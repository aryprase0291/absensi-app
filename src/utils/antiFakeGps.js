// =======================================================
// ANTI-FAKE GPS — LAPIS CLIENT
//
// BATAS YANG HARUS DISADARI
// Semua yang ada di file ini berjalan di perangkat karyawan, jadi
// SELALU anggap bisa dipalsukan oleh orang yang paham DevTools. Nilainya
// bukan sebagai penjaga terakhir, melainkan sebagai pengumpul bukti:
// hasilnya dikirim ke server dan diperiksa ulang di sana bersama riwayat
// absensi karyawan (apps-script/AntiFakeGps.gs), yang TIDAK bisa
// disentuh dari browser. Keputusan menolak absen ada di server.
//
// YANG DIPERIKSA DI SINI
// 1. Flag Mock Location bila WebView/Android mengekspornya
// 2. Jitter antar-sampel — pembeda terkuat yang tersedia di browser
// 3. Nilai koordinat yang mustahil (0,0 / akurasi 0 / presisi rendah)
// 4. Lingkungan otomasi (Selenium/Puppeteer)
// 5. Penyimpangan timestamp GPS terhadap jam perangkat
// 6. Sidik jari perangkat, untuk mendeteksi absen berpindah-pindah HP
// =======================================================

const JEDA_SAMPEL_MS = 1200;   // jeda antar pembacaan GPS
const JITTER_NOL_TOLERANSI = 0; // GPS asli praktis tidak pernah 0,0 m

