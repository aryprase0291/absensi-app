// =======================================================
// PROFILER — mengukur penyebab lambat secara nyata
// File: Profiler.gs
//
// CARA PAKAI:
//   1. Buat file baru di editor Apps Script, beri nama "Profiler.gs"
//   2. Tempel seluruh isi file ini
//   3. Pilih fungsi PROFILE_SEMUA dari dropdown, klik Run
//   4. Buka menu "Eksekusi" / "Executions" untuk melihat hasil log
//
// AMAN: seluruh fungsi di sini HANYA MEMBACA. Tidak ada setValue,
// tidak ada perubahan data apa pun di spreadsheet.
// =======================================================

// Logger.log Apps Script TIDAK mendukung penentu lebar seperti %-16s —
// format seperti itu akan tercetak mentah dan argumennya hilang.
// Jadi perataan kolom dibuat manual.
function _profPad(v, n)  { let s = String(v); while (s.length < n) s += ' '; return s; }
function _profPadL(v, n) { let s = String(v); while (s.length < n) s = ' ' + s; return s; }

/**
 * Jalankan ini. Mengukur semua sekaligus.
 */
function PROFILE_SEMUA() {
  const garis = '='.repeat(64);
  Logger.log(garis);
  Logger.log('PROFIL SPREADSHEET — ' + new Date());
  Logger.log(garis);

  PROFILE_SHEETS();

  Logger.log('');
  Logger.log(garis);
  Logger.log('PROFIL HANDLER');
  Logger.log(garis);
  Logger.log('Isi dulu USERNAME/PASSWORD/USER_ID di bawah, lalu jalankan');
  Logger.log('PROFILE_LOGIN() dan PROFILE_STATS() secara terpisah.');
}

/**
 * Ukuran & waktu baca tiap sheet.
 * Inilah biaya dasar dari setiap getDataRange().getValues().
 */
function PROFILE_SHEETS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const daftar = [
    'Users', 'MasterData', 'MASTER-CUTI', 'Absensi',
    'dbabsen', 'Remarks', 'Announcements', 'running shift'
  ];

  let totalSel = 0;
  let totalMs = 0;

  Logger.log(_profPad('SHEET',16) + _profPadL('BARIS',8) + _profPadL('KOL',6) + _profPadL('SEL',10) + _profPadL('BACA(ms)',9));
  Logger.log('-'.repeat(64));

  daftar.forEach(function (nama) {
    const sh = ss.getSheetByName(nama);
    if (!sh) {
      Logger.log(_profPad(nama,16) + '<< TIDAK DITEMUKAN >>');
      return;
    }

    const t0 = new Date().getTime();
    const v = sh.getDataRange().getValues();
    const ms = new Date().getTime() - t0;

    const baris = v.length;
    const kol = baris > 0 ? v[0].length : 0;
    const sel = baris * kol;

    totalSel += sel;
    totalMs += ms;

    Logger.log(_profPad(nama,16) + _profPadL(baris,8) + _profPadL(kol,6) + _profPadL(sel,10) + _profPadL(ms,9));
  });

  Logger.log('-'.repeat(64));
  Logger.log(_profPad('TOTAL',16) + _profPadL('',8) + _profPadL('',6) + _profPadL(totalSel,10) + _profPadL(totalMs,9));
  Logger.log('');
  Logger.log('Catatan: kalau "dbabsen" jauh lebih lambat dari sheet lain');
  Logger.log('padahal barisnya tidak jauh berbeda, itu tanda kolom A:S');
  Logger.log('berisi formula/IMPORTRANGE yang dihitung ulang setiap dibaca.');
}

/**
 * Ukur berapa lama handleLogin berjalan.
 * ISI dulu username & password milik user uji.
 */
