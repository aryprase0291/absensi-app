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

// =======================================================
// INDEKS BARIS (lihat Cache.gs) — PEMANGKAS UTAMA WAKTU LOGIN
//
// Sebelum ini, SETIAP login membaca tiga sheet UTUH hanya untuk
// menemukan tiga nomor baris: Devices (~300x11), DeviceUser (~300x8),
// dan SesiAktif (~300x8). Yang benar-benar dibutuhkan cuma
// "baris berapa", dan itu tidak berubah kecuali ada perangkat /
// ikatan / user baru.
//
// Indeks ini menyimpan pemetaan kunci -> nomor baris. Nomor barisnya
// SELALU DIVERIFIKASI ulang dengan membaca baris itu sendiri sebelum
// ditulisi, jadi indeks yang basi tidak pernah menimpa baris milik
// orang lain — paling buruk ia meleset dan jatuh ke jalur lambat.
// Karena itu pula indeks ini aman walau tidak sempat di-invalidasi.
// =======================================================
const DEVICE_IDX_DEV  = 'DEVIDX_DEV_V1';   // deviceId            -> baris
const DEVICE_IDX_BIND = 'DEVIDX_BIND_V1';  // deviceId|userId     -> baris
const DEVICE_IDX_SESI = 'DEVIDX_SESI_V1';  // userId              -> baris
const DEVICE_IDX_TTL  = 6 * 60 * 60;       // 6 jam
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
    // Lewat memo per-eksekusi (Cache.gs): deviceMode() dipanggil dua kali
    // per login (deviceAktif + _deviceDaftarkan) dan sekali lagi di setiap
    // absen. Tanpa memo itu tiga round trip PropertiesService.
    const v = (typeof _propGetCepat_ === 'function')
      ? String(_propGetCepat_(DEVICE_MODE_KEY)).trim().toLowerCase()
      : String(PropertiesService.getScriptProperties().getProperty(DEVICE_MODE_KEY) || '').trim().toLowerCase();
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
  if (typeof _propLupakanSatuan_ === 'function') _propLupakanSatuan_(DEVICE_MODE_KEY);
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

/** Baca satu indeks baris dari simpanan. @return {Object} peta (kosong bila tidak ada). @private */
function _devIdxAmbil(kunci) {
  try {
    const hit = (typeof _ambilTahan_ === 'function') ? _ambilTahan_(kunci) : null;
    return (hit && typeof hit === 'object') ? hit : {};
  } catch (e) { return {}; }
}

/** Simpan indeks baris. Kegagalan di sini hanya berarti jalur lambat dipakai lagi. @private */
function _devIdxSimpan(kunci, peta) {
  try { if (typeof _simpanTahan_ === 'function') _simpanTahan_(kunci, peta, DEVICE_IDX_TTL); }
  catch (e) { /* indeks itu optimasi, bukan sumber kebenaran */ }
}

/** Buang indeks (dipakai setelah admin mengubah ikatan/status perangkat). @private */
function _devIdxBuang(kunci) {
  try { if (typeof _hapusTahan_ === 'function') _hapusTahan_(kunci); } catch (e) { /* abaikan */ }
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
    if (typeof _propGetCepat_ === 'function') return _devNormId(_propGetCepat_(_devKunciSesi(userId)));
    return _devNormId(PropertiesService.getScriptProperties().getProperty(_devKunciSesi(userId)));
  } catch (e) {
    return '';
  }
}

