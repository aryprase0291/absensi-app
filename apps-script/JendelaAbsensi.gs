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

const JENDELA_PROP_AWALAN = 'ABSROW_V1_';

// Margin mundur untuk hitungStats & cek duplikat.
//
// Sebuah baris bisa jatuh di dalam periode aktif walaupun waktu inputnya
// jauh lebih awal — cuti yang diajukan berbulan-bulan sebelumnya adalah
// contohnya. 180 hari dipilih supaya pengajuan paling maju sekalipun
// tetap ikut terbaca, dan tetap memotong sheet yang umurnya bertahun.
//
// MENAIKKAN angka ini selalu aman (hanya membaca lebih banyak).
// MENURUNKANNYA berisiko: pengajuan yang diajukan lebih awal dari margin
// akan hilang dari statistik tanpa error apa pun.
const JENDELA_MARGIN_HARI = 180;

const JENDELA_MS_HARI = 24 * 60 * 60 * 1000;

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
  // Zona waktu skrip disisipkan lewat formatDate supaya tidak bergantung
  // pada zona waktu server Google yang menjalankan eksekusi ini.
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
 * Pencarian biner: nomor baris PERTAMA yang waktunya >= batasMs.
 * Mengembalikan 2 (baca penuh) bila ada sel waktu yang tidak terbaca —
 * pada data berlubang, pencarian biner tidak bisa dipercaya.
 * @private
 */
function _jabCariBaris_(sheet, batasMs, lastRow) {
  if (lastRow < 2) return lastRow + 1;

  let lo = 2;
  let hi = lastRow;
  let jawab = lastRow + 1;
  let pengaman = 0;

  // Sisa rentang yang lebih kecil dari ini diselesaikan dengan SATU
  // pembacaan blok, bukan diteruskan membelah. Enam langkah biner
  // terakhir masing-masing memakai satu round trip Sheets; membaca 64
  // sel sekaligus jauh lebih murah daripada enam kali membaca 1 sel.
  const BLOK = 64;

  while (lo <= hi && pengaman++ < 60) {
    if (hi - lo < BLOK) {
      const nilai = sheet.getRange(lo, 2, hi - lo + 1, 1).getValues();
      for (let i = 0; i < nilai.length; i++) {
        const ms = _jabWaktuMs_(nilai[i][0]);
        if (ms === null) return 2; // ada lubang -> jangan menebak, baca penuh
        if (ms >= batasMs) return lo + i;
      }
      return jawab;
    }

    const tengah = Math.floor((lo + hi) / 2);
    const ms = _jabWaktuMs_(sheet.getRange(tengah, 2).getValue());
    if (ms === null) return 2; // ada lubang -> jangan menebak, baca penuh
    if (ms >= batasMs) { jawab = tengah; hi = tengah - 1; }
    else { lo = tengah + 1; }
  }
  return jawab;
}

/**
 * Nomor baris awal jendela untuk sebuah tanggal, lewat simpanan yang
 * selalu diverifikasi ulang.
 *
 * Verifikasinya: baris (r-1) harus MASIH di bawah batas dan baris r harus
 * MASIH di atas batas. Kalau salah satu tidak lagi benar — misalnya
 * karena ada baris dihapus di tengah — pencarian biner diulang.
 */
