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
    try {
      const parsed = JSON.parse(hit);
      // Lihat _simpanIndeksTerpecah_ di bawah: kalau indeksnya lebih besar
      // dari 100 KB (batas CacheService per kunci), yang disimpan di sini
      // bukan indeksnya langsung, tapi MANIFEST yang menunjuk ke beberapa
      // kunci "potongan". Rakit ulang; kalau ada potongan yang hilang
      // (kadaluarsa tidak bersamaan, dsb), jatuh ke penyisiran ulang.
      if (parsed && parsed.__chunked) {
        const gabungan = _gabungkanChunkIndeks_(cache, kunci, parsed.n);
        if (gabungan) return gabungan;
      } else {
        return parsed;
      }
    } catch (e) { /* cache rusak, susun ulang */ }
  }
  return _susunIndeksDbAbsen(cache, periode, kunci);
}

/**
 * Rakit ulang indeks dari kunci-kunci potongan yang disimpan
 * _simpanIndeksTerpecah_. @return {Object|null} null kalau ada potongan
 * yang hilang/rusak — pemanggil harus menyisir ulang dari sheet.
 * @private
 */
function _gabungkanChunkIndeks_(cache, kunciUtama, jumlahChunk) {
  const gabungan = {};
  for (let i = 0; i < jumlahChunk; i++) {
    const kunciC = kunciUtama + '::c' + i;
    const raw = cache.get(kunciC);
    if (!raw) return null; // potongan hilang -> caller susun ulang dari sheet
    try {
      Object.assign(gabungan, JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }
  return gabungan;
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
  //
  // TERUKUR 19 Agu 2026: sejak V3 menambah alpa_by_date/hadir_by_date per
  // NIK, indeksnya melewati batas 100 KB per kunci CacheService (212 NIK ->
  // 109.536 byte). put() yang kebesaran gagal DIAM-DIAM, jadi cache TIDAK
  // PERNAH aktif — get_stats (dan hitungStats saat login) balik menyisir
  // 6.700+ baris dbabsen di SETIAP request, persis kondisi sebelum indeks
  // ini dibuat. Ini penyebab utama login/dashboard terasa lambat.
  //
  // Perbaikannya BUKAN mengurangi data (supaya angka yang tampil tidak
  // berubah), tapi memecah satu indeks besar jadi beberapa kunci cache
  // yang masing-masing di bawah batas — lihat _simpanIndeksTerpecah_.
  try {
    const payload = JSON.stringify(idx);
    if (payload.length > IDX_BATAS_BYTE) {
      _simpanIndeksTerpecah_(cache, kunci, idx);
    } else {
      cache.put(kunci, payload, IDX_TTL_DETIK);
    }
  } catch (e) {
    console.warn('Indeks dbabsen gagal di-cache: ' + e.message);
  }

  return idx;
}

/**
 * Simpan indeks yang kebesaran (>100 KB) sebagai beberapa kunci cache
 * terpisah (masing-masing di bawah batas), plus satu kunci "manifest" yang
 * menyebutkan jumlah potongan. getIndeksDbAbsen() merakitnya kembali lewat
 * _gabungkanChunkIndeks_.
 *
 * Dipecah PER NIK (bukan dipotong di tengah), supaya data satu orang tidak
 * pernah terbelah dua kunci — menyederhanakan penggabungan dan mencegah
 * data setengah-tersimpan.
 * @private
 */
function _simpanIndeksTerpecah_(cache, kunciUtama, idx) {
  // Target di bawah IDX_BATAS_BYTE dengan margin, supaya variasi ukuran
  // antar-NIK dan overhead penggabungan tidak membuat satu chunk kebablasan
  // melewati batas 100 KB yang sesungguhnya.
  const TARGET_CHUNK_BYTE = 80 * 1024;

  const niks = Object.keys(idx);
  const chunks = [];
  let chunkSekarang = {};
  let ukuranSekarang = 2; // "{}"

  niks.forEach((nik) => {
    const entriJson = JSON.stringify(idx[nik]);
    const perkiraanTambahan = entriJson.length + nik.length + 4; // `"NIK":` + koma
    if (ukuranSekarang + perkiraanTambahan > TARGET_CHUNK_BYTE && Object.keys(chunkSekarang).length > 0) {
      chunks.push(chunkSekarang);
      chunkSekarang = {};
      ukuranSekarang = 2;
    }
    chunkSekarang[nik] = idx[nik];
    ukuranSekarang += perkiraanTambahan;
  });
  if (Object.keys(chunkSekarang).length > 0) chunks.push(chunkSekarang);

  const kunciChunk = chunks.map((_, i) => kunciUtama + '::c' + i);
  const payloadChunk = chunks.map((c) => JSON.stringify(c));

  // Kalau ADA satu saja potongan yang masih melewati batas (mustahil dalam
  // praktiknya kecuali satu NIK sendirian punya riwayat raksasa), batalkan
  // semuanya — jangan simpan manifest yang menunjuk ke potongan yang gagal.
  for (let i = 0; i < payloadChunk.length; i++) {
    if (payloadChunk[i].length > IDX_BATAS_BYTE) {
      console.warn('Indeks dbabsen: potongan #%s (%s NIK) masih %s byte, melewati batas %s. ' +
                   'Cache dilewati untuk periode ini — get_stats menyisir sheet tiap request.',
                   i, Object.keys(chunks[i]).length, payloadChunk[i].length, IDX_BATAS_BYTE);
      return;
    }
  }

  // Simpan per potongan kunci secara individual dengan cache.put().
  // PENTING: Jangan gunakan cache.putAll() karena di Apps Script putAll()
  // membatasi total kumulatif seluruh entri map maksimal 100 KB.
  for (let i = 0; i < kunciChunk.length; i++) {
    cache.put(kunciChunk[i], payloadChunk[i], IDX_TTL_DETIK);
  }

  // Manifest disimpan TERAKHIR, setelah semua potongan berhasil ditulis —
  // supaya tidak ada jendela waktu di mana manifest sudah ada tapi
  // potongannya belum, yang bisa membuat pembaca lain gagal merakit.
  cache.put(kunciUtama, JSON.stringify({ __chunked: true, n: chunks.length }), IDX_TTL_DETIK);

  console.log('Indeks dbabsen %s byte dipecah jadi %s potongan (target %s byte/potongan).',
              JSON.stringify(idx).length, chunks.length, TARGET_CHUNK_BYTE);
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
