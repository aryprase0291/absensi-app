// =====================================================================
// ANTI-FAKE GPS — MESIN DETEKSI SISI SERVER
//
// KENAPA FILE INI ADA
// Sebelum ini seluruh pemeriksaan Fake GPS hanya berjalan di browser
// (src/utils/antiFakeGps.js). Browser dikendalikan sepenuhnya oleh
// karyawan, jadi proteksi itu bisa dilewati hanya dengan mengubah satu
// baris JavaScript atau mengirim POST langsung ke URL Apps Script.
// Semua pemeriksaan di file ini berjalan di server dan memakai data yang
// TIDAK dikirim oleh browser (riwayat absensi karyawan itu sendiri),
// sehingga tidak bisa dipalsukan dari sisi pengguna.
//
// TIGA LAPIS PERTAHANAN
//   Lapis 1 (browser)  : sinyal cepat — mock flag, jitter, otomasi.
//                        Berguna, tapi SELALU anggap bisa dipalsukan.
//   Lapis 2 (server)   : geofence + pola riwayat. Tidak bisa dipalsukan.
//   Lapis 3 (forensik) : semua percobaan dicatat ke sheet GpsAudit,
//                        termasuk yang ditolak, untuk bukti HRD.
// =====================================================================

const SHEET_GPS_AUDIT = "GpsAudit";
const GPS_AUDIT_HEADERS = [
  "Waktu", "UUID", "UserID", "Nama", "Tipe", "Latitude", "Longitude", "Alamat",
  "Akurasi(m)", "Skor", "Level", "Keputusan", "Alasan",
  "Jarak Geofence(m)", "Kecepatan(km/j)", "Jitter(m)", "Device ID",
  "Platform", "User Agent"
];

// Ambang batas terpusat. Semua angka di bawah sengaja dikumpulkan di satu
// tempat supaya HRD bisa melonggarkan/mengetatkan tanpa membedah logika.
const GPS_AMBANG = {
  SKOR_BLOKIR: 100,        // >= nilai ini -> absen DITOLAK
  SKOR_TINJAU: 50,         // >= nilai ini -> absen masuk tapi ditandai
  SKOR_WASPADA: 20,        // >= nilai ini -> dicatat saja

  KECEPATAN_MAKS_KMJ: 250, // di atas ini perpindahan dianggap mustahil
  JARAK_MIN_TELEPORT_M: 800,
  JEDA_MIN_TELEPORT_DTK: 30,

  AKURASI_MAKS_M: 500,     // di atas ini koordinat tidak layak dipakai
  AKURASI_CURIGA_M: 200,   // indikasi lokasi jaringan/WiFi, bukan GPS
  DESIMAL_MIN: 4,

  IDENTIK_BERTURUT: 6,     // koordinat sama persis berturut-turut
  IDENTIK_RASIO: 0.9,      // >90% record identik dalam jendela riwayat
  RIWAYAT_JENDELA: 25,     // berapa record terakhir yang diperiksa
  BARIS_DIBACA: 1500,      // baris terakhir sheet yang dipindai

  JITTER_MIN_M: 0.5,       // pergeseran minimum antar-sampel GPS asli
  DRIFT_WAKTU_MS: 45000
};

// ---------------------------------------------------------------------
// UTILITAS
// ---------------------------------------------------------------------

function _gpsJarakMeter(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _gpsParseTitik(lokasi) {
  const teks = String(lokasi === null || lokasi === undefined ? '' : lokasi).trim();
  if (!teks || teks === '-') return null;
  const parts = teks.split(',');
  if (parts.length < 2) return null;
  const lat = Number(String(parts[0]).trim());
  const lng = Number(String(parts[1]).trim());
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: lat, lng: lng };
}

// Kunci pembanding koordinat. Sengaja dipotong 6 desimal (~0,11 meter):
// dua pembacaan GPS asli praktis tidak pernah sama sampai 6 desimal,
// sedangkan pin Fake GPS selalu identik. Memakai string mentah terlalu
// rapuh karena pembulatan float bisa berbeda antar perangkat.
function _gpsKunci(titik) {
  if (!titik) return '';
  return titik.lat.toFixed(6) + ',' + titik.lng.toFixed(6);
}

