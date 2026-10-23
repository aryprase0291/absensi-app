// ================================================================
// SINKRON TABEL DATA (DB_FIX) -> GSHEET DB ABSEN (23 Okt 2026)
//
// Isi "Tabel Data (DB_FIX)" di layar Rekap ditulis ke sebuah sheet di
// spreadsheet lain (bawaan: sheet `db1-absen` di file DB_ABSEN_<BULAN>),
// menggantikan salin-tempel manual dari Excel.
//
// SUMBER DATANYA SATU: handleGetRekapAdmin — fungsi yang sama persis
// dengan yang mengisi Tabel Data (mesin + absen online + koreksi). Jadi
// apa yang terlihat di Tabel Data = apa yang tertulis di GSheet.
//
// KAPAN JALAN
//  - Otomatis: setiap rekapCacheBatalkan_() dipanggil (impor dbabsen,
//    simpan/hapus koreksi, edit tangan) -> dijadwalkan ~2 menit kemudian.
//    Perubahan beruntun (impor berpotongan-potongan) digabung jadi satu
//    sinkron: selama masih ada perubahan baru, jadwal digeser.
//  - Manual: tombol "Sinkron ke GSheet" (aksi `sinkron_gsheet`).
//  - Setiap sinkron (manual/otomatis) LANGSUNG diikuti "Sinkron Absensi"
//    file tujuan (ABSENSI -> ABSENSI-email), lihat _sgPindahAbsensi_.
//
// FILE TUJUAN GANTI TIAP BULAN: link & periode disimpan di Script
// Properties lewat layar "Sinkron GSheet" (aksi `set_sinkron_gsheet`).
//
// CARA MENULIS
//  - Kolom dikenali dari NAMA HEADER baris 1 (bukan posisi), jadi kolom
//    boleh digeser. Header yang tidak dikenali: kalau baris 2 berisi
//    rumus, rumusnya diteruskan ke bawah; kalau tidak, dibiarkan kosong.
//  - Kolom ID (=PAYROLL&TANGGAL) ditulis sebagai rumus, sama seperti
//    sekarang.
//  - TANGGAL ditulis sebagai nomor seri tanggal (bebas zona waktu, tidak
//    bisa bergeser sehari), format tampilannya ikut baris 2.
//  - Seluruh isi lama di bawah header diganti isi periode yang dipilih;
//    sisa baris lama di bawahnya dikosongkan. Sheet TIDAK dihapus, jadi
//    rumus di sheet lain yang merujuk ke sheet ini tetap utuh.
//
// PEMASANGAN: lihat SINKRON-GSHEET.md.
// ================================================================

const SG_PROP_CFG = 'SINKRON_GSHEET_CFG';
const SG_PROP_STATUS = 'SINKRON_GSHEET_STATUS';
const SG_PROP_ANTRI = 'SINKRON_GSHEET_ANTRI';
const SG_PROP_GESER = 'SINKRON_GSHEET_GESER';
const SG_PROP_LOG = 'SINKRON_GSHEET_LOG';   // riwayat sinkron, terbaru di depan
const SG_LOG_MAKS = 30;
const SG_FUNGSI_TRIGGER = 'SINKRON_GSHEET_JALAN';
const SG_SHEET_BAWAAN = 'db1-absen';
const SG_JEDA_MS = 60 * 1000;       // tunggu 1 menit sesudah perubahan terakhir (dulu 2 menit)
const SG_MAKS_GESER = 15;           // jadwal digeser paling banyak 15x (~15 menit)

// Nama header (huruf besar, tanpa spasi/tanda baca) -> field rawRecords
const SG_KOLOM = {
  ID: '_id',
  NOAKUN: 'noAkun', AKUN: 'noAkun',
  PAYROLL: 'payroll', NIK: 'payroll',
  NAMA: 'nama',
  TANGGAL: 'tanggal', TGL: 'tanggal',
  JAMKERJA: 'jamKerja', SHIFT: 'jamKerja',
  MTUGAS: 'mTugas', MULAITUGAS: 'mTugas',
  ATUGAS: 'aTugas', AKHIRTUGAS: 'aTugas',
  MASUK: 'masuk',
  PULANG: 'pulang',
  TELAT: 'telat',
  PAWAL: 'pAwal', PULANGAWAL: 'pAwal',
  BOLOS: 'bolos',
  TJK: 'tjk',
  ID2: 'id2', SYMBOL: 'id2', SIMBOL: 'id2',
  DEPARTEMEN: 'departemen', DEPT: 'departemen',
  ATTTIME: 'attTime',
  WAKTUSCAN: 'waktuScan',
  WEEK: 'week', MINGGU: 'week',
  NOMINAL: 'nominal',
  SUMBER: 'sumber',
  KOREKSI: 'koreksi'
};

// ---------------------------------------------------------------- setelan

function _sgProps_() { return PropertiesService.getScriptProperties(); }

