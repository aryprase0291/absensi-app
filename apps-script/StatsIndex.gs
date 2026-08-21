// =======================================================
// INDEKS STATISTIK dbabsen — File: StatsIndex.gs
//
// TUJUAN
//   handleGetStats / hitungStats butuh angka agregat per NIK dari sheet
//   dbabsen. Tanpa indeks, sheet itu disisir ulang dari nol SETIAP kali
//   ada yang login / membuka dashboard, hanya untuk mengambil angka satu
//   orang. File ini menyisirnya SEKALI lalu menyimpan hasilnya supaya
//   dipakai ulang oleh semua user.
//
// KENAPA HASILNYA BOLEH DISIMPAN
//   Sejak dbabsen diisi lewat import Excel (bukan IMPORTRANGE), isinya
//   HANYA berubah pada satu momen: admin menekan Import. Titik itulah
//   yang dipakai untuk membuang simpanan — lihat bersihkanIndeksDbAbsen().
//
// -------------------------------------------------------
// RIWAYAT PERBAIKAN 21 Agu 2026
//
// TAHAP 1 — scan dingin 15 detik  [SELESAI, TERBUKTI]
//   Session.getScriptTimeZone() dan Utilities.formatDate() dipanggil
//   ULANG di dalam loop, sampai 3x per baris. Keduanya panggilan layanan
//   Apps Script (~0,3-0,7 ms), bukan operasi JavaScript biasa.
//   6.700 baris x ~3 = ~20.900 panggilan = ~13 detik.
//   Sekarang zona waktu diambil sekali di luar loop, hasil format tanggal
//   di-memo per timestamp, dan tanggal yang sudah dihitung di awal baris
//   dipakai ulang.  TERUKUR: 15.107 ms -> 1.417 ms.
//
// TAHAP 2 — hasil scan tidak pernah tersimpan  [DIPERBAIKI DI SINI]
//   Empat percobaan lewat CacheService semuanya gagal:
//     v1  cache.put() satu kunci besar        -> gagal diam-diam (113 KB > 100 KB)
//     v2  dipecah per NIK + cache.putAll()    -> gagal, putAll dibatasi TOTAL 100 KB
//     v3  loop cache.put() per potongan       -> error "parameters () don't match"
//     v4  gzip+base64, 5.408 byte, satu kunci -> DITULIS TANPA ERROR, TAPI HILANG
//                                                SAAT DIBACA ULANG
//   v4 membuktikan ukuran BUKAN penyebabnya: 5.408 byte itu cuma 5% dari
//   batas, dan tetap hilang. Artinya CacheService di skrip ini memang
//   tidak menyimpan — entah kenapa (jalankan IDX_DIAGNOSA() untuk
//   memastikan penyebabnya).
//
//   Karena itu penyimpanan TIDAK LAGI BERGANTUNG pada CacheService.
//   Sumber kebenarannya sekarang PropertiesService (Script Properties):
//     - batas 9 KB per nilai; indeks terkompresi 5.408 byte -> muat
//     - TIDAK PUNYA MASA KEDALUWARSA. Cache 6 jam berarti scan dingin
//       terulang minimal 4x sehari; dengan Properties, scan hanya terjadi
//       saat isi dbabsen benar-benar berubah.
//     - cocok dengan model invalidasi yang sudah dipakai: dibuang secara
//       eksplisit saat import, bukan menunggu TTL.
//   CacheService tetap dipakai sebagai lapisan cepat di depannya, tapi
//   kalau gagal, semuanya tetap berjalan normal.
// =======================================================

// V5: sumber kebenaran pindah ke Script Properties.
const KUNCI_IDX_DBABSEN = 'DBABSEN_IDX_V5';
const KUNCI_REV_IDX_DBABSEN = 'DBABSEN_IDX_REVISION_V1';

// Awalan properti penyimpan indeks. Dipakai juga untuk membersihkan
// sisa revisi lama supaya kuota 500 KB tidak pelan-pelan penuh.
const IDX_PROP_AWALAN = 'IDXSTORE_';

// Batas aman per nilai properti. Batas keras Apps Script 9 KB; diberi
// margin supaya tidak mepet.
const IDX_PROP_POTONGAN = 8 * 1024;

// TTL lapisan cache (opsional). Maksimum yang diizinkan 21600 = 6 jam.
const IDX_TTL_DETIK = 21600;
const IDX_BATAS_CACHE = 100 * 1024;

