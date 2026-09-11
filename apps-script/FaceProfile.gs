// =======================================================
// WAJAH ACUAN KARYAWAN — PENCOCOKAN IDENTITAS SAAT ABSEN
// File: FaceProfile.gs
//
// Bedanya dengan yang SUDAH ADA (faceLiveness.js, v1.0.17):
//   - Yang lama menjawab "apakah ini WAJAH MANUSIA yang hidup dan utuh?"
//   - Yang ini menjawab "apakah ini wajah SI PEMILIK AKUN?"
// Keduanya dipakai berurutan pada absen Hadir & Pulang.
//
// CARA KERJANYA, DAN KENAPA BEGINI.
//
// Yang disimpan bukan foto, melainkan DESKRIPTOR: 128 angka hasil model
// face_recognition dari face-api.js. Dua foto orang yang sama menghasilkan
// dua deskriptor yang berdekatan; orang berbeda berjauhan. Jaraknya
// dihitung dengan Euclidean.
//
// PENTING — deskriptor acuan TIDAK PERNAH DIKIRIM KE KLIEN.
// Klien hanya mengirim deskriptor wajah yang baru saja dijepret, dan
// SERVER yang memutuskan cocok atau tidak. Kalau acuannya dikirim ke HP,
// siapa pun yang membuka DevTools bisa mengirim balik angka yang sama
// persis dan lolos tanpa pernah menghadap kamera. Konsekuensinya: layar
// absen perlu satu request tambahan (`verifikasi_wajah`) untuk memberi
// tahu karyawan bahwa wajahnya cocok SEBELUM ia menekan Kirim.
//
// Gerbang di handleAbsen tetap ada dan tidak boleh dihapus meski layar
// sudah memeriksa: `verifikasi_wajah` itu untuk KENYAMANAN, gerbang di
// handleAbsen itu yang benar-benar MENJAGA.
//
// MODE (Script Properties `FACE_MODE`):
//   'off'    - fitur mati.
//   'tandai' - tidak pernah menolak; ketidakcocokan hanya dicatat.
//   'ketat'  - DEFAULT. Wajah tidak cocok -> absen DITOLAK.
//
// `FACE_WAJIB_TERDAFTAR` ('1'/'0', default '0'):
//   Karyawan yang wajahnya BELUM didaftarkan admin tidak punya acuan
//   untuk dibandingkan. Default '0' meloloskannya (dengan tanda), supaya
//   fitur ini bisa dinyalakan sebelum 300-an karyawan selesai didaftarkan.
//   Setelah pendaftaran rampung, ubah ke '1' agar tidak ada celah
//   "belum terdaftar = bebas".
// =======================================================

const FACE_SHEET = 'FaceProfiles';
const FACE_HEADERS = [
  'UserID', 'Nama', 'Sampel1', 'Sampel2', 'Sampel3',
  'JumlahSampel', 'FotoAcuan', 'UpdatedAt', 'UpdatedBy', 'Catatan'
];

// Kolom sampel deskriptor: C, D, E (index 2..4)
const FACE_KOLOM_SAMPEL = [3, 4, 5];
const FACE_MAKS_SAMPEL = 3;
const FACE_PANJANG_DESKRIPTOR = 128;

const FACE_MODE_KEY = 'FACE_MODE';
const FACE_AMBANG_KEY = 'FACE_AMBANG';
const FACE_WAJIB_KEY = 'FACE_WAJIB_TERDAFTAR';

// Ambang jarak Euclidean. Model ini turunan dlib, dan baik dlib maupun
// face-api memakai 0,6 sebagai batas baku "orang yang sama".
//
// 0,52 sengaja lebih ketat: ongkos salah-terima (absen orang lain lolos)
// jauh lebih mahal daripada salah-tolak (karyawan asli mengulang foto di
// tempat yang lebih terang).
//
// TAPI angka ini WAJIB bisa disetel dari Panel Admin, dan itu bukan
// kemewahan. Kalau foto acuan diambil dari arsip HRD yang lama, buram,
// atau menyerong, ambang seketat ini akan menolak orang yang benar
// berulang kali — dan pada pagi hari saat 300 orang absen, satu-satunya
// jalan keluar yang tidak butuh deploy adalah menaikkannya sedikit.
// Naikkan bertahap (0,55 -> 0,58) dan jangan pernah lewat 0,6.
const FACE_AMBANG_DEFAULT = 0.52;

