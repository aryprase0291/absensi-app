// =====================================================================
// MASTER ROLE & LOKASI AKSES — Admin Panel (24 Okt 2026)
//
// Satu tempat mengatur:
//   - role apa saja yang boleh ditulis di kolom Role sheet Users,
//   - TINGKAT dasarnya (dipakai aturan keamanan per aksi di server),
//   - LOKASI yang boleh dilihat (HRD SBY -> Surabaya, HRD JKT -> Jakarta),
//   - MENU yang ditampilkan.
//
// Datanya di Supabase (tabel master_role & master_lokasi), ditulis HANYA
// lewat Edge Function `master-role`. Sesudah menyimpan, layar ini meminta
// Apps Script menyegarkan simpanannya (`segarkan_master_role`) supaya
// aturan baru langsung berlaku tanpa menunggu sinkron 10 menit.
//
// Penetapan role ke tiap karyawan TETAP di kolom Role sheet Users.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, MapPin, Plus, Pencil, Trash2, Loader2, RefreshCcw,
  AlertTriangle, CheckCircle2, X, Users, Info
} from 'lucide-react';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SCRIPT_URL } from '../config/constants';

const LABEL_TINGKAT = {
  admin: 'Admin', hrd: 'HRD', manager: 'Manager', pimpinan: 'Pimpinan', kepala: 'Kepala',
  kepala_divisi: 'Kepala Divisi', supervisor: 'Supervisor', spv: 'SPV', karyawan: 'Karyawan',
};
const LABEL_MENU = {
  approval: 'Approval', respon_laporan: 'Respon laporan', laporan_semua: 'Riwayat semua karyawan',
  rekap: 'Rekap & ABSEN-EMAIL', info_hrd: 'Info HRD', data_karyawan: 'Data karyawan',
  gps: 'Monitoring GPS', panel_admin: 'Panel',
};
const WARNA_TINGKAT = {
  admin: 'bg-slate-900 text-white', hrd: 'bg-violet-100 text-violet-700',
  karyawan: 'bg-slate-100 text-slate-600',
};

const kosongRole = () => ({ kode: '', nama: '', tingkat: 'hrd', lokasi: [], menu: [], keterangan: '', urut: 50, aktif: true, sistem: false, baru: true });
const kosongLokasi = () => ({ kode: '', nama: '', alias: [], urut: 50, aktif: true, baru: true });

function teksCakupan(lokasi) {
  if (!lokasi || !lokasi.length) return 'Ikut lokasi user';
  if (lokasi.includes('*')) return 'Semua lokasi';
  return lokasi.join(', ');
}

/** Daftar role aktif dari master (untuk dropdown form user). Gagal -> null. */
export async function ambilDaftarRoleMaster(user) {
  try {
    const res = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/master-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ aksi: 'semua', token: (user && user.token) || '' }),
    });
    const j = await res.json();
    if (!j || j.result !== 'success') return null;
    return (j.roles || []).filter((r) => r.aktif !== false && r.kode !== 'kayawan')
      .map((r) => ({ value: r.kode, label: r.nama + ' (' + r.kode + ')' + (r.lokasi && r.lokasi.length && !r.lokasi.includes('*') ? ' · ' + r.lokasi.join(', ') : '') }));
  } catch (e) { return null; }
}

