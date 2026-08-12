// Kasus uji diambil langsung dari file draft hasil download mesin absen,
// termasuk baris-baris yang formatnya menyimpang.

import { toYMD, toHHMM, isBarisHeader, normalisasiBaris, parseWorkbook } from './importDbAbsenParser';

const HEADER = ['No.Akun', 'NIK.', 'Nama', 'Tanggal', 'Jam Kerja', 'Mulai Tugas',
  'Akhir Tugas', 'Masuk', 'Pulang', 'Telat', 'Pulang Awal', 'Bolos',
  'Jam Kerja', 'Symbol', 'Departemen', 'ATT_Time', 'Waktu Scan', 'week'];

describe('toYMD', () => {
  test('DD/MM/YYYY dibaca sebagai hari-bulan', () => {
    expect(toYMD('21/07/2026')).toBe('2026-07-21');
  });

  test('DD-MM-YYYY (varian yang muncul di file asli)', () => {
    expect(toYMD('05-08-2026')).toBe('2026-08-05');
    expect(toYMD('11-08-2026')).toBe('2026-08-11');
  });

  test('tanggal 01-12 tidak tertukar jadi bulan', () => {
    expect(toYMD('01/08/2026')).toBe('2026-08-01');
    expect(toYMD('08/08/2026')).toBe('2026-08-08');
  });

  test('objek Date dari SheetJS', () => {
    expect(toYMD(new Date(2026, 6, 21))).toBe('2026-07-21');
  });

  test('serial Excel', () => {
    // 21 Juli 2026 = serial 46224
    expect(toYMD(46224)).toBe('2026-07-21');
  });

  test('bulan di luar 1-12 ditolak', () => {
    expect(toYMD('21/13/2026')).toBe('');
  });

  test('kosong dan sampah', () => {
    expect(toYMD('')).toBe('');
    expect(toYMD(null)).toBe('');
    expect(toYMD('Tanggal')).toBe('');
  });
});

describe('toHHMM', () => {
  test('jam satu digit dipadkan', () => {
    expect(toHHMM('8:30')).toBe('08:30');
    expect(toHHMM('6:37')).toBe('06:37');
  });

  test('yang sudah rapi tidak berubah', () => {
    expect(toHHMM('08:30')).toBe('08:30');
    expect(toHHMM('17:00')).toBe('17:00');
  });

  test('objek Date jam-saja dari Excel', () => {
    expect(toHHMM(new Date(1899, 11, 31, 8, 30))).toBe('08:30');
  });

  test('pecahan hari', () => {
    expect(toHHMM(0.354166666)).toBe('08:30');
  });

  test('durasi lebih dari 24 jam tetap utuh', () => {
    expect(toHHMM('23:59')).toBe('23:59');
  });

  test('kosong', () => {
    expect(toHHMM('')).toBe('');
  });
});

describe('isBarisHeader', () => {
  test('mengenali header asli', () => {
    expect(isBarisHeader(HEADER)).toBe(true);
  });

  test('baris data bukan header', () => {
    expect(isBarisHeader([5, 'C0011', 'Salam', '21/07/2026'])).toBe(false);
  });
});

describe('normalisasiBaris', () => {
  test('kolom shift dengan prefiks tidak dirusak', () => {
    const r = normalisasiBaris([25, 'A0009', 'Pujiono', '21/07/2026',
      'BSL_08:30-17:00', '8:30', '17:00', '08:32', '17:13', '', '', '',
      '8:27', 'H', 'BSL', '8:41', '08:32 17:08  17:13', 'Tue']);

    expect(r[4]).toBe('BSL_08:30-17:00');   // shift string utuh
    expect(r[3]).toBe('2026-07-21');
    expect(r[7]).toBe('08:32');
    expect(r[12]).toBe('08:27');
    expect(r[16]).toBe('08:32 17:08 17:13'); // spasi ganda dirapikan
    expect(r[13]).toBe('H');
  });

  test('shift lintas hari Kumai_19:00-07-00 tidak diubah', () => {
    const r = normalisasiBaris([204, 'G0020', 'Subroto', '20/07/2026',
      'Kumai_19:00-07-00', '19:00', '6:59', '', '7:12', '', '', '',
      '11:59', 'Si', 'Depo Kumai', '12:12', '', 'Mon']);
    expect(r[4]).toBe('Kumai_19:00-07-00');
    expect(r[6]).toBe('06:59');
    expect(r[13]).toBe('Si');
  });

  test('kolom Bolos TRUE dipertahankan', () => {
    const r = normalisasiBaris([120, '120', 'Agus Tri Prasetyo', '22/07/2026',
      '08:30-17:00', '8:30', '17:00', '', '', '', '', true,
      '', 'A', 'BTR Romo Operator', '', '', 'Wed']);
    expect(r[11]).toBe('true');
    expect(r[13]).toBe('A');
  });

  test('NIK berupa angka jadi teks bersih', () => {
    const r = normalisasiBaris([120, 120, 'Agus', '20/07/2026']);
    expect(r[1]).toBe('120');
  });
});

