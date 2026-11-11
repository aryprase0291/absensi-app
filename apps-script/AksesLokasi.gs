// =====================================================================
// ADMIN BERCAKUPAN LOKASI (4 Nov 2026) — mis. Admin Jakarta (admin_jkt)
//
// Role di master_role bertingkat "admin" tetapi BUKAN kode "admin" dan
// cakupan lokasinya bukan All (contoh: admin_jkt -> ['Jakarta']).
// Admin seperti ini:
//   - boleh melihat & mengelola karyawan lokasinya saja (rekap, koreksi,
//     approval, riwayat, laporan, tambah/reset user, Dashboard GPS);
//   - TIDAK boleh menyentuh pengaturan global (AKSI_ADMIN_PUSAT).
//
// Role kode "admin" tidak pernah terbatas, berapa pun isi kolom Lokasi
// user-nya — perilaku admin yang sudah ada tidak berubah.
//
// Tiga lapis, semuanya hanya aktif untuk admin terbatas:
//   1. aksesLokasiGerbang_  (dipanggil authorizeRequest): tolak aksi pusat
//      & periksa karyawan yang menjadi sasaran aksi.
//   2. aksesLokasiSaring_   (dipanggil doPost): saring jawaban daftar.
//   3. Penyaring lama HRD (rekap, ABSEN-EMAIL, koreksi, laporan) ikut
//      dipakai untuk admin terbatas.
// =====================================================================

const AKSI_ADMIN_PUSAT = [
  'segarkan_master_role', 'import_db_absen', 'tambah_master',
  'save_absence_period', 'save_absence_periods',
  'save_geofence_config', 'save_geofence_master', 'apply_geofence_divisi',
  'apply_mode_absen_divisi',
  'get_approval_team_config', 'save_approval_team_config', 'ganti_atasan_approval', 'set_approval_role',
  'set_sinkron_gsheet', 'sinkron_gsheet',
  'get_log_login', 'get_device_list', 'get_device_audit', 'save_device_config',
  'lepas_device', 'cabut_sesi_user', 'set_device_mode',
  'get_wajah_list', 'daftar_wajah', 'hapus_wajah', 'set_face_config',
  'get_analysis_data', 'run_gps_audit_historis', 'update_absensi'
];

function _cakupanSemua_(c) {
  const s = String(c == null ? '' : c).trim();
  return !s || s.toLowerCase() === 'all' || s === '*';
}

/** Admin dengan cakupan lokasi terbatas (mis. admin_jkt)? */
function adminTerbatas_(auth) {
  if (!auth) return false;
  if (String(auth.r || '').toLowerCase() !== 'admin') return false;
  if (String(auth.rk || 'admin').toLowerCase() === 'admin') return false;
  return !_cakupanSemua_(auth.l);
}

/** Pemohon yang daftarnya disaring per lokasi: HRD bercakupan atau admin terbatas. */
function pemohonBercakupan_(auth) {
  if (!auth) return false;
  if (adminTerbatas_(auth)) return true;
  return String(auth.r || '').toLowerCase() === 'hrd' && !_cakupanSemua_(auth.l);
}

let _alUsersMemo_ = null;
function _alUsers_() {
  if (!_alUsersMemo_) _alUsersMemo_ = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
  return _alUsersMemo_;
}

/** Set ID user (kolom A) dalam cakupan. */
function _alIdDalam_(cakupan) {
  const rows = _alUsers_();
  const set = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (id && cocokLokasi_(cakupan, rows[i][13])) set[id] = true;
  }
  return set;
}

function _alIdBoleh_(cakupan, userId) {
  const id = String(userId || '').trim();
  return !!id && !!_alIdDalam_(cakupan)[id];
}

/** Pemilik baris (kolom C) pada sheet berdasarkan UUID di kolom A. */
function _alPemilikUuid_(namaSheet, uuid) {
  const u = String(uuid || '').trim();
  if (!u) return '';
  const sheet = SS.getSheetByName(namaSheet);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]).trim() === u) return String(rows[i][2] || '').trim();
  }
  return '';
}

/** User sasaran bertingkat admin? (Admin lokasi tidak boleh menyentuhnya.) */
function _alTargetAdmin_(userId) {
  const id = String(userId || '').trim();
  const rows = _alUsers_();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === id) return peranEfektif_(rows[i][5], rows[i][13]).tingkat === 'admin';
  }
  return false;
}

/** Satu koreksi menurut id (null bila tidak ada). */
function _alKoreksi_(id) {
  const k = String(id || '').trim();
  if (!k) return null;
  const list = bacaDaftarKoreksi_('', '') || [];
  for (let i = 0; i < list.length; i++) if (String(list[i] && list[i].id) === k) return list[i];
  return null;
}

/** Cakupan role dari master (untuk role yang mau diberikan admin terbatas). */
function _alRoleBoleh_(kodeRole, cakupanPemohon) {
  const kode = String(kodeRole || '').trim().toLowerCase();
  if (!kode) return 'Role belum dipilih.';
  const p = peranEfektif_(kode, cakupanPemohon);
  if (p.tingkat === 'admin') return 'Admin lokasi tidak boleh membuat user bertingkat Admin.';
  const lok = ((_mrSimpanan_().roles || {})[kode] || {}).lokasi || [];
  if (lok.indexOf('*') !== -1) return 'Role ' + kode + ' melihat semua lokasi — hanya Admin pusat yang boleh memberikannya.';
  for (let i = 0; i < lok.length; i++) {
    if (!cocokLokasi_(cakupanPemohon, lok[i])) return 'Role ' + kode + ' untuk lokasi ' + lok[i] + ' — di luar cakupan Anda.';
  }
  return '';
}

