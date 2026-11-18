
// ================================================================
// GEOFENCE ABSEN ONLINE
// ================================================================

function _normalisasiBooleanGeofence(value, defaultValue) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!text) return !!defaultValue;
  return ['ya', 'yes', 'true', '1', 'wajib', 'aktif', 'on'].indexOf(text) !== -1;
}

function _ambilKonfigurasiGeofence() {
  const sheet = SS.getSheetByName(SHEET_GEOFENCE);
  const map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  const rows = bacaSheet(sheet, GEOFENCE_HEADERS.length);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const userId = String(row[0] === null || row[0] === undefined ? '' : row[0]).trim();
    if (!userId) continue;
    if (!map[userId]) map[userId] = { required: false, areas: [] };
    map[userId].required = map[userId].required || _normalisasiBooleanGeofence(row[2], false);
    const lat = Number(row[4]);
    const lng = Number(row[5]);
    const radius = Number(row[6]);
    const aktif = _normalisasiBooleanGeofence(row[7], true);
    if (!aktif || !isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    map[userId].areas.push({
      nama: String(row[3] || 'Area kantor').trim() || 'Area kantor',
      lat: lat, lng: lng,
      radius: isFinite(radius) && radius > 0 ? Math.min(radius, 100000) : 150,
      aktif: true
    });
  }
  return map;
}

function _ambilGeofenceUser(userId) {
  const map = _ambilKonfigurasiGeofence();
  return map[String(userId)] || { required: false, areas: [] };
}

function _parseLokasiGps(lokasi) {
  const parts = String(lokasi === null || lokasi === undefined ? '' : lokasi).split(',');
  if (parts.length < 2) return null;
  const lat = Number(String(parts[0]).trim());
  const lng = Number(String(parts[1]).trim());
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: lat, lng: lng };
}

function _jarakMeter(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validasiGeofence(data) {
  const tipe = String(data.tipe || '').trim();
  if (['Hadir', 'Pulang'].indexOf(tipe) === -1) return { ok: true };
  const config = _ambilGeofenceUser(data.userId);
  if (!config.required) return { ok: true, required: false };
  if (!config.areas.length) return { ok: false, code: 'GEOFENCE_NOT_CONFIGURED', message: 'Absen ditolak: geofence Anda wajib, tetapi belum ada area kantor aktif. Hubungi Admin/HRD.' };
  const titik = _parseLokasiGps(data.lokasi);
  if (!titik) return { ok: false, code: 'GPS_REQUIRED', message: 'Lokasi GPS wajib diaktifkan untuk absen dari area yang ditentukan.' };
  let terdekat = null;
  for (let i = 0; i < config.areas.length; i++) {
    const area = config.areas[i];
    const jarak = _jarakMeter(titik.lat, titik.lng, area.lat, area.lng);
    if (!terdekat || jarak < terdekat.jarak) terdekat = { area: area, jarak: jarak };
    if (jarak <= area.radius) return { ok: true, required: true, area: area.nama, distance: Math.round(jarak) };
  }
  return { ok: false, code: 'OUTSIDE_GEOFENCE', message: 'Absen ditolak: Anda berada di luar area kantor yang diizinkan' + (terdekat ? ` (terdekat ${Math.round(terdekat.jarak)} m dari ${terdekat.area.nama}).` : '.') };
}

function _pastikanSheetGeofence() {
  let sheet = SS.getSheetByName(SHEET_GEOFENCE);
  if (!sheet) sheet = SS.insertSheet(SHEET_GEOFENCE);
  if (sheet.getLastRow() < 1 || sheet.getRange(1, 1, 1, GEOFENCE_HEADERS.length).getValues()[0].join('').trim() === '') sheet.getRange(1, 1, 1, GEOFENCE_HEADERS.length).setValues([GEOFENCE_HEADERS]);
  return sheet;
}

function handleGetGeofenceConfig(data) {
  const role = String(data.roleRequester || '').toLowerCase();
  if (role !== 'admin' && role !== 'hrd') return responseJSON({ result: 'error', message: 'Akses Ditolak.' });
  const rowsUsers = bacaSheet(SS.getSheetByName(SHEET_USERS), 6);
  const users = rowsUsers.slice(1).map(row => ({ id: row[0], username: row[1], nama: row[3], divisi: row[4], role: row[5] })).filter(u => u.id !== '' && u.id !== null && u.id !== undefined);
  return responseJSON({ result: 'success', users: users, configs: _ambilKonfigurasiGeofence() });
}

function handleSaveGeofenceConfig(data) {
  if (String(data.roleRequester || '').toLowerCase() !== 'admin') return responseJSON({ result: 'error', message: 'Hanya Admin yang boleh mengubah konfigurasi geofence.' });
  const userId = String(data.userId || '').trim();
  if (!userId) return responseJSON({ result: 'error', message: 'Karyawan belum dipilih.' });
  const userRows = bacaSheet(SS.getSheetByName(SHEET_USERS), 4);
  const userRow = userRows.slice(1).find(row => String(row[0]).trim() === userId);
  if (!userRow) return responseJSON({ result: 'error', message: 'Karyawan tidak ditemukan.' });
  const required = _normalisasiBooleanGeofence(data.required, false);
  const incomingAreas = Array.isArray(data.areas) ? data.areas : [];
  const areas = incomingAreas.map(area => ({ nama: String(area.nama || 'Area kantor').trim() || 'Area kantor', lat: Number(area.lat), lng: Number(area.lng), radius: Number(area.radius), aktif: area.aktif !== false })).filter(area => area.aktif && isFinite(area.lat) && isFinite(area.lng) && area.lat >= -90 && area.lat <= 90 && area.lng >= -180 && area.lng <= 180 && isFinite(area.radius) && area.radius > 0).map(area => ({ nama: area.nama, lat: area.lat, lng: area.lng, radius: Math.min(Math.round(area.radius), 100000), aktif: true }));
  if (required && !areas.length) return responseJSON({ result: 'error', message: 'Tambahkan minimal satu area aktif jika geofence diwajibkan.' });
  const sheet = _pastikanSheetGeofence();
  const rows = bacaSheet(sheet, GEOFENCE_HEADERS.length);
  for (let i = rows.length - 1; i >= 1; i--) if (String(rows[i][0]).trim() === userId) sheet.deleteRow(i + 1);
  if (areas.length) sheet.getRange(sheet.getLastRow() + 1, 1, areas.length, GEOFENCE_HEADERS.length).setValues(areas.map(area => [userId, userRow[3], required ? 'YA' : 'TIDAK', area.nama, area.lat, area.lng, area.radius, 'YA']));
  return responseJSON({ result: 'success', message: required ? 'Geofence diwajibkan dan disimpan.' : 'Geofence opsional dan disimpan.', config: { required: required, areas: areas } });
}

// ==========================================
// 5. AUTH & LOGIC LAINNYA
// ==========================================

