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

// ============================================================
// SUPABASE (FASE 1 — LOGIN)
//
// Dibiarkan KOSONG secara default, dan itu disengaja: selama kedua nilai
// ini belum diisi, aplikasi berjalan persis seperti sebelumnya — login
// tetap lewat Apps Script. Tidak ada yang berubah sampai Anda memilih
// mengisinya.
//
// Keduanya aman berada di bundle yang dikirim ke HP karyawan: kunci
// `anon` memang dirancang untuk itu, dan seluruh tabel memakai RLS tanpa
// policy sehingga kunci ini tidak bisa membaca atau menulis apa pun.
// Satu-satunya pintu masuk adalah Edge Function.
//
// Untuk menguji ke project lain, timpa lewat .env.local:
//   REACT_APP_SUPABASE_URL=https://xxxx.supabase.co
//   REACT_APP_SUPABASE_ANON_KEY=...
// ============================================================
const SUPABASE_URL_PRODUKSI = 'https://owbibqqaoeyrnatzqgso.supabase.co';
const SUPABASE_ANON_PRODUKSI =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93YmlicXFhb2V5cm5hdHpxZ3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MTY5ODgsImV4cCI6MjEwNTI5Mjk4OH0.fYkvj16tWN-7yh4zvRSbRg7aIb3tp4dnZQapNK50J3Q';

export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || SUPABASE_URL_PRODUKSI;
export const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || SUPABASE_ANON_PRODUKSI;

// SAKELAR JALUR LOGIN BARU — SENGAJA MASIH MATI.
//
// Alamat dan kunci di atas sudah benar, tetapi menyalakannya sebelum
// SUPABASE_UJI_TOKEN() berkata BERHASIL adalah satu-satunya cara fase
// ini bisa merugikan: kalau AUTH_SECRET di Supabase berbeda dengan yang
// ada di Apps Script, karyawan akan berhasil login lalu SEKETIKA
// terlempar kembali ke layar login pada request berikutnya — dan itu
// jauh lebih buruk daripada login yang lambat.
//
// Nyalakan dengan mengubah false menjadi true di bawah (atau
// REACT_APP_SUPABASE_LOGIN=1 saat build), lalu `npm run build`.
// Mematikannya kembali: kembalikan ke false, build, unggah. Selesai.
export const SUPABASE_LOGIN_AKTIF =
  process.env.REACT_APP_SUPABASE_LOGIN === '1' || false;

export const SUPABASE_AKTIF = !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_LOGIN_AKTIF);

// Batas tunggu login lewat Supabase. Lewat dari ini, aplikasi berhenti
// menunggu dan mengulang ke Apps Script. Angkanya sengaja pendek: kalau
// jalur baru tidak lebih cepat dari ini, tidak ada gunanya ditunggu.
export const SUPABASE_BATAS_MS = 6000;

// true jika sedang memakai backend selain produksi.
// Dipakai untuk menandai dengan jelas bahwa data yang tampil bukan data asli.
export const IS_TEST_BACKEND = SCRIPT_URL !== PRODUCTION_SCRIPT_URL;

// ============================================================
// DURASI AUTO-LOGOUT (STANDBY)
//
// Default **60 menit** sejak aktivitas terakhir (bukan sejak login):
// setiap sentuhan/klik/gulir menyetel ulang hitungannya. Selama jendela
// itu aplikasi berada dalam keadaan "standby" — layar boleh menganggur,
// tetapi sesinya masih hidup dan pelacakan posisi terus berjalan
// (lihat utils/gpsTracker.js).
//
// KENAPA 60 MENIT, BUKAN 5.
// Angka 5 menit dibuat saat aplikasi ini hanya dipakai untuk mengisi
// form absen. Setelah ada pelacakan posisi, sesi yang mati adalah
// pelacakan yang mati: karyawan lapangan yang tidak menyentuh layarnya
// selama perjalanan akan hilang dari Dashboard GPS justru pada saat
// posisinya paling ingin diketahui.
//
// JANGAN dimatikan sepenuhnya (mis. 0 atau angka raksasa). HP yang
// tertinggal di meja akan menjadi sesi terbuka bagi siapa pun yang
// memegangnya. Kalau perlu disetel per lingkungan, pakai `.env.local`:
//   REACT_APP_TIMEOUT_MINUTES=120
// ============================================================
const TIMEOUT_MINUTES = Number(process.env.REACT_APP_TIMEOUT_MINUTES) || 60;

export const TIMEOUT_DURATION = TIMEOUT_MINUTES * 60 * 1000;

// Dipakai untuk menyusun kalimat yang dilihat karyawan, supaya teksnya
// tidak pernah lagi berbeda dari angka yang sebenarnya berlaku.
export const TIMEOUT_LABEL = TIMEOUT_MINUTES >= 60 && TIMEOUT_MINUTES % 60 === 0
  ? `${TIMEOUT_MINUTES / 60} jam`
  : `${TIMEOUT_MINUTES} menit`;

// ============================================================
// PELACAKAN POSISI SAAT STANDBY
//
// WAKE LOCK: menahan layar HP tetap menyala selama pelacakan aktif.
// Ini satu-satunya cara yang benar-benar bekerja di web untuk menjaga
// GPS tetap mengirim titik saat karyawan tidak menyentuh aplikasinya —
// browser membekukan timer pada tab yang tersembunyi, dan layar yang
// terkunci mematikan pembacaan posisi sepenuhnya.
//
// Konsekuensinya jujur: baterai lebih boros. Matikan lewat `.env.local`
// dengan REACT_APP_GPS_WAKE_LOCK=0 bila suatu saat dianggap terlalu mahal.
// ============================================================
export const GPS_WAKE_LOCK_AKTIF = String(process.env.REACT_APP_GPS_WAKE_LOCK || '1') !== '0';

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
