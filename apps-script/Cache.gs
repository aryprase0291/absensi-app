// =======================================================
// CACHE — memotong pembacaan sheet yang berulang
// File: Cache.gs
//
// LATAR BELAKANG (terukur di produksi 12 Agu 2026):
// handleLogin membaca 3 sheet PENUH (Users + MasterData + MASTER-CUTI),
// padahal dua yang terakhir hampir tidak pernah berubah dan hanya dipakai
// untuk mencari satu baris. Dengan ~300 user, request menumpuk di lapisan
// admisi Apps Script.
//
// -------------------------------------------------------
// PERBAIKAN 21 Agu 2026 — CacheService tidak menyimpan apa pun
//
// Ditemukan saat mengejar masalah lambat di StatsIndex.gs: CacheService
// di skrip ini MENERIMA put() tanpa melempar error, tapi get() sesudahnya
// mengembalikan null. Dibuktikan dengan payload 5.408 byte — hanya 5%
// dari batas 100 KB — yang tetap hilang. Jadi bukan soal ukuran.
//
// Artinya KETIGA cache di file ini tidak pernah bekerja sejak dibuat:
//
//   getMasterDataCached()     -> dipanggil handleLogin (Code.gs:1516)
//   getPetaCutiCached()       -> handleLogin (1522) DAN hitungStats (1804)
//   getGeofenceConfigCached() -> handleAbsen (1421), jalur paling sering
//                                dipakai di seluruh aplikasi
//
// Setiap login membaca ulang MasterData + MASTER-CUTI dari sheet, dan
// setiap tap Hadir/Pulang membaca ulang sheet Geofence. Tabel "cache
// hangat" di PERBAIKAN-LOGIN.md ternyata tidak pernah tercapai — yang
// selama ini berjalan adalah kolom "cache dingin".
//
// PENYIMPANANNYA SEKARANG:
//   Sumber kebenaran  : PropertiesService (Script Properties)
//   Lapisan cepat     : CacheService, tetap dicoba tapi tidak diandalkan
//
// KENAPA MASIH PAKAI MASA BERLAKU (berbeda dengan StatsIndex.gs):
//   Indeks dbabsen boleh disimpan selamanya karena isinya HANYA berubah
//   lewat tombol Import — ada kejadian yang bisa dipantau. Tiga data di
//   file ini tidak begitu: MASTER-CUTI bisa disunting langsung di sheet
//   atau oleh SyncCuti, MasterData bisa diubah admin. Kalau disimpan
//   tanpa batas waktu, angka cuti bisa basi tanpa ada yang menyadarinya.
//   Karena itu masa berlaku 10 menit tetap dipertahankan, hanya sekarang
//   dicatat sendiri sebagai stempel waktu (Properties tidak punya TTL).
//
// CATATAN UKURAN:
//   Semua nilai dikompres gzip+base64 sebelum disimpan. Peta cuti yang
//   dulu 42.436 byte JSON turun ke beberapa KB saja. Batas Properties
//   9 KB per nilai; kalau lewat, otomatis dipecah beberapa properti
//   (total 500 KB, pemakaian sekarang ~12 KB termasuk indeks dbabsen).
// =======================================================

const CACHE_TTL_DETIK = 600; // 10 menit

// V2: format simpanan berubah (terkompresi + berstempel waktu, di
// Properties). Kunci dinaikkan supaya sisa format lama tidak terbaca.
const KUNCI_MASTERDATA = 'MASTERDATA_V2';
const KUNCI_PETA_CUTI  = 'PETACUTI_V2';
const KUNCI_GEOFENCE   = 'GEOFENCE_V2';

const CACHE_PROP_AWALAN   = 'CACHESTORE_';
const CACHE_PROP_POTONGAN = 8 * 1024;  // batas keras Apps Script 9 KB
const CACHE_BATAS_CS      = 100 * 1024; // batas keras CacheService


// =======================================================
// LAPISAN PENYIMPANAN
// =======================================================

/**
 * Memo seluruh Script Properties untuk SATU eksekusi.
 *
 * getProperty() adalah panggilan layanan (~sama mahalnya dengan
 * Utilities.formatDate — pelajaran dari StatsIndex.gs). Satu login
 * membaca 3 simpanan; tanpa memo itu 6-8 panggilan layanan. Dengan
 * getProperties() sekali lalu dipakai bersama, cukup SATU.
 *
 * Global scope Apps Script dibuat ulang tiap eksekusi, jadi memo ini
 * tidak pernah bocor antar-request.
 * @private
 */
let _CACHE_PROPS_MEMO = null;

/** @private */
function _propsSemua_() {
  if (_CACHE_PROPS_MEMO === null) {
    _CACHE_PROPS_MEMO = PropertiesService.getScriptProperties().getProperties();
  }
  return _CACHE_PROPS_MEMO;
}

