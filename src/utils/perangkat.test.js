import { ambilDeviceId, sidikPerangkat, labelPerangkat, lupakanDeviceId } from './perangkat';

// jsdom sudah menyediakan localStorage, navigator, dan screen.
// Yang diuji di sini adalah tiga sifat yang KALAU RUSAK tidak akan
// terlihat sebagai error, hanya sebagai "penguncian perangkat tidak jalan":
//   1. ID harus stabil antar-pemanggilan;
//   2. ID yang sudah tersimpan TIDAK BOLEH ditulis ulang — menulis ulang
//      berarti memutus ikatan perangkat yang sudah tercatat di server;
//   3. awalan 8 karakter harus sama dengan sidik perangkat, karena itulah
//      yang dipakai Panel Admin untuk mengenali localStorage yang dibersihkan.

describe('ambilDeviceId', () => {
  beforeEach(() => {
    localStorage.clear();
    lupakanDeviceId();
  });

  test('mengembalikan nilai yang sama pada pemanggilan berulang', () => {
    const a = ambilDeviceId();
    const b = ambilDeviceId();
    expect(a).toBe(b);
  });

  test('menyimpan ID ke localStorage', () => {
    const id = ambilDeviceId();
    expect(localStorage.getItem('absen_device_id')).toBe(id);
  });

  test('berbentuk <8 hex>-<hex>', () => {
    expect(ambilDeviceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{20}$/);
  });

  test('awalannya adalah sidik perangkat', () => {
    expect(ambilDeviceId().split('-')[0]).toBe(sidikPerangkat());
  });

  test('tidak menimpa ID sah yang sudah tersimpan', () => {
    const lama = 'abcdef12-0123456789abcdef0123';
    localStorage.setItem('absen_device_id', lama);
    expect(ambilDeviceId()).toBe(lama);
    expect(localStorage.getItem('absen_device_id')).toBe(lama);
  });

  test('mengganti nilai tersimpan yang bentuknya tidak sah', () => {
    localStorage.setItem('absen_device_id', 'bukan-id-yang-benar');
    const id = ambilDeviceId();
    expect(id).not.toBe('bukan-id-yang-benar');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{20}$/);
  });
});

describe('sidikPerangkat', () => {
  test('selalu 8 karakter heksadesimal', () => {
    expect(sidikPerangkat()).toMatch(/^[0-9a-f]{8}$/);
  });

  test('stabil selama properti perangkat tidak berubah', () => {
    expect(sidikPerangkat()).toBe(sidikPerangkat());
  });
});

describe('labelPerangkat', () => {
  const uaAsli = navigator.userAgent;
  const setUA = (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  afterAll(() => setUA(uaAsli));

  test('mengenali Android + Chrome', () => {
    setUA('Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    expect(labelPerangkat()).toBe('Android · Chrome');
  });

  test('mengenali iPhone + Safari', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    expect(labelPerangkat()).toBe('iPhone · Safari');
  });

  // Ini yang paling mudah salah: UA WebView aplikasi lain MEMUAT kata
  // "Chrome" dan "Safari" sekaligus. Kalau urutan pemeriksaannya terbalik,
  // semua absen dari WhatsApp/Instagram akan tercatat sebagai "Chrome" —
  // padahal justru WebView itulah yang dulu meloloskan kamera belakang.
  test('WebView aplikasi lain tidak tertukar dengan Chrome', () => {
    setUA('Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/id_ID]');
    expect(labelPerangkat()).toBe('Android · Facebook');
  });
});
