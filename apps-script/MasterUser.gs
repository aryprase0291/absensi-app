// =====================================================================
// MASTER USER (4 Nov 2026) — Admin Panel > Pengguna > Master user
//
// Satu layar untuk melihat & mengubah data user di sheet Users:
// identitas, divisi, ROLE (kode dari master role), LOKASI, dan AKSES FORM
// (kolom G, nilai dari Master Data kategori "Menu").
//
// Kolom sheet Users (indeks 0):
//   0 ID | 1 Username/ID finger | 2 Password | 3 Nama | 4 Divisi | 5 Role
//   6 Akses (form, dipisah koma) | 7 Payroll | 8 Sisa cuti | 9 Foto
//   10 Perusahaan | 11 Status karyawan | 12 Email atasan | 13 Lokasi
//   14.. = rumus VLOOKUP — tidak pernah dibaca/ditulis di sini.
//
// Admin bercakupan lokasi (AksesLokasi.gs, mis. Admin Jakarta) hanya
// melihat & mengubah user lokasinya, tidak bisa menyentuh user bertingkat
// admin, dan hanya bisa memberi role yang diizinkan _alRoleBoleh_.
// =====================================================================

const MU_KOLOM = 14;

function _muDaftarAkses_(v) {
  return (Array.isArray(v) ? v : String(v || '').split(','))
    .map(function (x) { return String(x || '').trim(); })
    .filter(Boolean);
}

function _muTeks_(v, maks) {
  return String(v == null ? '' : v).trim().slice(0, maks || 200);
}

/** Daftar role untuk pilihan di layar (dari simpanan master role). */
function _muDaftarRole_(auth) {
  const roles = (_mrSimpanan_().roles) || {};
  const terbatas = (typeof adminTerbatas_ === 'function') && adminTerbatas_(auth);
  return Object.keys(roles)
    .filter(function (k) { return roles[k].aktif !== false; })
    .filter(function (k) { return !terbatas || _alRoleBoleh_(k, auth.l) === ''; })
    .map(function (k) {
      const r = roles[k];
      return { value: k, label: r.nama || k, tingkat: r.tingkat, lokasi: r.lokasi || [], menu: r.menu || [] };
    })
    .sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
}

/** Isi jawaban get_user_list_admin (dipanggil handleGetUserListAdmin). */
function masterUserDaftar_(data) {
  const rows = bacaSheet(SS.getSheetByName(SHEET_USERS), MU_KOLOM);
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] || '').trim();
    if (!id) continue;
    const kode = String(r[5] || '').trim();
    const peran = peranEfektif_(kode, r[13]);
    list.push({
      uuid: id,
      username: r[1],
      nama: String(r[3] || ''),
      divisi: String(r[4] || ''),
      jabatan: kode,                 // nama lama, dipakai layar lain
      role: kode.toLowerCase(),
      roleNama: peran.nama || kode,
      tingkat: peran.tingkat,
      akses: _muDaftarAkses_(r[6]),
      payroll: String(r[7] || ''),
      perusahaan: String(r[10] || ''),
      statusKaryawan: String(r[11] || ''),
      emailAtasan: String(r[12] || ''),
      lokasi: String(r[13] || ''),
      menu: (typeof menuUser_ === 'function') ? menuUser_(id) : null   // null = ikut role
    });
  }
  list.sort(function (a, b) { return a.nama.localeCompare(b.nama); });
  return { list: list, roles: _muDaftarRole_(data && data._auth) };
}

/**
 * Aksi `update_user` (admin). Field dari layar:
 *   targetUuid, username, nama, divisi, roleUser, aksesUser[], payrollUser,
 *   perusahaan, statusKaryawan, emailAtasan, lokasiUser
 * (roleUser/payrollUser/lokasiUser sengaja bukan role/noPayroll/lokasi —
 *  ketiganya ditimpa atau dihapus authorizeRequest.)
 */