// Simbol yang dihitung sebagai HADIR. Disalin persis dari handleGetStats
// versi lama supaya angka yang tampil di dashboard tidak berubah.
const IDX_HADIR_SYMBOLS = ['H', 'I', 'T', 'Si', 'So', 'TSo', 'TSi', 'TPC'];


// =======================================================
// KUNCI
// =======================================================

function _kunciIndeksDbAbsen_(periode) {
  const revisi = PropertiesService.getScriptProperties().getProperty(KUNCI_REV_IDX_DBABSEN) || '1';
  return `${KUNCI_IDX_DBABSEN}_R${revisi}_${periode.mulai}_${periode.selesai}`;
}


// =======================================================
// KOMPRESI
//
// JSON indeks sangat repetitif (nama kunci yang sama diulang 214 kali),
// jadi gzip sangat efektif — TERUKUR 113.196 -> 5.408 byte (5%).
// Hasil gzip berupa byte mentah sedangkan penyimpanan hanya menerima
// String, karena itu dibungkus base64.
// =======================================================

/** @return {string} base64 dari gzip(json) @private */
function _kompresIndeks_(json) {
  return Utilities.base64Encode(
    Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes()
  );
}

/** @return {string} json asli @private */
function _dekompresIndeks_(b64) {
  return Utilities.ungzip(
    Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')
  ).getDataAsString();
}

/** @return {Object|null} @private */
function _uraiIndeks_(b64) {
  try { return JSON.parse(_dekompresIndeks_(b64)); } catch (e) { return null; }
}


// =======================================================
// PENYIMPANAN
//
// Dua lapis, sengaja:
//   Properties = sumber kebenaran. Tidak kedaluwarsa, tahan restart,
//                dibuang hanya saat kita memintanya.
//   Cache      = lapisan cepat opsional di depannya. Boleh gagal total
//                tanpa mempengaruhi apa pun.
// =======================================================

/**
 * Menulis indeks. Mengembalikan ringkasan supaya log bisa menyebutkan
 * persis apa yang berhasil dan apa yang tidak — tidak ada lagi kegagalan
 * diam-diam.
 * @private
 */
function _simpanIndeks_(kunci, idx) {
  const hasil = {
    byteJson: 0, byteSimpan: 0, potongan: 0,
    props: false, cache: false, alasanProps: '', alasanCache: ''
  };

  let b64;
  try {
    const json = JSON.stringify(idx);
    hasil.byteJson = json.length;
    b64 = _kompresIndeks_(json);
    hasil.byteSimpan = b64.length;
  } catch (e) {
    hasil.alasanProps = hasil.alasanCache = 'gagal mengompres: ' + e.message;
    return hasil;
  }

  // ---- Lapis 1: Script Properties (wajib berhasil) ----
  try {
    const props = PropertiesService.getScriptProperties();

    const potongan = [];
    for (let p = 0; p < b64.length; p += IDX_PROP_POTONGAN) {
      potongan.push(b64.substring(p, p + IDX_PROP_POTONGAN));
    }
    hasil.potongan = potongan.length;

    const tulis = {};
    for (let i = 0; i < potongan.length; i++) tulis[IDX_PROP_AWALAN + kunci + '_' + i] = potongan[i];
    // Penanda jumlah potongan ditulis bersamaan; setProperties bersifat
    // satu paket sehingga tidak ada kondisi setengah-tertulis.
    tulis[IDX_PROP_AWALAN + kunci + '_n'] = String(potongan.length);
    props.setProperties(tulis, false);

    // VERIFIKASI BACA ULANG — pelajaran dari CacheService: "tidak melempar
    // error" bukan bukti bahwa datanya tersimpan.
    hasil.props = props.getProperty(IDX_PROP_AWALAN + kunci + '_n') === String(potongan.length);
    if (!hasil.props) hasil.alasanProps = 'ditulis tanpa error, tapi hilang saat dibaca ulang';

    // Buang sisa revisi/periode lama supaya kuota 500 KB tidak pelan-pelan
    // penuh. Aman: yang dihapus hanya milik indeks ini dan bukan kunci aktif.
    _bersihkanPropsLama_(props);
  } catch (e) {
    hasil.alasanProps = e.message;
  }

  // ---- Lapis 2: Cache (boleh gagal) ----
  try {
    if (b64.length <= IDX_BATAS_CACHE) {
      const cache = CacheService.getScriptCache();
      cache.put(kunci, b64, IDX_TTL_DETIK);
      hasil.cache = cache.get(kunci) !== null;
      if (!hasil.cache) hasil.alasanCache = 'ditulis tanpa error, tapi hilang saat dibaca ulang';
    } else {
      hasil.alasanCache = 'lebih besar dari batas cache';
    }
  } catch (e) {
    hasil.alasanCache = e.message;
  }

  return hasil;
}

