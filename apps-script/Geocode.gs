// =====================================================================
// REVERSE GEOCODING — KOORDINAT MENJADI NAMA ALAMAT
//
// Sebelum ini kolom Lokasi hanya berisi angka seperti
// "-7.290039699999999, 112.73560859999999". Tidak ada manusia yang bisa
// membaca itu, sehingga HRD harus menyalin-tempel ke Google Maps satu
// per satu untuk memverifikasi satu baris absen.
//
// DUA ATURAN YANG TIDAK BOLEH DILANGGAR
//
// 1. Kolom Lokasi (kolom F) TETAP berisi angka. Geofence dan mesin
//    anti-Fake GPS (AntiFakeGps.gs) membacanya sebagai angka. Mengganti
//    isinya dengan teks alamat akan mematikan kedua fitur itu diam-diam.
//    Alamat ditulis ke KOLOM BARU bernama "Alamat".
//
// 2. Kegagalan geocoding TIDAK BOLEH menggagalkan absen. Kuota habis,
//    layanan Google sedang bermasalah, atau koordinat di tengah laut —
//    semuanya berakhir dengan alamat kosong dan absen tetap tersimpan.
//
// KUOTA
// Maps.newGeocoder() memakai layanan Maps bawaan Apps Script: tanpa API
// key, tanpa biaya. Batasnya 1.000 panggilan/hari untuk akun konsumer
// dan 10.000/hari untuk akun Google Workspace. Dengan cache di bawah,
// pemakaian nyata jauh di bawah itu — satu titik hanya pernah dipanggil
// sekali seumur hidup.
// =====================================================================

const SHEET_GEOCACHE = 'GeoCache';
const GEOCACHE_HEADERS = ['Kunci', 'Alamat', 'Latitude', 'Longitude', 'Dibuat', 'Dipakai (x)'];
const KOLOM_ALAMAT_ABSENSI = 'Alamat';

// Presisi kunci cache: 4 desimal ≈ 11 meter.
//
// Kenapa tidak lebih presisi: makin banyak desimal, makin jarang cache
// kena, makin banyak kuota terpakai. 11 meter masih di dalam satu
// bangunan yang sama, jadi label alamatnya tetap benar.
const GEO_DESIMAL_KUNCI = 4;

// Cache dalam satu eksekusi. Penting untuk backfill: memproses 500 baris
// dengan koordinat berulang jadi hanya membaca sheet GeoCache satu kali.
let _geoMemo = null;

// ---------------------------------------------------------------------
// KUNCI & PARSING
// ---------------------------------------------------------------------

function _geoKunci(lat, lng) {
  return Number(lat).toFixed(GEO_DESIMAL_KUNCI) + ',' + Number(lng).toFixed(GEO_DESIMAL_KUNCI);
}

function _geoParse(lokasi) {
  const teks = String(lokasi === null || lokasi === undefined ? '' : lokasi).trim();
  if (!teks || teks === '-') return null;
  const parts = teks.split(',');
  if (parts.length < 2) return null;
  const lat = Number(String(parts[0]).trim());
  const lng = Number(String(parts[1]).trim());
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return null; // Null Island
  return { lat: lat, lng: lng };
}

// ---------------------------------------------------------------------
// PEMFORMATAN ALAMAT INDONESIA
//
// Google mengembalikan address_components dengan tipe yang berbeda-beda
// tergantung kepadatan pemetaan di titik itu. Di Indonesia polanya:
//   route                          -> Jalan Raya Darmo
//   street_number                  -> 68
//   administrative_area_level_4    -> Kelurahan (Wonokromo)
//   administrative_area_level_3    -> Kecamatan
//   administrative_area_level_2    -> Kota/Kabupaten
//   administrative_area_level_1    -> Provinsi
//
// Target keluaran: "Jl. Raya Darmo No. 68, Wonokromo, Surabaya"
// ---------------------------------------------------------------------

function _geoAmbilKomponen(komponen, tipeTipe) {
  for (let t = 0; t < tipeTipe.length; t++) {
    for (let i = 0; i < komponen.length; i++) {
      const types = komponen[i].types || [];
      if (types.indexOf(tipeTipe[t]) !== -1) return String(komponen[i].long_name || '').trim();
    }
  }
  return '';
}