/** Wajib dipanggil setiap kali properti ditulis/dihapus. @private */
function _propsLupakan_() { _CACHE_PROPS_MEMO = null; }

/** @private */
function _cacheKompres_(json) {
  return Utilities.base64Encode(
    Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes()
  );
}

/** @private */
function _cacheDekompres_(b64) {
  return Utilities.ungzip(
    Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')
  ).getDataAsString();
}

/**
 * Menyimpan sebuah nilai dengan masa berlaku.
 * Properties = sumber kebenaran, CacheService = lapisan cepat opsional.
 *
 * @return {{ok: boolean, byte: number, potongan: number, alasan: string}}
 * @private
 */
function _simpanTahan_(kunci, obj, ttlDetik) {
  const hasil = { ok: false, byte: 0, potongan: 0, alasan: '' };

  let b64;
  try {
    b64 = _cacheKompres_(JSON.stringify(obj));
    hasil.byte = b64.length;
  } catch (e) {
    hasil.alasan = 'gagal mengompres: ' + e.message;
    return hasil;
  }

  try {
    const potongan = [];
    for (let p = 0; p < b64.length; p += CACHE_PROP_POTONGAN) {
      potongan.push(b64.substring(p, p + CACHE_PROP_POTONGAN));
    }
    hasil.potongan = potongan.length;

    const tulis = {};
    for (let i = 0; i < potongan.length; i++) {
      tulis[CACHE_PROP_AWALAN + kunci + '_' + i] = potongan[i];
    }
    // Stempel waktu kedaluwarsa disimpan bersama jumlah potongan, dalam
    // satu setProperties — sehingga tidak ada kondisi setengah-tertulis.
    tulis[CACHE_PROP_AWALAN + kunci + '_meta'] = JSON.stringify({
      exp: new Date().getTime() + ttlDetik * 1000,
      n: potongan.length
    });

    PropertiesService.getScriptProperties().setProperties(tulis, false);
    _propsLupakan_();

    // VERIFIKASI BACA ULANG. "Tidak melempar error" bukan bukti bahwa
    // datanya tersimpan — itu persis jebakan yang membuat bug
    // CacheService bertahan seminggu.
    hasil.ok = !!_propsSemua_()[CACHE_PROP_AWALAN + kunci + '_meta'];
    if (!hasil.ok) hasil.alasan = 'ditulis tanpa error, tapi hilang saat dibaca ulang';
  } catch (e) {
    hasil.alasan = e.message;
    return hasil;
  }

  // Lapisan cepat — boleh gagal total tanpa mempengaruhi apa pun.
  try {
    if (b64.length <= CACHE_BATAS_CS) {
      CacheService.getScriptCache().put(kunci, b64, ttlDetik);
    }
  } catch (e) { /* diabaikan dengan sengaja */ }

  return hasil;
}

/**
 * Membaca nilai yang masih berlaku.
 * @return {Object|null} null kalau belum ada, rusak, atau sudah lewat masa berlaku.
 * @private
 */
function _ambilTahan_(kunci) {
  // --- Lapis 1: CacheService (kalau memang jalan di skrip ini) ---
  try {
    const raw = CacheService.getScriptCache().get(kunci);
    if (raw) {
      const obj = JSON.parse(_cacheDekompres_(raw));
      if (obj) return obj;
    }
  } catch (e) { /* lanjut ke Properties */ }

  // --- Lapis 2: Script Properties ---
  try {
    const semua = _propsSemua_();
    const metaRaw = semua[CACHE_PROP_AWALAN + kunci + '_meta'];
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw);
    if (!meta || !meta.n) return null;
    if (new Date().getTime() > meta.exp) return null; // sudah lewat masa berlaku

    let b64 = '';
    for (let i = 0; i < meta.n; i++) {
      const bagian = semua[CACHE_PROP_AWALAN + kunci + '_' + i];
      if (bagian === undefined) return null; // potongan hilang -> ambil ulang
      b64 += bagian;
    }
    return JSON.parse(_cacheDekompres_(b64));
  } catch (e) {
    return null; // simpanan rusak -> pemanggil membaca sheet lagi
  }
}

/** Membuang satu simpanan dari kedua lapisan. @private */
function _hapusTahan_(kunci) {
  try { CacheService.getScriptCache().remove(kunci); } catch (e) { /* abaikan */ }
  try {
    const props = PropertiesService.getScriptProperties();
    const semua = _propsSemua_();
    const metaRaw = semua[CACHE_PROP_AWALAN + kunci + '_meta'];
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      for (let i = 0; i < (meta.n || 0); i++) props.deleteProperty(CACHE_PROP_AWALAN + kunci + '_' + i);
    }
    props.deleteProperty(CACHE_PROP_AWALAN + kunci + '_meta');
    _propsLupakan_();
  } catch (e) {
    console.warn('Gagal menghapus simpanan ' + kunci + ': ' + e.message);
  }
}


