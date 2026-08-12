// =======================================================
// PARSER FILE EXCEL MESIN ABSEN  ->  baris siap kirim ke dbabsen
//
// Sengaja dipisah dari komponen React dan bebas dependensi supaya
// bisa diuji langsung dengan Node (lihat importDbAbsenParser.test.js).
//
// Kuirk data nyata yang ditangani di sini (diambil dari file draft
// hasil download mesin absen):
//   - tanggal campur: "21/07/2026" dan "05-08-2026" dalam satu kolom
//   - jam kadang 1 digit: "8:30" vs "08:30"
//   - baris header muncul berulang di tengah file (efek paginasi)
//   - satu file berisi beberapa sheet (NON-SHIFT, SHIFT, ...) plus
//     sheet bantu yang harus diabaikan
//   - "Waktu Scan" berisi banyak jam dipisah spasi
//   - kolom "Bolos" berisi TRUE
// =======================================================

// Urutan kolom file mesin. Dipakai untuk verifikasi header, bukan
// untuk pencocokan longgar — urutan harus persis seperti ini.
export const KOLOM_SUMBER = [
  'No.Akun', 'NIK.', 'Nama', 'Tanggal', 'Jam Kerja', 'Mulai Tugas',
  'Akhir Tugas', 'Masuk', 'Pulang', 'Telat', 'Pulang Awal', 'Bolos',
  'Jam Kerja', 'Symbol', 'Departemen', 'ATT_Time', 'Waktu Scan', 'week'
];

export const JUMLAH_KOLOM = 18;

// Indeks kolom (0-based) yang isinya jam tunggal dan perlu dirapikan
// jadi HH:mm. Kolom 4 (Jam Kerja shift, "BSL_08:30-17:00") dan
// kolom 16 (Waktu Scan, banyak jam) sengaja TIDAK ikut.
const KOLOM_JAM = [5, 6, 7, 8, 9, 10, 12, 15];

const IDX_TANGGAL = 3;
const IDX_NIK = 1;
const IDX_SYMBOL = 13;
const IDX_WAKTU_SCAN = 16;

const dua = (n) => String(n).padStart(2, '0');

// -------------------------------------------------------
// Normalisasi nilai
// -------------------------------------------------------

/**
 * Segala bentuk tanggal -> 'YYYY-MM-DD'. Mengembalikan '' kalau
 * tidak bisa dipastikan.
 *
 * Bentuk DD/MM/YYYY dibaca sebagai hari-bulan-tahun (bukan gaya AS).
 * Ini aman untuk file mesin absen yang dipakai di sini; kalau suatu
 * saat mesinnya diganti, bagian ini yang pertama harus dicek.
 */
export function toYMD(v) {
  if (v === null || v === undefined || v === '') return '';

  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return `${v.getFullYear()}-${dua(v.getMonth() + 1)}-${dua(v.getDate())}`;
  }

  const s = String(v).trim();
  if (!s) return '';

  // YYYY-MM-DD / YYYY/MM/DD
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) {
    const y = +m[1], bl = +m[2], hr = +m[3];
    if (bl < 1 || bl > 12 || hr < 1 || hr > 31) return '';
    return `${y}-${dua(bl)}-${dua(hr)}`;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const hr = +m[1], bl = +m[2], y = +m[3];
    if (bl < 1 || bl > 12 || hr < 1 || hr > 31) return '';
    return `${y}-${dua(bl)}-${dua(hr)}`;
  }

  // Serial Excel (epoch 30 Des 1899). Hanya diterima pada rentang
  // yang masuk akal supaya angka nyasar tidak jadi tanggal palsu.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n >= 20000 && n <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      if (!isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}-${dua(d.getUTCMonth() + 1)}-${dua(d.getUTCDate())}`;
      }
    }
  }

  return '';
}

/**
 * Jam tunggal -> 'HH:mm'. Kalau tidak dikenali, teks aslinya
 * dikembalikan apa adanya (lebih baik daripada menghapus data).
 */
