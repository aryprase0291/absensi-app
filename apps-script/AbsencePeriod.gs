// =======================================================
// PERIODE ABSENSI — File: AbsencePeriod.gs
//
// Sejak 21 Agu 2026: DAFTAR periode, bukan lagi satu periode tunggal.
// Tiap periode punya saklar aktif/tidak, dan boleh ada LEBIH DARI SATU
// yang aktif bersamaan.
//
// ATURAN YANG DISEPAKATI
//   1. Dashboard  : karyawan memilih dari dropdown berisi periode AKTIF
//                   saja. Angkanya per-periode, tidak dijumlah.
//   2. Kuota ijin : 4x PER PERIODE. Yang menentukan kuota mana yang
//                   dipakai adalah TANGGAL ijin yang diajukan, bukan
//                   tanggal hari ini.
//   3. Nonaktif   : tetap bisa dipilih SEMUA orang di tab Riwayat.
//                   Hanya dashboard yang dibatasi periode aktif.
//
// PERIODE DEFAULT (saat dashboard pertama dibuka)
//   Periode aktif yang memuat tanggal HARI INI. Kalau tidak ada yang
//   memuat hari ini, dipakai periode aktif dengan tanggal mulai paling
//   akhir. Kalau belum ada periode sama sekali, dipakai siklus standar
//   tanggal 21 s/d 20. Tidak perlu saklar "default" terpisah di admin —
//   satu hal lebih sedikit untuk salah diatur.
//
// KENAPA PERIODE AKTIF TIDAK BOLEH SALING TUMPANG TINDIH
//   Aturan 2 mengharuskan setiap tanggal jatuh ke TEPAT SATU periode
//   aktif. Kalau 21 Jul-20 Agu dan 1 Agu-31 Agu sama-sama aktif, tanggal
//   10 Agustus ada di dua-duanya dan kuota ijinnya jadi tidak tentu —
//   4x atau 8x tergantung urutan pembacaan. Karena itu tumpang tindih
//   antar periode AKTIF ditolak saat disimpan. Periode NONAKTIF bebas
//   tumpang tindih, karena hanya dipakai untuk melihat histori.
// =======================================================

const ABSENCE_PERIODS_PROPERTY = 'ABSENCE_PERIODS_V2';

// Properti lama (satu periode tunggal). Masih dibaca sekali untuk migrasi,
// setelah itu tidak dipakai lagi. Jangan dihapus dari kode — kalau ada
// deployment lama yang di-rollback, properti ini masih jadi sumbernya.
const ABSENCE_PERIOD_PROPERTY = 'ABSENCE_PERIOD_ACTIVE_V1';

// Batas jumlah periode. Satu entri ~90 byte; 60 periode (5 tahun siklus
// bulanan) ~5,4 KB, masih di bawah batas 9 KB per nilai properti.
const ABSENCE_MAKS_PERIODE = 60;


// =======================================================
// UTILITAS TANGGAL
// =======================================================

