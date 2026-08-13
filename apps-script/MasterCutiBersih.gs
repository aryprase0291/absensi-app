// =======================================================
// PEMBERSIH MASTER-CUTI — File: MasterCutiBersih.gs
//
// MASALAHNYA (diukur 13 Agu 2026 dari spreadsheet produksi):
//   MASTER-CUTI berisi 325 baris data, tapi sheet-nya 7.511 baris.
//   Selisih 7.186 baris itu bukan data — isinya formula `=B2` di kolom U
//   yang ter-drag sampai jauh ke bawah (7.510 sel formula total).
//
//   Akibatnya getLastRow() melaporkan 7.511, dan setiap pembacaan yang
//   memakai getDataRange() menarik 7.511 x 27 = 202.797 sel serta memaksa
//   7.510 formula dihitung ulang — untuk mengambil angka cuti satu orang.
//
// CATATAN: kode di Cache.gs sudah diubah agar tidak lagi menyentuh kolom U,
// jadi aplikasi TETAP CEPAT walaupun skrip ini tidak pernah dijalankan.
// Membersihkannya membuat sheet lebih ringan untuk dibuka manual dan
// menghilangkan sumber kebingungan, tapi sifatnya opsional.
//
// CARA PAKAI — JANGAN LANGKAHI URUTANNYA:
//   1. Buat salinan spreadsheet dulu (File -> Buat salinan).
//   2. Jalankan MASTERCUTI_PERIKSA()  <- read-only, tidak mengubah apa pun.
//      Baca log-nya. Pastikan angka "baris data terakhir" masuk akal.
//   3. Baru jalankan MASTERCUTI_BERSIHKAN().
//   4. Jalankan CACHE_BERSIHKAN() (Cache.gs) supaya peta cuti disusun ulang.
// =======================================================

const MC_NAMA_SHEET = 'MASTER-CUTI';

// Kolom B = No Payroll. Baris dianggap "berisi data" kalau kolom ini terisi.
const MC_KOL_KUNCI = 2;

// Baris kosong yang tetap disisakan di bawah data, sebagai ruang gerak
// kalau ada penambahan karyawan lewat tangan.
const MC_SISA_BUFFER = 50;

/**
 * READ-ONLY. Melaporkan kondisi sheet tanpa mengubah apa pun.
 * Jalankan ini dulu dan baca log-nya sebelum MASTERCUTI_BERSIHKAN().
 */
function MASTERCUTI_PERIKSA() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MC_NAMA_SHEET);
  if (!sh) { Logger.log('Sheet %s tidak ditemukan.', MC_NAMA_SHEET); return; }

  const maxRows = sh.getMaxRows();
  const lastRow = sh.getLastRow();
  const barisData = _mcBarisDataTerakhir(sh);

  Logger.log('=== KONDISI %s ===', MC_NAMA_SHEET);
  Logger.log('Baris fisik sheet (getMaxRows)      : %s', maxRows);
  Logger.log('Baris terisi menurut getLastRow()   : %s', lastRow);
  Logger.log('Baris data terakhir (kolom B terisi): %s', barisData);
  Logger.log('');

  // Hitung sel formula di zona yang akan dibuang, supaya jelas
  // yang dihapus memang formula ter-drag dan bukan data.
  const dariBaris = barisData + 1;
  if (dariBaris > lastRow) {
    Logger.log('Tidak ada baris menganggur di bawah data. Tidak perlu dibersihkan.');
    return;
  }

  const jml = lastRow - barisData;
  const zona = sh.getRange(dariBaris, 1, jml, sh.getLastColumn());
  const formulas = zona.getFormulas();
  const values = zona.getValues();

  let selFormula = 0;
  let selBerisiNilai = 0;
  const contohNilai = [];

  for (let i = 0; i < formulas.length; i++) {
    for (let j = 0; j < formulas[i].length; j++) {
      if (formulas[i][j]) {
        selFormula++;
      } else if (values[i][j] !== '' && values[i][j] !== null) {
        selBerisiNilai++;
        if (contohNilai.length < 10) {
          contohNilai.push('baris ' + (dariBaris + i) +
                           ' kolom ' + _mcHurufKolom(j + 1) +
                           ' = ' + values[i][j]);
        }
      }
    }
  }

  Logger.log('Zona yang akan dihapus: baris %s sampai %s (%s baris)', dariBaris, lastRow, jml);
  Logger.log('  sel berisi FORMULA          : %s  <- ini yang memang mau dibuang', selFormula);
  Logger.log('  sel berisi NILAI (bukan formula): %s', selBerisiNilai);
  Logger.log('');

  if (selBerisiNilai > 0) {
    Logger.log('!!! JANGAN DIBERSIHKAN DULU !!!');
    Logger.log('Ada %s sel berisi nilai di luar kolom B pada zona itu.', selBerisiNilai);
    Logger.log('Artinya di sana mungkin ada data yang No Payroll-nya kebetulan kosong.');
    Logger.log('Contoh:');
    contohNilai.forEach(function (s) { Logger.log('  ' + s); });
    Logger.log('Periksa manual dulu sebelum menjalankan MASTERCUTI_BERSIHKAN().');
  } else {
    Logger.log('AMAN. Zona itu hanya berisi formula ter-drag, tidak ada nilai.');
    Logger.log('Setelah dibersihkan, sheet akan tinggal %s baris (%s data + %s buffer).',
               barisData + MC_SISA_BUFFER, barisData, MC_SISA_BUFFER);
    Logger.log('Lanjut: buat salinan spreadsheet, lalu jalankan MASTERCUTI_BERSIHKAN().');
  }
}