export function toHHMM(v) {
  if (v === null || v === undefined || v === '') return '';

  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return `${dua(v.getHours())}:${dua(v.getMinutes())}`;
  }

  const s = String(v).trim();
  if (!s) return '';

  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const jam = +m[1];
    if (jam > 47) return s;
    return `${dua(jam)}:${m[2]}`;
  }

  // Pecahan hari dari Excel (0.354166 = 08:30)
  if (/^0?\.\d+$/.test(s)) {
    const menit = Math.round(Number(s) * 1440);
    return `${dua(Math.floor(menit / 60))}:${dua(menit % 60)}`;
  }

  return s;
}

/** Rapikan spasi berlebih pada kolom "Waktu Scan". */
export function rapikanWaktuScan(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${dua(v.getHours())}:${dua(v.getMinutes())}`;
  }
  return String(v === null || v === undefined ? '' : v)
    .replace(/\s+/g, ' ')
    .trim();
}

// -------------------------------------------------------
// Deteksi baris
// -------------------------------------------------------

/**
 * Baris header dikenali dari isinya, bukan dari posisinya — karena
 * mesin absen mengulang header setiap ganti halaman.
 */
export function isBarisHeader(row) {
  if (!Array.isArray(row)) return false;
  const teks = row.map((c) => String(c === null || c === undefined ? '' : c).toLowerCase()).join('|');
  return teks.includes('nik') && teks.includes('tanggal') && teks.includes('symbol');
}

export function isBarisKosong(row) {
  if (!Array.isArray(row)) return true;
  return row.every((c) => c === null || c === undefined || String(c).trim() === '');
}

// -------------------------------------------------------
// Normalisasi satu baris data
// -------------------------------------------------------

export function normalisasiBaris(row) {
  const out = new Array(JUMLAH_KOLOM).fill('');

  for (let i = 0; i < JUMLAH_KOLOM; i++) {
    const v = row[i];
    out[i] = (v === null || v === undefined) ? '' : v;
  }

  out[IDX_TANGGAL] = toYMD(out[IDX_TANGGAL]);
  KOLOM_JAM.forEach((i) => { out[i] = toHHMM(out[i]); });
  out[IDX_WAKTU_SCAN] = rapikanWaktuScan(out[IDX_WAKTU_SCAN]);

  // Sisanya jadikan teks bersih. NIK dan Symbol dipakai sebagai kunci
  // pencocokan di backend, jadi spasi liar wajib dibuang.
  for (let i = 0; i < JUMLAH_KOLOM; i++) {
    if (typeof out[i] !== 'string') out[i] = String(out[i]);
    if (i !== IDX_WAKTU_SCAN) out[i] = out[i].trim();
  }

  return out;
}

// -------------------------------------------------------
// Parsing keseluruhan workbook
// -------------------------------------------------------

/**
 * Sheet boleh berasal dari beberapa file sekaligus. Isi `file` dipakai
 * untuk pelaporan (pratinjau dan daftar bentrok) — parsing sendiri tidak
 * peduli batas file, semuanya digabung jadi satu kumpulan baris.
 *
 * @param {Array<{nama:string, aoa:Array<Array<any>>, file?:string}>} sheets
 * @returns {{
 *   baris: Array<Array<string>>,
 *   dilewati: Array<{file:string, sheet:string, baris:number, alasan:string, cuplikan:string}>,
 *   perSheet: Array<{file:string, nama:string, diterima:number, dilewati:number, adaHeader:boolean}>,
 *   perFile: Array<{nama:string, diterima:number, dilewati:number, sheets:number}>,
 *   bentrok: Array<{nik:string, tanggal:string, lama:string, baru:string}>,
 *   tanggalMin: string, tanggalMaks: string,
 *   jumlahNik: number, duplikat: number
 * }}
 */
export function parseWorkbook(sheets) {
  const dilewati = [];
  const perSheet = [];
  const nikSet = new Set();
  const bentrok = [];
  let duplikat = 0;
  let tanggalMin = '';
  let tanggalMaks = '';

  // Kunci 'NIK|tanggal' -> baris. Map menjaga urutan masuk, dan menulis
  // ulang kunci yang sama berarti baris terakhir yang menang — persis
  // seperti yang dijanjikan peringatan di layar.
  const peta = new Map();

  (sheets || []).forEach(({ nama, aoa, file }) => {
    const namaFile = file || '';
    let adaHeader = false;
    let diterima = 0;
    let dilewatiSheet = 0;

    (aoa || []).forEach((row, idx) => {
      const nomorBaris = idx + 1;

      if (isBarisKosong(row)) return;

      if (isBarisHeader(row)) {
        adaHeader = true;
        return;
      }

      // Baris data sebelum header pertama ditemukan hampir pasti
      // bukan tabel absensi (sheet bantu, judul laporan, dll).
      if (!adaHeader) return;

      const n = normalisasiBaris(row);

      if (!n[IDX_NIK]) {
        dilewatiSheet++;
        dilewati.push({
          file: namaFile, sheet: nama, baris: nomorBaris,
          alasan: 'NIK kosong', cuplikan: cuplikan(row)
        });
        return;
      }
      if (!n[IDX_TANGGAL]) {
        dilewatiSheet++;
        dilewati.push({
          file: namaFile, sheet: nama, baris: nomorBaris,
          alasan: 'Tanggal tidak terbaca: "' + String(row[IDX_TANGGAL] ?? '') + '"',
          cuplikan: cuplikan(row)
        });
        return;
      }

      const kunci = n[IDX_NIK] + '|' + n[IDX_TANGGAL];
      const asal = asalBaris(namaFile, nama, nomorBaris);

      const sebelumnya = peta.get(kunci);
      if (sebelumnya) {
        duplikat++;
        bentrok.push({
          nik: n[IDX_NIK],
          tanggal: n[IDX_TANGGAL],
          lama: sebelumnya.asal,
          baru: asal
        });
      }

      // Menimpa kunci yang sama: baris terakhir yang dipakai.
      peta.set(kunci, { row: n, asal });

      nikSet.add(n[IDX_NIK]);
      if (!tanggalMin || n[IDX_TANGGAL] < tanggalMin) tanggalMin = n[IDX_TANGGAL];
      if (!tanggalMaks || n[IDX_TANGGAL] > tanggalMaks) tanggalMaks = n[IDX_TANGGAL];

      diterima++;
    });

    // Sheet tanpa header sama sekali = sheet bantu, tidak perlu dilaporkan
    // sebagai masalah.
    if (adaHeader || diterima > 0) {
      perSheet.push({ file: namaFile, nama, diterima, dilewati: dilewatiSheet, adaHeader });
    }
  });

  return {
    baris: Array.from(peta.values(), (v) => v.row),
    dilewati,
    perSheet,
    perFile: ringkasPerFile(perSheet),
    bentrok,
    tanggalMin,
    tanggalMaks,
    jumlahNik: nikSet.size,
    duplikat
  };
}

function asalBaris(file, sheet, nomorBaris) {
  return (file ? file + ' · ' : '') + sheet + ' baris ' + nomorBaris;
}

/** perSheet -> ringkasan per file, urut sesuai urutan file dipilih. */
function ringkasPerFile(perSheet) {
  const peta = new Map();

  perSheet.forEach((s) => {
    const kunci = s.file || '';
    if (!peta.has(kunci)) {
      peta.set(kunci, { nama: kunci, diterima: 0, dilewati: 0, sheets: 0 });
    }
    const f = peta.get(kunci);
    f.diterima += s.diterima;
    f.dilewati += s.dilewati;
    f.sheets += 1;
  });

  return Array.from(peta.values());
}

function cuplikan(row) {
  return (row || []).slice(0, 5)
    .map((c) => String(c === null || c === undefined ? '' : c))
    .join(' | ');
}

export const IDX = {
  NO_AKUN: 0, NIK: IDX_NIK, NAMA: 2, TANGGAL: IDX_TANGGAL, SHIFT: 4,
  SYMBOL: IDX_SYMBOL, WAKTU_SCAN: IDX_WAKTU_SCAN, WEEK: 17
};