function _sgBacaJson_(kunci) {
  try {
    const t = _sgProps_().getProperty(kunci);
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
}

function _sgBacaCfg_() { return _sgBacaJson_(SG_PROP_CFG); }
function _sgBacaStatus_() { return _sgBacaJson_(SG_PROP_STATUS); }

function _sgSimpanStatus_(st) {
  try { _sgProps_().setProperty(SG_PROP_STATUS, JSON.stringify(st)); } catch (e) { /* abaikan */ }
  _sgTambahLog_(st);
}

/**
 * RIWAYAT SINKRON (23 Okt 2026): satu entri ringkas per sinkron, terbaru di
 * depan, paling banyak SG_LOG_MAKS. Disimpan di satu Script Property, jadi
 * dijaga di bawah batas 9 KB per nilai (entri lama dibuang lebih dulu).
 */
function _sgTambahLog_(st) {
  try {
    const sa = st.sinkronAbsensi || {};
    const ket = st.ok
      ? (sa.dilewati ? 'ABSENSI-email dilewati: ' + sa.dilewati : '')
      : String(st.pesan || '');
    const entri = {
      w: st.waktu, ok: !!st.ok, a: st.asal || '', o: String(st.oleh || '').slice(0, 60),
      n: Number(st.baris || 0), d: Number(st.durasiDetik || 0),
      p: st.dari && st.sampai ? st.dari + '|' + st.sampai : '',
      k: ket.slice(0, 160)
    };
    const log = (_sgBacaJson_(SG_PROP_LOG) || []).filter(function (x) { return x && x.w; });
    log.unshift(entri);
    while (log.length > SG_LOG_MAKS) log.pop();
    let teks = JSON.stringify(log);
    while (teks.length > 8500 && log.length > 1) { log.pop(); teks = JSON.stringify(log); }
    _sgProps_().setProperty(SG_PROP_LOG, teks);
  } catch (e) { /* riwayat boleh gagal, sinkron tidak */ }
}

/** Nama yang tercatat untuk sinkron manual: nama dari layar + ID akun dari token. */
function _sgOleh_(data) {
  const nama = String((data && (data.adminNama || data.nama)) || '').trim().slice(0, 50);
  const id = String((data && data.userId) || '').trim();
  return nama ? nama + (id ? ' (' + id + ')' : '') : id;
}

/** ID spreadsheet dari link lengkap atau ID polos. */
function _sgIdDariLink_(teks) {
  const s = String(teks || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{25,})$/);
  return m ? m[1] : '';
}

/** gid dari link (kalau ada) -> nama sheet. */
function _sgSheetDariGid_(ss, link) {
  const m = String(link || '').match(/[#?&]gid=(\d+)/);
  if (!m) return '';
  const gid = Number(m[1]);
  const sh = ss.getSheets().filter(function (x) { return x.getSheetId() === gid; })[0];
  return sh ? sh.getName() : '';
}

function _sgNormHeader_(h) {
  return String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Periode bawaan = periode aktif penuh (tidak dipotong hari ini). */
function _sgPeriodeBawaan_() {
  try {
    const p = getPeriodeAbsenAktif_();
    if (p && p.mulai) return { dari: p.mulai, sampai: p.selesai || p.mulai };
  } catch (e) { /* abaikan */ }
  return { dari: '', sampai: '' };
}

// ---------------------------------------------------------------- aksi web

/** Aksi `get_sinkron_gsheet`: setelan + status terakhir. */
function handleGetSinkronGsheet(data) {
  // Tab ABSEN-EMAIL memakai aksi yang sama (tanpa perlu rute baru di
  // Code.gs/Auth.gs): bagian='absensi_email' -> isi sheet ABSENSI-email.
  if (data && data.bagian === 'absensi_email') return handleGetAbsensiEmail(data);
  const cfg = _sgBacaCfg_() || {};
  let antri = '';
  try {
    const ada = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === SG_FUNGSI_TRIGGER; });
    if (ada) antri = _sgProps_().getProperty(SG_PROP_ANTRI) || 'ya';
  } catch (e) { /* izin ScriptApp belum diberikan -> abaikan */ }
  return responseJSON({
    result: 'success',
    setelan: {
      link: cfg.link || '',
      id: cfg.id || '',
      namaFile: cfg.namaFile || '',
      sheet: cfg.sheet || SG_SHEET_BAWAAN,
      dari: cfg.dari || '',
      sampai: cfg.sampai || '',
      otomatis: cfg.otomatis !== false
    },
    status: _sgBacaStatus_(),
    log: _sgBacaJson_(SG_PROP_LOG) || [],
    antri: antri,
    periodeBawaan: _sgPeriodeBawaan_(),
    periodeAktif: _rekapDaftarPeriode_()
  });
}

/** Aksi `set_sinkron_gsheet`: simpan link tujuan, nama sheet, periode, otomatis. */
function handleSetSinkronGsheet(data) {
  const link = String((data && data.link) || '').trim();
  const id = _sgIdDariLink_(link);
  if (!id) return responseJSON({ result: 'error', message: 'Link Google Sheet tidak dikenali. Tempel link lengkap dari address bar.' });

  let ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    return responseJSON({ result: 'error', message: 'File tidak bisa dibuka. Pastikan akun pemilik script punya akses Edit ke file itu. (' + e.message + ')' });
  }

  let sheet = String((data && data.sheet) || '').trim() || _sgSheetDariGid_(ss, link) || SG_SHEET_BAWAAN;
  if (!ss.getSheetByName(sheet)) {
    return responseJSON({
      result: 'error',
      message: 'Sheet "' + sheet + '" tidak ada di file "' + ss.getName() + '". Sheet yang ada: ' +
        ss.getSheets().map(function (x) { return x.getName(); }).join(', ')
    });
  }

  const dari = formatDateYMD_Strict(data && data.dari) || String((data && data.dari) || '').slice(0, 10);
  const sampai = formatDateYMD_Strict(data && data.sampai) || String((data && data.sampai) || '').slice(0, 10);
  if ((dari && !sampai) || (!dari && sampai) || (dari && sampai && dari > sampai)) {
    return responseJSON({ result: 'error', message: 'Periode tidak valid.' });
  }

  const cfg = {
    link: link, id: id, namaFile: ss.getName(), sheet: sheet,
    dari: dari, sampai: sampai,
    otomatis: !(data && (data.otomatis === false || data.otomatis === 'false' || data.otomatis === '0')),
    diubahOleh: _sgOleh_(data),
    diubahPada: new Date().toISOString()
  };
  _sgProps_().setProperty(SG_PROP_CFG, JSON.stringify(cfg));
  return handleGetSinkronGsheet({});
}

