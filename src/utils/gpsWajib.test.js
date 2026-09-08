/**
 * UJI GERBANG GPS WAJIB
 *
 * Jalankan:  CI=true npx react-scripts test --testPathPattern gpsWajib
 *
 * KENAPA ADA: gerbang ini menahan SELURUH aplikasi. Satu kesalahan kecil
 * di sini berarti karyawan tidak bisa absen sama sekali — kegagalan yang
 * jauh lebih mahal daripada fitur GPS-nya sendiri. Yang dijaga terutama
 * dua hal yang mudah rusak tanpa terasa: percobaan kedua dengan akurasi
 * rendah (penyelamat karyawan di dalam gedung), dan izin ditolak yang
 * TIDAK boleh dicoba ulang.
 */

import { periksaGpsWajib, izinSudahDiberikan, tandaiIzinPernahOk, lupakanIzin, GPS_STATUS } from './gpsWajib';

const posisiPalsu = {
  coords: { latitude: -7.2575, longitude: 112.7521, accuracy: 18 }
};

function pasangGeolocation(urutanJawaban) {
  const panggilan = [];
  global.navigator.geolocation = {
    getCurrentPosition: (sukses, gagal, opsi) => {
      panggilan.push(opsi);
      const jawab = urutanJawaban[panggilan.length - 1];
      // setTimeout supaya alurnya benar-benar asinkron seperti browser.
      setTimeout(() => {
        if (jawab && jawab.ok) sukses(posisiPalsu);
        else gagal({ code: jawab ? jawab.code : 2 });
      }, 0);
    }
  };
  return panggilan;
}

beforeEach(() => {
  delete global.navigator.geolocation;
  delete global.navigator.permissions;
  localStorage.clear();
  // jsdom berjalan di http://localhost -> dihitung aman oleh gerbang.
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

test('halaman non-HTTPS ditolak sebelum menyentuh Geolocation', async () => {
  Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
  const asli = window.location.hostname;
  delete window.location;
  window.location = { protocol: 'http:', hostname: 'absensi.contoh.co.id' };

  const hasil = await periksaGpsWajib();
  expect(hasil.status).toBe(GPS_STATUS.TIDAK_AMAN);

  window.location = { protocol: 'http:', hostname: asli };
});

test('browser tanpa Geolocation dilaporkan terpisah, bukan sebagai izin ditolak', async () => {
  const hasil = await periksaGpsWajib();
  expect(hasil.status).toBe(GPS_STATUS.TIDAK_DIDUKUNG);
});

test('posisi didapat pada percobaan pertama -> lolos', async () => {
  const panggilan = pasangGeolocation([{ ok: true }]);
  const hasil = await periksaGpsWajib();

  expect(hasil.status).toBe(GPS_STATUS.OK);
  expect(hasil.posisi.lat).toBeCloseTo(-7.2575);
  expect(panggilan).toHaveLength(1);
  expect(panggilan[0].enableHighAccuracy).toBe(true);
});

test('izin ditolak TIDAK dicoba ulang', async () => {
  const panggilan = pasangGeolocation([{ code: 1 }, { ok: true }]);
  const hasil = await periksaGpsWajib();

  expect(hasil.status).toBe(GPS_STATUS.DITOLAK);
  // Kalau angka ini pernah menjadi 2, artinya percobaan kedua ikut jalan
  // dan karyawan yang menolak izin akan melihat dua dialog beruntun.
  expect(panggilan).toHaveLength(1);
});

test('timeout GPS presisi tinggi diselamatkan lokasi jaringan (kasus dalam gedung)', async () => {
  const panggilan = pasangGeolocation([{ code: 3 }, { ok: true }]);
  const hasil = await periksaGpsWajib();

  expect(hasil.status).toBe(GPS_STATUS.OK);
  expect(panggilan).toHaveLength(2);
  expect(panggilan[1].enableHighAccuracy).toBe(false);
});

test('layanan lokasi perangkat mati -> ditahan di gerbang', async () => {
  const panggilan = pasangGeolocation([{ code: 2 }, { code: 2 }]);
  const hasil = await periksaGpsWajib();

  expect(hasil.status).toBe(GPS_STATUS.PERANGKAT_MATI);
  expect(panggilan).toHaveLength(2);
});

test('izin ditolak pada percobaan kedua tetap dilaporkan sebagai ditolak', async () => {
  pasangGeolocation([{ code: 3 }, { code: 1 }]);
  const hasil = await periksaGpsWajib();
  expect(hasil.status).toBe(GPS_STATUS.DITOLAK);
});


// =====================================================================
// INGATAN IZIN — "sudah pernah allow, jangan tanya lagi"
// =====================================================================

function pasangPermissions(state) {
  global.navigator.permissions = { query: () => Promise.resolve({ state }) };
}

test('izin granted -> aplikasi boleh langsung dibuka tanpa gerbang', async () => {
  pasangPermissions('granted');
  await expect(izinSudahDiberikan()).resolves.toBe(true);
});

test('izin prompt -> tetap lewat gerbang (browser masih akan bertanya)', async () => {
  pasangPermissions('prompt');
  await expect(izinSudahDiberikan()).resolves.toBe(false);
});

test('izin denied -> lewat gerbang, dan ingatan lama ikut dibuang', async () => {
  tandaiIzinPernahOk();
  pasangPermissions('denied');

  await expect(izinSudahDiberikan()).resolves.toBe(false);
  // Kalau ingatan tidak dibuang, aplikasi akan terus membuka menu lebih
  // dulu lalu menabrak gerbang — kedipan yang persis ingin dihindari.
  expect(localStorage.getItem('gps_izin_pernah_ok')).toBeNull();
});

test('tanpa Permissions API (Safari iOS): catatan lokal yang dipakai', async () => {
  await expect(izinSudahDiberikan()).resolves.toBe(false);
  tandaiIzinPernahOk();
  await expect(izinSudahDiberikan()).resolves.toBe(true);
});

test('catatan lokal kedaluwarsa setelah 60 hari', async () => {
  const enamPuluhSatuHari = Date.now() - 61 * 24 * 3600 * 1000;
  localStorage.setItem('gps_izin_pernah_ok', String(enamPuluhSatuHari));
  await expect(izinSudahDiberikan()).resolves.toBe(false);
});

test('lupakanIzin membersihkan catatan', async () => {
  tandaiIzinPernahOk();
  lupakanIzin();
  await expect(izinSudahDiberikan()).resolves.toBe(false);
});

test('mode diam memakai pembacaan terakhir, bukan menyalakan GPS presisi tinggi', async () => {
  const panggilan = pasangGeolocation([{ ok: true }]);
  const hasil = await periksaGpsWajib({ diam: true });

  expect(hasil.status).toBe(GPS_STATUS.OK);
  expect(panggilan[0].enableHighAccuracy).toBe(false);
  expect(panggilan[0].maximumAge).toBeGreaterThan(0);
});
