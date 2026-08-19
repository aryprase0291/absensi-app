// =======================================================
// AUTENTIKASI TOKEN
// File: Auth.gs
//
// Menutup celah: sebelumnya doPost menerima action apa pun tanpa
// memverifikasi pemanggil, dan role dibaca dari data.roleRequester
// yang dikirim klien (bisa dipalsukan dengan mudah).
//
// Sekarang:
//   1. handleLogin menerbitkan token bertanda tangan HMAC-SHA256
//   2. doPost memverifikasi token sebelum merutekan action
//   3. role, userId, dan scope diambil DARI TOKEN — bukan dari body
//
// LANGKAH PASANG (sekali saja):
//   1. Tempel file ini sebagai "Auth.gs" di editor Apps Script
//   2. Jalankan fungsi SETUP_GENERATE_SECRET() satu kali
//   3. Terapkan patch di Code.gs (lihat PATCH-AUTH.md)
//   4. Deploy ulang: Deploy > Kelola deployment > edit > Versi baru
// =======================================================

const AUTH_SECRET_KEY = 'AUTH_SECRET';
const TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 jam

// =======================================================
// SETUP — JALANKAN SEKALI
// =======================================================

/**
 * Membuat secret acak dan menyimpannya di Script Properties.
 * Jalankan SATU KALI. Kalau dijalankan ulang, semua token yang
 * sedang aktif langsung hangus (semua user harus login lagi).
 */
function SETUP_GENERATE_SECRET() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(AUTH_SECRET_KEY);

  if (existing) {
    Logger.log('Secret SUDAH ADA. Tidak diubah.');
    Logger.log('Kalau benar-benar ingin mengganti (semua user harus login ulang),');
    Logger.log('jalankan SETUP_REGENERATE_SECRET_PAKSA().');
    return;
  }

  const secret = _generateRandomSecret();
  props.setProperty(AUTH_SECRET_KEY, secret);
  Logger.log('Secret berhasil dibuat dan disimpan di Script Properties.');
  Logger.log('Panjang: %s karakter. Nilainya tidak perlu Anda catat.', secret.length);
}

/**
 * Ganti secret secara paksa. Semua user akan terlempar ke login.
 * Pakai ini kalau secret diduga bocor.
 */
function SETUP_REGENERATE_SECRET_PAKSA() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(AUTH_SECRET_KEY, _generateRandomSecret());
  Logger.log('Secret diganti. Semua token lama hangus — user harus login ulang.');
}

function _generateRandomSecret() {
  // Gabungan UUID + digest waktu, lalu di-hash agar panjang & acak
  const seed = Utilities.getUuid() + '|' + new Date().getTime() + '|' + Math.random();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  return Utilities.base64EncodeWebSafe(bytes) + Utilities.getUuid();
}

function _getSecret() {
  const s = PropertiesService.getScriptProperties().getProperty(AUTH_SECRET_KEY);
  if (!s) {
    throw new Error(
      'AUTH_SECRET belum dibuat. Jalankan SETUP_GENERATE_SECRET() sekali di editor Apps Script.'
    );
  }
  return s;
}

// =======================================================
// TOKEN
// =======================================================

/**
 * Terbitkan token untuk user yang baru berhasil login.
 * @param {Object} u - { id, role, divisi, lokasi }
 * @return {string} token
 */
function createAuthToken(u) {
  const payload = {
    u: String(u.id),
    // .trim() WAJIB: kalau sel Role di sheet Users berisi "admin " dengan
    // spasi di belakang, tanpa trim si admin akan terkunci dari semua
    // action admin. Kasus ini sangat mudah terjadi pada data hasil ketik manual.
    r: String(u.role || '').trim().toLowerCase(),
    d: String(u.divisi || '').trim(),
    l: String(u.lokasi || 'All').trim(),
    e: new Date().getTime() + TOKEN_LIFETIME_MS
  };

  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + _sign(body);
}

function _sign(body) {
  const sig = Utilities.computeHmacSha256Signature(body, _getSecret());
  return Utilities.base64EncodeWebSafe(sig);
}

/**
 * Verifikasi token.
 * @return {Object|null} payload bila sah, null bila tidak
 */
function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const body = parts[0];
  const sig = parts[1];

  // Bandingkan tanda tangan dengan panjang tetap
  const expected = _sign(body);
  if (!_timingSafeEqual(sig, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString());
  } catch (err) {
    return null;
  }

  if (!payload || !payload.u || !payload.e) return null;
  if (new Date().getTime() > Number(payload.e)) return null; // kedaluwarsa

  return payload;
}

