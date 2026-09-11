// =======================================================
// PENGUNCIAN PERANGKAT — 1 PERANGKAT 1 AKUN, 1 AKUN 1 SESI
// File: Devices.gs
//
// Menutup dua celah yang berbeda, jangan tertukar:
//
//   A. TITIP ABSEN. Satu HP dipakai bergantian oleh beberapa karyawan.
//      Dijaga oleh pengikatan DeviceID -> UserID beserta KUOTA per
//      perangkat (kuota > 1 khusus HP milik PIC yang mengabsenkan timnya).
//
//   B. AKUN DIPINJAMKAN. Satu akun dipakai dari dua HP sekaligus.
//      Dijaga oleh SESI TUNGGAL: login baru menerbitkan SessionID baru
//      dan LANGSUNG menggusur sesi lama. Token lama masih bertanda tangan
//      sah, tapi SessionID-nya sudah bukan yang berlaku, jadi ditolak.
//
// KENAPA SESI DISIMPAN DI SCRIPT PROPERTIES, BUKAN DI SHEET.
// Pemeriksaan sesi berjalan pada SETIAP request (di authorizeRequest).
// Membaca sheet di jalur itu berarti menambah ratusan sel pada tiap
// pemanggilan API — persis jenis biaya yang susah payah dipangkas di
// 1.0.14. Script Properties dibaca satu kunci, sekali, dan murah.
// Sheet `SesiAktif` hanya CERMIN untuk dibaca admin; ditulis saat login,
// tidak pernah dibaca di jalur panas.
//
// MODE (Script Properties `DEVICE_MODE`):
//   'off'    - fitur mati total. Semua pemeriksaan dilewati.
//   'tandai' - DEFAULT. Login tidak pernah diblokir; pelanggaran dicatat
//              sebagai tanda pada sesi dan pada absensi, untuk ditinjau.
//   'ketat'  - perangkat yang kuotanya sudah penuh menolak akun asing.
//
// Perangkat ber-Status 'diblokir' DITOLAK pada semua mode kecuali 'off'.
// Itu tuas admin yang tetap punya gigi walau mode masih 'tandai'.
// =======================================================

const DEVICE_SHEET = 'Devices';
const DEVICE_USER_SHEET = 'DeviceUser';
const DEVICE_SESI_SHEET = 'SesiAktif';
const DEVICE_AUDIT_SHEET = 'DeviceAudit';

const DEVICE_HEADERS = [
  'DeviceID', 'Label', 'KuotaLogin', 'Platform', 'UserAgent',
  'Status', 'PertamaLihat', 'TerakhirLihat', 'Catatan', 'UpdatedBy', 'UpdatedAt'
];
const DEVICE_USER_HEADERS = [
  'DeviceID', 'UserID', 'Nama', 'Username', 'PertamaLogin', 'TerakhirLogin', 'JumlahLogin', 'Status'
];
const DEVICE_SESI_HEADERS = [
  'UserID', 'Nama', 'SessionID', 'DeviceID', 'LoginAt', 'TerakhirAktif', 'Platform', 'Tanda'
];
const DEVICE_AUDIT_HEADERS = [
  'Waktu', 'UserID', 'Nama', 'DeviceID', 'Aksi', 'Tanda', 'Detail'
];

const DEVICE_MODE_KEY = 'DEVICE_MODE';
const DEVICE_SESI_PREFIX = 'SESI_';
const DEVICE_KUOTA_DEFAULT = 1;
const DEVICE_AUDIT_MAKS_BARIS = 4000;

// Tanda yang bisa menempel pada satu sesi / satu absen.
const DEVICE_TANDA = {
  BERSIH: '',
  TANPA_ID: 'tanpa_id_perangkat',
  PERANGKAT_BARU: 'perangkat_baru',
  PERANGKAT_ORANG_LAIN: 'perangkat_milik_orang_lain',
  KUOTA_PENUH: 'kuota_perangkat_penuh'
};

// =======================================================
// KONFIGURASI
// =======================================================

function deviceMode() {
  try {
    const v = String(PropertiesService.getScriptProperties().getProperty(DEVICE_MODE_KEY) || '').trim().toLowerCase();
    if (v === 'off' || v === 'ketat' || v === 'tandai') return v;
  } catch (e) { /* properties tidak terbaca: jatuh ke default */ }
  return 'tandai';
}

