// =======================================================
// BOARD ABSENSI — penyusun matriks rekap per tanggal
//
// Bentuknya mengikuti sheet BOARD pada BOARD_ABSENSI_2026:
//   https://docs.google.com/spreadsheets/d/1djRP-SZSMST5x1W_fZgViQdiMp1qUyFkDLFRAe3ekEM
//
// Satu baris per karyawan, satu PASANG kolom per tanggal (ABSEN | TELAT),
// lalu kolom hitung KETIDAKHADIRAN di kanan. Aturan penyusunannya disalin
// dari apps-script/BoardAbsensi.gs — file itu yang membangun sheet asli di
// spreadsheet, dan dua tempat yang menghitung hal yang sama harus memakai
// aturan yang sama. Kalau salah satunya diubah, ubah keduanya.
//
// SENGAJA TIDAK MEMANGGIL SERVER. Seluruh bahannya sudah ada di jawaban
// get_rekap_admin yang dipakai layar rekap: rawRecords (simbol harian) dan
// dashboardData (jabatan). Menambah permintaan kedua untuk data yang sudah
// ada di tangan hanya membuat layar ini menunggu dua kali.
// =======================================================

// Kolom kiri, persis KOL_INFO pada BoardAbsensi.gs.
//
// HRD, TGL MASUK, dan ATASAN LANGSUNG memang selalu kosong di sini: ketiganya
// hanya ada di tab induk "PEGAWAI AKTIF" pada spreadsheet sumber, tidak di
// sheet Users maupun dbabsen yang dibaca aplikasi ini. Kolomnya tetap ada
// supaya bentuk board — dan file yang di-export — sama dengan template.
// Begitu ketiga kolom itu tersedia di sheet Users, isinya tinggal dipetakan
// di susunBoard() tanpa mengubah apa pun di layar atau di export.
export const BOARD_KOLOM_INFO = [
  'NO', 'PAYROLL', 'HRD', 'NAMA', 'PT', 'TGL MASUK', 'JABATAN', 'ATASAN LANGSUNG', 'HARI KERJA'
];

// Kolom hitung di kanan, disalin dari template (CG:CK).
export const BOARD_KODE_HITUNG = [
  { kode: 'A', label: 'A', judul: 'Alpa' },
  { kode: 'C', label: 'C', judul: 'Cuti' },
  { kode: 'EO', label: 'EO', judul: 'Extra Ordinary' },
  { kode: 'O', label: 'O', judul: 'Off / Libur' },
  { kode: 'S', label: 'S', judul: 'Sakit' }
];

// Batas jumlah kolom tanggal. Rentang selebar setahun berarti 730 kolom
// tanggal — tabel yang tidak bisa dibaca siapa pun dan cukup berat untuk
// membekukan browser. Kalau rentangnya lebih lebar, yang dipotong adalah
// EKORNYA, dan pemanggil diberi tahu lewat `terpotong` supaya bisa bilang
// ke pengguna alih-alih diam-diam menampilkan setengah periode.
export const BOARD_MAKS_HARI = 120;

const SATU_HARI_MS = 86400000;

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const NAMA_BULAN_PANJANG = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * Menormalkan nilai tanggal apa pun menjadi 'YYYY-MM-DD'.
 *
 * Dipakai untuk DUA sumber yang bentuknya berbeda: rawRecords membawa
 * `tanggalYMD` yang sudah rapi, tapi juga `tanggal` dalam DD-MM-YYYY, dan
 * kotak filter di layar rekap mengirim YYYY-MM-DD. Yang tidak terbaca
 * dikembalikan sebagai string kosong — baris seperti itu dilewati, bukan
 * dijatuhkan ke tanggal hari ini.
 */
