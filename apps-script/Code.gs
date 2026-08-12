const SS = SpreadsheetApp.getActiveSpreadsheet();

// --- NAMA SHEET ---
const FOLDER_NAME = "Foto_Absensi_App";
const SHEET_ABSENSI = "Absensi";
const SHEET_USERS = "Users";
const SHEET_MASTER = "MasterData";
const SHEET_REMARKS = "Remarks";
const SHEET_DB_ABSEN = "dbabsen";
const SHEET_RUNNING_SHIFT = "running shift"; // Sheet Jadwal Shift
const SHEET_ANNOUNCEMENTS = "Announcements"; // Sheet Informasi HRD
const SHEET_MASTER_CUTI_NAME = "MASTER-CUTI";


// --- KONFIGURASI EMAIL HRD ---
const CONST_HRD_EMAILS = "aryprasetyo@jpt.co.id,hrd@jpt.co.id,";

// --- KONFIGURASI TARGET EXTERNAL SHEET ---
// Daftar ID Spreadsheet dan Nama Sheet yang akan diperiksa
const EXTERNAL_TARGETS = [
  { 
    id: "1EztinCf-TIT4CZaXcHw7ErNmiN_imgMVl8gYET_BRNs", // Link 1
    sheets: ["NON-SHIFT", "SHIFT"] 
  },
  { 
    id: "1RWzfh7n6dVtGqTSt0hKdQwuOxypprScUQUwe-KWmy6c", // Link 2 (db_jakarta)
    sheets: ["db_jakarta"] // Asumsi nama sheetnya db_jakarta (sesuaikan jika beda)
  },
  { 
    id: "1cXuSsy5Ea6vkl0B7sNRe49hEjM_lDsj3Hcev4SsJzUY", // Link 3 (MST)
    sheets: ["MST"] // Asumsi nama sheetnya MST
  }
];

// Nama Header Kolom di External Sheet untuk pencocokan (SESUAIKAN JIKA BEDA)
const COL_HEADER_ID = "NIK."; // Nama kolom ID User
const COL_HEADER_DATE = "Tanggal";    // Nama kolom Tanggal
const COL_HEADER_SYMBOL = "Symbol"; // Nama kolom Target Update

// Mapping Tipe Absen ke Simbol
function getSymbolFromType(tipe) {
  const t = tipe.toString().toUpperCase().trim();
  
  if (t.includes("IJIN")) return "I";
  if (t === "CUTI") return "C";
  if (t.includes("CUTI EO")) return "EO";
  if (t.includes("HADIR")) return "H";
  if (t.includes("SAKIT")) return "S";
  if (t.includes("OFF") || t.includes("TUKAR SHIFT")) return "O";
  if (t.includes("STANDBY")) return "H";
  if (t.includes("PULANG")) return "H"; // Pulang Awal/Cepat dianggap Hadir? Sesuai request = H
  if (t.includes("DINAS")) return "DL";
  
  return "H"; // Default fallback
}

// --- VERSION CONTROL ---
const APP_VERSION = "1.0.13"; // UBAH ANGKA INI SETIAP KALI ANDA UPDATE SCRIPT/DEPLOY BARU
// 1.0.13 — wajib token auth (lihat Auth.gs). Klien lama (1.0.12) akan
//          dipaksa reload oleh layar "Update Tersedia" agar dapat bundle
//          baru yang mengirimkan token.

// ==========================================
// 1. HANDLING REQUEST (GET & POST)
// ==========================================

function doGet(e) {
  try {
    // Handle Approval via Email Link
    if (e && e.parameter && (e.parameter.action === 'approve_via_email' || e.parameter.action === 'reject_via_email')) {
      return handleEmailAction(e);
    }
    return ContentService.createTextOutput("Server E-Absensi Berjalan Normal (Mode GET).");
  } catch (error) {
    return HtmlService.createHtmlOutput(`<h3>Terjadi Kesalahan Server</h3><p>${error.toString()}</p>`)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
}


function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // =====================================================
    // GERBANG AUTENTIKASI (lihat Auth.gs)
    // Wajib berada di sini — SEBELUM action apa pun dirutekan.
    // Fungsi ini juga menimpa data.userId / data.role / data.canViewAll
    // dengan nilai dari token, sehingga handler di bawah tidak lagi
    // mempercayai apa pun yang dikirim klien.
    // =====================================================
    const gate = authorizeRequest(data);
    if (!gate.ok) {
      return responseJSON({
        result: 'error',
        code: gate.message === 'SESI_HABIS' ? 'AUTH_REQUIRED' : 'FORBIDDEN',
        message: gate.message === 'SESI_HABIS'
          ? 'Sesi Anda sudah berakhir. Silakan login ulang.'
          : gate.message
      });
    }

    if (action === 'ping') {
      return responseJSON({ result: 'success', message: 'ping' });
    }

    // --- FITUR CHECK VERSION (BARU) ---
    if (action === 'check_version') {
        return responseJSON({ result: 'success', version: APP_VERSION });
    }
    
    // --- FITUR ANNOUNCEMENT ---
    if (action === 'get_latest_announcement') return handleGetLatestAnnouncement(data);
    if (action === 'tambah_announcement') return handleTambahAnnouncement(data);
    if (action === 'get_user_list_admin') return handleGetUserListAdmin(data); // Ambil list user lengkap
    if (action === 'reset_password_user') return handleResetPasswordUser(data); // Reset password
    if (action === 'get_analysis_data') return handleGetAnalysisData(data);
    if (action === 'delete_absensi') return handleDeleteAbsensi(data);
    if (action === 'update_absensi') return handleUpdateAbsensi(data);

    // --- AUTH & USER MANAGEMENT ---
    if (action === 'login') return handleLogin(data);
    if (action === 'tambah_user') return handleTambahUser(data);
    if (action === 'tambah_master') return handleTambahMaster(data);
    if (action === 'ganti_password') return handleGantiPassword(data);
    if (action === 'upload_profile') return handleUploadProfile(data);

    // --- FITUR ABSENSI UTAMA ---
    if (action === 'absen') return handleAbsen(data);
    if (action === 'edit_absen') return handleEditAbsen(data);
    if (action === 'delete_absen') return handleDeleteAbsen(data);

    // --- FITUR VIEW DATA ---
    if (action === 'get_history') return handleGetHistory(data);
    if (action === 'get_db_absen') return handleGetDbAbsen(data);
    if (action === 'get_user_list_simple') return handleGetUserListSimple(data);
    if (action === 'get_stats') return handleGetStats(data);

    // --- FITUR APPROVAL ---
    if (action === 'request_approval_email') return handleRequestApprovalEmail(data);
    if (action === 'process_approval') return handleProcessApprovalManual(data);
    if (action === 'get_approval_list') return handleGetApprovalList(data);
    if (action == 'update_status_absen') return handleUpdateStatusAbsen(data);

    // --- FITUR REMARK (LAPORAN) ---
    if (action === 'send_remark') return handleSendRemark(data);
    if (action === 'get_remarks') return handleGetRemarks(data);
    if (action === 'update_remark_status') return handleUpdateRemarkStatus(data);

    // --- FITUR SHIFT SCHEDULE (UPDATE LENGKAP) ---
    if (action === 'submit_shift_schedule') return handleSubmitShiftSchedule(data); // Input Baru
    if (action === 'get_shift_history') return handleGetShiftHistory(data); // Lihat History
    if (action === 'delete_shift_schedule') return handleDeleteShiftSchedule(data); // Hapus Shift
    if (action === 'edit_shift_schedule') return handleEditShiftSchedule(data); // Edit Shift

    return responseJSON({ result: 'error', message: 'Action tidak dikenal' });
  } catch (error) {
    return responseJSON({ result: 'error', message: error.toString() });
  }
}

