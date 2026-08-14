import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Send, Paperclip, SwitchCamera, RotateCcw, ChevronLeft, ShieldCheck, CalendarRange, LocateFixed, NotebookPen, CircleAlert, Layers,
  Camera, MapPin, CheckCircle, LogOut, LogIn, User, Activity, Clock, Key, Star, Calendar, History, Trash2, Edit, CreditCard, PieChart, Building, FileText, AlertTriangle, X, File as FileIcon, Filter, CheckSquare, Users, Eye, ScanFace, Fingerprint, Smartphone, ChevronDown, ChevronRight, Search, MessageSquare, MessageSquareText, Upload, Check, Info, CalendarCheck, Printer, FileSpreadsheet, Loader2, CalendarDays, CloudSun, KeyRound, ScanLine, RefreshCcw, UserRoundPlus, UsersRound, SlidersHorizontal, Database, Megaphone, ClipboardList, HeartPulse, Timer, PlaneTakeoff, Palmtree, ArrowLeftRight, Coffee, ChartColumn, FileUp } from 'lucide-react';
import { SCRIPT_URL, TIMEOUT_DURATION } from './config/constants';
import BackButton from './components/BackButton';
import ImportDbAbsen from './screens/ImportDbAbsen';
import { ImportJobProvider } from './context/ImportJobContext';
import ImportNotifier from './components/ImportNotifier';

// ============================================================
// HELPER API — token login + penanganan respons HTML dari Google
//
// 1) Menyisipkan token login ke setiap request. Backend (Apps Script)
//    menolak request tanpa token; token disimpan di dalam objek user
//    pada sessionStorage saat login.
//
// 2) Apps Script tidak bisa mengirim status HTTP 401, jadi kegagalan auth
//    dikenali dari body JSON: { result:'error', code:'AUTH_REQUIRED' }.
//
// 3) MASALAH TERUKUR: Google kadang membalas halaman HTML interstitial
//    (berisi window['ppConfig']) alih-alih JSON. Pengukuran 12 Agu 2026:
//    1 dari 7 request 'ping' membalas HTML, dan latensi 1,1 s s/d 34 s.
//    Dulu ini muncul ke user sebagai "Gagal koneksi server."
//
//    Retry hanya dilakukan untuk action BACA. Untuk action TULIS retry
//    DILARANG: tulisnya mungkin sudah berhasil di server dan hanya
//    responsnya yang berupa HTML — mengulang akan membuat data dobel.
//    Ini diduga akar dari bug "pengajuan ganda" yang sudah dua kali
//    dikoreksi (commit 017b033 dan f1f8255).
// ============================================================

// Action yang aman diulang: hanya membaca, tidak mengubah data.
const ACTION_AMAN_DIULANG = [
  'ping', 'check_version', 'login', 'get_latest_announcement',
  'get_history', 'get_db_absen', 'get_user_list_simple', 'get_stats',
  'get_remarks', 'get_shift_history', 'get_approval_list',
  'get_user_list_admin', 'get_analysis_data'
];

const MAKS_PERCOBAAN = 3;

const jedaMs = (ms) => new Promise((r) => setTimeout(r, ms));

const responsSintetis = (obj) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

const fetchApi = async (url, opts = {}, percobaan = 1) => {
  let body = opts.body;
  let action = '';
  try {
    const o = JSON.parse(body);
    action = o.action || '';
    const saved = sessionStorage.getItem('app_user');
    if (saved) {
      const u = JSON.parse(saved);
      if (u && u.token) o.token = u.token;
    }
    body = JSON.stringify(o);
  } catch (e) { /* body bukan JSON — biarkan apa adanya */ }

  let res;
  try {
    res = await fetch(url, { ...opts, body });
  } catch (e) {
    // Kegagalan jaringan murni — aman diulang untuk action baca
    if (ACTION_AMAN_DIULANG.includes(action) && percobaan < MAKS_PERCOBAAN) {
      await jedaMs(700 * percobaan);
      return fetchApi(url, opts, percobaan + 1);
    }
    throw e;
  }

  // Baca sekali lewat clone, supaya pemanggil tetap bisa memanggil .json()
  let data = null;
  let jsonValid = true;
  try {
    data = await res.clone().json();
  } catch (e) {
    jsonValid = false;
  }

  if (!jsonValid) {
    if (ACTION_AMAN_DIULANG.includes(action) && percobaan < MAKS_PERCOBAAN) {
      console.warn(`Google membalas non-JSON untuk '${action}' (percobaan ${percobaan}). Mengulang...`);
      await jedaMs(700 * percobaan);
      return fetchApi(url, opts, percobaan + 1);
    }

    console.error(`Google membalas non-JSON untuk '${action}' setelah ${percobaan} percobaan.`);

    if (ACTION_AMAN_DIULANG.includes(action)) {
      return responsSintetis({
        result: 'error',
        code: 'RESPONS_BUKAN_JSON',
        message: 'Server Google sedang tidak stabil dan membalas halaman, bukan data. Mohon coba lagi beberapa saat.'
      });
    }

    // Action TULIS: jangan pancing user untuk mengulang begitu saja
    return responsSintetis({
      result: 'error',
      code: 'RESPONS_BUKAN_JSON_TULIS',
      message: 'Server Google membalas halaman, bukan data, jadi status penyimpanan tidak diketahui. ' +
               'PERIKSA DULU di menu Riwayat apakah data sudah tersimpan sebelum mengulang, ' +
               'supaya tidak terjadi pengajuan ganda.'
    });
  }

  if (data && data.code === 'AUTH_REQUIRED') {
    sessionStorage.clear();
    alert('Sesi Anda sudah berakhir. Silakan login ulang.');
    window.location.reload();
  }

  return res;
};

    // HELPER FORMAT TANGGAL GLOBAL
// Tanggal hari ini menurut jam PERANGKAT (bukan UTC), format yyyy-MM-dd.
// Dipakai untuk mencocokkan catatan absen lokal dengan hari berjalan:
// toISOString() akan menggeser absen pagi hari WIB ke tanggal kemarin.
const tglLokal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatDateIndo = (d) => { if (!d || d === '-') return '-'; try { return new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return d; } };
const formatDateShort = (d) => { if (!d || d === '-') return '-'; try { return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}); } catch (e) { return d; } };
// Ikon dipilih per makna, bukan per kemiripan bentuk:
// Sakit = medis (bukan segitiga peringatan), Tukar Shift = panah dua arah
// (dulu memakai ikon kalender yang sama persis dengan Off).
const ICON_MAP = { 'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': ClipboardList, 'Sakit': HeartPulse, 'Lembur': Timer, 'Dinas': PlaneTakeoff, 'Dinas Luar': PlaneTakeoff, 'Cuti': Palmtree, 'Cuti EO': Palmtree, 'Tukar Shift': ArrowLeftRight, 'Off': Coffee, 'Standby': Clock };
// Tint lembut + ikon berwarna. Blok warna penuh bikin 4 kartu saling berebut perhatian.
const COLOR_MAP = {'Hadir': 'bg-emerald-50 text-emerald-600', 'Pulang': 'bg-rose-50 text-rose-600', 'Ijin': 'bg-amber-50 text-amber-600', 'Sakit': 'bg-red-50 text-red-600', 'Lembur': 'bg-violet-50 text-violet-600', 'Dinas': 'bg-sky-50 text-sky-600', 'Cuti': 'bg-teal-50 text-teal-600', 'Tukar Shift': 'bg-indigo-50 text-indigo-600', 'Off': 'bg-slate-100 text-slate-500'};

