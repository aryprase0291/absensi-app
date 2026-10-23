// SINKRON TABEL DATA (DB_FIX) -> GSHEET DB ABSEN (23 Okt 2026)
//
// Dua bagian:
//  - <SinkronGsheetPanel>  : isi tab "Sinkron GSheet" — link tujuan (ganti
//    tiap bulan), nama sheet, periode, sakelar otomatis, status terakhir,
//    tombol sinkron sekarang.
//  - <TombolSinkronGsheet> : tombol ringkas di kepala Tabel Data.
//
// Backend: apps-script/SinkronGsheet.gs (aksi get_sinkron_gsheet,
// set_sinkron_gsheet, sinkron_gsheet — admin saja).
import React, { useCallback, useEffect, useState } from 'react';
import {
  UploadCloud, Link2, Save, Loader2, CheckCircle2, AlertTriangle, Clock, ExternalLink
} from 'lucide-react';

const fmtWaktu = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtYmd = (ymd) => {
  const b = String(ymd || '').split('-');
  return b.length === 3 ? `${b[2]}/${b[1]}/${b[0]}` : (ymd || '-');
};

const pesanGagalServer = (res, cadangan) => {
  const m = res && res.message ? String(res.message) : '';
  if (/action tidak dikenal/i.test(m)) return 'Server belum diperbarui: pasang SinkronGsheet.gs lalu deploy ulang Apps Script.';
  return m || cadangan;
};

/** Baris status terakhir (dipakai panel & tombol). */
export function StatusSinkronGsheet({ status, antri, ringkas = false }) {
  if (!status && !antri) {
    return <span className="text-slate-400">Belum pernah sinkron.</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {status && (status.ok
        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        : <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />)}
      {status && (
        <span className={status.ok ? 'text-slate-600' : 'text-rose-700'}>
          {ringkas
            ? (status.ok ? `Sinkron ${fmtWaktu(status.waktu)} · ${status.baris} baris` : `Gagal ${fmtWaktu(status.waktu)}: ${status.pesan}`)
            : `${fmtWaktu(status.waktu)} (${status.asal === 'otomatis' ? 'otomatis' : 'manual'}${status.oleh ? ', ' + status.oleh : ''}) — ${status.pesan}`}
        </span>
      )}
      {antri && (
        <span className="inline-flex items-center gap-1 text-amber-700">
          <Clock className="w-3.5 h-3.5" /> sinkron otomatis terjadwal
        </span>
      )}
    </span>
  );
}

