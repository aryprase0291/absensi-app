// =======================================================
// PERIODE ABSENSI AKTIF
// Disimpan di Script Properties agar admin dapat mengganti siklus tanpa
// menambah kolom atau sheet baru.
// =======================================================

const ABSENCE_PERIOD_PROPERTY = 'ABSENCE_PERIOD_ACTIVE_V1';

function _periodePad2_(angka) {
  return String(angka).padStart(2, '0');
}

function _periodeIsoUtc_(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function _periodeDefaultBerjalan_() {
  const tz = Session.getScriptTimeZone();
  const sekarang = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-').map(Number);
  let tahun = sekarang[0];
  let bulan = sekarang[1] - 1;
  const hari = sekarang[2];

  // Siklus standar: tanggal 21 sampai tanggal 20 bulan berikutnya.
  if (hari < 21) bulan -= 1;
  const mulai = new Date(Date.UTC(tahun, bulan, 21));
  const selesai = new Date(Date.UTC(tahun, bulan + 1, 20));
  return { mulai: _periodeIsoUtc_(mulai), selesai: _periodeIsoUtc_(selesai), sumber: 'default' };
}

function getPeriodeAbsenAktif_() {
  const raw = PropertiesService.getScriptProperties().getProperty(ABSENCE_PERIOD_PROPERTY);
  if (!raw) return _periodeDefaultBerjalan_();
  try {
    const value = JSON.parse(raw);
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.mulai) && /^\d{4}-\d{2}-\d{2}$/.test(value.selesai) && value.mulai <= value.selesai) {
      return { mulai: value.mulai, selesai: value.selesai, sumber: 'admin', diperbaruiPada: value.diperbaruiPada || '' };
    }
  } catch (e) { /* property rusak: gunakan default */ }
  return _periodeDefaultBerjalan_();
}

function tanggalDalamPeriode_(tanggalYmd, periode) {
  return !!tanggalYmd && tanggalYmd >= periode.mulai && tanggalYmd <= periode.selesai;
}

function _labelPeriodeAbsen_(periode) {
  const tz = Session.getScriptTimeZone();
  const format = (ymd) => Utilities.formatDate(new Date(`${ymd}T00:00:00Z`), tz, 'dd MMMM yyyy');
  return `${format(periode.mulai)} - ${format(periode.selesai)}`;
}

function handleGetAbsencePeriod(data) {
  const periode = getPeriodeAbsenAktif_();
  return responseJSON({ result: 'success', period: { ...periode, label: _labelPeriodeAbsen_(periode) } });
}

function handleSaveAbsencePeriod(data) {
  const mulai = String(data.mulai || '').trim();
  const selesai = String(data.selesai || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai) || !/^\d{4}-\d{2}-\d{2}$/.test(selesai)) {
    return responseJSON({ result: 'error', message: 'Tanggal periode harus berformat YYYY-MM-DD.' });
  }
  if (mulai > selesai) {
    return responseJSON({ result: 'error', message: 'Tanggal mulai tidak boleh setelah tanggal selesai.' });
  }

  const mulaiDate = new Date(`${mulai}T00:00:00Z`);
  const selesaiDate = new Date(`${selesai}T00:00:00Z`);
  const durasiHari = Math.round((selesaiDate.getTime() - mulaiDate.getTime()) / 86400000) + 1;
  if (!isFinite(durasiHari) || durasiHari > 366) {
    return responseJSON({ result: 'error', message: 'Periode maksimal 366 hari.' });
  }

  const payload = { mulai, selesai, diperbaruiPada: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty(ABSENCE_PERIOD_PROPERTY, JSON.stringify(payload));
  if (typeof bersihkanIndeksDbAbsen === 'function') bersihkanIndeksDbAbsen();
  const periode = getPeriodeAbsenAktif_();
  return responseJSON({ result: 'success', message: 'Periode absensi aktif berhasil disimpan.', period: { ...periode, label: _labelPeriodeAbsen_(periode) } });
}
