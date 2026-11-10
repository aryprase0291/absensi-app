// ============================================================
// NotifEmailAtasan.gs  (Nov 2026)
// Email info ke atasan setelah HRD/atasan memproses pengajuan,
// log semua pengiriman email, dan audit email atasan di Users.
//
//   1. infoKeputusanKeAtasan_()  dipanggil dari processApprovalLogic
//   2. kirimEmailTercatat_()     MailApp + catatan ke sheet "LogEmail"
//   3. AUDIT_EMAIL_ATASAN()      jalankan manual dari editor Apps Script
//
// Semua fungsi di sini TIDAK pernah melempar error ke pemanggil,
// jadi approval tidak bisa gagal gara-gara email.
// ============================================================

const SHEET_LOG_EMAIL = 'LogEmail';
const LOG_EMAIL_HEADERS = ['Waktu', 'Jenis', 'UUID', 'Nama Karyawan', 'Tujuan', 'Status', 'Pesan'];
const SHEET_AUDIT_EMAIL = 'AuditEmailAtasan';
const LOG_EMAIL_MAKS_BARIS = 3000; // sheet log dipangkas agar tidak membengkak

function _emailValid_(v) {
  const s = String(v || '').trim();
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);
}

// Kolom M bisa berisi beberapa email dipisah koma / titik koma / spasi.
function _pecahEmail_(v) {
  return String(v || '').split(/[,;\s]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return _emailValid_(x); });
}

function catatLogEmail_(jenis, uuid, nama, tujuan, status, pesan) {
  try {
    let sh = SS.getSheetByName(SHEET_LOG_EMAIL);
    if (!sh) {
      sh = SS.insertSheet(SHEET_LOG_EMAIL);
      sh.getRange(1, 1, 1, LOG_EMAIL_HEADERS.length).setValues([LOG_EMAIL_HEADERS]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), jenis, uuid || '', nama || '', tujuan || '', status, String(pesan || '').slice(0, 300)]);
    const lr = sh.getLastRow();
    if (lr > LOG_EMAIL_MAKS_BARIS + 200) sh.deleteRows(2, lr - LOG_EMAIL_MAKS_BARIS - 1);
  } catch (e) { console.warn('Log email gagal ditulis: ' + e.message); }
}

// Kirim email + catat hasilnya. Mengembalikan true bila terkirim.
function kirimEmailTercatat_(jenis, uuid, nama, to, subject, htmlBody) {
  try {
    let sisa = -1;
    try { sisa = MailApp.getRemainingDailyQuota(); } catch (e) { /* abaikan */ }
    if (sisa === 0) {
      catatLogEmail_(jenis, uuid, nama, to, 'GAGAL', 'Kuota email harian habis (sisa 0)');
      return false;
    }
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: htmlBody });
    catatLogEmail_(jenis, uuid, nama, to, 'TERKIRIM', sisa >= 0 ? 'Sisa kuota ' + (sisa - 1) : '');
    return true;
  } catch (e) {
    catatLogEmail_(jenis, uuid, nama, to, 'GAGAL', e.message || e.toString());
    return false;
  }
}

// Penerima info = email atasan di Users kolom M + email kepala di
// Master Tim Approval (kalau akun kepala punya username berformat email).
function cariPenerimaInfoAtasan_(userId, rowsUsers) {
  const set = {};
  const hasil = [];
  function tambah(e) {
    const k = String(e).toLowerCase();
    if (!set[k]) { set[k] = true; hasil.push(String(e).trim()); }
  }
  try {
    const pemohon = rowsUsers.slice(1).find(function (r) { return String(r[0]) === String(userId); });
    if (pemohon) _pecahEmail_(pemohon[12]).forEach(tambah);
  } catch (e) { console.warn('Baca email atasan gagal: ' + e.message); }
  try {
    _ambilApprovalTeamAssignments().forEach(function (a) {
      if (a.anggotaId !== String(userId).trim()) return;
      const kepala = rowsUsers.slice(1).find(function (r) { return String(r[0]).trim() === a.kepalaId; });
      if (kepala && _emailValid_(kepala[1])) tambah(kepala[1]);
    });
  } catch (e) { console.warn('Baca tim approval gagal: ' + e.message); }
  return hasil;
}

// Selisih dua waktu dalam bahasa Indonesia, mis. "5 menit", "1 jam 20 menit",
// "2 hari 3 jam". Mengembalikan '-' bila waktu tidak valid.
function _selisihWaktu_(dari, sampai) {
  const a = new Date(dari), b = new Date(sampai);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '-';
  const menit = Math.round((b - a) / 60000);
  if (menit < 0) return '-';
  if (menit < 1) return 'kurang dari 1 menit';
  if (menit < 60) return menit + ' menit';
  const jam = Math.floor(menit / 60), sisaMenit = menit % 60;
  if (jam < 24) return jam + ' jam' + (sisaMenit ? ' ' + sisaMenit + ' menit' : '');
  const hari = Math.floor(jam / 24), sisaJam = jam % 24;
  return hari + ' hari' + (sisaJam ? ' ' + sisaJam + ' jam' : '');
}

