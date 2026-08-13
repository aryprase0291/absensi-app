// =======================================================
// IMPORT SHEET dbabsen DARI FILE EXCEL MESIN ABSEN
// File: ImportDbAbsen.gs
//
// LATAR BELAKANG
// --------------
// Sebelum ini `dbabsen` diisi formula (IMPORTRANGE/QUERY). Akibatnya
// setiap `getDataRange().getValues()` memaksa Sheets menghitung ulang
// seluruh formula — ini penyebab utama lambatnya login (lihat
// DIAGNOSA-LAMBAT.md). Dengan import, isi `dbabsen` menjadi NILAI STATIS
// sehingga pembacaan jauh lebih murah.
//
// KONSEKUENSI YANG HARUS DISADARI
// --------------------------------
// Commit menimpa kolom A:S. Formula apa pun yang masih ada di area itu
// AKAN HILANG. Ini memang tujuannya, tapi pastikan Anda sadar sebelum
// import pertama. Kolom T (timestamp) tidak disentuh kecuali T1.
//
// Setelah import dipakai rutin, trigger waktu `checkFormulaUpdates()`
// tidak lagi berguna dan sebaiknya dihapus dari Trigger — fungsinya
// hanya mendeteksi perubahan hasil formula.
//
// PEMETAAN KOLOM
// --------------
// File mesin punya 18 kolom, `dbabsen` punya 19 kolom (A:S) dengan
// kolom A kosong. Jadi kolom ke-N file  ->  kolom ke-(N+1) dbabsen.
//
//   file mesin              dbabsen   dibaca oleh Code.gs sebagai
//   ---------------------   -------   --------------------------
//   (tidak ada)             A         -
//   1  No.Akun              B         -
//   2  NIK.                 C         row[2]  kunci pencocokan user
//   3  Nama                 D         row[3]
//   4  Tanggal              E         row[4]
//   5  Jam Kerja (shift)    F         row[5]  dipecah jadi shiftStart/End
//   6  Mulai Tugas          G         -
//   7  Akhir Tugas          H         -
//   8  Masuk                I         row[8]
//   9  Pulang               J         row[9]
//   10 Telat                K         row[10]
//   11 Pulang Awal          L         -
//   12 Bolos                M         -
//   13 Jam Kerja (durasi)   N         -
//   14 Symbol               O         row[14]
//   15 Departemen           P         -
//   16 ATT_Time            Q         -
//   17 Waktu Scan           R         row[17]
//   18 week                 S         row[18]
//
// PROTOKOL UPLOAD
// ---------------
// Payload Apps Script dibatasi, jadi klien mengirim data per potongan:
//
//   { action:'import_db_absen', sessionId, chunkIndex, totalChunks,
//     mode:'upsert'|'replace', rows:[ [18 kolom], ... ] }
//
// Potongan ditumpuk lebih dulu di sheet sementara `_import_dbabsen_tmp`.
// Baru pada potongan terakhir isinya dipindah ke `dbabsen`. Kalau upload
// putus di tengah jalan, `dbabsen` sama sekali tidak tersentuh.
// =======================================================

const IMPORT_TMP_SHEET = '_import_dbabsen_tmp';
const IMPORT_PROP_PREFIX = 'IMPORT_DBABSEN_';

const DBABSEN_TOTAL_COLS = 19;   // A..S
const IMPORT_SRC_COLS = 18;      // jumlah kolom file mesin
const IMPORT_COL_OFFSET = 1;     // kolom A dbabsen dibiarkan kosong

const IMPORT_IDX_NIK = 2;        // kolom C
const IMPORT_IDX_TANGGAL = 4;    // kolom E

// Batas wajar supaya satu sheet tidak meledak karena file salah.
const IMPORT_MAX_ROWS = 60000;


// =======================================================
// HANDLER UTAMA
// =======================================================

