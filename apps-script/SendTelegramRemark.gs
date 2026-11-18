// Token & chat ID TIDAK ditulis di kode (repo GitHub). Isi di Apps Script:
// Project Settings > Script Properties > TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID.
const TELEGRAM_TOKEN_REMARK = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
const CHAT_ID_REMARK = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');

function sendReportToTelegram() {
  const today = new Date();
  const currentHour = parseInt(Utilities.formatDate(today, "Asia/Jakarta", "HH"));
  
  Logger.log("1. Skrip dijalankan. Jam sistem saat ini: " + currentHour + " WIB");

  if (currentHour < 7) {
    Logger.log("INFO: Eksekusi dihentikan karena waktu masih di bawah jam 07:00 pagi.");
    return; 
  }

  const sheetName = "Remarks"; 
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  
  if (!sheet) {
    Logger.log("ERROR: Sheet dengan nama '" + sheetName + "' tidak ditemukan!");
    return; 
  }
  
  const data = sheet.getDataRange().getValues();
  Logger.log("2. Sheet ditemukan. Membaca " + data.length + " baris data.");
  
  let doneBulanIni = 0;
  let openBulanIni = 0;
  let openHariIni = 0;
  let openTahunIni = 0;
  
  let oldestOpenDate = null;
  let oldestOpenName = "";
  let oldestOpenDays = 0;

  let groupedOpen = {};
  let groupedDoneHariIni = {}; // Grouped by nama untuk DONE hari ini

  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    const tglLaporanRaw = row[1]; // Kolom B (Waktu/Tgl Lapor)
    const nama = row[3] ? row[3].toString().trim() : "-"; // Kolom D (Nama)
    const status = row[9] ? row[9].toString().toUpperCase().trim() : ""; // Kolom J (Status)
    const tglProsesRaw = row[11]; // Kolom L (Tanggal Proses)
    
    if (!tglLaporanRaw) continue;

    // --- PARSING TANGGAL LAPOR ---
    let tglLaporan;
    if (tglLaporanRaw instanceof Date) {
      tglLaporan = tglLaporanRaw;
    } else {
      tglLaporan = new Date(tglLaporanRaw);
    }
    if (isNaN(tglLaporan.getTime())) continue;

    const laporanMonth = tglLaporan.getMonth();
    const laporanYear = tglLaporan.getFullYear();
    const laporanStr = Utilities.formatDate(tglLaporan, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const formatTglLapor = Utilities.formatDate(tglLaporan, Session.getScriptTimeZone(), "dd MMM yyyy HH:mm");

    // --- PARSING TANGGAL PROSES ---
    let tglProsesStr = "";
    let formatTglProses = "-";
    if (tglProsesRaw) {
      let tglProses = (tglProsesRaw instanceof Date) ? tglProsesRaw : new Date(tglProsesRaw);
      if (!isNaN(tglProses.getTime())) {
        tglProsesStr = Utilities.formatDate(tglProses, Session.getScriptTimeZone(), "yyyy-MM-dd");
        formatTglProses = Utilities.formatDate(tglProses, Session.getScriptTimeZone(), "dd MMM yyyy HH:mm");
      }
    }

    // --- LOGIK REKAPITULASI ---
    if (laporanMonth === currentMonth && laporanYear === currentYear) {
      if (status === "DONE") doneBulanIni++;
      if (status === "OPEN") openBulanIni++;
    }

    if (laporanStr === todayStr && status === "OPEN") {
      openHariIni++;
    }

    // --- PENGUMPULAN DATA DONE HARI INI (grouped by nama) ---
    if (status === "DONE" && tglProsesStr === todayStr) {
      if (!groupedDoneHariIni[nama]) {
        groupedDoneHariIni[nama] = [];
      }
      groupedDoneHariIni[nama].push({ lapor: formatTglLapor, proses: formatTglProses });
    }

    // --- PENGUMPULAN DATA OPEN ---
    if (status === "OPEN") {
      if (laporanYear === currentYear) {
        openTahunIni++;
      }

      if (!oldestOpenDate || tglLaporan < oldestOpenDate) {
        oldestOpenDate = tglLaporan;
        oldestOpenName = nama;
      }
      
      if (!groupedOpen[nama]) {
        groupedOpen[nama] = [];
      }
      groupedOpen[nama].push(formatTglLapor);
    }
  }

  // --- MENGURUTKAN DAN MENYUSUN TEKS OPEN ---
  const sortedNames = Object.keys(groupedOpen).sort();
  let detailOpen = [];
  for (const namaPerson of sortedNames) {
    const listTanggal = groupedOpen[namaPerson];
    const tanggalText = listTanggal.map(tgl => `    └ 📅 ${tgl}`).join("\n");
    detailOpen.push(`▪️ <b>${namaPerson}</b>\n${tanggalText}`);
  }

  Logger.log("3. Data berhasil diproses. Total orang OPEN: " + detailOpen.length + " | Total DONE Hari Ini: " + Object.keys(groupedDoneHariIni).length + " orang");

  // Perhitungan Laporan OPEN terlama
  if (oldestOpenDate) {
    let todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let oldestDateOnly = new Date(oldestOpenDate.getFullYear(), oldestOpenDate.getMonth(), oldestOpenDate.getDate());
    let diffTime = todayDateOnly - oldestDateOnly;
    oldestOpenDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
  }
  const oldestDateStr = oldestOpenDate ? Utilities.formatDate(oldestOpenDate, Session.getScriptTimeZone(), "dd MMM yyyy") : "-";
  const labelHari = oldestOpenDays > 0 ? `${oldestOpenDays} Hari yang lalu` : `Hari ini`;

  // Limit tampilan OPEN agar pesan tidak terlalu panjang
  const MAX_PERSON_ITEMS = 30; 
  let textDetailOpen = "";
  if (detailOpen.length === 0) {
    textDetailOpen = `<i>Semua laporan sudah direspon / tidak ada OPEN</i>`;
  } else if (detailOpen.length > MAX_PERSON_ITEMS) {
    textDetailOpen = detailOpen.slice(0, MAX_PERSON_ITEMS).join("\n");
    let sisaOrang = detailOpen.length - MAX_PERSON_ITEMS;
    textDetailOpen += `\n\n<i>... dan ${sisaOrang} orang lainnya masih memiliki laporan OPEN.</i>`;
  } else {
    textDetailOpen = detailOpen.join("\n");
  }

  // --- MENYUSUN TEKS DONE HARI INI (grouped by nama) ---
  let textDetailDone = "";
  const sortedDoneNames = Object.keys(groupedDoneHariIni).sort();
  if (sortedDoneNames.length === 0) {
    textDetailDone = `<i>Belum ada laporan yang diproses hari ini.</i>`;
  } else {
    let doneItems = [];
    for (const namaDone of sortedDoneNames) {
      const entries = groupedDoneHariIni[namaDone];
      let entryLines = [];
      for (let e = 0; e < entries.length; e++) {
        entryLines.push(`    ├ Lapor : ${entries[e].lapor}\n    └ Proses: ${entries[e].proses}`);
      }
      doneItems.push(`▪️ <b>${namaDone}</b>\n` + entryLines.join("\n"));
    }
    textDetailDone = doneItems.join("\n\n");
  }

  // ==========================================
  // PEMBUATAN 3 PESAN TELEGRAM
  // ==========================================
  
  // 1. Pesan REKAP
  const message1 = `📊 <b>REKAP LAPOR HRD</b>\n\n` +
                   `📅 <b>Periode Bulan Ini</b>\n` +
                   `✅ <b>DONE</b> (Sudah direspon): ${doneBulanIni}\n` +
                   `⚠️ <b>OPEN</b> (Belum direspon): ${openBulanIni}\n\n` +
                   `📌 <b>Status Laporan OPEN</b>\n` +
                   `Masuk Hari Ini: ${openHariIni} Laporan\n` +
                   `Terlama: ${oldestOpenDate ? `${labelHari} (Tgl ${oldestDateStr} - ${oldestOpenName})` : 'Tidak ada laporan menggantung'}\n\n` +
                   `📈 <b>Total OPEN Periode ${currentYear}: ${openTahunIni} Laporan</b>\n\n` +
                   `<i>🕒 Rekap otomatis — dikirim setiap hari pukul 09:00 & 17:00 WIB.</i>`;

  // 2. Pesan DAFTAR DONE HARI INI
  const message2 = `✅ <b>DAFTAR LAPOR HRD - DONE (HARI INI)</b>\n\n` +
                   textDetailDone;

  // 3. Pesan DAFTAR OPEN
  const message3 = `📋 <b>DAFTAR LAPOR HRD - OPEN</b>\n\n` +
                   textDetailOpen;

  // ==========================================
  // PENGIRIMAN PESAN KE TELEGRAM
  // ==========================================

  Logger.log("4. Mengirim Pesan 1 (Rekap)...");
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN_REMARK}/sendMessage`, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({"chat_id": CHAT_ID_REMARK, "text": message1, "parse_mode": "HTML"}),
    "muteHttpExceptions": true
  });

  Utilities.sleep(1000); // Jeda 1 detik

  Logger.log("5. Mengirim Pesan 2 (Daftar DONE)...");
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN_REMARK}/sendMessage`, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({"chat_id": CHAT_ID_REMARK, "text": message2, "parse_mode": "HTML"}),
    "muteHttpExceptions": true
  });

  Utilities.sleep(1000); // Jeda 1 detik

  Logger.log("6. Mengirim Pesan 3 (Daftar OPEN)...");
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN_REMARK}/sendMessage`, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({"chat_id": CHAT_ID_REMARK, "text": message3, "parse_mode": "HTML"}),
    "muteHttpExceptions": true
  });
  
  Logger.log("7. Eksekusi Selesai.");
}

// ==========================================
// PENGEMBANGAN 1: NOTIFIKASI REMARK BARU (SISTEM TRACKING BARIS)
// ==========================================

function cekRemarkBaru() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Remarks");
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  const lastRowKey = "LAST_ROW_REMARK";

  const currentLastRow = sheet.getLastRow();
  const savedLastRow = parseInt(props.getProperty(lastRowKey) || "1");

  if (currentLastRow <= savedLastRow) {
    props.setProperty(lastRowKey, currentLastRow.toString());
    return;
  }

  for (let r = savedLastRow + 1; r <= currentLastRow; r++) {
    const rowData = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const idUnik = rowData[0];        // Kolom A (UUID)
    const tglLaporanRaw = rowData[1]; // Kolom B (Waktu/Tgl Lapor)
    const userId = rowData[2];        // Kolom C (User ID)
    const nama = rowData[3] ? rowData[3].toString().trim() : "-"; // Kolom D (Nama)
    const divisiRaw = rowData[4] ? rowData[4].toString().trim() : "-"; // Kolom E (Departemen/Divisi)
    const kategori = rowData[6] ? rowData[6].toString().trim() : "-"; // Kolom G (Tipe/Kategori)
    const pesan = rowData[7] ? rowData[7].toString().trim() : "-";    // Kolom H (Alasan/Pesan)

    if (!idUnik) continue;

    const lastSentId = props.getProperty("LAST_REMARK_ID");
    if (idUnik.toString() === lastSentId) continue;
    props.setProperty("LAST_REMARK_ID", idUnik.toString());

    // Waktu Lapor = waktu form dikirim (kolom B). Bisa Date, atau teks "dd/MM/yyyy HH:mm:ss".
    let formatTglLapor = "-";
    if (tglLaporanRaw) {
      const tgl = _parseWaktuLapor_(tglLaporanRaw);
      if (tgl) formatTglLapor = Utilities.formatDate(tgl, "Asia/Jakarta", "dd MMM yyyy HH:mm");
      else formatTglLapor = tglLaporanRaw.toString().trim() || "-";
    }

    const departemen = _ambilDepartemenRemark_(userId, nama, divisiRaw);

    const pesanNotifikasi = `🚨 <b>LAPOR HRD</b>\n` +
      `👤 <b>Nama :</b> ${esc(nama)}\n` +
      `🏢 <b>Departemen :</b> ${esc(departemen)}\n` +
      `📌 <b>Tipe Pengajuan :</b> ${esc(kategori)}\n` +
      `📝 <b>Alasan :</b> ${esc(pesan)}\n` +
      `🕒 <b>Waktu Lapor :</b> ${formatTglLapor}`;

    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN_REMARK}/sendMessage`;
    const payload = {
      "chat_id": CHAT_ID_REMARK,
      "text": pesanNotifikasi,
      "parse_mode": "HTML"
    };

    UrlFetchApp.fetch(telegramUrl, {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    });

    Utilities.sleep(300);
  }

  props.setProperty(lastRowKey, currentLastRow.toString());
}

