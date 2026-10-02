import {
  rentangTanggal, hariMinggu, hariKerja, saringKerani, daftarDivisi,
  tanggalBaris, susunRekapKerani, STATUS
} from './rekapKerani';

// 1–7 Sep 2026: Sel Rab Kam Jum Sab Min Sen.
// (2026-09-06 adalah hari Minggu — dipakai berulang di bawah.)
const DARI = '2026-09-01';
const SAMPAI = '2026-09-07';

// Bentuk ini mengikuti sheet Users yang sebenarnya: "KERANI PABRIK"
// tersimpan di kolom DIVISI (yang tampil sebagai POSISI di layar
// Laporan), sedangkan kolom Jabatan berisi peran aplikasi.
const KERANI = [
  { id: 'U1', nama: 'ANI', divisi: 'KERANI PABRIK', jabatan: 'karyawan' },
  { id: 'U2', nama: 'BUDI', divisi: 'KERANI PABRIK', jabatan: 'karyawan' }
];

function absen(id, tipe, tgl, extra) {
  return { userId: id, tipe, waktu: tgl + 'T07:00:00', tglMulai: '-', tglSelesai: '-', ...(extra || {}) };
}

describe('rentangTanggal & hariKerja', () => {
  test('inklusif di kedua ujung', () => {
    expect(rentangTanggal(DARI, SAMPAI)).toHaveLength(7);
    expect(rentangTanggal(DARI, SAMPAI)[6]).toBe(SAMPAI);
  });

  test('rentang terbalik menghasilkan kosong, bukan lemparan', () => {
    expect(rentangTanggal(SAMPAI, DARI)).toEqual([]);
  });

  test('Minggu dikenali', () => {
    expect(hariMinggu('2026-09-06')).toBe(true);
    expect(hariMinggu('2026-09-07')).toBe(false);
  });

  test('Minggu & libur nasional dibuang secara bawaan', () => {
    const h = hariKerja(DARI, SAMPAI, { libur: { '2026-09-02': { nama: 'Uji' } } });
    expect(h).not.toContain('2026-09-06');
    expect(h).not.toContain('2026-09-02');
    expect(h).toHaveLength(5);
  });

  test('keduanya bisa dikembalikan lewat opsi', () => {
    const h = hariKerja(DARI, SAMPAI, {
      libur: { '2026-09-02': {} }, hitungMinggu: true, hitungLibur: true
    });
    expect(h).toHaveLength(7);
  });
});

describe('saringKerani', () => {
  const orang = KERANI.concat([
    // Cocok lewat kolom JABATAN, bukan divisi — bentuk yang juga harus
    // tertangkap kalau suatu saat sheet-nya dirapikan.
    { id: 'U3', nama: 'CITRA', divisi: 'KANTOR PUSAT', jabatan: 'KERANI ADMIN' },
    { id: 'U4', nama: 'DEDI', divisi: 'KERANI PABRIK', jabatan: 'karyawan' },
    { id: 'U5', nama: 'EKO', divisi: 'SOPIR', jabatan: 'karyawan' }
  ]);

  // Ini yang dulu gagal: "KERANI PABRIK" ada di kolom DIVISI, jadi
  // saringan yang hanya melihat kolom Jabatan mengembalikan nol orang
  // padahal datanya ada.
  test('kata kunci cocok lewat kolom DIVISI', () => {
    expect(saringKerani(KERANI, 'KERANI', []).map((x) => x.id)).toEqual(['U1', 'U2']);
  });

  test('kata kunci cocok lewat kolom JABATAN', () => {
    const h = saringKerani(orang, 'KERANI ADMIN', []);
    expect(h.map((x) => x.id)).toEqual(['U3']);
  });

  test('yang tidak cocok di kolom mana pun tetap terbuang', () => {
    expect(saringKerani(orang, 'KERANI', []).map((x) => x.id))
      .toEqual(['U1', 'U2', 'U3', 'U4']);
  });

  test('kata kunci tidak peduli besar-kecil huruf', () => {
    expect(saringKerani(orang, 'kerani', [])).toHaveLength(4);
  });

  test('daftar divisi kosong berarti SEMUA divisi, bukan nol', () => {
    expect(saringKerani(orang, 'KERANI', [])).toHaveLength(4);
  });

  test('divisi mempersempit hasil', () => {
    const h = saringKerani(orang, 'KERANI', ['KERANI PABRIK']);
    expect(h.map((x) => x.id)).toEqual(['U1', 'U2', 'U4']);
  });

  test('daftarDivisi unik dan terurut, melewati tanda strip', () => {
    expect(daftarDivisi(orang.concat([{ id: 'U6', divisi: '-' }])))
      .toEqual(['KANTOR PUSAT', 'KERANI PABRIK', 'SOPIR']);
  });
});

