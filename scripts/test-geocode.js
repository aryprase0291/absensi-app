/**
 * UJI PEMFORMATAN ALAMAT
 *
 * Jalankan:  node scripts/test-geocode.js
 *
 * Yang diuji adalah formatAlamatIndonesia() — bagian yang mengubah
 * address_components mentah dari Google menjadi satu baris yang terbaca
 * manusia. Fungsi geocoding-nya sendiri tidak diuji di sini karena itu
 * panggilan jaringan; yang gampang salah justru pemformatannya, karena
 * Google mengembalikan susunan komponen yang berbeda-beda tergantung
 * seberapa rapat sebuah titik dipetakan.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {
  SS: { getSheetByName: () => null, insertSheet: () => ({ getRange: () => ({ setValues(){}, setValue(){}, getValues: () => [[]] }), setFrozenRows(){}, appendRow(){}, getLastRow: () => 0, getLastColumn: () => 0, getMaxColumns: () => 0 }) },
  SHEET_ABSENSI: 'Absensi',
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  Maps: { newGeocoder: () => ({ setLanguage(){return this}, setRegion(){return this}, reverseGeocode: () => ({ status: 'ZERO_RESULTS' }) }) },
  Utilities: { formatDate: (d) => String(d) },
  Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
  responseJSON: (o) => o,
  console: { warn: () => {} },
  Math, Date, Number, String, Object, Array, isFinite, JSON, RegExp
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Geocode.gs'), 'utf8'), ctx);

// Pembantu: bikin address_components ringkas
const k = (long_name, ...types) => ({ long_name, short_name: long_name, types });

let lulus = 0, gagal = 0;
function uji(nama, hasilGeocode, harap) {
  const dapat = ctx.formatAlamatIndonesia(hasilGeocode);
  if (dapat === harap) {
    lulus++;
    console.log(`  LULUS  ${nama}`);
    console.log(`         -> "${dapat}"`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}`);
    console.log(`         diharap "${harap}"`);
    console.log(`         didapat "${dapat}"`);
  }
}

console.log('\n=== ALAMAT LENGKAP ===');

uji('Jalan + nomor + kelurahan + kota', {
  results: [{
    formatted_address: 'Jalan Raya Darmo No. 68, Wonokromo, Kec. Wonokromo, Kota SBY, Jawa Timur 60241, Indonesia',
    address_components: [
      k('68', 'street_number'),
      k('Jalan Raya Darmo', 'route'),
      k('Wonokromo', 'administrative_area_level_4'),
      k('Kecamatan Wonokromo', 'administrative_area_level_3'),
      k('Kota SBY', 'administrative_area_level_2'),
      k('Jawa Timur', 'administrative_area_level_1')
    ]
  }]
}, 'Jl. Raya Darmo No. 68, Wonokromo, Surabaya');

uji('Jalan tanpa nomor rumah', {
  results: [{
    formatted_address: 'Jalan Ahmad Yani, Gayungan, Kota SBY, Jawa Timur, Indonesia',
    address_components: [
      k('Jalan Ahmad Yani', 'route'),
      k('Gayungan', 'administrative_area_level_4'),
      k('Kota SBY', 'administrative_area_level_2')
    ]
  }]
}, 'Jl. Ahmad Yani, Gayungan, Surabaya');

uji('Nama jalan sudah memakai "Jl." — tidak boleh dobel', {
  results: [{
    formatted_address: 'Jl. Mayjend Sungkono, Dukuh Pakis, Surabaya',
    address_components: [
      k('Jl. Mayjend Sungkono', 'route'),
      k('Dukuh Pakis', 'administrative_area_level_4'),
      k('Surabaya', 'administrative_area_level_2')
    ]
  }]
}, 'Jl. Mayjend Sungkono, Dukuh Pakis, Surabaya');

uji('Kabupaten disingkat', {
  results: [{
    formatted_address: 'Jalan Raya Waru, Waru, Kabupaten Sidoarjo, Jawa Timur',
    address_components: [
      k('Jalan Raya Waru', 'route'),
      k('Waru', 'administrative_area_level_4'),
      k('Kabupaten Sidoarjo', 'administrative_area_level_2')
    ]
  }]
}, 'Jl. Raya Waru, Waru, Kab. Sidoarjo');

console.log('\n=== KOMPONEN TIDAK LENGKAP ===');

uji('Tanpa nama jalan — pakai kelurahan + kota', {
  results: [{
    formatted_address: 'Wonokromo, Kota SBY, Jawa Timur, Indonesia',
    address_components: [
      k('Wonokromo', 'administrative_area_level_4'),
      k('Kota SBY', 'administrative_area_level_2'),
      k('Jawa Timur', 'administrative_area_level_1')
    ]
  }]
}, 'Wonokromo, Surabaya');

uji('Hanya sublocality (pemetaan longgar)', {
  results: [{
    formatted_address: 'Ketintang, Surabaya, Jawa Timur',
    address_components: [
      k('Ketintang', 'sublocality_level_1', 'sublocality'),
      k('Surabaya', 'locality')
    ]
  }]
}, 'Ketintang, Surabaya');

uji('Kelurahan sama dengan kota — jangan diulang', {
  results: [{
    formatted_address: 'Surabaya, Jawa Timur',
    address_components: [
      k('Surabaya', 'administrative_area_level_4'),
      k('Surabaya', 'administrative_area_level_2')
    ]
  }]
}, 'Surabaya');

console.log('\n=== CADANGAN & KASUS RUSAK ===');

uji('Plus Code dibuang, sisanya dipakai', {
  results: [{
    formatted_address: 'JQ8H+2R Tegalsari, Surabaya, Jawa Timur 60262, Indonesia',
    address_components: [ k('60262', 'postal_code') ]
  }]
}, 'Tegalsari, Surabaya, Jawa Timur');

uji('Hasil kosong', { results: [], status: 'ZERO_RESULTS' }, '');
uji('Respons null', null, '');
uji('Respons tanpa properti results', { status: 'OK' }, '');

console.log('\n=== PARSING KOORDINAT ===');
const cek = (nama, masuk, harapNull) => {
  const r = ctx._geoParse(masuk);
  const ok = harapNull ? r === null : (r !== null);
  if (ok) { lulus++; console.log(`  LULUS  ${nama}`); }
  else { gagal++; console.log(`  GAGAL  ${nama} -> ${JSON.stringify(r)}`); }
};
cek('Koordinat normal', '-7.2900397, 112.7356086', false);
cek('Strip kosong "-"', '-', true);
cek('Null Island ditolak', '0.0, 0.0', true);
cek('Teks bukan angka', 'Surabaya', true);
cek('Latitude di luar jangkauan', '-99.0, 112.7', true);

console.log(`\n=================================`);
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log(`=================================\n`);
process.exit(gagal > 0 ? 1 : 0);