export function keYmd(nilai) {
  if (!nilai) return '';
  if (nilai instanceof Date) {
    if (isNaN(nilai.getTime())) return '';
    return nilai.toISOString().slice(0, 10);
  }
  const teks = String(nilai).trim();
  if (!teks) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(teks)) return teks.slice(0, 10);
  const m = teks.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  const d = new Date(teks);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' -> '21 Jul', label kolom tanggal seperti di template. */
export function labelTanggalPendek(ymd) {
  const b = String(ymd || '').split('-');
  if (b.length !== 3) return String(ymd || '');
  return String(Number(b[2])) + ' ' + (NAMA_BULAN[Number(b[1]) - 1] || b[1]);
}

/** 'YYYY-MM-DD' -> '21 Juli 2026', dipakai pada baris judul. */
export function labelTanggalPanjang(ymd) {
  const b = String(ymd || '').split('-');
  if (b.length !== 3) return String(ymd || '');
  return String(Number(b[2])) + ' ' + (NAMA_BULAN_PANJANG[Number(b[1]) - 1] || b[1]) + ' ' + b[0];
}

/**
 * Daftar tanggal berurutan dari `dari` s/d `sampai`, inklusif.
 *
 * Dihitung dalam UTC. Menambah 24 jam pada tanggal lokal akan MELEWATI satu
 * hari dua kali setahun di zona waktu yang punya DST — bukan masalah untuk
 * Asia/Jakarta hari ini, tapi kolom tanggal yang hilang diam-diam adalah
 * kegagalan yang tidak menimbulkan error apa pun, jadi lebih baik tidak
 * bergantung pada zona waktunya sama sekali.
 */
export function daftarTanggal(dariYmd, sampaiYmd, maksHari = BOARD_MAKS_HARI) {
  const a = keYmd(dariYmd);
  const b = keYmd(sampaiYmd);
  if (!a || !b) return { tanggal: [], terpotong: false };
  const mulai = Date.parse(a + 'T00:00:00Z');
  const akhir = Date.parse(b + 'T00:00:00Z');
  if (isNaN(mulai) || isNaN(akhir) || akhir < mulai) return { tanggal: [], terpotong: false };

  const total = Math.floor((akhir - mulai) / SATU_HARI_MS) + 1;
  const dipakai = Math.min(total, maksHari);
  const tanggal = [];
  for (let i = 0; i < dipakai; i++) {
    tanggal.push(new Date(mulai + i * SATU_HARI_MS).toISOString().slice(0, 10));
  }
  return { tanggal, terpotong: dipakai < total, totalHari: total };
}

/**
 * Membandingkan dua kode payroll secara "natural": huruf awalan dulu, lalu
 * angkanya sebagai ANGKA.
 *
 * Perbandingan string biasa tidak cukup. Kode payroll punya panjang angka
 * yang tidak seragam — di template ada G0071 dan ada 607 — dan
 * 'C0009' < 'C0010' memang benar secara string hanya SELAMA jumlah digitnya
 * sama. Begitu ada kode berdigit lain, urutannya diam-diam melenceng.
 *
 * Kode tanpa huruf awalan (2073, 2118) ditaruh SETELAH yang berhuruf.
 * Ini pilihan, bukan aturan yang bisa dibaca dari template: tiap blok PT di
 * sana selalu dibuka kode berhuruf, dan menempatkan kode telanjang di atas
 * akan mengubah baris pertama tiap blok.
 */
export function bandingPayroll(a, b) {
  const pecah = function (v) {
    const t = String(v || '').trim().toUpperCase();
    const m = t.match(/^([A-Z]*)0*(\d*)(.*)$/);
    if (!m) return { awalan: t, angka: 0, sisa: '', telanjang: true };
    return {
      awalan: m[1],
      angka: m[2] ? Number(m[2]) : 0,
      sisa: m[3] || '',
      telanjang: !m[1]
    };
  };
  const x = pecah(a);
  const y = pecah(b);
  if (x.telanjang !== y.telanjang) return x.telanjang ? 1 : -1;
  if (x.awalan !== y.awalan) return x.awalan < y.awalan ? -1 : 1;
  if (x.angka !== y.angka) return x.angka - y.angka;
  if (x.sisa !== y.sisa) return x.sisa < y.sisa ? -1 : 1;
  return 0;
}

