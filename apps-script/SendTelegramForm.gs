// Token & chat ID TIDAK ditulis di kode (repo GitHub). Isi di Apps Script:
// Project Settings > Script Properties > TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID.
const BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
const CHAT_ID = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');

function triggerTelegramUpdate() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Absensi");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();

  // Indeks kolom (Index array JS dimulai dari 0)
  const colWaktu = 1;        // Kolom B
  const colNama = 3;         // Kolom D
  const colTipe = 4;         // Kolom E
  const colTglMulai = 8;     // Kolom I
  const colTglSelesai = 9;   // Kolom J
  const colStatus = 12;      // Kolom M
  const colApprover = 13;    // Kolom N
  const colWktApprove = 14;  // Kolom O

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const startOfToday = new Date(currentYear, currentMonth, now.getDate()); 

  let pendingGroup = {};
  let approvedGroup = {};
  
  let totalPendingCount = 0;
  let totalApprovedCount = 0;
  let pendingHariIniCount = 0;
  let pendingHariSebelumnyaCount = 0;
  let maxDurationMs = -1;
  let oldestPendingName = "-";
  let oldestDurationText = "-";
  
  // Daftar tipe yang dikecualikan
  const excludeTipe = ["hadir", "pulang", "standby", "off (tukar shift)"];
  
  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    let waktu = row[colWaktu];
    let nama = row[colNama];
    let tipeMentah = row[colTipe]; 
    let status = row[colStatus];
    
    if (!nama || !tipeMentah || !status) continue;
    
    let tipeCek = tipeMentah.toString().trim().toLowerCase();
    if (excludeTipe.includes(tipeCek)) continue;

    let waktuObj = null;
    if (waktu instanceof Date) {
      waktuObj = waktu;
    } else if (typeof waktu === "string") {
      let parts = waktu.split(" ");
      let dateParts = parts[0].split("/");
      if (dateParts.length >= 3) { 
        waktuObj = new Date(dateParts[2], dateParts[1] - 1, dateParts[0]);
      } else {
        waktuObj = new Date(waktu);
      }
    }

    if (!waktuObj || isNaN(waktuObj.getTime())) continue;
    
    if (waktuObj.getMonth() === currentMonth && waktuObj.getFullYear() === currentYear) {
      
      let tipeKey = tipeMentah.toString().trim();
      let namaUpper = nama.toString().toUpperCase();
      
      let tglMulaiStr = row[colTglMulai] ? formatDateString(row[colTglMulai]) : "-";
      let tglSelesaiStr = row[colTglSelesai] ? formatDateString(row[colTglSelesai]) : "-";
      
      if (status === "Pending") {
        totalPendingCount++;
        
        if (!pendingGroup[tipeKey]) pendingGroup[tipeKey] = {};
        if (!pendingGroup[tipeKey][namaUpper]) pendingGroup[tipeKey][namaUpper] = [];
        
        let dateRange = `${tglMulaiStr} s.d ${tglSelesaiStr}`;
        pendingGroup[tipeKey][namaUpper].push(dateRange);
        
        if (waktuObj.getTime() >= startOfToday.getTime()) {
            pendingHariIniCount++;
        } else {
            pendingHariSebelumnyaCount++;
        }
        
        // Hitung Pending Terlama
        let durationMs = now.getTime() - waktuObj.getTime();
        if (durationMs > maxDurationMs) {
            maxDurationMs = durationMs;
            oldestPendingName = nama;
            
            let diffDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
            let diffHrs = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            if (diffDays > 0) {
                oldestDurationText = `${diffDays} hari ${diffHrs} jam`;
            } else {
                oldestDurationText = `${diffHrs} jam`;
            }
        }
      } else if (status === "Approved") {
        totalApprovedCount++;
        
        if (!approvedGroup[tipeKey]) approvedGroup[tipeKey] = {};
        if (!approvedGroup[tipeKey][namaUpper]) approvedGroup[tipeKey][namaUpper] = [];
        
        let approverName = row[colApprover] ? row[colApprover] : "-";
        let wktApproveStr = fmtTglJamTelegram(row[colWktApprove]);
        let dateRange = `${tglMulaiStr} s.d ${tglSelesaiStr}\n      └ ✅ Approved: ${wktApproveStr}\n      └ 👤 Oleh: ${approverName}`;
        
        approvedGroup[tipeKey][namaUpper].push(dateRange);
      }
    }
  }

  let monthName = Utilities.formatDate(now, "GMT+7", "MMMM yyyy");
  
  // ==========================================
  // PENGIRIMAN PESAN 1: REKAP UTAMA INFO
  // ==========================================
  let msgInfo = `📊 *Rekap Pengajuan Absensi (${monthName})* 📊\n\n`;
  msgInfo += `📋 *INFO STATUS PENDING:*\n`;
  msgInfo += `▪️ *Pending Hari Ini:* ${pendingHariIniCount} pengajuan\n`;
  msgInfo += `▪️ *Pending Hari Sebelumnya:* ${pendingHariSebelumnyaCount} pengajuan\n`;
  if (oldestPendingName !== "-") {
    msgInfo += `▪️ *Pending Terlama:* ${oldestDurationText} (a.n ${oldestPendingName.toString().toUpperCase()})\n`;
  } else {
    msgInfo += `▪️ *Pending Terlama:* Tidak ada\n`;
  }
  
  sendToTelegram(msgInfo);
  Utilities.sleep(500); 

  // ==========================================
  // PENGIRIMAN PESAN PENDING: TERPISAH PER TIPE
  // ==========================================
  if (totalPendingCount > 0) {
    for (let tipe in pendingGroup) {
      let emoji = getEmojiWarna(tipe);
      let tipeGroupArr = [];
      let sortedNames = Object.keys(pendingGroup[tipe]).sort();
      let tipeCount = 0;
      
      for (let n of sortedNames) {
          let listTanggal = pendingGroup[tipe][n];
          tipeCount += listTanggal.length;
          let tanggalText = listTanggal.map(tgl => `   └ 🗓 ${tgl}`).join("\n");
          tipeGroupArr.push(`▪️ *${n}*\n${tanggalText}`);
      }
      
      // Judul chat dibuat spesifik per Tipe & Status PENDING
      let msgPendingTipe = `${emoji} *PENGAJUAN ${tipe.toUpperCase()} (PENDING) - Total: ${tipeCount}*\n\n${tipeGroupArr.join("\n\n")}`;
      sendToTelegram(msgPendingTipe);
      Utilities.sleep(500); // Jeda antar chat agar aman
    }
  } else {
    sendToTelegram(`🔴 *STATUS PENDING*\n_- Tidak ada pengajuan pending -_`);
    Utilities.sleep(500);
  }

  // ==========================================
  // PENGIRIMAN PESAN APPROVED: TERPISAH PER TIPE
  // ==========================================
  if (totalApprovedCount > 0) {
    for (let tipe in approvedGroup) {
      let emoji = getEmojiWarna(tipe);
      let tipeGroupArr = [];
      let sortedNames = Object.keys(approvedGroup[tipe]).sort();
      let tipeCount = 0;
      
      for (let n of sortedNames) {
          let listTanggal = approvedGroup[tipe][n];
          tipeCount += listTanggal.length;
          let tanggalText = listTanggal.map(tgl => `   └ 🗓 ${tgl}`).join("\n");
          tipeGroupArr.push(`▪️ *${n}*\n${tanggalText}`);
      }
      
      // Judul chat dibuat spesifik per Tipe & Status APPROVED
      let msgApprovedTipe = `${emoji} *PENGAJUAN ${tipe.toUpperCase()} (APPROVED) - Total: ${tipeCount}*\n\n${tipeGroupArr.join("\n\n")}`;
      sendToTelegram(msgApprovedTipe);
      Utilities.sleep(500); // Jeda antar chat agar aman
    }
  } else {
    sendToTelegram(`🟢 *STATUS APPROVED*\n_- Tidak ada pengajuan approved -_`);
    Utilities.sleep(500);
  }
}


