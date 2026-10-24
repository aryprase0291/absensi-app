// =====================================================================
// MASTER ROLE & LOKASI AKSES (24 Okt 2026)
//
// Kolom Role di sheet Users berisi KODE role (mis. "hrd_sby"). Tabel
// master_role di Supabase menerjemahkannya menjadi:
//   - tingkat  : admin / hrd / manager / kepala / ... / karyawan
//                -> dipakai ACTION_ROLES di Auth.gs (aturan keamanan tetap di kode)
//   - lokasi   : cakupan lokasi yang boleh dilihat
//                []        = ikut kolom Lokasi karyawan itu (perilaku lama)
//                ['*']     = semua lokasi
//                ['Surabaya'] / ['Surabaya','Jakarta']
//   - menu     : menu yang ditampilkan (kosong = semua menu tingkatnya)
//
// Penulis master: Edge Function `master-role` (Admin Panel > Master Role).
// Di sini hanya MEMBACA, lewat simpanan Script Properties yang disegarkan:
//   - setiap SUPABASE_SINKRON_MASTER (trigger 10 menit),
//   - aksi `segarkan_master_role` (dipanggil layar sesudah menyimpan),
//   - MASTER_ROLE_SEGARKAN() dari editor.
// authorizeRequest TIDAK PERNAH memanggil jaringan — hanya membaca simpanan.
//
// KODE YANG TIDAK TERDAFTAR dipakai apa adanya sebagai tingkat, sama
// seperti sebelum master ini ada. Jadi aplikasi tetap jalan walau
// simpanan kosong / Supabase mati.
// =====================================================================

const MR_PROP = 'MASTER_ROLE_SIMPANAN';
let _mrMemo_ = null;

function _mrSimpanan_() {
  if (_mrMemo_) return _mrMemo_;
  let isi = null;
  try { isi = JSON.parse(PropertiesService.getScriptProperties().getProperty(MR_PROP) || 'null'); } catch (e) { isi = null; }
  _mrMemo_ = isi || { roles: {}, lokasi: {}, alias: {}, waktu: 0 };
  return _mrMemo_;
}

/** Normalisasi nama lokasi lewat alias master_lokasi -> kode baku huruf kecil. */
function lokasiBaku_(lok) {
  const s = String(lok || '').trim().toLowerCase();
  if (!s) return '';
  const alias = _mrSimpanan_().alias || {};
  return alias[s] || s;
}

/**
 * Apakah `lokasiKaryawan` termasuk `cakupan`?
 * cakupan: '' / 'All' / '*' = semua; 'Surabaya' atau 'Surabaya,Jakarta'.
 */
function cocokLokasi_(cakupan, lokasiKaryawan) {
  const c = String(cakupan == null ? '' : cakupan).trim();
  if (!c || c.toLowerCase() === 'all' || c === '*') return true;
  const l = lokasiBaku_(lokasiKaryawan);
  if (!l) return false;
  return c.split(',').some(function (x) { return lokasiBaku_(x) === l; });
}

/**
 * Peran efektif dari kode role + lokasi karyawan itu sendiri.
 * @return {{kode, nama, tingkat, cakupan, menu: string[], terdaftar}}
 */
function peranEfektif_(kodeRole, lokasiUser) {
  const kode = String(kodeRole || '').trim().toLowerCase();
  const r = (_mrSimpanan_().roles || {})[kode];
  if (!r) return { kode: kode, nama: kode, tingkat: kode, cakupan: String(lokasiUser || 'All'), menu: [], terdaftar: false };
  if (!r.aktif) return { kode: kode, nama: r.nama, tingkat: 'karyawan', cakupan: String(lokasiUser || 'All'), menu: [], terdaftar: true };
  const lok = r.lokasi || [];
  const cakupan = lok.indexOf('*') !== -1 ? 'All' : (lok.length ? lok.join(',') : String(lokasiUser || 'All'));
  return { kode: kode, nama: r.nama, tingkat: r.tingkat, cakupan: cakupan, menu: r.menu || [], terdaftar: true };
}

/** Tingkat dari kode role (untuk role karyawan LAIN yang dibaca dari sheet). */
function tingkatRole_(kodeRole) {
  return peranEfektif_(kodeRole, '').tingkat;
}

/** Ambil master dari Supabase dan simpan. Melempar error bila gagal. */
function MASTER_ROLE_SEGARKAN() {
  const j = _sbPanggil('master-role', { aksi: 'semua' });
  if (!j || j.result !== 'success') throw new Error('master-role: ' + ((j && j.message) || 'jawaban tidak dikenal'));
  const roles = {};
  (j.roles || []).forEach(function (r) {
    roles[String(r.kode).toLowerCase()] = {
      nama: r.nama, tingkat: r.tingkat, lokasi: r.lokasi || [], menu: r.menu || [], aktif: r.aktif !== false
    };
  });
  const alias = {};
  (j.lokasi || []).forEach(function (l) {
    if (l.aktif === false) return;
    const baku = String(l.kode).trim().toLowerCase();
    alias[baku] = baku;
    (l.alias || []).forEach(function (a) { alias[String(a).trim().toLowerCase()] = baku; });
  });
  const isi = { roles: roles, alias: alias, waktu: new Date().getTime() };
  PropertiesService.getScriptProperties().setProperty(MR_PROP, JSON.stringify(isi));
  _mrMemo_ = isi;
  Logger.log('Master role tersimpan: ' + Object.keys(roles).length + ' role, ' + Object.keys(alias).length + ' alias lokasi.');
  return { role: Object.keys(roles).length, lokasi: (j.lokasi || []).length };
}

