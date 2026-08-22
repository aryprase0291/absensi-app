import {
  CheckCircle, LogOut, FileText, AlertTriangle, Clock, Briefcase, Calendar
} from 'lucide-react';

// ============================================================
// URL BACKEND (Google Apps Script Web App)
//
// Default di bawah = deployment PRODUKSI (spreadsheet "absen" asli).
//
// Untuk development lokal, JANGAN ubah baris ini. Cukup buat file
// `.env.local` di root project berisi:
//
//   REACT_APP_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec
//
// dengan URL deployment dari spreadsheet SALINAN untuk uji coba.
// File `.env.local` sudah di-ignore git, jadi tidak akan ikut ter-commit.
// Panduan lengkap: lihat SETUP-LOCAL.md
//
// PENTING: CRA membaca env var saat server start. Setiap kali Anda
// mengubah `.env.local`, hentikan `npm start` lalu jalankan ulang.
// ============================================================
const PRODUCTION_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzUH1Q7iVAii82YGg_mObckPCZdMxd-bzjURra0VvaCulR0nS1PeE4HiGA-cRLVVDgD/exec';

export const SCRIPT_URL = process.env.REACT_APP_SCRIPT_URL || PRODUCTION_SCRIPT_URL;

// true jika sedang memakai backend selain produksi.
// Dipakai untuk menandai dengan jelas bahwa data yang tampil bukan data asli.
export const IS_TEST_BACKEND = SCRIPT_URL !== PRODUCTION_SCRIPT_URL;

// ============================================================
// DURASI AUTO-LOGOUT
// Default 5 menit. Saat development bisa diperpanjang lewat `.env.local`:
//   REACT_APP_TIMEOUT_MINUTES=120
// ============================================================
const TIMEOUT_MINUTES = Number(process.env.REACT_APP_TIMEOUT_MINUTES) || 5;

export const TIMEOUT_DURATION = TIMEOUT_MINUTES * 60 * 1000;

export const ICON_MAP = {
  'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': FileText, 'Sakit': AlertTriangle, 'Lembur': Clock, 'Dinas': Briefcase, 'Cuti': Calendar
};

export const COLOR_MAP = {
  'Hadir': 'bg-green-500', 'Pulang': 'bg-red-500', 'Ijin': 'bg-yellow-500', 'Sakit': 'bg-orange-500', 'Lembur': 'bg-purple-500', 'Dinas': 'bg-indigo-500', 'Cuti': 'bg-pink-500'
};

// Board Absensi - rekap absensi bulanan format lembar kerja di Google Sheets.
// Tautannya hanya DITAMPILKAN untuk role admin di Admin Panel. Yang
// benar-benar menjaga isinya adalah izin berbagi Google Drive: bagikan
// spreadsheet ini hanya ke akun admin, JANGAN "siapa saja yang punya link".
export const BOARD_ABSENSI_URL =
  'https://docs.google.com/spreadsheets/d/1djRP-SZSMST5x1W_fZgViQdiMp1qUyFkDLFRAe3ekEM/edit';