// Ubah nilai kolom B (Waktu Lapor) menjadi Date. Mengembalikan null bila tidak terbaca.
function _parseWaktuLapor_(val) {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Helper untuk Mengambil Departemen Lapor HRD
function _ambilDepartemenRemark_(userId, nama, divisi) {
  if (divisi && divisi !== "-" && divisi.trim() !== "") return divisi.trim();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetUsers = ss.getSheetByName("Users");
    if (!sheetUsers) return "-";
    const dataUsers = sheetUsers.getDataRange().getValues();
    if (userId) {
      for (let i = 1; i < dataUsers.length; i++) {
        if (String(dataUsers[i][0]) === String(userId)) {
          return dataUsers[i][4] ? String(dataUsers[i][4]).trim() : "-";
        }
      }
    }
    if (nama) {
      const namaClean = String(nama).trim().toLowerCase();
      for (let i = 1; i < dataUsers.length; i++) {
        if (dataUsers[i][3] && String(dataUsers[i][3]).trim().toLowerCase() === namaClean) {
          return dataUsers[i][4] ? String(dataUsers[i][4]).trim() : "-";
        }
      }
    }
    return "-";
  } catch (e) {
    return "-";
  }
}


// ============================================================
// RESET TRACKING: Jalankan fungsi ini SATU KALI SAJA secara manual 
// dari menu "Jalankan" (Run) agar tidak mengirim notifikasi data lama
// ============================================================
function resetLastRowRemark() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Remarks");
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_ROW_REMARK", sheet.getLastRow().toString());

  Logger.log("✅ Reset berhasil! Posisi baris Remark sekarang: " + sheet.getLastRow());
}

// Format tanggal sederhana (dd MMM yyyy) untuk tanggal pengajuan koreksi
function formatTglSederhana(val) {
  if (!val || val === "-") return "-";
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return val.toString();
  return Utilities.formatDate(d, "Asia/Jakarta", "dd MMM yyyy");
}

// Escape karakter HTML agar parse_mode HTML tidak gagal
function esc(val) {
  if (val === null || val === undefined) return "-";
  var s = val.toString().trim();
  if (!s) return "-";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
