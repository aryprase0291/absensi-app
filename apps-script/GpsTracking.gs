// =====================================================================
// PELACAKAN POSISI KARYAWAN (GPS TRACKING)
//
// KENAPA FILE INI ADA
// AntiFakeGps.gs menjawab "apakah titik absen ini jujur?". File ini
// menjawab pertanyaan yang berbeda: "di mana karyawan saya sekarang, dan
// ke mana saja dia hari ini?" — untuk dinas luar, kunjungan pelanggan,
// dan teknisi lapangan.
//
// EMPAT SHEET, EMPAT TUGAS BERBEDA
//   GpsTracking        jejak (log) — bertambah terus, dipangkas otomatis
//   GpsPosisiTerakhir  satu baris per karyawan — TIDAK pernah bertambah,
//                      inilah yang dibaca dashboard peta (murah & cepat)
//   GpsTrackingConfig  saklar aktif/nonaktif + interval per karyawan
//   LaporanGps         hasil rekap yang dibuat admin dari dashboard
//
// PRINSIP YANG MENJAGA KUOTA TETAP AMAN
// Titik yang masuk TIDAK selalu ditulis ke sheet jejak. Karyawan yang
// duduk di meja selama 8 jam hanya menghasilkan ~16 baris (heartbeat 30
// menit), sementara karyawan yang berkendara menghasilkan baris setiap
// kali bergeser 50 meter. Tanpa aturan ini, 50 karyawan x ping 5 menit
// x 8 jam = 4.800 baris PER HARI, dan spreadsheet absensi akan menabrak
// batas 10 juta sel dalam hitungan bulan.
//
// PRIVASI — DISENGAJA, BUKAN KELALAIAN
//   - Pelacakan hanya berjalan saat aplikasi dibuka. Browser tidak bisa
//     (dan tidak boleh) melacak saat aplikasi ditutup.
//   - Admin dapat mematikan pelacakan per karyawan lewat dashboard.
//   - Aplikasi menampilkan indikator jelas ke karyawan saat lokasinya
//     sedang dibagikan.
// =====================================================================

const SHEET_GPS_TRACK = 'GpsTracking';
const SHEET_GPS_LAST = 'GpsPosisiTerakhir';
const SHEET_GPS_TRACK_CFG = 'GpsTrackingConfig';
const SHEET_GPS_LAPORAN = 'LaporanGps';

const GPS_TRACK_HEADERS = [
  'Waktu', 'UserID', 'Nama', 'Divisi', 'Latitude', 'Longitude', 'Akurasi(m)',
  'Sumber', 'Jarak dari Titik Sebelumnya(m)', 'Kecepatan(km/j)', 'Baterai(%)',
  'Status Area', 'Alamat', 'Device ID', 'Platform'
];

const GPS_LAST_HEADERS = [
  'UserID', 'Nama', 'Divisi', 'Lokasi Kerja', 'Latitude', 'Longitude',
  'Akurasi(m)', 'Waktu Terakhir', 'Sumber', 'Alamat', 'Status Area',
  'Jarak ke Area(m)', 'Nama Area', 'Baterai(%)', 'Titik Hari Ini',
  'Jarak Hari Ini(km)', 'Device ID', 'Platform',
  // Tiga kolom terakhir dipakai mesin, bukan manusia: penentu kapan baris
  // jejak berikutnya layak ditulis (lihat aturan JARAK_MIN_LOG_M /
  // JEDA_HEARTBEAT_DTK). Disimpan di sini supaya tidak perlu membaca
  // ekor sheet GpsTracking pada setiap ping.
  'Waktu Log Terakhir', 'Lat Log', 'Lng Log'
];

const GPS_TRACK_CFG_HEADERS = ['UserID', 'Nama', 'Aktif', 'Interval(detik)', 'Diubah', 'Oleh'];

const GPS_LAPORAN_HEADERS = [
  'Tanggal', 'UserID', 'Nama', 'Divisi', 'Titik Terekam', 'Jam Pertama',
  'Jam Terakhir', 'Durasi Terpantau', 'Jarak Tempuh(km)', 'Titik Terjauh dari Area(m)',
  'Menit di Luar Area', 'Lokasi Terakhir', 'Alamat Terakhir'
];

// Semua ambang dikumpulkan di satu tempat supaya bisa disetel tanpa
// membedah logika di bawahnya.
const GPS_TRACK = {
  INTERVAL_DEFAULT_DTK: 300,   // 5 menit — interval ping normal
  INTERVAL_MIN_DTK: 60,
  INTERVAL_MAKS_DTK: 3600,

  JEDA_MIN_TERIMA_DTK: 45,     // ping lebih rapat dari ini ditolak halus
  JARAK_MIN_LOG_M: 50,         // geser < 50 m tidak menambah baris jejak
  JEDA_HEARTBEAT_DTK: 1800,    // ...kecuali sudah 30 menit sejak baris terakhir

  AKURASI_MAKS_M: 1000,        // di atas ini titik tidak layak dipakai
  JARAK_GEOCODE_M: 250,        // alamat baru dicari kalau bergeser sejauh ini

  ONLINE_DTK: 600,             // <= 10 menit  -> ONLINE
  IDLE_DTK: 3600,              // <= 60 menit  -> IDLE, lebih -> OFFLINE

  KECEPATAN_MUSTAHIL_KMJ: 400, // di atas ini jarak dianggap lompatan, tidak diakumulasi

  MAKS_BARIS: 45000,           // ambang pemangkasan otomatis sheet jejak
  PANGKAS_BARIS: 15000,        // berapa baris tertua yang dibuang sekali pangkas

  TRAIL_POTONG: 2000,          // ukuran blok pemindaian mundur
  TRAIL_MAKS_SCAN: 45000
};

const GPS_TRACK_CACHE_CFG = 'GPSTRACK_CFG_V1';
const GPS_TRACK_CACHE_USER = 'GPSTRACK_USER_V1';
const GPS_TRACK_CACHE_TTL = 600;

// ---------------------------------------------------------------------
// UTILITAS
// ---------------------------------------------------------------------