// Fungsi Notifikasi Input Baru
// Fungsi Notifikasi Input Baru
function notifikasiInputBaru() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Absensi");
  if (!sheet) return;
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; 
  
  const dataRow = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const idUnik = dataRow[0]; 
  const waktu = dataRow;  
  const userId = dataRow; // Kolom C
  const nama = dataRow[3];   // Kolom D
  const tipeMentah = dataRow[4]; // Kolom E
  
  if (!idUnik || !tipeMentah) return;

  const allowedTipe = ["ijin", "cuti", "cuti eo", "sakit", "dinas"];
  let tipeCek = tipeMentah.toString().trim().toLowerCase();
  
  if (!allowedTipe.includes(tipeCek)) return;
  
  const props = PropertiesService.getScriptProperties();
  const lastSentId = props.getProperty("LAST_INPUT_ID");
  if (idUnik === lastSentId) return; 
  
  props.setProperty("LAST_INPUT_ID", idUnik);
  
  let wktStr = formatDateString(waktu) + " " + formatTime(waktu);
  let emoji = getEmojiWarna(tipeMentah);
  let departemen = safeMd(_ambilDepartemenUser_(userId, nama));
  
  let periodeStr = buildPeriodeStr(dataRow[8], dataRow[9], dataRow[10], dataRow[11]);
  let alasanStr = safeMd(dataRow[6]);
  
  let message = `👤 *Nama :* ${nama.toString().toUpperCase()}\n`;
  message += `${emoji} *PENGAJUAN ${tipeMentah.toString().toUpperCase()}*\n`;
  message += `🏢 *Departemen :* ${departemen}\n`;
  message += `📝 *Alasan :* ${alasanStr}\n`;
  message += `📅 *Tgl Pengajuan :* ${periodeStr}\n`;
  message += `🕒 *Waktu Input :* ${wktStr}`;
  
  sendToTelegram(message);
}

