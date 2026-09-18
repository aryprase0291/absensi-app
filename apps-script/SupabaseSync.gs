// =====================================================================
// JEMBATAN KE SUPABASE — FASE 1 (LOGIN)
//
// File ini adalah SATU-SATUNYA titik sentuh antara Apps Script dan
// Postgres. Dua arah, dan masing-masing hanya satu arah:
//
//   SUPABASE_SINKRON_MASTER()  Sheets  -> Postgres, tiap 10 menit
//       Menyalin cermin baca-saja: karyawan, geofence, master data,
//       periode, pengumuman, perangkat. Postgres tidak pernah menulis
//       balik ke sini.
//
//   SUPABASE_TARIK_SESI()      Postgres -> Script Properties, tiap menit
//       Menarik SessionID yang diterbitkan Edge Function login, supaya
//       authorizeRequest di Auth.gs tetap membacanya dari tempat yang
//       sama seperti dulu. Inilah yang membuat seluruh endpoint lama
//       tetap berjalan tanpa satu pun tambahan request.
//
// KONSEKUENSI YANG DISENGAJA: penggusuran sesi telat paling lama satu
// putaran penarikan (60 detik). Dalam jendela itu satu akun bisa hidup
// di dua perangkat. Ini keputusan sadar, bukan kelalaian — lihat
// SUPABASE-FASE1.md.
//
// PEMASANGAN: jalankan SUPABASE_SETUP() sekali, lalu
// SUPABASE_PASANG_TRIGGER(). Urutan lengkapnya di SUPABASE-FASE1.md.
// =====================================================================

const SB_PROP_URL       = 'SUPABASE_URL';
const SB_PROP_RAHASIA   = 'SUPABASE_SINKRON_RAHASIA';
const SB_PROP_WATERMARK = 'SUPABASE_SESI_SAMPAI';
const SB_PROP_ANON      = 'SUPABASE_ANON_KEY';

/** @private */
function _sbKonfig() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty(SB_PROP_URL) || '').replace(/\/+$/, '');
  const rahasia = String(props.getProperty(SB_PROP_RAHASIA) || '');
  if (!url || !rahasia) {
    throw new Error('Supabase belum disiapkan. Jalankan SUPABASE_SETUP() lebih dulu.');
  }
  return { url: url, rahasia: rahasia };
}

/**
 * Header untuk setiap panggilan Edge Function.
 *
 * `x-sinkron-rahasia` adalah gerbang kita sendiri. `Authorization`
 * dibutuhkan terpisah: Edge Function yang dideploy lewat dasbor/API
 * berjalan dengan verify_jwt aktif, dan tanpa header ini Supabase
 * menolak permintaannya di depan pintu — sebelum kode kita sempat
 * berjalan sama sekali. Anon key TIDAK memberi akses apa pun ke tabel;
 * seluruh isi tetap dijaga RLS dan rahasia sinkron di atas.
 * @private
 */
function _sbHeader(cfg) {
  const h = { 'x-sinkron-rahasia': cfg.rahasia };
  const anon = String(PropertiesService.getScriptProperties().getProperty(SB_PROP_ANON) || '');
  if (anon) {
    h['apikey'] = anon;
    h['Authorization'] = 'Bearer ' + anon;
  }
  return h;
}

/** @private */
function _sbPanggil(namaFungsi, muatan) {
  const cfg = _sbKonfig();
  const res = UrlFetchApp.fetch(cfg.url + '/functions/v1/' + namaFungsi, {
    method: 'post',
    contentType: 'application/json',
    headers: _sbHeader(cfg),
    payload: JSON.stringify(muatan || {}),
    muteHttpExceptions: true
  });
  const kode = res.getResponseCode();
  const teks = res.getContentText();
  if (kode < 200 || kode >= 300) {
    throw new Error(namaFungsi + ' menjawab HTTP ' + kode + ': ' + teks.substring(0, 300));
  }
  return JSON.parse(teks);
}

// =====================================================================
// SHEETS -> POSTGRES
// =====================================================================

/**
 * Menyalin seluruh cermin baca-saja ke Postgres.
 * Dipasang sebagai trigger 10 menitan oleh SUPABASE_PASANG_TRIGGER().
 */
function SUPABASE_SINKRON_MASTER() {
  const t0 = new Date().getTime();

  const shUsers = SS.getSheetByName(SHEET_USERS);
  const rows = bacaSheet(shUsers, 14);

  // Sumber tambahan, masing-masing sudah punya lapisan simpanannya
  // sendiri — jadi sinkronisasi ini tidak membebani jalur panas.
  const petaCuti = (typeof getPetaCutiCached === 'function') ? getPetaCutiCached() : {};
  const geofence = (typeof _susunKonfigurasiGeofence_ === 'function') ? _susunKonfigurasiGeofence_() : {};
  const gpsTrack = (typeof _gpsTrackKonfigurasi === 'function') ? _gpsTrackKonfigurasi() : {};
  const bebas = {};
  try {
    (gpsBebasDaftar() || []).forEach(function (id) { bebas[String(id).trim()] = true; });
  } catch (e) { /* daftar kosong: tidak ada yang dikecualikan */ }

  const karyawan = [];
  const areaGeofence = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] || '').trim();
    const username = String(r[1] || '').trim();
    if (!id || !username) continue;

    const nik = String(r[7] || '').trim();
    const cuti = petaCuti[nik] || {};
    const geo = geofence[id] || { required: false, areas: [] };
    const gt = gpsTrack[id] || {};

    karyawan.push({
      id: id,
      username: username,
      // Dikirim apa adanya SEKALI, lewat HTTPS, lalu segera diubah
      // menjadi bcrypt oleh sinkron_master di Postgres. Tabel karyawan
      // tidak pernah menyimpannya polos. Lihat catatan di
      // SUPABASE-FASE1.md soal kata sandi polos di spreadsheet — itu
      // masalah terpisah yang tidak diperburuk di sini.
      kata_sandi: String(r[2] === null || r[2] === undefined ? '' : r[2]),
      nama: String(r[3] || ''),
      divisi: String(r[4] || ''),
      role: String(r[5] || ''),
      akses: String(r[6] || ''),
      no_payroll: nik,
      perusahaan: String(r[10] || '-'),
      status_karyawan: String(r[11] || '-'),
      lokasi: String(r[13] || 'All'),
      foto_profil: String(r[9] || ''),
      email_atasan: String(r[12] || ''),
      // Kalau NIK-nya ada di MASTER-CUTI, angka itu yang dipakai —
      // persis urutan yang dipakai handleLogin. Kalau tidak, jatuh ke
      // kolom I sheet Users.
      cuti_tersedia: Number((cuti.tersedia !== undefined ? cuti.tersedia : r[8]) || 0),
      cuti_terpakai: Number(cuti.terpakai || 0),
      cuti_bersama: Number(cuti.bersama || 0),
      geofence_wajib: !!geo.required,
      gps_gerbang_bebas: !!bebas[id],
      gps_dilacak: gt.aktif !== false,
      gps_interval_detik: Number(gt.interval || 300)
    });

    (geo.areas || []).forEach(function (a) {
      areaGeofence.push({
        karyawan_id: id, nama: a.nama,
        latitude: a.lat, longitude: a.lng,
        radius_meter: Math.round(a.radius), aktif: true
      });
    });
  }

  // --- Master data, periode, pengumuman ----------------------------
  const masterData = ((typeof getMasterDataCached === 'function') ? getMasterDataCached() : [])
    .map(function (m, idx) {
      return { kategori: m.kategori, value: m.value, label: m.label, urutan: idx };
    });

  const periode = ((typeof getSemuaPeriode_ === 'function') ? getSemuaPeriode_() : [])
    .map(function (p) {
      return {
        id: p.id, mulai: p.mulai, selesai: p.selesai, aktif: !!p.aktif,
        label: (typeof _labelPeriodeAbsen_ === 'function') ? _labelPeriodeAbsen_(p) : ''
      };
    });

  const umum = [];
  try {
    const p = (typeof getPengumumanAktifCached === 'function')
      ? getPengumumanAktifCached() : cariPengumumanAktif();
    if (p && p.isi) umum.push({ waktu: String(p.waktu || ''), isi: String(p.isi) });
  } catch (e) { /* tanpa pengumuman: bukan kegagalan */ }

  // --- Perangkat: HANYA kolom yang dipakai jalur cepat -------------
  const perangkat = [];
  const perangkatUser = [];
  try {
    const shDev = SS.getSheetByName(DEVICE_SHEET);
    if (shDev) {
      const d = bacaSheet(shDev, DEVICE_HEADERS.length);
      for (let i = 1; i < d.length; i++) {
        const did = String(d[i][0] || '').trim();
        if (did) perangkat.push({ device_id: did, status: String(d[i][5] || '') });
      }
    }
    const shBind = SS.getSheetByName(DEVICE_USER_SHEET);
    if (shBind) {
      const b = bacaSheet(shBind, DEVICE_USER_HEADERS.length);
      for (let i = 1; i < b.length; i++) {
        const did = String(b[i][0] || '').trim();
        const uid = String(b[i][1] || '').trim();
        if (did && uid) perangkatUser.push({ device_id: did, karyawan_id: uid, status: String(b[i][7] || '') });
      }
    }
  } catch (e) {
    console.warn('Data perangkat gagal dibaca: ' + e.message);
  }

  const hasil = _sbPanggil('sinkron-master', {
    karyawan: karyawan,
    geofence: areaGeofence,
    masterData: masterData,
    periode: periode,
    pengumuman: umum,
    perangkat: perangkat,
    perangkatUser: perangkatUser,
    konfigurasi: [{ kunci: 'APP_VERSION', nilai: APP_VERSION }]
  });

  // Perawatan yang menumpang jadwal yang sudah ada, supaya tidak perlu
  // trigger tersendiri. Lihat SUPABASE_BERSIHKAN_LOG_LOGIN.
  if (typeof SUPABASE_BERSIHKAN_LOG_LOGIN === 'function') SUPABASE_BERSIHKAN_LOG_LOGIN();

  const ms = new Date().getTime() - t0;
  console.log('Sinkron master selesai dalam ' + ms + ' ms — '
    + karyawan.length + ' karyawan, ' + areaGeofence.length + ' area, '
    + perangkat.length + ' perangkat, ' + perangkatUser.length + ' ikatan. '
    + 'Jawaban: ' + JSON.stringify(hasil));
  return hasil;
}

