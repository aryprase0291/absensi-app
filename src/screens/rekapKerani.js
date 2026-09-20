// =======================================================
// REKAP KERANI PABRIK — penghitung murni untuk DashboardKerani
//
// Dipisah dari layarnya dengan alasan yang sama seperti boardAbsensi.js:
// angka yang dipakai menilai orang harus bisa diuji tanpa merender apa
// pun. Seluruh fungsi di sini tidak menyentuh jaringan, DOM, maupun
// tanggal "hari ini" — masukannya eksplisit, keluarannya bisa diperiksa.
//
// SUMBER DATANYA `get_history`, BUKAN dbabsen mesin.
// Yang dihitung memang absen ONLINE: baris yang ditulis aplikasi ke sheet
// Absensi (tipe Hadir / Pulang / Standby / Ijin / Cuti / ...). Mesin
// fingerprint tidak ikut — kerani pabrik mengabsen lewat aplikasi, dan
// mencampur dua sumber berarti satu hari bisa terhitung dua kali.
//
// JABATAN TIDAK ADA DI `get_history`.
// Baris histori hanya membawa `divisi`. Karena itu daftar kerani datang
// dari `get_user_list_admin` (kolom Role/Jabatan di sheet Users), lalu
// dijodohkan ke histori lewat userId. Orang yang tidak ada di daftar itu
// tidak pernah masuk hitungan, termasuk kalau barisnya ada di histori.
// =======================================================

import { keYmd } from './boardAbsensi';

const SATU_HARI_MS = 86400000;

// Tipe yang dicatat sebagai KEHADIRAN ONLINE hari itu.
export const TIPE_HADIR = 'Hadir';
export const TIPE_PULANG = 'Pulang';
export const TIPE_STANDBY = 'Standby';

// Tipe pengajuan — punya rentang tglMulai..tglSelesai dan butuh approval.
// Disalin dari APPROVAL_TYPES di App.js; kalau di sana bertambah, di sini
// juga harus. 'Ijin' TIDAK ada di daftar App.js tapi tetap dimasukkan:
// baris ijin lama memakai tipe itu dan tetap punya rentang tanggal.
export const TIPE_PENGAJUAN = [
  'Cuti', 'Cuti EO', 'Sakit', 'Ijin', 'Dinas', 'Dinas Luar',
  'Lembur', 'Tukar Shift', 'Off'
];

// Empat keadaan yang mungkin dialami satu orang pada satu hari kerja.
// Urutannya juga urutan PRIORITAS: orang yang hari itu absen Hadir tetap
// dihitung hadir walau punya pengajuan Lembur di hari yang sama.
export const STATUS = {
  HADIR: 'HADIR',
  STANDBY: 'STANDBY',
  IZIN: 'IZIN',
  KOSONG: 'KOSONG'
};

/** Tanggal berurutan 'YYYY-MM-DD', inklusif, dihitung dalam UTC. */
export function rentangTanggal(dariYmd, sampaiYmd, maks = 400) {
  const a = keYmd(dariYmd);
  const b = keYmd(sampaiYmd);
  if (!a || !b) return [];
  const mulai = Date.parse(a + 'T00:00:00Z');
  const akhir = Date.parse(b + 'T00:00:00Z');
  if (isNaN(mulai) || isNaN(akhir) || akhir < mulai) return [];
  const total = Math.min(Math.floor((akhir - mulai) / SATU_HARI_MS) + 1, maks);
  const hasil = [];
  for (let i = 0; i < total; i++) {
    hasil.push(new Date(mulai + i * SATU_HARI_MS).toISOString().slice(0, 10));
  }
  return hasil;
}

/** Minggu = 0 pada getUTCDay(). Dihitung UTC supaya tidak tergantung zona. */
export function hariMinggu(ymd) {
  const t = Date.parse(String(ymd) + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).getUTCDay() === 0;
}

/**
 * Hari kerja dalam rentang.
 *
 * Minggu dan libur nasional DIBUANG secara bawaan. Keduanya bisa
 * dikembalikan lewat opsi karena pabrik memang bisa jalan di hari libur —
 * dan kalau hari libur ikut dihitung sementara tidak ada yang masuk,
 * persentase "tidak absen" akan melonjak tanpa ada yang salah.
 */
export function hariKerja(dariYmd, sampaiYmd, opsi) {
  const o = opsi || {};
  const libur = o.libur || {};
  return rentangTanggal(dariYmd, sampaiYmd).filter(function (t) {
    if (!o.hitungMinggu && hariMinggu(t)) return false;
    if (!o.hitungLibur && libur[t]) return false;
    return true;
  });
}

