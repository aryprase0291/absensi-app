// =====================================================================
// GERBANG GPS WAJIB
//
// Aturan yang diminta: karyawan tidak boleh masuk ke menu mana pun
// sebelum lokasi perangkatnya benar-benar dapat dibaca.
//
// TIGA HAL YANG MEMBEDAKAN INI DARI SEKADAR `if (!posisi) tolak`
//
// 1. TIGA KEGAGALAN, TIGA JALAN KELUAR YANG BERBEDA.
//    Izin ditolak, layanan lokasi perangkat mati, dan sinyal tidak
//    ketemu adalah tiga masalah berbeda dengan tiga cara memperbaiki
//    yang sama sekali berbeda. Pesan "GPS tidak aktif" untuk ketiganya
//    hanya membuat karyawan menelepon HRD.
//
// 2. PERCOBAAN KEDUA DENGAN AKURASI RENDAH.
//    enableHighAccuracy menyalakan cip GPS, dan di dalam gedung beton
//    cip itu sering tidak menemukan satelit sampai timeout. Percobaan
//    kedua memakai lokasi jaringan (WiFi/seluler) yang hampir selalu
//    berhasil di dalam ruangan. Tanpa ini, karyawan yang jujur akan
//    terkunci di lobi kantor sendiri — kegagalan yang jauh lebih mahal
//    daripada kelonggaran akurasinya.
//
// 3. HTTPS DIPERIKSA DULUAN.
//    Semua browser modern mematikan Geolocation di halaman non-HTTPS.
//    Kalau aplikasi disajikan lewat http://, TIDAK ADA karyawan yang
//    bisa lolos gerbang ini, dan itu bukan kesalahan mereka. Kasus itu
//    dikenali terpisah supaya tidak seluruh perusahaan berhenti absen
//    karena satu setelan hosting.
// =====================================================================

export const GPS_STATUS = {
  OK: 'ok',                       // posisi didapat
  MEMERIKSA: 'memeriksa',
  DITOLAK: 'ditolak',             // izin lokasi ditolak user/browser
  PERANGKAT_MATI: 'perangkat_mati', // layanan lokasi perangkat mati / tak ada sinyal
  TIDAK_DIDUKUNG: 'tidak_didukung', // browser tanpa Geolocation API
  TIDAK_AMAN: 'tidak_aman'        // halaman bukan HTTPS -> API dimatikan browser
};

const bacaPosisi = (opsi) =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opsi);
  });

/**
 * Menebak jenis perangkat hanya untuk memilih kalimat panduan yang benar.
 * Tidak dipakai untuk keputusan apa pun — salah tebak paling buruk hanya
 * membuat panduannya kurang pas, bukan mengunci orang.
 */
export function jenisPerangkat() {
  const ua = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/**
 * Membaca izin lewat Permissions API bila tersedia. Safari iOS tidak
 * mendukungnya, jadi hasilnya hanya dipakai sebagai petunjuk tambahan —
 * keputusan tetap diambil dari percobaan membaca posisi yang sebenarnya.
 */
export async function statusIzin() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'tidak_diketahui';
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state; // 'granted' | 'denied' | 'prompt'
  } catch (e) {
    return 'tidak_diketahui';
  }
}

/**
 * Pemeriksaan utama gerbang.
 *
 * @returns {Promise<{status: string, posisi: ?Object, pesan: string, kode: ?number}>}
 *          status OK berarti boleh masuk. Selain itu, tahan di gerbang.
 */