function _geoRapikanJalan(route, nomor) {
  if (!route) return '';
  // Google menulis "Jalan Raya Darmo"; bentuk pendek lebih lazim dipakai
  // di dokumen HR dan lebih hemat lebar kolom.
  let jalan = route.replace(/^Jalan\s+/i, 'Jl. ').replace(/^Jl\s+/i, 'Jl. ');
  if (!/^(Jl\.|Gg\.|Komplek|Perum|Kompleks)/i.test(jalan)) jalan = 'Jl. ' + jalan;
  if (nomor) jalan += ' No. ' + nomor;
  return jalan;
}

function _geoRapikanKota(kota) {
  if (!kota) return '';
  let k = kota.trim();
  // "Kota SBY" adalah singkatan yang benar-benar dikembalikan Google untuk
  // Surabaya, dan tidak terbaca oleh siapa pun.
  k = k.replace(/\bKota\s+SBY\b/i, 'Surabaya');
  k = k.replace(/^Kota\s+/i, '');
  k = k.replace(/^Kabupaten\s+/i, 'Kab. ');
  return k;
}

// Plus Code (mis. "JQ8H+2R Surabaya") muncul sebagai bagian pertama
// formatted_address ketika titiknya tidak punya alamat jalan. Itu bukan
// alamat yang berguna, jadi dibuang.
function _geoBuangPlusCode(teks) {
  return String(teks || '').replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4},?\s*/i, '').trim();
}

function formatAlamatIndonesia(hasilGeocode) {
  if (!hasilGeocode || !hasilGeocode.results || !hasilGeocode.results.length) return '';

  const utama = hasilGeocode.results[0];
  const komponen = utama.address_components || [];

  const route = _geoAmbilKomponen(komponen, ['route']);
  const nomor = _geoAmbilKomponen(komponen, ['street_number']);
  const kelurahan = _geoAmbilKomponen(komponen, [
    'administrative_area_level_4', 'sublocality_level_1', 'sublocality',
    'neighborhood', 'administrative_area_level_3'
  ]);
  const kota = _geoRapikanKota(_geoAmbilKomponen(komponen, [
    'administrative_area_level_2', 'locality', 'administrative_area_level_1'
  ]));

  const bagian = [];
  const jalan = _geoRapikanJalan(route, nomor);
  if (jalan) bagian.push(jalan);
  if (kelurahan && kelurahan !== kota) bagian.push(kelurahan);
  if (kota) bagian.push(kota);

  if (bagian.length) return bagian.join(', ');

  // Cadangan: potong formatted_address sampai tiga bagian pertama, buang
  // provinsi, kode pos, dan "Indonesia" yang selalu sama untuk semua orang.
  const rapi = _geoBuangPlusCode(utama.formatted_address);
  if (!rapi) return '';
  return rapi.split(',')
    // Kode pos bisa berdiri sendiri ("60262") atau menempel di ujung nama
    // provinsi ("Jawa Timur 60262"). Keduanya dibuang.
    .map(function (s) { return s.trim().replace(/\s+\d{5}$/, '').trim(); })
    .filter(function (s) { return s && !/^\d{5}$/.test(s) && !/^Indonesia$/i.test(s); })
    .slice(0, 3)
    .join(', ');
}

// ---------------------------------------------------------------------
// CACHE LAPIS 2: SHEET PERMANEN
//
// CacheService saja tidak cukup: TTL maksimalnya 6 jam, jadi koordinat
// kantor akan di-geocode ulang beberapa kali setiap hari selamanya.
// Sheet ini membuat satu titik hanya pernah memakai kuota SEKALI.
// ---------------------------------------------------------------------

