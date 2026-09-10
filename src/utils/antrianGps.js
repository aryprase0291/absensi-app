// =====================================================================
// ANTRIAN TITIK GPS YANG BELUM TERKIRIM
//
// MASALAH YANG DISELESAIKANNYA
//
// Titik posisi dibaca di tempat karyawan berada; ia dikirim lewat
// jaringan yang belum tentu ada di tempat yang sama. Selama ini titik
// yang gagal terkirim hilang begitu saja, dan yang terlihat admin adalah
// jejak berlubang persis di area yang paling sering ditanyakan: gudang
// tanpa sinyal, basement, jalan antar-kota.
//
// Antrian ini menyimpan titik yang gagal di localStorage, lalu
// mengirimnya kembali begitu jaringan hidup. Yang tersimpan hanya
// koordinat + waktu — bukan token, bukan identitas selain userId.
//
// EMPAT ATURAN YANG MENJAGANYA TETAP SEHAT
//
// 1. BERBATAS. Maksimal ANTRIAN_MAKS titik; yang tertua dibuang lebih
//    dulu. Tanpa batas, HP yang seharian tanpa sinyal akan menabrak
//    kuota localStorage (~5 MB) dan MERUSAK penyimpanan lain di
//    aplikasi ini — termasuk penanda versi dan ingatan izin GPS.
//
// 2. KEDALUWARSA. Titik yang lebih tua dari ANTRIAN_UMUR_MAKS_MS
//    dibuang. Posisi kemarin sore tidak menjelaskan apa pun hari ini,
//    dan backend memang menolaknya.
//
// 3. TERIKAT PADA SATU KARYAWAN. HP bersama (satpam, kurir) dipakai
//    bergantian. Titik milik user sebelumnya TIDAK BOLEH terkirim atas
//    nama user yang sedang login — itu bukan sekadar data kotor,
//    melainkan bukti lokasi palsu untuk orang yang salah.
//
// 4. TIDAK PERNAH MELEMPAR. Mode privat Safari membuat localStorage
//    melempar exception pada setiap penulisan. Pelacakan adalah fitur
//    tambahan; ia tidak boleh menjatuhkan layar absensi.
// =====================================================================

const KUNCI = 'gps_antrian_v1';

export const ANTRIAN_MAKS = 200;
export const ANTRIAN_UMUR_MAKS_MS = 12 * 3600 * 1000; // 12 jam
// Satu request tidak boleh membawa terlalu banyak titik: Apps Script
// punya batas waktu eksekusi 6 menit dan batas ukuran payload.
export const ANTRIAN_BATCH_MAKS = 50;

const bacaMentah = () => {
  try {
    const isi = localStorage.getItem(KUNCI);
    if (!isi) return [];
    const arr = JSON.parse(isi);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
};

const tulisMentah = (arr) => {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(arr));
    return true;
  } catch (e) {
    // Kuota penuh atau mode privat. Coba sekali lagi dengan separuh
    // isi terbaru — lebih baik kehilangan titik lama daripada tidak
    // bisa menyimpan apa pun sampai aplikasi ditutup.
    try {
      localStorage.setItem(KUNCI, JSON.stringify(arr.slice(-Math.floor(ANTRIAN_MAKS / 4))));
      return true;
    } catch (e2) {
      return false;
    }
  }
};

const titikValid = (t, sekarang) => {
  if (!t || typeof t !== 'object') return false;
  const waktu = Number(t.waktu);
  if (!isFinite(waktu) || waktu <= 0) return false;
  if (sekarang - waktu > ANTRIAN_UMUR_MAKS_MS) return false;
  const lat = Number(t.lat);
  const lng = Number(t.lng);
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
};

/**
 * Menyimpan satu titik yang gagal terkirim.
 * @returns {boolean} true bila benar-benar tersimpan.
 */
export function simpanTitikAntrian(titik) {
  const sekarang = Date.now();
  const isi = {
    id: `${sekarang}-${Math.random().toString(36).slice(2, 8)}`,
    userId: String((titik && titik.userId) || ''),
    waktu: Number((titik && titik.waktu) || sekarang),
    lat: Number(titik && titik.lat),
    lng: Number(titik && titik.lng),
    akurasi: isFinite(Number(titik && titik.akurasi)) ? Math.round(Number(titik.akurasi)) : null,
    baterai: isFinite(Number(titik && titik.baterai)) ? Math.round(Number(titik.baterai)) : null,
    sumber: String((titik && titik.sumber) || 'periodik')
  };
  if (!isi.userId) return false;
  if (!titikValid(isi, sekarang)) return false;

  const arr = bacaMentah().filter((t) => titikValid(t, sekarang));
  arr.push(isi);
  // Yang dibuang saat penuh adalah yang TERTUA. Titik terbaru jauh
  // lebih berharga: itulah posisi karyawan sekarang.
  const dipangkas = arr.length > ANTRIAN_MAKS ? arr.slice(arr.length - ANTRIAN_MAKS) : arr;
  return tulisMentah(dipangkas);
}

/**
 * Titik milik satu karyawan yang siap dikirim ulang, terurut dari yang
 * paling lama. Titik kedaluwarsa dan milik user lain ikut dibersihkan
 * dari penyimpanan saat fungsi ini dipanggil.
 */
export function ambilAntrian(userId, batas = ANTRIAN_BATCH_MAKS) {
  const sekarang = Date.now();
  const id = String(userId || '');
  if (!id) return [];
  const semua = bacaMentah();
  const arr = semua.filter((t) => titikValid(t, sekarang));
  // Penulisan ulang hanya dilakukan bila memang ada yang gugur, supaya
  // pembacaan biasa tidak menyentuh localStorage tanpa perlu.
  if (arr.length !== semua.length) tulisMentah(arr);
  return arr
    .filter((t) => String(t.userId) === id)
    .sort((a, b) => a.waktu - b.waktu)
    .slice(0, Math.max(1, batas));
}

/** Berapa titik milik karyawan ini yang masih menunggu. */
export function jumlahAntrian(userId) {
  const sekarang = Date.now();
  const id = String(userId || '');
  return bacaMentah().filter((t) => titikValid(t, sekarang) && String(t.userId) === id).length;
}

/**
 * Membuang titik yang sudah dipastikan diterima server.
 * Dipanggil HANYA setelah respons sukses — kalau tidak, titik yang
 * hilang di jaringan akan ikut terhapus dan jejaknya tetap berlubang.
 */
export function buangTerkirim(idList) {
  const buang = new Set((idList || []).map(String));
  if (!buang.size) return;
  const sekarang = Date.now();
  const sisa = bacaMentah().filter((t) => titikValid(t, sekarang) && !buang.has(String(t.id)));
  tulisMentah(sisa);
}

/**
 * Mengosongkan seluruh antrian, milik semua karyawan.
 *
 * SENGAJA TIDAK dipanggil saat logout. Auto-logout terjadi setiap kali
 * karyawan tidak menyentuh layarnya selama satu jam — justru situasi
 * yang paling sering menyisakan titik belum terkirim. Membuangnya di
 * sana berarti membuang jejak perjalanan yang baru saja dikumpulkan.
 * Pemisahan antar karyawan dijamin oleh saringan userId di
 * ambilAntrian(), bukan oleh penghapusan ini.
 */
export function bersihkanAntrian() {
  try { localStorage.removeItem(KUNCI); } catch (e) { /* abaikan */ }
}
