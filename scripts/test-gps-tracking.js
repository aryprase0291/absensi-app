/**
 * UJI MESIN PELACAKAN POSISI
 *
 * Jalankan:  node scripts/test-gps-tracking.js
 *
 * KENAPA ADA: aturan "kapan sebuah titik layak ditulis ke sheet" adalah
 * satu-satunya hal yang menahan sheet GpsTracking dari pertumbuhan liar.
 * 50 karyawan x ping 5 menit x 8 jam = 4.800 baris per hari kalau
 * aturannya rusak — dan yang mati bukan cuma fitur GPS, tapi seluruh
 * spreadsheet absensi begitu batas 10 juta sel terlampaui.
 *
 * Berkas ini memuat GpsTracking.gs APA ADANYA di dalam sandbox dengan
 * SpreadsheetApp tiruan, jadi yang diuji adalah kode yang benar-benar
 * dipakai di produksi, bukan salinannya.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SUMBER = path.join(__dirname, '..', 'apps-script', 'GpsTracking.gs');

// --- Sheet tiruan ----------------------------------------------------
function buatSheet(header) {
  const data = [header.slice()];
  return {
    _data: data,
    getLastRow: () => data.length,
    getLastColumn: () => (data[0] ? data[0].length : 0),
    getMaxColumns: () => 50,
    getSheetId: () => 123,
    setFrozenRows: () => {},
    autoResizeColumns: () => {},
    clear: () => { data.length = 0; },
    deleteRows: (mulai, jumlah) => { data.splice(mulai - 1, jumlah); },
    appendRow: (baris) => { data.push(baris.slice()); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const hasil = [];
        for (let i = 0; i < (nr || 1); i++) {
          const baris = data[r - 1 + i] || [];
          const potong = [];
          for (let j = 0; j < (nc || 1); j++) potong.push(baris[c - 1 + j] === undefined ? '' : baris[c - 1 + j]);
          hasil.push(potong);
        }
        return hasil;
      },
      setValues: (nilai) => {
        nilai.forEach((baris, i) => {
          const target = r - 1 + i;
          while (data.length <= target) data.push([]);
          baris.forEach((v, j) => { data[target][c - 1 + j] = v; });
        });
      },
      setFontWeight: () => {}
    })
  };
}

// Pemformat tanggal seadanya — cukup untuk pola yang dipakai GpsTracking.gs.
function formatDate(d, zona, pola) {
  const p = (n) => String(n).padStart(2, '0');
  return pola
    .replace('yyyy', d.getFullYear())
    .replace('MM', p(d.getMonth() + 1))
    .replace('dd', p(d.getDate()))
    .replace('HH', p(d.getHours()))
    .replace('mm', p(d.getMinutes()))
    .replace('ss', p(d.getSeconds()));
}

// Jam yang bisa dibekukan.
//
// Penghitung "titik hari ini" membandingkan tanggal titik dengan tanggal
// SEKARANG. Uji yang memakai jam sungguhan karena itu gagal setiap kali
// dijalankan lewat tengah malam — titik "45 menit yang lalu" jatuh di
// tanggal kemarin. Membekukan jam membuat hasilnya sama kapan pun uji
// dijalankan.
function buatDateTetap(waktuTetap) {
  class DateTetap extends Date {
    constructor(...args) {
      if (args.length === 0) super(waktuTetap);
      else super(...args);
    }
    static now() { return waktuTetap; }
  }
  return DateTetap;
}

function muatModul(opsi) {
  opsi = opsi || {};
  const sheets = {
    Users: buatSheet(['UUID', 'Username', 'Password', 'Nama', 'Divisi', 'Role', 'Akses', 'NoPayroll',
      'SisaCuti', 'Foto', 'Perusahaan', 'Status', 'X', 'Lokasi'])
  };
  (opsi.users || [['U1', 'ari', 'x', 'Ari Prasetyo', 'IT', 'karyawan', '', '001', 0, '', '', '', '', 'Surabaya']])
    .forEach((u) => sheets.Users.appendRow(u));

  if (opsi.konfig) {
    sheets.GpsTrackingConfig = buatSheet(['UserID', 'Nama', 'Aktif', 'Interval(detik)', 'Diubah', 'Oleh']);
    opsi.konfig.forEach((k) => sheets.GpsTrackingConfig.appendRow(k));
  }

  const ctx = {
    SHEET_USERS: 'Users',
    SS: {
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => { sheets[n] = buatSheet([]); return sheets[n]; },
      getUrl: () => 'https://docs.google.com/spreadsheets/d/UJI'
    },
    // bacaSheet asli ada di Code.gs; salin perilakunya.
    bacaSheet: (sheet, jmlKolom) => {
      if (!sheet) return [];
      const lastRow = sheet.getLastRow();
      if (lastRow < 1) return [];
      return sheet.getRange(1, 1, lastRow, jmlKolom || sheet.getLastColumn()).getValues();
    },
    // Cache dimatikan: setiap uji harus membaca sheet tiruannya sendiri.
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Utilities: { formatDate: formatDate },
    Logger: { log: () => {} },
    responseJSON: (o) => o,
    console: { warn: () => {}, log: () => {} },
    _ambilGeofenceUser: opsi.geofence || (() => ({ required: false, areas: [] })),
    _ambilKonfigurasiGeofence: () => opsi.petaGeofence || {},
    alamatDariKoordinat: () => (opsi.alamat === undefined ? 'Jl. Uji No. 1, Surabaya' : opsi.alamat),
    Math, Number, String, Object, Array, isFinite, isNaN, JSON, parseInt, parseFloat,
    Date: opsi.waktuSekarang ? buatDateTetap(opsi.waktuSekarang) : Date
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SUMBER, 'utf8'), ctx);
  ctx._sheets = sheets;
  return ctx;
}

// --- Pembantu --------------------------------------------------------
let lulus = 0;
let gagal = 0;

function cek(nama, syarat, keterangan) {
  if (syarat) { lulus++; console.log('  LULUS  ' + nama); }
  else { gagal++; console.log('  GAGAL  ' + nama + (keterangan ? ' -> ' + keterangan : '')); }
}

const ping = (ctx, isi) => ctx.handleTrackGpsPing(Object.assign({ userId: 'U1', nama: 'Ari Prasetyo' }, isi));

// Menggeser cap waktu baris posisi terakhir ke masa lalu, seolah-olah
// ping sebelumnya terjadi beberapa menit yang lalu.
function mundurkanWaktu(ctx, menit) {
  const sheet = ctx._sheets.GpsPosisiTerakhir;
  const baris = sheet._data[1];
  const geser = menit * 60000;
  baris[7] = new Date(new Date(baris[7]).getTime() - geser);   // Waktu Terakhir
  baris[18] = new Date(new Date(baris[18]).getTime() - geser); // Waktu Log Terakhir
}

const jumlahJejak = (ctx) => (ctx._sheets.GpsTracking ? ctx._sheets.GpsTracking._data.length - 1 : 0);

console.log('\n=== PELACAKAN POSISI KARYAWAN ===\n');

// 1. Titik pertama selalu dicatat
{
  const ctx = muatModul();
  const hasil = ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 12, sumber: 'awal' });
  cek('titik pertama tercatat', hasil.result === 'success' && hasil.dicatat === true, JSON.stringify(hasil));
  cek('baris posisi terakhir dibuat', ctx._sheets.GpsPosisiTerakhir._data.length === 2);
  cek('baris jejak dibuat', jumlahJejak(ctx) === 1);
}

// 2. Ping beruntun (< 45 detik) ditolak halus, bukan error
{
  const ctx = muatModul();
  ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 12 });
  const kedua = ping(ctx, { lat: -7.2576, lng: 112.7522, akurasi: 12 });
  cek('ping beruntun tidak menambah jejak', kedua.result === 'success' && kedua.dicatat === false, JSON.stringify(kedua));
  cek('jejak tetap satu baris', jumlahJejak(ctx) === 1);
}

// 3. Diam di tempat: posisi diperbarui, jejak TIDAK bertambah
{
  const ctx = muatModul();
  ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 10 });
  mundurkanWaktu(ctx, 5);
  const hasil = ping(ctx, { lat: -7.25752, lng: 112.75212, akurasi: 10 }); // geser ~3 m
  cek('geser 3 m tidak menambah jejak', hasil.dicatat === false, JSON.stringify(hasil));
  cek('jejak tetap satu baris saat diam', jumlahJejak(ctx) === 1);
}

// 4. Bergerak > 50 m: jejak bertambah
{
  const ctx = muatModul();
  ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 10 });
  mundurkanWaktu(ctx, 5);
  const hasil = ping(ctx, { lat: -7.2605, lng: 112.7551, akurasi: 10 }); // ~450 m
  cek('perpindahan 450 m menambah jejak', hasil.dicatat === true);
  cek('jejak menjadi dua baris', jumlahJejak(ctx) === 2);
  cek('jarak harian terakumulasi', hasil.jarakHariIniKm > 0.3 && hasil.jarakHariIniKm < 0.7, String(hasil.jarakHariIniKm));
}

// 5. Heartbeat: diam lama tetap meninggalkan jejak
{
  const ctx = muatModul();
  ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 10 });
  mundurkanWaktu(ctx, 35);
  const hasil = ping(ctx, { lat: -7.25751, lng: 112.75211, akurasi: 10 });
  cek('heartbeat 35 menit menambah jejak', hasil.dicatat === true);
}

// 6. Karyawan yang dikecualikan admin tidak dilacak sama sekali
{
  const ctx = muatModul({ konfig: [['U1', 'Ari Prasetyo', 'Tidak', 300, new Date(), 'admin']] });
  const hasil = ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 10 });
  cek('pelacakan nonaktif dilaporkan', hasil.result === 'success' && hasil.dilacak === false);
  cek('tidak ada sheet posisi yang ditulis', !ctx._sheets.GpsPosisiTerakhir);
  cek('tidak ada jejak yang ditulis', jumlahJejak(ctx) === 0);
}

// 7. Akurasi buruk diabaikan (bukan error)
{
  const ctx = muatModul();
  const hasil = ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 5000 });
  cek('akurasi 5 km diabaikan', hasil.result === 'success' && hasil.dicatat === false);
  cek('tidak menulis apa pun', jumlahJejak(ctx) === 0);
}

// 8. Koordinat tidak masuk akal ditolak
{
  const ctx = muatModul();
  const hasil = ping(ctx, { lat: 999, lng: 112.7521 });
  cek('koordinat di luar rentang ditolak', hasil.result === 'error' && hasil.code === 'KOORDINAT_TIDAK_VALID');
}

// 9. Lompatan mustahil tidak mengotori jarak harian
{
  const ctx = muatModul();
  ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 10 });
  mundurkanWaktu(ctx, 2);
  const hasil = ping(ctx, { lat: -6.2088, lng: 106.8456, akurasi: 10 }); // Surabaya -> Jakarta dalam 2 menit
  cek('lompatan mustahil tidak diakumulasi', hasil.jarakHariIniKm === 0, String(hasil.jarakHariIniKm));
}

// 10. Label geofence ikut tercatat
{
  const areaKantor = { required: true, areas: [{ nama: 'Kantor Pusat', lat: -7.2575, lng: 112.7521, radius: 150, aktif: true }] };
  const ctxDalam = muatModul({ geofence: () => areaKantor });
  const dalam = ping(ctxDalam, { lat: -7.2576, lng: 112.7522, akurasi: 10 });
  cek('titik di dalam radius berlabel DI AREA', dalam.statusArea === 'DI AREA', dalam.statusArea);

  const ctxLuar = muatModul({ geofence: () => areaKantor });
  const luar = ping(ctxLuar, { lat: -7.2900, lng: 112.7900, akurasi: 10 });
  cek('titik jauh berlabel LUAR AREA', luar.statusArea === 'LUAR AREA', luar.statusArea);
  cek('jarak ke area dilaporkan', luar.jarakArea > 1000);
}

// 11. Akumulasi harian di-reset saat ganti hari
{
  const ctx = muatModul();
  ping(ctx, { lat: -7.2575, lng: 112.7521, akurasi: 10 });
  mundurkanWaktu(ctx, 60 * 26); // 26 jam lalu = kemarin
  const hasil = ping(ctx, { lat: -7.2605, lng: 112.7551, akurasi: 10 });
  cek('titik hari ini dihitung ulang', hasil.result === 'success' && hasil.jarakHariIniKm === 0, String(hasil.jarakHariIniKm));
}

// 12. Gerbang role dashboard
{
  const ctx = muatModul();
  const hrd = ctx.handleGetGpsLive({ roleRequester: 'hrd' });
  const karyawan = ctx.handleGetGpsLive({ roleRequester: 'karyawan' });
  const admin = ctx.handleGetGpsLive({ roleRequester: 'admin' });
  cek('HRD ditolak membuka peta', hrd.result === 'error');
  cek('karyawan ditolak membuka peta', karyawan.result === 'error');
  cek('admin diizinkan', admin.result === 'success');
  const simpan = ctx.handleSaveGpsTrackingConfig({ roleRequester: 'hrd', targetUserId: 'U1', aktif: false });
  cek('HRD tidak bisa mengubah pengaturan', simpan.result === 'error');
}

// 13. Status untuk aplikasi karyawan
{
  const ctx = muatModul();
  const bawaan = ctx.handleGetGpsTrackingStatus({ userId: 'U1' });
  cek('bawaan: karyawan dilacak', bawaan.aktif === true && bawaan.intervalDetik === 300);
  cek('pemberitahuan ke karyawan ada isinya', String(bawaan.pemberitahuan).length > 10);

  const ctx2 = muatModul({ konfig: [['U1', 'Ari', 'Tidak', 600, new Date(), 'admin']] });
  const mati = ctx2.handleGetGpsTrackingStatus({ userId: 'U1' });
  cek('karyawan dikecualikan melihat aktif=false', mati.aktif === false);
}

// 14. Admin mengubah pengaturan lalu terbaca kembali
{
  const ctx = muatModul();
  const simpan = ctx.handleSaveGpsTrackingConfig({ roleRequester: 'admin', userId: 'ADM', targetUserId: 'U1', aktif: false, intervalDetik: 600 });
  cek('admin bisa menyimpan pengaturan', simpan.result === 'success', JSON.stringify(simpan));
  const baris = ctx._sheets.GpsTrackingConfig._data[1];
  cek('baris konfigurasi tertulis benar', baris && baris[0] === 'U1' && baris[2] === 'Tidak' && baris[3] === 600, JSON.stringify(baris));
}

// 15. Interval di luar batas dijepit, bukan diterima mentah
{
  const ctx = muatModul();
  ctx.handleSaveGpsTrackingConfig({ roleRequester: 'admin', targetUserId: 'U1', aktif: true, intervalDetik: 5 });
  cek('interval 5 detik dinaikkan ke batas minimum', ctx._sheets.GpsTrackingConfig._data[1][3] === 60);
  ctx.handleSaveGpsTrackingConfig({ roleRequester: 'admin', targetUserId: 'U1', aktif: true, intervalDetik: 999999 });
  cek('interval raksasa diturunkan ke batas maksimum', ctx._sheets.GpsTrackingConfig._data[1][3] === 3600);
}

// 16. Jejak harian: hanya tanggal yang diminta, urut kronologis
{
  const ctx = muatModul();
  const sheet = ctx._pastikanSheetGpsTrack();
  const buatBaris = (waktu, lat, lng, jarak, statusArea) =>
    [waktu, 'U1', 'Ari Prasetyo', 'IT', lat, lng, 10, 'periodik', jarak, 20, 80, statusArea || 'DI AREA', 'Alamat uji', 'dev', 'Android'];

  const kemarin = new Date(); kemarin.setDate(kemarin.getDate() - 1); kemarin.setHours(9, 0, 0, 0);
  const hariIni = new Date(); hariIni.setHours(8, 0, 0, 0);
  const hariIni2 = new Date(); hariIni2.setHours(9, 0, 0, 0);
  const hariIni3 = new Date(); hariIni3.setHours(10, 0, 0, 0);

  // Sengaja ditulis kronologis, seperti sheet asli.
  sheet.appendRow(buatBaris(kemarin, -7.2500, 112.7500, 0));
  sheet.appendRow(buatBaris(hariIni, -7.2575, 112.7521, 0));
  sheet.appendRow(buatBaris(hariIni2, -7.2605, 112.7551, 450, 'LUAR AREA'));
  sheet.appendRow(buatBaris(hariIni3, -7.2650, 112.7600, 700, 'LUAR AREA'));

  const p2 = (n) => String(n).padStart(2, '0');
  const kunciHariIni = hariIni.getFullYear() + '-' + p2(hariIni.getMonth() + 1) + '-' + p2(hariIni.getDate());

  const jejak = ctx.handleGetGpsTrail({ roleRequester: 'admin', targetUserId: 'U1', tanggal: kunciHariIni });
  cek('jejak hanya mengambil tanggal yang diminta', jejak.result === 'success' && jejak.jumlah === 3, JSON.stringify(jejak.jumlah));
  cek('jejak urut kronologis', jejak.titik[0].waktuMs < jejak.titik[2].waktuMs);
  cek('jam pertama & terakhir benar', jejak.jamPertama === '08:00:00' && jejak.jamTerakhir === '10:00:00', jejak.jamPertama + ' - ' + jejak.jamTerakhir);
  cek('jarak jejak dihitung', jejak.jarakKm > 0.8 && jejak.jarakKm < 2.5, String(jejak.jarakKm));

  const laporan = ctx.handleBuatLaporanGps({ roleRequester: 'admin', tglMulai: kunciHariIni, tglSelesai: kunciHariIni });
  cek('laporan menghasilkan satu baris per karyawan per hari', laporan.result === 'success' && laporan.jumlah === 1, JSON.stringify(laporan.jumlah));
  cek('laporan menghitung titik', laporan.laporan[0].titik === 3, String(laporan.laporan[0] && laporan.laporan[0].titik));
  cek('laporan menghitung jarak tempuh', laporan.laporan[0].km > 1, String(laporan.laporan[0].km));
  cek('laporan mencatat menit di luar area', laporan.laporan[0].menitLuar === 60, String(laporan.laporan[0].menitLuar));
  cek('laporan ditulis ke sheet LaporanGps', ctx._sheets.LaporanGps && ctx._sheets.LaporanGps._data.length === 2);
  cek('laporan menyertakan tautan sheet', String(laporan.sheetUrl).indexOf('docs.google.com') !== -1);
}

// =====================================================================
// ANTRIAN TITIK SUSULAN (1.0.18)
//
// Titik yang gagal terkirim saat sinyal hilang disusulkan belakangan.
// Dua hal yang diuji di sini tidak bisa diuji lewat handleTrackGpsPing:
// waktu yang dipakai adalah waktu di HP, dan titik lama TIDAK BOLEH
// menggeser mundur baris posisi terakhir yang dibaca peta admin.
// =====================================================================

const antrian = (ctx, titik, isi) =>
  ctx.handleTrackGpsAntrian(Object.assign({ userId: 'U1', nama: 'Ari Prasetyo', titik: titik }, isi || {}));

// Semua uji antrian memakai jam beku pada 9 Sep 2026 pukul 12.00 WIB.
// Lihat buatDateTetap() di atas: tanpa ini, uji akan gagal setiap kali
// kebetulan dijalankan sesaat setelah tengah malam.
const JAM_BEKU = new Date('2026-09-09T12:00:00+07:00').getTime();
const modulAntrian = (o) => muatModul(Object.assign({ waktuSekarang: JAM_BEKU }, o || {}));
const menitLalu = (n) => JAM_BEKU - n * 60000;

// A. Kiriman pertama tanpa riwayat apa pun
{
  const ctx = modulAntrian();
  const t = menitLalu(30);
  const hasil = antrian(ctx, [{ waktu: t, lat: -7.2575, lng: 112.7521, akurasi: 12, baterai: 70 }]);
  cek('antrian: kiriman pertama diterima', hasil.result === 'success' && hasil.diterima === 1, JSON.stringify(hasil));
  cek('antrian: satu baris jejak ditulis', jumlahJejak(ctx) === 1);
  cek('antrian: baris posisi terakhir dibuat', ctx._sheets.GpsPosisiTerakhir._data.length === 2);

  const jejak = ctx._sheets.GpsTracking._data[1];
  cek('antrian: waktu jejak memakai waktu HP, bukan waktu tiba',
    Math.abs(new Date(jejak[0]).getTime() - t) < 1000, String(jejak[0]));
  cek('antrian: sumber ditulis "antrian" agar admin tahu ini susulan', jejak[7] === 'antrian', String(jejak[7]));
}

// B. Diam di tempat: aturan penipisan tetap berlaku di dalam kiriman
{
  const ctx = modulAntrian();
  const titik = [];
  for (let i = 5; i >= 1; i--) {
    titik.push({ waktu: menitLalu(i * 5), lat: -7.2575 + i / 1000000, lng: 112.7521, akurasi: 10 });
  }
  const hasil = antrian(ctx, titik);
  cek('antrian: lima titik diterima', hasil.diterima === 5, String(hasil.diterima));
  cek('antrian: diam di tempat hanya menyisakan satu baris jejak', jumlahJejak(ctx) === 1, String(jumlahJejak(ctx)));
}

// C. Berpindah jauh: setiap titik meninggalkan jejak
{
  const ctx = modulAntrian();
  const titik = [
    { waktu: menitLalu(20), lat: -7.2575, lng: 112.7521, akurasi: 10 },
    { waktu: menitLalu(15), lat: -7.2605, lng: 112.7551, akurasi: 10 },
    { waktu: menitLalu(10), lat: -7.2645, lng: 112.7601, akurasi: 10 }
  ];
  const hasil = antrian(ctx, titik);
  cek('antrian: perjalanan menghasilkan tiga baris jejak', jumlahJejak(ctx) === 3, String(jumlahJejak(ctx)));
  cek('antrian: jarak harian terakumulasi', hasil.jarakHariIniKm > 0.8, String(hasil.jarakHariIniKm));
}

// D. Titik lama TIDAK boleh memundurkan posisi terakhir
{
  const ctx = modulAntrian();
  ping(ctx, { lat: -7.2700, lng: 112.7700, akurasi: 10, sumber: 'awal' });
  const barisSebelum = ctx._sheets.GpsPosisiTerakhir._data[1].slice();

  const hasil = antrian(ctx, [{ waktu: menitLalu(45), lat: -7.2575, lng: 112.7521, akurasi: 10 }]);
  const barisSesudah = ctx._sheets.GpsPosisiTerakhir._data[1];

  cek('antrian: titik lama dilaporkan tidak memperbarui posisi terakhir',
    hasil.posisiTerakhirDiperbarui === false, JSON.stringify(hasil));
  cek('antrian: koordinat peta admin tidak mundur',
    barisSesudah[4] === barisSebelum[4] && barisSesudah[5] === barisSebelum[5],
    String(barisSesudah[4]) + ',' + String(barisSesudah[5]));
  cek('antrian: waktu terakhir tidak mundur',
    new Date(barisSesudah[7]).getTime() === new Date(barisSebelum[7]).getTime());
  cek('antrian: jejaknya tetap ditulis walau posisi tidak diperbarui', jumlahJejak(ctx) === 2, String(jumlahJejak(ctx)));
  cek('antrian: penghitung titik hari ini tetap bertambah',
    Number(barisSesudah[14]) === Number(barisSebelum[14]) + 1,
    String(barisSebelum[14]) + ' -> ' + String(barisSesudah[14]));
}

// E. Titik yang memang lebih baru boleh memperbarui posisi terakhir
{
  const ctx = modulAntrian();
  ping(ctx, { lat: -7.2700, lng: 112.7700, akurasi: 10, sumber: 'awal' });
  mundurkanWaktu(ctx, 30);

  const hasil = antrian(ctx, [{ waktu: menitLalu(2), lat: -7.2575, lng: 112.7521, akurasi: 10 }]);
  const baris = ctx._sheets.GpsPosisiTerakhir._data[1];
  cek('antrian: titik lebih baru memperbarui posisi terakhir', hasil.posisiTerakhirDiperbarui === true);
  cek('antrian: koordinat peta admin ikut pindah', Math.abs(Number(baris[4]) - (-7.2575)) < 1e-9, String(baris[4]));
  cek('antrian: sumber pada posisi terakhir ditandai antrian', baris[8] === 'antrian', String(baris[8]));
}

// F. Titik yang tidak masuk akal disaring
{
  const ctx = modulAntrian();
  const hasil = antrian(ctx, [
    { waktu: Date.now() + 60 * 60000, lat: -7.2575, lng: 112.7521, akurasi: 10 },   // jam HP maju sejam
    { waktu: Date.now() - 13 * 3600000, lat: -7.2575, lng: 112.7521, akurasi: 10 }, // lebih tua dari 12 jam
    { waktu: menitLalu(10), lat: 999, lng: 112.7521, akurasi: 10 },                 // koordinat mustahil
    { waktu: menitLalu(9), lat: -7.2575, lng: 112.7521, akurasi: 5000 },            // akurasi 5 km
    { waktu: menitLalu(8), lat: -7.2575, lng: 112.7521, akurasi: 10 }               // satu-satunya yang sah
  ]);
  cek('antrian: hanya titik yang sah diterima', hasil.diterima === 1, JSON.stringify(hasil.diterima));
  cek('antrian: yang tersaring tidak menghasilkan baris', jumlahJejak(ctx) === 1, String(jumlahJejak(ctx)));
}

// G. Urutan acak tetap dicatat kronologis
{
  const ctx = modulAntrian();
  antrian(ctx, [
    { waktu: menitLalu(5), lat: -7.2645, lng: 112.7601, akurasi: 10 },
    { waktu: menitLalu(20), lat: -7.2575, lng: 112.7521, akurasi: 10 },
    { waktu: menitLalu(12), lat: -7.2605, lng: 112.7551, akurasi: 10 }
  ]);
  const j = ctx._sheets.GpsTracking._data;
  cek('antrian: jejak tersimpan urut waktu',
    new Date(j[1][0]).getTime() < new Date(j[2][0]).getTime() &&
    new Date(j[2][0]).getTime() < new Date(j[3][0]).getTime());
}

// H. Kiriman kosong dan karyawan yang dikecualikan
{
  const ctx = modulAntrian();
  const kosong = antrian(ctx, []);
  cek('antrian: kiriman kosong bukan error', kosong.result === 'success' && kosong.diterima === 0);
  cek('antrian: kiriman kosong tidak membuat sheet', !ctx._sheets.GpsTracking);

  const ctx2 = modulAntrian({ konfig: [['U1', 'Ari Prasetyo', 'Tidak', 300, new Date(), 'admin']] });
  const mati = antrian(ctx2, [{ waktu: menitLalu(5), lat: -7.2575, lng: 112.7521, akurasi: 10 }]);
  cek('antrian: karyawan yang dikecualikan tidak dicatat',
    mati.result === 'success' && mati.dilacak === false && jumlahJejak(ctx2) === 0);
}

// I. Batas 50 titik per kiriman
{
  const ctx = modulAntrian();
  const banyak = [];
  for (let i = 70; i >= 1; i--) banyak.push({ waktu: menitLalu(i), lat: -7.2575 + i / 1000, lng: 112.7521, akurasi: 10 });
  const hasil = antrian(ctx, banyak);
  cek('antrian: tidak lebih dari 50 titik diproses per kiriman', hasil.diterima === 50, String(hasil.diterima));
}

console.log('\n---------------------------------');
console.log(`  LULUS : ${lulus}`);
console.log(`  GAGAL : ${gagal}`);
console.log('---------------------------------\n');
process.exit(gagal ? 1 : 0);