function _gpsJumlahDesimal(nilai) {
  const s = String(nilai);
  const idx = s.indexOf('.');
  if (idx === -1) return 0;
  return s.length - idx - 1;
}

function _gpsKeWaktu(nilai) {
  if (nilai instanceof Date) return nilai.getTime();
  const d = new Date(nilai);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// ---------------------------------------------------------------------
// PEMBACAAN RIWAYAT
//
// Hanya membaca ekor sheet (bukan seluruh sheet) dan hanya 5 kolom.
// Ini penting: handleAbsen dipanggil di jalur kritis absen pagi, dan
// aplikasi ini sudah punya riwayat masalah lambat (lihat DIAGNOSA-LAMBAT).
// ---------------------------------------------------------------------
function _gpsRiwayatUser(userId, batasRecord) {
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const jumlah = Math.min(lastRow - 1, GPS_AMBANG.BARIS_DIBACA);
  const mulai = lastRow - jumlah + 1;
  // Kolom B..F = Waktu, UserID, Nama, Tipe, Lokasi
  const nilai = sheet.getRange(mulai, 2, jumlah, 5).getValues();

  const hasil = [];
  const target = String(userId);
  for (let i = nilai.length - 1; i >= 0; i--) {
    if (String(nilai[i][1]) !== target) continue;
    const tipe = String(nilai[i][3] || '');
    if (tipe !== 'Hadir' && tipe !== 'Pulang') continue;
    const titik = _gpsParseTitik(nilai[i][4]);
    if (!titik) continue;
    hasil.push({ waktu: _gpsKeWaktu(nilai[i][0]), tipe: tipe, titik: titik });
    if (hasil.length >= (batasRecord || GPS_AMBANG.RIWAYAT_JENDELA)) break;
  }
  return hasil; // terbaru lebih dulu
}

// Berapa KARYAWAN LAIN yang pernah memakai koordinat persis sama.
//
// Ini pembeda paling jujur antara Fake GPS dan lokasi WiFi. Positioning
// berbasis WiFi memang mengembalikan koordinat identik berulang, TAPI
// koordinat itu akan sama untuk semua orang yang memakai jaringan yang
// sama. Pin Fake GPS pribadi hanya muncul pada satu karyawan.
function _gpsPemakaiLain(kunci, userIdSendiri) {
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const jumlah = Math.min(lastRow - 1, GPS_AMBANG.BARIS_DIBACA);
  const nilai = sheet.getRange(lastRow - jumlah + 1, 3, jumlah, 4).getValues(); // C..F
  const lain = {};
  for (let i = 0; i < nilai.length; i++) {
    const uid = String(nilai[i][0]);
    if (uid === String(userIdSendiri) || !uid) continue;
    const titik = _gpsParseTitik(nilai[i][3]);
    if (!titik) continue;
    if (_gpsKunci(titik) === kunci) lain[uid] = true;
  }
  return Object.keys(lain).length;
}

// ---------------------------------------------------------------------
// MESIN SKOR
// ---------------------------------------------------------------------

/**
 * Menilai integritas satu pengajuan absen.
 * @param {Object} data payload dari client (lokasi, gpsAccuracy, gpsBukti...)
 * @param {Object} [geofenceInfo] hasil validasiGeofence untuk konteks
 * @returns {{skor:number, level:string, blokir:boolean, alasan:string[], detail:Object}}
 */
function analisaIntegritasGps(data, geofenceInfo) {
  const tipe = String(data.tipe || '').trim();
  const hasil = {
    skor: 0,
    level: 'AMAN',
    blokir: false,
    alasan: [],
    detail: { kecepatan: null, jitter: null, identikBerturut: 0, pemakaiLain: null }
  };

  // Hanya absen kehadiran online yang membawa koordinat. Tipe pengajuan
  // (Cuti, Sakit, Ijin) tidak dinilai supaya tidak ada false positive.
  if (tipe !== 'Hadir' && tipe !== 'Pulang') return hasil;

  const bukti = data.gpsBukti || {};
  const titik = _gpsParseTitik(data.lokasi);
  const akurasi = Number(data.gpsAccuracy);

  const tambah = function (poin, teks) {
    hasil.skor += poin;
    hasil.alasan.push(teks);
  };

  // --- A. KOORDINAT TIDAK ADA / TIDAK VALID -------------------------
  if (!titik) {
    tambah(100, 'Koordinat GPS tidak terkirim atau formatnya tidak valid');
    hasil.level = 'BLOKIR';
    hasil.blokir = true;
    return hasil;
  }

  // --- B. SINYAL DARI CLIENT ----------------------------------------
  // Dipercaya hanya sebagai penambah bukti, tidak pernah sebagai
  // satu-satunya alasan menerima. Client yang jujur akan melaporkan ini;
  // client yang dimodifikasi hanya bisa MENGHILANGKAN sinyal, bukan
  // menghindari pemeriksaan riwayat di bagian D dan E.
  if (data.isMockGps === true || bukti.mockFlag === true) {
    tambah(100, 'Perangkat melaporkan Mock Location aktif (aplikasi Fake GPS)');
  }
  if (bukti.otomasi === true) {
    tambah(100, 'Browser berjalan dalam mode otomasi/DevTools (override lokasi)');
  }

  // --- C. NILAI KOORDINAT YANG MUSTAHIL SECARA FISIK ----------------
  if (Math.abs(titik.lat) < 0.0001 && Math.abs(titik.lng) < 0.0001) {
    tambah(100, 'Koordinat berada di titik 0,0 (Null Island) — koordinat palsu');
  }
  if (isFinite(akurasi) && akurasi <= 0) {
    tambah(100, 'Akurasi GPS 0 meter — nilai ini mustahil pada perangkat asli');
  }
  const desimal = Math.min(_gpsJumlahDesimal(titik.lat), _gpsJumlahDesimal(titik.lng));
  if (desimal < GPS_AMBANG.DESIMAL_MIN) {
    tambah(100, 'Presisi koordinat hanya ' + desimal + ' desimal — indikasi koordinat diketik manual');
  }
  if (isFinite(akurasi) && akurasi > GPS_AMBANG.AKURASI_MAKS_M) {
    tambah(60, 'Akurasi GPS ' + Math.round(akurasi) + ' m — terlalu lemah untuk dipakai absen');
  } else if (isFinite(akurasi) && akurasi > GPS_AMBANG.AKURASI_CURIGA_M) {
    tambah(15, 'Akurasi ' + Math.round(akurasi) + ' m — kemungkinan lokasi jaringan/WiFi, bukan GPS sebenarnya');
  }

  // --- D. JITTER ANTAR-SAMPEL ---------------------------------------
  // GPS asli selalu bergetar beberapa sentimeter sampai beberapa meter
  // antar pembacaan. Pin Fake GPS mengembalikan angka yang sama persis.
  if (bukti.jitterMeter !== undefined && bukti.jitterMeter !== null && isFinite(Number(bukti.jitterMeter))) {
    const jitter = Number(bukti.jitterMeter);
    hasil.detail.jitter = jitter;
    if (bukti.sampel >= 2 && jitter === 0) {
      tambah(45, 'Koordinat sama persis pada 2 pembacaan berturut — GPS asli selalu bergetar sedikit');
    }
  }

  // --- E. POLA RIWAYAT (TIDAK BISA DIPALSUKAN DARI BROWSER) ---------
  const riwayat = _gpsRiwayatUser(data.userId, GPS_AMBANG.RIWAYAT_JENDELA);
  const kunciBaru = _gpsKunci(titik);
  const sekarang = Date.now();

  // E1. Perpindahan yang mustahil secara fisik (teleport).
  if (riwayat.length > 0 && riwayat[0].waktu) {
    const jarak = _gpsJarakMeter(titik.lat, titik.lng, riwayat[0].titik.lat, riwayat[0].titik.lng);
    const jedaDetik = (sekarang - riwayat[0].waktu) / 1000;
    if (jedaDetik >= GPS_AMBANG.JEDA_MIN_TELEPORT_DTK && jarak >= GPS_AMBANG.JARAK_MIN_TELEPORT_M) {
      const kmj = (jarak / 1000) / (jedaDetik / 3600);
      hasil.detail.kecepatan = Math.round(kmj);
      if (kmj > GPS_AMBANG.KECEPATAN_MAKS_KMJ) {
        tambah(100, 'Perpindahan mustahil: ' + Math.round(jarak) + ' m dalam ' +
          Math.round(jedaDetik / 60) + ' menit (setara ' + Math.round(kmj) + ' km/jam)');
      }
    }
  }

  // E2. Koordinat identik berulang.
  let berturut = 0;
  for (let i = 0; i < riwayat.length; i++) {
    if (_gpsKunci(riwayat[i].titik) === kunciBaru) berturut++;
    else break;
  }
  let identikTotal = 0;
  for (let i = 0; i < riwayat.length; i++) {
    if (_gpsKunci(riwayat[i].titik) === kunciBaru) identikTotal++;
  }
  hasil.detail.identikBerturut = berturut;

  if (riwayat.length >= GPS_AMBANG.IDENTIK_BERTURUT && berturut >= GPS_AMBANG.IDENTIK_BERTURUT) {
    const rasio = identikTotal / riwayat.length;
    // Cek pembanding: kalau karyawan lain juga memakai koordinat persis
    // sama, ini hampir pasti lokasi WiFi kantor bersama — BUKAN Fake GPS.
    // Pemeriksaan ini yang mencegah satu kantor penuh kena tuduhan palsu.
    const pemakaiLain = _gpsPemakaiLain(kunciBaru, data.userId);
    hasil.detail.pemakaiLain = pemakaiLain;

    if (pemakaiLain === 0) {
      if (rasio >= GPS_AMBANG.IDENTIK_RASIO) {
        // Bobot 50 = tepat di ambang TINJAU. Disengaja: pola ini sendirian
        // sudah layak dilihat HRD, tapi TIDAK PERNAH cukup untuk memblokir
        // sendirian — lokasi WiFi bisa menghasilkan pola yang sama, dan
        // memblokir karena itu berarti menuduh orang yang absen dari dalam
        // gedung. Blokir baru terjadi bila ada bukti kedua yang menyusul.
        tambah(50, 'Koordinat identik hingga 6 desimal pada ' + identikTotal + ' dari ' +
          riwayat.length + ' absen terakhir, dan tidak ada karyawan lain yang memakai titik ini — pola khas pin Fake GPS');
      } else {
        tambah(25, 'Koordinat identik ' + berturut + 'x berturut-turut tanpa variasi sama sekali');
      }
    }
    // pemakaiLain > 0: tidak diberi poin. Titik yang sama dipakai banyak
    // orang = lokasi jaringan kantor, wajar dan tidak dihukum.
  }

  // E3. Waktu perangkat dimundurkan/dimajukan.
  if (bukti.driftWaktuMs !== undefined && isFinite(Number(bukti.driftWaktuMs))) {
    if (Math.abs(Number(bukti.driftWaktuMs)) > GPS_AMBANG.DRIFT_WAKTU_MS) {
      tambah(30, 'Timestamp GPS meleset ' + Math.round(Number(bukti.driftWaktuMs) / 1000) +
        ' detik dari waktu perangkat — indikasi data lokasi diinjeksi/replay');
    }
  }

  // --- F. KESIMPULAN -------------------------------------------------
  if (hasil.skor >= GPS_AMBANG.SKOR_BLOKIR) {
    hasil.level = 'BLOKIR';
    hasil.blokir = true;
  } else if (hasil.skor >= GPS_AMBANG.SKOR_TINJAU) {
    hasil.level = 'TINJAU';
  } else if (hasil.skor >= GPS_AMBANG.SKOR_WASPADA) {
    hasil.level = 'WASPADA';
  } else {
    hasil.level = 'AMAN';
  }

  if (geofenceInfo && geofenceInfo.distance !== undefined) {
    hasil.detail.jarakGeofence = geofenceInfo.distance;
  }
  return hasil;
}

// ---------------------------------------------------------------------
// JEJAK AUDIT
// ---------------------------------------------------------------------

function _pastikanSheetGpsAudit() {
  let sheet = SS.getSheetByName(SHEET_GPS_AUDIT);
  if (!sheet) {
    sheet = SS.insertSheet(SHEET_GPS_AUDIT);
    sheet.getRange(1, 1, 1, GPS_AUDIT_HEADERS.length).setValues([GPS_AUDIT_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Mencatat SETIAP percobaan absen ber-GPS, termasuk yang ditolak.
 * Percobaan yang ditolak tidak pernah masuk sheet Absensi, jadi tanpa
 * catatan ini HRD tidak akan pernah tahu ada yang mencoba.
 */
function catatAuditGps(data, analisa, keputusan, uuid) {
  try {
    const tipe = String(data.tipe || '');
    if (tipe !== 'Hadir' && tipe !== 'Pulang') return;

    const sheet = _pastikanSheetGpsAudit();
    const titik = _gpsParseTitik(data.lokasi);
    const bukti = data.gpsBukti || {};

    sheet.appendRow([
      new Date(),
      uuid || '-',
      data.userId || '-',
      data.nama || '-',
      tipe,
      titik ? titik.lat : '-',
      titik ? titik.lng : '-',
      // Alamat terbaca. Untuk percobaan yang DITOLAK ini justru paling
      // berharga: HRD melihat "Jl. X, Sidoarjo", bukan sederet angka.
      // Hampir selalu gratis karena Geocode.gs meng-cache per titik.
      (typeof alamatDariLokasi === 'function' ? (alamatDariLokasi(data.lokasi) || '-') : '-'),
      isFinite(Number(data.gpsAccuracy)) ? Math.round(Number(data.gpsAccuracy)) : '-',
      analisa.skor,
      analisa.level,
      keputusan,
      analisa.alasan.length ? analisa.alasan.join(' | ') : '-',
      analisa.detail.jarakGeofence !== undefined ? analisa.detail.jarakGeofence : '-',
      analisa.detail.kecepatan !== null ? analisa.detail.kecepatan : '-',
      analisa.detail.jitter !== null ? analisa.detail.jitter : '-',
      bukti.deviceId || '-',
      bukti.platform || '-',
      String(bukti.userAgent || '-').substring(0, 250)
    ]);
  } catch (e) {
    // Audit tidak boleh pernah menggagalkan absen yang sah.
    console.warn('Gagal mencatat audit GPS: ' + e.message);
  }
}

// =====================================================================
// AUDIT HISTORIS
//
// Menilai data absensi yang SUDAH ada. Ini bekerja tanpa perlu menunggu
// data baru, karena dua sinyal terkuat — koordinat identik berulang dan
// perpindahan mustahil — hanya butuh kolom Waktu dan Lokasi yang sudah
// tersimpan sejak lama.
// =====================================================================

/**
 * @param {Object} [opsi] { userId, tglMulai, tglSelesai }
 * @returns {Array} ringkasan per karyawan, diurutkan dari paling berisiko
 */
function auditGpsHistoris(opsi) {
  opsi = opsi || {};
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Kolom B..F = Waktu, UserID, Nama, Tipe, Lokasi
  const nilai = sheet.getRange(2, 2, lastRow - 1, 5).getValues();

  const batasMulai = opsi.tglMulai ? new Date(opsi.tglMulai).getTime() : null;
  const batasSelesai = opsi.tglSelesai ? (new Date(opsi.tglSelesai).getTime() + 86400000) : null;

  // Pass 1: kelompokkan per karyawan + hitung sebaran koordinat global.
  const perUser = {};
  const pemakaiKoordinat = {}; // kunci koordinat -> set userId

  for (let i = 0; i < nilai.length; i++) {
    const tipe = String(nilai[i][3] || '');
    if (tipe !== 'Hadir' && tipe !== 'Pulang') continue;
    const uid = String(nilai[i][1] || '').trim();
    if (!uid) continue;
    const titik = _gpsParseTitik(nilai[i][4]);
    if (!titik) continue;
    const waktu = _gpsKeWaktu(nilai[i][0]);
    if (batasMulai && (!waktu || waktu < batasMulai)) continue;
    if (batasSelesai && (!waktu || waktu > batasSelesai)) continue;
    if (opsi.userId && uid !== String(opsi.userId)) {
      // tetap dihitung untuk pembanding koordinat lintas-karyawan
      const k0 = _gpsKunci(titik);
      if (!pemakaiKoordinat[k0]) pemakaiKoordinat[k0] = {};
      pemakaiKoordinat[k0][uid] = true;
      continue;
    }

    const kunci = _gpsKunci(titik);
    if (!pemakaiKoordinat[kunci]) pemakaiKoordinat[kunci] = {};
    pemakaiKoordinat[kunci][uid] = true;

    if (!perUser[uid]) {
      perUser[uid] = { userId: uid, nama: String(nilai[i][2] || '-'), record: [], hitungKunci: {} };
    }
    perUser[uid].record.push({ waktu: waktu, tipe: tipe, titik: titik, kunci: kunci });
    perUser[uid].hitungKunci[kunci] = (perUser[uid].hitungKunci[kunci] || 0) + 1;
  }

  // Pass 2: nilai tiap karyawan.
  const laporan = [];
  Object.keys(perUser).forEach(function (uid) {
    const u = perUser[uid];
    const total = u.record.length;
    if (total < 5) return; // sampel terlalu kecil untuk disimpulkan

    u.record.sort(function (a, b) { return (a.waktu || 0) - (b.waktu || 0); });

    // Koordinat dominan
    let kunciDominan = '';
    let hitungDominan = 0;
    Object.keys(u.hitungKunci).forEach(function (k) {
      if (u.hitungKunci[k] > hitungDominan) { hitungDominan = u.hitungKunci[k]; kunciDominan = k; }
    });
    const jumlahUnik = Object.keys(u.hitungKunci).length;
    const rasioDominan = hitungDominan / total;
    const pemakaiLain = pemakaiKoordinat[kunciDominan]
      ? Object.keys(pemakaiKoordinat[kunciDominan]).filter(function (x) { return x !== uid; }).length
      : 0;

    // Rentetan identik terpanjang
    let berturutMaks = 0;
    let berturut = 0;
    let sebelumnya = '';
    for (let i = 0; i < total; i++) {
      if (u.record[i].kunci === sebelumnya) berturut++;
      else berturut = 1;
      sebelumnya = u.record[i].kunci;
      if (berturut > berturutMaks) berturutMaks = berturut;
    }

    // Teleport
    const teleport = [];
    for (let i = 1; i < total; i++) {
      const a = u.record[i - 1];
      const b = u.record[i];
      if (!a.waktu || !b.waktu) continue;
      const jedaDetik = (b.waktu - a.waktu) / 1000;
      if (jedaDetik < GPS_AMBANG.JEDA_MIN_TELEPORT_DTK) continue;
      const jarak = _gpsJarakMeter(a.titik.lat, a.titik.lng, b.titik.lat, b.titik.lng);
      if (jarak < GPS_AMBANG.JARAK_MIN_TELEPORT_M) continue;
      const kmj = (jarak / 1000) / (jedaDetik / 3600);
      if (kmj > GPS_AMBANG.KECEPATAN_MAKS_KMJ) {
        teleport.push({
          waktu: b.waktu ? Utilities.formatDate(new Date(b.waktu), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '-',
          jarak: Math.round(jarak),
          kecepatan: Math.round(kmj)
        });
      }
    }

    // Skor risiko historis
    let skor = 0;
    const alasan = [];

    if (pemakaiLain === 0 && rasioDominan >= 0.9 && total >= 20) {
      skor += 45;
      alasan.push('Koordinat identik pada ' + hitungDominan + ' dari ' + total +
        ' absen (' + Math.round(rasioDominan * 100) + '%) dan tidak dipakai karyawan lain mana pun');
    } else if (pemakaiLain === 0 && rasioDominan >= 0.75 && total >= 15) {
      skor += 25;
      alasan.push('Koordinat dominan muncul ' + Math.round(rasioDominan * 100) + '% dan hanya dipakai karyawan ini');
    } else if (pemakaiLain > 0 && rasioDominan >= 0.9) {
      alasan.push('Koordinat dominan juga dipakai ' + pemakaiLain +
        ' karyawan lain — konsisten dengan lokasi jaringan/WiFi bersama, bukan Fake GPS');
    }

    if (jumlahUnik <= 2 && total >= 30) {
      skor += 20;
      alasan.push('Hanya ' + jumlahUnik + ' titik berbeda dalam ' + total + ' absen — variasi jauh di bawah wajar');
    }

    if (berturutMaks >= 20) {
      skor += 20;
      alasan.push('Rentetan ' + berturutMaks + ' absen berturut-turut dengan koordinat sama persis');
    }

    if (teleport.length > 0) {
      skor += 50;
      alasan.push(teleport.length + ' perpindahan mustahil terdeteksi (tercepat ' +
        Math.max.apply(null, teleport.map(function (t) { return t.kecepatan; })) + ' km/jam)');
    }

    let level = 'AMAN';
    if (skor >= 60) level = 'TINGGI';
    else if (skor >= 35) level = 'SEDANG';
    else if (skor >= 15) level = 'RENDAH';

    laporan.push({
      userId: uid,
      nama: u.nama,
      alamatDominan: (typeof alamatDariLokasi === 'function' ? (alamatDariLokasi(kunciDominan) || '') : ''),
      totalAbsen: total,
      titikUnik: jumlahUnik,
      koordinatDominan: kunciDominan,
      hitungDominan: hitungDominan,
      rasioDominan: Math.round(rasioDominan * 100),
      dipakaiKaryawanLain: pemakaiLain,
      rentetanTerpanjang: berturutMaks,
      teleport: teleport.slice(0, 5),
      jumlahTeleport: teleport.length,
      skor: skor,
      level: level,
      alasan: alasan
    });
  });

  laporan.sort(function (a, b) { return b.skor - a.skor; });
  return laporan;
}

// ---------------------------------------------------------------------
// ENDPOINT UNTUK PANEL HRD/ADMIN
// ---------------------------------------------------------------------

function _gpsBolehLihat(data) {
  const role = String(data.roleRequester || data.role || '').toLowerCase();
  return role === 'admin' || role === 'hrd';
}

function handleGetGpsAudit(data) {
  if (!_gpsBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin/HRD.' });
  }

  const batas = Math.min(Number(data.limit) || 200, 1000);
  const sheet = SS.getSheetByName(SHEET_GPS_AUDIT);
  const kejadian = [];

  if (sheet && sheet.getLastRow() > 1) {
    const lastRow = sheet.getLastRow();
    const jumlah = Math.min(lastRow - 1, batas);
    const nilai = sheet.getRange(lastRow - jumlah + 1, 1, jumlah, GPS_AUDIT_HEADERS.length).getValues();
    for (let i = nilai.length - 1; i >= 0; i--) {
      const r = nilai[i];
      const level = String(r[10] || '');
      if (data.hanyaMencurigakan !== false && level !== 'BLOKIR' && level !== 'TINJAU' && level !== 'WASPADA') continue;
      if (data.userId && String(r[2]) !== String(data.userId)) continue;
      kejadian.push({
        waktu: r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss') : String(r[0]),
        uuid: r[1], userId: r[2], nama: r[3], tipe: r[4],
        lat: r[5], lng: r[6], alamat: r[7], akurasi: r[8],
        skor: r[9], level: level, keputusan: r[11], alasan: r[12],
        jarakGeofence: r[13], kecepatan: r[14], jitter: r[15],
        deviceId: r[16], platform: r[17]
      });
    }
  }

  return responseJSON({
    result: 'success',
    kejadian: kejadian,
    ambang: GPS_AMBANG,
    auditAktif: !!sheet
  });
}

function handleRunGpsAuditHistoris(data) {
  if (!_gpsBolehLihat(data)) {
    return responseJSON({ result: 'error', message: 'Akses ditolak. Hanya Admin/HRD.' });
  }
  try {
    const laporan = auditGpsHistoris({
      userId: data.userId || null,
      tglMulai: data.tglMulai || null,
      tglSelesai: data.tglSelesai || null
    });
    return responseJSON({ result: 'success', laporan: laporan, jumlah: laporan.length });
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal menjalankan audit: ' + e.message });
  }
}

// Dijalankan manual dari editor Apps Script kalau HRD ingin hasilnya
// tertulis di spreadsheet, bukan hanya di layar aplikasi.
function tulisLaporanAuditGpsKeSheet() {
  const laporan = auditGpsHistoris({});
  const namaSheet = 'LaporanAuditGPS';
  let sheet = SS.getSheetByName(namaSheet);
  if (!sheet) sheet = SS.insertSheet(namaSheet);
  sheet.clear();
  const header = ['UserID', 'Nama', 'Total Absen', 'Titik Unik', 'Koordinat Dominan',
    'Muncul (x)', 'Rasio (%)', 'Dipakai Karyawan Lain', 'Rentetan Terpanjang',
    'Jumlah Teleport', 'Skor', 'Level', 'Alasan'];
  const baris = laporan.map(function (l) {
    return [l.userId, l.nama, l.totalAbsen, l.titikUnik, l.koordinatDominan,
      l.hitungDominan, l.rasioDominan, l.dipakaiKaryawanLain, l.rentetanTerpanjang,
      l.jumlahTeleport, l.skor, l.level, l.alasan.join(' | ')];
  });
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (baris.length) sheet.getRange(2, 1, baris.length, header.length).setValues(baris);
  sheet.setFrozenRows(1);
  return 'Selesai. ' + baris.length + ' karyawan dianalisa.';
}

// ---------------------------------------------------------------------
// KOLOM AUDIT DI SHEET ABSENSI
//
// Kolom dicari berdasarkan NAMA HEADER, bukan index tetap. Sheet Absensi
// sudah memakai kolom Q (Catatan Admin) dan V (ID Akun) di luar 16 kolom
// yang ditulis appendRow, jadi menebak index adalah cara paling cepat
// merusak data yang sudah ada. Pendekatan ini juga membuat penambahan
// kolom baru oleh siapa pun di masa depan tidak memecahkan fitur ini.
// ---------------------------------------------------------------------

const GPS_KOLOM_ABSENSI = ['GPS Akurasi', 'GPS Skor', 'GPS Level', 'GPS Alasan'];

function _gpsPetaKolomAbsensi(sheet) {
  const lebar = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lebar).getValues()[0];
  const peta = {};
  const perluDibuat = [];

  GPS_KOLOM_ABSENSI.forEach(function (nama) {
    let idx = -1;
    for (let i = 0; i < header.length; i++) {
      if (String(header[i]).trim() === nama) { idx = i + 1; break; }
    }
    if (idx === -1) perluDibuat.push(nama);
    else peta[nama] = idx;
  });

  if (perluDibuat.length) {
    let kolomBerikut = lebar + 1;
    // Jaga-jaga bila kolom terakhir sheet ternyata kosong berjejer.
    if (sheet.getMaxColumns() < kolomBerikut + perluDibuat.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(),
        kolomBerikut + perluDibuat.length - sheet.getMaxColumns());
    }
    perluDibuat.forEach(function (nama) {
      sheet.getRange(1, kolomBerikut).setValue(nama);
      peta[nama] = kolomBerikut;
      kolomBerikut++;
    });
  }
  return peta;
}

function tulisKolomAuditAbsensi(sheet, data, analisa) {
  const tipe = String(data.tipe || '');
  if (tipe !== 'Hadir' && tipe !== 'Pulang') return;

  const peta = _gpsPetaKolomAbsensi(sheet);
  const baris = sheet.getLastRow();
  const akurasi = Number(data.gpsAccuracy);

  sheet.getRange(baris, peta['GPS Akurasi']).setValue(isFinite(akurasi) ? Math.round(akurasi) : '-');
  sheet.getRange(baris, peta['GPS Skor']).setValue(analisa.skor);
  sheet.getRange(baris, peta['GPS Level']).setValue(analisa.level);
  sheet.getRange(baris, peta['GPS Alasan']).setValue(analisa.alasan.length ? analisa.alasan.join(' | ') : '-');
}