describe('tanggalBaris', () => {
  test('baris harian memakai kolom waktu', () => {
    expect(tanggalBaris(absen('U1', 'Hadir', '2026-09-01'))).toEqual(['2026-09-01']);
  });

  test('pengajuan dibentangkan ke seluruh rentangnya', () => {
    const cuti = { userId: 'U1', tipe: 'Cuti', waktu: '2026-08-28T09:00:00',
      tglMulai: '2026-09-02', tglSelesai: '2026-09-04' };
    expect(tanggalBaris(cuti)).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
  });
});

describe('susunRekapKerani', () => {
  const dasar = { kerani: KERANI, dari: DARI, sampai: SAMPAI, libur: {} };

  test('kerani tanpa satu baris pun tetap muncul, seluruh harinya kosong', () => {
    const r = susunRekapKerani({ ...dasar, history: [] });
    expect(r.ringkas.jumlahOrang).toBe(2);
    expect(r.ringkas.hariKerja).toBe(6);          // 7 hari minus satu Minggu
    expect(r.ringkas.totalHariOrang).toBe(12);
    expect(r.ringkas.tidakAbsen).toBe(12);
    expect(r.ringkas.persenTidakAbsen).toBe(100);
  });

  test('Hadir + Pulang = lengkap; Hadir saja tidak', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Hadir', '2026-09-01'),
      absen('U1', 'Pulang', '2026-09-01'),
      absen('U1', 'Hadir', '2026-09-02')
    ] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.hadir).toBe(2);
    expect(ani.lengkap).toBe(1);
    expect(r.ringkas.lengkap).toBe(1);
  });

  test('Hadir mengalahkan Standby pada hari yang sama', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Standby', '2026-09-01'),
      absen('U1', 'Hadir', '2026-09-01')
    ] });
    expect(r.perOrang.find((b) => b.id === 'U1').sel['2026-09-01']).toBe(STATUS.HADIR);
  });

  test('Pulang saja tetap hadir, tapi tidak lengkap', () => {
    const r = susunRekapKerani({ ...dasar, history: [absen('U1', 'Pulang', '2026-09-01')] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.sel['2026-09-01']).toBe(STATUS.HADIR);
    expect(ani.hadir).toBe(1);
    expect(ani.lengkap).toBe(0);
    expect(ani.tidakAbsen).toBe(5);
  });

  // Pola nyata dari data: satu orang bisa punya hari yang hanya absen
  // masuk, hari yang hanya absen pulang, hari Standby, dan hari kosong.
  test('pola campuran masuk-saja / pulang-saja / standby', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Hadir', '2026-09-01'),
      absen('U1', 'Pulang', '2026-09-02'),
      absen('U1', 'Hadir', '2026-09-03'),
      absen('U1', 'Pulang', '2026-09-03'),
      absen('U1', 'Standby', '2026-09-04')
    ] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.hadir).toBe(3);
    expect(ani.standby).toBe(1);
    expect(ani.lengkap).toBe(1);
    expect(ani.tidakAbsen).toBe(2);
  });

  test('cuti menutup seluruh harinya dan keluar dari penyebut produktifitas', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      { userId: 'U1', tipe: 'Cuti', waktu: '2026-08-28T09:00:00',
        tglMulai: '2026-09-01', tglSelesai: '2026-09-03', status: 'Approved' },
      absen('U1', 'Hadir', '2026-09-04'),
      absen('U1', 'Pulang', '2026-09-04')
    ] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.izin).toBe(3);
    expect(ani.hariEfektif).toBe(3);              // 6 hari kerja - 3 hari cuti
    expect(ani.lengkap).toBe(1);
    expect(Math.round(ani.persenProduktif)).toBe(33);
  });

  test('pengajuan yang ditolak tidak dihitung sebagai izin', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      { userId: 'U1', tipe: 'Cuti', waktu: '2026-08-28T09:00:00',
        tglMulai: '2026-09-01', tglSelesai: '2026-09-01', status: 'Rejected' }
    ] });
    expect(r.perOrang.find((b) => b.id === 'U1').izin).toBe(0);
  });

  test('baris milik orang di luar daftar kerani diabaikan', () => {
    const r = susunRekapKerani({ ...dasar, history: [absen('U9', 'Hadir', '2026-09-01')] });
    expect(r.ringkas.hadir).toBe(0);
  });

  test('baris pada hari Minggu tidak masuk hitungan selama Minggu bukan hari kerja', () => {
    const r = susunRekapKerani({ ...dasar, history: [absen('U1', 'Hadir', '2026-09-06')] });
    expect(r.ringkas.hadir).toBe(0);
  });

  test('empat persentase komposisi berjumlah 100', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Hadir', '2026-09-01'),
      absen('U2', 'Standby', '2026-09-01'),
      { userId: 'U2', tipe: 'Sakit', waktu: '2026-09-02T08:00:00',
        tglMulai: '2026-09-02', tglSelesai: '2026-09-02' }
    ] });
    const R = r.ringkas;
    const total = R.persenHadir + R.persenStandby + R.persenIzin + R.persenTidakAbsen;
    expect(Math.round(total)).toBe(100);
    expect(R.hadir + R.standby + R.izin + R.tidakAbsen).toBe(R.totalHariOrang);
  });

  test('rekap harian sejalan dengan rekap per orang', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Hadir', '2026-09-01'),
      absen('U2', 'Hadir', '2026-09-01')
    ] });
    const h = r.perHari.find((x) => x.tanggal === '2026-09-01');
    expect(h.hadir).toBe(2);
    expect(h.tidakAbsen).toBe(0);
  });

  test('urutan tabel menaruh produktifitas terendah di atas', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U2', 'Hadir', '2026-09-01'),
      absen('U2', 'Pulang', '2026-09-01')
    ] });
    expect(r.perOrang[0].id).toBe('U1');          // ANI 0%, BUDI lebih tinggi
  });

  test('tanpa hari kerja, persentase nol dan tidak NaN', () => {
    const r = susunRekapKerani({ ...dasar, dari: '2026-09-06', sampai: '2026-09-06', history: [] });
    expect(r.ringkas.hariKerja).toBe(0);
    expect(r.ringkas.persenProduktif).toBe(0);
    expect(Number.isNaN(r.ringkas.persenHadir)).toBe(false);
  });
});

