// =====================================================================
// NOTIFIKASI KARYAWAN — status pengajuan sudah direspon (24 Okt 2026)
// =====================================================================
//
// Karyawan diberi tahu begitu pengajuannya diproses oleh atasan
// (pimpinan / kepala divisi), HRD, atau admin:
//
//   approval  Pending -> Approved / Rejected (layar Approval, link email,
//             tombol ACTION di Laporan & Cetak Data)
//   batal     Approved / Verified -> Rejected (pembatalan approval)
//   hapus     pengajuan dihapus admin
//   remark    Lapor HRD sudah dijawab (status Done)
//
// PENYIMPANAN: sheet `NotifKaryawan`, satu baris per notifikasi.
//   ID | Waktu | UserID | Jenis | RefID | Judul | Pesan | Oleh | DibacaPada
//
// PEMBACAAN TIDAK MENAMBAH REQUEST: ringkasannya ikut di respons
// `buka_aplikasi` (lihat handleBukaAplikasi). Yang dibaca hanya ekor sheet
// (NOTIF_EKOR_BARIS baris terakhir), bukan seluruh sheet, jadi biayanya
// tidak tumbuh seiring waktu.
//
// PENULISAN TIDAK BOLEH MENGGAGALKAN APPROVAL: setiap pemanggilan dari
// handler lain dibungkus try/catch di dalam notifKaryawanTambah_. Kalau
// sheet terkunci / kuota habis, approval tetap berhasil dan kegagalannya
// hanya tercatat di log eksekusi.
// =====================================================================

const SHEET_NOTIF_KARYAWAN = 'NotifKaryawan';
const NOTIF_HEADERS = ['ID', 'Waktu', 'UserID', 'Jenis', 'RefID', 'Judul', 'Pesan', 'Oleh', 'DibacaPada'];
const NOTIF_EKOR_BARIS = 3000;     // baris terakhir yang dibaca
const NOTIF_UMUR_HARI = 45;        // notifikasi lebih tua dari ini tidak ditampilkan
const NOTIF_MAKS_RINGKAS = 8;      // isi daftar di respons buka_aplikasi
const NOTIF_MAKS_DAFTAR = 40;      // isi daftar di get_notif_karyawan