// =====================================================================
// POSTGRES -> SCRIPT PROPERTIES
// =====================================================================

/**
 * Menarik SessionID yang diterbitkan Edge Function login.
 * Dipasang sebagai trigger 1 menitan oleh SUPABASE_PASANG_TRIGGER().
 *
 * Hanya baris yang BERUBAH yang ditulis. Menulis ratusan properti setiap
 * menit untuk nilai yang sama akan memperlambat SELURUH skrip, karena
 * getProperties() menarik semuanya sekaligus.
 */
function SUPABASE_TARIK_SESI() {
  const props = PropertiesService.getScriptProperties();
  const sejak = String(props.getProperty(SB_PROP_WATERMARK) || '1970-01-01T00:00:00Z');

  const hasil = _sbPanggil('sesi-terbaru', { sejak: sejak });
  if (!hasil || !hasil.ok) throw new Error('sesi-terbaru menjawab tidak ok.');

  const daftar = hasil.sesi || [];
  if (daftar.length) {
    const tulis = {};
    daftar.forEach(function (s) {
      if (!s.id || !s.sesi) return;
      // Kunci yang SAMA PERSIS dengan yang dibaca deviceSesiBerlaku().
      // Memakai _devKunciSesi, bukan menyusun sendiri, supaya kalau
      // awalannya kelak diubah di Devices.gs, file ini ikut berubah.
      tulis[_devKunciSesi(s.id)] = String(s.sesi);
    });
    props.setProperties(tulis, false);
    if (typeof _propsLupakan_ === 'function') _propsLupakan_();
  }

  if (hasil.sampai) props.setProperty(SB_PROP_WATERMARK, hasil.sampai);

  console.log('Tarik sesi: ' + daftar.length + ' baris'
    + (hasil.terpotong ? ' (TERPOTONG — sisanya menyusul putaran berikutnya)' : '')
    + ', tanda air -> ' + hasil.sampai);
  return daftar.length;
}

// =====================================================================
// SINKRON SEGERA — dipanggil dari handler yang MENGUBAH sheet Users
//
// KENAPA ADA. Sejak login pindah, kata sandi diperiksa di Postgres
// (RPC login_periksa) tetapi diubah di sheet. Tanpa fungsi ini, ada jeda
// sampai 10 menit — satu putaran SUPABASE_SINKRON_MASTER — di mana:
//
//   - karyawan yang BARU ditambahkan belum bisa login sama sekali;
//   - kata sandi yang baru diganti belum berlaku, dan yang LAMA masih
//     bisa dipakai.
//
// Dan jeda itu tidak punya jaring pengaman: Edge Function menjawab
// "Username/Password salah!" yang tegas, bukan FALLBACK_APPS_SCRIPT,
// jadi jalur lama tidak ikut dicoba.
//
// Aksi-aksi ini jarang — beberapa kali sehari — jadi satu sinkronisasi
// penuh di dalamnya tidak membebani apa pun. Ia sengaja TIDAK dipanggil
// dari jalur panas mana pun.
//
// @return {string} '' bila selaras (atau Supabase memang belum dipakai),
//                  atau catatan siap-tempel untuk pesan ke pengguna.
// =====================================================================

const SUPABASE_PESAN_TERTUNDA =
  ' (Catatan: penyelarasan ke server login belum berhasil. Perubahan sudah '
  + 'tersimpan dan akan berlaku paling lama 10 menit lagi.)';

function SUPABASE_SINKRON_SEGERA(alasan) {
  try {
    // WAJIB: handler memanggil ini tepat setelah setValue/appendRow.
    // Tanpa flush, penulisan bisa masih mengantre saat sheet dibaca
    // ulang oleh SUPABASE_SINKRON_MASTER — dan yang terkirim ke Postgres
    // justru nilai LAMA, persis kegagalan yang hendak dicegah.
    SpreadsheetApp.flush();
    SUPABASE_SINKRON_MASTER();
    console.log('Sinkron segera OK — ' + alasan);
    return '';
  } catch (e) {
    const pesan = String(e && e.message ? e.message : e);
    // Supabase memang belum dipasang di skrip ini: bukan kegagalan,
    // dan tidak perlu mengganggu pengguna dengan catatan apa pun.
    if (pesan.indexOf('belum disiapkan') !== -1) return '';
    console.warn('Sinkron segera GAGAL (' + alasan + '): ' + pesan);
    return SUPABASE_PESAN_TERTUNDA;
  }
}

