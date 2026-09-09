import { periksaStreamDepan, POLA_BELAKANG, POLA_DEPAN } from './kameraDepan';

const streamPalsu = (settings, label) => ({
  getVideoTracks: () => [{
    label,
    getSettings: () => settings,
  }],
});

describe('periksaStreamDepan', () => {
  test('menerima stream dengan facingMode user', () => {
    const hasil = periksaStreamDepan(streamPalsu({ facingMode: 'user' }, 'FaceTime HD Camera'));
    expect(hasil.ok).toBe(true);
    expect(hasil.dikenali).toBe(true);
  });

  test('menolak stream dengan facingMode environment', () => {
    const hasil = periksaStreamDepan(streamPalsu({ facingMode: 'environment' }, 'camera2 0, facing back'));
    expect(hasil.ok).toBe(false);
  });

  test('menolak berdasarkan label ketika facingMode tidak dilaporkan', () => {
    expect(periksaStreamDepan(streamPalsu({}, 'camera2 0, facing back')).ok).toBe(false);
    expect(periksaStreamDepan(streamPalsu({}, 'Back Ultra Wide Camera')).ok).toBe(false);
    expect(periksaStreamDepan(streamPalsu({}, 'Kamera Belakang')).ok).toBe(false);
  });

  test('menerima berdasarkan label depan ketika facingMode kosong', () => {
    const hasil = periksaStreamDepan(streamPalsu({}, 'Front Camera'));
    expect(hasil.ok).toBe(true);
    expect(hasil.facing).toBe('user');
  });

  test('kamera tak dikenal diteruskan tetapi ditandai', () => {
    const hasil = periksaStreamDepan(streamPalsu({}, 'USB Video Device'));
    expect(hasil.ok).toBe(true);
    expect(hasil.dikenali).toBe(false);
  });

  test('stream tanpa track video ditolak', () => {
    expect(periksaStreamDepan({ getVideoTracks: () => [] }).ok).toBe(false);
    expect(periksaStreamDepan(null).ok).toBe(false);
  });

  test('pola label', () => {
    expect(POLA_BELAKANG.test('camera2 0, facing back')).toBe(true);
    expect(POLA_DEPAN.test('camera2 1, facing front')).toBe(true);
    expect(POLA_BELAKANG.test('FaceTime HD Camera')).toBe(false);
  });
});
