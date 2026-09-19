import {
  keYmd, labelTanggalPendek, labelTanggalPanjang, daftarTanggal,
  susunBoard, boardKeSheet, bandingPayroll, BOARD_KOLOM_INFO, BOARD_KODE_HITUNG, BOARD_MAKS_HARI
} from './boardAbsensi';

const denda = (telat, nominal) => Number(nominal) || 0;

const rec = (o) => Object.assign({
  noAkun: '', payroll: '', nama: '', tanggalYMD: '', tanggal: '',
  id2: 'H', departemen: '', telat: '', nominal: '', isKoreksi: false
}, o);

describe('keYmd', () => {
  test('meneruskan YYYY-MM-DD apa adanya', () => {
    expect(keYmd('2026-07-21')).toBe('2026-07-21');
    expect(keYmd('2026-07-21T00:00:00Z')).toBe('2026-07-21');
  });

  test('membaca DD-MM-YYYY dan DD/MM/YYYY', () => {
    expect(keYmd('21-07-2026')).toBe('2026-07-21');
    expect(keYmd('5/8/2026')).toBe('2026-08-05');
  });

  test('nilai tak terbaca jadi string kosong, bukan hari ini', () => {
    expect(keYmd('')).toBe('');
    expect(keYmd(null)).toBe('');
    expect(keYmd('bukan tanggal')).toBe('');
    expect(keYmd(new Date('x'))).toBe('');
  });
});

describe('label tanggal', () => {
  test('pendek dan panjang memakai nama bulan Indonesia', () => {
    expect(labelTanggalPendek('2026-07-21')).toBe('21 Jul');
    expect(labelTanggalPendek('2026-08-05')).toBe('5 Agu');
    expect(labelTanggalPanjang('2026-08-20')).toBe('20 Agustus 2026');
  });
});

