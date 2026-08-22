// =======================================================
// BOARD ABSENSI — File: BoardAbsensi.gs
//
// DIPASANG DI SPREADSHEET TUJUAN: BOARD_ABSENSI_2026
//   https://docs.google.com/spreadsheets/d/1djRP-SZSMST5x1W_fZgViQdiMp1qUyFkDLFRAe3ekEM
//
// Menyusun sheet rekap bulanan mengikuti template ABSEN_JUL_2026, dengan
// data diambil dari sheet DB_FIX di spreadsheet DATABASE ABSENSI.
//
// KENAPA BUKAN IMPORTRANGE
//   Template ini bukan salinan tabel — datanya diputar (satu baris per
//   karyawan, satu kolom per tanggal) dan diberi kolom hitung di kanan.
//   IMPORTRANGE tidak bisa memutar data. Selain itu proyek ini sudah
//   pernah kena masalahnya: lihat DIAGNOSA-LAMBAT.md — kolom berisi
//   IMPORTRANGE membuat setiap pembacaan sheet memaksa perhitungan ulang,
//   dan itulah yang dulu membuat login lambat. Skrip menulis NILAI biasa,
//   jadi sheet ini ringan dibuka.
//
// AUTO-UPDATE
//   Jalankan BOARD_PASANG_TRIGGER() sekali. Setelah itu sheet disusun
//   ulang tiap jam. Bisa juga diperbarui manual lewat menu "Board Absensi"
//   yang muncul di bilah menu spreadsheet.
// =======================================================

const BOARD_SUMBER_ID = '1tjeanu9Gug11HYkdsFlDj2tqF_ICQjqAfqv9NPPZF_I'; // DATABASE ABSENSI
const BOARD_SUMBER_SHEET = 'DB_FIX';

// Periode mengikuti siklus 21 s/d 20, sama seperti aplikasi absensi.
const BOARD_TGL_MULAI_SIKLUS = 21;

// Kolom hitung di kanan, disalin dari template (CG:CK).
const BOARD_KODE_HITUNG = [
  { kode: 'A',  label: 'A'  },
  { kode: 'C',  label: 'C'  },
  { kode: 'EO', label: 'EO' },
  { kode: 'O',  label: 'O'  },
  { kode: 'S',  label: 'S'  }
];

// Nama kolom DB_FIX dikenali dari KATA KUNCI, bukan posisi.
// Alasannya: kolom di DB_FIX bisa digeser/disisipi kapan saja, dan
// mengunci ke nomor kolom membuat rekap diam-diam salah kolom tanpa
// error apa pun. Kalau nama kolomnya berbeda, tambahkan kata kuncinya
// di sini — jangan mengubah kode di bawah.
// Disesuaikan 21 Agu 2026 dengan header DB_FIX yang sebenarnya:
//   A NO AKUN | B PAYROLL | C NAMA | D TANGGAL | E JAM KERJA | F M. TUGAS
//   G A: TUGAS | H MASUK | I PULANG | J TELAT | K P. AWAL | L BOLOS
//   M TJK | N ID2 | O DEPARTEMEN | P ATT_TIME | Q WAKTU SCAN | R WEEK | S NOMINAL
//
// Kolom simbol absensi bernama **ID2** (berisi H, So, T, A, O, C, ...).
// Namanya sama sekali tidak menyiratkan itu, jadi jangan diubah tanpa
// memeriksa isinya lagi lewat BOARD_CEK_SUMBER().
const BOARD_PETA_KOLOM = {
  payroll:  ['payroll', 'nik', 'no payroll'],
  nama:     ['nama'],
  tanggal:  ['tanggal', 'date'],
  simbol:   ['id2', 'symbol', 'simbol', 'kode'],
  telat:    ['telat', 'terlambat', 'late'],
  pt:       ['departemen', 'pt', 'perusahaan'],
  jabatan:  ['jabatan', 'posisi'],
  atasan:   ['atasan', 'supervisor'],
  hrd:      ['hrd'],
  tglMasuk: ['tgl masuk', 'tanggal masuk', 'join']
};

// DB_FIX tidak memuat JABATAN, ATASAN, HRD, maupun TGL MASUK — keempatnya
// ada di daftar induk karyawan pada tab lain di spreadsheet yang sama.
// Isi nama tabnya di sini untuk mengisi kolom-kolom itu; kalau dikosongkan,
// kolomnya tetap ada di board tapi dibiarkan kosong.
const BOARD_MASTER_SHEET = 'PEGAWAI AKTIF';

// Kalau pengenalan otomatis salah kolom, isi huruf kolomnya di sini dan
// pengenalan otomatis untuk kolom itu dilewati.
//
// PERLU untuk tab seperti MASTER, yang memuat TIGA daftar berdampingan
// dalam satu baris header (ada dua kolom PAYROLL dan dua NAMA). Pengenalan
// berdasarkan nama akan mengambil kolom PAYROLL dari blok pertama tapi
// JABATAN dari blok kedua — barisnya jadi milik orang yang berbeda, dan
// tidak ada error apa pun yang menandainya. Contoh isi: { payroll: 'G',
// hrd: 'H', nama: 'I', pt: 'J', tglMasuk: 'K', jabatan: 'L', atasan: 'M' }
const BOARD_MASTER_KOLOM = {};

// Hanya untuk BOARD_CEK_TAB(): tab mana yang mau diintip headernya.
// Dipisah dari BOARD_MASTER_SHEET supaya bisa memeriksa tab lain tanpa
// mengubah konfigurasi yang sedang dipakai membangun board.
const BOARD_TAB_DIPERIKSA = 'MASTER';


// =======================================================
// MENU
// =======================================================

