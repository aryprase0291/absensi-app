// KUNCI PENGAJUAN PERIODE LALU (Okt 2026)
//
// Cermin dari cekKunciPeriodeLalu_ di apps-script/AbsencePeriod.gs.
// Backend tetap penentu akhir; di sini hanya supaya kalender menutup
// tanggal lama dan karyawan mendapat pesan sebelum menekan Kirim.
//
// Batas = tanggal mulai periode yang berjalan hari ini:
//   1. periode AKTIF yang memuat hari ini, kalau ada;
//   2. kalau tidak ada, siklus standar 21 s/d 20.
// Tanggal sebelum batas = periode lalu = terkunci.

const pad = (n) => String(n).padStart(2, '0');

/** Mulai siklus standar 21–20 yang memuat `hariIni` (yyyy-MM-dd). */
export const mulaiSiklusStandar = (hariIni) => {
  const [y, m, d] = hariIni.split('-').map(Number);
  let tahun = y;
  let bulan = m; // 1-12
  if (d < 21) {
    bulan -= 1;
    if (bulan < 1) { bulan = 12; tahun -= 1; }
  }
  return `${tahun}-${pad(bulan)}-21`;
};

/**
 * @param {Array|null} periodsAktif daftar periode aktif dari server
 *   ({ mulai, selesai } dalam yyyy-MM-dd). null = belum diketahui.
 * @param {string} hariIni yyyy-MM-dd menurut jam server.
 * @return {string} tanggal terawal yang masih boleh diajukan, atau ''
 *   bila daftar periode belum diketahui (biarkan backend yang menilai,
 *   supaya frontend tidak salah mengunci bila admin memakai siklus lain).
 */
export const batasPengajuanMundur = (periodsAktif, hariIni) => {
  if (!hariIni || !Array.isArray(periodsAktif)) return '';
  const berjalan = periodsAktif.find(
    (p) => p && p.mulai && p.selesai && hariIni >= p.mulai && hariIni <= p.selesai
  );
  return berjalan ? berjalan.mulai : mulaiSiklusStandar(hariIni);
};

/** Daftar periode aktif yang disimpan saat login / buka dashboard. */
export const bacaPeriodeAktifTersimpan = () => {
  try {
    const raw = sessionStorage.getItem('app_periods_awal');
    if (!raw) return null;
    const p = JSON.parse(raw);
    return Array.isArray(p.periodsAktif) ? p.periodsAktif : null;
  } catch (e) {
    return null;
  }
};

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const tampilYmd = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};

/**
 * @return {string} pesan bila ada tanggal sebelum batas, '' bila lolos.
 */
export const pesanKunciPeriode = (daftarTanggal, batas) => {
  if (!batas) return '';
  const lama = (daftarTanggal || []).filter(Boolean).sort()[0];
  if (!lama || lama >= batas) return '';
  return `Periode untuk tanggal ${tampilYmd(lama)} sudah ditutup. Pengajuan hanya bisa untuk tanggal ${tampilYmd(batas)} ke atas.`;
};