/** Tombol ringkas di kepala Tabel Data. */
export function TombolSinkronGsheet({ doApiCall, onBukaSetelan }) {
  const [info, setInfo] = useState(null);
  const [jalan, setJalan] = useState(false);
  const [galat, setGalat] = useState('');

  const muat = useCallback(async () => {
    try {
      const res = await doApiCall('get_sinkron_gsheet');
      if (res && res.result === 'success') { setInfo(res); setGalat(''); }
      else setGalat(pesanGagalServer(res, 'Status sinkron tidak terbaca.'));
    } catch (e) { setGalat('Status sinkron tidak terbaca.'); }
  }, [doApiCall]);

  useEffect(() => { muat(); }, [muat]);

  const sinkron = async () => {
    if (!info || !info.setelan || !info.setelan.id) { if (onBukaSetelan) onBukaSetelan(); return; }
    setJalan(true); setGalat('');
    try {
      const res = await doApiCall('sinkron_gsheet');
      if (!res || res.result !== 'success') setGalat(pesanGagalServer(res, 'Sinkron gagal.'));
    } catch (e) {
      setGalat('Sinkron gagal: koneksi terputus.');
    } finally {
      setJalan(false);
      muat();
    }
  };

  const belumDiatur = info && info.setelan && !info.setelan.id;
  return (
    <div className="flex flex-col items-stretch sm:items-end gap-1 shrink-0">
      <button
        onClick={sinkron}
        disabled={jalan}
        title={belumDiatur ? 'Atur link GSheet tujuan dulu' : 'Tulis isi Tabel Data periode ini ke GSheet DB ABSEN'}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition active:scale-95"
      >
        {jalan ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
        <span>{jalan ? 'Menyinkron…' : belumDiatur ? 'Atur Sinkron GSheet' : 'Sinkron ke GSheet'}</span>
      </button>
      <div className="text-[11px] max-w-xs sm:text-right">
        {galat
          ? <span className="text-rose-700">{galat}</span>
          : info ? <StatusSinkronGsheet status={info.status} antri={info.antri} ringkas /> : null}
      </div>
    </div>
  );
}

/** Isi tab "Sinkron GSheet". */
export default function SinkronGsheetPanel({ doApiCall, kelasKartu }) {
  const [info, setInfo] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [form, setForm] = useState({ link: '', sheet: '', periode: '', otomatis: true });
  const [simpan, setSimpan] = useState(false);
  const [jalan, setJalan] = useState(false);
  const [pesan, setPesan] = useState(null); // {ok, teks}

  const pasangInfo = useCallback((res) => {
    setInfo(res);
    const s = res.setelan || {};
    setForm({
      link: s.link || '',
      sheet: s.sheet || 'db1-absen',
      periode: s.dari && s.sampai ? `${s.dari}|${s.sampai}` : '',
      otomatis: s.otomatis !== false
    });
  }, []);

  const muat = useCallback(async (pasangForm = true) => {
    setMemuat(true);
    try {
      const res = await doApiCall('get_sinkron_gsheet');
      if (res && res.result === 'success') {
        if (pasangForm) pasangInfo(res); else setInfo(res);
      } else {
        setPesan({ ok: false, teks: pesanGagalServer(res, 'Setelan tidak terbaca.') });
      }
    } catch (e) {
      setPesan({ ok: false, teks: 'Setelan tidak terbaca: koneksi terputus.' });
    } finally {
      setMemuat(false);
    }
  }, [doApiCall, pasangInfo]);

  useEffect(() => { muat(); }, [muat]);

  const daftarPeriode = (info && info.periodeAktif) || [];
  const bawaan = (info && info.periodeBawaan) || {};

  const simpanSetelan = async () => {
    setSimpan(true); setPesan(null);
    const [dari, sampai] = form.periode ? form.periode.split('|') : ['', ''];
    try {
      const res = await doApiCall('set_sinkron_gsheet', {
        link: form.link, sheet: form.sheet, dari, sampai, otomatis: form.otomatis
      });
      if (res && res.result === 'success') {
        pasangInfo(res);
        setPesan({ ok: true, teks: `Tersimpan. Tujuan: "${res.setelan.namaFile}" / ${res.setelan.sheet}.` });
      } else {
        setPesan({ ok: false, teks: pesanGagalServer(res, 'Gagal menyimpan setelan.') });
      }
    } catch (e) {
      setPesan({ ok: false, teks: 'Gagal menyimpan: koneksi terputus.' });
    } finally {
      setSimpan(false);
    }
  };

  const sinkronSekarang = async () => {
    setJalan(true); setPesan(null);
    try {
      const res = await doApiCall('sinkron_gsheet');
      setPesan(res && res.result === 'success'
        ? { ok: true, teks: res.message }
        : { ok: false, teks: pesanGagalServer(res, 'Sinkron gagal.') });
    } catch (e) {
      setPesan({ ok: false, teks: 'Sinkron gagal: koneksi terputus.' });
    } finally {
      setJalan(false);
      muat(false);
    }
  };

  const setelan = (info && info.setelan) || {};
  const berubah = info && (
    form.link !== (setelan.link || '') ||
    form.sheet !== (setelan.sheet || 'db1-absen') ||
    form.periode !== (setelan.dari && setelan.sampai ? `${setelan.dari}|${setelan.sampai}` : '') ||
    form.otomatis !== (setelan.otomatis !== false)
  );

  const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';
  const input = 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

  return (
    <div className="space-y-4 w-full">
      <div className={kelasKartu}>
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">Sinkron Tabel Data ke GSheet DB ABSEN</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Isi Tabel Data (DB_FIX) — mesin, absen online, dan koreksi — ditulis ke sheet tujuan. Otomatis berjalan ±2 menit setelah impor atau koreksi, atau klik "Sinkron sekarang".
          </p>
        </div>

        {memuat && !info ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" /> Memuat setelan…
          </div>
        ) : (
          <div className="p-4 sm:p-5 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <label className={label}>Link Google Sheet tujuan</label>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      className={`${input} pl-9`}
                      placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
                      value={form.link}
                      onChange={e => setForm(f => ({ ...f, link: e.target.value }))}
                    />
                  </div>
                  {setelan.link && (
                    <a href={setelan.link} target="_blank" rel="noreferrer"
                       className="px-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center" title="Buka file tujuan">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Ganti setiap bulan ke file DB_ABSEN periode berjalan. File harus bisa diedit oleh akun pemilik Apps Script.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>Nama sheet</label>
                  <input className={input} value={form.sheet} onChange={e => setForm(f => ({ ...f, sheet: e.target.value }))} placeholder="db1-absen" />
                </div>
                <div>
                  <label className={label}>Periode yang dikirim</label>
                  <select className={input} value={form.periode} onChange={e => setForm(f => ({ ...f, periode: e.target.value }))}>
                    <option value="">Ikut periode aktif{bawaan.dari ? ` (${fmtYmd(bawaan.dari)} – ${fmtYmd(bawaan.sampai)})` : ''}</option>
                    {daftarPeriode.map(p => (
                      <option key={p.id || p.mulai} value={`${p.mulai}|${p.selesai}`}>
                        {p.label || `${fmtYmd(p.mulai)} – ${fmtYmd(p.selesai)}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={form.otomatis}
                       onChange={e => setForm(f => ({ ...f, otomatis: e.target.checked }))} />
                Sinkron otomatis setelah impor &amp; koreksi
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={simpanSetelan} disabled={simpan || !form.link.trim()}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition active:scale-95">
                  {simpan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Simpan setelan
                </button>
                <button onClick={sinkronSekarang} disabled={jalan || !setelan.id || berubah}
                        title={berubah ? 'Simpan setelan dulu' : ''}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition active:scale-95">
                  {jalan ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {jalan ? 'Menyinkron… (±30 detik)' : 'Sinkron sekarang'}
                </button>
              </div>

              {pesan && (
                <div className={`text-xs rounded-xl px-3 py-2 border ${pesan.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                  {pesan.teks}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-600 space-y-2">
              <div className="font-bold text-slate-800 text-sm">Status</div>
              <div><span className="text-slate-400">Tujuan:</span> {setelan.namaFile ? <b>{setelan.namaFile}</b> : '-'} {setelan.sheet ? `/ ${setelan.sheet}` : ''}</div>
              <div><span className="text-slate-400">Periode:</span> {setelan.dari ? `${fmtYmd(setelan.dari)} – ${fmtYmd(setelan.sampai)}` : `ikut periode aktif${bawaan.dari ? ` (${fmtYmd(bawaan.dari)} – ${fmtYmd(bawaan.sampai)})` : ''}`}</div>
              <div><span className="text-slate-400">Otomatis:</span> {setelan.otomatis !== false ? 'aktif' : 'mati'}</div>
              <div className="pt-1"><span className="text-slate-400">Terakhir:</span> <StatusSinkronGsheet status={info && info.status} antri={info && info.antri} /></div>
              <div className="pt-2 border-t border-slate-200 text-slate-500 leading-relaxed">
                Kolom dicocokkan dari nama header baris 1 (ID, NO AKUN, PAYROLL, NAMA, TANGGAL, … WAKTU SCAN). Isi lama di bawah header diganti isi periode; kolom ID tetap rumus <span className="font-mono">=PAYROLL&amp;TANGGAL</span>. Setelah itu "Sinkron Absensi" di file tujuan (ABSENSI → ABSENSI-email) ikut dijalankan otomatis.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