// ⚠️ FILE INI SENGAJA TIDAK MENDEFINISIKAN onOpen().
//
// KESALAHAN 21 Agu 2026: versi sebelumnya punya `function onOpen()`.
// Seluruh file .gs dalam satu proyek Apps Script berbagi SATU global
// scope, jadi definisi terakhir menimpa yang sebelumnya — dan onOpen
// milik file ini membuat menu MENU UTAMA / View Dashboard / Koreksi
// yang sudah ada berhenti muncul. Kodenya tidak hilang, hanya tidak
// pernah dijalankan lagi.
//
// (Pola yang sama pernah ditemukan di proyek absensi: dua deklarasi
// onEdit saling menimpa — lihat DIAGNOSA-LAMBAT.md poin 6.)
//
// Sekarang menunya dipasang lewat TRIGGER onOpen yang terinstal, yang
// berjalan BERDAMPINGAN dengan onOpen bawaan proyek, bukan menggantikannya.
// Jalankan BOARD_PASANG_MENU() sekali.

/** Menyusun menu "Board Absensi". Dipanggil trigger, bukan onOpen. */
function boardBuatMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('Board Absensi')
    .addItem('Perbarui sekarang', 'BOARD_PERBARUI')
    .addItem('Isi sheet ABSENSI', 'ABSENSI_ISI')
    .addItem('Cek kolom DB_FIX', 'BOARD_CEK_SUMBER')
    .addItem('Cek tab induk karyawan', 'BOARD_CEK_MASTER')
    .addItem('Intip tab lain (BOARD_TAB_DIPERIKSA)', 'BOARD_CEK_TAB')
    .addSeparator()
    .addItem('Pasang auto-update tiap jam', 'BOARD_PASANG_TRIGGER')
    .addItem('Matikan auto-update', 'BOARD_LEPAS_TRIGGER')
    .addToUi();
}

/**
 * Memasang menu "Board Absensi" tanpa menyentuh onOpen milik proyek.
 * Jalankan SEKALI dari editor. Setelah itu menu muncul tiap spreadsheet
 * dibuka, berdampingan dengan menu yang sudah ada.
 */
function BOARD_PASANG_MENU() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'boardBuatMenu_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('boardBuatMenu_').forSpreadsheet(ss).onOpen().create();
  boardBuatMenu_();   // tampilkan sekarang juga, tanpa perlu muat ulang
  Logger.log('Menu "Board Absensi" dipasang lewat trigger. Menu lain tidak terpengaruh.');
}

/** Melepas menu "Board Absensi". */
function BOARD_LEPAS_MENU() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'boardBuatMenu_') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Trigger menu dilepas: %s.', n);
}


// =======================================================
// DIAGNOSTIK — jalankan ini DULU
// =======================================================

/**
 * Menampilkan nama kolom DB_FIX yang sebenarnya beserta kolom mana yang
 * berhasil dikenali. Jalankan sekali sebelum BOARD_PERBARUI supaya
 * pemetaannya terbukti benar, bukan ditebak.
 */
function BOARD_CEK_SUMBER() {
  const sh = _boardSheetSumber_();
  const rows = sh.getRange(1, 1, Math.min(5, sh.getLastRow()), sh.getLastColumn()).getValues();
  const header = rows[0].map(function (v) { return String(v || '').trim(); });

  Logger.log('=========== KOLOM DB_FIX ===========');
  header.forEach(function (h, i) {
    if (h) Logger.log('  %s (kolom %s)', h, _boardHurufKolom_(i + 1));
  });

  const peta = _boardPetakanKolom_(header);
  Logger.log('');
  Logger.log('=========== HASIL PENGENALAN ===========');
  Object.keys(BOARD_PETA_KOLOM).forEach(function (k) {
    const idx = peta[k];
    // Apps Script TIDAK mendukung penanda lebar seperti %-9s — kalau
    // dipakai, teksnya tercetak apa adanya dan argumennya ikut bergeser,
    // sehingga log tidak menampilkan apa pun yang berguna.
    const label = (k + '         ').slice(0, 9);
    Logger.log('  ' + label + ' : ' +
      (idx >= 0 ? (header[idx] + '  (kolom ' + _boardHurufKolom_(idx + 1) + ')') : '>>> TIDAK DITEMUKAN'));
  });

  const wajib = ['payroll', 'nama', 'tanggal', 'simbol'];
  const kurang = wajib.filter(function (k) { return peta[k] < 0; });
  Logger.log('');
  if (kurang.length) {
    Logger.log('>>> BELUM BISA DIJALANKAN. Kolom wajib belum dikenali: %s', kurang.join(', '));
    Logger.log('    Tambahkan kata kunci nama kolomnya ke BOARD_PETA_KOLOM di atas file ini.');
  } else {
    Logger.log('>>> SIAP. Jalankan BOARD_PERBARUI().');
  }
  Logger.log('');
  Logger.log('Baris data pertama sebagai contoh:');
  if (rows.length > 1) Logger.log('  %s', JSON.stringify(rows[1]).slice(0, 500));
  Logger.log('Total baris di DB_FIX: %s', sh.getLastRow() - 1);
  Logger.log('');
  Logger.log('Tab lain di spreadsheet sumber (untuk BOARD_MASTER_SHEET):');
  SpreadsheetApp.openById(BOARD_SUMBER_ID).getSheets().forEach(function (x) {
    Logger.log('  - %s (%s baris)', x.getName(), x.getLastRow());
  });
}


// =======================================================
// PEMBANGUN SHEET
// =======================================================

/**
 * Menyusun ulang sheet rekap untuk periode berjalan.
 * Aman dijalankan berkali-kali: sheet lama ditimpa, bukan ditumpuk.
 */