// Fungsi Trigger Cek Baris Baru
function cekBarisBaru() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Absensi");
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  const lastRowKey = "LAST_ROW_COUNT";

  const currentLastRow = sheet.getLastRow();
  const savedLastRow = parseInt(props.getProperty(lastRowKey) || "1");

  if (currentLastRow <= savedLastRow) {
    props.setProperty(lastRowKey, currentLastRow.toString());
    return;
  }

  const allowedTipe = ["ijin", "cuti", "cuti eo", "sakit", "dinas"];

  for (let r = savedLastRow + 1; r <= currentLastRow; r++) {
    const dataRow = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];

    const idUnik   = dataRow[0];   // Kolom A
    const waktu    = dataRow;   // Kolom B
    const userId   = dataRow;   // Kolom C
    const nama     = dataRow[3];   // Kolom D
    const tipeMentah = dataRow[4]; // Kolom E

    if (!idUnik || !tipeMentah) continue;

    const tipeCek = tipeMentah.toString().trim().toLowerCase();
    if (!allowedTipe.includes(tipeCek)) continue;

    const lastSentId = props.getProperty("LAST_INPUT_ID");
    if (idUnik.toString() === lastSentId) continue;
    props.setProperty("LAST_INPUT_ID", idUnik.toString());

    const wktStr = formatDateString(waktu) + " " + formatTime(waktu);
    const emoji  = getEmojiWarna(tipeMentah);
    const departemen = safeMd(_ambilDepartemenUser_(userId, nama));

    let periodeStr = buildPeriodeStr(dataRow[8], dataRow[9], dataRow[10], dataRow[11]);
    let alasanStr = safeMd(dataRow[6]);
    
    let message = `👤 *Nama :* ${nama.toString().toUpperCase()}\n`;
    message += `${emoji} *PENGAJUAN ${tipeMentah.toString().toUpperCase()}*\n`;
    message += `🏢 *Departemen :* ${departemen}\n`;
    message += `📝 *Alasan :* ${alasanStr}\n`;
    message += `📅 *Tgl Pengajuan :* ${periodeStr}\n`;
    message += `🕒 *Waktu Input :* ${wktStr}`;

    sendToTelegram(message);
    Utilities.sleep(300);
  }

  props.setProperty(lastRowKey, currentLastRow.toString());
}