// Dipanggil setelah status pengajuan berubah (Approved / Rejected).
// `row` = baris Absensi (nilai sebelum diubah, index kolom tetap).
function infoKeputusanKeAtasan_(row, statusFinal, approverName, alasan) {
  const uuid = row[0];
  const nama = row[3];
  try {
    const tipe = String(row[4] || '');
    // Hanya tipe yang melewati approval. Off/Standby (auto-approve), Dinas
    // dan absen biasa tidak butuh info. 'Ijin' sengaja ikut: pengajuan Ijin
    // diproses HRD di aplikasi dan atasan tetap perlu diberi tahu.
    if (['Ijin', 'Cuti', 'Sakit', 'Cuti EO', 'Lembur', 'Tukar Shift'].indexOf(tipe) === -1) {
      catatLogEmail_('INFO-KEPUTUSAN', uuid, nama, '-', 'DILEWATI', 'Tipe "' + tipe + '" tidak dikirimi info atasan');
      return;
    }

    const rowsUsers = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
    const penerima = cariPenerimaInfoAtasan_(row[2], rowsUsers);
    if (!penerima.length) {
      catatLogEmail_('INFO-KEPUTUSAN', uuid, nama, '-', 'DILEWATI', 'Tidak ada email atasan valid (Users kolom M / Master Tim)');
      return;
    }

    const mulai = row[8], selesai = row[9];
    let periode = formatDateStrict(row[1]);
    let durasi = '1 hari';
    if (mulai && mulai !== '-' && selesai && selesai !== '-') {
      periode = formatDateStrict(mulai) + ' s/d ' + formatDateStrict(selesai);
      const a = new Date(mulai), b = new Date(selesai);
      if (!isNaN(a) && !isNaN(b)) {
        a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
        durasi = (Math.round(Math.abs(b - a) / 86400000) + 1) + ' hari';
      }
    }
    // Lama izin/cuti ditempel di baris tanggal; "durasi" di email sekarang
    // = selisih waktu pengajuan sampai diproses.
    if (periode.indexOf('s/d') !== -1) periode += ' (' + durasi + ')';
    const sekarang = new Date();
    const decision = statusFinal === 'Approved' ? 'approve' : 'reject';
    kirimEmailKonfirmasiPimpinan(
      penerima.join(','), decision, nama, sekarang, _selisihWaktu_(row[1], sekarang), tipe,
      row[10], row[11], approverName, row[6], periode,
      decision === 'reject' ? alasan : '', row[1]
    );
  } catch (e) {
    catatLogEmail_('INFO-KEPUTUSAN', uuid, nama, '-', 'GAGAL', e.message || e.toString());
  }
}

// ------------------------------------------------------------
// AUDIT — jalankan manual dari editor Apps Script.
// Hasil di sheet "AuditEmailAtasan" + Logger.
// ------------------------------------------------------------
function AUDIT_EMAIL_ATASAN() {
  const rows = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
  const tim = _ambilApprovalTeamAssignments();
  const punyaTim = {};
  tim.forEach(function (a) { punyaTim[a.anggotaId] = a.kepalaNama || a.kepalaId; });

  const hasil = [['UserID', 'Nama', 'Divisi', 'Role', 'Isi Kolom M', 'Masalah', 'Atasan di Master Tim']];
  rows.slice(1).forEach(function (r) {
    const id = String(r[0] || '').trim();
    if (!id) return;
    const mentah = String(r[12] || '').trim();
    let masalah = '';
    if (!mentah || mentah === '-') masalah = 'KOSONG';
    else {
      const valid = _pecahEmail_(mentah);
      const semua = mentah.split(/[,;\s]+/).filter(Boolean);
      if (!valid.length) masalah = 'FORMAT TIDAK VALID';
      else if (valid.length < semua.length) masalah = 'SEBAGIAN TIDAK VALID';
    }
    if (masalah) hasil.push([id, r[3], r[4], r[5], mentah, masalah, punyaTim[id] || '-']);
  });

  let sh = SS.getSheetByName(SHEET_AUDIT_EMAIL);
  if (!sh) sh = SS.insertSheet(SHEET_AUDIT_EMAIL);
  sh.clear();
  sh.getRange(1, 1, hasil.length, hasil[0].length).setValues(hasil);
  sh.getRange(1, 1, 1, hasil[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);

  let sisa = '?';
  try { sisa = MailApp.getRemainingDailyQuota(); } catch (e) { /* abaikan */ }
  Logger.log('Audit email atasan: %s user bermasalah dari %s. Sisa kuota email hari ini: %s. Lihat sheet "%s".',
    hasil.length - 1, rows.length - 1, sisa, SHEET_AUDIT_EMAIL);
  return hasil.length - 1;
}