/**
 * Membuang properti indeks dari REVISI LAMA saja.
 *
 * ⚠️ JANGAN diubah menjadi "buang semua yang bukan kunci saat ini".
 * Kunci indeks berbentuk:
 *     IDXSTORE_DBABSEN_IDX_V5_R{revisi}_{mulai}_{selesai}_{potongan}
 * Sejak periode absensi boleh lebih dari satu yang aktif (AbsencePeriod.gs),
 * SETIAP periode punya indeksnya sendiri pada revisi yang sama. Kalau
 * penyaringnya memakai kunci penuh, karyawan yang membuka periode Agustus
 * akan menghapus indeks periode Juli milik karyawan lain, lalu sebaliknya —
 * keduanya bergantian menyisir ulang sheet.
 *
 * Gejalanya sulit dikenali: dashboard cepat sesekali lalu tiba-tiba lambat
 * lagi tanpa pola, dan tidak ada error apa pun di log.
 *
 * Yang benar: pertahankan SEMUA periode pada revisi yang sedang berlaku,
 * buang hanya sisa revisi sebelumnya.
 * @private
 */
function _bersihkanPropsLama_(props) {
  try {
    const revisi = props.getProperty(KUNCI_REV_IDX_DBABSEN) || '1';
    const awalanRevisiAktif = IDX_PROP_AWALAN + KUNCI_IDX_DBABSEN + '_R' + revisi + '_';

    const semuaKunci = props.getKeys();
    const buang = [];
    for (let i = 0; i < semuaKunci.length; i++) {
      const k = semuaKunci[i];
      if (k.indexOf(IDX_PROP_AWALAN) === 0 && k.indexOf(awalanRevisiAktif) !== 0) buang.push(k);
    }
    for (let i = 0; i < buang.length; i++) props.deleteProperty(buang[i]);
    if (buang.length) console.log('Indeks dbabsen: %s properti revisi lama dibersihkan.', buang.length);
  } catch (e) {
    console.warn('Gagal membersihkan properti indeks lama: ' + e.message);
  }
}

/**
 * Membaca indeks. Cache dulu (kalau memang jalan), lalu Properties.
 * @return {Object|null} null kalau belum ada / rusak.
 * @private
 */
function _ambilIndeks_(kunci) {
  // ---- Lapis 1: cache ----
  try {
    const raw = CacheService.getScriptCache().get(kunci);
    if (raw) {
      const obj = _uraiIndeks_(raw);
      if (obj) return obj;
    }
  } catch (e) { /* cache bermasalah: lanjut ke Properties */ }

  // ---- Lapis 2: Script Properties ----
  try {
    const props = PropertiesService.getScriptProperties();
    const n = Number(props.getProperty(IDX_PROP_AWALAN + kunci + '_n') || 0);
    if (n > 0) {
      let b64 = '';
      for (let i = 0; i < n; i++) {
        const bagian = props.getProperty(IDX_PROP_AWALAN + kunci + '_' + i);
        if (bagian === null) return null; // potongan hilang -> susun ulang
        b64 += bagian;
      }
      const obj = _uraiIndeks_(b64);
      if (obj) {
        // Hangatkan cache untuk request berikutnya. Kalau gagal, abaikan —
        // Properties sudah cukup.
        try { CacheService.getScriptCache().put(kunci, b64, IDX_TTL_DETIK); } catch (e) { /* abaikan */ }
        return obj;
      }
    }
  } catch (e) {
    console.warn('Gagal membaca indeks dari Properties: ' + e.message);
  }

  return null;
}


// =======================================================
// API UTAMA
// =======================================================

/**
 * Peta agregat dbabsen per NIK.
 *
 * @return {Object} {
 *   "A0009": { hadir, telat_freq, telat_menit, sakit, alpa,
 *              no_scan_in, no_scan_out, min_ts, max_ts,
 *              alpa_by_date, hadir_by_date }, ...
 * }
 */
