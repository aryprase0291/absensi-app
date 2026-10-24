// =====================================================================
// MASTER KARYAWAN BEBAS ABSEN MESIN — Admin Panel (24 Okt 2026)
//
// Karyawan yang tidak wajib absen di mesin fingerprint. Pada hari kerja
// (baris mesin berjam kerja) tanpa scan yang oleh mesin ditandai Alpa,
// simbolnya diganti NF dan dihitung MASUK — di Rekap, Board, DB_FIX,
// Sinkron GSheet, ABSEN-EMAIL, dan dashboard karyawan.
//
// Datanya: tabel karyawan_bebas_absen di Supabase, ditulis lewat Edge
// Function `master-role` (aksi bebas_semua / simpan_bebas / hapus_bebas).
// Penerapan ke db_absen dilakukan database (trigger + terapkan_bebas_absen),
// termasuk untuk impor data mesin berikutnya.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserCheck, Plus, Pencil, Trash2, Loader2, RefreshCcw, AlertTriangle, CheckCircle2, X, Info, Search } from 'lucide-react';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SCRIPT_URL } from '../config/constants';

const kosong = () => ({ payroll: '', nama: '', mulai: '', selesai: '', keterangan: 'Tidak absen mesin, dihitung masuk hari kerja', aktif: true, baru: true });
const tampilTgl = (t) => (t ? String(t).split('-').reverse().join('/') : '');

