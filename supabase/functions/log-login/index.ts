// =====================================================================
// LOG LOGIN — jalur baca
//
// HANYA untuk Apps Script (dijaga rahasia sinkron). Sengaja TIDAK
// dibuka untuk browser walau ada tokennya: log ini memuat alamat IP dan
// pola percobaan gagal — bahan yang berguna justru bagi orang yang
// sedang mencoba masuk. Satu gerbang lebih sedikit berarti satu cara
// bocor lebih sedikit.
//
// Agregasinya ada di Postgres (log_login_ringkas / log_login_daftar),
// bukan di sini. Sembilan puluh hari x ~300 login sehari adalah puluhan
// ribu baris; mengirimnya mentah lalu menghitung di browser membuat
// yang lambat bukan lagi kuerinya, melainkan jaringannya.
// =====================================================================

import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!rahasiaSinkronSah(req)) {
    return jawab({ result: "error", message: "Tidak berwenang." }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const aksi = String(body.aksi || "").trim();
    const db = klienAdmin();

    if (aksi === "ringkas") {
      const { data, error } = await db.rpc("log_login_ringkas", {
        p: { dari: body.dari, sampai: body.sampai },
      });
      if (error) throw error;
      return jawab({ result: "success", ...data });
    }

    if (aksi === "daftar") {
      const { data, error } = await db.rpc("log_login_daftar", {
        p: {
          dari: body.dari, sampai: body.sampai,
          cari: body.cari, hanyaGagal: body.hanyaGagal,
          batas: body.batas, offset: body.offset,
        },
      });
      if (error) throw error;
      return jawab({ result: "success", ...data });
    }

    // Masa simpan 90 hari. Dipanggil berkala dari Apps Script, bukan dari
    // jalur login — lihat catatan di migrasinya.
    if (aksi === "bersihkan") {
      const { data, error } = await db.rpc("log_login_bersihkan", {});
      if (error) throw error;
      return jawab({ result: "success", ...data });
    }

    return jawab({ result: "error", message: "Aksi tidak dikenal: " + aksi }, 400);
  } catch (e) {
    console.error("log-login gagal: " + (e as Error).message);
    return jawab({ result: "error", message: (e as Error).message }, 500);
  }
});
