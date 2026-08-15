// =======================================================
// HARI LIBUR NASIONAL INDONESIA
//
// Sumber: berkas JSON statis di raw.githubusercontent.com milik
// proyek APIHariLibur_V2 (guangrei). Dipilih setelah menguji beberapa
// alternatif:
//
//   - api-harilibur.vercel.app  -> membalas HTTP 402 (akun Vercel-nya
//     nonaktif). Sudah mati.
//   - dayoffapi.vercel.app      -> HTTP 402, sama.
//   - libur.deno.dev            -> HTTP 404.
//   - date.nager.at             -> hidup, tapi memblokir robot dan
//     data Indonesianya tidak memuat cuti bersama.
//
// Berkas statis di GitHub menang karena tidak ada server yang bisa
// mati: hanya berkas di CDN, dilayani dengan header CORS terbuka,
// tanpa kunci API, tanpa batas kuota.
//
// SATU HAL YANG HARUS DIINGAT: ini sumber pihak ketiga dan hanya
// memuat TAHUN BERJALAN. Karena itu seluruh modul ini dirancang
// supaya kegagalannya tidak terasa — kalender absensi tetap berfungsi
// penuh tanpa data libur; yang hilang hanya lapis keterangannya.
// =======================================================

import { useState, useEffect } from 'react';

const SUMBER = 'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/calendar.min.json';

const KUNCI_CACHE = 'hari_libur_v1';
// Daftar libur nasional bisa berubah di tengah tahun (penambahan cuti
// bersama lewat SKB), tapi tidak setiap hari. Seminggu sudah cukup.
const UMUR_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const BATAS_WAKTU_MS = 12000;

/**
 * Bentuk mentah dari sumber:
 *   { "2026-08-17": { holiday: true,
 *                     summary: ["Hari Proklamasi Kemerdekaan R.I."],
 *                     description: ["Hari libur nasional"] },
 *     ...,
 *     "info": { author, link, updated } }
 *
 * Yang dipakai hanya entri dengan holiday === true. Entri holiday:false
 * (mis. "Malam Tahun Baru") memang perayaan, tapi tetap hari kerja —
 * menandainya di kalender absensi justru menyesatkan.
 */
function olah(mentah) {
  const hasil = {};
  if (!mentah || typeof mentah !== 'object') return hasil;

  Object.keys(mentah).forEach((k) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;      // lewati kunci "info"
    const e = mentah[k];
    if (!e || e.holiday !== true) return;

    const nama = Array.isArray(e.summary) ? e.summary.join(', ') : String(e.summary || '');
    hasil[k] = {
      // Imbuhan "(belum pasti)" dibuang dari NAMA yang ditampilkan.
      // Sumbernya menambahkan itu untuk libur yang mengikuti kalender
      // Hijriah, yang tanggal pastinya baru ditetapkan lewat SKB
      // menjelang harinya. Tanpa dibuang, teksnya ikut muncul di tengah
      // nama hari libur: "Maulid Nabi Muhammad (belum pasti)".
      nama: nama.replace(/\s*\(belum pasti\)/i, '').trim(),
      // Statusnya tetap disimpan walau UI tidak lagi menampilkannya
      // (permintaan 15 Agu 2026) — supaya bisa dipakai lagi tanpa perlu
      // membongkar cara parsingnya.
      pasti: !/belum pasti/i.test(nama),
    };
  });

  return hasil;
}

function bacaCache() {
  try {
    const raw = localStorage.getItem(KUNCI_CACHE);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !c.data) return null;
    return c;                                  // umurnya diperiksa pemanggil
  } catch (e) { return null; }
}

function tulisCache(data) {
  try {
    localStorage.setItem(KUNCI_CACHE, JSON.stringify({ waktu: Date.now(), data }));
  } catch (e) { /* penyimpanan penuh atau diblokir: abaikan */ }
}

/**
 * @returns {{
 *   libur: Object.<string, {nama: string, pasti: boolean}>,
 *   status: 'memuat'|'siap'|'gagal',
 *   tahunAda: number[],
 *   dariCache: boolean
 * }}
 */
export function useHariLibur() {
  const [libur, setLibur] = useState({});
  const [status, setStatus] = useState('memuat');
  const [dariCache, setDariCache] = useState(false);

  useEffect(() => {
    let hidup = true;

    // 1. Tampilkan isi cache LEBIH DULU, tanpa menunggu jaringan.
    //    Layar tidak boleh berkedip hanya karena lapis tambahan.
    const cache = bacaCache();
    if (cache) {
      setLibur(cache.data);
      setStatus('siap');
      setDariCache(true);
      if (Date.now() - (cache.waktu || 0) < UMUR_CACHE_MS) return;  // masih segar
    }

    // 2. Ambil versi terbaru di latar.
    const kendali = new AbortController();
    const jamPasir = setTimeout(() => kendali.abort(), BATAS_WAKTU_MS);

    (async () => {
      try {
        const res = await fetch(SUMBER, { signal: kendali.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = olah(await res.json());
        if (!hidup) return;

        // Balasan kosong diperlakukan sebagai gagal. Menimpa cache yang
        // bagus dengan objek kosong akan menghapus data libur secara
        // permanen tanpa satu pun pesan error.
        if (Object.keys(data).length === 0) throw new Error('Data libur kosong');

        setLibur(data);
        setStatus('siap');
        setDariCache(false);
        tulisCache(data);
      } catch (e) {
        if (!hidup) return;
        // Kalau cache sempat terpasang, biarkan tetap terpakai.
        setStatus((s) => (s === 'siap' ? 'siap' : 'gagal'));
      } finally {
        clearTimeout(jamPasir);
      }
    })();

    return () => { hidup = false; kendali.abort(); clearTimeout(jamPasir); };
  }, []);

  const tahunAda = [...new Set(Object.keys(libur).map((k) => Number(k.slice(0, 4))))].sort();

  return { libur, status, tahunAda, dariCache };
}