export default function BebasAbsenPanel({ user, fetchApi }) {
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState(null);
  const [form, setForm] = useState(null);
  const [cari, setCari] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);

  const panggil = useCallback(async (muatan) => {
    const res = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/master-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ ...muatan, token: (user && user.token) || '', oleh: (user && user.nama) || '' }),
    });
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!j) throw new Error('Jawaban server tidak terbaca (HTTP ' + res.status + ').');
    if (j.result !== 'success') throw new Error(j.message || 'Gagal.');
    return j;
  }, [user]);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat('');
    try { setData(await panggil({ aksi: 'bebas_semua' })); }
    catch (e) { setGalat(e.message); }
    finally { setMemuat(false); }
  }, [panggil]);

  useEffect(() => { muat(); }, [muat]);

  // Minta Apps Script membuang simpanan rekap & indeks statistik.
  const segarkanRekap = useCallback(async () => {
    try {
      const f = fetchApi || fetch;
      const r = await f(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'segarkan_master_role', bebasBerubah: true }) });
      const j = await r.json();
      return j && j.result === 'success';
    } catch (e) { return false; }
  }, [fetchApi]);

  const selesai = async (teks, hasil) => {
    const ok = await segarkanRekap();
    const rinci = hasil ? ` (${hasil.diganti || 0} hari diubah ke NF, ${hasil.dikembalikan || 0} hari dikembalikan ke A)` : '';
    setPesan({ jenis: 'ok', teks: teks + rinci + (ok ? '. Rekap dihitung ulang.' : '. Rekap ikut diperbarui saat dibuka berikutnya.') });
    await muat();
  };

  const simpan = async (e) => {
    e.preventDefault();
    setMenyimpan(true); setPesan(null);
    try {
      const j = await panggil({ aksi: 'simpan_bebas', bebas: form });
      setForm(null);
      await selesai(`${form.nama || form.payroll} tersimpan`, j.terapkan);
    } catch (err) { setPesan({ jenis: 'galat', teks: err.message }); }
    finally { setMenyimpan(false); }
  };

  const hapus = async (b) => {
    if (!window.confirm(`Keluarkan ${b.nama || b.payroll} dari daftar bebas absen? Hari NF-nya akan kembali menjadi A (Alpa).`)) return;
    setPesan(null);
    try {
      const j = await panggil({ aksi: 'hapus_bebas', payroll: b.payroll });
      await selesai(`${b.nama || b.payroll} dikeluarkan`, j.terapkan);
    } catch (err) { setPesan({ jenis: 'galat', teks: err.message }); }
  };

  const bebas = useMemo(() => (data && data.bebas) || [], [data]);
  const karyawan = useMemo(() => (data && data.karyawan) || [], [data]);
  const hariNf = (data && data.hariNf) || {};
  const petaKaryawan = useMemo(() => {
    const m = {};
    karyawan.forEach((k) => { if (k.no_payroll) m[String(k.no_payroll).toUpperCase()] = k; });
    return m;
  }, [karyawan]);

  const saran = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q || !form || !form.baru) return [];
    const sudah = new Set(bebas.map((b) => String(b.payroll).toUpperCase()));
    return karyawan.filter((k) => k.no_payroll && !sudah.has(String(k.no_payroll).toUpperCase())
      && (String(k.nama || '').toLowerCase().includes(q) || String(k.no_payroll).toLowerCase().includes(q))).slice(0, 8);
  }, [cari, karyawan, bebas, form]);

  if (memuat && !data) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat daftar…</div>;
  }
  if (galat && !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        <p className="font-semibold">Daftar bebas absen tidak bisa dimuat</p>
        <p className="mt-1 text-[13px]">{galat}</p>
        <button onClick={muat} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"><RefreshCcw className="h-3.5 w-3.5" /> Coba lagi</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-[12.5px] leading-relaxed text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div>
          Karyawan di daftar ini <b>tidak wajib absen mesin</b>. Setiap <b>hari kerja</b> yang di mesin tertulis Alpa tanpa scan
          otomatis menjadi <b className="rounded bg-white px-1">NF</b> dan <b>dihitung masuk</b> — termasuk untuk impor data mesin berikutnya.
          Hari Off, Cuti, Sakit, Ijin, Dinas Luar, dan hari dengan scan tidak diubah.
        </div>
      </div>

      {pesan && (
        <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-[13px] ${pesan.jenis === 'ok' ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
          {pesan.jenis === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{pesan.teks}</span>
          <button onClick={() => setPesan(null)} aria-label="Tutup"><X className="h-4 w-4 opacity-60" /></button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-[18px] w-[18px] text-violet-600" strokeWidth={1.75} />
            <h3 className="text-[14px] font-semibold text-slate-900">Karyawan bebas absen mesin</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{bebas.length}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={muat} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              <RefreshCcw className={`h-3.5 w-3.5 ${memuat ? 'animate-spin' : ''}`} /> Muat ulang
            </button>
            <button onClick={() => { setForm(kosong()); setCari(''); }} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
              <Plus className="h-3.5 w-3.5" /> Tambah karyawan
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Karyawan</th>
                <th className="px-3 py-2 text-left font-medium">Berlaku</th>
                <th className="px-3 py-2 text-center font-medium">Simbol</th>
                <th className="px-3 py-2 text-right font-medium">Hari NF</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bebas.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Belum ada karyawan.</td></tr>
              )}
              {bebas.map((b) => {
                const k = petaKaryawan[String(b.payroll).toUpperCase()];
                return (
                  <tr key={b.payroll} className={b.aktif ? '' : 'opacity-50'}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{b.nama || (k && k.nama) || '-'}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        <code className="rounded bg-slate-100 px-1">{b.payroll}</code>
                        {k && <> · {k.divisi || '-'} · {k.lokasi || '-'}</>}
                        {!k && <span className="ml-1 text-amber-600">payroll tidak ada di data karyawan</span>}
                        {!b.aktif && <span className="ml-1 rounded bg-rose-100 px-1.5 text-[10px] text-rose-700">nonaktif</span>}
                      </div>
                      {b.keterangan && <div className="mt-0.5 text-[11px] text-slate-400">{b.keterangan}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {b.mulai || b.selesai ? `${b.mulai ? tampilTgl(b.mulai) : 'awal'} – ${b.selesai ? tampilTgl(b.selesai) : 'seterusnya'}` : 'Seterusnya'}
                    </td>
                    <td className="px-3 py-2.5 text-center"><span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">NF</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{hariNf[String(b.payroll).toUpperCase()] || 0}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => setForm({ ...b, mulai: b.mulai || '', selesai: b.selesai || '' })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Ubah"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => hapus(b)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50" title="Keluarkan"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={() => !menyimpan && setForm(null)}>
          <form onSubmit={simpan} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">{form.baru ? 'Tambah karyawan bebas absen' : 'Ubah'}</h3>
              <button type="button" onClick={() => setForm(null)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-3.5 text-[13px]">
              {form.baru && (
                <div className="relative">
                  <span className="text-[12px] font-medium text-slate-600">Cari karyawan</span>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Nama atau payroll" className="flex-1 outline-none" />
                  </div>
                  {saran.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                      {saran.map((k) => (
                        <button type="button" key={k.id} onClick={() => { setForm({ ...form, payroll: String(k.no_payroll).toUpperCase(), nama: k.nama }); setCari(''); }}
                          className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                          <div className="text-[13px] text-slate-800">{k.nama}</div>
                          <div className="text-[11px] text-slate-500">{k.no_payroll} · {k.divisi || '-'} · {k.lokasi || '-'}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] font-medium text-slate-600">Payroll</span>
                  <input value={form.payroll} disabled={!form.baru} required onChange={(e) => setForm({ ...form, payroll: e.target.value.toUpperCase().trim() })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono disabled:bg-slate-50" />
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-slate-600">Nama</span>
                  <input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-slate-600">Mulai (opsional)</span>
                  <input type="date" value={form.mulai || ''} onChange={(e) => setForm({ ...form, mulai: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-slate-600">Selesai (opsional)</span>
                  <input type="date" value={form.selesai || ''} onChange={(e) => setForm({ ...form, selesai: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
              </div>
              <p className="text-[11px] text-slate-400">Kosongkan tanggal = berlaku untuk seluruh data.</p>
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Keterangan</span>
                <input value={form.keterangan || ''} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <input type="checkbox" checked={form.aktif !== false} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} /> Aktif
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600">Batal</button>
              <button type="submit" disabled={menyimpan || !form.payroll} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
                {menyimpan && <Loader2 className="h-4 w-4 animate-spin" />} Simpan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