function handleAbsen(data) {
  // =================================================================
  // --- [BARU] VALIDASI CATATAN WAJIB DIISI ---
  // =================================================================
  // Daftar tipe yang WAJIB mengisi keterangan/catatan
  const TYPES_MUST_HAVE_NOTE = [
      'Ijin', 'Cuti', 'Sakit', 'Dinas Luar', 'Dinas', 
      'Cuti EO', 'Tukar Shift', 'Off', 'Lembur'
  ];

  // Cek apakah tipe saat ini termasuk yang wajib catatan
  if (TYPES_MUST_HAVE_NOTE.includes(data.tipe)) {
      // Cek jika catatan kosong, null, atau hanya tanda strip (-)
      if (!data.catatan || data.catatan.trim() === "" || data.catatan.trim() === "-" || data.catatan.trim().length < 3) {
          return responseJSON({ 
              result: 'error', 
              message: 'GAGAL: Kolom Catatan/Keterangan harus diisi (tidak boleh kosong).' 
          });
      }
  }
  // =================================================================
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  const sheetUsers = SS.getSheetByName(SHEET_USERS);
  const userRows = sheetUsers.getDataRange().getValues();

  // =================================================================
  // --- [UPDATE] VALIDASI DUPLIKASI & KUOTA (SEMUA TIPE FORM) ---
  // =================================================================
  
  // 1. Daftar tipe yang dicek agar tidak duplikat tanggalnya
  const TYPES_CHECK_DUPLICATE = ['Ijin', 'Cuti', 'Sakit', 'Dinas Luar', 'Cuti EO', 'Tukar Shift', 'Off', 'Dinas'];

  if (TYPES_CHECK_DUPLICATE.includes(data.tipe)) {
      const rowsAbsen = sheet.getDataRange().getValues();
      
      // Tentukan Tanggal Input yang akan dicek (Format: yyyy-MM-dd)
      let inputDateStr = "";
      if (data.tglMulai && data.tglMulai !== '-' && data.tglMulai !== '') {
          inputDateStr = Utilities.formatDate(new Date(data.tglMulai), Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else {
          // Jika tidak ada tglMulai, gunakan hari ini
          inputDateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
      }

      let countIjinExisting = 0; // Counter khusus Ijin

      // Loop untuk mengecek data lama
      for (let i = 1; i < rowsAbsen.length; i++) {
          const rUserId = String(rowsAbsen[i][2]); // Kolom C: User ID
          const rTipe   = rowsAbsen[i][4];         // Kolom E: Tipe Absen
          const rStatus = rowsAbsen[i][12];        // Kolom M: Status

          // Skip jika User Beda atau Status Rejected (Data ditolak tidak dihitung)
          if (rUserId !== String(data.userId) || rStatus === 'Rejected') {
              continue;
          }

          // A. Hitung Kuota Ijin (Khusus Tipe Ijin)
          if (data.tipe === 'Ijin' && rTipe === 'Ijin') {
              countIjinExisting++;
          }

          // B. Cek Duplikasi Tanggal (Hanya jika Tipe Sama)
          // Contoh: Jika input "Sakit", cek apakah sudah ada "Sakit" di tanggal tsb
          if (rTipe === data.tipe) {
               let rDateStr = "";
               // Ambil tanggal dari Kolom I (tglMulai)
               if (rowsAbsen[i][8] && rowsAbsen[i][8] !== '-' && rowsAbsen[i][8] !== '') {
                   const d = new Date(rowsAbsen[i][8]);
                   if(!isNaN(d.getTime())) rDateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
               } else {
                   // Fallback ke Kolom B (Waktu Input) jika tglMulai kosong
                   const d = new Date(rowsAbsen[i][1]);
                   if(!isNaN(d.getTime())) rDateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
               }

               // JIKA TANGGAL SAMA -> TOLAK
               if (rDateStr === inputDateStr) {
                   return responseJSON({ 
                       result: 'error', 
                       message: `GAGAL: Anda sudah mengajukan "${data.tipe}" pada tanggal ${inputDateStr}. Tanggal tidak boleh sama.` 
                   });
               }
          }
      }

      // C. Validasi Akhir Kuota Ijin (Maksimal 4x)
      if (data.tipe === 'Ijin' && countIjinExisting >= 4) {
          return responseJSON({ result: 'error', message: 'GAGAL: Kuota pengajuan Ijin Anda sudah habis (Maksimal 4x riwayat).' });
      }
  }
  // =================================================================
  // --- [AKHIR VALIDASI] ---
  // =================================================================

  const waktu = new Date();
  const uuid = Utilities.getUuid();

  // --- LOGIKA UPLOAD FOTO (TIDAK BERUBAH) ---
  let fotoUrl = '';
  if (data.foto && data.foto.includes('base64')) {
      try {
        const imageBlob = Utilities.newBlob(Utilities.base64Decode(data.foto.split(',')[1]), 'image/jpeg', `Absen_${data.nama}_${waktu.getTime()}.jpg`);
        const file = getFolder().createFile(imageBlob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fotoUrl = "https://drive.google.com/uc?export=view&id=" + file.getId();
      } catch (e) { fotoUrl = 'Error Upload'; }
  } else if (data.existingFoto) { fotoUrl = data.existingFoto; }

  // --- LOGIKA UPLOAD LAMPIRAN (TIDAK BERUBAH) ---
  let lampiranUrl = '-';
  if (data.fileLampiran && data.fileLampiran.includes('base64')) {
     try {
       const rawData = data.fileLampiran.split(',')[1];
       const decodedBlob = Utilities.base64Decode(rawData);
       const mimeType = data.fileMime || 'application/octet-stream';
       let finalFileName = (data.fileName && data.fileName.trim() !== "") 
            ? `Lampiran_${data.nama}_${data.fileName}` 
            : `Lampiran_${data.nama}_${waktu.getTime()}.bin`;

       const blob = Utilities.newBlob(decodedBlob, mimeType, finalFileName);
       const fileDoc = getFolder().createFile(blob);
       fileDoc.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
       lampiranUrl = "https://drive.google.com/uc?export=view&id=" + fileDoc.getId();
     } catch(e) { 
       lampiranUrl = 'Gagal Upload Lampiran';
       console.error("Error Upload: " + e.toString());
     }
  }

  // --- CEK DATA USER ---
  const foundUser = userRows.slice(1).find(row => String(row[0]) === String(data.userId));
  let currentSisaCuti = 0;
  let emailAtasan = '';
  
  if (foundUser) {
    // 1. Ambil Email Atasan (Tetap dari Sheet Users)
    emailAtasan = foundUser[12] || '';
    
    // 2. LOGIKA BARU: Ambil Sisa Cuti dari MASTER-CUTI (Kolom Y / Index 24)
    const userNik = String(foundUser[7]); // Asumsi NIK ada di Sheet Users Kolom H (Index 7)
    const sheetMasterCuti = SS.getSheetByName("MASTER-CUTI");
    
    if (sheetMasterCuti) {
      const rowsMaster = sheetMasterCuti.getDataRange().getValues();
      // Cari baris di Master Cuti yang NIK-nya (Kolom B/Index 1) cocok
      const rowCuti = rowsMaster.find(r => String(r[1]) === userNik);
      
      if (rowCuti) {
        // Ambil dari Kolom Y (Index 24)
        currentSisaCuti = rowCuti[24]; 
      } else {
        // Fallback jika tidak ketemu di Master, ambil dari Users
        currentSisaCuti = foundUser[8] || 0; 
      }
    } else {
      currentSisaCuti = foundUser[8] || 0;
    }
  }

  // --- STATUS AWAL ---
  let statusAwal = 'Pending';
  let approverAwal = '-';
  let timeStampAwal = '-';

  if (data.tipe === 'Hadir' || data.tipe === 'Pulang') {
    statusAwal = 'Verified';
    approverAwal = 'System';
    timeStampAwal = new Date();
  }

  // --- SIMPAN KE SHEET ---
  sheet.appendRow([
    uuid, waktu, data.userId, data.nama, data.tipe, data.lokasi, data.catatan, 
    fotoUrl, 
    data.tglMulai || '-', data.tglSelesai || '-', 
    data.jamMulai || '-', data.jamSelesai || '-', 
    statusAwal, approverAwal, timeStampAwal,
    lampiranUrl 
  ]);

  // --- KIRIM EMAIL ---
  const allowedTypes = ['Cuti', 'Sakit', 'Cuti EO', 'Dinas Luar', 'Lembur', 'Tukar Shift', 'Off'];
  if (allowedTypes.includes(data.tipe)) {
      if (emailAtasan && emailAtasan.includes('@')) {
          let detailPeriode = formatDateStrict(waktu);
          let durasiHari = 1;
          if (data.tglMulai && data.tglMulai !== '-') {
             detailPeriode = `${formatDateStrict(data.tglMulai)} s/d ${formatDateStrict(data.tglSelesai)}`;
             const dStart = new Date(data.tglMulai);
             const dEnd = new Date(data.tglSelesai);
             if(!isNaN(dStart) && !isNaN(dEnd)){
                 dStart.setHours(0,0,0,0); dEnd.setHours(0,0,0,0);
                 const diff = Math.abs(dEnd - dStart);
                 durasiHari = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
             }
          }
          kirimRequestApproval(
            uuid, data.nama, data.tipe, detailPeriode, data.catatan, 
            currentSisaCuti, emailAtasan, durasiHari, 
            data.jamMulai, data.jamSelesai, fotoUrl, lampiranUrl
          );
          return responseJSON({ result: 'success', message: `Permohonan ${data.tipe} ✉️Berhasil Dikirim ke Pimpinan` });
      } else {
          return responseJSON({ result: 'success', message: `${data.tipe} Tersimpan (Email Pimpinan belum ditambahkan)` });
      }
  }

  return responseJSON({ result: 'success', message: '✅Pengajuan Berhasil...!' });
}

function checkCutiOverlap(userId, newStartStr, newEndStr) {
    const sheet = SS.getSheetByName(SHEET_ABSENSI);
    const rows = sheet.getDataRange().getValues();
    const newStart = new Date(newStartStr);
    const newEnd = new Date(newEndStr);
    
    newStart.setHours(0,0,0,0);
    newEnd.setHours(0,0,0,0);

    for (let i = 1; i < rows.length; i++) {
        const rowUserId = String(rows[i][2]);
        const rowTipe = rows[i][4];
        const rowStatus = rows[i][12];
        const rowStartStr = rows[i][8];
        const rowEndStr = rows[i][9];

        if (rowUserId === String(userId) && rowTipe === 'Cuti' && rowStatus !== 'Rejected') {
            if (rowStartStr && rowStartStr !== '-' && rowEndStr && rowEndStr !== '-') {
                const existStart = new Date(rowStartStr);
                const existEnd = new Date(rowEndStr);
                existStart.setHours(0,0,0,0);
                existEnd.setHours(0,0,0,0);

                if (newStart <= existEnd && newEnd >= existStart) {
                    return { isOverlap: true, conflictDate: `${formatDate(rowStartStr)} - ${formatDate(rowEndStr)}` };
                }
            }
        }
    }
    return { isOverlap: false };
}

function kirimRequestApproval(uuid, namaKaryawan, tipe, periode, keterangan, sisaCuti, emailTujuan, durasi, jamMulai, jamSelesai, fotoUrl, lampiranUrl) {
  try {
    const scriptUrl = ScriptApp.getService().getUrl();
    const approveLink = `${scriptUrl}?action=approve_via_email&uuid=${uuid}`;
    const rejectLink = `${scriptUrl}?action=reject_via_email&uuid=${uuid}`;
    
    // 1. LOGIKA DURASI HARI (Hanya tipe tertentu)
    const showDurasi = ['Cuti', 'Cuti EO', 'Sakit', 'Dinas Luar'].includes(tipe);
    let rowDurasi = "";
    if (showDurasi) {
        const hari = durasi || 1; 
        rowDurasi = `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b;">Waktu</td>
            <td style="padding: 10px 0; font-weight: bold; color: #2563eb;">${hari} Hari</td>
        </tr>`;
    }

    // 2. LOGIKA SISA CUTI (Hanya muncul jika tipe == Cuti)
    let rowSisaCuti = "";
    if (tipe === 'Cuti') {
       rowSisaCuti = `
       <tr style="border-bottom: 1px solid #f1f5f9; background-color: #fffbeb;">
            <td style="padding: 10px; color: #b45309; font-weight: bold;">Sisa Cuti</td>
            <td style="padding: 10px; font-weight: 800; color: #b45309;">${sisaCuti} Hari</td>
       </tr>`;
    }

    // 3. LOGIKA JAM (Jika ada)
    let rowJam = "";
    if (jamMulai && jamMulai !== '-' && jamSelesai && jamSelesai !== '-') {
        rowJam = `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b;">Jam</td>
            <td style="padding: 10px 0; font-weight: bold;">${jamMulai} - ${jamSelesai}</td>
        </tr>`;
    }

    // 4. LOGIKA FOTO & LAMPIRAN
    let buktiHtml = [];
    if (fotoUrl && fotoUrl !== '-' && fotoUrl !== '' && fotoUrl !== 'Error Upload') {
        buktiHtml.push(`<a href="${fotoUrl}" style="text-decoration:none; color:#2563eb; font-weight:bold; border:1px solid #2563eb; padding:4px 8px; rounded:4px; font-size:12px;">📷 View</a>`);
    }
    if (lampiranUrl && lampiranUrl !== '-' && lampiranUrl !== '') {
        buktiHtml.push(`<a href="${lampiranUrl}" style="text-decoration:none; color:#d97706; font-weight:bold; border:1px solid #d97706; padding:4px 8px; rounded:4px; font-size:12px;">📎 View</a>`);
    }
    
    let rowBukti = "";
    if (buktiHtml.length > 0) {
        rowBukti = `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b;">Lampiran</td>
            <td style="padding: 10px 0;">${buktiHtml.join('&nbsp;&nbsp;')}</td>
        </tr>`;
    }

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background-color: #2563eb; padding: 25px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 22px;">Permohonan Approval</h2>
          <p style="color: #bfdbfe; margin: 5px 0 0; font-size: 14px;">e-Form Online Notification</p>
        </div>
  
        <div style="padding: 30px;">
          <p>Yth. Bpk/Ibu Pimpinan,</p>
          <p>Mohon tinjau permohonan Approval berikut:</p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;">Nama</td><td style="padding: 10px 0; font-weight: bold;">${namaKaryawan}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;">Form</td><td style="padding: 10px 0; font-weight: bold; color: #2563eb;">${tipe}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;">Periode</td><td style="padding: 10px 0; font-weight: bold;">${periode}</td></tr>
            
            ${rowJam}
            ${rowDurasi}
            ${rowBukti}
            
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;">Keterangan</td><td style="padding: 10px 0; font-style: italic;">"${keterangan}"</td></tr>
            
            ${rowSisaCuti}

          </table>
          <div style="text-align: center; margin-top: 30px;">
            <a href="${approveLink}" style="background-color: #10b981; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 10px;">✅ APPROVE</a>
            <a href="${rejectLink}" style="background-color: #ef4444; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold;">❎ REJECT</a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 15px; text-align: center; font-size: 11px; color: #cbd5e1;">&copy; e-Form Online | by : IT SUPPORT</div>
      </div>
    `;
    MailApp.sendEmail({ to: emailTujuan, subject: `[APPROVAL] ${tipe} - ${namaKaryawan}`, htmlBody: htmlBody });
  } catch (e) { console.log("Error kirim email: " + e.toString()); }
}

// ==========================================
// FITUR: KIRIM ULANG EMAIL APPROVAL (URL FIX)
// ==========================================
function handleRequestApprovalEmail(data) {
  const targetUuid = data.uuid;
  
  // FIX: Ambil URL dari data frontend (scriptUrl) ATAU deteksi otomatis
  // Ini mencegah error "MY_WEBAPP_URL is not defined"
  const currentAppUrl = data.scriptUrl || ScriptApp.getService().getUrl();

  const sheetAbsen = SS.getSheetByName(SHEET_ABSENSI);
  const rows = sheetAbsen.getDataRange().getValues();
  
  let foundRowIndex = -1;
  let rowData = null;

  // 1. Cari Data Absensi
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === String(targetUuid)) { // Cek Kolom C (Index 2) -> UUID User? 
      // TUNGGU, UUID biasanya di Kolom A (Index 0). Mari cek ulang logika insert.
      // Di handleAbsen: sheet.appendRow([uuid, waktu, userId...]) -> UUID di Kolom A (Index 0)
      // JADI KITA HARUS CEK KOLOM 0
    }
    // REVISI LOGIKA PENCARIAN (Cek Kolom A / Index 0 untuk UUID)
    if (String(rows[i][0]) === String(targetUuid)) {
      foundRowIndex = i;
      rowData = rows[i];
      break;
    }
  }

  if (foundRowIndex === -1) return responseJSON({ result: 'error', message: 'Data absensi tidak ditemukan (UUID Mismatch).' });

  // 2. Cek Status
  const currentStatus = rowData[12]; 
  if (currentStatus !== 'Pending') return responseJSON({ result: 'error', message: `Status data sudah: ${currentStatus}` });

  // 3. Ambil Email Atasan
  const userId = rowData[2]; 
  const sheetUser = SS.getSheetByName(SHEET_USERS);
  const rowsUser = sheetUser.getDataRange().getValues();
  let emailAtasan = '';
  let namaKaryawan = rowData[3];

  for(let j=1; j<rowsUser.length; j++){
      if(String(rowsUser[j][0]) === String(userId)){
          emailAtasan = rowsUser[j][12]; // Kolom M (Index 12)
          break;
      }
  }

  if (!emailAtasan || emailAtasan === '-' || !emailAtasan.includes('@')) {
      return responseJSON({ result: 'error', message: `Email atasan kosong (Cek Sheet Users Kolom M).` });
  }

  // 4. Kirim Email
  try {
      const approvalLink = `${currentAppUrl}?action=approve_via_email&uuid=${targetUuid}`;
      const rejectLink = `${currentAppUrl}?action=reject_via_email&uuid=${targetUuid}`;
      
      const subject = `[REMINDER] Approval Ijin/Cuti - ${namaKaryawan}`;
      const body = `
        <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px;">
          <h3>Pengajuan Menunggu Approval (Kirim Ulang)</h3>
          <p>Karyawan <b>${namaKaryawan}</b> mengirim ulang permintaan tinjauan:</p>
          <ul>
            <li><b>Tipe:</b> ${rowData[4]}</li>
            <li><b>Keterangan:</b> ${rowData[6]}</li> 
            <li><b>Tanggal:</b> ${formatDate(rowData[1])}</li>
          </ul>
          <div style="margin-top: 20px;">
            <a href="${approvalLink}" style="background:green; color:white; padding:10px 20px; text-decoration:none; margin-right:10px; border-radius:5px;">APPROVE</a>
            <a href="${rejectLink}" style="background:red; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">REJECT</a>
          </div>
        </div>
      `;

      MailApp.sendEmail({ to: emailAtasan, subject: subject, htmlBody: body });
      return responseJSON({ result: 'success', message: `Email terkirim ke: ${emailAtasan}` });

  } catch (e) {
      return responseJSON({ result: 'error', message: 'Gagal kirim email: ' + e.toString() });
  }
}


// ==========================================
// 3. FITUR REMARK (LAPORAN & RESPON HRD)
// ==========================================

// --- FUNGSI KIRIM LAPORAN (MODIFIED: TGL KOREKSI) ---
function handleSendRemark(data) {
  const sheet = SS.getSheetByName(SHEET_REMARKS);
  const uuid = Utilities.getUuid();
  const now = new Date();
  const timeStamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
  
  // [UBAH] Ambil tglKoreksi dari React
  const tglKoreksi = data.tglKoreksi || '-'; 

  // Upload File Logic
  let fileUrl = '-';
  if (data.file && data.file.includes('base64')) {
    try {
      const folder = DriveApp.getFoldersByName(FOLDER_NAME).hasNext() ? DriveApp.getFoldersByName(FOLDER_NAME).next() : DriveApp.createFolder(FOLDER_NAME);
      const blob = Utilities.newBlob(Utilities.base64Decode(data.file.split(',')[1]), data.file.split(';')[0].split(':')[1], data.nama + "_REMARK_" + uuid);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileUrl = file.getUrl();
    } catch (e) {
      fileUrl = 'Error Upload';
    }
  }

  // Simpan ke Sheet (Kolom ke-6 / Index 5 diisi tglKoreksi)
  sheet.appendRow([
    uuid,          // 0
    timeStamp,     // 1
    data.userId,   // 2
    data.nama,     // 3
    data.divisi,   // 4
    tglKoreksi,    // 5 (DULUNYA WA, SEKARANG TANGGAL)
    data.kategori, // 6
    data.pesan,    // 7
    fileUrl,       // 8
    'Open',        // 9
    '-',           // 10
    '-'            // 11
  ]);

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' })).setMimeType(ContentService.MimeType.JSON);
}

// --- FUNGSI AMBIL DATA REMARK (MODIFIED: TGL KOREKSI) ---
function handleGetRemarks(data) {
  const sheet = SS.getSheetByName(SHEET_REMARKS);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ result: 'success', list: [] })).setMimeType(ContentService.MimeType.JSON);
  
  const rows = sheet.getDataRange().getValues();
  const list = [];
  const userRole = data.role ? String(data.role).toLowerCase() : '';
  const userId = String(data.userId);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowUserId = String(row[2]); 
    let include = false;

    if (userRole === 'admin' || userRole === 'hrd') include = true;
    else if (rowUserId === userId) include = true;

    if (include) {
      // Format Tanggal Koreksi (Kolom Index 5)
      let rawTgl = row[5];
      let formattedTgl = '-';
      if (rawTgl instanceof Date) {
         formattedTgl = Utilities.formatDate(rawTgl, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else if (rawTgl) {
         formattedTgl = String(rawTgl);
      }

      list.push({
        uuid: row[0],
        waktu: row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss") : row[1],
        nama: row[3],
        divisi: row[4],
        tglKoreksi: formattedTgl, // Property untuk React
        kategori: row[6],
        pesan: row[7],
        lampiran: row[8],
        status: row[9] || 'Open',
        respon: row[10] || '',
        waktuRespon: row[11] ? (row[11] instanceof Date ? Utilities.formatDate(row[11], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss") : row[11]) : '-' 
      });
    }
  }
  
  list.reverse();
  return ContentService.createTextOutput(JSON.stringify({ result: 'success', list: list })).setMimeType(ContentService.MimeType.JSON);
}

// --- FUNGSI UPDATE STATUS (DONE) & RESPON ---
function handleUpdateRemarkStatus(data) {
  const sheet = SS.getSheetByName(SHEET_REMARKS);
  const rows = sheet.getDataRange().getValues();
  
  // Loop cari UUID yang cocok
  for (let i = 1; i < rows.length; i++) {
    // UUID ada di kolom index 0
    if (String(rows[i][0]) === String(data.uuid)) {
        
        const now = new Date();
        const waktuRespon = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");

        // Update Kolom J (Index 10) -> Status
        sheet.getRange(i + 1, 10).setValue('Done');
        
        // Update Kolom K (Index 11) -> Respon Pesan
        const responPesan = data.response ? data.response : "Sudah diproses.";
        sheet.getRange(i + 1, 11).setValue(responPesan); 
        
        // Update Kolom L (Index 12) -> Waktu Respon
        sheet.getRange(i + 1, 12).setValue(waktuRespon);

        // Return Sukses JSON
        return ContentService.createTextOutput(JSON.stringify({ 
            result: 'success', 
            message: 'Respon terkirim dan status Done.' 
        })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // Jika UUID tidak ketemu
  return ContentService.createTextOutput(JSON.stringify({ 
      result: 'error', 
      message: 'Data tidak ditemukan.' 
  })).setMimeType(ContentService.MimeType.JSON);
}


// ==========================================
// 4. FITUR GET DB ABSEN
// ==========================================

function handleGetDbAbsen(data) {
  const sheet = SS.getSheetByName(SHEET_DB_ABSEN);
  if (!sheet) return responseJSON({ result: 'error', message: 'Sheet dbabsen tidak ditemukan' }); // [cite: 158]

  // --- AMBIL TIMESTAMP UPDATE ---
  const lastUpdateRaw = sheet.getRange("T1").getValue();
  let lastUpdateStr = null;
  if (lastUpdateRaw && lastUpdateRaw !== "") {
      try {
        lastUpdateStr = new Date(lastUpdateRaw).toISOString();
      } catch (e) { lastUpdateStr = null; }
  }

  const rows = sheet.getDataRange().getValues();
  
  // --- CARI USER ---
  const sheetUser = SS.getSheetByName(SHEET_USERS); // [cite: 163]
  const rowsUser = sheetUser.getDataRange().getValues();
  let userNik = data.noPayroll; 

  if (!userNik) {
    const foundUser = rowsUser.slice(1).find(r => String(r[0]) === String(data.userId));
    if (foundUser) userNik = foundUser[7];
  }

  if (!userNik || userNik === '-') return responseJSON({ result: 'success', list: [] });

  const list = [];
  
  // --- [BARU] DAFTAR SIMBOL YANG MEMICU TOMBOL AJUKAN ---
  const TARGET_SYMBOLS = ['T', 'TSi', 'TSo', 'Si', 'So']; 

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNik = String(row[2]); // [cite: 167]

    if (rowNik === String(userNik)) {
       let rawDate = row[4];
       let parsedDate = new Date(rawDate);
       if (isNaN(parsedDate.getTime())) parsedDate = new Date(0);

       const symbol = String(row[14]).trim(); // Ambil Simbol
       const jamKerjaRaw = String(row[5]);    // Ambil Jam Kerja (misal: "08:00 - 17:00")

       // --- [BARU] LOGIKA PARSE JAM KERJA ---
       // Tujuannya agar Frontend tidak perlu pusing split string
       let shiftStart = "";
       let shiftEnd = "";
       
       if (jamKerjaRaw.includes("-")) {
          const parts = jamKerjaRaw.split("-");
          if (parts.length === 2) {
             shiftStart = parts[0].trim(); // "08:00"
             shiftEnd = parts[1].trim();   // "17:00"
          }
       }

       // --- [BARU] LOGIKA SHOW BUTTON ---
       // Cek apakah simbol ada di daftar target
       const showAjukanBtn = TARGET_SYMBOLS.includes(symbol);

       list.push({
         nik: row[2],
         nama: row[3],
         tanggal: formatDate(rawDate),         // Format Tampilan (DD-MM-YYYY)
         tanggalRaw: formatDateYMD(rawDate),   // [PENTING] Format Value Input (YYYY-MM-DD)
         jamKerja: row[5],
         masuk: row[8],
         pulang: row[9],
         telat: row[10],
         symbol: symbol,
         waktuScan: row[17],
         week: row[18],
         _sortDate: parsedDate.getTime(),
         
         // Data Tambahan untuk Fitur Baru:
         canRequestIjin: showAjukanBtn, // Boolean: True/False
         shiftStart: shiftStart,        // "08:00"
         shiftEnd: shiftEnd             // "17:00"
       });
    }
  }

  list.sort((a, b) => b._sortDate - a._sortDate);
  return responseJSON({ result: 'success', list: list, lastUpdate: lastUpdateStr });
}

// ==========================================
// 5. AUTH & LOGIC LAINNYA
// ==========================================

function handleLogin(data) {
  const sheetUsers = SS.getSheetByName(SHEET_USERS);
  const userRows = sheetUsers.getDataRange().getValues();

  // 1. AMBIL DATA MASTER (Agar menu E-Form Muncul)
  // DARI CACHE (lihat Cache.gs). Dulu membaca sheet MasterData PENUH di
  // setiap login. Isinya hampir tidak pernah berubah.
  const masterData = getMasterDataCached();

  // 2. AMBIL DATA MASTER CUTI (Agar Sisa Cuti Akurat)
  // DARI CACHE, dan sebagai PETA noPayroll -> {terpakai,bersama,tersedia},
  // bukan seluruh sheet. Dulu membaca MASTER-CUTI PENUH hanya untuk
  // mengambil satu baris.
  const petaCuti = getPetaCutiCached();

  // 3. CARI USER
  // Perbandingan ketat (=== dan dibungkus String) agar tidak ada
  // type coercion tak terduga saat sel password terbaca sebagai angka.
  const foundUser = userRows.slice(1).find(row =>
    String(row[1]).toLowerCase() === String(data.username).toLowerCase() &&
    String(row[2]) === String(data.password)
  );

  if (foundUser) {
    const noPayroll = String(foundUser[7] || '-');

    // 4. HITUNG SISA CUTI
    let cutiTersedia = 0;
    let cutiTerpakai = 0;
    let cutiBersama = 0;
    
    // Cek di Master Cuti berdasarkan NIK/Payroll.
    // Dulu .find() menyisir seluruh baris; sekarang lookup langsung ke peta.
    const rowCuti = petaCuti[noPayroll.trim()];
    if (rowCuti) {
       cutiTerpakai = rowCuti.terpakai || 0;
       cutiBersama = rowCuti.bersama || 0;
       cutiTersedia = rowCuti.tersedia || 0;
    } else {
       // Fallback ke data user jika tidak ada di Master Cuti
       cutiTersedia = foundUser[8] || 0;
    }

    return responseJSON({
      result: 'success',
      user: { 
          id: foundUser[0], 
          username: foundUser[1], 
          nama: foundUser[3], 
          divisi: foundUser[4], 
          role: foundUser[5], 
          akses: foundUser[6] ? foundUser[6].toString().split(',') : [], 
          noPayroll: noPayroll, 
          
          // Data Cuti
          sisaCuti: cutiTersedia,       
          cutiTerpakai: cutiTerpakai,   
          cutiBersama: cutiBersama,   
          
          fotoProfil: foundUser[9] || '', 
          perusahaan: foundUser[10] || '-', 
          statusKaryawan: foundUser[11] || '-',
          lokasi: foundUser[13] || 'All',

          // TOKEN AUTENTIKASI (lihat Auth.gs)
          // Frontend menyimpannya bersama data user dan mengirimkannya
          // kembali di setiap request. Tanpa ini, request akan ditolak.
          token: createAuthToken({
            id: foundUser[0],
            role: foundUser[5],
            divisi: foundUser[4],
            lokasi: foundUser[13] || 'All'
          })
      }, // <--- PASTIKAN ADA KOMA (,) DI SINI

      // Disertakan di sini agar nanti request check_version bisa dihapus
      // (menghemat satu round trip saat membuka aplikasi).
      version: APP_VERSION,

      masterData: masterData
    });
  } else { 
    return responseJSON({ result: 'error', message: 'Username/Password salah!' });
  }
}

function handleTambahUser(data) {
  if (data.roleRequester !== 'admin') {
    return responseJSON({ result: 'error', message: 'Akses Ditolak.' });
  }
  const sheet = SS.getSheetByName(SHEET_USERS);
  if (sheet.getDataRange().getValues().some(row => row[1] == data.username)) return responseJSON({ result: 'error', message: 'Username sudah ada!' });
  sheet.appendRow([
    'USR-' + new Date().getTime(), data.username, data.password, data.nama, 
    data.divisi, data.role, Array.isArray(data.akses) ? data.akses.join(',') : '', 
    data.noPayroll || '', data.sisaCuti || '', '', data.perusahaan || '', 
    data.statusKaryawan || '', data.emailAtasan || '',
    data.lokasi || 'Surabaya'
  ]);
  return responseJSON({ result: 'success', message: 'User berhasil ditambahkan' });
}

function handleTambahMaster(data) {
  if (data.roleRequester !== 'admin') return responseJSON({ result: 'error', message: 'Akses Ditolak.' });
  const sheet = SS.getSheetByName(SHEET_MASTER); 
  sheet.appendRow([data.kategori, data.value, data.label]); 
  return responseJSON({ result: 'success' }); 
}

function handleGantiPassword(data) {
  const sheet = SS.getSheetByName(SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) { 
      if (String(rows[i][0]) == String(data.id) && String(rows[i][2]) == String(data.oldPassword)) { 
          sheet.getRange(i + 1, 3).setValue(data.newPassword);
          return responseJSON({ result: 'success' }); 
      } 
  }
  return responseJSON({ result: 'error', message: 'Password lama salah' });
}

function handleUploadProfile(data) {
  const sheet = SS.getSheetByName(SHEET_USERS); const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) == String(data.id)) { 
      const imageBlob = Utilities.newBlob(Utilities.base64Decode(data.foto.split(',')[1]), 'image/jpeg', `Profil_${data.nama}.jpg`);
      const url = "https://drive.google.com/uc?export=view&id=" + getFolder().createFile(imageBlob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW).getId();
      sheet.getRange(i + 1, 10).setValue(url);
      return responseJSON({ result: 'success', message: 'Foto profil diperbarui', fotoUrl: url });
    }
  }
  return responseJSON({ result: 'error' });
}

function handleEditAbsen(data) {
    const sheet = SS.getSheetByName(SHEET_ABSENSI); const rows = sheet.getDataRange().getValues();
    const now = new Date();
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] == data.uuid) {
            const entryTime = new Date(rows[i][1]);
            const diffHours = (now - entryTime) / (1000 * 60 * 60);
            if (diffHours > 1) return responseJSON({ result: 'error', message: 'Batas waktu edit (1 jam) habis.' });
            
            const status = rows[i][12];
            if (status === 'Approved' || status === 'Rejected') return responseJSON({ result: 'error', message: 'Data sudah diproses pimpinan.' });
            sheet.getRange(i + 1, 7).setValue(data.catatan);
            sheet.getRange(i + 1, 9).setValue(data.tglMulai);
            sheet.getRange(i + 1, 10).setValue(data.tglSelesai);
            sheet.getRange(i + 1, 11).setValue(data.jamMulai);
            sheet.getRange(i + 1, 12).setValue(data.jamSelesai);
            return responseJSON({ result: 'success', message: 'Data berhasil diubah' });
        }
    }
    return responseJSON({ result: 'error', message: 'Data tidak ditemukan' });
}

function handleDeleteAbsen(data) {
    const sheet = SS.getSheetByName(SHEET_ABSENSI); const rows = sheet.getDataRange().getValues();
    const now = new Date();
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] == data.uuid) {
            const entryTime = new Date(rows[i][1]);
            const diffHours = (now - entryTime) / (1000 * 60 * 60);
            if (diffHours > 1) return responseJSON({ result: 'error', message: 'Batas waktu hapus (1 jam) habis.' });

            const status = rows[i][12];
            if (status === 'Approved' || status === 'Rejected') return responseJSON({ result: 'error', message: 'Data sudah diproses pimpinan.' });
            sheet.deleteRow(i + 1); 
            return responseJSON({ result: 'success', message: 'Data dihapus' });
        }
    }
    return responseJSON({ result: 'error', message: 'Data tidak ditemukan' });
}


// --- FUNGSI GET HISTORY (PERBAIKAN: ID AKUN & PAYROLL) ---
function handleGetHistory(data) {
  const sheetAbsen = SS.getSheetByName(SHEET_ABSENSI);
  const rowsAbsen = sheetAbsen.getDataRange().getValues();
  
  const sheetUser = SS.getSheetByName(SHEET_USERS);
  const rowsUser = sheetUser.getDataRange().getValues();
  
  // 1. Mapping Data User (Untuk ambil Payroll & Nama & Divisi)
  const userMap = {};
  for (let u = 1; u < rowsUser.length; u++) {
    // Key: User ID (Kolom A / Index 0)
    userMap[String(rowsUser[u][0])] = {
      noPayroll: rowsUser[u][7] || '-', // Ambil Payroll dari Kolom H (Index 7)
      nama: rowsUser[u][3],             // Nama
      divisi: rowsUser[u][4] || '-',    // Divisi
      lokasi: rowsUser[u][13] || ''     // Lokasi
    };
  }

  const history = [];
  const requestorLokasi = data.requestorLokasi || 'All';

  // Helper untuk filter view
  const isTargeted = (idToCheck) => {
    if (data.canViewAll && data.targetUserIds && Array.isArray(data.targetUserIds)) {
      if (data.targetUserIds.length > 0) return data.targetUserIds.includes(String(idToCheck));
      return true; 
    }
    return String(idToCheck) === String(data.userId);
  };

  // 2. Loop Data Absensi dari Bawah (Terbaru) ke Atas
  for (let i = rowsAbsen.length - 1; i >= 1; i--) {
    const row = rowsAbsen[i];
    const rowUserId = String(row[2]); // Kolom C: User ID
    
    // Ambil data detail user dari Map
    const userData = userMap[rowUserId] || { noPayroll: '-', nama: row[3], divisi: '-', lokasi: '' };
    
    // Filter Lokasi (Khusus Admin/HRD)
    if (data.canViewAll && (!userData.lokasi || userData.lokasi === '')) continue;

    if (isTargeted(rowUserId)) {
      // Filter Lokasi Requestor
      if (data.canViewAll && requestorLokasi !== 'All') {
         if (String(userData.lokasi).toLowerCase() !== String(requestorLokasi).toLowerCase()) continue;
      }

      history.push({
        uuid: row[0],
        waktu: formatDate(row[1]),
        
        userId: rowUserId,       // User ID Asli
        idAkun: rowUserId,       // [REQUEST] ID AKUN diisi dengan User ID
        noPayroll: userData.noPayroll, // [REQUEST] PAYROLL diisi data dari Sheet Users
        
        nama: userData.nama,
        divisi: userData.divisi,
        tipe: row[4],
        lokasi: row[5],
        catatan: row[6],
        foto: row[7],
        
        // Helper Format Tanggal & Jam
        tglMulai: formatDateYMD(row[8]),   
        tglSelesai: formatDateYMD(row[9]),
        jamMulai: formatTimeSimple(row[10]),
        jamSelesai: formatTimeSimple(row[11]),
        
        status: row[12] || 'Pending',
        approver: row[13] || '-',
        approvalTime: formatDate(row[14]),
        lampiran: row[15] || '-',
        alasan: row[16] || '-'
      });
    }
    
    // Batasan Data agar tidak loading lama
    if (!data.canViewAll && history.length >= 50) break;
    if (data.canViewAll && history.length >= 1000) break; // Naikkan limit untuk admin
  }
  
  return responseJSON({ result: 'success', history: history });
}

function handleGetUserListSimple(data) {
  const requestorLokasi = data.lokasi || 'All';
  const filterLokasi = data.filterLokasi || 'All'; 
  const sheet = SS.getSheetByName(SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const rawLokasi = rows[i][13];
    if (!rawLokasi || String(rawLokasi).trim() === '') continue; 
    const userLokasi = String(rawLokasi);
    const isPermitted = (requestorLokasi === 'All' || userLokasi.toLowerCase() === String(requestorLokasi).toLowerCase());
    const isMatchFilter = (filterLokasi === 'All' || userLokasi.toLowerCase() === String(filterLokasi).toLowerCase());
    if (isPermitted && isMatchFilter) {
      list.push({ id: rows[i][0], nama: rows[i][3], lokasi: userLokasi });
    }
  }
  list.sort((a, b) => a.nama.toLowerCase().localeCompare(b.nama.toLowerCase()));
  return responseJSON({ result: 'success', list: list });
}

// HANDLE GET STATS (UPDATED: Cuti dari Master-Cuti)
// ==========================================
function handleGetStats(data) { 
    const sheetAbsensi = SS.getSheetByName(SHEET_ABSENSI);
    const rowsAbsensi = sheetAbsensi.getDataRange().getValues();
    
    // Ambil Data Mesin
    const sheetDb = SS.getSheetByName(SHEET_DB_ABSEN);
    const rowsDb = sheetDb ? sheetDb.getDataRange().getValues() : [];

    // [UPDATE] Ambil Data MASTER-CUTI — DARI CACHE (lihat Cache.gs).
    // Dulu membaca sheet MASTER-CUTI PENUH di setiap pemanggilan get_stats.
    const petaCuti = getPetaCutiCached();

    // Init Counters
    let stats = {
        total_hadir: 0,
        total_ijin: 0,
        total_telat_freq: 0,
        total_telat_menit: 0,
        total_cuti: 0,          // Nanti di-override dari MASTER-CUTI
        total_cuti_bersama: 0,  // Nanti di-override dari MASTER-CUTI
        total_sakit: 0,
        total_alpa: 0,
        total_no_scan_in: 0,
        total_no_scan_out: 0,
        ijin_count: 0,      
        remarks_open: 0,
        periode_db: 'Belum ada data'
    };

    const targetId = String(data.userId);

    // 1. HITUNG STATISTIK MANUAL (Sheet Absensi - Ijin, Sakit, Alpa)
    for (let i = 1; i < rowsAbsensi.length; i++) { 
        if (String(rowsAbsensi[i][2]) === targetId) { 
            const tipe = rowsAbsensi[i][4];
            const status = rowsAbsensi[i][12]; 

            if (status !== 'Rejected') {
                if (tipe === 'Ijin') { 
                    stats.ijin_count++;
                    stats.total_ijin++; 
                }
                // [UPDATE] Logika Cuti manual dimatikan, karena diambil dari Master
                // if (tipe === 'Cuti' || tipe === 'Cuti EO') stats.total_cuti++;
                
                if (tipe === 'Sakit') stats.total_sakit++;
                if (tipe === 'Alpa') stats.total_alpa++;
            }
        } 
    }

    // 2. CARI NIK USER & AMBIL DATA CUTI DARI MASTER
    let userNik = '';
    const sheetUser = SS.getSheetByName(SHEET_USERS);
    const rowsUser = sheetUser.getDataRange().getValues();
    const foundUser = rowsUser.slice(1).find(r => String(r[0]) === targetId);
    
    if (foundUser) {
        userNik = String(foundUser[7]).trim(); // Ambil No Payroll

        // [UPDATE] LOGIKA BARU: AMBIL DARI MASTER-CUTI BERDASARKAN NIK
        if (userNik && userNik !== '-') {
            // Lookup langsung ke peta, bukan menyisir seluruh baris
            const rowCuti = petaCuti[userNik];

            if (rowCuti) {
                // Kolom W (Index 22) -> Dashboard: CUTI DIAMBIL
                stats.total_cuti = rowCuti.terpakai || 0;

                // Kolom X (Index 23) -> Dashboard: CUTI BERSAMA
                stats.total_cuti_bersama = rowCuti.bersama || 0;
            }
        }
    }

    // 3. HITUNG STATISTIK MESIN (Database Fingerprint)
    let minTimestamp = null;
    let maxTimestamp = null;
    let dataMesinFound = false;

    // Definisikan Simbol untuk Kategori HADIR
    const HADIR_SYMBOLS = ['H', 'I', 'T', 'Si', 'So', 'TSo', 'TSi', 'TPC'];

    if (userNik && userNik !== '-' && rowsDb.length > 1) {
        for (let j = 1; j < rowsDb.length; j++) {
            const rowNik = String(rowsDb[j][2]).trim();
            if (rowNik === userNik) {
                dataMesinFound = true;
                
                // A. Cek Periode
                const rawDate = rowsDb[j][4];
                let currentTs = null;
                if (rawDate instanceof Date) currentTs = rawDate.getTime();
                else if (typeof rawDate === 'string') {
                    const parsed = new Date(rawDate);
                    if (!isNaN(parsed.getTime())) currentTs = parsed.getTime();
                }
                if (currentTs !== null) {
                    if (minTimestamp === null || currentTs < minTimestamp) minTimestamp = currentTs;
                    if (maxTimestamp === null || currentTs > maxTimestamp) maxTimestamp = currentTs;
                }

                // B. Statistik Symbol
                const symbol = String(rowsDb[j][14]); 
                const telatStr = rowsDb[j][10];

                // Hitung Hadir Gabungan
                if (HADIR_SYMBOLS.includes(symbol)) {
                     stats.total_hadir++;
                }

                // Hitung Detail Lainnya
                if (['S'].includes(symbol)) stats.total_sakit++; // Opsional: jika ingin ambil dari DB
                if (['A', 'AC'].includes(symbol)) stats.total_alpa++; // Opsional: jika ingin ambil dari DB
                
                // [UPDATE] Cuti Bersama (CB) dari DB dimatikan agar tidak bentrok dengan Master Cuti
                // if (['CB'].includes(symbol)) stats.total_cuti_bersama++;

                // Terlambat
                if (symbol.includes('T') || (telatStr && telatStr !== '00:00:00' && telatStr !== '-' && telatStr !== 'FALSE')) {
                     if(symbol.includes('T')) stats.total_telat_freq++;
                     stats.total_telat_menit += parseTimeToMinutes(telatStr);
                }

                // Scan Error
                if (['Si', 'TSi', 'SiPC', 'SiSo'].includes(symbol)) stats.total_no_scan_in++;
                if (['So', 'TSo', 'SiSo'].includes(symbol)) stats.total_no_scan_out++;
            }
        }
    }

    // 4. Format Periode Data
    if (dataMesinFound && minTimestamp !== null && maxTimestamp !== null) {
        const tz = Session.getScriptTimeZone();
        const strMin = Utilities.formatDate(new Date(minTimestamp), tz, "dd MMM yyyy");
        const strMax = Utilities.formatDate(new Date(maxTimestamp), tz, "dd MMM yyyy");
        stats.periode_db = `${strMin} - ${strMax}`;
    } else if (!userNik || userNik === '-') {
        stats.periode_db = "NIK User Kosong";
    } else if (!dataMesinFound) {
        stats.periode_db = "Data Mesin Kosong";
    }

    // 5. Remarks Counter
    const sheetRemarks = SS.getSheetByName(SHEET_REMARKS);
    if(sheetRemarks) {
        const rRows = sheetRemarks.getDataRange().getValues();
        const userRole = data.role ? String(data.role).toLowerCase() : '';
        for (let k = 1; k < rRows.length; k++) {
             const rStatus = rRows[k][9];
             const rUserId = String(rRows[k][2]);
             if(rStatus === 'Open') {
                 if(userRole === 'admin' || userRole === 'hrd') stats.remarks_open++;
                 else if (rUserId === targetId) stats.remarks_open++;
             }
        }
    }

    return responseJSON({ result: 'success', stats: stats });
}

function handleGetApprovalList(data) {
  const role = data.role ? String(data.role).toLowerCase() : '';
  const adminLokasi = data.lokasi;
  if (role !== 'admin' && role !== 'hrd' && role !== 'manager') { return responseJSON({ result: 'success', list: [] }); }
  
  const sheetAbsensi = SS.getSheetByName(SHEET_ABSENSI);
  const rowsAbsen = sheetAbsensi.getDataRange().getValues();
  const sheetUsers = SS.getSheetByName(SHEET_USERS);
  const rowsUsers = sheetUsers.getDataRange().getValues();
  const userMap = {}; 
  
  for (let u = 1; u < rowsUsers.length; u++) {
    const uId = String(rowsUsers[u][0]);
    userMap[uId] = { divisi: rowsUsers[u][4], lokasi: rowsUsers[u][13] || '' };
  }

  const list = [];
  for (let i = 1; i < rowsAbsen.length; i++) {
    const row = rowsAbsen[i];
    const status = row[12]; 
    const tipe = row[4]; 
    const userIdPemohon = String(row[2]);

    if (tipe === 'Hadir' || tipe === 'Pulang') continue;

    if (status === 'Pending') {
      const dataPemohon = userMap[userIdPemohon];
      if (!dataPemohon || !dataPemohon.lokasi || dataPemohon.lokasi === '') continue;

      let isEligible = false;
      const isLokasiMatch = (adminLokasi === 'All') || (adminLokasi === dataPemohon.lokasi);
      
      if (isLokasiMatch) {
          if (role === 'admin' || role === 'hrd') isEligible = true;
          else if (role === 'manager') { if (dataPemohon.divisi === data.divisi) isEligible = true; }
      }
      if (userIdPemohon === String(data.userId)) isEligible = false;

      if (isEligible) {
        // --- 1. FORMAT TIMESTAMP PENGAJUAN (DD-MM-YYYY HH:mm) ---
        // row[1] adalah Waktu Input
        let timestampDisplay = formatDateTimeFull(row[1]); 

        // --- 2. FORMAT PERIODE & DURASI ---
        let detailWaktu = timestampDisplay; // Default
        
        // Cek jika ada range tanggal (Kolom I & J / Index 8 & 9)
        if (row[8] && row[8] !== '-' && row[9] && row[9] !== '-') {
            const startStr = formatDateDDMMYYYY(row[8]); // Format DD-MM-YYYY
            const endStr = formatDateDDMMYYYY(row[9]);   // Format DD-MM-YYYY
            
            // Hitung Durasi
            let durasiTxt = "";
            const d1 = new Date(row[8]);
            const d2 = new Date(row[9]);
            if (!isNaN(d1) && !isNaN(d2)) {
                const diffTime = Math.abs(d2 - d1);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
                durasiTxt = ` (${diffDays})`; // Hasil: (1) atau (2)
            }

            // Format Final: "15-01-2026 s/d 15-01-2026 (1)"
            detailWaktu = `${startStr} s/d ${endStr}${durasiTxt}`;
        } 
        else if (row[10] && row[10] !== '-') {
            // Jika ada Jam (Lembur/Ijin Jam)
            detailWaktu = `${formatDateDDMMYYYY(row[1])} (${formatJam(row[10])} - ${formatJam(row[11])})`;
        } else {
            // Fallback ke tanggal input saja (DD-MM-YYYY)
            detailWaktu = formatDateDDMMYYYY(row[1]);
        }
        
        list.push({
          uuid: row[0], 
          nama: row[3], 
          divisi: dataPemohon.divisi || '-', 
          lokasi: dataPemohon.lokasi || '-', 
          tipe: row[4], 
          waktu: timestampDisplay, // Dikirim sudah format rapi
          detailWaktu: detailWaktu, // Dikirim sudah format rapi + durasi
          catatan: row[6], 
          tglMulai: row[8], 
          tglSelesai: row[9],
          foto: row[7] || '',       
          lampiran: row[15] || ''   
        });
      }
    }
  }
  
  // Sort (Terlama di bawah)
  list.reverse();
  
  return responseJSON({ result: 'success', list: list });
}

function handleProcessApprovalManual(data) {
  const res = processApprovalLogic(data.uuid, data.decision, data.approverName, data.alasan);
  return responseJSON(res);
}

function processApprovalLogic(uuid, decision, approverName, alasanAdmin) {
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  const rows = sheet.getDataRange().getValues();
  // const userSheet = SS.getSheetByName(SHEET_USERS); // Opsional jika tidak dipakai bisa dimatikan

  for (let i = 1; i < rows.length; i++) {
    // Cek kecocokan UUID (Kolom A / Index 0)
    if (String(rows[i][0]) === String(uuid)) { 
      
      // 1. Cek Status Saat Ini
      if (rows[i][12] === 'Approved' || rows[i][12] === 'Rejected') { 
        return { result: 'error', message: 'Data sudah diproses sebelumnya.' }; 
      }
      
      const waktuPengajuan = new Date(rows[i][1]);
      const waktuApproval = new Date();
      
      // 2. Update Status di Sheet Absensi (Lokal)
      const statusFinal = decision === 'approve' ? 'Approved' : 'Rejected';
      
      // Update Kolom M (Status), N (Approver), O (Waktu), Q (Alasan)
      sheet.getRange(i + 1, 13).setValue(statusFinal);
      sheet.getRange(i + 1, 14).setValue(approverName);
      sheet.getRange(i + 1, 15).setValue(waktuApproval);
      sheet.getRange(i + 1, 17).setValue(alasanAdmin || '-');
      
      // ============================================================
      // --- INTEGRASI UPDATE KE 3 LINK EXTERNAL (PERBAIKAN) ---
      // Hanya jalankan jika statusnya 'Approved'
      if (decision === 'approve') {
   // PERBAIKAN: Pastikan konversi String eksplisit agar sama persis dengan tes manual
   const userId = String(rows[i][2]).trim();      // Paksa jadi String & Trim spasi
   const tipeAbsen = String(rows[i][4]).trim();   // Paksa jadi String
   
   // Tanggal dari getValues() biasanya sudah Object Date, jadi aman langsung dikirim
   // Tapi jika format di sheet teks, new Date() akan mengurusnya
   const tglMulai = rows[i][8];    
   const tglSelesai = rows[i][9]; 

   try {
     console.log("Mencoba Sync dari App: ID=" + userId + ", Tgl=" + tglMulai); // Log debug
     syncToExternalPayroll(userId, tglMulai, tglSelesai, tipeAbsen);
   } catch (errSync) {
     console.error("Gagal Sync External: " + errSync);
   }
}
      // ============================================================

      const userId = rows[i][2];
      const namaKaryawan = rows[i][3];
      const tipeAbsen = rows[i][4];
      const catatanUser = rows[i][6];
      
      // --- LOGIKA EMAIL ---
      if (CONST_HRD_EMAILS && CONST_HRD_EMAILS.length > 5) {
        const subject = `Status Pengajuan Absensi: ${statusFinal} - ${namaKaryawan}`;
        let body = `Halo,\n\nPengajuan absensi Anda telah di-${statusFinal} oleh ${approverName}.\n\n`;
        body += `Detail:\n`;
        body += `Nama: ${namaKaryawan}\n`;
        body += `Tipe: ${tipeAbsen}\n`;
        body += `Alasan Admin: ${alasanAdmin || '-'}\n\n`;
        body += `Terima kasih.`;
        
        try {
           // Kirim email ke User (jika email user ada di data userSheet - logika ini opsional tergantung setup Anda)
           // MailApp.sendEmail(emailUser, subject, body); 
        } catch (e) {
          console.log("Gagal kirim email: " + e);
        }
      }

      // --- LOGIKA POTONG CUTI (JIKA ADA) ---
      if (decision === 'approve' && (tipeAbsen === 'CUTI' || tipeAbsen === 'CUTI TAHUNAN')) {
         potongCutiUser(userId, rows[i][8], rows[i][9]);
      }

      return { result: 'success', message: `Berhasil ${decision}` };
    }
  }
  return { result: 'error', message: 'Data tidak ditemukan.' };
}

// --- EMAIL RESPONSE UI ---

// [GANTI] Update fungsi handleEmailAction dengan logika pencarian Nama Pimpinan
function handleEmailAction(e) {
  const uuid = e.parameter.uuid;
  const action = e.parameter.action;
  const reasonParam = e.parameter.reason;

  // --- 1. CARI NAMA PIMPINAN (APPROVER) ---
  let pimpinanName = "Pimpinan"; // Default jika tidak ketemu
  
  try {
    const sheetAbsen = SS.getSheetByName(SHEET_ABSENSI);
    const rowsAbsen = sheetAbsen.getDataRange().getValues();
    let userId = "";

    // A. Cari User ID dari UUID Absensi
    for (let i = 1; i < rowsAbsen.length; i++) {
      if (String(rowsAbsen[i][0]) === String(uuid)) {
        userId = rowsAbsen[i][2]; // Ambil User ID Pemohon
        break;
      }
    }

    // B. Cari Email Atasan dari User ID tersebut
    if (userId) {
      const sheetUsers = SS.getSheetByName(SHEET_USERS);
      const rowsUsers = sheetUsers.getDataRange().getValues();
      let emailAtasan = "";

      for (let j = 1; j < rowsUsers.length; j++) {
        if (String(rowsUsers[j][0]) === String(userId)) {
          emailAtasan = rowsUsers[j][12]; // Ambil Email Atasan (Kolom 13/Index 12)
          break;
        }
      }

      // C. Jika Email Atasan ketemu, coba cari Nama pemilik email tersebut di Sheet Users
      // (Asumsi: Pimpinan juga terdaftar sebagai user dengan email/username tersebut)
      if (emailAtasan) {
        // Default gunakan email jika nama tidak ketemu
        pimpinanName = emailAtasan; 
        
        for (let k = 1; k < rowsUsers.length; k++) {
          // Cek apakah Email Atasan cocok dengan Username (jika username=email) 
          // atau Anda bisa sesuaikan jika ada kolom email khusus.
          // Disini kita cek comot nama jika username/email cocok.
          if (String(rowsUsers[k][1]).toLowerCase() === String(emailAtasan).toLowerCase()) {
            pimpinanName = rowsUsers[k][3]; // Ambil Nama Pimpinan
            break;
          }
        }
      }
    }
  } catch (err) {
    console.log("Gagal mencari nama pimpinan: " + err);
  }

  // Format Nama Approver Baru
  const approverLabel = `Via Email - ${pimpinanName}`;
  // ----------------------------------------

  // --- LOGIKA REJECT FORM ---
  if (action === 'reject_via_email' && !reasonParam) {
      return createRejectForm(uuid);
  }

  const decision = action === 'approve_via_email' ? 'approve' : 'reject';
  
  let finalReason = "Diproses melalui Link Email";
  if (decision === 'reject' && reasonParam) {
      finalReason = reasonParam;
  }
  
  // Masukkan approverLabel ke fungsi process logic
  const result = processApprovalLogic(uuid, decision, approverLabel, finalReason);

  // --- TAMPILAN HTML ---
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f3f4f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; padding: 20px; }
          .card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); text-align: center; max-width: 400px; width: 100%; border: 1px solid #e5e7eb; }
          .icon-box { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
          .success { background-color: #ecfdf5; color: #059669; }
          .error { background-color: #fef2f2; color: #dc2626; }
          h1 { font-size: 24px; font-weight: 800; margin: 0 0 10px; color: #1f2937; }
          p { color: #6b7280; font-size: 16px; line-height: 1.6; margin: 0; }
          .status-badge { display: inline-block; margin-top: 15px; padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; }
          .status-approve { background-color: #d1fae5; color: #065f46; border: 1px solid #10b981; }
          .status-reject { background-color: #fee2e2; color: #991b1b; border: 1px solid #ef4444; }
          .footer { margin-top: 30px; font-size: 12px; color: #9ca3af; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-box ${result.result === 'success' ? 'success' : 'error'}">
             ${result.result === 'success' 
               ? '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
               : '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
             }
          </div>
          <h1>${result.result === 'success' ? 'Keputusan Tercatat' : 'Info'}</h1>
          <p>${result.message}</p>
          ${result.result === 'success' ? `
            <div style="margin-top:20px;">
              <span class="status-badge ${decision === 'approve' ? 'status-approve' : 'status-reject'}">
                 ${decision.toUpperCase()}ED
              </span>
              ${decision === 'reject' ? `<p style="margin-top:10px; font-size:12px; font-style:italic;">"${finalReason}"</p>` : ''}
              <p style="margin-top:15px; font-size:11px; color:#9ca3af;">Oleh: ${approverLabel}</p>
            </div>
          ` : ''}
          <div class="footer">Anda dapat menutup halaman ini sekarang.<br>E-Absensi System</div>
        </div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(htmlContent).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// [TAMBAHAN] Fungsi baru untuk menampilkan Form Input Alasan Reject
function createRejectForm(uuid) {
  const scriptUrl = ScriptApp.getService().getUrl();
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; padding: 20px; }
          .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1); width: 100%; max-width: 400px; }
          h2 { margin-top: 0; color: #111827; text-align: center; }
          p { color: #6b7280; text-align: center; font-size: 14px; margin-bottom: 20px; }
          textarea { width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box; min-height: 100px; margin-bottom: 20px; outline: none; transition: border-color 0.2s; }
          textarea:focus { border-color: #ef4444; ring: 2px solid #fee2e2; }
          button { width: 100%; background-color: #ef4444; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: background-color 0.2s; }
          button:hover { background-color: #dc2626; }
          .cancel { background-color: white; color: #6b7280; border: 1px solid #d1d5db; margin-top: 10px; }
          .cancel:hover { background-color: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="text-align:center; margin-bottom:15px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          </div>
          <h2>Konfirmasi Penolakan</h2>
          <p>Silakan masukkan alasan penolakan untuk pengajuan ini.</p>
          
          <form action="${scriptUrl}" method="GET">
            <input type="hidden" name="action" value="reject_via_email">
            <input type="hidden" name="uuid" value="${uuid}">
            <textarea name="reason" placeholder="Alasan penolakan..." required></textarea>
            <button type="submit">Kirim Penolakan</button>
          </form>
        </div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// [UPDATE] Tambahkan parameter 'alasanReject' di akhir
function kirimEmailKonfirmasiPimpinan(email, decision, nama, waktu, durasi, tipe, jamMulai, jamSelesai, namaApprover, catatanUser, periodeDisplay, alasanReject) {
  try {
    const isApprove = decision === 'approve';
    const headerColor = isApprove ? '#10b981' : '#ef4444'; 
    const statusText = isApprove ? 'DISETUJUI (APPROVED)' : 'DITOLAK (REJECTED)';
    const icon = isApprove ? '✅' : '❎';
    let waktuDisplay = formatDateTimeFull(waktu);

    // Tampilan Jam (Opsional)
    let jamDisplay = "";
    if (jamMulai && jamMulai !== '-' && jamSelesai && jamSelesai !== '-') {
       jamDisplay = `
         <tr>
           <td style="color: #64748b; padding: 5px 0;">Jam Pilihan</td>
           <td style="font-weight: bold; text-align: right; color: #2563eb;">${jamMulai} - ${jamSelesai}</td>
         </tr>
       `;
    }

    // --- LOGIKA BARU: TAMPILKAN ALASAN JIKA REJECT ---
    let rowAlasan = "";
    if (!isApprove && alasanReject && alasanReject !== '-') {
        rowAlasan = `
        <tr style="background-color: #fef2f2;">
            <td style="color: #dc2626; padding: 10px 5px; font-weight:bold; border-top: 1px dashed #fca5a5; border-bottom: 1px dashed #fca5a5;">Alasan Penolakan</td>
            <td style="color: #dc2626; padding: 10px 5px; font-style: italic; text-align: right; border-top: 1px dashed #fca5a5; border-bottom: 1px dashed #fca5a5;">
                "${alasanReject}"
            </td>
        </tr>`;
    }
    // --------------------------------------------------

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background-color: ${headerColor}; padding: 20px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Konfirmasi Keputusan</h2>
        </div>
        <div style="padding: 25px;">
          <p style="text-align:center; font-size: 16px; margin-bottom: 20px;">Keputusan Anda telah berhasil dicatat oleh sistem.</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px;">
             <table style="width: 100%; font-size: 14px;">
               <tr><td style="color: #64748b; padding: 5px 0;">Karyawan</td><td style="font-weight: bold; text-align: right;">${nama}</td></tr>
               <tr><td style="color: #64748b; padding: 5px 0;">Form</td><td style="font-weight: bold; text-align: right;">${tipe}</td></tr>
               <tr><td style="color: #64748b; padding: 5px 0;">Tanggal</td><td style="font-weight: bold; text-align: right;">${periodeDisplay}</td></tr>

               ${jamDisplay}

               <tr><td style="color: #64748b; padding: 5px 0; vertical-align: top;">Keterangan</td><td style="font-style: italic; text-align: right;">"${catatanUser || '-'}"</td></tr>

               <tr><td style="border-top: 1px dashed #cbd5e1; padding: 10px 0 5px 0; color: #64748b;">Keputusan</td><td style="border-top: 1px dashed #cbd5e1; padding: 10px 0 5px 0; font-weight: bold; color: ${headerColor}; text-align: right;">${statusText} ${icon}</td></tr>
               
               ${rowAlasan} <tr><td style="color: #64748b; padding: 5px 0;">Disetujui Oleh</td><td style="font-weight: bold; text-align: right;">${namaApprover || 'System'}</td></tr>
               <tr><td style="color: #64748b; padding: 5px 0;">Waktu Approval</td><td style="text-align: right;">${waktuDisplay}</td></tr>
             </table>
          </div>
          <p style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 25px;">Terima kasih atas respon Anda (Durasi: ${durasi}).</p>
        </div>
      </div>
    `;
    
    MailApp.sendEmail({ to: email, subject: `[KONFIRMASI] Info Keputusan ${decision.toUpperCase()} - ${nama}`, htmlBody: htmlBody });
  } catch (e) { console.log("Gagal kirim email konfirmasi: " + e.toString()); }
}

// ==========================================
// 6. FITUR SHIFT SCHEDULE (LENGKAP)
// ==========================================

// 1. UPDATE FUNGSI GET HISTORY (Agar menyertakan Divisi untuk Laporan Tally)
function handleGetHistory(data) {
  const sheetAbsen = SS.getSheetByName(SHEET_ABSENSI);
  const rowsAbsen = sheetAbsen.getDataRange().getValues();
  const sheetUser = SS.getSheetByName(SHEET_USERS);
  const rowsUser = sheetUser.getDataRange().getValues();
  
  // Mapping User Data (Index 4 = Divisi, Index 7 = NoPayroll/ID Akun)
  const userMap = {};
  for (let u = 1; u < rowsUser.length; u++) {
    userMap[String(rowsUser[u][0])] = {
      noPayroll: rowsUser[u][7] || '-',
      nama: rowsUser[u][3],
      divisi: rowsUser[u][4] || '-', // Ambil Divisi
      lokasi: rowsUser[u][13] || '' 
    };
  }

  const history = [];
  const requestorLokasi = data.requestorLokasi || 'All';
  
  const isTargeted = (idToCheck) => {
    if (data.canViewAll && data.targetUserIds && Array.isArray(data.targetUserIds)) {
      if (data.targetUserIds.length > 0) return data.targetUserIds.includes(String(idToCheck));
      return true; 
    }
    return String(idToCheck) === String(data.userId);
  };

  for (let i = rowsAbsen.length - 1; i >= 1; i--) {
    const rowUserId = String(rowsAbsen[i][2]);
    const userData = userMap[rowUserId] || { noPayroll: '-', nama: rowsAbsen[i][3], divisi: '-', lokasi: '' };
    
    if (data.canViewAll && (!userData.lokasi || userData.lokasi === '')) continue;

    if (isTargeted(rowUserId)) {
      if (data.canViewAll && requestorLokasi !== 'All') {
         if (String(userData.lokasi).toLowerCase() !== String(requestorLokasi).toLowerCase()) continue;
      }

      history.push({
        uuid: rowsAbsen[i][0],
        waktu: rowsAbsen[i][1],
        userId: rowUserId,
        nama: userData.nama,
        noPayroll: userData.noPayroll, // ID AKUN
        divisi: userData.divisi,       // POSISI BAGIAN
        tipe: rowsAbsen[i][4],
        lokasi: rowsAbsen[i][5],
        catatan: rowsAbsen[i][6],
        foto: rowsAbsen[i][7],
        tglMulai: rowsAbsen[i][8],
        tglSelesai: rowsAbsen[i][9],
        jamMulai: rowsAbsen[i][10],
        jamSelesai: rowsAbsen[i][11],
        status: rowsAbsen[i][12] || 'Pending',
        approver: rowsAbsen[i][13] || '-',
        approvalTime: rowsAbsen[i][14] || '-',
        lampiran: rowsAbsen[i][15] || '-',
        alasan: rowsAbsen[i][16] || '-',
        idAkun: rowsAbsen[i][21] || '-' // Backup jika ada di kolom history
      });
    }
    if (!data.canViewAll && history.length >= 50) break;
    if (data.canViewAll && history.length >= 500) break;
  }
  return responseJSON({ result: 'success', history: history });
}

// 2. UPDATE FUNGSI GET SHIFT HISTORY (Join Data User untuk ID Akun & Divisi)
function handleGetShiftHistory(data) {
  const sheet = SS.getSheetByName(SHEET_RUNNING_SHIFT);
  if (!sheet) return responseJSON({ result: 'success', data: [] });
  
  // Ambil data User untuk join (ID Akun & Divisi)
  const sheetUser = SS.getSheetByName(SHEET_USERS);
  const rowsUser = sheetUser.getDataRange().getValues();
  const userMap = {};
  for (let u = 1; u < rowsUser.length; u++) {
    // Map UserID -> { noPayroll, divisi }
    userMap[String(rowsUser[u][0])] = {
      noPayroll: rowsUser[u][7] || '-',
      divisi: rowsUser[u][4] || '-'
    };
  }

  const values = sheet.getDataRange().getValues();
  const resultList = [];
  
  const reqUserId = String(data.userId);
  const userRole = data.role ? String(data.role).toLowerCase() : '';
  const canViewAll = ['admin', 'hrd', 'manager'].includes(userRole);

  for (let i = 1; i < values.length; i++) {
    const rowUserId = String(values[i][2]);
    let include = false;

    if (canViewAll) {
      include = true;
    } else {
      if (rowUserId === reqUserId) include = true;
    }

    if (include) {
      const uData = userMap[rowUserId] || { noPayroll: '-', divisi: '-' };
      
      resultList.push({
        uuid: values[i][0],
        waktuInput: values[i][1],
        userId: rowUserId,
        nama: values[i][3],
        tanggal: values[i][4],
        shiftValue: values[i][5],
        shiftLabel: values[i][6],
        idAkun: uData.noPayroll, // Field Baru
        divisi: uData.divisi     // Field Baru
      });
    }
  }

  // Sort Descending by Tanggal
  resultList.sort(function(a, b) {
    return new Date(b.tanggal) - new Date(a.tanggal);
  });
  
  return responseJSON({ result: 'success', data: resultList });
}

// --- B. DELETE SHIFT (Validasi 1 Jam) ---
function handleDeleteShiftSchedule(data) {
  const sheet = SS.getSheetByName(SHEET_RUNNING_SHIFT);
  const rows = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.uuid)) {
        // Validasi Waktu 1 Jam
        const entryTime = new Date(rows[i][1]);
        const diffHours = (now - entryTime) / (1000 * 60 * 60);
        if (diffHours > 1) {
            return responseJSON({ result: 'error', message: 'Gagal Hapus: Batas waktu 1 jam sudah lewat.' });
        }
        
        sheet.deleteRow(i + 1);
        return responseJSON({ result: 'success', message: 'Data shift dihapus.' });
    }
  }
  return responseJSON({ result: 'error', message: 'Data tidak ditemukan.' });
}