// =====================================================================
// PEMASANGAN & PENGUJIAN
// =====================================================================

/**
 * Menyimpan alamat dan rahasia sinkronisasi. Jalankan SEKALI.
 * Isi kedua nilai di bawah lebih dulu.
 */
function SUPABASE_SETUP() {
  const URL = '';      // <-- contoh: https://abcdefgh.supabase.co
  const RAHASIA = '';  // <-- rahasia bersama; nilai yang sama dipasang
                       //     sebagai secret SINKRON_RAHASIA di Supabase

  if (!URL || !RAHASIA) {
    Logger.log('Isi dulu URL dan RAHASIA di dalam fungsi SUPABASE_SETUP.');
    Logger.log('RAHASIA boleh apa saja yang panjang dan acak — yang penting');
    Logger.log('nilainya SAMA dengan secret SINKRON_RAHASIA di Supabase.');
    return;
  }
  PropertiesService.getScriptProperties().setProperties({
    SUPABASE_URL: URL,
    SUPABASE_SINKRON_RAHASIA: RAHASIA
  }, false);
  Logger.log('Tersimpan. Berikutnya: SUPABASE_SINKRON_MASTER() sekali manual,');
  Logger.log('lalu SUPABASE_UJI_TOKEN(), lalu SUPABASE_PASANG_TRIGGER().');
}

/**
 * Menyimpan anon key Supabase. JALANKAN SEKALI, lalu lupakan.
 *
 * KENAPA PERLU. Edge Function `dbabsen` di-deploy lewat API, dan di
 * jalur itu `verify_jwt` menyala secara bawaan — berbeda dengan `login`,
 * `sesi-terbaru` dan `sinkron-master` yang di-deploy dengan satpam itu
 * dimatikan. Selama kunci ini belum tersimpan, setiap panggilan Apps
 * Script ke `dbabsen` ditolak Supabase di depan pintu, SEBELUM kode kita
 * sempat berjalan. Gejalanya: "dbabsen menjawab HTTP 401".
 *
 * APAKAH INI RAHASIA? Bukan. Anon key memang dirancang untuk dipasang di
 * sisi klien — nilainya sudah ikut terkirim ke setiap HP karyawan di
 * dalam bundle aplikasi (lihat src/config/constants.js). Ia tidak memberi
 * akses ke tabel mana pun: seluruh isi dijaga RLS, dan endpoint
 * sinkronisasi masih meminta SINKRON_RAHASIA di atasnya.
 *
 * KALAU KELAK ANDA MEMUTAR ULANG KUNCI Supabase, ganti nilai di bawah
 * dan jalankan fungsi ini lagi. Nilainya harus SAMA dengan yang dipakai
 * aplikasi, kalau tidak Apps Script tetap ditolak.
 */
function SUPABASE_SETUP_ANON() {
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93YmlicXFhb2V5cm5hdHpxZ3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MTY5ODgsImV4cCI6MjEwNTI5Mjk4OH0.fYkvj16tWN-7yh4zvRSbRg7aIb3tp4dnZQapNK50J3Q';

  PropertiesService.getScriptProperties().setProperty(SB_PROP_ANON, ANON);
  if (typeof _propsLupakan_ === 'function') _propsLupakan_();

  Logger.log('Anon key tersimpan (' + ANON.length + ' karakter).');
  Logger.log('Buktikan sekarang juga dengan SUPABASE_UJI_ANON().');
}

/**
 * Membuktikan kunci di atas benar-benar diterima.
 *
 * Memanggil Edge Function `dbabsen` sungguhan dengan aksi paling murah
 * yang ada (`versi`). Kalau ia menjawab angka, berarti kartu tamu DAN
 * rahasia sinkron dua-duanya diterima — tidak perlu menebak lagi.
 *
 * Aman dijalankan kapan saja: `versi` hanya membaca, tidak menulis
 * sebaris pun.
 */
function SUPABASE_UJI_ANON() {
  const anon = String(PropertiesService.getScriptProperties().getProperty(SB_PROP_ANON) || '');
  Logger.log('Anon key tersimpan : ' + (anon ? anon.length + ' karakter' : '(KOSONG — jalankan SUPABASE_SETUP_ANON dulu)'));

  try {
    const hasil = _sbDbAbsen('versi', {});
    Logger.log('Jawaban dbabsen    : ' + JSON.stringify(hasil));
    Logger.log('');
    Logger.log('>>> BERHASIL. Apps Script sudah bisa memanggil Edge Function dbabsen.');
    Logger.log('    Isi db_absen saat ini: ' + hasil.total + ' baris.');
    if (Number(hasil.total) === 0) {
      Logger.log('    (Masih kosong — itu wajar sebelum SUPABASE_SEMAI_DBABSEN dijalankan.)');
    }
    return hasil;
  } catch (e) {
    const pesan = String(e && e.message ? e.message : e);
    Logger.log('Jawaban dbabsen    : GAGAL — ' + pesan);
    Logger.log('');
    if (pesan.indexOf('401') !== -1) {
      Logger.log('>>> HTTP 401 = kartu tamunya ditolak. Anon key salah atau belum tersimpan.');
      Logger.log('    Salin ulang nilainya dari src/config/constants.js, lalu jalankan');
      Logger.log('    SUPABASE_SETUP_ANON() lagi.');
    } else if (pesan.indexOf('Tidak berwenang') !== -1) {
      Logger.log('>>> Kartu tamu diterima, tapi SINKRON_RAHASIA tidak cocok.');
      Logger.log('    Samakan nilainya dengan secret SINKRON_RAHASIA di Supabase.');
    } else if (pesan.indexOf('belum disiapkan') !== -1) {
      Logger.log('>>> SUPABASE_URL / SUPABASE_SINKRON_RAHASIA belum diisi.');
      Logger.log('    Jalankan SUPABASE_SETUP() lebih dulu.');
    } else {
      Logger.log('>>> Belum jelas penyebabnya. Pesan di atas apa adanya dari Supabase.');
    }
    throw e;
  }
}

/**
 * Menampilkan AUTH_SECRET supaya bisa dipasang sebagai secret di
 * Supabase. Edge Function login WAJIB memakai nilai yang sama — kalau
 * berbeda, tokennya akan ditolak setiap endpoint Apps Script.
 *
 * HATI-HATI: nilainya tercetak di log eksekusi. Jalankan seperlunya,
 * jangan bagikan tangkapan layarnya.
 */
function SUPABASE_TAMPILKAN_RAHASIA() {
  Logger.log('AUTH_SECRET = ' + PropertiesService.getScriptProperties().getProperty('AUTH_SECRET'));
  Logger.log('Pasang nilai itu di Supabase: Edge Functions > Secrets > AUTH_SECRET');
}

