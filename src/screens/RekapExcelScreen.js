import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet, Download, Edit3, Trash2, Plus, Search,
  Building, RefreshCcw, Check, X, Loader2,
  ShieldAlert, Layers, PieChart, Sparkles, Tag, AlertTriangle,
  Eye, Copy, EyeOff, Printer, CheckCircle2, UserCheck, CalendarDays,
  Maximize2, Minimize2
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';
import BackButton from '../components/BackButton';
import { useUrutCari, IsiKepala, TombolResetKolom, tooltipSelTerpotong } from '../components/KolomTabel';
import {
  susunBoard, boardKeSheet, labelTanggalPendek,
  BOARD_KOLOM_INFO, BOARD_KODE_HITUNG, BOARD_MAKS_HARI
} from './boardAbsensi';

// Pilihan Simbol Koreksi (ID2)
const OPSI_SIMBOL_KOREKSI = [
  { kode: 'H', label: 'H - Hadir Normal', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { kode: 'I', label: 'I - Ijin / Izin', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { kode: 'S', label: 'S - Sakit', color: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  { kode: 'C', label: 'C - Cuti Tahunan', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  { kode: 'CB', label: 'CB - Cuti Bersama', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { kode: 'EO', label: 'EO - Extra Ordinary', color: 'bg-lime-50 text-lime-700 border-lime-200' },
  { kode: 'DL', label: 'DL - Dinas Luar', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  { kode: 'O', label: 'O - Off / Libur Jadwal', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { kode: 'A', label: 'A - Alpa / Tanpa Keterangan', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  { kode: 'T', label: 'T - Terlambat', color: 'bg-amber-50 text-amber-700 border-amber-200' }
];

// Simbol awal form koreksi HARUS salah satu pilihan di dropdown (24 Sep 2026).
// Dulu form diisi simbol baris apa adanya — mis. 'Si' dari mesin. 'Si'
// tidak ada di dropdown, jadi browser MENAMPILKAN pilihan pertama
// ("H - Hadir Normal") padahal nilai yang tersimpan tetap 'Si'. Admin
// mengira sudah memilih H, menekan Simpan, dan yang tersimpan justru
// koreksi 'SI' — baris tetap tidak hadir.
const KODE_KOREKSI_SAH = OPSI_SIMBOL_KOREKSI.map(o => o.kode);
const simbolKoreksiAwal = (sym) => {
  const k = String(sym || '').trim().toUpperCase();
  return KODE_KOREKSI_SAH.includes(k) ? k : 'H';
};

// Simbol koreksi yang tetap dianggap terlambat. Koreksi ke simbol lain
// (H, I, S, DL, ...) menghapus TELAT dan NOMINAL baris itu.
const SIMBOL_TELAT = ['T', 'TPC', 'TSI', 'TSO'];

// Helper Format Waktu (HH:mm)
const formatTimeValue = (val) => {
  if (val === null || val === undefined || val === '' || val === '-') return '';
  if (typeof val === 'number') {
    if (val >= 0 && val < 1) {
      const totalMin = Math.round(val * 24 * 60);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    return String(val);
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (s.includes('T')) {
      try {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        }
      } catch (e) {}
    }
    return s;
  }
  return String(val);
};

// Helper Format Tanggal (DD-MM-YYYY)
const formatDateOnly = (val) => {
  if (!val || val === '-') return '-';
  if (typeof val === 'string') {
    const clean = val.trim();
    if (clean.includes(' ')) {
      return clean.split(' ')[0];
    }
    return clean;
  }
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    }
  } catch (e) {}
  return String(val);
};

// Helper Hitung Denda Keterlambatan Berdasarkan Menit
const hitungDendaTelat = (telatVal, existingNominal) => {
  if (existingNominal !== undefined && existingNominal !== null && existingNominal !== '' && Number(existingNominal) > 0) {
    return Number(existingNominal);
  }
  if (!telatVal || telatVal === '-' || telatVal === '00:00' || telatVal === '0') return 0;

  let minutes = 0;
  if (typeof telatVal === 'number') {
    if (telatVal >= 0 && telatVal < 1) {
      minutes = Math.round(telatVal * 24 * 60);
    } else {
      minutes = Math.round(telatVal);
    }
  } else if (typeof telatVal === 'string') {
    const s = telatVal.trim();
    if (s.includes(':')) {
      const parts = s.split(':');
      minutes = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    } else if (!isNaN(Number(s))) {
      const num = Number(s);
      if (num > 0 && num < 1) minutes = Math.round(num * 24 * 60);
      else minutes = Math.round(num);
    }
  }

  if (minutes <= 0) return 0;
  if (minutes <= 25) return 25000;
  if (minutes <= 35) return 50000;
  if (minutes <= 50) return 75000;
  return 100000;
};

// Helper Format Nominal Rupiah
const formatNominal = (val) => {
  if (val === null || val === undefined || val === '' || val === 0 || val === '0' || val === '-') return '';
  const num = Number(String(val).replace(/[^0-9.-]+/g, ''));
  if (isNaN(num) || num === 0) return '';
  return num.toLocaleString('id-ID');
};

// Lebar kolom info pada board, dalam piksel. Dipakai dua kali: sebagai
// minWidth kolomnya, dan untuk menghitung offset kolom yang menempel —
// keduanya harus dari angka yang sama, kalau tidak kolom yang menempel akan
// meleset sedikit dan menutupi tetangganya saat digulir.
const BOARD_LEBAR_INFO = [44, 84, 48, 200, 80, 88, 170, 150, 64];

// Empat kolom pertama (NO, PAYROLL, HRD, NAMA) menempel di kiri, sepadan
// dengan setFrozenColumns(4) pada BoardAbsensi.gs.
const BOARD_OFFSET_KIRI = BOARD_LEBAR_INFO.slice(0, 4).reduce((acc, w, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + BOARD_LEBAR_INFO[i - 1]);
  return acc;
}, []);

// Warna sel simbol pada board. Sengaja dipisah dari OPSI_SIMBOL_KOREKSI:
// daftar itu hanya memuat simbol yang boleh DIPILIH admin saat mengoreksi,
// sementara mesin absensi juga mengeluarkan NF, So, Si, PC, dan turunannya
// yang tidak boleh diinput manual tapi tetap harus terbaca di board.
const BOARD_WARNA_SIMBOL = {
  H: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ONL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  O: 'bg-slate-100 text-slate-500 border-slate-200',
  NF: 'bg-violet-50 text-violet-700 border-violet-200',
  C: 'bg-teal-50 text-teal-700 border-teal-200',
  CB: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  EO: 'bg-lime-50 text-lime-700 border-lime-200',
  DL: 'bg-sky-50 text-sky-700 border-sky-200',
  I: 'bg-blue-50 text-blue-700 border-blue-200',
  S: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  A: 'bg-rose-50 text-rose-700 border-rose-200',
  T: 'bg-amber-50 text-amber-800 border-amber-200',
  SI: 'bg-orange-50 text-orange-700 border-orange-200',
  SO: 'bg-orange-50 text-orange-700 border-orange-200',
  SISO: 'bg-orange-100 text-orange-800 border-orange-300',
  TSI: 'bg-orange-100 text-orange-800 border-orange-300',
  TSO: 'bg-orange-100 text-orange-800 border-orange-300',
  PC: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  TPC: 'bg-indigo-100 text-indigo-800 border-indigo-300'
};

// Sumber baris DB_FIX (24 Sep 2026): 'mesin' | 'online' | 'mesin+online'.
// 'online' = status hari itu ditentukan absen online (baris virtual, atau
// baris mesin berstatus A/Si/So yang tertutup absen online).
const LABEL_SUMBER = {
  mesin: { teks: 'Mesin', warna: 'bg-slate-50 text-slate-600 border-slate-200' },
  online: { teks: 'Online', warna: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  'mesin+online': { teks: 'Mesin + Online', warna: 'bg-sky-50 text-sky-700 border-sky-200' }
};
const labelSumber = (sumber) => LABEL_SUMBER[sumber] || LABEL_SUMBER.mesin;
const adaOnline = (r) => String(r.sumber || '').includes('online');

// PERIODE AKTIF (24 Sep 2026)
// Tanggal hari ini (zona perangkat) dalam YYYY-MM-DD.
const hariIniYMD = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
// Rentang yang dipakai untuk sebuah periode: periode yang sedang berjalan
// dipotong sampai hari ini, periode yang sudah lewat dipakai utuh.
const rentangPeriode = (p, hariIni) => {
  if (!p) return { dari: '', sampai: '' };
  const hi = hariIni || hariIniYMD();
  const sampai = (hi >= p.mulai && hi < p.selesai) ? hi : p.selesai;
  return { dari: p.mulai, sampai };
};
const periodeBerjalan = (p, hariIni) => !!p && hariIni >= p.mulai && hariIni <= p.selesai;
// '2026-09-21' -> '21 Sep 2026'
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const tglPendek = (ymd) => {
  const b = String(ymd || '').split('-');
  if (b.length !== 3) return ymd || '';
  return Number(b[2]) + ' ' + (BULAN_PENDEK[Number(b[1]) - 1] || b[1]) + ' ' + b[0];
};

const warnaSimbolBoard = (sym) => {
  const k = String(sym || '').trim().toUpperCase();
  return BOARD_WARNA_SIMBOL[k] || 'bg-slate-50 text-slate-600 border-slate-200';
};

// Fungsi murni di luar komponen: kalau didefinisikan di dalam, keduanya
// dibuat ulang setiap render dan membuat useMemo penyaring tanggal (lalu
// seluruh turunannya, termasuk Board) dihitung ulang di setiap ketikan.
const isDateInRange = (tglStr, startStr, endStr) => {
  if (!tglStr) return true;
  if (!startStr && !endStr) return true;
  const d = new Date(String(tglStr).slice(0, 10));
  if (isNaN(d.getTime())) return true;
  if (startStr) {
    const s = new Date(startStr);
    if (!isNaN(s.getTime()) && d < s) return false;
  }
  if (endStr) {
    const e = new Date(endStr);
    if (!isNaN(e.getTime()) && d > e) return false;
  }
  return true;
};

const isKoreksiRangeOverlaps = (kStart, kEnd, fStart, fEnd) => {
  if (!fStart && !fEnd) return true;
  const ks = kStart ? new Date(String(kStart).slice(0, 10)) : null;
  const ke = kEnd ? new Date(String(kEnd).slice(0, 10)) : (ks ? new Date(ks) : null);
  const fs = fStart ? new Date(fStart) : null;
  const fe = fEnd ? new Date(fEnd) : null;
  if (!ks || isNaN(ks.getTime())) return true;
  const effKe = (ke && !isNaN(ke.getTime())) ? ke : ks;
  const effFs = (fs && !isNaN(fs.getTime())) ? fs : new Date(-8640000000000000);
  const effFe = (fe && !isNaN(fe.getTime())) ? fe : new Date(8640000000000000);
  return ks <= effFe && effKe >= effFs;
};

// DEFINISI KOLOM TABEL — dipakai untuk urut A-Z/Z-A dan cari per kolom
// (lihat components/KolomTabel.js). `nilai` = untuk mengurutkan,
// `teks` = yang dicocokkan saat mencari (bawaan: String(nilai)).
const angka = (v) => Number(v) || 0;
const KOLOM_DASHBOARD = [
  { key: 'no', lebar: 48, label: 'No', aksi: false, align: 'center', kelas: 'w-12' },
  { key: 'dept', lebar: 150, label: 'Dept', nilai: d => d.dept || '' },
  { key: 'nama', lebar: 210, label: 'Nama Pegawai', nilai: d => d.nama || '' },
  { key: 'jabatan', lebar: 130, label: 'Jabatan', nilai: d => d.jabatan || '' },
  { key: 'payroll', lebar: 90, label: 'Payroll', nilai: d => d.payroll || '' },
  { key: 'sisaCuti', lebar: 85, label: 'Sisa Cuti', align: 'center', kelas: 'text-slate-800', nilai: d => angka(d.sisaCuti) },
  { key: 'cutiDiambil', lebar: 100, label: 'Cuti Diambil', align: 'center', kelas: 'text-teal-700', nilai: d => angka(d.cutiDiambil) },
  { key: 'sakit', lebar: 70, label: 'Sakit', align: 'center', kelas: 'text-fuchsia-700', nilai: d => angka(d.sakit) },
  { key: 'alpa', lebar: 70, label: 'Alpa', align: 'center', kelas: 'text-rose-700', nilai: d => angka(d.alpa) },
  { key: 'ijin', lebar: 70, label: 'Ijin', align: 'center', kelas: 'text-blue-700', nilai: d => angka(d.ijin) },
  { key: 'tdkAbsenMasuk', lebar: 90, label: 'Tdk Masuk', align: 'center', kelas: 'text-amber-700', nilai: d => angka(d.tdkAbsenMasuk) },
  { key: 'tdkAbsenPulang', lebar: 95, label: 'Tdk Pulang', align: 'center', kelas: 'text-amber-700', nilai: d => angka(d.tdkAbsenPulang) },
  { key: 'telat', lebar: 70, label: 'Telat', align: 'center', kelas: 'text-orange-700', nilai: d => angka(d.telat) },
  { key: 'nominalTerlambat', lebar: 130, label: 'Nominal Terlambat', align: 'right', kelas: 'text-amber-800',
    nilai: d => angka(d.nominalTerlambat), teks: d => `${d.nominalTerlambat || 0} ${formatNominal(d.nominalTerlambat || 0)}` },
  { key: 'aksi', lebar: 90, label: 'Kartu Detail', aksi: false, align: 'center' }
];

const KOLOM_TABEL = [
  { key: 'noAkun', lebar: 75, label: 'No Akun', align: 'center', nilai: r => r.noAkun || '' },
  { key: 'payroll', lebar: 80, label: 'Payroll', align: 'center', nilai: r => r.payroll || '' },
  { key: 'nama', lebar: 180, label: 'Nama', nilai: r => r.nama || '' },
  { key: 'tanggal', lebar: 95, label: 'Tanggal', align: 'center', nilai: r => r.tanggalYMD || '', teks: r => formatDateOnly(r.tanggal || r.tanggalYMD) },
  { key: 'jamKerja', lebar: 140, label: 'Jam Kerja', nilai: r => r.jamKerja || '' },
  { key: 'mTugas', lebar: 75, label: 'M. Tugas', align: 'center', nilai: r => formatTimeValue(r.mTugas) },
  { key: 'aTugas', lebar: 75, label: 'A: Tugas', align: 'center', nilai: r => formatTimeValue(r.aTugas) },
  { key: 'masuk', lebar: 70, label: 'Masuk', align: 'center', kelas: 'text-emerald-800', nilai: r => formatTimeValue(r.masuk) },
  { key: 'pulang', lebar: 75, label: 'Pulang', align: 'center', kelas: 'text-rose-800', nilai: r => formatTimeValue(r.pulang) },
  { key: 'telat', lebar: 70, label: 'Telat', align: 'center', kelas: 'text-amber-800', nilai: r => formatTimeValue(r.telat) },
  { key: 'pAwal', lebar: 70, label: 'P. Awal', align: 'center', nilai: r => formatTimeValue(r.pAwal) },
  { key: 'bolos', lebar: 65, label: 'Bolos', align: 'center', nilai: r => r.bolos || '' },
  { key: 'tjk', lebar: 65, label: 'TJK', align: 'center', kelas: 'font-black text-slate-800', nilai: r => formatTimeValue(r.tjk) },
  { key: 'id2', lebar: 60, label: 'ID2', align: 'center', kelas: 'font-black', nilai: r => r.id2 || '' },
  { key: 'departemen', lebar: 130, label: 'Departemen', nilai: r => r.departemen || '' },
  { key: 'attTime', lebar: 80, label: 'ATT_TIME', align: 'center', nilai: r => formatTimeValue(r.attTime) },
  { key: 'waktuScan', lebar: 110, label: 'Waktu Scan', nilai: r => r.waktuScan || '' },
  { key: 'week', lebar: 65, label: 'Week', align: 'center', nilai: r => r.week || '' },
  { key: 'nominal', lebar: 85, label: 'Nominal', align: 'right',
    nilai: r => hitungDendaTelat(r.telat, r.nominal) || '',
    teks: r => { const n = hitungDendaTelat(r.telat, r.nominal); return n ? `${n} ${formatNominal(n)}` : ''; } },
  { key: 'sumber', lebar: 100, label: 'Sumber', align: 'center', kelas: 'text-indigo-800', nilai: r => labelSumber(r.sumber).teks },
  { key: 'koreksi', lebar: 70, label: 'Koreksi', align: 'center',
    nilai: r => (r.isKoreksi ? 'Sudah' : ''), teks: r => (r.isKoreksi ? `sudah dikoreksi ${r.koreksiKet || ''}` : 'belum') }
];

const KOLOM_KOREKSI = [
  { key: 'no', lebar: 48, label: 'No', aksi: false, align: 'center', kelas: 'w-12' },
  { key: 'noAkun', lebar: 85, label: 'No Akun', nilai: k => k.noAkun || '' },
  { key: 'payroll', lebar: 90, label: 'Payroll', nilai: k => k.payroll || '' },
  { key: 'nama', lebar: 200, label: 'Nama Pegawai', nilai: k => k.nama || '' },
  { key: 'tglMulai', lebar: 100, label: 'Tgl Mulai', nilai: k => k.tglMulai || '', teks: k => formatDateOnly(k.tglMulai) },
  { key: 'tglSelesai', lebar: 100, label: 'Tgl Selesai', nilai: k => k.tglSelesai || k.tglMulai || '', teks: k => formatDateOnly(k.tglSelesai || k.tglMulai) },
  { key: 'id2', lebar: 130, label: 'Status Koreksi (ID2)', align: 'center', nilai: k => k.id2 || '' },
  { key: 'keterangan', lebar: 280, label: 'Keterangan', nilai: k => k.keterangan || '' },
  { key: 'createdAt', lebar: 150, label: 'Diinput', nilai: k => k.createdAt || '' },
  { key: 'aksi', lebar: 90, label: 'Aksi', aksi: false, align: 'center' }
];

// Kolom info board, urutannya sama dengan BOARD_KOLOM_INFO.
const KOLOM_BOARD_INFO = [
  { key: 'no', label: 'NO', nilai: o => angka(o.no) },
  { key: 'payroll', label: 'PAYROLL', nilai: o => o.payroll || '' },
  { key: 'hrd', label: 'HRD', nilai: o => o.hrd || '' },
  { key: 'nama', label: 'NAMA', nilai: o => o.nama || '' },
  { key: 'pt', label: 'PT', nilai: o => o.pt || '' },
  { key: 'tglMasuk', label: 'TGL MASUK', nilai: o => o.tglMasuk || '' },
  { key: 'jabatan', label: 'JABATAN', nilai: o => o.jabatan || '' },
  { key: 'atasan', label: 'ATASAN LANGSUNG', nilai: o => o.atasan || '' },
  { key: 'hariKerja', label: 'HARI KERJA', nilai: o => angka(o.hariKerja) }
];

// Lebar minimum tabel = jumlah lebar kolom. Di layar lebar kolom ikut
// melebar sampai penuh; di layar sempit tabel digulir ke samping.
const lebarTotal = (kolom) => kolom.reduce((n, k) => n + (k.lebar || 80), 0);

// Kepala tabel yang menempel di atas saat tabel digulir.
const TH_STICKY = 'sticky top-0 z-10 align-top shadow-[inset_0_-1px_0_rgb(226,232,240)]';

export default function RekapExcelScreen({ user, setView, fetchApi: customFetchApi, initialTab = 'dashboard' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  // Mode layar penuh: tabel aktif menutupi seluruh layar (Esc untuk keluar).
  const [layarPenuh, setLayarPenuh] = useState(false); // 'tabel' | 'koreksi' | 'dashboard' | 'board'
  const [loading, setLoading] = useState(false);
  const [rawRecords, setRawRecords] = useState([]);
  const [dashboardData, setDashboardData] = useState([]);
  const [koreksiList, setKoreksiList] = useState([]);
  const [serverError, setServerError] = useState(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterSimbol, setFilterSimbol] = useState('ALL');
  const [filterSumber, setFilterSumber] = useState('ALL'); // 'ALL' | 'mesin' | 'online'
  const [filterTglMulai, setFilterTglMulai] = useState('');
  const [filterTglSelesai, setFilterTglSelesai] = useState('');
  // Daftar periode aktif dari server (Panel Admin > Periode Absensi),
  // terbaru dulu. Dikirim bersama jawaban get_rekap_admin.
  const [periodeList, setPeriodeList] = useState([]);
  const [hariIniServer, setHariIniServer] = useState('');


  // Form Koreksi State
  const [showKoreksiModal, setShowKoreksiModal] = useState(false);
  const [editKoreksiItem, setEditKoreksiItem] = useState(null);
  const [formKoreksi, setFormKoreksi] = useState({
    noAkun: '',
    payroll: '',
    nama: '',
    tglMulai: '',
    tglSelesai: '',
    id2: 'H',
    keterangan: ''
  });
  const [namaSuggestOpen, setNamaSuggestOpen] = useState(false);
  const [namaSuggestIdx, setNamaSuggestIdx] = useState(-1);
  const [savingKoreksi, setSavingKoreksi] = useState(false);
  // Pesan singkat pengganti alert() — alert menahan layar sampai diklik,
  // dan membuat simpan koreksi terasa lebih lama dari sebenarnya.
  const [toast, setToast] = useState(null); // { teks, jenis: 'ok' | 'galat' }
  const toastTimer = useRef(null);
  const tampilkanToast = useCallback((teks, jenis = 'ok') => {
    setToast({ teks, jenis });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  // Penyegaran di belakang layar sedang berjalan (setelah koreksi).
  const [menyegarkan, setMenyegarkan] = useState(false);
  // Tab Koreksi: 'periode' = koreksi yang menyentuh periode terpilih,
  // 'semua' = seluruh histori koreksi yang pernah disimpan.
  const [lingkupKoreksi, setLingkupKoreksi] = useState('periode');
  const [semuaKoreksi, setSemuaKoreksi] = useState(null); // null = belum dimuat
  const [memuatSemuaKoreksi, setMemuatSemuaKoreksi] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Modal Kartu Detail View
  const [detailModalEmployee, setDetailModalEmployee] = useState(null);
  const [detailActiveCategory, setDetailActiveCategory] = useState('TELAT');
  const [showDetailNominal, setShowDetailNominal] = useState(true);
  const [copyImageSuccess, setCopyImageSuccess] = useState(false);

  // Pagination for table
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const isAdmin = user && (String(user.role).toLowerCase() === 'admin');

  // Reset pagination on filter / search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterDept, filterSimbol, filterSumber, filterTglMulai, filterTglSelesai]);

  // Internal safe api caller
  const doApiCall = useCallback(async (actionName, payload = {}) => {
    if (typeof customFetchApi === 'function') {
      const res = await customFetchApi(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: actionName, ...payload })
      });
      return await res.json();
    }

    const saved = sessionStorage.getItem('app_user');
    let token = '';
    if (saved) {
      try {
        const u = JSON.parse(saved);
        token = u?.token || '';
      } catch (e) { /* ignore */ }
    }

    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: actionName, token, ...payload })
    });
    return await res.json();
  }, [customFetchApi]);

  // Nomor urut permintaan. Filter tanggal sekarang memicu permintaan ke
  // server, jadi dua permintaan bisa melayang bersamaan — dan yang
  // berangkat lebih dulu bisa pulang belakangan. Tanpa penjaga ini,
  // jawaban lama akan menimpa jawaban yang benar dan layar menampilkan
  // rentang yang tidak sedang dipilih siapa pun.
  const permintaanKe = useRef(0);

  // Sudah pernahkah rentang terisi? Ini yang membedakan "belum diisi"
  // dari "sengaja dikosongkan" — dua keadaan yang sama-sama berupa string
  // kosong, tapi artinya berlawanan. Belum diisi = server pakai periode
  // aktif; sengaja dikosongkan = admin memang minta seluruh periode.
  const rentangSudahDiisi = useRef(false);
  // Rentang yang permintaannya terakhir dikirim. Dipakai supaya
  // pengisian otomatis dari jawaban server tidak memicu permintaan kedua
  // untuk rentang yang datanya baru saja diterima.
  const rentangTerakhir = useRef(null);

  // SIMPANAN DI BROWSER (24 Sep 2026)
  //
  // Jawaban per rentang disimpan sebentar di memori layar ini, jadi
  // berpindah periode bolak-balik tidak menunggu server lagi. Periode
  // yang sudah lewat disimpan 15 menit, rentang yang memuat hari ini
  // 2 menit. Tombol Refresh, simpan/hapus koreksi selalu melewatinya.
  // Server punya simpanan sendiri (lihat _rekapCacheKunci_ di Code.gs).
  const simpananRekap = useRef(new Map());
  const kunciSimpanan = (dari, sampai, semua) => (dari || '') + '|' + (sampai || '') + '|' + (semua || '');
  const simpananMasihBaru = (entri) => {
    if (!entri) return false;
    const berjalan = !entri.sampai || entri.sampai >= hariIniYMD();
    const umur = Date.now() - entri.t;
    return umur < (berjalan ? 2 : 15) * 60 * 1000;
  };
  const simpanKeSimpanan = (dari, sampai, semua, data) => {
    const entri = { data, t: Date.now(), sampai: sampai || '' };
    simpananRekap.current.set(kunciSimpanan(dari, sampai, semua), entri);
    // Jawaban untuk "periode bawaan" (dari & sampai kosong) juga
    // disimpan di bawah rentang yang dipantulkan server.
    const r = (data && data.rentang) || {};
    if ((r.dari || r.sampai) && !semua) {
      simpananRekap.current.set(kunciSimpanan(r.dari, r.sampai, ''), { ...entri, sampai: r.sampai || '' });
    }
  };

  // Panggil server, dengan SATU percobaan ulang kalau jaringannya yang
  // gagal (bukan kalau server menjawab error). Koneksi Apps Script
  // sesekali putus di tengah jalan; mengulang sekali setelah jeda
  // pendek hampir selalu berhasil dan jauh lebih baik daripada layar
  // kosong dengan pesan gagal.
  const ambilRekap = useCallback(async (payload) => {
    try {
      return await doApiCall('get_rekap_admin', payload);
    } catch (e) {
      await new Promise(r => setTimeout(r, 1500));
      return await doApiCall('get_rekap_admin', payload);
    }
  }, [doApiCall]);

  const terapkanData = useCallback((data) => {
    setRawRecords(data.rawRecords || []);
    setDashboardData(data.dashboardData || []);
    setKoreksiList(data.koreksiList || []);
    if (Array.isArray(data.periodeAktif)) setPeriodeList(data.periodeAktif);
    if (data.hariIni) setHariIniServer(data.hariIni);

    // Pemuatan pertama: server menjawab dengan periode aktif dan
    // memantulkan rentangnya. Kotak tanggal diisi supaya admin
    // melihat periode mana yang sedang ditampilkan — kalau dibiarkan
    // kosong, layar seolah menampilkan semuanya padahal tidak.
    if (!rentangSudahDiisi.current) {
      rentangSudahDiisi.current = true;
      const r = data.rentang || {};
      if (r.dari || r.sampai) {
        rentangTerakhir.current = (r.dari || '') + '|' + (r.sampai || '');
        setFilterTglMulai(r.dari || '');
        setFilterTglSelesai(r.sampai || '');
      }
    }
  }, []);

  // Fetch Data from Apps Script
  // opsi.paksa = lewati simpanan browser DAN server (Refresh, koreksi).
  const fetchData = useCallback(async (dariMasuk, sampaiMasuk, opsi) => {
    // Hanya string yang boleh lewat. Kalau suatu saat ada pemanggil yang
    // menyerahkan objek event lagi, yang terjadi adalah rentang kosong —
    // bukan seluruh permintaan gagal dengan pesan yang menuduh server.
    const dari   = typeof dariMasuk   === 'string' ? dariMasuk   : '';
    const sampai = typeof sampaiMasuk === 'string' ? sampaiMasuk : '';
    const paksa  = !!(opsi && opsi.paksa);
    // diam = tabel TIDAK diganti spinner; data lama tetap tampil sampai
    // jawaban baru datang (dipakai setelah simpan/hapus koreksi).
    const diam   = !!(opsi && opsi.diam);
    const semua  = (!dari && !sampai && rentangSudahDiisi.current) ? '1' : '';

    const nomor = ++permintaanKe.current;
    setServerError(null);

    if (paksa) {
      simpananRekap.current.clear();
    } else {
      const entri = simpananRekap.current.get(kunciSimpanan(dari, sampai, semua));
      if (simpananMasihBaru(entri)) {
        terapkanData(entri.data);
        setLoading(false);
        return;
      }
    }

    if (diam) setMenyegarkan(true); else setLoading(true);
    try {
      const data = await ambilRekap({
        dari: dari || '',
        sampai: sampai || '',
        semua,
        segarkan: paksa ? '1' : ''
      });
      if (nomor !== permintaanKe.current) {
        // Jawaban terlambat tetap berguna untuk simpanan.
        if (data && data.result === 'success') simpanKeSimpanan(dari, sampai, semua, data);
        return;
      }
      if (data && data.result === 'success') {
        simpanKeSimpanan(dari, sampai, semua, data);
        terapkanData(data);
      } else {
        const errMsg = data?.message || 'Server belum mengenali action get_rekap_admin.';
        setServerError(errMsg);
      }
    } catch (e) {
      if (nomor !== permintaanKe.current) return;
      console.error('Fetch rekap error:', e);
      setServerError('Gagal terhubung ke Web App Google Apps Script. Pastikan URL Web App aktif dan backend terbaru sudah di-deploy.');
    } finally {
      if (nomor === permintaanKe.current) {
        setLoading(false);
        setMenyegarkan(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambilRekap, terapkanData]);

  // KOREKSI LANGSUNG TERLIHAT (24 Sep 2026)
  //
  // Dulu simpan koreksi = simpan di server, alert, lalu SELURUH rekap
  // dihitung ulang dengan spinner menutupi tabel. Sekarang baris yang
  // kena koreksi diperbarui di layar saat itu juga, dan angka dashboard
  // disusulkan oleh penyegaran diam di belakang layar.
  const cocokPegawai = (r, k) => {
    const sama = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    return sama(r.payroll, k.payroll) || sama(r.noAkun, k.noAkun) || sama(r.nama, k.nama);
  };
  const terapkanKoreksiLokal = useCallback((k) => {
    setSemuaKoreksi(prev => {
      if (!prev) return prev;
      const ada = prev.some(x => x.id === k.id);
      return ada ? prev.map(x => (x.id === k.id ? { ...x, ...k } : x)) : [k, ...prev];
    });
    setKoreksiList(prev => {
      const ada = prev.some(x => x.id === k.id);
      return ada ? prev.map(x => (x.id === k.id ? { ...x, ...k } : x)) : [k, ...prev];
    });
    const selesai = k.tglSelesai || k.tglMulai;
    setRawRecords(prev => prev.map(r => {
      const tgl = r.tanggalYMD || '';
      if (!tgl || tgl < k.tglMulai || tgl > selesai || !cocokPegawai(r, k)) return r;
      // Koreksi ke simbol selain keluarga T menghapus telat & nominal
      // (aturan yang sama dengan handleGetRekapAdmin di Code.gs). Nilai
      // aslinya disimpan supaya kalau koreksi diubah lagi ke T, telatnya
      // kembali tanpa menunggu penyegaran dari server.
      const telatAsli = r._telatAsli !== undefined ? r._telatAsli : r.telat;
      const nominalAsli = r._nominalAsli !== undefined ? r._nominalAsli : r.nominal;
      const tetapTelat = SIMBOL_TELAT.includes(String(k.id2 || '').toUpperCase());
      return {
        ...r, id2: k.id2, isKoreksi: true, koreksiKet: k.keterangan,
        _telatAsli: telatAsli, _nominalAsli: nominalAsli,
        telat: tetapTelat ? telatAsli : '',
        nominal: tetapTelat ? nominalAsli : ''
      };
    }));
    simpananRekap.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hapusKoreksiLokal = useCallback((id) => {
    setKoreksiList(prev => prev.filter(x => x.id !== id));
    setSemuaKoreksi(prev => (prev ? prev.filter(x => x.id !== id) : prev));
    simpananRekap.current.clear();
  }, []);

  // AMBIL DI MUKA (24 Sep 2026). Setelah periode bawaan tampil, periode
  // aktif lain diambil diam-diam satu per satu di belakang layar, supaya
  // saat admin memilihnya datanya sudah siap. Tidak menyentuh tampilan
  // sama sekali — hanya mengisi simpanan (browser & server).
  const sudahAmbilDiMuka = useRef(false);
  useEffect(() => {
    if (!isAdmin || sudahAmbilDiMuka.current || loading || !periodeList.length) return undefined;
    sudahAmbilDiMuka.current = true;
    let batal = false;
    const hi = hariIniServer || hariIniYMD();
    const target = periodeList.slice(0, 3)
      .map(p => rentangPeriode(p, hi))
      .filter(r => !simpananMasihBaru(simpananRekap.current.get(kunciSimpanan(r.dari, r.sampai, ''))));
    (async () => {
      await new Promise(r => setTimeout(r, 1500));
      for (const r of target) {
        if (batal) return;
        try {
          const data = await doApiCall('get_rekap_admin', { dari: r.dari, sampai: r.sampai, semua: '', segarkan: '' });
          if (data && data.result === 'success') simpanKeSimpanan(r.dari, r.sampai, '', data);
        } catch (e) { /* ambil di muka boleh gagal diam-diam */ }
      }
    })();
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loading, periodeList, hariIniServer, doApiCall]);

  // Muat ulang atas permintaan (tombol Refresh, tombol coba lagi).
  //
  // WAJIB dibungkus, tidak boleh dipasang langsung sebagai onClick:
  // React menyerahkan objek event sebagai argumen pertama, dan sejak
  // fetchData punya parameter (dari, sampai), event itu akan masuk
  // sebagai `dari` lalu ikut di-JSON.stringify — yang LANGSUNG melempar
  // karena SyntheticEvent punya acuan melingkar di dalamnya. Yang
  // terlihat pengguna: "Gagal terhubung ke Web App", padahal server
  // tidak pernah dihubungi sama sekali.
  const muatUlang = useCallback(() => {
    fetchData(filterTglMulai, filterTglSelesai, { paksa: true });
  }, [fetchData, filterTglMulai, filterTglSelesai]);

  // Rentang tanggal sekarang ikut turun ke server, jadi mengubahnya
  // berarti mengambil data lagi — bukan lagi menyaring yang sudah ada di
  // browser. Ditunda 400 ms supaya mengetik tanggal tidak menembakkan
  // satu permintaan per ketikan.
  useEffect(() => {
    if (!isAdmin) return undefined;
    const kunci = (filterTglMulai || '') + '|' + (filterTglSelesai || '');
    // Rentang ini sudah diminta — termasuk saat kotak tanggal barusan
    // diisi otomatis dari jawaban server.
    if (rentangTerakhir.current === kunci) return undefined;
    const jeda = setTimeout(() => {
      rentangTerakhir.current = kunci;
      fetchData(filterTglMulai, filterTglSelesai);
    }, 400);
    return () => clearTimeout(jeda);
  }, [isAdmin, fetchData, filterTglMulai, filterTglSelesai]);

  // Periode yang cocok dengan rentang tanggal saat ini (kalau ada). Rentang
  // tanggal tetap satu-satunya sumber kebenaran; pilihan periode hanya
  // cara cepat mengisinya, jadi semua tab & export otomatis ikut.
  const hariIni = hariIniServer || hariIniYMD();
  const periodeTerpilih = useMemo(() => {
    return periodeList.find(p => {
      if (filterTglMulai !== p.mulai) return false;
      const r = rentangPeriode(p, hariIni);
      return filterTglSelesai === r.sampai || filterTglSelesai === p.selesai;
    }) || null;
  }, [periodeList, filterTglMulai, filterTglSelesai, hariIni]);

  // Periode bawaan: yang memuat hari ini, kalau tidak ada yang terbaru.
  const periodeBawaan = useMemo(() => {
    return periodeList.find(p => periodeBerjalan(p, hariIni)) || periodeList[0] || null;
  }, [periodeList, hariIni]);

  const pilihPeriode = useCallback((nilai) => {
    if (nilai === '__SEMUA__') {
      setFilterTglMulai('');
      setFilterTglSelesai('');
      return;
    }
    const p = periodeList.find(x => x.id === nilai);
    if (!p) return;
    const r = rentangPeriode(p, hariIni);
    setFilterTglMulai(r.dari);
    setFilterTglSelesai(r.sampai);
  }, [periodeList, hariIni]);

  const labelRentangAktif = (filterTglMulai || filterTglSelesai)
    ? (tglPendek(filterTglMulai) || 'awal') + ' s/d ' + (tglPendek(filterTglSelesai) || 'akhir')
    : 'Semua data';

  const muatSemuaKoreksi = useCallback(async () => {
    setMemuatSemuaKoreksi(true);
    try {
      const data = await doApiCall('get_koreksi_list', {});
      if (data && data.result === 'success') setSemuaKoreksi(data.list || []);
      else tampilkanToast(data?.message || 'Gagal memuat histori koreksi.', 'galat');
    } catch (e) {
      tampilkanToast('Gagal memuat histori koreksi.', 'galat');
    } finally {
      setMemuatSemuaKoreksi(false);
    }
  }, [doApiCall, tampilkanToast]);

  useEffect(() => {
    if (activeTab === 'koreksi' && lingkupKoreksi === 'semua' && semuaKoreksi === null && !memuatSemuaKoreksi) {
      muatSemuaKoreksi();
    }
  }, [activeTab, lingkupKoreksi, semuaKoreksi, memuatSemuaKoreksi, muatSemuaKoreksi]);

  // Unique Departments
  const deptList = useMemo(() => {
    const s = new Set();
    dashboardData.forEach(d => { if (d.dept) s.add(d.dept); });
    rawRecords.forEach(r => { if (r.departemen) s.add(r.departemen); });
    return Array.from(s).sort();
  }, [dashboardData, rawRecords]);

  const masterPegawai = useMemo(() => {
    const map = new Map();
    const pushItem = (payroll, noAkun, nama, dept, jabatan) => {
      const pr = String(payroll || '').trim();
      const ak = String(noAkun || '').trim();
      const nm = String(nama || '').trim();
      if (!pr && !ak && !nm) return;
      const key = (pr || '').toLowerCase() + '|' + (ak || '').toLowerCase() + '|' + (nm || '').toLowerCase();
      if (map.has(key)) return;
      map.set(key, {
        payroll: pr,
        noAkun: ak,
        nama: nm,
        dept: String(dept || '').trim(),
        jabatan: String(jabatan || '').trim()
      });
    };
    rawRecords.forEach(r => pushItem(r.payroll, r.noAkun, r.nama, r.departemen, r.jabatan || ''));
    dashboardData.forEach(d => pushItem(d.payroll, d.noAkun, d.nama, d.dept, d.jabatan || ''));
    koreksiList.forEach(k => pushItem(k.payroll, k.noAkun, k.nama, k.dept || '', ''));
    return Array.from(map.values()).sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
  }, [rawRecords, dashboardData, koreksiList]);

  const filteredRawRecordsByDate = useMemo(() => {
    return rawRecords.filter(r => isDateInRange(r.tanggalYMD || r.tanggal, filterTglMulai, filterTglSelesai));
  }, [rawRecords, filterTglMulai, filterTglSelesai]);

  // Map employee payroll/akun/nama to their daily records for fast calculation & detail lookup
  const recordsByPayroll = useMemo(() => {
    const map = {};
    filteredRawRecordsByDate.forEach(r => {
      const keys = [
        String(r.payroll || '').trim().toLowerCase(),
        String(r.noAkun || '').trim().toLowerCase(),
        String(r.nama || '').trim().toLowerCase()
      ].filter(Boolean);

      keys.forEach(k => {
        if (!map[k]) map[k] = [];
        if (!map[k].includes(r)) map[k].push(r);
      });
    });
    return map;
  }, [filteredRawRecordsByDate]);

  const filteredKoreksiByDate = useMemo(() => {
    return koreksiList.filter(k => isKoreksiRangeOverlaps(k.tglMulai, k.tglSelesai || k.tglMulai, filterTglMulai, filterTglSelesai));
  }, [koreksiList, filterTglMulai, filterTglSelesai]);

  // Enriched Dashboard Data with calculated nominal & correct counts
  // ANGKA DASHBOARD — DARI SERVER, TIDAK DIHITUNG ULANG (19 Sep 2026)
  //
  // Di sini dulu ada rumus kedua yang mencacah ulang cuti/sakit/alpa/
  // ijin/telat/denda dari rawRecords setiap kali filter berubah. Rumus
  // itu TIDAK SAMA dengan rumus server: yang ini melewati baris
  // ber-koreksi lalu menghitung koreksi terpisah per hari, sementara
  // server mencacah semua baris apa adanya. Periode yang sama karena itu
  // bisa menunjukkan angka berbeda tergantung filternya kosong atau
  // tidak — pada angka yang dipakai menghitung gaji.
  //
  // Aturan yang benar (yang ini) sekarang dipakai di server, dan
  // rentangnya ikut dikirim ke sana. Satu definisi, satu jawaban.
  //
  // `hadir` ikut terperbaiki sekalian: rumus lama tidak pernah
  // menghitungnya ulang, jadi tampilan yang difilter satu minggu tetap
  // memperlihatkan jumlah hadir seluruh periode.
  const enrichedDashboardData = useMemo(() => dashboardData, [dashboardData]);

  // Filtered Raw Records (DB_FIX) with Multi-Token Comprehensive Search
  const filteredRecords = useMemo(() => {
    const queryTokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    return filteredRawRecordsByDate.filter(r => {
      const matchDept = filterDept === 'ALL' || r.departemen === filterDept;
      const matchSimbol = filterSimbol === 'ALL' || String(r.id2).toUpperCase() === filterSimbol.toUpperCase();
      const matchSumber = filterSumber === 'ALL' ||
        (filterSumber === 'online' ? adaOnline(r) : !adaOnline(r));

      if (!matchDept || !matchSimbol || !matchSumber) return false;
      if (queryTokens.length === 0) return true;

      const searchableText = [
        r.nama || '',
        r.payroll || '',
        r.noAkun || '',
        r.departemen || '',
        formatDateOnly(r.tanggal || r.tanggalYMD) || '',
        r.jamKerja || '',
        r.mTugas || '',
        r.aTugas || '',
        r.masuk || '',
        r.pulang || '',
        r.telat || '',
        r.id2 || '',
        r.week || '',
        r.koreksiKet || '',
        r.waktuScan || '',
        adaOnline(r) ? 'online' : 'mesin'
      ].join(' ').toLowerCase();

      return queryTokens.every(token => searchableText.includes(token));
    });
  }, [filteredRawRecordsByDate, filterDept, filterSimbol, filterSumber, searchQuery]);

  // Filtered Dashboard Data with Multi-Token Comprehensive Search
  const filteredDashboard = useMemo(() => {
    const queryTokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    return enrichedDashboardData.filter(d => {
      const matchDept = filterDept === 'ALL' || d.dept === filterDept;
      if (!matchDept) return false;
      if (queryTokens.length === 0) return true;

      const searchableText = [
        d.nama || '',
        d.payroll || '',
        d.dept || '',
        d.jabatan || ''
      ].join(' ').toLowerCase();

      return queryTokens.every(token => searchableText.includes(token));
    });
  }, [enrichedDashboardData, filterDept, searchQuery]);

  // Filtered Koreksi List with Multi-Token Comprehensive Search
  const filteredKoreksi = useMemo(() => {
    const queryTokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const sumber = (lingkupKoreksi === 'semua' && semuaKoreksi) ? semuaKoreksi : filteredKoreksiByDate;
    // Terbaru di atas: urut waktu input, lalu tanggal mulai.
    const urut = sumber.slice().sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
      String(b.tglMulai || '').localeCompare(String(a.tglMulai || '')));

    return urut.filter(k => {
      if (queryTokens.length === 0) return true;

      const searchableText = [
        k.nama || '',
        k.payroll || '',
        k.noAkun || '',
        k.keterangan || '',
        k.id2 || '',
        formatDateOnly(k.tglMulai) || '',
        formatDateOnly(k.tglSelesai) || ''
      ].join(' ').toLowerCase();

      return queryTokens.every(token => searchableText.includes(token));
    });
  }, [filteredKoreksiByDate, searchQuery, lingkupKoreksi, semuaKoreksi]);

  // Urut & cari per kolom untuk setiap tabel (di atas hasil pencarian umum).
  const urutDashboard = useUrutCari(filteredDashboard, KOLOM_DASHBOARD);
  const urutTabel = useUrutCari(filteredRecords, KOLOM_TABEL);
  const urutKoreksi = useUrutCari(filteredKoreksi, KOLOM_KOREKSI);
  const barisTabel = urutTabel.rows;
  useEffect(() => { setCurrentPage(1); }, [urutTabel.urut, urutTabel.cari]);
  useEffect(() => { setLayarPenuh(false); }, [activeTab]);
  useEffect(() => {
    if (!layarPenuh) return undefined;
    const tutup = (e) => { if (e.key === 'Escape') setLayarPenuh(false); };
    window.addEventListener('keydown', tutup);
    const semula = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', tutup);
      document.body.style.overflow = semula;
    };
  }, [layarPenuh]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalCuti = 0, totalSakit = 0, totalAlpa = 0, totalIjin = 0;
    let totalTelat = 0, totalTdkMasuk = 0, totalTdkPulang = 0;

    filteredDashboard.forEach(d => {
      totalCuti += Number(d.cutiDiambil) || 0;
      totalSakit += Number(d.sakit) || 0;
      totalAlpa += Number(d.alpa) || 0;
      totalIjin += Number(d.ijin) || 0;
      totalTelat += Number(d.telat) || 0;
      totalTdkMasuk += Number(d.tdkAbsenMasuk) || 0;
      totalTdkPulang += Number(d.tdkAbsenPulang) || 0;
    });

    return {
      karyawan: filteredDashboard.length,
      cuti: totalCuti,
      sakit: totalSakit,
      alpa: totalAlpa,
      ijin: totalIjin,
      telat: totalTelat,
      tdkMasuk: totalTdkMasuk,
      tdkPulang: totalTdkPulang,
      koreksiCount: filteredKoreksiByDate.length
    };
  }, [filteredDashboard, filteredKoreksiByDate]);

  // BOARD ABSENSI — matriks satu baris per karyawan, satu pasang kolom
  // (ABSEN | TELAT) per tanggal. Bentuknya mengikuti sheet BOARD pada
  // BOARD_ABSENSI_2026; aturannya ada di boardAbsensi.js.
  //
  // Sumbernya SENGAJA bukan filteredRecords: filter simbol di tab Tabel
  // membuang baris yang simbolnya tidak dipilih, dan matriks yang kehilangan
  // baris hanya akan memperlihatkan sel kosong pada hari yang sebenarnya
  // ada isinya. Board hanya ikut filter yang masuk akal untuknya —
  // departemen dan pencarian — sementara rentang tanggalnya sudah disaring
  // di server.
  const recordsUntukBoard = useMemo(() => {
    const queryTokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return filteredRawRecordsByDate.filter(r => {
      if (filterDept !== 'ALL' && r.departemen !== filterDept) return false;
      if (queryTokens.length === 0) return true;
      const teks = [r.nama || '', r.payroll || '', r.noAkun || '', r.departemen || '']
        .join(' ').toLowerCase();
      return queryTokens.every(token => teks.includes(token));
    });
  }, [filteredRawRecordsByDate, filterDept, searchQuery]);

  const boardData = useMemo(() => susunBoard({
    records: recordsUntukBoard,
    dashboard: filteredDashboard,
    dari: filterTglMulai,
    sampai: filterTglSelesai,
    hitungDenda: hitungDendaTelat
  }), [recordsUntukBoard, filteredDashboard, filterTglMulai, filterTglSelesai]);
  const urutBoard = useUrutCari(boardData.baris, KOLOM_BOARD_INFO);

  const getDetailCategoryRecords = useCallback((employee, category) => {
    if (!employee) return [];
    const prKey = String(employee.payroll || '').trim().toLowerCase();
    const akunKey = String(employee.noAkun || '').trim().toLowerCase();
    const namaKey = String(employee.nama || '').trim().toLowerCase();

    const records = (prKey && recordsByPayroll[prKey]) ||
                    (akunKey && recordsByPayroll[akunKey]) ||
                    (namaKey && recordsByPayroll[namaKey]) || [];

    const isMatchKoreksiSym = (sym) => {
      const s = String(sym || '').toUpperCase().trim();
      switch (category) {
        case 'CUTI':
          return ['C', 'CB', 'EO', 'CUTI', 'CUTI BERSAMA', 'CUTI EO', 'IJIN CUTI'].includes(s);
        case 'SAKIT':
          return ['S', 'SAKIT'].includes(s);
        case 'ALPA':
          return ['A', 'AC', 'ALPA'].includes(s);
        case 'IJIN':
          return ['I', 'IJIN'].includes(s);
        case 'TELAT':
          return ['T', 'TPC', 'TSI', 'TSO'].includes(s);
        default:
          return false;
      }
    };

    const expandKoreksiRange = (k) => {
      const start = k.tglMulai ? new Date(k.tglMulai) : null;
      const end = k.tglSelesai ? new Date(k.tglSelesai) : (k.tglMulai ? new Date(k.tglMulai) : null);
      if (!start || isNaN(start.getTime())) return [];
      const fStart = filterTglMulai ? new Date(filterTglMulai) : new Date(-8640000000000000);
      const fEnd = filterTglSelesai ? new Date(filterTglSelesai) : new Date(8640000000000000);
      const days = [];
      const cur = new Date(start);
      const last = end && !isNaN(end.getTime()) ? new Date(end) : new Date(start);
      while (cur <= last) {
        if (cur >= fStart && cur <= fEnd) {
          const ymd = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
          const weekdays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
          days.push({
            tanggal: ymd,
            tanggalYMD: ymd,
            week: weekdays[cur.getDay()],
            id2: k.id2 || '',
            koreksiKet: k.keterangan || '',
            catatan: k.keterangan || '',
            keterangan: k.keterangan || '',
            _fromKoreksi: true
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
      return days;
    };

    const employeeKoreksi = filteredKoreksiByDate.filter(k => {
      const kPr = String(k.payroll || '').trim().toLowerCase();
      const kAkun = String(k.noAkun || '').trim().toLowerCase();
      const kNama = String(k.nama || '').trim().toLowerCase();
      const matchEmployee = (prKey && kPr === prKey) || (akunKey && kAkun === akunKey) || (namaKey && kNama === namaKey);
      return matchEmployee && isMatchKoreksiSym(k.id2);
    });

    const koreksiExpanded = employeeKoreksi.flatMap(expandKoreksiRange);

    const filteredRaw = records.filter(r => {
      const sym = String(r.id2 || '').toUpperCase().trim();
      const hasTelat = Boolean(r.telat && r.telat !== '-' && r.telat !== '00:00' && r.telat !== '0');
      switch (category) {
        case 'CUTI':
          return ['C', 'CB', 'EO', 'CUTI', 'CUTI BERSAMA', 'CUTI EO', 'IJIN CUTI'].includes(sym);
        case 'SAKIT':
          return ['S', 'SAKIT'].includes(sym);
        case 'ALPA':
          return ['A', 'AC', 'ALPA'].includes(sym);
        case 'IJIN':
          return ['I', 'IJIN'].includes(sym);
        case 'TDK_MASUK':
          return ['SI', 'TSI', 'SISO', 'SIPC'].includes(sym);
        case 'TDK_PULANG':
          return ['SO', 'TSO', 'SISO'].includes(sym);
        case 'TELAT':
          return ['T', 'TPC', 'TSI', 'TSO'].includes(sym) || hasTelat;
        default:
          return true;
      }
    });

    const seenKeys = new Set(filteredRaw.map(r => (r.tanggalYMD || r.tanggal || '') + '|' + String(r.id2 || '').toUpperCase().trim()));
    const uniqueKoreksi = koreksiExpanded.filter(k => {
      const key = (k.tanggalYMD || k.tanggal || '') + '|' + String(k.id2 || '').toUpperCase().trim();
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const combined = [...filteredRaw, ...uniqueKoreksi];
    combined.sort((a, b) => {
      const da = a.tanggalYMD || a.tanggal || '';
      const db = b.tanggalYMD || b.tanggal || '';
      return String(da).localeCompare(String(db));
    });
    return combined;
  }, [recordsByPayroll, filteredKoreksiByDate, filterTglMulai, filterTglSelesai]);

  // Render Card to Canvas & Copy to Clipboard for WhatsApp
  const handleCopyCardImage = useCallback(async () => {
    if (!detailModalEmployee) return;
    const catRecords = getDetailCategoryRecords(detailModalEmployee, detailActiveCategory);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = 2; // High DPI / Retina
    const width = 640;
    const pad = 24;
    const headerH = 76;
    const tableHeadH = 32;
    const rowH = 28;
    const footerH = 38;
    const numRows = Math.max(1, catRecords.length);
    const height = pad * 2 + headerH + tableHeadH + (numRows * rowH) + footerH + 16;

    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.scale(scale, scale);

    // Background Card
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Outer Border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, width - 8, height - 8);

    // Top Header Banner
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(4, 4, width - 8, 56);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`KARTU RINCIAN: ${detailActiveCategory.replace('_', ' ')}`, pad, 28);

    // Subtitle
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${detailModalEmployee.nama}  •  ${detailModalEmployee.payroll}  •  ${detailModalEmployee.dept || '-'}`, pad, 46);

    // Table Columns
    const isTelat = detailActiveCategory === 'TELAT';
    const cols = [
      { title: 'NO', width: 36, align: 'center' },
      { title: 'TANGGAL', width: 120, align: 'left' },
      { title: 'HARI', width: 68, align: 'center' },
      { title: 'KODE', width: 68, align: 'center' }
    ];
    if (isTelat) {
      cols.push({ title: 'TELAT', width: 88, align: 'center' });
      if (showDetailNominal) {
        cols.push({ title: 'NOMINAL', width: 140, align: 'right' });
      }
    } else {
      cols.push({ title: 'KETERANGAN', width: 220, align: 'left' });
    }

    let curX = pad;
    const tableY = pad + headerH;

    // Header Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(pad, tableY, width - pad * 2, tableHeadH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(pad, tableY, width - pad * 2, tableHeadH);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 10.5px sans-serif';
    cols.forEach(col => {
      let tx = curX + 8;
      if (col.align === 'center') tx = curX + col.width / 2;
      if (col.align === 'right') tx = curX + col.width - 8;
      ctx.textAlign = col.align;
      ctx.fillText(col.title, tx, tableY + 20);
      curX += col.width;
    });

    // Rows
    let curY = tableY + tableHeadH;
    ctx.font = '11px sans-serif';

    if (catRecords.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('Tidak ada catatan pada kategori ini.', width / 2, curY + 18);
      curY += rowH;
    } else {
      catRecords.forEach((r, i) => {
        curX = pad;
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fafc';
        ctx.fillRect(pad, curY, width - pad * 2, rowH);
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(pad, curY, width - pad * 2, rowH);

        ctx.fillStyle = '#0f172a';
        const denda = hitungDendaTelat(r.telat, r.nominal);
        const values = [
          String(i + 1),
          formatDateOnly(r.tanggal || r.tanggalYMD),
          r.week || '-',
          r.id2 || '-'
        ];
        if (isTelat) {
          values.push(r.telat ? `${formatTimeValue(r.telat)}` : '-');
          if (showDetailNominal) {
            values.push(denda > 0 ? `Rp ${denda.toLocaleString('id-ID')}` : '-');
          }
        } else {
          values.push(r.koreksiKet || r.catatan || r.keterangan || (detailActiveCategory === 'CUTI' ? 'Cuti Diambil' : '-'));
        }

        cols.forEach((col, j) => {
          let tx = curX + 8;
          if (col.align === 'center') tx = curX + col.width / 2;
          if (col.align === 'right') tx = curX + col.width - 8;
          ctx.textAlign = col.align;
          ctx.fillText(values[j] || '-', tx, curY + 18);
          curX += col.width;
        });

        curY += rowH;
      });
    }

    // Summary Footer
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(pad, curY, width - pad * 2, footerH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(pad, curY, width - pad * 2, footerH);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`TOTAL: ${catRecords.length} Hari`, pad + 12, curY + 23);

    if (isTelat && showDetailNominal) {
      const totNom = catRecords.reduce((acc, curr) => acc + hitungDendaTelat(curr.telat, curr.nominal), 0);
      ctx.textAlign = 'right';
      ctx.fillText(`Total Denda: Rp ${totNom.toLocaleString('id-ID')}`, width - pad - 12, curY + 23);
    }

    // Watermark
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`E-Absensi • JPT Group • Digenerate otomatis`, width / 2, height - 10);

    // Convert to Blob & Copy to Clipboard
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopyImageSuccess(true);
          setTimeout(() => setCopyImageSuccess(false), 4000);
        } catch (err) {
          // Fallback download if clipboard access blocked
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `Kartu_${detailActiveCategory}_${detailModalEmployee.nama}.png`;
          a.click();
          alert('Gambar kartu berhasil diunduh (izin clipboard browser terbatas).');
        }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Kartu_${detailActiveCategory}_${detailModalEmployee.nama}.png`;
        a.click();
      }
    }, 'image/png');
  }, [detailModalEmployee, detailActiveCategory, showDetailNominal, getDetailCategoryRecords]);

  // Open Form Koreksi
  const handleOpenKoreksi = (item = null) => {
    if (item) {
      setEditKoreksiItem(item);
      setFormKoreksi({
        id: item.id,
        noAkun: item.noAkun || '',
        payroll: item.payroll || '',
        nama: item.nama || '',
        tglMulai: item.tglMulai || '',
        tglSelesai: item.tglSelesai || item.tglMulai || '',
        id2: simbolKoreksiAwal(item.id2),
        keterangan: item.keterangan || ''
      });
    } else {
      setEditKoreksiItem(null);
      setFormKoreksi({
        noAkun: '',
        payroll: '',
        nama: '',
        tglMulai: '',
        tglSelesai: '',
        id2: 'H',
        keterangan: ''
      });
    }
    setShowKoreksiModal(true);
  };

  // Koreksi yang SUDAH menutupi baris ini, kalau ada.
  //
  // Tanpa pencarian ini, tombol koreksi pada baris yang sudah terkoreksi
  // akan menumpuk koreksi kedua di atas yang pertama. Keduanya lalu
  // bersaing — yang menang cuma yang kebetulan lebih dulu ditemukan —
  // dan menghapus salah satunya tidak mengembalikan keadaan semula.
  const cariKoreksiCocok = useCallback((sumber, tgl) => {
    if (!tgl) return null;
    const pr = String(sumber.payroll || '').trim().toLowerCase();
    const ak = String(sumber.noAkun || '').trim().toLowerCase();
    const nm = String(sumber.nama || '').trim().toLowerCase();
    return koreksiList.find(k => {
      const cocokOrang = (pr && String(k.payroll || '').trim().toLowerCase() === pr) ||
                         (ak && String(k.noAkun  || '').trim().toLowerCase() === ak) ||
                         (nm && String(k.nama    || '').trim().toLowerCase() === nm);
      if (!cocokOrang) return false;
      const a = k.tglMulai || '';
      const b = k.tglSelesai || a;
      return a && tgl >= a && tgl <= b;
    }) || null;
  }, [koreksiList]);

  // Membuka form koreksi yang sudah terisi dari baris yang diklik.
  // Kalau baris itu sudah punya koreksi, yang dibuka adalah MODE EDIT
  // atas koreksi itu — bukan form kosong yang akan menambah satu lagi.
  const bukaKoreksiUntuk = useCallback((sumber, tglMulai, tglSelesai) => {
    const t1 = tglMulai || sumber.tanggalYMD || '';
    const adaKoreksi = cariKoreksiCocok(sumber, t1);
    if (adaKoreksi) {
      setEditKoreksiItem(adaKoreksi);
      setFormKoreksi({
        noAkun: adaKoreksi.noAkun || '',
        payroll: adaKoreksi.payroll || '',
        nama: adaKoreksi.nama || '',
        tglMulai: adaKoreksi.tglMulai || t1,
        tglSelesai: adaKoreksi.tglSelesai || adaKoreksi.tglMulai || t1,
        id2: simbolKoreksiAwal(adaKoreksi.id2),
        keterangan: adaKoreksi.keterangan || ''
      });
    } else {
      setEditKoreksiItem(null);
      setFormKoreksi({
        noAkun: sumber.noAkun || '',
        payroll: sumber.payroll || '',
        nama: sumber.nama || '',
        tglMulai: t1,
        tglSelesai: tglSelesai || t1,
        id2: simbolKoreksiAwal(sumber.id2),
        keterangan: ''
      });
    }
    setShowKoreksiModal(true);
  }, [cariKoreksiCocok]);

  // Submit Koreksi
  const handleSaveKoreksi = async (e) => {
    e.preventDefault();
    if (!formKoreksi.payroll && !formKoreksi.nama) {
      alert('Payroll atau Nama Karyawan wajib diisi.');
      return;
    }
    if (!formKoreksi.tglMulai) {
      alert('Tanggal Mulai wajib diisi.');
      return;
    }

    setSavingKoreksi(true);
    try {
      // koreksiId, bukan id: server menimpa `id` dengan ID user yang login.
      const payload = {
        koreksiId: editKoreksiItem ? editKoreksiItem.id : '',
        noAkun: formKoreksi.noAkun,
        payroll: formKoreksi.payroll,
        nama: formKoreksi.nama,
        tglMulai: formKoreksi.tglMulai,
        tglSelesai: formKoreksi.tglSelesai || formKoreksi.tglMulai,
        id2: simbolKoreksiAwal(formKoreksi.id2),
        keterangan: formKoreksi.keterangan
      };

      const data = await doApiCall('save_koreksi', payload);
      if (data && data.result === 'success') {
        setShowKoreksiModal(false);
        tampilkanToast(data.message || 'Koreksi berhasil disimpan.');
        // Server baru mengembalikan barisnya; server lama tidak — pakai
        // isian form sebagai gantinya.
        terapkanKoreksiLokal(data.koreksi || {
          ...payload,
          id: payload.koreksiId || ('KOR-' + Date.now()),
          id2: String(payload.id2 || 'H').toUpperCase()
        });
        // Rentang yang sedang ditampilkan HARUS ikut, kalau tidak
        // penyegaran ini diam-diam menarik seluruh periode dan filter di
        // layar tidak lagi cocok dengan isi tabelnya.
        rentangTerakhir.current = (filterTglMulai || '') + '|' + (filterTglSelesai || '');
        fetchData(filterTglMulai, filterTglSelesai, { paksa: true, diam: true });
      } else {
        tampilkanToast(data?.message || 'Gagal menyimpan koreksi. Pastikan script Google Apps Script terbaru sudah di-deploy.', 'galat');
      }
    } catch (err) {
      console.error(err);
      tampilkanToast('Gagal menghubungi server.', 'galat');
    } finally {
      setSavingKoreksi(false);
    }
  };

  // Delete Koreksi
  const handleDeleteKoreksi = async (id) => {
    if (!window.confirm('Yakin ingin menghapus data koreksi ini?')) return;
    setDeletingId(id);
    try {
      const data = await doApiCall('delete_koreksi', { koreksiId: id });
      if (data && data.result === 'success') {
        tampilkanToast('Koreksi berhasil dihapus.');
        hapusKoreksiLokal(id);
        rentangTerakhir.current = (filterTglMulai || '') + '|' + (filterTglSelesai || '');
        fetchData(filterTglMulai, filterTglSelesai, { paksa: true, diam: true });
      } else {
        tampilkanToast(data?.message || 'Gagal menghapus koreksi.', 'galat');
      }
    } catch (err) {
      console.error(err);
      tampilkanToast('Gagal menghubungi server.', 'galat');
    } finally {
      setDeletingId(null);
    }
  };

  // EXPORT EXCEL FUNCTIONS (19 Kolom Persis Sesuai Request)
  const exportToExcel = (mode) => {
    const wb = XLSX.utils.book_new();
    const timestamp = new Date().toISOString().slice(0, 10);

    if (mode === 'tabel' || mode === 'all') {
      const recRows = filteredRecords.map(r => {
        const dendaNum = hitungDendaTelat(r.telat, r.nominal);
        return {
          'NO AKUN': r.noAkun || '',
          'PAYROLL': r.payroll || '',
          'NAMA': r.nama || '',
          'TANGGAL': formatDateOnly(r.tanggal || r.tanggalYMD),
          'JAM KERJA': r.jamKerja || '',
          'M. TUGAS': formatTimeValue(r.mTugas),
          'A: TUGAS': formatTimeValue(r.aTugas),
          'MASUK': formatTimeValue(r.masuk),
          'PULANG': formatTimeValue(r.pulang),
          'TELAT': formatTimeValue(r.telat),
          'P. AWAL': formatTimeValue(r.pAwal),
          'BOLOS': r.bolos || '',
          'TJK': formatTimeValue(r.tjk),
          'ID2': r.id2 || '',
          'DEPARTEMEN': r.departemen || '',
          'ATT_TIME': formatTimeValue(r.attTime),
          'WAKTU SCAN': r.waktuScan || '',
          'WEEK': r.week || '',
          'NOMINAL': dendaNum > 0 ? dendaNum : '',
          'SUMBER': labelSumber(r.sumber).teks,
          'ONLINE MASUK': r.onlineMasuk || '',
          'ONLINE PULANG': r.onlinePulang || ''
        };
      });
      const wsRec = XLSX.utils.json_to_sheet(recRows);
      XLSX.utils.book_append_sheet(wb, wsRec, 'DB_FIX');
    }

    // Mode 'board' ikut menulis DASHBOARD supaya satu berkas memuat kedua
    // sheet persis seperti template BOARD_ABSENSI_2026 — DASHBOARD lebih
    // dulu, lalu BOARD.
    if (mode === 'dashboard' || mode === 'board' || mode === 'all') {
      const dashRows = filteredDashboard.map((d, idx) => ({
        'NO': idx + 1,
        'DEPT': d.dept || '',
        'NAMA': d.nama || '',
        'JABATAN': d.jabatan || '',
        'PAYROLL': d.payroll || '',
        'SISA CUTI': d.sisaCuti,
        'CUTI DIAMBIL': d.cutiDiambil || '',
        'SAKIT': d.sakit || '',
        'ALPA': d.alpa || '',
        'IJIN': d.ijin || '',
        'TDK ABSEN MASUK': d.tdkAbsenMasuk || '',
        'TDK ABSEN PULANG': d.tdkAbsenPulang || '',
        'TELAT': d.telat || '',
        'NOMINAL TERLAMBAT': d.nominalTerlambat || ''
      }));
      const wsDash = XLSX.utils.json_to_sheet(dashRows);
      XLSX.utils.book_append_sheet(wb, wsDash, 'DASHBOARD');
    }

    if (mode === 'board' || mode === 'all') {
      // Sheet BOARD ditulis sebagai array-of-arrays, bukan json_to_sheet:
      // headernya dua baris dengan sel gabungan, dan json_to_sheet hanya
      // bisa satu baris header dari nama properti. Susunan sel, merge, dan
      // lebar kolomnya disiapkan boardKeSheet() supaya bentuk yang dipakai
      // layar dan yang dipakai file ini berasal dari satu tempat.
      const { aoa, merges, lebarKolom } = boardKeSheet(boardData);
      const wsBoard = XLSX.utils.aoa_to_sheet(aoa);
      wsBoard['!merges'] = merges;
      wsBoard['!cols'] = lebarKolom;
      // Pembekuan panel TIDAK ditulis: xlsx 0.18.5 edisi komunitas tidak
      // menulis elemen <pane>, jadi memasang '!freeze' hanya akan diam-diam
      // diabaikan. Di layar, kolom kiri dan header tetap menempel.
      XLSX.utils.book_append_sheet(wb, wsBoard, 'BOARD');
    }

    if (mode === 'koreksi' || mode === 'all') {
      const korRows = filteredKoreksi.map((k, idx) => ({
        'NO': idx + 1,
        'NO AKUN': k.noAkun || '',
        'PAYROLL': k.payroll || '',
        'NAMA': k.nama || '',
        'TGL MULAI': formatDateOnly(k.tglMulai),
        'TGL SELESAI': formatDateOnly(k.tglSelesai || k.tglMulai),
        'ID2': k.id2 || '',
        'KETERANGAN': k.keterangan || '',
        'WAKTU INPUT': k.createdAt || ''
      }));
      const wsKor = XLSX.utils.json_to_sheet(korRows);
      XLSX.utils.book_append_sheet(wb, wsKor, 'KOREKSI');
    }

    const akhiranPeriode = (filterTglMulai || filterTglSelesai)
      ? `_PERIODE_${filterTglMulai || 'awal'}_sd_${filterTglSelesai || 'akhir'}`
      : '_SEMUA_PERIODE';
    const filename = (mode === 'all'
      ? `DATABASE_ABSENSI_LENGKAP_${timestamp}.xlsx`
      : mode === 'board'
        ? `BOARD_ABSENSI_${timestamp}.xlsx`
      : mode === 'dashboard'
        ? `REKAP_DASHBOARD_ABSENSI_${timestamp}.xlsx`
        : mode === 'koreksi'
          ? `DATA_KOREKSI_ABSENSI_${timestamp}.xlsx`
          : `DATA_ABSENSI_DB_FIX_${timestamp}.xlsx`).replace(/\.xlsx$/, akhiranPeriode + '.xlsx');

    XLSX.writeFile(wb, filename);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <ShieldAlert className="w-16 h-16 text-rose-500 mb-4" />
        <h2 className="text-2xl font-black mb-2">Akses Terbatas</h2>
        <p className="text-slate-400 text-sm max-w-sm mb-6">
          Menu Rekapitulasi, Koreksi, dan Export Excel hanya dapat diakses oleh Administrator.
        </p>
        <button
          onClick={() => setView('dashboard')}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 font-bold rounded-xl text-sm"
        >
          Kembali ke Dashboard
        </button>
      </div>
    );
  }

  const activeCategoryRecords = detailModalEmployee ? getDetailCategoryRecords(detailModalEmployee, detailActiveCategory) : [];

  // Kotak pencarian umum + filter, diletakkan tepat di atas kepala tabel
  // pada setiap tab (dulu di kartu filter paling atas).
  const barPencarian = (
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 w-full">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari spesifik: nama pegawai, payroll, no akun, departemen, tanggal, dll..."
                className="w-full pl-10 pr-10 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                  title="Hapus pencarian"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <Building className="w-4 h-4 text-slate-400" />
                <select
                  value={filterDept}
                  onChange={e => setFilterDept(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                >
                  <option value="ALL">Semua Departemen ({deptList.length})</option>
                  {deptList.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {activeTab === 'tabel' && (
                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <Tag className="w-4 h-4 text-slate-400" />
                  <select
                    value={filterSimbol}
                    onChange={e => setFilterSimbol(e.target.value)}
                    className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                  >
                    <option value="ALL">Semua Simbol</option>
                    {OPSI_SIMBOL_KOREKSI.map(o => (
                      <option key={o.kode} value={o.kode}>{o.kode} - {o.label.split(' - ')[1]}</option>
                    ))}
                    <option value="Si">Si - Tidak Absen Masuk</option>
                    <option value="So">So - Tidak Absen Pulang</option>
                  </select>
                </div>
              )}

              {activeTab === 'tabel' && (
                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <Layers className="w-4 h-4 text-slate-400" />
                  <select
                    value={filterSumber}
                    onChange={e => setFilterSumber(e.target.value)}
                    className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                  >
                    <option value="ALL">Semua Sumber</option>
                    <option value="mesin">Mesin saja</option>
                    <option value="online">Ada Absen Online</option>
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => setLayarPenuh(v => !v)}
                title={layarPenuh ? 'Keluar layar penuh (Esc)' : 'Tampilkan tabel layar penuh'}
                className={`p-2 rounded-xl border transition active:scale-95 ${layarPenuh ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                {layarPenuh ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
  );

  // Kartu tabel & area gulirnya — normal atau layar penuh.
  // z-40: di atas header halaman (z-30), di bawah modal (z-50).
  const kelasKartu = layarPenuh
    ? 'fixed inset-0 z-40 bg-white flex flex-col overflow-hidden'
    : 'bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden w-full flex flex-col';
  const kelasGulir = layarPenuh
    ? 'overflow-auto w-full flex-1 min-h-0'
    : 'overflow-auto w-full max-h-[calc(100vh-200px)] min-h-[420px]';

  return (
    <div className="min-h-screen bg-slate-100 pb-20 font-sans w-full">
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-3 rounded-2xl shadow-xl text-sm font-bold flex items-center gap-2 ${
          toast.jenis === 'galat' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
        }`}>
          {toast.jenis === 'galat' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{toast.teks}</span>
        </div>
      )}
      {menyegarkan && (
        <div className="fixed top-3 right-3 z-[80] px-3 py-1.5 rounded-full bg-white/95 border border-slate-200 shadow text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Memperbarui angka rekap…
        </div>
      )}
      
      {/* TOP HEADER - FULL WIDTH */}
      <header className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white border-b border-slate-800 p-4 sm:p-5 shadow-xl sticky top-0 z-30 w-full">
        <div className="w-full px-3 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest bg-cyan-400/10 px-2 py-0.5 rounded-full border border-cyan-400/20">Admin Area</span>
                <span className="text-[10px] text-slate-400 font-mono">DATABASE ABSENSI</span>
              </div>
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-white mt-0.5">
                Rekapitulasi, Koreksi & Export Excel
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => muatUlang()}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white flex items-center gap-2 transition active:scale-95 disabled:opacity-50"
              title="Refresh data dari server"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Data</span>
            </button>

            <button
              onClick={() => exportToExcel('all')}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition active:scale-95"
              title="Download Excel Semua Sheet (DASHBOARD, KOREKSI, DB_FIX)"
            >
              <Download className="w-4 h-4" />
              <span>Export Full Excel (.xlsx)</span>
            </button>

            <BackButton onClick={() => setView('dashboard')} />
          </div>
        </div>

        {/* SUB NAVIGATION TABS */}
        <div className="w-full px-3 sm:px-6 lg:px-8 mt-4 flex gap-2 border-t border-slate-800/80 pt-3.5 overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <PieChart className="w-4 h-4" />
            <span>Dashboard Rekapitulasi</span>
          </button>

          <button
            onClick={() => setActiveTab('koreksi')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition whitespace-nowrap ${
              activeTab === 'koreksi'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            <span>Koreksi Data Absensi</span>
            {koreksiList.length > 0 && (
              <span className="bg-amber-400 text-slate-950 text-[10px] px-1.5 py-0.5 rounded-full font-black ml-1">
                {koreksiList.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('board')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition whitespace-nowrap ${
              activeTab === 'board'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            <span>Board Absensi Harian</span>
          </button>

          <button
            onClick={() => setActiveTab('tabel')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition whitespace-nowrap ${
              activeTab === 'tabel'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Tabel Data (DB_FIX)</span>
          </button>
        </div>
      </header>

      {/* MAIN CONTAINER - FULL WIDTH DESKTOP */}
      <main className="w-full px-2 sm:px-3 lg:px-4 pt-4 space-y-4">

        {/* SERVER ERROR BANNER */}
        {serverError && (
          <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 sm:p-5 shadow-sm animate-in fade-in duration-200 w-full">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-amber-900 leading-tight">
                  Perlu Deployment Google Apps Script Terbaru
                </h3>
                <p className="text-xs text-amber-800 leading-relaxed mt-1">
                  Pesan server: <em>{serverError}</em>
                </p>
                <div className="mt-3 p-3 bg-white/80 rounded-xl border border-amber-200 text-xs text-slate-700 space-y-1.5">
                  <p className="font-semibold text-slate-900">Langkah penyelesaian:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                    <li>Buka Spreadsheet Anda &rarr; <strong>Ekstensi &gt; Apps Script</strong>.</li>
                    <li>Salin isi berkas <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono text-[11px]">apps-script/Auth.gs</code> dan <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono text-[11px]">apps-script/Code.gs</code> ke editor Apps Script.</li>
                    <li>Klik <strong>Deploy &gt; Kelola deployment &gt; Ikon Pensil &gt; Versi: Versi Baru &gt; Deploy</strong>.</li>
                  </ol>
                </div>
                <button
                  onClick={() => muatUlang()}
                  disabled={loading}
                  className="mt-3.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-50"
                >
                  <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Coba Muat Ulang Data</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* FILTER PERIODE — kotak pencarian pindah ke atas kepala tiap tabel */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-3 w-full">
          <div className="flex flex-wrap items-end gap-2.5 w-full">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Periode Aktif
              </label>
              <div className="flex items-center gap-1.5 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-200">
                <CalendarDays className="w-3.5 h-3.5 text-blue-500" />
                <select
                  value={periodeTerpilih ? periodeTerpilih.id : ((filterTglMulai || filterTglSelesai) ? '__MANUAL__' : '__SEMUA__')}
                  onChange={e => pilihPeriode(e.target.value)}
                  className="bg-transparent text-xs font-bold text-blue-800 outline-none cursor-pointer min-w-[220px]"
                >
                  {periodeList.map(p => (
                    <option key={p.id} value={p.id}>
                      {tglPendek(p.mulai)} – {tglPendek(p.selesai)}{periodeBerjalan(p, hariIni) ? ' (berjalan)' : ''}
                    </option>
                  ))}
                  <option value="__MANUAL__" disabled>Rentang manual</option>
                  <option value="__SEMUA__">Semua data (tanpa batas)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Periode Mulai
              </label>
              <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <PieChart className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="date"
                  value={filterTglMulai}
                  onChange={e => setFilterTglMulai(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer w-[140px]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Sampai Dengan
              </label>
              <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <Sparkles className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="date"
                  value={filterTglSelesai}
                  onChange={e => setFilterTglSelesai(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer w-[140px]"
                />
              </div>
            </div>
            {periodeBawaan && periodeTerpilih?.id !== periodeBawaan.id && (
              <button
                onClick={() => pilihPeriode(periodeBawaan.id)}
                title="Kembali ke periode yang sedang berjalan, sampai hari ini"
                className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 text-[11px] font-bold flex items-center gap-1.5 transition"
              >
                <X className="w-3.5 h-3.5" /> Reset ke Periode Aktif
              </button>
            )}
            <div className="ml-auto text-[11px] font-semibold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              Menampilkan data: <span className="text-slate-800">{labelRentangAktif}</span>
              {periodeTerpilih && (
                <span className="text-blue-700"> · periode {tglPendek(periodeTerpilih.mulai)} – {tglPendek(periodeTerpilih.selesai)}</span>
              )}
            </div>
          </div>
        </div>

        {/* TAB 1: DASHBOARD REKAPITULASI (WITH SISA CUTI, CUTI DIAMBIL, NOMINAL TELAT & VIEW BUTTON) */}
        {activeTab === 'dashboard' && (
          <div className="space-y-5 w-full">
            
            {/* KPI METRIC CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4 w-full">
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Pegawai</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{metrics.karyawan}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Pegawai terdata</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <p className="text-[11px] font-semibold text-teal-600 uppercase tracking-wider">Cuti Diambil</p>
                <p className="text-2xl font-black text-teal-600 mt-1">{metrics.cuti}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Hari cuti</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <p className="text-[11px] font-semibold text-fuchsia-600 uppercase tracking-wider">Sakit</p>
                <p className="text-2xl font-black text-fuchsia-600 mt-1">{metrics.sakit}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Hari sakit</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">Ijin</p>
                <p className="text-2xl font-black text-blue-600 mt-1">{metrics.ijin}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Hari izin</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <p className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider">Alpa</p>
                <p className="text-2xl font-black text-rose-600 mt-1">{metrics.alpa}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Tanpa ket.</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">Terlambat</p>
                <p className="text-2xl font-black text-amber-600 mt-1">{metrics.telat}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Total telat</p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm col-span-2 sm:col-span-2 lg:col-span-1">
                <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-wider">Koreksi Aktif</p>
                <p className="text-2xl font-black text-orange-600 mt-1">{metrics.koreksiCount}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Data override</p>
              </div>
            </div>

            {/* REKAP TABLE */}
            <div className={kelasKartu}>
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                <div>
                  <h2 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                    Tabel Rekapitulasi Absensi Pegawai (DASHBOARD)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Data agregasi terhitung otomatis setelah digabungkan dengan data koreksi. Klik <strong>View</strong> untuk membuka rincian & capture gambar.
                  </p>
                </div>
                <button
                  onClick={() => exportToExcel('dashboard')}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition active:scale-95 shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Excel Dashboard</span>
                </button>
              </div>

              <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-white flex flex-col gap-2">
                {barPencarian}
                <div className="flex justify-end empty:hidden"><TombolResetKolom state={urutDashboard} /></div>
              </div>
              <div className={kelasGulir}>
                <table onMouseOver={tooltipSelTerpotong} className="tabel-rekap text-left text-xs border-collapse" style={{ minWidth: lebarTotal(KOLOM_DASHBOARD) }}>
                  <colgroup>
                    {KOLOM_DASHBOARD.map(k => <col key={k.key} style={{ width: k.lebar }} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-slate-600 font-bold text-[10px] whitespace-nowrap">
                      {KOLOM_DASHBOARD.map(k => (
                        <th key={k.key} className={`px-2 py-2.5 border-r border-slate-200/50 bg-slate-50 ${TH_STICKY} ${k.kelas || ''}`}>
                          <IsiKepala kolom={k} state={urutDashboard} align={k.align} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan="15" className="p-8 text-center text-slate-400">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                          <span>Memuat data rekapitulasi...</span>
                        </td>
                      </tr>
                    ) : urutDashboard.rows.length === 0 ? (
                      <tr>
                        <td colSpan="15" className="p-8 text-center text-slate-400">
                          {serverError ? 'Data belum dapat dimuat dari server.' : 'Tidak ada data rekap yang sesuai filter.'}
                        </td>
                      </tr>
                    ) : (
                      urutDashboard.rows.map((d, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/40 transition-colors whitespace-nowrap">
                          <td className="p-3 text-center text-slate-400 font-mono border-r border-slate-100">{idx + 1}</td>
                          <td className="p-3 font-semibold text-slate-800 border-r border-slate-100">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px]">
                              {d.dept || '-'}
                            </span>
                          </td>
                          <td className="p-3 font-bold text-slate-900 border-r border-slate-100">{d.nama || '-'}</td>
                          <td className="p-3 text-slate-500 border-r border-slate-100">{d.jabatan || '-'}</td>
                          <td className="p-3 font-mono text-slate-600 border-r border-slate-100">{d.payroll || '-'}</td>
                          
                          {/* SISA CUTI */}
                          <td className="p-3 text-center font-bold text-slate-800 border-r border-slate-100 bg-slate-50/50">
                            {d.sisaCuti}
                          </td>
                          
                          {/* CUTI DIAMBIL */}
                          <td className="p-3 text-center font-bold text-teal-600 bg-teal-50/30 border-r border-slate-100">
                            {d.cutiDiambil > 0 ? d.cutiDiambil : (d.cutiDiambil === 0 ? 0 : '-')}
                          </td>
                          
                          <td className="p-3 text-center font-bold text-fuchsia-600 bg-fuchsia-50/30 border-r border-slate-100">{d.sakit || '-'}</td>
                          <td className="p-3 text-center font-bold text-rose-600 bg-rose-50/30 border-r border-slate-100">{d.alpa || '-'}</td>
                          <td className="p-3 text-center font-bold text-blue-600 bg-blue-50/30 border-r border-slate-100">{d.ijin || '-'}</td>
                          <td className="p-3 text-center text-slate-600 border-r border-slate-100">{d.tdkAbsenMasuk || '-'}</td>
                          <td className="p-3 text-center text-slate-600 border-r border-slate-100">{d.tdkAbsenPulang || '-'}</td>
                          <td className="p-3 text-center font-bold text-amber-600 bg-amber-50/30 border-r border-slate-100">{d.telat || '-'}</td>
                          
                          {/* NOMINAL TERLAMBAT */}
                          <td className="p-3 text-right font-mono font-bold text-amber-700 border-r border-slate-100">
                            {d.nominalTerlambat > 0 ? (
                              <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200">
                                Rp {formatNominal(d.nominalTerlambat)}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>

                          {/* ACTION VIEW / KARTU DETAIL */}
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => {
                                  setDetailModalEmployee(d);
                                  setDetailActiveCategory('TELAT');
                                  setShowDetailNominal(true);
                                }}
                                title="View — rincian & capture kartu"
                                aria-label="View"
                                className="p-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-200/80 transition active:scale-95 shadow-sm"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {/* Baris dashboard adalah RINGKASAN satu orang, bukan satu
                                  hari — jadi tanggalnya diambil dari rentang yang sedang
                                  ditampilkan. Admin tinggal mempersempitnya di form. */}
                              <button
                                type="button"
                                onClick={() => bukaKoreksiUntuk(d, filterTglMulai, filterTglSelesai)}
                                title="Buat koreksi untuk pegawai ini"
                                aria-label="Koreksi"
                                className="p-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white border border-amber-200/80 transition active:scale-95 shadow-sm"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB BOARD: MATRIKS ABSENSI HARIAN (mengikuti sheet BOARD template) */}
        {activeTab === 'board' && (
          <div className="space-y-4 w-full">
            <div className={kelasKartu}>

              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="truncate">{boardData.judul}</span>
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {boardData.baris.length} pegawai &middot; {boardData.tanggal.length} hari &middot;
                    {' '}satu pasang kolom per tanggal (ABSEN &amp; TELAT), sama seperti template BOARD_ABSENSI_2026.
                  </p>
                </div>
                <button
                  onClick={() => exportToExcel('board')}
                  disabled={boardData.baris.length === 0}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-xs font-bold text-white flex items-center gap-2 shadow-sm transition active:scale-95 shrink-0"
                  title="Download Excel berisi sheet DASHBOARD dan sheet BOARD"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Excel (DASHBOARD + BOARD)</span>
                </button>
              </div>

              {boardData.terpotong && (
                <div className="mx-4 sm:mx-5 mt-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-900 leading-relaxed">
                    Rentang yang dipilih {boardData.totalHari} hari, melebihi batas {BOARD_MAKS_HARI} kolom tanggal.
                    Board menampilkan {boardData.tanggal.length} hari pertama saja &mdash; persempit filter tanggal
                    untuk melihat sisanya. Batas ini juga berlaku pada berkas yang di-download.
                  </p>
                </div>
              )}

              {/* PENCARIAN — tepat di atas kepala tabel */}
              <div className="px-4 sm:px-5 pt-4 flex flex-col gap-2">
                {barPencarian}
                <div className="flex justify-end empty:hidden"><TombolResetKolom state={urutBoard} /></div>
              </div>

              {/* KETERANGAN SIMBOL */}
              <div className="px-4 sm:px-5 pt-4 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Simbol</span>
                {OPSI_SIMBOL_KOREKSI.map(o => (
                  <span
                    key={o.kode}
                    title={o.label}
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${o.color}`}
                  >
                    {o.kode}
                  </span>
                ))}
              </div>

              {/* MATRIKS. Header dua baris dan empat kolom kiri menempel saat
                  digulir — pengganti freeze pane, yang tidak bisa ditulis ke
                  berkas xlsx oleh pustaka edisi komunitas. */}
              <div className={layarPenuh ? 'p-3 flex-1 min-h-0 flex flex-col' : 'p-4 sm:p-5'}>
                <div className={`overflow-auto border border-slate-200 rounded-xl ${layarPenuh ? 'flex-1 min-h-0' : 'max-h-[calc(100vh-200px)] min-h-[420px]'}`}>
                  <table className="text-left border-collapse min-w-max text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                        {BOARD_KOLOM_INFO.map((h, i) => (
                          <th
                            key={h}
                            rowSpan={2}
                            style={i < 4 ? { left: BOARD_OFFSET_KIRI[i], minWidth: BOARD_LEBAR_INFO[i], maxWidth: BOARD_LEBAR_INFO[i] } : { minWidth: BOARD_LEBAR_INFO[i], maxWidth: BOARD_LEBAR_INFO[i] }}
                            className={`p-2 border-r border-b border-slate-200 bg-slate-100 sticky top-0 align-middle ${i < 4 ? 'z-30' : 'z-20'}`}
                          >
                            <IsiKepala kolom={KOLOM_BOARD_INFO[i] || { key: h, label: h, aksi: false }} state={urutBoard} />
                          </th>
                        ))}
                        {boardData.tanggal.map(t => (
                          <th
                            key={t}
                            colSpan={2}
                            className="p-1.5 h-[62px] border-r border-b border-slate-200 bg-slate-100 sticky top-0 z-20 text-center whitespace-nowrap"
                          >
                            {labelTanggalPendek(t)}
                          </th>
                        ))}
                        <th
                          colSpan={BOARD_KODE_HITUNG.length}
                          className="p-1.5 h-[62px] border-r border-b border-slate-200 bg-slate-200 sticky top-0 z-20 text-center whitespace-nowrap"
                        >
                          Ketidakhadiran
                        </th>
                      </tr>
                      <tr className="bg-slate-50 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                        {boardData.tanggal.map(t => (
                          <React.Fragment key={t}>
                            <th className="px-1 py-1 border-r border-b border-slate-200 bg-slate-50 sticky top-[62px] z-20 text-center" style={{ minWidth: 34 }}>Absen</th>
                            <th className="px-1 py-1 border-r border-b border-slate-200 bg-slate-50 sticky top-[62px] z-20 text-center" style={{ minWidth: 52 }}>Telat</th>
                          </React.Fragment>
                        ))}
                        {BOARD_KODE_HITUNG.map(k => (
                          <th
                            key={k.kode}
                            title={k.judul}
                            className="px-1 py-1 border-r border-b border-slate-200 bg-slate-100 sticky top-[62px] z-20 text-center"
                            style={{ minWidth: 34 }}
                          >
                            {k.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        <tr>
                          <td colSpan={BOARD_KOLOM_INFO.length + boardData.tanggal.length * 2 + BOARD_KODE_HITUNG.length} className="p-8 text-center text-slate-400">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                            <span>Menyusun board absensi...</span>
                          </td>
                        </tr>
                      ) : urutBoard.rows.length === 0 ? (
                        <tr>
                          <td colSpan={Math.max(BOARD_KOLOM_INFO.length + boardData.tanggal.length * 2 + BOARD_KODE_HITUNG.length, 1)} className="p-8 text-center text-slate-400">
                            {serverError
                              ? 'Data belum dapat dimuat dari server.'
                              : (boardData.tanggal.length === 0
                                  ? 'Isi rentang tanggal pada filter di atas untuk menyusun board.'
                                  : 'Tidak ada data absensi yang sesuai filter.')}
                          </td>
                        </tr>
                      ) : (
                        urutBoard.rows.map(o => (
                          <tr key={o.payroll + '|' + o.nama} className="hover:bg-blue-50/40 transition-colors">
                            {/* Kolom info: lebar dikunci & teks dipotong (…) supaya
                                kolom yang menempel di kiri tidak bergeser. */}
                            {[
                              ['no', o.no, 'text-center font-mono text-slate-400'],
                              ['payroll', o.payroll, 'font-mono text-slate-600'],
                              ['hrd', o.hrd, 'text-slate-400 text-center'],
                              ['nama', o.nama, 'font-bold text-slate-900'],
                              ['pt', o.pt, 'text-slate-600'],
                              ['tglMasuk', o.tglMasuk, 'text-slate-400 text-center'],
                              ['jabatan', o.jabatan, 'text-slate-500'],
                              ['atasan', o.atasan, 'text-slate-400'],
                              ['hariKerja', o.hariKerja, 'text-center font-bold text-slate-800 bg-slate-50/60']
                            ].map(([key, isi, kelas], i) => (
                              <td
                                key={key}
                                title={isi === undefined || isi === null || isi === '' ? '' : String(isi)}
                                style={i < 4
                                  ? { left: BOARD_OFFSET_KIRI[i], minWidth: BOARD_LEBAR_INFO[i], maxWidth: BOARD_LEBAR_INFO[i] }
                                  : { minWidth: BOARD_LEBAR_INFO[i], maxWidth: BOARD_LEBAR_INFO[i] }}
                                className={`p-2 border-r border-slate-100 whitespace-nowrap overflow-hidden text-ellipsis ${kelas} ${i < 4 ? 'bg-white sticky z-10' : ''}`}
                              >
                                {isi === undefined || isi === null || isi === '' ? (key === 'hariKerja' ? isi : '-') : isi}
                              </td>
                            ))}

                            {boardData.tanggal.map((t, i) => {
                              const sel = o.sel[i];
                              const sym = sel && sel.absen ? sel.absen : '';
                              return (
                                <React.Fragment key={t}>
                                  <td className="px-1 py-1.5 border-r border-slate-100 text-center">
                                    {sym ? (
                                      <span
                                        title={sel.koreksi ? sym + ' (hasil koreksi)' : sym}
                                        className={`inline-block min-w-[22px] px-1 py-0.5 rounded border text-[10px] font-bold ${warnaSimbolBoard(sym)} ${sel.koreksi ? 'ring-1 ring-amber-400' : ''}`}
                                      >
                                        {sym}
                                      </span>
                                    ) : (
                                      <span className="text-slate-200">&middot;</span>
                                    )}
                                  </td>
                                  <td className="px-1 py-1.5 border-r border-slate-100 text-center font-mono text-[10px] text-amber-700 whitespace-nowrap">
                                    {sel && sel.denda ? formatNominal(sel.denda) : ''}
                                  </td>
                                </React.Fragment>
                              );
                            })}

                            {BOARD_KODE_HITUNG.map(k => (
                              <td key={k.kode} className="px-1 py-1.5 border-r border-slate-100 text-center font-bold bg-slate-50/60 text-slate-700">
                                {o.hitung[k.kode] || <span className="text-slate-300">0</span>}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TABEL DATA HARIAN (DB_FIX) - EXACT 19 COLUMNS FULL WIDTH */}
        {activeTab === 'tabel' && (
          <div className="space-y-4 w-full">
            <div className={kelasKartu}>
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <h2 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                      Tabel Data Harian Absensi (DB_FIX)
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Struktur 19 kolom sesuai Google Spreadsheet <span className="font-mono font-semibold text-slate-700">DB_FIX</span>, digabung dengan absen online (kolom SUMBER). Menampilkan {barisTabel.length} baris.
                  </p>
                </div>
                <button
                  onClick={() => exportToExcel('tabel')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition active:scale-95 shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Excel DB_FIX (.xlsx)</span>
                </button>
              </div>

              <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-white flex flex-col gap-2">
                {barPencarian}
                <div className="flex justify-end empty:hidden"><TombolResetKolom state={urutTabel} /></div>
              </div>
              <div className={kelasGulir}>
                <table onMouseOver={tooltipSelTerpotong} className="tabel-rekap text-left text-xs border-collapse" style={{ minWidth: lebarTotal(KOLOM_TABEL) }}>
                  <colgroup>
                    {KOLOM_TABEL.map(k => <col key={k.key} style={{ width: k.lebar }} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-slate-700 font-bold text-[10.5px] whitespace-nowrap">
                      {KOLOM_TABEL.map(k => (
                        <th key={k.key} className={`px-2 py-2.5 border-r border-emerald-200/50 bg-emerald-50 ${TH_STICKY} ${k.kelas || ''}`}>
                          <IsiKepala kolom={k} state={urutTabel} align={k.align} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {loading ? (
                      <tr>
                        <td colSpan="21" className="p-10 text-center text-slate-400">
                          <Loader2 className="w-7 h-7 animate-spin mx-auto text-blue-500 mb-2" />
                          <span>Memuat tabel data absensi DB_FIX...</span>
                        </td>
                      </tr>
                    ) : barisTabel.length === 0 ? (
                      <tr>
                        <td colSpan="21" className="p-10 text-center text-slate-400">
                          {serverError ? 'Data belum dapat dimuat dari server.' : 'Tidak ada data absensi yang cocok dengan pencarian / filter.'}
                        </td>
                      </tr>
                    ) : (
                      barisTabel.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((r, idx) => {
                        const opt = OPSI_SIMBOL_KOREKSI.find(o => o.kode === r.id2);
                        const hasTelat = Boolean(r.telat && r.telat !== '-' && r.telat !== '00:00' && r.telat !== '0');
                        const nominalDenda = hitungDendaTelat(r.telat, r.nominal);
                        return (
                          <tr key={idx} className={`hover:bg-blue-50/40 transition-colors whitespace-nowrap text-[12px] ${r.isKoreksi ? 'bg-amber-50/30' : ''}`}>
                            <td className="px-2 py-2.5 text-center font-mono text-slate-600 border-r border-slate-100">{r.noAkun || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-800 border-r border-slate-100">{r.payroll || '-'}</td>
                            <td className="px-2 py-2.5 font-bold text-slate-900 border-r border-slate-100">{r.nama || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono text-slate-700 border-r border-slate-100">{formatDateOnly(r.tanggal || r.tanggalYMD)}</td>
                            <td className="px-2 py-2.5 text-slate-700 font-mono border-r border-slate-100">{r.jamKerja || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono text-slate-600 border-r border-slate-100">{formatTimeValue(r.mTugas) || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono text-slate-600 border-r border-slate-100">{formatTimeValue(r.aTugas) || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono font-bold text-emerald-600 border-r border-slate-100">{formatTimeValue(r.masuk) || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono font-bold text-rose-600 border-r border-slate-100">{formatTimeValue(r.pulang) || '-'}</td>
                            
                            {/* TELAT CELL WITH HIGHLIGHT */}
                            <td className="px-2 py-2.5 text-center font-mono border-r border-slate-100">
                              {hasTelat ? (
                                <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded border border-emerald-300">
                                  {formatTimeValue(r.telat)}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>

                            <td className="px-2 py-2.5 text-center font-mono text-slate-500 border-r border-slate-100">{formatTimeValue(r.pAwal) || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono text-slate-500 border-r border-slate-100">{r.bolos || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-800 border-r border-slate-100">{formatTimeValue(r.tjk) || '-'}</td>
                            
                            {/* ID2 (STATUS SYMBOL) */}
                            <td className="px-2 py-2.5 text-center border-r border-slate-100">
                              <span className={`px-2.5 py-0.5 rounded text-[11px] font-black border ${opt ? opt.color : warnaSimbolBoard(r.id2)}`}>
                                {r.id2 || '-'}
                              </span>
                            </td>

                            <td className="px-2 py-2.5 text-slate-700 border-r border-slate-100">{r.departemen || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-mono text-slate-600 border-r border-slate-100">{formatTimeValue(r.attTime) || '-'}</td>
                            <td className="px-2 py-2.5 font-mono text-slate-600 border-r border-slate-100">{r.waktuScan || '-'}</td>
                            <td className="px-2 py-2.5 text-center font-semibold text-slate-600 border-r border-slate-100">{r.week || '-'}</td>
                            
                            {/* NOMINAL (DENDA TELAT) */}
                            <td className="px-2 py-2.5 text-right font-mono font-bold text-amber-700 border-r border-slate-100">
                              {nominalDenda > 0 ? (
                                <span>{formatNominal(nominalDenda)}</span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>

                            {/* SUMBER (MESIN / ONLINE) */}
                            <td className="px-2 py-2.5 text-center border-r border-slate-100">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${labelSumber(r.sumber).warna}`}
                                title={adaOnline(r) ? `Absen online: masuk ${r.onlineMasuk || '-'} / pulang ${r.onlinePulang || '-'}` : 'Data mesin absensi'}
                              >
                                {labelSumber(r.sumber).teks}
                              </span>
                              {adaOnline(r) && (
                                <div className="text-[10px] font-mono text-indigo-500 mt-0.5">
                                  {r.onlineMasuk || '-'} / {r.onlinePulang || '-'}
                                </div>
                              )}
                            </td>

                            <td className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => bukaKoreksiUntuk(r, r.tanggalYMD, r.tanggalYMD)}
                                title={r.isKoreksi
                                  ? ('Sudah dikoreksi' + (r.koreksiKet ? ': ' + r.koreksiKet : '') + ' \u2014 klik untuk mengubah')
                                  : 'Koreksi baris ini'}
                                aria-label="Koreksi"
                                className={`inline-flex items-center justify-center p-1.5 rounded-lg border transition active:scale-95 ${
                                  r.isKoreksi
                                    ? 'text-amber-700 bg-amber-100/80 border-amber-300 hover:bg-amber-200'
                                    : 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-blue-600 hover:text-white hover:border-blue-600'
                                }`}
                              >
                                {r.isKoreksi
                                  ? <Sparkles className="w-4 h-4" />
                                  : <Edit3 className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              {barisTabel.length > pageSize && (
                <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 bg-slate-50/50">
                  <span>
                    Menampilkan {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, barisTabel.length)} dari {barisTabel.length} baris
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-medium transition"
                    >
                      Sebelumnya
                    </button>
                    <span className="px-3 py-1.5 font-bold text-slate-800">
                      Halaman {currentPage} dari {Math.ceil(barisTabel.length / pageSize)}
                    </span>
                    <button
                      disabled={currentPage >= Math.ceil(barisTabel.length / pageSize)}
                      onClick={() => setCurrentPage(p => p + 1)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-medium transition"
                    >
                      Selanjutnya
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: KOREKSI DATA ABSENSI */}
        {activeTab === 'koreksi' && (
          <div className="space-y-4 w-full">
            <div className={kelasKartu}>
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                <div>
                  <h2 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                    Daftar Koreksi Data Absensi (Override)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Data pada tabel ini secara otomatis menimpa (override) status absensi di DB_FIX & Dashboard.
                  </p>
                  <div className="mt-2 inline-flex rounded-xl border border-slate-200 bg-white p-0.5 text-[11px] font-bold">
                    <button
                      onClick={() => setLingkupKoreksi('periode')}
                      className={`px-3 py-1 rounded-lg transition ${lingkupKoreksi === 'periode' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      Periode terpilih
                    </button>
                    <button
                      onClick={() => { setLingkupKoreksi('semua'); if (semuaKoreksi !== null) muatSemuaKoreksi(); }}
                      className={`px-3 py-1 rounded-lg transition ${lingkupKoreksi === 'semua' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      Semua histori{semuaKoreksi ? ` (${semuaKoreksi.length})` : ''}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenKoreksi()}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah Koreksi</span>
                  </button>
                  <button
                    onClick={() => exportToExcel('koreksi')}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition active:scale-95"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Excel Koreksi</span>
                  </button>
                </div>
              </div>

              <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-white flex flex-col gap-2">
                {barPencarian}
                <div className="flex justify-end empty:hidden"><TombolResetKolom state={urutKoreksi} /></div>
              </div>
              <div className={kelasGulir}>
                <table onMouseOver={tooltipSelTerpotong} className="tabel-rekap text-left text-xs border-collapse" style={{ minWidth: lebarTotal(KOLOM_KOREKSI) }}>
                  <colgroup>
                    {KOLOM_KOREKSI.map(k => <col key={k.key} style={{ width: k.lebar }} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-slate-600 font-bold text-[10px] whitespace-nowrap">
                      {KOLOM_KOREKSI.map(k => (
                        <th key={k.key} className={`px-2 py-2.5 bg-slate-50 ${TH_STICKY} ${k.kelas || ''}`}>
                          <IsiKepala kolom={k} state={urutKoreksi} align={k.align} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(lingkupKoreksi === 'semua' ? (memuatSemuaKoreksi && !semuaKoreksi) : loading) ? (
                      <tr>
                        <td colSpan="10" className="p-8 text-center text-slate-400">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                          <span>Memuat daftar koreksi...</span>
                        </td>
                      </tr>
                    ) : urutKoreksi.rows.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="p-8 text-center text-slate-400">
                          Belum ada data koreksi absensi. Klik <strong>Tambah Koreksi</strong> untuk menambahkan.
                        </td>
                      </tr>
                    ) : (
                      urutKoreksi.rows.map((k, idx) => {
                        const opt = OPSI_SIMBOL_KOREKSI.find(o => o.kode === k.id2);
                        return (
                          <tr key={k.id || idx} className="hover:bg-slate-50 transition-colors whitespace-nowrap">
                            <td className="p-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                            <td className="p-3 font-mono text-slate-600">{k.noAkun || '-'}</td>
                            <td className="p-3 font-mono font-bold text-slate-700">{k.payroll || '-'}</td>
                            <td className="p-3 font-bold text-slate-900">{k.nama || '-'}</td>
                            <td className="p-3 text-slate-700">{formatDateOnly(k.tglMulai)}</td>
                            <td className="p-3 text-slate-700">{formatDateOnly(k.tglSelesai || k.tglMulai)}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-black border ${opt ? opt.color : 'bg-slate-100 text-slate-800 border-slate-200'}`}>
                                {k.id2}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600 max-w-xs truncate">{k.keterangan || '-'}</td>
                            <td className="p-3 font-mono text-[11px] text-slate-500">{k.createdAt || '-'}</td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleOpenKoreksi(k)}
                                  className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                                  title="Edit Koreksi"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteKoreksi(k.id)}
                                  disabled={deletingId === k.id}
                                  className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition disabled:opacity-50"
                                  title="Hapus Koreksi"
                                >
                                  {deletingId === k.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODAL KARTU DETAIL PEGAWAI (VIEW, CAPTURE & WHATSAPP COPY) */}
      {detailModalEmployee && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl my-6 relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header Modal Kartu Detail */}
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white p-5 sm:p-6 relative">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-cyan-300 shadow-inner shrink-0">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/20 px-2 py-0.5 rounded-md border border-cyan-400/30">
                        {detailModalEmployee.dept || 'Staff'}
                      </span>
                      <span className="font-mono text-xs text-slate-300">{detailModalEmployee.payroll || '-'}</span>
                    </div>
                    <h3 className="text-xl font-black text-white tracking-tight mt-0.5">
                      {detailModalEmployee.nama}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">{detailModalEmployee.jabatan || 'Karyawan'}</p>
                  </div>
                </div>

                <button
                  onClick={() => setDetailModalEmployee(null)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition"
                  title="Tutup"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Category Selector Tabs inside Card */}
              <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1 border-t border-white/10 pt-3.5">
                {[
                  { key: 'TELAT', label: `⏰ Telat (${detailModalEmployee.telat || 0})` },
                  { key: 'CUTI', label: `🏝️ Cuti (${detailModalEmployee.cutiDiambil || 0})` },
                  { key: 'SAKIT', label: `🩺 Sakit (${detailModalEmployee.sakit || 0})` },
                  { key: 'ALPA', label: `⚠️ Alpa (${detailModalEmployee.alpa || 0})` },
                  { key: 'IJIN', label: `📋 Ijin (${detailModalEmployee.ijin || 0})` },
                  { key: 'TDK_MASUK', label: `🚪 Tdk Masuk (${detailModalEmployee.tdkAbsenMasuk || 0})` },
                  { key: 'TDK_PULANG', label: `🏃 Tdk Pulang (${detailModalEmployee.tdkAbsenPulang || 0})` }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setDetailActiveCategory(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                      detailActiveCategory === tab.key
                        ? 'bg-white text-slate-900 shadow-md'
                        : 'bg-white/10 text-slate-300 hover:bg-white/20'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notification Toast for Image Copy */}
            {copyImageSuccess && (
              <div className="bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 animate-in fade-in duration-150">
                <CheckCircle2 className="w-4 h-4" />
                <span>Gambar kartu berhasil disalin ke Clipboard! Langsung tempel (Ctrl+V) di WhatsApp / Chat.</span>
              </div>
            )}

            {/* Content Table of Dates */}
            <div className="p-4 sm:p-6 space-y-4 max-h-[50vh] overflow-y-auto">
              
              {/* Category Subheader + Controls */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-black text-slate-800">
                    Rincian Tanggal: {detailActiveCategory.replace('_', ' ')}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Total {activeCategoryRecords.length} catatan pada periode ini
                  </p>
                </div>

                {detailActiveCategory === 'TELAT' && (
                  <button
                    type="button"
                    onClick={() => setShowDetailNominal(!showDetailNominal)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition ${
                      showDetailNominal
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {showDetailNominal ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    <span>{showDetailNominal ? 'Sembunyikan Nominal' : 'Tampilkan Nominal'}</span>
                  </button>
                )}
              </div>

              {/* Detail Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider whitespace-nowrap">
                      <th className="p-2.5 text-center w-10">No</th>
                      <th className="p-2.5">Tanggal</th>
                      <th className="p-2.5 text-center">Hari</th>
                      <th className="p-2.5 text-center">Kode ID2</th>
                      {detailActiveCategory === 'TELAT' && (
                        <th className="p-2.5 text-center text-amber-700">Telat</th>
                      )}
                      {detailActiveCategory === 'TELAT' && showDetailNominal && (
                        <th className="p-2.5 text-right text-amber-800">Nominal Denda</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeCategoryRecords.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="p-6 text-center text-slate-400 text-xs">
                          Tidak ada catatan {detailActiveCategory.toLowerCase()} pada periode ini.
                        </td>
                      </tr>
                    ) : (
                      activeCategoryRecords.map((r, i) => {
                        const opt = OPSI_SIMBOL_KOREKSI.find(o => o.kode === r.id2);
                        const dendaNum = hitungDendaTelat(r.telat, r.nominal);
                        return (
                          <tr key={i} className="hover:bg-slate-50 whitespace-nowrap">
                            <td className="p-2.5 text-center font-mono text-slate-400">{i + 1}</td>
                            <td className="p-2.5 font-bold text-slate-800">{formatDateOnly(r.tanggal || r.tanggalYMD)}</td>
                            <td className="p-2.5 text-center text-slate-600 font-medium">{r.week || '-'}</td>
                            <td className="p-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${opt ? opt.color : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                {r.id2 || '-'}
                              </span>
                            </td>
                            {detailActiveCategory === 'TELAT' && (
                              <td className="p-2.5 text-center font-mono font-bold text-amber-700">
                                {formatTimeValue(r.telat)}
                              </td>
                            )}
                            {detailActiveCategory === 'TELAT' && showDetailNominal && (
                              <td className="p-2.5 text-right font-mono font-bold text-amber-800">
                                {dendaNum > 0 ? `Rp ${dendaNum.toLocaleString('id-ID')}` : '-'}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {activeCategoryRecords.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 font-bold border-t border-slate-200 text-slate-800">
                        <td className="p-2.5 text-center">-</td>
                        <td className="p-2.5" colSpan={detailActiveCategory === 'TELAT' ? 3 : 2}>
                          Total: {activeCategoryRecords.length} Hari
                        </td>
                        {detailActiveCategory === 'TELAT' && (
                          <td className="p-2.5 text-center font-mono text-amber-700">
                            -
                          </td>
                        )}
                        {detailActiveCategory === 'TELAT' && showDetailNominal && (
                          <td className="p-2.5 text-right font-mono text-amber-900">
                            Rp {activeCategoryRecords.reduce((acc, curr) => acc + hitungDendaTelat(curr.telat, curr.nominal), 0).toLocaleString('id-ID')}
                          </td>
                        )}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Modal Bottom Action Bar (Capture & Copy WhatsApp) */}
            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCardImage}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-emerald-600/20 active:scale-95 transition"
                  title="Salin gambar kartu ke Clipboard untuk di-paste langsung ke WhatsApp"
                >
                  <Copy className="w-4 h-4" />
                  <span>📸 Salin Gambar (Siap Paste WhatsApp)</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-white text-slate-700 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailModalEmployee(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
                >
                  Tutup
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODAL FORM KOREKSI ABSENSI */}
      {showKoreksiModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-100 w-full max-w-lg my-8 relative animate-in fade-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-800 tracking-tight">
                    {editKoreksiItem ? 'Edit Data Koreksi' : 'Tambah Koreksi Absensi'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Penimpaan (Override) Simbol Absensi Pegawai</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowKoreksiModal(false);
                  setNamaSuggestOpen(false);
                  setNamaSuggestIdx(-1);
                }}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveKoreksi} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    No. Payroll / NIK <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={formKoreksi.payroll}
                    onChange={e => setFormKoreksi({ ...formKoreksi, payroll: e.target.value })}
                    placeholder="Contoh: G0058"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    No. Akun (Opsional)
                  </label>
                  <input
                    type="text"
                    value={formKoreksi.noAkun}
                    onChange={e => setFormKoreksi({ ...formKoreksi, noAkun: e.target.value })}
                    placeholder="Contoh: 360"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                  />
                </div>
              </div>

              <div className="relative">
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Nama Pegawai <span className="text-rose-500">*</span>
                  <span className="ml-2 font-normal text-[10px] text-slate-400">
                    (Ketik nama → pilih dari saran, Payroll & No Akun otomatis terisi)
                  </span>
                </label>
                <UserCheck className="absolute left-3.5 top-[38px] w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  required
                  type="text"
                  value={formKoreksi.nama}
                  onChange={e => {
                    setFormKoreksi({ ...formKoreksi, nama: e.target.value });
                    setNamaSuggestIdx(-1);
                    setNamaSuggestOpen(true);
                  }}
                  onFocus={() => setNamaSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setNamaSuggestOpen(false), 150)}
                  onKeyDown={e => {
                    const suggestList = (() => {
                      const q = formKoreksi.nama.trim().toLowerCase();
                      if (!q) return [];
                      return masterPegawai.filter(m =>
                        !m.nama ? false :
                        (m.nama.toLowerCase().includes(q) ||
                         (m.payroll && m.payroll.toLowerCase().includes(q)) ||
                         (m.noAkun && m.noAkun.toLowerCase().includes(q)))
                      ).slice(0, 12);
                    })();
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (suggestList.length > 0) {
                        setNamaSuggestOpen(true);
                        setNamaSuggestIdx(i => (i + 1) % suggestList.length);
                      }
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (suggestList.length > 0) {
                        setNamaSuggestOpen(true);
                        setNamaSuggestIdx(i => (i <= 0 ? suggestList.length - 1 : i - 1));
                      }
                    } else if (e.key === 'Enter' && namaSuggestIdx >= 0 && suggestList[namaSuggestIdx]) {
                      e.preventDefault();
                      const m = suggestList[namaSuggestIdx];
                      setFormKoreksi(fk => ({
                        ...fk,
                        nama: m.nama || fk.nama,
                        payroll: m.payroll || fk.payroll,
                        noAkun: m.noAkun || fk.noAkun
                      }));
                      setNamaSuggestOpen(false);
                      setNamaSuggestIdx(-1);
                    } else if (e.key === 'Escape') {
                      setNamaSuggestOpen(false);
                      setNamaSuggestIdx(-1);
                    }
                  }}
                  placeholder="Ketik nama pegawai, payroll, atau no akun..."
                  autoComplete="off"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                />
                {namaSuggestOpen && (() => {
                  const q = formKoreksi.nama.trim().toLowerCase();
                  const suggestList = !q ? [] : masterPegawai.filter(m =>
                    !m.nama ? false :
                    (m.nama.toLowerCase().includes(q) ||
                     (m.payroll && m.payroll.toLowerCase().includes(q)) ||
                     (m.noAkun && m.noAkun.toLowerCase().includes(q)))
                  ).slice(0, 12);
                  if (suggestList.length === 0) return null;
                  return (
                    <div className="absolute left-0 right-0 top-[70px] z-50 bg-white border border-blue-200/80 rounded-2xl shadow-2xl shadow-blue-900/10 overflow-hidden max-h-64 overflow-y-auto ring-1 ring-blue-500/10">
                      <div className="px-3 py-1.5 bg-blue-50/80 border-b border-blue-100 text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                        {suggestList.length} saran ditemukan
                      </div>
                      {suggestList.map((m, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            setFormKoreksi(fk => ({
                              ...fk,
                              nama: m.nama || fk.nama,
                              payroll: m.payroll || fk.payroll,
                              noAkun: m.noAkun || fk.noAkun
                            }));
                            setNamaSuggestOpen(false);
                            setNamaSuggestIdx(-1);
                          }}
                          onMouseEnter={() => setNamaSuggestIdx(i)}
                          className={`w-full text-left px-3.5 py-2.5 border-b border-slate-50 last:border-0 flex items-start gap-3 transition ${
                            namaSuggestIdx === i ? 'bg-blue-600 text-white' : 'hover:bg-blue-50 text-slate-700'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-black ${
                            namaSuggestIdx === i ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {(m.nama || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-bold truncate ${namaSuggestIdx === i ? 'text-white' : 'text-slate-800'}`}>
                              {m.nama || '-'}
                            </div>
                            <div className={`mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] font-semibold ${
                              namaSuggestIdx === i ? 'text-blue-100' : 'text-slate-500'
                            }`}>
                              {m.payroll && (
                                <span className={`px-1.5 py-0.5 rounded ${namaSuggestIdx === i ? 'bg-white/15' : 'bg-slate-100 text-slate-700'}`}>
                                  Payroll: {m.payroll}
                                </span>
                              )}
                              {m.noAkun && (
                                <span className={`px-1.5 py-0.5 rounded ${namaSuggestIdx === i ? 'bg-white/15' : 'bg-slate-100 text-slate-700'}`}>
                                  Akun: {m.noAkun}
                                </span>
                              )}
                              {m.dept && (
                                <span className="truncate">{m.dept}</span>
                              )}
                            </div>
                          </div>
                          <CheckCircle2 className={`w-4 h-4 shrink-0 mt-2 ${namaSuggestIdx === i ? 'text-white' : 'text-emerald-500'}`} />
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Tanggal Mulai <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="date"
                    value={formKoreksi.tglMulai}
                    onChange={e => setFormKoreksi({ ...formKoreksi, tglMulai: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Tanggal Selesai
                  </label>
                  <input
                    type="date"
                    value={formKoreksi.tglSelesai || formKoreksi.tglMulai}
                    onChange={e => setFormKoreksi({ ...formKoreksi, tglSelesai: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Simbol Koreksi (ID2) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formKoreksi.id2}
                  onChange={e => setFormKoreksi({ ...formKoreksi, id2: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                >
                  {OPSI_SIMBOL_KOREKSI.map(o => (
                    <option key={o.kode} value={o.kode}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Keterangan / Alasan Koreksi
                </label>
                <textarea
                  rows="2"
                  value={formKoreksi.keterangan}
                  onChange={e => setFormKoreksi({ ...formKoreksi, keterangan: e.target.value })}
                  placeholder="Contoh: Surat Tugas Dinas Luar / Ijin disetujui HRD"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowKoreksiModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingKoreksi}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {savingKoreksi ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{editKoreksiItem ? 'Simpan Perubahan' : 'Tambahkan Koreksi'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
