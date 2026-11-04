// =====================================================================
// MASTER USER — Admin Panel > Pengguna > Master user (4 Nov 2026)
//
// Daftar seluruh user (sheet Users) dengan:
//   1. filter LOKASI & ROLE — terlihat jelas siapa di lokasi mana,
//   2. AKSES FORM per user (kolom G, pilihan dari Master Data "Menu"),
//   3. EDIT data user (identitas, divisi, role, lokasi, akses) + reset password.
//
// Server: get_user_list_admin (daftar + pilihan role) dan update_user
// (apps-script/MasterUser.gs). Admin bercakupan lokasi (mis. Admin
// Jakarta) hanya menerima user lokasinya dan tidak bisa mengubah user
// bertingkat Admin — dijaga di server (AksesLokasi.gs), di sini hanya
// ditampilkan terkunci.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Pencil, RefreshCcw, Loader2, X, MapPin, Lock, AlertTriangle, Users } from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-shadow focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5 disabled:bg-slate-50 disabled:text-slate-500';
const WARNA_TINGKAT = {
  admin: 'bg-slate-900 text-white', hrd: 'bg-violet-100 text-violet-700',
  manager: 'bg-sky-100 text-sky-700', pimpinan: 'bg-sky-100 text-sky-700',
  kepala: 'bg-amber-100 text-amber-700', kepala_divisi: 'bg-amber-100 text-amber-700',
  supervisor: 'bg-amber-100 text-amber-700', spv: 'bg-amber-100 text-amber-700',
};
const pecah = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

// MENU PER USER (Admin / HRD). Kunci = MENU_KATALOG di apps-script/MasterUser.gs.
// `hrd: true` = menu yang memang bisa dipakai tingkat HRD.
const MENU_TIDAK_ADA = '_tidak_ada';
const KATALOG_MENU = [
  { grup: 'Umum', item: [
    { k: 'panel_admin', l: 'Buka Panel', hrd: true },
    { k: 'approval', l: 'Approval pengajuan', hrd: true },
  ] },
  { grup: 'Pengguna', item: [
    { k: 'user', l: 'Tambah user baru' },
    { k: 'master_user', l: 'Master user' },
    { k: 'master_role', l: 'Master role & lokasi' },
  ] },
  { grup: 'Data', item: [
    { k: 'analysis', l: 'Analisa data' },
    { k: 'master', l: 'Master data' },
    { k: 'import_db', l: 'Import data mesin' },
    { k: 'bebas_absen', l: 'Bebas absen & harian' },
    { k: 'geomaster', l: 'Master lokasi geofence' },
    { k: 'geofence', l: 'Akses absen & geofence' },
    { k: 'period', l: 'Periode absensi' },
    { k: 'approval_team', l: 'Tim approval' },
    { k: 'perangkat', l: 'Perangkat & sesi login' },
    { k: 'wajah', l: 'Wajah karyawan' },
    { k: 'board', l: 'Board absensi' },
  ] },
  { grup: 'Laporan & Monitoring', item: [
    { k: 'rekap', l: 'Rekap, Koreksi & Export', hrd: true },
    { k: 'gps', l: 'Dashboard GPS' },
    { k: 'gps_audit', l: 'Monitoring integritas GPS' },
    { k: 'dashboard_kerani', l: 'Absen online Kerani' },
    { k: 'log_login', l: 'Log login' },
  ] },
  { grup: 'Komunikasi', item: [
    { k: 'info_hrd', l: 'Info HRD', hrd: true },
  ] },
];

function Label({ children }) {
  return <label className="block text-[11px] font-medium text-slate-500 mb-1.5">{children}</label>;
}