// =====================================================================
// UJI MENYELURUH — SATU KLIK
//
// Menggantikan seluruh langkah 6 di SUPABASE-FASE1.md. Tidak perlu curl,
// Postman, atau menyalin token dari mana pun: fungsi ini memanggil Edge
// Function login sungguhan, lalu memverifikasi tokennya dengan
// verifyAuthToken() yang asli — kode yang sama persis yang dipakai
// setiap request aplikasi.
//
// Kalau ia berkata BERHASIL, itu bukan perkiraan. Artinya token terbitan
// Supabase memang diterima seluruh endpoint Apps Script.
//
// ⚠️ PERINGATAN: login yang berhasil MENERBITKAN SESI BARU untuk akun
// itu, persis seperti login sungguhan. Karyawan pemilik akun akan
// terlempar ke layar login pada request berikutnya. Pakai akun uji, atau
// akun Anda sendiri, atau jalankan di luar jam kerja.
// =====================================================================
function SUPABASE_UJI_LOGIN() {
  // Kosongkan kembali keduanya setelah selesai menguji — ini kode sumber,
  // bukan tempat menyimpan kredensial.
  const USERNAME = '';   // <-- isi username akun UJI
  const PASSWORD = '';   // <-- isi kata sandinya

  if (!USERNAME || !PASSWORD) {
    Logger.log('Isi dulu USERNAME dan PASSWORD di dalam fungsi SUPABASE_UJI_LOGIN.');
    Logger.log('PERINGATAN: akun itu akan mendapat sesi baru, sehingga sesi');
    Logger.log('yang sedang berjalan di HP-nya akan digusur. Pakai akun uji.');
    return;
  }

  const cfg = _sbKonfig();

  // --- 1. Cari ID karyawan dari username ---------------------------
  const rowsUser = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
  let userId = '';
  for (let i = 1; i < rowsUser.length; i++) {
    if (String(rowsUser[i][1] || '').trim().toLowerCase() === USERNAME.trim().toLowerCase()) {
      userId = String(rowsUser[i][0] || '').trim();
      break;
    }
  }
  if (!userId) {
    Logger.log('>>> Username "' + USERNAME + '" tidak ada di sheet Users.');
    return;
  }

  // --- 2. Cari perangkat yang MEMANG sudah terikat ke akun itu ------
  //
  // Edge Function sengaja hanya melayani perangkat yang sudah dikenal
  // dan sudah terikat (lihat catatan di login/index.ts). Tanpa langkah
  // ini, ujinya selalu berakhir FALLBACK_APPS_SCRIPT dan tokennya tidak
  // pernah terbit — jadi yang paling ingin dibuktikan justru tidak ikut
  // teruji.
  let deviceId = '';
  const shBind = SS.getSheetByName(DEVICE_USER_SHEET);
  if (shBind) {
    const b = bacaSheet(shBind, DEVICE_USER_HEADERS.length);
    for (let i = 1; i < b.length; i++) {
      if (String(b[i][1] || '').trim() !== userId) continue;
      if (String(b[i][7] || '').trim().toLowerCase() === 'dilepas') continue;
      deviceId = String(b[i][0] || '').trim();
      if (deviceId) break;
    }
  }
  if (!deviceId) {
    Logger.log('>>> Akun ini belum punya perangkat terikat di sheet DeviceUser.');
    Logger.log('>>> Edge Function akan menjawab FALLBACK_APPS_SCRIPT (itu memang');
    Logger.log('>>> perilaku yang benar), tetapi tokennya jadi tidak bisa diuji.');
    Logger.log('>>> Pakai akun yang sudah pernah login dari sebuah HP.');
    return;
  }
  Logger.log('Menguji dengan userId=' + userId + ' deviceId=' + deviceId);

  // --- 3. Panggil Edge Function login -------------------------------
  const res = UrlFetchApp.fetch(cfg.url + '/functions/v1/login', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ username: USERNAME, password: PASSWORD, deviceId: deviceId }),
    muteHttpExceptions: true
  });
  Logger.log('HTTP ' + res.getResponseCode());

  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('>>> GAGAL: jawaban bukan JSON. Isi mentahnya:');
    Logger.log(res.getContentText().substring(0, 500));
    return;
  }

  if (data.code === 'FALLBACK_APPS_SCRIPT') {
    Logger.log('>>> Edge Function menyerah (FALLBACK_APPS_SCRIPT).');
    Logger.log('>>> Itu SAH — aplikasi akan memakai jalur Apps Script. Tapi untuk');
    Logger.log('>>> menguji token, sebabnya harus dihilangkan dulu. Periksa:');
    Logger.log('>>>   - sudahkah SUPABASE_SINKRON_MASTER() dijalankan?');
    Logger.log('>>>   - apakah AUTH_SECRET sudah dipasang di Supabase?');
    Logger.log('>>>   - apakah perangkat ' + deviceId + ' berstatus diblokir?');
    return;
  }

  if (data.result !== 'success' || !data.user || !data.user.token) {
    Logger.log('>>> Login ditolak: ' + (data.message || JSON.stringify(data).substring(0, 300)));
    Logger.log('>>> Kalau pesannya "Username/Password salah!" padahal benar,');
    Logger.log('>>> kemungkinan besar SUPABASE_SINKRON_MASTER() belum dijalankan');
    Logger.log('>>> sehingga tabel karyawan di Postgres masih kosong.');
    return;
  }

  Logger.log('Login BERHASIL di Supabase. Nama: ' + data.user.nama
    + ' | sisa cuti: ' + data.user.sisaCuti
    + ' | masterData: ' + (data.masterData || []).length + ' entri'
    + ' | periode aktif: ' + ((data.periodsAktif || []).length));

  // --- 4. Inti pengujian: apakah Apps Script menerima tokennya? -----
  _sbPeriksaToken(data.user.token);
}

/**
 * Memverifikasi sebuah token dengan verifyAuthToken() yang asli, lalu
 * memastikan SessionID-nya sudah sampai ke Script Properties.
 * @private
 */
function _sbPeriksaToken(token) {
  // Menjawab satu-satunya hal yang tidak bisa dipastikan dari sisi
  // Supabase: apakah base64EncodeWebSafe mempertahankan tanda '='.
  // 'YWI=' berarti YA (setelan bawaan token.ts sudah benar).
  // 'YWI'  berarti TIDAK — ubah PERTAHANKAN_PADDING menjadi false di
  //        supabase/functions/_bersama/token.ts lalu deploy ulang.
  Logger.log('base64EncodeWebSafe("ab") = "'
    + Utilities.base64EncodeWebSafe(Utilities.newBlob('ab').getBytes()) + '"');

  const isi = verifyAuthToken(token);
  if (!isi) {
    Logger.log('>>> GAGAL: tanda tangan tidak cocok atau token kedaluwarsa.');
    Logger.log('>>> Penyebab paling sering: AUTH_SECRET di Supabase berbeda');
    Logger.log('>>> dengan yang ada di Script Properties. Bandingkan lewat');
    Logger.log('>>> SUPABASE_TAMPILKAN_RAHASIA().');
    Logger.log('>>> Kalau baris base64 di atas berbunyi "YWI" (tanpa "="),');
    Logger.log('>>> sebabnya padding — lihat PERTAHANKAN_PADDING di token.ts.');
    return;
  }

  Logger.log('Tanda tangan COCOK. Isi token: ' + JSON.stringify(isi));

  // Sesi harus sudah tertarik, kalau tidak request berikutnya ditolak.
  SUPABASE_TARIK_SESI();
  const sesiBerlaku = deviceSesiBerlaku(isi.u);
  Logger.log('SessionID di token            : ' + isi.s);
  Logger.log('SessionID di Script Properties: ' + (sesiBerlaku || '(kosong)'));

  if (sesiBerlaku !== isi.s) {
    Logger.log('>>> BELUM COCOK. Jalankan SUPABASE_TARIK_SESI() sekali lagi;');
    Logger.log('>>> kalau tetap beda, periksa log Edge Function sesi-terbaru.');
    return;
  }

  Logger.log('');
  Logger.log('>>> BERHASIL. Token terbitan Supabase diterima Apps Script,');
  Logger.log('>>> dan sesinya sudah tersalin. Langkah 7 aman dijalankan.');
  Logger.log('');
  Logger.log('>>> SEKARANG KOSONGKAN KEMBALI USERNAME dan PASSWORD di dalam');
  Logger.log('>>> fungsi ini. Keduanya tersimpan sebagai KODE SUMBER, terbaca');
  Logger.log('>>> siapa pun yang punya akses ke editor Apps Script ini, dan');
  Logger.log('>>> ikut terbawa setiap kali isinya disalin atau di-screenshot.');
}