describe('rincian per orang', () => {
  const { tanggalPerKolom, jamDari } = require('./rekapKerani');
  const dasar = { kerani: KERANI, dari: DARI, sampai: SAMPAI, libur: {} };

  test('jumlah tanggal per kolom sama dengan angka di tabel', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Hadir', '2026-09-01'), absen('U1', 'Pulang', '2026-09-01'),
      absen('U1', 'Hadir', '2026-09-02'),
      absen('U1', 'Standby', '2026-09-03'),
      absen('U1', 'Cuti', '2026-09-04', { tglMulai: '2026-09-04', tglSelesai: '2026-09-04', status: 'Approved' })
    ] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(tanggalPerKolom(ani, r.tanggal, 'hadir')).toEqual(['2026-09-01', '2026-09-02']);
    expect(tanggalPerKolom(ani, r.tanggal, 'lengkap')).toEqual(['2026-09-01']);
    expect(tanggalPerKolom(ani, r.tanggal, 'sebelah')).toEqual(['2026-09-02']);
    expect(tanggalPerKolom(ani, r.tanggal, 'standby').length).toBe(ani.standby);
    expect(tanggalPerKolom(ani, r.tanggal, 'izin').length).toBe(ani.izin);
    expect(tanggalPerKolom(ani, r.tanggal, 'tidak').length).toBe(ani.tidakAbsen);
    expect(tanggalPerKolom(ani, r.tanggal, 'semua').length).toBe(r.tanggal.length);
    expect(ani.barisPer['2026-09-01'].length).toBe(2);
  });

  test('baris ditolak tetap tersimpan untuk riwayat, tapi tidak dihitung', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      absen('U1', 'Sakit', '2026-09-01', { tglMulai: '2026-09-01', tglSelesai: '2026-09-01', status: 'Rejected' })
    ] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.sel['2026-09-01']).toBe(STATUS.KOSONG);
    expect(ani.barisPer['2026-09-01'].length).toBe(1);
  });

  test('jamDari membaca teks dd/MM/yyyy dan ISO tanpa zona', () => {
    expect(jamDari('01/09/2026 07:05:33')).toBe('07:05');
    expect(jamDari('2026-09-01T16:40:00')).toBe('16:40');
    expect(jamDari('')).toBe('');
  });
});