// --- C. EDIT SHIFT (Validasi 1 Jam) ---
function handleEditShiftSchedule(data) {
  const sheet = SS.getSheetByName(SHEET_RUNNING_SHIFT);
  const rows = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.uuid)) {
        // Validasi Waktu 1 Jam
        const entryTime = new Date(rows[i][1]);
        const diffHours = (now - entryTime) / (1000 * 60 * 60);
        if (diffHours > 1) {
            return responseJSON({ result: 'error', message: 'Gagal Edit: Batas waktu 1 jam sudah lewat.' });
        }

        // Update Kolom (Tanggal:E/Idx 4, Value:F/Idx 5, Label:G/Idx 6)
        sheet.getRange(i + 1, 5).setValue(data.tanggal);
        sheet.getRange(i + 1, 6).setValue(data.shiftValue);
        sheet.getRange(i + 1, 7).setValue(data.shiftLabel);
        
        return responseJSON({ result: 'success', message: 'Jadwal shift berhasil diperbarui.' });
    }
  }
  return responseJSON({ result: 'error', message: 'Data tidak ditemukan.' });
}

// --- D. SUBMIT BARU (Create) ---
function handleSubmitShiftSchedule(data) {
  let sheet = SS.getSheetByName(SHEET_RUNNING_SHIFT);
  if (!sheet) {
    sheet = SS.insertSheet(SHEET_RUNNING_SHIFT);
    sheet.appendRow(['UUID', 'Waktu Input', 'User ID', 'Nama', 'Tanggal Shift', 'Jam Kerja (Value)', 'Label Shift']);
    sheet.setFrozenRows(1);
  }

  const uuid = Utilities.getUuid();
  const waktuInput = new Date();
  if (!data.userId || !data.tanggal || !data.shiftValue) {
    return responseJSON({ result: 'error', message: 'Data tidak lengkap.' });
  }

  // --- [UPDATE LOGIKA] CEK DUPLIKASI DAN LOCK ---
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const rowUserId = String(rows[i][2]);
    const rowDate = formatDateYMD(rows[i][4]); 
    const inputDate = data.tanggal; 

    // Jika User sama DAN Tanggal sama
    if (rowUserId === String(data.userId) && rowDate === inputDate) {
      
      // Cek apakah data lama sudah terkunci (> 1 Jam)
      const entryTime = new Date(rows[i][1]);
      const now = new Date();
      const diffHours = (now - entryTime) / (1000 * 60 * 60);

      if (diffHours > 1) {
          // Jika sudah > 1 jam, TOLAK update
          return responseJSON({ 
            result: 'error', 
            message: 'GAGAL: Jadwal tanggal ini sudah terkunci (Input > 1 jam lalu). Tidak bisa diubah.' 
          });
      }

      // Jika masih < 1 jam, boleh di-overwrite (Update)
      sheet.getRange(i + 1, 6).setValue(data.shiftValue);
      sheet.getRange(i + 1, 7).setValue(data.shiftLabel);
      // Update waktu input agar timer 1 jam reset (opsional, jika ingin perpanjang waktu edit)
      sheet.getRange(i + 1, 2).setValue(waktuInput); 
      
      return responseJSON({ result: 'success', message: 'Jadwal shift tanggal ini diperbarui.' });
    }
  }
  // --- [AKHIR UPDATE] ---

  try {
    sheet.appendRow([
      uuid, 
      waktuInput, 
      data.userId, 
      data.nama, 
      data.tanggal,    
      data.shiftValue, 
      data.shiftLabel  
    ]);
    return responseJSON({ result: 'success', message: 'Jadwal shift berhasil disimpan!' });
  } catch (e) {
    return responseJSON({ result: 'error', message: 'Gagal simpan ke sheet: ' + e.toString() });
  }
}

