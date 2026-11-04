// =====================================================================
// KELOLA USER & AKSES — Admin Panel > Pengguna > Master user (4 Nov 2026)
//
// Dua kolom:
//   kiri  : daftar user (cari, filter tingkat & lokasi, progress menu)
//   kanan : form user (tambah / edit) dalam 4 bagian
//           1. Identitas  2. Role & lokasi  3. Akses menu (Admin/HRD)
//           4. Akses form absen
// + Salin akses dari user lain, preset menu, Export Matriks (CSV).
//
// Server: get_user_list_admin, tambah_user, update_user, reset_password_user
// (apps-script/MasterUser.gs, Code.gs). Menu per user disimpan di
// MENU_PER_USER; kuncinya = KATALOG_MENU di bawah = MENU_KATALOG di server.
// Admin bercakupan lokasi (Admin Jakarta) hanya melihat user lokasinya dan
// tidak bisa mengubah user bertingkat Admin — dijaga di server.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, RefreshCcw, Loader2, MapPin, Lock, AlertTriangle, Users, UserPlus, Download,
  Eye, EyeOff, Shuffle, Copy, Check, ChevronLeft, ShieldCheck, KeyRound, Minus,
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';

const MENU_TIDAK_ADA = '_tidak_ada';

// Katalog menu aplikasi absensi. `hrd: true` = bisa dipakai tingkat HRD.
export const KATALOG_MENU = [
  { no: 1, grup: 'Beranda', ikon: '🏠', item: [
    { k: 'panel_admin', l: 'Buka Panel', d: 'Tombol Panel di beranda (pintu masuk Admin Panel)', hrd: true, chip: 'Panel' },
    { k: 'approval', l: 'Approval pengajuan', d: 'Menyetujui / menolak cuti, ijin, sakit, DL', hrd: true, chip: 'Approval' },
  ] },
  { no: 2, grup: 'Pengguna', ikon: '👥', item: [
    { k: 'user', l: 'Tambah user baru', d: 'Membuat akun karyawan baru', chip: 'Tambah user' },
    { k: 'master_user', l: 'Kelola user & akses', d: 'Halaman ini: edit, reset password, atur menu', chip: 'Kelola user' },
    { k: 'master_role', l: 'Master role & lokasi', d: 'Daftar role, tingkat & lokasi yang dilihat' },
    { k: 'approval_team', l: 'Tim approval', d: 'Kepala divisi & anggota timnya' },
  ] },
  { no: 3, grup: 'Data Absensi', ikon: '🗂️', item: [
    { k: 'import_db', l: 'Import data mesin', d: 'Unggah file mesin fingerprint ke dbabsen', chip: 'Import' },
    { k: 'bebas_absen', l: 'Bebas absen & harian', d: 'Karyawan tanpa scan mesin / karyawan harian' },
    { k: 'period', l: 'Periode absensi', d: 'Rentang tanggal periode gaji / absen' },
    { k: 'board', l: 'Board absensi', d: 'Tampilan BOARD_ABSENSI_2026' },
    { k: 'analysis', l: 'Analisa data', d: 'Grafik & analisa kehadiran' },
    { k: 'master', l: 'Master data', d: 'Menu form, divisi, jam shift, sheet import' },
  ] },
  { no: 4, grup: 'Lokasi & Perangkat', ikon: '📍', item: [
    { k: 'geomaster', l: 'Master lokasi geofence', d: 'Titik & radius kantor' },
    { k: 'geofence', l: 'Akses absen & geofence', d: 'Wajib area, mode online/mesin per karyawan' },
    { k: 'perangkat', l: 'Perangkat & sesi login', d: 'Kunci HP, cabut sesi' },
    { k: 'wajah', l: 'Wajah karyawan', d: 'Foto acuan pencocokan wajah' },
  ] },
  { no: 5, grup: 'Laporan & Monitoring', ikon: '📊', item: [
    { k: 'rekap', l: 'Rekap, koreksi & export', d: 'Dashboard rekap, koreksi absen, ABSEN-EMAIL', hrd: true, chip: 'Rekap' },
    { k: 'gps', l: 'Dashboard GPS', d: 'Posisi & jejak karyawan', chip: 'GPS' },
    { k: 'gps_audit', l: 'Monitoring integritas GPS', d: 'Deteksi fake GPS' },
    { k: 'dashboard_kerani', l: 'Absen online Kerani', d: 'Dashboard kerani pabrik' },
    { k: 'log_login', l: 'Log login', d: 'Riwayat login pengguna' },
  ] },
  { no: 6, grup: 'Komunikasi', ikon: '📣', item: [
    { k: 'info_hrd', l: 'Info HRD', d: 'Broadcast pengumuman ke karyawan', hrd: true, chip: 'Info HRD' },
  ] },
];
const SEMUA_MENU = KATALOG_MENU.flatMap((g) => g.item);
const KUNCI_HRD = SEMUA_MENU.filter((it) => it.hrd).map((it) => it.k);
const PRESET = [
  { l: 'Preset HRD', ikon: '🧑‍💼', menu: ['panel_admin', 'approval', 'rekap', 'info_hrd'] },
  { l: 'Preset Admin lokasi', ikon: '🏢', menu: ['panel_admin', 'approval', 'user', 'master_user', 'rekap', 'gps', 'gps_audit', 'info_hrd'] },
];