/**
 * Versi manual: kalau Anda sudah punya token dari tempat lain (curl,
 * Postman), tempel di sini. Untuk pemakaian biasa, SUPABASE_UJI_LOGIN()
 * di atas lebih mudah karena tidak perlu menyalin apa pun.
 */
function SUPABASE_UJI_TOKEN() {
  const TOKEN = ''; // <-- tempel token dari respons login Edge Function

  if (!TOKEN) {
    Logger.log('Tempel dulu tokennya, atau pakai SUPABASE_UJI_LOGIN() yang');
    Logger.log('mengerjakan seluruhnya sendiri tanpa perlu menyalin apa pun.');
    return;
  }
  _sbPeriksaToken(TOKEN);
}

/** Memasang kedua trigger. Aman dipanggil berulang. */
function SUPABASE_PASANG_TRIGGER() {
  SUPABASE_LEPAS_TRIGGER();
  ScriptApp.newTrigger('SUPABASE_TARIK_SESI').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('SUPABASE_SINKRON_MASTER').timeBased().everyMinutes(10).create();
  // Cermin dbabsen. Tiap 5 menit sudah cukup: yang mengubahnya hanya
  // import, beberapa kali sehari. Penarikan yang menemukan sidik isi
  // tidak berubah berhenti tanpa menyentuh satu sel pun.
  ScriptApp.newTrigger('SUPABASE_TARIK_DBABSEN').timeBased().everyMinutes(5).create();
  Logger.log('Trigger terpasang: sesi 1 menit, master 10 menit, cermin dbabsen 5 menit.');
}

/** Melepas kedua trigger. */
function SUPABASE_LEPAS_TRIGGER() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'SUPABASE_TARIK_SESI' || f === 'SUPABASE_SINKRON_MASTER' ||
        f === 'SUPABASE_TARIK_DBABSEN') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('Trigger dilepas: ' + n);
}

// =====================================================================
// FASE 2 — dbabsen
//
// ARAHNYA BERLAWANAN DENGAN FASE 1, dan itu disengaja:
//
//   karyawan : Sheets menulis  -> Postgres cermin   (SUPABASE_SINKRON_MASTER)
//   dbabsen  : Postgres menulis -> sheet cermin     (SUPABASE_TARIK_DBABSEN)
//
// Satu tabel tetap punya SATU penulis; yang berubah cuma siapa. Sejak
// ini dipakai, sheet `dbabsen` TIDAK BOLEH lagi diedit tangan — isinya
// ditimpa setiap kali Postgres berubah.
// =====================================================================

const SB_PROP_DBABSEN      = 'SUPABASE_DBABSEN';        // '1' = jalur baru menyala
const SB_PROP_DBABSEN_CAP  = 'SUPABASE_DBABSEN_CAP';    // sidik isi terakhir yang sudah ditulis ke sheet

// Potongan penyemaian & penarikan. 2.000 baris x 18 kolom masih jauh di
// bawah batas muatan Edge Function, dan cukup kecil untuk selesai dalam
// satu eksekusi Apps Script.
const SB_DBABSEN_POTONGAN = 2000;

// Urutannya HARUS sama dengan kolom B..S sheet dbabsen. Dipakai dua
// arah — menyemai ke Postgres dan menulis balik ke sheet — supaya tidak
// ada dua daftar kolom yang bisa berbeda diam-diam.
const SB_DBABSEN_KOLOM = [
  'no_akun', 'nik', 'nama', 'tanggal', 'jam_kerja', 'mulai_tugas',
  'akhir_tugas', 'masuk', 'pulang', 'telat', 'pulang_awal', 'bolos',
  'durasi_kerja', 'symbol', 'departemen', 'att_time', 'waktu_scan', 'minggu'
];

/**
 * Sakelar jalur baru. Selama '0' atau kosong, SELURUH pembacaan tetap
 * memakai sheet seperti sebelumnya — jadi menyalakannya bukan taruhan,
 * dan mematikannya kembali satu properti.
 */
function sbDbAbsenAktif() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(SB_PROP_DBABSEN) || '') === '1';
  } catch (e) {
    return false;
  }
}

/** @private */
function _sbDbAbsen(aksi, muatan) {
  const isi = muatan || {};
  isi.aksi = aksi;
  return _sbPanggil('dbabsen', isi);
}

// ---------------------------------------------------------------------
// PENYEMAIAN: isi sheet yang sudah ada -> Postgres
//
// Dijalankan SEKALI, manual, sebelum sakelar dinyalakan. Tanpa ini
// Postgres kosong dan semua pembacaan mengembalikan nol — bukan error,
// yang justru lebih berbahaya karena tidak ada yang sadar.
// ---------------------------------------------------------------------
function SUPABASE_SEMAI_DBABSEN() {
  const sheet = SS.getSheetByName(SHEET_DB_ABSEN);
  if (!sheet) throw new Error('Sheet dbabsen tidak ditemukan.');

  const rows = bacaSheet(sheet, 19);
  if (rows.length < 2) throw new Error('Sheet dbabsen kosong, tidak ada yang bisa disemai.');

  const sesi = 'semai-' + new Date().getTime();
  let terkirim = 0;
  let dilewati = 0;
  let potongan = [];

  const kirim = function () {
    if (!potongan.length) return;
    _sbDbAbsen('impor_potongan', { sesi: sesi, baris: potongan });
    terkirim += potongan.length;
    potongan = [];
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    // Baris tanpa tanggal terbaca tidak bisa dimasukkan: tanggal adalah
    // separuh kunci. Dihitung dan dilaporkan, bukan dibuang diam-diam.
    const ymd = formatDateYMD_Strict(r[4]);
    if (!ymd) { dilewati++; continue; }
    // Baris tanpa No.Akun DAN tanpa NIK tidak punya kunci sama sekali.
    if (!String(r[1] || '').trim() && !String(r[2] || '').trim()) { dilewati++; continue; }

    const b = {};
    for (let k = 0; k < SB_DBABSEN_KOLOM.length; k++) {
      b[SB_DBABSEN_KOLOM[k]] = String(r[k + 1] === null || r[k + 1] === undefined ? '' : r[k + 1]).trim();
    }
    b.tanggal = ymd;
    potongan.push(b);

    if (potongan.length >= SB_DBABSEN_POTONGAN) kirim();
  }
  kirim();

  if (!terkirim) throw new Error('Tidak ada baris yang bisa disemai (semua dilewati).');

  // replace: Postgres diisi ULANG dari sheet, bukan digabung. Penyemaian
  // yang diulang karena gagal di tengah karena itu aman — tidak ada
  // baris kembar yang tertinggal.
  const hasil = _sbDbAbsen('impor_commit', { sesi: sesi, mode: 'replace' });

  Logger.log('Semai selesai: ' + terkirim + ' baris terkirim, ' + dilewati + ' dilewati.');
  Logger.log('Jawaban commit: ' + JSON.stringify(hasil));
  Logger.log('');
  Logger.log('Berikutnya: bandingkan dulu dengan SUPABASE_UJI_DBABSEN(),');
  Logger.log('baru nyalakan sakelarnya dengan SUPABASE_DBABSEN_NYALAKAN().');
  return hasil;
}