export default function MasterUserPanel({ user, fetchApi, masterData, listLokasi, terbatas, onResetPassword }) {
  const [list, setList] = useState([]);
  const [roles, setRoles] = useState([]);
  const [memuat, setMemuat] = useState(false);
  const [cari, setCari] = useState('');
  const [filterLokasi, setFilterLokasi] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [edit, setEdit] = useState(null);     // salinan user yang sedang disunting
  const [asli, setAsli] = useState(null);
  const [menyimpan, setMenyimpan] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_user_list_admin', roleRequester: user.role }) });
      const d = await res.json();
      if (d.result === 'success') { setList(d.list || []); setRoles(d.roles || []); }
      else alert(d.message || 'Gagal memuat daftar user.');
    } catch (e) { alert('Gagal koneksi saat memuat daftar user.'); }
    finally { setMemuat(false); }
  }, [fetchApi, user.role]);
  useEffect(() => { muat(); }, [muat]);

  // Pilihan role: dari master role (server). Cadangan: kategori Role di Master Data.
  const opsiRole = useMemo(() => (roles.length ? roles
    : (masterData.roles || []).map((r) => ({ value: String(r.value).toLowerCase(), label: r.label }))), [roles, masterData.roles]);

  const hitungLokasi = useMemo(() => {
    const h = {};
    list.forEach((u) => pecah(u.lokasi || '(kosong)').forEach((l) => { h[l] = (h[l] || 0) + 1; }));
    return Object.keys(h).sort((a, b) => h[b] - h[a]).map((l) => ({ lokasi: l, jumlah: h[l] }));
  }, [list]);
  const daftarRoleDipakai = useMemo(() => [...new Set(list.map((u) => u.role).filter(Boolean))].sort(), [list]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return list.filter((u) => {
      if (filterLokasi && !pecah(u.lokasi || '(kosong)').some((l) => l.toLowerCase() === filterLokasi.toLowerCase())) return false;
      if (filterRole && u.role !== filterRole) return false;
      if (!q) return true;
      return [u.nama, u.username, u.payroll, u.divisi].some((x) => String(x || '').toLowerCase().includes(q));
    });
  }, [list, cari, filterLokasi, filterRole]);

  const bukaEdit = (u) => {
    const menu = Array.isArray(u.menu) ? u.menu.filter((k) => k !== MENU_TIDAK_ADA) : [];
    const salinan = { ...u, akses: [...(u.akses || [])], lokasiList: pecah(u.lokasi), menuKustom: Array.isArray(u.menu), menuList: menu };
    setAsli(salinan); setEdit({ ...salinan, akses: [...salinan.akses], lokasiList: [...salinan.lokasiList], menuList: [...menu] });
  };
  const ubah = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const toggleAkses = (v) => setEdit((e) => ({ ...e, akses: e.akses.includes(v) ? e.akses.filter((x) => x !== v) : [...e.akses, v] }));
  const toggleLokasi = (loc) => setEdit((e) => {
    let l = e.lokasiList;
    if (l.includes(loc)) l = l.filter((x) => x !== loc);
    else if (loc === 'All') l = ['All'];
    else l = [...l.filter((x) => x !== 'All'), loc];
    return { ...e, lokasiList: l };
  });

  const toggleMenu = (k) => setEdit((e) => ({ ...e, menuList: e.menuList.includes(k) ? e.menuList.filter((x) => x !== k) : [...e.menuList, k] }));
  // Tingkat role yang sedang dipilih di form (admin / hrd / ...).
  const tingkatEdit = useMemo(() => {
    if (!edit) return '';
    const r = opsiRole.find((x) => x.value === edit.role);
    return String((r && r.tingkat) || edit.role || '').toLowerCase();
  }, [edit, opsiRole]);
  const pakaiMenu = tingkatEdit === 'admin' || tingkatEdit === 'hrd';
  const katalogEdit = KATALOG_MENU
    .map((g) => ({ ...g, item: g.item.filter((it) => tingkatEdit === 'admin' || it.hrd) }))
    .filter((g) => g.item.length);
  const menuBerubah = edit && asli && (
    (pakaiMenu && edit.menuKustom) !== asli.menuKustom
    || (pakaiMenu && edit.menuKustom && [...edit.menuList].sort().join() !== [...asli.menuList].sort().join()));
  const hakBerubah = edit && asli && (edit.role !== asli.role || edit.lokasiList.join(', ') !== asli.lokasiList.join(', ') || menuBerubah);
  const diriSendiri = edit && String(edit.uuid) === String(user.id || user.userId || '');

  const simpan = async () => {
    if (!edit.nama.trim()) return alert('Nama wajib diisi.');
    if (!String(edit.username).trim()) return alert('ID finger wajib diisi.');
    if (!edit.role) return alert('Role wajib dipilih.');
    if (!edit.lokasiList.length) return alert('Pilih minimal satu lokasi.');
    setMenyimpan(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({
        action: 'update_user', targetUuid: edit.uuid,
        username: String(edit.username).trim(), nama: edit.nama, divisi: edit.divisi,
        roleUser: edit.role, aksesUser: edit.akses, payrollUser: edit.payroll,
        perusahaan: edit.perusahaan, statusKaryawan: edit.statusKaryawan,
        emailAtasan: edit.emailAtasan, lokasiUser: edit.lokasiList.join(', '),
        menuKustom: pakaiMenu && edit.menuKustom,
        menuUser: pakaiMenu && edit.menuKustom ? edit.menuList : []
      }) });
      const d = await res.json();
      alert(d.message || (d.result === 'success' ? 'Tersimpan.' : 'Gagal menyimpan.'));
      if (d.result === 'success') { setEdit(null); setAsli(null); muat(); }
    } catch (e) { alert('Gagal koneksi saat menyimpan.'); }
    finally { setMenyimpan(false); }
  };

  // Pilihan yang tidak ada di master (data lama) tetap ditampilkan agar tidak hilang diam-diam.
  const opsiMenu = useMemo(() => {
    const m = (masterData.menus || []).map((x) => ({ value: x.value, label: x.label }));
    const ada = new Set(m.map((x) => x.value));
    (edit ? edit.akses : []).forEach((v) => { if (!ada.has(v)) m.push({ value: v, label: v + ' (tidak ada di master)' }); });
    return m;
  }, [masterData.menus, edit]);
  const opsiLokasi = useMemo(() => {
    const l = [...listLokasi];
    (edit ? edit.lokasiList : []).forEach((x) => { if (!l.includes(x)) l.push(x); });
    return l;
  }, [listLokasi, edit]);
  const opsiDivisi = useMemo(() => {
    const d = (masterData.divisions || []).map((x) => ({ value: x.value, label: x.label }));
    if (edit && edit.divisi && !d.some((x) => x.value === edit.divisi)) d.unshift({ value: edit.divisi, label: edit.divisi });
    return d;
  }, [masterData.divisions, edit]);
  const opsiRoleEdit = useMemo(() => {
    const r = [...opsiRole];
    if (edit && edit.role && !r.some((x) => x.value === edit.role)) r.unshift({ value: edit.role, label: edit.role + ' (tidak terdaftar)' });
    return r;
  }, [opsiRole, edit]);

  return (
    <div className="animate-in fade-in duration-300 space-y-3">
      {/* FILTER */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-3 space-y-2.5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={1.75} />
            <input type="text" placeholder="Cari nama, ID finger, payroll, divisi" value={cari} onChange={(e) => setCari(e.target.value)} className={`${inputCls} pl-9`} />
          </div>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className={`${inputCls} w-40 shrink-0`}>
            <option value="">Semua role</option>
            {daftarRoleDipakai.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={muat} disabled={memuat} title="Muat ulang" className="shrink-0 px-3 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCcw className={`w-4 h-4 ${memuat ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button onClick={() => setFilterLokasi('')} className={`shrink-0 px-2.5 py-1 rounded-full text-[12px] border ${!filterLokasi ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            Semua lokasi <span className="tabular-nums opacity-70">{list.length}</span>
          </button>
          {hitungLokasi.map(({ lokasi, jumlah }) => (
            <button key={lokasi} onClick={() => setFilterLokasi(lokasi === filterLokasi ? '' : lokasi)} className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] border ${filterLokasi === lokasi ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <MapPin className="w-3 h-3" strokeWidth={1.75} />{lokasi} <span className="tabular-nums opacity-70">{jumlah}</span>
            </button>
          ))}
        </div>
        {terbatas && <p className="text-[11px] text-amber-700">Anda melihat user lokasi {user.lokasiAkses} saja. User bertingkat Admin hanya bisa diubah Admin pusat.</p>}
      </div>

      {/* DAFTAR */}
      {memuat && !list.length ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-100 overflow-hidden">
          <div className="px-4 py-2 text-[11px] text-slate-400 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" strokeWidth={1.75} />{tampil.length} user</div>
          {tampil.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-slate-400">Tidak ada user yang cocok.</p>}
          {tampil.map((u) => {
            const kunci = terbatas && u.tingkat === 'admin';
            return (
              <div key={u.uuid} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-slate-900 tracking-tight truncate">{u.nama}</p>
                  <p className="text-[11px] text-slate-400 tabular-nums mt-0.5 truncate">ID {u.username}{u.payroll ? ` · ${u.payroll}` : ''}{u.divisi ? ` · ${u.divisi}` : ''}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${WARNA_TINGKAT[u.tingkat] || 'bg-slate-100 text-slate-600'}`} title={`Kode role: ${u.role}`}>{u.roleNama || u.role || '-'}</span>
                    {pecah(u.lokasi).map((l) => <span key={l} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10.5px] bg-emerald-50 text-emerald-700"><MapPin className="w-2.5 h-2.5" />{l}</span>)}
                    <span className="text-[10.5px] text-slate-400" title={(u.akses || []).join(', ')}>{(u.akses || []).length} form</span>
                    {Array.isArray(u.menu) && <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-indigo-50 text-indigo-700" title={u.menu.filter((k) => k !== MENU_TIDAK_ADA).join(', ') || 'tanpa menu'}>menu khusus · {u.menu.filter((k) => k !== MENU_TIDAK_ADA).length}</span>}
                  </div>
                </div>
                {kunci ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400"><Lock className="w-3.5 h-3.5" />Admin pusat</span>
                ) : (
                  <div className="shrink-0 flex gap-1.5">
                    <button onClick={() => bukaEdit(u)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50">
                      <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} /> Edit
                    </button>
                    <button onClick={() => onResetPassword(u.uuid, u.nama)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-rose-600 hover:border-rose-200">
                      <RefreshCcw className="w-3.5 h-3.5" strokeWidth={1.75} /> Reset
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FORM EDIT */}
      {edit && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4" onClick={() => !menyimpan && setEdit(null)}>
          <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2 z-10">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-400">Edit user</p>
                <p className="text-[15px] font-semibold text-slate-900 truncate">{asli.nama}</p>
              </div>
              <button onClick={() => setEdit(null)} disabled={menyimpan} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <div className="divide-y divide-slate-100">
              <div className="p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Identitas</p>
                <div><Label>Nama karyawan</Label><input className={inputCls} value={edit.nama} onChange={(e) => ubah('nama', e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>ID finger</Label><input className={`${inputCls} tabular-nums`} value={edit.username} onChange={(e) => ubah('username', e.target.value)} /></div>
                  <div><Label>No. payroll</Label><input className={`${inputCls} tabular-nums`} value={edit.payroll} onChange={(e) => ubah('payroll', e.target.value)} placeholder="C0093" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Divisi</Label>
                    <select className={inputCls} value={edit.divisi} onChange={(e) => ubah('divisi', e.target.value)}>
                      <option value="">-</option>{opsiDivisi.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div><Label>Perusahaan</Label><input className={inputCls} value={edit.perusahaan} onChange={(e) => ubah('perusahaan', e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Status karyawan</Label><input className={inputCls} value={edit.statusKaryawan} onChange={(e) => ubah('statusKaryawan', e.target.value)} /></div>
                  <div><Label>Email atasan (approval)</Label><input type="email" className={inputCls} value={edit.emailAtasan} onChange={(e) => ubah('emailAtasan', e.target.value)} /></div>
                </div>
              </div>

              <div className="p-4 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Role</p>
                <select className={inputCls} value={edit.role} onChange={(e) => ubah('role', e.target.value)} disabled={diriSendiri}>
                  {opsiRoleEdit.map((r) => <option key={r.value} value={r.value}>{r.label}{r.lokasi && r.lokasi.length && !r.lokasi.includes('*') ? ` — ${r.lokasi.join(', ')}` : ''}</option>)}
                </select>
                <p className="text-[11px] text-slate-400">Role menentukan hak menu & lokasi data yang dilihat (atur di Master role &amp; lokasi akses).</p>
              </div>

              <div className="p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Lokasi</p>
                  <span className="text-[11px] text-slate-400 tabular-nums">{edit.lokasiList.length} dipilih</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                  {opsiLokasi.map((loc) => (
                    <label key={loc} className={`flex items-center gap-2.5 py-1.5 text-[13px] ${terbatas || diriSendiri ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
                      <input type="checkbox" disabled={terbatas || diriSendiri} checked={edit.lokasiList.includes(loc)} onChange={() => toggleLokasi(loc)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-900" />
                      {loc}
                    </label>
                  ))}
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Akses form</p>
                  <span className="text-[11px] text-slate-400 tabular-nums">{edit.akses.length} dipilih</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {opsiMenu.map((m) => (
                    <label key={m.value} className="flex items-center gap-2.5 py-1.5 text-[13px] text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={edit.akses.includes(m.value)} onChange={() => toggleAkses(m.value)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-900" />
                      {m.label}
                    </label>
                  ))}
                </div>
                {opsiMenu.length === 0 && <p className="text-[12px] text-slate-400">Belum ada form di Master Data (kategori Menu).</p>}
              </div>

              {pakaiMenu && (
                <div className="p-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Akses menu ({tingkatEdit === 'admin' ? 'Admin' : 'HRD'})</p>
                    {edit.menuKustom && <span className="text-[11px] text-slate-400 tabular-nums">{edit.menuList.length} dipilih</span>}
                  </div>
                  <div className="flex gap-2 mb-3">
                    {[{ v: false, l: 'Ikuti role', d: 'Semua menu tingkatnya / sesuai Master role' }, { v: true, l: 'Pilih menu', d: 'Hanya menu yang dicentang' }].map((o) => (
                      <button key={String(o.v)} type="button" disabled={diriSendiri} onClick={() => ubah('menuKustom', o.v)}
                        className={`flex-1 text-left px-3 py-2 rounded-lg border text-[12px] disabled:opacity-60 ${edit.menuKustom === o.v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        <span className="block font-medium">{o.l}</span>
                        <span className={`block text-[10.5px] ${edit.menuKustom === o.v ? 'text-white/70' : 'text-slate-400'}`}>{o.d}</span>
                      </button>
                    ))}
                  </div>
                  {edit.menuKustom && (
                    <div className="space-y-3">
                      <div className="flex gap-3 text-[11.5px]">
                        <button type="button" disabled={diriSendiri} onClick={() => ubah('menuList', katalogEdit.flatMap((g) => g.item.map((it) => it.k)))} className="text-slate-600 underline underline-offset-2">Pilih semua</button>
                        <button type="button" disabled={diriSendiri} onClick={() => ubah('menuList', [])} className="text-slate-600 underline underline-offset-2">Kosongkan</button>
                      </div>
                      {katalogEdit.map((g) => (
                        <div key={g.grup}>
                          <p className="text-[11px] font-medium text-slate-500 mb-1">{g.grup}</p>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                            {g.item.map((it) => (
                              <label key={it.k} className={`flex items-center gap-2.5 py-1 text-[13px] ${diriSendiri ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
                                <input type="checkbox" disabled={diriSendiri} checked={edit.menuList.includes(it.k)} onChange={() => toggleMenu(it.k)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-900" />
                                {it.l}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!edit.menuList.includes('panel_admin') && <p className="text-[11px] text-amber-700">Tanpa "Buka Panel", menu Data/Laporan di atas tidak bisa dibuka dari beranda.</p>}
                    </div>
                  )}
                </div>
              )}

              {(hakBerubah || diriSendiri) && (
                <div className="px-4 py-3 bg-amber-50 text-[12px] text-amber-800 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {diriSendiri ? 'Ini akun Anda sendiri: role, lokasi dan menu tidak bisa diubah dari sini.' : 'Role/lokasi/menu berubah: sesi user ini akan dicabut dan ia harus login ulang.'}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-100 p-3 flex gap-2">
              <button onClick={() => setEdit(null)} disabled={menyimpan} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-slate-600 border border-slate-200 hover:bg-slate-50">Batal</button>
              <button onClick={simpan} disabled={menyimpan} className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60">
                {menyimpan && <Loader2 className="w-4 h-4 animate-spin" />}{menyimpan ? 'Menyimpan…' : 'Simpan perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
