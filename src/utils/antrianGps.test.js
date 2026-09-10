import {
  simpanTitikAntrian, ambilAntrian, buangTerkirim, bersihkanAntrian,
  jumlahAntrian, ANTRIAN_MAKS, ANTRIAN_UMUR_MAKS_MS
} from './antrianGps';

const titik = (extra = {}) => ({
  userId: 'U1', waktu: Date.now(), lat: -6.2, lng: 106.8, akurasi: 12, baterai: 80, ...extra
});

beforeEach(() => { bersihkanAntrian(); });

describe('antrian GPS - penyimpanan dasar', () => {
  test('titik sah tersimpan dan bisa diambil kembali', () => {
    expect(simpanTitikAntrian(titik())).toBe(true);
    const hasil = ambilAntrian('U1');
    expect(hasil).toHaveLength(1);
    expect(hasil[0].lat).toBeCloseTo(-6.2);
    expect(hasil[0].id).toBeTruthy();
  });

  test('titik tanpa userId ditolak — tidak ada yang boleh terkirim tanpa pemilik', () => {
    expect(simpanTitikAntrian(titik({ userId: '' }))).toBe(false);
    expect(jumlahAntrian('U1')).toBe(0);
  });

  test('koordinat di luar rentang ditolak', () => {
    expect(simpanTitikAntrian(titik({ lat: 91 }))).toBe(false);
    expect(simpanTitikAntrian(titik({ lng: 999 }))).toBe(false);
    expect(simpanTitikAntrian(titik({ lat: 'abc' }))).toBe(false);
    expect(jumlahAntrian('U1')).toBe(0);
  });

  test('akurasi/baterai yang tidak ada disimpan sebagai null, bukan NaN', () => {
    simpanTitikAntrian({ userId: 'U1', lat: -6.2, lng: 106.8 });
    const [t] = ambilAntrian('U1');
    expect(t.akurasi).toBeNull();
    expect(t.baterai).toBeNull();
    expect(JSON.stringify(t)).toContain('"akurasi":null');
  });
});

describe('antrian GPS - pemisahan antar karyawan', () => {
  test('titik milik user lain tidak pernah ikut terambil', () => {
    simpanTitikAntrian(titik({ userId: 'U1' }));
    simpanTitikAntrian(titik({ userId: 'U2' }));
    expect(ambilAntrian('U1')).toHaveLength(1);
    expect(ambilAntrian('U2')).toHaveLength(1);
    expect(ambilAntrian('U1')[0].userId).toBe('U1');
  });

  test('bersihkanAntrian membuang milik semua user', () => {
    simpanTitikAntrian(titik({ userId: 'U1' }));
    simpanTitikAntrian(titik({ userId: 'U2' }));
    bersihkanAntrian();
    expect(jumlahAntrian('U1')).toBe(0);
    expect(jumlahAntrian('U2')).toBe(0);
  });
});

describe('antrian GPS - batas dan kedaluwarsa', () => {
  test('tidak pernah melebihi ANTRIAN_MAKS, yang dibuang adalah yang tertua', () => {
    const awal = Date.now() - 60000;
    for (let i = 0; i < ANTRIAN_MAKS + 25; i += 1) {
      simpanTitikAntrian(titik({ waktu: awal + i * 100, lat: -6.2 + i / 100000 }));
    }
    expect(jumlahAntrian('U1')).toBe(ANTRIAN_MAKS);
    const semua = ambilAntrian('U1', ANTRIAN_MAKS);
    // Titik paling awal (i = 0..24) sudah terbuang.
    expect(semua[0].waktu).toBe(awal + 25 * 100);
  });

  test('titik lebih tua dari 12 jam dibuang saat diambil', () => {
    simpanTitikAntrian(titik({ waktu: Date.now() - 60000 }));
    // Titik basi disuntikkan langsung: simpanTitikAntrian memang menolaknya.
    const isi = JSON.parse(localStorage.getItem('gps_antrian_v1'));
    isi.push({
      id: 'basi', userId: 'U1', waktu: Date.now() - ANTRIAN_UMUR_MAKS_MS - 1000,
      lat: -6.2, lng: 106.8, akurasi: 10, baterai: 50, sumber: 'periodik'
    });
    localStorage.setItem('gps_antrian_v1', JSON.stringify(isi));

    const hasil = ambilAntrian('U1');
    expect(hasil).toHaveLength(1);
    expect(hasil.find((t) => t.id === 'basi')).toBeUndefined();
    // Sudah ikut terhapus dari penyimpanan, bukan sekadar tersaring.
    expect(JSON.parse(localStorage.getItem('gps_antrian_v1'))).toHaveLength(1);
  });

  test('batas batch membatasi jumlah yang diambil, urut dari yang paling lama', () => {
    const awal = Date.now() - 60000;
    for (let i = 0; i < 10; i += 1) simpanTitikAntrian(titik({ waktu: awal + i * 1000 }));
    const hasil = ambilAntrian('U1', 3);
    expect(hasil).toHaveLength(3);
    expect(hasil[0].waktu).toBe(awal);
    expect(hasil[2].waktu).toBe(awal + 2000);
  });
});

describe('antrian GPS - pembuangan setelah terkirim', () => {
  test('hanya id yang disebut yang dibuang', () => {
    for (let i = 0; i < 3; i += 1) simpanTitikAntrian(titik({ waktu: Date.now() - i * 1000 }));
    const semua = ambilAntrian('U1');
    buangTerkirim([semua[0].id, semua[1].id]);
    const sisa = ambilAntrian('U1');
    expect(sisa).toHaveLength(1);
    expect(sisa[0].id).toBe(semua[2].id);
  });

  test('daftar kosong tidak mengubah apa pun (kegagalan kirim tidak boleh menghapus)', () => {
    simpanTitikAntrian(titik());
    buangTerkirim([]);
    buangTerkirim(null);
    expect(jumlahAntrian('U1')).toBe(1);
  });
});

describe('antrian GPS - localStorage bermasalah', () => {
  test('penulisan yang selalu gagal (mode privat) tidak melempar', () => {
    const asli = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); };
    expect(() => simpanTitikAntrian(titik())).not.toThrow();
    expect(simpanTitikAntrian(titik())).toBe(false);
    Storage.prototype.setItem = asli;
  });

  test('isi penyimpanan yang rusak dianggap antrian kosong', () => {
    localStorage.setItem('gps_antrian_v1', '{bukan json');
    expect(ambilAntrian('U1')).toEqual([]);
    expect(simpanTitikAntrian(titik())).toBe(true);
    expect(jumlahAntrian('U1')).toBe(1);
  });
});