/**
 * Menyaring daftar pegawai menjadi kerani pabrik.
 *
 * Dua saringan, keduanya harus lolos:
 *   - JABATAN mengandung `kataKunci` (bawaan 'KERANI'), dari kolom
 *     Role/Jabatan sheet Users;
 *   - DIVISI termasuk dalam `divisiDipilih`. Daftar kosong berarti
 *     "semua divisi" — bukan "tidak ada satu pun", karena layar memuat
 *     daftar divisinya SESUDAH pegawai datang.
 */
export function saringKerani(pegawai, kataKunci, divisiDipilih) {
  const kunci = String(kataKunci || 'KERANI').trim().toUpperCase();
  const pilih = Array.isArray(divisiDipilih) ? divisiDipilih : [];
  const setDivisi = {};
  pilih.forEach(function (d) { setDivisi[String(d).trim().toUpperCase()] = true; });

  return (pegawai || []).filter(function (p) {
    const jab = String(p.jabatan || '').trim().toUpperCase();
    if (kunci && jab.indexOf(kunci) === -1) return false;
    if (!pilih.length) return true;
    return !!setDivisi[String(p.divisi || '').trim().toUpperCase()];
  });
}

/** Daftar divisi unik dari sekumpulan pegawai, terurut A-Z. */
export function daftarDivisi(pegawai) {
  const ada = {};
  (pegawai || []).forEach(function (p) {
    const d = String(p.divisi || '').trim();
    if (d && d !== '-') ada[d] = true;
  });
  return Object.keys(ada).sort(function (a, b) { return a.localeCompare(b); });
}

/**
 * Tanggal-tanggal yang dicakup satu baris histori.
 *
 * Baris pengajuan (Cuti, Sakit, Dinas, ...) berlaku untuk SELURUH rentang
 * tglMulai..tglSelesai, bukan untuk hari ia diajukan. Cuti tiga hari yang
 * diajukan sehari sebelumnya harus menutup ketiga harinya — kalau hanya
 * hari pengajuan yang dihitung, dua hari sisanya muncul sebagai "tidak
 * absen sama sekali".
 *
 * Baris harian (Hadir / Pulang / Standby) memakai kolom Waktu.
 */
export function tanggalBaris(item) {
  if (!item) return [];
  const tipe = String(item.tipe || '').trim();
  const mulai = keYmd(item.tglMulai && item.tglMulai !== '-' ? item.tglMulai : '');
  const selesai = keYmd(item.tglSelesai && item.tglSelesai !== '-' ? item.tglSelesai : '');

  if (TIPE_PENGAJUAN.indexOf(tipe) !== -1 && mulai) {
    return rentangTanggal(mulai, selesai || mulai, 400);
  }
  const t = mulai || keYmd(item.waktu);
  return t ? [t] : [];
}

/**
 * Menyusun rekap kehadiran online kerani.
 *
 * DUA PENYEBUT, DAN KEDUANYA DISEBUT DI LAYAR:
 *
 *   komposisi (Hadir / Standby / Izin / Tidak absen)
 *       penyebutnya SELURUH hari-orang = hari kerja x jumlah kerani.
 *       Empat angkanya berjumlah 100% — itu gunanya satu penyebut.
 *
 *   produktifitas
 *       penyebutnya hari-orang EFEKTIF = seluruh hari-orang dikurangi
 *       hari izin/cuti/sakit. Orang yang sedang cuti tidak punya apa pun
 *       untuk diabsen; memasukkannya ke penyebut membuat divisi yang
 *       cutinya banyak terlihat tidak produktif padahal cutinya sah.
 *
 * Yang disebut PRODUKTIF adalah hari dengan absen LENGKAP: ada Hadir DAN
 * ada Pulang. Hadir tanpa Pulang tidak dihitung — itu justru pola yang
 * ingin dilihat, bukan yang ingin disembunyikan.
 */
