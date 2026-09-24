// =====================================================================
// KOREKSI ABSENSI DI SUPABASE (24 Sep 2026)
// File: SupabaseKoreksi.gs  (tempel sebagai file baru di editor Apps Script)
//
// Postgres (tabel koreksi_absen) = PENULIS. Sheet KOREKSI = cermin
// cadangan yang ikut ditulis setiap simpan/hapus, supaya mematikan
// sakelar tidak pernah membuat koreksi hilang.
//
// LANGKAH SEKALI JALAN (urut):
//   1. Migrasi supabase/migrations/20260924000000_koreksi.sql
//      dan Edge Function supabase/functions/koreksi sudah terpasang.
//   2. SUPABASE_SEMAI_KOREKSI()   -> salin isi sheet KOREKSI ke Postgres
//   3. SUPABASE_UJI_KOREKSI()     -> bandingkan jumlah sheet vs Postgres
//   4. SUPABASE_KOREKSI_NYALAKAN()
// Mundur kapan saja: SUPABASE_KOREKSI_MATIKAN() — semua kembali ke sheet.
//
// Semua jalur baca jatuh ke sheet kalau Supabase gagal, jadi rekap
// tidak pernah berhenti karena koreksi.
// =====================================================================

const SB_PROP_KOREKSI = 'SUPABASE_KOREKSI'; // '1' = baca/tulis lewat Supabase

function sbKoreksiAktif() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(SB_PROP_KOREKSI) || '') === '1';
  } catch (e) {
    return false;
  }
}

/** @private */
function _sbKoreksi(aksi, muatan) {
  const isi = muatan || {};
  isi.aksi = aksi;
  const hasil = _sbPanggil('koreksi', isi);
  if (!hasil || hasil.result !== 'success') {
    throw new Error('koreksi/' + aksi + ': ' + ((hasil && hasil.message) || 'jawaban tidak dikenal'));
  }
  return hasil;
}

/** Baris Postgres -> bentuk objek yang dipakai rekap & layar. @private */
function _koreksiDariPg_(b) {
  return {
    id: String(b.id || ''),
    noAkun: String(b.no_akun || '').trim(),
    payroll: String(b.payroll || '').trim(),
    nama: String(b.nama || '').trim(),
    tglMulai: String(b.tgl_mulai || '').slice(0, 10),
    tglSelesai: String(b.tgl_selesai || b.tgl_mulai || '').slice(0, 10),
    id2: String(b.id2 || '').trim().toUpperCase(),
    keterangan: String(b.keterangan || ''),
    createdAt: String(b.dibuat_pada || '')
  };
}

/** Isi sheet KOREKSI sebagai daftar objek. @private */
function _bacaKoreksiSheet_() {
  const sheet = _pastikanSheetKoreksi();
  const rows = bacaSheet(sheet, 9);
  const list = [];
  for (let k = 1; k < rows.length; k++) {
    const kr = rows[k];
    if (!kr[0] && !kr[2] && !kr[3]) continue;
    list.push({
      id: String(kr[0] || ('KOR-' + k)),
      noAkun: String(kr[1] || '').trim(),
      payroll: String(kr[2] || '').trim(),
      nama: String(kr[3] || '').trim(),
      tglMulai: formatDateYMD_Strict(kr[4]) || String(kr[4] || ''),
      tglSelesai: formatDateYMD_Strict(kr[5]) || String(kr[5] || ''),
      id2: String(kr[6] || '').trim().toUpperCase(),
      keterangan: String(kr[7] || ''),
      createdAt: String(kr[8] || '')
    });
  }
  return list;
}

/**
 * Daftar koreksi. Rentang opsional (YYYY-MM-DD): hanya koreksi yang
 * bersinggungan dengannya. Supabase dulu, sheet sebagai cadangan.
 * `pgSiap` = jawaban mentah aksi `daftar` yang sudah diambil lebih dulu
 * (lihat pengambilan paralel di handleGetRekapAdmin).
 */
function bacaDaftarKoreksi_(dari, sampai, pgSiap) {
  if (sbKoreksiAktif()) {
    try {
      const hasil = pgSiap || _sbKoreksi('daftar', { dari: dari || '', sampai: sampai || '' });
      if (hasil && hasil.result === 'success') return (hasil.list || []).map(_koreksiDariPg_);
    } catch (e) {
      console.warn('Koreksi Supabase gagal, kembali ke sheet: ' + e.message);
    }
  }
  const semua = _bacaKoreksiSheet_();
  if (!dari && !sampai) return semua;
  return semua.filter(function (k) {
    const a = k.tglMulai;
    const b = k.tglSelesai || k.tglMulai;
    if (sampai && a && a > sampai) return false;
    if (dari && b && b < dari) return false;
    return true;
  });
}

/** Tulis satu baris ke cermin sheet (ubah kalau id ada, tambah kalau belum). @private */
function _cerminKoreksiKeSheet_(k) {
  const sheet = _pastikanSheetKoreksi();
  const baris = [k.id, k.noAkun, k.payroll, k.nama, k.tglMulai, k.tglSelesai, k.id2, k.keterangan, k.createdAt];
  const last = sheet.getLastRow();
  if (last >= 2) {
    // Hanya kolom A yang dibaca untuk mencari id — bukan seluruh sheet.
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(k.id)) {
        sheet.getRange(i + 2, 1, 1, 9).setValues([baris]);
        return;
      }
    }
  }
  sheet.getRange(last + 1, 1, 1, 9).setValues([baris]);
}

