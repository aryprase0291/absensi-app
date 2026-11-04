// =====================================================================
// MASTER TIM APPROVAL — ringkasan atasan & timnya (4 Nov 2026)
//
// Ditampilkan di atas editor Tim approval (Admin Panel). Satu kartu per
// atasan: nama, jabatan, role, lokasi, lalu anggota tim per departemen.
// Atasan yang terdaftar di sini:
//   - meng-approve pengajuan anggota timnya lewat aplikasi, dan
//   - membuka "Histori Tim" di beranda (laporan absensi timnya, lihat saja).
// Data: approvalTeamUsers + approvalTeamAssignments (sheet ApprovalTeams).
// =====================================================================

import React, { useMemo, useState } from 'react';
import { Search, Users, UserPlus, Pencil, MapPin, Eye, ShieldCheck } from 'lucide-react';

const WARNA = ['bg-indigo-600', 'bg-rose-600', 'bg-emerald-600', 'bg-teal-600', 'bg-blue-600', 'bg-amber-600', 'bg-violet-600', 'bg-cyan-600'];
const inisial = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const warnaDari = (s) => WARNA[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % WARNA.length];

export default function MasterTimApproval({ users, assignments, onKelola, onTambah }) {
  const [cari, setCari] = useState('');

  const petaUser = useMemo(() => {
    const m = {};
    (users || []).forEach((u) => { m[String(u.uuid)] = u; });
    return m;
  }, [users]);

  // Kelompokkan: atasan -> departemen -> anggota
  const atasan = useMemo(() => {
    const m = {};
    (assignments || []).forEach((a) => {
      const k = String(a.kepalaId);
      if (!m[k]) {
        const u = petaUser[k] || {};
        m[k] = { id: k, nama: u.nama || a.kepalaNama || k, role: u.role || '', divisi: u.divisi || '', lokasi: u.lokasi || '', jabatan: '', grup: {} };
      }
      if (a.jabatan && !m[k].jabatan) m[k].jabatan = a.jabatan;
      const d = a.departemen || '-';
      if (!m[k].grup[d]) m[k].grup[d] = [];
      m[k].grup[d].push({ ...a, anggota: petaUser[String(a.anggotaId)] || null });
    });
    return Object.values(m).map((x) => ({
      ...x,
      total: Object.values(x.grup).reduce((n, g) => n + g.length, 0),
    })).sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
  }, [assignments, petaUser]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return atasan;
    return atasan.filter((x) => [x.nama, x.jabatan, x.divisi, ...Object.keys(x.grup),
      ...Object.values(x.grup).flat().map((r) => r.anggotaNama)].some((s) => String(s || '').toLowerCase().includes(q)));
  }, [atasan, cari]);

  const totalAnggota = useMemo(() => new Set((assignments || []).map((a) => String(a.anggotaId))).size, [assignments]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
      <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
        <div className="flex items-center gap-3 mr-auto">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></div>
          <div>
            <p className="text-[15px] font-semibold text-slate-900 leading-tight">Master Tim Approval</p>
            <p className="text-[11.5px] text-slate-400">Atasan yang meng-approve lewat aplikasi &amp; bisa melihat histori absensi timnya</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-1.5 rounded-lg border border-slate-200 text-center">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">Atasan</p>
            <p className="text-[16px] font-semibold tabular-nums text-indigo-600 leading-tight">{atasan.length}</p>
          </div>
          <div className="px-3 py-1.5 rounded-lg border border-slate-200 text-center">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">Anggota</p>
            <p className="text-[16px] font-semibold tabular-nums text-emerald-600 leading-tight">{totalAnggota}</p>
          </div>
        </div>
        <button type="button" onClick={onTambah} className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white text-[12.5px] font-medium hover:bg-indigo-700">
          <UserPlus className="w-4 h-4" /> Tambah atasan
        </button>
      </div>

      <div className="p-4 space-y-3">
        {atasan.length > 3 && (
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari atasan, departemen, atau anggota…"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-[13px] outline-none focus:bg-white focus:border-indigo-400" />
          </div>
        )}

        {atasan.length === 0 && (
          <div className="py-10 text-center">
            <Users className="w-9 h-9 mx-auto text-slate-300" />
            <p className="mt-2 text-[13px] text-slate-500">Belum ada tim approval. Klik <b>Tambah atasan</b> untuk membuat yang pertama.</p>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {tampil.map((x) => (
            <div key={x.id} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-3 px-3.5 py-3 bg-slate-50/70 border-b border-slate-100">
                <div className={`w-10 h-10 rounded-full ${warnaDari(x.nama)} text-white text-[13px] font-semibold flex items-center justify-center shrink-0`}>{inisial(x.nama)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-slate-900 truncate">{x.nama}</p>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    {x.jabatan && <span className="text-[11px] text-slate-600">{x.jabatan}</span>}
                    <span className="px-1.5 py-px rounded bg-amber-100 text-amber-800 text-[10px] font-medium">{x.role || '-'}</span>
                    {x.lokasi && <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded bg-emerald-50 text-emerald-700 text-[10px]"><MapPin className="w-2.5 h-2.5" />{x.lokasi}</span>}
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[11px] text-slate-600 tabular-nums"><Users className="w-3 h-3" />{x.total}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {Object.keys(x.grup).sort().map((d) => (
                  <div key={d} className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex-1 truncate">{d} <span className="font-normal text-slate-400">· {x.grup[d].length} anggota</span></p>
                      <button type="button" onClick={() => onKelola(x.id, d, x.grup[d])}
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-indigo-700">
                        <Pencil className="w-3 h-3" /> Kelola
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {x.grup[d].map((r) => (
                        <span key={r.anggotaId} className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] text-slate-700" title={r.anggota ? `${r.anggota.divisi || ''} · ${r.anggota.lokasi || ''}` : ''}>
                          {String((r.anggota && r.anggota.nama) || r.anggotaNama || r.anggotaId).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-3.5 py-2 bg-indigo-50/50 text-[10.5px] text-indigo-700 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Bisa approve &amp; melihat histori absensi {x.total} anggota ini (menu "Histori Tim" di beranda).
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
