// =====================================================================
// PELACAK POSISI KARYAWAN (SISI KLIEN)
//
// Mengirim satu titik posisi ke backend secara berkala selama aplikasi
// terbuka, plus satu titik setiap kali karyawan berhasil absen.
//
// EMPAT BATASAN YANG HARUS DIPAHAMI SEBELUM MENGUBAH FILE INI
//
// 1. Browser TIDAK BISA melacak saat aplikasi ditutup. Tidak ada
//    pekerjaan latar belakang yang diizinkan untuk itu di web. Yang
//    tercatat adalah posisi selama aplikasi dibuka — dan itu memang
//    batas jujur dari fitur ini.
//
// 2. Aplikasi ini melakukan auto-logout setelah tidak ada aktivitas
//    (lihat TIMEOUT_DURATION di config/constants.js). Sesi yang berakhir
//    ikut menghentikan pelacakan. Untuk karyawan lapangan, perpanjang
//    lewat REACT_APP_TIMEOUT_MINUTES — JANGAN mematikan auto-logout-nya.
//
// 3. Tab yang tidak terlihat (layar terkunci, pindah aplikasi) di-throttle
//    berat oleh browser. Karena itu jadwal dibuat dengan rantai setTimeout
//    yang selalu memeriksa waktu nyata, bukan setInterval yang berasumsi
//    setiap centangnya tepat waktu.
//
// 4. Kegagalan pelacakan TIDAK BOLEH mengganggu apa pun. Izin ditolak,
//    GPS mati, server sibuk — semuanya berakhir diam-diam di sini.
//    Absensi adalah fitur utama aplikasi ini; pelacakan hanya tambahan.
// =====================================================================

import { ambilSidikPerangkat } from './antiFakeGps';

const INTERVAL_BAWAAN_MS = 5 * 60 * 1000;
const TIMEOUT_GPS_MS = 15000;
const JEDA_GAGAL_MAKS_MS = 15 * 60 * 1000;

const bacaPosisiSekali = (opsi) =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opsi);
  });

// Persentase baterai dipakai admin untuk membedakan "karyawan tidak
// bergerak" dari "HP-nya mati". API-nya tidak ada di semua browser
// (Safari iOS tidak punya), jadi selalu opsional.
const bacaBaterai = async () => {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return Math.round((b.level || 0) * 100);
  } catch (e) {
    return null;
  }
};

/**
 * Mengirim SATU titik posisi. Dipakai pelacak berkala di bawah, dan juga
 * dipanggil langsung setelah absen berhasil (sumber: 'absen').
 *
 * Selalu resolve — tidak pernah melempar — supaya pemanggilnya tidak
 * perlu membungkus dengan try/catch hanya untuk fitur tambahan.
 */
export async function kirimTitikGps({ fetchApi, scriptUrl, user, sumber = 'periodik', posisi = null }) {
  try {
    if (!user || !user.id) return { ok: false, alasan: 'tanpa-user' };
    if (!('geolocation' in navigator)) return { ok: false, alasan: 'tanpa-geolocation' };

    let coords = posisi;
    if (!coords) {
      const pos = await bacaPosisiSekali({
        enableHighAccuracy: true,
        timeout: TIMEOUT_GPS_MS,
        // 30 detik: cukup segar untuk pemantauan, tapi masih boleh memakai
        // pembacaan terakhir supaya radio GPS tidak dinyalakan terus-menerus.
        maximumAge: 30000
      });
      coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        akurasi: pos.coords.accuracy
      };
    }

    const baterai = await bacaBaterai();
    let bukti = null;
    try {
      const p = ambilSidikPerangkat();
      bukti = { deviceId: p.deviceId, platform: p.platform };
    } catch (e) { /* sidik perangkat opsional */ }

    const res = await fetchApi(scriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'track_gps_ping',
        userId: user.id,
        nama: user.nama,
        lat: coords.lat,
        lng: coords.lng,
        akurasi: coords.akurasi,
        sumber,
        baterai,
        gpsBukti: bukti
      })
    });
    const data = await res.json();
    if (data.result !== 'success') return { ok: false, alasan: data.code || data.message || 'ditolak-server' };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, alasan: e && e.code === 1 ? 'izin-ditolak' : 'gagal' };
  }
}

/**
 * Menyalakan pelacakan berkala. Kembaliannya adalah fungsi penghenti —
 * WAJIB dipanggil saat logout / unmount, kalau tidak timernya tetap
 * hidup dan menembak dengan token milik user sebelumnya.
 *
 * @param {Function} onStatus dipanggil setiap status berubah, untuk
 *        indikator di layar: { aktif, izinDitolak, terakhir, pesan }
 */