/**
 * Lapis 1. Dipanggil authorizeRequest SETELAH data._auth terisi.
 * @return {string} '' = boleh, selain itu pesan penolakan.
 */
function aksesLokasiGerbang_(action, data, auth) {
  if (!adminTerbatas_(auth)) return '';
  const c = auth.l;
  const luar = 'Karyawan ini di luar lokasi akses Anda (' + c + ').';

  if (AKSI_ADMIN_PUSAT.indexOf(action) !== -1) {
    // Administrator boleh membuka menu pusat untuk admin lokasi lewat
    // Master User > Akses menu (centang manual). Pilihan itu yang menang.
    const kunciMenu = (typeof AKSI_MENU !== 'undefined') ? AKSI_MENU[action] : '';
    const dicentang = !!kunciMenu && Array.isArray(auth.menu) && auth.menu.indexOf(kunciMenu) !== -1;
    if (!dicentang) return 'Menu ini khusus Admin pusat. Akun Anda dibatasi lokasi ' + c + '.';
  }

  switch (action) {
    case 'get_team_history':
      data.lokasi = c;
      return '';
    case 'get_sinkron_gsheet':
      return String(data.bagian || '') === 'absensi_email' ? '' : 'Bagian ini khusus Admin pusat.';
    case 'process_approval':
    case 'update_status_absen':
    case 'delete_absensi':
      return _alIdBoleh_(c, _alPemilikUuid_(SHEET_ABSENSI, data.uuid)) ? '' : luar;
    case 'update_remark_status':
    case 'delete_remark':
      return _alIdBoleh_(c, _alPemilikUuid_(SHEET_REMARKS, data.uuid)) ? '' : luar;
    case 'reset_password_user':
      if (!_alIdBoleh_(c, data.targetUuid)) return luar;
      return _alTargetAdmin_(data.targetUuid) ? 'User bertingkat Admin hanya bisa diubah Admin pusat.' : '';
    case 'update_user': {
      if (!_alIdBoleh_(c, data.targetUuid)) return luar;
      if (_alTargetAdmin_(data.targetUuid)) return 'User bertingkat Admin hanya bisa diubah Admin pusat.';
      if (!cocokLokasi_(c, data.lokasiUser)) return 'Lokasi user harus ' + c + '.';
      return _alRoleBoleh_(data.roleUser, c);
    }
    case 'tambah_user': {
      if (!cocokLokasi_(c, data.lokasi)) return 'Lokasi user baru harus ' + c + '.';
      return _alRoleBoleh_(data.roleBaru, c);
    }
    case 'save_koreksi': {
      const set = payrollDalamCakupan_(c) || {};
      if (!set[String(data.payroll || '').trim().toUpperCase()]) return luar;
      // Mengedit koreksi yang sudah ada: koreksi lamanya juga harus milik lokasi ini.
      const idLama = String(data.koreksiId || '').trim();
      if (!idLama) return '';
      const lama = _alKoreksi_(idLama);
      return (!lama || set[String(lama.payroll || '').trim().toUpperCase()]) ? '' : luar;
    }
    case 'delete_koreksi': {
      const lama = _alKoreksi_(data.koreksiId);
      if (!lama) return 'Data koreksi tidak ditemukan.';
      const set = payrollDalamCakupan_(c) || {};
      return set[String(lama.payroll || '').trim().toUpperCase()] ? '' : luar;
    }
    case 'get_gps_trail':
      return _alIdBoleh_(c, data.targetUserId || data.userIdTarget) ? '' : luar;
    case 'save_gps_tracking_config':
    case 'get_gps_tracking_admin':
      if (action === 'get_gps_tracking_admin' && !data.targetUserId) return '';
      if (String(data.targetUserId || '').toUpperCase() === 'SEMUA') return 'Ubah pelacakan SEMUA karyawan khusus Admin pusat.';
      return _alIdBoleh_(c, data.targetUserId) ? '' : luar;
    case 'buat_laporan_gps':
      if (!String(data.targetUserId || '').trim()) return 'Pilih karyawan terlebih dahulu (laporan semua karyawan khusus Admin pusat).';
      return _alIdBoleh_(c, data.targetUserId) ? '' : luar;
    default:
      return '';
  }
}

/** Lapis 2. Saring jawaban berbentuk daftar per userId. */
function aksesLokasiSaring_(action, keluaran, data) {
  const auth = data && data._auth;
  if (!adminTerbatas_(auth) || !keluaran || typeof keluaran.getContent !== 'function') return keluaran;
  const kunci = {
    get_user_list_admin: ['list', 'uuid'],
    get_gps_live: ['daftar', 'userId'],
    get_gps_tracking_admin: ['daftar', 'userId'],
    get_gps_audit: ['kejadian', 'userId']
  }[action];
  if (!kunci) return keluaran;
  let j;
  try { j = JSON.parse(keluaran.getContent()); } catch (e) { return keluaran; }
  if (!j || j.result !== 'success' || !Array.isArray(j[kunci[0]])) return keluaran;
  const set = _alIdDalam_(auth.l);
  j[kunci[0]] = j[kunci[0]].filter(function (x) { return !!set[String((x && x[kunci[1]]) || '').trim()]; });
  if (action === 'get_gps_live' && j.ringkasan) {
    const d = j.daftar;
    j.ringkasan = {
      total: d.length,
      online: d.filter(function (x) { return x.status === 'ONLINE'; }).length,
      idle: d.filter(function (x) { return x.status === 'IDLE'; }).length,
      offline: d.filter(function (x) { return x.status === 'OFFLINE'; }).length,
      luarArea: d.filter(function (x) { return x.statusArea === 'LUAR AREA'; }).length
    };
  }
  j.cakupanLokasi = auth.l;
  return ContentService.createTextOutput(JSON.stringify(j)).setMimeType(ContentService.MimeType.JSON);
}