function _timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// =======================================================
// IZIN PER ACTION
// =======================================================

// '*' = semua user yang sudah login
// array = hanya role tersebut
const PUBLIC_ACTIONS = ['ping', 'check_version', 'login'];

const ACTION_ROLES = {
  // --- Semua user yang sudah login ---
  'get_latest_announcement': '*',
  'absen': '*',
  'edit_absen': '*',
  'delete_absen': '*',
  'get_history': '*',
  'get_db_absen': '*',
  'get_user_list_simple': '*',
  'get_stats': '*',
  'get_absence_period': '*',
  'ganti_password': '*',
  'upload_profile': '*',
  'send_remark': '*',
  'get_remarks': '*',
  'submit_shift_schedule': '*',
  'get_shift_history': '*',
  'delete_shift_schedule': '*',
  'edit_shift_schedule': '*',
  'request_approval_email': '*',

  // --- Penyetuju (sesuai App.js: canApprove) ---
  // Kepala divisi/supervisor diberi jalur yang sama seperti manager.
  'get_approval_list': ['admin', 'hrd', 'manager', 'kepala', 'kepala_divisi', 'supervisor', 'spv', 'pimpinan'],
  'process_approval': ['admin', 'hrd', 'manager', 'kepala', 'kepala_divisi', 'supervisor', 'spv', 'pimpinan'],
  'get_team_history': ['admin', 'hrd', 'manager', 'kepala', 'kepala_divisi', 'supervisor', 'spv', 'pimpinan'],

  // --- Admin & HRD ---
  'get_user_list_admin': ['admin', 'hrd'],
  'get_geofence_config': ['admin', 'hrd'],
  'tambah_announcement': ['admin', 'hrd'],
  'update_remark_status': ['admin', 'hrd'],
  'update_status_absen': ['admin', 'hrd'],
  'get_analysis_data': ['admin', 'hrd'],

  // --- Admin saja ---
  'get_approval_team_config': ['admin'],
  'save_approval_team_config': ['admin'],
  'set_approval_role': ['admin'],
  'reset_password_user': ['admin'],
  'save_geofence_config': ['admin'],
  'save_absence_period': ['admin'],
  'tambah_user': ['admin'],
  'tambah_master': ['admin'],
  'delete_absensi': ['admin'],
  'update_absensi': ['admin'],

  // Menimpa isi sheet dbabsen — sengaja admin saja, tanpa HRD.
  'import_db_absen': ['admin']
};

/**
 * Gerbang utama. Dipanggil di awal doPost.
 *
 * Bila lolos, fungsi ini MENIMPA field pada `data` yang sebelumnya
 * dipercaya mentah dari klien, sehingga seluruh handler lama otomatis
 * ikut aman tanpa perlu diubah satu per satu.
 *
 * @return {Object} { ok: boolean, message?: string, auth?: Object }
 */