export async function periksaGpsWajib(opsi) {
  const diam = !!(opsi && opsi.diam);
  // --- 1. Halaman harus aman (HTTPS / localhost) --------------------
  const aman = typeof window !== 'undefined' &&
    (window.isSecureContext === true ||
     window.location.protocol === 'https:' ||
     window.location.hostname === 'localhost' ||
     window.location.hostname === '127.0.0.1');

  if (!aman) {
    return {
      status: GPS_STATUS.TIDAK_AMAN,
      posisi: null,
      kode: null,
      pesan: 'Aplikasi sedang diakses lewat koneksi tidak aman (http://). ' +
             'Semua browser mematikan akses lokasi pada halaman seperti ini.'
    };
  }

  // --- 2. Browser harus punya Geolocation ---------------------------
  if (!('geolocation' in navigator)) {
    return {
      status: GPS_STATUS.TIDAK_DIDUKUNG,
      posisi: null,
      kode: null,
      pesan: 'Browser ini tidak mendukung layanan lokasi.'
    };
  }

  // --- 3. Percobaan pertama: GPS presisi tinggi ----------------------
  let galat = null;
  try {
    // Mode diam dipakai untuk karyawan yang izinnya SUDAH diberikan:
    // pembacaan terakhir (maks. 5 menit) boleh dipakai apa adanya supaya
    // aplikasi terbuka seketika dan cip GPS tidak perlu dinyalakan ulang.
    const pos = await bacaPosisi({
      enableHighAccuracy: !diam,
      timeout: diam ? 20000 : 12000,
      maximumAge: diam ? 300000 : 0
    });
    return {
      status: GPS_STATUS.OK,
      posisi: { lat: pos.coords.latitude, lng: pos.coords.longitude, akurasi: pos.coords.accuracy },
      kode: null,
      pesan: ''
    };
  } catch (e) {
    galat = e;
  }

  // Izin ditolak tidak perlu dicoba ulang: hasilnya pasti sama sampai
  // karyawan sendiri mengubah setelan browsernya.
  if (galat && galat.code === 1) {
    return {
      status: GPS_STATUS.DITOLAK,
      posisi: null,
      kode: 1,
      pesan: 'Izin akses lokasi ditolak.'
    };
  }

  // --- 4. Percobaan kedua: lokasi jaringan (dalam ruangan) ----------
  try {
    const pos = await bacaPosisi({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    return {
      status: GPS_STATUS.OK,
      posisi: { lat: pos.coords.latitude, lng: pos.coords.longitude, akurasi: pos.coords.accuracy },
      kode: null,
      pesan: ''
    };
  } catch (e) {
    galat = e;
  }

  if (galat && galat.code === 1) {
    return { status: GPS_STATUS.DITOLAK, posisi: null, kode: 1, pesan: 'Izin akses lokasi ditolak.' };
  }

  // code 2 = POSITION_UNAVAILABLE (layanan lokasi perangkat mati)
  // code 3 = TIMEOUT (sinyal tidak ketemu)
  return {
    status: GPS_STATUS.PERANGKAT_MATI,
    posisi: null,
    kode: galat ? galat.code : null,
    pesan: galat && galat.code === 3
      ? 'Waktu pencarian lokasi habis. Sinyal GPS belum ditemukan.'
      : 'Layanan lokasi perangkat tidak aktif atau tidak dapat dibaca.'
  };
}


// =====================================================================
// INGATAN IZIN
//
// Tujuannya satu: karyawan yang SUDAH pernah mengizinkan lokasi tidak
// perlu melihat layar gerbang lagi setiap kali membuka aplikasi.
//
// Sumber kebenaran utamanya Permissions API. Safari iOS tidak
// mendukungnya untuk geolocation, jadi di sana dipakai catatan lokal:
// "perangkat ini pernah berhasil membaca posisi". Catatan itu hanya
// mempercepat pembukaan — posisinya tetap dibaca ulang di latar
// belakang, dan gerbang tetap muncul kalau pembacaan itu gagal.
// =====================================================================

const KUNCI_IZIN = 'gps_izin_pernah_ok';
const UMUR_INGATAN_MS = 60 * 24 * 3600 * 1000; // 60 hari

export function tandaiIzinPernahOk() {
  try { localStorage.setItem(KUNCI_IZIN, String(Date.now())); } catch (e) { /* mode privat: abaikan */ }
}

export function lupakanIzin() {
  try { localStorage.removeItem(KUNCI_IZIN); } catch (e) { /* abaikan */ }
}

function ingatanMasihBerlaku() {
  try {
    const t = Number(localStorage.getItem(KUNCI_IZIN) || 0);
    return t > 0 && (Date.now() - t) < UMUR_INGATAN_MS;
  } catch (e) {
    return false;
  }
}

/**
 * Apakah aplikasi boleh langsung dibuka tanpa memperlihatkan gerbang?
 *
 * true  -> izin sudah ada; buka menu, verifikasi posisi di latar belakang
 * false -> browser akan bertanya, atau izinnya memang ditolak; tahan di gerbang
 */
export async function izinSudahDiberikan() {
  const izin = await statusIzin();
  if (izin === 'granted') return true;
  // 'denied' dan 'prompt' sama-sama berarti karyawan akan melihat dialog
  // atau memang sudah menolak — keduanya harus lewat gerbang.
  if (izin === 'denied' || izin === 'prompt') {
    if (izin === 'denied') lupakanIzin();
    return false;
  }
  // Permissions API tidak tersedia (Safari iOS): pakai catatan lokal.
  return ingatanMasihBerlaku();
}