/** Kunci karyawan. Urutannya sama dengan empSummary di handleGetRekapAdmin. */
function kunciKaryawan(payroll, noAkun, nama) {
  return String(payroll || noAkun || nama || '').trim().toLowerCase();
}

/**
 * Menyusun matriks board dari jawaban get_rekap_admin.
 *
 * @param {Object}   opsi
 * @param {Array}    opsi.records     rawRecords yang SUDAH disaring (tanggal, dept, pencarian)
 * @param {Array}    opsi.dashboard   dashboardData, dipakai mengisi JABATAN
 * @param {string}   opsi.dari        batas bawah rentang, 'YYYY-MM-DD' atau kosong
 * @param {string}   opsi.sampai      batas atas rentang, 'YYYY-MM-DD' atau kosong
 * @param {Function} [opsi.hitungDenda] (telat, nominal) -> angka denda
 * @returns {{tanggal: string[], baris: Array, judul: string, terpotong: boolean, totalHari: number}}
 */
export function susunBoard(opsi) {
  const records = (opsi && opsi.records) || [];
  const dashboard = (opsi && opsi.dashboard) || [];
  const hitungDenda = (opsi && opsi.hitungDenda) ||
    function (telat, nominal) { return Number(nominal) || 0; };

  // Rentang yang tidak disebut diambil dari datanya sendiri. Layar rekap
  // hampir selalu mengisi kotak tanggalnya (server memantulkan periode
  // aktif saat pertama dimuat), tapi board tidak boleh kosong hanya karena
  // admin sengaja mengosongkan filter untuk melihat seluruh periode.
  let dari = keYmd(opsi && opsi.dari);
  let sampai = keYmd(opsi && opsi.sampai);
  if (!dari || !sampai) {
    let min = '';
    let maks = '';
    for (let i = 0; i < records.length; i++) {
      const t = keYmd(records[i].tanggalYMD || records[i].tanggal);
      if (!t) continue;
      if (!min || t < min) min = t;
      if (!maks || t > maks) maks = t;
    }
    if (!dari) dari = min;
    if (!sampai) sampai = maks;
  }

  const { tanggal, terpotong, totalHari } = daftarTanggal(dari, sampai);
  const indeksTanggal = {};
  tanggal.forEach(function (t, i) { indeksTanggal[t] = i; });

  // JABATAN diambil dari dashboardData, bukan dari baris harian: baris
  // dbabsen tidak memuatnya sama sekali. Dipetakan lewat ketiga kunci yang
  // sama dengan yang dipakai server, supaya karyawan yang tercatat atas
  // nama no.akun tetap ketemu.
  const petaJabatan = {};
  dashboard.forEach(function (d) {
    const jab = String(d.jabatan || '').trim();
    if (!jab) return;
    [d.payroll, d.noAkun, d.nama].forEach(function (k) {
      const kk = String(k || '').trim().toLowerCase();
      if (kk && !petaJabatan[kk]) petaJabatan[kk] = jab;
    });
  });

  const orang = {};
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const kunci = kunciKaryawan(r.payroll, r.noAkun, r.nama);
    if (!kunci) continue;

    const ymd = keYmd(r.tanggalYMD || r.tanggal);
    if (!ymd) continue;
    const kolom = indeksTanggal[ymd];
    if (kolom === undefined) continue;   // di luar rentang, atau kena batas

    let o = orang[kunci];
    if (!o) {
      o = orang[kunci] = {
        payroll: String(r.payroll || r.noAkun || '').trim(),
        noAkun: String(r.noAkun || '').trim(),
        nama: String(r.nama || '').trim(),
        // Tiga kolom di bawah ini memang belum punya sumber di aplikasi.
        // Lihat catatan pada BOARD_KOLOM_INFO.
        hrd: '',
        tglMasuk: '',
        atasan: '',
        pt: String(r.departemen || '').trim(),
        jabatan: '',
        sel: new Array(tanggal.length).fill(null)
      };
      o.jabatan = petaJabatan[String(o.payroll).toLowerCase()] ||
                  petaJabatan[String(o.noAkun).toLowerCase()] ||
                  petaJabatan[String(o.nama).toLowerCase()] || '';
    }
    if (!o.pt && r.departemen) o.pt = String(r.departemen).trim();

    const denda = hitungDenda(r.telat, r.nominal);
    o.sel[kolom] = {
      absen: String(r.id2 || '').trim(),
      denda: denda > 0 ? Number(denda) : 0,
      koreksi: !!r.isKoreksi
    };
  }

  const baris = Object.keys(orang).map(function (k) { return orang[k]; });

  // URUTAN: PT dulu, lalu PAYROLL menaik.
  //
  // Diambil dari sheet BOARD template, bukan dari tab Dashboard. Blok KCM
  // dan SPT di sana berurut payroll persis (C0009, C0010, C0018, C0019,
  // C0033, ...), dan itu pola yang berlaku di hampir seluruh sheet.
  //
  // Blok BSL adalah satu-satunya yang menyimpang (A0009, A0012, E0071,
  // C0094, H0005, A0013, ...). Urutan itu tidak mengikuti payroll, nama,
  // maupun tanggal masuk — kemungkinan besar disusun tangan dan tidak
  // pernah dirapikan. TIDAK ditiru di sini: menyalin urutan yang tidak
  // punya aturan berarti tidak ada yang bisa menebak di mana sebuah nama
  // akan muncul.
  //
  // Nama dipakai sebagai pemutus seri supaya dua orang dengan payroll yang
  // sama persis tidak bertukar tempat tiap kali board disusun ulang.
  baris.sort(function (a, b) {
    return String(a.pt || '').localeCompare(String(b.pt || '')) ||
           bandingPayroll(a.payroll, b.payroll) ||
           String(a.nama || '').localeCompare(String(b.nama || ''));
  });

  baris.forEach(function (o, i) {
    o.no = i + 1;

    // HARI KERJA: hari yang punya simbol dan simbolnya bukan O (libur
    // jadwal). Aturan ini disalin apa adanya dari BoardAbsensi.gs.
    let hariKerja = 0;
    const hitung = {};
    BOARD_KODE_HITUNG.forEach(function (k) { hitung[k.kode] = 0; });

    let totalDenda = 0;
    for (let d = 0; d < tanggal.length; d++) {
      const sel = o.sel[d];
      if (!sel || !sel.absen) continue;
      const sym = sel.absen.toUpperCase();
      if (sym !== 'O') hariKerja++;
      if (hitung[sym] !== undefined) hitung[sym]++;
      totalDenda += sel.denda || 0;
    }
    o.hariKerja = hariKerja;
    o.hitung = hitung;
    o.totalDenda = totalDenda;
  });

  const judul = tanggal.length
    ? 'Absensi Karyawan Periode ' + labelTanggalPanjang(tanggal[0]) +
      ' s/d ' + labelTanggalPanjang(tanggal[tanggal.length - 1])
    : 'Absensi Karyawan — rentang tanggal belum terisi';

  return { tanggal, baris, judul, terpotong: !!terpotong, totalHari: totalHari || 0 };
}

