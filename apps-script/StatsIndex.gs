// =======================================================
// INDEKS STATISTIK dbabsen — File: StatsIndex.gs
//
// LATAR BELAKANG (terukur 13 Agu 2026 dari spreadsheet produksi):
//   dbabsen  = 6.700 baris data, 310 NIK berbeda, 0 sel formula.
//   handleGetStats menyisir SELURUH 6.700 baris itu hanya untuk
//   menghitung angka milik SATU orang, dan itu terjadi setiap kali
//   ada yang membuka dashboard. Biayanya tumbuh tiap kali import.
//
// KENAPA BARU SEKARANG BISA DI-CACHE:
//   Sebelum ini kolom A:S dbabsen berisi IMPORTRANGE — isinya bisa
//   berubah kapan saja tanpa ada kejadian yang bisa dipantau, jadi
//   meng-cache hasilnya berbahaya (angka basi tanpa cara tahu).
//   Sejak diganti import Excel (lihat IMPORT-DBABSEN.md), dbabsen
//   HANYA berubah pada satu momen: admin menekan Import. Itu titik
//   yang bisa dipakai untuk membuang cache — sehingga hasil scan
//   boleh disimpan lama dan dipakai ulang oleh semua user.
//
// UKURAN (dihitung dari data asli, bukan perkiraan):
//   310 NIK x 9 angka = 30.045 byte JSON. Batas CacheService 100 KB
//   per kunci, jadi margin ~72 KB. Tetap dijaga oleh pemeriksaan di
//   bawah supaya kalau suatu saat lewat, kegagalannya terlihat di log
//   dan bukan diam-diam (put() yang kebesaran gagal tanpa exception).
// =======================================================

// V3 menambahkan jumlah Alpa dan Hadir per tanggal agar data online dapat
// digabung tanpa menghitung ganda atau mempertahankan Alpa yang tertutup.
const KUNCI_IDX_DBABSEN = 'DBABSEN_IDX_V3';
const KUNCI_REV_IDX_DBABSEN = 'DBABSEN_IDX_REVISION_V1';

// 6 jam. Bukan pengaman kebasian — invalidasi sebenarnya dilakukan oleh
// bersihkanIndeksDbAbsen() saat import. TTL ini hanya jaring pengaman
// kalau suatu saat ada jalur lain yang mengubah dbabsen tanpa lewat import.
const IDX_TTL_DETIK = 21600;

const IDX_BATAS_BYTE = 100 * 1024;

// Simbol yang dihitung sebagai HADIR. Disalin persis dari handleGetStats
// versi lama supaya angka yang tampil di dashboard tidak berubah.
const IDX_HADIR_SYMBOLS = ['H', 'I', 'T', 'Si', 'So', 'TSo', 'TSi', 'TPC'];

/**
 * Peta agregat dbabsen per NIK.
 *
 * Kunci peta dibentuk dengan String(...).trim() PERSIS seperti
 * handleGetStats versi lama (`String(rowsDb[j][2]).trim()`), supaya
 * pencocokan NIK bertingkah sama untuk sel angka maupun sel teks.
 *
 * @return {Object} {
 *   "A0009": { hadir, telat_freq, telat_menit, sakit, alpa,
 *              no_scan_in, no_scan_out, min_ts, max_ts }, ...
 * }
 */
function _kunciIndeksDbAbsen_(periode) {
  const revisi = PropertiesService.getScriptProperties().getProperty(KUNCI_REV_IDX_DBABSEN) || '1';
  return `${KUNCI_IDX_DBABSEN}_R${revisi}_${periode.mulai}_${periode.selesai}`;
}

function getIndeksDbAbsen(periodeDiketahui) {
  const periode = periodeDiketahui || getPeriodeAbsenAktif_();
  const kunci = _kunciIndeksDbAbsen_(periode);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(kunci);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache rusak, susun ulang */ }
  }
  return _susunIndeksDbAbsen(cache, periode, kunci);
}

/**
 * Menyisir dbabsen sekali dan menyimpan hasilnya.
 * Dipisah dari getIndeksDbAbsen() supaya bisa dipanggil langsung oleh
 * IDX_HANGATKAN() sesudah import, tanpa menunggu ada user yang login.
 * @private
 */