function _gpsTrackJarak(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _gpsTrackWaktu(nilai) {
  if (nilai instanceof Date) return nilai.getTime();
  if (!nilai && nilai !== 0) return null;
  const d = new Date(nilai);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function _gpsTrackZona() {
  return Session.getScriptTimeZone() || 'Asia/Jakarta';
}

function _gpsTrackFormat(tanggal, pola) {
  if (!(tanggal instanceof Date) || isNaN(tanggal.getTime())) return '';
  return Utilities.formatDate(tanggal, _gpsTrackZona(), pola);
}

function _gpsTrackTglKunci(tanggal) {
  return _gpsTrackFormat(tanggal, 'yyyy-MM-dd');
}

function _gpsTrackBoolean(nilai, bawaan) {
  const teks = String(nilai === null || nilai === undefined ? '' : nilai).trim().toLowerCase();
  if (!teks) return !!bawaan;
  if (['ya', 'yes', 'true', '1', 'aktif', 'on'].indexOf(teks) !== -1) return true;
  if (['tidak', 'no', 'false', '0', 'nonaktif', 'off'].indexOf(teks) !== -1) return false;
  return !!bawaan;
}

function _gpsTrackCacheAmbil(kunci) {
  try {
    const isi = CacheService.getScriptCache().get(kunci);
    return isi ? JSON.parse(isi) : null;
  } catch (e) { return null; }
}

function _gpsTrackCacheSimpan(kunci, obj) {
  try {
    CacheService.getScriptCache().put(kunci, JSON.stringify(obj), GPS_TRACK_CACHE_TTL);
  } catch (e) { /* cache penuh: bukan kegagalan yang perlu dilaporkan */ }
}

function _gpsTrackCacheHapus(kunci) {
  try { CacheService.getScriptCache().remove(kunci); } catch (e) { /* abaikan */ }
}

// ---------------------------------------------------------------------
// SHEET
// ---------------------------------------------------------------------

function _gpsTrackSiapkanSheet(nama, header) {
  let sheet = SS.getSheetByName(nama);
  if (!sheet) {
    sheet = SS.insertSheet(nama);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  const kosong = sheet.getLastRow() < 1 ||
    sheet.getRange(1, 1, 1, header.length).getValues()[0].join('').trim() === '';
  if (kosong) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _pastikanSheetGpsTrack() { return _gpsTrackSiapkanSheet(SHEET_GPS_TRACK, GPS_TRACK_HEADERS); }
function _pastikanSheetGpsLast() { return _gpsTrackSiapkanSheet(SHEET_GPS_LAST, GPS_LAST_HEADERS); }
function _pastikanSheetGpsCfg() { return _gpsTrackSiapkanSheet(SHEET_GPS_TRACK_CFG, GPS_TRACK_CFG_HEADERS); }

// Sheet jejak adalah SATU-SATUNYA sheet di fitur ini yang tumbuh tanpa
// batas. Dibiarkan, ia akan menghabiskan kuota 10 juta sel spreadsheet
// absensi — dan yang mati bukan cuma fitur GPS, tapi seluruh aplikasi.
function _gpsTrackPangkasOtomatis(sheet) {
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow <= GPS_TRACK.MAKS_BARIS) return 0;
    const buang = Math.min(GPS_TRACK.PANGKAS_BARIS, lastRow - 2);
    if (buang <= 0) return 0;
    sheet.deleteRows(2, buang); // baris 1 = header, baris tertua ada di atas
    return buang;
  } catch (e) {
    console.warn('Pangkas GpsTracking gagal: ' + e.message);
    return 0;
  }
}

// ---------------------------------------------------------------------
// PETA USER & KONFIGURASI
// ---------------------------------------------------------------------

function _gpsTrackPetaUser() {
  const memo = _gpsTrackCacheAmbil(GPS_TRACK_CACHE_USER);
  if (memo) return memo;

  const sheet = SS.getSheetByName(SHEET_USERS);
  const peta = {};
  if (sheet) {
    // Kolom yang dipakai: 0 UUID, 3 Nama, 4 Divisi, 5 Role, 13 Lokasi.
    const rows = bacaSheet(sheet, 14);
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] === null || rows[i][0] === undefined ? '' : rows[i][0]).trim();
      if (!id) continue;
      peta[id] = {
        nama: String(rows[i][3] || '-'),
        divisi: String(rows[i][4] || '-'),
        role: String(rows[i][5] || '').toLowerCase(),
        lokasi: String(rows[i][13] || 'All')
      };
    }
  }
  _gpsTrackCacheSimpan(GPS_TRACK_CACHE_USER, peta);
  return peta;
}

function _gpsTrackKonfigurasi() {
  const memo = _gpsTrackCacheAmbil(GPS_TRACK_CACHE_CFG);
  if (memo) return memo;

  const sheet = SS.getSheetByName(SHEET_GPS_TRACK_CFG);
  const peta = {};
  if (sheet && sheet.getLastRow() > 1) {
    const rows = bacaSheet(sheet, GPS_TRACK_CFG_HEADERS.length);
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] === null || rows[i][0] === undefined ? '' : rows[i][0]).trim();
      if (!id) continue;
      const interval = Number(rows[i][3]);
      peta[id] = {
        aktif: _gpsTrackBoolean(rows[i][2], true),
        interval: isFinite(interval) && interval > 0
          ? Math.min(Math.max(Math.round(interval), GPS_TRACK.INTERVAL_MIN_DTK), GPS_TRACK.INTERVAL_MAKS_DTK)
          : GPS_TRACK.INTERVAL_DEFAULT_DTK
      };
    }
  }
  _gpsTrackCacheSimpan(GPS_TRACK_CACHE_CFG, peta);
  return peta;
}

// Default SENGAJA aktif: karyawan yang belum pernah disentuh admin ikut
// terlacak. Baris di GpsTrackingConfig hanya perlu dibuat untuk yang
// dikecualikan atau yang intervalnya khusus.
function _gpsTrackKonfigUser(userId) {
  const peta = _gpsTrackKonfigurasi();
  const cfg = peta[String(userId)];
  if (!cfg) return { aktif: true, interval: GPS_TRACK.INTERVAL_DEFAULT_DTK };
  return { aktif: cfg.aktif !== false, interval: cfg.interval || GPS_TRACK.INTERVAL_DEFAULT_DTK };
}