function getIndeksDbAbsen(periodeDiketahui) {
  const periode = periodeDiketahui || getPeriodeAbsenAktif_();
  const kunci = _kunciIndeksDbAbsen_(periode);

  const tersimpan = _ambilIndeks_(kunci);
  if (tersimpan) return tersimpan;

  return _susunIndeksDbAbsen(periode, kunci);
}

/**
 * Menyisir dbabsen sekali dan menyimpan hasilnya.
 * Dipisah dari getIndeksDbAbsen() supaya bisa dipanggil langsung oleh
 * IDX_HANGATKAN() sesudah import, tanpa menunggu ada user yang login.
 * @private
 */
function _susunIndeksDbAbsen(periodeDiketahui, kunciDiketahui) {
  const periode = periodeDiketahui || getPeriodeAbsenAktif_();
  const kunci = kunciDiketahui || _kunciIndeksDbAbsen_(periode);
  const sheetDb = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DB_ABSEN);

  // Kolom terjauh yang dipakai di bawah: index 14 (Symbol) -> 15 kolom.
  const rows = bacaSheet(sheetDb, 15);
  const idx = {};

  // ---- TAHAP 1: zona waktu diambil SEKALI, bukan per baris ----
  // Session.getScriptTimeZone() adalah panggilan layanan Apps Script,
  // bukan variabel biasa. Dulu dipanggil sampai 3x per baris.
  const tz = Session.getScriptTimeZone();

  // Memo hasil Utilities.formatDate per timestamp. Ratusan baris berbagi
  // tanggal yang sama, jadi jumlah panggilan formatDate turun dari
  // ~3 per baris menjadi ~1 per tanggal unik.
  const memoTanggal = {};
  const formatTanggal = function (ts) {
    let v = memoTanggal[ts];
    if (v === undefined) {
      v = Utilities.formatDate(new Date(ts), tz, 'yyyy-MM-dd');
      memoTanggal[ts] = v;
    }
    return v;
  };

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

    const tanggalBaris = ts === null ? '' : formatTanggal(ts);
    if (!tanggalDalamPeriode_(tanggalBaris, periode)) continue;
    // Setelah baris di atas, ts DIPASTIKAN bukan null — tanggalDalamPeriode_
    // selalu false untuk string kosong. Karena itu tanggalBaris boleh
    // dipakai ulang di bawah; dulu nilai yang sama dihitung ulang 2x
    // dengan ekspresi yang identik.

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
      e.hadir_by_date[tanggalBaris] = (e.hadir_by_date[tanggalBaris] || 0) + 1;
    }
    if (symbol === 'S') e.sakit++;
    if (symbol === 'A' || symbol === 'AC') {
      e.alpa++;
      e.alpa_by_date[tanggalBaris] = (e.alpa_by_date[tanggalBaris] || 0) + 1;
    }

    if (symbol.indexOf('T') !== -1 ||
        (telatStr && telatStr !== '00:00:00' && telatStr !== '-' && telatStr !== 'FALSE')) {
      if (symbol.indexOf('T') !== -1) e.telat_freq++;
      e.telat_menit += parseTimeToMinutes(telatStr);
    }

    if (['Si', 'TSi', 'SiPC', 'SiSo'].indexOf(symbol) !== -1) e.no_scan_in++;
    if (['So', 'TSo', 'SiSo'].indexOf(symbol) !== -1) e.no_scan_out++;
  }

  // Kegagalan menyimpan TIDAK boleh menggagalkan request — user tetap
  // mendapat angka yang benar, hanya saja request berikutnya menyisir
  // lagi. Tapi kegagalannya WAJIB kelihatan di log.
  const s = _simpanIndeks_(kunci, idx);
  if (s.props) {
    console.log('Indeks dbabsen tersimpan: %s NIK, %s byte -> %s byte (%s potongan properti). Cache: %s.',
                Object.keys(idx).length, s.byteJson, s.byteSimpan, s.potongan,
                s.cache ? 'ikut terisi' : 'tidak terpakai (' + s.alasanCache + ')');
  } else {
    console.warn('Indeks dbabsen GAGAL tersimpan di Properties (%s). ' +
                 'dbabsen akan disisir ulang di SETIAP request. Jalankan IDX_DIAGNOSA().',
                 s.alasanProps);
  }

  return idx;
}

