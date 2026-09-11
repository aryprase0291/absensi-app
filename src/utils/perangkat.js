// =======================================================
// IDENTITAS PERANGKAT
//
// Dipakai untuk aturan "1 perangkat 1 akun" (lihat apps-script/Devices.gs).
//
// BENTUK ID: "<8 hex sidik perangkat>-<20 hex acak>"
//
// KENAPA DUA BAGIAN, DAN KENAPA BUKAN SALAH SATUNYA SAJA.
//
//   Bagian ACAK saja tidak cukup jujur: ia hilang begitu karyawan
//   membersihkan data situs, dan HP yang sama akan tampak sebagai HP baru
//   setiap kali — penguncian perangkat jadi tidak ada artinya, tanpa
//   satu pun jejak bahwa ada yang menghapusnya.
//
//   Bagian SIDIK saja juga tidak cukup: dua HP dengan model, resolusi,
//   dan zona waktu yang sama menghasilkan sidik yang sama persis. Di
//   satu kantor yang membagikan HP dinas seragam, itu berarti puluhan
//   orang dianggap memakai satu perangkat.
//
//   Digabung, keduanya menutup lubang masing-masing: ID tetap unik per
//   perangkat, TAPI kalau localStorage dibersihkan, ID barunya masih
//   berawalan 8 karakter yang sama. Panel Admin mengelompokkan perangkat
//   berdasarkan awalan itu, sehingga "satu HP dengan lima ID berbeda"
//   terlihat sebagai satu baris mencurigakan, bukan lima HP baru.
//
// YANG TIDAK DILAKUKAN DI SINI, DENGAN SENGAJA:
//   Tidak ada canvas/WebGL fingerprinting, tidak ada pembacaan daftar
//   font atau perangkat media. Semua bahan di bawah adalah properti yang
//   memang dipublikasikan browser untuk penyesuaian tampilan. Sidiknya
//   cukup untuk mengenali "HP yang sama", dan sengaja tidak lebih tajam
//   dari itu.
// =======================================================

const KUNCI_ID = 'absen_device_id';

// Cadangan bila localStorage tidak bisa ditulis (mode privat iOS lama).
// Umur sesi tab saja — lebih baik daripada ID baru di setiap request.
let idSementara = null;

/**
 * FNV-1a 32-bit. Bukan hash kriptografis, dan memang tidak perlu:
 * tugasnya cuma memadatkan beberapa properti jadi 8 karakter stabil.
 */
function hash32(teks) {
  let h = 0x811c9dc5;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function bahanSidik() {
  if (typeof navigator === 'undefined') return 'server';
  const n = navigator;
  // WAJIB `window.screen`, bukan `screen` telanjang. Konfigurasi eslint
  // CRA (react-app) melarangnya lewat aturan no-restricted-globals, dan
  // di sini larangan itu memang beralasan: `screen` juga nama ekspor
  // @testing-library/react, sehingga versi telanjangnya bisa menunjuk
  // benda yang sama sekali berbeda di dalam berkas tes.
  const s = (typeof window !== 'undefined' && window.screen) ? window.screen : {};
  let zona = '';
  try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* abaikan */ }

  return [
    String(n.userAgent || ''),
    String(n.platform || ''),
    String(n.language || ''),
    String(n.hardwareConcurrency || ''),
    String(n.deviceMemory || ''),
    String(n.maxTouchPoints || ''),
    String(s.width || ''),
    String(s.height || ''),
    String(s.colorDepth || ''),
    String(typeof window !== 'undefined' ? window.devicePixelRatio || '' : ''),
    zona
  ].join('|');
}

export function sidikPerangkat() {
  return hash32(bahanSidik());
}

function acakHex(panjang) {
  const buf = new Uint8Array(Math.ceil(panjang / 2));
  try {
    (window.crypto || window.msCrypto).getRandomValues(buf);
  } catch (e) {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < buf.length; i++) out += ('0' + buf[i].toString(16)).slice(-2);
  return out.slice(0, panjang);
}

/**
 * ID perangkat yang stabil. Dibuat sekali, lalu dipakai selamanya.
 * @returns {string}
 */
export function ambilDeviceId() {
  let tersimpan = null;
  try { tersimpan = localStorage.getItem(KUNCI_ID); } catch (e) { tersimpan = null; }

  // Format lama / rusak diperbaiki diam-diam, tapi hanya kalau memang
  // tidak berbentuk "<8hex>-<hex>". Jangan pernah menulis ulang ID yang
  // sudah sah: itu akan memutus ikatan perangkat yang tercatat di server.
  if (tersimpan && /^[0-9a-f]{8}-[0-9a-f]{8,}$/.test(tersimpan)) return tersimpan;
  if (idSementara) return idSementara;

  const baru = sidikPerangkat() + '-' + acakHex(20);
  try {
    localStorage.setItem(KUNCI_ID, baru);
  } catch (e) {
    idSementara = baru;
  }
  return baru;
}

/**
 * Nama perangkat yang bisa dibaca manusia di Panel Admin.
 * Sengaja kasar: yang dibutuhkan admin hanya "HP Android" atau "iPhone",
 * bukan nomor versi yang berubah tiap pembaruan sistem.
 */
export function labelPerangkat() {
  if (typeof navigator === 'undefined') return 'Tidak diketahui';
  const ua = String(navigator.userAgent || '');

  let sistem = 'Perangkat';
  if (/iPhone/i.test(ua)) sistem = 'iPhone';
  else if (/iPad/i.test(ua)) sistem = 'iPad';
  else if (/Android/i.test(ua)) sistem = 'Android';
  else if (/Windows/i.test(ua)) sistem = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) sistem = 'Mac';
  else if (/Linux/i.test(ua)) sistem = 'Linux';

  // Urutannya penting: hampir semua UA di Android memuat kata "Chrome",
  // dan UA Chrome memuat "Safari". Yang paling spesifik diperiksa dulu.
  let peramban = '';
  if (/FBAN|FBAV/i.test(ua)) peramban = 'Facebook';
  else if (/Instagram/i.test(ua)) peramban = 'Instagram';
  else if (/(WhatsApp)/i.test(ua)) peramban = 'WhatsApp';
  else if (/EdgA?\//i.test(ua)) peramban = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) peramban = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) peramban = 'Samsung Internet';
  else if (/Firefox/i.test(ua)) peramban = 'Firefox';
  else if (/CriOS|Chrome/i.test(ua)) peramban = 'Chrome';
  else if (/Safari/i.test(ua)) peramban = 'Safari';

  return peramban ? sistem + ' · ' + peramban : sistem;
}

/**
 * Paket lengkap untuk disertakan pada request login.
 */
export function infoPerangkat() {
  return {
    deviceId: ambilDeviceId(),
    deviceLabel: labelPerangkat(),
    devicePlatform: typeof navigator !== 'undefined' ? String(navigator.platform || '') : '',
    deviceUA: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 300) : ''
  };
}

/**
 * Hanya untuk pengujian dan untuk tombol "lupakan perangkat ini" bila
 * suatu saat dibutuhkan. JANGAN dipanggil di alur normal: menghapus ID
 * berarti perangkat ini akan tercatat sebagai perangkat baru di server.
 */
export function lupakanDeviceId() {
  try { localStorage.removeItem(KUNCI_ID); } catch (e) { /* abaikan */ }
  idSementara = null;
}