describe('parseWorkbook', () => {
  const barisSalam = [5, 'C0011', 'Salam', '21/07/2026', '08:30-17:00', '8:30',
    '17:00', '07:04', '21:00', '', '', '', '08:30', 'H', 'JPT Office',
    '13:56', '07:04 07:04 21:00', 'Tue'];
  const barisDede = [6, 'C0007', 'Dede Fernando', '05-08-2026', '08:00-16:00',
    '08:00', '16:00', '7:29', '16:02', '', '', '', '08:00', 'H',
    'BTR Romo Normal', '8:33', '07:29 16:02', 'Wed'];

  test('membaca banyak sheet dan melewati sheet bantu', () => {
    const hasil = parseWorkbook([
      { nama: 'NON-SHIFT', aoa: [HEADER, barisSalam, barisDede] },
      { nama: 'SHIFT', aoa: [HEADER, barisSalam.map((v, i) => (i === 1 ? 'G0020' : v))] },
      { nama: 'Bantu', aoa: [['Tanggal', '', 'PERIODE'], ['21/07/2026', '', '2026-1']] }
    ]);

    expect(hasil.baris).toHaveLength(3);
    expect(hasil.perSheet.map((s) => s.nama)).toEqual(['NON-SHIFT', 'SHIFT']);
    expect(hasil.jumlahNik).toBe(3);
    expect(hasil.tanggalMin).toBe('2026-07-21');
    expect(hasil.tanggalMaks).toBe('2026-08-05');
  });

  test('header yang berulang di tengah file dilewati, bukan jadi data', () => {
    const hasil = parseWorkbook([
      { nama: 'NON-SHIFT', aoa: [HEADER, barisSalam, HEADER, barisDede, HEADER] }
    ]);
    expect(hasil.baris).toHaveLength(2);
    expect(hasil.dilewati).toHaveLength(0);
  });

  test('baris kosong diabaikan tanpa dilaporkan sebagai masalah', () => {
    const hasil = parseWorkbook([
      { nama: 'NON-SHIFT', aoa: [HEADER, barisSalam, ['', '', '', ''], barisDede] }
    ]);
    expect(hasil.baris).toHaveLength(2);
    expect(hasil.dilewati).toHaveLength(0);
  });

  test('tanggal tidak terbaca dilaporkan, tidak diam-diam dibuang', () => {
    const rusak = [...barisSalam];
    rusak[3] = '32/32/2026';
    const hasil = parseWorkbook([{ nama: 'NON-SHIFT', aoa: [HEADER, rusak] }]);

    expect(hasil.baris).toHaveLength(0);
    expect(hasil.dilewati).toHaveLength(1);
    expect(hasil.dilewati[0].alasan).toContain('Tanggal tidak terbaca');
  });

  test('NIK kosong dilaporkan', () => {
    const rusak = [...barisSalam];
    rusak[1] = '';
    const hasil = parseWorkbook([{ nama: 'NON-SHIFT', aoa: [HEADER, rusak] }]);
    expect(hasil.dilewati[0].alasan).toBe('NIK kosong');
  });

  test('duplikat NIK+tanggal dibuang, hanya baris terakhir yang dipakai', () => {
    const kedua = [...barisSalam];
    kedua[7] = '09:15';   // Masuk berbeda, supaya bisa dibedakan

    const hasil = parseWorkbook([
      { nama: 'NON-SHIFT', aoa: [HEADER, barisSalam, kedua] }
    ]);

    expect(hasil.baris).toHaveLength(1);
    expect(hasil.duplikat).toBe(1);
    expect(hasil.baris[0][7]).toBe('09:15');
  });

  test('duplikat antar file: file yang dibaca belakangan menang', () => {
    const dariFileKedua = [...barisSalam];
    dariFileKedua[7] = '06:45';

    const hasil = parseWorkbook([
      { file: 'juli.xlsx', nama: 'NON-SHIFT', aoa: [HEADER, barisSalam, barisDede] },
      { file: 'agustus.xlsx', nama: 'NON-SHIFT', aoa: [HEADER, dariFileKedua] }
    ]);

    expect(hasil.baris).toHaveLength(2);
    expect(hasil.duplikat).toBe(1);

    const salam = hasil.baris.find((r) => r[1] === 'C0011');
    expect(salam[7]).toBe('06:45');

    expect(hasil.bentrok).toHaveLength(1);
    expect(hasil.bentrok[0].lama).toContain('juli.xlsx');
    expect(hasil.bentrok[0].baru).toContain('agustus.xlsx');
  });

  test('beberapa file digabung dan diringkas per file', () => {
    const hasil = parseWorkbook([
      { file: 'juli.xlsx', nama: 'NON-SHIFT', aoa: [HEADER, barisSalam] },
      { file: 'juli.xlsx', nama: 'SHIFT', aoa: [HEADER, barisSalam.map((v, i) => (i === 1 ? 'G0020' : v))] },
      { file: 'agustus.xlsx', nama: 'NON-SHIFT', aoa: [HEADER, barisDede] }
    ]);

    expect(hasil.baris).toHaveLength(3);
    expect(hasil.perFile).toEqual([
      { nama: 'juli.xlsx', diterima: 2, dilewati: 0, sheets: 2 },
      { nama: 'agustus.xlsx', diterima: 1, dilewati: 0, sheets: 1 }
    ]);
  });

  test('baris dilewati mencantumkan file asalnya', () => {
    const rusak = [...barisSalam];
    rusak[1] = '';

    const hasil = parseWorkbook([
      { file: 'agustus.xlsx', nama: 'NON-SHIFT', aoa: [HEADER, rusak] }
    ]);

    expect(hasil.dilewati[0].file).toBe('agustus.xlsx');
    expect(hasil.dilewati[0].alasan).toBe('NIK kosong');
  });

  test('data sebelum header pertama tidak ikut terbaca', () => {
    const hasil = parseWorkbook([
      { nama: 'NON-SHIFT', aoa: [['Laporan Absensi Juli'], [''], HEADER, barisSalam] }
    ]);
    expect(hasil.baris).toHaveLength(1);
  });
});
