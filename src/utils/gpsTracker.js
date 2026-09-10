// =====================================================================
// PELACAK POSISI KARYAWAN (SISI KLIEN)
//
// Mengirim satu titik posisi ke backend secara berkala selama sesi
// karyawan masih hidup — termasuk saat aplikasi hanya dibiarkan terbuka
// tanpa disentuh ("standby") — plus satu titik setiap kali karyawan
// berhasil absen.
//
// EMPAT BATASAN YANG HARUS DIPAHAMI SEBELUM MENGUBAH FILE INI
//
// 1. Browser TIDAK BISA melacak saat aplikasi DITUTUP. Tidak ada
//    pekerjaan latar belakang yang diizinkan untuk itu di web — Service
//    Worker sekalipun tidak boleh membaca geolocation. Yang bisa
//    dijangkau hanyalah "aplikasi masih terbuka, tapi tidak disentuh",
//    dan itulah yang ditangani file ini.
//
// 2. Sesi berakhir = pelacakan berakhir. Auto-logout kini 60 menit sejak
//    aktivitas terakhir (TIMEOUT_DURATION di config/constants.js).
//    JANGAN mematikan auto-logout untuk memperpanjang pelacakan; HP yang
//    tertinggal di meja akan menjadi sesi terbuka bagi siapa pun.
//
// 3. Tab tersembunyi di-throttle, layar terkunci menghentikan GPS sama
//    sekali. Dua penangkalnya ada di sini:
//      - Wake Lock (utils/wakeLock.js) menahan layar tetap menyala
//        selama pelacakan aktif, sehingga halaman tetap "terlihat".
//      - Jadwal memakai rantai setTimeout yang selalu memeriksa waktu
//        nyata, bukan setInterval yang berasumsi tiap centangnya tepat.
//    Siklus TIDAK LAGI dilewati saat dokumen tersembunyi (perilaku lama
//    sampai 1.0.17): justru di saat itulah karyawan sedang berjalan dan
//    posisinya paling ingin diketahui. Yang gagal disimpan ke antrian.
//
// 4. Kegagalan pelacakan TIDAK BOLEH mengganggu apa pun. Izin ditolak,
//    GPS mati, server sibuk — semuanya berakhir diam-diam di sini.
//    Absensi adalah fitur utama aplikasi ini; pelacakan hanya tambahan.
// =====================================================================

import { ambilSidikPerangkat } from './antiFakeGps';
import { GPS_WAKE_LOCK_AKTIF } from '../config/constants';
import { mulaiWakeLock } from './wakeLock';
import {
  simpanTitikAntrian, ambilAntrian, buangTerkirim, jumlahAntrian, ANTRIAN_BATCH_MAKS
} from './antrianGps';

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
 *
 * Pada kegagalan JARINGAN, kembaliannya ikut membawa `titik`: posisi
 * yang sudah terlanjur terbaca. Itulah yang disimpan pemanggil ke
 * antrian — membacanya ulang nanti akan menghasilkan posisi yang salah,
 * karena karyawannya sudah pindah tempat.
 */