export function susunRekapKerani(opsi) {
  const o = opsi || {};
  const tanggal = hariKerja(o.dari, o.sampai, {
    libur: o.libur,
    hitungMinggu: !!o.hitungMinggu,
    hitungLibur: !!o.hitungLibur
  });
  const adaTanggal = {};
  tanggal.forEach(function (t) { adaTanggal[t] = true; });

  // Satu kerangka per orang, diisi nol dulu. Orang yang TIDAK punya satu
  // baris pun tetap muncul dengan seluruh harinya KOSONG — itu justru
  // temuan yang dicari, dan tidak akan terlihat kalau barisnya dibuat
  // hanya saat ada data.
  const peta = {};
  const urut = [];
  (o.kerani || []).forEach(function (p) {
    const id = String(p.id || p.uuid || '').trim();
    if (!id || peta[id]) return;
    const baris = {
      id: id,
      nama: String(p.nama || '-').trim(),
      divisi: String(p.divisi || '-').trim(),
      jabatan: String(p.jabatan || '-').trim(),
      sel: {},
      lengkapPer: {},
      hadir: 0, standby: 0, izin: 0, tidakAbsen: 0, lengkap: 0,
      persenProduktif: 0
    };
    tanggal.forEach(function (t) { baris.sel[t] = STATUS.KOSONG; });
    peta[id] = baris;
    urut.push(baris);
  });

  // Tanda per orang per hari. Dikumpulkan dulu, dinilai belakangan —
  // supaya prioritas Hadir > Standby > Izin tidak bergantung pada urutan
  // baris datang dari server.
  const tanda = {};
  (o.history || []).forEach(function (item) {
    const id = String((item && item.userId) || '').trim();
    if (!id || !peta[id]) return;
    if (String(item.status || '').trim() === 'Rejected') return;

    const tipe = String(item.tipe || '').trim();
    tanggalBaris(item).forEach(function (t) {
      if (!adaTanggal[t]) return;
      const k = id + '|' + t;
      if (!tanda[k]) tanda[k] = { hadir: false, pulang: false, standby: false, izin: false };
      if (tipe === TIPE_HADIR) tanda[k].hadir = true;
      else if (tipe === TIPE_PULANG) tanda[k].pulang = true;
      else if (tipe === TIPE_STANDBY) tanda[k].standby = true;
      else if (TIPE_PENGAJUAN.indexOf(tipe) !== -1) tanda[k].izin = true;
    });
  });

  const perHari = tanggal.map(function (t) {
    return { tanggal: t, hadir: 0, standby: 0, izin: 0, tidakAbsen: 0, lengkap: 0 };
  });
  const indeksHari = {};
  tanggal.forEach(function (t, i) { indeksHari[t] = i; });

  urut.forEach(function (b) {
    tanggal.forEach(function (t) {
      const m = tanda[b.id + '|' + t];
      let st = STATUS.KOSONG;
      if (m) {
        if (m.hadir) st = STATUS.HADIR;
        else if (m.standby) st = STATUS.STANDBY;
        else if (m.izin) st = STATUS.IZIN;
        // Baris Pulang tanpa Hadir sengaja TIDAK menjadikan hari itu
        // hadir. Absen pulang tanpa absen masuk adalah cacat data yang
        // harus terlihat, bukan lubang yang ditambal diam-diam.
      }
      b.sel[t] = st;

      const h = perHari[indeksHari[t]];
      if (st === STATUS.HADIR) { b.hadir++; h.hadir++; }
      else if (st === STATUS.STANDBY) { b.standby++; h.standby++; }
      else if (st === STATUS.IZIN) { b.izin++; h.izin++; }
      else { b.tidakAbsen++; h.tidakAbsen++; }

      const lengkap = !!(m && m.hadir && m.pulang);
      b.lengkapPer[t] = lengkap;
      if (lengkap) { b.lengkap++; h.lengkap++; }
    });

    const efektif = tanggal.length - b.izin;
    b.hariEfektif = efektif;
    b.persenProduktif = efektif > 0 ? (b.lengkap / efektif) * 100 : 0;
  });

  const jumlahOrang = urut.length;
  const totalHariOrang = jumlahOrang * tanggal.length;
  const jml = function (kunci) {
    return urut.reduce(function (a, b) { return a + b[kunci]; }, 0);
  };
  const hadir = jml('hadir');
  const standby = jml('standby');
  const izin = jml('izin');
  const tidakAbsen = jml('tidakAbsen');
  const lengkap = jml('lengkap');
  const efektif = totalHariOrang - izin;
  const persen = function (n, d) { return d > 0 ? (n / d) * 100 : 0; };

  // Urutan tabel: produktifitas TERENDAH di atas. Layar ini dibuka untuk
  // mencari yang bermasalah, jadi yang bermasalah tidak boleh berada di
  // halaman terakhir. Nama sebagai pemutus seri supaya urutannya tetap.
  urut.sort(function (a, b) {
    return a.persenProduktif - b.persenProduktif ||
           b.tidakAbsen - a.tidakAbsen ||
           String(a.nama).localeCompare(String(b.nama));
  });

  return {
    tanggal: tanggal,
    perOrang: urut,
    perHari: perHari,
    ringkas: {
      jumlahOrang: jumlahOrang,
      hariKerja: tanggal.length,
      totalHariOrang: totalHariOrang,
      hariEfektif: efektif,
      hadir: hadir,
      standby: standby,
      izin: izin,
      tidakAbsen: tidakAbsen,
      lengkap: lengkap,
      persenHadir: persen(hadir, totalHariOrang),
      persenStandby: persen(standby, totalHariOrang),
      persenIzin: persen(izin, totalHariOrang),
      persenTidakAbsen: persen(tidakAbsen, totalHariOrang),
      persenProduktif: persen(lengkap, efektif)
    }
  };
}
