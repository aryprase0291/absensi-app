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

/** @private */
function _sbPanggil(namaFungsi, muatan) {
  const cfg = _sbKonfig();
  const res = UrlFetchApp.fetch(cfg.url + '/functions/v1/' + namaFungsi, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sinkron-rahasia': cfg.rahasia },
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

/**
 * BUKTI bahwa token buatan Edge Function benar-benar diterima Apps Script.
 *
 * Jalankan SETELAH Edge Function login ter-deploy. Tempel token yang
 * dikembalikannya ke TOKEN di bawah. Kalau fungsi ini berkata BERHASIL,
 * seluruh endpoint lama akan menerimanya juga — karena yang dipakai di
 * sini persis verifyAuthToken yang sama.
 */
function SUPABASE_UJI_TOKEN() {
  const TOKEN = ''; // <-- tempel token dari respons login Edge Function

  if (!TOKEN) {
    Logger.log('Tempel dulu tokennya ke dalam fungsi SUPABASE_UJI_TOKEN.');
    return;
  }

  // Menjawab satu-satunya hal yang tidak bisa dipastikan dari sisi
  // Supabase: apakah base64EncodeWebSafe mempertahankan tanda '='.
  // 'YWI=' berarti YA (setelan bawaan token.ts sudah benar).
  // 'YWI'  berarti TIDAK — ubah PERTAHANKAN_PADDING menjadi false di
  //        supabase/functions/_bersama/token.ts lalu deploy ulang.
  Logger.log('base64EncodeWebSafe("ab") = "'
    + Utilities.base64EncodeWebSafe(Utilities.newBlob('ab').getBytes()) + '"');

  const isi = verifyAuthToken(TOKEN);
  if (!isi) {
    Logger.log('>>> GAGAL: tanda tangan tidak cocok atau token kedaluwarsa.');
    Logger.log('Penyebab paling sering: AUTH_SECRET di Supabase berbeda dengan');
    Logger.log('yang ada di Script Properties. Bandingkan lewat SUPABASE_TAMPILKAN_RAHASIA().');
    return;
  }

  Logger.log('Tanda tangan COCOK. Isi token: ' + JSON.stringify(isi));

  const sesiBerlaku = deviceSesiBerlaku(isi.u);
  Logger.log('SessionID di token          : ' + isi.s);
  Logger.log('SessionID di Script Properties: ' + (sesiBerlaku || '(kosong)'));

  if (!sesiBerlaku) {
    Logger.log('>>> Sesi belum tertarik. Jalankan SUPABASE_TARIK_SESI() lalu ulangi.');
  } else if (sesiBerlaku !== isi.s) {
    Logger.log('>>> BELUM COCOK: penarik sesi belum sampai ke baris ini, atau');
    Logger.log('>>> ada login lain sesudahnya. Jalankan SUPABASE_TARIK_SESI() lalu ulangi.');
  } else {
    Logger.log('>>> BERHASIL: token ini akan diterima semua endpoint Apps Script.');
  }
}

/** Memasang kedua trigger. Aman dipanggil berulang. */
function SUPABASE_PASANG_TRIGGER() {
  SUPABASE_LEPAS_TRIGGER();
  ScriptApp.newTrigger('SUPABASE_TARIK_SESI').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('SUPABASE_SINKRON_MASTER').timeBased().everyMinutes(10).create();
  Logger.log('Trigger terpasang: tarik sesi tiap 1 menit, sinkron master tiap 10 menit.');
}

/** Melepas kedua trigger. */
function SUPABASE_LEPAS_TRIGGER() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'SUPABASE_TARIK_SESI' || f === 'SUPABASE_SINKRON_MASTER') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('Trigger dilepas: ' + n);
}