function _notifSheet_(buatBilaTidakAda) {
  let sh = SS.getSheetByName(SHEET_NOTIF_KARYAWAN);
  if (!sh && buatBilaTidakAda) {
    sh = SS.insertSheet(SHEET_NOTIF_KARYAWAN);
    sh.getRange(1, 1, 1, NOTIF_HEADERS.length).setValues([NOTIF_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _notifTgl_(v) {
  if (!v || v === '-') return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, 'Asia/Jakarta', 'dd/MM/yyyy');
}

/** "21/10/2026" atau "21/10/2026 – 23/10/2026" */
function _notifRentang_(mulai, selesai) {
  const a = _notifTgl_(mulai);
  const b = _notifTgl_(selesai);
  if (!a) return b;
  if (!b || a === b) return a;
  return a + ' – ' + b;
}

/**
 * Tambah satu notifikasi. Tidak pernah melempar error.
 * @param {{userId:string, jenis:string, refId:string, judul:string, pesan:string, oleh:string}} n
 */
function notifKaryawanTambah_(n) {
  try {
    if (!n || !n.userId) return;
    const sh = _notifSheet_(true);
    sh.appendRow([
      Utilities.getUuid(),
      new Date(),
      String(n.userId).trim(),
      String(n.jenis || 'info'),
      String(n.refId || ''),
      String(n.judul || '').slice(0, 200),
      String(n.pesan || '').slice(0, 1000),
      String(n.oleh || '').slice(0, 120),
      ''
    ]);
  } catch (e) {
    console.warn('Notif karyawan gagal ditulis: ' + (e && e.message ? e.message : e));
  }
}

/**
 * Notifikasi dari satu baris sheet Absensi (A..Q).
 * C=userId(2) E=tipe(4) I=tglMulai(8) J=tglSelesai(9)
 * @param {Array} row  baris Absensi
 * @param {string} statusBaru  'Approved' | 'Rejected' | 'Batal' | 'Hapus'
 * @param {string} oleh  nama pemroses
 * @param {string=} alasan  keterangan / alasan penolakan
 */
function notifKaryawanDariPengajuan_(row, statusBaru, oleh, alasan) {
  try {
    if (!row) return;
    const tipe = String(row[4] || 'Pengajuan').trim();
    const tgl = _notifRentang_(row[8] && row[8] !== '-' ? row[8] : row[1], row[9] && row[9] !== '-' ? row[9] : row[8]);
    const ket = String(alasan || '').trim();
    let jenis = 'approval', judul = '', pesan = '';
    if (statusBaru === 'Approved') {
      judul = '✅ Pengajuan ' + tipe + ' disetujui';
    } else if (statusBaru === 'Batal') {
      jenis = 'batal';
      judul = '↩️ Approval ' + tipe + ' dibatalkan';
    } else if (statusBaru === 'Hapus') {
      jenis = 'hapus';
      judul = '🗑 Pengajuan ' + tipe + ' dihapus';
    } else {
      judul = '❌ Pengajuan ' + tipe + ' ditolak';
    }
    pesan = (tgl ? 'Tanggal ' + tgl : '');
    if (ket && ket !== '-') pesan += (pesan ? ' · ' : '') + ket;
    notifKaryawanTambah_({
      userId: row[2], jenis: jenis, refId: row[0], judul: judul, pesan: pesan, oleh: oleh || ''
    });
  } catch (e) {
    console.warn('Notif pengajuan gagal disusun: ' + e);
  }
}

/** Notifikasi saat Lapor HRD dijawab. Baris Remarks: C=userId(2) G=kategori(6) */
function notifKaryawanDariRemark_(row, respon, oleh) {
  try {
    if (!row) return;
    const kategori = String(row[6] || 'Laporan').trim();
    notifKaryawanTambah_({
      userId: row[2],
      jenis: 'remark',
      refId: row[0],
      judul: '💬 Lapor HRD dijawab: ' + kategori,
      pesan: String(respon || 'Sudah diproses.'),
      oleh: oleh || 'HRD'
    });
  } catch (e) {
    console.warn('Notif remark gagal disusun: ' + e);
  }
}

/**
 * Baca notifikasi milik satu user dari ekor sheet, terbaru dulu.
 * @return {{rows:Array<Object>, nomorBaris:Object}} nomorBaris: id -> nomor baris sheet
 * @private
 */
function _notifBacaUser_(userId) {
  const sh = _notifSheet_(false);
  const hasil = { rows: [], nomorBaris: {} };
  if (!sh) return hasil;
  const last = sh.getLastRow();
  if (last < 2) return hasil;
  const awal = Math.max(2, last - NOTIF_EKOR_BARIS + 1);
  const data = sh.getRange(awal, 1, last - awal + 1, NOTIF_HEADERS.length).getValues();
  const batasUmur = Date.now() - NOTIF_UMUR_HARI * 86400000;
  const uid = String(userId).trim();
  for (let i = data.length - 1; i >= 0; i--) {
    const r = data[i];
    if (String(r[2]).trim() !== uid) continue;
    const w = r[1] instanceof Date ? r[1] : new Date(r[1]);
    if (isNaN(w.getTime()) || w.getTime() < batasUmur) continue;
    hasil.nomorBaris[String(r[0])] = awal + i;
    hasil.rows.push({
      id: String(r[0]),
      waktu: w.getTime(),
      jenis: String(r[3] || ''),
      refId: String(r[4] || ''),
      judul: String(r[5] || ''),
      pesan: String(r[6] || ''),
      oleh: String(r[7] || ''),
      dibaca: !!r[8]
    });
  }
  return hasil;
}

/** Ringkasan untuk respons buka_aplikasi: jumlah belum dibaca + beberapa terbaru yang belum dibaca. */
function notifKaryawanRingkas_(userId) {
  const b = _notifBacaUser_(userId);
  const belum = b.rows.filter(function (x) { return !x.dibaca; });
  return { belumDibaca: belum.length, daftar: belum.slice(0, NOTIF_MAKS_RINGKAS) };
}

function handleGetNotifKaryawan(data) {
  try {
    const b = _notifBacaUser_(data.userId);
    return responseJSON({
      result: 'success',
      belumDibaca: b.rows.filter(function (x) { return !x.dibaca; }).length,
      list: b.rows.slice(0, NOTIF_MAKS_DAFTAR)
    });
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal membaca notifikasi: ' + e.message });
  }
}

/**
 * Tandai dibaca. data.ids = [id,...] atau data.semua = true.
 * userId berasal dari token (Auth.gs), jadi hanya notifikasi milik sendiri
 * yang bisa ditandai.
 */
function handleBacaNotifKaryawan(data) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return responseJSON({ result: 'error', message: 'Server sibuk, coba lagi.' });
  }
  try {
    const sh = _notifSheet_(false);
    if (!sh) return responseJSON({ result: 'success', ditandai: 0 });
    const b = _notifBacaUser_(data.userId);
    const pilih = {};
    (Array.isArray(data.ids) ? data.ids : []).forEach(function (id) { pilih[String(id)] = true; });
    const sekarang = new Date();
    let n = 0;
    b.rows.forEach(function (x) {
      if (x.dibaca) return;
      if (!data.semua && !pilih[x.id]) return;
      sh.getRange(b.nomorBaris[x.id], 9).setValue(sekarang);
      n++;
    });
    return responseJSON({ result: 'success', ditandai: n });
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal menandai notifikasi: ' + e.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Perawatan opsional: buang notifikasi lebih tua dari 90 hari.
 * Jalankan manual dari editor, atau pasang trigger bulanan.
 */
function NOTIF_KARYAWAN_BERSIHKAN() {
  const sh = _notifSheet_(false);
  if (!sh || sh.getLastRow() < 2) { Logger.log('Tidak ada isi.'); return; }
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, NOTIF_HEADERS.length).getValues();
  const batas = Date.now() - 90 * 86400000;
  const sisa = data.filter(function (r) {
    const w = r[1] instanceof Date ? r[1] : new Date(r[1]);
    return !isNaN(w.getTime()) && w.getTime() >= batas;
  });
  sh.getRange(2, 1, data.length, NOTIF_HEADERS.length).clearContent();
  if (sisa.length) sh.getRange(2, 1, sisa.length, NOTIF_HEADERS.length).setValues(sisa);
  Logger.log('Dibuang ' + (data.length - sisa.length) + ' baris, sisa ' + sisa.length + '.');
}