// ============================================================
// TEMA WARNA PER JENIS FORM
//
// Satu warna aksen per jenis pengajuan, dipakai konsisten di kepala
// layar, chip ikon, cincin fokus input, dan tombol kirim. Ini yang
// membedakan "berwarna" dari "warna-warni": versi lama menumpuk kotak
// biru, oranye, indigo, dan abu di satu layar tanpa alasan — tiap blok
// berteriak sekeras blok di sebelahnya, jadi tidak ada yang menonjol.
//
// Kelasnya ditulis utuh (bukan dirakit dari potongan string) karena
// Tailwind memindai kode sebagai teks; nama kelas hasil rakitan tidak
// akan pernah ikut ter-generate.
// ============================================================
const TEMA_DEFAULT = {
  grad: 'from-blue-600 to-indigo-700',
  chip: 'bg-blue-50 text-blue-600',
  fokus: 'focus:border-blue-400 focus:ring-blue-500/10',
  tombol: 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/25',
  garis: 'bg-blue-500',
};
const TEMA_FORM = {
  'Hadir':       { grad: 'from-emerald-500 to-teal-600',  chip: 'bg-emerald-50 text-emerald-600', fokus: 'focus:border-emerald-400 focus:ring-emerald-500/10', tombol: 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25', garis: 'bg-emerald-500' },
  'Pulang':      { grad: 'from-rose-500 to-red-600',      chip: 'bg-rose-50 text-rose-600',       fokus: 'focus:border-rose-400 focus:ring-rose-500/10',       tombol: 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/25',       garis: 'bg-rose-500' },
  'Ijin':        { grad: 'from-amber-500 to-orange-600',  chip: 'bg-amber-50 text-amber-600',     fokus: 'focus:border-amber-400 focus:ring-amber-500/10',     tombol: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/25',     garis: 'bg-amber-500' },
  'Sakit':       { grad: 'from-red-500 to-rose-600',      chip: 'bg-red-50 text-red-600',         fokus: 'focus:border-red-400 focus:ring-red-500/10',         tombol: 'bg-red-600 hover:bg-red-700 shadow-red-600/25',         garis: 'bg-red-500' },
  'Lembur':      { grad: 'from-violet-500 to-purple-600', chip: 'bg-violet-50 text-violet-600',   fokus: 'focus:border-violet-400 focus:ring-violet-500/10',   tombol: 'bg-violet-600 hover:bg-violet-700 shadow-violet-600/25', garis: 'bg-violet-500' },
  'Dinas':       { grad: 'from-sky-500 to-blue-600',      chip: 'bg-sky-50 text-sky-600',         fokus: 'focus:border-sky-400 focus:ring-sky-500/10',         tombol: 'bg-sky-600 hover:bg-sky-700 shadow-sky-600/25',         garis: 'bg-sky-500' },
  'Dinas Luar':  { grad: 'from-sky-500 to-cyan-600',      chip: 'bg-sky-50 text-sky-600',         fokus: 'focus:border-sky-400 focus:ring-sky-500/10',         tombol: 'bg-sky-600 hover:bg-sky-700 shadow-sky-600/25',         garis: 'bg-sky-500' },
  'Cuti':        { grad: 'from-teal-500 to-emerald-600',  chip: 'bg-teal-50 text-teal-600',       fokus: 'focus:border-teal-400 focus:ring-teal-500/10',       tombol: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/25',       garis: 'bg-teal-500' },
  'Cuti EO':     { grad: 'from-teal-500 to-cyan-600',     chip: 'bg-teal-50 text-teal-600',       fokus: 'focus:border-teal-400 focus:ring-teal-500/10',       tombol: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/25',       garis: 'bg-teal-500' },
  'Tukar Shift': { grad: 'from-indigo-500 to-blue-700',   chip: 'bg-indigo-50 text-indigo-600',   fokus: 'focus:border-indigo-400 focus:ring-indigo-500/10',   tombol: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/25', garis: 'bg-indigo-500' },
  'Off':         { grad: 'from-slate-600 to-slate-800',   chip: 'bg-slate-100 text-slate-500',    fokus: 'focus:border-slate-400 focus:ring-slate-500/10',     tombol: 'bg-slate-800 hover:bg-slate-900 shadow-slate-800/25',   garis: 'bg-slate-500' },
  'Standby':     { grad: 'from-slate-600 to-slate-800',   chip: 'bg-slate-100 text-slate-500',    fokus: 'focus:border-slate-400 focus:ring-slate-500/10',     tombol: 'bg-slate-800 hover:bg-slate-900 shadow-slate-800/25',   garis: 'bg-slate-500' },
};
const temaFor = (tipe) => TEMA_FORM[tipe] || TEMA_DEFAULT;

// Sakelar on/off. Dulu tiap tempat menggambar sakelarnya sendiri dengan
// ukuran dan jarak berbeda — di satu layar yang sama ada dua sakelar yang
// tidak sama tingginya.
const Sakelar = ({ aktif, onToggle, nonaktif, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={aktif}
    aria-label={label}
    disabled={nonaktif}
    onClick={onToggle}
    className={`relative inline-flex h-[24px] w-[42px] shrink-0 items-center rounded-full transition-colors duration-200
      ${aktif ? 'bg-blue-600' : 'bg-slate-200'} ${nonaktif ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform duration-200
      ${aktif ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
  </button>
);

// Satu kartu seksi form: kepala (ikon + judul + kontrol kanan) lalu isi.
// Semua blok di layar form memakai ini, sehingga jarak dan garisnya sama.
const SeksiForm = ({ ikon: Ikon, judul, catatan, aksi, warnaIkon, padat, children }) => (
  <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm shadow-slate-900/[0.03] overflow-hidden">
    <header className="flex items-center gap-2.5 px-4 py-3">
      <span className={`w-8 h-8 shrink-0 rounded-[10px] flex items-center justify-center ${warnaIkon || 'bg-slate-100 text-slate-500'}`}>
        <Ikon className="w-[15px] h-[15px]" strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-900 tracking-tight leading-tight">{judul}</p>
        {catatan && <p className="text-[10.5px] text-slate-400 leading-tight mt-0.5">{catatan}</p>}
      </div>
      {aksi}
    </header>
    {children && (
      <div className={`border-t border-slate-100 ${padat ? 'p-3' : 'px-4 py-3.5'}`}>{children}</div>
    )}
  </section>
);

// Satu gaya input untuk seluruh layar form.
const INPUT_FORM = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-[13.5px] font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none transition-all focus:ring-4';

// Label mikro di atas tiap field.
const LabelKecil = ({ children }) => (
  <label className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400 mb-1.5">{children}</label>
);

    // MAIN APP COMPONENT
    //
    // Dibungkus <ImportJobProvider> di bawah (lihat AppAbsensi). Provider itu
    // yang memegang job import dbabsen, supaya loop pengirimannya tidak ikut
    // mati saat admin meninggalkan layar Import.
function AppAbsensiInner() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); 
  const [masterData, setMasterData] = useState({ menus: [], roles: [], divisions: [], shifts: [] });
  const [editItem, setEditItem] = useState(null);
  const logoutTimerRef = useRef(null);
  // HARUS SAMA dengan APP_VERSION di Kode.gs yang SEDANG di-deploy.
  // Backend produksi sudah di Versi 127 (APP_VERSION 1.0.14) sejak 12 Agu 13.13.
  // Aturan urutannya: deploy Apps Script DULU, baru naikkan angka ini.
  // Kalau frontend lebih baru dari backend, layar "Update Tersedia" memblokir
  // semua user dan reload tidak menyelesaikan apa pun.
  const CLIENT_VERSION = "1.0.14";
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newVersion, setNewVersion] = useState('');

    //----LOGIKA CEK UPDATE----
    // Request 'check_version' saat mount DIHAPUS. Alasannya terukur:
    // membuka aplikasi tadinya menembak 4 request Apps Script berurutan,
    // dan backend sedang saturasi — klien menunggu 45-60 detik padahal
    // eksekusi server hanya 1-5 detik. Menghapus satu request memotong
    // 25% beban pada jalur buka-aplikasi.
    //
    // Versi server sekarang dibawa di dalam respons 'login' (field version),
    // jadi fiturnya tetap ada tanpa round trip tambahan.
const cekVersi = useCallback((versiServer) => {
  if (!versiServer || versiServer === CLIENT_VERSION) return;
  const sudahCoba = new URLSearchParams(window.location.search).get('v');
  if (sudahCoba === versiServer) {
    console.warn(`Versi tetap tidak cocok setelah reload (client v${CLIENT_VERSION}, server v${versiServer}). Tidak memblokir.`);
    return;
  }
  setNewVersion(versiServer);
  setUpdateAvailable(true);
}, [CLIENT_VERSION]);

    //----LOGIKA AUTO LOGIN / RESTORE SESSION----
useEffect(() => { 
  // UBAH: localStorage menjadi sessionStorage
  const u = sessionStorage.getItem('app_user'), m = sessionStorage.getItem('app_master_data'); 
  if (u) { 
    setUser(JSON.parse(u)); 
    if (m) setMasterData(JSON.parse(m)); 
    setView('dashboard'); 
  } 
}, []);

    //----FUNGSI EKSEKUSI UPDATE (MEMBERSIHKAN CACHE)----
const performUpdate = () => { localStorage.clear(); sessionStorage.clear(); if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())); window.location.href = window.location.href.split('?')[0] + '?v=' + newVersion + '&t=' + Date.now(); };

    //----FUNGSI LOGOUT / KELUAR APLIKASI----
const handleLogout = useCallback(() => { 
  setUser(null); 
  setMasterData({ menus: [], roles: [], divisions: [], shifts: [] }); 
  setView('login'); 
  // UBAH: localStorage menjadi sessionStorage
  sessionStorage.removeItem('app_user'); 
  sessionStorage.removeItem('app_master_data');
  sessionStorage.removeItem('announcement_shown');
  // Statistik milik user sebelumnya — kalau tidak dibuang, user berikutnya
  // yang login di HP yang sama akan melihat angka orang lain sekejap.
  sessionStorage.removeItem('app_stats_awal');
  sessionStorage.removeItem('app_stats_terakhir');
  sessionStorage.removeItem('app_pengumuman_awal');
  if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current); 
}, []);

    //----RESET TIMER OTOMATIS LOGOUT----
const resetTimer = useCallback(() => { if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current); if (user) logoutTimerRef.current = setTimeout(() => { alert("Sesi Anda berakhir karena tidak ada aktivitas selama 10 menit."); handleLogout(); }, TIMEOUT_DURATION); }, [user, handleLogout]);

    // LISTENER AKTIVITAS USER (AUTO-LOGOUT)
useEffect(() => { if (!user) return; resetTimer(); const ev = ['click', 'mousemove', 'keypress', 'scroll', 'touchstart']; ev.forEach(e => window.addEventListener(e, resetTimer)); return () => { if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current); ev.forEach(e => window.removeEventListener(e, resetTimer)); }; }, [user, resetTimer]);

    // FUNGSI HANDLER LOGIN & PENYIMPANAN SESI
const handleLogin = (userData, rawMasterData, versiServer, statsAwal, pengumumanAwal, pengumumanDisertakan) => {
  cekVersi(versiServer);

  const p = { menus: rawMasterData.filter(m => m.kategori === 'Menu'), roles: rawMasterData.filter(m => m.kategori === 'Role'), divisions: rawMasterData.filter(m => m.kategori === 'Divisi'), shifts: rawMasterData.filter(m => m.kategori === 'Shift') };
  setMasterData(p);
  setUser(userData);
  setView('dashboard');
  // UBAH: localStorage menjadi sessionStorage
  sessionStorage.setItem('app_user', JSON.stringify(userData));
  sessionStorage.setItem('app_master_data', JSON.stringify(p));

  // STATISTIK IKUT DALAM RESPONS LOGIN (Agu 2026).
  // Dititipkan lewat sessionStorage, bukan props, supaya Dashboard bisa
  // memakainya tanpa mengubah rantai props yang dilewati banyak layar.
  // Dibaca SEKALI lalu dihapus oleh Dashboard — kalau halaman di-reload
  // dan sesi dipulihkan, angkanya sudah usang dan harus diambil ulang.
  //
  // Backend boleh mengirim stats: null (perhitungannya dibungkus try di
  // sana). Kalau null, Dashboard jatuh ke perilaku lama: tembak get_stats.
  if (statsAwal) {
    try {
      sessionStorage.setItem('app_stats_awal', JSON.stringify(statsAwal));
    } catch (e) { /* kuota penuh: bukan kegagalan fatal, cuma tidak hemat */ }
  }

  // PENGUMUMAN juga ikut di respons login. Dititipkan HANYA kalau backend
  // menyatakan pembacaannya berhasil (pengumumanDisertakan). Kalau tidak,
  // kunci ini tidak ditulis sama sekali dan Dashboard mengambilnya sendiri
  // seperti dulu — supaya pengumuman yang gagal dibaca tidak hilang diam-diam.
  //
  // isi null yang SAH (memang tidak ada pengumuman aktif) tetap perlu
  // disimpan, karena itulah yang memberi tahu Dashboard "sudah dicek, kosong".
  // Karena itu yang disimpan objek pembungkus, bukan nilainya langsung.
  if (pengumumanDisertakan) {
    try {
      sessionStorage.setItem('app_pengumuman_awal', JSON.stringify({ isi: pengumumanAwal || null }));
    } catch (e) { /* abaikan */ }
  }
};

    // LAYOUT CONTAINER / WRAPPER UTAMA APLIKASI
return (<div className="min-h-screen bg-gray-100 font-sans text-slate-800"><div className="max-w-md mx-auto bg-white min-h-screen shadow-xl overflow-hidden relative">{updateAvailable&&(<div className="fixed inset-0 z-[9999] bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300"><div className="bg-white p-6 rounded-3xl shadow-2xl max-w-sm w-full"><div className="bg-blue-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce"><RefreshCcw className="w-10 h-10 text-blue-600"/></div><h2 className="text-2xl font-black text-slate-800 mb-2">Update Tersedia!</h2><p className="text-slate-500 text-sm mb-6">Versi aplikasi Anda usang (v{CLIENT_VERSION}).<br/>Mohon update ke <strong>versi {newVersion}</strong> untuk melanjutkan.</p><button onClick={performUpdate} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2"><RefreshCcw className="w-5 h-5 animate-spin"/>Update Sekarang</button><p className="text-[10px] text-slate-400 mt-4">*Aplikasi akan dimuat ulang secara otomatis.</p></div></div>)}{/* Bar biru generik. 'form' dikecualikan (Agu 2026): layar itu sekarang
       punya kepala sendiri yang menyebutkan jenis pengajuannya, jadi bar ini
       hanya menghasilkan judul dobel — "Menu Form" di atas "Form Ijin". */}
    {view!=='login'&&view!=='dashboard'&&view!=='form'&&(<div className="bg-blue-600 p-4 text-white flex justify-between items-center shadow-md z-10 relative"><div className="flex items-center gap-2"><button onClick={()=>setView('dashboard')} className="flex items-center gap-2"><Activity className="w-6 h-6"/><span className="font-bold text-lg">Menu {view==='history'?'Riwayat':'Lainnya'}</span></button></div></div>)}<div className="p-0">{view==='login'&&<LoginScreen onLogin={handleLogin}/>}{view==='dashboard'&&<Dashboard user={user} setUser={setUser} setView={setView} handleLogout={handleLogout} masterData={masterData}/>}{view==='form'&&<AttendanceForm user={user} setUser={setUser} setView={setView} editItem={editItem} setEditItem={setEditItem} masterData={masterData}/>}{view==='history'&&<HistoryScreen user={user} setView={setView} setEditItem={setEditItem} masterData={masterData}/>}{view==='db_absen'&&<DbAbsenScreen user={user} setView={setView}/>}{view==='admin'&&<AdminPanel user={user} setView={setView} masterData={masterData}/>}{view==='approval'&&<ApprovalScreen user={user} setView={setView}/>}{view==='ganti_password'&&<ChangePasswordScreen user={user} setView={setView}/>}{view==='remark'&&<RemarkScreen user={user} setView={setView}/>}{view==='input_shift'&&<ShiftScheduleScreen user={user} setView={setView} masterData={masterData}/>}{view==='analysis'&&<AnalysisScreen user={user} setView={setView}/>}</div>{user&&<ImportNotifier/>}</div></div>);}

    // PEMBUNGKUS APLIKASI
    // Provider dipasang di luar komponen utama, bukan di dalamnya, supaya
    // job import tidak ikut ter-reset setiap kali AppAbsensiInner render ulang.
export default function AppAbsensi() {
  return (
    <ImportJobProvider>
      <AppAbsensiInner />
    </ImportJobProvider>
  );
}

// Satu kartu absen (masuk / pulang).
// Tiga keadaan, dan hanya SATU yang boleh terlihat menonjol pada saat
// yang sama — itu yang membuat orang tidak perlu berpikir tombol mana
// yang harus ditekan sekarang.
//   utama    : aksi yang wajar dilakukan berikutnya -> tombol terisi warna
//   menunggu : belum waktunya (mis. pulang sebelum masuk) -> redup
//   selesai  : sudah tercatat -> menampilkan jam, bukan ajakan
const KartuAbsen = ({ onClick, label, jam, Ikon, warna, keadaan }) => {
  const selesai = keadaan === 'selesai';
  const utama = keadaan === 'utama';

  const gaya = selesai
      ? `bg-white border-slate-200/80 ${warna.teksSelesai}`
      : utama
          ? `${warna.isi} border-transparent text-white ${warna.bayangan}`
          : 'bg-white border-slate-200/80 text-slate-400';

  return (
      <button
          onClick={onClick}
          className={`relative flex-1 min-w-0 rounded-2xl border p-3.5 text-left transition-all duration-200 active:scale-[0.97] ${gaya}`}
      >
          <div className="flex items-center gap-2">
              <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center
                  ${selesai ? warna.lembut : utama ? 'bg-white/20' : 'bg-slate-100'}`}>
                  <Ikon className="w-[15px] h-[15px]" strokeWidth={2.1} />
              </span>
              <span className={`text-[11px] font-semibold tracking-tight truncate
                  ${utama ? 'text-white/90' : selesai ? 'text-slate-500' : 'text-slate-400'}`}>
                  {label}
              </span>
          </div>

          <p className={`mt-2.5 font-semibold tabular-nums tracking-tight leading-none
              ${jam ? 'text-[26px]' : 'text-[26px] opacity-40'}`}>
              {jam || '--:--'}
          </p>

          <p className={`mt-1.5 text-[10px] font-medium leading-tight
              ${utama ? 'text-white/70' : selesai ? warna.teksSelesai : 'text-slate-300'}`}>
              {selesai
                  ? 'Sudah tercatat'
                  : utama ? 'Ketuk untuk absen' : 'Belum tercatat'}
          </p>

          {selesai && (
              <span className={`absolute top-3 right-3 ${warna.teksSelesai}`}>
                  <CheckCircle className="w-4 h-4" strokeWidth={2.2} />
              </span>
          )}
      </button>
  );
};

    // KOMPONEN JAM ANALOG
const AnalogClock = ({ time }) => { const s = time.getSeconds(), m = time.getMinutes(), h = time.getHours(); const sD = (s/60)*360, mD = (m/60)*360+(s/60)*6, hD = ((h%12)/12)*360+(m/60)*30; return (<div className="relative w-28 h-28 flex items-center justify-center bg-white rounded-full shadow-inner border-4 border-slate-100">{[...Array(12)].map((_, i) => { const n = i+1, r = n*30; return (<div key={n} className="absolute w-full h-full text-center pt-1" style={{transform:`rotate(${r}deg)`}}><span className="inline-block text-[10px] font-bold text-slate-400" style={{transform:`rotate(-${r}deg)`}}>{n}</span></div>); })}{[...Array(12)].map((_, i) => (<div key={i} className="absolute w-0.5 h-1 bg-slate-200 rounded-full" style={{transform:`rotate(${i*30}deg) translate(0, -38px)`}}></div>))}<div className="absolute w-1.5 h-7 bg-slate-800 rounded-full origin-bottom z-10" style={{transform:`rotate(${hD}deg)`, bottom:'50%'}}></div><div className="absolute w-1 h-9 bg-blue-500 rounded-full origin-bottom z-10" style={{transform:`rotate(${mD}deg)`, bottom:'50%'}}></div><div className="absolute w-0.5 h-10 bg-red-500 rounded-full origin-bottom z-10" style={{transform:`rotate(${sD}deg)`, bottom:'50%'}}></div><div className="absolute w-2.5 h-2.5 bg-slate-800 rounded-full z-20 border-2 border-white"></div></div>); };

    // DASHBOARD SCREEN (CLICKABLE STATS)
function Dashboard({ user, setUser, setView, handleLogout, masterData }) { const [time, setTime] = useState(new Date()); const [stats, setStats] = useState({ total_hadir: 0, total_ijin: 0, total_telat_freq: 0, total_telat_menit: 0, total_cuti: 0, total_cuti_bersama: 0, total_sakit: 0, total_alpa: 0, total_no_scan_in: 0, total_no_scan_out: 0, periode_db: '-' }); const [loadingStats, setLoadingStats] = useState(true); const [showNews, setShowNews] = useState(false); const [newsContent, setNewsContent] = useState(null);
// Gagal-ambil vs benar-benar-nol dulu tampil identik (semua angka 0 dan
// periode '-'), jadi request yang gagal terbaca seperti "user belum punya
// data". Dua state ini memisahkannya.
const [statsError, setStatsError] = useState('');
const [statsRetry, setStatsRetry] = useState(0);

// STATISTIK YANG SUDAH IKUT DI RESPONS LOGIN (Agu 2026).
// Dibaca sekali saat komponen pertama dibuat, lalu dihapus dari
// sessionStorage supaya reload halaman tidak memakai angka basi.
// useState dengan fungsi inisialisasi = dijalankan sekali, bukan tiap render.
const [statsAwal] = useState(() => {
  try {
    const raw = sessionStorage.getItem('app_stats_awal');
    if (!raw) return null;
    sessionStorage.removeItem('app_stats_awal');
    return JSON.parse(raw);
  } catch (e) { return null; }
});

// Menandai bahwa pengambilan get_stats PERTAMA boleh dilewati.
// Dipakai sekali lalu dimatikan, sehingga tombol "coba lagi" (statsRetry)
// dan pergantian user tetap menembak server seperti biasa.
const lewatiFetchStatsAwal = useRef(!!statsAwal);

    // LOGIC FETCH PENGUMUMAN / INFO HRD
useEffect(() => { (async () => {
  if (sessionStorage.getItem('announcement_shown')) return;

  // JALUR CEPAT: pengumuman sudah ikut di respons login (lihat handleLogin).
  // Dipakai sekali lalu dihapus, supaya reload halaman mengambil yang terbaru.
  //
  // Yang disimpan objek pembungkus {isi: ...}, bukan nilainya langsung —
  // sehingga "sudah dicek dan memang kosong" bisa dibedakan dari
  // "belum pernah dicek". Kalau tidak dibedakan, setiap user yang tidak
  // punya pengumuman aktif akan tetap menembak request ini sia-sia.
  try {
    const raw = sessionStorage.getItem('app_pengumuman_awal');
    if (raw) {
      sessionStorage.removeItem('app_pengumuman_awal');
      const bungkus = JSON.parse(raw);
      if (bungkus && bungkus.isi) { setNewsContent(bungkus.isi); setShowNews(true); }
      return;
    }
  } catch (e) { /* cache rusak: lanjut ambil dari server */ }

  try { const d = await (await fetchApi(SCRIPT_URL, {method:'POST', body:JSON.stringify({action:'get_latest_announcement'})})).json(); if(d.result==='success'&&d.data){ setNewsContent(d.data); setShowNews(true); } } catch(e){ console.error(e); }
})(); }, []);
  
    // LOGIC TIMER / DETAK JAM REAL-TIME
useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

    // LOGIC FETCH STATISTIK DASHBOARD
useEffect(() => {
  // Menyalin apa adanya + versi huruf kecil semua kunci, karena beberapa
  // kartu dashboard membaca nama kunci dengan kapitalisasi berbeda.
  const terapkanStats = (s) => {
    const n = {};
    Object.keys(s).forEach(k => n[k.toLowerCase()] = s[k]);
    setStats({ ...s, ...n });
    // Disimpan supaya layar DB Absen tidak perlu menembak get_stats lagi
    // hanya untuk mengambil ijin_count.
    try { sessionStorage.setItem('app_stats_terakhir', JSON.stringify(s)); } catch (e) { /* abaikan */ }
  };

  // JALUR CEPAT: angka sudah ikut di respons login, tidak perlu request.
  // Inilah yang menghilangkan satu round trip penuh (POST + 302 redirect
  // + boot container) dari jalur membuka aplikasi.
  if (lewatiFetchStatsAwal.current) {
    lewatiFetchStatsAwal.current = false;
    terapkanStats(statsAwal);
    setLoadingStats(false);
    setStatsError('');
    return;
  }

  const f = async () => {
    setLoadingStats(true);
    setStatsError('');
    try {
      const d = await (await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_stats', userId: user.id }) })).json();
      if (d.result === 'success') {
        terapkanStats(d.stats);
      } else {
        // Dulu cabang ini tidak ada: pesan error dari fetchApi
        // (RESPONS_BUKAN_JSON, FORBIDDEN, dsb) dibuang, dan kartu
        // Statistik tetap menampilkan nol seolah-olah itu datanya.
        setStatsError(d.message || 'Server tidak mengirim data statistik.');
      }
    } catch (e) {
      console.error('Gagal load stats:', e);
      setStatsError('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      setLoadingStats(false);
    }
  };
  if (user) f();
  // statsAwal sengaja tidak masuk daftar: nilainya dibekukan sekali oleh
  // useState dan tidak pernah berubah, jadi menambahkannya tidak mengubah
  // kapan efek ini berjalan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [user, statsRetry]);

    // FUNGSI KLIK STATISTIK (NAVIGASI FILTER)
const handleStatClick = (c) => { localStorage.setItem('dbAbsenFilter', c); setView('db_absen'); };

    // LOGIKA PERSIAPAN DATA DASHBOARD
if (!user) return null;
const availableMenus = masterData.menus || [];

    // FILTER MENU BERDASARKAN HAK AKSES USER
const allowedMenus = user.akses && user.akses.length > 0 ? availableMenus.filter(item => user.akses.includes(item.value)) : availableMenus;

    // NORMALISASI ROLE USER
const userRole = (user.role || '').toLowerCase();

    // PENENTUAN HAK AKSES (FLAGS)
const canApprove = ['admin', 'hrd', 'manager'].includes(userRole);
const canAccessPanel = userRole === 'admin' && userRole !== 'hrd';
const isHRDOrAdmin = ['admin', 'hrd'].includes(userRole);
const isShiftWorker = userRole === 'karyawan_shift';

    // LOGIKA SAPAAN BERDASARKAN WAKTU
const hour = time.getHours();
let greeting = 'Selamat Pagi';

if (hour >= 11 && hour < 15) { 
    greeting = 'Selamat Siang'; 
} else if (hour >= 15 && hour < 18) { 
    greeting = 'Selamat Sore'; 
} else if (hour >= 18) { 
    greeting = 'Selamat Malam'; 
}

    // FORMAT TANGGAL BAHASA INDONESIA
const dateOptions = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' };
const dateString = time.toLocaleDateString('id-ID', dateOptions);

    // KOMPONEN HELPER LOADING (SKELETON)
const Skeleton = ({ className }) => (
    <div className={`bg-gray-200 animate-pulse rounded ${className}`}></div>
);

  // Sel angka pada grid statistik. Nilai 0 sengaja diredupkan supaya
  // mata langsung tertuju ke angka yang benar-benar ada isinya.
  const StatCell = ({ label, value, tone = 'neutral', onClick }) => {
    const n = Number(value) || 0;
    const warna = n === 0
        ? 'text-slate-300'
        : tone === 'alert' ? 'text-rose-600' : 'text-slate-900';
    return (
        <button
            onClick={onClick}
            className="text-left px-3 py-3 transition-colors hover:bg-slate-50 active:bg-slate-100"
        >
            <p className="text-[10.5px] leading-tight text-slate-500 font-medium min-h-[26px]">{label}</p>
            {loadingStats
                ? <Skeleton className="h-[19px] w-6 mt-1" />
                : <p className={`mt-1 text-[19px] leading-none font-semibold tabular-nums tracking-tight ${warna}`}>{n}</p>}
        </button>
    );
  };

  // ============================================================
  // ABSEN HARI INI — sumber jam masuk & jam pulang
  //
  // Angkanya datang dari hitungStats di Apps Script (field
  // jam_masuk_hari_ini / jam_pulang_hari_ini), jadi TIDAK ada request
  // tambahan: loop sheet Absensi di sana memang sudah membaca kolom
  // waktu inputnya.
  //
  // Cadangan localStorage dipakai hanya untuk jeda beberapa detik antara
  // "form absen baru saja terkirim" dan "stats berikutnya sudah turun",
  // supaya jamnya muncul seketika. Isinya diabaikan kalau tanggalnya
  // bukan hari ini atau user-nya beda.
  const absenLokal = (() => {
    try {
      const raw = localStorage.getItem('absen_hari_ini');
      if (!raw) return {};
      const d = JSON.parse(raw);
      // tglLokal(), bukan toISOString(): toISOString memberi tanggal UTC,
      // jadi absen pukul 06.00 WIB tersimpan sebagai "kemarin" dan
      // jam-nya tidak pernah muncul.
      if (d.tgl !== tglLokal() || String(d.userId) !== String(user.id)) return {};
      return d;
    } catch (e) { return {}; }
  })();

  const jamMasuk  = stats.jam_masuk_hari_ini  || absenLokal.masuk  || '';
  const jamPulang = stats.jam_pulang_hari_ini || absenLokal.pulang || '';

  const menitDariJam = (j) => {
    if (!j) return null;
    const c = String(j).match(/^(\d{1,2}):(\d{2})/);
    return c ? Number(c[1]) * 60 + Number(c[2]) : null;
  };

  // Selisih masuk -> pulang. Kalau negatif, berarti shift yang menyeberang
  // tengah malam, bukan data salah.
  const durasiKerja = (() => {
    const a = menitDariJam(jamMasuk), b = menitDariJam(jamPulang);
    if (a === null || b === null) return '';
    const d = b >= a ? b - a : b + 1440 - a;
    return `${Math.floor(d / 60)} jam ${d % 60} menit`;
  })();

  // Tombol hanya untuk user yang memang punya akses menu-nya (lihat kolom
  // "akses" di sheet Users). Sisa menunya tetap tampil di daftar e-Form.
  const menuMasuk  = allowedMenus.find(m => m.value === 'Hadir');
  const menuPulang = allowedMenus.find(m => m.value === 'Pulang');
  const adaTombolAbsen = !!(menuMasuk || menuPulang);
  const menuEForm = allowedMenus.filter(m => m.value !== 'Hadir' && m.value !== 'Pulang');

  const bukaFormAbsen = (nilai) => {
    localStorage.setItem('absenType', nilai);
    setView('form');
  };

  const jamSekarang = time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });

  // --- RENDER UI ---
  const sHadir  = Number(stats.total_hadir) || 0;
  const sTelatX = Number(stats.total_telat_freq) || 0;
  const sTelatM = Number(stats.total_telat_menit) || 0;
  // Basis persentase: seluruh hari yang punya catatan, bukan kalender penuh.
  const sTercatat = sHadir
        + (Number(stats.total_ijin) || 0)
        + (Number(stats.total_cuti) || 0)
        + (Number(stats.total_cuti_bersama) || 0)
        + (Number(stats.total_sakit) || 0)
        + (Number(stats.total_alpa) || 0);
  const sPctHadir = sTercatat > 0 ? Math.round((sHadir / sTercatat) * 100) : 0;

  return (
    <div className="p-4 pb-24 bg-gray-50 min-h-screen font-sans flex flex-col"> 
      
      {/* --- KARTU PROFIL HEADER --- */}
      <div className="relative rounded-[2.5rem] p-6 shadow-xl shadow-slate-200 mb-6 overflow-hidden bg-white border border-white">
        <div className="absolute top-0 left-0 w-full h-28 bg-gradient-to-r from-blue-600 to-indigo-700"></div>
        <div className="absolute top-20 left-0 w-full h-10 bg-white rounded-t-[2.5rem]"></div>
 
        {/* HEADER KIRI ATAS */}
        <div className="absolute top-5 left-6 z-20 flex items-center gap-2">
            <div className="bg-white/10 backdrop-blur-md p-2 rounded-full border border-white/20 shadow-lg animate-[pulse_3s_infinite]">
                <ScanLine className="w-5 h-5 text-blue-100" />
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] font-bold text-blue-100 tracking-widest uppercase">Secure</span>
                <span className="text-[10px] font-bold text-white tracking-widest uppercase leading-none">Access</span>
            </div>
        </div>

        {/* HEADER KANAN ATAS */}
        <div className="absolute top-5 right-6 z-20 flex gap-2">
             <button onClick={() => setView('ganti_password')} className="bg-white/20 hover:bg-white/40 p-2.5 rounded-full backdrop-blur-md transition-all duration-300 text-white border border-white/30 shadow-lg active:scale-90 hover:rotate-12 group" title="Ubah Password">
                <KeyRound className="w-5 h-5 group-hover:text-yellow-300 transition-colors" />
             </button>
             <button onClick={handleLogout} className="bg-red-500/80 hover:bg-red-600 p-2.5 rounded-full backdrop-blur-md transition-all duration-300 text-white border border-red-400/50 shadow-lg active:scale-90 hover:animate-[tada_1s_ease-in-out]" title="Keluar Aplikasi">
                <LogOut className="w-5 h-5" />
             </button>
        </div>

        <div className="relative z-10 flex flex-col items-center mt-6">
            <div className="mb-4 transform hover:scale-105 transition-transform duration-500 ease-out shadow-2xl rounded-full bg-white p-1">
                 <AnalogClock time={time} />
            </div>

            <div className="text-center mb-6 w-full">
                <div className="flex items-center justify-center gap-2 mb-1">
                    <CloudSun className="w-4 h-4 text-orange-400 animate-bounce-slow" />
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">{greeting}</p>
                </div>
                <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-tight truncate px-2">{user.nama}</h2>
                <div className="flex items-center justify-center gap-2 mt-1 text-xs font-bold text-slate-500">
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 border border-slate-200">{user.divisi}</span>
                    <span className="text-slate-300">•</span>
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 border border-slate-200">{user.lokasi || 'All'}</span>
                </div>
                <p className="text-[10px] text-slate-400 font-medium mt-2">{dateString}</p>
            </div>

            {/* INFO CHIPS */}
            <div className="grid grid-cols-2 gap-3 w-full">
                 <div className="bg-blue-50/50 p-2.5 rounded-2xl border border-blue-100 flex items-center gap-3 hover:bg-blue-50 transition-colors">
                    <div className="bg-blue-500 p-2 rounded-xl text-white shadow-sm shadow-blue-200"><Building className="w-4 h-4"/></div>
                    <div className="overflow-hidden">
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Perusahaan</p>
                        <p className="text-xs font-bold text-slate-700 truncate">{user.perusahaan || 'JPT Group'}</p>
                    </div>
                 </div>
                 <div className="bg-indigo-50/50 p-2.5 rounded-2xl border border-indigo-100 flex items-center gap-3 hover:bg-indigo-50 transition-colors">
                    <div className="bg-indigo-500 p-2 rounded-xl text-white shadow-sm shadow-indigo-200"><CreditCard className="w-4 h-4"/></div>
                     <div>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">ID Akun</p>
                        <p className="text-xs font-bold text-slate-700 font-mono">{user.noPayroll || '-'}</p>
                    </div>
                 </div>
                 <div className="bg-emerald-50/50 p-2.5 rounded-2xl border border-emerald-100 flex items-center gap-3 hover:bg-emerald-50 transition-colors">
                    <div className="bg-emerald-500 p-2 rounded-xl text-white shadow-sm shadow-emerald-200"><User className="w-4 h-4"/></div>
                     <div>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Status</p>
                        <p className="text-xs font-bold text-slate-700">{user.statusKaryawan || '-'}</p>
                    </div>
                 </div>
                 <div className="bg-amber-50/50 p-2.5 rounded-2xl border border-amber-100 flex items-center gap-3 hover:bg-amber-50 transition-colors">
                    <div className="bg-amber-500 p-2 rounded-xl text-white shadow-sm shadow-amber-200"><PieChart className="w-4 h-4"/></div>
                     <div>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Cuti Tersedia</p>
                        <p className="text-xs font-bold text-slate-700">{user.sisaCuti} </p>
                    </div>
                </div>
            </div>
        </div>
      </div> 

      {/* --- ABSEN HARI INI --- */}
      {/* Dulu "Absen Masuk" dan "Absen Pulang" hanya dua baris di antara
          delapan baris daftar e-Form — padahal keduanya dipakai setiap hari
          oleh setiap orang, sedangkan sisanya sebulan sekali. Sekarang
          keduanya naik ke atas sebagai satu kartu tersendiri, dan jamnya
          langsung terbaca tanpa harus membuka Riwayat. */}
      {adaTombolAbsen && (
        <div className="mb-4 bg-white rounded-2xl border border-slate-200/70 overflow-hidden">

            <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
                <h3 className="text-[13px] font-semibold text-slate-900 tracking-tight">Absensi hari ini</h3>
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 tabular-nums">
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    {jamSekarang}
                </span>
            </div>

            <div className="flex gap-2.5 p-3 pt-2">
                {menuMasuk && (
                    <KartuAbsen
                        onClick={() => bukaFormAbsen('Hadir')}
                        label={menuMasuk.label || 'Absen Masuk'}
                        jam={jamMasuk}
                        Ikon={LogIn}
                        keadaan={jamMasuk ? 'selesai' : 'utama'}
                        warna={{
                            isi: 'bg-emerald-600',
                            bayangan: 'shadow-lg shadow-emerald-600/20',
                            lembut: 'bg-emerald-50',
                            teksSelesai: 'text-emerald-600',
                        }}
                    />
                )}

                {menuPulang && (
                    <KartuAbsen
                        onClick={() => bukaFormAbsen('Pulang')}
                        label={menuPulang.label || 'Absen Pulang'}
                        jam={jamPulang}
                        Ikon={LogOut}
                        keadaan={jamPulang ? 'selesai' : (jamMasuk || !menuMasuk ? 'utama' : 'menunggu')}
                        warna={{
                            isi: 'bg-rose-600',
                            bayangan: 'shadow-lg shadow-rose-600/20',
                            lembut: 'bg-rose-50',
                            teksSelesai: 'text-rose-600',
                        }}
                    />
                )}
            </div>

            {/* Baris bawah hanya muncul kalau ada yang bisa dikatakan.
                Tanpa ini, kartu punya footer kosong sepanjang pagi. */}
            {(durasiKerja || (jamMasuk && !jamPulang)) && (
                <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 flex items-center gap-1.5">
                    <Timer className="w-3 h-3 text-slate-400" strokeWidth={2} />
                    <span className="text-[10.5px] font-medium text-slate-500">
                        {durasiKerja
                            ? <>Durasi kerja hari ini <span className="font-semibold text-slate-700 tabular-nums">{durasiKerja}</span></>
                            : <>Masuk pukul <span className="font-semibold text-slate-700 tabular-nums">{jamMasuk}</span> — belum absen pulang</>}
                    </span>
                </div>
            )}
        </div>
      )}

      {/* --- MENU SHORTCUT --- */}
      {/* Satu bar tersegmentasi. Versi lama memakai kartu terpisah dengan warna teks
          berbeda-beda + scroll horizontal, jadi scrollbar-nya ikut terlihat di layar kecil.
          Posisinya dinaikkan ke atas kartu Statistik (Agu 2026): ini navigasi, dan
          navigasi tidak boleh berada di bawah blok angka setinggi satu layar. */}
      <div className="mb-5 bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <div className={`grid divide-x divide-slate-100 ${canApprove && canAccessPanel ? 'grid-cols-5' : (canApprove || canAccessPanel ? 'grid-cols-4' : 'grid-cols-3')}`}>

            <button onClick={() => setView('history')} className="flex flex-col items-center gap-1.5 px-1 py-3.5 transition-colors hover:bg-slate-50 active:bg-slate-100">
                <History className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.75} />
                <span className="text-[10.5px] font-medium text-slate-600 leading-tight text-center">Riwayat</span>
            </button>

            <button onClick={() => setView('db_absen')} className="flex flex-col items-center gap-1.5 px-1 py-3.5 transition-colors hover:bg-slate-50 active:bg-slate-100">
                <Fingerprint className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.75} />
                <span className="text-[10.5px] font-medium text-slate-600 leading-tight text-center">Data mesin</span>
            </button>

            <button onClick={() => setView('remark')} className="flex flex-col items-center gap-1.5 px-1 py-3.5 transition-colors hover:bg-slate-50 active:bg-slate-100">
                <MessageSquareText className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.75} />
                <span className="text-[10.5px] font-medium text-slate-600 leading-tight text-center">{isHRDOrAdmin ? 'Respon' : 'Lapor HRD'}</span>
            </button>

            {canApprove && (
                <button onClick={() => setView('approval')} className="flex flex-col items-center gap-1.5 px-1 py-3.5 transition-colors hover:bg-slate-50 active:bg-slate-100">
                    <UsersRound className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.75} />
                    <span className="text-[10.5px] font-medium text-slate-600 leading-tight text-center">Approval</span>
                </button>
            )}

            {canAccessPanel && (
                <button onClick={() => setView('admin')} className="flex flex-col items-center gap-1.5 px-1 py-3.5 transition-colors hover:bg-slate-50 active:bg-slate-100">
                    <SlidersHorizontal className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.75} />
                    <span className="text-[10.5px] font-medium text-slate-600 leading-tight text-center">Panel</span>
                </button>
            )}
        </div>
      </div>

      {/* --- STATISTIK (CLICKABLE) --- */}
      <div className="mb-5">

        <div className="flex items-baseline justify-between mb-2.5 px-1">
            <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">Statistik</h3>
                {loadingStats && <Loader2 className="w-3 h-3 text-slate-400 animate-spin"/>}
            </div>
            <span className="text-[11px] text-slate-400 font-medium">
                {loadingStats ? "Menyinkronkan…" : (statsError ? <span className="text-red-500 font-semibold">gagal dimuat</span> : stats.periode_db)}
            </span>
        </div>

        {/* Gagal ambil statistik — angka nol di bawah BUKAN data asli. */}
        {!loadingStats && statsError && (
            <div className="mb-2.5 bg-red-50 border border-red-200 rounded-xl p-3">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="text-[11px] font-bold text-red-700">Statistik gagal dimuat</p>
                        <p className="text-[10px] text-red-600 leading-relaxed mt-0.5">{statsError}</p>
                        <p className="text-[10px] text-red-500 italic mt-0.5">Angka 0 di bawah bukan data Anda — server belum sempat mengirimnya.</p>
                        <button
                            onClick={() => setStatsRetry(r => r + 1)}
                            className="mt-2 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition active:scale-95"
                        >
                            <RefreshCcw className="w-3 h-3" /> Coba Lagi
                        </button>
                    </div>
                </div>
            </div>
        )}

        <div className={`bg-white rounded-2xl border overflow-hidden ${statsError && !loadingStats ? 'border-red-200 opacity-60' : 'border-slate-200/70'}`}>

            {/* BARIS UTAMA — dua angka yang paling sering dilihat */}
            <div className="grid grid-cols-2 divide-x divide-slate-100">

                {/* HADIR -> Filter 'HADIR_ALL' */}
                <button onClick={() => handleStatClick('HADIR_ALL')} className="text-left p-4 transition-colors hover:bg-slate-50 active:bg-slate-100">
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span className="text-[11px] font-medium text-slate-500">Hadir</span>
                    </div>
                    {loadingStats ? <Skeleton className="h-8 w-14 mt-2.5"/> : (
                        <>
                            <p className="mt-2 flex items-baseline gap-1">
                                <span className="text-[32px] leading-none font-semibold text-slate-900 tabular-nums tracking-tighter">{sHadir}</span>
                                <span className="text-[11px] font-medium text-slate-400">hari</span>
                            </p>
                            <div className="mt-3 h-[3px] rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${sPctHadir}%` }}></div>
                            </div>
                            <p className="mt-1.5 text-[10px] text-slate-400 tabular-nums">{sPctHadir}% dari {sTercatat} hari tercatat</p>
                        </>
                    )}
                </button>

                {/* TELAT -> Filter 'T' */}
                <button onClick={() => handleStatClick('T')} className="text-left p-4 transition-colors hover:bg-slate-50 active:bg-slate-100">
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        <span className="text-[11px] font-medium text-slate-500">Telat</span>
                    </div>
                    {loadingStats ? <Skeleton className="h-8 w-14 mt-2.5"/> : (
                        <>
                            <p className="mt-2 flex items-baseline gap-1">
                                <span className={`text-[32px] leading-none font-semibold tabular-nums tracking-tighter ${sTelatX > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{sTelatX}</span>
                                <span className="text-[11px] font-medium text-slate-400">kali</span>
                            </p>
                            <p className="mt-3 flex items-baseline gap-1.5">
                                <span className="text-[13px] font-semibold text-amber-600 tabular-nums leading-none">{sTelatM}</span>
                                <span className="text-[10px] text-slate-400">menit total</span>
                            </p>
                            <p className="mt-1 text-[10px] text-slate-400 tabular-nums">
                                {sTelatX > 0 ? `rata-rata ${Math.round(sTelatM / sTelatX)} menit` : 'selalu tepat waktu'}
                            </p>
                        </>
                    )}
                </button>
            </div>

            {/* KELOMPOK 1 — ketidakhadiran yang sudah berizin */}
            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">Izin &amp; cuti</span>
            </div>
            <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100">
                <StatCell label="Ijin"          value={stats.total_ijin}         onClick={() => handleStatClick('I')} />
                <StatCell label="Cuti diambil"  value={stats.total_cuti}         onClick={() => handleStatClick('C')} />
                <StatCell label="Cuti bersama"  value={stats.total_cuti_bersama} onClick={() => handleStatClick('CB')} />
                <StatCell label="Sakit"         value={stats.total_sakit}        onClick={() => handleStatClick('S')} />
            </div>

            {/* KELOMPOK 2 — yang perlu ditindaklanjuti */}
            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">Perlu perhatian</span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
                <StatCell label="Alpa"            value={stats.total_alpa}         tone="alert" onClick={() => handleStatClick('A')} />
                <StatCell label="Tidak absen-in"  value={stats.total_no_scan_in}   tone="alert" onClick={() => handleStatClick('Si')} />
                <StatCell label="Tidak absen-out" value={stats.total_no_scan_out}  tone="alert" onClick={() => handleStatClick('So')} />
            </div>
        </div>
      </div>

      {/* --- MENU INPUT SHIFT --- */}
      {isShiftWorker && (
         <div className="mb-5">
            <h3 className="font-bold text-slate-700 mb-2 px-1 flex items-center gap-2 text-sm">
                 <CalendarCheck className="w-4 h-4 text-indigo-500"/> Menu Running Shift
             </h3>
            <button onClick={() => setView('input_shift')} className="w-full bg-indigo-50 border border-indigo-200 p-3 rounded-xl flex items-center justify-between group active:scale-95 transition-all shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm"><CalendarCheck className="w-5 h-5" /></div>
                    <div className="text-left">
                        <h4 className="font-bold text-indigo-900 text-sm">Input Jadwal Shift</h4>
                         <p className="text-[10px] text-indigo-600">Atur tanggal & jam kerja Shift Anda</p>
                    </div>
                </div>
                 <div className="bg-white p-1 rounded-full text-indigo-400"><ChevronDown className="-rotate-90 w-3 h-3" /></div>
            </button>
         </div>
      )}

      {/* --- MENU ABSENSI (DAFTAR) --- */}
      {/* Dulu grid kartu dengan blob dekoratif dan subjudul "Pengajuan Form" yang
          diulang di tiap kartu. Sekarang jadi daftar: kolom kanan dipakai untuk
          sisa kuota, informasi yang sebelumnya baru muncul setelah tombol mati. */}
      {/* Absen Masuk/Pulang sengaja dikeluarkan dari daftar ini — keduanya
          sudah punya kartu sendiri di atas, dan menampilkannya dua kali
          hanya membuat orang ragu mana yang "benar". */}
      {menuEForm.length > 0 && (
      <>
      <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight mb-2.5 px-1">
          Pengajuan e-Form
      </h3>

      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden divide-y divide-slate-100">
        {menuEForm.map((item) => {
            const Icon = ICON_MAP[item.value] || Star;
            const toneClass = COLOR_MAP[item.value] || 'bg-slate-100 text-slate-500';
            const sisaCuti = parseInt(user.sisaCuti) || 0;
            const ijinTerpakai = stats.ijin_count || 0;
            const isCutiEmpty = item.value === 'Cuti' && sisaCuti < 1;
            const isIjinFull = item.value === 'Ijin' && ijinTerpakai >= 4;
            const isDisabled = isCutiEmpty || isIjinFull;

            let meta = null;
            if (item.value === 'Cuti')      meta = isCutiEmpty ? 'Kuota habis' : `Sisa ${sisaCuti} hari`;
            else if (item.value === 'Ijin') meta = isIjinFull ? 'Limit tercapai' : `${ijinTerpakai} dari 4 terpakai`;

            return (
                <button
                    key={item.value}
                    disabled={isDisabled}
                    onClick={() => {
                        localStorage.setItem('absenType', item.value);
                        setView('form');
                     }}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors
                    ${isDisabled ? 'cursor-not-allowed' : 'hover:bg-slate-50 active:bg-slate-100'}`}
                 >
                    <span className={`w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center ${isDisabled ? 'bg-slate-100 text-slate-300' : toneClass}`}>
                       <Icon className="w-[17px] h-[17px]" strokeWidth={1.75} />
                     </span>

                    <span className={`flex-1 text-[14px] font-medium tracking-tight ${isDisabled ? 'text-slate-400' : 'text-slate-900'}`}>
                        {item.label}
                    </span>

                    {meta && (
                        <span className={`text-[11px] tabular-nums ${isDisabled ? 'font-medium text-rose-600' : 'text-slate-400'}`}>
                            {meta}
                        </span>
                    )}

                    <ChevronRight className={`w-4 h-4 shrink-0 ${isDisabled ? 'text-slate-200' : 'text-slate-300'}`} strokeWidth={2} />
                 </button>
            )
        })}
      </div>
      </>
      )}

      {/* --- FOOTER --- */}
      <div className="p-6 text-center mt-4 border-t border-dashed border-gray-200">
          <p className="text-[10px] text-slate-400 font
          -bold uppercase tracking-widest">
              Version {masterData?.appVersion || '1.0.13'} | &copy; {new Date().getFullYear()}
          </p>
      </div>


      {/* --- ANNOUNCEMENT POPUP (SOFT & ELEGANT V2) --- */}
      {showNews && newsContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans" style={{ perspective: '1000px' }}>
          
          {/* 1. Backdrop (Blur Lembut & Gelap Transparan untuk Fokus) */}
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[6px] transition-all duration-500"
            onClick={() => { setShowNews(false); sessionStorage.setItem('announcement_shown', 'true'); }}
          ></div>

          {/* 2. Kartu Utama (Floating Card) */}
          <div className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] border border-white/50 overflow-hidden transform transition-all animate-[softPop_0.6s_cubic-bezier(0.22,1,0.36,1)_forwards]">
             
             {/* Hiasan Latar Belakang (Soft Aurora Glow) */}
             <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-gradient-to-br from-blue-50 via-white to-indigo-50 opacity-60 pointer-events-none z-0"></div>
             <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-100/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

             {/* Tombol Close (Minimalis) */}
             <button 
                onClick={() => { setShowNews(false); sessionStorage.setItem('announcement_shown', 'true'); }}
                className="absolute top-5 right-5 z-20 bg-white/80 hover:bg-slate-100 p-2.5 rounded-full text-slate-400 hover:text-rose-500 transition-all shadow-sm border border-slate-100 active:scale-90"
             >
                <X className="w-5 h-5" />
             </button>

             {/* Header Section */}
             <div className="relative z-10 pt-10 px-8 text-center">
                {/* Icon Circle (Soft Shadow) */}
                <div className="mx-auto w-20 h-20 bg-white rounded-3xl shadow-xl shadow-indigo-100 flex items-center justify-center mb-5 rotate-3 hover:rotate-0 transition-transform duration-500 border border-slate-50">
                    <Megaphone className="w-9 h-9 text-indigo-500" />
                </div>

                <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Informasi HRD</h3>
                
                {/* Tanggal Badge (Modern Pill) */}
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-50 border border-slate-100 rounded-full mb-6">
                    <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                        {newsContent.waktu}
                    </span>
                </div>
             </div>

             {/* Content Area (Wide & Readable) */}
             <div className="relative z-10 px-8 pb-8">
                <div className="bg-slate-50/80 p-6 rounded-3xl border border-slate-100/80 max-h-[60vh] overflow-y-auto custom-scrollbar shadow-inner">
                    {/* TYPOGRAPHY FIX: Jarak baris lebar (leading-loose) & Warna Gelap */}
                    <p className="text-sm md:text-[15px] text-slate-700 font-medium leading-loose whitespace-pre-line text-left">
                        {newsContent.isi}
                    </p>
                </div>

                {/* Footer Action */}
                <div className="mt-6">
                    <button 
                        onClick={() => { setShowNews(false); sessionStorage.setItem('announcement_shown', 'true'); }}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white py-4 rounded-2xl font-bold shadow-xl shadow-slate-200 active:scale-[0.98] transition-all flex items-center justify-center gap-3 group"
                    >
                        <span>Saya Mengerti</span>
                        <Check className="w-5 h-5 text-emerald-400 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
             </div>
          </div>

          {/* Animasi Soft Pop (Paste di style atau di file CSS global jika perlu, tapi inline style di sini aman) */}
          <style>{`
            @keyframes softPop {
                0% { opacity: 0; transform: scale(0.95) translateY(10px); }
                100% { opacity: 1; transform: scale(1) translateY(0); }
            }
            /* Custom Scrollbar agar tidak merusak estetika */
            .custom-scrollbar::-webkit-scrollbar { width: 4px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
          `}</style>
        </div>
      )}
    </div> 
  );
}

