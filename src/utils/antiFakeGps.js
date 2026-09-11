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

// ---------------------------------------------------------------------
// PENGAMBILAN SAMPEL — DIPERBAIKI 10 Sep 2026 (SALAH TUDUH MOCK GPS)
//
// Versi lama membaca posisi dua kali berjarak 1,2 detik, lalu mencap
// "Mock GPS" bila kedua koordinatnya sama persis. Asumsinya: "GPS asli
// selalu bergetar". Asumsi itu SALAH pada perangkat modern, dan sudah
// terbukti menuduh karyawan yang tidak memakai Fake GPS sama sekali:
//
//   1. Chip GNSS menghasilkan fix ±1 kali per detik. Meminta posisi 1,2
//      detik kemudian sering mengembalikan OBJEK FIX YANG SAMA — bukan
//      pembacaan kedua. `maximumAge: 0` tidak menolong: ia hanya
//      melarang cache lama, tidak memaksa chip menghitung ulang.
//   2. Android Fused Location dan CoreLocation iOS MENAHAN posisi saat
//      perangkat terdeteksi diam ("static hold"), justru supaya titiknya
//      tidak melompat. Karyawan yang berdiri diam saat absen adalah
//      kasus yang paling mungkin menghasilkan jitter 0,000 m.
//   3. Makin bagus lock GPS-nya, makin stabil koordinatnya. Sinyal yang
//      paling jujur justru yang paling mudah salah tuduh.
//
// Perbaikannya ada dua lapis:
//   - Sampel hanya dihitung sebagai sampel BERBEDA bila `timestamp`-nya
//     berbeda. Timestamp yang sama = fix yang sama dipakai ulang, dan
//     jitternya "tidak diketahui" (null), bukan nol.
//   - Jitter nol hanya dinilai kalau memang ada DUA FIX BERBEDA. Dengan
//     dasar itu, ia kembali menjadi VONIS (11 Sep 2026) — lihat catatan
//     panjang di dekat `resolve()` di bawah dan ANTI-FAKE-GPS.md.
//
// Yang perlu dipegang: perangkat asli yang diam MENGULANG fix yang sama
// (timestamp sama) sehingga jitternya null dan tidak dihukum sama sekali.
// Pin Fake GPS menyuntikkan fix BARU berulang kali dengan koordinat yang
// sama persis — itu yang ditolak. Sinyal keras (flag Mock Location dari
// sistem, otomasi, koordinat 0,0, akurasi 0, presisi rendah) tetap menjadi
// vonis sendiri-sendiri seperti sebelumnya.
// ---------------------------------------------------------------------

const SAMPEL_TARGET = 3;          // fix BERBEDA yang diincar sebelum berhenti
// Dua batas waktu, karena dua keadaan yang berbeda:
//   BUDGET : batas keras. Perangkat yang menahan posisinya (static hold)
//            tidak akan pernah memberi fix kedua — menunggunya lebih lama
//            hanya membuat form absen terasa menggantung tanpa hasil.
//   GRACE  : setelah fix KEDUA didapat, jitter sudah bisa dihitung.
//            Fix ketiga hanya memperkuat, jadi ditunggu sebentar saja.
const SAMPEL_BUDGET_MS = 3500;
const SAMPEL_GRACE_MS = 1200;
const JITTER_NOL_TOLERANSI = 0;   // ambang "identik"; kini hanya jadi bukti

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
 * Mengumpulkan beberapa fix GPS yang BENAR-BENAR BERBEDA.
 *
 * Pembeda satu-satunya yang bisa dipercaya adalah `position.timestamp`.
 * Dua pemanggilan yang mengembalikan timestamp sama berarti browser
 * menyerahkan fix yang sama untuk kedua kalinya — itu bukan bukti apa
 * pun tentang kejujuran lokasinya, dan tidak boleh dihitung sebagai
 * "koordinat identik".
 *
 * `watchPosition` dipakai, bukan getCurrentPosition berulang, karena ia
 * mengirim fix begitu chip menghasilkannya — tidak perlu menebak berapa
 * lama harus menunggu. Sebagian browser hanya memanggil balik saat
 * posisi berubah; kalau itu terjadi, sampelnya memang cuma satu dan
 * jitter dilaporkan null (tidak diketahui), bukan nol.
 *
 * SELALU resolve. Kegagalan mengumpulkan sampel tambahan bukan
 * kecurangan — sinyal yang hilang tidak boleh berubah jadi tuduhan.
 *
 * @returns {Promise<{sampel: Array, fixTerulang: number}>}
 */