function handleImportDbAbsen(data) {
  const sessionId = String(data.sessionId || '').trim();
  const chunkIndex = Number(data.chunkIndex);
  const totalChunks = Number(data.totalChunks);
  const rows = Array.isArray(data.rows) ? data.rows : [];

  if (!sessionId) {
    return responseJSON({ result: 'error', message: 'sessionId kosong.' });
  }
  if (!isFinite(chunkIndex) || !isFinite(totalChunks) || totalChunks < 1 ||
      chunkIndex < 0 || chunkIndex >= totalChunks) {
    return responseJSON({ result: 'error', message: 'Nomor potongan tidak valid.' });
  }

  // Kunci skrip: mencegah dua admin mengimpor bersamaan, yang bisa
  // mencampur isi sheet sementara menjadi data campur aduk.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return responseJSON({
      result: 'error',
      message: 'Ada proses import lain yang sedang berjalan. Coba lagi sebentar.'
    });
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const propKey = IMPORT_PROP_PREFIX + sessionId;

    if (chunkIndex === 0) {
      const mode = (data.mode === 'replace') ? 'replace' : 'upsert';
      props.setProperty(propKey, JSON.stringify({
        mode: mode,
        totalChunks: totalChunks,
        mulai: new Date().getTime()
      }));
    }

    const stateRaw = props.getProperty(propKey);
    if (!stateRaw) {
      return responseJSON({
        result: 'error',
        code: 'SESI_IMPORT_HILANG',
        message: 'Sesi import tidak dikenal atau sudah kedaluwarsa. Ulangi dari awal.'
      });
    }
    const state = JSON.parse(stateRaw);

    const tmp = _importSiapkanSheetSementara(chunkIndex === 0);

    if (rows.length > 0) {
      const terpakai = tmp.getLastRow();
      if (terpakai + rows.length > IMPORT_MAX_ROWS) {
        _importBersihkan(propKey);
        return responseJSON({
          result: 'error',
          message: 'Data melebihi batas ' + IMPORT_MAX_ROWS + ' baris. Import per periode saja.'
        });
      }
      const mapped = rows.map(_importPetakanBaris);
      tmp.getRange(terpakai + 1, 1, mapped.length, DBABSEN_TOTAL_COLS).setValues(mapped);
    }

    // Belum potongan terakhir — cukup laporkan progres.
    if (chunkIndex < totalChunks - 1) {
      return responseJSON({
        result: 'success',
        stage: 'chunk',
        chunkIndex: chunkIndex,
        tertampung: tmp.getLastRow()
      });
    }

    // Potongan terakhir — pindahkan ke dbabsen.
    const hasil = _importCommit(tmp, state.mode);
    _importBersihkan(propKey);

    return responseJSON({
      result: 'success',
      stage: 'done',
      mode: state.mode,
      barisBaru: hasil.barisBaru,
      barisDitimpa: hasil.barisDitimpa,
      barisDipertahankan: hasil.barisDipertahankan,
      totalBaris: hasil.totalBaris,
      lastUpdate: hasil.lastUpdate
    });

  } catch (e) {
    return responseJSON({ result: 'error', message: 'Import gagal: ' + e.toString() });
  } finally {
    lock.releaseLock();
  }
}


// =======================================================
// SHEET SEMENTARA
// =======================================================

function _importSiapkanSheetSementara(reset) {
  let sh = SS.getSheetByName(IMPORT_TMP_SHEET);

  if (sh && reset) {
    SS.deleteSheet(sh);
    sh = null;
  }
  if (!sh) {
    sh = SS.insertSheet(IMPORT_TMP_SHEET);
    sh.hideSheet();
    _importSetFormatKolom(sh, 1, sh.getMaxRows());
  }
  return sh;
}

/**
 * Sheets menafsirkan string "08:06" sebagai NILAI JAM begitu ditulis
 * lewat setValues — persis seperti diketik manual di sel. Isinya jadi
 * angka serial (0.3375), dan karena format kolom dbabsen adalah tanggal,
 * yang tampil di layar adalah "30/12/1899".
 *
 * Sebelum formula IMPORTRANGE diganti, kolom-kolom ini berisi TEKS, dan
 * handleGetDbAbsen() di Code.gs meneruskan row[8]/row[9]/row[10]/row[17]
 * apa adanya ke frontend. Jadi teks memang bentuk yang benar — kalau
 * dibiarkan jadi Date, frontend menerima "1899-12-30T01:06:00.000Z".
 *
 * Karena itu seluruh kolom dipaksa teks, KECUALI kolom Tanggal yang
 * harus tetap objek Date supaya formatDateYMD_Strict() bekerja.
 */
function _importSetFormatKolom(sheet, barisAwal, jumlahBaris) {
  if (jumlahBaris < 1) return;
  sheet.getRange(barisAwal, 1, jumlahBaris, DBABSEN_TOTAL_COLS)
       .setNumberFormat('@');
  sheet.getRange(barisAwal, IMPORT_IDX_TANGGAL + 1, jumlahBaris, 1)
       .setNumberFormat('dd/MM/yyyy');
}

/**
 * Mengembalikan sel yang terlanjur jadi Date menjadi teks "HH:mm".
 *
 * Dipakai untuk SELURUH baris yang akan ditulis — termasuk baris lama
 * yang dipertahankan pada mode upsert — sehingga satu kali import ulang
 * cukup untuk merapikan sheet yang sudah terlanjur rusak.
 */