function deviceAktif() {
  return deviceMode() !== 'off';
}

/**
 * Dipakai admin dari Panel. Dikembalikan juga oleh get_device_list
 * supaya layar admin selalu menampilkan mode yang benar-benar berlaku.
 */
function deviceSetMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (['off', 'tandai', 'ketat'].indexOf(m) === -1) {
    throw new Error('Mode perangkat tidak dikenal: ' + mode);
  }
  PropertiesService.getScriptProperties().setProperty(DEVICE_MODE_KEY, m);
  return m;
}

// =======================================================
// SHEET
// =======================================================

function _devSheet(nama, headers) {
  let sh = SS.getSheetByName(nama);
  if (!sh) {
    sh = SS.insertSheet(nama);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) { /* boleh gagal */ }
    return sh;
  }
  // Sheet sudah ada tapi kosong (mis. dibuat manual) -> pasang header.
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _devNormId(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

function _devWaktu() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// =======================================================
// SESI TUNGGAL
// =======================================================

function _devKunciSesi(userId) {
  return DEVICE_SESI_PREFIX + _devNormId(userId);
}

/**
 * SessionID yang sedang berlaku untuk satu user, atau '' bila tidak ada.
 * Satu pembacaan properti. Inilah satu-satunya biaya yang ditambahkan
 * fitur ini ke jalur panas.
 */
function deviceSesiBerlaku(userId) {
  try {
    return _devNormId(PropertiesService.getScriptProperties().getProperty(_devKunciSesi(userId)));
  } catch (e) {
    return '';
  }
}

function deviceTerbitkanSesi(userId) {
  const sid = Utilities.getUuid().replace(/-/g, '').substring(0, 20);
  try {
    PropertiesService.getScriptProperties().setProperty(_devKunciSesi(userId), sid);
  } catch (e) {
    // Gagal menyimpan sesi TIDAK boleh menggagalkan login. Kalau ini
    // terjadi, sesi sebelumnya tetap berlaku dan token baru akan ditolak
    // pada request berikutnya — user tinggal login ulang.
    console.warn('Gagal menyimpan SessionID: ' + e.message);
  }
  return sid;
}

/**
 * Cabut sesi seorang user (dipakai admin: "paksa logout").
 */
function deviceCabutSesi(userId) {
  try {
    PropertiesService.getScriptProperties().deleteProperty(_devKunciSesi(userId));
  } catch (e) { /* abaikan */ }
}

// =======================================================
// PEMERIKSAAN SAAT LOGIN
// =======================================================

/**
 * Dipanggil dari handleLogin SETELAH password terbukti benar.
 *
 * @param {Object} u    - { id, nama, username }
 * @param {Object} data - body request (deviceId, devicePlatform, deviceUA, deviceLabel)
 * @return {Object} { boleh, pesan, tanda, deviceId, sessionId, pemilik }
 *
 * Fungsi ini TIDAK PERNAH melempar. Kegagalan tak terduga di sini akan
 * mengunci seluruh karyawan dari aplikasi, jadi semua jalur error
 * berakhir "boleh: true" dengan tanda 'gagal_periksa'.
 */
function devicePeriksaLogin(u, data) {
  const hasil = {
    boleh: true,
    pesan: '',
    tanda: DEVICE_TANDA.BERSIH,
    deviceId: '',
    sessionId: '',
    pemilik: ''
  };

  if (!deviceAktif()) {
    hasil.sessionId = deviceTerbitkanSesi(u.id);
    return hasil;
  }

  const deviceId = _devNormId(data && data.deviceId);
  hasil.deviceId = deviceId;

  // Klien lama (bundle < 1.0.19) tidak mengirim deviceId sama sekali.
  // Menolaknya berarti mengunci semua HP yang belum sempat memuat ulang
  // bundle baru — jadi dilewatkan, tetapi ditandai.
  if (!deviceId) {
    hasil.tanda = DEVICE_TANDA.TANPA_ID;
    hasil.sessionId = deviceTerbitkanSesi(u.id);
    _deviceCatatAudit(u, '', 'login', hasil.tanda, 'Klien tidak mengirim ID perangkat.');
    return hasil;
  }

  const lock = LockService.getScriptLock();
  let dapatLock = false;
  try {
    dapatLock = lock.tryLock(8000);
  } catch (e) {
    dapatLock = false;
  }

  try {
    const info = _deviceDaftarkan(u, data, deviceId);
    hasil.tanda = info.tanda;
    hasil.pemilik = info.pemilik;

    if (info.diblokir) {
      hasil.boleh = false;
      hasil.pesan = info.pesan;
      _deviceCatatAudit(u, deviceId, 'login_ditolak', info.tanda, info.pesan);
      return hasil;
    }

    if (info.tanda) {
      _deviceCatatAudit(u, deviceId, 'login', info.tanda, info.pesan || '');
    }
  } catch (e) {
    // Fail-open yang disengaja. Lihat catatan di JSDoc.
    console.error('devicePeriksaLogin gagal: ' + e.message);
    hasil.tanda = 'gagal_periksa';
  } finally {
    if (dapatLock) { try { lock.releaseLock(); } catch (e) { /* abaikan */ } }
  }

  hasil.sessionId = deviceTerbitkanSesi(u.id);
  _deviceTulisSesi(u, deviceId, hasil.sessionId, data, hasil.tanda);
  return hasil;
}

/**
 * Daftarkan/perbarui perangkat dan ikatannya ke user.
 * @return {Object} { diblokir, pesan, tanda, pemilik }
 */
function _deviceDaftarkan(u, data, deviceId) {
  const mode = deviceMode();
  const shDev = _devSheet(DEVICE_SHEET, DEVICE_HEADERS);
  const shBind = _devSheet(DEVICE_USER_SHEET, DEVICE_USER_HEADERS);
  const waktu = _devWaktu();

  const rowsDev = bacaSheet(shDev, DEVICE_HEADERS.length);
  let barisDev = -1;
  for (let i = 1; i < rowsDev.length; i++) {
    if (_devNormId(rowsDev[i][0]) === deviceId) { barisDev = i; break; }
  }

  const platform = _devNormId(data.devicePlatform).substring(0, 120);
  const ua = _devNormId(data.deviceUA).substring(0, 300);

  // --- Perangkat belum pernah terlihat ---
  if (barisDev === -1) {
    shDev.appendRow([
      deviceId,
      _devNormId(data.deviceLabel) || (u.nama ? ('HP ' + u.nama) : 'Perangkat baru'),
      DEVICE_KUOTA_DEFAULT,
      platform, ua,
      'aktif',
      waktu, waktu,
      'Terdaftar otomatis saat login pertama.',
      _devNormId(u.id), waktu
    ]);
    _deviceIkat(shBind, deviceId, u, waktu);
    return {
      diblokir: false,
      tanda: DEVICE_TANDA.PERANGKAT_BARU,
      pemilik: _devNormId(u.nama),
      pesan: 'Perangkat baru didaftarkan otomatis.'
    };
  }

  const status = _devNormId(rowsDev[barisDev][5]).toLowerCase();
  const kuota = Math.max(1, parseInt(rowsDev[barisDev][2], 10) || DEVICE_KUOTA_DEFAULT);

  // Kolom H (index 7) = TerakhirLihat.
  shDev.getRange(barisDev + 1, 8).setValue(waktu);
  if (platform && !_devNormId(rowsDev[barisDev][3])) shDev.getRange(barisDev + 1, 4).setValue(platform);
  if (ua && !_devNormId(rowsDev[barisDev][4])) shDev.getRange(barisDev + 1, 5).setValue(ua);

  if (status === 'diblokir') {
    return {
      diblokir: true,
      tanda: 'perangkat_diblokir',
      pemilik: '',
      pesan: 'Perangkat ini diblokir oleh admin. Hubungi HRD untuk membukanya.'
    };
  }

  // --- Ikatan yang sudah ada pada perangkat ini ---
  const rowsBind = bacaSheet(shBind, DEVICE_USER_HEADERS.length);
  const terikat = [];
  let barisIkatanSaya = -1;
  for (let i = 1; i < rowsBind.length; i++) {
    if (_devNormId(rowsBind[i][0]) !== deviceId) continue;
    if (_devNormId(rowsBind[i][7]).toLowerCase() === 'dilepas') continue;
    terikat.push({ userId: _devNormId(rowsBind[i][1]), nama: _devNormId(rowsBind[i][2]) });
    if (_devNormId(rowsBind[i][1]) === _devNormId(u.id)) barisIkatanSaya = i;
  }

  // Sudah terikat -> jalur normal, tidak ada tanda.
  if (barisIkatanSaya !== -1) {
    const jml = (parseInt(rowsBind[barisIkatanSaya][6], 10) || 0) + 1;
    shBind.getRange(barisIkatanSaya + 1, 6, 1, 2).setValues([[waktu, jml]]);
    return { diblokir: false, tanda: DEVICE_TANDA.BERSIH, pemilik: '', pesan: '' };
  }

  // Masih ada kursi kosong (perangkat PIC dengan kuota > 1).
  if (terikat.length < kuota) {
    _deviceIkat(shBind, deviceId, u, waktu);
    return {
      diblokir: false,
      tanda: terikat.length === 0 ? DEVICE_TANDA.PERANGKAT_BARU : DEVICE_TANDA.BERSIH,
      pemilik: '',
      pesan: terikat.length === 0 ? 'Perangkat dikaitkan ke akun ini.' : ''
    };
  }

  // Kuota penuh dan akun ini bukan salah satu pemiliknya. Inilah pola
  // titip-absen yang sebenarnya ingin ditangkap.
  const namaPemilik = terikat.map(function (t) { return t.nama || t.userId; }).join(', ');
  if (mode === 'ketat') {
    return {
      diblokir: true,
      tanda: DEVICE_TANDA.KUOTA_PENUH,
      pemilik: namaPemilik,
      pesan: 'Perangkat ini sudah terdaftar untuk ' + namaPemilik + '. '
        + 'Satu perangkat hanya untuk ' + kuota + ' akun. Minta admin melepas ikatannya '
        + 'atau menaikkan kuota perangkat bila ini HP PIC.'
    };
  }

  // Mode 'tandai': tetap diloloskan, tapi ikatannya dicatat sebagai
  // melebihi kuota supaya terlihat jelas di Panel Admin.
  _deviceIkat(shBind, deviceId, u, waktu, 'melebihi_kuota');
  return {
    diblokir: false,
    tanda: DEVICE_TANDA.PERANGKAT_ORANG_LAIN,
    pemilik: namaPemilik,
    pesan: 'Perangkat sudah dipakai akun lain: ' + namaPemilik + '.'
  };
}

function _deviceIkat(shBind, deviceId, u, waktu, status) {
  shBind.appendRow([
    deviceId,
    _devNormId(u.id),
    _devNormId(u.nama),
    _devNormId(u.username),
    waktu, waktu, 1,
    status || 'aktif'
  ]);
}

/**
 * Cermin sesi aktif untuk dibaca admin. Satu baris per user, ditimpa.
 * TIDAK pernah dibaca di jalur panas — lihat catatan di kepala file.
 */
function _deviceTulisSesi(u, deviceId, sessionId, data, tanda) {
  try {
    const sh = _devSheet(DEVICE_SESI_SHEET, DEVICE_SESI_HEADERS);
    const rows = bacaSheet(sh, DEVICE_SESI_HEADERS.length);
    const waktu = _devWaktu();
    const baris = [
      _devNormId(u.id), _devNormId(u.nama), sessionId, deviceId,
      waktu, waktu, _devNormId(data && data.devicePlatform).substring(0, 120), tanda || ''
    ];
    for (let i = 1; i < rows.length; i++) {
      if (_devNormId(rows[i][0]) === _devNormId(u.id)) {
        sh.getRange(i + 1, 1, 1, baris.length).setValues([baris]);
        return;
      }
    }
    sh.appendRow(baris);
  } catch (e) {
    console.warn('Gagal menulis SesiAktif: ' + e.message);
  }
}

function _deviceCatatAudit(u, deviceId, aksi, tanda, detail) {
  try {
    const sh = _devSheet(DEVICE_AUDIT_SHEET, DEVICE_AUDIT_HEADERS);
    sh.appendRow([
      _devWaktu(), _devNormId(u && u.id), _devNormId(u && u.nama),
      deviceId, aksi, tanda || '', String(detail || '').substring(0, 500)
    ]);
    // Pangkas agar sheet audit tidak tumbuh tanpa batas dan membuat
    // pembacaan admin makin lambat tiap bulan.
    const last = sh.getLastRow();
    if (last > DEVICE_AUDIT_MAKS_BARIS + 500) {
      sh.deleteRows(2, last - DEVICE_AUDIT_MAKS_BARIS);
    }
  } catch (e) {
    console.warn('Gagal menulis DeviceAudit: ' + e.message);
  }
}

/**
 * Dipanggil dari handleAbsen. Mengembalikan tanda perangkat untuk absen
 * ini (string kosong = bersih), dan mencatatnya bila tidak bersih.
 */
function deviceTandaAbsen(data) {
  if (!deviceAktif()) return '';
  const auth = data && data._auth;
  const deviceId = _devNormId(data && data.deviceId);
  const tandaSesi = _devNormId(auth && auth.t);

  if (!deviceId) {
    _deviceCatatAudit({ id: data.userId, nama: data.nama }, '', 'absen', DEVICE_TANDA.TANPA_ID,
      'Absen ' + _devNormId(data.tipe) + ' tanpa ID perangkat.');
    return DEVICE_TANDA.TANPA_ID;
  }

  // Perangkat yang dipakai absen harus perangkat yang dipakai login.
  const deviceSesi = _devNormId(auth && auth.dv);
  if (deviceSesi && deviceSesi !== deviceId) {
    _deviceCatatAudit({ id: data.userId, nama: data.nama }, deviceId, 'absen', 'perangkat_beda_dari_sesi',
      'ID perangkat saat absen berbeda dari saat login (' + deviceSesi + ').');
    return 'perangkat_beda_dari_sesi';
  }

  if (tandaSesi) {
    _deviceCatatAudit({ id: data.userId, nama: data.nama }, deviceId, 'absen', tandaSesi,
      'Absen ' + _devNormId(data.tipe) + ' dari sesi bertanda.');
    return tandaSesi;
  }
  return '';
}

// =======================================================
// HANDLER UNTUK PANEL ADMIN
// =======================================================

function handleGetDeviceList(data) {
  const shDev = _devSheet(DEVICE_SHEET, DEVICE_HEADERS);
  const shBind = _devSheet(DEVICE_USER_SHEET, DEVICE_USER_HEADERS);
  const shSesi = _devSheet(DEVICE_SESI_SHEET, DEVICE_SESI_HEADERS);

  const rowsDev = bacaSheet(shDev, DEVICE_HEADERS.length);
  const rowsBind = bacaSheet(shBind, DEVICE_USER_HEADERS.length);
  const rowsSesi = bacaSheet(shSesi, DEVICE_SESI_HEADERS.length);

  const ikatan = {};
  for (let i = 1; i < rowsBind.length; i++) {
    const did = _devNormId(rowsBind[i][0]);
    if (!did) continue;
    if (!ikatan[did]) ikatan[did] = [];
    ikatan[did].push({
      userId: _devNormId(rowsBind[i][1]),
      nama: _devNormId(rowsBind[i][2]),
      username: _devNormId(rowsBind[i][3]),
      pertama: _devNormId(rowsBind[i][4]),
      terakhir: _devNormId(rowsBind[i][5]),
      jumlahLogin: parseInt(rowsBind[i][6], 10) || 0,
      status: _devNormId(rowsBind[i][7]) || 'aktif'
    });
  }

  const daftar = [];
  for (let i = 1; i < rowsDev.length; i++) {
    const did = _devNormId(rowsDev[i][0]);
    if (!did) continue;
    daftar.push({
      deviceId: did,
      label: _devNormId(rowsDev[i][1]),
      kuota: Math.max(1, parseInt(rowsDev[i][2], 10) || DEVICE_KUOTA_DEFAULT),
      platform: _devNormId(rowsDev[i][3]),
      userAgent: _devNormId(rowsDev[i][4]),
      status: _devNormId(rowsDev[i][5]) || 'aktif',
      pertamaLihat: _devNormId(rowsDev[i][6]),
      terakhirLihat: _devNormId(rowsDev[i][7]),
      catatan: _devNormId(rowsDev[i][8]),
      pengguna: ikatan[did] || []
    });
  }
  daftar.sort(function (a, b) { return String(b.terakhirLihat).localeCompare(String(a.terakhirLihat)); });

  const sesi = [];
  for (let i = 1; i < rowsSesi.length; i++) {
    if (!_devNormId(rowsSesi[i][0])) continue;
    sesi.push({
      userId: _devNormId(rowsSesi[i][0]),
      nama: _devNormId(rowsSesi[i][1]),
      deviceId: _devNormId(rowsSesi[i][3]),
      loginAt: _devNormId(rowsSesi[i][4]),
      platform: _devNormId(rowsSesi[i][6]),
      tanda: _devNormId(rowsSesi[i][7])
    });
  }
  sesi.sort(function (a, b) { return String(b.loginAt).localeCompare(String(a.loginAt)); });

  return responseJSON({
    result: 'success',
    mode: deviceMode(),
    devices: daftar,
    sesi: sesi
  });
}

function handleGetDeviceAudit(data) {
  const sh = _devSheet(DEVICE_AUDIT_SHEET, DEVICE_AUDIT_HEADERS);
  const rows = bacaSheet(sh, DEVICE_AUDIT_HEADERS.length);
  const batas = Math.max(1, Math.min(500, parseInt(data.limit, 10) || 200));
  const out = [];
  for (let i = rows.length - 1; i >= 1 && out.length < batas; i--) {
    if (!_devNormId(rows[i][0])) continue;
    out.push({
      waktu: _devNormId(rows[i][0]),
      userId: _devNormId(rows[i][1]),
      nama: _devNormId(rows[i][2]),
      deviceId: _devNormId(rows[i][3]),
      aksi: _devNormId(rows[i][4]),
      tanda: _devNormId(rows[i][5]),
      detail: _devNormId(rows[i][6])
    });
  }
  return responseJSON({ result: 'success', log: out });
}

function handleSaveDeviceConfig(data) {
  const deviceId = _devNormId(data.deviceId);
  if (!deviceId) return responseJSON({ result: 'error', message: 'ID perangkat wajib diisi.' });

  const sh = _devSheet(DEVICE_SHEET, DEVICE_HEADERS);
  const rows = bacaSheet(sh, DEVICE_HEADERS.length);
  for (let i = 1; i < rows.length; i++) {
    if (_devNormId(rows[i][0]) !== deviceId) continue;

    if (data.kuota !== undefined && data.kuota !== null && data.kuota !== '') {
      const k = parseInt(data.kuota, 10);
      if (isNaN(k) || k < 1 || k > 50) {
        return responseJSON({ result: 'error', message: 'Kuota login harus antara 1 dan 50.' });
      }
      sh.getRange(i + 1, 3).setValue(k);
    }
    if (data.label !== undefined) sh.getRange(i + 1, 2).setValue(_devNormId(data.label).substring(0, 120));
    if (data.status !== undefined) {
      const s = _devNormId(data.status).toLowerCase();
      if (['aktif', 'diblokir'].indexOf(s) === -1) {
        return responseJSON({ result: 'error', message: 'Status perangkat hanya boleh aktif atau diblokir.' });
      }
      sh.getRange(i + 1, 6).setValue(s);
    }
    if (data.catatan !== undefined) sh.getRange(i + 1, 9).setValue(_devNormId(data.catatan).substring(0, 300));
    sh.getRange(i + 1, 10, 1, 2).setValues([[_devNormId(data.userId), _devWaktu()]]);

    _deviceCatatAudit({ id: data.userId, nama: 'admin' }, deviceId, 'ubah_konfigurasi', '',
      'kuota=' + _devNormId(data.kuota) + ' status=' + _devNormId(data.status));
    return responseJSON({ result: 'success', message: 'Konfigurasi perangkat disimpan.' });
  }
  return responseJSON({ result: 'error', message: 'Perangkat tidak ditemukan.' });
}

/**
 * Lepas ikatan satu akun dari satu perangkat. Dipakai saat karyawan
 * ganti HP: ikatan lama dilepas supaya kursinya kembali kosong.
 */
function handleLepasDevice(data) {
  const deviceId = _devNormId(data.deviceId);
  const targetUserId = _devNormId(data.targetUserId);
  if (!deviceId) return responseJSON({ result: 'error', message: 'ID perangkat wajib diisi.' });

  const sh = _devSheet(DEVICE_USER_SHEET, DEVICE_USER_HEADERS);
  const rows = bacaSheet(sh, DEVICE_USER_HEADERS.length);
  let jml = 0;
  // Dari bawah ke atas: menghapus baris menggeser index baris di bawahnya.
  for (let i = rows.length - 1; i >= 1; i--) {
    if (_devNormId(rows[i][0]) !== deviceId) continue;
    if (targetUserId && _devNormId(rows[i][1]) !== targetUserId) continue;
    sh.deleteRow(i + 1);
    jml++;
  }
  if (!jml) return responseJSON({ result: 'error', message: 'Ikatan tidak ditemukan.' });

  // Sesi yang sedang berjalan di perangkat itu ikut dicabut, kalau tidak
  // pelepasan baru terasa 12 jam kemudian saat token kedaluwarsa.
  if (targetUserId) deviceCabutSesi(targetUserId);

  _deviceCatatAudit({ id: data.userId, nama: 'admin' }, deviceId, 'lepas_ikatan', '',
    'target=' + (targetUserId || 'SEMUA') + ' jumlah=' + jml);
  return responseJSON({ result: 'success', message: jml + ' ikatan dilepas.' });
}

/**
 * Paksa logout satu akun tanpa menyentuh ikatan perangkatnya.
 */
function handleCabutSesiUser(data) {
  const targetUserId = _devNormId(data.targetUserId);
  if (!targetUserId) return responseJSON({ result: 'error', message: 'User tujuan wajib dipilih.' });
  deviceCabutSesi(targetUserId);
  _deviceCatatAudit({ id: data.userId, nama: 'admin' }, '', 'cabut_sesi', '', 'target=' + targetUserId);
  return responseJSON({ result: 'success', message: 'Sesi user tersebut dicabut. Ia harus login ulang.' });
}

function handleSetDeviceMode(data) {
  try {
    const m = deviceSetMode(data.mode);
    _deviceCatatAudit({ id: data.userId, nama: 'admin' }, '', 'ubah_mode', '', 'mode=' + m);
    return responseJSON({ result: 'success', mode: m, message: 'Mode penguncian perangkat: ' + m });
  } catch (e) {
    return responseJSON({ result: 'error', message: e.message });
  }
}

// =======================================================
// PEMASANGAN — JALANKAN SEKALI DARI EDITOR
// =======================================================

/**
 * Membuat keempat sheet beserta header-nya, dan menyetel mode awal.
 * Aman dijalankan berkali-kali.
 */
function SETUP_DEVICE_LOCK() {
  _devSheet(DEVICE_SHEET, DEVICE_HEADERS);
  _devSheet(DEVICE_USER_SHEET, DEVICE_USER_HEADERS);
  _devSheet(DEVICE_SESI_SHEET, DEVICE_SESI_HEADERS);
  _devSheet(DEVICE_AUDIT_SHEET, DEVICE_AUDIT_HEADERS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(DEVICE_MODE_KEY)) props.setProperty(DEVICE_MODE_KEY, 'tandai');
  Logger.log('Sheet perangkat siap. Mode saat ini: %s', deviceMode());
  Logger.log('Ubah mode lewat Panel Admin > Perangkat, atau deviceSetMode("ketat").');
}

/**
 * Mencabut SEMUA sesi. Semua karyawan harus login ulang — dan login ulang
 * itulah yang mendaftarkan perangkat mereka. Jalankan sekali setelah
 * deploy kalau ingin pendaftaran perangkat dimulai bersamaan.
 */
function SETUP_CABUT_SEMUA_SESI() {
  const props = PropertiesService.getScriptProperties();
  const semua = props.getProperties();
  let n = 0;
  Object.keys(semua).forEach(function (k) {
    if (k.indexOf(DEVICE_SESI_PREFIX) === 0) { props.deleteProperty(k); n++; }
  });
  Logger.log('%s sesi dicabut. Semua user harus login ulang.', n);
}