// -------------------------------------------------------
// SIDIK JARI PERANGKAT
//
// Bukan untuk identifikasi pribadi — hanya penanda stabil agar terlihat
// kalau satu akun tiba-tiba absen dari perangkat yang berbeda-beda.
// -------------------------------------------------------
function hashSederhana(teks) {
  let h = 0;
  for (let i = 0; i < teks.length; i++) {
    h = ((h << 5) - h) + teks.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

export function ambilSidikPerangkat() {
  let tersimpan = null;
  try { tersimpan = localStorage.getItem('absen_device_id'); } catch (e) { /* storage diblokir */ }

  const komponen = [
    navigator.userAgent || '',
    navigator.platform || '',
    String(navigator.hardwareConcurrency || ''),
    String((window.screen && window.screen.width) || '') + 'x' + String((window.screen && window.screen.height) || ''),
    String(window.devicePixelRatio || ''),
    (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
    String(navigator.language || '')
  ].join('|');

  const sidik = hashSederhana(komponen);
  if (!tersimpan) {
    tersimpan = sidik;
    try { localStorage.setItem('absen_device_id', tersimpan); } catch (e) { /* abaikan */ }
  }

  return {
    deviceId: tersimpan,
    sidikSaatIni: sidik,
    // true bila perangkat berbeda dari yang pertama kali dipakai login.
    perangkatBerubah: tersimpan !== sidik,
    platform: navigator.platform || '-',
    userAgent: (navigator.userAgent || '-').substring(0, 250)
  };
}

// -------------------------------------------------------
// DETEKSI LINGKUNGAN OTOMASI
//
// Sengaja hanya memakai penanda yang tidak ambigu. Trik deteksi DevTools
// yang agresif (ukuran window, timing debugger) sering salah tuduh pada
// HP biasa, dan salah tuduh jauh lebih mahal daripada satu kasus lolos.
// -------------------------------------------------------
export function deteksiOtomasi() {
  try {
    if (navigator.webdriver === true) return true;
    if (window.callPhantom || window._phantom || window.__nightmare) return true;
    if (window.__playwright || window.__puppeteer_evaluation_script__) return true;
    if (window.document.$cdc_asdjflasutopfhvcZLmcfl_) return true;
  } catch (e) { /* akses diblokir: anggap normal */ }
  return false;
}

// -------------------------------------------------------
// JARAK DUA KOORDINAT (meter)
// -------------------------------------------------------
function jarakMeter(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jumlahDesimal(nilai) {
  const s = String(nilai);
  const idx = s.indexOf('.');
  return idx === -1 ? 0 : s.length - idx - 1;
}

function bacaPosisi(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Memvalidasi satu objek GeolocationPosition.
 * Dipertahankan sebagai export terpisah supaya bisa diuji sendiri.
 */
export function validateGpsPosition(position) {
  const reasons = [];
  let isSuspicious = false;

  if (!position || !position.coords) {
    return {
      valid: false, isSuspicious: true, accuracy: 0,
      warning: 'Data GPS tidak valid atau tidak terbaca.',
      reasons: ['Objek koordinat kosong']
    };
  }

  const { latitude, longitude, accuracy } = position.coords;
  const timestamp = position.timestamp || Date.now();
  const driftWaktuMs = Date.now() - timestamp;

  // 1. Null Island — koordinat default yang dipakai banyak emulator.
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
    reasons.push('Koordinat berada di titik 0,0 (Null Island)');
    isSuspicious = true;
  }

  // 2. Akurasi mustahil. Perangkat asli tidak pernah melaporkan 0 meter.
  if (accuracy <= 0) {
    reasons.push('Akurasi GPS tidak wajar (0 meter)');
    isSuspicious = true;
  }

  // 3. Presisi desimal. GPS asli selalu menghasilkan banyak desimal;
  //    koordinat yang diketik manual biasanya pendek.
  if (jumlahDesimal(latitude) < 4 || jumlahDesimal(longitude) < 4) {
    reasons.push('Presisi desimal koordinat terlalu rendah (indikasi koordinat manual)');
    isSuspicious = true;
  }

  // 4. Timestamp GPS jauh dari jam perangkat.
  if (Math.abs(driftWaktuMs) > 45000) {
    reasons.push('Timestamp GPS tidak sinkron dengan jam perangkat (indikasi replay/injeksi)');
    isSuspicious = true;
  }

  // 5. Flag mock bila WebView Android mengekspornya.
  if (position.coords.isMock === true || position.isMock === true || position.mocked === true) {
    reasons.push('Terdeteksi flag Mock Location dari sistem');
    isSuspicious = true;
  }

  // 6. Lingkungan otomasi.
  if (deteksiOtomasi()) {
    reasons.push('Browser berjalan di lingkungan otomasi/debug');
    isSuspicious = true;
  }

  let warning = null;
  if (isSuspicious) {
    warning = reasons.join('. ');
  } else if (accuracy > 150) {
    warning = `Akurasi GPS agak rendah (±${Math.round(accuracy)}m). Berdirilah di ruang terbuka untuk hasil terbaik.`;
  }

  return {
    valid: !isSuspicious && accuracy <= 500,
    isSuspicious,
    accuracy: Math.round(accuracy || 0),
    warning,
    reasons,
    driftWaktuMs
  };
}

/**
 * Mengambil koordinat dengan DUA pembacaan berjeda.
 *
 * Kenapa dua: GPS asli selalu bergetar — sensor, satelit, dan filter
 * Kalman membuat dua pembacaan berturut hampir mustahil identik sampai
 * digit terakhir. Aplikasi Fake GPS mengunci satu titik dan mengembalikan
 * angka yang sama persis setiap kali. Jitter 0,000 m pada dua pembacaan
 * adalah sinyal paling kuat yang bisa didapat dari dalam browser.
 *
 * Pembacaan kedua bersifat best-effort: kalau gagal atau timeout, absen
 * tetap jalan dengan jitter null (tidak dihukum). Prinsipnya, sinyal yang
 * hilang tidak boleh berubah menjadi tuduhan.
 */
export function getVerifiedGeolocation(options = {}) {
  return new Promise(async (resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Perangkat atau browser tidak mendukung Geolocation GPS.'));
    }

    const opsiDasar = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0, // wajib 0: cache lama membuat jitter selalu 0
      ...options
    };

    let pos1;
    try {
      pos1 = await bacaPosisi(opsiDasar);
    } catch (err) {
      let msg = 'Gagal mengakses GPS.';
      if (err.code === 1) msg = 'Izin akses lokasi (GPS) ditolak. Mohon aktifkan izin lokasi di browser.';
      else if (err.code === 2) msg = 'Sinyal GPS tidak ditemukan. Pastikan GPS aktif.';
      else if (err.code === 3) msg = 'Waktu pencarian GPS habis (timeout). Coba lagi di tempat terbuka.';
      return reject(new Error(msg));
    }

    // --- Pembacaan kedua untuk mengukur jitter ---
    let pos2 = null;
    let jitterMeter = null;
    let jitterAkurasi = null;
    try {
      await new Promise(r => setTimeout(r, JEDA_SAMPEL_MS));
      pos2 = await bacaPosisi({ ...opsiDasar, timeout: 6000 });
      jitterMeter = Number(jarakMeter(
        pos1.coords.latitude, pos1.coords.longitude,
        pos2.coords.latitude, pos2.coords.longitude
      ).toFixed(3));
      jitterAkurasi = Number((pos2.coords.accuracy - pos1.coords.accuracy).toFixed(2));
    } catch (e) {
      // Pembacaan kedua gagal — bukan indikasi kecurangan, jangan dihukum.
      jitterMeter = null;
    }

    // Pakai pembacaan terbaru yang berhasil sebagai koordinat resmi.
    const posFinal = pos2 || pos1;
    const validasi = validateGpsPosition(posFinal);

    const alasan = validasi.reasons.slice();
    let mencurigakan = validasi.isSuspicious;

    if (jitterMeter !== null && jitterMeter <= JITTER_NOL_TOLERANSI) {
      alasan.push('Koordinat identik pada dua pembacaan berturut (GPS asli selalu bergetar)');
      mencurigakan = true;
    }

    const perangkat = ambilSidikPerangkat();

    resolve({
      lat: posFinal.coords.latitude,
      lng: posFinal.coords.longitude,
      accuracy: validasi.accuracy,
      isMockSuspicious: mencurigakan,
      warning: mencurigakan ? alasan.join('. ') : validasi.warning,
      position: posFinal,

      // Paket bukti yang dikirim apa adanya ke server untuk diperiksa
      // ulang bersama riwayat absensi.
      bukti: {
        sampel: pos2 ? 2 : 1,
        jitterMeter,
        jitterAkurasi,
        akurasi1: Math.round(pos1.coords.accuracy || 0),
        akurasi2: pos2 ? Math.round(pos2.coords.accuracy || 0) : null,
        driftWaktuMs: validasi.driftWaktuMs,
        mockFlag: !!(posFinal.coords.isMock || posFinal.isMock || posFinal.mocked),
        otomasi: deteksiOtomasi(),
        deviceId: perangkat.deviceId,
        perangkatBerubah: perangkat.perangkatBerubah,
        platform: perangkat.platform,
        userAgent: perangkat.userAgent,
        alasanClient: alasan
      }
    });
  });
}