// Helper untuk Mengambil Departemen Karyawan dari Sheet Users
function _ambilDepartemenUser_(userId, nama) {
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



// Fungsi Bantuan (Helper) untuk Menentukan Warna Emoji
function getEmojiWarna(tipe) {
  let t = tipe.toString().toLowerCase().trim();
  if (t === "sakit") return "🔴"; 
  if (t === "ijin" || t === "izin") return "🔵"; 
  if (t === "cuti") return "🟡"; 
  if (t === "cuti eo") return "🟣"; 
  if (t === "dinas") return "🟢"; 
  return "⚪"; // Default jika ada tipe lain
}

function sendToTelegram(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const options = {
    method: "post",
    payload: {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    },
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

function formatDateString(date) {
  if (!date || isNaN(new Date(date).getTime())) return "-";
  return Utilities.formatDate(new Date(date), "GMT+7", "dd/MM/yyyy");
}

function formatTime(time) {
  if (!time) return "-";
  if (time instanceof Date) {
    return Utilities.formatDate(time, "GMT+7", "HH:mm");
  }
  return time.toString();
}

function onEdit(e) {
  if (!e) return;
  const sheet = e.source.getActiveSheet();
  
  if (sheet.getName() !== "Absensi") return;

  const col = e.range.getColumn();
  if (col === 13) {
     triggerTelegramUpdate();
  }
}

// ============================================================
// PEMICU MANUAL: Jalankan fungsi ini lewat menu Run di Apps Script
// Atau tambahkan Time-driven trigger setiap 1-5 menit dari menu Triggers
// ============================================================

function cekBarisBaru() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Absensi");
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  const lastRowKey = "LAST_ROW_COUNT";

  const currentLastRow = sheet.getLastRow();
  const savedLastRow = parseInt(props.getProperty(lastRowKey) || "1");

  // Tidak ada baris baru
  if (currentLastRow <= savedLastRow) {
    props.setProperty(lastRowKey, currentLastRow.toString());
    return;
  }

  // Tipe yang memicu notifikasi
  const allowedTipe = ["ijin", "cuti", "cuti eo", "sakit", "dinas"];

  // Loop semua baris baru yang belum diproses
  for (let r = savedLastRow + 1; r <= currentLastRow; r++) {
    const dataRow = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];

    const idUnik   = dataRow[0];   // Kolom A
    const waktu    = dataRow[1];   // Kolom B
    const nama     = dataRow[3];   // Kolom D
    const tipeMentah = dataRow[4]; // Kolom E

    if (!idUnik || !tipeMentah) continue;

    const tipeCek = tipeMentah.toString().trim().toLowerCase();
    if (!allowedTipe.includes(tipeCek)) continue;

    // Cegah duplikasi berdasarkan ID unik
    const lastSentId = props.getProperty("LAST_INPUT_ID");
    if (idUnik.toString() === lastSentId) continue;
    props.setProperty("LAST_INPUT_ID", idUnik.toString());

    const wktStr = formatDateString(waktu) + " " + formatTime(waktu);
    const emoji  = getEmojiWarna(tipeMentah);

    let periodeStr = buildPeriodeStr(dataRow[8], dataRow[9], dataRow[10], dataRow[11]);
    let alasanStr = safeMd(dataRow[6]);
    let message = `${emoji} *PENGAJUAN ${tipeMentah.toString().toUpperCase()}*\n\n`;
    message += `👤 *Nama:* ${nama.toString().toUpperCase()}\n`;
    message += `📌 *Tipe Pengajuan:* ${tipeMentah.toString().toUpperCase()}\n`;
    message += `📅 *Tanggal Pengajuan:* ${periodeStr}\n`;
    message += `📝 *Alasan:* ${alasanStr}\n`;
    message += `🕒 *Waktu Input:* ${wktStr}`;

    sendToTelegram(message);
    Utilities.sleep(300);
  }

  // Simpan posisi baris terakhir yang sudah diproses
  props.setProperty(lastRowKey, currentLastRow.toString());
}


// ============================================================
// RESET: Jalankan sekali untuk mengatur posisi awal ke baris terakhir
// saat ini (supaya tidak kirim notifikasi data lama)
// ============================================================
function resetLastRowCount() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Absensi");
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_ROW_COUNT", sheet.getLastRow().toString());

  SpreadsheetApp.getUi().alert("✅ Reset berhasil! Posisi baris sekarang: " + sheet.getLastRow());
}