// --- HELPER FUNCTIONS ---
function getFolder() { const folders = DriveApp.getFoldersByName(FOLDER_NAME); return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
function responseJSON(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function formatDate(d){ try { return new Date(d).toLocaleDateString('id-ID'); } catch(e){return d;} }
function hitungDurasi(start, end) { const diff = Math.abs(end - start); const minutes = Math.floor(diff / 60000); return `${minutes} Menit`; }
function formatDateYMD(dateInput) { try { const d = new Date(dateInput); if (isNaN(d.getTime())) return dateInput; const year = d.getFullYear(); const month = ('0' + (d.getMonth() + 1)).slice(-2); const day = ('0' + d.getDate()).slice(-2); return `${year}-${month}-${day}`; } catch (e) { return ''; } }

//---POP UP INFO HRD--//
function handleGetLatestAnnouncement() {
  const sheet = SS.getSheetByName(SHEET_ANNOUNCEMENTS);
  // Jika sheet tidak ditemukan, return null
  if (!sheet) return responseJSON({ result: 'success', data: null });

  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return responseJSON({ result: 'success', data: null });

  // Loop dari bawah (terbaru)
  // Kolom D (Index 3) adalah Status
  for (let i = rows.length - 1; i >= 1; i--) {
    const statusRaw = rows[i][3];
    // Bersihkan data: ubah ke string, hapus spasi, ubah ke huruf kecil
    const status = String(statusRaw).trim().toLowerCase();

    // Cek apakah status mengandung kata 'active' atau 'aktif'
    if (status === 'active' || status === 'aktif') {
      return responseJSON({
        result: 'success',
        data: {
          waktu: formatDate(rows[i][1]), // Kolom B
          isi: rows[i][2]                // Kolom C
        }
      });
    }
  }
  return responseJSON({ result: 'success', data: null });
}

// Fungsi Helper Pemroses Data
function processAnnouncementData(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return responseJSON({ result: 'success', data: null });

  // Loop dari baris paling bawah (Terbaru) ke atas
  for (let i = rows.length - 1; i >= 1; i--) {
    // KOLOM D = Index 3 (A=0, B=1, C=2, D=3)
    // Kita ambil data kolom D, ubah ke string, hapus spasi, kecilkan huruf
    const statusRaw = rows[i][3]; 
    const status = String(statusRaw).trim().toLowerCase(); 
    
    // Cek logika: apakah mengandung kata 'active' atau 'aktif'
    if (status.includes('active') || status.includes('aktif')) {
      return responseJSON({
        result: 'success',
        data: {
          waktu: formatDate(rows[i][1]), // Ambil Waktu dari Kolom B
          isi: rows[i][2]                // Ambil Isi dari Kolom C
        }
      });
    }
  }
  
  // Jika sampai atas tidak ada yang Active
  return responseJSON({ result: 'success', data: null });
}

function handleTambahAnnouncement(data) {
  if (data.roleRequester !== 'admin' && data.roleRequester !== 'hrd') {
    return responseJSON({ result: 'error', message: 'Akses Ditolak.' }); // [cite: 121]
  }
  
  const sheet = SS.getSheetByName(SHEET_ANNOUNCEMENTS);
  const uuid = Utilities.getUuid(); // [cite: 24]
  const waktu = new Date();
  
  sheet.appendRow([uuid, waktu, data.isi, 'Active']); // [cite: 44]
  return responseJSON({ result: 'success', message: 'Pengumuman berhasil diterbitkan.' });
}

// ==========================================
// 8. AUTO UPDATE TIMESTAMP (KHUSUS FORMULA)
// ==========================================

/**
 * Fungsi ini harus dipasang pada TRIGGER WAKTU (Time-Driven).
 * Mengecek apakah data di dbabsen berubah (hasil IMPORTRANGE/QUERY).
 * Jika berubah, update T1.
 */
function checkFormulaUpdates() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DB_ABSEN); [cite_start]// Menggunakan konstanta SHEET_DB_ABSEN [cite: 2]
    if (!sheet) return;

    // 1. Ambil Data Kolom A sampai S (Area Formula)
    // Kita ambil seluruh data yang ada (getDataRange) lalu potong sampai kolom S (19)
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return; // Tidak ada data (hanya header)

    // Ambil data dari baris 2 sampai bawah, kolom 1 (A) sampai 19 (S)
    const rangeData = sheet.getRange(2, 1, lastRow - 1, 19);
    const values = rangeData.getValues();

    // 2. Buat "Sidik Jari" (Hash) unik dari data saat ini
    // Ini mengubah seluruh data tabel menjadi satu string pendek
    const payload = JSON.stringify(values);
    const signature = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload);
    const currentHash = Utilities.base64Encode(signature);

    // 3. Bandingkan dengan Hash terakhir yang disimpan
    const props = PropertiesService.getScriptProperties();
    const lastHash = props.getProperty("LAST_DB_HASH");

    if (currentHash !== lastHash) {
      // --> DATA BERUBAH! (Ada update dari ImportRange)
      
      // Update Timestamp T1
      const now = new Date();
      sheet.getRange("T1").setValue(now);
      
      // Simpan Hash baru untuk pengecekan berikutnya
      props.setProperty("LAST_DB_HASH", currentHash);
      
      console.log("Data Formula Berubah. Timestamp T1 diupdate ke: " + now);
    } else {
      console.log("Tidak ada perubahan data.");
    }

  } catch (e) {
    console.error("Error checkFormulaUpdates: " + e.toString());
  }
}