export function mulaiPelacakGps({ fetchApi, scriptUrl, user, onStatus }) {
  let hidup = true;
  let timer = null;
  let intervalMs = INTERVAL_BAWAAN_MS;
  let gagalBerturut = 0;
  let terakhirKirimMs = 0;
  let dilacak = false;

  const kabar = (isi) => { try { if (onStatus) onStatus(isi); } catch (e) { /* abaikan */ } };

  const jadwalkan = (jedaMs) => {
    if (!hidup) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(siklus, Math.max(jedaMs, 15000));
  };

  const siklus = async () => {
    if (!hidup) return;

    // Tab tersembunyi: jangan paksa radio GPS menyala. Titik berikutnya
    // dikirim segera setelah karyawan membuka aplikasinya lagi.
    if (typeof document !== 'undefined' && document.hidden) {
      jadwalkan(intervalMs);
      return;
    }

    const hasil = await kirimTitikGps({ fetchApi, scriptUrl, user, sumber: 'periodik' });

    if (hasil.ok) {
      gagalBerturut = 0;
      terakhirKirimMs = Date.now();
      if (hasil.data && hasil.data.intervalDetik) {
        intervalMs = Math.max(Number(hasil.data.intervalDetik) * 1000, 60000);
      }
      // Admin bisa mematikan pelacakan seseorang di tengah hari kerja.
      if (hasil.data && hasil.data.dilacak === false) {
        dilacak = false;
        kabar({ aktif: false, izinDitolak: false, terakhir: terakhirKirimMs, pesan: '' });
        hentikan();
        return;
      }
      kabar({
        aktif: true,
        izinDitolak: false,
        terakhir: terakhirKirimMs,
        pesan: (hasil.data && hasil.data.statusArea) || ''
      });
      jadwalkan(intervalMs);
      return;
    }

    if (hasil.alasan === 'izin-ditolak') {
      // Menembak ulang tidak akan mengubah apa pun sampai karyawan
      // sendiri mengubah izin lokasinya di browser.
      kabar({ aktif: false, izinDitolak: true, terakhir: terakhirKirimMs, pesan: 'Izin lokasi ditolak.' });
      hentikan();
      return;
    }

    // Mundur bertahap: jaringan buruk atau Apps Script sedang sibuk
    // tidak boleh berubah menjadi banjir request.
    gagalBerturut += 1;
    const mundur = Math.min(intervalMs * Math.pow(2, Math.min(gagalBerturut, 3)), JEDA_GAGAL_MAKS_MS);
    jadwalkan(mundur);
  };

  const saatTerlihat = () => {
    if (!hidup || !dilacak) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    // Kembali dari layar terkunci: kalau jadwalnya sudah lewat, kirim
    // sekarang juga daripada menunggu satu siklus penuh lagi.
    if (Date.now() - terakhirKirimMs >= intervalMs) jadwalkan(1000);
  };

  const hentikan = () => {
    hidup = false;
    if (timer) clearTimeout(timer);
    timer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', saatTerlihat);
    }
  };

  // --- Mulai: tanyakan dulu apakah akun ini memang dilacak ------------
  (async () => {
    try {
      const res = await fetchApi(scriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_gps_tracking_status', userId: user.id })
      });
      const data = await res.json();

      // Backend lama (< 1.0.16) menjawab "Action tidak dikenal". Itu bukan
      // kesalahan yang perlu ditampilkan: aplikasi baru memang harus tetap
      // berjalan normal di backend yang belum di-deploy ulang.
      if (!data || data.result !== 'success') { hentikan(); return; }
      if (!data.aktif) {
        kabar({ aktif: false, izinDitolak: false, terakhir: 0, pesan: '' });
        hentikan();
        return;
      }

      dilacak = true;
      intervalMs = Math.max(Number(data.intervalDetik || 300) * 1000, 60000);
      kabar({ aktif: true, izinDitolak: false, terakhir: 0, pesan: data.pemberitahuan || '' });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', saatTerlihat);
      }
      // Titik pertama dikirim agak lambat, bukan seketika: saat login
      // aplikasi sedang sibuk memuat dashboard, dan izin lokasi yang
      // muncul di detik pertama membuat karyawan menolaknya karena kaget.
      jadwalkan(20000);
    } catch (e) {
      hentikan();
    }
  })();

  return hentikan;
}