// ---------------------------------------------------------------------
// GEOFENCE — DIPAKAI ULANG, BUKAN DITULIS ULANG
//
// Konfigurasi area kantor sudah ada di Code.gs (_ambilGeofenceUser) dan
// sudah di-cache. Di sini ia hanya dibaca untuk memberi label
// "DI AREA" / "LUAR AREA" pada titik, bukan untuk menolak apa pun.
// ---------------------------------------------------------------------

function _gpsTrackStatusArea(userId, lat, lng) {
  const hasil = { status: '-', jarak: null, area: '-' };
  try {
    if (typeof _ambilGeofenceUser !== 'function') return hasil;
    const cfg = _ambilGeofenceUser(userId);
    if (!cfg || !cfg.areas || !cfg.areas.length) return hasil;

    let terdekat = null;
    for (let i = 0; i < cfg.areas.length; i++) {
      const area = cfg.areas[i];
      const jarak = _gpsTrackJarak(lat, lng, area.lat, area.lng);
      if (!terdekat || jarak < terdekat.jarak) terdekat = { area: area, jarak: jarak };
    }
    if (!terdekat) return hasil;

    hasil.jarak = Math.round(terdekat.jarak);
    hasil.area = terdekat.area.nama;
    hasil.status = terdekat.jarak <= terdekat.area.radius ? 'DI AREA' : 'LUAR AREA';
  } catch (e) { /* label area bersifat tambahan — jangan menggagalkan ping */ }
  return hasil;
}

// Alamat hanya dicari kalau karyawan benar-benar berpindah jauh atau
// titiknya berasal dari absen. Tanpa penjagaan ini, satu karyawan yang
// berkendara bisa menghabiskan kuota geocoding harian sendirian.
function _gpsTrackAlamat(lat, lng, jarakDariSebelumnya, sumber, alamatLama) {
  const perluBaru = sumber === 'absen' ||
    !alamatLama ||
    jarakDariSebelumnya === null ||
    jarakDariSebelumnya >= GPS_TRACK.JARAK_GEOCODE_M;
  if (!perluBaru) return alamatLama;
  try {
    if (typeof alamatDariKoordinat === 'function') {
      const alamat = alamatDariKoordinat(lat, lng);
      if (alamat && alamat !== '-') return alamat;
    }
  } catch (e) { /* kuota habis / layanan bermasalah: alamat lama tetap dipakai */ }
  return alamatLama || '';
}

// ---------------------------------------------------------------------
// BARIS POSISI TERAKHIR
//
// Satu baris per karyawan. Nomor barisnya di-cache supaya ping berikutnya
// tidak perlu memindai kolom A lagi — dengan 300 karyawan, itu satu
// pembacaan sheet yang bisa dihemat pada SETIAP ping.
// ---------------------------------------------------------------------

