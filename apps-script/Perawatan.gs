// =======================================================
// PERAWATAN SPREADSHEET
// File: Perawatan.gs
//
// Dua fungsi yang dijalankan MANUAL dari editor Apps Script.
// Tidak dipanggil dari doPost, jadi tidak memengaruhi aplikasi.
//
// Latar belakang (12 Agu 2026): sheet `dbabsen` ditemukan punya 66.946
// baris untuk 6.720 baris data — 60.226 baris kosong yang tetap ikut
// terformat. Penyebabnya, rutinitas import memakai clearContent()
// (menghapus isi, bukan baris) dan insertRowsAfter() (hanya menambah),
// jadi sheet hanya bisa memanjang. Sudah ditambal di ImportDbAbsen.gs;
// file ini untuk membersihkan sisa yang terlanjur menumpuk.
// =======================================================

const PERAWATAN_SHEETS = [
  'dbabsen', 'Absensi', 'Remarks', 'Users', 'MASTER-CUTI',
  'running shift', 'db-tally', 'Online'
];

// Berapa baris kosong yang sengaja disisakan sebagai ruang gerak.
const PERAWATAN_BUFFER_BARIS = 200;

/**
 * READ-ONLY. Menampilkan seberapa besar tiap sheet menurut Sheets,
 * dan berapa yang sebenarnya terpakai.
 *
 * Yang perlu diperhatikan di log:
 *   - "baris nganggur" besar  -> sheet membengkak, jalankan RAPIKAN_SHEET_SEKALI()
 *   - "sel dataRange" besar   -> setiap getDataRange().getValues() semahal itu
 */
function DIAG_SHEET() {
  const ss = SpreadsheetApp.getActive();
  Logger.log('=== DIAGNOSA UKURAN SHEET ===');
  Logger.log('Spreadsheet: %s', ss.getName());

  let totalNganggur = 0;

  PERAWATAN_SHEETS.forEach(function (nama) {
    const sh = ss.getSheetByName(nama);
    if (!sh) {
      Logger.log('%s -> TIDAK ADA', nama);
      return;
    }
    const maxR = sh.getMaxRows();
    const lastR = sh.getLastRow();
    const maxC = sh.getMaxColumns();
    const lastC = sh.getLastColumn();
    const ngangguR = maxR - lastR;
    const ngangguC = maxC - lastC;
    totalNganggur += ngangguR;

    Logger.log(
      '%s | baris %s dari %s (nganggur %s) | kolom %s dari %s (nganggur %s) | sel dataRange ~%s',
      nama, lastR, maxR, ngangguR, lastC, maxC, ngangguC, (lastR * lastC)
    );
  });

  Logger.log('---');
  Logger.log('Total baris nganggur di semua sheet: %s', totalNganggur);
  if (totalNganggur > 5000) {
    Logger.log('SARAN: jalankan RAPIKAN_SHEET_SEKALI() untuk memangkasnya.');
  } else {
    Logger.log('Ukuran sheet masih wajar. Tidak perlu dirapikan.');
  }
}

/**
 * Memangkas baris kosong berlebih di bawah data.
 *
 * AMAN: hanya menghapus baris SETELAH baris terisi terakhir
 * (getLastRow()), ditambah buffer. Tidak ada data yang tersentuh.
 * Kolom sengaja TIDAK disentuh — kolom kosong di kanan kadang dipakai
 * formula bantu, jadi keputusannya diserahkan ke Anda.
 *
 * Jalankan saat tidak ada yang sedang memakai aplikasi, lalu jalankan
 * DIAG_SHEET() lagi untuk memastikan hasilnya.
 */
function RAPIKAN_SHEET_SEKALI() {
  const ss = SpreadsheetApp.getActive();
  Logger.log('=== MERAPIKAN BARIS NGANGGUR ===');
  let totalDihapus = 0;

  PERAWATAN_SHEETS.forEach(function (nama) {
    const sh = ss.getSheetByName(nama);
    if (!sh) return;

    const maxR = sh.getMaxRows();
    const lastR = sh.getLastRow();
    const batas = Math.max(lastR, 1) + PERAWATAN_BUFFER_BARIS;

    if (maxR <= batas) {
      Logger.log('%s -> sudah rapi (%s baris)', nama, maxR);
      return;
    }

    const jumlah = maxR - batas;
    sh.deleteRows(batas + 1, jumlah);
    totalDihapus += jumlah;
    Logger.log('%s -> %s baris dihapus (%s menjadi %s)', nama, jumlah, maxR, sh.getMaxRows());
  });

  SpreadsheetApp.flush();
  Logger.log('---');
  Logger.log('Selesai. Total baris nganggur dihapus: %s', totalDihapus);
  Logger.log('Jalankan DIAG_SHEET() untuk memverifikasi.');
}