/**
 * MENGUBAH SHEET. Menghapus baris menganggur di bawah data terakhir.
 * Jalankan MASTERCUTI_PERIKSA() dulu dan pastikan hasilnya "AMAN".
 */
function MASTERCUTI_BERSIHKAN() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MC_NAMA_SHEET);
  if (!sh) { Logger.log('Sheet %s tidak ditemukan.', MC_NAMA_SHEET); return; }

  const barisData = _mcBarisDataTerakhir(sh);
  if (barisData < 2) {
    Logger.log('Kolom B kosong atau hanya berisi header. Dibatalkan demi keamanan.');
    return;
  }

  // Pemeriksaan ulang otomatis: menolak menghapus kalau di zona itu
  // ternyata ada nilai (bukan formula). Ini pengaman terakhir kalau
  // MASTERCUTI_PERIKSA() terlewat dijalankan.
  const lastRow = sh.getLastRow();
  if (lastRow > barisData) {
    const zona = sh.getRange(barisData + 1, 1, lastRow - barisData, sh.getLastColumn());
    const formulas = zona.getFormulas();
    const values = zona.getValues();
    let selBerisiNilai = 0;
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values[i].length; j++) {
        if (!formulas[i][j] && values[i][j] !== '' && values[i][j] !== null) selBerisiNilai++;
      }
    }
    if (selBerisiNilai > 0) {
      Logger.log('DIBATALKAN: ada %s sel berisi nilai di bawah baris data terakhir (%s).',
                 selBerisiNilai, barisData);
      Logger.log('Jalankan MASTERCUTI_PERIKSA() untuk melihat rinciannya.');
      return;
    }
  }

  const batasSimpan = barisData + MC_SISA_BUFFER;
  const maxRows = sh.getMaxRows();

  if (maxRows <= batasSimpan) {
    Logger.log('Sheet sudah ringkas (%s baris). Tidak ada yang dihapus.', maxRows);
    return;
  }

  const jmlHapus = maxRows - batasSimpan;
  sh.deleteRows(batasSimpan + 1, jmlHapus);
  SpreadsheetApp.flush();

  Logger.log('Selesai. %s baris dihapus.', jmlHapus);
  Logger.log('%s: %s baris -> %s baris (%s data + %s buffer).',
             MC_NAMA_SHEET, maxRows, sh.getMaxRows(), barisData, MC_SISA_BUFFER);
  Logger.log('getLastRow() sekarang: %s', sh.getLastRow());
  Logger.log('');
  Logger.log('Langkah terakhir: jalankan CACHE_BERSIHKAN() (Cache.gs)');
  Logger.log('supaya peta cuti disusun ulang dari sheet yang sudah bersih.');
}

/**
 * Baris terakhir yang kolom B-nya terisi.
 * @private
 */
function _mcBarisDataTerakhir(sh) {
  const maxRows = sh.getMaxRows();
  if (maxRows < 1) return 0;
  const sel = sh.getRange(maxRows, MC_KOL_KUNCI).getNextDataCell(SpreadsheetApp.Direction.UP);
  const baris = sel.getRow();
  if (baris === 1 && sel.getValue() === '') return 0;
  return baris;
}

/**
 * Nomor kolom -> huruf (1 -> A, 27 -> AA). Untuk pesan log saja.
 * @private
 */
function _mcHurufKolom(n) {
  let s = '';
  while (n > 0) {
    const sisa = (n - 1) % 26;
    s = String.fromCharCode(65 + sisa) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