const inputCls = 'w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-500';
const WARNA_AVATAR = ['bg-indigo-600', 'bg-rose-600', 'bg-emerald-600', 'bg-teal-600', 'bg-blue-600', 'bg-amber-600', 'bg-violet-600', 'bg-cyan-600'];
const WARNA_TINGKAT = {
  admin: 'bg-slate-900 text-white', hrd: 'bg-violet-100 text-violet-700',
  manager: 'bg-sky-100 text-sky-700', pimpinan: 'bg-sky-100 text-sky-700',
  kepala: 'bg-amber-100 text-amber-700', kepala_divisi: 'bg-amber-100 text-amber-700',
  supervisor: 'bg-amber-100 text-amber-700', spv: 'bg-amber-100 text-amber-700',
};
const WARNA_CHIP = ['bg-blue-50 text-blue-700 border-blue-200', 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-amber-50 text-amber-700 border-amber-200', 'bg-violet-50 text-violet-700 border-violet-200', 'bg-rose-50 text-rose-700 border-rose-200'];
const WARNA_STAT = { blue: 'text-blue-600', violet: 'text-violet-600', emerald: 'text-emerald-600' };
const TITIK_STAT = { blue: 'bg-blue-600', violet: 'bg-violet-600', emerald: 'bg-emerald-600' };

const pecah = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const inisial = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const hashWarna = (s) => WARNA_AVATAR[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % WARNA_AVATAR.length];
const sandiAcak = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');

const kosongUser = (lokasiAwal) => ({
  uuid: '', username: '', nama: '', divisi: '', role: 'karyawan', akses: [], payroll: '',
  perusahaan: '', statusKaryawan: '', emailAtasan: '', lokasiList: lokasiAwal ? [lokasiAwal] : [],
  menuKustom: false, menuList: [], password: '',
});

function Kepala({ no, judul, sub, kanan }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
      <span className="w-6 h-6 rounded-md bg-slate-900 text-white text-[12px] font-semibold flex items-center justify-center shrink-0">{no}</span>
      <p className="text-[13px] font-semibold tracking-[0.08em] text-slate-900 uppercase">{judul}</p>
      {sub && <p className="hidden sm:block text-[12px] text-slate-400 truncate">— {sub}</p>}
      {kanan && <div className="ml-auto shrink-0">{kanan}</div>}
    </div>
  );
}
function Label({ children, wajib, hint }) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <label className="text-[12px] font-medium text-slate-700">{children}{wajib && <span className="text-rose-500"> *</span>}</label>
      {hint && <span className="text-[10.5px] text-slate-400">{hint}</span>}
    </div>
  );
}
function Saklar({ nyala, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={nyala}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${nyala ? 'bg-blue-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${nyala ? 'translate-x-4' : ''}`} />
    </button>
  );
}
// status: true | false | 'sebagian'
function Centang({ status, onClick, disabled }) {
  return (
    <span role="checkbox" aria-checked={status === 'sebagian' ? 'mixed' : !!status} aria-disabled={!!disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled && onClick) onClick(); }}
      className={`w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 transition-colors
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${status ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 hover:border-blue-400'}`}>
      {status === 'sebagian' ? <Minus className="w-3 h-3" strokeWidth={3} /> : status ? <Check className="w-3 h-3" strokeWidth={3} /> : null}
    </span>
  );
}
function Stat({ label, nilai, warna }) {
  return (
    <div className="px-3.5 py-2 rounded-xl border border-slate-200/80 bg-white min-w-[92px] shrink-0">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-500">
        {warna && <span className={`w-1.5 h-1.5 rounded-full ${TITIK_STAT[warna]}`} />}{label}
      </p>
      <p className={`text-[20px] font-semibold tabular-nums leading-tight ${warna ? WARNA_STAT[warna] : 'text-slate-900'}`}>{nilai}</p>
    </div>
  );
}