function authorizeRequest(data) {
  const action = data.action;

  if (PUBLIC_ACTIONS.indexOf(action) !== -1) {
    return { ok: true, auth: null };
  }

  const rule = ACTION_ROLES[action];
  if (rule === undefined) {
    return { ok: false, message: 'Action tidak dikenal.' };
  }

  const auth = verifyAuthToken(data.token);
  if (!auth) {
    return { ok: false, message: 'SESI_HABIS' };
  }

  const role = String(auth.r || '').trim().toLowerCase();
  if (rule !== '*' && rule.indexOf(role) === -1) {
    return { ok: false, message: 'Akses ditolak untuk role Anda.' };
  }

  // ---------------------------------------------------------
  // Timpa field yang tadinya bisa dipalsukan klien
  // ---------------------------------------------------------

  data._auth = auth;

  // Identitas: seluruh handler memakai data.userId / data.id
  // sebagai "diri sendiri", jadi aman ditimpa menyeluruh.
  data.userId = auth.u;
  data.id = auth.u;

  // Role: dulu dibaca dari data.role / data.roleRequester
  data.role = role;
  data.roleRequester = role;

  // handleGetDbAbsen menerima noPayroll dari klien; hapus agar
  // selalu diturunkan dari userId hasil token.
  delete data.noPayroll;

  // Hak melihat data semua orang — sebelumnya klien cukup mengirim
  // canViewAll:true untuk membaca riwayat seluruh karyawan.
  // Samakan dengan aturan di App.js: ['admin','hrd'].
  data.canViewAll = (role === 'admin' || role === 'hrd');

  // CATATAN PENTING soal `data.lokasi`:
  // field ini punya DUA arti berbeda tergantung action —
  //   - handleAbsen      : lokasi GPS tempat absen (data user, jangan ditimpa!)
  //   - handleGetApprovalList : lokasi kantor si admin (scope, harus ditimpa)
  // Karena itu penimpaan dilakukan per-action, bukan menyeluruh.
  if (action === 'get_approval_list' || action === 'process_approval') {
    data.lokasi = auth.l;
    data.divisi = auth.d;
  }

  // handleGetUserListSimple memakai data.lokasi sebagai batas wilayah
  // si peminta. Tanpa penimpaan ini, karyawan biasa cukup mengirim
  // lokasi:'All' untuk memperoleh daftar nama SELURUH karyawan.
  // Nilai dari token identik dengan yang dikirim App.js
  // (`lokasi: user.lokasi || 'All'`), jadi perilaku normal tidak berubah.
  // Penyaringan tetap lewat data.filterLokasi yang memang pilihan UI.
  if (action === 'get_user_list_simple') {
    data.lokasi = auth.l || 'All';
  }

  // handleGetHistory memakai requestorLokasi sebagai penyaring lokasi.
  // Hanya super admin (admin dengan lokasi 'All') boleh memilih lokasi
  // secara bebas; sisanya dipaksa ke lokasi miliknya sendiri.
  if (action === 'get_history') {
    const isSuperAdmin = (role === 'admin' && auth.l === 'All');
    if (!isSuperAdmin) {
      data.requestorLokasi = auth.l || 'All';
    }
  }

  return { ok: true, auth: auth };
}

// =======================================================
// PEMERIKSAAN SEBELUM DEPLOY — JALANKAN SEBELUM KE PRODUKSI
// =======================================================

/**
 * Read-only. Mencocokkan role yang benar-benar ada di sheet Users
 * dengan tabel izin ACTION_ROLES.
 *
 * Tujuannya mencegah satu risiko nyata: kalau ada role di sheet yang
 * tidak terdaftar di tabel izin (misal 'pimpinan', 'spv', atau 'manager'
 * yang ternyata ditulis 'Manager Ops'), user itu akan kehilangan akses ke
 * menu approval / admin begitu patch aktif.
 *
 * JALANKAN INI DULU sebelum deploy ke produksi, dan baca log-nya.
 */