// Absen yang wajib dicocokkan wajahnya.
//
// Dinas & Sakit sengaja TIDAK ikut, tapi alasannya berbeda — jangan
// disamakan kalau suatu saat daftar ini diubah:
//   - Sakit : boleh kamera belakang, memang bukan bukti kehadiran orangnya.
//   - Dinas : kamera depannya DIKUNCI di klien (wajibKameraDepan), tetapi
//             fotonya sering berisi beberapa orang sekaligus. Syarat
//             "tepat satu wajah" yang melekat pada pencocokan identitas
//             akan menolak foto yang justru paling wajar.
const FACE_TIPE_WAJIB = ['Hadir', 'Pulang'];

// =======================================================
// KONFIGURASI
// =======================================================

function faceMode() {
  try {
    const v = String(PropertiesService.getScriptProperties().getProperty(FACE_MODE_KEY) || '').trim().toLowerCase();
    if (v === 'off' || v === 'tandai' || v === 'ketat') return v;
  } catch (e) { /* jatuh ke default */ }
  return 'ketat';
}

function faceAmbang() {
  try {
    const v = parseFloat(PropertiesService.getScriptProperties().getProperty(FACE_AMBANG_KEY));
    if (!isNaN(v) && v > 0.2 && v < 1.2) return v;
  } catch (e) { /* jatuh ke default */ }
  return FACE_AMBANG_DEFAULT;
}

function faceWajibTerdaftar() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(FACE_WAJIB_KEY) || '0') === '1';
  } catch (e) {
    return false;
  }
}

function faceSetKonfigurasi(mode, ambang, wajibTerdaftar) {
  const props = PropertiesService.getScriptProperties();
  if (mode !== undefined && mode !== null && mode !== '') {
    const m = String(mode).trim().toLowerCase();
    if (['off', 'tandai', 'ketat'].indexOf(m) === -1) throw new Error('Mode wajah tidak dikenal: ' + mode);
    props.setProperty(FACE_MODE_KEY, m);
  }
  if (ambang !== undefined && ambang !== null && ambang !== '') {
    const a = parseFloat(ambang);
    if (isNaN(a) || a <= 0.2 || a >= 1.2) throw new Error('Ambang kemiripan harus antara 0,2 dan 1,2.');
    props.setProperty(FACE_AMBANG_KEY, String(a));
  }
  if (wajibTerdaftar !== undefined && wajibTerdaftar !== null) {
    props.setProperty(FACE_WAJIB_KEY, wajibTerdaftar ? '1' : '0');
  }
}

// =======================================================
// SHEET & DESKRIPTOR
// =======================================================

function _faceSheet() {
  let sh = SS.getSheetByName(FACE_SHEET);
  if (!sh) {
    sh = SS.insertSheet(FACE_SHEET);
    sh.getRange(1, 1, 1, FACE_HEADERS.length).setValues([FACE_HEADERS]);
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) { /* boleh gagal */ }
  } else if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, FACE_HEADERS.length).setValues([FACE_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Cari nomor baris (1-based, seperti getRange) milik satu user.
 * Sengaja hanya membaca KOLOM A. Deskriptor itu ~1.000 karakter per sel;
 * membaca seluruh sheet hanya untuk mencari satu baris berarti menarik
 * ratusan ribu karakter pada setiap absen.
 * @return {number} nomor baris, atau -1
 */
function _faceCariBaris(sh, userId) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const kolomA = sh.getRange(2, 1, last - 1, 1).getValues();
  const target = String(userId === null || userId === undefined ? '' : userId).trim();
  if (!target) return -1;
  for (let i = 0; i < kolomA.length; i++) {
    if (String(kolomA[i][0]).trim() === target) return i + 2;
  }
  return -1;
}

/**
 * Ubah array 128 angka jadi teks untuk sel. Presisi 5 desimal sudah
 * jauh di bawah beda antar-orang; menyimpan presisi penuh hanya
 * menggandakan ukuran sel tanpa menambah ketelitian.
 */
function _faceKeTeks(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) out.push(Number(arr[i]).toFixed(5));
  return out.join(',');
}