function _pastikanSheetGeoCache() {
  let sheet = SS.getSheetByName(SHEET_GEOCACHE);
  if (!sheet) {
    sheet = SS.insertSheet(SHEET_GEOCACHE);
    sheet.getRange(1, 1, 1, GEOCACHE_HEADERS.length).setValues([GEOCACHE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _geoMuatMemo() {
  if (_geoMemo) return _geoMemo;
  _geoMemo = {};
  try {
    const sheet = SS.getSheetByName(SHEET_GEOCACHE);
    if (sheet && sheet.getLastRow() > 1) {
      const nilai = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      for (let i = 0; i < nilai.length; i++) {
        const k = String(nilai[i][0] || '').trim();
        const a = String(nilai[i][1] || '').trim();
        if (k && a) _geoMemo[k] = a;
      }
    }
  } catch (e) {
    console.warn('GeoCache tidak terbaca: ' + e.message);
  }
  return _geoMemo;
}

function _geoSimpanCache(kunci, alamat, lat, lng) {
  _geoMuatMemo()[kunci] = alamat;
  try {
    CacheService.getScriptCache().put('geo_' + kunci, alamat, 21600);
  } catch (e) { /* cache penuh: abaikan */ }
  try {
    _pastikanSheetGeoCache().appendRow([kunci, alamat, lat, lng, new Date(), 1]);
  } catch (e) {
    console.warn('Gagal menulis GeoCache: ' + e.message);
  }
}

// ---------------------------------------------------------------------
// FUNGSI UTAMA
// ---------------------------------------------------------------------

/**
 * @returns {string} alamat terbaca, atau '' bila gagal / kuota habis.
 *                   Pemanggil WAJIB memperlakukan '' sebagai hal normal.
 */
function alamatDariKoordinat(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return '';
  const kunci = _geoKunci(lat, lng);

  // Lapis 0: memori eksekusi ini
  const memo = _geoMuatMemo();
  if (memo[kunci]) return memo[kunci];

  // Lapis 1: CacheService
  try {
    const cepat = CacheService.getScriptCache().get('geo_' + kunci);
    if (cepat) { memo[kunci] = cepat; return cepat; }
  } catch (e) { /* lanjut */ }

  // Lapis 2: panggil Google
  try {
    const hasil = Maps.newGeocoder()
      .setLanguage('id')
      .setRegion('id')
      .reverseGeocode(lat, lng);

    if (!hasil || hasil.status !== 'OK') {
      // ZERO_RESULTS itu jawaban sah (mis. titik di tengah laut) dan
      // dicache sebagai '-' supaya tidak dipanggil berulang selamanya.
      if (hasil && hasil.status === 'ZERO_RESULTS') {
        _geoSimpanCache(kunci, '-', lat, lng);
        return '-';
      }
      console.warn('Geocode gagal, status: ' + (hasil ? hasil.status : 'kosong'));
      return '';
    }

    const alamat = formatAlamatIndonesia(hasil);
    if (!alamat) return '';
    _geoSimpanCache(kunci, alamat, lat, lng);
    return alamat;
  } catch (e) {
    // Termasuk kasus kuota harian habis. Sengaja tidak dilempar ulang.
    console.warn('Geocode error: ' + e.message);
    return '';
  }
}

/** Menerima string "lat, lng" seperti yang tersimpan di kolom Lokasi. */
function alamatDariLokasi(lokasi) {
  const titik = _geoParse(lokasi);
  if (!titik) return '';
  return alamatDariKoordinat(titik.lat, titik.lng);
}

// ---------------------------------------------------------------------
// KOLOM "Alamat" DI SHEET ABSENSI
//
// Dicari berdasarkan NAMA HEADER, bukan index tetap — alasannya sama
// seperti di AntiFakeGps.gs: sheet Absensi memakai kolom Q (Catatan
// Admin) dan V (ID Akun) di luar 16 kolom yang ditulis appendRow, jadi
// menebak index adalah cara tercepat merusak data yang sudah ada.
// ---------------------------------------------------------------------

// Index kolom Alamat, dihitung sekali saja per eksekusi.
let _geoIdxAlamatMemo = null;

/**
 * Mengambil isi kolom Alamat dari SATU baris sheet Absensi.
 *
 * KENAPA BERBENTUK BEGINI (8 Sep 2026)
 * Versi sebelumnya memakai variabel bantu yang dideklarasikan di AWAL
 * fungsi pemanggil lalu dipakai puluhan baris di bawahnya. Saat Code.gs
 * digabungkan manual ke Kode.gs di editor Apps Script, tiga baris
 * deklarasinya ikut hilang sementara baris pemakaiannya tertinggal.
 * Hasilnya `ReferenceError: _idxAlamatHistory is not defined`,
 * handleGetHistory gagal seluruhnya, dan layar Laporan & Cetak Data
 * kosong tanpa satu pun pesan error di layar.
 *
 * Sekarang seluruh kebutuhannya muat dalam satu pemanggilan tanpa
 * variabel bantu, jadi tidak ada lagi pasangan baris yang bisa terpisah.
 */
function nilaiAlamatBaris(sheet, baris) {
  try {
    if (_geoIdxAlamatMemo === null) _geoIdxAlamatMemo = indeksKolomAlamat(sheet) - 1;
    if (_geoIdxAlamatMemo < 0 || !baris) return '';
    return String(baris[_geoIdxAlamatMemo] || '').trim();
  } catch (e) {
    return '';
  }
}

/** Lebar baca sheet Absensi yang menjamin kolom Alamat ikut terbaca. */
function lebarBacaAbsensi(sheet, minimal) {
  try {
    return Math.max(minimal || 1, indeksKolomAlamat(sheet));
  } catch (e) {
    return minimal || 1;
  }
}

function indeksKolomAlamat(sheet) {
  const target = sheet || SS.getSheetByName(SHEET_ABSENSI);
  if (!target) return -1;

  const lebar = Math.max(target.getLastColumn(), 1);
  const header = target.getRange(1, 1, 1, lebar).getValues()[0];
  for (let i = 0; i < header.length; i++) {
    if (String(header[i]).trim() === KOLOM_ALAMAT_ABSENSI) return i + 1;
  }

  const kolomBaru = lebar + 1;
  if (target.getMaxColumns() < kolomBaru) {
    target.insertColumnsAfter(target.getMaxColumns(), kolomBaru - target.getMaxColumns());
  }
  target.getRange(1, kolomBaru).setValue(KOLOM_ALAMAT_ABSENSI);
  return kolomBaru;
}

/** Mengisi kolom Alamat untuk satu baris absen yang baru ditulis. */
function tulisAlamatAbsensi(sheet, baris, lokasi) {
  const alamat = alamatDariLokasi(lokasi);
  if (!alamat) return '';
  const kolom = indeksKolomAlamat(sheet);
  if (kolom < 1) return '';
  sheet.getRange(baris, kolom).setValue(alamat);
  return alamat;
}

// ---------------------------------------------------------------------
// ENDPOINT UNTUK APLIKASI
// ---------------------------------------------------------------------

/**
 * Dipanggil form absen agar karyawan melihat nama tempat, bukan angka,
 * SEBELUM menekan kirim. Sengaja ringan: hanya geocoding, tidak menyentuh
 * sheet Absensi sama sekali.
 */
function handleGetAlamat(data) {
  const titik = _geoParse(data.lokasi || ((data.lat !== undefined && data.lng !== undefined) ? (data.lat + ', ' + data.lng) : ''));
  if (!titik) return responseJSON({ result: 'error', message: 'Koordinat tidak valid.' });
  const alamat = alamatDariKoordinat(titik.lat, titik.lng);
  return responseJSON({
    result: 'success',
    alamat: alamat || '',
    // Client memakai ini untuk memutuskan apakah menampilkan angka sebagai
    // cadangan atau tetap menunggu.
    tersedia: !!alamat && alamat !== '-'
  });
}

// ---------------------------------------------------------------------
// PERBAIKAN / PENGISIAN ULANG
//
// Dijalankan MANUAL dari editor Apps Script, bukan otomatis. Gunanya dua:
//   - mengisi baris yang alamatnya gagal didapat saat absen
//   - mengisi data lama bila suatu saat diputuskan perlu
//
// Batas per panggilan menjaga eksekusi tetap di bawah 6 menit dan kuota
// harian tidak terkuras sekaligus. Jalankan lagi untuk sisa barisnya.
// ---------------------------------------------------------------------

function isiAlamatYangKosong(maksBaris) {
  const batas = maksBaris || 200;
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  if (!sheet) return 'Sheet Absensi tidak ditemukan.';

  const kolomAlamat = indeksKolomAlamat(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'Belum ada data.';

  const lokasiSemua = sheet.getRange(2, 6, lastRow - 1, 1).getValues();   // kolom F
  const alamatSemua = sheet.getRange(2, kolomAlamat, lastRow - 1, 1).getValues();

  let diisi = 0, dilewati = 0, gagal = 0;

  // Dari baris TERBARU ke belakang: data terbaru yang paling sering dilihat.
  for (let i = lokasiSemua.length - 1; i >= 0 && diisi < batas; i--) {
    const sudahAda = String(alamatSemua[i][0] || '').trim();
    if (sudahAda) { dilewati++; continue; }
    const titik = _geoParse(lokasiSemua[i][0]);
    if (!titik) { dilewati++; continue; }

    const alamat = alamatDariKoordinat(titik.lat, titik.lng);
    if (alamat) {
      alamatSemua[i][0] = alamat;
      diisi++;
    } else {
      gagal++;
      // Kuota kemungkinan habis — berhenti daripada membuang sisa waktu.
      if (gagal >= 5) break;
    }
  }

  sheet.getRange(2, kolomAlamat, alamatSemua.length, 1).setValues(alamatSemua);
  return 'Selesai. Terisi: ' + diisi + ', dilewati: ' + dilewati + ', gagal: ' + gagal +
    '. Jalankan lagi bila masih ada yang kosong.';
}