/** Aksi `sinkron_gsheet`: jalankan sekarang. */
function handleSinkronGsheet(data) {
  try {
    const st = _sgJalankan_('manual', _sgOleh_(data));
    return responseJSON({ result: 'success', status: st, message: st.pesan });
  } catch (e) {
    return responseJSON({ result: 'error', message: e.message, status: _sgBacaStatus_() });
  }
}

// ---------------------------------------------------------------- otomatis

/**
 * Dipanggil dari rekapCacheBatalkan_(). Murah dan tidak pernah melempar:
 * hanya mencatat waktu perubahan dan memastikan ada satu jadwal.
 */
function sinkronGsheetJadwalkan_() {
  try {
    const cfg = _sgBacaCfg_();
    if (!cfg || !cfg.id || cfg.otomatis === false) return;
    const props = _sgProps_();
    props.setProperty(SG_PROP_ANTRI, new Date().toISOString());
    const ada = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === SG_FUNGSI_TRIGGER; });
    if (!ada) {
      props.setProperty(SG_PROP_GESER, '0');
      ScriptApp.newTrigger(SG_FUNGSI_TRIGGER).timeBased().after(SG_JEDA_MS).create();
    }
  } catch (e) {
    // onEdit sederhana tidak boleh membuat trigger; itu wajar.
    console.warn('Sinkron GSheet tidak terjadwal: ' + e.message);
  }
}

function _sgHapusTrigger_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === SG_FUNGSI_TRIGGER) ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* abaikan */ }
}

/** Fungsi trigger. Kalau masih ada perubahan baru (<45 detik), geser jadwal. */
function SINKRON_GSHEET_JALAN() {
  _sgHapusTrigger_();
  const props = _sgProps_();
  const antri = Date.parse(props.getProperty(SG_PROP_ANTRI) || '') || 0;
  const geser = Number(props.getProperty(SG_PROP_GESER) || 0);
  if (antri && Date.now() - antri < 45 * 1000 && geser < SG_MAKS_GESER) {
    props.setProperty(SG_PROP_GESER, String(geser + 1));
    ScriptApp.newTrigger(SG_FUNGSI_TRIGGER).timeBased().after(SG_JEDA_MS).create();
    return;
  }
  props.deleteProperty(SG_PROP_ANTRI);
  props.deleteProperty(SG_PROP_GESER);
  try {
    _sgJalankan_('otomatis', '');
  } catch (e) {
    console.error('Sinkron GSheet otomatis gagal: ' + e.message);
  }
}

/** Jalankan SEKALI dari editor setelah memasang file ini, untuk memberi izin. */
function SINKRON_GSHEET_IZIN() {
  ScriptApp.getProjectTriggers();
  const cfg = _sgBacaCfg_();
  if (cfg && cfg.id) Logger.log('Tujuan: ' + SpreadsheetApp.openById(cfg.id).getName() + ' / ' + cfg.sheet);
  else Logger.log('Izin OK. Atur link tujuan dari layar Rekap > Sinkron GSheet.');
}

// ---------------------------------------------------------------- inti

