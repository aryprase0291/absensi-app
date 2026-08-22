// =======================================================
// ANTI-FAKE GPS & GEOLOCATION INTEGRITY DETECTOR
//
// Modul untuk memvalidasi keaslian dan integritas koordinat GPS:
// 1. Akurasi realistis (mendeteksi nilai artifisial seperti 0m atau >300m)
// 2. Integritas Timestamp (posisi basi / inject / cache emulator)
// 3. Deteksi webdriver / DevTools Geolocation Override
// 4. Deteksi anomali koordinat (Null Island / koordinat bulat palsu)
// 5. Pemeriksaan flag mock bawaan jika disediakan oleh WebView/Android
// =======================================================

/**
 * Memvalidasi objek GeolocationPosition dari navigator.geolocation
 * @param {GeolocationPosition} position 
 * @returns {{
 *   valid: boolean,
 *   isSuspicious: boolean,
 *   accuracy: number,
 *   warning: string | null,
 *   reasons: string[]
 * }}
 */
export function validateGpsPosition(position) {
  const reasons = [];
  let isSuspicious = false;

  if (!position || !position.coords) {
    return {
      valid: false,
      isSuspicious: true,
      accuracy: 0,
      warning: 'Data GPS tidak valid atau tidak terbaca.',
      reasons: ['Objek koordinat kosong']
    };
  }

  const { latitude, longitude, accuracy } = position.coords;
  const timestamp = position.timestamp || Date.now();
  const timeDiff = Math.abs(Date.now() - timestamp);

  // 1. Cek Koordinat Null Island (0, 0)
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
    reasons.push('Koordinat berada di titik 0,0 (Null Island)');
    isSuspicious = true;
  }

  // 2. Cek Akurasi Tidak Realistis
  // Perangkat asli di dunia nyata tidak pernah memiliki akurasi persis 0 meter.
  // Fake GPS sering meng-inject akurasi 0 atau 1.0 m secara konstan.
  if (accuracy <= 0) {
    reasons.push('Akurasi GPS tidak wajar (0 meter)');
    isSuspicious = true;
  } else if (accuracy > 350) {
    reasons.push(`Sinyal GPS terlalu lemah/tidak akurat (${Math.round(accuracy)} meter)`);
  }

  // 3. Cek Presisi Desimal Koordinat
  // GPS ponsel nyata menghasilkan setidaknya 4-8 angka di belakang koma.
  const latDecimals = (String(latitude).split('.')[1] || '').length;
  const lngDecimals = (String(longitude).split('.')[1] || '').length;
  if (latDecimals < 3 || lngDecimals < 3) {
    reasons.push('Presisi desimal koordinat terlalu rendah (indikasi manual/mock)');
    isSuspicious = true;
  }

  // 4. Cek Usia Data / Timestamp Spoofing
  // Jika timestamp GPS terlalu lampau (>45 detik) atau di masa depan (>10 detik)
  if (timeDiff > 45000) {
    reasons.push('Data GPS usang / hasil injeksi replay');
    isSuspicious = true;
  }

  // 5. Cek Flag Mock (beberapa browser / WebView Android mengekspos isMock)
  if (position.coords.isMock === true || position.isMock === true || position.mocked === true) {
    reasons.push('Terdeteksi flag Mock Location dari sistem');
    isSuspicious = true;
  }

  // 6. Cek Otomasi / DevTools Override (navigator.webdriver)
  if (navigator.webdriver) {
    reasons.push('Browser dijalankan di lingkungan otomasi/debug');
    isSuspicious = true;
  }

  let warning = null;
  if (isSuspicious) {
    warning = reasons.join('. ');
  } else if (accuracy > 150) {
    warning = `Akurasi GPS agak rendah (±${Math.round(accuracy)}m). Pastikan berada di ruang terbuka untuk hasil terbaik.`;
  }

  return {
    valid: !isSuspicious && accuracy <= 500,
    isSuspicious,
    accuracy: Math.round(accuracy || 0),
    warning,
    reasons
  };
}

/**
 * Mengambil koordinat GPS dengan verifikasi integritas
 * @param {PositionOptions} [options]
 * @returns {Promise<{
 *   lat: number,
 *   lng: number,
 *   accuracy: number,
 *   isMockSuspicious: boolean,
 *   warning: string | null,
 *   position: GeolocationPosition
 * }>}
 */
export function getVerifiedGeolocation(options = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Perangkat atau browser tidak mendukung Geolocation GPS.'));
    }

    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0, // Jangan gunakan cache lama
      ...options
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const validation = validateGpsPosition(pos);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: validation.accuracy,
          isMockSuspicious: validation.isSuspicious,
          warning: validation.warning,
          position: pos
        });
      },
      (err) => {
        let msg = 'Gagal mengakses GPS.';
        if (err.code === 1) msg = 'Izin akses lokasi (GPS) ditolak. Mohon aktifkan izin lokasi di browser.';
        else if (err.code === 2) msg = 'Sinyal GPS tidak ditemukan. Pastikan GPS aktif.';
        else if (err.code === 3) msg = 'Waktu pencarian GPS habis (timeout). Coba lagi di tempat terbuka.';
        reject(new Error(msg));
      },
      defaultOptions
    );
  });
}