/** Aksi `segarkan_master_role` (admin): dipanggil layar Master Role sesudah menyimpan. */
function handleSegarkanMasterRole(data) {
  // Master karyawan bebas absen berubah -> isi db_absen ikut berubah
  // (NF <-> A). Rekap & indeks statistik harus dihitung ulang.
  if (data && data.bebasBerubah) {
    try { if (typeof rekapCacheBatalkan_ === 'function') rekapCacheBatalkan_(); } catch (e) { console.warn(e.message); }
    try { if (typeof bersihkanIndeksDbAbsen === 'function') bersihkanIndeksDbAbsen(); } catch (e) { console.warn(e.message); }
    return responseJSON({ result: 'success', message: 'Rekap akan dihitung ulang dengan data bebas absen terbaru.' });
  }
  try {
    const h = MASTER_ROLE_SEGARKAN();
    return responseJSON({ result: 'success', message: 'Master role diterapkan (' + h.role + ' role, ' + h.lokasi + ' lokasi). Berlaku untuk request berikutnya; menu baru tampil setelah user login ulang.' });
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal menyegarkan master role: ' + e.message });
  }
}

/**
 * Payroll (kolom H Users) yang lokasinya (kolom N) masuk cakupan.
 * @return {Object<string,boolean>|null} null = tanpa batas
 */
function payrollDalamCakupan_(cakupan) {
  const c = String(cakupan || '').trim();
  if (!c || c.toLowerCase() === 'all' || c === '*') return null;
  const rows = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
  const set = {};
  for (let i = 1; i < rows.length; i++) {
    const p = String(rows[i][7] || '').trim().toUpperCase();
    if (p && cocokLokasi_(c, rows[i][13])) set[p] = true;
  }
  return set;
}

/**
 * Saring jawaban get_rekap_admin untuk peminta bercakupan lokasi
 * (HRD SBY / HRD JKT). Simpanan rekap tetap utuh dan dipakai bersama;
 * penyaringan dilakukan pada salinan jawaban.
 */
function rekapUntukCakupan_(keluaran, cakupan) {
  const set = payrollDalamCakupan_(cakupan);
  if (!set) return keluaran;
  let j;
  try { j = JSON.parse(keluaran.getContent()); } catch (e) { return keluaran; }
  if (!j || j.result !== 'success') return keluaran;
  const boleh = function (x) { return !!set[String((x && x.payroll) || '').trim().toUpperCase()]; };
  j.rawRecords = (j.rawRecords || []).filter(boleh);
  j.dashboardData = (j.dashboardData || []).filter(boleh);
  j.koreksiList = (j.koreksiList || []).filter(boleh);
  j.cakupanLokasi = cakupan;
  return ContentService.createTextOutput(JSON.stringify(j)).setMimeType(ContentService.MimeType.JSON);
}

/** Saring jawaban ABSEN-EMAIL (sheet ABSENSI-email) per payroll. */
function absensiEmailUntukCakupan_(keluaran, cakupan) {
  const set = payrollDalamCakupan_(cakupan);
  if (!set) return keluaran;
  let j;
  try { j = JSON.parse(keluaran.getContent()); } catch (e) { return keluaran; }
  if (!j || j.result !== 'success' || !j.kepala) return keluaran;
  const kepala = (j.kepala.hari || []).map(function (h, i) { return String(h || (j.kepala.label || [])[i] || (j.kepala.tanggal || [])[i] || '').trim().toUpperCase(); });
  const idx = kepala.indexOf('PAYROLL');
  if (idx < 0) { j.baris = []; j.cakupanLokasi = cakupan; return ContentService.createTextOutput(JSON.stringify(j)).setMimeType(ContentService.MimeType.JSON); }
  const baru = [];
  (j.baris || []).forEach(function (b) {
    if (b.pisah) { if (baru.length && !baru[baru.length - 1].pisah) baru.push(b); return; }
    if (set[String(b.t[idx] || '').trim().toUpperCase()]) baru.push(b);
  });
  while (baru.length && baru[baru.length - 1].pisah) baru.pop();
  j.baris = baru;
  j.cakupanLokasi = cakupan;
  return ContentService.createTextOutput(JSON.stringify(j)).setMimeType(ContentService.MimeType.JSON);
}

/** Saring jawaban get_koreksi_list (per payroll) untuk peminta non-admin. */
function _saringKoreksiCakupan_(keluaran, data) {
  const a = data && data._auth;
  if (!a || a.r === 'admin') return keluaran;
  const set = payrollDalamCakupan_(a.l);
  if (!set) return keluaran;
  let j;
  try { j = JSON.parse(keluaran.getContent()); } catch (e) { return keluaran; }
  if (!j || j.result !== 'success') return keluaran;
  j.list = (j.list || []).filter(function (k) { return !!set[String((k && k.payroll) || '').trim().toUpperCase()]; });
  return ContentService.createTextOutput(JSON.stringify(j)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * ID user (kolom A Users) yang lokasinya masuk cakupan peminta non-admin.
 * @return {Object<string,boolean>|null} null = tanpa batas (admin / cakupan All)
 */
function idUserDalamCakupan_(data) {
  const a = data && data._auth;
  // Hanya HRD yang dibatasi di sini; tingkat lain memakai aturan lamanya.
  if (!a || a.r !== 'hrd') return null;
  const c = String(a.l || '').trim();
  if (!c || c.toLowerCase() === 'all' || c === '*') return null;
  const rows = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
  const set = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (id && cocokLokasi_(c, rows[i][13])) set[id] = true;
  }
  return set;
}