function _faceDariTeks(teks) {
  const s = String(teks === null || teks === undefined ? '' : teks).trim();
  if (!s) return null;
  const bagian = s.split(',');
  if (bagian.length !== FACE_PANJANG_DESKRIPTOR) return null;
  const out = new Array(FACE_PANJANG_DESKRIPTOR);
  for (let i = 0; i < FACE_PANJANG_DESKRIPTOR; i++) {
    const n = parseFloat(bagian[i]);
    if (isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

/**
 * Validasi deskriptor kiriman klien. Jangan pernah percaya panjangnya.
 * @return {Array<number>|null}
 */
function _faceValidasiKiriman(nilai) {
  if (!nilai) return null;
  let arr = nilai;
  if (typeof nilai === 'string') {
    arr = _faceDariTeks(nilai);
    if (!arr) return null;
  }
  if (!Array.isArray(arr) || arr.length !== FACE_PANJANG_DESKRIPTOR) return null;
  let jumlahKuadrat = 0;
  const out = new Array(FACE_PANJANG_DESKRIPTOR);
  for (let i = 0; i < FACE_PANJANG_DESKRIPTOR; i++) {
    const n = Number(arr[i]);
    if (isNaN(n) || !isFinite(n) || Math.abs(n) > 5) return null;
    out[i] = n;
    jumlahKuadrat += n * n;
  }
  // BATAS INI SENGAJA LONGGAR — jangan diperketat tanpa pengukuran.
  //
  // Sempat ditulis 0,5-2,0 dengan asumsi keluaran face-api ternormalisasi
  // ke panjang 1. Asumsi itu SALAH: FaceRecognitionNet.forwardInput()
  // mengembalikan hasil lapisan fully-connected apa adanya, tanpa
  // L2-normalisasi (lihat node_modules/@vladmandic/face-api/src/
  // faceRecognitionNet/FaceRecognitionNet.ts). Panjangnya memang
  // cenderung mendekati 1 pada model turunan dlib ini, tetapi
  // mempertaruhkan seluruh presensi kantor pada kecenderungan itu berarti
  // satu hari di mana semua orang ditolak tanpa pesan yang masuk akal.
  //
  // Yang benar-benar perlu ditangkap di sini cuma satu: vektor NOL.
  // computeFaceDescriptor() mengembalikan Float32Array(128) berisi nol
  // ketika masukannya berdimensi cacat — dan vektor nol akan "berjarak
  // sama" dari semua orang. Selebihnya biarkan ambang jarak yang bekerja.
  const panjang = Math.sqrt(jumlahKuadrat);
  if (panjang < 0.05 || panjang > 20) return null;
  return out;
}

function _faceJarak(a, b) {
  let total = 0;
  for (let i = 0; i < FACE_PANJANG_DESKRIPTOR; i++) {
    const d = a[i] - b[i];
    total += d * d;
  }
  return Math.sqrt(total);
}

// =======================================================
// PENCOCOKAN
// =======================================================

/**
 * Bandingkan satu deskriptor dengan seluruh sampel acuan milik user.
 *
 * @return {Object} {
 *   status: 'cocok' | 'tidak_cocok' | 'belum_terdaftar' | 'kiriman_invalid' | 'off',
 *   jarak: number|null, ambang: number, pesan: string
 * }
 */
function faceCocokkan(userId, deskriptorKiriman) {
  const ambang = faceAmbang();

  if (faceMode() === 'off') {
    return { status: 'off', jarak: null, ambang: ambang, pesan: '' };
  }

  const kiriman = _faceValidasiKiriman(deskriptorKiriman);
  if (!kiriman) {
    return {
      status: 'kiriman_invalid', jarak: null, ambang: ambang,
      pesan: 'Data wajah tidak terbaca. Ambil ulang foto dari kamera depan.'
    };
  }

  const sh = _faceSheet();
  const baris = _faceCariBaris(sh, userId);
  if (baris === -1) {
    return {
      status: 'belum_terdaftar', jarak: null, ambang: ambang,
      pesan: 'Wajah acuan Anda belum didaftarkan admin.'
    };
  }

  const selSampel = sh.getRange(baris, FACE_KOLOM_SAMPEL[0], 1, FACE_MAKS_SAMPEL).getValues()[0];
  let terdekat = null;
  for (let i = 0; i < selSampel.length; i++) {
    const acuan = _faceDariTeks(selSampel[i]);
    if (!acuan) continue;
    const j = _faceJarak(kiriman, acuan);
    if (terdekat === null || j < terdekat) terdekat = j;
  }

  if (terdekat === null) {
    return {
      status: 'belum_terdaftar', jarak: null, ambang: ambang,
      pesan: 'Wajah acuan Anda belum didaftarkan admin.'
    };
  }

  if (terdekat <= ambang) {
    return { status: 'cocok', jarak: terdekat, ambang: ambang, pesan: 'Wajah cocok.' };
  }

  return {
    status: 'tidak_cocok', jarak: terdekat, ambang: ambang,
    pesan: 'Wajah tidak cocok dengan data karyawan ini. Presensi hanya boleh diambil oleh pemilik akun.'
  };
}

/**
 * Gerbang yang dipanggil handleAbsen.
 *
 * @return {Object} { tolak: boolean, pesan: string, tanda: string, jarak: number|null }
 *
 * TIDAK PERNAH melempar: kegagalan tak terduga di sini akan menghentikan
 * seluruh presensi kantor. Semua jalur error berakhir lolos + bertanda.
 */
function faceGerbangAbsen(data) {
  const kosong = { tolak: false, pesan: '', tanda: '', jarak: null };
  try {
    const mode = faceMode();
    if (mode === 'off') return kosong;

    const tipe = String((data && data.tipe) || '').trim();
    if (FACE_TIPE_WAJIB.indexOf(tipe) === -1) return kosong;

    // Edit absen lama tidak menjepret wajah baru; jangan dihalangi.
    if (data && data.uuid) return kosong;

    const hasil = faceCocokkan(data.userId, data.wajahDescriptor);

    if (hasil.status === 'cocok') {
      return { tolak: false, pesan: '', tanda: '', jarak: hasil.jarak };
    }

    if (hasil.status === 'belum_terdaftar') {
      if (faceWajibTerdaftar() && mode === 'ketat') {
        _faceCatat(data, 'wajah_belum_terdaftar', 'Presensi ditolak: wajah acuan belum terdaftar.');
        return {
          tolak: true, tanda: 'wajah_belum_terdaftar', jarak: null,
          pesan: 'Wajah acuan Anda belum didaftarkan. Hubungi admin/HRD untuk pendaftaran wajah sebelum presensi.'
        };
      }
      _faceCatat(data, 'wajah_belum_terdaftar', 'Presensi diloloskan tanpa pencocokan (belum terdaftar).');
      return { tolak: false, tanda: 'wajah_belum_terdaftar', jarak: null, pesan: '' };
    }

    const tanda = hasil.status === 'kiriman_invalid' ? 'wajah_tidak_terbaca' : 'wajah_tidak_cocok';
    const jarakTeks = hasil.jarak === null ? '-' : hasil.jarak.toFixed(3);
    if (mode === 'ketat') {
      _faceCatat(data, tanda, 'DITOLAK. jarak=' + jarakTeks + ' ambang=' + hasil.ambang);
      return { tolak: true, tanda: tanda, jarak: hasil.jarak, pesan: hasil.pesan };
    }
    _faceCatat(data, tanda, 'Mode tandai: diloloskan. jarak=' + jarakTeks + ' ambang=' + hasil.ambang);
    return { tolak: false, tanda: tanda, jarak: hasil.jarak, pesan: '' };
  } catch (e) {
    console.error('faceGerbangAbsen gagal: ' + e.message);
    return { tolak: false, pesan: '', tanda: 'wajah_gagal_periksa', jarak: null };
  }
}

// =======================================================
// HANDLER
// =======================================================

/**
 * Catat kejadian wajah ke sheet DeviceAudit (Devices.gs).
 *
 * Sengaja menumpang di sheet yang sama, bukan membuat sheet audit sendiri:
 * admin yang sedang menelusuri satu absen mencurigakan perlu melihat tanda
 * perangkat dan tanda wajah dalam SATU urutan waktu. Dua sheet terpisah
 * berarti dua layar yang harus dicocokkan manual per detik.
 *
 * Dibungkus typeof + try: audit tidak boleh menggagalkan presensi.
 */
function _faceCatat(data, tanda, detail) {
  if (typeof _deviceCatatAudit !== 'function') return;
  try {
    _deviceCatatAudit(
      { id: data && data.userId, nama: data && data.nama },
      String((data && data.deviceId) || ''),
      'absen_wajah',
      tanda,
      String((data && data.tipe) || '') + ' — ' + detail
    );
  } catch (e) { /* abaikan */ }
}

/**
 * Dipanggil layar absen SEBELUM Kirim, supaya karyawan tahu lebih awal.
 * Sengaja TIDAK mengembalikan deskriptor acuan apa pun.
 */
function handleVerifikasiWajah(data) {
  const hasil = faceCocokkan(data.userId, data.wajahDescriptor);
  const bolehLanjut = (hasil.status === 'cocok')
    || (hasil.status === 'off')
    || (hasil.status === 'belum_terdaftar' && !(faceWajibTerdaftar() && faceMode() === 'ketat'))
    || (faceMode() === 'tandai');

  return responseJSON({
    result: 'success',
    status: hasil.status,
    cocok: hasil.status === 'cocok',
    bolehLanjut: bolehLanjut,
    // Jarak dibulatkan: angka mentah adalah petunjuk seberapa dekat
    // sebuah percobaan pemalsuan, dan itu tidak perlu diketahui klien.
    jarak: hasil.jarak === null ? null : Math.round(hasil.jarak * 100) / 100,
    mode: faceMode(),
    pesan: hasil.pesan
  });
}

/**
 * Admin mendaftarkan / memperbarui wajah acuan seorang karyawan.
 * data: { targetUserId, targetNama, descriptors: [[128], ...], fotoAcuan? }
 */
function handleDaftarWajah(data) {
  const targetUserId = String(data.targetUserId || '').trim();
  if (!targetUserId) return responseJSON({ result: 'error', message: 'Karyawan tujuan wajib dipilih.' });

  const mentah = Array.isArray(data.descriptors) ? data.descriptors : [];
  if (!mentah.length) {
    return responseJSON({ result: 'error', message: 'Tidak ada data wajah yang dikirim.' });
  }

  const sampel = [];
  for (let i = 0; i < mentah.length && sampel.length < FACE_MAKS_SAMPEL; i++) {
    const d = _faceValidasiKiriman(mentah[i]);
    if (d) sampel.push(_faceKeTeks(d));
  }
  if (!sampel.length) {
    return responseJSON({
      result: 'error',
      message: 'Data wajah tidak valid. Pastikan foto memuat satu wajah yang jelas dan menghadap depan.'
    });
  }

  // Jarak antar-sampel diperiksa supaya admin tidak diam-diam
  // mendaftarkan dua orang berbeda ke satu akun (mis. salah pilih file).
  if (sampel.length > 1) {
    const a0 = _faceDariTeks(sampel[0]);
    for (let i = 1; i < sampel.length; i++) {
      const ai = _faceDariTeks(sampel[i]);
      if (a0 && ai && _faceJarak(a0, ai) > 0.7) {
        return responseJSON({
          result: 'error',
          message: 'Foto-foto yang diunggah tampaknya bukan orang yang sama. Periksa kembali berkasnya.'
        });
      }
    }
  }

  let urlFoto = '';
  if (data.fotoAcuan && String(data.fotoAcuan).indexOf('base64,') !== -1) {
    try {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(String(data.fotoAcuan).split('base64,')[1]),
        'image/jpeg',
        'WajahAcuan_' + targetUserId + '.jpg'
      );
      urlFoto = 'https://drive.google.com/uc?export=view&id=' + getFolder().createFile(blob).getId();
    } catch (e) {
      // Foto acuan hanya untuk dilihat admin. Gagal menyimpannya tidak
      // boleh membatalkan pendaftaran deskriptor yang justru inti fiturnya.
      console.warn('Foto acuan gagal disimpan: ' + e.message);
    }
  }

  const sh = _faceSheet();
  const waktu = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const nama = String(data.targetNama || '').trim();
  const baris = [
    targetUserId, nama,
    sampel[0] || '', sampel[1] || '', sampel[2] || '',
    sampel.length, urlFoto, waktu, String(data.userId || ''),
    String(data.catatan || '').substring(0, 200)
  ];

  const barisAda = _faceCariBaris(sh, targetUserId);
  if (barisAda === -1) {
    sh.appendRow(baris);
  } else {
    // Foto acuan lama dipertahankan kalau kali ini tidak ada foto baru.
    if (!urlFoto) baris[6] = sh.getRange(barisAda, 7).getValue();
    sh.getRange(barisAda, 1, 1, baris.length).setValues([baris]);
  }

  return responseJSON({
    result: 'success',
    message: 'Wajah acuan tersimpan (' + sampel.length + ' sampel).',
    jumlahSampel: sampel.length,
    fotoAcuan: urlFoto
  });
}

function handleHapusWajah(data) {
  const targetUserId = String(data.targetUserId || '').trim();
  if (!targetUserId) return responseJSON({ result: 'error', message: 'Karyawan tujuan wajib dipilih.' });

  const sh = _faceSheet();
  const baris = _faceCariBaris(sh, targetUserId);
  if (baris === -1) return responseJSON({ result: 'error', message: 'Karyawan ini belum punya wajah acuan.' });

  sh.deleteRow(baris);
  return responseJSON({ result: 'success', message: 'Wajah acuan dihapus.' });
}

/**
 * Daftar status pendaftaran wajah untuk Panel Admin.
 * Deskriptornya (kolom C-E) SENGAJA tidak ikut dibaca maupun dikirim.
 */
function handleGetWajahList(data) {
  const sh = _faceSheet();
  const last = sh.getLastRow();
  const terdaftar = {};

  if (last >= 2) {
    const kiri = sh.getRange(2, 1, last - 1, 2).getValues();          // UserID, Nama
    const kanan = sh.getRange(2, 6, last - 1, 5).getValues();          // Jumlah..Catatan
    for (let i = 0; i < kiri.length; i++) {
      const uid = String(kiri[i][0]).trim();
      if (!uid) continue;
      terdaftar[uid] = {
        jumlahSampel: parseInt(kanan[i][0], 10) || 0,
        fotoAcuan: String(kanan[i][1] || ''),
        updatedAt: String(kanan[i][2] || ''),
        updatedBy: String(kanan[i][3] || ''),
        catatan: String(kanan[i][4] || '')
      };
    }
  }

  // Gabungkan dengan daftar karyawan supaya admin melihat siapa yang
  // BELUM terdaftar — itu justru informasi yang paling dicari di layar ini.
  const shUsers = SS.getSheetByName(SHEET_USERS);
  const rowsUsers = bacaSheet(shUsers, 14);
  const daftar = [];
  for (let i = 1; i < rowsUsers.length; i++) {
    const uid = String(rowsUsers[i][0] || '').trim();
    if (!uid) continue;
    const info = terdaftar[uid];
    daftar.push({
      userId: uid,
      username: String(rowsUsers[i][1] || ''),
      nama: String(rowsUsers[i][3] || ''),
      divisi: String(rowsUsers[i][4] || ''),
      lokasi: String(rowsUsers[i][13] || ''),
      fotoProfil: String(rowsUsers[i][9] || ''),
      terdaftar: !!info,
      jumlahSampel: info ? info.jumlahSampel : 0,
      fotoAcuan: info ? info.fotoAcuan : '',
      updatedAt: info ? info.updatedAt : '',
      updatedBy: info ? info.updatedBy : ''
    });
  }

  return responseJSON({
    result: 'success',
    list: daftar,
    mode: faceMode(),
    ambang: faceAmbang(),
    wajibTerdaftar: faceWajibTerdaftar(),
    jumlahTerdaftar: Object.keys(terdaftar).length
  });
}

function handleSetFaceConfig(data) {
  try {
    faceSetKonfigurasi(data.mode, data.ambang, data.wajibTerdaftar);
    return responseJSON({
      result: 'success',
      mode: faceMode(),
      ambang: faceAmbang(),
      wajibTerdaftar: faceWajibTerdaftar(),
      message: 'Pengaturan verifikasi wajah disimpan.'
    });
  } catch (e) {
    return responseJSON({ result: 'error', message: e.message });
  }
}

// =======================================================
// PEMASANGAN — JALANKAN SEKALI DARI EDITOR
// =======================================================

function SETUP_FACE_PROFILE() {
  _faceSheet();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(FACE_MODE_KEY)) props.setProperty(FACE_MODE_KEY, 'ketat');
  if (!props.getProperty(FACE_AMBANG_KEY)) props.setProperty(FACE_AMBANG_KEY, String(FACE_AMBANG_DEFAULT));
  if (!props.getProperty(FACE_WAJIB_KEY)) props.setProperty(FACE_WAJIB_KEY, '0');
  Logger.log('Sheet FaceProfiles siap.');
  Logger.log('mode=%s ambang=%s wajibTerdaftar=%s', faceMode(), faceAmbang(), faceWajibTerdaftar());
  Logger.log('Daftarkan wajah karyawan lewat Panel Admin > Wajah Karyawan.');
  Logger.log('Setelah semua karyawan terdaftar, nyalakan "wajib terdaftar" di layar yang sama.');
}
