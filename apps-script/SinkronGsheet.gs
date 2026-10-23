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
const SG_FUNGSI_TRIGGER = 'SINKRON_GSHEET_JALAN';
const SG_SHEET_BAWAAN = 'db1-absen';
const SG_JEDA_MS = 2 * 60 * 1000;   // tunggu 2 menit sesudah perubahan terakhir
const SG_MAKS_GESER = 10;           // jadwal digeser paling banyak 10x (~20 menit)

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
    diubahOleh: String((data && (data.adminNama || data.nama)) || ''),
    diubahPada: new Date().toISOString()
  };
  _sgProps_().setProperty(SG_PROP_CFG, JSON.stringify(cfg));
  return handleGetSinkronGsheet({});
}

/** Aksi `sinkron_gsheet`: jalankan sekarang. */
function handleSinkronGsheet(data) {
  try {
    const st = _sgJalankan_('manual', String((data && (data.adminNama || data.nama)) || ''));
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

/** Fungsi trigger. Kalau masih ada perubahan baru (<1,5 menit), geser jadwal. */
function SINKRON_GSHEET_JALAN() {
  _sgHapusTrigger_();
  const props = _sgProps_();
  const antri = Date.parse(props.getProperty(SG_PROP_ANTRI) || '') || 0;
  const geser = Number(props.getProperty(SG_PROP_GESER) || 0);
  if (antri && Date.now() - antri < 90 * 1000 && geser < SG_MAKS_GESER) {
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
  try {
    if (!dari || !sampai) throw new Error('Periode tidak diketahui.');
    const jawab = JSON.parse(handleGetRekapAdmin({ dari: dari, sampai: sampai, segarkan: '1' }).getContent());
    if (!jawab || jawab.result !== 'success') throw new Error('Data rekap gagal dibaca: ' + ((jawab && jawab.message) || 'tanpa pesan'));
    const rec = (jawab.rawRecords || []).filter(function (r) { return r.tanggalYMD >= dari && r.tanggalYMD <= sampai; });
    rec.sort(function (a, b) {
      const ka = String(a.noAkun || '~' + (a.payroll || a.nama || ''));
      const kb = String(b.noAkun || '~' + (b.payroll || b.nama || ''));
      return ka.localeCompare(kb, undefined, { numeric: true }) ||
        String(a.payroll || '').localeCompare(String(b.payroll || '')) ||
        String(a.tanggalYMD).localeCompare(String(b.tanggalYMD));
    });
    const hasil = _sgTulis_(cfg, rec);
    st.ok = true;
    st.baris = rec.length;
    st.namaFile = hasil.namaFile;
    st.pesan = rec.length + ' baris periode ' + dari + ' s/d ' + sampai + ' tertulis ke "' + hasil.namaFile + '" / ' + cfg.sheet + '.';
  } catch (e) {
    st.pesan = e.message;
    throw e;
  } finally {
    st.durasiDetik = Math.round((Date.now() - mulai) / 100) / 10;
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
  return { namaFile: ss.getName() };
}
