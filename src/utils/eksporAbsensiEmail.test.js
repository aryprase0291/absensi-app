import ExcelJS from 'exceljs';
import { eksporAbsensiEmail } from './eksporAbsensiEmail';
test('ekspor ABSEN-EMAIL: judul, kepala 3 baris, warna, angka, beku', async () => {
  let blob = null;
  global.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
  global.URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = () => {};
  const info = [['GRUP',34],['NO',26],['NAMA',150]];
  const kolom = [...info.map(i => ({ lebar: i[1] })), { lebar: 40 }, { lebar: 40 }];
  const data = { judul: 'ABSENSI KARYAWAN PERIODE 21 SEP - 20 OKT 2026', namaFile: 'DB_ABSEN_SEPT', kolom,
    kepala: { tanggal: ['', '', '', '21-09-2026', ''], hari: ['GRUP', 'NO', 'NAMA', 'Sen', ''], label: ['', '', '', 'ABSEN', 'TELAT'] },
    palet: ['#ffffff', '#000000', '#ff0000', '#1155cc'] };
  const susunan = { n: 5, jenis: ['info','info','info','absen','telat'], judulInfo: ['GRUP','NO','NAMA','',''], idxBeku: 2, lebar: kolom.map(k => k.lebar) };
  const baris = [{ t: ['GMS JKT', '1', 'MURPHY', '', '5'], b: [0,0,0,2,0], f: [1,1,1,1,1] }, { t: ['GMS JKT', '2', 'BAMBANG', '', ''], b: [0,0,2,3,0], f: [1,1,1,1,1] }];
  const hasil = await eksporAbsensiEmail({ data, susunan, baris, label: 'GMS JKT' });
  const buf = await new Response(blob).arrayBuffer();
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  expect(hasil.namaBerkas).toBe('ABSENSI_GMS_JKT_PERIODE_21_SEP_-_20_OKT_2026.xlsx');
  expect(ws.name).toBe('GMS JKT');
  expect(ws.getCell('D3').value).toBe('21-09-2026');
  expect(ws.getCell('D5').value).toBe('ABSEN');
  expect(ws.getCell('E5').value).toBe('TELAT');
  expect(ws.getCell('C3').isMerged).toBe(true);
  expect(ws.getCell('D6').fill.fgColor.argb).toBe('FFFF0000');
  expect(ws.getCell('C7').fill.fgColor.argb).toBe('FFFF0000');
  expect(ws.getCell('E6').value).toBe(5);
  expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 5 });
});
