// =====================================================================
// JENDELA BACA SHEET ABSENSI (Sep 2026)
//
// MASALAH YANG DIPERBAIKI
//
// Sheet `Absensi` bersifat APPEND-ONLY dan hanya bertambah. Tiga jalur
// terpanas aplikasi ini membacanya UTUH setiap kali dipanggil:
//
//   hitungStats()        -> setiap kali dashboard dibuka  (setiap karyawan,
//                           setiap pagi)
//   handleAbsen()        -> setiap pengajuan form (cek duplikat & kuota Ijin)
//   handleEditAbsen()    -> setiap edit/hapus pengajuan
//
// Biaya ketiganya tumbuh mengikuti UMUR sheet, bukan jumlah data yang
// sebenarnya dipakai. Itulah kenapa aplikasi terasa "makin lama makin
// lambat" padahal tidak ada fitur baru yang ditambahkan: sheetnya yang
// makin panjang, dan setiap barisnya dibaca ulang oleh setiap orang.
//
// Padahal ketiganya hanya membutuhkan potongan kecil di UJUNG sheet:
//   - hitungStats hanya memakai baris yang jatuh di dalam periode aktif;
//     semua yang di luar periode dibuang oleh penjaga `masukPeriode`.
//   - handleAbsen hanya membandingkan dengan pengajuan di periode kuota
//     yang sedang dinilai.
//   - handleEditAbsen/handleDeleteAbsen dibatasi 1 jam sejak input, jadi
//     mustahil menyentuh baris yang lebih tua dari itu.
//
// CARA KERJA
//
// Kolom B (Waktu Input) selalu menaik karena setiap baris baru masuk
// lewat appendRow — tidak ada satu pun handler yang menulis ulang kolom
// itu (sudah diperiksa: handleEditAbsen menyentuh kolom G, I, J, K, L;
// handleUpdateAbsensi kolom E). Karena menaik, baris pertama yang
// waktunya >= sebuah tanggal bisa dicari dengan PENCARIAN BINER:
// ~14 pembacaan satu sel untuk 15.000 baris, bukan 15.000 x 13 sel.
//
// Hasilnya disimpan di Script Properties dan DIVERIFIKASI setiap dipakai
// (satu pembacaan 2 sel). Verifikasi itu yang membuatnya aman terhadap
// penghapusan baris: kalau batasnya sudah tidak tepat, pencarian biner
// diulang. Tidak ada jalur yang bisa menghasilkan data kurang secara
// diam-diam — kegagalan apa pun berakhir dengan membaca sheet PENUH,
// yaitu perilaku lama.
//
// ATURAN YANG TIDAK BOLEH DILANGGAR
//
// 1. Fungsi di sini TIDAK PERNAH mengubah hasil perhitungan. Ia hanya
//    memotong baris yang pasti tidak dipakai pemanggilnya. Kalau ragu,
//    ia mengembalikan lebih banyak baris, bukan lebih sedikit.
// 2. Pemanggil yang butuh NOMOR BARIS SHEET wajib memakai `offsetBaris`
//    dari kembalian, bukan `i + 1` seperti saat membaca dari baris 1.
// =====================================================================

// Margin mundur untuk hitungStats & cek duplikat.
//
// Sebuah baris bisa jatuh di dalam periode aktif walaupun waktu inputnya
// jauh lebih awal — cuti yang diajukan berbulan-bulan sebelumnya adalah
// contohnya. Margin inilah yang menjamin baris seperti itu tetap terbaca.
//
// MENAIKKAN angka ini selalu aman (hanya membaca lebih banyak).
// MENURUNKANNYA berisiko: pengajuan yang dikirim lebih awal dari margin
// akan hilang dari statistik tanpa error apa pun.
//
// JANGAN menebak saat mengubahnya. JENDELA_UJI() melaporkan jarak
// terjauh yang BENAR-BENAR pernah terjadi di spreadsheet ini
// ("selisih terjauh"), dan angka itulah dasar yang sah.
const JENDELA_MARGIN_HARI = 180;

