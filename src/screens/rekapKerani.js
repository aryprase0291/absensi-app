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
 * KATA KUNCI DICOCOKKAN KE DUA KOLOM, BUKAN SATU.
 *   Di sheet Users, "KERANI PABRIK" ternyata tersimpan di kolom DIVISI
 *   (kolom E) — itu yang tampil sebagai "POSISI" di layar Laporan &
 *   Cetak Data. Kolom Role/Jabatan (kolom F) berisi peran aplikasi
 *   (karyawan / admin / hrd), bukan jabatan pekerjaan.
 *
 *   Menyaring kolom Jabatan saja karena itu menghasilkan NOL kerani
 *   padahal datanya ada — persis kegagalan yang sempat terjadi. Karena
 *   dua tempat yang sama-sama masuk akal, keduanya diperiksa: cocok di
 *   salah satunya sudah cukup.
 *
 * Saringan kedua, DIVISI, tetap berlaku dan dipilih di layar. Daftar
 * kosong berarti "semua divisi" — bukan "tidak ada satu pun", karena
 * layar memuat daftar divisinya SESUDAH pegawai datang.
 */
export function saringKerani(pegawai, kataKunci, divisiDipilih) {
  const kunci = String(kataKunci || 'KERANI').trim().toUpperCase();
  const pilih = Array.isArray(divisiDipilih) ? divisiDipilih : [];
  const setDivisi = {};
  pilih.forEach(function (d) { setDivisi[String(d).trim().toUpperCase()] = true; });

  return (pegawai || []).filter(function (p) {
    const jab = String(p.jabatan || '').trim().toUpperCase();
    const div = String(p.divisi || '').trim().toUpperCase();
    if (kunci && jab.indexOf(kunci) === -1 && div.indexOf(kunci) === -1) return false;
    if (!pilih.length) return true;
    return !!setDivisi[div];
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
// ZONA WAKTU.
//   Kalau sel Waktu / Tgl Mulai di sheet sudah menjadi tipe Date,
//   getValues() mengirimnya sebagai ISO UTC, mis. "2026-10-01T23:48:00.000Z"
//   untuk absen 2 Okt pukul 06:48 WIB. keYmd() memotong 10 karakter pertama
//   -> "2026-10-01": absen sebelum jam 07:00 WIB jatuh ke HARI SEBELUMNYA,
//   dan hari ini terlihat "tidak absen" padahal orangnya sudah absen.
//   Teks ISO yang membawa zona (Z / +07:00) karena itu dibaca dalam zona
//   Asia/Jakarta — zona script backend — bukan zona perangkat yang membuka.
const ZONA = 'Asia/Jakarta';
const ISO_BERZONA = /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/;

function bagianJakarta(teks) {
  const d = new Date(teks);
  if (isNaN(d.getTime())) return null;
  const b = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).forEach((x) => { b[x.type] = x.value; });
  return b;
}

/** 'YYYY-MM-DD' menurut kalender Jakarta. */
export function tglLokal(nilai) {
  if (nilai instanceof Date) nilai = nilai.toISOString();
  const teks = String(nilai || '').trim();
  if (ISO_BERZONA.test(teks)) {
    const b = bagianJakarta(teks);
    if (b) return b.year + '-' + b.month + '-' + b.day;
  }
  return keYmd(teks);
}

export function tanggalBaris(item) {
  if (!item) return [];
  const tipe = String(item.tipe || '').trim();
  const mulai = tglLokal(item.tglMulai && item.tglMulai !== '-' ? item.tglMulai : '');
  const selesai = tglLokal(item.tglSelesai && item.tglSelesai !== '-' ? item.tglSelesai : '');

  if (TIPE_PENGAJUAN.indexOf(tipe) !== -1 && mulai) {
    return rentangTanggal(mulai, selesai || mulai, 400);
  }
  const t = mulai || tglLokal(item.waktu);
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
  // Hari DI LUAR hari kerja (Minggu / libur nasional) yang masih dalam
  // rentang. Tidak dihitung di angka mana pun, tapi kalau ada yang absen
  // di hari itu barisnya tetap disimpan supaya jamnya terbaca di rincian.
  const adaRentang = {};
  rentangTanggal(o.dari, o.sampai).forEach(function (t) { adaRentang[t] = true; });

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
      barisPer: {},
      hariOff: {},
      hadir: 0, standby: 0, izin: 0, tidakAbsen: 0, lengkap: 0,
      persenProduktif: 0
    };
    tanggal.forEach(function (t) { baris.sel[t] = STATUS.KOSONG; baris.barisPer[t] = []; });
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
    const ditolak = String(item.status || '').trim() === 'Rejected';

    const tipe = String(item.tipe || '').trim();
    tanggalBaris(item).forEach(function (t) {
      if (!adaTanggal[t]) {
        // Hari off: catat untuk dilihat, jangan dihitung. Hanya absen
        // harian — cuti panjang yang kebetulan melewati hari Minggu tidak
        // perlu memunculkan baris Minggu.
        if (adaRentang[t] && !ditolak &&
            (tipe === TIPE_HADIR || tipe === TIPE_PULANG || tipe === TIPE_STANDBY)) {
          if (!peta[id].hariOff[t]) peta[id].hariOff[t] = [];
          peta[id].hariOff[t].push(item);
        }
        return;
      }
      // Baris mentah disimpan untuk layar riwayat — termasuk yang
      // DITOLAK, supaya admin bisa melihat kenapa hari itu tetap kosong
      // padahal orangnya sempat mengajukan sesuatu.
      peta[id].barisPer[t].push(item);
      if (ditolak) return;
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
        // Absen PULANG saja sudah menjadikan hari itu hadir.
        //
        // "Tidak absen sama sekali" harus berarti benar-benar tidak ada
        // satu baris pun. Orang yang hari itu hanya sempat absen pulang
        // tetap mengabsen — menyebutnya tidak absen akan menaikkan angka
        // pelanggaran atas orang yang sebenarnya bekerja. Yang kurang
        // pada hari seperti itu adalah KELENGKAPANnya, dan itu memang
        // sudah ditangkap terpisah oleh `lengkap` di bawah.
        if (m.hadir || m.pulang) st = STATUS.HADIR;
        else if (m.standby) st = STATUS.STANDBY;
        else if (m.izin) st = STATUS.IZIN;
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

// ---------------------------------------------------------------------
// RIWAYAT PER ORANG — untuk jendela rincian di layar.
// ---------------------------------------------------------------------

/**
 * Kolom tabel -> tanggal-tanggal yang membentuk angkanya. Angka di tabel
 * dan daftar tanggal di jendela rincian HARUS berasal dari sumber yang
 * sama (b.sel / b.lengkapPer), supaya klik angka "4" selalu menampilkan
 * tepat empat tanggal.
 *
 *   semua    seluruh hari kerja + hari off yang ada absennya
 *   off      Minggu / libur yang ada absennya (tidak dihitung)
 *   hadir / standby / izin / tidak   menurut status hari itu
 *   lengkap  ada masuk DAN pulang
 *   sebelah  hadir tapi tidak lengkap (selisih Hadir − Lengkap)
 */
export const KOLOM_RINCIAN = ['semua', 'off', 'hadir', 'standby', 'izin', 'tidak', 'lengkap', 'sebelah'];

export function tanggalPerKolom(b, tanggal, kolom) {
  if (!b) return [];
  const sel = b.sel || {};
  const lk = b.lengkapPer || {};
  const off = Object.keys(b.hariOff || {});
  if (kolom === 'off') return off.sort();
  if (kolom === 'semua') return (tanggal || []).concat(off).sort();
  return (tanggal || []).filter(function (t) {
    switch (kolom) {
      case 'hadir': return sel[t] === STATUS.HADIR;
      case 'standby': return sel[t] === STATUS.STANDBY;
      case 'izin': return sel[t] === STATUS.IZIN;
      case 'tidak': return sel[t] === STATUS.KOSONG;
      case 'lengkap': return !!lk[t];
      case 'sebelah': return sel[t] === STATUS.HADIR && !lk[t];
      default: return true;
    }
  });
}

/**
 * Jam 'HH:MM' dari kolom Waktu. Kolom itu bisa datang sebagai teks
 * "dd/MM/yyyy HH:mm:ss" (yang ditulis backend) ATAU sebagai tanggal ISO
 * kalau Sheets sudah mengubah selnya jadi Date. ISO dengan zona (Z /
 * +07:00) dibaca dalam zona Asia/Jakarta; teks biasa diambil apa adanya.
 */
export function jamDari(waktu) {
  const teks = String(waktu || '').trim();
  if (!teks) return '';
  if (ISO_BERZONA.test(teks)) {
    const b = bagianJakarta(teks);
    if (b) return b.hour + ':' + b.minute;
  }
  const m = teks.match(/[ T](\d{1,2})[:.](\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