/** Menyalakan / mematikan jalur baca baru. */
function SUPABASE_DBABSEN_NYALAKAN() {
  PropertiesService.getScriptProperties().setProperty(SB_PROP_DBABSEN, '1');
  if (typeof _propsLupakan_ === 'function') _propsLupakan_();
  Logger.log('Jalur dbabsen Supabase DINYALAKAN.');
}

function SUPABASE_DBABSEN_MATIKAN() {
  PropertiesService.getScriptProperties().setProperty(SB_PROP_DBABSEN, '0');
  if (typeof _propsLupakan_ === 'function') _propsLupakan_();
  Logger.log('Jalur dbabsen Supabase DIMATIKAN — semua pembacaan kembali ke sheet.');
}

// ---------------------------------------------------------------------
// CERMIN: Postgres -> sheet dbabsen
//
// Dipasang sebagai trigger. Sheet ditulis ULANG SELURUHNYA, bukan
// digabung baris per baris. Alasannya: Postgres satu-satunya penulis,
// jadi tidak ada perubahan lokal yang perlu dipertahankan — dan menulis
// ulang sekali jauh lebih sederhana (juga lebih sulit salah) daripada
// mencocokkan ribuan kunci di dalam Apps Script.
//
// Biayanya dijaga oleh sidik isi: selama `versi` menjawab jumlah baris
// dan stempel terbaru yang sama, TIDAK ADA satu sel pun yang ditulis.
// ---------------------------------------------------------------------
function SUPABASE_TARIK_DBABSEN(paksa) {
  if (!sbDbAbsenAktif()) {
    Logger.log('Jalur dbabsen belum dinyalakan; penarikan dilewati.');
    return 0;
  }

  const props = PropertiesService.getScriptProperties();
  const versi = _sbDbAbsen('versi', {});
  const sidik = String(versi.total) + '|' + String(versi.terbaru || '');

  if (sidik === String(props.getProperty(SB_PROP_DBABSEN_CAP) || '')) {
    return 0; // tidak ada yang berubah — jalur paling sering dilewati.
  }

  const sheet = SS.getSheetByName(SHEET_DB_ABSEN);
  if (!sheet) throw new Error('Sheet dbabsen tidak ditemukan.');

  // Seluruh isi ditarik lebih dulu ke memori. Sheet baru disentuh
  // setelah penarikan BERHASIL SELURUHNYA — kalau putus di tengah,
  // sheet lama tetap utuh, bukan setengah jadi.
  const semua = [];
  let offset = 0;
  for (;;) {
    const hal = _sbDbAbsen('semua', { offset: offset, batas: SB_DBABSEN_POTONGAN });
    const baris = hal.baris || [];
    for (let i = 0; i < baris.length; i++) semua.push(baris[i]);

    // Berhenti HANYA pada halaman kosong — bukan pada halaman yang lebih
    // kecil dari yang diminta. PostgREST membatasi baris per permintaan
    // (bawaannya 1.000), jadi halaman yang "kurang" adalah hal biasa,
    // bukan tanda sudah habis. Lihat catatan panjang di
    // _sbSemuaBarisMesin (Code.gs).
    if (!baris.length) break;
    offset += baris.length;
    if (offset > 200000) throw new Error('Penarikan dbabsen melebihi batas wajar; dihentikan.');
  }

  if (!semua.length) {
    Logger.log('Postgres kosong — sheet TIDAK dikosongkan. Jalankan SUPABASE_SEMAI_DBABSEN() dulu.');
    return 0;
  }

  // Patokannya sudah ada di tangan: `versi.total` yang dibaca di atas.
  // Kalau yang tertarik tidak sebanyak itu, sheet JANGAN ditulis —
  // menulis separuh isi ke cermin sama saja membuang separuhnya.
  if (semua.length !== Number(versi.total)) {
    throw new Error('Penarikan TIDAK LENGKAP: dapat ' + semua.length + ' dari '
      + versi.total + ' baris. Sheet tidak disentuh.');
  }

  const keluar = new Array(semua.length);
  for (let i = 0; i < semua.length; i++) {
    const s = semua[i];
    const baris = new Array(19).fill('');   // kolom A memang kosong
    for (let k = 0; k < SB_DBABSEN_KOLOM.length; k++) {
      baris[k + 1] = s[SB_DBABSEN_KOLOM[k]] === null || s[SB_DBABSEN_KOLOM[k]] === undefined
        ? '' : String(s[SB_DBABSEN_KOLOM[k]]);
    }
    // Tanggal harus objek Date — formatDateYMD_Strict dan seluruh
    // pembaca lama bergantung padanya. 'T00:00:00' (tanpa Z) supaya
    // dibaca sebagai tengah malam waktu skrip, bukan UTC, sehingga
    // tidak ada yang bergeser satu hari.
    baris[4] = new Date(String(s.tanggal) + 'T00:00:00');
    keluar[i] = baris;
  }

  const lastRow = sheet.getLastRow();

  // PENJAGA SEBELUM MENIMPA.
  //
  // Penarikan ini MENGHAPUS seluruh isi sheet lalu menulis ulang. Kalau
  // Postgres kebetulan setengah terisi — penyemaian yang putus, tabel
  // yang baru dibersihkan, import yang gagal di tengah — penulisan ulang
  // itu memusnahkan data yang masih utuh di sheet, dan tidak ada Undo.
  //
  // Karena itu penyusutan drastis diperlakukan sebagai tanda bahaya,
  // bukan sebagai perintah. Ambangnya longgar (setengah) supaya
  // penyusutan wajar — periode bergulir, baris ganda dibersihkan — tetap
  // lewat.
  const barisSheetLama = Math.max(lastRow - 1, 0);
  if (!paksa && barisSheetLama > 0 && keluar.length < barisSheetLama / 2) {
    throw new Error(
      'Penarikan DIBATALKAN demi keamanan: Postgres hanya punya ' + keluar.length +
      ' baris sementara sheet punya ' + barisSheetLama + '. Menulis ulang sekarang akan ' +
      'membuang lebih dari separuh isi sheet. Periksa dulu isi db_absen; kalau penyusutan ' +
      'ini memang disengaja, jalankan SUPABASE_TARIK_DBABSEN_PAKSA().'
    );
  }

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 19).clearContent();
  sheet.getRange(2, 1, keluar.length, 19).setValues(keluar);

  // Format kolom: semua teks kecuali tanggal. Kalau tidak, "08:06"
  // ditafsirkan Sheets sebagai nilai jam dan tampil sebagai 30/12/1899.
  if (typeof _importSetFormatKolom === 'function') {
    _importSetFormatKolom(sheet, 2, keluar.length);
  }
  sheet.getRange('T1').setValue(new Date());

  props.setProperty(SB_PROP_DBABSEN_CAP, sidik);
  if (typeof _propsLupakan_ === 'function') _propsLupakan_();

  // Indeks statistik lama disusun dari isi sheet yang barusan berubah.
  if (typeof bersihkanIndeksDbAbsen === 'function') {
    try { bersihkanIndeksDbAbsen(); } catch (e) { console.warn('Gagal bersihkan indeks: ' + e.message); }
  }

  Logger.log('Cermin dbabsen diperbarui: ' + keluar.length + ' baris.');
  return keluar.length;
}