export default function MasterRolePanel({ user, fetchApi }) {
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState(null); // {jenis:'ok'|'galat', teks}
  const [formRole, setFormRole] = useState(null);
  const [formLokasi, setFormLokasi] = useState(null);
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
    try { setData(await panggil({ aksi: 'semua' })); }
    catch (e) { setGalat(e.message); }
    finally { setMemuat(false); }
  }, [panggil]);

  useEffect(() => { muat(); }, [muat]);

  // Terapkan ke Apps Script supaya berlaku seketika.
  const terapkan = useCallback(async () => {
    try {
      const f = fetchApi || fetch;
      const r = await f(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'segarkan_master_role' }) });
      const j = await r.json();
      return j && j.result === 'success' ? '' : ((j && j.message) || 'Apps Script belum menerapkan.');
    } catch (e) { return 'Apps Script belum menerapkan (akan ikut sinkron 10 menit berikutnya).'; }
  }, [fetchApi]);

  const selesai = async (teks) => {
    const catatan = await terapkan();
    setPesan({ jenis: catatan ? 'galat' : 'ok', teks: catatan ? teks + ' — ' + catatan : teks + ' Berlaku untuk request berikutnya; menu baru tampil setelah user login ulang.' });
    await muat();
  };

  const simpanRole = async (e) => {
    e.preventDefault();
    setMenyimpan(true); setPesan(null);
    try {
      await panggil({ aksi: 'simpan_role', role: formRole });
      setFormRole(null);
      await selesai('Role "' + formRole.kode + '" tersimpan.');
    } catch (err) { setPesan({ jenis: 'galat', teks: err.message }); }
    finally { setMenyimpan(false); }
  };

  const hapusRole = async (r) => {
    if (!window.confirm('Hapus role "' + r.kode + '"?')) return;
    setPesan(null);
    try { await panggil({ aksi: 'hapus_role', kode: r.kode }); await selesai('Role "' + r.kode + '" dihapus.'); }
    catch (err) { setPesan({ jenis: 'galat', teks: err.message }); }
  };

  const simpanLokasi = async (e) => {
    e.preventDefault();
    setMenyimpan(true); setPesan(null);
    try {
      await panggil({ aksi: 'simpan_lokasi', lokasi: formLokasi });
      setFormLokasi(null);
      await selesai('Lokasi "' + formLokasi.kode + '" tersimpan.');
    } catch (err) { setPesan({ jenis: 'galat', teks: err.message }); }
    finally { setMenyimpan(false); }
  };

  const hapusLokasi = async (l) => {
    if (!window.confirm('Hapus lokasi "' + l.kode + '"?')) return;
    setPesan(null);
    try { await panggil({ aksi: 'hapus_lokasi', kode: l.kode }); await selesai('Lokasi "' + l.kode + '" dihapus.'); }
    catch (err) { setPesan({ jenis: 'galat', teks: err.message }); }
  };

  const roles = useMemo(() => (data && data.roles) || [], [data]);
  const lokasi = useMemo(() => (data && data.lokasi) || [], [data]);
  const pemakai = useMemo(() => (data && data.pemakai) || {}, [data]);
  const lokasiUser = useMemo(() => (data && data.lokasiUser) || {}, [data]);
  const daftarTingkat = (data && data.tingkat) || Object.keys(LABEL_TINGKAT);
  const daftarMenu = (data && data.menu) || Object.keys(LABEL_MENU);

  // Kode role di sheet Users yang belum terdaftar di master.
  const tidakTerdaftar = useMemo(() => {
    const ada = new Set(roles.map((r) => r.kode));
    return Object.keys(pemakai).filter((k) => !ada.has(k)).sort();
  }, [roles, pemakai]);

  // Ejaan lokasi di sheet Users yang tidak dikenali master_lokasi.
  const lokasiAsing = useMemo(() => {
    const kenal = new Set();
    lokasi.forEach((l) => { kenal.add(String(l.kode).toLowerCase()); (l.alias || []).forEach((a) => kenal.add(String(a).toLowerCase())); });
    return Object.keys(lokasiUser).filter((k) => k !== '(kosong)' && k.toLowerCase() !== 'all' && !kenal.has(k.toLowerCase())).sort();
  }, [lokasi, lokasiUser]);

  // Jumlah karyawan per lokasi baku (menggabungkan alias).
  const jumlahPerLokasi = useMemo(() => {
    const hasil = {};
    lokasi.forEach((l) => {
      const ejaan = new Set([String(l.kode).toLowerCase(), ...(l.alias || []).map((a) => String(a).toLowerCase())]);
      hasil[l.kode] = Object.keys(lokasiUser).reduce((n, k) => n + (ejaan.has(k.toLowerCase()) ? lokasiUser[k] : 0), 0);
    });
    return hasil;
  }, [lokasi, lokasiUser]);

  if (memuat && !data) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat master role…</div>;
  }
  if (galat && !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        <p className="font-semibold">Master role tidak bisa dimuat</p>
        <p className="mt-1 text-[13px]">{galat}</p>
        <button onClick={muat} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"><RefreshCcw className="h-3.5 w-3.5" /> Coba lagi</button>
      </div>
    );
  }

  const modeLokasi = (f) => (f.lokasi.includes('*') ? 'semua' : f.lokasi.length ? 'pilih' : 'ikut');

  return (
    <div className="space-y-5">
      {/* Penjelasan singkat */}
      <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-[12.5px] leading-relaxed text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div>
          Kolom <b>Role</b> di sheet Users diisi <b>kode role</b> dari daftar ini (mis. <code className="rounded bg-white px-1">hrd_sby</code>).
          <b> Tingkat</b> menentukan hak aksi, <b>Lokasi</b> menentukan data karyawan mana yang terlihat, <b>Menu</b> kosong berarti semua menu tingkatnya.
        </div>
      </div>

      {pesan && (
        <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-[13px] ${pesan.jenis === 'ok' ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
          {pesan.jenis === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{pesan.teks}</span>
          <button onClick={() => setPesan(null)} aria-label="Tutup"><X className="h-4 w-4 opacity-60" /></button>
        </div>
      )}

      {/* ROLE */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-[18px] w-[18px] text-violet-600" strokeWidth={1.75} />
            <h3 className="text-[14px] font-semibold text-slate-900">Role & lokasi akses</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{roles.length}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={muat} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              <RefreshCcw className={`h-3.5 w-3.5 ${memuat ? 'animate-spin' : ''}`} /> Muat ulang
            </button>
            <button onClick={() => setFormRole(kosongRole())} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
              <Plus className="h-3.5 w-3.5" /> Role baru
            </button>
          </div>
        </div>

        {tidakTerdaftar.length > 0 && (
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Role di sheet Users yang belum terdaftar</p>
            <p className="mt-0.5 text-amber-800">Role ini tetap jalan seperti dulu (kodenya dipakai sebagai tingkat), tapi tidak bisa diatur lokasinya.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tidakTerdaftar.map((k) => (
                <button key={k} onClick={() => setFormRole({ ...kosongRole(), kode: k === '(kosong)' ? '' : k, nama: k, tingkat: daftarTingkat.includes(k) ? k : 'karyawan' })}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11.5px] text-amber-900 hover:bg-amber-100">
                  <code>{k}</code> <span className="text-amber-600">· {pemakai[k]} orang</span> <Plus className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Kode / nama</th>
                <th className="px-3 py-2 text-left font-medium">Tingkat</th>
                <th className="px-3 py-2 text-left font-medium">Lokasi yang dilihat</th>
                <th className="px-3 py-2 text-left font-medium">Menu</th>
                <th className="px-3 py-2 text-right font-medium">Pemakai</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((r) => (
                <tr key={r.kode} className={r.aktif ? '' : 'opacity-50'}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11.5px] text-slate-800">{r.kode}</code>
                      {r.sistem && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">bawaan</span>}
                      {!r.aktif && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">nonaktif</span>}
                    </div>
                    <div className="mt-0.5 text-slate-600">{r.nama}</div>
                    {r.keterangan && <div className="mt-0.5 text-[11px] text-slate-400">{r.keterangan}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${WARNA_TINGKAT[r.tingkat] || 'bg-indigo-50 text-indigo-700'}`}>{LABEL_TINGKAT[r.tingkat] || r.tingkat}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.lokasi && r.lokasi.length && !r.lokasi.includes('*')
                      ? <div className="flex flex-wrap gap-1">{r.lokasi.map((l) => <span key={l} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"><MapPin className="h-3 w-3" />{l}</span>)}</div>
                      : <span className="text-slate-500">{teksCakupan(r.lokasi)}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">
                    {r.menu && r.menu.length ? r.menu.map((m) => LABEL_MENU[m] || m).join(', ') : 'Semua menu tingkatnya'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-slate-400" />{pemakai[r.kode] || 0}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setFormRole({ ...r, lokasi: r.lokasi || [], menu: r.menu || [] })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Ubah"><Pencil className="h-3.5 w-3.5" /></button>
                      {!r.sistem && <button onClick={() => hapusRole(r)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50" title="Hapus"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* LOKASI */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-[18px] w-[18px] text-emerald-600" strokeWidth={1.75} />
            <h3 className="text-[14px] font-semibold text-slate-900">Master lokasi</h3>
          </div>
          <button onClick={() => setFormLokasi(kosongLokasi())} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> Lokasi baru
          </button>
        </div>
        {lokasiAsing.length > 0 && (
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
            <p className="font-semibold">Ejaan lokasi di sheet Users yang belum dikenali</p>
            <p className="mt-0.5 text-amber-800">Karyawan dengan lokasi ini tidak akan terlihat oleh HRD yang dibatasi lokasinya. Tambahkan sebagai alias lokasi yang benar.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lokasiAsing.map((k) => <span key={k} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11.5px]"><code>{k}</code> · {lokasiUser[k]} orang</span>)}
            </div>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {lokasi.map((l) => (
            <div key={l.kode} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-[12.5px] ${l.aktif ? '' : 'opacity-50'}`}>
              <div className="min-w-[120px] font-medium text-slate-800">{l.nama}</div>
              <div className="flex flex-1 flex-wrap gap-1">
                {(l.alias || []).map((a) => <code key={a} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{a}</code>)}
              </div>
              <div className="tabular-nums text-slate-500"><Users className="mr-1 inline h-3.5 w-3.5 text-slate-400" />{jumlahPerLokasi[l.kode] || 0}</div>
              <div className="inline-flex gap-1">
                <button onClick={() => setFormLokasi({ ...l, alias: l.alias || [] })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Ubah"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => hapusLokasi(l)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50" title="Hapus"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FORM ROLE */}
      {formRole && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={() => !menyimpan && setFormRole(null)}>
          <form onSubmit={simpanRole} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">{formRole.baru ? 'Role baru' : 'Ubah role'}</h3>
              <button type="button" onClick={() => setFormRole(null)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-3.5 text-[13px]">
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Kode (ditulis di kolom Role sheet Users)</span>
                <input value={formRole.kode} disabled={!formRole.baru} required pattern="[a-z0-9_]{2,40}"
                  onChange={(e) => setFormRole({ ...formRole, kode: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  placeholder="mis. hrd_sby" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono disabled:bg-slate-50" />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Nama tampilan</span>
                <input value={formRole.nama} onChange={(e) => setFormRole({ ...formRole, nama: e.target.value })} placeholder="mis. HRD Surabaya" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Tingkat (hak aksi)</span>
                <select value={formRole.tingkat} disabled={formRole.sistem} onChange={(e) => setFormRole({ ...formRole, tingkat: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-50">
                  {daftarTingkat.map((t) => <option key={t} value={t}>{LABEL_TINGKAT[t] || t}</option>)}
                </select>
              </label>

              <fieldset>
                <legend className="text-[12px] font-medium text-slate-600">Lokasi yang boleh dilihat</legend>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {[['ikut', 'Lokasi user'], ['pilih', 'Pilih lokasi'], ['semua', 'Semua']].map(([v, l]) => (
                    <button type="button" key={v}
                      onClick={() => setFormRole({ ...formRole, lokasi: v === 'semua' ? ['*'] : v === 'ikut' ? [] : (lokasi[0] ? [lokasi[0].kode] : []) })}
                      className={`rounded-lg border px-2 py-2 text-[12px] ${modeLokasi(formRole) === v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>
                  ))}
                </div>
                {modeLokasi(formRole) === 'pilih' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {lokasi.filter((l) => l.aktif).map((l) => {
                      const on = formRole.lokasi.includes(l.kode);
                      return (
                        <button type="button" key={l.kode}
                          onClick={() => {
                            const baru = on ? formRole.lokasi.filter((x) => x !== l.kode) : [...formRole.lokasi, l.kode];
                            setFormRole({ ...formRole, lokasi: baru });
                          }}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
                          <MapPin className="h-3 w-3" />{l.nama}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {modeLokasi(formRole) === 'ikut' ? 'Memakai kolom Lokasi karyawan itu sendiri (perilaku lama).' : modeLokasi(formRole) === 'semua' ? 'Melihat karyawan di semua lokasi.' : 'Hanya karyawan di lokasi yang dipilih.'}
                </p>
              </fieldset>

              <fieldset>
                <legend className="text-[12px] font-medium text-slate-600">Menu (kosong = semua menu tingkatnya)</legend>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {daftarMenu.map((m) => {
                    const on = formRole.menu.includes(m);
                    return (
                      <button type="button" key={m}
                        onClick={() => setFormRole({ ...formRole, menu: on ? formRole.menu.filter((x) => x !== m) : [...formRole.menu, m] })}
                        className={`rounded-full border px-2.5 py-1 text-[12px] ${on ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>
                        {LABEL_MENU[m] || m}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Keterangan</span>
                <input value={formRole.keterangan || ''} onChange={(e) => setFormRole({ ...formRole, keterangan: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className="text-[12px] text-slate-600">Urutan</span>
                  <input type="number" value={formRole.urut} onChange={(e) => setFormRole({ ...formRole, urut: e.target.value })} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-slate-600">
                  <input type="checkbox" checked={formRole.aktif !== false} disabled={formRole.sistem} onChange={(e) => setFormRole({ ...formRole, aktif: e.target.checked })} /> Aktif
                </label>
              </div>
              {formRole.aktif === false && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">Role nonaktif diturunkan menjadi tingkat Karyawan.</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFormRole(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600">Batal</button>
              <button type="submit" disabled={menyimpan || (modeLokasi(formRole) === 'pilih' && !formRole.lokasi.length)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
                {menyimpan && <Loader2 className="h-4 w-4 animate-spin" />} Simpan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FORM LOKASI */}
      {formLokasi && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={() => !menyimpan && setFormLokasi(null)}>
          <form onSubmit={simpanLokasi} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">{formLokasi.baru ? 'Lokasi baru' : 'Ubah lokasi'}</h3>
              <button type="button" onClick={() => setFormLokasi(null)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-3.5 text-[13px]">
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Nama baku</span>
                <input value={formLokasi.kode} disabled={!formLokasi.baru} required onChange={(e) => setFormLokasi({ ...formLokasi, kode: e.target.value.replace(/,/g, ''), nama: e.target.value.replace(/,/g, '') })} placeholder="mis. Surabaya" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50" />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Ejaan lain di kolom Lokasi sheet Users (pisahkan koma)</span>
                <input value={(formLokasi.alias || []).join(', ')} onChange={(e) => setFormLokasi({ ...formLokasi, alias: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="mis. Sby, SBY" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className="text-[12px] text-slate-600">Urutan</span>
                  <input type="number" value={formLokasi.urut} onChange={(e) => setFormLokasi({ ...formLokasi, urut: e.target.value })} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-slate-600">
                  <input type="checkbox" checked={formLokasi.aktif !== false} onChange={(e) => setFormLokasi({ ...formLokasi, aktif: e.target.checked })} /> Aktif
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFormLokasi(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600">Batal</button>
              <button type="submit" disabled={menyimpan} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
                {menyimpan && <Loader2 className="h-4 w-4 animate-spin" />} Simpan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