function _sgJalankan_(asal, oleh) {
  const cfg = _sgBacaCfg_();
  if (!cfg || !cfg.id) throw new Error('Link GSheet tujuan belum diatur. Buka tab "Sinkron GSheet".');

  const kunci = LockService.getScriptLock();
  if (!kunci.tryLock(20000)) throw new Error('Sinkron lain sedang berjalan. Coba lagi sebentar lagi.');
  const mulai = Date.now();
  const bawaan = _sgPeriodeBawaan_();
  const dari = cfg.dari || bawaan.dari;
  const sampai = cfg.sampai || bawaan.sampai;
  const st = {
    waktu: new Date().toISOString(), ok: false, asal: asal, oleh: oleh || '',
    dari: dari, sampai: sampai, namaFile: cfg.namaFile || '', sheet: cfg.sheet, baris: 0, pesan: ''
  };
  const tahap = {};
  try {
    if (!dari || !sampai) throw new Error('Periode tidak diketahui.');
    // Tanpa segarkan=1: simpanan rekap berversi (REKAP_VERSI naik setiap
    // impor/koreksi), jadi isinya selalu terbaru. Kalau masih ada, tahap
    // ini selesai dalam hitungan detik, bukan menghitung ulang dari nol.
    let t0 = Date.now();
    const jawab = JSON.parse(handleGetRekapAdmin({ dari: dari, sampai: sampai }).getContent());
    tahap.data = Date.now() - t0;
    if (!jawab || jawab.result !== 'success') throw new Error('Data rekap gagal dibaca: ' + ((jawab && jawab.message) || 'tanpa pesan'));
    const rec = (jawab.rawRecords || []).filter(function (r) { return r.tanggalYMD >= dari && r.tanggalYMD <= sampai; });
    rec.sort(function (a, b) {
      const ka = String(a.noAkun || '~' + (a.payroll || a.nama || ''));
      const kb = String(b.noAkun || '~' + (b.payroll || b.nama || ''));
      return ka.localeCompare(kb, undefined, { numeric: true }) ||
        String(a.payroll || '').localeCompare(String(b.payroll || '')) ||
        String(a.tanggalYMD).localeCompare(String(b.tanggalYMD));
    });
    t0 = Date.now();
    const hasil = _sgTulis_(cfg, rec);
    tahap.db1 = Date.now() - t0;
    st.baris = rec.length;
    st.namaFile = hasil.namaFile;
    st.pesan = rec.length + ' baris periode ' + dari + ' s/d ' + sampai + ' tertulis ke "' + hasil.namaFile + '" / ' + cfg.sheet + '.';
    // Lanjut: "Sinkron Absensi" di file tujuan (ABSENSI -> ABSENSI-email),
    // supaya ABSENSI-email & tab ABSEN-EMAIL langsung ikut data terbaru.
    try {
      t0 = Date.now();
      const pa = _sgPindahAbsensi_(hasil.ss);
      tahap.absensi = Date.now() - t0;
      st.sinkronAbsensi = pa;
      st.pesan += pa.dilewati ? ' Sinkron Absensi dilewati: ' + pa.dilewati : ' Sinkron Absensi: ' + pa.pesan;
    } catch (e2) {
      st.sinkronAbsensi = { ok: false, pesan: e2.message };
      throw new Error(st.pesan + ' TETAPI Sinkron Absensi (ABSENSI -> ABSENSI-email) gagal: ' + e2.message);
    }
    st.ok = true;
  } catch (e) {
    st.pesan = e.message;
    throw e;
  } finally {
    st.durasiDetik = Math.round((Date.now() - mulai) / 100) / 10;
    const dtk = function (ms) { return (Math.round(ms / 100) / 10).toString().replace('.', ','); };
    st.tahap = tahap;
    if (st.ok) {
      st.pesan += ' (' + dtk(Date.now() - mulai) + ' dtk: data ' + dtk(tahap.data || 0) +
        ' · db1-absen ' + dtk(tahap.db1 || 0) + ' · ABSENSI-email ' + dtk(tahap.absensi || 0) + ')';
    }
    _sgSimpanStatus_(st);
    kunci.releaseLock();
  }
  return st;
}

function _sgSerialTanggal_(ymd) {
  const b = String(ymd || '').split('-');
  if (b.length !== 3) return '';
  return (Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2])) - Date.UTC(1899, 11, 30)) / 86400000;
}

function _sgNilai_(r, field) {
  if (field === 'tanggal') return _sgSerialTanggal_(r.tanggalYMD);
  if (field === 'koreksi') return r.isKoreksi ? ('Sudah' + (r.koreksiKet ? ' - ' + r.koreksiKet : '')) : '';
  if (field === 'sumber') return r.sumber || '';
  if (field === 'nominal') return r.nominal === '' || r.nominal === null || r.nominal === undefined ? '' : Number(r.nominal) || '';
  const v = r[field];
  return v === undefined || v === null ? '' : v;
}