describe('daftarTanggal', () => {
  test('inklusif di kedua ujung', () => {
    const { tanggal } = daftarTanggal('2026-07-21', '2026-07-24');
    expect(tanggal).toEqual(['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
  });

  test('melintasi pergantian bulan tanpa hari yang hilang', () => {
    const { tanggal } = daftarTanggal('2026-07-30', '2026-08-02');
    expect(tanggal).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
  });

  test('periode penuh 21 s/d 20 berisi 31 hari', () => {
    const { tanggal, terpotong } = daftarTanggal('2026-07-21', '2026-08-20');
    expect(tanggal.length).toBe(31);
    expect(terpotong).toBe(false);
  });

  test('rentang terbalik menghasilkan daftar kosong, bukan lemparan', () => {
    expect(daftarTanggal('2026-08-20', '2026-07-21').tanggal).toEqual([]);
  });

  test('rentang melewati batas dipotong dan ditandai', () => {
    const { tanggal, terpotong, totalHari } = daftarTanggal('2026-01-01', '2026-12-31');
    expect(tanggal.length).toBe(BOARD_MAKS_HARI);
    expect(terpotong).toBe(true);
    expect(totalHari).toBe(365);
  });
});

describe('susunBoard', () => {
  const records = [
    rec({ payroll: 'A0009', nama: 'PUJIONO', departemen: 'BSL', tanggalYMD: '2026-07-21', id2: 'H' }),
    rec({ payroll: 'A0009', nama: 'PUJIONO', departemen: 'BSL', tanggalYMD: '2026-07-22', id2: 'O' }),
    rec({ payroll: 'A0009', nama: 'PUJIONO', departemen: 'BSL', tanggalYMD: '2026-07-23', id2: 'C' }),
    rec({ payroll: 'E0065', nama: 'EDO SATYA', departemen: 'GMS BWI', tanggalYMD: '2026-07-21', id2: 'T', telat: '00:15', nominal: 25000 }),
    rec({ payroll: 'E0065', nama: 'EDO SATYA', departemen: 'GMS BWI', tanggalYMD: '2026-07-23', id2: 'A' })
  ];
  const dashboard = [
    { payroll: 'A0009', nama: 'PUJIONO', dept: 'BSL', jabatan: 'STAFT OPERATIONAL' },
    { payroll: 'E0065', nama: 'EDO SATYA', dept: 'GMS BWI', jabatan: 'ADMINISTRASI' }
  ];
  const board = susunBoard({ records, dashboard, dari: '2026-07-21', sampai: '2026-07-23', hitungDenda: denda });

  test('satu baris per karyawan, satu kolom per tanggal', () => {
    expect(board.tanggal).toEqual(['2026-07-21', '2026-07-22', '2026-07-23']);
    expect(board.baris.length).toBe(2);
    board.baris.forEach(b => expect(b.sel.length).toBe(3));
  });

  test('diurutkan PT lalu payroll, seperti sheet BOARD template', () => {
    expect(board.baris.map(b => b.pt)).toEqual(['BSL', 'GMS BWI']);
    expect(board.baris[0].no).toBe(1);
    expect(board.baris[1].no).toBe(2);
  });

  test('urutan payroll dalam satu PT mengikuti blok KCM template', () => {
    const kcm = ['C0049', 'C0009', 'C0105', 'C0018', 'C0010', 'C0103', 'C0019', 'C0033'];
    const b = susunBoard({
      records: kcm.map(pr => rec({ payroll: pr, nama: 'X ' + pr, departemen: 'KCM', tanggalYMD: '2026-07-21', id2: 'H' })),
      dashboard: [], dari: '2026-07-21', sampai: '2026-07-21', hitungDenda: denda
    });
    expect(b.baris.map(x => x.payroll))
      .toEqual(['C0009', 'C0010', 'C0018', 'C0019', 'C0033', 'C0049', 'C0103', 'C0105']);
  });

  test('PT dikelompokkan lebih dulu, payroll diurutkan di dalamnya', () => {
    const b = susunBoard({
      records: [
        rec({ payroll: 'D0012', nama: 'D DUA', departemen: 'SPT', tanggalYMD: '2026-07-21', id2: 'H' }),
        rec({ payroll: 'C0018', nama: 'C SATU', departemen: 'KCM', tanggalYMD: '2026-07-21', id2: 'H' }),
        rec({ payroll: 'D0002', nama: 'D SATU', departemen: 'SPT', tanggalYMD: '2026-07-21', id2: 'H' }),
        rec({ payroll: 'A0009', nama: 'A SATU', departemen: 'BSL', tanggalYMD: '2026-07-21', id2: 'H' }),
        rec({ payroll: 'C0009', nama: 'C NOL', departemen: 'KCM', tanggalYMD: '2026-07-21', id2: 'H' })
      ],
      dashboard: [], dari: '2026-07-21', sampai: '2026-07-21', hitungDenda: denda
    });
    expect(b.baris.map(x => x.pt + ':' + x.payroll))
      .toEqual(['BSL:A0009', 'KCM:C0009', 'KCM:C0018', 'SPT:D0002', 'SPT:D0012']);
  });

  test('simbol harian jatuh di kolom tanggalnya', () => {
    const p = board.baris[0];
    expect(p.sel.map(s => (s ? s.absen : null))).toEqual(['H', 'O', 'C']);
  });

  test('hari tanpa baris mesin dibiarkan kosong, bukan diisi alpa', () => {
    const edo = board.baris[1];
    expect(edo.sel[1]).toBe(null);
  });

  test('HARI KERJA menghitung hari bersimbol selain O', () => {
    expect(board.baris[0].hariKerja).toBe(2);   // H + C, O tidak dihitung
    expect(board.baris[1].hariKerja).toBe(2);   // T + A
  });

  test('kolom KETIDAKHADIRAN mencacah simbolnya masing-masing', () => {
    expect(board.baris[0].hitung).toEqual({ A: 0, C: 1, EO: 0, O: 1, S: 0 });
    expect(board.baris[1].hitung).toEqual({ A: 1, C: 0, EO: 0, O: 0, S: 0 });
  });

  test('kolom TELAT berisi nominal denda, dijumlahkan per orang', () => {
    expect(board.baris[1].sel[0].denda).toBe(25000);
    expect(board.baris[1].totalDenda).toBe(25000);
    expect(board.baris[0].totalDenda).toBe(0);
  });

  test('JABATAN diambil dari dashboardData karena dbabsen tidak memuatnya', () => {
    expect(board.baris[0].jabatan).toBe('STAFT OPERATIONAL');
    expect(board.baris[1].jabatan).toBe('ADMINISTRASI');
  });

  test('HRD, TGL MASUK, dan ATASAN memang kosong — belum ada sumbernya', () => {
    board.baris.forEach(b => {
      expect(b.hrd).toBe('');
      expect(b.tglMasuk).toBe('');
      expect(b.atasan).toBe('');
    });
  });

  test('baris di luar rentang tidak masuk board', () => {
    const b = susunBoard({
      records: records.concat([
        rec({ payroll: 'A0009', nama: 'PUJIONO', tanggalYMD: '2026-08-01', id2: 'S' })
      ]),
      dashboard, dari: '2026-07-21', sampai: '2026-07-23', hitungDenda: denda
    });
    expect(b.baris[0].hitung.S).toBe(0);
    expect(b.baris[0].sel.length).toBe(3);
  });

  test('rentang kosong diambil dari tanggal terkecil s/d terbesar di data', () => {
    const b = susunBoard({ records, dashboard, dari: '', sampai: '', hitungDenda: denda });
    expect(b.tanggal[0]).toBe('2026-07-21');
    expect(b.tanggal[b.tanggal.length - 1]).toBe('2026-07-23');
  });

  test('tanggal DD-MM-YYYY tetap terbaca kalau tanggalYMD tidak ada', () => {
    const b = susunBoard({
      records: [rec({ payroll: 'X1', nama: 'X', tanggal: '22-07-2026', id2: 'H' })],
      dashboard: [], dari: '2026-07-21', sampai: '2026-07-23', hitungDenda: denda
    });
    expect(b.baris[0].sel[1].absen).toBe('H');
  });

  test('karyawan dicocokkan lewat payroll, no akun, lalu nama', () => {
    const b = susunBoard({
      records: [
        rec({ noAkun: 'K99', nama: 'TANPA PAYROLL', tanggalYMD: '2026-07-21', id2: 'H' }),
        rec({ noAkun: 'K99', nama: 'TANPA PAYROLL', tanggalYMD: '2026-07-22', id2: 'I' })
      ],
      dashboard: [{ noAkun: 'K99', nama: 'TANPA PAYROLL', jabatan: 'KERANI' }],
      dari: '2026-07-21', sampai: '2026-07-22', hitungDenda: denda
    });
    expect(b.baris.length).toBe(1);
    expect(b.baris[0].payroll).toBe('K99');
    expect(b.baris[0].jabatan).toBe('KERANI');
  });

  test('data kosong menghasilkan board kosong, bukan lemparan', () => {
    const b = susunBoard({ records: [], dashboard: [], dari: '', sampai: '', hitungDenda: denda });
    expect(b.baris).toEqual([]);
    expect(b.tanggal).toEqual([]);
    expect(b.judul).toContain('belum terisi');
  });

  test('judul menyebut rentang yang benar-benar ditampilkan', () => {
    expect(board.judul).toBe('Absensi Karyawan Periode 21 Juli 2026 s/d 23 Juli 2026');
  });
});

describe('boardKeSheet', () => {
  const board = susunBoard({
    records: [
      rec({ payroll: 'A0009', nama: 'PUJIONO', departemen: 'BSL', tanggalYMD: '2026-07-21', id2: 'H' }),
      rec({ payroll: 'A0009', nama: 'PUJIONO', departemen: 'BSL', tanggalYMD: '2026-07-22', id2: 'T', nominal: 25000 })
    ],
    dashboard: [{ payroll: 'A0009', nama: 'PUJIONO', jabatan: 'STAFT OPERATIONAL' }],
    dari: '2026-07-21', sampai: '2026-07-22', hitungDenda: denda
  });
  const { aoa, merges, lebarKolom, lebarInfo, lebarTotal } = boardKeSheet(board);

  test('lebar tabel = info + 2 kolom per tanggal + kolom hitung', () => {
    expect(lebarInfo).toBe(BOARD_KOLOM_INFO.length);
    expect(lebarTotal).toBe(9 + 2 * 2 + BOARD_KODE_HITUNG.length);
    aoa.forEach(r => expect(r.length).toBe(lebarTotal));
    expect(lebarKolom.length).toBe(lebarTotal);
  });

  test('baris 1 judul, baris 2-3 header dua tingkat', () => {
    expect(aoa[0][0]).toBe(board.judul);
    expect(aoa[0][1]).toBe('');                       // judul tidak digabung
    expect(aoa[1].slice(0, 9)).toEqual(BOARD_KOLOM_INFO);
    expect(aoa[1][9]).toBe('21 Jul');
    expect(aoa[1][11]).toBe('22 Jul');
    expect(aoa[2].slice(9, 13)).toEqual(['ABSEN', 'TELAT', 'ABSEN', 'TELAT']);
    expect(aoa[1][13]).toBe('KETIDAKHADIRAN');
    expect(aoa[2].slice(13)).toEqual(BOARD_KODE_HITUNG.map(k => k.label));
  });

  test('baris data memakai urutan kolom template', () => {
    const b = aoa[3];
    expect(b[0]).toBe(1);                 // NO
    expect(b[1]).toBe('A0009');           // PAYROLL
    expect(b[2]).toBe('');                // HRD
    expect(b[3]).toBe('PUJIONO');         // NAMA
    expect(b[4]).toBe('BSL');             // PT
    expect(b[5]).toBe('');                // TGL MASUK
    expect(b[6]).toBe('STAFT OPERATIONAL'); // JABATAN
    expect(b[7]).toBe('');                // ATASAN LANGSUNG
    expect(b[8]).toBe(2);                 // HARI KERJA
    expect(b[9]).toBe('H');
    expect(b[10]).toBe('');               // tidak telat -> kosong, bukan 0
    expect(b[11]).toBe('T');
    expect(b[12]).toBe(25000);            // angka, supaya bisa dijumlah di Excel
  });

  test('merge: kolom info ke bawah, tanggal ke samping, ketidakhadiran selebar kodenya', () => {
    expect(merges.filter(m => m.s.r === 1 && m.e.r === 2).length).toBe(9);
    const tgl = merges.filter(m => m.s.r === 1 && m.e.r === 1 && m.e.c - m.s.c === 1);
    expect(tgl.length).toBe(2);
    const hitung = merges.find(m => m.s.c === 13);
    expect(hitung).toEqual({ s: { r: 1, c: 13 }, e: { r: 1, c: 13 + BOARD_KODE_HITUNG.length - 1 } });
  });

  test('tidak ada merge yang keluar dari lebar tabel', () => {
    merges.forEach(m => {
      expect(m.e.c).toBeLessThan(lebarTotal);
      expect(m.e.r).toBeLessThan(aoa.length);
    });
  });
});

describe('bandingPayroll', () => {
  const urut = (arr) => arr.slice().sort(bandingPayroll);

  test('angka dibandingkan sebagai angka, bukan sebagai teks', () => {
    // 'G0071' < 'G0621' benar secara teks; 'G71' vs 'G621' tidak.
    expect(urut(['G621', 'G71', 'G8'])).toEqual(['G8', 'G71', 'G621']);
  });

  test('digit nol di depan tidak mengubah urutan', () => {
    expect(urut(['C0010', 'C0009', 'C9'])).toEqual(['C0009', 'C9', 'C0010']);
  });

  test('awalan huruf dikelompokkan lebih dulu', () => {
    expect(urut(['E0071', 'A0012', 'C0094', 'A0009', 'H0005']))
      .toEqual(['A0009', 'A0012', 'C0094', 'E0071', 'H0005']);
  });

  test('kode tanpa huruf awalan ditaruh paling belakang', () => {
    expect(urut(['2073', 'G0429', '607', 'G0540']))
      .toEqual(['G0429', 'G0540', '607', '2073']);
  });

  test('huruf kecil dan spasi tidak membuat urutan meleset', () => {
    expect(urut([' c0018 ', 'c0009'])).toEqual(['c0009', ' c0018 ']);
  });

  test('nilai kosong tidak melempar dan tidak menyusup ke tengah', () => {
    expect(urut(['C0010', '', 'C0009', null])).toEqual(['C0009', 'C0010', '', null]);
  });
});
