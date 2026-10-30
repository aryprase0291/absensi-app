// =====================================================================
// MODE ABSEN PER KARYAWAN (Okt 2026)
//
// Admin menentukan dari mana absensi seorang karyawan boleh/terbaca:
//   'gabungan' — ONLINE + MESIN (bawaan untuk semua karyawan)
//   'online'   — ONLINE SAJA: scan mesin tidak dipakai untuk jam/status
//   'mesin'    — MESIN SAJA : tombol absen online Hadir/Pulang ditutup dan
//                catatan online Hadir/Pulang tidak ikut dihitung
//
// GABUNGAN = semua absen terbaca. Contoh: masuk lewat aplikasi 08:17,
// pulang lewat mesin 12:32 -> Masuk 08:17, Pulang 12:32, status dihitung
// ulang dari dua jam itu (bukan "Tidak Absen Pulang"). Aturannya:
//   - MASUK  = jam paling AWAL dari mesin dan online;
//   - PULANG = jam paling AKHIR dari mesin dan online;
//   - Si/So/A tertutup bila sisi yang kosong diisi sumber lain;
//   - TERLAMBAT dihitung ulang dari jam masuk gabungan bila jam kerja
//     (kolom "Jam Kerja", mis. 08:30-12:00) terbaca;
//   - PULANG CEPAT dihitung ulang hanya untuk shift siang (selesai > mulai).
//   Simbol non-kehadiran (I, S, C, CB, DL, O, EO, ...) tidak disentuh.
//
// DISIMPAN DI SCRIPT PROPERTIES (sama seperti GPS_GERBANG_BEBAS), berupa
// JSON { userId: 'online' | 'mesin' }. Karyawan bermode 'gabungan' tidak
// dicatat — isinya hanya pengecualian, jadi tetap kecil.
// =====================================================================
const MODE_ABSEN_KEY = 'MODE_ABSEN_PER_USER';
const MODE_ABSEN_DEFAULT = 'gabungan';
const MODE_ABSEN_VALID = ['gabungan', 'online', 'mesin'];

function modeAbsenNormal_(mode) {
  const m = String(mode === null || mode === undefined ? '' : mode).trim().toLowerCase();
  if (m === 'online' || m === 'online_saja' || m === 'online saja') return 'online';
  if (m === 'mesin' || m === 'mesin_saja' || m === 'mesin saja') return 'mesin';
  return MODE_ABSEN_DEFAULT;
}

function modeAbsenLabel_(mode) {
  const m = modeAbsenNormal_(mode);
  if (m === 'online') return 'Online saja';
  if (m === 'mesin') return 'Mesin saja';
  return 'Online + mesin';
}

/** Peta { userId: 'online'|'mesin' } — hanya yang BUKAN bawaan. */
function modeAbsenPeta() {
  let mentah = '';
  try {
    mentah = (typeof _propGetCepat_ === 'function')
      ? _propGetCepat_(MODE_ABSEN_KEY)
      : String(PropertiesService.getScriptProperties().getProperty(MODE_ABSEN_KEY) || '');
  } catch (e) { mentah = ''; }
  if (!mentah) return {};
  try {
    const obj = JSON.parse(mentah);
    const hasil = {};
    Object.keys(obj || {}).forEach(function (id) {
      const m = modeAbsenNormal_(obj[id]);
      if (m !== MODE_ABSEN_DEFAULT) hasil[String(id).trim()] = m;
    });
    return hasil;
  } catch (e) {
    console.warn('MODE_ABSEN_PER_USER rusak, dianggap kosong: ' + e.message);
    return {};
  }
}

function modeAbsenUntuk(userId) {
  const id = String(userId === null || userId === undefined ? '' : userId).trim();
  if (!id) return MODE_ABSEN_DEFAULT;
  return modeAbsenPeta()[id] || MODE_ABSEN_DEFAULT;
}

