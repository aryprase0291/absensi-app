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

/** Kebalikannya — meniru Utilities.base64DecodeWebSafe. */
function base64WebSafeBalik(teks: string): Uint8Array {
  let s = teks.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  const biner = atob(s);
  const out = new Uint8Array(biner.length);
  for (let i = 0; i < biner.length; i++) out[i] = biner.charCodeAt(i);
  return out;
}

async function kunciHmac(rahasia: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rahasia),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function tandaTangan(body: string, rahasia: string): Promise<string> {
  const tanda = await crypto.subtle.sign(
    "HMAC",
    await kunciHmac(rahasia),
    new TextEncoder().encode(body),
  );
  return base64WebSafe(new Uint8Array(tanda));
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
  return body + "." + await tandaTangan(body, rahasia);
}

/** SessionID: 20 karakter heksadesimal, sama bentuknya dengan deviceTerbitkanSesi. */
export function buatSesiId(): string {
  return crypto.randomUUID().replace(/-/g, "").substring(0, 20);
}

// =====================================================================
// VERIFIKASI — cerminan verifyAuthToken() di apps-script/Auth.gs
//
// Dipakai endpoint yang dipanggil LANGSUNG oleh browser karyawan
// (lihat functions/dbabsen). Tanpa ini, satu-satunya cara memastikan
// pemanggilnya sah adalah menumpang Apps Script — dan itu justru biaya
// yang sedang dihapus.
//
// Yang TIDAK diperiksa di sini: SessionID (aturan satu perangkat).
// Pemeriksaan itu butuh Script Properties dan tetap tinggal di
// authorizeRequest. Akibat yang disengaja: perangkat yang sesinya sudah
// digusur masih bisa MEMBACA riwayatnya sendiri sampai tokennya
// kedaluwarsa, tapi tidak bisa mengabsen atau menyentuh apa pun yang
// mengubah data. Menaruh pembacaan riwayat di belakang penggusuran sesi
// tidak sepadan dengan satu round trip tambahan ke Apps Script pada
// setiap pembukaan layar.
// =====================================================================

export interface TokenTerbaca {
  u: string;   // userId
  s: string;   // sessionId
  r: string;   // role
  d: string;   // divisi
  l: string;   // lokasi
  e: number;   // kedaluwarsa (epoch ms)
}

export async function bacaToken(
  token: unknown,
  rahasia: string,
): Promise<TokenTerbaca | null> {
  if (!token || typeof token !== "string") return null;

  const bagian = token.split(".");
  if (bagian.length !== 2) return null;

  const [body, sig] = bagian;

  const diharapkan = await tandaTangan(body, rahasia);
  // Perbandingan panjang tetap, sama seperti _timingSafeEqual.
  if (sig.length !== diharapkan.length) return null;
  let beda = 0;
  for (let i = 0; i < sig.length; i++) {
    beda |= sig.charCodeAt(i) ^ diharapkan.charCodeAt(i);
  }
  if (beda !== 0) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64WebSafeBalik(body)));
  } catch (_e) {
    return null;
  }

  if (!payload || !payload.u || !payload.e) return null;
  if (Date.now() > Number(payload.e)) return null;

  return {
    u: String(payload.u),
    s: String(payload.s || ""),
    r: String(payload.r || "").trim().toLowerCase(),
    d: String(payload.d || ""),
    l: String(payload.l || "All"),
    e: Number(payload.e),
  };
}