function BOARD_PERBARUI() {
  const periode = _boardPeriodeBerjalan_();
  const hasil = BOARD_PERBARUI_PERIODE(periode.mulai, periode.selesai);

  // Periode berjalan bisa saja belum punya data sama sekali — pada tanggal
  // 21, periode baru saja mulai dan mesin belum menyetorkan apa pun.
  // Board kosong tanpa penjelasan adalah kegagalan diam-diam: kelihatan
  // seperti "skripnya rusak", padahal datanya yang memang belum ada.
  // Karena itu kalau kosong, dibangun ulang untuk periode TERAKHIR yang
  // benar-benar berisi, dan alasannya dicatat di log.
  if (hasil.karyawan === 0) {
    const p2 = _boardPeriodeTerakhirBerisi_();
    if (p2) {
      Logger.log('Periode berjalan (%s s/d %s) belum ada datanya. Membangun periode terakhir yang berisi.',
        Utilities.formatDate(periode.mulai, Session.getScriptTimeZone(), 'd MMM yyyy'),
        Utilities.formatDate(periode.selesai, Session.getScriptTimeZone(), 'd MMM yyyy'));
      return BOARD_PERBARUI_PERIODE(p2.mulai, p2.selesai);
    }
    Logger.log('>>> DB_FIX tidak punya data tanggal yang bisa dibaca sama sekali.');
  }
  return hasil;
}

/**
 * Periode siklus 21-20 terakhir yang benar-benar berisi baris di DB_FIX.
 * @return {{mulai: Date, selesai: Date}|null}
 * @private
 */
function _boardPeriodeTerakhirBerisi_() {
  const tz = Session.getScriptTimeZone();
  const sh = _boardSheetSumber_();
  const nilai = sh.getDataRange().getValues();
  if (nilai.length < 2) return null;

  const header = nilai[0].map(function (v) { return String(v || '').trim(); });
  const peta = _boardPetakanKolom_(header);
  if (peta.tanggal < 0) return null;

  let maks = '';
  let min = '';
  for (let i = 1; i < nilai.length; i++) {
    const t = _boardTanggalYmd_(nilai[i][peta.tanggal], tz);
    if (!t) continue;
    if (!maks || t > maks) maks = t;
    if (!min || t < min) min = t;
  }
  if (!maks) return null;
  Logger.log('Rentang tanggal di DB_FIX: %s s/d %s', min, maks);

  const bagian = maks.split('-').map(Number);
  let tahun = bagian[0], bulan = bagian[1] - 1;
  if (bagian[2] < BOARD_TGL_MULAI_SIKLUS) bulan -= 1;
  return {
    mulai: new Date(Date.UTC(tahun, bulan, BOARD_TGL_MULAI_SIKLUS)),
    selesai: new Date(Date.UTC(tahun, bulan + 1, BOARD_TGL_MULAI_SIKLUS - 1))
  };
}

/**
 * @param {Date} mulai
 * @param {Date} selesai
 */