function _gpsTrackCariBaris(sheet, userId) {
  const kunciCache = 'GPSTRACK_ROW_' + userId;
  const target = String(userId);

  const tersimpan = _gpsTrackCacheAmbil(kunciCache);
  if (tersimpan && tersimpan.baris > 1) {
    try {
      const nilai = sheet.getRange(tersimpan.baris, 1, 1, GPS_LAST_HEADERS.length).getValues()[0];
      if (String(nilai[0]) === target) return { baris: tersimpan.baris, nilai: nilai };
    } catch (e) { /* baris tergeser: jatuh ke pemindaian di bawah */ }
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const kolomId = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < kolomId.length; i++) {
    if (String(kolomId[i][0]) === target) {
      const baris = i + 2;
      _gpsTrackCacheSimpan(kunciCache, { baris: baris });
      return { baris: baris, nilai: sheet.getRange(baris, 1, 1, GPS_LAST_HEADERS.length).getValues()[0] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// ENDPOINT KARYAWAN — PENGIRIMAN POSISI
// ---------------------------------------------------------------------

/**
 * Menerima satu titik posisi dari aplikasi karyawan.
 *
 * Jawaban SELALU result:'success' selama request-nya sah — termasuk saat
 * titiknya sengaja tidak dicatat. Alasannya praktis: klien memanggil ini
 * setiap 5 menit di latar belakang, dan memunculkan pesan merah kepada
 * karyawan hanya karena titiknya dianggap duplikat akan membuat fitur ini
 * terasa rusak padahal bekerja persis seperti seharusnya.
 */
function handleTrackGpsPing(data) {
  const userId = String(data.userId || '').trim();
  if (!userId) return responseJSON({ result: 'error', message: 'User tidak dikenal.' });

  const lat = Number(data.lat);
  const lng = Number(data.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return responseJSON({ result: 'error', code: 'KOORDINAT_TIDAK_VALID', message: 'Koordinat tidak valid.' });
  }

  const cfg = _gpsTrackKonfigUser(userId);
  if (!cfg.aktif) {
    return responseJSON({
      result: 'success', dilacak: false, dicatat: false,
      intervalDetik: cfg.interval,
      message: 'Pelacakan lokasi nonaktif untuk akun ini.'
    });
  }

  const akurasi = isFinite(Number(data.akurasi)) ? Math.round(Number(data.akurasi)) : null;
  if (akurasi !== null && akurasi > GPS_TRACK.AKURASI_MAKS_M) {
    return responseJSON({
      result: 'success', dilacak: true, dicatat: false,
      intervalDetik: cfg.interval,
      message: 'Akurasi GPS terlalu rendah (' + akurasi + ' m), titik diabaikan.'
    });
  }

  const sumberMentah = String(data.sumber || 'periodik').toLowerCase();
  const sumber = ['periodik', 'absen', 'manual', 'awal'].indexOf(sumberMentah) !== -1 ? sumberMentah : 'periodik';

  const peta = _gpsTrackPetaUser();
  const profil = peta[userId] || {};
  const nama = String(data.nama || profil.nama || '-');
  const divisi = String(profil.divisi || '-');
  const lokasiKerja = String(profil.lokasi || 'All');

  const bukti = data.gpsBukti || {};
  const deviceId = String(bukti.deviceId || data.deviceId || '-');
  const platform = String(bukti.platform || data.platform || '-');
  const baterai = isFinite(Number(data.baterai)) ? Math.round(Number(data.baterai)) : '';

  const sekarang = new Date();
  const sheetLast = _pastikanSheetGpsLast();
  const sebelumnya = _gpsTrackCariBaris(sheetLast, userId);

  // --- Bandingkan dengan titik sebelumnya ---------------------------
  let jarakM = null;
  let kecepatan = null;
  let jarakHariIni = 0;
  let titikHariIni = 0;
  let alamatLama = '';
  let waktuLog = null;
  let latLog = null;
  let lngLog = null;

  if (sebelumnya) {
    const n = sebelumnya.nilai;
    const latLama = Number(n[4]);
    const lngLama = Number(n[5]);
    const waktuLama = _gpsTrackWaktu(n[7]);
    alamatLama = String(n[9] || '');
    waktuLog = _gpsTrackWaktu(n[18]);
    latLog = Number(n[19]);
    lngLog = Number(n[20]);

    // Penolakan halus untuk ping yang terlalu rapat. Ini bukan soal
    // kecurangan, melainkan perlindungan kuota: satu tab yang di-refresh
    // berulang kali bisa mengirim puluhan ping per menit.
    if (waktuLama && (sekarang.getTime() - waktuLama) < GPS_TRACK.JEDA_MIN_TERIMA_DTK * 1000 && sumber !== 'absen') {
      return responseJSON({
        result: 'success', dilacak: true, dicatat: false,
        intervalDetik: cfg.interval,
        message: 'Titik sebelumnya baru saja tersimpan.'
      });
    }

    const hariSama = waktuLama && _gpsTrackTglKunci(new Date(waktuLama)) === _gpsTrackTglKunci(sekarang);
    if (hariSama) {
      titikHariIni = Number(n[14]) || 0;
      jarakHariIni = Number(n[15]) || 0;
    }

    if (isFinite(latLama) && isFinite(lngLama)) {
      jarakM = Math.round(_gpsTrackJarak(latLama, lngLama, lat, lng));
      if (waktuLama) {
        const jam = (sekarang.getTime() - waktuLama) / 3600000;
        if (jam > 0) kecepatan = Math.round((jarakM / 1000) / jam);
      }
      // Lompatan mustahil (mis. VPN/GPS palsu, atau data lama) tidak boleh
      // mengotori akumulasi jarak tempuh harian.
      const masukAkal = kecepatan === null || kecepatan <= GPS_TRACK.KECEPATAN_MUSTAHIL_KMJ;
      if (hariSama && masukAkal) jarakHariIni = Number((jarakHariIni + jarakM / 1000).toFixed(3));
    }
  }

  titikHariIni += 1;

  const area = _gpsTrackStatusArea(userId, lat, lng);
  const alamat = _gpsTrackAlamat(lat, lng, jarakM, sumber, alamatLama);

  // --- Perlukah baris jejak baru? -----------------------------------
  // Inilah aturan yang menahan pertumbuhan sheet. Lihat catatan di kepala
  // berkas untuk alasan angkanya.
  let jarakDariLog = null;
  if (isFinite(latLog) && isFinite(lngLog) && latLog !== 0 && lngLog !== 0) {
    jarakDariLog = _gpsTrackJarak(latLog, lngLog, lat, lng);
  }
  const umurLogDtk = waktuLog ? (sekarang.getTime() - waktuLog) / 1000 : null;

  const statusAreaLama = sebelumnya ? String(sebelumnya.nilai[10] || '-') : '-';
  const areaBerubah = area.status !== '-' && statusAreaLama !== '-' && area.status !== statusAreaLama;

  const perluLog = !sebelumnya ||
    sumber === 'absen' || sumber === 'manual' ||
    jarakDariLog === null ||
    jarakDariLog >= GPS_TRACK.JARAK_MIN_LOG_M ||
    umurLogDtk === null || umurLogDtk >= GPS_TRACK.JEDA_HEARTBEAT_DTK ||
    areaBerubah;

  if (perluLog) {
    try {
      const sheetTrack = _pastikanSheetGpsTrack();
      sheetTrack.appendRow([
        sekarang, userId, nama, divisi, lat, lng,
        akurasi === null ? '' : akurasi,
        sumber,
        jarakM === null ? '' : jarakM,
        kecepatan === null ? '' : kecepatan,
        baterai,
        area.status,
        alamat || '',
        deviceId,
        platform
      ]);
      _gpsTrackPangkasOtomatis(sheetTrack);
      waktuLog = sekarang.getTime();
      latLog = lat;
      lngLog = lng;
    } catch (e) {
      console.warn('Gagal menulis jejak GPS: ' + e.message);
    }
  }

  // --- Perbarui posisi terakhir -------------------------------------
  const barisNilai = [
    userId, nama, divisi, lokasiKerja, lat, lng,
    akurasi === null ? '' : akurasi,
    sekarang, sumber, alamat || '',
    area.status,
    area.jarak === null ? '' : area.jarak,
    area.area,
    baterai,
    titikHariIni,
    jarakHariIni,
    deviceId, platform,
    waktuLog ? new Date(waktuLog) : sekarang,
    latLog === null || !isFinite(latLog) ? lat : latLog,
    lngLog === null || !isFinite(lngLog) ? lng : lngLog
  ];

  try {
    if (sebelumnya) {
      sheetLast.getRange(sebelumnya.baris, 1, 1, GPS_LAST_HEADERS.length).setValues([barisNilai]);
    } else {
      sheetLast.appendRow(barisNilai);
      _gpsTrackCacheSimpan('GPSTRACK_ROW_' + userId, { baris: sheetLast.getLastRow() });
    }
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal menyimpan posisi: ' + e.message });
  }

  return responseJSON({
    result: 'success',
    dilacak: true,
    dicatat: perluLog,
    intervalDetik: cfg.interval,
    statusArea: area.status,
    jarakArea: area.jarak,
    alamat: alamat || '',
    jarakHariIniKm: jarakHariIni
  });
}

/**
 * Dipanggil klien satu kali setelah login: apakah akun ini dilacak, dan
 * seberapa sering harus mengirim titik. Tanpa ini, klien akan menembak
 * ping untuk karyawan yang justru sudah dikecualikan admin.
 */
function handleGetGpsTrackingStatus(data) {
  const userId = String(data.userId || '').trim();
  const cfg = _gpsTrackKonfigUser(userId);
  return responseJSON({
    result: 'success',
    aktif: cfg.aktif,
    intervalDetik: cfg.interval,
    // Ditampilkan apa adanya di aplikasi karyawan. Pelacakan diam-diam
    // bukan hanya masalah etika, di banyak yurisdiksi juga masalah hukum.
    pemberitahuan: cfg.aktif
      ? 'Lokasi Anda dibagikan ke Admin selama aplikasi ini terbuka.'
      : ''
  });
}

// =====================================================================
// ENDPOINT ADMIN — DASHBOARD PEMANTAUAN
//
// Gerbang role sudah dipasang di Auth.gs (ACTION_ROLES). Pemeriksaan di
// sini adalah lapis kedua: kalau suatu saat ada yang menambahkan action
// ini ke daftar publik karena keliru, data tetap tidak bocor.
// =====================================================================

function _gpsTrackBolehLihat(data) {
  return String(data.roleRequester || data.role || '').toLowerCase() === 'admin';
}

function _gpsTrackStatusHidup(waktuMs, sekarangMs) {
  if (!waktuMs) return 'OFFLINE';
  const selisih = (sekarangMs - waktuMs) / 1000;
  if (selisih <= GPS_TRACK.ONLINE_DTK) return 'ONLINE';
  if (selisih <= GPS_TRACK.IDLE_DTK) return 'IDLE';
  return 'OFFLINE';
}

// Semua area kantor yang aktif, tanpa duplikat. Dipakai dashboard untuk
// menggambar lingkaran geofence di peta.
function _gpsTrackSemuaArea() {
  const hasil = [];
  const terlihat = {};
  try {
    if (typeof _ambilKonfigurasiGeofence !== 'function') return hasil;
    const peta = _ambilKonfigurasiGeofence();
    Object.keys(peta).forEach(function (userId) {
      const areas = (peta[userId] && peta[userId].areas) || [];
      areas.forEach(function (a) {
        const kunci = a.nama + '|' + Number(a.lat).toFixed(5) + '|' + Number(a.lng).toFixed(5);
        if (terlihat[kunci]) return;
        terlihat[kunci] = true;
        hasil.push({ nama: a.nama, lat: a.lat, lng: a.lng, radius: a.radius });
      });
    });
  } catch (e) { /* peta tetap tampil tanpa lingkaran area */ }
  return hasil;
}

/**
 * Isi utama dashboard: posisi terakhir SEMUA karyawan sekaligus.
 *
 * Sengaja membaca sheet GpsPosisiTerakhir (satu baris per karyawan),
 * bukan mengurai sheet jejak. Berapa pun banyaknya jejak yang terkumpul,
 * biaya membuka dashboard tidak berubah.
 */
function handleGetGpsLive(data) {
  if (!_gpsTrackBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin.' });
  }

  const sheet = SS.getSheetByName(SHEET_GPS_LAST);
  const sekarangMs = new Date().getTime();
  const daftar = [];

  if (sheet && sheet.getLastRow() > 1) {
    const rows = bacaSheet(sheet, GPS_LAST_HEADERS.length);
    const konfig = _gpsTrackKonfigurasi();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const userId = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
      if (!userId) continue;
      const lat = Number(r[4]);
      const lng = Number(r[5]);
      if (!isFinite(lat) || !isFinite(lng)) continue;

      const waktuMs = _gpsTrackWaktu(r[7]);
      const cfg = konfig[userId];
      daftar.push({
        userId: userId,
        nama: String(r[1] || '-'),
        divisi: String(r[2] || '-'),
        lokasiKerja: String(r[3] || '-'),
        lat: lat,
        lng: lng,
        akurasi: r[6] === '' || r[6] === null ? null : Number(r[6]),
        waktu: waktuMs ? _gpsTrackFormat(new Date(waktuMs), 'dd/MM/yyyy HH:mm:ss') : '-',
        waktuMs: waktuMs,
        umurDetik: waktuMs ? Math.round((sekarangMs - waktuMs) / 1000) : null,
        status: _gpsTrackStatusHidup(waktuMs, sekarangMs),
        sumber: String(r[8] || '-'),
        alamat: String(r[9] || ''),
        statusArea: String(r[10] || '-'),
        jarakArea: r[11] === '' || r[11] === null ? null : Number(r[11]),
        namaArea: String(r[12] || '-'),
        baterai: r[13] === '' || r[13] === null ? null : Number(r[13]),
        titikHariIni: Number(r[14]) || 0,
        jarakHariIniKm: Number(r[15]) || 0,
        deviceId: String(r[16] || '-'),
        platform: String(r[17] || '-'),
        pelacakanAktif: cfg ? cfg.aktif !== false : true
      });
    }
  }

  daftar.sort(function (a, b) { return (b.waktuMs || 0) - (a.waktuMs || 0); });

  return responseJSON({
    result: 'success',
    daftar: daftar,
    area: _gpsTrackSemuaArea(),
    ringkasan: {
      total: daftar.length,
      online: daftar.filter(function (d) { return d.status === 'ONLINE'; }).length,
      idle: daftar.filter(function (d) { return d.status === 'IDLE'; }).length,
      offline: daftar.filter(function (d) { return d.status === 'OFFLINE'; }).length,
      luarArea: daftar.filter(function (d) { return d.statusArea === 'LUAR AREA'; }).length
    },
    ambang: { onlineDetik: GPS_TRACK.ONLINE_DTK, idleDetik: GPS_TRACK.IDLE_DTK },
    serverTimestamp: sekarangMs
  });
}

/**
 * Jejak satu karyawan pada satu tanggal.
 *
 * Sheet jejak diurut kronologis, jadi pencarian dilakukan MUNDUR dari
 * baris terakhir per blok dan berhenti begitu menemukan tanggal yang
 * lebih tua dari yang diminta. Membaca seluruh sheet hanya untuk
 * mengambil satu hari akan membuat layar ini melambat seiring waktu —
 * persis pola masalah yang sudah dua kali didiagnosis di aplikasi ini
 * (lihat DIAGNOSA-LAMBAT.md).
 */
function handleGetGpsTrail(data) {
  if (!_gpsTrackBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin.' });
  }

  const userId = String(data.targetUserId || data.userIdTarget || '').trim();
  if (!userId) return responseJSON({ result: 'error', message: 'Karyawan belum dipilih.' });

  const tanggal = String(data.tanggal || _gpsTrackTglKunci(new Date())).trim();
  const sheet = SS.getSheetByName(SHEET_GPS_TRACK);
  const titik = [];

  if (sheet && sheet.getLastRow() > 1) {
    const lastRow = sheet.getLastRow();
    let baris = lastRow;
    let dipindai = 0;
    let selesai = false;

    while (baris > 1 && !selesai && dipindai < GPS_TRACK.TRAIL_MAKS_SCAN) {
      const jumlah = Math.min(GPS_TRACK.TRAIL_POTONG, baris - 1);
      const mulai = baris - jumlah + 1;
      const nilai = sheet.getRange(mulai, 1, jumlah, 13).getValues();
      dipindai += jumlah;

      for (let i = nilai.length - 1; i >= 0; i--) {
        const r = nilai[i];
        const waktu = r[0] instanceof Date ? r[0] : new Date(r[0]);
        if (isNaN(waktu.getTime())) continue;
        const kunci = _gpsTrackTglKunci(waktu);
        if (kunci > tanggal) continue;      // masih di hari sesudahnya
        if (kunci < tanggal) { selesai = true; break; }  // sudah melewati
        if (String(r[1]) !== userId) continue;
        titik.push({
          waktu: _gpsTrackFormat(waktu, 'HH:mm:ss'),
          waktuMs: waktu.getTime(),
          lat: Number(r[4]),
          lng: Number(r[5]),
          akurasi: r[6] === '' ? null : Number(r[6]),
          sumber: String(r[7] || '-'),
          jarak: r[8] === '' ? null : Number(r[8]),
          kecepatan: r[9] === '' ? null : Number(r[9]),
          baterai: r[10] === '' ? null : Number(r[10]),
          statusArea: String(r[11] || '-'),
          alamat: String(r[12] || '')
        });
      }
      baris = mulai - 1;
    }
  }

  titik.reverse(); // kembalikan ke urutan kronologis

  let totalKm = 0;
  for (let i = 1; i < titik.length; i++) {
    const j = _gpsTrackJarak(titik[i - 1].lat, titik[i - 1].lng, titik[i].lat, titik[i].lng);
    const jam = (titik[i].waktuMs - titik[i - 1].waktuMs) / 3600000;
    const kmj = jam > 0 ? (j / 1000) / jam : 0;
    if (kmj <= GPS_TRACK.KECEPATAN_MUSTAHIL_KMJ) totalKm += j / 1000;
  }

  const peta = _gpsTrackPetaUser();
  return responseJSON({
    result: 'success',
    userId: userId,
    nama: (peta[userId] && peta[userId].nama) || '-',
    tanggal: tanggal,
    titik: titik,
    jumlah: titik.length,
    jarakKm: Number(totalKm.toFixed(2)),
    jamPertama: titik.length ? titik[0].waktu : '-',
    jamTerakhir: titik.length ? titik[titik.length - 1].waktu : '-'
  });
}

/**
 * Daftar karyawan + status pelacakannya, untuk tab Pengaturan di
 * dashboard. Karyawan yang belum punya baris konfigurasi ditampilkan
 * sebagai aktif — itu memang perilaku bawaannya.
 */
function handleGetGpsTrackingAdmin(data) {
  if (!_gpsTrackBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin.' });
  }

  const peta = _gpsTrackPetaUser();
  const konfig = _gpsTrackKonfigurasi();
  const terakhir = {};

  const sheetLast = SS.getSheetByName(SHEET_GPS_LAST);
  if (sheetLast && sheetLast.getLastRow() > 1) {
    const rows = bacaSheet(sheetLast, GPS_LAST_HEADERS.length);
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || '').trim();
      if (!id) continue;
      const w = _gpsTrackWaktu(rows[i][7]);
      terakhir[id] = w ? _gpsTrackFormat(new Date(w), 'dd/MM/yyyy HH:mm') : '-';
    }
  }

  const daftar = Object.keys(peta).map(function (id) {
    const cfg = konfig[id];
    return {
      userId: id,
      nama: peta[id].nama,
      divisi: peta[id].divisi,
      lokasi: peta[id].lokasi,
      aktif: cfg ? cfg.aktif !== false : true,
      intervalDetik: (cfg && cfg.interval) || GPS_TRACK.INTERVAL_DEFAULT_DTK,
      terakhirTerlihat: terakhir[id] || '-'
    };
  });

  daftar.sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama)); });
  return responseJSON({
    result: 'success',
    daftar: daftar,
    intervalDefault: GPS_TRACK.INTERVAL_DEFAULT_DTK,
    intervalMin: GPS_TRACK.INTERVAL_MIN_DTK,
    intervalMaks: GPS_TRACK.INTERVAL_MAKS_DTK
  });
}