/** @private */
function _hapusKoreksiDiSheet_(id) {
  const sheet = _pastikanSheetKoreksi();
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

/**
 * Simpan satu koreksi. Postgres dulu (kalau menyala) — kalau gagal,
 * penyimpanan GAGAL (tidak diam-diam hanya masuk sheet, supaya kedua
 * sisi tidak berbeda). Cermin sheet menyusul; kegagalannya hanya dicatat.
 */
function simpanKoreksi_(k) {
  if (sbKoreksiAktif()) {
    _sbKoreksi('simpan', { koreksi: k });
    try { _cerminKoreksiKeSheet_(k); } catch (e) { console.warn('Cermin sheet KOREKSI gagal: ' + e.message); }
    return;
  }
  _cerminKoreksiKeSheet_(k);
}

/** @return {boolean} true kalau ada yang terhapus. */
function hapusKoreksi_(id) {
  if (sbKoreksiAktif()) {
    const hasil = _sbKoreksi('hapus', { id: id });
    let diSheet = false;
    try { diSheet = _hapusKoreksiDiSheet_(id); } catch (e) { console.warn('Cermin sheet KOREKSI gagal: ' + e.message); }
    return Number(hasil.terhapus || 0) > 0 || diSheet;
  }
  return _hapusKoreksiDiSheet_(id);
}

// ---------------------------------------------------------------------
// Jalankan manual dari editor
// ---------------------------------------------------------------------
function SUPABASE_SEMAI_KOREKSI() {
  const list = _bacaKoreksiSheet_();
  const hasil = _sbKoreksi('semai', { list: list });
  Logger.log('Semai koreksi: ' + list.length + ' baris dari sheet, ' + hasil.total + ' tersimpan di Postgres.');
  Logger.log('Berikutnya: SUPABASE_UJI_KOREKSI(), lalu SUPABASE_KOREKSI_NYALAKAN().');
  return hasil;
}

function SUPABASE_UJI_KOREKSI() {
  const sheet = _bacaKoreksiSheet_().length;
  const pg = Number(_sbKoreksi('jumlah', {}).total || 0);
  const t0 = new Date().getTime();
  _sbKoreksi('daftar', {});
  const ms = new Date().getTime() - t0;
  Logger.log('Sheet KOREKSI : ' + sheet + ' baris');
  Logger.log('Postgres      : ' + pg + ' baris');
  Logger.log('Baca daftar   : ' + ms + ' ms');
  Logger.log(sheet === pg ? 'COCOK — aman dinyalakan.' : 'BEDA — jalankan SUPABASE_SEMAI_KOREKSI() lagi.');
}

function SUPABASE_KOREKSI_NYALAKAN() {
  PropertiesService.getScriptProperties().setProperty(SB_PROP_KOREKSI, '1');
  if (typeof _propsLupakan_ === 'function') _propsLupakan_();
  if (typeof rekapCacheBatalkan_ === 'function') rekapCacheBatalkan_();
  Logger.log('Koreksi Supabase DINYALAKAN.');
}

function SUPABASE_KOREKSI_MATIKAN() {
  PropertiesService.getScriptProperties().setProperty(SB_PROP_KOREKSI, '0');
  if (typeof _propsLupakan_ === 'function') _propsLupakan_();
  if (typeof rekapCacheBatalkan_ === 'function') rekapCacheBatalkan_();
  Logger.log('Koreksi Supabase DIMATIKAN — kembali ke sheet KOREKSI.');
}

/**
 * Beberapa panggilan Edge Function SEKALIGUS (UrlFetchApp.fetchAll).
 * Waktu tunggunya = panggilan paling lama, bukan jumlah semuanya — ini
 * yang membuat rekap menarik data mesin + koreksi dalam satu perjalanan.
 * @param {Array<{fungsi:string, muatan:Object}>} daftar
 * @return {Array<{ok:boolean, data:?Object, galat:string}>}
 */
function _sbPanggilParalel_(daftar) {
  const cfg = _sbKonfig();
  const permintaan = daftar.map(function (d) {
    return {
      url: cfg.url + '/functions/v1/' + d.fungsi,
      method: 'post',
      contentType: 'application/json',
      headers: _sbHeader(cfg),
      payload: JSON.stringify(d.muatan || {}),
      muteHttpExceptions: true
    };
  });
  return UrlFetchApp.fetchAll(permintaan).map(function (res, i) {
    try {
      const kode = res.getResponseCode();
      const teks = res.getContentText();
      if (kode < 200 || kode >= 300) {
        return { ok: false, data: null, galat: daftar[i].fungsi + ' HTTP ' + kode + ': ' + teks.substring(0, 200) };
      }
      return { ok: true, data: JSON.parse(teks), galat: '' };
    } catch (e) {
      return { ok: false, data: null, galat: e.message };
    }
  });
}