function _periodeIsoUtc_(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function _periodeValidYmd_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function _periodeId_(mulai, selesai) {
  return mulai + '_' + selesai;
}

/** Tanggal hari ini menurut zona waktu skrip. @private */
function _periodeHariIni_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _periodeDefaultBerjalan_() {
  const sekarang = _periodeHariIni_().split('-').map(Number);
  const tahun = sekarang[0];
  let bulan = sekarang[1] - 1;
  const hari = sekarang[2];

  // Siklus standar: tanggal 21 sampai tanggal 20 bulan berikutnya.
  if (hari < 21) bulan -= 1;
  const mulai = new Date(Date.UTC(tahun, bulan, 21));
  const selesai = new Date(Date.UTC(tahun, bulan + 1, 20));
  return {
    id: _periodeId_(_periodeIsoUtc_(mulai), _periodeIsoUtc_(selesai)),
    mulai: _periodeIsoUtc_(mulai),
    selesai: _periodeIsoUtc_(selesai),
    aktif: true,
    sumber: 'default'
  };
}

function tanggalDalamPeriode_(tanggalYmd, periode) {
  return !!tanggalYmd && tanggalYmd >= periode.mulai && tanggalYmd <= periode.selesai;
}

function _labelPeriodeAbsen_(periode) {
  const tz = Session.getScriptTimeZone();
  const format = (ymd) => Utilities.formatDate(new Date(`${ymd}T00:00:00Z`), tz, 'dd MMMM yyyy');
  return `${format(periode.mulai)} - ${format(periode.selesai)}`;
}

/** Melengkapi objek periode dengan id + label supaya siap dikirim ke frontend. */
function _periodeLengkap_(p) {
  return {
    id: p.id || _periodeId_(p.mulai, p.selesai),
    mulai: p.mulai,
    selesai: p.selesai,
    aktif: p.aktif !== false,
    label: _labelPeriodeAbsen_(p)
  };
}


// =======================================================
// DAFTAR PERIODE
// =======================================================

/**
 * Seluruh periode tersimpan, urut tanggal mulai DESCENDING (terbaru dulu).
 *
 * Melakukan migrasi otomatis dari properti lama pada pembacaan pertama,
 * sehingga tidak ada langkah manual saat deploy: periode tunggal yang
 * sedang berlaku menjadi entri pertama daftar dengan status aktif.
 */
function getSemuaPeriode_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(ABSENCE_PERIODS_PROPERTY);

  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return _periodeUrut_(arr.filter(_periodeSah_).map(_periodeLengkap_));
    } catch (e) { /* properti rusak: susun ulang di bawah */ }
  }

  // --- Migrasi dari properti lama (satu periode tunggal) ---
  const daftar = [];
  try {
    const lama = props.getProperty(ABSENCE_PERIOD_PROPERTY);
    if (lama) {
      const v = JSON.parse(lama);
      if (_periodeSah_(v)) {
        daftar.push(_periodeLengkap_({ mulai: v.mulai, selesai: v.selesai, aktif: true }));
        console.log('Periode absensi: migrasi dari properti lama (%s - %s).', v.mulai, v.selesai);
      }
    }
  } catch (e) { /* abaikan, pakai default di bawah */ }

  if (!daftar.length) daftar.push(_periodeLengkap_(_periodeDefaultBerjalan_()));

  try {
    props.setProperty(ABSENCE_PERIODS_PROPERTY, JSON.stringify(daftar));
  } catch (e) {
    console.warn('Gagal menyimpan hasil migrasi periode: ' + e.message);
  }
  return _periodeUrut_(daftar);
}

/** @private */
function _periodeSah_(p) {
  return !!p && _periodeValidYmd_(p.mulai) && _periodeValidYmd_(p.selesai) && p.mulai <= p.selesai;
}

/** Terbaru dulu. @private */
function _periodeUrut_(arr) {
  return arr.slice().sort(function (a, b) {
    if (a.mulai === b.mulai) return a.selesai < b.selesai ? 1 : -1;
    return a.mulai < b.mulai ? 1 : -1;
  });
}

/** Periode yang saklarnya aktif, terbaru dulu. */
function getPeriodeAktifList_() {
  return getSemuaPeriode_().filter(function (p) { return p.aktif; });
}

/**
 * Periode DEFAULT — dipakai semua kode lama yang belum mengenal daftar.
 *
 * NAMA FUNGSI INI SENGAJA TIDAK DIUBAH: ada 8 pemanggil di Code.gs dan
 * StatsIndex.gs yang tetap benar dengan memakai periode default, sehingga
 * tidak perlu disentuh satu per satu.
 */
function getPeriodeAbsenAktif_() {
  const aktif = getPeriodeAktifList_();
  if (!aktif.length) return _periodeLengkap_(_periodeDefaultBerjalan_());

  const hariIni = _periodeHariIni_();
  for (let i = 0; i < aktif.length; i++) {
    if (tanggalDalamPeriode_(hariIni, aktif[i])) return aktif[i];
  }
  return aktif[0]; // tidak ada yang memuat hari ini -> yang paling baru
}

/**
 * Periode AKTIF yang memuat sebuah tanggal.
 *
 * Inilah yang menentukan kuota ijin: pengajuan untuk tanggal 5 September
 * dinilai terhadap periode yang memuat 5 September, bukan periode yang
 * kebetulan sedang berjalan hari ini.
 *
 * @return {Object|null} null kalau tanggal itu di luar semua periode aktif.
 */