function kumpulkanSampelBerbeda(pertama, opsi, batas) {
  const budgetMs = Number((batas && batas.budgetMs) || SAMPEL_BUDGET_MS);
  const graceMs = Number((batas && batas.graceMs) || SAMPEL_GRACE_MS);
  return new Promise((resolve) => {
    const sampel = [pertama];
    let fixTerulang = 0;
    let selesai = false;
    let idPantau = null;
    let idBatas = null;
    let idGrace = null;

    const tutup = () => {
      if (selesai) return;
      selesai = true;
      if (idPantau !== null) {
        try { navigator.geolocation.clearWatch(idPantau); } catch (e) { /* abaikan */ }
      }
      if (idBatas) clearTimeout(idBatas);
      if (idGrace) clearTimeout(idGrace);
      resolve({ sampel, fixTerulang });
    };

    const terima = (pos) => {
      if (selesai || !pos || !pos.coords) return;
      const terakhir = sampel[sampel.length - 1];
      // Fix yang sama dikirim ulang: dicatat sebagai statistik, tidak
      // pernah sebagai sampel baru.
      if (terakhir && Number(pos.timestamp) === Number(terakhir.timestamp)) {
        fixTerulang += 1;
        return;
      }
      sampel.push(pos);
      if (sampel.length >= SAMPEL_TARGET) { tutup(); return; }
      // Fix kedua sudah cukup untuk menghitung jitter. Beri kesempatan
      // singkat untuk fix ketiga, lalu berhenti — jangan menahan karyawan
      // di layar form hanya demi sampel tambahan.
      if (sampel.length === 2 && !idGrace) idGrace = setTimeout(tutup, graceMs);
    };

    idBatas = setTimeout(tutup, budgetMs);

    try {
      if (typeof navigator.geolocation.watchPosition !== 'function') { tutup(); return; }
      idPantau = navigator.geolocation.watchPosition(terima, () => {
        // Gagal di tengah jalan: pakai apa pun yang sudah terkumpul.
        tutup();
      }, { ...opsi, timeout: budgetMs, maximumAge: 0 });
    } catch (e) {
      tutup();
    }
  });
}

/**
 * Jitter = pergeseran terbesar antar dua fix BERTURUTAN yang berbeda.
 * null bila fix berbedanya kurang dari dua — keadaan "tidak diketahui",
 * yang di server tidak dihukum sama sekali.
 */
function hitungJitter(sampel) {
  if (!sampel || sampel.length < 2) return null;
  let maks = 0;
  for (let i = 1; i < sampel.length; i++) {
    const d = jarakMeter(
      sampel[i - 1].coords.latitude, sampel[i - 1].coords.longitude,
      sampel[i].coords.latitude, sampel[i].coords.longitude
    );
    if (d > maks) maks = d;
  }
  return Number(maks.toFixed(3));
}

/**
 * Mengambil koordinat beserta paket buktinya.
 *
 * Fix pertama dibaca lewat getCurrentPosition supaya pesan kesalahannya
 * tetap spesifik (izin ditolak / sinyal tidak ada / timeout). Sampel
 * berikutnya dikumpulkan lewat watchPosition, dan seluruh prosesnya
 * dibatasi SAMPEL_BUDGET_MS agar form absen tidak menggantung.
 *
 * PENTING: jitter nol menjadikan `isMockSuspicious` true HANYA bila
 * terkumpul >= 2 fix BERBEDA. Aturan sebelum 10 Sep 2026 tidak memakai
 * syarat itu dan karena itu menuduh karyawan yang perangkatnya justru
 * mengunci posisi dengan baik.
 */
