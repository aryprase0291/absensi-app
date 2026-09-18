// =====================================================================
// SESI TERBARU — Postgres menjadi Apps Script, satu arah
//
// Inilah yang membuat aturan "satu akun satu perangkat" tetap hidup
// walaupun login sudah pindah. Apps Script memanggilnya setiap menit dan
// menyalin hasilnya ke Script Properties, sehingga authorizeRequest di
// sana tetap membaca dari tempat yang sama seperti dulu — tanpa satu pun
// tambahan request pada jalur panas.
//
// Hanya baris yang BERUBAH sejak penarikan terakhir yang dikirim. Tanpa
// tanda air itu, setiap menit Apps Script akan menulis ulang ratusan
// properti tanpa satu nilai pun yang berbeda.
//
// Konsekuensi yang disengaja: penggusuran sesi telat paling lama satu
// putaran penarikan (60 detik).
// =====================================================================

import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";

// Batas aman satu tarikan. Kalau sampai terlampaui, sisanya ikut di
// putaran berikutnya — tanda airnya memang dimaksudkan untuk itu.
const BATAS = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!rahasiaSinkronSah(req)) {
    return jawab({ ok: false, pesan: "Tidak berwenang." }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    // Tumpang tindih 5 detik: jam server Postgres dan Apps Script tidak
    // dijamin sama persis, dan baris yang jatuh tepat di batas jauh lebih
    // baik terkirim dua kali daripada tidak sama sekali.
    const sejak = String(body.sejak || "1970-01-01T00:00:00Z");
    const sejakLonggar = new Date(new Date(sejak).getTime() - 5000).toISOString();

    const { data, error } = await klienAdmin()
      .from("sesi_aktif")
      .select("karyawan_id,sesi_id,diperbarui_pada")
      .gt("diperbarui_pada", sejakLonggar)
      .order("diperbarui_pada", { ascending: true })
      .limit(BATAS);

    if (error) throw error;

    const baris = data || [];
    return jawab({
      ok: true,
      sesi: baris.map((r) => ({ id: r.karyawan_id, sesi: r.sesi_id })),
      // Tanda air untuk tarikan berikutnya: stempel baris TERAKHIR yang
      // benar-benar terkirim, bukan "sekarang". Kalau memakai "sekarang"
      // sementara hasilnya terpotong BATAS, sisanya akan terlewat
      // selamanya.
      sampai: baris.length ? baris[baris.length - 1].diperbarui_pada : sejak,
      terpotong: baris.length >= BATAS,
    });
  } catch (e) {
    console.error("sesi-terbaru gagal: " + (e as Error).message);
    return jawab({ ok: false, pesan: (e as Error).message }, 500);
  }
});
