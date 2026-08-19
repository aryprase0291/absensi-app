// =======================================================
// CACHE — memotong pembacaan sheet yang berulang
// File: Cache.gs
//
// LATAR BELAKANG (terukur di produksi 12 Agu 2026):
// handleLogin membaca 3 sheet PENUH (Users + MasterData + MASTER-CUTI),
// padahal dua yang terakhir hampir tidak pernah berubah dan hanya dipakai
// untuk mencari satu baris. Dengan ~300 user, request menumpuk di lapisan
// admisi Apps Script: klien menunggu 10-60 detik padahal eksekusi server
// hanya 2-5 detik, dan 60% request 'login' dibalas halaman HTML.
//
// CATATAN PENTING soal batas CacheService:
//   - maksimal 100 KB per kunci, 10 MB total
//   - MASTER-CUTI berisiko melewati 100 KB kalau disimpan apa adanya.
//     Karena itu yang disimpan hanya PETA RINGKAS
//     noPayroll -> {terpakai, bersama, tersedia}, bukan sheetnya.
//     Diukur 13 Agu 2026 dari data asli: 325 NIK = 42.436 byte. Aman,
//     tapi jangan sekali-kali diubah jadi menyimpan barisnya utuh.
//   - JSON mengubah Date menjadi string. Aman di sini karena MasterData
//     berisi teks dan peta cuti berisi angka.
//   - put() yang gagal TIDAK boleh menggagalkan request: dibungkus try.
// =======================================================

const CACHE_TTL_DETIK = 600; // 10 menit

// Naikkan angka versi di kunci kalau struktur datanya berubah,
// supaya cache lama tidak terpakai.
const KUNCI_MASTERDATA = 'MASTERDATA_V1';
const KUNCI_PETA_CUTI  = 'PETACUTI_V1';
const KUNCI_GEOFENCE   = 'GEOFENCE_V1';

/**
 * MasterData (kategori, value, label) — dipakai untuk menyusun menu.
 * Ukurannya kecil sehingga aman disimpan utuh.
 * @return {Array<Object>} [{kategori, value, label}, ...]
 */
function getMasterDataCached() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(KUNCI_MASTERDATA);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache rusak, ambil ulang */ }
  }

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MASTER);
  if (!sh) return [];

  const rows = sh.getDataRange().getValues();
  const hasil = rows.length > 1
    ? rows.slice(1).map(function (r) {
        return { kategori: r[0], value: r[1], label: r[2] };
      })
    : [];

  try {
    cache.put(KUNCI_MASTERDATA, JSON.stringify(hasil), CACHE_TTL_DETIK);
  } catch (e) {
    console.warn('MasterData gagal di-cache: ' + e.message);
  }
  return hasil;
}

/**
 * Peta cuti per No Payroll, diringkas dari MASTER-CUTI.
 * Kolom B (1) = No Payroll, W (22) = terpakai, X (23) = bersama, Y (24) = tersedia.
 * @return {Object} { "A0009": {terpakai, bersama, tersedia}, ... }
 */
function getPetaCutiCached() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(KUNCI_PETA_CUTI);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache rusak, ambil ulang */ }
  }

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
  //
  // Dua getRange terpisah membaca 4 kolom saja dan melompati kolom U
  // sepenuhnya. Kalau baris kosong itu nanti dibersihkan
  // (lihat Perawatan.gs -> MASTERCUTI_PERIKSA/MASTERCUTI_BERSIHKAN),
  // kode ini tetap benar — hanya jadi lebih cepat lagi.
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

  try {
    cache.put(KUNCI_PETA_CUTI, JSON.stringify(peta), CACHE_TTL_DETIK);
  } catch (e) {
    console.warn('Peta cuti gagal di-cache: ' + e.message);
  }
  return peta;
}

/**
 * Konfigurasi Geofence per user (peta userId -> {required, areas}).
 *
 * LATAR BELAKANG (Agu 2026): sheet Geofence dibaca PENUH tanpa cache di
 * DUA jalur yang sering dipanggil — handleLogin (sekali per login) DAN
 * handleAbsen -> validasiGeofence (setiap kali Hadir/Pulang, jalur paling
 * sering dipakai di seluruh aplikasi). Ukurannya kecil per baris, tapi
 * tetap satu round-trip baca sheet yang sebenarnya bisa dihindari kalau
 * datanya jarang berubah (hanya saat admin menyimpan konfigurasi baru).
 *
 * _susunKonfigurasiGeofence_ (di Code.gs) melakukan pembacaan sheet yang
 * sesungguhnya; fungsi ini hanya lapisan cache di depannya, mengikuti pola
 * yang sama seperti getMasterDataCached/getPetaCutiCached.
 * @return {Object} { "USR-123": {required, areas: [...]}, ... }
 */
function getGeofenceConfigCached() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(KUNCI_GEOFENCE);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache rusak, ambil ulang */ }
  }

  const map = _susunKonfigurasiGeofence_();

  try {
    cache.put(KUNCI_GEOFENCE, JSON.stringify(map), CACHE_TTL_DETIK);
  } catch (e) {
    console.warn('Konfigurasi geofence gagal di-cache: ' + e.message);
  }
  return map;
}

/**
 * Kosongkan cache geofence. WAJIB dipanggil setiap kali konfigurasi
 * geofence disimpan (lihat handleSaveGeofenceConfig di Code.gs) — kalau
 * tidak, perubahan admin baru terlihat oleh user lain setelah TTL habis.
 */
function GEOFENCE_CACHE_BERSIHKAN() {
  CacheService.getScriptCache().remove(KUNCI_GEOFENCE);
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

/**
 * Kosongkan cache secara manual. Jalankan setelah mengubah MasterData
 * atau MASTER-CUTI kalau tidak mau menunggu 10 menit.
 */
function CACHE_BERSIHKAN() {
  CacheService.getScriptCache().removeAll([KUNCI_MASTERDATA, KUNCI_PETA_CUTI, KUNCI_GEOFENCE]);
  Logger.log('Cache dikosongkan. Pembacaan berikutnya mengambil data terbaru dari sheet.');
}

/**
 * Read-only. Memeriksa apakah cache benar-benar bekerja dan mengukur
 * selisih waktu antara pembacaan pertama (dingin) dan kedua (panas).
 */
function CACHE_UJI() {
  CACHE_BERSIHKAN();

  let t0 = new Date().getTime();
  const md1 = getMasterDataCached();
  const dingin1 = new Date().getTime() - t0;

  t0 = new Date().getTime();
  getMasterDataCached();
  const panas1 = new Date().getTime() - t0;

  t0 = new Date().getTime();
  const pc1 = getPetaCutiCached();
  const dingin2 = new Date().getTime() - t0;

  t0 = new Date().getTime();
  getPetaCutiCached();
  const panas2 = new Date().getTime() - t0;

  Logger.log('MasterData : %s entri | dingin %s ms -> panas %s ms', md1.length, dingin1, panas1);
  Logger.log('Peta cuti  : %s NIK   | dingin %s ms -> panas %s ms', Object.keys(pc1).length, dingin2, panas2);
  Logger.log('');
  Logger.log('Ukuran peta cuti kalau di-JSON: %s byte (batas CacheService 100 KB)',
             JSON.stringify(pc1).length);
  Logger.log('Kalau "panas" tidak jauh lebih kecil dari "dingin", cache TIDAK bekerja');
  Logger.log('— biasanya karena datanya melebihi 100 KB per kunci.');
}