function _susunIndeksDbAbsen(cache, periodeDiketahui, kunciDiketahui) {
  const periode = periodeDiketahui || getPeriodeAbsenAktif_();
  const kunci = kunciDiketahui || _kunciIndeksDbAbsen_(periode);
  const sheetDb = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DB_ABSEN);

  // Kolom terjauh yang dipakai di bawah: index 14 (Symbol) -> 15 kolom.
  // Sama dengan angka yang dipakai handleGetStats sebelumnya.
  const rows = bacaSheet(sheetDb, 15);
  const idx = {};

  for (let j = 1; j < rows.length; j++) {
    const nik = String(rows[j][2]).trim();
    if (!nik || nik === '-' || nik === 'undefined') continue;

    // --- Periode ---
    const rawDate = rows[j][4];
    let ts = null;
    if (rawDate instanceof Date) ts = rawDate.getTime();
    else if (typeof rawDate === 'string') {
      const parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) ts = parsed.getTime();
    }
    const tanggalBaris = ts === null ? '' : Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!tanggalDalamPeriode_(tanggalBaris, periode)) continue;

    let e = idx[nik];
    if (!e) {
      e = idx[nik] = {
        hadir: 0, telat_freq: 0, telat_menit: 0, sakit: 0, alpa: 0,
        no_scan_in: 0, no_scan_out: 0, min_ts: null, max_ts: null,
        alpa_by_date: {}, hadir_by_date: {}
      };
    }
    if (e.min_ts === null || ts < e.min_ts) e.min_ts = ts;
    if (e.max_ts === null || ts > e.max_ts) e.max_ts = ts;

    // --- Simbol ---
    const symbol = String(rows[j][14]);
    const telatStr = rows[j][10];

    if (IDX_HADIR_SYMBOLS.indexOf(symbol) !== -1) {
      e.hadir++;
      if (ts !== null) {
        const tanggal = Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        e.hadir_by_date[tanggal] = (e.hadir_by_date[tanggal] || 0) + 1;
      }
    }
    if (symbol === 'S') e.sakit++;
    if (symbol === 'A' || symbol === 'AC') {
      e.alpa++;
      if (ts !== null) {
        const tanggal = Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        e.alpa_by_date[tanggal] = (e.alpa_by_date[tanggal] || 0) + 1;
      }
    }

    if (symbol.indexOf('T') !== -1 ||
        (telatStr && telatStr !== '00:00:00' && telatStr !== '-' && telatStr !== 'FALSE')) {
      if (symbol.indexOf('T') !== -1) e.telat_freq++;
      e.telat_menit += parseTimeToMinutes(telatStr);
    }

    if (['Si', 'TSi', 'SiPC', 'SiSo'].indexOf(symbol) !== -1) e.no_scan_in++;
    if (['So', 'TSo', 'SiSo'].indexOf(symbol) !== -1) e.no_scan_out++;
  }

  // Simpan. Kegagalan put() TIDAK boleh menggagalkan request — user tetap
  // dapat angka yang benar, hanya saja request berikutnya menyisir lagi.
  try {
    const payload = JSON.stringify(idx);
    if (payload.length > IDX_BATAS_BYTE) {
      // put() yang kebesaran gagal DIAM-DIAM. Dicatat supaya kalau
      // suatu hari jumlah NIK meledak, penyebabnya kelihatan di log
      // dan bukan muncul sebagai "kok lambat lagi ya".
      console.warn('Indeks dbabsen %s byte, melewati batas CacheService %s byte. ' +
                   'Cache dilewati — get_stats kembali menyisir sheet tiap request.',
                   payload.length, IDX_BATAS_BYTE);
    } else {
      cache.put(kunci, payload, IDX_TTL_DETIK);
    }
  } catch (e) {
    console.warn('Indeks dbabsen gagal di-cache: ' + e.message);
  }

  return idx;
}

/**
 * Membuang indeks. WAJIB dipanggil setiap kali isi dbabsen berubah —
 * saat ini hanya di akhir handleImportDbAbsen (lihat ImportDbAbsen.gs).
 * Kalau nanti ada jalur lain yang menulis ke dbabsen, panggil ini juga,
 * kalau tidak dashboard akan menampilkan angka periode sebelumnya.
 */
function bersihkanIndeksDbAbsen() {
  try {
    const props = PropertiesService.getScriptProperties();
    const revisiLama = Number(props.getProperty(KUNCI_REV_IDX_DBABSEN) || 1);
    props.setProperty(KUNCI_REV_IDX_DBABSEN, String(revisiLama + 1));
    const periode = getPeriodeAbsenAktif_();
    CacheService.getScriptCache().remove(_kunciIndeksDbAbsen_(periode));
  } catch (e) {
    console.warn('Gagal membersihkan indeks dbabsen: ' + e.message);
  }
}

/**
 * Susun ulang indeks sekarang juga, tanpa menunggu user pertama.
 * Dipanggil setelah import supaya yang membayar biaya scan adalah proses
 * import (yang memang sudah lama), bukan orang pertama yang login.
 */
function IDX_HANGATKAN() {
  const t0 = new Date().getTime();
  const periode = getPeriodeAbsenAktif_();
  const idx = _susunIndeksDbAbsen(CacheService.getScriptCache(), periode, _kunciIndeksDbAbsen_(periode));
  const durasi = new Date().getTime() - t0;
  Logger.log('Indeks dbabsen disusun ulang: %s NIK dalam %s ms', Object.keys(idx).length, durasi);
  return idx;
}

/**
 * Read-only. Memastikan indeks benar-benar bekerja dan mengukur selisih
 * pembacaan dingin vs panas. Jalankan dari editor Apps Script.
 */
function IDX_UJI() {
  bersihkanIndeksDbAbsen();

  let t0 = new Date().getTime();
  const idx = getIndeksDbAbsen();
  const dingin = new Date().getTime() - t0;

  t0 = new Date().getTime();
  getIndeksDbAbsen();
  const panas = new Date().getTime() - t0;

  const ukuran = JSON.stringify(idx).length;
  Logger.log('Indeks dbabsen : %s NIK', Object.keys(idx).length);
  Logger.log('Dingin (scan sheet) : %s ms', dingin);
  Logger.log('Panas  (dari cache) : %s ms', panas);
  Logger.log('Ukuran JSON         : %s byte (batas %s)', ukuran, IDX_BATAS_BYTE);
  Logger.log('');
  Logger.log('Kalau "panas" tidak jauh lebih kecil dari "dingin", cache TIDAK bekerja.');
  Logger.log('Periksa dulu apakah ukuran JSON melewati batas.');
}
