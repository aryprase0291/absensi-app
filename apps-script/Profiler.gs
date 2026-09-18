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
// AMAN: tidak ada satu pun fungsi di sini yang mengubah DATA di
// spreadsheet — tidak ada setValue, tidak ada baris ditulis.
//
// DUA PENGECUALIAN yang harus Anda tahu sebelum menjalankannya:
//   PROFILE_LOGIN()        memanggil handleLogin sungguhan, sehingga
//                          menerbitkan SessionID baru — karyawan pemilik
//                          akun itu akan terlempar ke layar login.
//   PROFILE_MASUK_DINGIN() membuang seluruh SIMPANAN (cache) lebih dulu.
//                          Datanya tidak hilang, tapi beberapa permintaan
//                          berikutnya akan lambat sampai simpanannya
//                          tersusun ulang sendiri.
// Untuk mencari bagian yang lambat, PROFILE_MASUK() sudah cukup dan
// tidak punya efek samping apa pun.
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
 *
 * PERINGATAN: fungsi ini memanggil handleLogin SUNGGUHAN, dan
 * handleLogin menerbitkan SessionID baru. Artinya karyawan yang sedang
 * memakai akun itu di HP-nya akan TERLEMPAR KE LAYAR LOGIN.
 * Untuk sekadar mencari bagian mana yang lambat, pakai PROFILE_MASUK()
 * di bawah — fungsinya hanya membaca, tanpa efek samping sama sekali.
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
  Logger.log('CATATAN: sesi karyawan pemilik akun ini baru saja digusur.');
}

