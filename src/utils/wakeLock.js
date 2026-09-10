// =====================================================================
// PENAHAN LAYAR (SCREEN WAKE LOCK)
//
// KENAPA FILE INI ADA
//
// Pelacakan posisi hanya berguna kalau titiknya tetap terkirim saat
// karyawan TIDAK sedang menyentuh aplikasinya — sedang menyetir, sedang
// di lokasi pelanggan, HP di saku. Di web, itulah bagian yang paling
// sering gagal, dan alasannya bukan kode yang salah:
//
//   1. Tab yang tersembunyi di-throttle berat. Timer yang seharusnya
//      berjalan tiap 5 menit bisa mundur menjadi sekali per menit atau
//      berhenti sama sekali.
//   2. LAYAR YANG TERKUNCI menghentikan pembacaan posisi sepenuhnya di
//      iOS dan sebagian besar Android. Tidak ada API yang bisa
//      mengakalinya — Service Worker sekalipun tidak boleh membaca GPS.
//
// Wake Lock menyerang penyebab nomor dua: selama pelacakan aktif, layar
// ditahan supaya tidak mati sendiri, sehingga halaman tetap "terlihat"
// bagi browser dan geolocation terus bekerja.
//
// TIGA HAL YANG HARUS DIINGAT SEBELUM MENGUBAH FILE INI
//
// - Lock HANYA bisa diminta saat dokumen terlihat. Memanggilnya dari tab
//   tersembunyi melempar NotAllowedError. Karena itu permintaannya
//   diulang lewat 'visibilitychange', bukan lewat timer.
// - Lock DILEPAS SENDIRI oleh browser saat user berpindah aplikasi atau
//   mengunci layar secara manual. Itu perilaku normal, bukan kegagalan;
//   yang penting ia diminta lagi begitu aplikasi kembali dibuka.
// - Safari iOS baru mendukungnya sejak iOS 16.4, dan sebagian browser
//   dalam aplikasi (WebView Instagram/WA) tidak punya sama sekali.
//   Ketidakhadirannya tidak boleh mengganggu apa pun — pelacakan tetap
//   berjalan, hanya lebih mudah terputus saat layar mati.
//
// Biaya yang jujur: baterai lebih boros. Saklarnya ada di
// GPS_WAKE_LOCK_AKTIF (config/constants.js, REACT_APP_GPS_WAKE_LOCK=0).
// =====================================================================

export function wakeLockDidukung() {
  try {
    return typeof navigator !== 'undefined' &&
      !!navigator.wakeLock &&
      typeof navigator.wakeLock.request === 'function';
  } catch (e) {
    return false;
  }
}

/**
 * Menyalakan penahan layar dan menjaganya tetap hidup.
 *
 * @param {Function} [onStatus] dipanggil saat status berubah:
 *        { aktif: boolean, didukung: boolean, alasan: string }
 * @returns {Function} penghenti — WAJIB dipanggil saat logout/unmount,
 *          kalau tidak layar karyawan akan menyala terus sepanjang hari.
 */
export function mulaiWakeLock(onStatus) {
  let hidup = true;
  let sentinel = null;

  const kabar = (isi) => { try { if (onStatus) onStatus(isi); } catch (e) { /* abaikan */ } };

  if (!wakeLockDidukung()) {
    kabar({ aktif: false, didukung: false, alasan: 'tidak-didukung' });
    return () => {};
  }

  const minta = async () => {
    if (!hidup) return;
    if (sentinel && !sentinel.released) return;
    // Permintaan dari tab tersembunyi selalu ditolak browser. Menahannya
    // di sini lebih murah daripada menangkap exception-nya.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      kabar({ aktif: true, didukung: true, alasan: '' });
      // Browser melepas sendiri saat user berpindah aplikasi. Yang
      // dilakukan di sini hanya mencatat; permintaan ulang datang dari
      // 'visibilitychange' ketika karyawan kembali.
      sentinel.addEventListener('release', () => {
        if (!hidup) return;
        kabar({ aktif: false, didukung: true, alasan: 'dilepas-browser' });
      });
    } catch (e) {
      sentinel = null;
      // Baterai lemah (mode hemat daya Android) juga menolak permintaan
      // ini. Tidak ada yang perlu diperbaiki karyawan, jadi diam saja.
      kabar({ aktif: false, didukung: true, alasan: (e && e.name) || 'ditolak' });
    }
  };

  const saatTerlihat = () => {
    if (!hidup) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    minta();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', saatTerlihat);
  }
  minta();

  return function hentikanWakeLock() {
    hidup = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', saatTerlihat);
    }
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) {
      try { s.release(); } catch (e) { /* abaikan */ }
    }
    kabar({ aktif: false, didukung: true, alasan: 'dihentikan' });
  };
}