// =======================================================
// DATA YANG DISIMPAN
// =======================================================

/**
 * MasterData (kategori, value, label) — dipakai untuk menyusun menu.
 * @return {Array<Object>} [{kategori, value, label}, ...]
 */
function getMasterDataCached() {
  const hit = _ambilTahan_(KUNCI_MASTERDATA);
  if (hit) return hit;

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MASTER);
  if (!sh) return [];

  const rows = sh.getDataRange().getValues();
  const hasil = rows.length > 1
    ? rows.slice(1).map(function (r) {
        return { kategori: r[0], value: r[1], label: r[2] };
      })
    : [];

  const s = _simpanTahan_(KUNCI_MASTERDATA, hasil, CACHE_TTL_DETIK);
  if (!s.ok) console.warn('MasterData gagal disimpan: ' + s.alasan);
  return hasil;
}

/**
 * Peta cuti per No Payroll, diringkas dari MASTER-CUTI.
 * Kolom B (1) = No Payroll, W (22) = terpakai, X (23) = bersama, Y (24) = tersedia.
 * @return {Object} { "A0009": {terpakai, bersama, tersedia}, ... }
 */
function getPetaCutiCached() {
  const hit = _ambilTahan_(KUNCI_PETA_CUTI);
  if (hit) return hit;

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MASTER_CUTI_NAME);
  const peta = {};
  if (!sh) return peta;

  // --- KENAPA TIDAK getDataRange() (Agu 2026) ---
  // Diukur dari spreadsheet produksi: MASTER-CUTI hanya berisi 325 baris
  // data, tapi getLastRow() melaporkan 7.511 — karena kolom U diisi
  // formula `=B2` yang ter-drag sampai jauh ke bawah (7.510 sel).
  // getDataRange() berarti 7.511 x 27 = 202.797 sel, dan membaca kolom U
  // memaksa 7.510 formula itu dihitung ulang. Padahal yang dipakai di
  // bawah cuma kolom B, W, X, Y.
  const baris = _lastRowKolom(sh, 2); // baris terakhir yang punya No Payroll
  if (baris < 1) return peta;

  const kolNik = sh.getRange(1, 2, baris, 1).getValues();       // B
  const kolCuti = sh.getRange(1, 23, baris, 3).getValues();     // W, X, Y

  for (let i = 0; i < baris; i++) {
    const nik = String(kolNik[i][0] || '').trim();
    if (!nik) continue;
    peta[nik] = {
      terpakai: kolCuti[i][0] || 0,
      bersama:  kolCuti[i][1] || 0,
      tersedia: kolCuti[i][2] || 0
    };
  }

  const s = _simpanTahan_(KUNCI_PETA_CUTI, peta, CACHE_TTL_DETIK);
  if (!s.ok) console.warn('Peta cuti gagal disimpan: ' + s.alasan);
  return peta;
}

/**
 * Konfigurasi Geofence per user (peta userId -> {required, areas}).
 *
 * Dipakai handleLogin DAN handleAbsen -> validasiGeofence, yaitu jalur
 * paling sering dipakai di seluruh aplikasi (setiap tap Hadir/Pulang).
 * _susunKonfigurasiGeofence_ (di Code.gs) yang membaca sheetnya;
 * fungsi ini hanya lapisan simpanan di depannya.
 * @return {Object} { "USR-123": {required, areas: [...]}, ... }
 */
function getGeofenceConfigCached() {
  const hit = _ambilTahan_(KUNCI_GEOFENCE);
  if (hit) return hit;

  const map = _susunKonfigurasiGeofence_();

  const s = _simpanTahan_(KUNCI_GEOFENCE, map, CACHE_TTL_DETIK);
  if (!s.ok) console.warn('Konfigurasi geofence gagal disimpan: ' + s.alasan);
  return map;
}


// =======================================================
// PEMBERSIHAN
// =======================================================

/**
 * Kosongkan simpanan geofence. WAJIB dipanggil setiap kali konfigurasi
 * geofence disimpan (handleSaveGeofenceConfig di Code.gs) — kalau tidak,
 * perubahan admin baru terlihat user lain setelah masa berlaku habis.
 */
function GEOFENCE_CACHE_BERSIHKAN() { _hapusTahan_(KUNCI_GEOFENCE); }