/**
 * Menyalakan/mematikan pelacakan seorang karyawan, atau mengubah
 * intervalnya. userId 'SEMUA' berlaku untuk seluruh karyawan.
 */
function handleSaveGpsTrackingConfig(data) {
  if (!_gpsTrackBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin.' });
  }

  const target = String(data.targetUserId || '').trim();
  if (!target) return responseJSON({ result: 'error', message: 'Karyawan belum dipilih.' });

  const aktif = _gpsTrackBoolean(data.aktif, true);
  let interval = Number(data.intervalDetik);
  if (!isFinite(interval) || interval <= 0) interval = GPS_TRACK.INTERVAL_DEFAULT_DTK;
  interval = Math.min(Math.max(Math.round(interval), GPS_TRACK.INTERVAL_MIN_DTK), GPS_TRACK.INTERVAL_MAKS_DTK);

  const sheet = _pastikanSheetGpsCfg();
  const peta = _gpsTrackPetaUser();
  const oleh = String(data.userId || '-');
  const sekarang = new Date();

  const targets = target === 'SEMUA' ? Object.keys(peta) : [target];
  if (!targets.length) return responseJSON({ result: 'error', message: 'Tidak ada karyawan yang cocok.' });

  // Satu kali baca, satu kali tulis — bukan satu operasi sheet per
  // karyawan. Dengan 300 karyawan, bedanya menit versus detik.
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, GPS_TRACK_CFG_HEADERS.length).getValues() : [];
  const indeks = {};
  rows.forEach(function (r, i) {
    const id = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
    if (id) indeks[id] = i;
  });

  const baru = [];
  targets.forEach(function (id) {
    const nama = (peta[id] && peta[id].nama) || '-';
    const baris = [id, nama, aktif ? 'Ya' : 'Tidak', interval, sekarang, oleh];
    if (indeks[id] !== undefined) rows[indeks[id]] = baris;
    else baru.push(baris);
  });

  if (rows.length) sheet.getRange(2, 1, rows.length, GPS_TRACK_CFG_HEADERS.length).setValues(rows);
  if (baru.length) sheet.getRange(sheet.getLastRow() + 1, 1, baru.length, GPS_TRACK_CFG_HEADERS.length).setValues(baru);

  _gpsTrackCacheHapus(GPS_TRACK_CACHE_CFG);

  return responseJSON({
    result: 'success',
    message: (target === 'SEMUA' ? 'Seluruh karyawan' : ((peta[target] && peta[target].nama) || target)) +
      ': pelacakan ' + (aktif ? 'AKTIF' : 'NONAKTIF') + ', interval ' + Math.round(interval / 60) + ' menit.',
    diubah: targets.length
  });
}

