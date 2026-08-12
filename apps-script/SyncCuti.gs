// =======================================================
// SINKRONISASI OTOMATIS MASTER CUTI & ABSENSI
// File: SyncCuti.gs
// =======================================================

const SYNC_CONFIG = {
  SHEET_ABSENSI: "Absensi",
  SHEET_USERS: "Users",
  SHEET_MASTER: "MASTER-CUTI",
  COL_INDEX_MASTER_PAYROLL: 1, // Kolom B (Index 1) di MASTER-CUTI (No Payroll)
  COL_INDEX_MASTER_OUTPUT: 22, // Kolom W (Index 22) di MASTER-CUTI (Output Cuti Terpakai)
  STATUS_VALID: ["Approved"]   // Hanya hitung yang Approved
};

function syncTotalCuti() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetAbsen = ss.getSheetByName(SYNC_CONFIG.SHEET_ABSENSI);
  const sheetUser = ss.getSheetByName(SYNC_CONFIG.SHEET_USERS);
  const sheetMaster = ss.getSheetByName(SYNC_CONFIG.SHEET_MASTER);

  if (!sheetAbsen || !sheetUser || !sheetMaster) {
    console.error("Salah satu sheet tidak ditemukan!");
    return;
  }

  // 1. AMBIL DATA USERS (Mapping User ID -> No Payroll)
  // Asumsi: Users Kolom A = ID, Kolom H = No Payroll
  const dataUsers = sheetUser.getDataRange().getValues();
  const userPayrollMap = {}; // Key: UserID, Value: NoPayroll
  
  for (let i = 1; i < dataUsers.length; i++) {
    const userId = String(dataUsers[i][0]);
    const noPayroll = String(dataUsers[i][7]); // Index 7 = Kolom H
    if (userId && noPayroll) {
      userPayrollMap[userId] = noPayroll;
    }
  }

  // 2. HITUNG TOTAL CUTI DARI ABSENSI
  const dataAbsen = sheetAbsen.getDataRange().getValues();
  const payrollCutiCount = {}; // Key: NoPayroll, Value: TotalHari

  for (let i = 1; i < dataAbsen.length; i++) {
    const userId = String(dataAbsen[i][2]); // Kolom C = User ID
    const tipe = String(dataAbsen[i][4]);   // Kolom E = Tipe
    const status = String(dataAbsen[i][12]); // Kolom M = Status
    
    // Filter: Hanya tipe 'Cuti' dan Status 'Approved'
    if (tipe === 'Cuti' && SYNC_CONFIG.STATUS_VALID.includes(status)) {
      
      const noPayroll = userPayrollMap[userId];
      
      if (noPayroll) {
        // Hitung Durasi Hari
        const tglMulai = new Date(dataAbsen[i][8]);  // Kolom I
        const tglSelesai = new Date(dataAbsen[i][9]); // Kolom J
        
        let durasi = 0;
        if (!isNaN(tglMulai) && !isNaN(tglSelesai)) {
          // Set jam ke 0 agar hitungan hari akurat
          tglMulai.setHours(0,0,0,0);
          tglSelesai.setHours(0,0,0,0);
          
          const diffTime = Math.abs(tglSelesai - tglMulai);
          durasi = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
        } else {
          // Fallback jika tanggal kosong, anggap 1 hari
          durasi = 1;
        }

        // Akumulasi ke Map
        if (!payrollCutiCount[noPayroll]) {
          payrollCutiCount[noPayroll] = 0;
        }
        payrollCutiCount[noPayroll] += durasi;
      }
    }
  }

  // 3. UPDATE KE MASTER-CUTI
  const masterData = sheetMaster.getDataRange().getValues();
  // Loop mulai baris ke-2 (Index 1)
  for (let i = 1; i < masterData.length; i++) {
    const masterPayroll = String(masterData[i][SYNC_CONFIG.COL_INDEX_MASTER_PAYROLL]); // Ambil No Payroll (Kolom B)
    
    if (masterPayroll) {
      // Ambil nilai cuti terpakai dari hitungan (atau 0 jika tidak ada)
      const totalTerpakai = payrollCutiCount[masterPayroll] || 0;
      
      // Update Kolom W (Row index + 1 karena base-1, Column index + 1)
      // Kita cek dulu agar tidak overwrite jika nilai sama (hemat quota write)
      const currentValue = masterData[i][SYNC_CONFIG.COL_INDEX_MASTER_OUTPUT];
      
      if (currentValue != totalTerpakai) {
        sheetMaster.getRange(i + 1, SYNC_CONFIG.COL_INDEX_MASTER_OUTPUT + 1).setValue(totalTerpakai);
      }
    }
  }
  
  console.log("Sinkronisasi Cuti Selesai.");
}