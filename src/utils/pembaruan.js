// =======================================================
// PENGAWAS PEMBARUAN FRONTEND
//
// Masalah yang diperbaiki (9 Sep 2026):
//   Pemeriksaan versi lama hanya membandingkan versi bundle dengan versi
//   BACKEND (Apps Script) lewat action check_version. Akibatnya:
//     - Frontend yang sudah di-deploy tapi Apps Script belum disalin ->
//       server melapor versi lama -> HP karyawan tidak pernah diminta
//       update dan tetap memakai bundle lama berhari-hari.
//     - Sisa Service Worker / Cache Storage dari rilis lama tetap
//       menyajikan index.html lama, jadi "refresh" pun tidak menolong.
//
// Modul ini membaca /update-manifest.json — berkas yang ikut ter-upload
// bersama bundle, jadi ISINYA SELALU MENCERMINKAN APA YANG ADA DI SERVER
// SAAT ITU JUGA, tanpa bergantung pada deploy Apps Script.
// =======================================================

const BASE = process.env.PUBLIC_URL || '';
export const URL_MANIFEST = `${BASE}/update-manifest.json`;

const KUNCI_SW_BERSIH = 'sw_dibersihkan';

/**
 * Bandingkan dua versi "x.y.z".
 * @returns {number} >0 bila a lebih baru, <0 bila b lebih baru, 0 bila sama.
 */
export function bandingkanVersi(a, b) {
  const pecah = (v) => String(v || '').split('.').map((n) => Number(n) || 0);
  const va = pecah(a);
  const vb = pecah(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    const selisih = (va[i] || 0) - (vb[i] || 0);
    if (selisih !== 0) return selisih;
  }
  return 0;
}

/**
 * Ambil versi frontend yang SEDANG ADA DI SERVER.
 * Selalu tanpa cache: query penanda waktu + cache: 'no-store'.
 * @returns {Promise<{ versi: string, wajib: boolean }>}
 */
export async function ambilVersiFrontendServer() {
  const res = await fetch(`${URL_MANIFEST}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!res.ok) throw new Error(`update-manifest.json tidak terbaca (${res.status})`);
  const data = await res.json();
  const versi = data && data.frontend && data.frontend.currentVersion;
  if (!versi) throw new Error('update-manifest.json tidak memuat versi frontend');
  const riwayat = (data.frontend.history || []).find((r) => r.version === versi);
  return { versi: String(versi), wajib: riwayat ? riwayat.required !== false : true };
}

/**
 * Hapus Service Worker dan Cache Storage yang tertinggal.
 * Aplikasi ini TIDAK memakai Service Worker; apa pun yang terdaftar adalah
 * sisa rilis lama dan justru menyajikan berkas basi.
 * @returns {Promise<{ adaSw: boolean, adaCache: boolean }>}
 */
export async function bersihkanCacheDanServiceWorker() {
  let adaSw = false;
  let adaCache = false;

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const daftar = await navigator.serviceWorker.getRegistrations();
      adaSw = daftar.length > 0;
      await Promise.all(daftar.map((r) => r.unregister()));
    } catch (e) { /* abaikan */ }
  }

  if (typeof caches !== 'undefined' && caches.keys) {
    try {
      const kunci = await caches.keys();
      adaCache = kunci.length > 0;
      await Promise.all(kunci.map((k) => caches.delete(k)));
    } catch (e) { /* abaikan */ }
  }

  return { adaSw, adaCache };
}

/**
 * Muat ulang halaman setelah cache dibersihkan.
 * replace(), bukan href, supaya tombol "kembali" tidak membawa user
 * kembali ke halaman versi lama.
 */
export async function muatUlangBersih(versi) {
  await bersihkanCacheDanServiceWorker();
  const penanda = `?v=${encodeURIComponent(versi || 'baru')}&t=${Date.now()}`;
  window.location.replace(window.location.pathname + penanda);
}

/**
 * Dijalankan sekali saat aplikasi dimuat (dari src/index.js), SEBELUM React.
 * Kalau ditemukan sisa Service Worker / Cache Storage, keduanya dihapus lalu
 * halaman dimuat ulang SATU KALI supaya berkas yang dipakai benar-benar
 * berasal dari server, bukan dari cache lama. Penanda sessionStorage
 * mencegah putaran muat-ulang tanpa henti.
 */
export async function bersihkanSisaCacheSaatBoot() {
  if (typeof window === 'undefined') return;
  let sudah = false;
  try { sudah = sessionStorage.getItem(KUNCI_SW_BERSIH) === '1'; } catch (e) { sudah = false; }
  if (sudah) return;
  try { sessionStorage.setItem(KUNCI_SW_BERSIH, '1'); } catch (e) { /* abaikan */ }

  const { adaSw, adaCache } = await bersihkanCacheDanServiceWorker();
  if (adaSw || adaCache) {
    // Berkas halaman ini kemungkinan besar berasal dari cache yang barusan
    // dihapus. Ambil ulang dari server sekali.
    window.location.reload();
  }
}

/**
 * Pasang pemantau: cek versi saat aplikasi kembali aktif (pindah tab,
 * kembali dari layar kunci, atau halaman dipulihkan dari bfcache).
 * @param {() => void} cek
 * @returns {() => void} pembatal
 */
export function pantauPembaruan(cek) {
  if (typeof window === 'undefined') return () => {};
  const saatTerlihat = () => { if (document.visibilityState === 'visible') cek(); };
  const saatFokus = () => cek();
  const saatDipulihkan = (ev) => { if (ev && ev.persisted) cek(); };

  document.addEventListener('visibilitychange', saatTerlihat);
  window.addEventListener('focus', saatFokus);
  window.addEventListener('pageshow', saatDipulihkan);

  return () => {
    document.removeEventListener('visibilitychange', saatTerlihat);
    window.removeEventListener('focus', saatFokus);
    window.removeEventListener('pageshow', saatDipulihkan);
  };
}
