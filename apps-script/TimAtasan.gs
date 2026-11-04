// =====================================================================
// HISTORI ABSENSI TIM UNTUK ATASAN (4 Nov 2026)
//
// Atasan yang terdaftar di Master Tim Approval (sheet ApprovalTeams)
// membuka "Histori Tim" di beranda: laporan absensi (rekap + data harian)
// anggota timnya, LIHAT SAJA.
//
// Aksi `get_rekap_tim` (Auth.gs: tingkat approval). Tim ditentukan dari
// akun yang login (data._auth.u) — bukan dari kiriman klien:
//   1. anggota di ApprovalTeams dengan KepalaID = user ini;
//   2. bila belum punya tim di sana: karyawan se-divisi & se-lokasi
//      (aturan approval lama), kecuali dirinya sendiri.
// Datanya = get_rekap_admin yang disaring ke payroll anggota tim.
// =====================================================================

/** Anggota tim atasan. @return {{anggota: Object[], sumber: 'master'|'divisi'}} */
function timAtasan_(userId) {
  const id = String(userId || '').trim();
  const rows = bacaSheet(SS.getSheetByName(SHEET_USERS), 14);
  const peta = {};
  let saya = null;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const uid = String(r[0] || '').trim();
    if (!uid) continue;
    const u = {
      id: uid, username: String(r[1] || '').trim(), nama: String(r[3] || '').toUpperCase(),
      divisi: String(r[4] || ''), payroll: String(r[7] || '').trim().toUpperCase(), lokasi: String(r[13] || '')
    };
    peta[uid] = u;
    if (uid === id) saya = u;
  }

  const dariMaster = (typeof _ambilApprovalTeamAssignments === 'function' ? _ambilApprovalTeamAssignments() : [])
    .filter(function (a) { return a.kepalaId === id; });
  if (dariMaster.length) {
    const sudah = {};
    const anggota = [];
    dariMaster.forEach(function (a) {
      const u = peta[a.anggotaId];
      if (!u || sudah[u.id]) return;
      sudah[u.id] = true;
      anggota.push(Object.assign({ departemen: a.departemen || '' }, u));
    });
    return { anggota: anggota, sumber: 'master' };
  }

  if (!saya || !saya.divisi) return { anggota: [], sumber: 'divisi' };
  const anggota = Object.keys(peta).map(function (k) { return peta[k]; }).filter(function (u) {
    return u.id !== saya.id && u.divisi === saya.divisi && cocokLokasi_(saya.lokasi || 'All', u.lokasi);
  });
  return { anggota: anggota, sumber: 'divisi' };
}

function handleGetRekapTim(data) {
  const auth = data._auth || {};
  const tim = timAtasan_(auth.u);
  if (!tim.anggota.length) {
    return responseJSON({ result: 'error', message: 'Anda belum punya anggota tim. Minta Admin mendaftarkan tim Anda di Master Tim Approval.' });
  }
  const kunci = {};
  tim.anggota.forEach(function (u) {
    if (u.payroll) kunci[u.payroll] = true;
    if (u.username) kunci[u.username.toUpperCase()] = true;
  });
  const keluaran = handleGetRekapAdmin(data);
  let j;
  try { j = JSON.parse(keluaran.getContent()); } catch (e) { return keluaran; }
  if (!j || j.result !== 'success') return keluaran;
  const boleh = function (x) {
    if (!x) return false;
    const p = String(x.payroll || '').trim().toUpperCase();
    const a = String(x.noAkun || '').trim().toUpperCase();
    return (!!p && !!kunci[p]) || (!!a && !!kunci[a]);
  };
  j.rawRecords = (j.rawRecords || []).filter(boleh);
  j.dashboardData = (j.dashboardData || []).filter(boleh);
  j.koreksiList = [];   // koreksi admin tidak ditampilkan ke atasan
  // Nominal denda telat tidak untuk atasan.
  j.dashboardData.forEach(function (d) { delete d.nominalTerlambat; });
  j.rawRecords.forEach(function (r) { delete r.nominal; });
  j.tim = {
    sumber: tim.sumber,
    anggota: tim.anggota.map(function (u) { return { nama: u.nama, payroll: u.payroll, divisi: u.divisi, lokasi: u.lokasi, departemen: u.departemen || '' }; })
  };
  return ContentService.createTextOutput(JSON.stringify(j)).setMimeType(ContentService.MimeType.JSON);
}
