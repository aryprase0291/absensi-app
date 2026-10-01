// =====================================================================
// JENDELA RINCIAN SATU KERANI
//
// Dibuka dari tabel "Rincian per kerani":
//   - klik NAMA   -> seluruh hari kerja orang itu (riwayat lengkap);
//   - klik ANGKA  -> hanya tanggal-tanggal yang membentuk angka itu.
//
// Daftar tanggalnya diambil lewat tanggalPerKolom() dari rekapKerani.js,
// sumber yang sama dengan angka di tabel — jadi angka "4" selalu berisi
// tepat empat tanggal. Jendela ini tidak menghitung apa pun sendiri.
// =====================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { STATUS, tanggalPerKolom, jamDari } from './rekapKerani';

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function labelTgl(ymd) {
  const b = String(ymd).split('-');
  const t = Date.parse(ymd + 'T00:00:00Z');
  const hari = isNaN(t) ? '' : HARI[new Date(t).getUTCDay()] + ', ';
  return hari + Number(b[2]) + ' ' + (BULAN[Number(b[1]) - 1] || b[1]) + ' ' + b[0];
}

function urutJam(a, b) {
  return jamDari(a.waktu).localeCompare(jamDari(b.waktu));
}

export default function RincianKerani({ orang, tanggal, kolomAwal, warna, onClose }) {
  const [kolom, setKolom] = useState(kolomAwal || 'semua');
  useEffect(() => { setKolom(kolomAwal || 'semua'); }, [orang, kolomAwal]);

  useEffect(() => {
    const tutup = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', tutup);
    return () => window.removeEventListener('keydown', tutup);
  }, [onClose]);

  const PILIHAN = useMemo(() => [
    { kunci: 'semua',   label: 'Semua hari' },
    { kunci: 'hadir',   label: 'Hadir',       warna: warna.hadir },
    { kunci: 'standby', label: 'Standby',     warna: warna.standby },
    { kunci: 'izin',    label: 'Izin',        warna: warna.izin },
    { kunci: 'tidak',   label: 'Tidak absen', warna: warna.tidak },
    { kunci: 'lengkap', label: 'Lengkap' },
    { kunci: 'sebelah', label: 'Hanya sebelah' }
  ], [warna]);

  const STATUS_TAMPIL = {
    [STATUS.HADIR]:   { label: 'Hadir',       warna: warna.hadir },
    [STATUS.STANDBY]: { label: 'Standby',     warna: warna.standby },
    [STATUS.IZIN]:    { label: 'Izin',        warna: warna.izin },
    [STATUS.KOSONG]:  { label: 'Tidak absen', warna: warna.tidak }
  };

  const jumlah = useMemo(() => {
    const h = {};
    PILIHAN.forEach((p) => { h[p.kunci] = tanggalPerKolom(orang, tanggal, p.kunci).length; });
    return h;
  }, [orang, tanggal, PILIHAN]);

  // Terbaru di atas — yang biasanya ingin diperiksa adalah minggu ini.
  const daftar = useMemo(
    () => tanggalPerKolom(orang, tanggal, kolom).slice().reverse(),
    [orang, tanggal, kolom]
  );

  if (!orang) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl max-h-[88vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* Kepala */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900 truncate">{orang.nama}</h3>
            <p className="text-[12px] text-slate-500">
              {orang.divisi} · produktifitas {orang.persenProduktif.toFixed(1)}%
              {' '}({orang.lengkap}/{orang.hariEfektif} hari efektif)
            </p>
          </div>
          <button onClick={onClose} aria-label="Tutup"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Saringan */}
        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-slate-100">
          {PILIHAN.map((p) => {
            const aktif = kolom === p.kunci;
            return (
              <button key={p.kunci} onClick={() => setKolom(p.kunci)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors
                  ${aktif ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {p.warna && <span className="w-2 h-2 rounded-full" style={{ background: p.warna }} />}
                {p.label}
                <span className={`tabular-nums ${aktif ? 'text-white/70' : 'text-slate-400'}`}>{jumlah[p.kunci]}</span>
              </button>
            );
          })}
        </div>

        {/* Daftar tanggal */}
        <div className="overflow-y-auto px-4 py-2">
          {daftar.length === 0 && (
            <p className="py-10 text-center text-[13px] text-slate-400">Tidak ada tanggal untuk pilihan ini.</p>
          )}
          <ul className="divide-y divide-slate-100">
            {daftar.map((t) => {
              const st = STATUS_TAMPIL[orang.sel[t]] || STATUS_TAMPIL[STATUS.KOSONG];
              const baris = (orang.barisPer && orang.barisPer[t]) || [];
              const sah = baris.filter((x) => String(x.status || '').trim() !== 'Rejected');
              const masuk = sah.filter((x) => String(x.tipe).trim() === 'Hadir').sort(urutJam)[0];
              const pulang = sah.filter((x) => String(x.tipe).trim() === 'Pulang').sort(urutJam).slice(-1)[0];
              const lain = baris.filter((x) => {
                const tp = String(x.tipe).trim();
                return x !== masuk && x !== pulang && !(sah.includes(x) && (tp === 'Hadir' || tp === 'Pulang'));
              });
              const hadir = orang.sel[t] === STATUS.HADIR;
              const lokasi = (masuk && (masuk.alamat || masuk.lokasi)) || (pulang && (pulang.alamat || pulang.lokasi)) || '';

              return (
                <li key={t} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium text-slate-900 tabular-nums">{labelTgl(t)}</span>
                    <span className="flex items-center gap-1.5 text-[12px] text-slate-600 shrink-0">
                      <span className="w-2 h-2 rounded-full" style={{ background: st.warna }} />
                      {st.label}
                      {hadir && !orang.lengkapPer[t] && <span className="text-rose-700 font-medium">· sebelah</span>}
                    </span>
                  </div>

                  {hadir && (
                    <div className="flex gap-4 mt-1 text-[12px] tabular-nums">
                      <span className="text-slate-500">Masuk <b className={masuk ? 'text-slate-900' : 'text-rose-700'}>
                        {masuk ? (jamDari(masuk.waktu) || '✓') : 'tidak ada'}</b></span>
                      <span className="text-slate-500">Pulang <b className={pulang ? 'text-slate-900' : 'text-rose-700'}>
                        {pulang ? (jamDari(pulang.waktu) || '✓') : 'tidak ada'}</b></span>
                    </div>
                  )}

                  {lain.map((x, i) => {
                    const ditolak = String(x.status || '').trim() === 'Rejected';
                    return (
                      <p key={(x.uuid || '') + i} className={`mt-1 text-[12px] ${ditolak ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                        {x.tipe}
                        {jamDari(x.waktu) && <span className="tabular-nums"> · {jamDari(x.waktu)}</span>}
                        {x.status && x.status !== '-' && <span> · {ditolak ? 'Ditolak' : x.status}</span>}
                        {x.catatan && x.catatan !== '-' && <span className="text-slate-400"> · {x.catatan}</span>}
                      </p>
                    );
                  })}

                  {lokasi && lokasi !== '-' && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-400">
                      <MapPin className="w-3 h-3 mt-[2px] shrink-0" strokeWidth={1.75} />
                      <span className="line-clamp-1">{lokasi}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