function _sgTulis_(cfg, rec) {
  const ss = SpreadsheetApp.openById(cfg.id);
  const sh = ss.getSheetByName(cfg.sheet);
  if (!sh) throw new Error('Sheet "' + cfg.sheet + '" tidak ada di file "' + ss.getName() + '".');

  const lebar = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, lebar).getDisplayValues()[0];
  const peta = header.map(function (h) { return SG_KOLOM[_sgNormHeader_(h)] || null; });
  const dikenali = peta.filter(Boolean).length;
  if (dikenali < 5) throw new Error('Header baris 1 sheet "' + cfg.sheet + '" tidak dikenali (hanya ' + dikenali + ' kolom cocok).');

  const kolPayroll = peta.indexOf('payroll') + 1;
  const kolTanggal = peta.indexOf('tanggal') + 1;
  const akhirLama = sh.getLastRow();
  const contohRumus = akhirLama >= 2 ? sh.getRange(2, 1, 1, lebar).getFormulasR1C1()[0] : new Array(lebar).fill('');
  const formatTanggal = (kolTanggal && akhirLama >= 2 && sh.getRange(2, kolTanggal).getNumberFormat()) || 'm/d/yyyy';

  // Kolom rumus: ID (pakai rumus baris 2, atau =PAYROLL&TANGGAL), dan kolom tak dikenal yang punya rumus.
  const rumusKolom = peta.map(function (f, c) {
    if (f === '_id') return contohRumus[c] || (kolPayroll && kolTanggal ? '=RC' + kolPayroll + '&RC' + kolTanggal : '');
    if (!f) return contohRumus[c] || '';
    return '';
  });

  const n = rec.length;
  if (sh.getMaxRows() < n + 1) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());

  if (n > 0) {
    const nilai = rec.map(function (r) {
      return peta.map(function (f) { return f && f !== '_id' ? _sgNilai_(r, f) : ''; });
    });
    sh.getRange(2, 1, n, lebar).setValues(nilai);
    rumusKolom.forEach(function (rumus, c) {
      if (!rumus) return;
      const isi = [];
      for (let i = 0; i < n; i++) isi.push([rumus]);
      sh.getRange(2, c + 1, n, 1).setFormulasR1C1(isi);
    });
    if (kolTanggal) sh.getRange(2, kolTanggal, n, 1).setNumberFormat(formatTanggal);
  }
  if (akhirLama > n + 1) sh.getRange(n + 2, 1, akhirLama - n - 1, lebar).clearContent();
  SpreadsheetApp.flush();
  return { namaFile: ss.getName(), ss: ss };
}

// ================================================================
// SINKRON ABSENSI (ABSENSI -> ABSENSI-email) — 23 Okt 2026
//
// Salinan logika tombol "SINKRON ABSENSI" / menu "Sinkron Absensi >
// Pindah ABSENSI -> ABSENSI-email" milik script file DB_ABSEN, supaya
// ikut jalan setiap sinkron (manual & otomatis) TANPA perlu klik tombol
// di GSheet. Urutannya: db1-absen ditulis -> flush -> rumus ABSENSI
// terhitung ulang -> nilai ABSENSI disalin ke ABSENSI-email.
//
// Bedanya dengan versi di file: bekerja pada spreadsheet hasil openById
// (bukan getActive), dan toast diabaikan (tidak ada UI di web app).
// Kalau logika di file DB_ABSEN diubah, ubah juga di sini.
// ================================================================
const SA_SRC = 'ABSENSI';
const SA_DST = 'ABSENSI-email';
const SA_OFFSET = 3;          // kolom D (4) -> A (1)
const SA_DATE_START = 12;     // kolom L = tanggal pertama (ABSEN)
const SA_N_DAYS = 31;         // kolom L..BU
const SA_HEADER_DATE_ROW = 3;
const SA_DAY_NAME_ROW = 4;
const SA_FIRST_ROW = 9;
const SA_SRC_ID_COL = 6;      // F = PAYROLL di ABSENSI
const SA_NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function _saToast_(ss, pesan, judul) { try { ss.toast(pesan, judul, 8); } catch (e) { /* tanpa UI */ } }

function _saLastDataRow_(src) {
  const last = src.getLastRow();
  if (last < 1) return SA_FIRST_ROW;
  const ids = src.getRange(1, SA_SRC_ID_COL, last, 1).getDisplayValues();
  for (let r = ids.length - 1; r >= 0; r--) if (String(ids[r][0]).trim() !== '') return r + 1;
  return SA_FIRST_ROW;
}

// Zona waktu & pemisah rumus dibaca SEKALI per jalan (dulu dibaca ulang
// di setiap sel header — puluhan panggilan ke server Sheets).
let _saTz_ = null, _saPemisah_ = null;
function _saFmtTgl_(ss, v) {
  if (_saTz_ === null) _saTz_ = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Jakarta';
  return v instanceof Date ? Utilities.formatDate(v, _saTz_, 'yyyy-MM-dd') : String(v).trim();
}

function _saRumus_(ss, dst, f) {
  if (_saPemisah_ === null) {
    const contoh = dst.getRange('B2').getFormula();
    _saPemisah_ = (/;/.test(contoh) || /^(in|id)/i.test(ss.getSpreadsheetLocale() || '')) ? ';' : ',';
  }
  return _saPemisah_ === ';' ? f.replace(/,/g, ';') : f;
}

function _saPeriodeDari_(sheet, firstCol) {
  const sel = sheet.getRange(SA_HEADER_DATE_ROW, firstCol);
  if (!(sel.getValue() instanceof Date)) return null;
  const t = String(sel.getDisplayValue()).match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!t) return null;
  const d = +t[1], m1 = +t[2], y = t[3].length === 2 ? 2000 + +t[3] : +t[3];
  const akhirUtc = new Date(Date.UTC(y, m1, d - 1));
  const jumlahHari = Math.round((akhirUtc.getTime() - Date.UTC(y, m1 - 1, d)) / 86400000) + 1;
  const label = d + ' ' + SA_NAMA_BULAN[m1 - 1] + ' - ' + akhirUtc.getUTCDate() + ' ' + SA_NAMA_BULAN[akhirUtc.getUTCMonth()] + ' ' + akhirUtc.getUTCFullYear();
  return { kunci: y + '-' + m1 + '-' + d, bulan: y + '-' + m1, urut: Date.UTC(y, m1 - 1, d), jumlahHari: Math.min(jumlahHari, SA_N_DAYS), label: label };
}