// =====================================================================
// LAPORAN KE GOOGLE SHEET
//
// Dashboard menjawab "sekarang di mana". Laporan menjawab "kemarin ke
// mana saja, berapa jauh, dan berapa lama di luar area" — bentuk yang
// bisa dilampirkan ke penilaian kinerja atau klaim uang jalan.
//
// Hasilnya ditulis sebagai SHEET, bukan hanya tabel di layar, karena
// itulah bentuk yang bisa difilter, di-pivot, dan dibagikan HRD tanpa
// bergantung pada aplikasi ini.
// =====================================================================

function _gpsTrackRekap(tglMulai, tglSelesai, userIdFilter) {
  const sheet = SS.getSheetByName(SHEET_GPS_TRACK);
  const kelompok = {};
  if (!sheet || sheet.getLastRow() < 2) return [];

  const lastRow = sheet.getLastRow();
  let baris = lastRow;
  let dipindai = 0;
  let selesai = false;

  while (baris > 1 && !selesai && dipindai < GPS_TRACK.TRAIL_MAKS_SCAN) {
    const jumlah = Math.min(GPS_TRACK.TRAIL_POTONG, baris - 1);
    const mulai = baris - jumlah + 1;
    const nilai = sheet.getRange(mulai, 1, jumlah, 13).getValues();
    dipindai += jumlah;

    for (let i = nilai.length - 1; i >= 0; i--) {
      const r = nilai[i];
      const waktu = r[0] instanceof Date ? r[0] : new Date(r[0]);
      if (isNaN(waktu.getTime())) continue;
      const kunci = _gpsTrackTglKunci(waktu);
      if (kunci > tglSelesai) continue;
      if (kunci < tglMulai) { selesai = true; break; }

      const userId = String(r[1] || '').trim();
      if (!userId) continue;
      if (userIdFilter && userId !== userIdFilter) continue;

      const k = kunci + '|' + userId;
      if (!kelompok[k]) {
        kelompok[k] = {
          tanggal: kunci, userId: userId, nama: String(r[2] || '-'), divisi: String(r[3] || '-'),
          titik: 0, mulaiMs: null, selesaiMs: null, km: 0,
          jarakAreaMaks: 0, menitLuar: 0,
          lat: null, lng: null, alamat: '',
          _prev: null
        };
      }
      const g = kelompok[k];
      g.titik += 1;
      const ms = waktu.getTime();
      if (g.mulaiMs === null || ms < g.mulaiMs) g.mulaiMs = ms;
      if (g.selesaiMs === null || ms > g.selesaiMs) {
        g.selesaiMs = ms;
        g.lat = Number(r[4]); g.lng = Number(r[5]); g.alamat = String(r[12] || '');
      }
      const jarak = Number(r[8]);
      const kecepatan = Number(r[9]);
      if (isFinite(jarak) && jarak > 0 && (!isFinite(kecepatan) || kecepatan <= GPS_TRACK.KECEPATAN_MUSTAHIL_KMJ)) {
        g.km += jarak / 1000;
      }
      // Baris dibaca dari yang TERBARU ke yang lama, jadi "titik
      // sesudahnya" justru yang sudah tercatat lebih dulu. Selisih
      // waktunya itulah lama karyawan berada di luar area.
      if (String(r[11] || '') === 'LUAR AREA' && g._prev !== null) {
        const menit = (g._prev - ms) / 60000;
        if (menit > 0 && menit <= 120) g.menitLuar += menit;
      }
      g._prev = ms;
    }
    baris = mulai - 1;
  }

  // Jarak terjauh dari area diambil dari sheet posisi terakhir hanya
  // untuk hari berjalan; untuk hari lampau nilainya tidak tersimpan per
  // titik, jadi kolomnya sengaja dibiarkan kosong daripada menebak.
  return Object.keys(kelompok).map(function (k) {
    const g = kelompok[k];
    const durasiMenit = g.mulaiMs && g.selesaiMs ? Math.round((g.selesaiMs - g.mulaiMs) / 60000) : 0;
    return {
      tanggal: g.tanggal,
      userId: g.userId,
      nama: g.nama,
      divisi: g.divisi,
      titik: g.titik,
      jamPertama: g.mulaiMs ? _gpsTrackFormat(new Date(g.mulaiMs), 'HH:mm') : '-',
      jamTerakhir: g.selesaiMs ? _gpsTrackFormat(new Date(g.selesaiMs), 'HH:mm') : '-',
      durasi: Math.floor(durasiMenit / 60) + 'j ' + (durasiMenit % 60) + 'm',
      km: Number(g.km.toFixed(2)),
      jarakAreaMaks: g.jarakAreaMaks || '',
      menitLuar: Math.round(g.menitLuar),
      koordinat: (g.lat !== null && g.lng !== null) ? (g.lat + ', ' + g.lng) : '-',
      alamat: g.alamat || ''
    };
  }).sort(function (a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    return String(a.nama).localeCompare(String(b.nama));
  });
}