// ---------------------------------------------------------------------
// PEMBUKTIAN
//
// Membandingkan angka statistik versi Postgres dengan versi sheet untuk
// beberapa NIK, memakai periode aktif. Jalankan SEBELUM sakelar
// dinyalakan — kalau ada yang berbeda, ia mencetak selisihnya, bukan
// sekadar berkata gagal.
// ---------------------------------------------------------------------
function SUPABASE_UJI_DBABSEN(periodeDipaksa) {
  let periode = periodeDipaksa || getPeriodeAbsenAktif_();
  let idxSheet = _susunIndeksDbAbsen(periode);
  let nikSemua = Object.keys(idxSheet);

  // Periode aktif bisa saja BARU berganti, sementara isi dbabsen masih
  // periode sebelumnya — misalnya dijalankan sehari setelah periode
  // bergulir, sebelum import berikutnya masuk. Membandingkan periode
  // yang memang belum punya data bukan kegagalan, tapi hasilnya nol dan
  // membingungkan. Jadi kalau itu terjadi, pembandingan dipindahkan ke
  // rentang yang BENAR-BENAR ada isinya di Postgres.
  if (!nikSemua.length && !periodeDipaksa) {
    Logger.log('Periode aktif (' + periode.mulai + ' .. ' + periode.selesai + ') belum punya data di sheet.');
    Logger.log('Beralih membandingkan SELURUH isi dbabsen, tanpa batas periode.');

    // Rentang selebar mungkin, bukan rentang yang dicari-cari. Kedua
    // sisi memakai batas yang SAMA, jadi perbandingannya tetap adil —
    // dan kalau lebar, ia justru menguji lebih banyak baris daripada
    // satu periode saja.
    periode = { mulai: '1970-01-01', selesai: '2999-12-31' };
    idxSheet = _susunIndeksDbAbsen(periode);
    nikSemua = Object.keys(idxSheet);
  }

  if (!nikSemua.length) {
    Logger.log('Indeks sheet kosong — tidak ada yang bisa dibandingkan.');
    Logger.log('Kalau dbabsen memang berisi periode lain, panggil dengan rentang eksplisit:');
    Logger.log("  SUPABASE_UJI_DBABSEN({ mulai: '2026-08-20', selesai: '2026-09-18' })");
    return;
  }

  // Sepuluh NIK dengan catatan terbanyak: paling mungkin memunculkan
  // perbedaan kalau memang ada.
  nikSemua.sort(function (a, b) {
    return Object.keys(idxSheet[b].hari_by_date).length - Object.keys(idxSheet[a].hari_by_date).length;
  });
  const contoh = nikSemua.slice(0, 10);

  const bandingkan = ['hadir', 'telat_freq', 'telat_menit', 'sakit', 'alpa', 'no_scan_in', 'no_scan_out'];
  let beda = 0;

  Logger.log('Periode: ' + periode.mulai + ' .. ' + periode.selesai);
  for (let i = 0; i < contoh.length; i++) {
    const nik = contoh[i];
    const jawab = _sbDbAbsen('statistik', { nik: nik, dari: periode.mulai, sampai: periode.selesai });
    const pg = jawab.stats || {};
    const sh = idxSheet[nik];

    const selisih = [];
    for (let k = 0; k < bandingkan.length; k++) {
      const f = bandingkan[k];
      if (Number(pg[f] || 0) !== Number(sh[f] || 0)) {
        selisih.push(f + ': sheet=' + sh[f] + ' postgres=' + pg[f]);
      }
    }
    const hariSheet = Object.keys(sh.hari_by_date).length;
    const hariPg = Object.keys(pg.hari_by_date || {}).length;
    if (hariSheet !== hariPg) selisih.push('hari_tercatat: sheet=' + hariSheet + ' postgres=' + hariPg);

    if (selisih.length) {
      beda++;
      Logger.log('BEDA  ' + nik + ' -> ' + selisih.join(' | '));
    } else {
      Logger.log('sama  ' + nik + ' (' + hariSheet + ' hari tercatat)');
    }
  }

  Logger.log('');
  Logger.log(beda === 0
    ? '>>> BERHASIL: ' + contoh.length + ' NIK sama persis. Aman menyalakan sakelar.'
    : '>>> ADA ' + beda + ' NIK BERBEDA. JANGAN nyalakan sakelar sebelum ini dijelaskan.');
}

/** Melewati penjaga penyusutan. Hanya setelah isi db_absen diperiksa. */
function SUPABASE_TARIK_DBABSEN_PAKSA() {
  return SUPABASE_TARIK_DBABSEN(true);
}

// =====================================================================
// PENGUJIAN FASE 2
// =====================================================================

/**
 * Foto keadaan kedua sisi, berdampingan. Murah dan tidak mengubah apa
 * pun, jadi boleh dijalankan sesering yang perlu.
 *
 * Pakai ini untuk membuktikan import baru benar-benar masuk: jalankan
 * SEBELUM import, lalu SESUDAHNYA, dan bandingkan angkanya.
 */
function SUPABASE_HITUNG_DBABSEN() {
  const versi = _sbDbAbsen('versi', {});
  const sheet = SS.getSheetByName(SHEET_DB_ABSEN);
  const barisSheet = sheet ? Math.max(sheet.getLastRow() - 1, 0) : 0;

  Logger.log('Postgres : ' + versi.total + ' baris, terbaru ' + (versi.terbaru || '(kosong)'));
  Logger.log('Sheet    : ' + barisSheet + ' baris');
  Logger.log(versi.total === barisSheet
    ? 'Keduanya SAMA — cermin sedang selaras.'
    : 'BERBEDA ' + Math.abs(versi.total - barisSheet) + ' baris. Wajar kalau import baru '
      + 'belum ditarik ke sheet; jalankan SUPABASE_TARIK_DBABSEN() untuk menyamakan.');

  return { postgres: versi.total, sheet: barisSheet, terbaru: versi.terbaru };
}

/**
 * Pemeriksaan menyeluruh Fase 2, satu kali jalan.
 *
 * Empat hal yang dibuktikan, berurutan — dan setiap tahap berhenti
 * kalau tahap sebelumnya gagal, karena hasil tahap berikutnya tidak
 * bisa dipercaya:
 *
 *   1. Sakelarnya memang menyala.
 *   2. Jalur BACA riwayat mengambil dari Postgres, dan isinya sama
 *      dengan yang dibaca dari sheet untuk NIK yang sama.
 *   3. Angka STATISTIK dari Postgres sama dengan hitungan sheet.
 *   4. Cermin sheet selaras dengan Postgres.
 *
 * Tidak ada yang ditulis kecuali Anda menjawab ya pada tahap 4.
 */