export default function MasterUserPanel({ user, fetchApi, masterData, listLokasi, terbatas, onResetPassword }) {
  const [list, setList] = useState([]);
  const [roles, setRoles] = useState([]);
  const [memuat, setMemuat] = useState(false);
  const [cari, setCari] = useState('');
  const [tabTingkat, setTabTingkat] = useState('semua');
  const [filterLokasi, setFilterLokasi] = useState('');
  const [pilihId, setPilihId] = useState('');          // '' = belum memilih, 'baru' = tambah user
  const [form, setForm] = useState(null);
  const [asli, setAsli] = useState(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [lihatSandi, setLihatSandi] = useState(false);
  const [salinDari, setSalinDari] = useState('');
  const [salinRole, setSalinRole] = useState(false);
  const [cariMenu, setCariMenu] = useState('');
  const [dipilihSaja, setDipilihSaja] = useState(false);

  const bukaUser = useCallback((u) => {
    if (!u) return;
    const menu = Array.isArray(u.menu) ? u.menu.filter((k) => k !== MENU_TIDAK_ADA) : [];
    const f = { ...u, akses: [...(u.akses || [])], lokasiList: pecah(u.lokasi), menuKustom: Array.isArray(u.menu), menuList: menu, password: '' };
    setAsli(f);
    setForm({ ...f, akses: [...f.akses], lokasiList: [...f.lokasiList], menuList: [...menu] });
    setPilihId(String(u.uuid)); setSalinDari(''); setCariMenu(''); setDipilihSaja(false);
  }, []);

  const muat = useCallback(async (pilihSetelah) => {
    setMemuat(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_user_list_admin', roleRequester: user.role }) });
      const d = await res.json();
      if (d.result === 'success') {
        setList(d.list || []); setRoles(d.roles || []);
        if (pilihSetelah) bukaUser((d.list || []).find((x) => String(x.uuid) === String(pilihSetelah)));
      } else alert(d.message || 'Gagal memuat daftar user.');
    } catch (e) { alert('Gagal koneksi saat memuat daftar user.'); }
    finally { setMemuat(false); }
  }, [fetchApi, user.role, bukaUser]);
  useEffect(() => { muat(); }, [muat]);

  const opsiRole = useMemo(() => (roles.length ? roles
    : (masterData.roles || []).map((r) => ({ value: String(r.value).toLowerCase(), label: r.label, tingkat: String(r.value).toLowerCase(), lokasi: [], menu: [] }))), [roles, masterData.roles]);
  const infoRole = useCallback((kode) => opsiRole.find((x) => x.value === kode) || null, [opsiRole]);

  // Menu efektif seorang user (untuk progress, chip & matriks).
  const menuEfektif = useCallback((u) => {
    const t = u.tingkat;
    if (t !== 'admin' && t !== 'hrd') return [];
    if (Array.isArray(u.menu)) return u.menu.filter((k) => k !== MENU_TIDAK_ADA);
    const r = infoRole(u.role);
    const dasar = t === 'admin' ? SEMUA_MENU.map((it) => it.k) : KUNCI_HRD;
    return r && r.menu && r.menu.length ? dasar.filter((k) => r.menu.includes(k)) : dasar;
  }, [infoRole]);
  const totalMenu = (t) => (t === 'admin' ? SEMUA_MENU.length : KUNCI_HRD.length);

  const kelompokTingkat = (u) => (u.tingkat === 'admin' ? 'admin' : u.tingkat === 'hrd' ? 'hrd' : 'lain');
  const hitung = useMemo(() => {
    const h = { semua: list.length, admin: 0, hrd: 0, lain: 0, khusus: 0 };
    list.forEach((u) => { h[kelompokTingkat(u)] += 1; if (Array.isArray(u.menu)) h.khusus += 1; });
    return h;
  }, [list]);
  const daftarLokasi = useMemo(() => [...new Set(list.flatMap((u) => pecah(u.lokasi)))].sort(), [list]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return list.filter((u) => {
      if (tabTingkat !== 'semua' && kelompokTingkat(u) !== tabTingkat) return false;
      if (filterLokasi && !pecah(u.lokasi).includes(filterLokasi)) return false;
      if (!q) return true;
      return [u.nama, u.username, u.payroll, u.divisi, u.roleNama].some((x) => String(x || '').toLowerCase().includes(q));
    });
  }, [list, cari, tabTingkat, filterLokasi]);

  const tambahBaru = () => {
    setAsli(null); setForm(kosongUser(terbatas ? user.lokasiAkses : '')); setPilihId('baru');
    setSalinDari(''); setCariMenu(''); setDipilihSaja(false); setLihatSandi(false);
  };
  const tutupForm = () => { setForm(null); setAsli(null); setPilihId(''); };
  const ubah = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const baru = pilihId === 'baru';
  const diriSendiri = !!form && !baru && String(form.uuid) === String(user.id || '');
  const terkunci = !!form && !baru && terbatas && form.tingkat === 'admin';

  const tingkatForm = useMemo(() => {
    if (!form) return '';
    const r = infoRole(form.role);
    return String((r && r.tingkat) || form.role || '').toLowerCase();
  }, [form, infoRole]);
  const pakaiMenu = tingkatForm === 'admin' || tingkatForm === 'hrd';
  const menuBolehDipilih = useCallback((it) => tingkatForm === 'admin' || !!it.hrd, [tingkatForm]);

  // ---------- salin akses ----------
  const sumberSalin = useMemo(() => list.filter((u) => (u.tingkat === 'admin' || u.tingkat === 'hrd')
    && String(u.uuid) !== String(form && form.uuid)), [list, form]);
  const terapkanSalin = (id) => {
    setSalinDari(id);
    const s = list.find((u) => String(u.uuid) === String(id));
    if (!s) return;
    setForm((f) => ({
      ...f,
      ...(salinRole ? { role: s.role, lokasiList: terbatas ? f.lokasiList : pecah(s.lokasi) } : {}),
      menuKustom: true,
      menuList: menuEfektif(s),
      akses: [...(s.akses || [])],
    }));
  };

  // ---------- menu ----------
  const menuTerpilih = useMemo(() => {
    if (!form || !pakaiMenu) return [];
    if (form.menuKustom) return form.menuList.filter((k) => SEMUA_MENU.some((it) => it.k === k && menuBolehDipilih(it)));
    return menuEfektif({ tingkat: tingkatForm, role: form.role, menu: null });
  }, [form, pakaiMenu, tingkatForm, menuEfektif, menuBolehDipilih]);
  const pilihMenu = (k) => setForm((f) => {
    const dasar = f.menuKustom ? f.menuList : menuTerpilih;
    return { ...f, menuKustom: true, menuList: dasar.includes(k) ? dasar.filter((x) => x !== k) : [...dasar, k] };
  });
  const pilihGrup = (g) => setForm((f) => {
    const dasar = f.menuKustom ? f.menuList : menuTerpilih;
    const ks = g.item.filter(menuBolehDipilih).map((it) => it.k);
    const semua = ks.every((k) => dasar.includes(k));
    return { ...f, menuKustom: true, menuList: semua ? dasar.filter((k) => !ks.includes(k)) : [...new Set([...dasar, ...ks])] };
  });
  const setMenu = (arr) => setForm((f) => ({ ...f, menuKustom: true, menuList: arr.filter((k) => SEMUA_MENU.some((it) => it.k === k && menuBolehDipilih(it))) }));
  const nMenu = pakaiMenu ? totalMenu(tingkatForm) : 0;
  const persen = nMenu ? Math.round((menuTerpilih.length / nMenu) * 100) : 0;

  // ---------- form absen, divisi, lokasi, role ----------
  const opsiForm = useMemo(() => {
    const m = (masterData.menus || []).map((x) => ({ value: x.value, label: x.label }));
    (form ? form.akses : []).forEach((v) => { if (!m.some((x) => x.value === v)) m.push({ value: v, label: v + ' (lama)' }); });
    return m;
  }, [masterData.menus, form]);
  const pilihForm = (v) => setForm((f) => ({ ...f, akses: f.akses.includes(v) ? f.akses.filter((x) => x !== v) : [...f.akses, v] }));
  const opsiDivisi = useMemo(() => {
    const d = (masterData.divisions || []).map((x) => ({ value: x.value, label: x.label }));
    if (form && form.divisi && !d.some((x) => x.value === form.divisi)) d.unshift({ value: form.divisi, label: form.divisi });
    return d;
  }, [masterData.divisions, form]);
  const opsiLokasi = useMemo(() => {
    const l = [...listLokasi];
    (form ? form.lokasiList : []).forEach((x) => { if (!l.includes(x)) l.push(x); });
    return l;
  }, [listLokasi, form]);
  const pilihLokasi = (loc) => setForm((f) => {
    let l = f.lokasiList;
    if (l.includes(loc)) l = l.filter((x) => x !== loc);
    else if (loc === 'All') l = ['All'];
    else l = [...l.filter((x) => x !== 'All'), loc];
    return { ...f, lokasiList: l };
  });
  const opsiRoleForm = useMemo(() => {
    const r = [...opsiRole];
    if (form && form.role && !r.some((x) => x.value === form.role)) r.unshift({ value: form.role, label: form.role + ' (tidak terdaftar)', tingkat: form.tingkat });
    return r;
  }, [opsiRole, form]);

  const hakBerubah = !!form && !!asli && (
    form.role !== asli.role || form.lokasiList.join(', ') !== asli.lokasiList.join(', ')
    || (pakaiMenu && form.menuKustom) !== asli.menuKustom
    || (pakaiMenu && form.menuKustom && [...form.menuList].sort().join() !== [...asli.menuList].sort().join()));

  // ---------- simpan ----------
  const simpan = async () => {
    if (!String(form.username).trim()) return alert('Username / ID finger wajib diisi.');
    if (!form.nama.trim()) return alert('Nama lengkap wajib diisi.');
    if (!form.role) return alert('Role wajib dipilih.');
    if (!form.lokasiList.length) return alert('Pilih minimal satu lokasi.');
    if (baru && String(form.password).length < 4) return alert('Password minimal 4 karakter.');
    setMenyimpan(true);
    try {
      const menuKustom = pakaiMenu && form.menuKustom;
      const umum = {
        username: String(form.username).trim(), nama: form.nama.trim(), divisi: form.divisi,
        perusahaan: form.perusahaan, statusKaryawan: form.statusKaryawan, emailAtasan: form.emailAtasan,
        payrollUser: form.payroll, menuKustom, menuUser: menuKustom ? menuTerpilih : [],
      };
      const body = baru
        ? { action: 'tambah_user', roleRequester: user.role, ...umum, password: form.password, role: form.role, akses: form.akses, lokasi: form.lokasiList.join(', ') }
        : { action: 'update_user', targetUuid: form.uuid, ...umum, roleUser: form.role, aksesUser: form.akses, lokasiUser: form.lokasiList.join(', ') };
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) });
      const d = await res.json();
      alert(d.message || (d.result === 'success' ? 'Tersimpan.' : 'Gagal menyimpan.'));
      if (d.result === 'success') muat(baru ? d.id : form.uuid);
    } catch (e) { alert('Gagal koneksi saat menyimpan.'); }
    finally { setMenyimpan(false); }
  };

  // ---------- export matriks ----------
  const exportMatriks = () => {
    const kepala = ['Nama', 'Username', 'Payroll', 'Divisi', 'Role', 'Tingkat', 'Lokasi', 'Mode menu', ...SEMUA_MENU.map((it) => it.l), 'Akses form'];
    const baris = list.map((u) => {
      const m = menuEfektif(u);
      const ada = u.tingkat === 'admin' || u.tingkat === 'hrd';
      return [u.nama, u.username, u.payroll, u.divisi, u.roleNama || u.role, u.tingkat, u.lokasi,
        !ada ? '-' : Array.isArray(u.menu) ? 'Khusus' : 'Ikut role',
        ...SEMUA_MENU.map((it) => (ada && m.includes(it.k) ? '✓' : '')), (u.akses || []).join(', ')];
    });
    const csv = [kepala, ...baris].map((r) => r.map((x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `Matriks_Akses_User_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // =================================================================
  return (
    <div className="animate-in fade-in duration-300 space-y-4">
      {/* ===== KEPALA ===== */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 mr-2">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></div>
          <div>
            <p className="text-[11.5px] text-slate-400">Pengaturan Sistem › Pengguna</p>
            <p className="text-[17px] font-semibold text-slate-900 leading-tight">Kelola User &amp; Akses</p>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto max-w-full">
          <Stat label="Total user" nilai={hitung.semua} />
          <Stat label="Admin" nilai={hitung.admin} warna="blue" />
          <Stat label="HRD" nilai={hitung.hrd} warna="violet" />
          <Stat label="Menu khusus" nilai={hitung.khusus} warna="emerald" />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={exportMatriks} disabled={!list.length} className="h-10 px-3.5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export Matriks</span>
          </button>
          <button onClick={() => muat(pilihId && pilihId !== 'baru' ? pilihId : '')} disabled={memuat} title="Muat ulang" className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCcw className={`w-4 h-4 ${memuat ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={tambahBaru} className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700">
            <UserPlus className="w-4 h-4" /> Tambah User
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* ===== DAFTAR USER ===== */}
        <aside className={`w-full lg:w-[360px] lg:shrink-0 bg-white rounded-2xl border border-slate-200/70 overflow-hidden lg:sticky lg:top-4 ${form ? 'hidden lg:block' : ''}`}>
          <div className="p-4 pb-3 space-y-3 border-b border-slate-100">
            <div className="flex items-baseline justify-between">
              <p className="text-[14px] font-semibold text-slate-900">Daftar User</p>
              <span className="text-[11.5px] text-slate-400 tabular-nums">{tampil.length} dari {list.length}</span>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama, ID finger, payroll, divisi…" className={`${inputCls} pl-9 bg-slate-50`} />
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-slate-100">
              {[['semua', 'Semua'], ['admin', 'Admin'], ['hrd', 'HRD'], ['lain', 'Lainnya']].map(([k, l]) => (
                <button key={k} onClick={() => setTabTingkat(k)} className={`py-1.5 rounded-md text-[11.5px] font-medium transition ${tabTingkat === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {l} · <span className="tabular-nums">{hitung[k]}</span>
                </button>
              ))}
            </div>
            {daftarLokasi.length > 1 && (
              <select value={filterLokasi} onChange={(e) => setFilterLokasi(e.target.value)} className={`${inputCls} h-9`}>
                <option value="">Semua lokasi</option>
                {daftarLokasi.map((l) => <option key={l} value={l}>{l} · {list.filter((u) => pecah(u.lokasi).includes(l)).length}</option>)}
              </select>
            )}
            {terbatas && <p className="text-[11px] text-amber-700">Hanya user lokasi {user.lokasiAkses}.</p>}
          </div>
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto divide-y divide-slate-100">
            {memuat && !list.length && <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>}
            {!memuat && tampil.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-slate-400">Tidak ada user yang cocok.</p>}
            {tampil.map((u) => {
              const aktif = String(u.uuid) === pilihId;
              const adaMenu = u.tingkat === 'admin' || u.tingkat === 'hrd';
              const m = menuEfektif(u);
              const tot = totalMenu(u.tingkat);
              const chips = SEMUA_MENU.filter((it) => it.chip && m.includes(it.k)).slice(0, 5);
              return (
                <button key={u.uuid} onClick={() => bukaUser(u)} className={`w-full text-left flex gap-3 px-4 py-3 transition ${aktif ? 'bg-blue-50/70 shadow-[inset_3px_0_0_#2563eb]' : 'hover:bg-slate-50'}`}>
                  <div className={`relative w-10 h-10 rounded-full ${hashWarna(u.nama)} text-white text-[13px] font-semibold flex items-center justify-center shrink-0`}>
                    {inisial(u.nama)}
                    {adaMenu && <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${Array.isArray(u.menu) ? 'bg-emerald-500' : 'bg-slate-300'}`} title={Array.isArray(u.menu) ? 'Menu khusus' : 'Ikut role'} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13.5px] font-semibold text-slate-900 truncate">{u.nama}</p>
                      {String(u.uuid) === String(user.id) && <span className="px-1.5 py-px rounded bg-slate-900 text-white text-[9px] font-bold tracking-wide shrink-0">ANDA</span>}
                      {terbatas && u.tingkat === 'admin' && <Lock className="w-3 h-3 text-slate-400 shrink-0" />}
                    </div>
                    <p className="text-[11.5px] text-slate-400 truncate">@{u.username}{u.divisi ? ` · ${u.divisi}` : ''}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className={`px-1.5 py-px rounded text-[10px] font-medium ${WARNA_TINGKAT[u.tingkat] || 'bg-slate-100 text-slate-600'}`}>{u.roleNama || u.role}</span>
                      {pecah(u.lokasi).map((l) => <span key={l} className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] bg-emerald-50 text-emerald-700"><MapPin className="w-2.5 h-2.5" />{l}</span>)}
                    </div>
                    {adaMenu && (
                      <div className="mt-2 flex items-start gap-2">
                        <div className="flex items-center gap-1.5 pt-1 shrink-0">
                          <div className="h-1.5 w-14 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${tot ? (m.length / tot) * 100 : 0}%` }} /></div>
                          <span className="text-[10.5px] text-slate-500 tabular-nums">{m.length}/{tot}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 min-w-0">
                          {chips.map((it, i) => <span key={it.k} className={`px-1.5 py-px rounded border text-[9.5px] font-medium ${WARNA_CHIP[i % WARNA_CHIP.length]}`}>{it.chip}</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ===== FORM USER ===== */}
        <section className={`flex-1 min-w-0 w-full ${form ? '' : 'hidden lg:block'}`}>
          {!form ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-20 px-6 text-center">
              <ShieldCheck className="w-10 h-10 mx-auto text-slate-300" />
              <p className="mt-3 text-[14px] font-medium text-slate-700">Pilih user di sebelah kiri</p>
              <p className="text-[12.5px] text-slate-400 mt-1">untuk mengatur role, lokasi, menu &amp; form yang bisa diakses — atau klik <b>Tambah User</b>.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/70">
              {/* kepala form */}
              <div className="flex items-center gap-3 p-4 sm:p-5 border-b border-slate-100">
                <button onClick={tutupForm} className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Kembali ke daftar"><ChevronLeft className="w-5 h-5" /></button>
                {baru
                  ? <div className="w-11 h-11 rounded-full border-2 border-blue-200 text-blue-600 flex items-center justify-center text-[22px] font-light shrink-0">+</div>
                  : <div className={`w-11 h-11 rounded-full ${hashWarna(asli.nama)} text-white font-semibold flex items-center justify-center shrink-0`}>{inisial(asli.nama)}</div>}
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-slate-900 truncate">{baru ? 'Tambah User Baru' : asli.nama}</p>
                  <p className="text-[12px] text-slate-400 truncate">{baru ? 'Isi identitas, lalu tentukan role, lokasi & akses menu' : `@${asli.username} · ${asli.roleNama || asli.role} · ${asli.lokasi || '-'}`}</p>
                </div>
                {!baru && !terkunci && (
                  <button onClick={() => onResetPassword(form.uuid, form.nama)} className="shrink-0 h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-[12.5px] text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50">
                    <KeyRound className="w-4 h-4" /> <span className="hidden sm:inline">Reset password</span>
                  </button>
                )}
              </div>

              {terkunci ? (
                <div className="p-10 text-center">
                  <Lock className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="mt-2 text-[13.5px] text-slate-600">User bertingkat Admin hanya bisa diubah Admin pusat.</p>
                </div>
              ) : (
                <fieldset disabled={menyimpan} className="divide-y divide-slate-100 min-w-0">
                  {/* SALIN AKSES */}
                  <div className="p-4 sm:p-5">
                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-800"><Copy className="w-4 h-4" /> Salin akses dari</p>
                        <select value={salinDari} onChange={(e) => terapkanSalin(e.target.value)} disabled={diriSendiri} className={`${inputCls} flex-1 min-w-[200px]`}>
                          <option value="">— Tidak menyalin (atur manual) —</option>
                          {sumberSalin.map((u) => <option key={u.uuid} value={u.uuid}>{u.nama} · {u.roleNama || u.role} · {u.lokasi}</option>)}
                        </select>
                        <label className="inline-flex items-center gap-2 text-[12.5px] text-blue-800 cursor-pointer">
                          <Saklar nyala={salinRole} onClick={() => setSalinRole((v) => !v)} disabled={diriSendiri} /> Ikut salin role{terbatas ? '' : ' & lokasi'}
                        </label>
                      </div>
                      <p className="mt-2 text-[11.5px] text-blue-700/80">Pilih user Admin/HRD yang aksesnya mirip — akses menu &amp; form langsung terisi.</p>
                    </div>
                  </div>

                  {/* 1. IDENTITAS */}
                  <div className="p-4 sm:p-5">
                    <Kepala no={1} judul="Identitas user" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
                      <div><Label wajib hint="ID mesin finger">Username</Label><input className={`${inputCls} tabular-nums`} value={form.username} onChange={(e) => ubah('username', e.target.value)} placeholder="mis. 1024" /></div>
                      <div><Label wajib>Nama lengkap</Label><input className={inputCls} value={form.nama} onChange={(e) => ubah('nama', e.target.value)} placeholder="Nama lengkap" /></div>
                      <div><Label>Divisi / bagian</Label>
                        <select className={inputCls} value={form.divisi} onChange={(e) => ubah('divisi', e.target.value)}>
                          <option value="">—</option>{opsiDivisi.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </div>
                      {baru && (
                        <div><Label wajib hint="Min. 4 karakter">Password</Label>
                          <div className="relative">
                            <input type={lihatSandi ? 'text' : 'password'} className={`${inputCls} pr-24`} value={form.password} onChange={(e) => ubah('password', e.target.value)} placeholder="Password" autoComplete="new-password" />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                              <button type="button" onClick={() => setLihatSandi((v) => !v)} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Tampilkan password">{lihatSandi ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                              <button type="button" onClick={() => { ubah('password', sandiAcak()); setLihatSandi(true); }} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-blue-600"><Shuffle className="w-3.5 h-3.5" />Acak</button>
                            </div>
                          </div>
                        </div>
                      )}
                      <div><Label>No. payroll</Label><input className={`${inputCls} tabular-nums`} value={form.payroll} onChange={(e) => ubah('payroll', e.target.value)} placeholder="C0093" /></div>
                      <div><Label>Perusahaan</Label><input className={inputCls} value={form.perusahaan} onChange={(e) => ubah('perusahaan', e.target.value)} placeholder="JPT" /></div>
                      <div><Label>Status karyawan</Label><input className={inputCls} value={form.statusKaryawan} onChange={(e) => ubah('statusKaryawan', e.target.value)} placeholder="Tetap / Kontrak" /></div>
                      <div><Label>Email atasan</Label><input type="email" className={inputCls} value={form.emailAtasan} onChange={(e) => ubah('emailAtasan', e.target.value)} placeholder="atasan@jpt.co.id" /></div>
                    </div>
                  </div>

                  {/* 2. ROLE & LOKASI */}
                  <div className="p-4 sm:p-5">
                    <Kepala no={2} judul="Role & lokasi" sub="Tingkat hak aksi & data karyawan yang terlihat" />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <Label wajib>Role</Label>
                        <select className={inputCls} value={form.role} onChange={(e) => ubah('role', e.target.value)} disabled={diriSendiri}>
                          {opsiRoleForm.map((r) => <option key={r.value} value={r.value}>{r.label}{r.lokasi && r.lokasi.length && !r.lokasi.includes('*') ? ` — ${r.lokasi.join(', ')}` : ''}</option>)}
                        </select>
                        <p className="mt-1.5 text-[11.5px] text-slate-500">
                          Tingkat <span className={`px-1.5 py-px rounded text-[10.5px] font-medium ${WARNA_TINGKAT[tingkatForm] || 'bg-slate-100 text-slate-600'}`}>{tingkatForm || '-'}</span>
                          {pakaiMenu ? ' — menu Admin Panel diatur di bagian 3.' : ' — tidak memakai Admin Panel.'}
                        </p>
                      </div>
                      <div>
                        <Label wajib>Lokasi</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {opsiLokasi.map((loc) => {
                            const on = form.lokasiList.includes(loc);
                            const mati = terbatas || diriSendiri;
                            return (
                              <button key={loc} type="button" onClick={() => pilihLokasi(loc)} disabled={mati}
                                className={`h-8 px-3 inline-flex items-center gap-1 rounded-full border text-[12.5px] transition disabled:cursor-not-allowed
                                  ${on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'} ${mati && !on ? 'opacity-50' : ''}`}>
                                {on ? <Check className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}{loc}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. AKSES MENU */}
                  {pakaiMenu && (
                    <div className="p-4 sm:p-5">
                      <Kepala no={3} judul="Akses menu" sub={`Menu Admin Panel yang bisa dibuka ${tingkatForm === 'admin' ? 'Admin' : 'HRD'} ini`}
                        kanan={<span className="px-2 py-0.5 rounded-full bg-slate-100 text-[11.5px] text-slate-600 tabular-nums">{menuTerpilih.length} / {nMenu} dipilih</span>} />

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] text-slate-700 cursor-pointer">
                          <Saklar nyala={form.menuKustom} disabled={diriSendiri}
                            onClick={() => setForm((f) => ({ ...f, menuKustom: !f.menuKustom, menuList: f.menuKustom ? f.menuList : menuTerpilih }))} />
                          Atur menu manual
                        </label>
                        <span className="text-[11.5px] text-slate-500">
                          {form.menuKustom ? 'Hanya menu yang dicentang yang tampil & bisa dipakai.' : <>Saat ini <b>ikut role</b> — {tingkatForm === 'admin' ? 'semua menu Admin' : 'menu bawaan HRD / Master role'}. Centang apa saja untuk mulai mengatur.</>}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <div className="flex items-center gap-2 mr-1">
                          <div className="h-1.5 w-28 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${persen}%` }} /></div>
                          <span className="text-[12px] text-slate-500 tabular-nums w-9">{persen}%</span>
                        </div>
                        <div className="relative flex-1 min-w-[160px]">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input value={cariMenu} onChange={(e) => setCariMenu(e.target.value)} placeholder="Cari menu…" className={`${inputCls} h-9 pl-9`} />
                        </div>
                        <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] text-slate-700 cursor-pointer">
                          <Saklar nyala={dipilihSaja} onClick={() => setDipilihSaja((v) => !v)} /> Dipilih saja
                        </label>
                        {PRESET.map((p) => (
                          <button key={p.l} type="button" onClick={() => setMenu(p.menu)} disabled={diriSendiri} className="h-9 px-3 rounded-lg border border-blue-200 bg-blue-50 text-[12.5px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">{p.ikon} {p.l}</button>
                        ))}
                        <button type="button" onClick={() => setMenu(SEMUA_MENU.map((it) => it.k))} disabled={diriSendiri} className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 text-[12.5px] font-medium text-blue-700 hover:bg-slate-50 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Pilih semua</button>
                        <button type="button" onClick={() => setMenu([])} disabled={diriSendiri} className="h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Kosongkan</button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                        {KATALOG_MENU.map((g) => {
                          const q = cariMenu.trim().toLowerCase();
                          const items = g.item.filter((it) => (!q || `${it.l} ${it.d}`.toLowerCase().includes(q)) && (!dipilihSaja || menuTerpilih.includes(it.k)));
                          if (!items.length) return null;
                          const boleh = g.item.filter(menuBolehDipilih);
                          const n = boleh.filter((it) => menuTerpilih.includes(it.k)).length;
                          const status = !boleh.length ? false : n === boleh.length ? true : n ? 'sebagian' : false;
                          return (
                            <div key={g.grup} className="rounded-xl border border-slate-200 overflow-hidden self-start">
                              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-100">
                                <Centang status={status} onClick={() => pilihGrup(g)} disabled={!boleh.length || diriSendiri} />
                                <p className="text-[13px] font-semibold text-slate-800 flex-1 truncate"><span className="text-slate-400 font-normal">{g.no}.</span> {g.ikon} {g.grup}</p>
                                <span className="px-1.5 py-px rounded bg-white border border-slate-200 text-[10.5px] text-slate-500 tabular-nums">{n}/{boleh.length}</span>
                              </div>
                              <div className="divide-y divide-slate-50">
                                {items.map((it) => {
                                  const bisa = menuBolehDipilih(it);
                                  const on = bisa && menuTerpilih.includes(it.k);
                                  return (
                                    <div key={it.k} onClick={() => bisa && !diriSendiri && pilihMenu(it.k)}
                                      className={`flex items-start gap-2.5 px-3.5 py-2.5 ${bisa && !diriSendiri ? 'cursor-pointer hover:bg-slate-50' : ''} ${bisa ? '' : 'opacity-50'}`}>
                                      <div className="pt-0.5"><Centang status={on} onClick={() => pilihMenu(it.k)} disabled={!bisa || diriSendiri} /></div>
                                      <span className="text-[11px] text-slate-400 tabular-nums pt-0.5 w-7 shrink-0">{g.no}.{g.item.indexOf(it) + 1}</span>
                                      <div className="min-w-0">
                                        <p className="text-[13px] text-slate-800 leading-tight">{it.l}{!bisa && <span className="ml-1.5 text-[10px] text-slate-500">(khusus Admin)</span>}</p>
                                        <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{it.d}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {form.menuKustom && !menuTerpilih.includes('panel_admin') && (
                        <p className="mt-3 text-[11.5px] text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Tanpa "Buka Panel", menu Admin Panel tidak bisa dibuka dari beranda.</p>
                      )}
                    </div>
                  )}

                  {/* 4. AKSES FORM */}
                  <div className="p-4 sm:p-5">
                    <Kepala no={pakaiMenu ? 4 : 3} judul="Akses form absen" sub="Form pengajuan yang tampil di aplikasi"
                      kanan={<div className="flex items-center gap-3 text-[12px]">
                        <span className="text-slate-500 tabular-nums">{form.akses.length} / {opsiForm.length}</span>
                        <button type="button" onClick={() => ubah('akses', opsiForm.map((m) => m.value))} className="text-blue-600 font-medium">Pilih semua</button>
                        <button type="button" onClick={() => ubah('akses', [])} className="text-slate-500">Kosongkan</button>
                      </div>} />
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                      {opsiForm.map((m) => {
                        const on = form.akses.includes(m.value);
                        return (
                          <div key={m.value} onClick={() => pilihForm(m.value)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-[13px] cursor-pointer transition ${on ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                            <Centang status={on} onClick={() => pilihForm(m.value)} />{m.label}
                          </div>
                        );
                      })}
                      {!opsiForm.length && <p className="text-[12px] text-slate-400">Belum ada form di Master Data (kategori Menu).</p>}
                    </div>
                  </div>
                </fieldset>
              )}

              {/* KAKI */}
              {!terkunci && (
                <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur border-t border-slate-100 rounded-b-2xl px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3">
                  {(hakBerubah || diriSendiri) && (
                    <p className="text-[12px] text-amber-700 flex items-center gap-1.5 flex-1 min-w-[200px]">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {diriSendiri ? 'Akun Anda sendiri: role, lokasi & menu tidak bisa diubah dari sini.' : 'Role/lokasi/menu berubah — sesi user ini dicabut dan ia harus login ulang.'}
                    </p>
                  )}
                  <div className="flex gap-2 ml-auto">
                    <button type="button" onClick={() => (baru ? tutupForm() : bukaUser(list.find((u) => String(u.uuid) === pilihId)))} disabled={menyimpan} className="h-10 px-4 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
                      {baru ? 'Batal' : 'Kembalikan'}
                    </button>
                    <button type="button" onClick={simpan} disabled={menyimpan} className="h-10 px-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-60">
                      {menyimpan && <Loader2 className="w-4 h-4 animate-spin" />}{menyimpan ? 'Menyimpan…' : baru ? 'Simpan user baru' : 'Simpan perubahan'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