function PREFLIGHT_CEK_ROLE() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  if (!sheet) { Logger.log('Sheet Users tidak ditemukan.'); return; }

  const rows = sheet.getDataRange().getValues();

  // Role yang mendapat hak istimewa di ACTION_ROLES
  const istimewa = {};
  Object.keys(ACTION_ROLES).forEach(function (a) {
    const r = ACTION_ROLES[a];
    if (r !== '*') r.forEach(function (x) { istimewa[x] = true; });
  });

  const hitung = {};
  const spasiNakal = [];
  const kosong = [];

  for (let i = 1; i < rows.length; i++) {
    const mentah = rows[i][5];
    const nama = rows[i][3];
    const asli = String(mentah === null || mentah === undefined ? '' : mentah);
    const bersih = asli.trim().toLowerCase();

    if (bersih === '') { kosong.push((i + 1) + ' · ' + nama); continue; }
    if (asli !== asli.trim()) spasiNakal.push((i + 1) + ' · ' + nama + ' · "' + asli + '"');

    hitung[bersih] = (hitung[bersih] || 0) + 1;
  }

  Logger.log('='.repeat(60));
  Logger.log('ROLE YANG ADA DI SHEET USERS');
  Logger.log('='.repeat(60));

  const daftar = Object.keys(hitung).sort();
  daftar.forEach(function (r) {
    const status = istimewa[r]
      ? 'punya hak khusus di tabel izin'
      : 'user biasa (hanya action bertanda *)';
    Logger.log(('  ' + r + '                        ').slice(0, 24) + ('     ' + hitung[r]).slice(-5) + ' orang   -> ' + status);
  });

  Logger.log('');
  Logger.log('-'.repeat(60));

  // Role di tabel izin yang tidak dipakai siapa pun
  const tidakTerpakai = Object.keys(istimewa).filter(function (r) { return !hitung[r]; });
  if (tidakTerpakai.length) {
    Logger.log('CATATAN: role ini ada di tabel izin tapi tidak dipakai user mana pun:');
    Logger.log('  ' + tidakTerpakai.join(', '));
    Logger.log('  (tidak berbahaya — hanya berarti aturannya menganggur)');
    Logger.log('');
  }

  // Yang perlu ditindak
  let aman = true;

  if (spasiNakal.length) {
    aman = false;
    Logger.log('!! PERLU DIBERESKAN — role berisi spasi di depan/belakang:');
    spasiNakal.forEach(function (x) { Logger.log('   baris ' + x); });
    Logger.log('   Sudah diamankan oleh .trim() di kode, tapi sebaiknya');
    Logger.log('   dirapikan di sheet agar tidak membingungkan.');
    Logger.log('');
  }

  if (kosong.length) {
    aman = false;
    Logger.log('!! PERLU DIBERESKAN — user tanpa role (akan jadi user biasa):');
    kosong.forEach(function (x) { Logger.log('   baris ' + x); });
    Logger.log('');
  }

  // Role tak dikenal yang TERLIHAT seperti seharusnya punya hak khusus
  const curiga = daftar.filter(function (r) {
    if (istimewa[r]) return false;
    return /admin|hrd|manager|pimpinan|spv|supervisor|kepala|direk|owner/.test(r);
  });
  if (curiga.length) {
    aman = false;
    Logger.log('!! PERIKSA — role ini TIDAK punya hak khusus di tabel izin,');
    Logger.log('   padahal namanya terdengar seperti jabatan berwenang:');
    curiga.forEach(function (r) { Logger.log('   "' + r + '" (' + hitung[r] + ' orang)'); });
    Logger.log('   Kalau mereka memang perlu akses approval/admin, tambahkan');
    Logger.log('   nama role tersebut ke ACTION_ROLES di Auth.gs SEBELUM deploy.');
    Logger.log('');
  }

  Logger.log('='.repeat(60));
  Logger.log(aman ? 'HASIL: aman untuk lanjut deploy.' : 'HASIL: ada yang perlu diperiksa dulu (lihat di atas).');
  Logger.log('='.repeat(60));
}

// =======================================================
// DIAGNOSTIK — read-only. Menguji pipeline token tanpa kredensial user.
// =======================================================
function DIAG_TOKEN() {
  Logger.log("--- 1. cek secret ---");
  var s;
  try { s = _getSecret(); Logger.log("secret ADA, panjang " + s.length); }
  catch (e) { Logger.log("GAGAL ambil secret: " + e.message); return; }

  Logger.log("--- 2. buat token uji ---");
  var tok;
  try {
    tok = createAuthToken({ id: "DIAG-TEST", role: "karyawan", divisi: "X", lokasi: "All" });
    Logger.log("token OK, panjang " + tok.length + ", jumlah titik " + (tok.split(".").length - 1));
  } catch (e) { Logger.log("GAGAL createAuthToken: " + e.message); Logger.log(e.stack); return; }

  Logger.log("--- 3. verifikasi token uji ---");
  try { Logger.log("hasil: " + JSON.stringify(verifyAuthToken(tok))); }
  catch (e) { Logger.log("GAGAL verify: " + e.message); return; }

  Logger.log("--- 4. pakai data user NYATA (baris 2 sheet Users) ---");
  try {
    var rows = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Users").getDataRange().getValues();
    var u = rows[1];
    Logger.log("id=" + u[0] + " role=" + u[5] + " divisi=" + u[4] + " lokasi=" + u[13]);
    var t2 = createAuthToken({ id: u[0], role: u[5], divisi: u[4], lokasi: u[13] });
    Logger.log("token user nyata OK, panjang " + t2.length);
    Logger.log("verifikasi: " + JSON.stringify(verifyAuthToken(t2)));
  } catch (e) { Logger.log("GAGAL di data user nyata: " + e.message); Logger.log(e.stack); }

  Logger.log("--- 5. simulasi responseJSON lengkap seperti handleLogin ---");
  try {
    var out = handleLogin({ action: "login", username: "__tidak_ada__", password: "__x__" });
    Logger.log("handleLogin (user tidak ada) mengembalikan objek: " + (out ? "ya" : "tidak"));
  } catch (e) { Logger.log("GAGAL handleLogin: " + e.message); Logger.log(e.stack); }

  Logger.log("--- SELESAI ---");
}