// ==========================================
// FITUR BARU: MANAJEMEN USER (RESET PASSWORD)
// ==========================================

// 1. Ambil daftar user lengkap (UUID, Username/ID Fingerprint, Nama, Divisi)
function handleGetUserListAdmin(data) {
  // Validasi Security: Hanya Admin/HRD yang boleh akses
  const role = data.roleRequester ? String(data.roleRequester).toLowerCase() : '';
  if (role !== 'admin' && role !== 'hrd') {
    return responseJSON({ result: 'error', message: 'Akses Ditolak.' });
  }

  const sheet = SS.getSheetByName(SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  const list = [];

  // Mulai loop dari baris ke-2 (index 1) karena baris 1 adalah Header
  for (let i = 1; i < rows.length; i++) {
    list.push({
      uuid: rows[i][0],      // UUID
      username: rows[i][1],  // ID Fingerprint / Username
      nama: rows[i][3],      // Nama Lengkap
      divisi: rows[i][4],    // Divisi
      jabatan: rows[i][5]    // Role/Jabatan
    });
  }

  // Sortir berdasarkan Nama A-Z
  list.sort((a, b) => a.nama.localeCompare(b.nama));
  
  return responseJSON({ result: 'success', list: list });
}

// 2. Proses Reset Password menjadi "123"
function handleResetPasswordUser(data) {
  // Validasi Security
  const role = data.roleRequester ? String(data.roleRequester).toLowerCase() : '';
  if (role !== 'admin') {
    return responseJSON({ result: 'error', message: 'Hanya Admin yang boleh mereset password.' });
  }

  const targetUuid = data.targetUuid;
  const sheet = SS.getSheetByName(SHEET_USERS);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    // Cek jika UUID cocok (Kolom A / Index 0)
    if (String(rows[i][0]) === String(targetUuid)) {
      // Set Password (Kolom C / Index 2) menjadi "123"
      sheet.getRange(i + 1, 3).setValue("123"); 
      return responseJSON({ result: 'success', message: `Password untuk ${rows[i][3]} berhasil direset menjadi "123"` });
    }
  }

  return responseJSON({ result: 'error', message: 'User tidak ditemukan.' });
}

