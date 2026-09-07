/**
 * UJI MESIN DETEKSI FAKE GPS
 *
 * Jalankan:  node scripts/test-antifakegps.js
 *
 * KENAPA ADA: ambang batas di GPS_AMBANG akan disetel ulang seiring waktu.
 * Setiap kali disetel, dua hal harus tetap benar — Fake GPS yang jelas
 * tertangkap, DAN karyawan yang absen dari WiFi kantor tidak ikut kena.
 * Berkas ini menjaga keduanya. Ia memuat AntiFakeGps.gs apa adanya di
 * dalam sandbox dengan SpreadsheetApp tiruan, jadi yang diuji adalah kode
 * yang benar-benar dipakai di produksi, bukan salinannya.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SUMBER = path.join(__dirname, '..', 'apps-script', 'AntiFakeGps.gs');

// --- Sheet Absensi tiruan -------------------------------------------
// Kolom mengikuti sheet asli: A uuid, B waktu, C userId, D nama,
// E tipe, F lokasi.
function buatSheetTiruan(baris) {
  const data = [['uuid', 'Waktu', 'UserID', 'Nama', 'Tipe', 'Lokasi']].concat(baris);
  return {
    getLastRow: () => data.length,
    getLastColumn: () => 6,
    getMaxColumns: () => 6,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
      setValue: () => {},
      setValues: () => {}
    }),
    appendRow: () => {},
    setFrozenRows: () => {},
    insertColumnsAfter: () => {}
  };
}

function muatModul(barisAbsensi) {
  const ctx = {
    SHEET_ABSENSI: 'Absensi',
    SS: {
      getSheetByName: (n) => (n === 'Absensi' ? buatSheetTiruan(barisAbsensi) : null),
      insertSheet: () => buatSheetTiruan([])
    },
    Utilities: { getUuid: () => 'uuid-uji', formatDate: (d) => String(d) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    responseJSON: (o) => o,
    console: { warn: () => {}, log: () => {} },
    Math, Date, Number, String, Object, Array, isFinite, JSON
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SUMBER, 'utf8'), ctx);
  return ctx;
}

// --- Pembantu -------------------------------------------------------
const menitLalu = (n) => new Date(Date.now() - n * 60000);

function riwayatIdentik(userId, nama, jumlah, koordinat) {
  const baris = [];
  for (let i = jumlah; i >= 1; i--) {
    baris.push(['u', menitLalu(i * 600), userId, nama, i % 2 ? 'Hadir' : 'Pulang', koordinat]);
  }
  return baris;
}

function riwayatWajar(userId, nama, jumlah) {
  const baris = [];
  for (let i = jumlah; i >= 1; i--) {
    const lat = -7.290039 + (Math.sin(i) * 0.00012);
    const lng = 112.735608 + (Math.cos(i) * 0.00012);
    baris.push(['u', menitLalu(i * 600), userId, nama, i % 2 ? 'Hadir' : 'Pulang', lat + ', ' + lng]);
  }
  return baris;
}

// --- Kerangka uji ----------------------------------------------------
let lulus = 0, gagal = 0;

function uji(nama, barisAbsensi, payload, harap) {
  const ctx = muatModul(barisAbsensi);
  const hasil = ctx.analisaIntegritasGps(payload, { ok: true });
  const cocok = (harap.level === undefined || hasil.level === harap.level) &&
                (harap.blokir === undefined || hasil.blokir === harap.blokir) &&
                (harap.skorMin === undefined || hasil.skor >= harap.skorMin) &&
                (harap.skorMaks === undefined || hasil.skor <= harap.skorMaks);
  if (cocok) {
    lulus++;
    console.log(`  LULUS  ${nama}  [skor ${hasil.skor}, ${hasil.level}]`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}`);
    console.log(`         diharap ${JSON.stringify(harap)}`);
    console.log(`         didapat skor=${hasil.skor} level=${hasil.level} blokir=${hasil.blokir}`);
    console.log(`         alasan: ${hasil.alasan.join(' | ') || '(tidak ada)'}`);
  }
}

const buktiSehat = { sampel: 2, jitterMeter: 2.4, driftWaktuMs: 120, mockFlag: false, otomasi: false };

console.log('\n=== HARUS DITOLAK (blokir) ===');

uji('Flag Mock Location dari perangkat',
  riwayatWajar('U1', 'Budi', 10),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 14, isMockGps: true, gpsBukti: buktiSehat },
  { blokir: true, level: 'BLOKIR' });

uji('Akurasi 0 meter (mustahil pada perangkat asli)',
  riwayatWajar('U1', 'Budi', 10),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 0, gpsBukti: buktiSehat },
  { blokir: true });

uji('Koordinat Null Island 0,0',
  riwayatWajar('U1', 'Budi', 10),
  { userId: 'U1', tipe: 'Hadir', lokasi: '0.0000000, 0.0000000', gpsAccuracy: 15, gpsBukti: buktiSehat },
  { blokir: true });

uji('Koordinat diketik manual (2 desimal)',
  riwayatWajar('U1', 'Budi', 10),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.29, 112.73', gpsAccuracy: 15, gpsBukti: buktiSehat },
  { blokir: true });

uji('Browser mode otomasi / override DevTools',
  riwayatWajar('U1', 'Budi', 10),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 15,
    gpsBukti: Object.assign({}, buktiSehat, { otomasi: true }) },
  { blokir: true });

uji('Perpindahan mustahil (Surabaya -> Jakarta dalam 10 menit)',
  [['u', menitLalu(10), 'U1', 'Budi', 'Hadir', '-7.2901234, 112.7356789']],
  { userId: 'U1', tipe: 'Hadir', lokasi: '-6.2087634, 106.8455916', gpsAccuracy: 15, gpsBukti: buktiSehat },
  { blokir: true });

console.log('\n=== HARUS DITANDAI, TAPI TIDAK DIBLOKIR ===');

uji('Koordinat beku: dua pembacaan sama persis',
  riwayatWajar('U1', 'Budi', 10),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 15,
    gpsBukti: Object.assign({}, buktiSehat, { jitterMeter: 0 }) },
  { blokir: false, skorMin: 40 });

uji('Pola INDRA LESTARI: koordinat identik 25x, tak ada karyawan lain di titik itu',
  riwayatIdentik('U9', 'INDRA LESTARI', 25, '-7.290039699999999, 112.73560859999999'),
  { userId: 'U9', tipe: 'Hadir', lokasi: '-7.290039699999999, 112.73560859999999', gpsAccuracy: 30, gpsBukti: buktiSehat },
  { blokir: false, skorMin: 40, level: 'TINJAU' });

uji('Pola identik DITAMBAH koordinat beku -> cukup untuk ditolak',
  riwayatIdentik('U9', 'INDRA LESTARI', 25, '-7.290039699999999, 112.73560859999999'),
  { userId: 'U9', tipe: 'Hadir', lokasi: '-7.290039699999999, 112.73560859999999', gpsAccuracy: 250,
    gpsBukti: Object.assign({}, buktiSehat, { jitterMeter: 0 }) },
  { blokir: true });

console.log('\n=== TIDAK BOLEH KENA (anti tuduhan palsu) ===');

uji('Absen normal, koordinat bervariasi wajar',
  riwayatWajar('U1', 'Budi', 15),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 12, gpsBukti: buktiSehat },
  { blokir: false, level: 'AMAN' });

uji('WiFi kantor: koordinat identik TAPI dipakai 4 karyawan lain juga',
  riwayatIdentik('U9', 'INDRA LESTARI', 25, '-7.290039699999999, 112.73560859999999')
    .concat(riwayatIdentik('U2', 'Sari', 4, '-7.290039699999999, 112.73560859999999'))
    .concat(riwayatIdentik('U3', 'Dedi', 4, '-7.290039699999999, 112.73560859999999'))
    .concat(riwayatIdentik('U4', 'Tono', 4, '-7.290039699999999, 112.73560859999999'))
    .concat(riwayatIdentik('U5', 'Rina', 4, '-7.290039699999999, 112.73560859999999')),
  { userId: 'U9', tipe: 'Hadir', lokasi: '-7.290039699999999, 112.73560859999999', gpsAccuracy: 30, gpsBukti: buktiSehat },
  { blokir: false, level: 'AMAN', skorMaks: 0 });

uji('Pembacaan kedua gagal (jitter tidak terukur) -> jangan dihukum',
  riwayatWajar('U1', 'Budi', 15),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 20,
    gpsBukti: { sampel: 1, jitterMeter: null, driftWaktuMs: 200, mockFlag: false, otomasi: false } },
  { blokir: false, level: 'AMAN' });

uji('Pengajuan Cuti (tanpa GPS) tidak ikut dinilai',
  riwayatWajar('U1', 'Budi', 15),
  { userId: 'U1', tipe: 'Cuti', lokasi: '-', gpsAccuracy: null, gpsBukti: {} },
  { blokir: false, level: 'AMAN', skorMaks: 0 });

uji('Karyawan lapangan pindah 40 km dalam 2 jam (wajar)',
  [['u', menitLalu(120), 'U1', 'Budi', 'Hadir', '-7.2901234, 112.7356789']],
  { userId: 'U1', tipe: 'Pulang', lokasi: '-7.6521345, 112.9012678', gpsAccuracy: 18, gpsBukti: buktiSehat },
  { blokir: false, level: 'AMAN' });

uji('Sinyal lemah di dalam gedung (akurasi 240 m) -> ditandai, bukan ditolak',
  riwayatWajar('U1', 'Budi', 15),
  { userId: 'U1', tipe: 'Hadir', lokasi: '-7.2901234, 112.7356789', gpsAccuracy: 240, gpsBukti: buktiSehat },
  { blokir: false });

console.log(`\n=================================`);
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log(`=================================\n`);
process.exit(gagal > 0 ? 1 : 0);
