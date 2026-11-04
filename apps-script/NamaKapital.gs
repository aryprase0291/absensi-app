// =====================================================================
// NAMA KARYAWAN HURUF KAPITAL (4 Nov 2026)
//
// Seluruh nama karyawan di sistem ditampilkan HURUF KAPITAL. Supaya
// berlaku di semua menu tanpa mengubah setiap layar, yang dikapitalkan
// adalah SUMBER datanya (kolom D = Nama):
//   - Users          : dijaga di SETIAP SUPABASE_SINKRON_MASTER (10 menit)
//                      — murah (±300 baris) dan ikut menangkap nama yang
//                      diketik manual di sheet. Supabase ikut kapital
//                      karena sinkron membaca sheet sesudahnya.
//   - Absensi, Remarks, running shift : SEKALI (Script Property
//                      NAMA_KAPITAL_V1), karena barisnya ribuan dan nama
//                      baru sudah ditulis kapital oleh handler-nya.
// Hanya sel yang benar-benar berubah yang membuat kolom ditulis ulang;
// kolom lain tidak disentuh.
// =====================================================================

const NAMA_KAPITAL_PROP = 'NAMA_KAPITAL_V1';

/** Nama -> huruf kapital, spasi dirapikan. Nilai kosong/bukan teks dibiarkan. */
function namaKapital_(v) {
  if (v === null || v === undefined || v === '') return v;
  if (typeof v !== 'string') return v;
  return v.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Kapitalkan kolom D sebuah sheet. @return jumlah sel yang berubah */
function _namaKapitalKolomD_(namaSheet) {
  const sh = SS.getSheetByName(namaSheet);
  if (!sh) return 0;
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const rng = sh.getRange(2, 4, n, 1);
  const nilai = rng.getValues();
  let ubah = 0;
  for (let i = 0; i < nilai.length; i++) {
    const baru = namaKapital_(nilai[i][0]);
    if (baru !== nilai[i][0]) { nilai[i][0] = baru; ubah++; }
  }
  if (ubah) rng.setValues(nilai);
  return ubah;
}

/** Dipanggil di awal SUPABASE_SINKRON_MASTER. Tidak pernah melempar error. */
function NAMA_KAPITAL_JAGA_() {
  try {
    const u = _namaKapitalKolomD_(SHEET_USERS);
    if (u) console.log('Nama kapital: ' + u + ' nama di Users diubah.');
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(NAMA_KAPITAL_PROP) !== 'selesai') {
      const hasil = [SHEET_ABSENSI, SHEET_REMARKS, SHEET_RUNNING_SHIFT].map(function (s) {
        return s + '=' + _namaKapitalKolomD_(s);
      });
      props.setProperty(NAMA_KAPITAL_PROP, 'selesai');
      console.log('Nama kapital (sekali): ' + hasil.join(', '));
    }
    if (u) SpreadsheetApp.flush();
  } catch (e) {
    console.warn('NAMA_KAPITAL_JAGA_ gagal: ' + e.message);
  }
}
