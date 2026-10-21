import { mulaiSiklusStandar, batasPengajuanMundur, pesanKunciPeriode } from './kunciPeriode';

describe('kunciPeriode', () => {
  test('siklus standar 21–20', () => {
    expect(mulaiSiklusStandar('2026-10-21')).toBe('2026-10-21');
    expect(mulaiSiklusStandar('2026-10-20')).toBe('2026-09-21');
    expect(mulaiSiklusStandar('2026-01-05')).toBe('2025-12-21');
  });

  test('contoh kasus: periode 21 Sep–20 Okt, hari ini 21 Okt', () => {
    const aktif = [
      { mulai: '2026-09-21', selesai: '2026-10-20' },
      { mulai: '2026-10-21', selesai: '2026-11-20' },
    ];
    const batas = batasPengajuanMundur(aktif, '2026-10-21');
    expect(batas).toBe('2026-10-21');
    expect(pesanKunciPeriode(['2026-10-20'], batas)).toMatch(/sudah ditutup/);
    expect(pesanKunciPeriode(['2026-10-21', '2026-10-25'], batas)).toBe('');
  });

  test('masih di periode berjalan: mundur dalam periode yang sama boleh', () => {
    const aktif = [{ mulai: '2026-09-21', selesai: '2026-10-20' }];
    const batas = batasPengajuanMundur(aktif, '2026-10-20');
    expect(pesanKunciPeriode(['2026-09-25'], batas)).toBe('');
    expect(pesanKunciPeriode(['2026-09-20'], batas)).toMatch(/sudah ditutup/);
  });

  test('admin belum membuat periode bulan ini -> pakai siklus standar', () => {
    const aktif = [{ mulai: '2026-09-21', selesai: '2026-10-20' }];
    expect(batasPengajuanMundur(aktif, '2026-10-22')).toBe('2026-10-21');
  });

  test('periode kustom 1–31 dihormati', () => {
    const aktif = [{ mulai: '2026-10-01', selesai: '2026-10-31' }];
    expect(batasPengajuanMundur(aktif, '2026-10-21')).toBe('2026-10-01');
  });

  test('daftar periode belum diketahui -> tidak mengunci', () => {
    expect(batasPengajuanMundur(null, '2026-10-21')).toBe('');
    expect(pesanKunciPeriode(['2020-01-01'], '')).toBe('');
  });
});