function jendelaBarisAbsensi_(sheet, tanggalYmd) {
  if (!sheet) return 2;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2;

  const batasMs = _jabBatasMs_(tanggalYmd);
  if (batasMs === null) return 2; // tanggal tidak dikenal -> baca penuh

  const kunci = JENDELA_PROP_AWALAN + tanggalYmd;

  // --- Jalur cepat: simpanan yang masih terbukti benar ---------------
  try {
    const simpan = (typeof _propGetCepat_ === 'function')
      ? _propGetCepat_(kunci)
      : PropertiesService.getScriptProperties().getProperty(kunci);
    const r = Number(simpan);
    if (isFinite(r) && r >= 2 && r <= lastRow + 1) {
      if (r === 2) {
        // Klaim "seluruh sheet masuk jendela": cukup periksa baris 2.
        const ms = _jabWaktuMs_(sheet.getRange(2, 2).getValue());
        if (ms !== null && ms >= batasMs) return 2;
      } else if (r === lastRow + 1) {
        const ms = _jabWaktuMs_(sheet.getRange(lastRow, 2).getValue());
        if (ms !== null && ms < batasMs) return r;
      } else {
        const dua = sheet.getRange(r - 1, 2, 2, 1).getValues();
        const sebelum = _jabWaktuMs_(dua[0][0]);
        const ini = _jabWaktuMs_(dua[1][0]);
        if (sebelum !== null && ini !== null && sebelum < batasMs && ini >= batasMs) return r;
      }
    }
  } catch (e) { /* simpanan rusak: hitung ulang */ }

  // --- Jalur lengkap: pencarian biner --------------------------------
  const jawab = _jabCariBaris_(sheet, batasMs, lastRow);
  try {
    PropertiesService.getScriptProperties().setProperty(kunci, String(jawab));
    if (typeof _propLupakanSatuan_ === 'function') _propLupakanSatuan_(kunci);
  } catch (e) { /* kuota properti penuh: tetap jalan, hanya tidak hemat */ }
  return jawab;
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

/**
 * Membuang seluruh simpanan batas jendela.
 *
 * WAJIB dipanggil setelah baris sheet Absensi DIHAPUS. Sebenarnya
 * verifikasi di jendelaBarisAbsensi_ sudah menangkapnya sendiri, tetapi
 * membersihkan di tempat kejadian membuat pemanggil berikutnya tidak
 * perlu membayar satu pencarian biner.
 */
function ABSENSI_JENDELA_BERSIHKAN() {
  try {
    const props = PropertiesService.getScriptProperties();
    const semua = props.getProperties();
    Object.keys(semua).forEach(function (k) {
      if (k.indexOf(JENDELA_PROP_AWALAN) === 0) props.deleteProperty(k);
    });
    if (typeof _propsLupakan_ === 'function') _propsLupakan_();
  } catch (e) {
    console.warn('Gagal membersihkan jendela Absensi: ' + e.message);
  }
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

  const t0 = new Date().getTime();
  const penuh = bacaSheet(sheet, 13);
  const t1 = new Date().getTime();

  ABSENSI_JENDELA_BERSIHKAN();
  const dingin = bacaAbsensiPeriode_(sheet, periode, 13);
  const t2 = new Date().getTime();
  const panas = bacaAbsensiPeriode_(sheet, periode, 13);
  const t3 = new Date().getTime();

  // Setiap baris di dalam periode HARUS ikut terbawa jendela.
  let hilang = 0;
  let contoh = '';
  for (let i = 1; i < penuh.length; i++) {
    const mulaiBaris = formatDateYMD_Strict(
      penuh[i][8] && penuh[i][8] !== '-' ? penuh[i][8] : penuh[i][1]);
    const selesaiBaris = formatDateYMD_Strict(
      penuh[i][9] && penuh[i][9] !== '-' ? penuh[i][9] : mulaiBaris);
    const masuk = !!mulaiBaris && !!selesaiBaris &&
      !(selesaiBaris < periode.mulai || mulaiBaris > periode.selesai);
    if (!masuk) continue;
    const barisSheet = i + 1;
    if (barisSheet < panas.offsetBaris) {
      hilang++;
      if (!contoh) contoh = 'baris ' + barisSheet + ' (' + mulaiBaris + ')';
    }
  }

  console.log(
    'Sheet Absensi: ' + lastRow + ' baris. Periode ' + periode.mulai + ' s/d ' + periode.selesai + '\n' +
    'Baca penuh   : ' + (penuh.length - 1) + ' baris, ' + (t1 - t0) + ' ms\n' +
    'Jendela dingin: ' + dingin.baris.length + ' baris (mulai ' + dingin.offsetBaris + '), ' + (t2 - t1) + ' ms\n' +
    'Jendela panas : ' + panas.baris.length + ' baris (mulai ' + panas.offsetBaris + '), ' + (t3 - t2) + ' ms\n' +
    'Baris periode yang TERLEWAT: ' + hilang + (contoh ? ' — contoh ' + contoh : '')
  );
  console.log(hilang === 0 ? '>>> BERHASIL: tidak ada baris periode yang terlewat.'
                           : '>>> GAGAL: naikkan JENDELA_MARGIN_HARI.');
}