/**
 * Membuang indeks. WAJIB dipanggil setiap kali isi dbabsen berubah —
 * saat ini di akhir handleImportDbAbsen (ImportDbAbsen.gs) dan saat
 * periode absensi diganti (AbsencePeriod.gs).
 *
 * Cara kerjanya menaikkan nomor revisi, sehingga seluruh kunci lama
 * langsung tidak terpakai. Properti sisanya dibersihkan pada penulisan
 * berikutnya oleh _bersihkanPropsLama_.
 */
function bersihkanIndeksDbAbsen() {
  try {
    const props = PropertiesService.getScriptProperties();
    const revisiLama = Number(props.getProperty(KUNCI_REV_IDX_DBABSEN) || 1);
    props.setProperty(KUNCI_REV_IDX_DBABSEN, String(revisiLama + 1));
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
  const idx = _susunIndeksDbAbsen(periode, _kunciIndeksDbAbsen_(periode));
  const durasi = new Date().getTime() - t0;
  Logger.log('Indeks dbabsen disusun ulang: %s NIK dalam %s ms', Object.keys(idx).length, durasi);
  return idx;
}


// =======================================================
// DIAGNOSTIK — read-only terhadap data, jalankan dari editor
// =======================================================

/**
 * Memastikan indeks benar-benar bekerja, dan menyebutkan penyebabnya
 * kalau tidak.
 */
function IDX_UJI() {
  bersihkanIndeksDbAbsen();

  const periode = getPeriodeAbsenAktif_();
  const kunci = _kunciIndeksDbAbsen_(periode);

  // --- Dingin: wajib menyisir sheet ---
  let t0 = new Date().getTime();
  const idx = _susunIndeksDbAbsen(periode, kunci);
  const dingin = new Date().getTime() - t0;

  // --- Benar-benar tersimpan? ---
  const tersimpan = _ambilIndeks_(kunci);

  // --- Panas: harus dari simpanan ---
  t0 = new Date().getTime();
  const idxPanas = getIndeksDbAbsen(periode);
  const panas = new Date().getTime() - t0;

  const json = JSON.stringify(idx);
  const b64 = _kompresIndeks_(json);

  Logger.log('=========== HASIL UJI INDEKS dbabsen ===========');
  Logger.log('Jumlah NIK          : %s', Object.keys(idx).length);
  Logger.log('Ukuran JSON         : %s byte', json.length);
  Logger.log('Setelah dikompres   : %s byte (%s%% dari asli)',
             b64.length, Math.round((b64.length / json.length) * 100));
  Logger.log('Potongan properti   : %s (batas %s byte per potongan)',
             Math.ceil(b64.length / IDX_PROP_POTONGAN), IDX_PROP_POTONGAN);
  Logger.log('');
  Logger.log('Dingin (scan sheet) : %s ms', dingin);
  Logger.log('Panas  (tersimpan)  : %s ms', panas);
  Logger.log('');

  if (!tersimpan) {
    Logger.log('>>> GAGAL: indeks tidak tersimpan. Jalankan IDX_DIAGNOSA().');
  } else if (Object.keys(tersimpan).length !== Object.keys(idx).length) {
    Logger.log('>>> GAGAL: isi simpanan tidak utuh (%s NIK, seharusnya %s).',
               Object.keys(tersimpan).length, Object.keys(idx).length);
  } else if (panas > dingin / 5) {
    Logger.log('>>> MENCURIGAKAN: tersimpan, tapi "panas" tidak jauh lebih cepat.');
    Logger.log('    Seharusnya di bawah %s ms.', Math.round(dingin / 5));
  } else {
    Logger.log('>>> BERHASIL: login tidak lagi menyisir dbabsen.');
    Logger.log('    Simpanan di Script Properties TIDAK kedaluwarsa, jadi');
    Logger.log('    scan dingin hanya terjadi saat dbabsen benar-benar berubah.');
  }

  return { dingin: dingin, panas: panas, tersimpan: !!tersimpan, nik: Object.keys(idxPanas).length };
}

/**
 * Menguji lapisan penyimpanan SENDIRIAN, tanpa menyentuh sheet.
 *
 * Dipakai untuk memisahkan "penyimpanannya yang bermasalah" dari
 * "kodenya yang bermasalah", dan untuk menemukan di dimensi mana
 * CacheService gagal — ukuran, panjang kunci, TTL, atau memang mati
 * seluruhnya. Tidak mengubah data aplikasi apa pun; semua kunci uji
 * dihapus lagi setelah diperiksa.
 */
function IDX_DIAGNOSA() {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  const periode = getPeriodeAbsenAktif_();
  const kunciAsli = _kunciIndeksDbAbsen_(periode);

  const coba = function (label, kunci, nilai, ttl) {
    try {
      cache.put(kunci, nilai, ttl);
      const balik = cache.get(kunci);
      cache.remove(kunci);
      if (balik === null) return label + ' -> HILANG (put tidak error, get null)';
      if (balik.length !== nilai.length) return label + ' -> RUSAK (' + balik.length + '/' + nilai.length + ' byte)';
      return label + ' -> OK';
    } catch (e) {
      return label + ' -> ERROR: ' + e.message;
    }
  };

  const isi = function (n) { return new Array(n + 1).join('x'); };

  Logger.log('=========== DIAGNOSA PENYIMPANAN ===========');
  Logger.log('Kunci asli yang dipakai indeks:');
  Logger.log('  "%s" (%s karakter)', kunciAsli, kunciAsli.length);
  Logger.log('');

  Logger.log('--- A. CacheService, variasi UKURAN (kunci pendek, TTL 60) ---');
  [10, 1024, 5 * 1024, 10 * 1024, 50 * 1024, 100 * 1024].forEach(function (n) {
    Logger.log('  ' + coba(n + ' byte', 'DIAG_A_' + n, isi(n), 60));
  });

  Logger.log('');
  Logger.log('--- B. CacheService, variasi TTL (5 KB) ---');
  [60, 600, 3600, 21600].forEach(function (t) {
    Logger.log('  ' + coba('TTL ' + t + ' detik', 'DIAG_B_' + t, isi(5 * 1024), t));
  });

  Logger.log('');
  Logger.log('--- C. CacheService dengan KUNCI ASLI ---');
  Logger.log('  ' + coba('kunci asli + 5 KB', kunciAsli + '_DIAG', isi(5 * 1024), IDX_TTL_DETIK));

  Logger.log('');
  Logger.log('--- D. Jenis cache lain ---');
  ['UserCache', 'DocumentCache'].forEach(function (jenis) {
    try {
      const c = jenis === 'UserCache' ? CacheService.getUserCache() : CacheService.getDocumentCache();
      if (!c) { Logger.log('  %s -> tidak tersedia di konteks ini', jenis); return; }
      c.put('DIAG_D', isi(5 * 1024), 60);
      const balik = c.get('DIAG_D');
      c.remove('DIAG_D');
      Logger.log('  %s -> %s', jenis, balik === null ? 'HILANG' : 'OK');
    } catch (e) {
      Logger.log('  %s -> ERROR: %s', jenis, e.message);
    }
  });

  Logger.log('');
  Logger.log('--- E. PropertiesService (sumber kebenaran sekarang) ---');
  try {
    const nilai = isi(5 * 1024);
    props.setProperty('DIAG_E', nilai);
    const balik = props.getProperty('DIAG_E');
    props.deleteProperty('DIAG_E');
    Logger.log('  tulis+baca 5 KB -> %s',
               balik === null ? 'HILANG' : (balik.length === nilai.length ? 'OK' : 'RUSAK'));
  } catch (e) {
    Logger.log('  ERROR: %s', e.message);
  }
  try {
    const semua = props.getKeys();
    let dipakai = 0;
    const isiSemua = props.getProperties();
    Object.keys(isiSemua).forEach(function (k) { dipakai += k.length + String(isiSemua[k]).length; });
    Logger.log('  jumlah properti tersimpan : %s', semua.length);
    Logger.log('  perkiraan pemakaian       : %s byte dari ~512000', dipakai);
  } catch (e) {
    Logger.log('  gagal menghitung pemakaian: %s', e.message);
  }

  Logger.log('');
  Logger.log('--- F. gzip + base64 bolak-balik ---');
  try {
    const contoh = JSON.stringify({ a: 1, b: 'halo', c: [1, 2, 3] });
    Logger.log('  %s', _dekompresIndeks_(_kompresIndeks_(contoh)) === contoh ? 'OK' : 'GAGAL');
  } catch (e) {
    Logger.log('  ERROR: %s', e.message);
  }

  Logger.log('');
  Logger.log('CARA MEMBACA:');
  Logger.log('  Kalau bagian E "OK" -> aplikasi aman, indeks tersimpan di Properties.');
  Logger.log('  Bagian A-D hanya untuk mengetahui kenapa CacheService bermasalah;');
  Logger.log('  semuanya boleh gagal tanpa mempengaruhi kecepatan aplikasi.');
}