function BOARD_PERBARUI_PERIODE(mulai, selesai) {
  const t0 = new Date().getTime();
  const tz = Session.getScriptTimeZone();

  const sh = _boardSheetSumber_();
  const nilai = sh.getDataRange().getValues();
  if (nilai.length < 2) throw new Error('DB_FIX kosong.');

  const header = nilai[0].map(function (v) { return String(v || '').trim(); });
  const peta = _boardPetakanKolom_(header);
  ['payroll', 'nama', 'tanggal', 'simbol'].forEach(function (k) {
    if (peta[k] < 0) throw new Error('Kolom "' + k + '" tidak ditemukan di DB_FIX. Jalankan BOARD_CEK_SUMBER() dulu.');
  });

  // --- Daftar tanggal periode ---
  const tanggal = [];
  for (let d = new Date(mulai.getTime()); d.getTime() <= selesai.getTime(); d = new Date(d.getTime() + 86400000)) {
    tanggal.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }
  const indexTanggal = {};
  tanggal.forEach(function (t, i) { indexTanggal[t] = i; });

  // --- Kumpulkan per karyawan ---
  // Peta di sini disusun SEKALI lalu dipakai ulang. Menyisir ulang array
  // untuk tiap karyawan akan membuat waktu jalannya tumbuh kuadratik dan
  // menabrak batas 6 menit Apps Script begitu datanya membesar.
  const orang = {};   // payroll -> { info, hari: [] }
  for (let i = 1; i < nilai.length; i++) {
    const baris = nilai[i];
    const payroll = String(baris[peta.payroll] || '').trim();
    if (!payroll || payroll === '-') continue;

    const tglStr = _boardTanggalYmd_(baris[peta.tanggal], tz);
    if (!tglStr) continue;
    const kolomHari = indexTanggal[tglStr];
    if (kolomHari === undefined) continue;   // di luar periode

    let o = orang[payroll];
    if (!o) {
      o = orang[payroll] = {
        payroll: payroll,
        nama: peta.nama >= 0 ? String(baris[peta.nama] || '') : '',
        hrd: peta.hrd >= 0 ? String(baris[peta.hrd] || '') : '',
        pt: peta.pt >= 0 ? String(baris[peta.pt] || '') : '',
        tglMasuk: peta.tglMasuk >= 0 ? baris[peta.tglMasuk] : '',
        jabatan: peta.jabatan >= 0 ? String(baris[peta.jabatan] || '') : '',
        atasan: peta.atasan >= 0 ? String(baris[peta.atasan] || '') : '',
        hari: new Array(tanggal.length * 2).fill('')
      };
    }
    o.hari[kolomHari * 2] = String(baris[peta.simbol] || '').trim();
    if (peta.telat >= 0) {
      const telat = baris[peta.telat];
      const teks = String(telat == null ? '' : telat).trim();
      o.hari[kolomHari * 2 + 1] = (teks === '' || teks === '-' || teks === 'FALSE' || teks === '00:00:00') ? '' : teks;
    }
  }

  // --- Lengkapi dari daftar induk (opsional) ---
  const induk = _boardAmbilMaster_();
  if (induk) {
    Object.keys(orang).forEach(function (pr) {
      const m = induk[pr];
      if (!m) return;
      const o = orang[pr];
      if (!o.hrd) o.hrd = m.hrd || '';
      if (!o.pt) o.pt = m.pt || '';
      if (!o.tglMasuk) o.tglMasuk = m.tglMasuk || '';
      if (!o.jabatan) o.jabatan = m.jabatan || '';
      if (!o.atasan) o.atasan = m.atasan || '';
      if (!o.nama) o.nama = m.nama || '';
    });
  }

  const daftar = Object.keys(orang).sort().map(function (k) { return orang[k]; });
  Logger.log('Periode %s s/d %s -> %s karyawan cocok dari %s baris DB_FIX.',
    Utilities.formatDate(mulai, tz, 'd MMM yyyy'), Utilities.formatDate(selesai, tz, 'd MMM yyyy'),
    daftar.length, nilai.length - 1);

  // --- Susun matriks keluaran ---
  const judul = 'Absensi Karyawan Periode ' +
    Utilities.formatDate(mulai, tz, 'd MMMM yyyy') + ' s/d ' +
    Utilities.formatDate(selesai, tz, 'd MMMM yyyy');

  const KOL_INFO = ['NO', 'PAYROLL', 'HRD', 'NAMA', 'PT', 'TGL MASUK', 'JABATAN', 'ATASAN LANGSUNG', 'HARI KERJA'];
  const lebarInfo = KOL_INFO.length;
  const lebarTotal = lebarInfo + tanggal.length * 2 + BOARD_KODE_HITUNG.length;

  const kosong = function () { return new Array(lebarTotal).fill(''); };

  const r1 = kosong(); r1[0] = judul;
  const r2 = kosong();                       // baris tanggal
  const r3 = kosong();                       // ABSEN / TELAT
  KOL_INFO.forEach(function (h, i) { r2[i] = h; });
  tanggal.forEach(function (t, i) {
    r2[lebarInfo + i * 2] = Utilities.formatDate(new Date(t + 'T00:00:00Z'), 'UTC', 'd MMM');
    r3[lebarInfo + i * 2] = 'ABSEN';
    r3[lebarInfo + i * 2 + 1] = 'TELAT';
  });
  BOARD_KODE_HITUNG.forEach(function (k, i) {
    r2[lebarInfo + tanggal.length * 2 + i] = 'KETIDAKHADIRAN';
    r3[lebarInfo + tanggal.length * 2 + i] = k.label;
  });

  const isi = [r1, r2, r3];
  daftar.forEach(function (o, n) {
    const baris = kosong();
    baris[0] = n + 1;
    baris[1] = o.payroll;
    baris[2] = o.hrd;
    baris[3] = o.nama;
    baris[4] = o.pt;
    baris[5] = o.tglMasuk;
    baris[6] = o.jabatan;
    baris[7] = o.atasan;

    let hariKerja = 0;
    for (let i = 0; i < o.hari.length; i++) baris[lebarInfo + i] = o.hari[i];
    for (let i = 0; i < tanggal.length; i++) {
      const sym = o.hari[i * 2];
      if (sym && sym !== 'O') hariKerja++;
    }
    baris[8] = hariKerja;

    BOARD_KODE_HITUNG.forEach(function (k, j) {
      let n2 = 0;
      for (let i = 0; i < tanggal.length; i++) if (o.hari[i * 2] === k.kode) n2++;
      baris[lebarInfo + tanggal.length * 2 + j] = n2;
    });
    isi.push(baris);
  });

  // --- Tulis ---
  const namaSheet = 'BOARD ' + Utilities.formatDate(mulai, tz, 'MMM yyyy').toUpperCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let out = ss.getSheetByName(namaSheet);
  if (!out) out = ss.insertSheet(namaSheet);
  out.clear();

  // Satu setValues untuk SELURUH tabel. Menulis per baris akan membuat
  // ratusan panggilan layanan dan menghabiskan batas waktu eksekusi.
  out.getRange(1, 1, isi.length, lebarTotal).setValues(isi);

  // Judul SENGAJA tidak digabung selebar tabel.
  // Google Sheets menolak setFrozenColumns kalau pembekuannya memotong
  // sebuah sel gabungan ("tidak dapat membekukan kolom yang berisi hanya
  // sebagian dari sel gabungan"), dan judul selebar 80+ kolom pasti
  // terpotong oleh pembekuan 4 kolom pertama. Teks di A1 tetap terbaca
  // penuh karena sel di sebelah kanannya kosong.
  out.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  out.getRange(2, 1, 2, lebarTotal).setFontWeight('bold').setHorizontalAlignment('center')
     .setBackground('#f1f5f9').setFontSize(9);
  out.getRange(4, lebarInfo + 1, Math.max(isi.length - 3, 1), tanggal.length * 2)
     .setHorizontalAlignment('center').setFontSize(9);
  out.setFrozenRows(3);
  out.setFrozenColumns(4);
  out.getRange(1, 1, isi.length, lebarTotal).setBorder(true, true, true, true, true, true,
    '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);
  for (let c = lebarInfo + 1; c <= lebarInfo + tanggal.length * 2; c++) out.setColumnWidth(c, 34);

  const durasi = new Date().getTime() - t0;
  Logger.log('Board "%s" diperbarui: %s karyawan x %s hari dalam %s ms.',
             namaSheet, daftar.length, tanggal.length, durasi);
  return { sheet: namaSheet, karyawan: daftar.length, hari: tanggal.length, ms: durasi };
}


// =======================================================
// AUTO-UPDATE
// =======================================================

function BOARD_PASANG_TRIGGER() {
  BOARD_LEPAS_TRIGGER();
  ScriptApp.newTrigger('BOARD_PERBARUI').timeBased().everyHours(1).create();
  Logger.log('Auto-update dipasang: tiap 1 jam.');
}

function BOARD_LEPAS_TRIGGER() {
  const semua = ScriptApp.getProjectTriggers();
  let n = 0;
  semua.forEach(function (t) {
    if (t.getHandlerFunction() === 'BOARD_PERBARUI') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Trigger lama dilepas: %s.', n);
}


// =======================================================
// PEMBANTU
// =======================================================

/** @private */
function _boardSheetSumber_() {
  const ss = SpreadsheetApp.openById(BOARD_SUMBER_ID);
  const sh = ss.getSheetByName(BOARD_SUMBER_SHEET);
  if (!sh) {
    throw new Error('Sheet "' + BOARD_SUMBER_SHEET + '" tidak ada di spreadsheet sumber. ' +
                    'Tab yang tersedia: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  }
  return sh;
}

/** @private */
function _boardPetakanKolom_(header) {
  const bawah = header.map(function (h) { return String(h || '').toLowerCase().trim(); });
  const hasil = {};
  Object.keys(BOARD_PETA_KOLOM).forEach(function (kunci) {
    const kandidat = BOARD_PETA_KOLOM[kunci];
    let ketemu = -1;
    // Cocok PERSIS lebih diutamakan daripada cocok sebagian, supaya
    // "NAMA" tidak kalah oleh "NAMA ATASAN" yang kebetulan lebih dulu.
    for (let i = 0; i < bawah.length && ketemu < 0; i++) {
      if (kandidat.indexOf(bawah[i]) !== -1) ketemu = i;
    }
    for (let i = 0; i < bawah.length && ketemu < 0; i++) {
      for (let j = 0; j < kandidat.length; j++) {
        if (bawah[i] && bawah[i].indexOf(kandidat[j]) !== -1) { ketemu = i; break; }
      }
    }
    hasil[kunci] = ketemu;
  });
  return hasil;
}

/** @private */
function _boardTanggalYmd_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const teks = String(v || '').trim();
  if (!teks) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(teks)) return teks.slice(0, 10);
  // dd-mm-yyyy atau dd/mm/yyyy
  const m = teks.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) {
    return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  const d = new Date(teks);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/** Periode siklus 21 s/d 20 yang sedang berjalan. @private */
function _boardPeriodeBerjalan_() {
  const tz = Session.getScriptTimeZone();
  const bagian = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-').map(Number);
  let tahun = bagian[0], bulan = bagian[1] - 1;
  if (bagian[2] < BOARD_TGL_MULAI_SIKLUS) bulan -= 1;
  return {
    mulai: new Date(Date.UTC(tahun, bulan, BOARD_TGL_MULAI_SIKLUS)),
    selesai: new Date(Date.UTC(tahun, bulan + 1, BOARD_TGL_MULAI_SIKLUS - 1))
  };
}

/**
 * Daftar induk karyawan (payroll -> data), kalau BOARD_MASTER_SHEET diisi.
 * @return {Object|null} null kalau tidak dikonfigurasi / tab tidak ada.
 * @private
 */
function _boardAmbilMaster_() {
  if (!BOARD_MASTER_SHEET) return null;
  const sh = SpreadsheetApp.openById(BOARD_SUMBER_ID).getSheetByName(BOARD_MASTER_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    console.warn('Tab induk "' + BOARD_MASTER_SHEET + '" tidak ditemukan — kolom jabatan/atasan dibiarkan kosong.');
    return null;
  }
  const nilai = sh.getDataRange().getValues();

  // Baris header tidak selalu baris 1 — beberapa tab punya judul/spasi di
  // atasnya. Dicari baris pertama (dari 10 teratas) yang memuat PAYROLL.
  let barisHeader = 0;
  for (let r = 0; r < Math.min(10, nilai.length); r++) {
    const teks = nilai[r].map(function (v) { return String(v || '').toLowerCase(); });
    if (teks.indexOf('payroll') !== -1) { barisHeader = r; break; }
  }

  const header = nilai[barisHeader].map(function (v) { return String(v || '').trim(); });
  const peta = _boardPetakanKolom_(header);

  // Penimpaan manual menang atas pengenalan otomatis.
  Object.keys(BOARD_MASTER_KOLOM).forEach(function (k) {
    const huruf = String(BOARD_MASTER_KOLOM[k] || '').trim().toUpperCase();
    if (huruf) peta[k] = _boardNomorKolom_(huruf) - 1;
  });

  if (peta.payroll < 0) {
    console.warn('Tab induk "' + BOARD_MASTER_SHEET + '" tidak punya kolom PAYROLL — dilewati.');
    return null;
  }

  // Pemetaan dicatat supaya salah kolom terlihat di log, bukan muncul
  // diam-diam sebagai jabatan orang lain di board.
  console.log('Induk "%s": header di baris %s -> payroll=%s hrd=%s pt=%s tglMasuk=%s jabatan=%s atasan=%s',
    BOARD_MASTER_SHEET, barisHeader + 1,
    peta.payroll >= 0 ? header[peta.payroll] : '-', peta.hrd >= 0 ? header[peta.hrd] : '-',
    peta.pt >= 0 ? header[peta.pt] : '-', peta.tglMasuk >= 0 ? header[peta.tglMasuk] : '-',
    peta.jabatan >= 0 ? header[peta.jabatan] : '-', peta.atasan >= 0 ? header[peta.atasan] : '-');

  const hasil = {};
  for (let i = barisHeader + 1; i < nilai.length; i++) {
    const pr = String(nilai[i][peta.payroll] || '').trim();
    if (!pr) continue;
    hasil[pr] = {
      nama:     peta.nama     >= 0 ? String(nilai[i][peta.nama] || '') : '',
      hrd:      peta.hrd      >= 0 ? String(nilai[i][peta.hrd] || '') : '',
      pt:       peta.pt       >= 0 ? String(nilai[i][peta.pt] || '') : '',
      tglMasuk: peta.tglMasuk >= 0 ? nilai[i][peta.tglMasuk] : '',
      jabatan:  peta.jabatan  >= 0 ? String(nilai[i][peta.jabatan] || '') : '',
      atasan:   peta.atasan   >= 0 ? String(nilai[i][peta.atasan] || '') : ''
    };
  }
  return hasil;
}

/**
 * Read-only. Menampilkan header tab induk beserta kolom yang dikenali,
 * supaya penimpaan di BOARD_MASTER_KOLOM bisa diisi dengan benar.
 */
function BOARD_CEK_MASTER() { _boardPeriksaTab_(BOARD_MASTER_SHEET); }

/** Mengintip header tab lain (diatur lewat BOARD_TAB_DIPERIKSA). */
function BOARD_CEK_TAB() { _boardPeriksaTab_(BOARD_TAB_DIPERIKSA); }

/** @private */
function _boardPeriksaTab_(namaTab) {
  if (!namaTab) { Logger.log('Nama tab masih kosong.'); return; }
  const sh = SpreadsheetApp.openById(BOARD_SUMBER_ID).getSheetByName(namaTab);
  if (!sh) { Logger.log('Tab "%s" tidak ada.', namaTab); return; }
  const BOARD_MASTER_SHEET = namaTab; // dipakai label di bawah

  const nilai = sh.getRange(1, 1, Math.min(6, sh.getLastRow()), sh.getLastColumn()).getValues();
  let barisHeader = 0;
  for (let r = 0; r < nilai.length; r++) {
    if (nilai[r].map(function (v) { return String(v || '').toLowerCase(); }).indexOf('payroll') !== -1) { barisHeader = r; break; }
  }
  const header = nilai[barisHeader].map(function (v) { return String(v || '').trim(); });

  Logger.log('=========== TAB INDUK: %s ===========', BOARD_MASTER_SHEET);
  Logger.log('Baris header : %s', barisHeader + 1);
  header.forEach(function (h, i) { if (h) Logger.log('  %s (kolom %s)', h, _boardHurufKolom_(i + 1)); });

  // Nama kolom yang muncul lebih dari sekali adalah tanda tab ini memuat
  // beberapa daftar berdampingan — pengenalan otomatis TIDAK bisa dipercaya
  // di situ, harus ditunjuk manual lewat BOARD_MASTER_KOLOM.
  const hitung = {};
  header.forEach(function (h) { if (h) hitung[h] = (hitung[h] || 0) + 1; });
  const ganda = Object.keys(hitung).filter(function (h) { return hitung[h] > 1; });
  Logger.log('');
  if (ganda.length) {
    Logger.log('>>> PERINGATAN: nama kolom muncul ganda: %s', ganda.join(', '));
    Logger.log('    Tab ini memuat beberapa daftar berdampingan. Tunjuk kolomnya');
    Logger.log('    secara manual di BOARD_MASTER_KOLOM, jangan andalkan otomatis.');
  }
  const peta = _boardPetakanKolom_(header);
  Logger.log('Hasil pengenalan otomatis:');
  ['payroll', 'hrd', 'nama', 'pt', 'tglMasuk', 'jabatan', 'atasan'].forEach(function (k) {
    const i = peta[k];
    Logger.log('  ' + (k + '         ').slice(0, 9) + ' : ' +
      (i >= 0 ? header[i] + '  (kolom ' + _boardHurufKolom_(i + 1) + ')' : 'TIDAK DITEMUKAN'));
  });
  if (nilai.length > barisHeader + 1) {
    Logger.log('');
    Logger.log('Contoh baris data: %s', JSON.stringify(nilai[barisHeader + 1]).slice(0, 400));
  }
}

/** 'G' -> 7 @private */
function _boardNomorKolom_(huruf) {
  let n = 0;
  for (let i = 0; i < huruf.length; i++) n = n * 26 + (huruf.charCodeAt(i) - 64);
  return n;
}

/** @private */
function _boardHurufKolom_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}


// =======================================================
// MENGISI SHEET "ABSENSI" BUATAN ADMIN
//
// Berbeda dengan BOARD_PERBARUI yang membuat sheet dari nol, fungsi ini
// MENGISI sheet yang sudah Anda susun sendiri: kolom identitas (NO s/d
// HARI KERJA) dibiarkan apa adanya, yang ditulis hanya kolom harian ke
// kanan. Baris dicocokkan lewat PAYROLL, jadi baris kosong pemisah
// antar-kelompok tetap utuh di tempatnya.
// =======================================================

const ABS_SHEET = 'ABSENSI';
const ABS_KOL_MULAI = 10;   // J — kolom harian pertama
const ABS_BARIS_TANGGAL = 1;
const ABS_BARIS_ABSTEL = 2;
const ABS_BARIS_NOMOR = 3;

// Warna diambil dari format bersyarat file ABSEN_JUL_2026 (GMS-BWI,
// rentang L26:BU26). URUTAN DI SINI PENTING — dicocokkan dari atas ke
// bawah, yang pertama cocok dipakai, meniru cara Excel menerapkannya.
// Contoh yang tergantung urutan: "AC" mengandung "A" sehingga harus
// diuji SEBELUM aturan yang lebih longgar.
const ABS_WARNA = [
  { uji: function (s) { return s.indexOf('CA') !== -1; }, bg: '#92D050' },
  { uji: function (s) { return s.indexOf('MN') !== -1; }, bg: '#7030A0' },
  { uji: function (s) { return s.indexOf('EO') !== -1; }, bg: '#B6DDE8' },
  { uji: function (s) { return s.indexOf('NF') !== -1; }, bg: '#D99594' },
  { uji: function (s) { return s.indexOf('DL') === 0;  }, bg: '#FFFF00' },
  { uji: function (s) { return s.indexOf('A') !== -1;  }, bg: '#FF0000' },
  { uji: function (s) { return s.indexOf('O') === 0;   }, bg: '#7F7F7F' },
  { uji: function (s) { return s.indexOf('C') === 0;   }, bg: '#92D050' },
  { uji: function (s) { return s.slice(-1) === 'S';    }, bg: '#92D050' },
  { uji: function (s) { return s.indexOf('H') === 0;   }, bg: '#0070C0' },
  { uji: function (s) { return s.indexOf('T') === 0;   }, bg: '#0070C0' },
  { uji: function (s) { return s.indexOf('SI') === 0;  }, bg: '#0070C0' },
  { uji: function (s) { return s.indexOf('SO') === 0;  }, bg: '#0070C0' },
  { uji: function (s) { return s.indexOf('I') === 0;   }, bg: '#0070C0' },
  { uji: function (s) { return s.slice(-2) === 'PC';   }, bg: '#0070C0' }
];

/**
 * Warna latar untuk sebuah kode absensi, atau '' kalau tidak dikenali.
 * @private
 */
function _absWarna_(kode) {
  const s = String(kode || '').trim().toUpperCase();
  if (!s) return '';
  for (let i = 0; i < ABS_WARNA.length; i++) if (ABS_WARNA[i].uji(s)) return ABS_WARNA[i].bg;
  return '';
}

/**
 * Warna teks yang kontras terhadap latarnya.
 *
 * File Excel aslinya memberi warna teks SAMA dengan latarnya, sehingga
 * kodenya tidak terbaca — hanya tampak kotak berwarna. Itu membuat kode
 * yang sewarna tidak bisa dibedakan sama sekali: A dan AC dua-duanya
 * merah, T dan TSo dua-duanya biru. Di sini teksnya dibuat tetap
 * terbaca; warnanya jadi penanda kelompok, bukan satu-satunya penanda.
 * @private
 */
function _absWarnaTeks_(bg) {
  if (!bg) return '#000000';
  const r = parseInt(bg.substr(1, 2), 16), g = parseInt(bg.substr(3, 2), 16), b = parseInt(bg.substr(5, 2), 16);
  // Luminansi perseptual; ambang 150 memisahkan kuning/hijau muda (teks
  // hitam) dari merah/biru/abu tua (teks putih).
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000000' : '#FFFFFF';
}

/**
 * Menit keterlambatan sebagai ANGKA.
 *
 * DB_FIX menyimpan TELAT sebagai nilai waktu (mis. 30 Des 1899 00:17),
 * yang kalau disalin apa adanya tampil sebagai tanggal 1899 — itu yang
 * terlihat di board sebelumnya. Diubah jadi jumlah menit supaya bisa
 * dijumlah dan dibandingkan.
 * @private
 */
function _absMenitTelat_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    const jam = Utilities.formatDate(v, tz, 'HH:mm:ss').split(':').map(Number);
    const menit = jam[0] * 60 + jam[1] + (jam[2] >= 30 ? 1 : 0);
    return menit > 0 ? menit : '';
  }
  const teks = String(v).trim();
  if (!teks || teks === '-' || teks === 'FALSE' || teks === '00:00:00') return '';
  if (teks.indexOf(':') !== -1) {
    const b = teks.split(':').map(Number);
    const menit = (b[0] || 0) * 60 + (b[1] || 0);
    return menit > 0 ? menit : '';
  }
  const angka = Number(teks);
  if (!isNaN(angka)) {
    // Angka pecahan < 1 berarti bagian dari satu hari (format serial
    // spreadsheet); selain itu dianggap sudah dalam satuan menit.
    const menit = angka < 1 ? Math.round(angka * 1440) : Math.round(angka);
    return menit > 0 ? menit : '';
  }
  return '';
}

/** Mengisi sheet ABSENSI untuk periode terakhir yang berisi data. */
function ABSENSI_ISI() {
  const p = _boardPeriodeTerakhirBerisi_() || _boardPeriodeBerjalan_();
  return ABSENSI_ISI_PERIODE(p.mulai, p.selesai);
}

/** Mengisi sheet ABSENSI untuk periode berjalan. */
function ABSENSI_ISI_BERJALAN() {
  const p = _boardPeriodeBerjalan_();
  return ABSENSI_ISI_PERIODE(p.mulai, p.selesai);
}

function ABSENSI_ISI_PERIODE(mulai, selesai) {
  const t0 = new Date().getTime();
  const tz = Session.getScriptTimeZone();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = ss.getSheetByName(ABS_SHEET);
  if (!out) throw new Error('Sheet "' + ABS_SHEET + '" tidak ada di spreadsheet ini.');

  // ---- Data sumber ----
  const sh = _boardSheetSumber_();
  const nilai = sh.getDataRange().getValues();
  const header = nilai[0].map(function (v) { return String(v || '').trim(); });
  const peta = _boardPetakanKolom_(header);
  ['payroll', 'tanggal', 'simbol'].forEach(function (k) {
    if (peta[k] < 0) throw new Error('Kolom "' + k + '" tidak ditemukan di DB_FIX.');
  });

  const tanggal = [];
  for (let d = new Date(mulai.getTime()); d.getTime() <= selesai.getTime(); d = new Date(d.getTime() + 86400000)) {
    tanggal.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }
  const idxTgl = {};
  tanggal.forEach(function (t, i) { idxTgl[t] = i; });

  const data = {};   // payroll -> array [absen, telat, absen, telat, ...]
  for (let i = 1; i < nilai.length; i++) {
    const pr = String(nilai[i][peta.payroll] || '').trim();
    if (!pr) continue;
    const t = _boardTanggalYmd_(nilai[i][peta.tanggal], tz);
    const kol = idxTgl[t];
    if (kol === undefined) continue;
    if (!data[pr]) data[pr] = new Array(tanggal.length * 2).fill('');
    data[pr][kol * 2] = String(nilai[i][peta.simbol] || '').trim();
    data[pr][kol * 2 + 1] = peta.telat >= 0 ? _absMenitTelat_(nilai[i][peta.telat], tz) : '';
  }

  // ---- Kolom PAYROLL di sheet tujuan ----
  // Dicari dari isi baris header, bukan dipatok kolom B: kalau suatu saat
  // ada kolom disisipkan di kiri, mematok posisi akan menulis data ke
  // baris orang yang salah tanpa error apa pun.
  const lastRow = out.getLastRow();
  const petaHead = out.getRange(1, 1, Math.min(4, lastRow), Math.min(out.getLastColumn(), 12)).getValues();
  let kolPayroll = 0;
  for (let r = 0; r < petaHead.length && !kolPayroll; r++) {
    for (let c = 0; c < petaHead[r].length; c++) {
      if (String(petaHead[r][c] || '').trim().toUpperCase() === 'PAYROLL') { kolPayroll = c + 1; break; }
    }
  }
  if (!kolPayroll) throw new Error('Kolom PAYROLL tidak ditemukan di sheet "' + ABS_SHEET + '".');

  const payrollKolom = out.getRange(1, kolPayroll, lastRow, 1).getValues();

  // ---- Susun matriks tulis ----
  const lebar = tanggal.length * 2;
  const barisTulis = [];
  const warnaTulis = [];
  const teksTulis = [];
  let cocok = 0, tanpaData = 0;

  for (let r = 0; r < lastRow; r++) {
    const pr = String(payrollKolom[r][0] || '').trim();
    const isBarisData = pr && r + 1 > ABS_BARIS_NOMOR && pr.toUpperCase() !== 'PAYROLL';

    const baris = new Array(lebar).fill('');
    const warna = new Array(lebar).fill(null);
    const teks = new Array(lebar).fill('#000000');

    if (isBarisData) {
      const d = data[pr];
      if (d) {
        cocok++;
        for (let i = 0; i < lebar; i++) baris[i] = d[i];
        for (let i = 0; i < tanggal.length; i++) {
          const bg = _absWarna_(d[i * 2]);
          if (bg) { warna[i * 2] = bg; teks[i * 2] = _absWarnaTeks_(bg); }
        }
      } else {
        tanpaData++;
      }
    }
    barisTulis.push(baris);
    warnaTulis.push(warna);
    teksTulis.push(teks);
  }

  // ---- Header harian ----
  const hdrTanggal = new Array(lebar).fill('');
  const hdrAbsTel = new Array(lebar).fill('');
  const hdrNomor = new Array(lebar).fill('');
  tanggal.forEach(function (t, i) {
    hdrTanggal[i * 2] = Utilities.formatDate(new Date(t + 'T00:00:00Z'), 'UTC', 'd MMM');
    hdrAbsTel[i * 2] = 'ABSEN';
    hdrAbsTel[i * 2 + 1] = 'TELAT';
    hdrNomor[i * 2] = 9 + i * 2;
    hdrNomor[i * 2 + 1] = 10 + i * 2;
  });
  barisTulis[ABS_BARIS_TANGGAL - 1] = hdrTanggal;
  barisTulis[ABS_BARIS_ABSTEL - 1] = hdrAbsTel;
  barisTulis[ABS_BARIS_NOMOR - 1] = hdrNomor;
  [ABS_BARIS_TANGGAL, ABS_BARIS_ABSTEL, ABS_BARIS_NOMOR].forEach(function (b) {
    warnaTulis[b - 1] = new Array(lebar).fill(null);
    teksTulis[b - 1] = new Array(lebar).fill('#000000');
  });

  // ---- Tulis sekali jalan ----
  // Satu setValues + satu setBackgrounds untuk SELURUH blok. Menulis per
  // sel akan jadi puluhan ribu panggilan layanan dan pasti menabrak batas
  // 6 menit eksekusi Apps Script.
  out.getRange(1, ABS_KOL_MULAI, lastRow, Math.max(lebar, out.getLastColumn() - ABS_KOL_MULAI + 1)).clearContent();
  const rng = out.getRange(1, ABS_KOL_MULAI, lastRow, lebar);
  rng.setValues(barisTulis);
  rng.setBackgrounds(warnaTulis);
  rng.setFontColors(teksTulis);
  rng.setHorizontalAlignment('center').setFontSize(9);

  // Kolom TELAT diberi format angka polos supaya tidak pernah lagi
  // ditafsirkan spreadsheet sebagai tanggal 1899.
  for (let i = 0; i < tanggal.length; i++) {
    out.getRange(ABS_BARIS_NOMOR + 1, ABS_KOL_MULAI + i * 2 + 1, Math.max(lastRow - ABS_BARIS_NOMOR, 1), 1)
       .setNumberFormat('0');
  }
  out.getRange(ABS_BARIS_TANGGAL, ABS_KOL_MULAI, 3, lebar).setFontWeight('bold').setBackground('#F1F5F9');
  for (let c = ABS_KOL_MULAI; c < ABS_KOL_MULAI + lebar; c++) out.setColumnWidth(c, 34);

  const durasi = new Date().getTime() - t0;
  Logger.log('Sheet "%s" diisi: periode %s s/d %s, %s baris cocok, %s baris tanpa data, %s hari, %s ms.',
    ABS_SHEET, Utilities.formatDate(mulai, tz, 'd MMM yyyy'),
    Utilities.formatDate(selesai, tz, 'd MMM yyyy'), cocok, tanpaData, tanggal.length, durasi);
  if (cocok === 0) Logger.log('>>> TIDAK ADA yang cocok. Periksa apakah PAYROLL di sheet ini sama persis dengan di DB_FIX.');
  return { cocok: cocok, tanpaData: tanpaData, hari: tanggal.length, ms: durasi };
}