function SUPABASE_UJI_FASE2() {
  Logger.log('=== 1. SAKELAR ===');
  const nyala = sbDbAbsenAktif();
  Logger.log(nyala ? 'MENYALA — pembacaan diarahkan ke Postgres.' : 'MATI — semua masih lewat sheet.');
  if (!nyala) {
    Logger.log('Hentikan di sini: tanpa sakelar, tahap berikutnya tidak menguji apa pun yang baru.');
    return;
  }

  Logger.log('');
  Logger.log('=== 2. JALUR BACA RIWAYAT ===');

  // NIK contoh diambil dari sheet, bukan dari Postgres — supaya kalau
  // Postgres kehilangan seseorang, kehilangan itu KETAHUAN, bukan
  // tersembunyi karena orangnya tidak pernah ditanyakan.
  const sheetDb = SS.getSheetByName(SHEET_DB_ABSEN);
  const barisSheet = bacaSheet(sheetDb, 19);
  const hitungSheet = {};
  for (let i = 1; i < barisSheet.length; i++) {
    const nik = String(barisSheet[i][2] || '').trim();
    if (nik) hitungSheet[nik] = (hitungSheet[nik] || 0) + 1;
  }
  const nikContoh = Object.keys(hitungSheet).sort(function (a, b) {
    return hitungSheet[b] - hitungSheet[a];
  }).slice(0, 5);

  if (!nikContoh.length) {
    Logger.log('Sheet dbabsen kosong — tidak ada yang bisa diuji.');
    return;
  }

  let bedaBaca = 0;
  for (let i = 0; i < nikContoh.length; i++) {
    const nik = nikContoh[i];
    const dariPg = _sbBarisMesin(nik).length - 1;   // dikurangi baris judul palsu
    const dariSheet = hitungSheet[nik];
    const sama = (dariPg === dariSheet);
    if (!sama) bedaBaca++;
    Logger.log((sama ? 'sama  ' : 'BEDA  ') + nik + ' -> sheet=' + dariSheet + ' postgres=' + dariPg);
  }
  if (bedaBaca) {
    Logger.log('>>> ' + bedaBaca + ' NIK berbeda jumlah barisnya. JANGAN lanjut sebelum dijelaskan.');
    return;
  }
  Logger.log('>>> Jalur baca riwayat COCOK untuk ' + nikContoh.length + ' NIK tersibuk.');

  Logger.log('');
  Logger.log('=== 3. ANGKA STATISTIK ===');
  SUPABASE_UJI_DBABSEN();

  Logger.log('');
  Logger.log('=== 4. CERMIN SHEET ===');
  SUPABASE_HITUNG_DBABSEN();
  Logger.log('Kalau keduanya berbeda dan Anda memang baru mengimpor, jalankan');
  Logger.log('SUPABASE_TARIK_DBABSEN() lalu ulangi SUPABASE_HITUNG_DBABSEN().');
}

/**
 * Memeriksa kolom T sheet dbabsen pada BARIS DATA.
 *
 * KENAPA INI PENTING. Kolom T diisi stempel waktu oleh trigger onEdit
 * setiap kali sebuah baris dbabsen diedit tangan. Tetapi
 * handleGetRekapAdmin membacanya sebagai `existingNominal` — nominal
 * denda yang sudah ditetapkan:
 *
 *     const nominal = _hitungNominalDenda(r[10] || telat, r[19]);
 *
 * dan di dalamnya `Number(existingNominal) > 0`. Objek Date yang
 * di-Number() menjadi epoch milidetik, yaitu angka raksasa. Jadi setiap
 * baris yang pernah diedit tangan menampilkan denda miliaran rupiah,
 * bukan Rp 25.000.
 *
 * Selama dbabsen murni dari import, kolom itu kosong dan bug ini tidak
 * pernah muncul. Fungsi ini membuktikannya — dan kalau ternyata TIDAK
 * kosong, ia menunjukkan baris mana saja, supaya keputusan memindahkan
 * rekap ke Postgres diambil dengan mata terbuka.
 */
function SUPABASE_PERIKSA_KOLOM_T() {
  const sheet = SS.getSheetByName(SHEET_DB_ABSEN);
  if (!sheet) { Logger.log('Sheet dbabsen tidak ditemukan.'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Sheet dbabsen tidak punya baris data.'); return; }

  const kolomT = sheet.getRange(2, 20, lastRow - 1, 1).getValues();
  const kolomNik = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  const kolomTgl = sheet.getRange(2, 5, lastRow - 1, 1).getValues();

  let terisi = 0;
  const contoh = [];
  for (let i = 0; i < kolomT.length; i++) {
    const v = kolomT[i][0];
    if (v === '' || v === null || v === undefined) continue;
    terisi++;
    if (contoh.length < 10) {
      contoh.push('baris ' + (i + 2) + ' | NIK ' + kolomNik[i][0]
        + ' | tgl ' + formatDateYMD_Strict(kolomTgl[i][0])
        + ' | isi kolom T: ' + v + ' (Number -> ' + Number(v) + ')');
    }
  }

  Logger.log('Baris data diperiksa : ' + kolomT.length);
  Logger.log('Kolom T terisi       : ' + terisi);
  Logger.log('');

  if (terisi === 0) {
    Logger.log('>>> BERSIH. Kolom T kosong di seluruh baris data, jadi denda selalu');
    Logger.log('    dihitung dari kolom telat. Memindahkan rekap ke Postgres TIDAK');
    Logger.log('    mengubah satu angka pun.');
    return 0;
  }

  Logger.log('>>> ADA ' + terisi + ' BARIS dengan kolom T terisi. Contohnya:');
  contoh.forEach(function (c) { Logger.log('    ' + c); });
  Logger.log('');
  Logger.log('    Kalau nilainya tanggal/jam, baris-baris itu SEKARANG menampilkan');
  Logger.log('    denda sebesar epoch milidetiknya — miliaran rupiah. Periksa menu');
  Logger.log('    Rekapitulasi untuk NIK di atas sebelum memutuskan apa pun.');
  return terisi;
}

// =====================================================================
// LOG LOGIN
//
// Tabelnya diisi Edge Function `login` (satu baris per percobaan,
// berhasil maupun gagal). Apps Script hanya MEMBACA — dan pembacaannya
// pun tidak pernah sampai ke browser karyawan: handler di Code.gs
// menolak siapa pun yang bukan admin.
// =====================================================================

/** @private */
function _sbLogLogin(aksi, muatan) {
  const isi = muatan || {};
  isi.aksi = aksi;
  return _sbPanggil('log-login', isi);
}

/**
 * Membuang baris log yang lebih tua dari 90 hari.
 *
 * Dipanggil dari SUPABASE_SINKRON_MASTER yang sudah berjalan tiap 10
 * menit — bukan dari jalur login. Login adalah jalur terpanas aplikasi
 * ini; ia tidak boleh menanggung pekerjaan perawatan hanya karena
 * kebetulan ialah yang menulis barisnya.
 *
 * Kegagalan di sini sengaja tidak dilempar: log yang menumpuk beberapa
 * hari lebih lama tidak merugikan siapa pun, sedangkan sinkronisasi
 * master yang gagal karenanya merugikan semua orang.
 */
function SUPABASE_BERSIHKAN_LOG_LOGIN() {
  try {
    const hasil = _sbLogLogin('bersihkan', {});
    if (hasil && Number(hasil.dibuang) > 0) {
      console.log('Log login: ' + hasil.dibuang + ' baris lewat 90 hari dibuang.');
    }
    return hasil;
  } catch (e) {
    console.warn('Pembersihan log login gagal (diabaikan): ' + e.message);
    return null;
  }
}
