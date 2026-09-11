import React from 'react';
import { RefreshCcw, Loader2, LogOut, ShieldAlert, Settings, CheckCircle2 } from 'lucide-react';
import { GPS_STATUS, jenisPerangkat } from '../utils/gpsWajib';

// =====================================================================
// LAYAR GERBANG GPS
//
// Satu-satunya layar yang terlihat karyawan sebelum menu terbuka, selama
// lokasinya belum bisa dibaca. Tidak ada tombol "lewati" — kecuali untuk
// dua keadaan yang MUSTAHIL diperbaiki karyawan sendiri (halaman bukan
// HTTPS, atau browser tanpa Geolocation sama sekali). Menahan seluruh
// perusahaan berhenti absen karena satu setelan hosting bukan kebijakan
// yang bisa dipertanggungjawabkan; menahan satu karyawan yang mematikan
// izin lokasinya, sebaliknya, memang itu tujuannya.
//
// Panduannya dipisah per perangkat karena langkahnya benar-benar berbeda.
// Menampilkan langkah Android kepada pemakai iPhone sama saja dengan
// tidak menampilkan apa pun.
// =====================================================================

const PANDUAN = {
  ios: {
    judul: 'iPhone / iPad (Safari)',
    langkah: [
      'Buka Pengaturan → Privasi & Keamanan → Layanan Lokasi, pastikan AKTIF.',
      'Masih di Pengaturan → Safari → Lokasi, pilih "Tanya" atau "Izinkan".',
      'Kembali ke aplikasi ini, ketuk "Periksa Ulang" di bawah, lalu pilih "Izinkan" saat Safari bertanya.',
      'Jika tidak ada pertanyaan yang muncul: ketuk ikon "aA" di kiri kolom alamat → Setelan Situs Web → Lokasi → Izinkan.'
    ]
  },
  android: {
    judul: 'Android (Chrome)',
    langkah: [
      'Geser layar dari atas, pastikan tombol "Lokasi" menyala.',
      'Di Chrome, ketuk ikon gembok di kolom alamat → Izin → Lokasi → Izinkan.',
      'Bila menu itu tidak ada: Chrome → ⋮ → Setelan → Setelan situs → Lokasi → Izinkan.',
      'Kembali ke sini dan ketuk "Periksa Ulang".'
    ]
  },
  desktop: {
    judul: 'Komputer / Laptop',
    langkah: [
      'Klik ikon gembok atau penanda lokasi di kolom alamat browser.',
      'Ubah izin Lokasi menjadi "Izinkan".',
      'Windows: Setelan → Privasi & keamanan → Lokasi → aktifkan untuk aplikasi desktop.',
      'Klik "Periksa Ulang" setelah selesai.'
    ]
  }
};

export default function GpsGateScreen({ status, pesan, memeriksa, onPeriksaUlang, onKeluar, onLanjutDarurat, namaUser, bolehDarurat }) {
  const perangkat = jenisPerangkat();
  const panduan = PANDUAN[perangkat] || PANDUAN.desktop;

  // Dua keadaan di luar kendali karyawan. Di sinilah — dan hanya di
  // sini — jalan keluar sementara disediakan.
  const diLuarKendaliKaryawan =
    status === GPS_STATUS.TIDAK_AMAN || status === GPS_STATUS.TIDAK_DIDUKUNG;

  const judul =
    status === GPS_STATUS.DITOLAK ? 'Izin Lokasi Ditolak' :
    status === GPS_STATUS.PERANGKAT_MATI ? 'GPS Perangkat Tidak Aktif' :
    status === GPS_STATUS.TIDAK_AMAN ? 'Koneksi Tidak Aman' :
    status === GPS_STATUS.TIDAK_DIDUKUNG ? 'Browser Tidak Mendukung Lokasi' :
    'Memeriksa Lokasi';

  return (
    <div className="fixed inset-0 z-[9998] overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-blue-950 px-4 py-8">
      <div className="mx-auto w-full max-w-sm">

        {/* IKON + JUDUL */}
        <div className="text-center">
          <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${memeriksa ? 'bg-blue-500/20' : 'bg-rose-500/20'}`}>
            {memeriksa
              ? <Loader2 className="h-9 w-9 animate-spin text-blue-300" />
              : <ShieldAlert className="h-9 w-9 text-rose-300" />}
          </div>
          <h1 className="text-xl font-black leading-tight text-white">
            {memeriksa ? 'Memeriksa Lokasi…' : judul}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-300">
            {memeriksa
              ? 'Mohon tunggu, aplikasi sedang membaca posisi perangkat Anda.'
              : 'Aplikasi absensi hanya dapat digunakan bila lokasi perangkat aktif. Menu tidak dapat dibuka sebelum lokasi terbaca.'}
          </p>
          {namaUser && !memeriksa && (
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-blue-300/80">{namaUser}</p>
          )}
        </div>

        {/* PESAN TEKNIS */}
        {!memeriksa && pesan && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
            <p className="text-[12px] leading-relaxed text-slate-200">{pesan}</p>
          </div>
        )}

        {/* PANDUAN LANGKAH */}
        {!memeriksa && !diLuarKendaliKaryawan && (
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <Settings className="h-4 w-4 text-slate-500" />
              <h2 className="text-[13px] font-bold text-slate-800">Cara mengaktifkan — {panduan.judul}</h2>
            </div>
            <ol className="space-y-2.5">
              {panduan.langkah.map((teks, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-[12px] leading-relaxed text-slate-600">{teks}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* PESAN KHUSUS ADMIN */}
        {!memeriksa && diLuarKendaliKaryawan && (
          <div className="mt-4 rounded-2xl bg-amber-50 p-4 shadow-xl">
            <h2 className="mb-1.5 text-[13px] font-bold text-amber-900">Ini bukan kesalahan perangkat Anda</h2>
            <p className="text-[12px] leading-relaxed text-amber-800">
              {status === GPS_STATUS.TIDAK_AMAN
                ? 'Alamat aplikasi harus memakai https:// agar browser mengizinkan akses lokasi. Laporkan ke Admin — setelan ini hanya bisa diperbaiki di sisi server.'
                : 'Browser yang Anda pakai tidak memiliki fitur lokasi. Coba buka lewat Chrome (Android) atau Safari (iPhone) versi terbaru.'}
            </p>
          </div>
        )}

        {/* TOMBOL */}
        <div className="mt-5 space-y-2.5">
          <button
            onClick={onPeriksaUlang}
            disabled={memeriksa}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 text-[14px] font-bold text-white shadow-lg shadow-blue-900/40 transition-all active:scale-95 disabled:opacity-60"
          >
            {memeriksa ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {memeriksa ? 'Sedang memeriksa…' : 'Periksa Ulang'}
          </button>

          {/* Jalan keluar hanya muncul untuk keadaan yang mustahil
              diperbaiki karyawan, atau untuk admin yang sudah beberapa kali
              gagal — supaya pemilik sistem tidak pernah terkunci dari
              sistemnya sendiri. Karyawan biasa tidak pernah melihat ini. */}
          {!memeriksa && (diLuarKendaliKaryawan || bolehDarurat) && (
            <button
              onClick={onLanjutDarurat}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 py-3 text-[13px] font-bold text-slate-200 transition-all active:scale-95"
            >
              <CheckCircle2 className="h-4 w-4" />
              Lanjutkan sementara (lapor Admin)
            </button>
          )}

          {!memeriksa && (
            <button
              onClick={onKeluar}
              className="flex w-full items-center justify-center gap-2 py-2.5 text-[12px] font-semibold text-slate-400 transition-colors hover:text-slate-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              Keluar dari akun
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