function cariPeriodeAktifUntukTanggal_(tanggalYmd) {
  if (!_periodeValidYmd_(tanggalYmd)) return null;
  const aktif = getPeriodeAktifList_();
  for (let i = 0; i < aktif.length; i++) {
    if (tanggalDalamPeriode_(tanggalYmd, aktif[i])) return aktif[i];
  }
  return null;
}

/**
 * Periode kuota untuk sebuah tanggal, dengan cadangan.
 * Dipakai handleAbsen & validasiPotonganAbsensi_ supaya pengajuan di luar
 * seluruh periode aktif tetap punya patokan (periode default) dan tidak
 * lolos tanpa batas kuota sama sekali.
 */
function periodeKuotaUntukTanggal_(tanggalYmd) {
  return cariPeriodeAktifUntukTanggal_(tanggalYmd) || getPeriodeAbsenAktif_();
}

/** Satu periode berdasarkan id, termasuk yang NONAKTIF (untuk histori). */
function getPeriodeById_(id) {
  if (!id) return null;
  const semua = getSemuaPeriode_();
  for (let i = 0; i < semua.length; i++) if (semua[i].id === String(id)) return semua[i];
  return null;
}

/**
 * Periode untuk DASHBOARD (get_stats). Hanya menerima periode AKTIF —
 * sesuai aturan 1. Kalau id yang dikirim klien tidak dikenal atau sudah
 * dinonaktifkan, jatuh ke periode default, bukan ditolak: dashboard yang
 * tetap tampil dengan angka periode berjalan lebih baik daripada layar
 * error hanya karena admin baru saja menonaktifkan sebuah periode.
 */
function resolvePeriodeStats_(data) {
  const id = data && data.periodeId ? String(data.periodeId) : '';
  if (id) {
    const p = getPeriodeById_(id);
    if (p && p.aktif) return p;
  }
  return getPeriodeAbsenAktif_();
}

/**
 * Periode untuk HISTORI (riwayat, approval, laporan). Menerima periode
 * aktif MAUPUN nonaktif — sesuai aturan 3.
 */
function resolvePeriodeHistori_(data) {
  const id = data && data.periodeId ? String(data.periodeId) : '';
  if (id) {
    const p = getPeriodeById_(id);
    if (p) return p;
  }
  return getPeriodeAbsenAktif_();
}


// =======================================================
// ACTION
// =======================================================

/**
 * Dipakai dashboard, admin, dan layar Analisa.
 * Bentuk respons lama (`period`) dipertahankan supaya bundle frontend
 * versi lama tetap jalan selama masa transisi.
 */
function handleGetAbsencePeriod(data) {
  const semua = getSemuaPeriode_();
  const aktif = semua.filter(function (p) { return p.aktif; });
  const dipakai = getPeriodeAbsenAktif_();

  return responseJSON({
    result: 'success',
    period: dipakai,          // kompatibilitas bundle lama
    periodeDefault: dipakai,
    periods: semua,           // termasuk nonaktif (untuk Riwayat & admin)
    periodsAktif: aktif       // untuk dropdown dashboard
  });
}

/**
 * Menyimpan SELURUH daftar periode sekaligus (admin).
 *
 * Sengaja "kirim semua, timpa semua" alih-alih tambah/ubah/hapus per
 * baris: satu action, tidak ada urutan operasi yang bisa setengah jadi,
 * dan layar admin tinggal mengirim apa yang ada di layarnya.
 */
