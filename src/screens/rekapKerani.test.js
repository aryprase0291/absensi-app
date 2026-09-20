import {
  rentangTanggal, hariMinggu, hariKerja, saringKerani, daftarDivisi,
  tanggalBaris, susunRekapKerani, STATUS
} from './rekapKerani';

// 1–7 Sep 2026: Sel Rab Kam Jum Sab Min Sen.
// (2026-09-06 adalah hari Minggu — dipakai berulang di bawah.)
const DARI = '2026-09-01';
const SAMPAI = '2026-09-07';

const KERANI = [
  { id: 'U1', nama: 'ANI', divisi: 'PABRIK A', jabatan: 'KERANI PABRIK' },
  { id: 'U2', nama: 'BUDI', divisi: 'PABRIK A', jabatan: 'Kerani Timbang' }
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
    { id: 'U3', nama: 'CITRA', divisi: 'KANTOR', jabatan: 'KERANI KANTOR' },
    { id: 'U4', nama: 'DEDI', divisi: 'PABRIK A', jabatan: 'Mandor' }
  ]);

  test('kata kunci tidak peduli besar-kecil huruf', () => {
    const h = saringKerani(orang, 'kerani', []);
    expect(h.map((x) => x.id)).toEqual(['U1', 'U2', 'U3']);
  });

  test('daftar divisi kosong berarti SEMUA divisi, bukan nol', () => {
    expect(saringKerani(orang, 'KERANI', [])).toHaveLength(3);
  });

  test('divisi mempersempit hasil', () => {
    const h = saringKerani(orang, 'KERANI', ['PABRIK A']);
    expect(h.map((x) => x.id)).toEqual(['U1', 'U2']);
  });

  test('daftarDivisi unik dan terurut, melewati tanda strip', () => {
    expect(daftarDivisi(orang.concat([{ id: 'U5', divisi: '-' }])))
      .toEqual(['KANTOR', 'PABRIK A']);
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

  test('Pulang tanpa Hadir tidak menjadikan hari itu hadir', () => {
    const r = susunRekapKerani({ ...dasar, history: [absen('U1', 'Pulang', '2026-09-01')] });
    const ani = r.perOrang.find((b) => b.id === 'U1');
    expect(ani.sel['2026-09-01']).toBe(STATUS.KOSONG);
    expect(ani.lengkap).toBe(0);
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