function _importNormalisasiJam(rows) {
  const tz = Session.getScriptTimeZone();

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (c === IMPORT_IDX_TANGGAL) continue;

      const v = row[c];
      if (Object.prototype.toString.call(v) !== '[object Date]') continue;
      if (isNaN(v.getTime())) { row[c] = ''; continue; }

      // Nilai jam murni berpangkal di 30/12/1899 (serial 0).
      row[c] = (v.getFullYear() <= 1900)
        ? Utilities.formatDate(v, tz, 'HH:mm')
        : Utilities.formatDate(v, tz, 'dd/MM/yyyy HH:mm');
    }
  }
  return rows;
}

function _importBersihkan(propKey) {
  try { PropertiesService.getScriptProperties().deleteProperty(propKey); } catch (e) {}
  try {
    const sh = SS.getSheetByName(IMPORT_TMP_SHEET);
    if (sh) SS.deleteSheet(sh);
  } catch (e) {}
}

/**
 * Dijalankan manual dari editor kalau ada sisa sheet sementara
 * gara-gara import yang putus di tengah.
 */
function IMPORT_BERSIHKAN_SISA() {
  const props = PropertiesService.getScriptProperties();
  const semua = props.getProperties();
  let n = 0;
  Object.keys(semua).forEach(function (k) {
    if (k.indexOf(IMPORT_PROP_PREFIX) === 0) { props.deleteProperty(k); n++; }
  });
  const sh = SS.getSheetByName(IMPORT_TMP_SHEET);
  if (sh) SS.deleteSheet(sh);
  Logger.log('Dibersihkan: %s sesi tertunda, sheet sementara %s.',
             n, sh ? 'dihapus' : 'tidak ada');
}


// =======================================================
// PEMETAAN & NORMALISASI BARIS
// =======================================================

/**
 * 18 kolom file mesin -> 19 kolom dbabsen (geser satu ke kanan).
 * Kolom tanggal dijadikan objek Date supaya formatDateYMD_Strict()
 * dan kawan-kawannya membacanya dengan benar.
 */
function _importPetakanBaris(src) {
  const out = new Array(DBABSEN_TOTAL_COLS).fill('');
  const n = Math.min(IMPORT_SRC_COLS, src ? src.length : 0);

  for (let i = 0; i < n; i++) {
    const target = i + IMPORT_COL_OFFSET;
    if (target >= DBABSEN_TOTAL_COLS) break;
    const v = src[i];
    out[target] = (v === null || v === undefined) ? '' : v;
  }

  out[IMPORT_IDX_NIK] = String(out[IMPORT_IDX_NIK] || '').trim();
  out[IMPORT_IDX_TANGGAL] = _importParseYMD(out[IMPORT_IDX_TANGGAL]) || '';

  return out;
}

/**
 * Klien selalu mengirim tanggal dalam format 'YYYY-MM-DD'. Parsing
 * dilakukan per komponen, BUKAN new Date(string), karena
 * new Date('2026-08-05') diperlakukan sebagai UTC dan di zona
 * Asia/Jakarta bisa mundur satu hari.
 */
function _importParseYMD(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : v;
  }
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function _importKunci(row) {
  const nik = String(row[IMPORT_IDX_NIK] || '').trim();
  if (!nik) return '';
  const ymd = formatDateYMD_Strict(row[IMPORT_IDX_TANGGAL]);
  if (!ymd) return '';
  return nik + '|' + ymd;
}

function _importBarisKosong(row) {
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
  }
  return true;
}


// =======================================================
// COMMIT KE dbabsen
// =======================================================

/**
 * mode 'replace' : seluruh A2:S dibuang, diganti isi file.
 * mode 'upsert'  : baris lama yang punya kombinasi NIK+tanggal sama
 *                  dengan file baru dibuang; sisanya dipertahankan.
 *                  Ini yang dipakai kalau Anda mengimpor per periode.
 */