function handleBuatLaporanGps(data) {
  if (!_gpsTrackBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin.' });
  }

  const hariIni = _gpsTrackTglKunci(new Date());
  const tglSelesai = String(data.tglSelesai || hariIni).trim();
  const tglMulai = String(data.tglMulai || tglSelesai).trim();
  if (tglMulai > tglSelesai) {
    return responseJSON({ result: 'error', message: 'Tanggal mulai melewati tanggal selesai.' });
  }

  const filter = String(data.targetUserId || '').trim();
  const rekap = _gpsTrackRekap(tglMulai, tglSelesai, filter === 'SEMUA' ? '' : filter);

  const sheet = _gpsTrackSiapkanSheet(SHEET_GPS_LAPORAN, GPS_LAPORAN_HEADERS);
  sheet.clear();
  sheet.getRange(1, 1, 1, GPS_LAPORAN_HEADERS.length).setValues([GPS_LAPORAN_HEADERS]);
  sheet.getRange(1, 1, 1, GPS_LAPORAN_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  if (rekap.length) {
    const baris = rekap.map(function (r) {
      return [r.tanggal, r.userId, r.nama, r.divisi, r.titik, r.jamPertama, r.jamTerakhir,
        r.durasi, r.km, r.jarakAreaMaks, r.menitLuar, r.koordinat, r.alamat];
    });
    sheet.getRange(2, 1, baris.length, GPS_LAPORAN_HEADERS.length).setValues(baris);
    sheet.autoResizeColumns(1, GPS_LAPORAN_HEADERS.length);
  }

  let url = '';
  try { url = SS.getUrl() + '#gid=' + sheet.getSheetId(); } catch (e) { url = ''; }

  return responseJSON({
    result: 'success',
    // Dibatasi supaya respons tidak membengkak; sheet-nya tetap berisi
    // seluruh baris.
    laporan: rekap.slice(0, 500),
    jumlah: rekap.length,
    periode: { tglMulai: tglMulai, tglSelesai: tglSelesai },
    sheetUrl: url,
    namaSheet: SHEET_GPS_LAPORAN,
    message: rekap.length
      ? 'Laporan ' + rekap.length + ' baris ditulis ke sheet "' + SHEET_GPS_LAPORAN + '".'
      : 'Tidak ada data jejak GPS pada rentang tanggal tersebut.'
  });
}

// =====================================================================
// PERAWATAN — DIJALANKAN MANUAL DARI EDITOR APPS SCRIPT
// =====================================================================

/**
 * Membuang jejak yang lebih tua dari jumlah hari tertentu (default 60).
 * Pemangkasan otomatis di handleTrackGpsPing bekerja berdasarkan JUMLAH
 * baris; yang ini berdasarkan UMUR, untuk kebijakan retensi data.
 */
function PANGKAS_JEJAK_GPS(hari) {
  const simpanHari = Number(hari) > 0 ? Number(hari) : 60;
  const sheet = SS.getSheetByName(SHEET_GPS_TRACK);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Tidak ada jejak untuk dipangkas.'); return; }

  const batas = new Date().getTime() - simpanHari * 24 * 3600 * 1000;
  const lastRow = sheet.getLastRow();
  const waktu = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  let buang = 0;
  for (let i = 0; i < waktu.length; i++) {
    const t = _gpsTrackWaktu(waktu[i][0]);
    if (t === null || t >= batas) break; // baris tersusun kronologis
    buang++;
  }
  if (buang > 0) sheet.deleteRows(2, buang);
  Logger.log('Jejak GPS dipangkas: %s baris (retensi %s hari).', buang, simpanHari);
}

/**
 * Membersihkan cache konfigurasi & daftar user pelacakan. Jalankan
 * kalau ada perubahan di sheet Users atau GpsTrackingConfig yang harus
 * langsung berlaku tanpa menunggu 10 menit.
 */
function GPSTRACK_CACHE_BERSIHKAN() {
  _gpsTrackCacheHapus(GPS_TRACK_CACHE_CFG);
  _gpsTrackCacheHapus(GPS_TRACK_CACHE_USER);
  Logger.log('Cache pelacakan GPS dibersihkan.');
}

/**
 * Menyiapkan keempat sheet sekaligus. Tidak wajib dijalankan — sheet
 * dibuat otomatis saat dipakai — tapi berguna untuk memastikan struktur
 * kolomnya benar sebelum fitur dipakai karyawan.
 */
function GPSTRACK_SIAPKAN_SHEET() {
  _pastikanSheetGpsTrack();
  _pastikanSheetGpsLast();
  _pastikanSheetGpsCfg();
  _gpsTrackSiapkanSheet(SHEET_GPS_LAPORAN, GPS_LAPORAN_HEADERS);
  Logger.log('Sheet GpsTracking, GpsPosisiTerakhir, GpsTrackingConfig, LaporanGps siap.');
}