// Format tanggal + jam lengkap (dd/MM/yyyy HH:mm) untuk waktu approval
function fmtTglJamTelegram(val) {
  if (!val || val === "-") return "-";
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return val.toString();
  return Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm") + " WIB";
}

// Susun teks periode pengajuan (tanggal + jam bila ada)
function buildPeriodeStr(tglMulai, tglSelesai, jamMulai, jamSelesai) {
  var a = (tglMulai && tglMulai !== "-") ? formatDateString(tglMulai) : "-";
  var b = (tglSelesai && tglSelesai !== "-") ? formatDateString(tglSelesai) : "-";
  var txt = (a === "-" && b === "-") ? "-" : (a === b ? a : a + " s.d " + b);
  var j1 = (jamMulai && jamMulai !== "-") ? formatTime(jamMulai) : "";
  var j2 = (jamSelesai && jamSelesai !== "-") ? formatTime(jamSelesai) : "";
  if (j1 || j2) txt += " (" + (j1 || "?") + " - " + (j2 || "?") + ")";
  return txt;
}

// Bersihkan karakter Markdown dari teks input user agar pesan tidak gagal terkirim
function safeMd(val) {
  if (val === null || val === undefined) return "-";
  var s = val.toString().trim();
  if (!s || s === "-") return "-";
  return s.replace(/[*_`\[\]]/g, " ");
}

// ==============================================================
// SETUP JADWAL REKAP: jalankan fungsi ini SEKALI dari menu Jalankan.
// Rekap dikirim tiap hari pukul 09:00 dan 17:00 WIB.
// ==============================================================
function setupJadwalRekapTelegram() {
  var fungsiRekap = ['triggerTelegramUpdate', 'sendReportToTelegram'];
  var jamKirim = [9, 17];

  // Hapus pemicu lama untuk kedua fungsi rekap
  var existing = ScriptApp.getProjectTriggers();
  var dihapus = 0;
  for (var i = 0; i < existing.length; i++) {
    if (fungsiRekap.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
      dihapus++;
    }
  }

  // Buat pemicu baru: tiap fungsi x tiap jam
  var dibuat = 0;
  for (var f = 0; f < fungsiRekap.length; f++) {
    for (var j = 0; j < jamKirim.length; j++) {
      ScriptApp.newTrigger(fungsiRekap[f])
        .timeBased()
        .atHour(jamKirim[j])
        .nearMinute(1)
        .everyDays(1)
        .inTimezone('Asia/Jakarta')
        .create();
      dibuat++;
    }
  }

  Logger.log('Pemicu lama dihapus: ' + dihapus + ' | Pemicu baru dibuat: ' + dibuat);
  return 'Pemicu lama dihapus: ' + dihapus + ', pemicu baru dibuat: ' + dibuat;
}
