// =====================================================================
// TOKEN YANG DIMENGERTI APPS SCRIPT
//
// Inilah yang membuat Fase 1 bisa berdiri sendiri: token terbitan Edge
// Function ini berbentuk SAMA PERSIS dengan terbitan createAuthToken()
// di apps-script/Auth.gs, ditandatangani dengan rahasia yang sama.
// Akibatnya seluruh endpoint Apps Script yang belum dipindahkan —
// absen, riwayat, buka_aplikasi, ping GPS — tetap menerima token ini
// tanpa satu baris pun diubah.
//
// Bentuknya:  base64url(JSON payload) + "." + base64url(HMAC-SHA256)
//
// TIGA HAL YANG HARUS SAMA PERSIS, kalau tidak tandanya tidak cocok dan
// SEMUA request sesudah login akan ditolak:
//   1. Urutan & nama field payload tidak penting (JSON diurai, bukan
//      dibandingkan sebagai teks) — tapi ISI-nya penting.
//   2. base64EncodeWebSafe milik Apps Script MEMPERTAHANKAN padding '='.
//      Jangan dibuang.
//   3. Yang ditandatangani adalah STRING base64 itu sendiri, bukan JSON
//      mentahnya.
//
// Jangan percaya ketiganya begitu saja — jalankan SUPABASE_UJI_TOKEN()
// di editor Apps Script. Fungsi itu memverifikasi token buatan file ini
// dengan verifyAuthToken() yang asli, dan itulah buktinya.
// =====================================================================

const UMUR_TOKEN_MS = 12 * 60 * 60 * 1000; // sama dengan TOKEN_LIFETIME_MS

// SATU-SATUNYA HAL DI FILE INI YANG TIDAK BISA DIBUKTIKAN DARI LUAR
// APPS SCRIPT: apakah Utilities.base64EncodeWebSafe mempertahankan tanda
// '=' di ujung. Sepanjang pengetahuan saat file ini ditulis: YA.
//
// Kalau ternyata tidak, tanda tangannya tidak akan pernah cocok dan
// SUPABASE_UJI_TOKEN() akan berkata GAGAL. Perbaikannya satu baris:
// ubah nilai di bawah menjadi false, lalu deploy ulang.
//
// Jawaban pastinya dicetak SUPABASE_UJI_TOKEN() di editor Apps Script —
// ia menampilkan hasil base64EncodeWebSafe untuk masukan yang sudah
// diketahui, jadi tidak perlu ditebak.
const PERTAHANKAN_PADDING = true;

/** base64 web-safe — meniru Utilities.base64EncodeWebSafe. */
function base64WebSafe(bytes: Uint8Array): string {
  let biner = "";
  for (let i = 0; i < bytes.length; i++) biner += String.fromCharCode(bytes[i]);
  const hasil = btoa(biner).replace(/\+/g, "-").replace(/\//g, "_");
  return PERTAHANKAN_PADDING ? hasil : hasil.replace(/=+$/, "");
}

export interface IsiToken {
  id: string;
  sesiId: string;
  deviceId: string;
  tanda: string;
  role: string;
  divisi: string;
  lokasi: string;
}

export async function buatToken(isi: IsiToken, rahasia: string): Promise<string> {
  // Nama field sengaja sependek aslinya (u, s, dv, t, r, d, l, e):
  // verifyAuthToken dan authorizeRequest membacanya persis dengan nama itu.
  const payload = {
    u: String(isi.id),
    s: String(isi.sesiId || ""),
    dv: String(isi.deviceId || ""),
    t: String(isi.tanda || ""),
    r: String(isi.role || "").trim().toLowerCase(),
    d: String(isi.divisi || "").trim(),
    l: String(isi.lokasi || "All").trim(),
    e: Date.now() + UMUR_TOKEN_MS,
  };

  const body = base64WebSafe(new TextEncoder().encode(JSON.stringify(payload)));

  const kunci = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rahasia),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const tanda = await crypto.subtle.sign("HMAC", kunci, new TextEncoder().encode(body));

  return body + "." + base64WebSafe(new Uint8Array(tanda));
}

/** SessionID: 20 karakter heksadesimal, sama bentuknya dengan deviceTerbitkanSesi. */
export function buatSesiId(): string {
  return crypto.randomUUID().replace(/-/g, "").substring(0, 20);
}