// --- BARU: SHIFT SCHEDULE SCREEN (LENGKAP: View Report, Edit, Delete, Validasi 1 Jam) ---
function ShiftScheduleScreen({ user, setView, masterData }) {
    const [date, setDate] = useState('');
    const [selectedShiftValue, setSelectedShiftValue] = useState('');
    const [loading, setLoading] = useState(false);
    // STATE BARU: Untuk Riwayat dan Edit
    const [shiftHistory, setShiftHistory] = useState([]);
    const [editingItem, setEditingItem] = useState(null);
    // Jika sedang mode edit
    const [loadingHistory, setLoadingHistory] = useState(false);

    const availableShifts = masterData?.shifts || [];
    // FUNGSI: Cek apakah masih bisa diedit (Max 1 Jam)
    const isEditable = (waktuInput) => {
        if (!waktuInput) return false;
        try {
            const entryTime = new Date(waktuInput).getTime();
            const now = new Date().getTime();
            const diffInHours = (now - entryTime) / (1000 * 60 * 60);
            return diffInHours <= 1; // True jika kurang dari 1 jam
        } catch (e) { return false; }
    };

    // FUNGSI: Ambil Data Riwayat Shift
    const fetchShiftHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'get_shift_history', 
                    userId: user.id
                })
            });
            const data = await res.json();
            if (data.result === 'success') {
                setShiftHistory(data.data); 
            }
        } catch (e) {
            console.error("Gagal load history shift");
        } finally {
            setLoadingHistory(false);
        }
    }, [user.id]);

    useEffect(() => {
        fetchShiftHistory();
    }, [fetchShiftHistory]);

    // FUNGSI: Handle Klik Edit
    const handleEdit = (item) => {
        let formattedDate = item.tanggal;
        try {
            const d = new Date(item.tanggal);
            if(!isNaN(d.getTime())) {
                formattedDate = d.toISOString().split('T')[0];
            }
        } catch(e) {}

        setDate(formattedDate);
        setSelectedShiftValue(item.shiftValue);
        setEditingItem(item); 
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // FUNGSI: Handle Klik Hapus
    const handleDelete = async (uuid) => {
        // PERBAIKAN: Menambahkan 'window.' sebelum confirm
        if(!window.confirm("Yakin ingin menghapus jadwal shift ini?")) return;
        setLoading(true);
        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'delete_shift_schedule',
                    uuid: uuid
                })
            });
            const data = await res.json();
            if (data.result === 'success') {
                alert("Data berhasil dihapus");
                fetchShiftHistory(); 
            } else {
                alert(data.message);
            }
        } catch (e) {
            alert("Gagal menghapus data.");
        } finally {
            setLoading(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingItem(null);
        setDate('');
        setSelectedShiftValue('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!date || !selectedShiftValue) {
            alert("Mohon lengkapi Tanggal dan Pilihan Shift!");
            return;
        }

        const shiftObj = availableShifts.find(s => s.value === selectedShiftValue);
        const shiftLabel = shiftObj ? shiftObj.label : selectedShiftValue;

        // --- UPDATE VALIDASI: CEK APAKAH TANGGAL SUDAH ADA DAN TERKUNCI ---
        // Jika sedang TIDAK edit (Mode Input Baru), kita cek apakah tanggal sudah pernah diinput
        if (!editingItem) {
            const isLockedDate = shiftHistory.some(item => {
                let itemDate = item.tanggal;
                // Normalisasi format tanggal dari history agar sama dengan input (YYYY-MM-DD)
                try {
                    const d = new Date(item.tanggal);
                    // Adjust Timezone offset agar tidak geser hari
                    const offset = d.getTimezoneOffset() * 60000;
                    itemDate = new Date(d.getTime() - offset).toISOString().split('T')[0];
                } catch (e) {}
                
                // Jika tanggal sama DAN tidak bisa diedit (expired > 1 jam)
                return itemDate === date && !isEditable(item.waktuInput);
            });

            if (isLockedDate) {
                alert("GAGAL: Tanggal ini sudah ada dan tidak bisa di Tambahkan/diubah.");
                return;
            }
        }
        // --- END VALIDASI ---

        setLoading(true);

        // Tentukan Action: Edit atau Baru
        const actionType = editingItem ? 'edit_shift_schedule' : 'submit_shift_schedule';
        const payload = {
            action: actionType,
            userId: user.id,
            nama: user.nama,
            tanggal: date,
            shiftValue: selectedShiftValue,
            shiftLabel: shiftLabel,
            uuid: editingItem ? editingItem.uuid : null 
        };

        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.result === 'success') {
                alert(data.message);
                setDate('');
                setSelectedShiftValue('');
                setEditingItem(null); 
                fetchShiftHistory();  
            } else {
                alert(data.message);
            }
        } catch (e) {
            console.error(e);
            alert("Gagal koneksi ke server.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 h-full overflow-y-auto pb-20">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold ml-2">Jadwal Shift</h2>
                <BackButton onClick={() => setView('dashboard')} />
            </div>

            {/* --- FORM INPUT --- */}
            <div className={`bg-white p-5 rounded-xl shadow-sm border mb-6 transition-colors ${editingItem ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'}`}>
                {editingItem && (
                    <div className="mb-3 bg-yellow-50 text-yellow-700 p-2 rounded text-xs font-bold flex justify-between items-center">
                        <span>Sedang Mengedit Data...</span>
                        <button onClick={handleCancelEdit} className="bg-white border border-yellow-200 px-2 py-1 rounded hover:bg-yellow-100">Batal</button>
                    </div>
                )}
                
                {!editingItem && (
                    <div className="bg-indigo-50 border border-indigo-200 p-3 rounded-lg mb-4 text-xs text-indigo-800">
                       <p className="font-bold mb-1">Panduan:</p>
                       <p>Silakan input jadwal shift Anda. Data yang sudah diinput bisa diedit/hapus selama 1 jam setelah input.</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-700 block mb-1">Tanggal Shift *</label>
                        <input 
                            type="date" 
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />
                    </div>
                    
                    <div>
                        <label className="text-xs font-bold text-gray-700 block mb-1">Pilih Jam Kerja *</label>
                        <select 
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                            value={selectedShiftValue}
                            onChange={(e) => setSelectedShiftValue(e.target.value)}
                            required
                        >
                            <option value="">-- Pilih Shift --</option>
                            {availableShifts.map((s, idx) => (
                                <option key={idx} value={s.value}>
                                    {s.label} ({s.value})
                                </option>
                            ))}
                            {availableShifts.length === 0 && <option disabled>Tidak ada data master shift</option>}
                        </select>
                    </div>

                    <button 
                        type="submit" 
                        disabled={loading} 
                        className={`w-full text-white py-3 rounded-lg font-bold transition flex items-center justify-center gap-2 mt-4 ${editingItem ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        {loading ? 'Menyimpan...' : (
                            <>
                                {editingItem ? <Edit className="w-5 h-5"/> : <CheckCircle className="w-5 h-5"/>} 
                                {editingItem ? 'Update Jadwal' : 'Simpan Jadwal'}
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* --- LIST RIWAYAT SHIFT --- */}
            <div>
                <h3 className="font-bold text-gray-700 mb-3 px-1 flex items-center gap-2">
                    <History className="w-4 h-4"/> Riwayat Input Shift
                </h3>

                {loadingHistory ? <p className="text-center text-gray-400 text-sm">Memuat riwayat...</p> : (
                    <div className="space-y-3">
                        {shiftHistory.length === 0 && (
                            <div className="text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                <p className="text-gray-400 text-sm">Belum ada data shift yang diinput.</p>
                            </div>
                        )}

                        {shiftHistory.map((item, idx) => {
                            const canEdit = isEditable(item.waktuInput); 
                            return (
                                <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-l-4 border-l-indigo-500 relative">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 text-indigo-700 font-bold mb-1">
                                                <CalendarCheck className="w-4 h-4"/> 
                                                <span>{new Date(item.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'})}</span>
                                            </div>
                                            <p className="text-sm font-semibold text-gray-800">{item.shiftLabel}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">Jam: {item.shiftValue}</p>
                                            <p className="text-[10px] text-gray-400 mt-2">Dibuat: {item.waktuInput ? new Date(item.waktuInput).toLocaleString('id-ID') : '-'}</p>
                                        </div>

                                        {canEdit && (
                                            <div className="flex flex-col gap-2">
                                                <button 
                                                    onClick={() => handleEdit(item)}
                                                    className="bg-yellow-50 text-yellow-600 p-2 rounded-lg border border-yellow-200 hover:bg-yellow-100 transition"
                                                    title="Edit Data"
                                                >
                                                    <Edit className="w-4 h-4"/>
                                                </button>
                                                <button 
                                                    onClick={() => handleDelete(item.uuid)}
                                                    className="bg-red-50 text-red-600 p-2 rounded-lg border border-red-200 hover:bg-red-100 transition"
                                                    title="Hapus Data"
                                                >
                                                    <Trash2 className="w-4 h-4"/>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {!canEdit && (
                                        <div className="absolute top-2 right-2">
                                            <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-1 rounded border">Locked</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}


// --- SCREEN ANALISA DATA (UPDATED: REFRESH BTN & MOVED ACTION COLUMN) ---
function AnalysisScreen({ user, setView }) {
    const [dataList, setDataList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    // --- HELPER TANGGAL DEFAULT (7 HARI TERAKHIR) ---
    const getDefaultDates = () => {
        const today = new Date();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 7);
        const formatYMD = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };
        return { start: formatYMD(sevenDaysAgo), end: formatYMD(today) };
    };

    const defaultDates = getDefaultDates();
    const [startDate, setStartDate] = useState(defaultDates.start);
    const [endDate, setEndDate] = useState(defaultDates.end);
    
    // STATE FILTER (Multi Select)
    const [columnFilters, setColumnFilters] = useState({
        tglPengajuan: [], idAkun: [], nik: [], nama: [], divisi: [],
        periode: [], durasi: [], tglKonflik: [], tipeManual: [], 
        simbolMesin: [], waktuScan: [], status: []
    });

    // STATE SORTING
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [activeFilter, setActiveFilter] = useState(null);

    useEffect(() => {
        if (user.role !== 'admin' && user.role !== 'hrd') {
            alert("Akses Ditolak!");
            setView('dashboard');
        }
    }, [user, setView]);

    // Close dropdown logic
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (activeFilter && !event.target.closest('.filter-dropdown-container')) {
                setActiveFilter(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeFilter]);

    const handleAnalyze = async () => {
        if (!startDate || !endDate) {
            alert("Mohon pilih Tanggal Mulai dan Sampai.");
            return;
        }
        setLoading(true);
        setHasSearched(true);
        
        // Reset Filter & Sort saat search baru (opsional, bisa dihapus jika ingin preserve filter)
        // setColumnFilters({ ... }); 
        // setSortConfig({ key: null, direction: 'asc' });

        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'get_analysis_data',
                    startDate,
                    endDate,
                    roleRequester: user.role
                })
            });
            const result = await res.json();
            if (result.result === 'success') {
                setDataList(result.list);
            } else {
                alert(result.message);
            }
        } catch (e) {
            alert("Gagal mengambil data analisa.");
        } finally {
            setLoading(false);
        }
    };

    const handleProcessApproval = async (uuid, decision, namaKaryawan) => {
        const actionText = decision === 'approve' ? 'Menyetujui' : 'Menolak';
        if (!window.confirm(`Apakah Anda yakin ingin ${actionText} pengajuan atas nama ${namaKaryawan}?`)) return;

        setLoading(true);
        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'process_approval',
                    uuid: uuid,
                    decision: decision,
                    approverName: user.nama + ' (Via Analisa)',
                    alasan: 'Diproses melalui Menu Analisa Data'
                })
            });
            const result = await res.json();
            if (result.result === 'success') {
                alert(`Berhasil: ${result.message}`);
                handleAnalyze(); // Refresh data otomatis setelah action
            } else {
                alert(`Gagal: ${result.message}`);
            }
        } catch (e) {
            console.error(e);
            alert("Terjadi kesalahan jaringan.");
        } finally {
            setLoading(false);
        }
    };

    // --- HELPER FILTER & SORT ---
    const getUniqueValues = (field) => {
        const values = dataList.map(item => item[field]).filter(v => v !== null && v !== undefined && v !== '');
        return [...new Set(values)].sort();
    };

    const toggleFilterValue = (field, value) => {
        setColumnFilters(prev => {
            const currentValues = prev[field];
            if (currentValues.includes(value)) return { ...prev, [field]: currentValues.filter(v => v !== value) };
            else return { ...prev, [field]: [...currentValues, value] };
        });
    };

    const toggleSelectAll = (field, visibleOptions) => {
        setColumnFilters(prev => {
            const currentValues = prev[field];
            const allVisibleSelected = visibleOptions.every(val => currentValues.includes(val));
            if (allVisibleSelected) {
                return { ...prev, [field]: currentValues.filter(v => !visibleOptions.includes(v)) };
            } else {
                const newValues = [...currentValues];
                visibleOptions.forEach(v => {
                    if (!newValues.includes(v)) newValues.push(v);
                });
                return { ...prev, [field]: newValues };
            }
        });
    };

    // FILTERING
    const filteredList = dataList.filter(item => {
        return Object.keys(columnFilters).every(key => {
            const selectedValues = columnFilters[key];
            if (selectedValues.length === 0) return true;
            return selectedValues.includes(String(item[key]));
        });
    });

    // SORTING
    const sortedList = React.useMemo(() => {
        let sortableItems = [...filteredList];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let valA = a[sortConfig.key];
                let valB = b[sortConfig.key];
                if (valA === null) valA = '';
                if (valB === null) valB = '';
                const numA = parseFloat(valA);
                const numB = parseFloat(valB);
                const isNum = !isNaN(numA) && !isNaN(numB) && String(valA).trim() !== '' && String(valB).trim() !== '';

                if (isNum) {
                    return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
                } else {
                    return sortConfig.direction === 'asc' 
                        ? String(valA).localeCompare(String(valB))
                        : String(valB).localeCompare(String(valA));
                }
            });
        }
        return sortableItems;
    }, [filteredList, sortConfig]);

    const requestSort = (key, direction) => {
        setSortConfig({ key, direction });
    };

    const getStatusColor = (status) => {
        const s = String(status).toLowerCase();
        if (s.includes('approve') || s.includes('verified')) return 'bg-green-100 text-green-700 border-green-200';
        if (s.includes('reject')) return 'bg-red-100 text-red-700 border-red-200';
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    };

    // --- EXPORT FUNCTIONS (EXCEL & PDF) ---
    const handleExportExcel = () => {
        if (sortedList.length === 0) return alert("Tidak ada data untuk diexport.");
        const dataToExport = sortedList.map((item, index) => ({
            "No": index + 1,
            "Tgl Ajuan": item.tglPengajuan,
            "ID Akun": item.idAkun,
            "NIK": item.nik, 
            "Nama Karyawan": item.nama,
            "Departemen": item.divisi,
            "Periode Form": item.periode,
            "Durasi": item.durasi,
            "Tgl Konflik": item.tglKonflik,
            "Data Manual": item.tipeManual,
            "Data Mesin": item.simbolMesin,
            "Waktu Scan": item.waktuScan,
            "Status Approval": item.status 
        }));
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Analisa_Mismatch");
        const wscols = [{wch:5}, {wch:15}, {wch:12}, {wch:12}, {wch:30}, {wch:20}, {wch:25}, {wch:10}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:15}];
        ws['!cols'] = wscols;
        XLSX.writeFile(wb, `Analisa_Absensi_${startDate}_${endDate}.xlsx`);
    };

    const handleExportPDF = () => {
        if (sortedList.length === 0) return alert("Tidak ada data untuk dicetak.");
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.setFontSize(14);
        doc.text("Laporan Analisa Ketidakcocokan Absensi", 14, 15);
        doc.setFontSize(10);
        doc.text(`Periode: ${startDate} s/d ${endDate}`, 14, 21);
        doc.text(`Dicetak Oleh: ${user.nama} | Tgl: ${new Date().toLocaleDateString('id-ID')}`, 14, 26);
        const tableColumn = [
            "No", "Tgl Ajuan", "ID Akun", "NIK", "Nama", "Dept", 
            "Periode", "Dur", "Tgl Konflik", "Form", "Mesin", "Scan", "Status"
        ];
        const tableRows = [];
        sortedList.forEach((item, index) => {
            tableRows.push([
                index + 1, item.tglPengajuan, item.idAkun, item.nik, item.nama, item.divisi,
                item.periode, item.durasi, item.tglKonflik, item.tipeManual, item.simbolMesin, item.waktuScan, item.status
            ]);
        });
        autoTable(doc, {
            head: [tableColumn], body: tableRows, startY: 30, theme: 'grid',
            headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle', lineWidth: 0.1 },
            styles: { fontSize: 6.5, cellPadding: 1.5, valign: 'middle', overflow: 'linebreak', lineWidth: 0.1, lineColor: [200, 200, 200] },
            columnStyles: {
                0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 18, halign: 'center' },
                3: { cellWidth: 18, halign: 'center' }, 4: { cellWidth: 45, halign: 'left' }, 5: { cellWidth: 28, halign: 'left' },
                6: { cellWidth: 35, halign: 'center' }, 7: { cellWidth: 12, halign: 'center' }, 8: { cellWidth: 22, halign: 'center', textColor: [220, 38, 38] },
                9: { cellWidth: 18, halign: 'center' }, 10: { cellWidth: 15, halign: 'center' }, 11: { cellWidth: 18, halign: 'center' }, 12: { cellWidth: 20, halign: 'center' }
            },
            margin: { left: 10, right: 10 },
            didParseCell: function(data) {
                if (data.section === 'body' && data.column.index === 12) {
                    const text = data.cell.raw.toString().toLowerCase();
                    if (text.includes('reject')) data.cell.styles.textColor = [220, 38, 38];
                    else if (text.includes('approve')) data.cell.styles.textColor = [21, 128, 61];
                    else data.cell.styles.textColor = [202, 138, 4];
                }
            }
        });
        doc.save(`Laporan_Analisa_${startDate}_${endDate}.pdf`);
    };

    // --- FILTER HEADER COMPONENT ---
    const FilterHeader = ({ label, field, width, textColor }) => {
        const uniqueOptions = getUniqueValues(field);
        const selectedValues = columnFilters[field];
        const isOpen = activeFilter === field;
        const [searchTerm, setSearchTerm] = useState('');
        useEffect(() => { if (!isOpen) setSearchTerm(''); }, [isOpen]);
        const visibleOptions = uniqueOptions.filter(opt => String(opt).toLowerCase().includes(searchTerm.toLowerCase()));

        return (
            <th className={`p-2 border border-gray-300 align-top ${width || 'w-24'} font-normal text-gray-700 bg-gray-100`}>
                <div className="flex flex-col gap-1 filter-dropdown-container relative">
                    <div className="flex items-center justify-center gap-1">
                        <span className={`text-center font-normal ${textColor || ''}`}>{label}</span>
                        {sortConfig.key === field && (
                            <span className="text-[9px] text-blue-600 font-bold">{sortConfig.direction === 'asc' ? '↓' : '↑'}</span>
                        )}
                    </div>
                    <button onClick={() => setActiveFilter(isOpen ? null : field)} className={`flex items-center justify-between w-full text-[10px] px-2 py-1 border rounded bg-white outline-none focus:border-blue-500 font-normal ${selectedValues.length > 0 ? 'text-blue-600 border-blue-300 bg-blue-50' : 'text-gray-500 border-gray-300'}`}>
                        <span className="truncate">{selectedValues.length === 0 ? "(All)" : `${selectedValues.length} Selected`}</span>
                        <Filter className="w-3 h-3 ml-1" />
                    </button>
                    {isOpen && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-300 shadow-xl rounded-md z-50 flex flex-col max-h-80">
                            <div className="p-2 border-b border-gray-200 bg-gray-50 grid grid-cols-2 gap-2">
                                <button onClick={() => requestSort(field, 'asc')} className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] border ${sortConfig.key === field && sortConfig.direction === 'asc' ? 'bg-blue-100 text-blue-700 border-blue-300 font-bold' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}><span>A-Z</span> ↓</button>
                                <button onClick={() => requestSort(field, 'desc')} className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] border ${sortConfig.key === field && sortConfig.direction === 'desc' ? 'bg-blue-100 text-blue-700 border-blue-300 font-bold' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}><span>Z-A</span> ↑</button>
                            </div>
                            <div className="p-2 border-b border-gray-200">
                                <div className="relative">
                                    <Search className="w-3 h-3 absolute left-2 top-2 text-gray-400" />
                                    <input type="text" placeholder="Find..." className="w-full pl-7 pr-2 py-1 text-[11px] border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoFocus />
                                </div>
                            </div>
                            <div className="p-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                                <input type="checkbox" className="rounded border-gray-300 w-3.5 h-3.5 cursor-pointer" checked={visibleOptions.length > 0 && visibleOptions.every(v => selectedValues.includes(v))} onChange={() => toggleSelectAll(field, visibleOptions)} />
                                <span className="text-[10px] text-gray-600 font-normal cursor-pointer" onClick={() => toggleSelectAll(field, visibleOptions)}>Select All (Shown)</span>
                            </div>
                            <div className="overflow-y-auto p-1 flex-1 min-h-[100px]">
                                {visibleOptions.map((val, idx) => (
                                    <label key={idx} className="flex items-center gap-2 px-2 py-1.5 hover:bg-blue-50 cursor-pointer rounded">
                                        <input type="checkbox" className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5" checked={selectedValues.includes(val)} onChange={() => toggleFilterValue(field, val)}/>
                                        <span className="text-[11px] text-gray-700 font-normal truncate">{val}</span>
                                    </label>
                                ))}
                                {visibleOptions.length === 0 && <div className="p-2 text-[10px] text-gray-400 text-center font-normal">No results found</div>}
                            </div>
                        </div>
                    )}
                </div>
            </th>
        );
    };

    return (
        <div className="fixed inset-0 z-50 bg-gray-100 flex flex-col font-sans h-screen w-screen overflow-hidden text-xs">
            {/* HEADER */}
            <div className="bg-white border-b border-gray-300 px-4 py-3 shadow-sm flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="bg-rose-100 p-2 rounded-lg"><FileSpreadsheet className="w-5 h-5 text-rose-600" /></div>
                    <div><h2 className="text-lg font-normal text-slate-800">Analisa Data Absensi</h2><p className="text-xs text-slate-500 font-normal">Monitoring Ketidakcocokan Data</p></div>
                </div>
                <button onClick={() => setView('dashboard')} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-normal transition border border-gray-200">
                    <LogOut className="w-3.5 h-3.5 rotate-180" /> Tutup
                </button>
            </div>

            {/* CONTROL BAR */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap gap-3 items-end shrink-0">
                <div><label className="text-[10px] font-normal text-gray-400 uppercase block mb-1">Periode Mulai</label><input type="date" className="border border-gray-300 p-1.5 rounded text-xs font-normal shadow-sm" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                <div><label className="text-[10px] font-normal text-gray-400 uppercase block mb-1">Sampai Dengan</label><input type="date" className="border border-gray-300 p-1.5 rounded text-xs font-normal shadow-sm" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
                
                {/* Tombol Analisa Data */}
                <button onClick={handleAnalyze} disabled={loading} className="bg-slate-800 text-white px-5 py-2 rounded font-normal text-xs hover:bg-slate-700 transition flex items-center gap-2 shadow-md">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Search className="w-3.5 h-3.5"/>} {loading ? 'Proses...' : 'Analisa Data'}
                </button>

                {/* --- [BARU] TOMBOL REFRESH --- */}
                <button 
                    onClick={handleAnalyze} 
                    disabled={loading || !hasSearched} 
                    className="bg-white text-blue-600 border border-blue-200 px-3 py-2 rounded font-normal text-xs hover:bg-blue-50 transition flex items-center gap-2 shadow-sm"
                    title="Refresh Data"
                >
                    <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden w-full bg-gray-50 p-4">
                {hasSearched && (
                    <div className="flex-1 flex flex-col bg-white border border-gray-300 shadow-sm overflow-hidden">
                        {/* STATS */}
                        <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-200 flex justify-between items-center shrink-0">
                            <span className="text-xs font-normal text-gray-600">Total: {sortedList.length} Data</span>
                            <div className="flex gap-2">
                                <button onClick={handleExportExcel} className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-[10px] font-normal shadow-sm"><FileSpreadsheet className="w-3 h-3" /> Excel</button>
                                <button onClick={handleExportPDF} className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-[10px] font-normal shadow-sm"><Printer className="w-3 h-3" /> PDF</button>
                            </div>
                        </div>

                        {/* TABLE */}
                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-left border-collapse table-fixed text-xs">
                                <thead className="sticky top-0 z-10 bg-gray-100 text-gray-700 font-normal uppercase border-b-2 border-gray-300">
                                    <tr>
                                        <th className="p-2 border border-gray-300 text-center w-10 align-top font-normal">No</th>
                                        
                                        {/* --- [PINDAH] KOLOM ACTION KE SINI --- */}
                                        <th className="p-2 border border-gray-300 text-center w-20 align-top font-normal">Action</th>

                                        <FilterHeader label="Tgl Ajuan" field="tglPengajuan" width="w-24" />
                                        <FilterHeader label="ID Akun" field="idAkun" width="w-20" />
                                        <FilterHeader label="NIK" field="nik" width="w-20" /> 
                                        <FilterHeader label="Nama Karyawan" field="nama" width="w-40" />
                                        <FilterHeader label="Departemen" field="divisi" width="w-24" />
                                        <FilterHeader label="Periode" field="periode" width="w-28" />
                                        <FilterHeader label="Dur" field="durasi" width="w-12" />
                                        <FilterHeader label="Tgl Konflik" field="tglKonflik" width="w-24" textColor="text-red-600" />
                                        <FilterHeader label="Form" field="tipeManual" width="w-20" />
                                        <FilterHeader label="Mesin" field="simbolMesin" width="w-16" />
                                        <FilterHeader label="Scan" field="waktuScan" width="w-20" />
                                        <FilterHeader label="Status" field="status" width="w-24" />
                                    </tr>
                                </thead>
                                <tbody className="text-gray-800 text-xs bg-white font-normal">
                                    {sortedList.length === 0 ? (
                                        <tr><td colSpan="14" className="p-8 text-center text-gray-400 italic border border-gray-300 font-normal">Tidak ada data.</td></tr>
                                    ) : (
                                        sortedList.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-blue-50 transition-colors">
                                                <td className="p-2 border border-gray-300 text-center font-normal">{idx + 1}</td>
                                                
                                                {/* --- [PINDAH] TOMBOL ACTION DI SINI --- */}
                                                <td className="p-1 border border-gray-300 text-center font-normal">
                                                    {item.status === 'Pending' ? (
                                                        <div className="flex justify-center gap-1">
                                                            <button onClick={() => handleProcessApproval(item.uuid, 'approve', item.nama)} className="bg-green-600 hover:bg-green-700 text-white p-1 rounded shadow-sm" title="Approve"><CheckCircle className="w-3.5 h-3.5" /></button>
                                                            <button onClick={() => handleProcessApproval(item.uuid, 'reject', item.nama)} className="bg-red-600 hover:bg-red-700 text-white p-1 rounded shadow-sm" title="Reject"><X className="w-3.5 h-3.5" /></button>
                                                        </div>
                                                    ) : <span className="text-gray-300">-</span>}
                                                </td>

                                                <td className="p-2 border border-gray-300 text-center font-normal">{item.tglPengajuan}</td>
                                                <td className="p-2 border border-gray-300 font-mono text-gray-600 font-normal">{item.idAkun}</td>
                                                <td className="p-2 border border-gray-300 font-mono text-gray-600 font-normal">{item.nik}</td>
                                                <td className="p-2 border border-gray-300 truncate font-normal" title={item.nama}>{item.nama}</td>
                                                <td className="p-2 border border-gray-300 truncate font-normal">{item.divisi}</td>
                                                <td className="p-2 border border-gray-300 text-center font-normal">{item.periode}</td>
                                                <td className="p-2 border border-gray-300 text-center font-normal">{item.durasi}</td>
                                                <td className="p-2 border border-gray-300 text-center font-normal text-red-600">{item.tglKonflik}</td>
                                                <td className="p-2 border border-gray-300 text-center font-normal">{item.tipeManual}</td>
                                                <td className="p-2 border border-gray-300 text-center font-normal">{item.simbolMesin}</td>
                                                <td className="p-2 border border-gray-300 text-center font-mono font-normal">{item.waktuScan}</td>
                                                <td className="p-2 border border-gray-300 text-center font-normal">
                                                    <span className={`px-1.5 py-0.5 rounded border ${getStatusColor(item.status)}`}>{item.status}</span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


// --- DASHBOARD SCREEN (FIX: UI POP-UP DITAMBAHKAN) ---
function DashboardScreen({ user, setView, handleLogout }) {
  // 1. STATE POP-UP
  const [announcement, setAnnouncement] = useState(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const menuItems = [
    { id: 'absen', label: 'Absen', icon: Camera, color: 'bg-blue-600', desc: 'Masuk/Pulang' },
    { id: 'history', label: 'Riwayat', icon: History, color: 'bg-emerald-600', desc: 'Cek Aktivitas' },
    { id: 'approval', label: 'Approval', icon: CheckSquare, color: 'bg-indigo-600', desc: 'Acc Bawahan', hidden: !['admin', 'hrd', 'manager'].includes(user.role?.toLowerCase()) },
    { id: 'users', label: 'Karyawan', icon: Users, color: 'bg-violet-600', desc: 'Data Pegawai', hidden: user.role !== 'admin' && user.role !== 'hrd' },
    { id: 'master', label: 'Master', icon: Database, color: 'bg-slate-600', desc: 'Setting Data', hidden: user.role !== 'admin' },
    { id: 'remarks', label: 'Laporan', icon: MessageSquare, color: 'bg-orange-600', desc: 'Koreksi/Isu' },
    { id: 'schedule', label: 'Jadwal', icon: CalendarDays, color: 'bg-cyan-600', desc: 'Shift Kerja' },
    { id: 'announcement', label: 'Info HRD', icon: Megaphone, color: 'bg-rose-600', desc: 'Buat Info', hidden: user.role !== 'admin' && user.role !== 'hrd' },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
      {/* HEADER DASHBOARD */}
      <div className="bg-white p-5 pb-8 rounded-b-[30px] shadow-sm relative z-10">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-xl font-extrabold text-slate-800">Halo, {user.nama.split(' ')[0]} 👋</h1>
            <p className="text-xs text-slate-500 font-medium">{user.divisi} • {user.lokasi || 'Indonesia'}</p>
          </div>
          <button onClick={handleLogout} className="p-2 bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all shadow-sm border border-slate-100">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* STATS CARD */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-4 text-white shadow-lg shadow-blue-200">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-medium opacity-80 uppercase tracking-wider">Sisa Cuti Tahunan</p>
              <h2 className="text-3xl font-bold mt-1">{user.sisaCuti} <span className="text-sm font-normal opacity-80">Hari</span></h2>
            </div>
            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
              <Calendar className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* MENU GRID */}
      <div className="flex-1 overflow-y-auto p-5 -mt-4 z-0 pt-8">
        <h3 className="text-sm font-bold text-slate-700 mb-3 ml-1">Menu Utama</h3>
        <div className="grid grid-cols-2 gap-3">
          {menuItems.filter(i => !i.hidden).map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md hover:border-blue-100 transition-all flex flex-col items-center justify-center gap-3 group active:scale-95"
            >
              <div className={`p-3 rounded-xl ${item.color} text-white shadow-md group-hover:scale-110 transition-transform`}>
                <item.icon className="w-6 h-6" />
              </div>
              <div className="text-center">
                <span className="block text-sm font-bold text-slate-700">{item.label}</span>
                <span className="block text-[10px] text-slate-400 font-medium">{item.desc}</span>
              </div>
            </button>
          ))}
        </div>
        
        <div className="mt-6 text-center">
            <p className="text-[10px] text-slate-300 font-bold">E-ABSENSI APP V1.0</p>
        </div>
      </div>

      {/* --- INI BAGIAN YANG SEBELUMNYA HILANG: UI POP UP MODAL --- */}
      {showAnnouncement && announcement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 transform transition-all">
            
            {/* Header dengan Icon Megaphone */}
            <div className="bg-gradient-to-br from-rose-500 to-orange-500 p-6 text-center relative">
               <div className="bg-white/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto backdrop-blur-md shadow-inner mb-2">
                  <Megaphone className="w-8 h-8 text-white animate-bounce-slow" />
               </div>
               <button 
                  onClick={() => setShowAnnouncement(false)} 
                  className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 p-1.5 rounded-full text-white transition-colors"
               >
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            {/* Isi Pengumuman */}
            <div className="p-6 text-center">
               <h3 className="text-lg font-extrabold text-slate-800 mb-1">Informasi HRD</h3>
               <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-4">
                  {announcement.waktu}
               </p>
               
               <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100 max-h-60 overflow-y-auto custom-scrollbar">
                  <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-line text-left">
                    {announcement.isi}
                  </p>
               </div>
            </div>

            {/* Tombol Tutup */}
            <div className="p-4 pt-0">
               <button 
                  onClick={() => setShowAnnouncement(false)}
                  className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
               >
                  Saya Mengerti
               </button>
            </div>
          </div>
        </div>
      )}
      {/* ---------------------------------------------------------- */}

    </div>
  );
}

// --- 2. REMARK SCREEN (UPDATED: DATE FORMAT DD-MM-YYYY) ---
function RemarkScreen({ user, setView }) {
    const userRole = user.role ? String(user.role).toLowerCase() : '';
    const isHRDOrAdmin = ['admin', 'hrd'].includes(userRole);

    const [tglKoreksi, setTglKoreksi] = useState(''); 
    const [kategori, setKategori] = useState('Koreksi Absensi');
    const [pesan, setPesan] = useState('');
    const [file, setFile] = useState(null);
    const [fileName, setFileName] = useState('');
    const [loading, setLoading] = useState(false);
    const [remarks, setRemarks] = useState([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // STATUS PENGAMBILAN DATA
    // Sebelum ini, gagal-ambil dan benar-benar-kosong tampil PERSIS SAMA
    // ("Belum ada data laporan"), sehingga request yang gagal terlihat
    // seperti sheet yang kosong. Tiga state ini memisahkan keduanya.
    const [remarksLoading, setRemarksLoading] = useState(true);
    const [remarksError, setRemarksError] = useState('');
    const [remarksTotal, setRemarksTotal] = useState(null); // total di server (bisa > yang dimuat)
    const [muatSemua, setMuatSemua] = useState(false);

    // VIEW MODE STATE
    const [viewMode, setViewMode] = useState('list'); 

    // TABLE FILTER STATE
    const [reportColumnFilters, setReportColumnFilters] = useState({});
    const [reportSortConfig, setReportSortConfig] = useState({ key: null, direction: 'asc' });
    const [activeReportFilter, setActiveReportFilter] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10); // Default 10 baris

    // --- HELPER FORMAT TANGGAL (DD-MM-YYYY) ---
    const formatDateDisplay = (value) => {
        if (!value || value === '-' || value === '') return '-';
        const strVal = String(value);

        // 1. Jika format YYYY-MM-DD (dari Input Date/Backend TglKoreksi) -> Ubah ke DD-MM-YYYY
        if (strVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = strVal.split('-');
            return `${d}-${m}-${y}`;
        }
        
        // 2. Jika format dd/mm/yyyy (dari Timestamp Backend) -> Ubah / jadi -
        if (strVal.includes('/')) {
            return strVal.replace(/\//g, '-');
        }

        return strVal;
    };

    // Close dropdown logic
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (activeReportFilter && !event.target.closest('.report-filter-container')) {
                setActiveReportFilter(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeReportFilter]);

    useEffect(() => {
        let dibatalkan = false;

        const fetchRemarks = async () => {
            setRemarksLoading(true);
            setRemarksError('');
            try {
                const res = await fetchApi(SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'get_remarks',
                        userId: user.id,
                        role: userRole,
                        // Backend membatasi jumlah baris yang dikirim (default 200 terbaru).
                        // Seluruh isi sheet Remarks sekaligus berukuran ~300-400 KB dan
                        // itulah request yang paling sering dibalas HTML oleh Google.
                        muatSemua: muatSemua
                    })
                });
                const data = await res.json();
                if (dibatalkan) return;

                if (data.result === 'success') {
                    setRemarks(Array.isArray(data.list) ? data.list : []);
                    setRemarksTotal(typeof data.total === 'number' ? data.total : null);
                    // Sheet tidak ditemukan tetap dibalas 'success' oleh backend lama.
                    // Kalau backend baru mengirim sheetDitemukan:false, tampilkan apa adanya.
                    if (data.sheetDitemukan === false) {
                        setRemarksError('Sheet "Remarks" tidak ditemukan di spreadsheet backend. Periksa nama tab-nya.');
                    }
                } else {
                    // INI yang dulu hilang: pesan error dari fetchApi
                    // (RESPONS_BUKAN_JSON, FORBIDDEN, dsb) dibuang begitu saja.
                    setRemarksError(data.message || 'Gagal mengambil data laporan dari server.');
                }
            } catch (e) {
                if (dibatalkan) return;
                console.error('Gagal load remark:', e);
                setRemarksError('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
            } finally {
                if (!dibatalkan) setRemarksLoading(false);
            }
        };
        fetchRemarks();

        return () => { dibatalkan = true; };
    }, [user.id, userRole, refreshTrigger, muatSemua]);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            if(selectedFile.size > 5 * 1024 * 1024) { alert("Ukuran file maksimal 5MB"); return; }
            setFileName(selectedFile.name);
            const reader = new FileReader();
            reader.onloadend = () => { setFile(reader.result); };
            reader.readAsDataURL(selectedFile);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'send_remark', 
                    userId: user.id, 
                    nama: user.nama, 
                    divisi: user.divisi,
                    tglKoreksi, 
                    kategori, 
                    pesan, 
                    file
                })
            }).then(r => r.json());
            if (res.result === 'success') {
                alert('Laporan berhasil dikirim ke HRD!');
                setPesan(''); setTglKoreksi(''); setFile(null); setFileName('');
                setRefreshTrigger(prev => prev + 1); 
            } else {
                alert('Gagal mengirim laporan: ' + res.message);
            }
        } catch (err) { alert('Gagal koneksi.'); } finally { setLoading(false); }
    };

    const handleMarkDone = async (uuid) => {
        const responseText = window.prompt("Masukkan tanggapan/respon untuk user (Wajib diisi):", "Sudah diproses.");
        if (responseText === null || responseText.trim() === "") return; 

        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'update_remark_status', uuid, response: responseText })
            }).then(r => r.json());
            if (res.result === 'success') {
                alert("Status diperbarui & Respon terkirim!");
                setRefreshTrigger(prev => prev + 1);
            } else alert(res.message);
        } catch (e) { alert("Gagal update"); }
    };

    // --- FILTER LOGIC ---
    const getReportUniqueValues = (field) => {
        const values = remarks.map(item => item[field]).filter(v => v !== null && v !== undefined && v !== '');
        return [...new Set(values)].sort();
    };

    const toggleReportFilterValue = (field, value) => {
        setReportColumnFilters(prev => {
            const currentValues = prev[field] || [];
            if (currentValues.includes(value)) return { ...prev, [field]: currentValues.filter(v => v !== value) };
            else return { ...prev, [field]: [...currentValues, value] };
        });
    };

    const toggleReportSelectAll = (field, visibleOptions) => {
        setReportColumnFilters(prev => {
            const currentValues = prev[field] || [];
            const allVisibleSelected = visibleOptions.every(val => currentValues.includes(val));
            if (allVisibleSelected) return { ...prev, [field]: currentValues.filter(v => !visibleOptions.includes(v)) };
            else {
                const newValues = [...currentValues];
                visibleOptions.forEach(v => { if (!newValues.includes(v)) newValues.push(v); });
                return { ...prev, [field]: newValues };
            }
        });
    };

    const filteredRemarksTable = remarks.filter(item => {
        return Object.keys(reportColumnFilters).every(key => {
            const selectedValues = reportColumnFilters[key];
            if (!selectedValues || selectedValues.length === 0) return true;
            return selectedValues.includes(String(item[key]));
        });
    });

    const sortedRemarksTable = React.useMemo(() => {
        let sortableItems = [...filteredRemarksTable];
        if (reportSortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let valA = a[reportSortConfig.key] || '';
                let valB = b[reportSortConfig.key] || '';
                return reportSortConfig.direction === 'asc' 
                    ? String(valA).localeCompare(String(valB)) 
                    : String(valB).localeCompare(String(valA));
            });
        }
        return sortableItems;
    }, [filteredRemarksTable, reportSortConfig]);

    const requestReportSort = (key, direction) => {
        setReportSortConfig({ key, direction });
    };

    // Show Columns Logic
    const showResponseColumns = sortedRemarksTable.some(item => item.status === 'Done');

    // --- EXPORT FUNCTION ---
    const generateExcel = () => {
        let tableHead = ["No", "Waktu Lapor", "Tgl Koreksi", "Nama", "Divisi", "Jenis", "Keterangan", "Status"];
        
        if (showResponseColumns) {
            tableHead.push("Respon HRD", "Waktu Respon");
        }

        const tableBody = sortedRemarksTable.map((item, index) => {
            let row = [
                index + 1, 
                formatDateDisplay(item.waktu),       // [UPDATE] Format DD-MM-YYYY
                formatDateDisplay(item.tglKoreksi),  // [UPDATE] Format DD-MM-YYYY
                item.nama, item.divisi, item.kategori, item.pesan, item.status
            ];
            if (showResponseColumns) {
                row.push(item.respon, formatDateDisplay(item.waktuRespon)); // [UPDATE] Format DD-MM-YYYY
            }
            return row;
        });

        const worksheet = XLSX.utils.aoa_to_sheet([tableHead, ...tableBody]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan_Masuk");
        XLSX.writeFile(workbook, `Laporan_Remarks_${new Date().getTime()}.xlsx`);
    };

    const generatePDF = () => {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        doc.setFontSize(10);
        doc.text("Laporan Respon / Masukan Karyawan", 14, 15);
        doc.setFontSize(8);
        doc.text(`Total Data: ${sortedRemarksTable.length}`, 14, 20);

        let tableColumn = ["No", "Waktu", "Tgl Koreksi", "Nama", "Divisi", "Jenis", "Keterangan", "Status"];
        
        if (showResponseColumns) {
            tableColumn.push("Respon");
        }

        const tableRows = sortedRemarksTable.map((item, index) => {
            let row = [
                index + 1, 
                formatDateDisplay(item.waktu),       // [UPDATE] Format DD-MM-YYYY
                formatDateDisplay(item.tglKoreksi),  // [UPDATE] Format DD-MM-YYYY
                item.nama, item.divisi, item.kategori, item.pesan, item.status
            ];
            if (showResponseColumns) {
                row.push(item.respon);
            }
            return row;
        });

        autoTable(doc, {
            head: [tableColumn], body: tableRows, startY: 25, theme: 'grid',
            styles: { fontSize: 7, cellPadding: 1, valign: 'middle' },
            headStyles: { fillColor: [50, 50, 50] }
        });
        doc.save(`Laporan_Remarks_${new Date().getTime()}.pdf`);
    };

    // --- FILTER HEADER COMPONENT ---
    const ReportFilterHeader = ({ label, field, width }) => {
        const uniqueOptions = getReportUniqueValues(field);
        const selectedValues = reportColumnFilters[field] || [];
        const isOpen = activeReportFilter === field;
        const [searchTerm, setSearchTerm] = useState('');
        const visibleOptions = uniqueOptions.filter(opt => String(opt).toLowerCase().includes(searchTerm.toLowerCase()));

        return (
            <th className={`p-0 border border-gray-300 bg-gray-100 align-top ${width || 'w-auto'} relative`}>
                <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between p-2 pb-1">
                        <span className="text-[10px] font-bold text-gray-700 uppercase">{label}</span>
                        {reportSortConfig.key === field && (
                            <span className="text-[9px] text-gray-800 font-bold ml-1">{reportSortConfig.direction === 'asc' ? '↓' : '↑'}</span>
                        )}
                    </div>
                    <div className="px-2 pb-2 report-filter-container">
                        <button onClick={(e) => { e.stopPropagation(); setActiveReportFilter(isOpen ? null : field); }} 
                            className={`flex items-center justify-between w-full text-[9px] px-2 py-1 border rounded bg-white shadow-sm transition-all ${selectedValues.length > 0 ? 'text-blue-700 border-blue-400 bg-blue-50' : 'text-gray-600 border-gray-300 hover:border-gray-400'}`}>
                            <span className="truncate font-medium">{selectedValues.length === 0 ? "(All)" : `${selectedValues.length} Selected`}</span>
                            <Filter className="w-2.5 h-2.5 ml-1 opacity-70" />
                        </button>
                        {isOpen && (
                            <div className="absolute top-[95%] left-0 mt-0 w-48 bg-white border border-gray-400 shadow-xl z-[100] flex flex-col max-h-64 rounded-sm">
                                <div className="p-1.5 border-b bg-gray-50 flex gap-1">
                                    <button onClick={() => requestReportSort(field, 'asc')} className="flex-1 text-[9px] font-bold bg-white border rounded p-1 hover:bg-gray-200">A-Z</button>
                                    <button onClick={() => requestReportSort(field, 'desc')} className="flex-1 text-[9px] font-bold bg-white border rounded p-1 hover:bg-gray-200">Z-A</button>
                                </div>
                                <div className="p-1.5 border-b relative">
                                    <input type="text" placeholder="Cari..." className="w-full text-[9px] border p-1 rounded bg-white outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoFocus />
                                </div>
                                <div className="px-2 py-1.5 bg-gray-50 flex items-center gap-2 border-b hover:bg-gray-100 cursor-pointer" onClick={() => toggleReportSelectAll(field, visibleOptions)}>
                                    <input type="checkbox" readOnly checked={visibleOptions.length > 0 && visibleOptions.every(v => selectedValues.includes(v))} className="w-3 h-3 text-blue-600 rounded border-gray-300"/>
                                    <span className="text-[9px] font-bold text-gray-700">Select All</span>
                                </div>
                                <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                                    {visibleOptions.map((val, idx) => (
                                        <label key={idx} className="flex items-center gap-2 px-1.5 py-1 hover:bg-blue-50 cursor-pointer rounded transition-colors">
                                            <input type="checkbox" className="w-3 h-3 text-blue-600 rounded border-gray-300 focus:ring-blue-500" checked={selectedValues.includes(val)} onChange={() => toggleReportFilterValue(field, val)}/>
                                            <span className="text-[9px] text-gray-700 truncate font-medium">{val}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </th>
        );
    };

    // LOGIC SWITCH STYLE
    const isTableMode = viewMode === 'table' && isHRDOrAdmin;
    const containerClass = isTableMode
        ? "fixed inset-0 z-[50] bg-white flex flex-col"
        : "p-4 h-full overflow-y-auto pb-20 bg-gray-50";

    // --- PANEL STATUS PENGAMBILAN DATA ---
    // Dipakai di kedua mode (list & tabel) supaya sumber kegagalan yang sama
    // tidak lagi muncul sebagai dua "layar kosong" yang berbeda.
    const StatusPanel = () => {
        if (remarksLoading) {
            return (
                <div className="flex items-center justify-center gap-2 py-6 text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs font-medium">Memuat data laporan...</span>
                </div>
            );
        }
        if (remarksError) {
            return (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 my-3">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                        <div className="flex-1">
                            <p className="text-xs font-bold text-red-700 mb-1">Data laporan gagal dimuat</p>
                            <p className="text-[11px] text-red-600 leading-relaxed">{remarksError}</p>
                            <p className="text-[10px] text-red-500 mt-1 italic">
                                Ini BUKAN berarti tidak ada laporan — data di server tidak berhasil diambil.
                            </p>
                            <button
                                onClick={() => setRefreshTrigger(t => t + 1)}
                                className="mt-2 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition"
                            >
                                <RefreshCcw className="w-3 h-3" /> Coba Lagi
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        // Sukses, tapi server masih menyimpan lebih banyak daripada yang dimuat
        if (!muatSemua && remarksTotal !== null && remarksTotal > remarks.length) {
            return (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 my-3 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-blue-800 font-medium">
                        Menampilkan {remarks.length} laporan terbaru dari total {remarksTotal}.
                    </span>
                    <button
                        onClick={() => setMuatSemua(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0 transition"
                    >
                        Muat Semua
                    </button>
                </div>
            );
        }
        return null;
    };

    return (
        <div className={containerClass}>
            {/* HEADER AREA */}
            <div className={`flex items-center justify-between mb-4 ${isTableMode ? 'px-4 py-3 bg-white border-b shadow-sm' : ''}`}>
                <div>
                    <h2 className="text-xl font-bold text-gray-800">{isHRDOrAdmin ? 'Respon Laporan Masuk' : 'Lapor & Riwayat'}</h2>
                    {isHRDOrAdmin && !isTableMode && <p className="text-[10px] text-gray-500">Kelola dan respon laporan karyawan</p>}
                </div>
                <div className="flex gap-2">
                    {isHRDOrAdmin && (
                        <button 
                            onClick={() => setViewMode(viewMode === 'list' ? 'table' : 'list')}
                            className={`${isTableMode ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'} px-3 py-2 rounded-lg text-xs font-bold transition shadow-sm flex items-center gap-2`}
                        >
                            {viewMode === 'list' ? <FileSpreadsheet className="w-4 h-4 text-green-600"/> : <MessageSquare className="w-4 h-4 text-white"/>}
                            {viewMode === 'list' ? 'View Tabel' : 'Kembali ke List'}
                        </button>
                    )}
                    {!isTableMode && <BackButton onClick={() => setView('dashboard')} />}
                    {isTableMode && (
                         <button onClick={() => setViewMode('list')} className="p-2 hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-lg transition" title="Exit Full Screen">
                            <X className="w-5 h-5" />
                         </button>
                    )}
                </div>
            </div>

            {/* FORM BUAT LAPORAN (LIST MODE ONLY) */}
            {(!isHRDOrAdmin || viewMode === 'list') && !isHRDOrAdmin && (
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 mb-6">
                    <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Edit className="w-4 h-4"/> Buat Laporan</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">Tanggal Koreksi *</label>
                            <div className="relative">
                                <CalendarDays className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                                {/* State tglKoreksi untuk INPUT tetap YYYY-MM-DD agar valid di HTML input type="date" */}
                                <input type="date" required className="w-full p-2.5 pl-10 border rounded-lg text-sm bg-white" value={tglKoreksi} onChange={e => setTglKoreksi(e.target.value)} />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">Jenis Koreksi/Laporan *</label>
                            <select className="w-full p-2.5 border rounded-lg text-sm bg-white" value={kategori} onChange={e => setKategori(e.target.value)}>
                                <option>Koreksi Profil (Nama/Divisi/Lainnya)</option>
                                <option>Koreksi Absensi (Ijin, Lupa Absen Masuk/Pulang)</option>
                                <option>Koreksi Cuti / Sisa Cuti</option>
                                <option>Koreksi Shift / Jam Kerja</option>
                                <option>Koreksi Lainnya</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">Keterangan Detail *</label>
                            <textarea required rows="3" className="w-full p-2.5 border rounded-lg text-sm" placeholder="Jelaskan detail..." value={pesan} onChange={e => setPesan(e.target.value)} ></textarea>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 border-dashed rounded-lg p-4 text-center">
                            <input type="file" id="fileInput" className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={handleFileChange}/>
                            <label htmlFor="fileInput" className="cursor-pointer flex flex-col items-center gap-2">
                                <Upload className="w-6 h-6 text-blue-500" />
                                <span className="text-xs font-bold text-blue-600">{fileName ? fileName : "Upload Lampiran"}</span>
                            </label>
                        </div>
                        <button type="submit" disabled={loading} className="w-full bg-purple-600 text-white py-3 rounded-lg font-bold hover:bg-purple-700 flex items-center justify-center gap-2">
                            {loading ? 'Mengirim...' : <><MessageSquare className="w-4 h-4"/> Kirim Laporan</>}
                        </button>
                    </form>
                </div>
            )}

            {/* --- MODE TABEL (FULL SCREEN WEB REPORT) --- */}
            {isHRDOrAdmin && viewMode === 'table' ? (
                <div className="flex-1 flex flex-col overflow-hidden bg-white">
                    {/* Status panel juga muncul di mode tabel — dulu mode ini
                        tidak punya indikator apa pun saat request gagal. */}
                    {(remarksLoading || remarksError || (!muatSemua && remarksTotal !== null && remarksTotal > remarks.length)) && (
                        <div className="px-4 border-b border-gray-200"><StatusPanel /></div>
                    )}
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-600">Total: {sortedRemarksTable.length} Data</span>
                        <div className="flex gap-2">
                            <button onClick={generateExcel} className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm transition"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
                            <button onClick={generatePDF} className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm transition"><Printer className="w-3.5 h-3.5" /> PDF</button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse table-fixed text-xs">
                            <thead className="sticky top-0 z-10 bg-gray-100 text-gray-700 font-normal uppercase border-b-2 border-gray-300 shadow-sm">
                                <tr>
                                    <th className="p-2 border border-gray-300 text-center w-10 align-top font-bold bg-gray-100">No</th>
                                    <th className="p-2 border border-gray-300 text-center w-20 align-top font-bold bg-gray-100">Action</th>
                                    
                                    <ReportFilterHeader label="Waktu Lapor" field="waktu" width="w-24" />
                                    <ReportFilterHeader label="Tgl Koreksi" field="tglKoreksi" width="w-24" />
                                    <ReportFilterHeader label="Nama" field="nama" width="w-32" />
                                    <ReportFilterHeader label="Divisi" field="divisi" width="w-24" />
                                    <ReportFilterHeader label="Jenis" field="kategori" width="w-28" />
                                    <ReportFilterHeader label="Keterangan" field="pesan" width="w-48" />
                                    <th className="p-2 border border-gray-300 text-center w-16 align-top font-bold bg-gray-100">Lampiran</th>
                                    <ReportFilterHeader label="Status" field="status" width="w-20" />

                                    {/* [DYNAMIC] Header Respon: Hanya muncul jika ada Status DONE */}
                                    {showResponseColumns && (
                                        <>
                                            <ReportFilterHeader label="Respon HRD" field="respon" width="w-32" />
                                            <ReportFilterHeader label="Waktu Respon" field="waktuRespon" width="w-24" />
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="text-gray-800 text-xs bg-white font-normal divide-y divide-gray-200">
                                {sortedRemarksTable.length === 0 ? (
                                    <tr><td colSpan={showResponseColumns ? "12" : "10"} className="p-8 text-center text-gray-400 italic font-normal bg-gray-50">
                                        {remarksLoading ? 'Memuat data laporan...'
                                            : remarksError ? 'Data gagal dimuat — lihat pesan di atas.'
                                            : remarks.length > 0 ? 'Tidak ada baris yang cocok dengan filter.'
                                            : 'Tidak ada data laporan.'}
                                    </td></tr>
                                ) : (
                                    sortedRemarksTable.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-blue-50 transition-colors group">
                                            <td className="p-2 border border-gray-200 text-center font-medium bg-gray-50/50">{idx + 1}</td>
                                            
                                            <td className="p-2 border border-gray-200 text-center">
                                                {item.status === 'Open' ? (
                                                    <button onClick={() => handleMarkDone(item.uuid)} className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-[10px] font-bold shadow-sm flex items-center justify-center gap-1 w-full transition active:scale-95">
                                                        <Check className="w-3 h-3"/> Done
                                                    </button>
                                                ) : <span className="text-green-600 font-bold">✔</span>}
                                            </td>

                                            <td className="p-2 border border-gray-200 text-center font-mono text-[10px] text-gray-500">{formatDateDisplay(item.waktu)}</td>
                                            <td className="p-2 border border-gray-200 text-center text-blue-600 font-medium">{formatDateDisplay(item.tglKoreksi)}</td>
                                            <td className="p-2 border border-gray-200 font-bold text-gray-700">{item.nama}</td>
                                            <td className="p-2 border border-gray-200 text-gray-600">{item.divisi}</td>
                                            <td className="p-2 border border-gray-200 text-purple-700 font-medium">{item.kategori}</td>
                                            <td className="p-2 border border-gray-200 italic text-gray-600 break-words">{item.pesan}</td>
                                            <td className="p-2 border border-gray-200 text-center">
                                                {item.lampiran && item.lampiran !== '-' ? (
                                                    <a href={item.lampiran} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center p-1.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition" title="Lihat Lampiran">
                                                        <FileIcon className="w-3.5 h-3.5"/>
                                                    </a>
                                                ) : <span className="text-gray-300">-</span>}
                                            </td>
                                            <td className="p-2 border border-gray-200 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${item.status === 'Done' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`}>
                                                    {item.status}
                                                </span>
                                            </td>

                                            {/* [DYNAMIC] Kolom Respon: Hanya muncul jika ada Status DONE */}
                                            {showResponseColumns && (
                                                <>
                                                    <td className="p-2 border border-gray-200 text-blue-800 font-medium">{item.respon}</td>
                                                    <td className="p-2 border border-gray-200 text-center text-[10px] text-gray-500">{formatDateDisplay(item.waktuRespon)}</td>
                                                </>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                /* --- MODE LIST CARD (NORMAL VIEW) --- */
                <div className="space-y-3">
                    <StatusPanel />

                    {/* Pesan kosong hanya boleh muncul kalau pengambilan data
                        benar-benar BERHASIL dan hasilnya memang nol baris. */}
                    {!remarksLoading && !remarksError && filteredRemarksTable.length === 0 && (
                        <p className="text-gray-400 text-sm text-center py-4">
                            {remarks.length > 0 ? 'Tidak ada laporan yang cocok dengan filter.' : 'Belum ada data laporan.'}
                        </p>
                    )}

                    {filteredRemarksTable.map((item, idx) => (
                        <div key={idx} className={`bg-white p-4 rounded-xl shadow-sm border-l-4 relative ${item.status === 'Done' ? 'border-l-green-500' : 'border-l-yellow-500'}`}>
                            <div className="flex justify-between items-start mb-1">
                                <div>
                                    <h4 className="font-bold text-gray-800 text-sm">{item.nama} <span className="font-normal text-xs text-gray-500">({item.divisi})</span></h4>
                                    <p className="text-[10px] text-gray-400">{formatDateDisplay(item.waktu)}</p>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${item.status === 'Done' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`}>
                                    {item.status}
                                </span>
                            </div>
                            
                            <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 mt-2 mb-2 border border-gray-100">
                                {item.tglKoreksi && (
                                    <div className="mb-1 pb-1 border-b border-gray-200 flex items-center gap-1.5">
                                        <CalendarDays className="w-3 h-3 text-blue-500"/>
                                        <span className="font-bold text-gray-600"></span>
                                        {/* [UPDATE] Format DD-MM-YYYY di sini */}
                                        <span className="font-mono text-blue-700">{formatDateDisplay(item.tglKoreksi)}</span>
                                    </div>
                                )}
                                <p className="font-bold text-purple-700 mb-1">{item.kategori}</p>
                                <p className="italic">"{item.pesan}"</p>
                            </div>

                            {/* [UPDATE] KARTU RESPON HANYA MUNCUL JIKA STATUS DONE */}
                            {item.status === 'Done' && item.respon && item.respon !== '' && (
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mt-3 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2 opacity-10"><Info className="w-12 h-12 text-blue-500" /></div>
                                    <div className="flex justify-between items-center relative z-10 mb-2">
                                        <div className="flex items-center gap-1.5 font-bold text-blue-800 text-xs">
                                            <div className="bg-blue-200 p-1 rounded-full"><Info className="w-3 h-3 text-blue-700"/></div>
                                            <span>Tanggapan HRD:</span>
                                        </div>
                                        {item.waktuRespon && item.waktuRespon !== '-' && (
                                            <div className="flex items-center gap-1 bg-white/60 px-2 py-1 rounded-full border border-blue-100 shadow-sm">
                                                <Clock className="w-3 h-3 text-blue-400" />
                                                {/* [UPDATE] Format DD-MM-YYYY di sini */}
                                                <span className="text-[10px] text-blue-600 font-bold font-mono">{formatDateDisplay(item.waktuRespon)}</span>
                                            </div>
                                        )}
                                    </div>
                                    <p className="italic text-xs text-blue-900 mt-1 leading-relaxed pl-1 border-l-2 border-blue-300">"{item.respon}"</p>
                                </div>
                            )}

                            <div className="flex justify-between items-center mt-2">
                                {item.lampiran && item.lampiran !== '-' ? (
                                    <a href={item.lampiran} target="_blank" rel="noreferrer" className="text-xs text-blue-600 font-bold underline flex items-center gap-1"><FileIcon className="w-3 h-3"/> Lampiran </a>
                                ) : <span className="text-[10px] text-gray-400">Tidak ada lampiran</span>}

                                {isHRDOrAdmin && item.status === 'Open' && (
                                    <button onClick={() => handleMarkDone(item.uuid)} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-green-700">
                                        <Check className="w-3 h-3"/> Mark Done & Reply
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// --- KOMPONEN KALENDER RANGE PICKER (UPDATED: HIGHLIGHT TODAY) ---
const DateRangeModal = ({ isOpen, onClose, onApply, initialStart, initialEnd }) => {
  const [viewDate, setViewDate] = useState(new Date());
  const [tempStart, setTempStart] = useState(initialStart);
  const [tempEnd, setTempEnd] = useState(initialEnd);

  // Helper Lokal
  const formatIndoLocal = (d) => { 
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } 
    catch (e) { return d; } 
  };

  useEffect(() => {
    if (isOpen) {
      // Saat dibuka, pastikan viewDate mengarah ke Bulan Hari Ini atau Tanggal Start yang sudah dipilih
      const d = initialStart ? new Date(initialStart) : new Date();
      setViewDate(d);
      setTempStart(initialStart);
      setTempEnd(initialEnd);
    }
  }, [isOpen, initialStart, initialEnd]);

  if (!isOpen) return null;

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay(); // 0 = Sunday

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  // --- LOGIKA HARI INI ---
  const today = new Date();
  const isToday = (day) => {
    return day === today.getDate() && 
           month === today.getMonth() && 
           year === today.getFullYear();
  };

  const handleDayClick = (day) => {
    const selectedStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(selectedStr);
      setTempEnd(null);
    } else {
      if (new Date(selectedStr) < new Date(tempStart)) {
        setTempStart(selectedStr);
      } else {
        setTempEnd(selectedStr);
      }
    }
  };

  const handlePrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const getDayClass = (day) => {
    const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const todayStatus = isToday(day);

    // 1. Jika Tanggal Start / End (Selected)
    if (currentStr === tempStart || currentStr === tempEnd) {
        return "bg-blue-600 text-white font-bold rounded-full shadow-md";
    }
    
    // 2. Jika Dalam Range
    if (tempStart && tempEnd && new Date(currentStr) > new Date(tempStart) && new Date(currentStr) < new Date(tempEnd)) {
        return "bg-blue-100 text-blue-800 rounded-none font-medium";
    }

    // 3. Jika HARI INI (Tapi tidak sedang dipilih)
    if (todayStatus) {
        return "border-2 border-blue-600 text-blue-700 font-extrabold rounded-full";
    }

    // 4. Tanggal Biasa
    return "text-slate-700 hover:bg-gray-100 rounded-full font-medium";
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-200">
        
        {/* Header Kalender */}
        <div className="bg-blue-600 p-4 text-white">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5"/> Pilih Tanggal
            </h3>
            <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition"><X className="w-5 h-5"/></button>
          </div>
          <div className="flex justify-between items-center bg-blue-700/50 p-1 rounded-lg">
            <button onClick={handlePrevMonth} className="p-1 hover:bg-white/20 rounded"><ChevronDown className="w-5 h-5 rotate-90"/></button>
            <span className="font-bold text-sm tracking-wide">{monthNames[month]} {year}</span>
            <button onClick={handleNextMonth} className="p-1 hover:bg-white/20 rounded"><ChevronDown className="w-5 h-5 -rotate-90"/></button>
          </div>
        </div>

        {/* Grid Kalender */}
        <div className="p-4">
          <div className="grid grid-cols-7 mb-2 text-center border-b border-gray-100 pb-2">
            {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(d => (
              <span key={d} className={`text-[10px] font-bold uppercase ${d === 'Min' ? 'text-red-500' : 'text-slate-400'}`}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={`h-9 w-9 mx-auto flex items-center justify-center text-xs transition-all ${getDayClass(day)}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer Info & Action */}
        <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
          <div className="text-[10px] flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-slate-500">
                <span className="w-2 h-2 rounded-full border border-blue-600 bg-white"></span> Hari Ini
            </div>
            <div className="flex items-center gap-1 text-slate-500">
                <span className="w-2 h-2 rounded-full bg-blue-600"></span> Dipilih
            </div>
          </div>
          <button 
            disabled={!tempStart}
            onClick={() => onApply(tempStart, tempEnd || tempStart)} 
            className="px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all shadow-md active:scale-95"
          >
            Terapkan
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 3. ATTENDANCE FORM (FIXED: DATE RANGE + OPTIONAL TIME TOGGLE) ---
function AttendanceForm({ user, setUser, setView, editItem, setEditItem, masterData }) {
  const type = localStorage.getItem('absenType') || 'Hadir';
  const isEditMode = !!editItem;

  // KONFIGURASI TIPE ABSEN
  const PHOTO_REQUIRED_TYPES = ['Hadir', 'Pulang', 'Dinas', 'Sakit'];
  const NO_GPS_TYPES = ['Ijin', 'Cuti', 'Dinas Luar', 'Sakit', 'Cuti EO', 'Tukar Shift'];
  // const NO_TIME_TYPES = ['Cuti', 'Dinas Luar', 'Sakit', 'Cuti EO']; // (Digantikan logic manual)
  const H3_REQUIRED_TYPES = ['Ijin', 'Tukar Shift'];
  const UPLOAD_ALLOWED_TYPES = ['Dinas Luar', 'Cuti', 'Cuti EO', 'Ijin']; 

  const isPhotoRequired = PHOTO_REQUIRED_TYPES.includes(type);
  const isGpsRequired = !NO_GPS_TYPES.includes(type);
  const isH3Required = H3_REQUIRED_TYPES.includes(type);
  const isUploadAllowed = UPLOAD_ALLOWED_TYPES.includes(type);
  const isIntervalType = !['Hadir', 'Pulang'].includes(type);
  const isShiftWorker = user.role === 'karyawan_shift'; 
  const isClockIn = type === 'Hadir';

  const [selectedShift, setSelectedShift] = useState('');
  const availableShifts = masterData?.shifts || [];

  // CAMERA & FILES
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState(type === 'Sakit' ? 'environment' : 'user');
  const [fileLampiran, setFileLampiran] = useState(null);
  const [fileName, setFileName] = useState('');
  const [fileMime, setFileMime] = useState('');
  
  // FORM DATA
  const [location, setLocation] = useState(null);
  const [catatan, setCatatan] = useState('');
  const [intervalData, setIntervalData] = useState({ tglMulai: '', tglSelesai: '', jamMulai: '', jamSelesai: '' });
  
  // UI STATES
  const [isUploading, setIsUploading] = useState(type === 'Dinas Luar');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  
  // [NEW] STATE UNTUK OPSI JAM
  const [useTime, setUseTime] = useState(false);

  // --- INIT EFFECT ---
  useEffect(() => {
    let isMounted = true;
    const initForm = async () => {
      setIsInitializing(true);
      await new Promise(r => setTimeout(r, 500));

      // Default Use Time logic (Misal: Lembur/Tukar Shift default ON, Cuti default OFF)
      if (!isEditMode) {
          const timeDefaultRequired = ['Lembur', 'Tukar Shift'].includes(type);
          setUseTime(timeDefaultRequired);
      }

      // Prefill Logic
      const prefillJson = localStorage.getItem('absen_prefill');
      if (prefillJson && !editItem) {
        try {
          const data = JSON.parse(prefillJson);
          setIntervalData(prev => ({
            ...prev,
            tglMulai: data.tgl || prev.tglMulai,
            tglSelesai: data.tgl || prev.tglSelesai,
            jamMulai: data.jamMulai || '',    
            jamSelesai: data.jamSelesai || '' 
          }));
          if (data.jamMulai) setUseTime(true); // Auto enable jika ada data jam
          localStorage.removeItem('absen_prefill');
        } catch (e) { console.error("Gagal parse prefill", e); }
      }

      // Edit Mode Logic
      if (isEditMode) {
        setCatatan(editItem.catatan);
        const formatDate = (d) => d && d !== '-' ? new Date(d).toISOString().split('T')[0] : '';
        const hasTime = (editItem.jamMulai && editItem.jamMulai !== '-' && editItem.jamMulai !== '');
        
        setIntervalData({ 
          tglMulai: formatDate(editItem.tglMulai), 
          tglSelesai: formatDate(editItem.tglSelesai), 
          jamMulai: hasTime ? editItem.jamMulai : '', 
          jamSelesai: hasTime ? editItem.jamSelesai : '' 
        });
        setUseTime(hasTime); // Set toggle sesuai data yang diedit
        setPhoto(editItem.foto); 
      }

      // GPS Logic
      if (!isEditMode && isGpsRequired && 'geolocation' in navigator) {
        try {
          await new Promise((resolve) => {
             navigator.geolocation.getCurrentPosition(
               (p) => { if(isMounted) setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); resolve(); }, 
               () => { alert('Gagal lokasi. Pastikan GPS aktif.'); resolve(); },
               { timeout: 8000, enableHighAccuracy: true }
             );
          });
        } catch (err) { console.error(err); }
      }
      if (isMounted) setIsInitializing(false);
    };
    initForm();
    return () => { isMounted = false; };
  }, [isEditMode, editItem, isGpsRequired, type]);

  // --- HANDLERS ---
  const handleCalendarApply = (start, end) => {
      setIntervalData({ ...intervalData, tglMulai: start, tglSelesai: end });
      setShowCalendar(false);
  };

  const handleFileChange = (e) => {
      const file = e.target.files[0];
      if (file) {
          if (file.size > 5 * 1024 * 1024) { alert("Ukuran file terlalu besar (Max 5MB)"); return; }
          setFileName(file.name); setFileMime(file.type);
          const reader = new FileReader(); reader.onloadend = () => { setFileLampiran(reader.result); }; reader.readAsDataURL(file);
      }
  };

  const startCamera = async () => { 
      if (videoRef.current && videoRef.current.srcObject) { 
          videoRef.current.srcObject.getTracks().forEach(t => t.stop()); 
      }
      setCameraActive(false);
      try { 
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
          if (videoRef.current) { videoRef.current.srcObject = stream; setCameraActive(true); } 
      } catch (err) { alert("Gagal akses kamera."); } 
  };
  useEffect(() => { if (cameraActive) { startCamera(); } }, [facingMode]);
  const toggleCamera = () => { setFacingMode(prev => prev === 'user' ? 'environment' : 'user'); };
  const takePhoto = () => { 
      const video = videoRef.current; const canvas = canvasRef.current;
      if (video && canvas) { 
          canvas.width = video.videoWidth; canvas.height = video.videoHeight; 
          const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
          const fontSize = Math.floor(canvas.width / 25); ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textAlign = "right"; ctx.textBaseline = "bottom"; const paddingX = 20; const paddingY = 20;
          const now = new Date(); const timestampText = `${now.toLocaleDateString('id-ID')} ${now.toLocaleTimeString('id-ID', { hour12: false })}`;
          let gpsText = location ? `${location.lat}, ${location.lng}` : "No GPS";
          ctx.lineWidth = 3; ctx.strokeStyle = 'black'; ctx.fillStyle = "white";
          ctx.strokeText(timestampText, canvas.width - paddingX, canvas.height - paddingY); ctx.fillText(timestampText, canvas.width - paddingX, canvas.height - paddingY);
          ctx.strokeText(gpsText, canvas.width - paddingX, canvas.height - paddingY - (fontSize * 1.2)); ctx.fillText(gpsText, canvas.width - paddingX, canvas.height - paddingY - (fontSize * 1.2));
          setPhoto(canvas.toDataURL('image/jpeg', 0.8)); 
          if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
          setCameraActive(false);
      } 
  };

  const handleSubmit = async () => {
    // Validasi
    if (type === 'Cuti') {
        const sisa = parseInt(user.sisaCuti) || 0;
        if (sisa < 1) { alert('Sisa Cuti Habis.'); return; }
    }
    if (isH3Required && intervalData.tglMulai) {
        const dMulai = new Date(intervalData.tglMulai); const dBatas = new Date();
        dBatas.setDate(dBatas.getDate() - 3); dMulai.setHours(0,0,0,0); dBatas.setHours(0,0,0,0);
        if (dMulai < dBatas) { alert(`Pengajuan ${type} maks H-3.`); return; }
    }
    if (isIntervalType) {
        if (!intervalData.tglMulai || !intervalData.tglSelesai) { alert('Pilih Tanggal!'); return; }
        // Validasi Jam hanya jika useTime aktif
        if (useTime && (!intervalData.jamMulai || !intervalData.jamSelesai)) { alert('Jam Mulai dan Selesai wajib diisi!'); return; }
    }
    if (isShiftWorker && isClockIn && !isEditMode && !selectedShift) { alert('Pilih Shift!'); return; }
    if (isPhotoRequired && !isEditMode && !photo) { alert('Foto Wajib.'); return; }
    if (isGpsRequired && !isEditMode && !location) { alert('Lokasi belum ditemukan.'); return; }

    setIsSubmitting(true);
    try {
      let shiftJamMulai = '', shiftJamSelesai = '';
      if (selectedShift) {
           const splitJam = selectedShift.split('-');
           if(splitJam.length === 2) { shiftJamMulai = splitJam[0].trim(); shiftJamSelesai = splitJam[1].trim(); }
      }

      // Logic Jam Final
      const finalJamMulai = isShiftWorker && isClockIn ? shiftJamMulai : (useTime ? intervalData.jamMulai : '-');
      const finalJamSelesai = isShiftWorker && isClockIn ? shiftJamSelesai : (useTime ? intervalData.jamSelesai : '-');

      const payload = { 
          action: isEditMode ? 'edit_absen' : 'absen', 
          uuid: isEditMode ? editItem.uuid : null, 
          userId: user.id, nama: user.nama, tipe: type, 
          lokasi: location ? `${location.lat}, ${location.lng}` : '-', 
          catatan: catatan, foto: photo, 
          fileLampiran: isUploading ? fileLampiran : null, 
          fileName: isUploading ? fileName : '', fileMime: isUploading ? fileMime : '',
          ...intervalData,
          jamMulai: finalJamMulai,
          jamSelesai: finalJamSelesai
      };

      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') {
        alert(data.message);

        // Catat jam masuk/pulang hari ini secara lokal supaya kartu
        // "Absensi hari ini" di dashboard langsung terisi, tanpa menunggu
        // stats berikutnya turun dari server. Ini CADANGAN, bukan sumber
        // kebenaran — dashboard selalu mendahulukan angka dari hitungStats.
        if (!isEditMode && (type === 'Hadir' || type === 'Pulang')) {
          try {
            const skr = new Date();
            const hariIni = tglLokal(skr);
            let simpan = {};
            try {
              const lama = JSON.parse(localStorage.getItem('absen_hari_ini') || '{}');
              if (lama.tgl === hariIni && String(lama.userId) === String(user.id)) simpan = lama;
            } catch (e2) { /* isi rusak: mulai dari kosong */ }

            simpan.tgl = hariIni;
            simpan.userId = user.id;
            simpan[type === 'Hadir' ? 'masuk' : 'pulang'] =
              String(skr.getHours()).padStart(2, '0') + ':' + String(skr.getMinutes()).padStart(2, '0');

            localStorage.setItem('absen_hari_ini', JSON.stringify(simpan));
          } catch (e2) { /* localStorage penuh/diblokir: abaikan saja */ }
        }

        if (data.newSisaCuti !== undefined) {
           const updatedUser = { ...user, sisaCuti: data.newSisaCuti };
           setUser(updatedUser); 
           // UBAH: localStorage menjadi sessionStorage
           sessionStorage.setItem('app_user', JSON.stringify(updatedUser));
        }
        setEditItem(null); setView(isEditMode ? 'history' : 'dashboard');
      } else { alert(data.message); }
    } catch (e) { alert('Gagal kirim.'); } finally { setIsSubmitting(false); }
  };
  
  // ============================================================
  // TAMPILAN
  //
  // Susunannya: kepala berwarna (identitas pengajuan) -> kartu-kartu
  // seksi di atas latar netral -> bilah aksi yang menempel di bawah.
  //
  // Kenapa bilah aksi ditempel: di versi lama tombol "Kirim" ikut
  // menggulung ke bawah bersama isi form. Pada form yang panjang (foto +
  // peta + alasan) tombolnya keluar layar, dan orang harus menggulir
  // balik untuk mengirim.
  // ============================================================
  const tema = temaFor(type);
  const IkonTipe = ICON_MAP[type] || FileText;

  // Daftar syarat yang BELUM terpenuhi. Ini murni untuk ditampilkan —
  // validasi sesungguhnya tetap di handleSubmit dan tidak diubah, supaya
  // tidak ada jalur kirim yang diam-diam ikut terblokir oleh logika baru.
  // Nilainya juga bukan sekadar hiasan: sebelum ini satu-satunya cara tahu
  // ada yang kurang adalah menekan tombol lalu membaca alert.
  const NOTE_WAJIB = ['Ijin', 'Cuti', 'Sakit', 'Dinas Luar', 'Dinas', 'Cuti EO', 'Tukar Shift', 'Off', 'Lembur'];
  const kurang = [];
  if (isShiftWorker && isClockIn && !isEditMode && !selectedShift) kurang.push('pilih shift');
  if (isIntervalType && (!intervalData.tglMulai || !intervalData.tglSelesai)) kurang.push('tanggal');
  if (isIntervalType && useTime && (!intervalData.jamMulai || !intervalData.jamSelesai)) kurang.push('jam mulai & selesai');
  if (isPhotoRequired && !isEditMode && !photo) kurang.push('foto');
  if (isGpsRequired && !isEditMode && !location) kurang.push('lokasi GPS');
  if (NOTE_WAJIB.includes(type) && catatan.trim().length < 3) kurang.push('alasan');

  const adaTanggal = !!intervalData.tglMulai;
  const teksTanggal = adaTanggal
      ? (intervalData.tglMulai === intervalData.tglSelesai
          ? formatDateIndo(intervalData.tglMulai)
          : `${formatDateShort(intervalData.tglMulai)} — ${formatDateShort(intervalData.tglSelesai)}`)
      : 'Pilih tanggal…';

  return (
    <div className="min-h-screen bg-slate-50 pb-32">

      {/* ================= KEPALA ================= */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${tema.grad} px-5 pt-5 pb-14`}>
        {/* Dua lingkaran samar. Gradien polos terlihat rata seperti blok cat;
            ini memberi kedalaman tanpa menambah elemen yang harus dibaca. */}
        <div className="absolute -top-16 -right-10 w-52 h-52 rounded-full bg-white/10"></div>
        <div className="absolute -bottom-24 -left-16 w-56 h-56 rounded-full bg-black/5"></div>

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 shrink-0 rounded-2xl bg-white/15 border border-white/25 backdrop-blur-sm flex items-center justify-center">
              <IkonTipe className="w-[19px] h-[19px] text-white" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/65 leading-none">
                {isEditMode ? 'Ubah pengajuan' : 'Pengajuan e-Form'}
              </p>
              <h2 className="mt-1 text-[20px] font-semibold text-white tracking-tight leading-none truncate">{type}</h2>
            </div>
          </div>

          <button
            onClick={() => { setEditItem(null); setView('dashboard'); }}
            className="shrink-0 w-9 h-9 rounded-xl bg-white/15 border border-white/25 backdrop-blur-sm flex items-center justify-center text-white transition-colors hover:bg-white/25 active:scale-95"
            title="Kembali"
          >
            <ChevronLeft className="w-[18px] h-[18px]" strokeWidth={2.2} />
          </button>
        </div>

        {/* Identitas pemohon. Di form HRIS ini selalu terlihat supaya orang
            yakin sedang mengajukan atas nama dirinya sendiri. */}
        <div className="relative z-10 mt-4 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/20 backdrop-blur-sm rounded-lg px-2.5 py-1 text-[10.5px] font-medium text-white">
            <User className="w-3 h-3 text-white/70" strokeWidth={2} /> {user.nama}
          </span>
          <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/20 backdrop-blur-sm rounded-lg px-2.5 py-1 text-[10.5px] font-medium text-white">
            <Layers className="w-3 h-3 text-white/70" strokeWidth={2} /> {user.divisi}
          </span>
          {user.noPayroll && (
            <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/20 backdrop-blur-sm rounded-lg px-2.5 py-1 text-[10.5px] font-medium text-white font-mono">
              {user.noPayroll}
            </span>
          )}
        </div>
      </div>

      {isInitializing ? (
        <div className="px-4 -mt-8 relative z-10">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm py-16 flex flex-col items-center justify-center">
            <Loader2 className="w-7 h-7 text-slate-300 animate-spin mb-3" />
            <p className="text-[12px] font-medium text-slate-400">Menyiapkan formulir…</p>
          </div>
        </div>
      ) : (
        <div className="px-4 -mt-8 relative z-10 space-y-3">

          {/* ---- PERINGATAN H-3 ---- */}
          {isH3Required && (
            <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3.5 flex gap-2.5">
              <CircleAlert className="w-[17px] h-[17px] text-amber-600 shrink-0 mt-px" strokeWidth={2} />
              <div>
                <p className="text-[12px] font-semibold text-amber-900 leading-tight">Pengajuan wajib H-3</p>
                <p className="text-[11px] text-amber-700/90 leading-relaxed mt-0.5">
                  Tanggal mulai minimal 3 hari dari hari ini. Pengajuan lebih mepet akan ditolak sistem.
                </p>
              </div>
            </div>
          )}

          {/* ---- PILIH SHIFT ---- */}
          {isShiftWorker && isClockIn && !isEditMode && (
            <SeksiForm ikon={Clock} judul="Shift hari ini" catatan="Wajib dipilih sebelum absen masuk" warnaIkon={tema.chip}>
              <div className="relative">
                <select
                  className={`${INPUT_FORM} ${tema.fokus} appearance-none pr-10 cursor-pointer`}
                  value={selectedShift}
                  onChange={(e) => setSelectedShift(e.target.value)}
                >
                  <option value="">— Pilih shift —</option>
                  {availableShifts.map((s, idx) => (<option key={idx} value={s.value}>{s.label} ({s.value})</option>))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </SeksiForm>
          )}

          {/* ---- TANGGAL & JAM ---- */}
          {isIntervalType && (
            <SeksiForm
              ikon={CalendarRange}
              judul="Periode pengajuan"
              catatan={useTime ? 'Beserta jam mulai & selesai' : 'Sehari penuh'}
              warnaIkon={tema.chip}
              aksi={
                <div className="flex items-center gap-2 shrink-0">
                  {/* Tanpa breakpoint 'xs:' — itu bukan breakpoint bawaan
                      Tailwind, jadi kelasnya tidak pernah ter-generate dan
                      labelnya akan hilang selamanya. */}
                  <span className="text-[10px] font-medium text-slate-400">Jam</span>
                  <Sakelar aktif={useTime} onToggle={() => setUseTime(!useTime)} label="Sertakan jam" />
                </div>
              }
            >
              <LabelKecil>Tanggal mulai — selesai</LabelKecil>
              <button
                onClick={() => setShowCalendar(true)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border bg-white text-left transition-all active:scale-[0.995]
                  ${adaTanggal ? 'border-slate-200' : 'border-dashed border-slate-300'}`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <CalendarDays className={`w-4 h-4 shrink-0 ${adaTanggal ? 'text-slate-400' : 'text-slate-300'}`} strokeWidth={2} />
                  <span className={`text-[13.5px] truncate ${adaTanggal ? 'font-medium text-slate-900' : 'text-slate-400'}`}>
                    {teksTanggal}
                  </span>
                </span>
                <ChevronDown className="w-4 h-4 text-slate-300 shrink-0" />
              </button>

              <DateRangeModal
                isOpen={showCalendar}
                onClose={() => setShowCalendar(false)}
                onApply={handleCalendarApply}
                initialStart={intervalData.tglMulai}
                initialEnd={intervalData.tglSelesai}
              />

              {useTime && (
                <div className="grid grid-cols-2 gap-2.5 mt-3.5 pt-3.5 border-t border-slate-100">
                  <div>
                    <LabelKecil>Jam mulai</LabelKecil>
                    <input type="time" className={`${INPUT_FORM} ${tema.fokus} tabular-nums`}
                      value={intervalData.jamMulai}
                      onChange={e => setIntervalData({ ...intervalData, jamMulai: e.target.value })} />
                  </div>
                  <div>
                    <LabelKecil>Jam selesai</LabelKecil>
                    <input type="time" className={`${INPUT_FORM} ${tema.fokus} tabular-nums`}
                      value={intervalData.jamSelesai}
                      onChange={e => setIntervalData({ ...intervalData, jamSelesai: e.target.value })} />
                  </div>
                </div>
              )}
            </SeksiForm>
          )}

          {/* ---- LAMPIRAN ---- */}
          {isUploadAllowed && (
            <SeksiForm
              ikon={Paperclip}
              judul="Lampiran"
              catatan={fileName ? fileName : 'Opsional — gambar atau PDF'}
              warnaIkon={tema.chip}
              padat
              aksi={
                <Sakelar
                  aktif={isUploading}
                  label="Sertakan lampiran"
                  onToggle={() => { setIsUploading(!isUploading); if (isUploading) { setFileLampiran(null); setFileName(''); } }}
                />
              }
            >
              {isUploading && (
                <>
                  <input type="file" id="lampiranInput" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
                  <label
                    htmlFor="lampiranInput"
                    className={`cursor-pointer w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed transition-colors
                      ${fileName ? 'border-slate-200 bg-slate-50/70' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}`}
                  >
                    {fileName
                      ? <CheckCircle className="w-6 h-6 text-emerald-500" strokeWidth={1.8} />
                      : <Upload className="w-6 h-6 text-slate-400" strokeWidth={1.8} />}
                    <span className="text-[12px] font-medium text-slate-700 text-center px-4 truncate max-w-full">
                      {fileName || 'Ketuk untuk memilih berkas'}
                    </span>
                    {fileName && <span className="text-[10px] text-slate-400">Ketuk lagi untuk mengganti</span>}
                  </label>
                </>
              )}
            </SeksiForm>
          )}

          {/* ---- FOTO ---- */}
          {isPhotoRequired && !isEditMode && (
            <SeksiForm
              ikon={Camera}
              judul="Foto kehadiran"
              catatan="Wajib — diambil langsung dari kamera"
              warnaIkon={tema.chip}
              padat
              aksi={photo
                ? <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg shrink-0"><CheckCircle className="w-3 h-3" strokeWidth={2.4} /> Siap</span>
                : <span className="text-[10.5px] font-semibold text-slate-300 shrink-0">Belum</span>}
            >
              <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-[4/5]">
                {!photo && !cameraActive && (
                  <button onClick={startCamera} className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 hover:bg-slate-200/70 transition-colors">
                    <span className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                      <Camera className="w-6 h-6 text-slate-500" strokeWidth={1.8} />
                    </span>
                    <span className="text-[12.5px] font-semibold text-slate-600">Buka kamera</span>
                  </button>
                )}

                <video ref={videoRef} autoPlay playsInline
                  className={`absolute inset-0 w-full h-full object-cover ${cameraActive && !photo ? 'block' : 'hidden'}`} />
                <canvas ref={canvasRef} className="hidden" />
                {photo && <img src={photo} alt="Pratinjau" className="absolute inset-0 w-full h-full object-cover" />}

                {cameraActive && !photo && (
                  <>
                    {/* Bingkai bantu — memberi patokan posisi wajah, dan
                        membuat layar kamera tidak terlihat seperti video kosong. */}
                    <div className="absolute inset-6 rounded-2xl border-2 border-white/25 pointer-events-none"></div>
                    <div className="absolute inset-x-0 bottom-0 pt-10 pb-4 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-center gap-8">
                      <button onClick={toggleCamera} className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm border border-white/25 flex items-center justify-center text-white active:scale-90 transition-transform" title="Ganti kamera">
                        <SwitchCamera className="w-[18px] h-[18px]" strokeWidth={2} />
                      </button>
                      <button onClick={takePhoto} className="w-[62px] h-[62px] rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform" title="Ambil foto">
                        <span className="w-[50px] h-[50px] rounded-full bg-white border-[3px] border-white/60"></span>
                      </button>
                      <span className="w-10"></span>
                    </div>
                  </>
                )}
              </div>

              {photo && (
                <button
                  onClick={() => { setPhoto(null); startCamera(); }}
                  className="mt-2.5 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[12.5px] font-semibold text-slate-700 transition-colors active:scale-[0.99]"
                >
                  <RotateCcw className="w-3.5 h-3.5" strokeWidth={2.2} /> Ambil ulang
                </button>
              )}
            </SeksiForm>
          )}

          {/* ---- LOKASI ---- */}
          {!isEditMode && isGpsRequired && (
            <SeksiForm
              ikon={LocateFixed}
              judul="Lokasi"
              catatan={location ? 'Titik GPS terkunci' : 'Mencari sinyal GPS…'}
              warnaIkon={tema.chip}
              padat
              aksi={location
                ? <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg shrink-0"><CheckCircle className="w-3 h-3" strokeWidth={2.4} /> Terkunci</span>
                : <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin shrink-0" />}
            >
              <div className="rounded-xl overflow-hidden h-44 bg-slate-100 relative">
                {location ? (
                  <iframe title="Lokasi" width="100%" height="100%" frameBorder="0" style={{ border: 0 }}
                    src={`https://maps.google.com/maps?q=${location.lat},${location.lng}&z=17&output=embed`}></iframe>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <MapPin className="w-7 h-7 text-slate-300 animate-pulse" strokeWidth={1.8} />
                    <span className="text-[11px] font-medium text-slate-400">Menunggu GPS…</span>
                  </div>
                )}
              </div>
              {location && (
                <p className="mt-2 text-[10px] text-slate-400 font-mono tabular-nums text-center">
                  {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                </p>
              )}
            </SeksiForm>
          )}

          {/* ---- ALASAN ---- */}
          <SeksiForm
            ikon={NotebookPen}
            judul="Keterangan"
            catatan={NOTE_WAJIB.includes(type) ? 'Wajib diisi — minimal 3 huruf' : 'Opsional'}
            warnaIkon={tema.chip}
          >
            <textarea
              className={`${INPUT_FORM} ${tema.fokus} resize-none leading-relaxed`}
              placeholder={`Tulis alasan pengajuan ${type} Anda…`}
              rows="3"
              value={catatan}
              onChange={e => setCatatan(e.target.value)}
            />
            <div className="mt-1.5 flex justify-end">
              <span className={`text-[10px] tabular-nums ${catatan.trim().length < 3 && NOTE_WAJIB.includes(type) ? 'text-slate-300' : 'text-slate-400'}`}>
                {catatan.length} huruf
              </span>
            </div>
          </SeksiForm>

          <p className="flex items-center justify-center gap-1.5 pt-1 pb-2 text-[10px] text-slate-400">
            <ShieldCheck className="w-3 h-3" strokeWidth={2} />
            Data pengajuan tercatat atas nama {user.nama}
          </p>
        </div>
      )}

      {/* ================= BILAH AKSI ================= */}
      {!isInitializing && (
        <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
          <div className="max-w-md mx-auto pointer-events-auto bg-white/90 backdrop-blur-md border-t border-slate-200 px-4 pt-3 pb-4">

            {/* Daftar yang masih kurang. Sebelumnya informasi ini baru muncul
                sebagai alert SETELAH tombol ditekan, satu per satu. */}
            {kurang.length > 0 && (
              <div className="mb-2.5 flex items-start gap-2 text-[11px] text-slate-500">
                <CircleAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-px" strokeWidth={2.2} />
                <span className="leading-snug">
                  Belum lengkap: <span className="font-semibold text-slate-700">{kurang.join(', ')}</span>
                </span>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white text-[14px] font-semibold tracking-tight shadow-lg transition-all active:scale-[0.98]
                ${isSubmitting ? 'bg-slate-300 shadow-none cursor-wait' : tema.tombol}`}
            >
              {isSubmitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim…</>
                : <><Send className="w-4 h-4" strokeWidth={2.2} /> {isEditMode ? 'Simpan perubahan' : 'Kirim pengajuan'}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- 4. APPROVAL SCREEN (MODERN REDESIGN) ---
// [SOURCE REFERENCE: 1724]
function ApprovalScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('All');

  // --- LOGIC FETCH (Sama seperti sebelumnya) ---
  const fetchApprovalList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
            action: 'get_approval_list', 
            userId: user.id, 
            divisi: user.divisi, 
            role: user.role,
            lokasi: user.lokasi || 'All' 
        }) 
      });
      const data = await res.json();
      if (data.result === 'success') setList(data.list);
    } catch (e) { alert('Gagal memuat data approval'); } finally { setLoading(false); }
  }, [user.id, user.divisi, user.role, user.lokasi]);

  useEffect(() => { fetchApprovalList(); }, [fetchApprovalList]);

  // --- LOGIC APPROVE/REJECT ---
const handleDecision = async (uuid, decision, namaUser) => {
    const isReject = decision === 'reject';
    const actionText = isReject ? 'Menolak' : 'Menyetujui';
    
    // 1. Minta Input Alasan/Catatan
    const pesanPrompt = isReject 
        ? `Alasan PENOLAKAN untuk ${namaUser} (Wajib diisi):` 
        : `Catatan PERSETUJUAN untuk ${namaUser} (Opsional):`;
    
    const alasanInput = window.prompt(pesanPrompt, "");
    
    // Jika user klik Cancel di prompt
    if (alasanInput === null) return;

    // 2. Validasi: Reject Wajib Ada Alasan
    if (isReject && alasanInput.trim() === "") {
        alert("Gagal! Anda wajib memberikan alasan jika menolak pengajuan.");
        return;
    }

    // 3. Konfirmasi Terakhir
    if (!window.confirm(`Yakin ingin ${actionText} pengajuan ini?`)) return;
    
    // 4. Optimistic Update UI (Hapus baris dari layar biar cepat)
    const newList = list.filter(item => item.uuid !== uuid);
    setList(newList);

    try {
        // 5. Kirim ke Server
        const res = await fetchApi(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'process_approval', 
                uuid: uuid, 
                decision: decision, 
                approverName: user.nama, // Mengambil nama user yang sedang login
                alasan: alasanInput.trim() 
            }) 
        }).then(r => r.json());
        
        if (res.result === 'success') { 
            alert(res.message);
            // Tidak perlu fetch ulang jika sukses, karena data sudah dihapus dari layar (Optimistic UI)
        } else {
            // Jika Gagal, kembalikan data (Revert)
            alert(res.message);
            fetchApprovalList(); 
        }
    } catch (e) {
        alert('Terjadi kesalahan koneksi');
        fetchApprovalList(); // Revert jika error koneksi
    }
};

  const formatDateIndo = (dateString) => { 
    if (!dateString || dateString === '-') return '-';
    try { 
      const date = new Date(dateString);
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'});
    } catch (e) { return dateString; } 
  };

  const uniqueTypes = ['All', ...new Set(list.map(item => item.tipe))];
  const filteredList = list.filter(item => filterType === 'All' || item.tipe === filterType);

  // --- COLORS HELPER ---
  const getTypeColor = (tipe) => {
      switch(tipe) {
          case 'Cuti': return 'bg-pink-100 text-pink-700 border-pink-200';
          case 'Sakit': return 'bg-orange-100 text-orange-700 border-orange-200';
          case 'Ijin': return 'bg-blue-100 text-blue-700 border-blue-200';
          case 'Dinas Luar': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
          default: return 'bg-gray-100 text-gray-700 border-gray-200';
      }
  };

  return (
      <div className="p-4 h-full overflow-y-auto pb-24 bg-gray-50/50">
        <div className="flex items-center justify-between mb-6">
          <div>
              <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Approval</h2>
              <p className="text-[10px] text-slate-500 font-medium">Menunggu persetujuan HRD</p>
          </div>
          <BackButton onClick={() => setView('dashboard')} />
        </div>
  
        {/* --- FILTER SECTION --- */}
        <div className="flex justify-between items-center mb-5 sticky top-0 bg-gray-50/95 py-2 z-10 backdrop-blur-sm">
            <div className="flex items-center gap-2">
                 <span className="bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm shadow-slate-300">
                    {filteredList.length} Pending
                 </span>
            </div>
           
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full shadow-sm border border-gray-200">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select 
                    value={filterType} 
                    onChange={(e) => setFilterType(e.target.value)} 
                    className="text-xs bg-transparent border-none outline-none font-bold text-slate-600 cursor-pointer"
                >
                    <option value="All">Semua Tipe</option>
                    {uniqueTypes.filter(t => t !== 'All').map((type, idx) => (
                       <option key={idx} value={type}>{type}</option>
                    ))}
                </select>
            </div>
        </div>
  
        {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-2"/>
                <span className="text-xs font-bold text-slate-400">Memuat Pengajuan...</span>
            </div>
        ) : (
          <div className="space-y-4">
            {filteredList.length === 0 && (
                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-300">
                     <CheckCircle className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                     <p className="text-slate-400 font-bold text-sm">Semua beres!</p>
                     <p className="text-[10px] text-slate-300">Tidak ada pengajuan yang perlu diproses.</p>
                </div>
            )}
            
            {/* --- CARD DESIGN BARU --- */}
            {filteredList.map((item, idx) => (
              <div key={idx} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg transition-all duration-300 group">
                
                {/* HEADER STRIP */}
                <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 to-indigo-600"></div>

                <div className="p-4">
                    {/* TOP: USER INFO & TYPE */}
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 font-black text-sm shadow-sm">
                                {item.nama.charAt(0)}
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800 text-sm leading-tight">{item.nama}</h4>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] font-medium text-slate-500 bg-slate-50 px-1.5 rounded border border-slate-100">{item.divisi}</span>
                                    <span className="text-[10px] text-slate-300">•</span>
                                    <span className="text-[10px] font-medium text-slate-400">{item.lokasi}</span>
                                </div>
                            </div>
                        </div>
                        <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full border shadow-sm ${getTypeColor(item.tipe)}`}>
                              {item.tipe.toUpperCase()}
                        </span>
                    </div>

                    {/* MIDDLE: INFO GRID */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 mb-4">
                        <div className="grid grid-cols-2 gap-y-3 gap-x-2">
                             {/* Tanggal */}
                             <div className="col-span-2 flex items-start gap-2">
                                <Calendar className="w-4 h-4 text-slate-400 mt-0.5"/>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Periode Pengajuan</p>
                                    <p className="text-sm font-bold text-slate-700">
                                        {item.tglMulai && item.tglMulai !== '-' ? `${formatDateIndo(item.tglMulai)} - ${formatDateIndo(item.tglSelesai)}` : formatDateIndo(item.waktu)}
                                    </p>
                                </div>
                             </div>

                             {/* Catatan / Alasan */}
                             <div className="col-span-2 border-t border-dashed border-slate-200 pt-2 mt-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Keterangan / Alasan</p>
                                <p className="text-xs text-slate-600 italic leading-relaxed">"{item.catatan || '-'}"</p>
                             </div>
                        </div>
                    </div>
                    
                    {/* ATTACHMENTS (Jika Ada) */}
                    <div className="flex gap-2 mb-4">
                        {item.foto && item.foto.length > 10 && item.foto !== 'Error Upload' && (
                            <a href={item.foto} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-blue-200 hover:bg-blue-100 transition shadow-sm no-underline">
                                <Camera className="w-3 h-3"/> Foto Bukti
                            </a>
                        )}
                        {item.lampiran && item.lampiran.length > 10 && item.lampiran !== '-' && (
                            <a href={item.lampiran} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-amber-50 text-amber-600 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-amber-200 hover:bg-amber-100 transition shadow-sm no-underline">
                                <FileIcon className="w-3 h-3"/> Dokumen
                            </a>
                        )}
                    </div>

                    {/* ACTION BUTTONS (FIXED BOTTOM STYLE) */}
                    <div className="grid grid-cols-2 gap-3">
                        <button 
                            onClick={() => handleDecision(item.uuid, 'reject', item.nama)} 
                            className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-600 font-bold text-xs hover:bg-rose-50 active:scale-[0.98] transition flex items-center justify-center gap-2 group/btn"
                        >
                           <X className="w-4 h-4 group-hover/btn:scale-110 transition-transform"/> Tolak
                        </button>
                        <button 
                            onClick={() => handleDecision(item.uuid, 'approve', item.nama)} 
                            className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 shadow-md shadow-indigo-200 active:scale-[0.98] transition flex items-center justify-center gap-2 group/btn"
                        >
                           <CheckCircle className="w-4 h-4 group-hover/btn:scale-110 transition-transform"/> Setujui
                        </button>
                    </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
  );
}

// --- 5. HISTORY SCREEN (FIXED: ADDED APPROVE/REJECT BUTTONS IN REPORT) ---
function HistoryScreen({ user, setView, setEditItem, masterData }) {
  const [history, setHistory] = useState([]);
  const [shiftReport, setShiftReport] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  
  // MAIN FILTER STATE
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All'); 
  
  // REPORT MODAL STATE
  const [showWebReport, setShowWebReport] = useState(false);
  const [reportStatusFilter, setReportStatusFilter] = useState('All');
  const [reportCategory, setReportCategory] = useState('General'); 
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportFormFilter, setReportFormFilter] = useState('All');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  // REPORT ADVANCED FILTERS
  const [reportUserIds, setReportUserIds] = useState([]);
  const [reportDivisiFilters, setReportDivisiFilters] = useState([]); 
  const [isReportFilterExpanded, setIsReportFilterExpanded] = useState(false); 
  const [isPosisiFilterExpanded, setIsPosisiFilterExpanded] = useState(false); 
  const [searchReportUser, setSearchReportUser] = useState('');
  
  // REPORT TABLE FILTERS
  const [reportColumnFilters, setReportColumnFilters] = useState({});
  const [reportSortConfig, setReportSortConfig] = useState({ key: null, direction: 'asc' });
  const [activeReportFilter, setActiveReportFilter] = useState(null);

  // Close dropdown logic
  useEffect(() => {
      const handleClickOutside = (event) => {
          if (activeReportFilter && !event.target.closest('.report-filter-container')) {
              setActiveReportFilter(null);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeReportFilter]);

  const userRole = user.role ? String(user.role).toLowerCase() : '';
  const canViewAll = ['admin', 'hrd'].includes(userRole);
  const isSuperAdmin = userRole === 'admin' && (user.lokasi === 'All' || !user.lokasi);
  
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]); 
  
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [locationFilter, setLocationFilter] = useState('All');
  const [searchUser, setSearchUser] = useState('');
  const APPROVAL_TYPES = ['Cuti', 'Sakit', 'Dinas Luar', 'Lembur', 'Tukar Shift', 'Off', 'Cuti EO'];

  // --- EFFECT & FETCH DATA ---
  useEffect(() => {
      if (showWebReport) {
          if(filterStart) setReportStartDate(filterStart);
          if(filterEnd) setReportEndDate(filterEnd);
          setIsReportLoading(true);
          if (canViewAll && allUsers.length === 0) fetchUsers();
          setTimeout(() => setIsReportLoading(false), 800);
          setReportColumnFilters({});
          setReportSortConfig({ key: null, direction: 'asc' });
      }
  }, [showWebReport]);

  const fetchUsers = async () => {
    try {
        const res = await fetchApi(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'get_user_list_simple', lokasi: user.lokasi || 'All', filterLokasi: locationFilter }) 
        });
        const data = await res.json();
        if(data.result === 'success') { setAllUsers(data.list); setSelectedUserIds([]); }
    } catch(e) { console.error("Gagal load users"); }
  }

  const fetchHistory = async () => {
    setLoading(true);
    try { 
      const payload = { 
        action: 'get_history', 
        userId: user.id,
        canViewAll: canViewAll, 
        requestorLokasi: isSuperAdmin ? locationFilter : (user.lokasi || 'All'), 
        targetUserIds: canViewAll ? selectedUserIds : [] 
      };
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') setHistory(data.history);
    } catch (e) { alert('Gagal ambil data history'); } finally { setLoading(false); }
  };

  const fetchShiftReport = async () => {
    if (reportCategory !== 'RunningShift') return;
    setIsReportLoading(true);
    try {
       const res = await fetchApi(SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'get_shift_history', userId: user.id, role: user.role })
       });
       const data = await res.json();
       if (data.result === 'success') { setShiftReport(data.data); }
    } catch (e) { console.error("Gagal load shift report"); } 
    finally { setIsReportLoading(false); }
  };

  useEffect(() => { if(canViewAll) fetchUsers(); }, [locationFilter]);
  useEffect(() => { fetchHistory(); }, [selectedUserIds]);
  useEffect(() => { 
      if (showWebReport && reportCategory === 'RunningShift') {
          fetchShiftReport();
      } else if (showWebReport) {
          setIsReportLoading(true);
          setTimeout(() => setIsReportLoading(false), 500);
      }
      setReportColumnFilters({});
  }, [showWebReport, reportCategory]);

  // --- HELPER FORMAT ---
  const formatDateIndo = (d) => { if (!d || d === '-') return '-'; try { return new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return d; } };
  const formatDateShort = (d) => { if (!d || d === '-') return '-'; try { return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}); } catch (e) { return d; } };
  const formatTimeOnly = (val) => { if (!val || val === '-') return '-'; if (typeof val === 'string' && (val.includes('T') || val.length > 8)) { try { const d = new Date(val); if (!isNaN(d.getTime())) { return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':'); } } catch (e) { return val.substring(0, 5); } } return val.length >= 5 ? val.substring(0, 5) : val; };
  const formatDateTimeFull = (val) => { if (!val || val === '-') return '-'; try { const d = new Date(val); if(isNaN(d.getTime())) return val; const dd = String(d.getDate()).padStart(2, '0'); const mm = String(d.getMonth() + 1).padStart(2, '0'); const yy = String(d.getFullYear()).slice(-2); const hh = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0'); return `${dd}-${mm}-${yy} ${hh}:${min}`; } catch(e) { return val; } };
  const getDurasiHari = (start, end) => { if (!start || start === '-' || !end || end === '-') return '-'; try { const d1 = new Date(start); const d2 = new Date(end); d1.setHours(0,0,0,0); d2.setHours(0,0,0,0); const diffTime = Math.abs(d2 - d1); const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; return `${diffDays} Hari`; } catch (e) { return '-'; } };
  
  const formatDateDDMMYYYY = (d) => { try { const dateObj = new Date(d); if (isNaN(dateObj.getTime())) return d; const day = String(dateObj.getDate()).padStart(2, '0'); const month = String(dateObj.getMonth() + 1).padStart(2, '0'); const year = dateObj.getFullYear(); return `${day}-${month}-${year}`; } catch (e) { return '-'; } };

  const uniqueForms = ['All', ...new Set(history.map(item => item.tipe))];

  // --- [NEW] HANDLE APPROVAL ACTION ---
  const handleUpdateStatus = async (uuid, newStatus) => {
    if(!window.confirm(`Apakah Anda yakin ingin mengubah status menjadi ${newStatus}?`)) return;
    
    setIsReportLoading(true);
    try {
        const res = await fetchApi(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_status_absen', // Pastikan backend punya handler ini
                uuid: uuid,
                status: newStatus,
                approverName: user.nama
            })
        });
        const data = await res.json();
        
        if (data.result === 'success') {
            alert(`Berhasil di-${newStatus}`);
            await fetchHistory(); // Refresh data agar tabel update
        } else {
            alert("Gagal update: " + data.message);
        }
    } catch (e) {
        console.error(e);
        alert("Terjadi kesalahan koneksi.");
    } finally {
        setIsReportLoading(false);
    }
  };

  // --- REPORT PROCESSING LOGIC ---
  const processReportData = () => {
      try {
          let finalData = [];
          let availableUsers = [];
          let availableDivisions = [];
          const start = reportStartDate ? new Date(reportStartDate).setHours(0, 0, 0, 0) : null;
          const end = reportEndDate ? new Date(reportEndDate).setHours(23, 59, 59, 999) : null;
          
          if (reportCategory === 'Tally') {
              const tallyTypes = ['Hadir', 'Pulang', 'Standby', 'Off'];
              const filteredRaw = history.filter(item => {
                 const itemDate = new Date(item.waktu).setHours(0,0,0,0);
                 const matchDate = (!start && !end) || (itemDate >= start && itemDate <= end);
                 return matchDate && tallyTypes.includes(item.tipe);
              });
              const groupedMap = {};
              filteredRaw.forEach(item => {
                  const dateKey = new Date(item.waktu).toLocaleDateString('en-CA'); 
                  const groupKey = `${item.userId}_${dateKey}`;
                  if (!groupedMap[groupKey]) {
                      groupedMap[groupKey] = {
                          id: item.userId, 
                          idAkun: item.idAkun || '-', 
                          nama: item.nama, 
                          noPayroll: item.noPayroll, 
                          divisi: item.divisi || '-',
                          dateObj: new Date(item.waktu), tanggal: item.waktu, foto: item.foto || '-', 
                          catatanList: item.catatan ? [item.catatan] : [], masuk: '-', pulang: '-', standby: '-'
                      };
                  } else {
                      if (item.catatan) groupedMap[groupKey].catatanList.push(item.catatan);
                      if ((!groupedMap[groupKey].foto || groupedMap[groupKey].foto === '-') && item.foto) groupedMap[groupKey].foto = item.foto;
                  }
                  const timeStr = formatTimeOnly(item.waktu); 
                  if (item.tipe === 'Hadir') groupedMap[groupKey].masuk = timeStr;
                  else if (item.tipe === 'Pulang') groupedMap[groupKey].pulang = timeStr;
                  else if (item.tipe === 'Standby' || item.tipe === 'Off') groupedMap[groupKey].standby = timeStr; 
              });
              finalData = Object.values(groupedMap).map(g => ({ 
                  ...g, 
                  catatan: g.catatanList.join('; '), 
                  col_date: formatDateDDMMYYYY(g.tanggal),
                  col_userId: g.idAkun, 
                  col_payroll: g.noPayroll,
                  
              }));
          } else {
              let sourceData = (reportCategory === 'RunningShift') ? shiftReport : history;
              finalData = sourceData.filter(item => {
                  const dateRef = reportCategory === 'RunningShift' ? item.tanggal : item.waktu;
                  const itemDate = new Date(dateRef).setHours(0, 0, 0, 0);
                  const matchDate = (!start && !end) || (itemDate >= start && itemDate <= end);
                  let matchStatus = true; let matchForm = true;
                  if (reportCategory === 'General') {
                     matchStatus = (reportStatusFilter === 'All' || item.status === reportStatusFilter);
                     matchForm = (reportFormFilter === 'All' || item.tipe === reportFormFilter);
                  }
                  return matchDate && matchStatus && matchForm;
              });

              finalData = finalData.map(item => {
                  if (reportCategory === 'RunningShift') {
                      const matchedUser = allUsers.find(u => u.nama === item.nama);
                      const realUsername = matchedUser ? matchedUser.id : (item.userId || '-');
                      return { 
                          ...item, 
                          col_date: formatDateDDMMYYYY(item.tanggal), 
                          col_time: formatDateTimeFull(item.waktuInput),
                          col_userId: realUsername,
                          col_payroll: item.idAkun || '-'
                      };
                  } else { 
                      const idAkunFromSheet = item.idAkun || item.userId || '-'; 
                      const pRoll = item.noPayroll || '-';
                      let periode = item.tglMulai && item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : (item.jamMulai && item.jamMulai !== '-' ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-');
                      let durasi = getDurasiHari(item.tglMulai, item.tglSelesai);
                      return { 
                          ...item, 
                          col_date: formatDateTimeFull(item.waktu),
                          col_periode: periode,
                          col_durasi: durasi,
                          col_approval: item.approvalTime && item.approvalTime !== '-' ? formatDateTimeFull(item.approvalTime) : '-',
                          col_userId: idAkunFromSheet, 
                          col_payroll: pRoll 
                      };
                  }
              });
          }

          availableUsers = finalData.reduce((acc, current) => {
              const uid = String(current.id || current.userId); 
              if (!acc.find(u => u.id === uid)) acc.push({ id: uid, nama: current.nama });
              return acc;
          }, []).sort((a, b) => a.nama.localeCompare(b.nama));
          availableDivisions = [...new Set(finalData.map(item => item.divisi || '-'))].sort();

          if (reportUserIds.length > 0) finalData = finalData.filter(item => reportUserIds.includes(String(item.id || item.userId)));
          if (reportDivisiFilters.length > 0) finalData = finalData.filter(item => reportDivisiFilters.includes(item.divisi || '-'));

          return { finalData, availableUsers, availableDivisions };
      } catch (err) {
          console.error("Error processing report:", err);
          return { finalData: [], availableUsers: [], availableDivisions: [] };
      }
  };
  const { finalData: currentReportData, availableUsers, availableDivisions } = processReportData();

  // --- FILTERING & SORTING ---
  const getReportUniqueValues = (field) => {
      const values = currentReportData.map(item => item[field]).filter(v => v !== null && v !== undefined && v !== '');
      return [...new Set(values)].sort();
  };
  const toggleReportFilterValue = (field, value) => {
      setReportColumnFilters(prev => {
          const currentValues = prev[field] || [];
          if (currentValues.includes(value)) return { ...prev, [field]: currentValues.filter(v => v !== value) };
          else return { ...prev, [field]: [...currentValues, value] };
      });
  };
  const toggleReportSelectAll = (field, visibleOptions) => {
      setReportColumnFilters(prev => {
          const currentValues = prev[field] || [];
          const allVisibleSelected = visibleOptions.every(val => currentValues.includes(val));
          if (allVisibleSelected) return { ...prev, [field]: currentValues.filter(v => !visibleOptions.includes(v)) };
          else {
              const newValues = [...currentValues];
              visibleOptions.forEach(v => { if (!newValues.includes(v)) newValues.push(v); });
              return { ...prev, [field]: newValues };
          }
      });
  };
  const requestReportSort = (key, direction) => { setReportSortConfig({ key, direction }); };
  const filteredReportTable = currentReportData.filter(item => {
      return Object.keys(reportColumnFilters).every(key => {
          const selectedValues = reportColumnFilters[key];
          if (!selectedValues || selectedValues.length === 0) return true;
          return selectedValues.includes(String(item[key]));
      });
  });
  const sortedReportTable = React.useMemo(() => {
      let sortableItems = [...filteredReportTable];
      if (reportSortConfig.key !== null) {
          sortableItems.sort((a, b) => {
              let valA = a[reportSortConfig.key] || '';
              let valB = b[reportSortConfig.key] || '';
              return reportSortConfig.direction === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
          });
      }
      return sortableItems;
  }, [filteredReportTable, reportSortConfig]);

  // --- ACTIONS HANDLERS ---
  const toggleReportUserSelection = (id) => { if(reportUserIds.includes(id)) setReportUserIds(reportUserIds.filter(x => x !== id)); else setReportUserIds([...reportUserIds, id]); };
  const toggleReportDivisiSelection = (div) => { if(reportDivisiFilters.includes(div)) setReportDivisiFilters(reportDivisiFilters.filter(x => x !== div)); else setReportDivisiFilters([...reportDivisiFilters, div]); };
  const selectAllReportUsers = () => { const visibleIds = availableUsers.filter(u => u.nama.toLowerCase().includes(searchReportUser.toLowerCase())).map(u => u.id); if(visibleIds.every(id => reportUserIds.includes(id))) { setReportUserIds(reportUserIds.filter(id => !visibleIds.includes(id))); } else { setReportUserIds([...new Set([...reportUserIds, ...visibleIds])]); } };
  const selectAllDivisions = () => { if(availableDivisions.every(d => reportDivisiFilters.includes(d))) { setReportDivisiFilters([]); } else { setReportDivisiFilters(availableDivisions); } };

  // --- EXPORT FUNCTIONS ---
  const generateExcel = () => {
    let tableHead = [], tableBody = [];
    const dataToExport = sortedReportTable; 
    if (reportCategory === 'RunningShift') {
        tableHead = ["No", "UserID", "PAYROLL", "Nama", "Posisi", "Tanggal Shift", "Jam Kerja", "Waktu Input"];
        tableBody = dataToExport.map((item, index) => [ index + 1, item.col_userId, item.col_payroll, item.nama, item.divisi || '-', item.col_date, item.shiftLabel, item.col_time ]);
    } else if (reportCategory === 'Tally') {
        tableHead = ["No", "UserID", "PAYROLL", "Nama", "Tanggal", "Posisi", "Masuk", "Pulang", "Standby", "Foto URL", "Catatan"];
        tableBody = dataToExport.map((item, index) => [ index + 1, item.col_userId, item.col_payroll, item.nama, item.col_date, item.divisi || '-', item.masuk, item.pulang, item.standby, item.foto || '-', item.catatan || '-' ]);
    } else {
        tableHead = ["No", "UserID", "PAYROLL", "Nama", "Form", "Waktu Input", "Periode", "Durasi", "Catatan", "Status", "Approval"];
        tableBody = dataToExport.map((item, index) => [ index + 1, item.col_userId, item.col_payroll, item.nama, item.tipe, item.col_date, item.col_periode, item.col_durasi, item.catatan || '-', item.status, item.col_approval ]);
    }
    const worksheet = XLSX.utils.aoa_to_sheet([tableHead, ...tableBody]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan");
    XLSX.writeFile(workbook, `Laporan_${reportCategory}_${reportStartDate || 'All'}.xlsx`);
  };

  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const marginLeft = 10; const marginTop = 10;
    doc.setFontSize(10); doc.setFont("helvetica", "bold");
    let judul = "LAPORAN DATA ABSENSI";
    if (reportCategory === 'RunningShift') judul = "LAPORAN RUNNING SHIFT (JADWAL)";
    if (reportCategory === 'Tally') judul = "LAPORAN ABSEN ONLINE TALLY";
    doc.text(judul, marginLeft, marginTop);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    const infoFilter = `Periode: ${reportStartDate || 'Awal'} s/d ${reportEndDate || 'Akhir'} | Total: ${sortedReportTable.length}`;
    doc.text(infoFilter, marginLeft, marginTop + 4);
    let tableColumn = [], tableRows = [];
    
    if (reportCategory === 'RunningShift') {
        tableColumn = ["No", "UserID", "PAYROLL", "Nama", "Posisi", "Tanggal Shift", "Jam Kerja", "Waktu Input"];
        sortedReportTable.forEach((item, index) => { tableRows.push([index + 1, item.col_userId, item.col_payroll, item.nama, item.divisi || '-', item.col_date, item.shiftLabel, item.col_time]); });
    } else if (reportCategory === 'Tally') {
        tableColumn = ["No", "UserID", "PAYROLL", "Nama", "Tanggal", "Posisi", "Masuk", "Pulang", "Standby", "Foto URL", "Catatan"];
        sortedReportTable.forEach((item, index) => { tableRows.push([ index + 1, item.col_userId, item.col_payroll, item.nama, item.col_date, item.divisi, item.masuk, item.pulang, item.standby, item.foto || '-', item.catatan || '-' ]); });
    } else {
        tableColumn = ["No", "UserID", "PAYROLL", "Nama", "Form", "Waktu Input", "Periode", "Durasi", "Catatan", "Status", "Approval"];
        sortedReportTable.forEach((item, index) => { tableRows.push([index + 1, item.col_userId, item.col_payroll, item.nama, item.tipe, item.col_date, item.col_periode, item.col_durasi, item.catatan || '-', item.status, item.col_approval]); });
    }
    autoTable(doc, { head: [tableColumn], body: tableRows, startY: 18, theme: 'grid', styles: { fontSize: 6, cellPadding: 1, valign: 'middle' }, headStyles: { fillColor: [50, 50, 50] } });
    doc.save(`Laporan_${reportCategory}_${reportStartDate}.pdf`);
  };

  // --- ACTIONS --- (Non-Report)
  const handleRequestApproval = async (item) => {
    const detailTanggal = item.tglMulai && item.tglMulai !== '-' ? `${formatDateIndo(item.tglMulai)} s/d ${formatDateIndo(item.tglSelesai)}` : formatDateIndo(item.waktu);
    if (!window.confirm(`Kirim ulang email approval untuk ${item.tipe} (${detailTanggal})?`)) return;
    setSendingEmail(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'request_approval_email', uuid: item.uuid, scriptUrl: SCRIPT_URL }) });
      const data = await res.json(); 
      if (data.result === 'success') alert("Sukses! " + data.message); else alert("Gagal: " + data.message);
    } catch (e) { alert("Gagal kirim email: " + e.message); } finally { setSendingEmail(false); }
  };
  const handleDelete = async (uuid) => { if (!window.confirm('Yakin hapus data ini?')) return;
    try { const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'delete_absen', uuid }) });
    const data = await res.json(); if (data.result === 'success') { alert('Berhasil dihapus'); fetchHistory(); } else { alert(data.message); } } catch (e) { alert('Gagal hapus'); } };
  const handleEdit = (item) => { setEditItem(item); localStorage.setItem('absenType', item.tipe); setView('form'); };
  const isEditable = (waktuStr, status) => { if (status === 'Approved' || status === 'Rejected') return false;
    if (!waktuStr || waktuStr === '-') return false; try { return (new Date().getTime() - new Date(waktuStr).getTime()) / (1000 * 60 * 60) <= 1; } catch (e) { return false; } };
  
  const getFilteredHistory = () => { return history.filter(item => { const itemDate = new Date(item.waktu).setHours(0, 0, 0, 0); const start = filterStart ? new Date(filterStart).setHours(0, 0, 0, 0) : null; const end = filterEnd ? new Date(filterEnd).setHours(23, 59, 59, 999) : null; return ((!start && !end) || (itemDate >= start && itemDate <= end)) && (filterType === 'All' || item.tipe === filterType) && (filterStatus === 'All' || item.status === filterStatus); }); };
  
  const getStatusColor = (status) => { if (status === 'Approved' || status === 'Verified') return 'bg-emerald-100 text-emerald-700 border-emerald-200'; if (status === 'Rejected') return 'bg-rose-100 text-rose-700 border-rose-200'; return 'bg-amber-100 text-amber-700 border-amber-200'; };
  const toggleUserSelection = (id) => { if(selectedUserIds.includes(id)) { setSelectedUserIds(selectedUserIds.filter(x => x !== id)); } else { setSelectedUserIds([...selectedUserIds, id]); } };
  const selectAllUsers = () => { const visibleIds = allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).map(u => u.id); if(visibleIds.every(id => selectedUserIds.includes(id))) { setSelectedUserIds(selectedUserIds.filter(id => !visibleIds.includes(id))); } else { setSelectedUserIds([...new Set([...selectedUserIds, ...visibleIds])]); } };
  
  const uniqueTypes = ['All', ...new Set(history.map(item => item.tipe))];
  const displayData = getFilteredHistory().filter(item => {
      if (canViewAll) {
          const HIDDEN_TYPES = ['Hadir', 'Pulang', 'Standby', 'Off', 'Tukar Shift'];
          if (HIDDEN_TYPES.includes(item.tipe)) return false;
      }
      return true;
  });

  // --- HEADER COMPONENT ---
  const ReportFilterHeader = ({ label, field, width }) => {
      const uniqueOptions = getReportUniqueValues(field);
      const selectedValues = reportColumnFilters[field] || [];
      const isOpen = activeReportFilter === field;
      const [searchTerm, setSearchTerm] = useState('');
      const visibleOptions = uniqueOptions.filter(opt => String(opt).toLowerCase().includes(searchTerm.toLowerCase()));

      return (
          <th className={`p-0 border border-gray-300 bg-gray-100 align-top ${width || 'w-auto'} relative`}>
              <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-2 pb-1">
                      <span className="text-[10px] font-bold text-gray-700 uppercase">{label}</span>
                      {reportSortConfig.key === field && (
                          <span className="text-[9px] text-gray-800 font-bold ml-1">{reportSortConfig.direction === 'asc' ? '↓' : '↑'}</span>
                      )}
                  </div>
                  <div className="px-2 pb-2 report-filter-container">
                    <button onClick={(e) => { e.stopPropagation(); setActiveReportFilter(isOpen ? null : field); }} 
                        className={`flex items-center justify-between w-full text-[9px] px-2 py-1 border rounded bg-white shadow-sm transition-all ${selectedValues.length > 0 ? 'text-blue-700 border-blue-400 bg-blue-50' : 'text-gray-600 border-gray-300 hover:border-gray-400'}`}>
                        <span className="truncate font-medium">{selectedValues.length === 0 ? "(All)" : `${selectedValues.length} Selected`}</span>
                        <Filter className="w-2.5 h-2.5 ml-1 opacity-70" />
                    </button>
                    {isOpen && (
                        <div className="absolute top-[95%] left-0 mt-0 w-48 bg-white border border-gray-400 shadow-xl z-[100] flex flex-col max-h-64 rounded-sm">
                            <div className="p-1.5 border-b bg-gray-50 flex gap-1">
                                <button onClick={() => requestReportSort(field, 'asc')} className="flex-1 text-[9px] font-bold bg-white border rounded p-1 hover:bg-gray-200">A-Z</button>
                                <button onClick={() => requestReportSort(field, 'desc')} className="flex-1 text-[9px] font-bold bg-white border rounded p-1 hover:bg-gray-200">Z-A</button>
                            </div>
                            <div className="p-1.5 border-b relative">
                                <input type="text" placeholder="Cari..." className="w-full text-[9px] border p-1 rounded bg-white outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoFocus />
                            </div>
                            <div className="px-2 py-1.5 bg-gray-50 flex items-center gap-2 border-b hover:bg-gray-100 cursor-pointer" onClick={() => toggleReportSelectAll(field, visibleOptions)}>
                                <input type="checkbox" readOnly checked={visibleOptions.length > 0 && visibleOptions.every(v => selectedValues.includes(v))} className="w-3 h-3 text-blue-600 rounded border-gray-300"/>
                                <span className="text-[9px] font-bold text-gray-700">Select All</span>
                            </div>
                            <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                                {visibleOptions.map((val, idx) => (
                                    <label key={idx} className="flex items-center gap-2 px-1.5 py-1 hover:bg-blue-50 cursor-pointer rounded transition-colors">
                                        <input type="checkbox" className="w-3 h-3 text-blue-600 rounded border-gray-300 focus:ring-blue-500" checked={selectedValues.includes(val)} onChange={() => toggleReportFilterValue(field, val)}/>
                                        <span className="text-[9px] text-gray-700 truncate font-medium">{val}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                  </div>
              </div>
          </th>
      );
  };

  return (
    <div className="p-4 h-full overflow-y-auto pb-20 bg-gray-50/50">
      {showWebReport && (
        <div className="fixed inset-0 bg-slate-200/50 backdrop-blur-sm z-[60] flex flex-col font-sans animate-in fade-in duration-200">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-5 py-3 flex justify-between items-center shadow-lg shadow-slate-300/50 z-30 flex-none h-16 rounded-b-2xl mx-2 mt-2">
              <div className="flex items-center gap-3">
                  <div className="bg-white/10 p-2 rounded-xl backdrop-blur-sm"><FileIcon className="w-5 h-5 text-yellow-400"/></div>
                  <div>
                    <h3 className="font-bold text-base tracking-wide text-white">Laporan & Cetak Data</h3>
                    <p className="text-[10px] text-slate-300 font-medium">Download PDF/Excel atau lihat preview tabel.</p>
                  </div>
              </div>
              <button onClick={() => setShowWebReport(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all duration-200 border border-white/5"><X className="w-5 h-5 text-white"/></button>
          </div>

          <div className="bg-white/90 backdrop-blur-md shadow-sm z-20 border border-gray-100 mx-2 mt-2 rounded-2xl flex-none flex flex-col overflow-visible">
              <div className="p-4 flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex flex-wrap gap-3 items-center">
                      <div className="flex items-center bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 shadow-sm">
                          <span className="text-[10px] text-slate-500 font-bold mr-2 uppercase tracking-wider">Periode</span>
                          <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-24 cursor-pointer" />
                          <span className="text-slate-300 mx-1">|</span>
                          <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-24 cursor-pointer" />
                      </div>
                      <div className="relative">
                        <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)} className="appearance-none pl-4 pr-8 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 rounded-full cursor-pointer outline-none transition-all shadow-sm">
                            <option value="General">Laporan Absensi</option>
                            <option value="RunningShift">Running Shift</option>
                            <option value="Tally">Absen Online</option>
                        </select>
                        <ChevronDown className="w-3 h-3 text-indigo-400 absolute right-3 top-2 pointer-events-none"/>
                      </div>
                      {reportCategory === 'General' && (
                          <div className="relative">
                            <select value={reportFormFilter} onChange={(e) => setReportFormFilter(e.target.value)} className="appearance-none pl-4 pr-8 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-full cursor-pointer outline-none transition-all shadow-sm">
                                <option value="All">Semua Form</option>
                                {uniqueForms.filter(t => t !== 'All').map((type, idx) => (<option key={idx} value={type}>{type}</option>))}
                             </select>
                            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-3 top-2 pointer-events-none"/>
                          </div>
                      )}
                  </div>
                  <div className="flex items-center gap-3">
                      <button onClick={async () => { setIsReportLoading(true); try { if (reportCategory === 'RunningShift') await fetchShiftReport(); else await fetchHistory(); } catch (e) { console.error(e); } finally { setTimeout(() => setIsReportLoading(false), 500); } }} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border shadow-sm bg-white text-slate-600 border-slate-200 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 active:scale-95 group">
                          <RefreshCcw className={`w-3.5 h-3.5 transition-transform group-hover:rotate-180 ${isReportLoading ? 'animate-spin text-blue-500' : ''}`} />
                          <span className="hidden sm:inline">Refresh</span>
                      </button>
                      {canViewAll && (
                          <button onClick={() => setShowAdvancedFilter(!showAdvancedFilter)} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border shadow-sm ${showAdvancedFilter ? 'bg-blue-50 text-blue-600 border-blue-200 ring-2 ring-blue-100' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                              <Filter className="w-3.5 h-3.5" /> Filter
                          </button>
                      )}
                      <div className="h-6 w-px bg-slate-200 mx-1"></div>
                      <div className="flex gap-2">
                          <button onClick={generatePDF} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-200 transition-all active:scale-95"><Printer className="w-3.5 h-3.5" /> PDF</button>
                          {(reportCategory === 'RunningShift' || reportCategory === 'Tally' || (reportCategory === 'General' && canViewAll)) && (
                              <button onClick={generateExcel} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-200 transition-all active:scale-95"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
                          )}
                      </div>
                  </div>
              </div>
              {/* Filter Panel content... (same as before) */}
          </div>

          <div className="flex-1 overflow-hidden relative flex flex-col mx-2 mb-2 rounded-b-2xl">
                {isReportLoading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-50 flex flex-col items-center justify-center rounded-2xl">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-2"/>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Loading...</span>
                    </div>
                )}
                
                <div className="flex-1 overflow-auto bg-white border border-gray-300 shadow-sm custom-scrollbar">
                        <table className="w-full whitespace-nowrap border-collapse">
                            <thead className="sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-2 py-3 text-xs font-bold text-center text-gray-700 uppercase bg-gray-100 border border-gray-300 w-10">No</th>
                                    {reportCategory === 'RunningShift' ? (
                                        <>
                                            <ReportFilterHeader label="UserID" field="col_userId" />
                                            <ReportFilterHeader label="PAYROLL" field="col_payroll" />
                                            <ReportFilterHeader label="NAMA" field="nama" width="min-w-[140px]"/>
                                            <ReportFilterHeader label="Posisi" field="divisi" />
                                            <ReportFilterHeader label="Tgl Shift" field="col_date" />
                                            <ReportFilterHeader label="Jam Kerja" field="shiftLabel" />
                                            <ReportFilterHeader label="Waktu Input" field="col_time" />
                                        </>
                                    ) : reportCategory === 'Tally' ? (
                                        <>
                                            <ReportFilterHeader label="UserID" field="col_userId" />
                                            <ReportFilterHeader label="PAYROLL" field="col_payroll" />
                                            <ReportFilterHeader label="NAMA" field="nama" width="min-w-[140px]"/>
                                            <ReportFilterHeader label="Tanggal" field="col_date" />
                                            <ReportFilterHeader label="Posisi" field="divisi" />
                                            <ReportFilterHeader label="Masuk" field="masuk" />
                                            <ReportFilterHeader label="Pulang" field="pulang" />
                                            <ReportFilterHeader label="Standby" field="standby" />
                                            <th className="px-2 py-3 text-xs font-bold text-left text-gray-700 uppercase bg-gray-100 border border-gray-300">Foto</th>
                                            <ReportFilterHeader label="Catatan" field="catatan" width="min-w-[200px]"/>
                                        </>
                                    ) : (
                                        <>
                                            {/* [NEW] KOLOM ACTION (Hanya untuk General Report) */}
                                            {canViewAll && <th className="px-2 py-3 text-xs font-bold text-center text-gray-700 uppercase bg-gray-100 border border-gray-300">ACTION</th>}
                                            <ReportFilterHeader label="UserID" field="col_userId" />
                                            <ReportFilterHeader label="PAYROLL" field="col_payroll" />
                                            <ReportFilterHeader label="NAMA" field="nama" width="min-w-[140px]"/>
                                            <ReportFilterHeader label="Form" field="tipe" />
                                            <ReportFilterHeader label="Waktu Input" field="col_date" />
                                            <ReportFilterHeader label="Periode" field="col_periode" />
                                            <ReportFilterHeader label="Durasi" field="col_durasi" />
                                            <ReportFilterHeader label="Catatan" field="catatan" width="min-w-[250px]"/>
                                            <ReportFilterHeader label="Status" field="status" />
                                            <ReportFilterHeader label="Approval" field="col_approval" />
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                               {sortedReportTable.length === 0 ? (
                                   <tr><td colSpan="14" className="p-12 text-center text-slate-400 italic border border-gray-300">Tidak ada data sesuai filter.</td></tr>
                              ) : (
                                    sortedReportTable.map((item, index) => (
                                    <tr key={index} className="hover:bg-blue-50 transition-colors">
                                        <td className="px-2 py-1.5 text-[11px] text-center text-gray-600 border border-gray-300 bg-gray-50/50 align-top">{index + 1}</td>
                                        {reportCategory === 'RunningShift' ? (
                                            <>
                                                <td className="px-2 py-1.5 text-[11px] font-mono text-gray-700 border border-gray-300 align-top">{item.col_userId}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-mono text-gray-700 border border-gray-300 align-top">{item.col_payroll}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-bold text-gray-800 border border-gray-300 align-top">{item.nama}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-gray-600 border border-gray-300 align-top">{item.divisi}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center text-gray-700 border border-gray-300 align-top">{item.col_date}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center border border-gray-300 align-top">{item.shiftLabel}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center text-gray-500 border border-gray-300 align-top">{item.col_time}</td>
                                            </>
                                        ) : reportCategory === 'Tally' ? (
                                            <>
                                                <td className="px-2 py-1.5 text-[11px] font-mono border border-gray-300 align-top">{item.col_userId}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-mono border border-gray-300 align-top">{item.col_payroll}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-bold border border-gray-300 align-top">{item.nama}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center border border-gray-300 align-top">{item.col_date}</td>
                                                <td className="px-2 py-1.5 text-[11px] border border-gray-300 align-top">{item.divisi}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-bold text-center text-emerald-700 bg-emerald-50/50 border border-gray-300 align-top">{item.masuk}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-bold text-center text-red-700 bg-red-50/50 border border-gray-300 align-top">{item.pulang}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-bold text-center text-amber-700 bg-amber-50/50 border border-gray-300 align-top">{item.standby}</td>
                                                <td className="px-2 py-1.5 text-[11px] border border-gray-300 text-center align-top">{(item.foto && item.foto !== '-') ? (<a href={item.foto} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-bold text-[10px]">Lihat</a>) : '-'}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-gray-600 italic border border-gray-300 whitespace-normal min-w-[200px] align-top">{item.catatan}</td>
                                            </>
                                        ) : (
                                            <>
                                                {/* [NEW] TOMBOL ACTION APPROVE/REJECT */}
                                                {canViewAll && (
                                                    <td className="px-2 py-1.5 text-center border border-gray-300 align-top">
                                                        {item.status === 'Pending' ? (
                                                            <div className="flex gap-1 justify-center">
                                                                <button 
                                                                    onClick={() => handleUpdateStatus(item.uuid, 'Approved')} 
                                                                    className="p-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded border border-emerald-300 transition-colors"
                                                                    title="Approve"
                                                                >
                                                                    <Check className="w-3 h-3" />
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleUpdateStatus(item.uuid, 'Rejected')} 
                                                                    className="p-1 bg-red-100 hover:bg-red-200 text-red-700 rounded border border-red-300 transition-colors"
                                                                    title="Reject"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-[9px] text-gray-400 font-medium">-</span>
                                                        )}
                                                    </td>
                                                )}
                                                
                                                <td className="px-2 py-1.5 text-[11px] font-mono text-gray-600 border border-gray-300 align-top">{item.col_userId}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-mono text-gray-600 border border-gray-300 align-top">{item.col_payroll}</td>
                                                <td className="px-2 py-1.5 text-[11px] font-bold text-gray-800 border border-gray-300 align-top">{item.nama}</td>
                                                <td className="px-2 py-1.5 text-[11px] border border-gray-300 align-top">{item.tipe}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center text-gray-600 border border-gray-300 align-top">{item.col_date}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center text-gray-700 border border-gray-300 align-top">{item.col_periode}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center text-gray-800 font-bold border border-gray-300 align-top">{item.col_durasi}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-gray-600 italic border border-gray-300 whitespace-normal min-w-[200px] align-top">{item.catatan}</td>
                                                <td className="px-2 py-1.5 text-[11px] text-center border border-gray-300 align-top"><span className={`font-bold ${item.status === 'Approved' ? 'text-green-700' : (item.status === 'Rejected' ? 'text-red-700' : 'text-amber-700')}`}>{item.status}</span></td>
                                                <td className="px-2 py-1.5 text-[11px] text-center text-gray-500 border border-gray-300 align-top">{item.col_approval}</td>
                                            </>
                                        )}
                                    </tr>
                                   ))
                              )}
                            </tbody>
                        </table>
                </div>
                <div className="bg-gray-100 px-4 py-2 border border-gray-300 border-t-0 flex justify-between items-center rounded-b-2xl mt-0">
                     <span className="text-[10px] text-gray-500 font-bold">Total Data: {sortedReportTable.length}</span>
                     <div className="text-[10px] text-gray-400 italic">E-Absensi System</div>
                </div>
          </div>
        </div>
      )}
      
      {/* --- MAIN PAGE CONTENT (RIWAYAT CARD VIEW) --- */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
           <h2 className="text-xl font-bold ml-2 text-slate-800">Riwayat & Laporan</h2>
           {loading && <span className="text-[10px] text-slate-400 font-normal animate-pulse">Updating...</span>}
        </div>

        <div className="flex items-center gap-2">
            <button onClick={() => { fetchHistory(); if(canViewAll) fetchUsers(); }} disabled={loading} className="p-2.5 bg-white text-blue-600 rounded-xl border border-blue-100 hover:bg-blue-50 active:scale-95 transition-all shadow-sm flex items-center justify-center">
                <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <BackButton onClick={() => setView('dashboard')} />
        </div>
      </div>

      {/* --- KARTU FILTER --- */}
      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-200 mb-3">
        <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider"><Filter className="w-3.5 h-3.5 text-slate-400" /> Filter Data</div>
        {canViewAll && (
            <div className="grid grid-cols-2 gap-2 mb-2">
                {isSuperAdmin && (
                    <div>
                        <label className="text-[9px] font-bold text-slate-400 block mb-0.5">Lokasi</label>
                        <div className="relative">
                            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-semibold text-slate-700 bg-white appearance-none focus:ring-1 focus:ring-blue-100 outline-none"><option value="All">Semua Lokasi</option><option value="Surabaya">Surabaya</option><option value="Jakarta">Jakarta</option></select>
                            <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2 pointer-events-none"/>
                        </div>
                    </div>
                )}
                <div className={isSuperAdmin ? "" : "col-span-2"}>
                    <label className="text-[9px] font-bold text-slate-400 block mb-0.5">Karyawan ({selectedUserIds.length})</label>
                    <div className="relative">
                        <button onClick={() => setShowAdvancedFilter(!showAdvancedFilter)} className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-semibold text-slate-700 bg-white flex justify-between items-center focus:ring-1 focus:ring-blue-100"><span className="truncate">{selectedUserIds.length > 0 ? `${selectedUserIds.length} Dipilih` : 'Semua Karyawan'}</span><ChevronDown className="w-3 h-3 text-gray-400"/></button>
                        {showAdvancedFilter && (
                            <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200 shadow-xl rounded-lg z-20 p-2">
                                <input type="text" placeholder="Cari nama..." value={searchUser} onChange={(e) => setSearchUser(e.target.value)} className="w-full p-1.5 text-xs border border-gray-200 rounded mb-2 outline-none focus:border-blue-300"/>
                                <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar">
                                    <div onClick={selectAllUsers} className="p-1.5 hover:bg-blue-50 rounded cursor-pointer text-xs font-bold text-blue-600">{selectedUserIds.length > 0 ? 'Reset Pilihan' : 'Pilih Semua'}</div>
                                    {allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).map(u => (
                                        <div key={u.id} onClick={() => toggleUserSelection(u.id)} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer"><input type="checkbox" checked={selectedUserIds.includes(u.id)} readOnly className="w-3 h-3 rounded text-blue-600"/><span className="text-xs text-slate-600 truncate">{u.nama}</span></div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2"> 
          <div><label className="text-[9px] font-bold text-slate-400 block mb-0.5">Dari Tanggal</label><input type="date" className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-semibold text-slate-700 focus:ring-1 focus:ring-blue-100 outline-none" value={filterStart} onChange={e => setFilterStart(e.target.value)} /></div> 
          <div><label className="text-[9px] font-bold text-slate-400 block mb-0.5">Sampai Tanggal</label><input type="date" className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-semibold text-slate-700 focus:ring-1 focus:ring-blue-100 outline-none" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></div> 
        </div>
        <div className="grid grid-cols-2 gap-2"> 
             <div><label className="text-[9px] font-bold text-slate-400 block mb-0.5">Tipe Absen</label><div className="relative"><select className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-semibold text-slate-700 bg-white appearance-none focus:ring-1 focus:ring-blue-100 outline-none" value={filterType} onChange={(e) => setFilterType(e.target.value)}>{uniqueTypes.map((t, i) => ( <option key={i} value={t}>{t === 'All' ? 'Semua Form' : t}</option> ))}</select><ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2 pointer-events-none"/></div></div>
             <div><label className="text-[9px] font-bold text-slate-400 block mb-0.5">Status Approval</label><div className="relative"><select className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-semibold text-slate-700 bg-white appearance-none focus:ring-1 focus:ring-blue-100 outline-none" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="All">Semua Status</option><option value="Pending">Pending</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option><option value="Verified">Verified</option></select><ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2 pointer-events-none"/></div></div>
        </div>
      </div>

      <button onClick={() => setShowWebReport(true)} className="w-full mb-4 flex items-center justify-center gap-2 p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all text-xs font-bold shadow-md shadow-indigo-200 active:scale-[0.98]">
          <Eye className="w-4 h-4" /> MENU LAPORAN
      </button>

      {/* --- HISTORY LIST (CARD VIEW) --- */}
      {loading ? (
          <div className="flex flex-col items-center justify-center py-10"><Loader2 className="w-8 h-8 text-slate-300 animate-spin mb-2"/><p className="text-xs font-bold text-slate-400">Memuat Riwayat...</p></div>
      ) : (
        <div className="space-y-2">
          {displayData.map((item, idx) => {
            const canEdit = isEditable(item.waktu, item.status);
            const isRegularAbsen = item.tipe === 'Hadir' || item.tipe === 'Pulang';
            const showResendButton = APPROVAL_TYPES.includes(item.tipe) && item.status === 'Pending' && !canViewAll;
            return (
              <div key={idx} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm relative group transition-all hover:border-blue-200">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                        {canViewAll ? (
                            <><h4 className="font-bold text-slate-800 text-sm leading-tight">{item.nama}</h4><div className="flex items-center gap-1.5 mt-1"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${item.tipe === 'Sakit' ? 'bg-orange-400' : (item.tipe === 'Cuti' ? 'bg-pink-400' : 'bg-blue-500')}`}>{item.tipe}</span><span className="text-[10px] text-slate-400 font-medium">• {formatDateShort(item.waktu)}</span></div></>
                        ) : (
                            <><h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">{item.tipe}</h4><div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-400 font-medium"><Clock className="w-3 h-3"/> {formatDateIndo(item.waktu)}</div></>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        {!isRegularAbsen && <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${getStatusColor(item.status)}`}>{item.status || 'Pending'}</span>}
                        {isRegularAbsen && <span className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full font-mono">{formatTimeOnly(item.waktu)}</span>}
                        {canEdit && !canViewAll && (
                            <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEdit(item)} className="p-1 bg-yellow-50 text-yellow-600 rounded border border-yellow-100 hover:bg-yellow-100" title="Edit"><Edit className="w-3 h-3"/></button>
                                <button onClick={() => handleDelete(item.uuid)} className="p-1 bg-red-50 text-red-600 rounded border border-red-100 hover:bg-red-100" title="Hapus"><Trash2 className="w-3 h-3"/></button>
                            </div>
                        )}
                    </div>
                </div>
                {(item.catatan || (item.alasan && item.status === 'Rejected') || item.tglMulai) && (
                    <div className="mt-2 pt-2 border-t border-dashed border-gray-100 text-xs">
                        {item.status === 'Rejected' && item.alasan && <p className="text-red-600 italic mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> {item.alasan}</p>}
                        {(item.tglMulai && item.tglMulai !== '-') && <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded w-fit mb-1"><CalendarDays className="w-3 h-3"/> {formatDateShort(item.tglMulai)} - {formatDateShort(item.tglSelesai)}</div>}
                        {item.catatan && <p className="text-slate-500 italic">"{item.catatan}"</p>}
                    </div>
                )}
                <div className="flex gap-2 mt-2">
                    {item.foto && item.foto.length > 10 && item.foto !== 'Error Upload' && <a href={item.foto} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[9px] font-bold text-blue-600 hover:underline"><Camera className="w-3 h-3"/> Foto</a>}
                    {item.lampiran && item.lampiran.length > 10 && item.lampiran !== '-' && <a href={item.lampiran} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[9px] font-bold text-orange-600 hover:underline"><FileIcon className="w-3 h-3"/> Lampiran</a>}
                </div>
                {showResendButton && <button onClick={() => handleRequestApproval(item)} disabled={sendingEmail} className="w-full mt-2 bg-purple-50 text-purple-700 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-purple-100 border border-purple-200 transition-colors">{sendingEmail ? 'Mengirim...' : <><CheckSquare className="w-3 h-3"/> Kirim Ulang Email</>}</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- 6. ADMIN PANEL (FIX: MENAMBAHKAN MENU ANALISA DATA) ---
function AdminPanel({ user, setView, masterData }) {
  const [activeTab, setActiveTab] = useState('user'); 
  const [loading, setLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false); 
  
  // State Reset Password
  const [adminUserList, setAdminUserList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingList, setLoadingList] = useState(false);

  // State Lainnya
  const [newsInput, setNewsInput] = useState('');
  const [userData, setUserData] = useState({ 
    username: '', password: '', nama: '', email: '', 
    divisi: 'Staff', role: 'karyawan', akses: [], 
    noPayroll: '', sisaCuti: '', perusahaan: '', 
    statusKaryawan: '', emailAtasan: '', lokasi: 'Surabaya' 
  });
  const [masterInput, setMasterInput] = useState({ kategori: 'Menu', value: '', label: '' });

  const LIST_LOKASI = ['Surabaya', 'Jakarta', 'Semarang', 'Cilegon', 'Citeureup', 'Makassar', 'Balikpapan', 'Medan', 'All'];

  // Logic Fetch User
  const fetchAdminUserList = async () => {
    setLoadingList(true);
    try {
      const res = await fetchApi(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_user_list_admin', roleRequester: user.role })
      });
      const data = await res.json();
      if (data.result === 'success') { setAdminUserList(data.list); }
    } catch (e) { console.error("Gagal load user"); }
    finally { setLoadingList(false); }
  };

  useEffect(() => {
    if (activeTab === 'master_user') fetchAdminUserList();
  }, [activeTab]);

  const handleResetPassword = async (uuid, namaUser) => {
    if(!window.confirm(`Reset password "${namaUser}" jadi "123"?`)) return;
    setLoading(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'reset_password_user', roleRequester: user.role, targetUuid: uuid }) });
      const data = await res.json();
      alert(data.message);
    } catch (e) { alert("Gagal koneksi."); } finally { setLoading(false); }
  };

  const handleLocationChange = (loc) => {
     let currentLocs = userData.lokasi ? userData.lokasi.split(',').map(l=>l.trim()).filter(l=>l!=='') : [];
     if (currentLocs.includes(loc)) { currentLocs = currentLocs.filter(l => l !== loc); } 
     else { if(loc === 'All') { currentLocs = ['All']; } else { currentLocs = currentLocs.filter(l => l !== 'All'); currentLocs.push(loc); } }
     setUserData({ ...userData, lokasi: currentLocs.join(', ') });
  };
  const handleCheckboxChange = (val) => { 
    setUserData(prev => { const current = prev.akses; return current.includes(val) ? { ...prev, akses: current.filter(i => i !== val) } : { ...prev, akses: [...current, val] }; });
  };
  const handleAddUser = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'tambah_user', roleRequester: user.role, ...userData }) }).then(r => r.json());
      if(res.result === 'success') { alert('User Ditambahkan!'); setUserData({ username: '', password: '', nama: '', email: '', divisi: 'Staff', role: 'karyawan', akses: [], noPayroll: '', sisaCuti: '', perusahaan: '', statusKaryawan: '', emailAtasan: '', lokasi: 'Surabaya' }); } 
      else { alert(res.message); }
    } catch(e) { alert('Error koneksi'); } finally { setLoading(false); }
  };
  const handleAddMaster = async (e) => { 
    e.preventDefault(); setLoading(true);
    try { const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'tambah_master', roleRequester: user.role, ...masterInput }) }).then(r=>r.json());
      if(res.result === 'success') { alert('Data Ditambah!'); setMasterInput({ kategori: 'Menu', value: '', label: '' }); } else alert(res.message); 
    } catch(e) { alert('Error'); } finally { setLoading(false); } 
  };
  const handleAddAnnouncement = async () => {
    if (!newsInput.trim()) return alert("Isi kosong!");
    setLoading(true);
    try {
      const res = await fetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'tambah_announcement', roleRequester: user.role, isi: newsInput }) }).then(r => r.json());
      if (res.result === 'success') { alert("Terbit!"); setNewsInput(''); } else { alert(res.message); }
    } catch (e) { alert("Gagal koneksi."); } finally { setLoading(false); }
  };

  const filteredUsers = adminUserList.filter(u => 
    u.nama.toLowerCase().includes(searchQuery.toLowerCase()) || 
    String(u.username).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const switchTab = (tabName) => { setActiveTab(tabName); setIsMenuOpen(false); };

  // Satu gaya input untuk seluruh panel — sebelumnya tiap tab memakai
  // padding, radius, dan warna border yang berbeda-beda.
  const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-shadow focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5";

  const getPageTitle = () => {
      switch(activeTab) {
          case 'user': return 'Tambah User Baru';
          case 'master_user': return 'Master User (Reset)';
          case 'master': return 'Master Data';
          case 'import_db': return 'Import Data Mesin Absen';
          case 'news': return 'Broadcast Info HRD';
          default: return 'Admin Panel';
      }
  };

  return (
    <div className="p-4 h-full overflow-y-auto pb-20 bg-gray-50 min-h-screen">
      
      {/* HEADER */}
      <div className="flex items-start justify-between mb-5 relative z-40">
        <div className="pt-0.5">
            <p className="text-[11px] font-medium text-slate-400 tracking-tight">Admin panel</p>
            <h2 className="text-[19px] font-semibold text-slate-900 tracking-tight leading-tight">{getPageTitle()}</h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
            <BackButton onClick={() => setView('dashboard')} />

            {/* DROPDOWN MENU */}
            <div className="relative">
                <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    aria-expanded={isMenuOpen}
                    className={`flex items-center gap-2 pl-3.5 pr-2.5 py-2.5 rounded-xl text-[13px] font-medium border transition-colors
                        ${isMenuOpen ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                    Menu
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
                </button>

                {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-[248px] bg-white rounded-xl border border-slate-200 shadow-lg shadow-slate-900/5 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right">

                        {/* Dikelompokkan per urusan: pengguna, lalu data, lalu komunikasi.
                            Sebelumnya enam item berderet tanpa pemisah. */}
                        <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Pengguna</p>

                        <button onClick={() => switchTab('user')} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left transition-colors ${activeTab === 'user' ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <UserRoundPlus className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'user' ? 'text-slate-900' : 'text-slate-400'}`} strokeWidth={1.75}/>
                            <span className="flex-1 leading-tight">Tambah user baru</span>
                            {activeTab === 'user' && <Check className="w-3.5 h-3.5 shrink-0 text-slate-900" strokeWidth={2.5}/>}
                        </button>

                        <button onClick={() => switchTab('master_user')} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left transition-colors ${activeTab === 'master_user' ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <KeyRound className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'master_user' ? 'text-slate-900' : 'text-slate-400'}`} strokeWidth={1.75}/>
                            <span className="flex-1 leading-tight">Reset password user</span>
                            {activeTab === 'master_user' && <Check className="w-3.5 h-3.5 shrink-0 text-slate-900" strokeWidth={2.5}/>}
                        </button>

                        {user.role === 'admin' && (
                        <>
                            <p className="px-3.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 border-t border-slate-100 mt-1">Data</p>

                            <button onClick={() => setView('analysis')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left text-slate-600 hover:bg-slate-50 transition-colors">
                                <ChartColumn className="w-[17px] h-[17px] shrink-0 text-slate-400" strokeWidth={1.75}/>
                                <span className="flex-1 leading-tight">Analisa data</span>
                            </button>

                            <button onClick={() => switchTab('master')} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left transition-colors ${activeTab === 'master' ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                                <Database className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'master' ? 'text-slate-900' : 'text-slate-400'}`} strokeWidth={1.75}/>
                                <span className="flex-1 leading-tight">Master data</span>
                                {activeTab === 'master' && <Check className="w-3.5 h-3.5 shrink-0 text-slate-900" strokeWidth={2.5}/>}
                            </button>

                            <button onClick={() => switchTab('import_db')} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left transition-colors ${activeTab === 'import_db' ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                                <FileUp className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'import_db' ? 'text-slate-900' : 'text-slate-400'}`} strokeWidth={1.75}/>
                                <span className="flex-1 leading-tight">Import data mesin absen</span>
                                {activeTab === 'import_db' && <Check className="w-3.5 h-3.5 shrink-0 text-slate-900" strokeWidth={2.5}/>}
                            </button>
                        </>
                        )}

                        <p className="px-3.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 border-t border-slate-100 mt-1">Komunikasi</p>

                        <button onClick={() => switchTab('news')} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 mb-1 text-[13px] text-left transition-colors ${activeTab === 'news' ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <Megaphone className={`w-[17px] h-[17px] shrink-0 ${activeTab === 'news' ? 'text-slate-900' : 'text-slate-400'}`} strokeWidth={1.75}/>
                            <span className="flex-1 leading-tight">Info HRD</span>
                            {activeTab === 'news' && <Check className="w-3.5 h-3.5 shrink-0 text-slate-900" strokeWidth={2.5}/>}
                        </button>
                    </div>
                )}
            </div>
        </div>
      </div>

      {isMenuOpen && <div className="fixed inset-0 z-30 bg-transparent" onClick={() => setIsMenuOpen(false)} />}

      {/* KONTEN TAB: MASTER USER */}
      {activeTab === 'master_user' && (
        <div className="animate-in fade-in duration-300">
           <div className="relative mb-3">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={1.75} />
              <input type="text" placeholder="Cari nama atau ID finger" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`${inputCls} pl-9`} />
           </div>
           {loadingList ? ( <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin"/></div> ) : (
             <div className="bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-100 overflow-hidden">
               {filteredUsers.length === 0 && (
                  <p className="px-4 py-10 text-center text-[13px] text-slate-400">Tidak ada user yang cocok.</p>
               )}
               {filteredUsers.map((u, idx) => (
                 <div key={idx} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                       <p className="text-[14px] font-medium text-slate-900 tracking-tight truncate">{u.nama}</p>
                       <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">ID {u.username}</p>
                    </div>
                    <button onClick={() => handleResetPassword(u.uuid, u.nama)} disabled={loading} className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-rose-600 hover:border-rose-200 active:bg-slate-100 disabled:opacity-50 transition-colors">
                      <RefreshCcw className="w-3.5 h-3.5" strokeWidth={1.75} /> Reset
                    </button>
                 </div>
               ))}
             </div>
           )}
        </div>
      )}

      {/* KONTEN TAB: TAMBAH USER */}
      {activeTab === 'user' && (
        <div className="animate-in fade-in duration-300">
          {/* Setiap kolom kini punya label tetap. Sebelumnya nama kolom hanya ada
              di placeholder, jadi hilang begitu kolomnya diisi. */}
          <form onSubmit={handleAddUser} className="bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-100 overflow-hidden">

            <div className="p-4 space-y-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Identitas</p>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Nama karyawan</label>
                        <input required type="text" className={inputCls} value={userData.nama} onChange={e => setUserData({...userData, nama: e.target.value})} placeholder="Budi Santoso" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Email</label>
                        <input required type="email" className={inputCls} value={userData.email} onChange={e => setUserData({...userData, email: e.target.value})} placeholder="budi@jpt.co.id" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">ID finger</label>
                        <input required type="text" className={`${inputCls} tabular-nums`} value={userData.username} onChange={e => setUserData({...userData, username: e.target.value})} placeholder="1024" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Password awal</label>
                        <input required type="text" className={inputCls} value={userData.password} onChange={e => setUserData({...userData, password: e.target.value})} placeholder="Minimal 6 karakter" />
                    </div>
                </div>

                <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Email atasan untuk approval</label>
                    <input type="email" className={inputCls} value={userData.emailAtasan} onChange={e => setUserData({...userData, emailAtasan: e.target.value})} placeholder="manager@jpt.co.id" />
                    <p className="mt-1.5 text-[11px] text-slate-400">Kosongkan bila pengajuan user ini tidak perlu approval.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Divisi</label>
                        <select className={inputCls} value={userData.divisi} onChange={e => setUserData({...userData, divisi: e.target.value})}>{masterData.divisions.map((d, i) => <option key={i} value={d.value}>{d.label}</option>)}</select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Role</label>
                        <select className={inputCls} value={userData.role} onChange={e => setUserData({...userData, role: e.target.value})}>{masterData.roles.map((r, i) => <option key={i} value={r.value}>{r.label}</option>)}</select>
                    </div>
                </div>
            </div>

            <div className="p-4">
                <div className="flex items-baseline justify-between mb-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Akses lokasi</p>
                    <span className="text-[11px] text-slate-400 tabular-nums">{(userData.lokasi || []).length} dipilih</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                  {LIST_LOKASI.map((loc) => (
                    <label key={loc} className="flex items-center gap-2.5 py-1.5 text-[13px] text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={userData.lokasi && userData.lokasi.includes(loc)} onChange={() => handleLocationChange(loc)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20" />
                        {loc}
                    </label>
                  ))}
                </div>
            </div>

            <div className="p-4">
                <div className="flex items-baseline justify-between mb-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Akses menu</p>
                    <span className="text-[11px] text-slate-400 tabular-nums">{(userData.akses || []).length} dipilih</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {masterData.menus.map(item => (
                    <label key={item.value} className="flex items-center gap-2.5 py-1.5 text-[13px] text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={userData.akses.includes(item.value)} onChange={() => handleCheckboxChange(item.value)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20" />
                        {item.label}
                    </label>
                  ))}
                </div>
            </div>

            <div className="p-4 bg-slate-50/60">
                <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3 rounded-xl text-[14px] font-medium hover:bg-slate-800 active:bg-slate-950 disabled:opacity-60 transition-colors">
                    {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
                    {loading ? 'Menyimpan…' : 'Simpan user baru'}
                </button>
            </div>
          </form>
        </div>
      )}

      {/* KONTEN TAB: MASTER DATA */}
      {activeTab === 'master' && (
        <div className="animate-in fade-in duration-300">
          <form onSubmit={handleAddMaster} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
            <div className="p-4 space-y-3.5">
                <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Kategori</label>
                    <select className={inputCls} value={masterInput.kategori} onChange={e => setMasterInput({...masterInput, kategori: e.target.value})}>
                        <option value="Menu">Menu absensi</option><option value="Role">Role user</option><option value="Divisi">Divisi</option><option value="Shift">Jam shift</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Value</label>
                    <input required type="text" className={inputCls} value={masterInput.value} onChange={e => setMasterInput({...masterInput, value: e.target.value})} placeholder="Nilai yang disimpan sistem" />
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Label</label>
                    <input required type="text" className={inputCls} value={masterInput.label} onChange={e => setMasterInput({...masterInput, label: e.target.value})} placeholder="Teks yang dilihat pengguna" />
                </div>
            </div>
            <div className="p-4 pt-0">
                <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3 rounded-xl text-[14px] font-medium hover:bg-slate-800 disabled:opacity-60 transition-colors">
                    {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
                    {loading ? 'Menyimpan…' : 'Tambah data'}
                </button>
            </div>
          </form>
        </div>
      )}

      {/* KONTEN TAB: IMPORT dbabsen */}
      {activeTab === 'import_db' && user.role === 'admin' && (
        <ImportDbAbsen user={user} />
      )}

      {/* KONTEN TAB: INFO HRD */}
      {activeTab === 'news' && (
        <div className="animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
            <div className="p-4">
                <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Isi pengumuman</label>
                <textarea className={`${inputCls} resize-y leading-relaxed`} rows="6" placeholder="Tulis informasi yang akan tampil di dashboard semua karyawan…" value={newsInput} onChange={(e) => setNewsInput(e.target.value)}></textarea>
                <p className="mt-1.5 text-[11px] text-slate-400">Muncul sebagai popup satu kali per sesi login.</p>
            </div>
            <div className="p-4 pt-0">
                <button onClick={handleAddAnnouncement} disabled={loading || !newsInput.trim()} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3 rounded-xl text-[14px] font-medium hover:bg-slate-800 disabled:opacity-40 transition-colors">
                    {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
                    {loading ? 'Menerbitkan…' : 'Terbitkan'}
                </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- 7. LOGIN SCREEN (MODERN & DYNAMIC LIGHT THEME) ---
function LoginScreen({ onLogin }) { 
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); 
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(null); // Untuk efek fokus input

  const handleSubmit = async (e) => { 
    e.preventDefault(); 
    setLoading(true);
    try { 
      const response = await fetchApi(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ action: 'login', username, password }) 
      });
      const data = await response.json(); 
      if (data.result === 'success' && data.user) {
        // data.stats / data.pengumuman boleh tidak ada (backend lama) atau
        // null (gagal dihitung di server). Dashboard menanganinya dengan
        // mengambil sendiri, persis seperti perilaku sebelum perubahan ini.
        onLogin(
          data.user,
          data.masterData || [],
          data.version,
          data.stats,
          data.pengumuman,
          data.pengumumanDisertakan === true
        );
      } else {
        alert(data.message || 'Login Gagal');
      }
    } catch (err) { 
      alert('Gagal koneksi server.');
    } finally { 
      setLoading(false); 
    } 
  };

  return ( 
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden font-sans">
      
      {/* --- BACKGROUND ANIMATION (Modern Light Blobs) --- */}
      {/* Blob Biru Muda - Bergerak lambat */}
      <div className="absolute -top-20 -left-20 w-96 h-96 bg-blue-200/40 rounded-full blur-3xl animate-[pulse_8s_ease-in-out_infinite]"></div>
      {/* Blob Cyan - Bergerak lambat */}
      <div className="absolute top-40 right-0 w-72 h-72 bg-cyan-200/30 rounded-full blur-3xl animate-[bounce_10s_infinite]"></div>
      {/* Blob Ungu Tipis - Bawah */}
      <div className="absolute -bottom-20 left-20 w-80 h-80 bg-indigo-200/30 rounded-full blur-3xl animate-[pulse_6s_ease-in-out_infinite]"></div>

      {/* --- CARD CONTAINER (Glassmorphism Light) --- */}
      <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl shadow-blue-100/50 w-full max-w-[380px] border border-white/60 relative z-10 transform transition-all duration-500 hover:shadow-blue-200/50">
        
        {/* HEADER & ANIMATED LOGO */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative group cursor-pointer">
            {/* Lingkaran Luar Berputar */}
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-cyan-400 rounded-full blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            
            <div className="relative bg-white p-5 rounded-3xl shadow-lg border border-slate-50 flex items-center justify-center overflow-hidden w-24 h-24 group-hover:scale-105 transition-transform duration-300">
               {/* Garis Scan Animasi */}
               <div className="absolute w-full h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent top-0 animate-[scan_2.5s_linear_infinite]"></div>
               <div className="absolute w-full h-full bg-blue-500/5 top-0 animate-[scan_2.5s_linear_infinite]"></div>
               
               <ScanFace className="w-10 h-10 text-slate-700 relative z-10" />
            </div>

            {/* Status Badge Kecil */}
            <div className="absolute -bottom-2 -right-2 bg-white p-1.5 rounded-full shadow-md border border-slate-100">
              <div className="bg-emerald-500 w-3 h-3 rounded-full animate-pulse"></div>
            </div>
          </div>
          
          <div className="text-center mt-6">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Welcome Back</h2>
            <p className="text-slate-500 text-xs font-medium mt-1">Sistem Absensi Terintegrasi</p>
          </div>
        </div>

        {/* FORM INPUT */}
        <form onSubmit={handleSubmit} className="space-y-5">
          
          {/* Input ID Fingerprint */}
          <div className={`group relative transition-all duration-300 rounded-2xl border bg-white ${focused === 'user' ? 'border-blue-500 ring-4 ring-blue-500/10 shadow-lg shadow-blue-500/10' : 'border-slate-200 shadow-sm'}`}>
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
               <div className={`p-1.5 rounded-lg transition-colors duration-300 ${focused === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400'}`}>
                 <Smartphone className="h-4 w-4" />
               </div>
            </div>
            <input 
              type="text" 
              value={username} 
              onFocus={() => setFocused('user')}
              onBlur={() => setFocused(null)}
              onChange={e => setUsername(e.target.value)} 
              className="block w-full pl-12 pr-4 py-4 bg-transparent rounded-2xl text-sm font-bold text-slate-700 placeholder-slate-400 focus:outline-none transition-colors" 
              placeholder="ID Fingerprint" 
              required 
            />
          </div>

          {/* Input Password */}
          <div className={`group relative transition-all duration-300 rounded-2xl border bg-white ${focused === 'pass' ? 'border-blue-500 ring-4 ring-blue-500/10 shadow-lg shadow-blue-500/10' : 'border-slate-200 shadow-sm'}`}>
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
               <div className={`p-1.5 rounded-lg transition-colors duration-300 ${focused === 'pass' ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400'}`}>
                 <Key className="h-4 w-4" />
               </div>
            </div>
            <input 
              type="password" 
              value={password} 
              onFocus={() => setFocused('pass')}
              onBlur={() => setFocused(null)}
              onChange={e => setPassword(e.target.value)} 
              className="block w-full pl-12 pr-4 py-4 bg-transparent rounded-2xl text-sm font-bold text-slate-700 placeholder-slate-400 focus:outline-none transition-colors" 
              placeholder="Kata Sandi" 
              required 
            />
          </div>

          {/* Tombol Login */}
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full py-4 px-4 rounded-2xl text-white font-bold text-sm bg-slate-900 hover:bg-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/30 shadow-xl shadow-slate-200 transform transition-all duration-300 hover:-translate-y-1 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed group relative overflow-hidden"
          >
            {/* Efek Kilap pada Button */}
            <div className="absolute top-0 -left-full w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:animate-[shimmer_1.5s_infinite]"></div>
            
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-200" />
                <span>Sedang Memproses...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <span>Masuk Aplikasi</span>
                <ChevronDown className="w-4 h-4 -rotate-90 group-hover:translate-x-1 transition-transform" />
              </div>
            )}
          </button>
        </form>
        
        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-[10px] text-slate-400 font-medium">
            &copy; {new Date().getFullYear()} JPT Group &bull; IT Support Dept.
          </p>
          <div className="w-10 h-1 bg-slate-100 rounded-full mx-auto mt-3"></div>
        </div>
      </div>
      
      {/* --- INJECT KEYFRAMES STYLE KHUSUS LOGIN --- */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes shimmer {
          100% { left: 100%; }
        }
      `}</style>
    </div> 
  );
}

// --- 8. CHANGE PASSWORD SCREEN (TIDAK BERUBAH) ---
function ChangePasswordScreen({ user, setView }) { 
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState(''); 
  const [loading, setLoading] = useState(false);
  const handleChangePassword = async (e) => { 
    e.preventDefault(); 
    setLoading(true);
    try { 
      const res = await fetchApi(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ action: 'ganti_password', id: user.id, oldPassword, newPassword }) 
      }).then(r => r.json());
      if (res.result === 'success') { 
        alert('Password berhasil diubah!'); 
        setView('dashboard');
      } else { 
        alert(res.message);
      } 
    } catch (err) { 
      alert('Gagal menghubungi server.');
    } finally { 
      setLoading(false); 
    } 
  };
  return ( 
    <div className="p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold ml-2">Ganti Password</h2>
        <BackButton onClick={() => setView('dashboard')} />
      </div>
      
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
        <form onSubmit={handleChangePassword} className="space-y-4">
          <input required type="password" className="w-full p-2 border rounded" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="Password Lama" />
          <input required type="password" className="w-full p-2 border rounded" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Password Baru" />
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-blue-700">{loading ? 'Memproses...' : 'Ubah Password'}</button>
        </form>
      </div>
    </div> 
  );
}

// --- 9. DB ABSEN SCREEN (FIXED FILTER HADIR GABUNGAN & BUTTON AUTO-FILL) ---
function DbAbsenScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ijinCount, setIjinCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null); 

  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showFilter, setShowFilter] = useState(false);
  
  // DAFTAR KODE YANG MEMICU TOMBOL 'AJUKAN IJIN'
  const TARGET_CODES = ['T', 'TSi', 'TSo', 'Si', 'So'];

  // --- CEK AUTO FILTER DARI DASHBOARD ---
  useEffect(() => {
      const autoFilter = localStorage.getItem('dbAbsenFilter');
      if (autoFilter) {
          setFilterStatus(autoFilter); 
          setShowFilter(true); // Buka panel filter otomatis
          localStorage.removeItem('dbAbsenFilter');
      }
  }, []);

  const KETERANGAN_MAP = {
      'H': 'Hadir', 'T': 'Terlambat', 'O': 'Off / Libur', 'CB': 'Cuti Bersama',
      'PC': 'Pulang Cepat', 'Si': 'Tdk Absen IN', 'So': 'Tdk Absen OUT',
      'I': 'Ijin', 'S': 'Sakit', 'C': 'Cuti', 'A': 'Alpa',
      'DL': 'Dinas Luar', 'TPC': 'Telat & Pulang Cepat', 'TSo': 'Telat & Tdk Absen OUT',
      'TSi': 'Telat & No Scan In', 'SiSo': 'Tdk Absen IN & OUT',
      'SiPC': 'Tdk Absen IN & Pulang Cepat', 'AC': 'Alpa (Lebih Cuti)',
      'EO': 'Extra Ordinary', 'NF': 'Tidak Absen'
  };
  
  const availableStatusOptions = [...new Set(list.map(item => item.symbol))]
      .filter(s => s && s.trim() !== '')
      .sort();

  const calculateTimeAgo = (isoDateString) => {
    if (!isoDateString || isoDateString === '-') return '-';
    try {
        const now = new Date();
        const past = new Date(isoDateString);
        const diffMs = now - past; 
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

        if (diffMinutes < 1) return 'Baru saja update';
        if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;
        if (diffHours < 24) {
            const sisaMenit = diffMinutes % 60;
            if (sisaMenit === 0) return `${diffHours} jam yang lalu`;
            return `${diffHours} jam ${sisaMenit} menit yang lalu`;
        }
        return past.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit'});
    } catch (e) { return '-'; }
  };

  useEffect(() => {
    // Layar ini hanya butuh SATU angka: ijin_count. Dulu ia menembak
    // get_stats sendiri untuk mendapatkannya — satu request penuh (POST +
    // 302 redirect + boot container Apps Script) yang mengantre di belakang
    // get_db_absen di bawah, padahal Dashboard baru saja memegang angka itu.
    //
    // Sekarang dipakai ulang dari sessionStorage yang diisi Dashboard.
    // Request hanya ditembak kalau nilainya benar-benar belum ada
    // (misal user membuka layar ini tanpa lewat Dashboard).
    const dariCache = (() => {
      try {
        const raw = sessionStorage.getItem('app_stats_terakhir');
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    })();

    if (dariCache) {
      setIjinCount(dariCache.ijin_count || 0);
      return;
    }

    const fetchStats = async () => {
        try {
            const res = await fetchApi(SCRIPT_URL, {
                method: 'POST', body: JSON.stringify({ action: 'get_stats', userId: user.id })
            });
            const data = await res.json();
            if (data.result === 'success') setIjinCount(data.stats.ijin_count || 0);
        } catch (e) { console.error("Gagal load stats"); }
    };
    if (user) fetchStats();
  }, [user]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetchApi(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'get_db_absen', userId: user.id, noPayroll: user.noPayroll }) 
        });
        const data = await res.json();
        if (data.result === 'success') {
             setList(data.list);
             setLastUpdate(data.lastUpdate); 
        } else {
             alert(data.message);
        }
      } catch (e) { console.error(e); alert("Gagal memuat data mesin."); } finally { setLoading(false); }
    };
    if (user) fetchData();
  }, [user]);

  const parseDate = (dateStr) => {
      if (!dateStr) return null;
      try {
          if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return new Date(dateStr);
          const parts = dateStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
          if (parts) return new Date(`${parts[3]}-${parts[2]}-${parts[1]}`);
          return new Date(dateStr);
      } catch (e) { return null; }
  };

  // --- LOGIKA FILTER UTAMA ---
  const filteredList = list.filter(item => {
    // 1. Filter Tanggal
    let matchDate = true;
    if (filterStart || filterEnd) {
        const itemDateObj = parseDate(item.tanggal); 
        if (itemDateObj && !isNaN(itemDateObj.getTime())) {
             const itemTime = itemDateObj.setHours(0, 0, 0, 0);
             const startTime = filterStart ? new Date(filterStart).setHours(0, 0, 0, 0) : null;
             const endTime = filterEnd ? new Date(filterEnd).setHours(23, 59, 59, 999) : null;
             matchDate = (!startTime || itemTime >= startTime) && (!endTime || itemTime <= endTime);
        } else { matchDate = false; }
    }

    // 2. Filter Status
    let matchStatus = true;
    if (filterStatus !== 'All') { 
        if (filterStatus === 'HADIR_ALL') {
             const included = ['H', 'I', 'T', 'TSi', 'TSo', 'TPC', 'SiPC', 'So', 'Si', 'PC'];
             matchStatus = included.includes(item.symbol);
        } else {
             matchStatus = item.symbol === filterStatus; 
        }
    }
    return matchDate && matchStatus;
  });

  const getStatusStyle = (sym) => {
      if(!sym) return { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' };
      const s = sym.toUpperCase();
      if(['H', 'A'].includes(s)) return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
      if(s.includes('T') || s.includes('SI') || s.includes('SO')) return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' };
      return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
  };

  const splitDate = (dateStr, weekName) => {
      const d = parseDate(dateStr);
      if(!d || isNaN(d.getTime())) return { day: '00', month: '---', year: '0000', dayName: weekName || '-' };
      return {
          day: String(d.getDate()).padStart(2, '0'),
          month: d.toLocaleDateString('id-ID', { month: 'short' }).toUpperCase(),
          year: d.getFullYear(),
          dayName: d.toLocaleDateString('id-ID', { weekday: 'long' })
      };
  };

  const clearFilter = () => { setFilterStart(''); setFilterEnd(''); setFilterStatus('All'); };

  // --- FUNGSI HANDLE KLIK TOMBOL AJUKAN (PARSING JAM) ---
const handleAjukanIjin = (item) => { let jMulai="", jSelesai="", jk=item.jamKerja||""; if(jk.includes("-")){ const p=jk.split("-"); if(p.length===2){ jMulai=p[0].trim(); jSelesai=p[1].trim(); } }

    // 2. Parsing Tanggal
    let tanggalYMD = "";
    if (item.tanggalRaw) {
        tanggalYMD = item.tanggalRaw;
    } else {
        const d = parseDate(item.tanggal);
        if (d && !isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            tanggalYMD = `${year}-${month}-${day}`;
        }
    }

    // 3. Simpan Data Prefill (CATATAN TIDAK DISIMPAN AGAR FORM KOSONG)
    const prefillData = {
        tgl: tanggalYMD,
        jamMulai: jMulai,
        jamSelesai: jSelesai
        // catatan dihapus agar user isi sendiri
    };

    localStorage.setItem('absenType', 'Ijin');
    localStorage.setItem('absen_prefill', JSON.stringify(prefillData));
    setView('form');
  };

  return (
    <div className="p-4 h-full overflow-y-auto pb-24 bg-gray-50">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6 sticky top-0 bg-gray-50 z-10 py-2">
        <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Data Mesin</h2>
            <p className="text-[10px] text-slate-500 font-medium">Sinkronisasi ID: {user.noPayroll}</p>
            {lastUpdate && (
                <div className="flex items-center gap-1 mt-1">
                    <Clock className="w-4 h-4 text-slate-600"/>
                    <p className="text-[12px] text-slate-600 font-medium">{calculateTimeAgo(lastUpdate)}</p>
                </div>
            )}
        </div>
        
        <div className="flex items-center gap-2">
            <button 
                onClick={() => setShowFilter(!showFilter)} 
                className={`p-2.5 rounded-xl border transition-all shadow-sm ${showFilter ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200' : 'bg-white text-slate-600 border-gray-200 hover:bg-gray-50'}`}
            >
                <Filter className="w-5 h-5" />
            </button>
            <BackButton onClick={() => setView('dashboard')} />
        </div>
      </div>

      {/* FILTER PANEL */}
      {showFilter && (
        <div className="bg-white p-5 rounded-2xl shadow-lg shadow-blue-50/50 border border-blue-100 mb-6 animate-in slide-in-from-top-4 duration-300">
            <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2"><Filter className="w-4 h-4 text-blue-500"/> Filter Data</h4>
                {(filterStart || filterEnd || filterStatus !== 'All') && (
                    <button onClick={clearFilter} className="text-[10px] text-red-500 font-bold bg-red-50 px-2 py-1 rounded-md hover:bg-red-100 transition">
                        Reset Filter
                    </button>
                )}
            </div>
            
            <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">Mulai</label>
                    <input type="date" className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} />
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">Sampai</label>
                    <input type="date" className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} />
                </div>
            </div>

            {/* DROPDOWN STATUS */}
            <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">Status Kehadiran</label>
                <select className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="All">Semua Status</option>
                    <option value="HADIR_ALL" className="font-bold text-emerald-600">☑️ Hadir (Total)</option>
                    {availableStatusOptions.map((sym) => (
                        <option key={sym} value={sym}>
                            {KETERANGAN_MAP[sym] || sym} ({sym})
                        </option>
                    ))}
                </select>
            </div>
            
            <div className="mt-4 pt-3 border-t border-dashed border-gray-100 text-[10px] text-slate-400 text-center font-medium">
                Menampilkan <strong>{filteredList.length}</strong> data presensi
            </div>
        </div>
      )}

      {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
              <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-3"></div>
              <p className="text-xs font-bold text-slate-400">Mengambil Data Mesin...</p>
          </div>
      ) : (
        <div className="space-y-4">
            {filteredList.length === 0 && (
                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-300 mx-2">
                    <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Fingerprint className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-slate-500 font-bold text-sm">Tidak ada data ditemukan</p>
                    <p className="text-xs text-slate-400 mt-1">Coba sesuaikan filter tanggal Anda</p>
                </div>
            )}

            {filteredList.map((item, idx) => {
                const style = getStatusStyle(item.symbol);
                const dateParts = splitDate(item.tanggal, item.week);
                const keterangan = KETERANGAN_MAP[item.symbol] || '-';
                
                // --- LOGIKA TOMBOL FORM (REVISI) ---
                // Cek apakah Kode Absen termasuk dalam daftar TARGET_CODES
                const isTargetCode = TARGET_CODES.includes(item.symbol);
                
                // Tambahan: Validasi Tanggal Max 4 Hari (Opsional, jika ingin tetap dipakai)
                let isWithinTimeLimit = true;
                const itemDate = parseDate(item.tanggal);
                if (itemDate) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    itemDate.setHours(0, 0, 0, 0);
                    const diffTime = today - itemDate;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    // Jika lebih dari 4 hari yang lalu, button tidak muncul (Business Rule)
                    if (diffDays < 0 || diffDays > 4) {
                        isWithinTimeLimit = false;
                    }
                }

                // Tampilkan tombol jika Kode Cocok DAN Masih dalam batas waktu
                const showButton = isTargetCode && isWithinTimeLimit;
                
                const isIjinDisabled = ijinCount >= 4;

                return (
                    <div key={idx} className="bg-white rounded-2xl p-0 shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-all duration-300 group">
                        <div className="flex">
                            <div className="bg-slate-50 w-24 flex flex-col items-center justify-center border-r border-dashed border-slate-200 p-3 text-center">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{dateParts.month}</span>
                                <span className="text-3xl font-black text-slate-700 leading-none my-0.5">{dateParts.day}</span>
                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{dateParts.year}</span>
                            </div>
                            <div className="flex-1 p-3">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{dateParts.dayName}</p>
                                        <div className={`inline-flex items-center px-2.5 py-1 rounded-lg border ${style.bg} ${style.border} ${style.text}`}>
                                            <span className="text-[10px] font-extrabold tracking-wide uppercase">{keterangan}</span>
                                        </div>
                                    </div>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2 ${style.bg} ${style.border} ${style.text}`}>
                                        {item.symbol}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    <div className="relative pl-3 border-l-2 border-green-400">
                                        <p className="text-[9px] font-bold text-slate-400 uppercase">Masuk</p>
                                        <p className="text-base font-black text-slate-800">{formatTimeOnly(item.masuk)}</p>
                                    </div>
                                    <div className="relative pl-3 border-l-2 border-red-400">
                                        <p className="text-[9px] font-bold text-slate-400 uppercase">Pulang</p>
                                        <p className="text-base font-black text-slate-800">{formatTimeOnly(item.pulang)}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-50/50 px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div>
                                    <p className="text-[9px] font-bold text-slate-400">Jam Kerja</p>
                                    <p className="text-xs font-bold text-slate-600">{item.jamKerja || '-'}</p>
                                </div>
                                {item.telat && item.telat !== 'FALSE' && item.telat !== '00:00:00' && (
                                    <div>
                                        <p className="text-[9px] font-bold text-orange-400">Terlambat</p>
                                        <p className="text-xs font-bold text-orange-600">{formatTimeOnly(item.telat)}</p>
                                    </div>
                                )}
                            </div>
                            <div className="relative group/tooltip">
                                <Activity className="w-4 h-4 text-slate-300" />
                                <div className="absolute right-0 bottom-6 w-48 bg-slate-800 text-white text-[10px] p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition pointer-events-none z-10 font-mono">
                                    Scan: {item.waktuScan ? item.waktuScan.replace(/,/g, ', ') : '-'}
                                </div>
                            </div>
                        </div>
                        
                        {showButton && (
                            <div className="px-3 pb-3 pt-1">
                                <button 
                                    disabled={isIjinDisabled}
                                    onClick={() => handleAjukanIjin(item)}
                                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all border
                                        ${isIjinDisabled ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-orange-600 border-orange-200 hover:bg-orange-50 shadow-sm' }`}
                                >
                                    <FileText className="w-3.5 h-3.5" />
                                    {isIjinDisabled ? 'Form IJIN Sudah Terpakai 4X' : 'Ajukan Form Ijin'}
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
      )}
      <div className="h-10"></div>
    </div>
  );
}

// --- HELPER FORMAT WAKTU (HH:MM) ---
function formatTimeOnly(v){if(!v||v==='-'||v==='FALSE')return'-';if(typeof v==='string'){if(v.includes('T')){try{const d=new Date(v);return isNaN(d)?v:d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false}).replace(/\./g,':')}catch(e){return v}}if(v.includes(':'))return v.substring(0,5)}return v}