function handleUpdateUser(data) {
  const auth = data._auth || {};
  if (String(auth.r || '').toLowerCase() !== 'admin') {
    return responseJSON({ result: 'error', message: 'Hanya Admin yang boleh mengubah data user.' });
  }
  const target = _muTeks_(data.targetUuid, 80);
  if (!target) return responseJSON({ result: 'error', message: 'User belum dipilih.' });

  const nama = _muTeks_(data.nama, 120);
  const username = _muTeks_(data.username, 60);
  const role = _muTeks_(data.roleUser, 40).toLowerCase();
  const lokasi = _muDaftarAkses_(data.lokasiUser).join(', ');
  if (!nama) return responseJSON({ result: 'error', message: 'Nama wajib diisi.' });
  if (!username) return responseJSON({ result: 'error', message: 'ID finger wajib diisi.' });
  if (!role) return responseJSON({ result: 'error', message: 'Role wajib dipilih.' });
  if (!lokasi) return responseJSON({ result: 'error', message: 'Lokasi wajib dipilih.' });

  // TANPA ScriptLock (4 Nov 2026). Kunci global itu juga dipegang proses
  // panjang (Sinkron GSheet, Import mesin), sehingga simpan user sering
  // gagal "Server sedang sibuk". Yang ditulis hanya SATU baris yang
  // dicari ulang berdasarkan ID tepat sebelum ditulis — tidak butuh kunci.
  {
    const sheet = SS.getSheetByName(SHEET_USERS);
    const rows = bacaSheet(sheet, MU_KOLOM);
    let idx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === target) { idx = i; break; }
    }
    if (idx < 0) return responseJSON({ result: 'error', message: 'User tidak ditemukan.' });
    for (let i = 1; i < rows.length; i++) {
      if (i !== idx && String(rows[i][1] || '').trim() === username) {
        return responseJSON({ result: 'error', message: 'ID finger ' + username + ' sudah dipakai ' + rows[i][3] + '.' });
      }
    }
    const lama = rows[idx];
    const roleLama = String(lama[5] || '').trim().toLowerCase();
    const lokasiLama = String(lama[13] || '').trim();

    // Admin tidak boleh mengubah role / lokasi akunnya sendiri — mencegah
    // terkunci di luar Admin Panel karena salah klik.
    if (target === String(auth.u) && (role !== roleLama || lokasi !== lokasiLama)) {
      return responseJSON({ result: 'error', message: 'Role dan lokasi akun Anda sendiri tidak bisa diubah dari sini. Minta admin lain.' });
    }

    // MENU PER USER: hanya berarti untuk tingkat admin / HRD.
    const tingkatBaru = peranEfektif_(role, lokasi).tingkat;
    const menuKustom = data.menuKustom === true && (tingkatBaru === 'admin' || tingkatBaru === 'hrd');
    const menuLama = JSON.stringify(menuUser_(target));
    const menuPilihan = _muDaftarAkses_(data.menuUser).filter(function (k) { return MENU_KATALOG.indexOf(k) !== -1; });
    const menuBaru = JSON.stringify(menuKustom ? (menuPilihan.length ? menuPilihan : [MENU_TIDAK_ADA]) : null);
    if (target === String(auth.u) && menuLama !== menuBaru) {
      return responseJSON({ result: 'error', message: 'Menu akun Anda sendiri tidak bisa diubah dari sini. Minta admin lain.' });
    }

    const r = sheet.getRange(idx + 1, 1, 1, MU_KOLOM);
    const baris = r.getValues()[0];   // kolom lain (password, cuti, foto) tetap
    baris[1] = username;
    baris[3] = nama;
    baris[4] = _muTeks_(data.divisi, 80);
    baris[5] = role;
    baris[6] = _muDaftarAkses_(data.aksesUser).join(',');
    baris[7] = _muTeks_(data.payrollUser, 40).toUpperCase();
    baris[10] = _muTeks_(data.perusahaan, 80);
    baris[11] = _muTeks_(data.statusKaryawan, 60);
    baris[12] = _muTeks_(data.emailAtasan, 120);
    baris[13] = lokasi;
    // Hanya kolom yang memang diubah layar ini yang ditulis (B, D:H, K:N);
    // kolom C (password), I (cuti) dan J (foto) tidak disentuh sama sekali.
    sheet.getRange(idx + 1, 2).setValue(baris[1]);
    sheet.getRange(idx + 1, 4, 1, 5).setValues([baris.slice(3, 8)]);
    sheet.getRange(idx + 1, 11, 1, 4).setValues([baris.slice(10, 14)]);

    if (menuLama !== menuBaru) _muSimpanMenu_(target, menuKustom, menuPilihan);

    // Role / lokasi / menu berubah -> hak di token lama sudah tidak berlaku.
    // Cabut sesinya supaya user login ulang dengan hak yang baru.
    let catatanSesi = '';
    if ((role !== roleLama || lokasi !== lokasiLama || menuLama !== menuBaru) && typeof deviceCabutSesi === 'function') {
      try { deviceCabutSesi(target); catatanSesi = ' User ini perlu login ulang.'; } catch (e) { console.warn(e.message); }
    }
    if (typeof _alUsersMemo_ !== 'undefined') _alUsersMemo_ = null;
    try { if (typeof rekapCacheBatalkan_ === 'function') rekapCacheBatalkan_(); } catch (e) { console.warn(e.message); }
    const catatanSinkron = (typeof SUPABASE_SINKRON_SEGERA === 'function') ? SUPABASE_SINKRON_SEGERA('update_user') : '';

    return responseJSON({ result: 'success', message: 'Data ' + nama + ' tersimpan.' + catatanSesi + catatanSinkron });
  }
}