/**
 * Kosongkan simpanan MasterData.
 *
 * ⚠️ Code.gs baris 1666 (handleTambahMaster) masih memanggil
 *    CacheService.getScriptCache().remove(KUNCI_MASTERDATA) secara
 *    langsung. Itu TIDAK lagi cukup, karena sumber kebenarannya sekarang
 *    Properties. Ganti baris itu menjadi:  MASTERDATA_CACHE_BERSIHKAN();
 */
function MASTERDATA_CACHE_BERSIHKAN() { _hapusTahan_(KUNCI_MASTERDATA); }

/** Kosongkan simpanan peta cuti. Panggil setelah SyncCuti menulis MASTER-CUTI. */
function PETACUTI_CACHE_BERSIHKAN() { _hapusTahan_(KUNCI_PETA_CUTI); }

/**
 * Kosongkan semua simpanan secara manual. Jalankan setelah mengubah
 * MasterData atau MASTER-CUTI kalau tidak mau menunggu 10 menit.
 */
function CACHE_BERSIHKAN() {
  _hapusTahan_(KUNCI_MASTERDATA);
  _hapusTahan_(KUNCI_PETA_CUTI);
  _hapusTahan_(KUNCI_GEOFENCE);
  Logger.log('Simpanan dikosongkan. Pembacaan berikutnya mengambil data terbaru dari sheet.');
}

/**
 * Baris terakhir yang benar-benar berisi data pada satu kolom.
 *
 * sheet.getLastRow() mengembalikan baris terakhir yang terisi di SELURUH
 * sheet — termasuk kolom lain yang penuh formula sampai jauh ke bawah.
 * getNextDataCell(UP) menelusuri dari bawah ke atas pada satu kolom saja
 * dan tidak membaca isi selnya, jadi murah.
 *
 * @param {Sheet} sh
 * @param {number} kolom  nomor kolom 1-based (B = 2)
 * @return {number} nomor baris terakhir berisi data, 0 kalau kosong
 * @private
 */
function _lastRowKolom(sh, kolom) {
  const maxRows = sh.getMaxRows();
  if (maxRows < 1) return 0;
  const sel = sh.getRange(maxRows, kolom).getNextDataCell(SpreadsheetApp.Direction.UP);
  const baris = sel.getRow();
  // Kalau kolomnya benar-benar kosong, getNextDataCell mendarat di baris 1.
  if (baris === 1 && sel.getValue() === '') return 0;
  return baris;
}


// =======================================================
// DIAGNOSTIK
// =======================================================

/**
 * Memastikan ketiga simpanan benar-benar bekerja, dan memberi vonis —
 * bukan sekadar menampilkan angka seperti versi lama.
 */
function CACHE_UJI() {
  CACHE_BERSIHKAN();

  const ukur = function (nama, fn, kunci) {
    let t0 = new Date().getTime();
    const data = fn();
    const dingin = new Date().getTime() - t0;

    const tersimpan = _ambilTahan_(kunci);

    t0 = new Date().getTime();
    fn();
    const panas = new Date().getTime() - t0;

    const jumlah = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
    const byte = _cacheKompres_(JSON.stringify(data)).length;

    Logger.log('%s', nama);
    Logger.log('   isi            : %s entri  (%s byte terkompresi)', jumlah, byte);
    Logger.log('   dingin -> panas: %s ms -> %s ms', dingin, panas);
    Logger.log('   tersimpan      : %s', tersimpan ? 'YA' : 'TIDAK  <-- MASALAH');
    Logger.log('');
    return !!tersimpan;
  };

  Logger.log('=========== UJI SIMPANAN Cache.gs ===========');
  const a = ukur('MasterData', getMasterDataCached, KUNCI_MASTERDATA);
  const b = ukur('Peta cuti (MASTER-CUTI)', getPetaCutiCached, KUNCI_PETA_CUTI);
  const c = ukur('Konfigurasi geofence', getGeofenceConfigCached, KUNCI_GEOFENCE);

  if (a && b && c) {
    Logger.log('>>> BERHASIL: ketiganya tersimpan.');
    Logger.log('    Login tidak lagi membaca MasterData & MASTER-CUTI dari sheet,');
    Logger.log('    dan tap Hadir/Pulang tidak lagi membaca sheet Geofence.');
  } else {
    Logger.log('>>> GAGAL: ada yang tidak tersimpan. Jalankan IDX_DIAGNOSA()');
    Logger.log('    (di StatsIndex.gs) bagian E untuk memeriksa PropertiesService.');
  }

  try {
    const isiSemua = PropertiesService.getScriptProperties().getProperties();
    let dipakai = 0;
    Object.keys(isiSemua).forEach(function (k) { dipakai += k.length + String(isiSemua[k]).length; });
    Logger.log('');
    Logger.log('Pemakaian Script Properties: %s byte dari ~512000 (%s properti).',
               dipakai, Object.keys(isiSemua).length);
  } catch (e) { /* abaikan */ }
}