/** Ubah mode beberapa karyawan sekaligus (satu tulisan properti). */
function modeAbsenSetBanyak(userIds, mode) {
  const m = modeAbsenNormal_(mode);
  const peta = modeAbsenPeta();
  (userIds || []).forEach(function (uid) {
    const id = String(uid === null || uid === undefined ? '' : uid).trim();
    if (!id) return;
    if (m === MODE_ABSEN_DEFAULT) delete peta[id];
    else peta[id] = m;
  });
  const props = PropertiesService.getScriptProperties();
  if (Object.keys(peta).length) props.setProperty(MODE_ABSEN_KEY, JSON.stringify(peta));
  else props.deleteProperty(MODE_ABSEN_KEY);
  if (typeof _propLupakanSatuan_ === 'function') _propLupakanSatuan_(MODE_ABSEN_KEY);
  if (typeof rekapCacheBatalkan_ === 'function') {
    try { rekapCacheBatalkan_(); } catch (e) { /* cache rekap basi lebih baik daripada gagal simpan */ }
  }
  return peta;
}

function modeAbsenSet(userId, mode) {
  return modeAbsenSetBanyak([userId], mode);
}

/**
 * Peta pencarian untuk rekap admin, yang barisnya hanya membawa payroll
 * dan nama (bukan User ID). Kunci: payroll & nama huruf kecil.
 * rowsUsers: index 0 = User ID, 3 = Nama, 7 = No Payroll.
 */
function modeAbsenPetaRekap_(rowsUsers) {
  const peta = modeAbsenPeta();
  const hasil = {};
  if (!Object.keys(peta).length) return hasil;
  for (let i = 1; i < (rowsUsers || []).length; i++) {
    const r = rowsUsers[i];
    const id = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
    const m = peta[id];
    if (!m) continue;
    const payroll = String(r[7] || '').trim().toLowerCase();
    const nama = String(r[3] || '').trim().toLowerCase();
    if (payroll) hasil[payroll] = m;
    if (nama && !hasil[nama]) hasil[nama] = m;
  }
  return hasil;
}

function modeAbsenCariRekap_(petaRekap, payroll, nama) {
  const p = String(payroll || '').trim().toLowerCase();
  const n = String(nama || '').trim().toLowerCase();
  return (p && petaRekap[p]) || (n && petaRekap[n]) || MODE_ABSEN_DEFAULT;
}

// ---------------------------------------------------------------------
// PENGGABUNGAN MESIN + ONLINE
// ---------------------------------------------------------------------

/** 'HH:mm' / 'HH:mm:ss' / Date / pecahan hari -> menit, atau null. */
function _modeMenit_(val) {
  if (val === null || val === undefined || val === '' || val === '-') return null;
  if (Object.prototype.toString.call(val) === '[object Date]') {
    if (isNaN(val.getTime())) return null;
    const s = Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
    return _modeMenit_(s);
  }
  if (typeof val === 'number') {
    if (val >= 0 && val < 1) return Math.round(val * 24 * 60);
    return null;
  }
  const str = String(val).trim();
  if (str.indexOf('T') !== -1 && /\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return _modeMenit_(d);
  }
  const c = str.match(/(\d{1,2})[:.](\d{2})/);
  if (!c) return null;
  const h = Number(c[1]), mnt = Number(c[2]);
  if (h > 23 || mnt > 59) return null;
  return h * 60 + mnt;
}

function _modeJam_(menit) {
  if (menit === null || menit === undefined) return '';
  return String(Math.floor(menit / 60)).padStart(2, '0') + ':' + String(menit % 60).padStart(2, '0');
}