// [GANTI FUNCTION handleGetAnalysisData - UPDATE V18 (FIX MULTIPLE SCAN TIMES)]
function handleGetAnalysisData(data) {
  // 1. VALIDASI
  const role = data.roleRequester ? String(data.roleRequester).toLowerCase() : '';
  if (role !== 'admin' && role !== 'hrd') return responseJSON({ result: 'error', message: 'Akses Ditolak.' });

  // 2. DATA SOURCE
  const sheetAbsen = SS.getSheetByName(SHEET_ABSENSI);
  const rowsAbsen = sheetAbsen.getDataRange().getValues();
  
  const sheetDb = SS.getSheetByName(SHEET_DB_ABSEN);
  const rowsDb = sheetDb ? sheetDb.getDataRange().getValues() : [];
  
  const sheetUser = SS.getSheetByName(SHEET_USERS);
  const rowsUser = sheetUser.getDataRange().getValues();
  
  // 3. MAPPING USER
  const userMap = {};
  for (let i = 1; i < rowsUser.length; i++) {
    const uid = String(rowsUser[i][0]);
    userMap[uid] = {
      idAbsen: String(rowsUser[i][1]).trim(), // ID AKUN
      nik: String(rowsUser[i][7]).trim(),     // NIK
      nama: rowsUser[i][3],
      divisi: rowsUser[i][4]
    };
  }

  // 4. INDEXING MESIN (DENGAN PENGGABUNGAN JAM SCAN)
  const mesinMap = {};
  for (let i = 1; i < rowsDb.length; i++) {
    const rawId = rowsDb[i][2]; 
    if (!rawId) continue;
    
    // Key pencarian bisa NIK atau ID Absen (sesuaikan dengan isi sheet dbabsen Anda)
    // Di sini kita asumsikan Kolom C di dbabsen cocok dengan NIK User (sesuai history sebelumnya)
    const idMesin = String(rawId).trim(); 
    const dateKey = formatDateYMD_Strict(rowsDb[i][4]);
    if (!dateKey) continue;
    
    const symbol = String(rowsDb[i][14]).trim(); // Kolom O
    
    // [PERBAIKAN] Ambil semua jam, jangan dipotong
    const rawTime = rowsDb[i][17]; // Kolom R
    const scanStr = extractAllTimes_Backend(rawTime); // Helper Baru

    const mapKey = `${idMesin}_${dateKey}`;

    // LOGIKA PENGGABUNGAN (AGGREGATION)
    if (mesinMap[mapKey]) {
        // Jika data sudah ada (baris kedua dst untuk tanggal yg sama), gabungkan jamnya
        // Cek dulu apakah scanStr valid dan belum ada di data yang sudah tersimpan
        if (scanStr && scanStr !== '-' && !mesinMap[mapKey].waktu.includes(scanStr)) {
             // Jika data lama '-', ganti baru. Jika tidak, tambahkan koma.
             if (mesinMap[mapKey].waktu === '-') {
                 mesinMap[mapKey].waktu = scanStr;
             } else {
                 mesinMap[mapKey].waktu += ', ' + scanStr;
             }
        }
        // Update symbol jika yang baru ada isinya (prioritas yang tidak kosong)
        if (symbol && (!mesinMap[mapKey].symbol || mesinMap[mapKey].symbol === '-')) {
            mesinMap[mapKey].symbol = symbol;
        }

    } else {
        // Data Baru
        mesinMap[mapKey] = {
            symbol: symbol || '-',
            waktu: scanStr || '-'
        };
    }
  }

  // 5. CONFIG KATEGORI
  const CATEGORY_MAP = {
    'Hadir': ['H', 'T', 'Si', 'So', 'PC', 'TPC', 'SiPC', 'SiSo', 'TSi', 'TSo'],
    'Pulang': ['H', 'T', 'Si', 'So', 'PC', 'TPC', 'SiPC', 'SiSo', 'TSi', 'TSo'],
    'Standby': ['H', 'T', 'Si', 'So', 'PC', 'TPC'], 
    'Off (Tukar Shift)': ['O', 'OFF'], 
    'Tukar Shift': ['H', 'T', 'Si', 'So'], 
    'Lembur': ['L', 'SPL', 'H', 'T'],
    'Off': ['O', 'OFF'],
    'Sakit': ['S'], 'Ijin': ['I'], 'Cuti': ['C', 'CB'], 
    'Cuti EO': ['EO'], 'Dinas': ['DL'], 'Dinas Luar': ['DL'], 'Alpa': ['A', 'AC']
  };

  const resultList = [];
  const filterStart = data.startDate ? new Date(data.startDate) : null;
  if(filterStart) filterStart.setHours(0,0,0,0);
  const filterEnd = data.endDate ? new Date(data.endDate) : null;
  if(filterEnd) filterEnd.setHours(23,59,59,999);

  // 6. LOOPING DATA MANUAL
  for (let i = 1; i < rowsAbsen.length; i++) {
    const row = rowsAbsen[i];
    const uid = String(row[2]);
    const uData = userMap[uid];
    
    if (!uData || !uData.nik || uData.nik === '-') continue; 

    // Info Tanggal
    const tglPengajuanStr = formatDateDDMMYYYY(row[1]); 
    let startDateObj = new Date(row[1]); 
    if (row[8] && row[8] !== '-' && isValidDate(row[8])) startDateObj = new Date(row[8]);
    
    let endDateObj = new Date(startDateObj);
    if (row[9] && row[9] !== '-' && isValidDate(row[9])) endDateObj = new Date(row[9]);

    startDateObj.setHours(0,0,0,0);
    endDateObj.setHours(0,0,0,0);
    if (endDateObj.getTime() < startDateObj.getTime()) endDateObj = new Date(startDateObj);

    const diffTime = Math.abs(endDateObj - startDateObj);
    const durasiHari = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const durasiStr = `${durasiHari} Hari`;
    const periodeStr = `${formatDateDDMMYYYY(startDateObj)} s/d ${formatDateDDMMYYYY(endDateObj)}`;

    // LOOP PER HARI
    let currentDate = new Date(startDateObj);
    while (currentDate.getTime() <= endDateObj.getTime()) {
        if (filterStart && filterEnd) {
           if (currentDate.getTime() < filterStart.getTime() || currentDate.getTime() > filterEnd.getTime()) {
               currentDate.setDate(currentDate.getDate() + 1);
               continue;
           }
        }

        const dateKey = formatDateYMD_Strict(currentDate);
        
        // Lookup Mesin (Menggunakan NIK)
        const mesinData = mesinMap[`${uData.nik}_${dateKey}`];
        
        const symbolMesin = mesinData ? mesinData.symbol : '-';
        const waktuMesin = mesinData ? mesinData.waktu : '-';
        const tipeManual = String(row[4]).trim();

        // LOGIC MISMATCH
        let isMismatch = false;
        const allowedSymbols = CATEGORY_MAP[tipeManual] || [];

        if (!allowedSymbols.includes(symbolMesin)) {
             isMismatch = true;
        }

        if (isMismatch) {
            // [PERBAIKAN TAMPILAN WAKTU MESIN]
            // Urutkan waktu jika ada banyak biar rapi (opsional)
            let finalWaktu = waktuMesin;
            if (waktuMesin !== '-' && waktuMesin.includes(',')) {
                // Hapus duplikat dan urutkan
                let times = waktuMesin.split(',').map(s => s.trim()).filter(Boolean);
                times = [...new Set(times)].sort(); 
                finalWaktu = times.join(' '); // Pisahkan dengan spasi agar tidak terlalu lebar
            }

            resultList.push({
                uuid: row[0],
                idAkun: uData.idAbsen, 
                nik: uData.nik,        
                nama: uData.nama,
                divisi: uData.divisi,
                
                tglPengajuan: tglPengajuanStr,
                periode: periodeStr,
                durasi: durasiStr,
                tglKonflik: formatDateDDMMYYYY(currentDate), 
                
                tipeManual: tipeManual,
                simbolMesin: symbolMesin,
                waktuScan: finalWaktu, // Data Waktu Lengkap
                status: row[12] || 'Pending'
            });
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  resultList.sort((a, b) => b.tglPengajuan.localeCompare(a.tglPengajuan));
  return responseJSON({ result: 'success', list: resultList });
}


// =======================================================
// HELPER BARU: EXTRACT ALL TIMES (Hapus helper lama formatTimeOnly_Backend)
// =======================================================

// Fungsi ini akan mencari SEMUA pola jam (HH:mm) dalam sel
// Baik itu "08:00", "08:00, 17:00", atau Date Object
function extractAllTimes_Backend(val) {
  if (!val || val === '-') return '-';
  
  // 1. Jika Date Object (Hanya satu waktu)
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
  }

  // 2. Jika String atau Number
  const str = String(val);
  
  // Gunakan Regex untuk mencari pola angka:angka (contoh 08:00, 8:00, 17:30)
  // \d{1,2}:\d{2} artinya 1 atau 2 digit angka, titik dua, 2 digit angka
  const matches = str.match(/\d{1,2}:\d{2}/g);

  if (matches && matches.length > 0) {
    // Gabungkan semua yang ditemukan dengan koma
    // Contoh input: "Scan: 08:00 lalu 17:00" -> Output: "08:00, 17:00"
    return matches.join(', ');
  }

  // Jika tidak ketemu pola waktu tapi ada teks, return apa adanya (trimmed)
  // atau return '-' jika terlalu pendek
  return str.length > 2 ? str.trim() : '-';
}

function formatDateYMD_Strict(dateInput) {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } catch (e) { return ''; }
}

function formatDateDDMMYYYY(d) {
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return '-';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (e) { return '-'; }
}

// ==========================================
// HELPER FUNCTIONS (WAJIB ADA DI BAWAH)
// ==========================================

function isValidDate(d) {
  if (!d) return false;
  const date = new Date(d);
  return !isNaN(date.getTime());
}

// Helper Format Tanggal Strict (YYYY-MM-DD)
// Penting untuk mencocokkan tanggal mesin yang mungkin ada jamnya
function formatDateYMD_Strict(dateInput) {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } catch (e) {
    return '';
  }
}