export async function kirimTitikGps({ fetchApi, scriptUrl, user, sumber = 'periodik', posisi = null }) {
  let coords = posisi;
  let baterai = null;
  try {
    if (!user || !user.id) return { ok: false, alasan: 'tanpa-user' };
    if (!('geolocation' in navigator)) return { ok: false, alasan: 'tanpa-geolocation' };

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

    baterai = await bacaBaterai();
    let bukti = null;
    try {
      const p = ambilSidikPerangkat();
      bukti = { deviceId: p.deviceId, platform: p.platform };
    } catch (e) { /* sidik perangkat opsional */ }

    const res = await fetchApi(scriptUrl, {
      method: 'POST',
      // senyap: ini permintaan latar belakang. Kalau sesinya sudah habis,
      // berhenti diam-diam — jangan memunculkan alert atau me-reload
      // halaman di tengah karyawan memakai aplikasi.
      senyap: true,
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
    if (data.result !== 'success') {
      return { ok: false, alasan: data.code || data.message || 'ditolak-server', titik: null };
    }
    return { ok: true, data };
  } catch (e) {
    const izinDitolak = e && e.code === 1;
    return {
      ok: false,
      alasan: izinDitolak ? 'izin-ditolak' : 'gagal',
      // Posisi hanya dititipkan bila memang sudah terbaca. Gagal membaca
      // GPS tidak menghasilkan titik apa pun untuk diantrikan.
      titik: !izinDitolak && coords ? { ...coords, baterai, sumber } : null
    };
  }
}

/**
 * Mengirim ulang titik-titik yang tertinggal di antrian, sekaligus dalam
 * SATU request.
 *
 * Kenapa satu request, bukan satu per titik: Apps Script adalah bagian
 * paling lambat di rantai ini (1–34 detik per panggilan, terukur Agu
 * 2026). Mengirim 40 titik satu per satu bukan hanya lama, tapi juga
 * memakan kuota panggilan harian yang dipakai bersama seluruh fitur
 * absensi.
 *
 * Titik hanya dibuang dari antrian setelah server BENAR-BENAR menjawab
 * sukses. Kegagalan apa pun meninggalkannya utuh untuk percobaan
 * berikutnya.
 */
export async function kirimAntrianGps({ fetchApi, scriptUrl, user }) {
  try {
    if (!user || !user.id) return { ok: false, terkirim: 0 };
    const antre = ambilAntrian(user.id, ANTRIAN_BATCH_MAKS);
    if (!antre.length) return { ok: true, terkirim: 0 };

    let bukti = null;
    try {
      const p = ambilSidikPerangkat();
      bukti = { deviceId: p.deviceId, platform: p.platform };
    } catch (e) { /* opsional */ }

    const res = await fetchApi(scriptUrl, {
      method: 'POST',
      senyap: true,
      body: JSON.stringify({
        action: 'track_gps_antrian',
        userId: user.id,
        nama: user.nama,
        gpsBukti: bukti,
        titik: antre.map((t) => ({
          waktu: t.waktu,
          lat: t.lat,
          lng: t.lng,
          akurasi: t.akurasi,
          baterai: t.baterai,
          sumber: t.sumber
        }))
      })
    });
    const data = await res.json();
    // Backend lama (< 1.0.18) menjawab "Action tidak dikenal" dan tidak
    // akan pernah menerima antrian ini. Titiknya DIBIARKAN di antrian
    // sampai kedaluwarsa sendiri (12 jam) — bukan dibuang, karena
    // backend bisa saja di-deploy beberapa menit kemudian.
    if (!data || data.result !== 'success') return { ok: false, terkirim: 0 };

    buangTerkirim(antre.map((t) => t.id));
    return { ok: true, terkirim: antre.length, sisa: jumlahAntrian(user.id) };
  } catch (e) {
    return { ok: false, terkirim: 0 };
  }
}

/**
 * Menyalakan pelacakan berkala. Kembaliannya adalah fungsi penghenti —
 * WAJIB dipanggil saat logout / unmount, kalau tidak timernya tetap
 * hidup dan menembak dengan token milik user sebelumnya (dan layar HP
 * karyawan tetap ditahan menyala oleh wake lock).
 *
 * @param {Function} onStatus dipanggil setiap status berubah, untuk
 *        indikator di layar:
 *        { aktif, izinDitolak, terakhir, pesan, antrian, layarDitahan }
 */
export function mulaiPelacakGps({ fetchApi, scriptUrl, user, onStatus }) {
  let hidup = true;
  let timer = null;
  let intervalMs = INTERVAL_BAWAAN_MS;
  let gagalBerturut = 0;
  let terakhirKirimMs = 0;
  let dilacak = false;
  let hentikanWakeLock = null;
  let layarDitahan = false;

  const kabar = (isi) => {
    try {
      if (onStatus) onStatus({ ...isi, antrian: jumlahAntrian(user && user.id), layarDitahan });
    } catch (e) { /* abaikan */ }
  };

  const jadwalkan = (jedaMs) => {
    if (!hidup) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(siklus, Math.max(jedaMs, 15000));
  };

  const siklus = async () => {
    if (!hidup) return;

    // CATATAN PERUBAHAN 1.0.18: dokumen yang tersembunyi TIDAK LAGI
    // membuat siklus dilewati. Sampai 1.0.17 baris itu ada di sini dan
    // hasilnya persis kebalikan dari maksud fitur — karyawan yang
    // menaruh HP di saku sambil berkendara berhenti terlacak, padahal
    // itulah saat jejaknya paling dibutuhkan. Pembacaan yang gagal
    // karena layar mati akan berakhir di antrian, bukan hilang.
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
      // Jaringan terbukti hidup: inilah saat yang tepat menyusulkan
      // titik-titik yang tertinggal. Dijalankan SETELAH titik terbaru
      // terkirim, supaya posisi sekarang tidak tertunda oleh riwayat.
      await kirimAntrianGps({ fetchApi, scriptUrl, user });
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

    // Posisi sempat terbaca tapi tidak sampai ke server: simpan supaya
    // jejaknya tidak berlubang. Inilah satu-satunya tempat titik masuk
    // antrian.
    if (hasil.titik) {
      simpanTitikAntrian({
        userId: user.id,
        waktu: Date.now(),
        lat: hasil.titik.lat,
        lng: hasil.titik.lng,
        akurasi: hasil.titik.akurasi,
        baterai: hasil.titik.baterai,
        sumber: 'periodik'
      });
      kabar({ aktif: true, izinDitolak: false, terakhir: terakhirKirimMs, pesan: 'Menunggu jaringan.' });
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
    // sekarang juga daripada menunggu satu siklus penuh lagi. Antrian
    // yang menumpuk selama layar mati ikut tersusul di siklus itu.
    if (Date.now() - terakhirKirimMs >= intervalMs) jadwalkan(1000);
    else if (jumlahAntrian(user && user.id) > 0) {
      kirimAntrianGps({ fetchApi, scriptUrl, user });
    }
  };

  // Jaringan hidup kembali adalah sinyal paling akurat bahwa antrian
  // layak dicoba lagi — jauh lebih tepat daripada menunggu jadwal.
  const saatOnline = () => {
    if (!hidup || !dilacak) return;
    kirimAntrianGps({ fetchApi, scriptUrl, user });
  };

  const hentikan = () => {
    hidup = false;
    if (timer) clearTimeout(timer);
    timer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', saatTerlihat);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', saatOnline);
    }
    if (hentikanWakeLock) {
      try { hentikanWakeLock(); } catch (e) { /* abaikan */ }
      hentikanWakeLock = null;
      layarDitahan = false;
    }
  };

  // --- Mulai: tanyakan dulu apakah akun ini memang dilacak ------------
  (async () => {
    try {
      const res = await fetchApi(scriptUrl, {
        method: 'POST',
        senyap: true,
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

      // Layar ditahan HANYA untuk karyawan yang memang dilacak. Menahan
      // layar orang yang pelacakannya dimatikan admin adalah baterai
      // yang terbuang tanpa satu titik pun dihasilkan.
      if (GPS_WAKE_LOCK_AKTIF) {
        hentikanWakeLock = mulaiWakeLock((st) => {
          layarDitahan = !!(st && st.aktif);
        });
      }

      kabar({ aktif: true, izinDitolak: false, terakhir: 0, pesan: data.pemberitahuan || '' });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', saatTerlihat);
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('online', saatOnline);
      }

      // Titik yang tertinggal dari sesi sebelumnya (aplikasi ditutup saat
      // jaringan mati, atau sesi habis karena auto-logout) disusulkan
      // lebih dulu — tidak perlu menunggu siklus pertama.
      kirimAntrianGps({ fetchApi, scriptUrl, user });

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