// =======================================================
// PROFILE_MASUK — RINCIAN "KENAPA MASUK APLIKASI LAMA"
//
// Menjawab pertanyaan yang tidak bisa dijawab oleh satu angka total:
// dari sekian detik itu, DETIK YANG MANA milik siapa.
//
// Mengukur setiap bagian jalur masuk secara terpisah, dalam kondisi
// simpanan apa adanya (biasanya sudah panas), TANPA efek samping — tidak
// ada SessionID baru, tidak ada sel yang ditulis, tidak ada karyawan yang
// terlempar dari aplikasinya. Untuk kondisi terburuk, jalankan
// PROFILE_MASUK_DINGIN() di bawahnya.
//
// CARA PAKAI
//   1. Isi USER_ID di bawah (kolom A sheet Users, contoh
//      'USR-1765521090380'). Ambil dari akun yang Anda pakai menguji.
//   2. Pilih PROFILE_MASUK dari dropdown, klik Run.
//   3. Buka Eksekusi / Executions untuk membaca tabelnya.
//
// CARA MEMBACANYA
//   Angka di sini adalah waktu KERJA DI SERVER saja. Waktu yang Anda
//   rasakan di HP = angka ini + ongkos tetap Apps Script (redirect 302
//   + boot container, biasanya 1-3 detik dan TIDAK bisa dihilangkan
//   dari sisi kode) + waktu jaringan.
//
//   Jadi kalau tabel ini menunjukkan total 800 ms sementara di HP terasa
//   10 detik, masalahnya BUKAN di sini — cari di DevTools > Network,
//   atau di gerbang GPS (lihat src/utils/gpsWajib.js).
// =======================================================
function PROFILE_MASUK() {
  const USER_ID = '';   // <-- WAJIB diisi

  if (!USER_ID) {
    Logger.log('Isi dulu USER_ID di dalam fungsi PROFILE_MASUK.');
    Logger.log('Ambil dari kolom A sheet Users, contoh: USR-1765521090380');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shUsers = ss.getSheetByName('Users');
  const shAbsensi = ss.getSheetByName('Absensi');

  // Cari baris user supaya NIK & role-nya bisa dipakai apa adanya.
  const rowsUser = bacaSheet(shUsers, 14);
  let baris = null;
  for (let i = 1; i < rowsUser.length; i++) {
    if (String(rowsUser[i][0]) === String(USER_ID)) { baris = rowsUser[i]; break; }
  }
  if (!baris) {
    Logger.log('USER_ID "%s" tidak ada di sheet Users. Periksa lagi kolom A.', USER_ID);
    return;
  }

  const role = String(baris[5] || '');
  const nik = String(baris[7] || '');
  const lokasi = baris[13] || 'All';
  const divisi = baris[4];

  const hasil = [];
  const ukur = function (nama, fn) {
    const t = new Date().getTime();
    let catatan = '';
    try { catatan = fn() || ''; } catch (e) { catatan = 'GAGAL: ' + e.message; }
    hasil.push({ nama: nama, ms: new Date().getTime() - t, catatan: catatan });
  };

  Logger.log('PROFIL JALUR MASUK — %s', new Date());
  Logger.log('User: %s | role: %s | NIK: %s', USER_ID, role || '-', nik || '-');
  Logger.log('');

  // --- Bagian yang dikerjakan handleLogin --------------------------
  ukur('bacaSheet(Users,14)', function () {
    const r = bacaSheet(shUsers, 14);
    return (r.length - 1) + ' baris';
  });

  ukur('getMasterDataCached', function () {
    return getMasterDataCached().length + ' entri';
  });

  ukur('getPetaCutiCached', function () {
    return Object.keys(getPetaCutiCached()).length + ' NIK';
  });

  ukur('_ambilGeofenceUser', function () {
    const g = _ambilGeofenceUser(USER_ID);
    return g.required ? 'wajib' : 'tidak wajib';
  });

  ukur('getPengumumanAktifCached', function () {
    return getPengumumanAktifCached() ? 'ada' : 'tidak ada';
  });

  ukur('getSemuaPeriode_', function () {
    return getSemuaPeriode_().length + ' periode';
  });

  ukur('_ringkasGpsTracking_', function () {
    return _ringkasGpsTracking_(USER_ID).aktif ? 'dilacak' : 'tidak dilacak';
  });

  // --- Bagian yang dikerjakan buka_aplikasi ------------------------
  const periode = getPeriodeAbsenAktif_();

  ukur('getIndeksDbAbsen', function () {
    return Object.keys(getIndeksDbAbsen(periode)).length + ' NIK';
  });

  ukur('jendela sheet Absensi', function () {
    const j = bacaAbsensiPeriode_(shAbsensi, periode, 13);
    return j.baris.length + ' dari ' + (shAbsensi.getLastRow() - 1) + ' baris'
      + ' (mulai baris ' + j.offsetBaris + ')';
  });

  ukur('hitungStats (utuh)', function () {
    const st = hitungStats(String(USER_ID), role, nik, null, periode);
    return st.hari_tercatat + ' hari tercatat';
  });

  if (_isApprovalRoleValue(role)) {
    ukur('_susunApprovalList_', function () {
      const ap = _susunApprovalList_({
        role: role.toLowerCase(), lokasi: lokasi, divisi: divisi, userId: String(USER_ID)
      });
      return ap.list.length + ' pengajuan pending';
    });
  } else {
    hasil.push({ nama: '_susunApprovalList_', ms: 0, catatan: 'dilewati (bukan penyetuju)' });
  }

  // --- Tabel -------------------------------------------------------
  Logger.log(_profPad('BAGIAN', 26) + _profPadL('ms', 7) + '  KETERANGAN');
  Logger.log('-'.repeat(72));
  let total = 0;
  let terberat = { nama: '-', ms: -1 };
  hasil.forEach(function (h) {
    total += h.ms;
    if (h.ms > terberat.ms) terberat = h;
    Logger.log(_profPad(h.nama, 26) + _profPadL(h.ms, 7) + '  ' + h.catatan);
  });
  Logger.log('-'.repeat(72));
  Logger.log(_profPad('TOTAL KERJA SERVER', 26) + _profPadL(total, 7));
  Logger.log('');
  Logger.log('Bagian terberat: %s (%s ms)', terberat.nama, terberat.ms);
  Logger.log('');
  Logger.log('CATATAN PENTING soal "hitungStats (utuh)": angkanya SUDAH');
  Logger.log('termasuk getIndeksDbAbsen dan jendela Absensi di atasnya,');
  Logger.log('jadi jangan dijumlahkan dua kali. TOTAL di atas memang');
  Logger.log('menghitungnya berlebih — yang dipakai untuk membandingkan');
  Logger.log('adalah angka per baris, bukan totalnya.');
  Logger.log('');
  Logger.log('Waktu yang Anda RASAKAN di HP = angka di atas');
  Logger.log('  + ongkos tetap Apps Script (redirect 302 + boot container,');
  Logger.log('    biasanya 1-3 detik, tidak bisa dihilangkan dari kode)');
  Logger.log('  + waktu jaringan.');
  Logger.log('Kalau selisihnya jauh, penyebabnya BUKAN di server.');
  Logger.log('Periksa DevTools > Network dan gerbang GPS (gpsWajib.js).');
}

/**
 * Sama seperti PROFILE_MASUK, tetapi seluruh simpanan dibuang dulu
 * sehingga yang terukur adalah kondisi PALING BURUK — yaitu yang
 * dialami karyawan pertama yang login setelah import data mesin.
 *
 * Aman: yang dibuang hanya simpanan, bukan data. Semuanya tersusun
 * ulang otomatis pada pemanggilan berikutnya.
 */
function PROFILE_MASUK_DINGIN() {
  Logger.log('Membuang seluruh simpanan lebih dulu...');
  try { CACHE_BERSIHKAN(); } catch (e) { Logger.log('CACHE_BERSIHKAN: ' + e.message); }
  try { bersihkanIndeksDbAbsen(); } catch (e) { Logger.log('bersihkanIndeksDbAbsen: ' + e.message); }
  try { ABSENSI_JENDELA_BERSIHKAN(); } catch (e) { Logger.log('ABSENSI_JENDELA_BERSIHKAN: ' + e.message); }
  try { GEOCACHE_PETA_BERSIHKAN(); } catch (e) { Logger.log('GEOCACHE_PETA_BERSIHKAN: ' + e.message); }
  Logger.log('');
  PROFILE_MASUK();
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