function handleSaveAbsencePeriods(data) {
  const masuk = Array.isArray(data.periods) ? data.periods : null;
  if (!masuk) return responseJSON({ result: 'error', message: 'Daftar periode tidak dikirim.' });
  if (masuk.length > ABSENCE_MAKS_PERIODE) {
    return responseJSON({ result: 'error', message: 'Maksimal ' + ABSENCE_MAKS_PERIODE + ' periode.' });
  }

  const bersih = [];
  const idTerpakai = {};

  for (let i = 0; i < masuk.length; i++) {
    const p = masuk[i] || {};
    const mulai = String(p.mulai || '').trim();
    const selesai = String(p.selesai || '').trim();

    if (!_periodeValidYmd_(mulai) || !_periodeValidYmd_(selesai)) {
      return responseJSON({ result: 'error', message: 'Baris ' + (i + 1) + ': tanggal harus berformat YYYY-MM-DD.' });
    }
    if (mulai > selesai) {
      return responseJSON({ result: 'error', message: 'Baris ' + (i + 1) + ': tanggal mulai tidak boleh setelah tanggal selesai.' });
    }

    const durasiHari = Math.round(
      (new Date(selesai + 'T00:00:00Z').getTime() - new Date(mulai + 'T00:00:00Z').getTime()) / 86400000
    ) + 1;
    if (!isFinite(durasiHari) || durasiHari > 366) {
      return responseJSON({ result: 'error', message: 'Baris ' + (i + 1) + ': periode maksimal 366 hari.' });
    }

    const id = _periodeId_(mulai, selesai);
    if (idTerpakai[id]) {
      return responseJSON({ result: 'error', message: 'Periode ' + mulai + ' s/d ' + selesai + ' terdaftar dua kali.' });
    }
    idTerpakai[id] = true;

    bersih.push({ id: id, mulai: mulai, selesai: selesai, aktif: p.aktif !== false });
  }

  // --- Periode AKTIF tidak boleh tumpang tindih ---
  // Lihat penjelasan di kepala file: kuota ijin 4x per periode menuntut
  // setiap tanggal jatuh ke tepat satu periode aktif.
  const aktif = bersih.filter(function (p) { return p.aktif; })
                      .sort(function (a, b) { return a.mulai < b.mulai ? -1 : 1; });
  for (let i = 1; i < aktif.length; i++) {
    if (aktif[i].mulai <= aktif[i - 1].selesai) {
      return responseJSON({
        result: 'error',
        message: 'Periode aktif tidak boleh tumpang tindih: ' +
                 aktif[i - 1].mulai + ' s/d ' + aktif[i - 1].selesai + ' bertabrakan dengan ' +
                 aktif[i].mulai + ' s/d ' + aktif[i].selesai +
                 '. Nonaktifkan salah satunya, atau perbaiki tanggalnya.'
      });
    }
  }

  const payload = JSON.stringify(_periodeUrut_(bersih));
  if (payload.length > 8 * 1024) {
    return responseJSON({ result: 'error', message: 'Daftar periode terlalu besar. Hapus periode lama yang sudah tidak dipakai.' });
  }

  try {
    PropertiesService.getScriptProperties().setProperty(ABSENCE_PERIODS_PROPERTY, payload);
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal menyimpan: ' + e.message });
  }

  // Indeks dbabsen disimpan per periode dan ikut kedaluwarsa kalau
  // batas periodenya berubah. Tanpa ini, dashboard menampilkan angka
  // dari batas tanggal yang lama.
  if (typeof bersihkanIndeksDbAbsen === 'function') bersihkanIndeksDbAbsen();

  const semua = getSemuaPeriode_();
  return responseJSON({
    result: 'success',
    message: 'Daftar periode berhasil disimpan.',
    periods: semua,
    periodsAktif: semua.filter(function (p) { return p.aktif; }),
    periodeDefault: getPeriodeAbsenAktif_()
  });
}

/**
 * Action lama (satu periode). Dipertahankan supaya bundle frontend versi
 * lama tidak error selama masa transisi: menyimpan satu periode berarti
 * menambahkannya ke daftar dalam keadaan aktif, dan menonaktifkan periode
 * aktif lain yang bertabrakan dengannya.
 */
function handleSaveAbsencePeriod(data) {
  const mulai = String(data.mulai || '').trim();
  const selesai = String(data.selesai || '').trim();
  if (!_periodeValidYmd_(mulai) || !_periodeValidYmd_(selesai)) {
    return responseJSON({ result: 'error', message: 'Tanggal periode harus berformat YYYY-MM-DD.' });
  }
  if (mulai > selesai) {
    return responseJSON({ result: 'error', message: 'Tanggal mulai tidak boleh setelah tanggal selesai.' });
  }

  const id = _periodeId_(mulai, selesai);
  const daftar = getSemuaPeriode_().filter(function (p) { return p.id !== id; });

  // Nonaktifkan yang bertabrakan, bukan menghapusnya — datanya masih
  // berguna untuk histori.
  daftar.forEach(function (p) {
    if (p.aktif && !(selesai < p.mulai || mulai > p.selesai)) p.aktif = false;
  });
  daftar.push({ id: id, mulai: mulai, selesai: selesai, aktif: true });

  return handleSaveAbsencePeriods({ periods: daftar });
}