// Helper Format Jam (HH:mm) untuk Kolom R
function formatTimeOnly_Backend(val) {
  if (!val || val === '-' || val === '') return '-';
  
  // Jika Date Object
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
  }
  
  // Jika String (misal "08:00:00")
  const str = String(val).trim();
  if (str.includes(':')) {
    return str.substring(0, 5); // Ambil 5 karakter pertama
  }
  return str;
}


// ==========================================
// FITUR: EDIT & DELETE DATA ABSENSI MANUAL
// ==========================================

// 1. HAPUS DATA
function handleDeleteAbsensi(data) {
  if (data.roleRequester !== 'admin') return responseJSON({ result: 'error', message: 'Akses Ditolak.' });

  const targetUuid = data.uuid;
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  const rows = sheet.getDataRange().getValues();
  
  // Loop cari UUID (Kolom C / Index 2)
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === String(targetUuid)) {
      sheet.deleteRow(i + 1); // Hapus Baris
      return responseJSON({ result: 'success', message: 'Data berhasil dihapus.' });
    }
  }
  return responseJSON({ result: 'error', message: 'Data tidak ditemukan.' });
}

// 2. UPDATE DATA (GANTI TIPE ABSEN)
function handleUpdateAbsensi(data) {
  if (data.roleRequester !== 'admin') return responseJSON({ result: 'error', message: 'Akses Ditolak.' });

  const targetUuid = data.uuid;
  const newType = data.newType; // Tipe baru (misal ganti dari Sakit ke Ijin)
  
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === String(targetUuid)) {
      // Update Kolom E (Index 4) -> Tipe Absen
      sheet.getRange(i + 1, 5).setValue(newType);
      return responseJSON({ result: 'success', message: 'Data berhasil diupdate.' });
    }
  }
  return responseJSON({ result: 'error', message: 'Data tidak ditemukan.' });
}