function _importCommit(tmp, mode) {
  const db = SS.getSheetByName(SHEET_DB_ABSEN);
  if (!db) throw new Error('Sheet "' + SHEET_DB_ABSEN + '" tidak ditemukan.');

  const nBaru = tmp.getLastRow();
  if (nBaru < 1) throw new Error('Tidak ada baris yang bisa diimpor.');

  const baru = tmp.getRange(1, 1, nBaru, DBABSEN_TOTAL_COLS).getValues();

  let final = baru;
  let barisDitimpa = 0;
  let barisDipertahankan = 0;

  if (mode === 'upsert') {
    const lastRow = db.getLastRow();
    const lama = (lastRow > 1)
      ? db.getRange(2, 1, lastRow - 1, DBABSEN_TOTAL_COLS).getValues()
      : [];

    const kunciBaru = {};
    for (let i = 0; i < baru.length; i++) {
      const k = _importKunci(baru[i]);
      if (k) kunciBaru[k] = true;
    }

    const sisa = [];
    for (let i = 0; i < lama.length; i++) {
      const row = lama[i];
      if (_importBarisKosong(row)) continue;
      const k = _importKunci(row);
      if (k && kunciBaru[k]) { barisDitimpa++; continue; }
      sisa.push(row);
    }

    barisDipertahankan = sisa.length;
    final = sisa.concat(baru);
  }

  // Urutkan NIK lalu tanggal supaya sheet enak dibaca manusia dan
  // hasilnya deterministik antar import.
  final.sort(function (a, b) {
    const na = String(a[IMPORT_IDX_NIK] || '');
    const nb = String(b[IMPORT_IDX_NIK] || '');
    if (na !== nb) return na < nb ? -1 : 1;
    const da = formatDateYMD_Strict(a[IMPORT_IDX_TANGGAL]);
    const dbb = formatDateYMD_Strict(b[IMPORT_IDX_TANGGAL]);
    if (da === dbb) return 0;
    return da < dbb ? -1 : 1;
  });

  // Kosongkan area lama (A2:S) lalu tulis sekali jalan.
  const lastRowSekarang = db.getLastRow();
  if (lastRowSekarang > 1) {
    db.getRange(2, 1, lastRowSekarang - 1, DBABSEN_TOTAL_COLS).clearContent();
  }

  // Pastikan sheet cukup panjang sebelum setValues.
  const butuhBaris = final.length + 1;
  if (db.getMaxRows() < butuhBaris) {
    db.insertRowsAfter(db.getMaxRows(), butuhBaris - db.getMaxRows());
  }

  if (final.length > 0) {
    // Urutannya penting: format teks HARUS dipasang sebelum setValues,
    // karena penafsiran "08:06" -> nilai jam terjadi saat penulisan.
    _importNormalisasiJam(final);
    _importSetFormatKolom(db, 2, final.length);
    db.getRange(2, 1, final.length, DBABSEN_TOTAL_COLS).setValues(final);
  }

  // --- PANGKAS BARIS MENGANGGUR (Agu 2026) ---
  // clearContent() di atas menghapus ISI, bukan barisnya, dan
  // insertRowsAfter() hanya bisa menambah. Tanpa pemangkasan ini sheet
  // hanya bisa memanjang: pengukuran 12 Agu 2026 menemukan dbabsen punya
  // 66.946 baris untuk 6.720 baris data — 60.226 baris kosong yang tetap
  // ikut terformat dan memperlambat setiap operasi pada sheet.
  //
  // Disisakan 200 baris kosong sebagai ruang gerak agar import berikutnya
  // tidak selalu perlu insertRowsAfter().
  const SISA_BUFFER = 200;
  const barisTerpakai = final.length + 1;             // + header
  const batasSimpan = barisTerpakai + SISA_BUFFER;
  if (db.getMaxRows() > batasSimpan) {
    db.deleteRows(batasSimpan + 1, db.getMaxRows() - batasSimpan);
  }

  const sekarang = new Date();
  db.getRange('T1').setValue(sekarang);
  SpreadsheetApp.flush();

  // --- INVALIDASI INDEKS STATISTIK (Agu 2026) ---
  // Statistik dashboard tidak lagi menyisir dbabsen per request; ia
  // memakai indeks agregat per NIK yang di-cache (StatsIndex.gs).
  // Import adalah SATU-SATUNYA momen isi dbabsen berubah, jadi di sinilah
  // indeks lama harus dibuang. Kalau baris ini hilang, dashboard akan
  // menampilkan angka periode SEBELUMNYA sampai TTL 6 jam habis.
  //
  // Langsung disusun ulang di sini (bukan menunggu user pertama) supaya
  // biaya scan ditanggung proses import, bukan orang yang login duluan.
  // Dibungkus try: gagal menyusun indeks tidak boleh menggagalkan import
  // yang datanya sudah tertulis — paling buruk request berikutnya yang
  // menyusunnya.
  try {
    bersihkanIndeksDbAbsen();
    IDX_HANGATKAN();
  } catch (e) {
    console.warn('Indeks dbabsen gagal disegarkan setelah import: ' + e.message);
  }

  // Hash disamakan supaya checkFormulaUpdates() (kalau triggernya masih
  // terpasang) tidak langsung menimpa T1 pada eksekusi berikutnya.
  try {
    const payload = JSON.stringify(final);
    const sig = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload);
    PropertiesService.getScriptProperties()
      .setProperty('LAST_DB_HASH', Utilities.base64Encode(sig));
  } catch (e) { /* bukan kegagalan fatal */ }

  return {
    barisBaru: baru.length,
    barisDitimpa: barisDitimpa,
    barisDipertahankan: barisDipertahankan,
    totalBaris: final.length,
    lastUpdate: sekarang.toISOString()
  };
}