function _saNamaArsip_(p) { return 'ARSIP ' + SA_DST + ' ' + p.label; }

function _saArsipkan_(ss, sh, nama) {
  if (ss.getSheetByName(nama)) return;
  const copy = sh.copyTo(ss).setName(nama);
  const rg = copy.getDataRange();
  rg.copyTo(rg, { contentsOnly: true });
}

function _saSiapkanPeriode_(ss, src, dst) {
  const firstSrcCol = SA_DATE_START + SA_OFFSET;
  const p = _saPeriodeDari_(src, firstSrcCol);
  if (!p) throw new Error('Tanggal pertama di ABSENSI (sel ' + src.getRange(SA_HEADER_DATE_ROW, firstSrcCol).getA1Notation() + ') kosong / bukan tanggal.');
  const lama = _saPeriodeDari_(dst, SA_DATE_START);
  const kolomAkhir = SA_DATE_START + (p.jumlahHari - 1) * 2;
  const rumusJudul = _saRumus_(ss, dst, '="ABSENSI KARYAWAN PERIODE "&UPPER(TEXT(L3,"DD MMM"))&" - "&UPPER(TEXT(' + _sgHurufKolom_(kolomAkhir) + SA_HEADER_DATE_ROW + ',"DD MMM YYYY"))');
  const judulPas = dst.getRange('B2').getFormula().replace(/\s/g, '') === rumusJudul.replace(/\s/g, '');
  if (lama && lama.kunci === p.kunci && judulPas) return p;

  const bulanBaru = !lama || lama.bulan !== p.bulan;
  if (bulanBaru) {
    if (lama && p.urut < lama.urut) {
      throw new Error('Periode ABSENSI (' + p.label + ') lebih lama dari ABSENSI-email (' + lama.label + '). Cek tanggal di ABSENSI sel O3.');
    }
    if (lama) _saArsipkan_(ss, dst, _saNamaArsip_(lama));
    _saToast_(ss, 'Ganti periode ke ' + p.label + (lama ? '. Data lama disimpan di sheet "' + _saNamaArsip_(lama) + '".' : '.'), 'Periode baru');
  }

  const sTgl = src.getRange(SA_HEADER_DATE_ROW, firstSrcCol, 1, SA_N_DAYS * 2).getValues()[0];
  const rgTgl = dst.getRange(SA_HEADER_DATE_ROW, SA_DATE_START, 1, SA_N_DAYS * 2);
  const rgHari = dst.getRange(SA_DAY_NAME_ROW, SA_DATE_START, 1, SA_N_DAYS * 2);
  const tgl = rgTgl.getValues()[0];
  const hari = rgHari.getFormulas()[0];
  for (let i = 0; i < SA_N_DAYS; i++) {
    const k = i * 2;
    tgl[k] = i < p.jumlahHari ? sTgl[k] : '';
    const a1 = _sgHurufKolom_(SA_DATE_START + k) + SA_HEADER_DATE_ROW;
    hari[k] = _saRumus_(ss, dst, '=IF(' + a1 + '="","",TEXT(' + a1 + ',"DDD"))');
  }
  rgTgl.setValues([tgl]);
  // Format tanggal sekaligus satu panggilan (dulu satu per kolom).
  const fmt = rgTgl.getNumberFormats()[0];
  for (let i = 0; i < p.jumlahHari; i++) fmt[i * 2] = 'dd-mm-yyyy';
  rgTgl.setNumberFormats([fmt]);
  rgHari.setFormulas([hari]);
  dst.getRange('B2').setFormula(rumusJudul);
  SpreadsheetApp.flush();
  return p;
}

function _saIsRed_(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return false;
  const r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
  return r >= 180 && g <= 110 && b <= 110;
}

/**
 * Sama dengan pindahSemua() di file DB_ABSEN. Mengembalikan ringkasan;
 * { dilewati } kalau file tidak punya sheet ABSENSI / ABSENSI-email.
 */