export function getVerifiedGeolocation(options = {}) {
  return new Promise(async (resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Perangkat atau browser tidak mendukung Geolocation GPS.'));
    }

    // Dua batas waktu pengambilan sampel bisa ditimpa (dipakai uji
    // otomatis supaya tidak perlu menunggu detik sungguhan); keduanya
    // tidak boleh ikut diteruskan ke Geolocation API.
    const { sampelBudgetMs, sampelGraceMs, ...opsiGeo } = options;
    const opsiDasar = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0, // wajib 0: cache lama membuat jitter selalu 0
      ...opsiGeo
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

    // --- Kumpulkan fix tambahan yang benar-benar berbeda --------------
    let sampel = [pos1];
    let fixTerulang = 0;
    try {
      const hasil = await kumpulkanSampelBerbeda(pos1, opsiDasar, {
        budgetMs: sampelBudgetMs, graceMs: sampelGraceMs
      });
      sampel = hasil.sampel;
      fixTerulang = hasil.fixTerulang;
    } catch (e) {
      // Pengumpulan sampel gagal — bukan indikasi kecurangan.
    }

    const jitterMeter = hitungJitter(sampel);
    const jitterAkurasi = sampel.length >= 2
      ? Number(((sampel[sampel.length - 1].coords.accuracy || 0) - (sampel[0].coords.accuracy || 0)).toFixed(2))
      : null;

    // Fix terbaru yang berhasil dipakai sebagai koordinat resmi.
    const posFinal = sampel[sampel.length - 1];
    const validasi = validateGpsPosition(posFinal);

    const alasan = validasi.reasons.slice();

    // JITTER NOL — DIKEMBALIKAN JADI PENOLAKAN (11 Sep 2026)
    //
    // Riwayat singkat, supaya tidak diayun bolak-balik lagi:
    //
    //   sebelum 10 Sep : dua pembacaan berjarak 1,2 detik; jitter 0 menolak
    //                    absen. MENUDUH karyawan jujur, karena kedua
    //                    pembacaan itu sering fix yang SAMA, bukan dua fix.
    //   10 Sep         : tuduhan dicabut seluruhnya -> Fake GPS lolos,
    //                    sebab penolakan di layar inilah satu-satunya yang
    //                    benar-benar menahannya (skor server 45 pun tidak
    //                    pernah mencapai ambang blokir 100).
    //   sekarang       : penolakannya kembali, TAPI hanya atas dasar fix
    //                    yang BENAR-BENAR BERBEDA.
    //
    // Kenapa syarat itu yang membedakan: fix dipisahkan oleh
    // `position.timestamp` (lihat kumpulkanSampelBerbeda). Perangkat asli
    // yang diam menyerahkan fix yang SAMA berkali-kali — itu terhitung
    // `fixTerulang`, sampelBerbeda tetap 1, dan jitter dilaporkan null
    // sehingga tidak dihukum sama sekali. Pin Fake GPS menyuntikkan posisi
    // berulang kali sebagai fix BARU: timestamp-nya maju, koordinatnya
    // tidak bergerak satu milimeter pun. Itulah pola yang ditolak di sini.
    //
    // JANGAN melonggarkan syarat `sampel.length >= 2` menjadi jumlah
    // pemanggilan getCurrentPosition. Persis itu yang dulu salah.
    const jitterNol = jitterMeter !== null
      && sampel.length >= 2
      && jitterMeter <= JITTER_NOL_TOLERANSI;

    let mencurigakan = validasi.isSuspicious;
    if (jitterNol) {
      alasan.push(
        'Koordinat tidak bergerak sama sekali pada ' + sampel.length
        + ' fix GPS berbeda — GPS asli selalu bergetar walau perangkat diam'
      );
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
        // Dipertahankan namanya demi kompatibilitas dengan sheet GpsAudit
        // dan klien lama; isinya kini JUMLAH FIX BERBEDA, bukan jumlah
        // pemanggilan getCurrentPosition.
        sampel: sampel.length,
        sampelBerbeda: sampel.length,
        fixTerulang,
        jitterMeter,
        jitterNol,
        jitterAkurasi,
        akurasi1: Math.round(sampel[0].coords.accuracy || 0),
        akurasi2: sampel.length >= 2 ? Math.round(sampel[sampel.length - 1].coords.accuracy || 0) : null,
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
