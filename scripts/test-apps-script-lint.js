/**
 * UJI: TIDAK ADA IDENTIFIER YANG DIPAKAI TAPI TIDAK PERNAH DIDEKLARASIKAN
 *
 * Jalankan:  node scripts/test-apps-script-lint.js
 *
 * KENAPA ADA (8 Sep 2026)
 * Layar "Laporan & Cetak Data" mendadak kosong total. Penyebabnya sebuah
 * variabel yang DIPAKAI tapi baris DEKLARASInya hilang saat Code.gs
 * digabungkan manual ke Kode.gs di editor Apps Script. Efeknya
 * ReferenceError di dalam handleGetHistory — dan karena doPost membungkus
 * semuanya dengan try/catch, Apps Script tetap mencatat eksekusinya
 * "Selesai", sementara aplikasi hanya menampilkan tabel kosong. Tidak ada
 * satu pun pesan error yang menunjuk ke penyebabnya.
 *
 * Semua berkas .gs berbagi satu ruang lingkup global di Apps Script, jadi
 * pemeriksaan dilakukan pada GABUNGAN seluruh berkas — bukan per berkas —
 * supaya pemanggilan lintas-berkas tidak salah dilaporkan.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'apps-script');

// Global bawaan Apps Script. Kalau memakai layanan lanjutan baru
// (mis. Sheets API), tambahkan namanya di sini.
const GLOBAL_APPS_SCRIPT = [
  'SpreadsheetApp', 'DriveApp', 'MailApp', 'GmailApp', 'Utilities', 'Session',
  'CacheService', 'PropertiesService', 'LockService', 'UrlFetchApp',
  'ContentService', 'HtmlService', 'ScriptApp', 'Logger', 'console', 'Maps',
  'Browser', 'CalendarApp', 'SitesApp', 'DocumentApp', 'FormApp', 'SlidesApp',
  'XmlService', 'Charts', 'LanguageApp', 'BigQuery', 'Sheets', 'Drive'
];

// Fungsi yang DIPANGGIL dari repo ini tapi tidak pernah didefinisikan di
// sini. Kemungkinan hidup di berkas yang hanya ada di project Apps Script
// (repo dan project memang tidak identik — lihat NAMA-LOKASI.md).
//
// Daftar ini BUKAN izin untuk mengabaikan: setiap nama di sini harus
// dipastikan benar-benar ada di editor Apps Script, kalau tidak baris
// pemanggilnya akan melempar ReferenceError saat dijalankan.
const GLOBAL_LUAR_REPO = ['potongCutiUser'];

const berkas = fs.readdirSync(DIR).filter(f => f.endsWith('.gs')).sort();
if (!berkas.length) { console.error('Tidak ada berkas .gs.'); process.exit(1); }

// Gabungkan sambil mencatat baris awal tiap berkas, supaya nomor baris
// hasil lint bisa dikembalikan ke berkas aslinya.
let gabungan = '';
let barisBerjalan = 0;
const peta = [];
berkas.forEach((f) => {
  const isi = fs.readFileSync(path.join(DIR, f), 'utf8');
  peta.push({ nama: f, mulai: barisBerjalan + 1, jumlah: isi.split('\n').length });
  gabungan += isi + '\n';
  barisBerjalan += isi.split('\n').length + 1;
});

const tmp = path.join(os.tmpdir(), 'gabungan-apps-script.js');
fs.writeFileSync(tmp, gabungan);

const asalBerkas = (barisGabungan) => {
  for (let i = peta.length - 1; i >= 0; i--) {
    if (barisGabungan >= peta[i].mulai) {
      return `${peta[i].nama}:${barisGabungan - peta[i].mulai + 1}`;
    }
  }
  return '?';
};

let keluaran = '';
try {
  keluaran = execFileSync('npx', [
    'eslint', '--no-eslintrc', '--env', 'es2021',
    '--rule', '{"no-undef":"error"}',
    '--global', GLOBAL_APPS_SCRIPT.concat(GLOBAL_LUAR_REPO).join(','),
    '--format', 'json', tmp
  ], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
} catch (e) {
  // eslint keluar dengan kode != 0 saat menemukan error; keluarannya tetap dipakai
  keluaran = e.stdout || '';
}

let laporan = [];
try { laporan = JSON.parse(keluaran); } catch (e) {
  console.error('Tidak bisa membaca keluaran eslint. Pastikan dependensi terpasang (npm install).');
  process.exit(1);
}

const masalah = (laporan[0] && laporan[0].messages) || [];
console.log(`\nBerkas diperiksa : ${berkas.length}`);
console.log(`Baris gabungan   : ${gabungan.split('\n').length}\n`);

if (!masalah.length) {
  console.log('LULUS  Tidak ada identifier yang dipakai tanpa dideklarasikan.\n');
  if (GLOBAL_LUAR_REPO.length) {
    console.log('CATATAN  Dianggap ada di project Apps Script, bukan di repo ini —');
    console.log('         pastikan sendiri keberadaannya di editor:');
    GLOBAL_LUAR_REPO.forEach(n => console.log('           - ' + n));
    console.log('');
  }
  console.log('=================================');
  console.log('  SEMUA BERSIH');
  console.log('=================================\n');
  process.exit(0);
}

masalah.forEach((m) => {
  console.log(`GAGAL  ${asalBerkas(m.line)}  ${m.message}`);
});
console.log('\nIdentifier yang dipakai tapi tidak pernah dideklarasikan akan');
console.log('melempar ReferenceError SAAT DIJALANKAN, bukan saat deploy — dan');
console.log('doPost menelannya jadi respons error yang tidak terlihat di layar.\n');
console.log('=================================');
console.log(`  ${masalah.length} MASALAH`);
console.log('=================================\n');
process.exit(1);