const JENDELA_MS_HARI = 24 * 60 * 60 * 1000;

// Berapa baris ekor yang dibaca pada percobaan pertama saat mencari
// batas jendela. Lihat catatan biaya di jendelaBarisAbsensi_.
const JENDELA_EKOR_AWAL = 1500;

/**
 * Nilai kolom Waktu menjadi milidetik. null kalau tidak bisa dibaca.
 * @private
 */
function _jabWaktuMs_(nilai) {
  if (nilai instanceof Date) {
    const t = nilai.getTime();
    return isNaN(t) ? null : t;
  }
  if (nilai === '' || nilai === null || nilai === undefined) return null;
  const t = new Date(nilai).getTime();
  return isNaN(t) ? null : t;
}

/**
 * Tengah malam tanggal YYYY-MM-DD menurut zona waktu skrip.
 * Dipakai sebagai batas bawah jendela.
 * @private
 */
function _jabBatasMs_(tanggalYmd) {
  const teks = String(tanggalYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const nol = new Date(teks + 'T00:00:00Z');
  if (isNaN(nol.getTime())) return null;

  // Selisih zona waktu skrip terhadap UTC, diukur PADA TANGGAL ITU —
  // bukan ditebak dari jamnya saja. Menebak dari jam gagal untuk zona
  // di luar UTC+12, dan kalau gagal jendela bisa mulai satu hari terlalu
  // belakang, yaitu satu-satunya cara fungsi ini bisa menghilangkan
  // baris tanpa ketahuan.
  let geserMs = 0;
  try {
    const lokal = Utilities.formatDate(nol, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    const t = new Date(lokal + 'Z').getTime();
    if (!isNaN(t)) geserMs = t - nol.getTime();
  } catch (e) { geserMs = 0; }

  return nol.getTime() - geserMs;
}

/**
 * Nomor baris PERTAMA yang waktu inputnya >= tanggal.
 *
 * KENAPA MEMBACA EKOR, BUKAN PENCARIAN BINER (dikoreksi 18 Sep 2026)
 *
 * Versi pertama memakai pencarian biner: ~10 pembacaan satu sel untuk
 * 20.000 baris, dan itu terdengar hemat. Ternyata salah, dan PROFILE_SHEETS
 * di spreadsheet produksi yang membuktikannya:
 *
 *     Announcements      9 baris x  4 kolom =     36 sel -> 214 ms
 *     MasterData        55 baris x  7 kolom =    385 sel -> 188 ms
 *     Users            307 baris x 18 kolom =  5.526 sel -> 247 ms
 *
 * 36 sel dan 5.526 sel memakan waktu hampir sama. Artinya biaya membaca
 * sheet hampir seluruhnya adalah ONGKOS PER PANGGILAN (~200 ms), bukan
 * jumlah selnya. Pencarian biner menukar sedikit sel dengan BANYAK
 * panggilan — persis arah yang salah: 10 panggilan = ~2 detik, dan itu
 * dibayar setiap kali batasnya belum tersimpan.
 *
 * Yang dipakai sekarang: membaca EKOR kolom B sekali jalan, digandakan
 * kalau ternyata kurang jauh. Satu panggilan untuk kasus biasa
 * (~200 ms), dua untuk jendela yang lebar. Tidak ada simpanan yang perlu
 * diverifikasi atau dibersihkan saat ada baris dihapus — penyederhanaan
 * ini sekaligus menghapus satu sumber bug.
 *
 * Kalau sheet Absensi kelak melewati ~50.000 baris, tinjau ulang: pada
 * ukuran itu ongkos selnya mulai menyaingi ongkos panggilan.
 */
function jendelaBarisAbsensi_(sheet, tanggalYmd) {
  if (!sheet) return 2;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2;

  const batasMs = _jabBatasMs_(tanggalYmd);
  if (batasMs === null) return 2; // tanggal tidak dikenal -> baca penuh

  // Percobaan pertama: ekor saja. Kalau ternyata kurang jauh, percobaan
  // KEDUA langsung membaca seluruh kolom B — tidak digandakan
  // bertahap. Menggandakan terdengar lebih hemat sel, tapi setiap
  // penggandaan adalah satu panggilan lagi seharga ~200 ms, dan pada
  // sheet 20.000 baris tiga panggilan bertahap justru lebih lambat
  // daripada dua panggilan yang salah satunya membaca semuanya.
  // Jadi: paling banyak DUA panggilan, apa pun ukuran sheetnya.
  for (let putaran = 0; putaran < 2; putaran++) {
    const mulai = putaran === 0 ? Math.max(2, lastRow - JENDELA_EKOR_AWAL + 1) : 2;
    const jml = lastRow - mulai + 1;
    const nilai = sheet.getRange(mulai, 2, jml, 1).getValues();

    let ketemu = -1;
    for (let i = 0; i < jml; i++) {
      const ms = _jabWaktuMs_(nilai[i][0]);
      // Sel waktu yang tidak terbaca TIDAK boleh dilewati: kita tidak
      // bisa membuktikan baris itu di luar jendela, jadi ia dianggap
      // masuk. Selalu ke arah membaca LEBIH BANYAK, tidak pernah kurang.
      if (ms === null || ms >= batasMs) { ketemu = i; break; }
    }

    // Tidak ada satu pun baris di dalam jendela. Karena kolom B menaik,
    // baris yang lebih tua pasti lebih jauh lagi dari batas — tidak perlu
    // membaca ke atas.
    if (ketemu === -1) return lastRow + 1;

    // Ketemu di baris paling atas yang dibaca padahal di atasnya masih
    // ada baris lain: batas sebenarnya bisa lebih tinggi lagi, jadi baca
    // seluruh kolom pada putaran berikutnya.
    if (ketemu === 0 && mulai > 2) continue;

    return mulai + ketemu;
  }

  return 2; // tidak sempat dipastikan -> baca penuh, seperti perilaku lama
}

/**
 * Membaca sheet Absensi HANYA dari baris yang waktunya >= tanggal.
 *
 * @param {Sheet} sheet     sheet Absensi
 * @param {string} tanggalYmd batas bawah, format YYYY-MM-DD
 * @param {number} jmlKolom jumlah kolom yang benar-benar dipakai pemanggil
 * @return {{baris: Array<Array>, offsetBaris: number}}
 *         `offsetBaris` = nomor baris sheet untuk elemen ke-0.
 *         Baris judul TIDAK ikut.
 */
function bacaAbsensiSejak_(sheet, tanggalYmd, jmlKolom) {
  const kosong = { baris: [], offsetBaris: 2 };
  if (!sheet) return kosong;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return kosong;

  const mulai = jendelaBarisAbsensi_(sheet, tanggalYmd);
  if (mulai > lastRow) return kosong;

  const kolom = jmlKolom
    ? Math.min(jmlKolom, sheet.getMaxColumns())
    : Math.max(sheet.getLastColumn(), 1);

  return {
    baris: sheet.getRange(mulai, 1, lastRow - mulai + 1, kolom).getValues(),
    offsetBaris: mulai
  };
}

/**
 * Jendela untuk sebuah periode absensi, sudah termasuk margin mundur.
 * Inilah yang dipakai hitungStats dan cek duplikat handleAbsen.
 */
function bacaAbsensiPeriode_(sheet, periode, jmlKolom) {
  let tanggal = '';
  try {
    const mulai = periode && periode.mulai ? String(periode.mulai) : '';
    const d = new Date(mulai + 'T00:00:00Z');
    if (!isNaN(d.getTime())) {
      tanggal = new Date(d.getTime() - JENDELA_MARGIN_HARI * JENDELA_MS_HARI)
        .toISOString().slice(0, 10);
    }
  } catch (e) { tanggal = ''; }

  // Periode tidak terbaca -> baca penuh, sama seperti sebelum ada file ini.
  return bacaAbsensiSejak_(sheet, tanggal, jmlKolom);
}

/**
 * Jendela beberapa JAM ke belakang. Dipakai handleEditAbsen /
 * handleDeleteAbsen yang memang hanya boleh menyentuh baris muda.
 */
function bacaAbsensiJamTerakhir_(sheet, jumlahJam, jmlKolom) {
  const mundurMs = Math.max(1, Number(jumlahJam) || 1) * 60 * 60 * 1000;
  let tanggal = '';
  try {
    // Dibulatkan ke tanggal karena batas jendela memang bertingkat hari.
    // Selalu mundur satu hari ekstra supaya baris tepat di batas tengah
    // malam tidak pernah terlewat.
    tanggal = new Date(Date.now() - mundurMs - JENDELA_MS_HARI)
      .toISOString().slice(0, 10);
  } catch (e) { tanggal = ''; }
  return bacaAbsensiSejak_(sheet, tanggal, jmlKolom);
}

// =====================================================================
// DIAGNOSA — jalankan dari editor Apps Script
// =====================================================================

/**
 * Membuktikan bahwa jendela TIDAK menghilangkan satu baris pun yang
 * dipakai hitungStats: membandingkan hasil baca penuh dengan hasil
 * jendela untuk periode aktif, baris per baris.
 */
function JENDELA_UJI() {
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  if (!sheet) { console.log('Sheet Absensi tidak ada.'); return; }

  const periode = getPeriodeAbsenAktif_();
  const lastRow = sheet.getLastRow();
  const batasPeriodeMs = _jabBatasMs_(periode.mulai);

  const t0 = new Date().getTime();
  const penuh = bacaSheet(sheet, 13);
  const t1 = new Date().getTime();
  const jendela = bacaAbsensiPeriode_(sheet, periode, 13);
  const t2 = new Date().getTime();

  // --- Pemeriksaan 1: adakah baris periode yang terlewat? -----------
  // --- Pemeriksaan 2: berapa hari SEBENARNYA margin yang dibutuhkan?
  //
  // Pemeriksaan kedua inilah yang membuat JENDELA_MARGIN_HARI tidak
  // perlu ditebak. Untuk setiap baris yang jatuh di dalam periode, ia
  // menghitung berapa hari SEBELUM periode dimulai baris itu diinput.
  // Yang terbesar = margin minimum yang sah untuk data ini.
  let hilang = 0;
  let contoh = '';
  let selisihTerjauh = 0;
  let barisTerjauh = '';
  let jumlahDiPeriode = 0;

  // Pemeriksaan 3: SELURUH kolom B harus terisi tanggal yang terbaca.
  //
  // Seluruh keamanan jendela bersandar pada satu hal: kolom B menaik dan
  // selalu terisi, karena setiap baris masuk lewat appendRow. Baris yang
  // kolom B-nya dikosongkan manual di sheet TIDAK bisa dinilai posisinya,
  // dan kalau letaknya jauh di atas jendela ia bisa terlewat tanpa error.
  // Karena itu jumlahnya dihitung dan dilaporkan — bukan diasumsikan nol.
  let waktuKosong = 0;
  let contohKosong = '';

  for (let i = 1; i < penuh.length; i++) {
    if (_jabWaktuMs_(penuh[i][1]) === null) {
      waktuKosong++;
      if (!contohKosong) contohKosong = 'baris ' + (i + 1);
    }
    const mulaiBaris = formatDateYMD_Strict(
      penuh[i][8] && penuh[i][8] !== '-' ? penuh[i][8] : penuh[i][1]);
    const selesaiBaris = formatDateYMD_Strict(
      penuh[i][9] && penuh[i][9] !== '-' ? penuh[i][9] : mulaiBaris);
    const masuk = !!mulaiBaris && !!selesaiBaris &&
      !(selesaiBaris < periode.mulai || mulaiBaris > periode.selesai);
    if (!masuk) continue;

    jumlahDiPeriode++;
    const barisSheet = i + 1;

    if (barisSheet < jendela.offsetBaris) {
      hilang++;
      if (!contoh) contoh = 'baris ' + barisSheet + ' (' + mulaiBaris + ')';
    }

    const inputMs = _jabWaktuMs_(penuh[i][1]);
    if (inputMs !== null && batasPeriodeMs !== null) {
      const hari = Math.ceil((batasPeriodeMs - inputMs) / JENDELA_MS_HARI);
      if (hari > selisihTerjauh) {
        selisihTerjauh = hari;
        barisTerjauh = 'baris ' + barisSheet + ' (' + mulaiBaris + ')';
      }
    }
  }

  const persen = lastRow > 1
    ? Math.round(jendela.baris.length * 100 / (lastRow - 1)) : 0;

  console.log(
    'Sheet Absensi : ' + (lastRow - 1) + ' baris data\n' +
    'Periode aktif : ' + periode.mulai + ' s/d ' + periode.selesai +
      '  (' + jumlahDiPeriode + ' baris di dalamnya)\n' +
    '\n' +
    'Baca PENUH    : ' + (penuh.length - 1) + ' baris, ' + (t1 - t0) + ' ms\n' +
    'Baca JENDELA  : ' + jendela.baris.length + ' baris (' + persen + '%), ' +
      (t2 - t1) + ' ms, mulai baris ' + jendela.offsetBaris + '\n' +
    'Hemat         : ' + ((t1 - t0) - (t2 - t1)) + ' ms\n' +
    '\n' +
    'Baris periode yang TERLEWAT : ' + hilang + (contoh ? ' — contoh ' + contoh : '') + '\n' +
    'Kolom B kosong/tak terbaca  : ' + waktuKosong + (contohKosong ? ' — contoh ' + contohKosong : '') + '\n' +
    'Margin terpakai sekarang    : ' + JENDELA_MARGIN_HARI + ' hari\n' +
    'Selisih terjauh sebenarnya  : ' + selisihTerjauh + ' hari' +
      (barisTerjauh ? ' (' + barisTerjauh + ')' : '')
  );

  console.log('');
  if (hilang > 0) {
    console.log('>>> GAGAL: ada baris periode yang tidak ikut terbaca.');
    console.log('>>> Naikkan JENDELA_MARGIN_HARI menjadi minimal ' + (selisihTerjauh + 30) + '.');
    return;
  }

  if (waktuKosong > 0) {
    console.log('>>> PERHATIAN: ada ' + waktuKosong + ' baris yang kolom B-nya tidak');
    console.log('>>> terbaca sebagai tanggal. Jendela memakai kolom itu untuk');
    console.log('>>> menentukan batas, jadi baris seperti ini sebaiknya');
    console.log('>>> diperbaiki di sheet (isi Waktu Input-nya) atau dihapus.');
    console.log('');
  }

  console.log('>>> BENAR: tidak ada baris periode yang terlewat.');
  if (selisihTerjauh + 60 < JENDELA_MARGIN_HARI) {
    console.log('>>> Margin ' + JENDELA_MARGIN_HARI + ' hari jauh lebih lebar daripada');
    console.log('>>> yang dibutuhkan data ini (' + selisihTerjauh + ' hari). Menurunkannya ke');
    console.log('>>> ' + (selisihTerjauh + 60) + ' hari akan mempersempit jendela tanpa kehilangan');
    console.log('>>> satu baris pun — tetapi ingat angka itu hanya berlaku');
    console.log('>>> untuk data yang ADA SEKARANG. Sisakan kelonggaran untuk');
    console.log('>>> pengajuan yang lebih maju dari apa pun yang pernah terjadi.');
  }
  if ((t1 - t0) - (t2 - t1) < 100) {
    console.log('>>> CATATAN: penghematannya masih kecil. Pada ukuran sheet');
    console.log('>>> sekarang itu wajar — nilai jendela ini terutama menahan');
    console.log('>>> biaya agar tidak ikut tumbuh saat sheet makin panjang.');
  }
}
