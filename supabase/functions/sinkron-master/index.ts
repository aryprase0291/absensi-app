// =====================================================================
// SINKRON MASTER — Sheets menjadi Postgres, satu arah
//
// Dipanggil HANYA oleh Apps Script (SupabaseSync.gs), dilindungi rahasia
// bersama di header. Tidak ada jalur lain yang boleh menulis ke tabel
// cermin — itulah yang menjaga aturan "satu tabel, satu penulis".
//
// Seluruh pekerjaannya diserahkan ke satu fungsi Postgres supaya
// berjalan dalam SATU transaksi. Cermin yang setengah diperbarui jauh
// lebih berbahaya daripada cermin yang tertinggal sepuluh menit: yang
// tertinggal masih konsisten, yang setengah tidak, dan tidak ada yang
// akan menyadarinya sampai seseorang gagal login.
// =====================================================================

import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!rahasiaSinkronSah(req)) {
    return jawab({ ok: false, pesan: "Tidak berwenang." }, 401);
  }

  try {
    const muatan = await req.json();
    const { data, error } = await klienAdmin().rpc("sinkron_master", { p: muatan });
    if (error) throw error;
    return jawab({ ok: true, hasil: data });
  } catch (e) {
    console.error("sinkron-master gagal: " + (e as Error).message);
    return jawab({ ok: false, pesan: (e as Error).message }, 500);
  }
});
