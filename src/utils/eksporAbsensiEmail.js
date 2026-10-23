// =====================================================================
// Export Excel tab ABSEN-EMAIL dengan FORMAT SAMA seperti di layar (24 Okt 2026)
//
// Isi: judul, kepala 3 baris (tanggal / hari / ABSEN-TELAT, kolom info
// digabung 3 baris), warna latar & huruf tiap sel persis dari sheet
// ABSENSI-email, lebar kolom, kolom beku sampai NAMA, baris kepala beku.
//
// Pakai ExcelJS (bukan SheetJS `xlsx` edisi komunitas, yang tidak bisa
// menulis gaya sel). Dimuat dinamis supaya tidak menambah berat bundle
// utama — baru diunduh saat tombol Excel ditekan.
// =====================================================================

const argb = (hex, bawaan) => {
  const h = String(hex || '').replace('#', '').trim();
  if (/^[0-9a-f]{6}$/i.test(h)) return 'FF' + h.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(h)) return 'FF' + h.split('').map(c => c + c).join('').toUpperCase();
  return bawaan;
};

// Lebar kolom Google Sheets (piksel) -> satuan lebar Excel (≈ karakter).
const pxKeLebar = (px) => Math.max(2.5, Math.round(((Number(px) || 60) / 7) * 10) / 10);

const BORDER_TIPIS = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
};

const nilaiExcel = (t) => {
  const s = String(t == null ? '' : t);
  // Bilangan bulat murni ditulis sebagai angka (bisa dijumlah di Excel);
  // selebihnya teks apa adanya, sama seperti yang tampil.
  if (/^-?\d{1,9}$/.test(s.trim()) && !/^0\d/.test(s.trim())) return Number(s.trim());
  return s;
};

/**
 * @param {object} p
 * @param {object} p.data      jawaban get_sinkron_gsheet bagian absensi_email
 * @param {object} p.susunan   { n, jenis[], judulInfo[], idxBeku, lebar[] } dari AbsensiEmailPanel
 * @param {Array}  p.baris     baris yang mau diekspor (boleh berisi {pisah:true})
 * @param {string} p.label     nama grup/departemen untuk judul sheet & nama file
 */
export async function eksporAbsensiEmail({ data, susunan, baris, label }) {
  const modul = await import('exceljs');
  const ExcelJS = modul.default || modul;
  const { n, jenis, judulInfo, idxBeku } = susunan;
  const { tanggal, hari } = data.kepala;
  const palet = data.palet || ['#ffffff', '#000000'];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'absensi.jpt.co.id';
  wb.created = new Date();
  const namaSheet = (label || 'ABSENSI').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  const ws = wb.addWorksheet(namaSheet, {
    views: [{ state: 'frozen', xSplit: idxBeku + 1, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  });

  // Kolom info yang sangat sempit (mis. GRUP 34px) diberi lebar minimum supaya
  // isinya ("GMS JKT") terbaca utuh di Excel.
  ws.columns = susunan.lebar.map((w, i) => ({ width: jenis[i] === 'info' ? Math.max(pxKeLebar(w), 8) : pxKeLebar(w) }));

  // Baris 1: judul, baris 2: keterangan.
  ws.mergeCells(1, 1, 1, n);
  const sJudul = ws.getCell(1, 1);
  sJudul.value = (data.judul || 'ABSENSI KARYAWAN') + (label ? ' — ' + label : '');
  sJudul.font = { bold: true, size: 14 };
  sJudul.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 22;
  ws.mergeCells(2, 1, 2, n);
  const jumlah = baris.filter(b => !b.pisah).length;
  ws.getCell(2, 1).value = `Dari ${data.namaFile || '-'} · ${jumlah} baris · diekspor ${new Date().toLocaleString('id-ID')}`;
  ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF64748B' } };

  // Baris 3-5: kepala.
  const R1 = 3, R2 = 4, R3 = 5;
  const gayaKepala = (cell, latar) => {
    cell.font = { bold: true, size: 9, color: { argb: 'FF334155' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: latar } };
    cell.border = BORDER_TIPIS;
  };
  for (let i = 0; i < n; i++) {
    const c = i + 1;
    if (jenis[i] === 'info') {
      ws.mergeCells(R1, c, R3, c);
      const cell = ws.getCell(R1, c);
      cell.value = judulInfo[i] || '';
      gayaKepala(cell, 'FFF1F5F9');
      if (i === idxBeku) cell.alignment = { horizontal: 'left', vertical: 'middle' };
      continue;
    }
    const pasangan = jenis[i] === 'absen' && i + 1 < n && jenis[i + 1] === 'telat';
    const sesudahAbsen = jenis[i] === 'telat' && i > 0 && jenis[i - 1] === 'absen';
    if (!sesudahAbsen) {
      if (pasangan) { ws.mergeCells(R1, c, R1, c + 1); ws.mergeCells(R2, c, R2, c + 1); }
      const t = ws.getCell(R1, c); t.value = tanggal[i] || ''; gayaKepala(t, 'FFFFFFFF');
      const h = ws.getCell(R2, c); h.value = hari[i] || ''; gayaKepala(h, 'FFFFFFFF');
      h.font = { size: 9, color: { argb: 'FF334155' } };
    }
    const l = ws.getCell(R3, c);
    l.value = jenis[i] === 'absen' ? 'ABSEN' : 'TELAT';
    gayaKepala(l, 'FFF0F9FF');
    l.font = { size: 8, color: { argb: 'FF475569' } };
  }
  [R1, R2, R3].forEach(r => { ws.getRow(r).height = 18; });

  // Data.
  let r = R3 + 1;
  baris.forEach(b => {
    if (b.pisah) {
      ws.getRow(r).height = 6;
      r++;
      return;
    }
    for (let i = 0; i < n; i++) {
      const cell = ws.getCell(r, i + 1);
      const isi = b.t[i];
      if (isi !== '' && isi !== null && isi !== undefined) cell.value = nilaiExcel(isi);
      const latar = argb(palet[b.b[i]], 'FFFFFFFF');
      if (latar !== 'FFFFFFFF') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: latar } };
      cell.font = { size: 9, bold: i === idxBeku, color: { argb: argb(palet[b.f[i]], 'FF000000') } };
      cell.alignment = { horizontal: jenis[i] === 'info' && i === idxBeku ? 'left' : 'center', vertical: 'middle' };
      cell.border = BORDER_TIPIS;
    }
    ws.getRow(r).height = 15;
    r++;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const bersih = s => String(s || '').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_');
  const namaBerkas = `ABSENSI_${bersih(label) || 'SEMUA'}_${bersih(data.judul).replace(/^ABSENSI_KARYAWAN_?/i, '') || 'PERIODE'}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = namaBerkas;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { namaBerkas, jumlah };
}