/** "08:30-12:00" -> { mulai: 510, selesai: 720 } (null bila tak terbaca). */
function _modeShift_(jamKerja) {
  const s = String(jamKerja || '');
  const c = s.match(/(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/);
  if (!c) return { mulai: null, selesai: null };
  return { mulai: _modeMenit_(c[1]), selesai: _modeMenit_(c[2]) };
}

// Pecahan simbol kehadiran mesin. Simbol yang tidak ada di sini (I, S, C,
// CB, DL, O, EO, NF, ...) dianggap bukan soal scan dan tidak diubah.
const _MODE_POLA_SIMBOL = {
  'H':    { t: false, pc: false, noIn: false, noOut: false },
  'T':    { t: true,  pc: false, noIn: false, noOut: false },
  'PC':   { t: false, pc: true,  noIn: false, noOut: false },
  'TPC':  { t: true,  pc: true,  noIn: false, noOut: false },
  'SI':   { t: false, pc: false, noIn: true,  noOut: false },
  'SO':   { t: false, pc: false, noIn: false, noOut: true },
  'TSI':  { t: true,  pc: false, noIn: true,  noOut: false },
  'TSO':  { t: true,  pc: false, noIn: false, noOut: true },
  'SIPC': { t: false, pc: true,  noIn: true,  noOut: false },
  'SISO': { t: false, pc: false, noIn: true,  noOut: true },
  'A':    { t: false, pc: false, noIn: true,  noOut: true },
  'AC':   { t: false, pc: false, noIn: true,  noOut: true },
  'ALPA': { t: false, pc: false, noIn: true,  noOut: true },
  '':     { t: false, pc: false, noIn: true,  noOut: true }
};

function _modeSusunSimbol_(f) {
  if (f.noIn && f.noOut) return null;          // tidak ada scan sama sekali
  if (f.noIn) return f.pc ? 'SiPC' : 'Si';
  if (f.noOut) return f.t ? 'TSo' : 'So';
  if (f.t && f.pc) return 'TPC';
  if (f.t) return 'T';
  if (f.pc) return 'PC';
  return 'H';
}

/**
 * Gabungkan satu hari mesin dengan absen online sesuai mode karyawan.
 *
 * @param {Object} m   { symbol, masuk, pulang, telat, jamKerja } — boleh
 *                     null kalau hari itu tidak ada baris mesin.
 * @param {Object} onl { masuk, pulang } jam 'HH:mm' dari absen online, atau null.
 * @param {string} mode 'gabungan' | 'online' | 'mesin'
 * @return {Object} { symbol, masuk, pulang, telat, masukSumber, pulangSumber,
 *                    berubah, pakaiOnline } — berubah=false berarti nilai
 *                    mesin dipakai apa adanya.
 */
function gabungAbsenMesinOnline_(m, onl, mode) {
  mode = modeAbsenNormal_(mode);
  const mesin = m || { symbol: '', masuk: '', pulang: '', telat: '', jamKerja: '' };
  const simbolAsli = String(mesin.symbol || '').trim();
  const pola0 = _MODE_POLA_SIMBOL[simbolAsli.toUpperCase()];

  let mMasuk = _modeMenit_(mesin.masuk);
  let mPulang = _modeMenit_(mesin.pulang);
  let mTelat = mesin.telat;
  let pola = pola0 ? { t: pola0.t, pc: pola0.pc, noIn: pola0.noIn, noOut: pola0.noOut } : null;

  const tetap = {
    symbol: simbolAsli, masuk: mesin.masuk, pulang: mesin.pulang, telat: mesin.telat,
    masukSumber: mMasuk !== null ? 'mesin' : '', pulangSumber: mPulang !== null ? 'mesin' : '',
    berubah: false, pakaiOnline: false
  };

  // ONLINE SAJA: scan mesin diabaikan, hari dinilai seolah mesin kosong.
  if (mode === 'online' && pola) {
    mMasuk = null; mPulang = null; mTelat = '';
    pola = { t: false, pc: false, noIn: true, noOut: true };
  }

  const oMasuk = (mode !== 'mesin' && onl) ? _modeMenit_(onl.masuk) : null;
  const oPulang = (mode !== 'mesin' && onl) ? _modeMenit_(onl.pulang) : null;

  // Simbol non-kehadiran (cuti, sakit, DL, libur...) tidak diubah.
  if (!pola) return tetap;

  if (mode === 'mesin' || (oMasuk === null && oPulang === null)) {
    if (mode !== 'online') return tetap;
    // Online saja tanpa absen online hari itu = tidak ada scan.
    return { symbol: m ? 'A' : '', masuk: '', pulang: '', telat: '', masukSumber: '', pulangSumber: '',
             berubah: true, pakaiOnline: false };
  }

  // MASUK paling awal, PULANG paling akhir.
  let masuk = mMasuk, masukSumber = mMasuk !== null ? 'mesin' : '';
  if (oMasuk !== null && (masuk === null || oMasuk < masuk)) { masuk = oMasuk; masukSumber = 'online'; }
  let pulang = mPulang, pulangSumber = mPulang !== null ? 'mesin' : '';
  if (oPulang !== null && (pulang === null || oPulang > pulang)) { pulang = oPulang; pulangSumber = 'online'; }

  const shift = _modeShift_(mesin.jamKerja);
  const shiftMalam = shift.mulai !== null && shift.selesai !== null && shift.selesai <= shift.mulai;

  // SATU SCAN YANG SALAH KOLOM. Mesin yang hanya menerima satu scan sehari
  // kadang menaruhnya di kolom MASUK walau itu scan pulang (dan sebaliknya).
  // Contoh: masuk online 08:17 + satu scan mesin 12:32 tercatat "masuk"
  // -> 12:32 sebenarnya PULANG. Waktu dianggap pulang bila sudah lewat
  // tengah jam kerja (atau >= 4 jam setelah masuk bila jam kerja tak
  // terbaca). Shift malam tidak dinilai: jamnya menyeberang tengah malam.
  if (!shiftMalam) {
    const tengah = (shift.mulai !== null && shift.selesai !== null) ? (shift.mulai + shift.selesai) / 2 : null;
    const lewatTengah = function (t, acuanMasuk) { return tengah !== null ? t >= tengah : (t - acuanMasuk >= 240); };
    const sebelumTengah = function (t, acuanPulang) { return tengah !== null ? t < tengah : (acuanPulang - t >= 240); };
    if (pulang === null && masuk !== null) {
      [[mMasuk, 'mesin'], [oMasuk, 'online']].forEach(function (c) {
        if (c[0] !== null && c[0] > masuk && lewatTengah(c[0], masuk) && (pulang === null || c[0] > pulang)) {
          pulang = c[0]; pulangSumber = c[1];
        }
      });
    }
    if (masuk === null && pulang !== null) {
      [[mPulang, 'mesin'], [oPulang, 'online']].forEach(function (c) {
        if (c[0] !== null && c[0] < pulang && sebelumTengah(c[0], pulang) && (masuk === null || c[0] < masuk)) {
          masuk = c[0]; masukSumber = c[1];
        }
      });
    }
  }

  const f = { t: pola.t, pc: pola.pc, noIn: masuk === null, noOut: pulang === null };

  // TERLAMBAT: dihitung ulang dari jam masuk gabungan bila jam kerja ada.
  let telat = mTelat;
  if (masuk !== null && shift.mulai !== null && (masukSumber === 'online' || pola.noIn)) {
    const selisih = masuk - shift.mulai;
    // Shift malam: masuk sebelum tengah malam vs mulai 20:00 tetap benar;
    // selisih negatif besar berarti masuk sangat awal, bukan telat.
    f.t = selisih > 0 && selisih < 12 * 60;
    telat = f.t ? _modeJam_(selisih) : '';
  } else if (masuk === null) {
    f.t = false;
  }

  // PULANG CEPAT: hanya shift siang, hanya bila jam pulang berubah.
  if (pulang !== null && shift.selesai !== null && !shiftMalam && (pulangSumber === 'online' || pola.noOut)) {
    f.pc = pulang < shift.selesai;
  } else if (pulang === null) {
    f.pc = false;
  }

  const simbolBaru = _modeSusunSimbol_(f) || simbolAsli;
  return {
    symbol: simbolBaru,
    masuk: masuk !== null ? _modeJam_(masuk) : '',
    pulang: pulang !== null ? _modeJam_(pulang) : '',
    telat: telat,
    masukSumber: masukSumber,
    pulangSumber: pulangSumber,
    berubah: true,
    pakaiOnline: masukSumber === 'online' || pulangSumber === 'online'
  };
}

// ---------------------------------------------------------------------
// ENDPOINT ADMIN: terapkan mode ke satu divisi sekaligus
// ---------------------------------------------------------------------
function handleApplyModeAbsenDivisi(data) {
  if (String(data.roleRequester || '').toLowerCase() !== 'admin') {
    return responseJSON({ result: 'error', message: 'Hanya Admin yang boleh mengubah mode absen.' });
  }
  const divisi = String(data.divisi || '').trim().toLowerCase();
  if (!divisi) return responseJSON({ result: 'error', message: 'Divisi belum dipilih.' });
  const mode = modeAbsenNormal_(data.modeAbsen);
  const ids = bacaSheet(SS.getSheetByName(SHEET_USERS), 6).slice(1)
    .filter(function (r) { return String(r[0]).trim() !== '' && String(r[4] || '').trim().toLowerCase() === divisi; })
    .map(function (r) { return String(r[0]).trim(); });
  if (!ids.length) return responseJSON({ result: 'error', message: 'Tidak ada karyawan pada divisi tersebut.' });
  const peta = modeAbsenSetBanyak(ids, mode);
  return responseJSON({
    result: 'success',
    message: 'Mode absen "' + modeAbsenLabel_(mode) + '" diterapkan ke ' + ids.length + ' karyawan divisi ' + data.divisi + '.',
    modeAbsen: peta
  });
}
