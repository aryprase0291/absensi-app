// =======================================================
// PENGUNCI KAMERA DEPAN
//
// Masalah yang diperbaiki:
//   constraint { facingMode: 'user' } itu hanya PERMINTAAN HALUS. Kalau
//   browser/OS punya "kamera bawaan" lain (mis. izin situs di Chrome
//   dikunci ke kamera belakang, WebView aplikasi lain, atau HP dengan
//   banyak lensa), browser boleh saja memberi kamera belakang dan kode
//   lama tidak pernah memeriksa kamera mana yang benar-benar menyala.
//
// Modul ini:
//   1. Meminta kamera depan secara TEGAS ({ exact: 'user' }).
//   2. Kalau gagal, mencari perangkat video berlabel depan lewat
//      enumerateDevices() dan membukanya lewat deviceId.
//   3. Memverifikasi ulang stream yang didapat (track.getSettings() dan
//      label perangkat). Kalau ternyata kamera belakang -> stream
//      dimatikan dan dilempar error, bukan dipakai.
// =======================================================

export const POLA_BELAKANG = /(^|[^a-z])(back|rear|belakang|environment|world|dunia)([^a-z]|$)/i;
export const POLA_DEPAN = /(^|[^a-z])(front|depan|user|selfie|face|facetime)([^a-z]|$)/i;

export class KameraDepanError extends Error {
  constructor(message, kode = 'gagal') {
    super(message);
    this.name = 'KameraDepanError';
    this.kode = kode;
  }
}

/** Matikan semua track pada sebuah MediaStream. */
export function hentikanStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    /* diamkan: stream mungkin sudah mati */
  }
}

/**
 * Periksa apakah stream benar-benar berasal dari kamera depan.
 * @returns {{ ok: boolean, facing: string, label: string, dikenali: boolean, alasan: string }}
 */
export function periksaStreamDepan(stream) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track) {
    return { ok: false, facing: '', label: '', dikenali: false, alasan: 'Tidak ada aliran video dari kamera.' };
  }

  let settings = {};
  try {
    settings = typeof track.getSettings === 'function' ? track.getSettings() || {} : {};
  } catch (e) {
    settings = {};
  }

  const facing = String(settings.facingMode || '');
  const label = String(track.label || '');

  if (facing === 'environment' || facing === 'left' || facing === 'right') {
    return { ok: false, facing, label, dikenali: true, alasan: 'Kamera belakang terdeteksi.' };
  }
  if (facing === 'user') {
    return { ok: true, facing, label, dikenali: true, alasan: '' };
  }

  // facingMode tidak dilaporkan (umum di laptop & sebagian Safari) -> pakai label.
  if (POLA_BELAKANG.test(label)) {
    return { ok: false, facing, label, dikenali: true, alasan: 'Kamera belakang terdeteksi dari nama perangkat.' };
  }
  if (POLA_DEPAN.test(label)) {
    return { ok: true, facing: 'user', label, dikenali: true, alasan: '' };
  }

  // Tidak bisa dipastikan. Diizinkan, tapi ditandai supaya verifikasi wajah
  // tetap menjadi penjaga terakhir dan UI bisa memberi keterangan.
  return { ok: true, facing: '', label, dikenali: false, alasan: '' };
}

function pesanDariError(err) {
  const nama = err && err.name ? err.name : '';
  if (nama === 'NotAllowedError' || nama === 'SecurityError') {
    return 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini, lalu coba lagi.';
  }
  if (nama === 'NotFoundError' || nama === 'OverconstrainedError' || nama === 'DevicesNotFoundError') {
    return 'Kamera depan tidak ditemukan pada perangkat ini. Presensi wajib memakai kamera depan.';
  }
  if (nama === 'NotReadableError' || nama === 'TrackStartError') {
    return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
  }
  return 'Gagal membuka kamera depan. Periksa izin kamera pada browser Anda.';
}

/**
 * Buka kamera depan dengan verifikasi berlapis.
 * @returns {Promise<{ stream: MediaStream, facing: string, label: string, dikenali: boolean }>}
 * @throws {KameraDepanError}
 */
export async function bukaKameraDepan({ width = 640, height = 480 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new KameraDepanError('Browser ini tidak mendukung akses kamera. Gunakan Chrome atau Safari versi terbaru.', 'tidak-didukung');
  }

  const dasar = { width: { ideal: width }, height: { ideal: height } };
  const percobaan = [
    { video: { ...dasar, facingMode: { exact: 'user' } } },
    { video: { ...dasar, facingMode: 'user' } },
  ];

  let errTerakhir = null;
  let ditolakBelakang = false;

  for (const constraint of percobaan) {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraint);
    } catch (err) {
      errTerakhir = err;
      continue;
    }
    const cek = periksaStreamDepan(stream);
    if (cek.ok) return { stream, facing: cek.facing, label: cek.label, dikenali: cek.dikenali };
    ditolakBelakang = true;
    hentikanStream(stream);
  }

  // Jalur terakhir: pilih perangkat kamera depan secara manual.
  let perangkat = [];
  try {
    perangkat = await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    perangkat = [];
  }

  const kandidat = perangkat
    .filter((d) => d.kind === 'videoinput' && !POLA_BELAKANG.test(d.label || ''))
    .sort((a, b) => (POLA_DEPAN.test(b.label || '') ? 1 : 0) - (POLA_DEPAN.test(a.label || '') ? 1 : 0));

  for (const d of kandidat) {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...dasar, deviceId: { exact: d.deviceId } } });
    } catch (err) {
      errTerakhir = err;
      continue;
    }
    const cek = periksaStreamDepan(stream);
    if (cek.ok) return { stream, facing: cek.facing, label: cek.label, dikenali: cek.dikenali };
    ditolakBelakang = true;
    hentikanStream(stream);
  }

  if (ditolakBelakang) {
    throw new KameraDepanError(
      'Presensi wajib memakai KAMERA DEPAN. Perangkat ini hanya memberikan kamera belakang. '
      + 'Buka pengaturan izin kamera pada browser, pilih kamera depan (front), lalu coba lagi.',
      'kamera-belakang'
    );
  }
  throw new KameraDepanError(pesanDariError(errTerakhir), 'gagal-buka');
}
