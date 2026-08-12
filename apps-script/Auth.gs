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
    r: String(u.role || '').toLowerCase(),
    d: String(u.divisi || ''),
    l: String(u.lokasi || 'All'),
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
  'get_approval_list': ['admin', 'hrd', 'manager'],
  'process_approval': ['admin', 'hrd', 'manager'],

  // --- Admin & HRD ---
  'get_user_list_admin': ['admin', 'hrd'],
  'tambah_announcement': ['admin', 'hrd'],
  'update_remark_status': ['admin', 'hrd'],
  'update_status_absen': ['admin', 'hrd'],
  'get_analysis_data': ['admin', 'hrd'],

  // --- Admin saja ---
  'reset_password_user': ['admin'],
  'tambah_user': ['admin'],
  'tambah_master': ['admin'],
  'delete_absensi': ['admin'],
  'update_absensi': ['admin']
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

  const role = String(auth.r || '').toLowerCase();
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
  if (action === 'get_approval_list') {
    data.lokasi = auth.l;
    data.divisi = auth.d;
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