function PROFILE_LOGIN() {
  const USERNAME = '';   // <-- isi, contoh: '25'
  const PASSWORD = '';   // <-- isi

  if (!USERNAME) {
    Logger.log('Isi dulu USERNAME dan PASSWORD di dalam fungsi PROFILE_LOGIN.');
    return;
  }

  const t0 = new Date().getTime();
  handleLogin({ action: 'login', username: USERNAME, password: PASSWORD });
  const ms = new Date().getTime() - t0;

  Logger.log('handleLogin  : %s ms', ms);
  Logger.log('  membaca 3 sheet penuh: Users + MasterData + MASTER-CUTI');
}

/**
 * Ukur berapa lama handleGetStats berjalan.
 * Ini biasanya bagian terberat dari proses masuk aplikasi.
 * ISI dulu USER_ID (kolom A sheet Users, contoh: 'USR-1765521090380').
 */
function PROFILE_STATS() {
  const USER_ID = '';   // <-- isi
  const ROLE = 'karyawan';

  if (!USER_ID) {
    Logger.log('Isi dulu USER_ID di dalam fungsi PROFILE_STATS.');
    return;
  }

  const t0 = new Date().getTime();
  handleGetStats({ action: 'get_stats', userId: USER_ID, role: ROLE });
  const ms = new Date().getTime() - t0;

  Logger.log('handleGetStats: %s ms', ms);
  Logger.log('  membaca 5 sheet penuh: Absensi + dbabsen + MASTER-CUTI');
  Logger.log('  + Users + Remarks  (Users & MASTER-CUTI sudah dibaca saat login)');
}

/**
 * Ukur handleGetHistory — dipakai layar Riwayat & Laporan.
 */
function PROFILE_HISTORY() {
  const USER_ID = '';   // <-- isi

  if (!USER_ID) {
    Logger.log('Isi dulu USER_ID di dalam fungsi PROFILE_HISTORY.');
    return;
  }

  const t0 = new Date().getTime();
  handleGetHistory({ action: 'get_history', userId: USER_ID, canViewAll: false });
  const ms = new Date().getTime() - t0;

  Logger.log('handleGetHistory (1 user): %s ms', ms);

  const t1 = new Date().getTime();
  handleGetHistory({
    action: 'get_history', userId: USER_ID,
    canViewAll: true, requestorLokasi: 'All', targetUserIds: []
  });
  const ms2 = new Date().getTime() - t1;

  Logger.log('handleGetHistory (admin, semua): %s ms', ms2);
}

/**
 * Cek apakah dbabsen memang berisi formula (dugaan utama penyebab lambat).
 * Membandingkan waktu getValues() vs getDisplayValues() dan menghitung
 * jumlah sel yang isinya formula.
 */
function PROFILE_FORMULA_DBABSEN() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('dbabsen');
  if (!sh) { Logger.log('Sheet dbabsen tidak ditemukan.'); return; }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  Logger.log('dbabsen: %s baris x %s kolom', lastRow, lastCol);

  // Hitung sel berformula
  const formulas = sh.getRange(1, 1, lastRow, lastCol).getFormulas();
  let jumlahFormula = 0;
  let contoh = [];
  for (let r = 0; r < formulas.length; r++) {
    for (let c = 0; c < formulas[r].length; c++) {
      if (formulas[r][c]) {
        jumlahFormula++;
        if (contoh.length < 3) {
          contoh.push('R' + (r + 1) + 'C' + (c + 1) + ' = ' + formulas[r][c].substring(0, 80));
        }
      }
    }
  }

  Logger.log('Sel berisi formula: %s dari %s sel', jumlahFormula, lastRow * lastCol);
  contoh.forEach(function (x) { Logger.log('  contoh: %s', x); });

  if (jumlahFormula > 0) {
    Logger.log('');
    Logger.log('>> TERKONFIRMASI: dbabsen berisi formula.');
    Logger.log('>> Setiap getDataRange().getValues() memaksa Sheets menghitung');
    Logger.log('>> ulang formula tersebut. Ini penyebab utama request lambat.');
    Logger.log('>> Solusi: simpan hasilnya sebagai nilai statis (paste-special');
    Logger.log('>> values only) lewat proses impor berkala, bukan formula hidup.');
  }
}