/**
 * Mengubah hasil susunBoard() menjadi array-of-arrays siap XLSX, lengkap
 * dengan daftar merge dan lebar kolom.
 *
 * Tata letaknya: baris 1 judul, baris 2 header (kolom info digabung ke
 * bawah, tanggal digabung ke samping 2 kolom), baris 3 ABSEN/TELAT.
 */
export function boardKeSheet(board) {
  const tanggal = board.tanggal || [];
  const lebarInfo = BOARD_KOLOM_INFO.length;
  const lebarTotal = lebarInfo + tanggal.length * 2 + BOARD_KODE_HITUNG.length;
  const kosong = function () { return new Array(lebarTotal).fill(''); };

  const r1 = kosong();
  r1[0] = board.judul;

  const r2 = kosong();
  const r3 = kosong();
  BOARD_KOLOM_INFO.forEach(function (h, i) { r2[i] = h; });
  tanggal.forEach(function (t, i) {
    r2[lebarInfo + i * 2] = labelTanggalPendek(t);
    r3[lebarInfo + i * 2] = 'ABSEN';
    r3[lebarInfo + i * 2 + 1] = 'TELAT';
  });
  const awalHitung = lebarInfo + tanggal.length * 2;
  BOARD_KODE_HITUNG.forEach(function (k, i) {
    r2[awalHitung + i] = 'KETIDAKHADIRAN';
    r3[awalHitung + i] = k.label;
  });

  const aoa = [r1, r2, r3];
  (board.baris || []).forEach(function (o) {
    const b = kosong();
    b[0] = o.no;
    b[1] = o.payroll || '';
    b[2] = o.hrd || '';
    b[3] = o.nama || '';
    b[4] = o.pt || '';
    b[5] = o.tglMasuk || '';
    b[6] = o.jabatan || '';
    b[7] = o.atasan || '';
    b[8] = o.hariKerja;
    for (let i = 0; i < tanggal.length; i++) {
      const sel = o.sel[i];
      b[lebarInfo + i * 2] = sel && sel.absen ? sel.absen : '';
      b[lebarInfo + i * 2 + 1] = sel && sel.denda ? sel.denda : '';
    }
    BOARD_KODE_HITUNG.forEach(function (k, j) {
      b[awalHitung + j] = o.hitung[k.kode] || 0;
    });
    aoa.push(b);
  });

  // Merge: kolom info digabung baris 2-3, tiap tanggal digabung 2 kolom di
  // baris 2, dan KETIDAKHADIRAN digabung selebar kode hitungnya.
  const merges = [];
  for (let c = 0; c < lebarInfo; c++) {
    merges.push({ s: { r: 1, c: c }, e: { r: 2, c: c } });
  }
  for (let i = 0; i < tanggal.length; i++) {
    merges.push({ s: { r: 1, c: lebarInfo + i * 2 }, e: { r: 1, c: lebarInfo + i * 2 + 1 } });
  }
  if (BOARD_KODE_HITUNG.length > 1) {
    merges.push({ s: { r: 1, c: awalHitung }, e: { r: 1, c: awalHitung + BOARD_KODE_HITUNG.length - 1 } });
  }

  // Judul SENGAJA tidak digabung selebar tabel — sel di kanannya kosong,
  // jadi teksnya tetap terbaca penuh, dan pembekuan panel (kalau kelak
  // ditambahkan) tidak akan memotong sel gabungan. Alasan yang sama
  // tercatat di BoardAbsensi.gs.

  const lebarKolom = [
    { wpx: 38 },   // NO
    { wpx: 76 },   // PAYROLL
    { wpx: 52 },   // HRD
    { wpx: 190 },  // NAMA
    { wpx: 78 },   // PT
    { wpx: 86 },   // TGL MASUK
    { wpx: 168 },  // JABATAN
    { wpx: 140 },  // ATASAN LANGSUNG
    { wpx: 62 }    // HARI KERJA
  ];
  for (let i = 0; i < tanggal.length; i++) {
    lebarKolom.push({ wpx: 34 }, { wpx: 52 });
  }
  BOARD_KODE_HITUNG.forEach(function () { lebarKolom.push({ wpx: 38 }); });

  return { aoa, merges, lebarKolom, lebarInfo, lebarTotal };
}