function deviceTerbitkanSesi(userId) {
  const sid = Utilities.getUuid().replace(/-/g, '').substring(0, 20);
  try {
    PropertiesService.getScriptProperties().setProperty(_devKunciSesi(userId), sid);
    if (typeof _propLupakanSatuan_ === 'function') _propLupakanSatuan_(_devKunciSesi(userId));
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
    if (typeof _propLupakanSatuan_ === 'function') _propLupakanSatuan_(_devKunciSesi(userId));
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

  // --- JALUR CEPAT (tanpa lock, tanpa pembacaan sheet penuh) ---------
  // Dicoba lebih dulu karena inilah bentuk login sehari-hari: HP yang
  // sudah dikenal, dipakai orang yang sama. Kalau indeksnya meleset,
  // fungsinya mengembalikan null dan kita lanjut ke jalur lengkap.
  try {
    const cepat = _deviceDaftarkanCepat(u, data, deviceId);
    if (cepat) {
      hasil.tanda = cepat.tanda;
      hasil.pemilik = cepat.pemilik;
      if (cepat.diblokir) {
        hasil.boleh = false;
        hasil.pesan = cepat.pesan;
        _deviceCatatAudit(u, deviceId, 'login_ditolak', cepat.tanda, cepat.pesan);
        return hasil;
      }
      hasil.sessionId = deviceTerbitkanSesi(u.id);
      _deviceTulisSesi(u, deviceId, hasil.sessionId, data, hasil.tanda);
      return hasil;
    }
  } catch (e) {
    // Fail-open sama seperti jalur lengkap: masalah di optimasi tidak
    // boleh mengunci karyawan dari aplikasinya.
    console.warn('Jalur cepat perangkat dilewati: ' + e.message);
  }

  // --- JALUR LENGKAP -------------------------------------------------
  // Hanya dicapai kalau memang ada kemungkinan baris BARU ditulis
  // (perangkat baru, ikatan baru, kuota penuh). Di sinilah lock benar-
  // benar dibutuhkan, dan di sini pula frekuensinya rendah — jadi
  // menunggu beberapa detik tidak lagi menjadi biaya semua orang.
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
 * JALUR CEPAT: perangkat sudah dikenal DAN sudah terikat ke akun ini.
 *
 * Inilah >95% login harian. Yang dilakukan hanya dua pembacaan SATU BARIS
 * dan dua penulisan pembukuan (TerakhirLihat, TerakhirLogin+JumlahLogin) —
 * tidak ada pembacaan sheet penuh, dan yang terpenting TIDAK ADA
 * LockService: jalur ini tidak pernah menambah baris, jadi tidak ada yang
 * perlu dilindungi dari balapan. Lock global 8 detik di jalur ini adalah
 * penyebab utama antrean login di jam masuk — 300 karyawan yang login
 * bersamaan saling menunggu padahal tidak ada satu pun baris baru.
 *
 * Nomor baris dari indeks SELALU diverifikasi terhadap isi barisnya
 * sendiri. Indeks basi => fungsi ini mengembalikan null dan pemanggil
 * jatuh ke _deviceDaftarkan() yang lengkap.
 *
 * @return {Object|null} hasil seperti _deviceDaftarkan, atau null bila
 *                       tidak bisa dilayani dari indeks.
 */
function _deviceDaftarkanCepat(u, data, deviceId) {
  const userId = _devNormId(u.id);
  if (!deviceId || !userId) return null;

  const idxDev = _devIdxAmbil(DEVICE_IDX_DEV);
  const idxBind = _devIdxAmbil(DEVICE_IDX_BIND);
  const barisDev = idxDev[deviceId];
  const barisBind = idxBind[deviceId + '|' + userId];
  if (!barisDev || !barisBind) return null;

  const shDev = SS.getSheetByName(DEVICE_SHEET);
  const shBind = SS.getSheetByName(DEVICE_USER_SHEET);
  if (!shDev || !shBind) return null;
  if (barisDev < 2 || barisDev > shDev.getLastRow()) return null;
  if (barisBind < 2 || barisBind > shBind.getLastRow()) return null;

  const rowDev = shDev.getRange(barisDev, 1, 1, DEVICE_HEADERS.length).getValues()[0];
  if (_devNormId(rowDev[0]) !== deviceId) return null; // indeks basi

  const status = _devNormId(rowDev[5]).toLowerCase();
  if (status === 'diblokir') {
    return {
      diblokir: true,
      tanda: 'perangkat_diblokir',
      pemilik: '',
      pesan: 'Perangkat ini diblokir oleh admin. Hubungi HRD untuk membukanya.'
    };
  }

  const rowBind = shBind.getRange(barisBind, 1, 1, DEVICE_USER_HEADERS.length).getValues()[0];
  if (_devNormId(rowBind[0]) !== deviceId) return null;          // indeks basi
  if (_devNormId(rowBind[1]) !== userId) return null;            // indeks basi
  if (_devNormId(rowBind[7]).toLowerCase() === 'dilepas') return null; // biar jalur lambat yang menilai

  const waktu = _devWaktu();
  shDev.getRange(barisDev, 8).setValue(waktu); // kolom H = TerakhirLihat
  shBind.getRange(barisBind, 6, 1, 2).setValues([[waktu, (parseInt(rowBind[6], 10) || 0) + 1]]);

  return { diblokir: false, tanda: DEVICE_TANDA.BERSIH, pemilik: '', pesan: '' };
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
  // Sheet sudah terbaca utuh di sini — sekalian susun indeksnya supaya
  // login berikutnya tidak perlu mengulang pembacaan ini.
  const petaDev = {};
  for (let i = 1; i < rowsDev.length; i++) {
    const idBaris = _devNormId(rowsDev[i][0]);
    if (!idBaris) continue;
    petaDev[idBaris] = i + 1; // nomor baris 1-based ala getRange
    if (idBaris === deviceId && barisDev === -1) barisDev = i;
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
    petaDev[deviceId] = shDev.getLastRow();
    _devIdxSimpan(DEVICE_IDX_DEV, petaDev);
    _deviceIkat(shBind, deviceId, u, waktu);
    _devIdxBuang(DEVICE_IDX_BIND); // ikatan baru: indeks lama sudah tidak lengkap
    return {
      diblokir: false,
      tanda: DEVICE_TANDA.PERANGKAT_BARU,
      pemilik: _devNormId(u.nama),
      pesan: 'Perangkat baru didaftarkan otomatis.'
    };
  }

  const status = _devNormId(rowsDev[barisDev][5]).toLowerCase();
  const kuota = Math.max(1, parseInt(rowsDev[barisDev][2], 10) || DEVICE_KUOTA_DEFAULT);

  _devIdxSimpan(DEVICE_IDX_DEV, petaDev);

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
  // Indeks ikatan disusun untuk SELURUH perangkat, bukan hanya yang ini:
  // pembacaannya sudah terlanjur penuh, dan login karyawan lain besok
  // akan memanfaatkannya.
  const petaBind = {};
  for (let i = 1; i < rowsBind.length; i++) {
    const dvBaris = _devNormId(rowsBind[i][0]);
    const usBaris = _devNormId(rowsBind[i][1]);
    if (_devNormId(rowsBind[i][7]).toLowerCase() === 'dilepas') continue;
    if (dvBaris && usBaris) petaBind[dvBaris + '|' + usBaris] = i + 1;
    if (dvBaris !== deviceId) continue;
    terikat.push({ userId: usBaris, nama: _devNormId(rowsBind[i][2]) });
    if (usBaris === _devNormId(u.id)) barisIkatanSaya = i;
  }
  _devIdxSimpan(DEVICE_IDX_BIND, petaBind);

  // Sudah terikat -> jalur normal, tidak ada tanda.
  if (barisIkatanSaya !== -1) {
    const jml = (parseInt(rowsBind[barisIkatanSaya][6], 10) || 0) + 1;
    shBind.getRange(barisIkatanSaya + 1, 6, 1, 2).setValues([[waktu, jml]]);
    return { diblokir: false, tanda: DEVICE_TANDA.BERSIH, pemilik: '', pesan: '' };
  }

  // Masih ada kursi kosong (perangkat PIC dengan kuota > 1).
  if (terikat.length < kuota) {
    _deviceIkat(shBind, deviceId, u, waktu);
    petaBind[deviceId + '|' + _devNormId(u.id)] = shBind.getLastRow();
    _devIdxSimpan(DEVICE_IDX_BIND, petaBind);
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
  petaBind[deviceId + '|' + _devNormId(u.id)] = shBind.getLastRow();
  _devIdxSimpan(DEVICE_IDX_BIND, petaBind);
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
    const waktu = _devWaktu();
    const userId = _devNormId(u.id);
    const baris = [
      userId, _devNormId(u.nama), sessionId, deviceId,
      waktu, waktu, _devNormId(data && data.devicePlatform).substring(0, 120), tanda || ''
    ];

    // Jalur biasa: baris user sudah pernah ada, nomornya ada di indeks.
    // Isinya tetap diperiksa dulu — indeks yang basi TIDAK BOLEH menimpa
    // baris sesi milik karyawan lain.
    const idx = _devIdxAmbil(DEVICE_IDX_SESI);
    const tebakan = idx[userId];
    if (tebakan && tebakan >= 2 && tebakan <= sh.getLastRow()) {
      if (_devNormId(sh.getRange(tebakan, 1).getValue()) === userId) {
        sh.getRange(tebakan, 1, 1, baris.length).setValues([baris]);
        return;
      }
    }

    // Indeks belum ada / meleset: baca KOLOM A saja (bukan 8 kolom),
    // lalu simpan indeksnya untuk login-login berikutnya.
    const kolomA = bacaSheet(sh, 1);
    const peta = {};
    let ketemu = -1;
    for (let i = 1; i < kolomA.length; i++) {
      const uid = _devNormId(kolomA[i][0]);
      if (!uid) continue;
      peta[uid] = i + 1;
      if (uid === userId) ketemu = i + 1;
    }
    if (ketemu !== -1) {
      sh.getRange(ketemu, 1, 1, baris.length).setValues([baris]);
    } else {
      sh.appendRow(baris);
      peta[userId] = sh.getLastRow();
    }
    _devIdxSimpan(DEVICE_IDX_SESI, peta);
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

  // deleteRow menggeser nomor baris di bawahnya, jadi indeks ikatan
  // langsung usang. Verifikasi isi baris di jalur cepat sudah membuat
  // indeks basi tidak berbahaya, tapi membuangnya di sini menghindarkan
  // seluruh karyawan jatuh ke jalur lambat sampai TTL habis.
  _devIdxBuang(DEVICE_IDX_BIND);

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
