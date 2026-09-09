import { bandingkanVersi } from './pembaruan';

describe('bandingkanVersi', () => {
  test('mendeteksi versi server lebih baru', () => {
    expect(bandingkanVersi('1.0.17', '1.0.16')).toBeGreaterThan(0);
    expect(bandingkanVersi('1.1.0', '1.0.99')).toBeGreaterThan(0);
    expect(bandingkanVersi('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  test('mendeteksi versi sama', () => {
    expect(bandingkanVersi('1.0.17', '1.0.17')).toBe(0);
    expect(bandingkanVersi('1.0', '1.0.0')).toBe(0);
  });

  test('mendeteksi versi server lebih lama', () => {
    expect(bandingkanVersi('1.0.15', '1.0.16')).toBeLessThan(0);
    expect(bandingkanVersi('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  test('tidak membandingkan sebagai teks (1.0.9 vs 1.0.10)', () => {
    expect(bandingkanVersi('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });

  test('nilai kosong dianggap 0.0.0', () => {
    expect(bandingkanVersi('', '1.0.0')).toBeLessThan(0);
    expect(bandingkanVersi(undefined, undefined)).toBe(0);
  });
});