// =====================================================================
// MENU PER USER (4 Nov 2026) — khusus user bertingkat Admin / HRD
//
// Disimpan di Script Properties MENU_PER_USER: { userId: [kunci menu] }.
//   - user tidak ada di peta  -> ikut menu role-nya (master role)
//   - user ada di peta        -> HANYA menu yang tercantum
//     (daftar kosong disimpan sebagai [MENU_TIDAK_ADA] supaya tidak
//      terbaca "semua menu")
// Kunci menu sama dengan frontend (MasterUserPanel.js KATALOG_MENU).
// Ditegakkan dua lapis: frontend menyembunyikan menunya, authorizeRequest
// menolak aksinya (cekMenuAksi_).
// =====================================================================

const MU_MENU_PROP = 'MENU_PER_USER';
const MENU_TIDAK_ADA = '_tidak_ada';
const MENU_KATALOG = [
  'panel_admin', 'approval',
  'user', 'master_user', 'master_role',
  'analysis', 'master', 'import_db', 'bebas_absen', 'geomaster', 'geofence', 'period',
  'approval_team', 'perangkat', 'wajah', 'board',
  'rekap', 'gps', 'gps_audit', 'dashboard_kerani', 'log_login',
  'info_hrd'
];

// Aksi server -> kunci menu. Aksi yang tidak ada di sini tidak dibatasi menu.
const AKSI_MENU = {
  get_approval_list: 'approval', process_approval: 'approval',
  tambah_user: 'user',
  update_user: 'master_user', reset_password_user: 'master_user',
  segarkan_master_role: 'master_role',
  get_analysis_data: 'analysis',
  tambah_master: 'master',
  import_db_absen: 'import_db',
  save_geofence_master: 'geomaster',
  save_geofence_config: 'geofence', apply_geofence_divisi: 'geofence', apply_mode_absen_divisi: 'geofence',
  save_absence_period: 'period', save_absence_periods: 'period',
  get_approval_team_config: 'approval_team', save_approval_team_config: 'approval_team', set_approval_role: 'approval_team',
  get_device_list: 'perangkat', get_device_audit: 'perangkat', save_device_config: 'perangkat',
  lepas_device: 'perangkat', cabut_sesi_user: 'perangkat', set_device_mode: 'perangkat',
  get_wajah_list: 'wajah', daftar_wajah: 'wajah', hapus_wajah: 'wajah', set_face_config: 'wajah',
  get_rekap_admin: 'rekap', get_koreksi_list: 'rekap', save_koreksi: 'rekap', delete_koreksi: 'rekap',
  get_sinkron_gsheet: 'rekap', set_sinkron_gsheet: 'rekap', sinkron_gsheet: 'rekap',
  get_gps_live: 'gps', get_gps_trail: 'gps', get_gps_tracking_admin: 'gps',
  save_gps_tracking_config: 'gps', buat_laporan_gps: 'gps',
  get_gps_audit: 'gps_audit', run_gps_audit_historis: 'gps_audit',
  get_log_login: 'log_login',
  tambah_announcement: 'info_hrd'
};

let _muMenuMemo_ = null;
function menuPerUserPeta_() {
  if (_muMenuMemo_) return _muMenuMemo_;
  let obj = {};
  try { obj = JSON.parse(PropertiesService.getScriptProperties().getProperty(MU_MENU_PROP) || '{}') || {}; }
  catch (e) { console.warn('MENU_PER_USER rusak, dianggap kosong: ' + e.message); obj = {}; }
  _muMenuMemo_ = obj;
  return obj;
}

/** Menu khusus user ini, atau null bila ikut role. */
function menuUser_(userId) {
  const m = menuPerUserPeta_()[String(userId || '').trim()];
  if (!Array.isArray(m)) return null;
  return m.length ? m : [MENU_TIDAK_ADA];
}

function _muSimpanMenu_(userId, kustom, menu) {
  const id = String(userId || '').trim();
  const peta = menuPerUserPeta_();
  if (!kustom) delete peta[id];
  else {
    const bersih = _muDaftarAkses_(menu).filter(function (k) { return MENU_KATALOG.indexOf(k) !== -1; });
    peta[id] = bersih.length ? bersih : [MENU_TIDAK_ADA];
  }
  PropertiesService.getScriptProperties().setProperty(MU_MENU_PROP, JSON.stringify(peta));
  _muMenuMemo_ = peta;
}

/** '' = boleh. Hanya admin/HRD yang dibatasi menu; daftar kosong = semua. */
function cekMenuAksi_(action, auth) {
  const t = String((auth && auth.r) || '').toLowerCase();
  if (t !== 'admin' && t !== 'hrd') return '';
  const kunci = AKSI_MENU[action];
  if (!kunci) return '';
  const m = (auth && auth.menu) || [];
  if (!m.length || m.indexOf(kunci) !== -1) return '';
  return 'Menu ini tidak diaktifkan untuk akun Anda. Hubungi Admin (Master user).';
}