function _sgPindahAbsensi_(ss) {
  const src = ss.getSheetByName(SA_SRC);
  const dst = ss.getSheetByName(SA_DST);
  if (!src || !dst) return { ok: true, dilewati: 'sheet "' + (!src ? SA_SRC : SA_DST) + '" tidak ada.' };

  _saTz_ = null; _saPemisah_ = null;
  SpreadsheetApp.flush(); // pastikan rumus ABSENSI sudah membaca db1-absen terbaru
  const startRow = SA_FIRST_ROW;
  const endRow = _saLastDataRow_(src);
  const nCols = (SA_DATE_START - 1) + SA_N_DAYS * 2; // A..BU
  const nRows = endRow - startRow + 1;

  const p = _saSiapkanPeriode_(ss, src, dst);
  const nHari = p.jumlahHari;

  const sH = src.getRange(SA_HEADER_DATE_ROW, SA_DATE_START + SA_OFFSET, 1, nHari * 2).getValues()[0];
  const dH = dst.getRange(SA_HEADER_DATE_ROW, SA_DATE_START, 1, nHari * 2).getValues()[0];
  for (let i = 0; i < nHari * 2; i += 2) {
    if (_saFmtTgl_(ss, sH[i]) !== _saFmtTgl_(ss, dH[i])) throw new Error('Header tanggal beda di hari ke-' + (i / 2 + 1) + ': ' + _saFmtTgl_(ss, sH[i]) + ' vs ' + _saFmtTgl_(ss, dH[i]));
  }

  if (dst.getMaxRows() < endRow) dst.insertRowsAfter(dst.getMaxRows(), endRow - dst.getMaxRows());

  const sVals = src.getRange(startRow, 1 + SA_OFFSET, nRows, nCols).getValues();
  const dRange = dst.getRange(startRow, 1, nRows, nCols);
  const dForm = dRange.getFormulas();
  const nameBg = src.getRange(startRow, 1 + SA_OFFSET + 4, nRows, 1).getBackgrounds();
  let redRows = 0, filledO = 0, skippedF = 0;
  const out = [];

  for (let r = 0; r < nRows; r++) {
    const isEmployee = String(sVals[r][2]).trim() !== '';
    const isRed = isEmployee && _saIsRed_(nameBg[r][0]);
    if (isRed) redRows++;
    const o = [];
    for (let c = 0; c < nCols; c++) {
      const col = c + 1;
      const isAbsen = col >= SA_DATE_START && (col - SA_DATE_START) % 2 === 0;
      const diLuarPeriode = col >= SA_DATE_START && Math.floor((col - SA_DATE_START) / 2) >= nHari;
      if (isRed && (col === 10 || col === 11)) { o.push(''); continue; }
      if (diLuarPeriode) { if (dForm[r][c]) skippedF++; o.push(dForm[r][c] || ''); continue; }
      if (isRed && isAbsen) { o.push('A'); continue; }
      if (dForm[r][c]) { o.push(dForm[r][c]); skippedF++; continue; }
      let v = sVals[r][c];
      if (isEmployee && isAbsen && String(v).trim() === '') { v = 'O'; filledO++; }
      o.push(v);
    }
    out.push(o);
  }
  dRange.setValues(out);
  SpreadsheetApp.flush();
  const pesan = 'periode ' + p.label + ' (' + nHari + ' hari), baris ' + startRow + '-' + endRow + ' tersalin ke ABSENSI-email.';
  _saToast_(ss, pesan, 'Sinkron absensi selesai');
  return { ok: true, pesan: pesan, periode: p.label, baris: nRows, diisiO: filledO, namaMerah: redRows, rumusDilewati: skippedF };
}

// ================================================================
// TAB ABSEN-EMAIL (23 Okt 2026)
//
// Menampilkan sheet ABSENSI-email ("ABSENSI KARYAWAN PERIODE ...") dari
// file DB_ABSEN yang sama dengan tujuan sinkron, apa adanya: teks yang
// tampil, warna latar & warna huruf (warna = arti simbol, lihat legenda
// baris 1), lebar kolom, dan kolom tersembunyi ikut disembunyikan.
// Hanya membaca — tidak menulis apa pun.
// ================================================================
const SG_SHEET_EMAIL = 'ABSENSI-email';
const SG_EMAIL_BARIS_DATA = 9;

