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
//   - MASTER-CUTI (~300 baris x 25 kolom) berisiko melewati 100 KB kalau
//     disimpan apa adanya. Karena itu yang disimpan hanya PETA RINGKAS
//     noPayroll -> {terpakai, bersama, tersedia} (~10 KB), bukan sheetnya.
//   - JSON mengubah Date menjadi string. Aman di sini karena MasterData
//     berisi teks dan peta cuti berisi angka.
//   - put() yang gagal TIDAK boleh menggagalkan request: dibungkus try.
// =======================================================

const CACHE_TTL_DETIK = 600; // 10 menit

// Naikkan angka versi di kunci kalau struktur datanya berubah,
// supaya cache lama tidak terpakai.
const KUNCI_MASTERDATA = 'MASTERDATA_V1';
const KUNCI_PETA_CUTI  = 'PETACUTI_V1';

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

  const rows = sh.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    const nik = String(rows[i][1] || '').trim();
    if (!nik) continue;
    peta[nik] = {
      terpakai: rows[i][22] || 0,
      bersama:  rows[i][23] || 0,
      tersedia: rows[i][24] || 0
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
 * Kosongkan cache secara manual. Jalankan setelah mengubah MasterData
 * atau MASTER-CUTI kalau tidak mau menunggu 10 menit.
 */
function CACHE_BERSIHKAN() {
  CacheService.getScriptCache().removeAll([KUNCI_MASTERDATA, KUNCI_PETA_CUTI]);
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