describe('zona waktu & hari off', () => {
  const { tanggalPerKolom, jamDari, tglLokal } = require('./rekapKerani');
  const dasar = { kerani: KERANI, dari: DARI, sampai: SAMPAI, libur: {} };

  test('ISO UTC dibaca sebagai tanggal & jam Jakarta', () => {
    // 2 Sep 06:48 WIB = 1 Sep 23:48 UTC
    expect(tglLokal('2026-09-01T23:48:00.000Z')).toBe('2026-09-02');
    expect(jamDari('2026-09-01T23:48:00.000Z')).toBe('06:48');
    // tanggal tanpa jam dari sheet (tengah malam WIB) = 17:00 UTC sehari sebelumnya
    expect(tglLokal('2026-09-01T17:00:00.000Z')).toBe('2026-09-02');
    expect(tglLokal('02/09/2026 06:48:00')).toBe('2026-09-02');
  });

  test('absen pagi tidak bergeser ke hari sebelumnya', () => {
    const r = susunRekapKerani({ ...dasar, history: [
      { userId: 'U1', tipe: 'Hadir', waktu: '2026-09-01T23:48:00.000Z', tglMulai: '-', tglSelesai: '-' }
    ] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.sel['2026-09-02']).toBe(STATUS.HADIR);
    expect(ani.sel['2026-09-01']).toBe(STATUS.KOSONG);
  });

  test('Minggu tidak dihitung, tapi absennya tetap terbaca', () => {
    const r = susunRekapKerani({ ...dasar, history: [absen('U1', 'Hadir', '2026-09-06'), absen('U1', 'Pulang', '2026-09-06')] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(r.tanggal).not.toContain('2026-09-06');
    expect(ani.hadir).toBe(0);
    expect(ani.hariOff['2026-09-06'].length).toBe(2);
    expect(tanggalPerKolom(ani, r.tanggal, 'off')).toEqual(['2026-09-06']);
    expect(tanggalPerKolom(ani, r.tanggal, 'semua')).toContain('2026-09-06');
    expect(tanggalPerKolom(ani, r.tanggal, 'tidak')).not.toContain('2026-09-06');
  });
});