function _sgHurufKolom_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function handleGetAbsensiEmail(data) {
  const cfg = _sgBacaCfg_() || {};
  const id = _sgIdDariLink_(data && data.link) || cfg.id;
  if (!id) return responseJSON({ result: 'error', message: 'Link file DB_ABSEN belum diatur. Isi dulu di tab "Sinkron GSheet".' });
  let ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    return responseJSON({ result: 'error', message: 'File DB_ABSEN tidak bisa dibuka: ' + e.message });
  }
  const namaSheet = String((data && data.sheet) || SG_SHEET_EMAIL);
  const sh = ss.getSheetByName(namaSheet);
  if (!sh) {
    return responseJSON({ result: 'error', message: 'Sheet "' + namaSheet + '" tidak ada di "' + ss.getName() + '".' });
  }

  const akhirBaris = sh.getLastRow();
  const akhirKolom = sh.getLastColumn();
  if (akhirBaris < 1 || akhirKolom < 1) return responseJSON({ result: 'error', message: 'Sheet "' + namaSheet + '" kosong.' });
  const rg = sh.getRange(1, 1, akhirBaris, akhirKolom);
  const teks = rg.getDisplayValues();
  const latar = rg.getBackgrounds();
  const huruf = rg.getFontColors();

  // Kolom yang tampil saja.
  const kol = [];
  for (let c = 1; c <= akhirKolom; c++) {
    if (!sh.isColumnHiddenByUser(c)) kol.push(c);
  }

  // Palet warna -> nomor, supaya JSON kecil.
  const palet = [];
  const idxPalet = {};
  const warna = function (w) {
    const k = String(w || '#ffffff').toLowerCase();
    if (idxPalet[k] === undefined) { idxPalet[k] = palet.length; palet.push(k); }
    return idxPalet[k];
  };
  warna('#ffffff'); // 0 = putih
  warna('#000000'); // 1 = hitam

  const ambil = function (r) { return kol.map(function (c) { return teks[r - 1][c - 1]; }); };

  // Legenda baris 1.
  const legenda = [];
  kol.forEach(function (c) {
    const t = String(teks[0][c - 1] || '').trim();
    if (t) legenda.push({ teks: t, b: warna(latar[0][c - 1]), f: warna(huruf[0][c - 1]) });
  });

  // Judul = teks pertama yang tidak kosong di baris 2.
  let judul = '';
  for (let c = 1; c <= akhirKolom && !judul; c++) judul = String(teks[1] ? teks[1][c - 1] : '').trim();

  // Baris data mulai baris 9. Baris kosong putih beruntun dijadikan satu pemisah.
  const baris = [];
  let pemisahTerakhir = true;
  for (let r = SG_EMAIL_BARIS_DATA; r <= akhirBaris; r++) {
    const t = ambil(r);
    const b = kol.map(function (c) { return warna(latar[r - 1][c - 1]); });
    const kosong = t.every(function (x) { return String(x).trim() === ''; }) && b.every(function (x) { return x === 0; });
    if (kosong) {
      if (!pemisahTerakhir) baris.push({ pisah: true });
      pemisahTerakhir = true;
      continue;
    }
    pemisahTerakhir = false;
    baris.push({ r: r, t: t, b: b, f: kol.map(function (c) { return warna(huruf[r - 1][c - 1]); }) });
  }
  while (baris.length && baris[baris.length - 1].pisah) baris.pop();

  return responseJSON({
    result: 'success',
    namaFile: ss.getName(),
    sheet: namaSheet,
    url: ss.getUrl() + '#gid=' + sh.getSheetId(),
    judul: judul,
    kolom: kol.map(function (c) { return { huruf: _sgHurufKolom_(c), lebar: sh.getColumnWidth(c) }; }),
    kepala: { tanggal: ambil(3), hari: ambil(4), label: ambil(5) },
    legenda: legenda,
    palet: palet,
    baris: baris,
    dibaca: new Date().toISOString()
  });
}

// ================================================================
// SINKRON DARI TELEGRAM (23 Okt 2026)
//
// Bot AutoAbsen memanggil aksi `sinkron_gsheet_bot` (tanpa login) dengan
// kunci rahasia sendiri. Kunci disimpan di Script Property
// SINKRON_BOT_KEY — buat dengan SINKRON_BOT_KUNCI_BUAT() dari editor,
// salin hasil Log ke config bot. Ganti kunci = jalankan lagi fungsinya.
//
//   { action:'sinkron_gsheet_bot', kunci:'...', perintah:'sinkron'|'status', oleh:'nama TG' }
// ================================================================
const SG_PROP_BOT_KEY = 'SINKRON_BOT_KEY';

function SINKRON_BOT_KUNCI_BUAT() {
  const k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  _sgProps_().setProperty(SG_PROP_BOT_KEY, k);
  Logger.log('Kunci bot sinkron (salin ke config AutoAbsen): ' + k);
  Logger.log('URL web app: ' + ScriptApp.getService().getUrl());
}

function _sgRingkasStatus_(st) {
  if (!st) return 'Belum pernah sinkron.';
  const w = Utilities.formatDate(new Date(st.waktu), 'Asia/Jakarta', 'dd/MM/yyyy HH:mm');
  return (st.ok ? '✅ ' : '❌ ') + w + ' WIB (' + st.asal + (st.oleh ? ', ' + st.oleh : '') + ')\n' + st.pesan;
}

function handleSinkronGsheetBot(data) {
  const kunciSah = _sgProps_().getProperty(SG_PROP_BOT_KEY) || '';
  const kunci = String((data && data.kunci) || '');
  if (!kunciSah || !kunci || !_timingSafeEqual(kunci, kunciSah)) {
    return responseJSON({ result: 'error', message: 'Kunci bot tidak sah.' });
  }
  const perintah = String((data && data.perintah) || 'sinkron').toLowerCase();
  if (perintah === 'status') {
    const cfg = _sgBacaCfg_() || {};
    return responseJSON({
      result: 'success',
      message: '📄 Tujuan: ' + (cfg.namaFile || '-') + ' / ' + (cfg.sheet || SG_SHEET_BAWAAN) +
        '\n⏱ Otomatis: ' + (cfg.otomatis === false ? 'mati' : 'aktif') + '\n\nTerakhir:\n' + _sgRingkasStatus_(_sgBacaStatus_())
    });
  }
  const oleh = 'Telegram' + (data && data.oleh ? ' · ' + String(data.oleh).slice(0, 60) : '');
  try {
    const st = _sgJalankan_('telegram', oleh);
    return responseJSON({ result: 'success', status: st, message: _sgRingkasStatus_(st) });
  } catch (e) {
    return responseJSON({ result: 'error', message: '❌ Sinkron gagal: ' + e.message });
  }
}
