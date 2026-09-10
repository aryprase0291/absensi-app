import { getVerifiedGeolocation, validateGpsPosition } from './antiFakeGps';

// Batas waktu pengambilan sampel dipendekkan agar uji tidak menunggu
// detik sungguhan. Nilai produksinya 3500/1200 ms.
const UJI = { sampelBudgetMs: 300, sampelGraceMs: 120 };

// Koordinat asli Surabaya dengan 6 desimal — presisi yang wajar untuk GPS.
const LAT = -7.257520;
const LNG = 112.752100;

const buatPos = (lat, lng, akurasi, ts, extra = {}) => ({
  coords: { latitude: lat, longitude: lng, accuracy: akurasi, ...extra },
  timestamp: ts
});

/**
 * @param {Array} fixTambahan urutan fix yang dikirim watchPosition
 * @param {Object} opsi { gagalWatch, tanpaWatch, tolakPertama }
 */
function pasangGeolocation(pertama, fixTambahan = [], opsi = {}) {
  const geo = {
    getCurrentPosition: (ok, gagal) => {
      if (opsi.tolakPertama) return setTimeout(() => gagal(opsi.tolakPertama), 0);
      setTimeout(() => ok(pertama), 0);
    },
    clearWatch: jest.fn()
  };
  if (!opsi.tanpaWatch) {
    geo.watchPosition = (ok, gagal) => {
      if (opsi.gagalWatch) { setTimeout(() => gagal({ code: 3 }), 0); return 7; }
      fixTambahan.forEach((f, i) => setTimeout(() => ok(f), i + 1));
      return 7;
    };
  }
  Object.defineProperty(global.navigator, 'geolocation', { value: geo, configurable: true, writable: true });
  return geo;
}

beforeEach(() => { localStorage.clear(); });

describe('validateGpsPosition — sinyal keras', () => {
  test('koordinat wajar tidak dianggap mencurigakan', () => {
    const v = validateGpsPosition(buatPos(LAT, LNG, 6, Date.now()));
    expect(v.isSuspicious).toBe(false);
    expect(v.accuracy).toBe(6);
  });

  test('flag Mock Location dari sistem tetap menjadi vonis', () => {
    const v = validateGpsPosition(buatPos(LAT, LNG, 6, Date.now(), { isMock: true }));
    expect(v.isSuspicious).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/Mock Location/i);
  });

  test('Null Island, akurasi 0, dan presisi rendah tetap ditangkap', () => {
    expect(validateGpsPosition(buatPos(0, 0, 6, Date.now())).isSuspicious).toBe(true);
    expect(validateGpsPosition(buatPos(LAT, LNG, 0, Date.now())).isSuspicious).toBe(true);
    expect(validateGpsPosition(buatPos(-7.25, 112.75, 6, Date.now())).isSuspicious).toBe(true);
  });
});

describe('getVerifiedGeolocation — fix yang sama tidak boleh dihitung sebagai dua pembacaan', () => {
  test('timestamp identik: jitter null, bukan nol, dan tidak ada tuduhan', async () => {
    const ts = Date.now();
    const fix = buatPos(LAT, LNG, 6, ts);
    // Browser mengirim ulang fix yang sama persis tiga kali — inilah
    // penyebab salah tuduh yang dilaporkan 10 Sep 2026.
    pasangGeolocation(fix, [buatPos(LAT, LNG, 6, ts), buatPos(LAT, LNG, 6, ts)]);

    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.bukti.sampelBerbeda).toBe(1);
    expect(hasil.bukti.fixTerulang).toBe(2);
    expect(hasil.bukti.jitterMeter).toBeNull();
    expect(hasil.bukti.jitterNol).toBe(false);
    expect(hasil.isMockSuspicious).toBe(false);
    expect(hasil.warning).toBeFalsy();
  });

  test('watchPosition gagal: hanya satu fix, tetap tanpa tuduhan', async () => {
    pasangGeolocation(buatPos(LAT, LNG, 8, Date.now()), [], { gagalWatch: true });
    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.bukti.sampelBerbeda).toBe(1);
    expect(hasil.bukti.jitterMeter).toBeNull();
    expect(hasil.isMockSuspicious).toBe(false);
  });

  test('browser tanpa watchPosition tetap menghasilkan koordinat', async () => {
    pasangGeolocation(buatPos(LAT, LNG, 9, Date.now()), [], { tanpaWatch: true });
    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.lat).toBeCloseTo(LAT);
    expect(hasil.bukti.sampelBerbeda).toBe(1);
    expect(hasil.bukti.jitterMeter).toBeNull();
  });
});

describe('getVerifiedGeolocation — jitter pada fix yang benar-benar berbeda', () => {
  test('koordinat identik pada 3 fix berbeda: dicatat sebagai bukti, BUKAN vonis', async () => {
    const ts = Date.now();
    pasangGeolocation(
      buatPos(LAT, LNG, 6, ts),
      [buatPos(LAT, LNG, 6, ts + 1000), buatPos(LAT, LNG, 6, ts + 2000)]
    );

    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.bukti.sampelBerbeda).toBe(3);
    expect(hasil.bukti.jitterMeter).toBe(0);
    expect(hasil.bukti.jitterNol).toBe(true);
    // Inti perbaikan 10 Sep 2026: badge merah tidak menyala karena ini.
    expect(hasil.isMockSuspicious).toBe(false);
    expect(hasil.bukti.alasanClient.join(' ')).toMatch(/bukan tuduhan/i);
  });

  test('perangkat bergeser: jitter terukur lebih dari nol', async () => {
    const ts = Date.now();
    pasangGeolocation(
      buatPos(LAT, LNG, 6, ts),
      [buatPos(LAT + 0.000045, LNG, 6, ts + 1000)]
    );
    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.bukti.sampelBerbeda).toBe(2);
    expect(hasil.bukti.jitterMeter).toBeGreaterThan(1);
    expect(hasil.bukti.jitterNol).toBe(false);
    expect(hasil.isMockSuspicious).toBe(false);
  });

  test('jitter nol TIDAK menutupi flag mock sistem — itu tetap vonis', async () => {
    const ts = Date.now();
    pasangGeolocation(
      buatPos(LAT, LNG, 6, ts, { isMock: true }),
      [buatPos(LAT, LNG, 6, ts + 1000, { isMock: true })]
    );
    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.isMockSuspicious).toBe(true);
    expect(hasil.bukti.mockFlag).toBe(true);
  });

  test('koordinat resmi diambil dari fix terbaru', async () => {
    const ts = Date.now();
    pasangGeolocation(
      buatPos(LAT, LNG, 20, ts),
      [buatPos(LAT + 0.001, LNG + 0.001, 7, ts + 1500)]
    );
    const hasil = await getVerifiedGeolocation(UJI);
    expect(hasil.lat).toBeCloseTo(LAT + 0.001, 6);
    expect(hasil.accuracy).toBe(7);
    expect(hasil.bukti.akurasi1).toBe(20);
    expect(hasil.bukti.akurasi2).toBe(7);
  });
});

describe('getVerifiedGeolocation — kegagalan pembacaan pertama', () => {
  test('izin ditolak menghasilkan pesan yang bisa ditindaklanjuti', async () => {
    pasangGeolocation(null, [], { tolakPertama: { code: 1 } });
    await expect(getVerifiedGeolocation(UJI)).rejects.toThrow(/Izin akses lokasi/i);
  });

  test('timeout dibedakan dari izin ditolak', async () => {
    pasangGeolocation(null, [], { tolakPertama: { code: 3 } });
    await expect(getVerifiedGeolocation(UJI)).rejects.toThrow(/timeout/i);
  });
});