// HELPER FORMAT DATE (STANDAR ISO UNTUK IPHONE)
function formatDateYMD(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal); // Jika text, kembalikan text
  
  // Format ke YYYY-MM-DD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// HELPER FORMAT DATE + TIME
function formatDate(dateVal) {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  
  // Format ke YYYY-MM-DD HH:mm:ss
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// HELPER FORMAT JAM SIMPLE (HH:mm)
function formatTimeSimple(val) {
  if (!val || val === '-' || val === '') return '-';
  if (val instanceof Date) {
     let h = val.getHours().toString().padStart(2, '0');
     let m = val.getMinutes().toString().padStart(2, '0');
     return `${h}:${m}`;
  }
  // Jika string, kembalikan apa adanya (atau potong 5 char pertama)
  return String(val).substring(0, 5);
}

// FORMAT TANGGAL + JAM (DD-MM-YYYY HH:mm)
function formatDateTimeFull(d) {
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return d;
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    const h = String(dateObj.getHours()).padStart(2, '0');
    const m = String(dateObj.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${h}:${m}`;
  } catch (e) { return d; }
}

// Helper 1: Memformat Jam (08:00)
function formatJam(val) {
  if (!val || val === '-' || val === '') return '-';
  // Jika formatnya object Date (dari Sheet)
  if (Object.prototype.toString.call(val) === '[object Date]') {
    let h = val.getHours().toString().padStart(2, '0');
    let m = val.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
  // Jika format string, ambil 5 karakter pertama
  return String(val).substring(0, 5);
}

// Helper 2: Memformat Tanggal + Jam (24/12/2025 Pukul 14:30)
function formatDateTimeFull(d) {
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return d;
    
    // Format Tanggal
    const datePart = dateObj.toLocaleDateString('id-ID'); 
    // Format Jam
    const h = dateObj.getHours().toString().padStart(2, '0');
    const m = dateObj.getMinutes().toString().padStart(2, '0');
    
    return `${datePart} | ${h}:${m}`;
  } catch (e) { return d; }
}

// --- TAMBAHAN HELPER: FORMAT TANGGAL DD-MM-YYYY ---
function formatDateStrict(d) {
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return d;
    
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    
    return `${day}-${month}-${year}`;
  } catch (e) { return d; }
}

// --- HELPER TAMBAHAN: formatDateDDMMYYYY ---
function formatDateDDMMYYYY(d) {
  try {
    const dateObj = new Date(d);
    // Cek validitas tanggal
    if (isNaN(dateObj.getTime())) return d;
    
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    
    return `${day}-${month}-${year}`;
  } catch (e) { 
    return d; 
  }
}

// --- HELPER: Parse Jam ke Menit (Pastikan fungsi ini ada di paling bawah script) ---
function parseTimeToMinutes(timeStr) {
    if (!timeStr || timeStr === '-' || timeStr === 'FALSE') return 0;
    
    // Jika format Date Object
    if (Object.prototype.toString.call(timeStr) === '[object Date]') {
        return (timeStr.getHours() * 60) + timeStr.getMinutes();
    }
    
    // Jika format String "00:15:00"
    if (String(timeStr).includes(':')) {
        const parts = String(timeStr).split(':');
        const h = parseInt(parts[0]) || 0;
        const m = parseInt(parts[1]) || 0;
        return (h * 60) + m;
    }
    return 0;
}

// HELPER FORMAT DATE + TIME (Fixed: DD-MM-YYYY HH:MM)
function formatDate(dateVal) {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  
  // Format Baru: Tanggal-Bulan-Tahun Jam:Menit
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`; 
}

// --- HELPER VALIDASI DATE (Tambahkan di paling bawah script) ---
function isValidDate(d) {
  if (!d) return false;
  const date = new Date(d);
  return !isNaN(date.getTime());
}

// Pastikan juga helper ini sudah ada:
function formatDateDDMMYYYY(d) {
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return '-';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (e) { return '-'; }
}

// ==========================================
// HELPER FUNCTIONS (Wajib Ditambahkan di Bawah)
// ==========================================

// 1. Helper Format Tanggal Strict (YYYY-MM-DD)
// Ini memastikan tanggal mesin (yang mungkin ada jamnya) tetap terbaca benar
function formatDateYMD_Strict(dateInput) {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    // Gunakan Utilities.formatDate agar sesuai Timezone Script (Jakarta/Bangkok biasanya GMT+7)
    // Format harus sama persis dengan yang dihasilkan loop manual
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } catch (e) {
    return '';
  }
}

// 2. Helper Format Jam (HH:mm) untuk Kolom R
function formatTimeOnly_Backend(val) {
  if (!val || val === '-' || val === '') return '-';
  
  // Jika value adalah Date Object (biasanya di Google Sheet format Time = Date Object)
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
  }
  
  // Jika string (misal '08:00:00')
  const str = String(val).trim();
  if (str.includes(':')) {
    // Ambil HH:mm saja (5 karakter pertama)
    return str.substring(0, 5);
  }
  
  return str;
}

// ==========================================
// TRIGGER EDIT MANUAL (AUTO TIMESTAMP)
// ==========================================
function onEdit(e) {
  if (!e) return;
  
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  
  // Hanya jalankan jika sheet yang diedit adalah 'dbabsen'
  if (sheetName === "dbabsen") {
    const range = e.range;
    const row = range.getRow();
    const col = range.getColumn();
    
    // Kolom T adalah kolom ke-20
    const TIMESTAMP_COL_INDEX = 20; 

    // Syarat:
    // 1. Bukan baris Header (row > 1)
    // 2. Yang diedit BUKAN kolom timestamp itu sendiri (biar gak looping)
    if (row > 1 && col !== TIMESTAMP_COL_INDEX) {
      
      // Update Kolom T (20) dengan tanggal & jam sekarang
      sheet.getRange(row, TIMESTAMP_COL_INDEX).setValue(new Date());
    }
  }
}

// ==========================================
// HELPER: SYNC KE EXTERNAL SHEET (MULTI LINK)
// ==========================================
function syncToExternalPayroll(userId, startDate, endDate, tipeAbsen) {
  console.log("=== TRIGGER DARI APP ===");
  console.log("User ID (Raw): " + userId + " | Tipe: " + typeof userId);
  console.log("Tanggal (Raw): " + startDate + " | Tipe: " + typeof startDate);
  console.log("Absen (Raw): " + tipeAbsen);

  const symbol = getSymbolFromType(tipeAbsen);
  
  let currentDate = new Date(startDate);
  const lastDate = new Date(endDate);
  
  // Loop tanggal
  while (currentDate <= lastDate) {
    // Clone tanggal agar tidak merubah referensi loop
    const dateToProcess = new Date(currentDate); 
    
    console.log(`[SYNC START] Mencari ID: "${userId}" | Tanggal: ${dateToProcess.toDateString()} | Simbol: ${symbol}`);
    
    EXTERNAL_TARGETS.forEach(target => {
      // Buka Spreadsheet
      let ss;
      try {
        ss = SpreadsheetApp.openById(target.id);
      } catch (e) {
        console.error(`[ERROR] Tidak bisa membuka Link ID: ${target.id}. Cek izin akses.`);
        return;
      }

      target.sheets.forEach(sheetName => {
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
          console.warn(`[SKIP] Sheet "${sheetName}" tidak ditemukan di file target.`);
          return; 
        }
        
        // Ambil Data & Header
        const data = sheet.getDataRange().getValues();
        if (data.length < 1) return;

        // Cari Index Kolom (Case Insensitive & Trim Spasi)
        // Kita ubah header jadi huruf besar semua & buang spasi ujung biar pencarian lebih mudah
        const headers = data[0].map(h => String(h).toUpperCase().trim());
        
        // Sesuaikan string pencarian dengan konstanta Anda
        const idxID = headers.indexOf(COL_HEADER_ID.toUpperCase().trim());
        const idxDate = headers.indexOf(COL_HEADER_DATE.toUpperCase().trim());
        const idxSymbol = headers.indexOf(COL_HEADER_SYMBOL.toUpperCase().trim());
        
        // DEBUG: Cek apakah kolom ditemukan
        if (idxID === -1 || idxDate === -1 || idxSymbol === -1) {
          console.warn(`[GAGAL] Di Sheet "${sheetName}", kolom tidak lengkap!`);
          console.warn(`Ditemukan: ${JSON.stringify(headers)}`);
          console.warn(`Dicari: ID="${COL_HEADER_ID}", Date="${COL_HEADER_DATE}", Symbol="${COL_HEADER_SYMBOL}"`);
          return;
        }

        // Loop Cari Data
        let isFound = false;
        for (let i = 1; i < data.length; i++) {
          const rowId = String(data[i][idxID]).trim(); // ID di Sheet External
          const rowDateRaw = data[i][idxDate];         // Tanggal di Sheet External

          // Cek ID & Tanggal
          if (rowId === String(userId).trim() && isSameDay(rowDateRaw, dateToProcess)) {
            // UPDATE NILAI
            sheet.getRange(i + 1, idxSymbol + 1).setValue(symbol);
            console.log(`[SUKSES] Update di Sheet "${sheetName}" Baris ${i+1}`);
            isFound = true;
          }
        }
        
        if (!isFound) {
          console.log(`[INFO] Data tidak ketemu di Sheet "${sheetName}" (Mungkin ID/Tanggal tdk ada di sana).`);
        }
      });
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

// Helper membandingkan 2 tanggal (lebih kuat menangani format text/date)
function isSameDay(rowValue, targetDate) {
  if (!rowValue || !targetDate) return false;
  
  // Konversi targetDate (dari input form) ke Object Date
  const dTarget = new Date(targetDate);
  
  // Coba parsing nilai dari Cell (rowValue)
  let dRow;
  if (rowValue instanceof Date) {
    dRow = rowValue;
  } else {
    // Jika text, coba parse
    dRow = new Date(rowValue);
  }

  // Jika gagal parse (Invalid Date), return false
  if (isNaN(dRow.getTime())) return false;

  // Bandingkan Tgl, Bulan, Tahun (abaikan jam)
  return dRow.getDate() === dTarget.getDate() &&
         dRow.getMonth() === dTarget.getMonth() &&
         dRow.getFullYear() === dTarget.getFullYear();
}

function TEST_MANUAL_SYNC() {
  // Ganti data ini dengan data CONTOH yang BENAR-BENAR ADA di Sheet Target (db_jakarta atau MST)
  const testID = "G0601"; // Masukkan ID Payroll yang ada di sheet target
  const testDate = "2026-01-19";  // Masukkan Tanggal yang ada di sheet target (format YYYY-MM-DD)

  // Jalankan fungsi
  syncToExternalPayroll(testID, testDate, testDate, "D");
}

// --- FUNGSI UPDATE STATUS (APPROVE/REJECT) ---
function handleUpdateStatusAbsen(data) {
  const sheet = SS.getSheetByName(SHEET_ABSENSI);
  if (!sheet) return responseJSON({ result: 'error', message: 'Sheet Absensi tidak ditemukan' });

  const uuid = data.uuid;
  const newStatus = data.status; // 'Approved' atau 'Rejected'
  const approverName = data.approverName || 'Admin';
  const now = new Date();

  // Cari baris berdasarkan UUID (Kolom A)
  // Kita cari manual biar aman
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  let rowIndex = -1;

  // Loop cari UUID (mulai baris ke-2, index 1)
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(uuid)) {
      rowIndex = i + 1; // Karena index array mulai 0, tapi baris sheet mulai 1
      break;
    }
  }

  if (rowIndex === -1) {
    return responseJSON({ result: 'error', message: 'Data ID tidak ditemukan.' });
  }

  // --- UPDATE KOLOM DI SHEET ---
  // Sesuaikan nomor kolom dengan layout sheet Anda:
  // Kolom A=1, B=2, ... M=13, N=14, O=15
  
  // 1. Update Status (Kolom M / ke-13)
  sheet.getRange(rowIndex, 13).setValue(newStatus);
  
  // 2. Update Approver (Kolom N / ke-14)
  sheet.getRange(rowIndex, 14).setValue(approverName);
  
  // 3. Update Waktu Approval (Kolom O / ke-15)
  // Format waktu agar rapi di sheet
  const formattedTime = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.getRange(rowIndex, 15).setValue(formattedTime);

  return responseJSON({ result: 'success', message: `Status berhasil diubah menjadi ${newStatus}` });
}