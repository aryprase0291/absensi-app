// =======================================================
// NOTIFIKASI IMPORT dbabsen
//
// Satu-satunya bagian UI yang tahu soal job import di luar layar Admin.
// Dipasang sekali di akar aplikasi, jadi ia ikut terlihat di layar mana
// pun — termasuk saat admin sudah kembali ke dashboard.
//
// Dua bentuk, sengaja dibedakan:
//   - SEDANG BERJALAN -> pil tipis, tidak menutupi konten, tidak bisa
//     ditutup. Import yang sedang jalan bukan informasi opsional.
//   - SUDAH SELESAI   -> kartu hasil yang bisa ditutup, dengan angka
//     ringkasan dari server kalau ada.
// =======================================================

import React from 'react';
import { Loader2, CheckCircle, AlertTriangle, X, Database } from 'lucide-react';
import { useImportJob } from '../context/ImportJobContext';

export default function ImportNotifier() {
  const { job, tutupNotifikasi } = useImportJob();

  if (job.status === 'idle') return null;
  if (job.status !== 'berjalan' && job.dibaca) return null;

  // --- SEDANG BERJALAN ---
  if (job.status === 'berjalan') {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] w-[calc(100%-2rem)] max-w-sm pointer-events-none">
        <div className="pointer-events-auto bg-slate-900 text-white rounded-2xl shadow-2xl shadow-slate-900/25 px-4 py-3 flex items-center gap-3">
          <div className="relative shrink-0">
            <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold leading-tight">
              Mengimpor data mesin… {job.progres}%
            </p>
            <div className="mt-1.5 h-1 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-400 transition-all duration-300"
                style={{ width: `${job.progres}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400 tabular-nums">
              {job.chunkSelesai}/{job.totalChunk} bagian · {job.jumlahBaris} baris ·
              {' '}jangan tutup halaman ini
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- SELESAI (SUKSES / GAGAL) ---
  const sukses = job.status === 'sukses';
  const r = job.ringkasan;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] w-[calc(100%-2rem)] max-w-sm">
      {/* Keyframe ditulis di sini, bukan lewat kelas animate-in/slide-in.
          Kelas-kelas itu berasal dari plugin tailwindcss-animate yang TIDAK
          terpasang di proyek ini (cek tailwind.config.js: plugins kosong),
          jadi di beberapa layar lain kelas serupa sebenarnya tidak
          menghasilkan animasi apa pun. */}
      <style>{`
        @keyframes notifNaik {
          0%   { opacity: 0; transform: translateY(12px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        style={{ animation: 'notifNaik 0.28s cubic-bezier(0.22,1,0.36,1)' }}
        className={`bg-white rounded-2xl shadow-2xl shadow-slate-900/15 border overflow-hidden ${sukses ? 'border-emerald-200' : 'border-red-200'}`}
      >
        <div className="p-4 flex gap-3">
          <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${sukses ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {sukses ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </span>

          <div className="min-w-0 flex-1">
            <p className={`text-[13px] font-semibold leading-tight ${sukses ? 'text-slate-900' : 'text-red-700'}`}>
              {sukses ? 'Import dbabsen selesai' : 'Import dbabsen gagal'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
              {sukses
                ? `${job.jumlahBaris} baris dari ${job.jumlahFile > 1 ? `${job.jumlahFile} file` : 'file'} terkirim.`
                : job.pesan}
            </p>

            {sukses && r && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500 tabular-nums">
                <li>Baris dari file: <span className="font-semibold text-slate-700">{r.barisBaru}</span></li>
                {r.mode === 'upsert' && (
                  <>
                    <li>Baris lama ditimpa: <span className="font-semibold text-slate-700">{r.barisDitimpa}</span></li>
                    <li>Baris lama dipertahankan: <span className="font-semibold text-slate-700">{r.barisDipertahankan}</span></li>
                  </>
                )}
                <li className="pt-0.5 flex items-center gap-1.5 text-slate-700 font-semibold">
                  <Database className="w-3 h-3 text-slate-400" />
                  Total dbabsen sekarang: {r.totalBaris}
                </li>
              </ul>
            )}
          </div>

          <button
            onClick={tutupNotifikasi}
            className="shrink-0 text-slate-300 hover:text-slate-600 transition-colors -mt-1 -mr-1 p-1"
            title="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
