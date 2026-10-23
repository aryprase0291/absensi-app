// TAB ABSEN-EMAIL (23 Okt 2026)
//
// Menampilkan sheet ABSENSI-email ("ABSENSI KARYAWAN PERIODE ...") dari file
// DB_ABSEN yang diatur di tab Sinkron GSheet — apa adanya: teks, warna latar
// & huruf (arti warna lihat legenda), lebar kolom, kolom tersembunyi ikut
// tersembunyi. Hanya membaca.
//
// Backend: aksi get_sinkron_gsheet dengan bagian='absensi_email'
// (handleGetAbsensiEmail di apps-script/SinkronGsheet.gs).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, ExternalLink, Search, AlertTriangle, Mail } from 'lucide-react';

const TINGGI_KEPALA = 26; // px per baris kepala (3 baris)

export default function AbsensiEmailPanel({ doApiCall, onBukaSetelan }) {
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const [cari, setCari] = useState('');
  const [grup, setGrup] = useState('');

  const muat = useCallback(async () => {
    setMemuat(true); setGalat('');
    try {
      const res = await doApiCall('get_sinkron_gsheet', { bagian: 'absensi_email' });
      if (res && res.result === 'success' && Array.isArray(res.baris)) setData(res);
      else if (res && res.result === 'success') setGalat('Server belum diperbarui: tempel ulang SinkronGsheet.gs lalu deploy versi baru.');
      else setGalat((res && res.message) || 'Sheet ABSENSI-email tidak terbaca.');
    } catch (e) {
      setGalat('Sheet ABSENSI-email tidak terbaca: koneksi terputus.');
    } finally {
      setMemuat(false);
    }
  }, [doApiCall]);

  useEffect(() => { muat(); }, [muat]);

  // Susunan kolom & kepala.
  const susunan = useMemo(() => {
    if (!data) return null;
    const n = data.kolom.length;
    const { tanggal, hari, label } = data.kepala;
    const jenis = label.map(l => {
      const u = String(l || '').trim().toUpperCase();
      return u === 'ABSEN' ? 'absen' : u === 'TELAT' ? 'telat' : 'info';
    });
    const judulInfo = jenis.map((j, i) => (j === 'info' ? String(hari[i] || label[i] || tanggal[i] || '').trim() : ''));
    let idxNama = judulInfo.findIndex(t => t.toUpperCase() === 'NAMA');
    if (idxNama < 0) idxNama = Math.min(2, n - 1);
    const lebar = data.kolom.map(k => Math.max(22, Number(k.lebar) || 60));
    const kiri = [];
    let x = 0;
    for (let i = 0; i < n; i++) { kiri.push(x); x += lebar[i]; }
    return { n, jenis, judulInfo, idxBeku: idxNama, lebar, kiri, total: x };
  }, [data]);

  const daftarGrup = useMemo(() => {
    if (!data) return [];
    const s = new Set();
    data.baris.forEach(b => { if (!b.pisah && String(b.t[0] || '').trim()) s.add(String(b.t[0]).trim()); });
    return Array.from(s);
  }, [data]);

  const barisTampil = useMemo(() => {
    if (!data || !susunan) return [];
    const q = cari.trim().toLowerCase();
    if (!q && !grup) return data.baris;
    return data.baris.filter(b => {
      if (b.pisah) return false;
      if (grup && String(b.t[0] || '').trim() !== grup) return false;
      if (!q) return true;
      for (let i = 0; i <= susunan.idxBeku + 6 && i < b.t.length; i++) {
        if (String(b.t[i] || '').toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [data, susunan, cari, grup]);

  const palet = (data && data.palet) || ['#ffffff', '#000000'];
  const beku = (i, z, extra = {}) => (susunan && i <= susunan.idxBeku
    ? { position: 'sticky', left: susunan.kiri[i], zIndex: z, ...(i === susunan.idxBeku ? { boxShadow: '3px 0 5px -2px rgba(15,23,42,0.25)' } : {}), ...extra }
    : extra);

  // Kepala 3 baris: tanggal / nama hari / ABSEN-TELAT. Kolom info memakai rowSpan 3.
  const kepala = () => {
    const { n, jenis, judulInfo } = susunan;
    const { tanggal, hari } = data.kepala;
    const r1 = [], r2 = [], r3 = [];
    const thDasar = 'border border-slate-300 bg-slate-100 text-slate-700 font-bold text-[10.5px] px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis';
    for (let i = 0; i < n; i++) {
      const top = { position: 'sticky', top: 0 };
      if (jenis[i] === 'info') {
        r1.push(
          <th key={`i${i}`} rowSpan={3} className={thDasar}
              style={{ ...top, ...beku(i, 40, { top: 0, position: 'sticky' }), zIndex: i <= susunan.idxBeku ? 40 : 30, height: TINGGI_KEPALA * 3 }}>
            {judulInfo[i]}
          </th>
        );
        continue;
      }
      if (jenis[i] === 'telat' && i > 0 && jenis[i - 1] === 'absen') {
        // sudah tercakup colSpan kolom ABSEN di baris 1 & 2
      } else {
        const span = jenis[i] === 'absen' && i + 1 < n && jenis[i + 1] === 'telat' ? 2 : 1;
        r1.push(<th key={`t${i}`} colSpan={span} className={`${thDasar} bg-white`} style={{ position: 'sticky', top: 0, zIndex: 30, height: TINGGI_KEPALA }}>{tanggal[i]}</th>);
        r2.push(<th key={`h${i}`} colSpan={span} className={`${thDasar} bg-white font-semibold`} style={{ position: 'sticky', top: TINGGI_KEPALA, zIndex: 30, height: TINGGI_KEPALA }}>{hari[i]}</th>);
      }
      r3.push(
        <th key={`l${i}`} className={`${thDasar} bg-sky-50 font-medium text-[10px]`}
            style={{ position: 'sticky', top: TINGGI_KEPALA * 2, zIndex: 30, height: TINGGI_KEPALA }}>
          {jenis[i] === 'absen' ? 'ABSEN' : 'TELAT'}
        </th>
      );
    }
    return (
      <thead>
        <tr>{r1}</tr>
        <tr>{r2}</tr>
        <tr>{r3}</tr>
      </thead>
    );
  };

  return (
    <div className="space-y-4 w-full">
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden w-full flex flex-col">
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-600 shrink-0" />
              <h2 className="text-base sm:text-lg font-black text-slate-800 tracking-tight truncate">
                {(data && data.judul) || 'ABSENSI KARYAWAN'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {data
                ? <>Dari <span className="font-semibold text-slate-700">{data.namaFile}</span> / {data.sheet} · {barisTampil.filter(b => !b.pisah).length} baris · dibaca {new Date(data.dibaca).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</>
                : 'Sheet ABSENSI-email dari file DB_ABSEN (tab Sinkron GSheet).'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Cari nama / payroll…"
                     className="pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            {daftarGrup.length > 1 && (
              <select value={grup} onChange={e => setGrup(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white">
                <option value="">Semua grup</option>
                {daftarGrup.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <button onClick={muat} disabled={memuat}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-60">
              {memuat ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />} Muat ulang
            </button>
            {data && data.url && (
              <a href={data.url} target="_blank" rel="noreferrer"
                 className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5">
                <ExternalLink className="w-4 h-4" /> Buka di GSheet
              </a>
            )}
          </div>
        </div>

        {data && data.legenda && data.legenda.length > 0 && (
          <div className="px-4 sm:px-5 py-2.5 border-b border-slate-100 flex flex-wrap gap-1.5">
            {data.legenda.map((l, i) => (
              <span key={i} className="px-2 py-0.5 rounded-md text-[10.5px] font-bold border border-black/10"
                    style={{ background: palet[l.b], color: palet[l.f] }}>{l.teks}</span>
            ))}
          </div>
        )}

        {galat ? (
          <div className="p-6 text-sm text-rose-700 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              {galat}
              {/belum diatur/i.test(galat) && onBukaSetelan && (
                <button onClick={onBukaSetelan} className="ml-2 underline font-bold">Buka tab Sinkron GSheet</button>
              )}
            </div>
          </div>
        ) : !data ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" /> Membaca sheet ABSENSI-email… (±5–10 detik)
          </div>
        ) : (
          <div className="overflow-auto w-full max-h-[calc(100vh-230px)] min-h-[420px]">
            <table className="border-collapse text-[11px]" style={{ tableLayout: 'fixed', width: susunan.total }}>
              <colgroup>
                {susunan.lebar.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              {kepala()}
              <tbody>
                {barisTampil.map((b, k) => (
                  b.pisah ? (
                    <tr key={`p${k}`}><td colSpan={susunan.n} className="h-3 bg-slate-50 border-y border-slate-200" /></tr>
                  ) : (
                    <tr key={b.r}>
                      {b.t.map((t, i) => (
                        <td key={i} title={t}
                            className={`border border-slate-200 px-1 h-[22px] whitespace-nowrap overflow-hidden text-ellipsis ${susunan.jenis[i] === 'info' ? (i === susunan.idxBeku ? 'text-left font-semibold' : 'text-center') : 'text-center'}`}
                            style={{ background: palet[b.b[i]] || '#ffffff', color: palet[b.f[i]] || '#000000', ...beku(i, 10) }}>
                          {t}
                        </td>
                      ))}
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
