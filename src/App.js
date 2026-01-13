import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, FileText, AlertTriangle, X, 
  File as FileIcon, Filter, CheckSquare, Users, Eye, 
  ScanFace, Fingerprint, Smartphone, ChevronDown, ChevronUp, Search, 
  MessageSquare, Upload, Check, MessageCircle, Info, CalendarCheck,
  Printer, FileSpreadsheet, Loader2, Wifi, WifiOff, CalendarDays, DoorOpen, DoorClosed, 
  CloudSun, KeyRound, ScanLine,
} from 'lucide-react';

import { SCRIPT_URL } from './config/constants';
import { TIMEOUT_DURATION } from './config/constants';
import BackButton from './components/BackButton';


const ICON_MAP = {
  'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': FileText, 'Sakit': AlertTriangle, 
  'Lembur': Clock, 'Dinas': Briefcase, 'Cuti': Calendar, 
  'Tukar Shift': CalendarCheck, 'Off': CalendarCheck // Tambahkan Icon untuk Off
};

const COLOR_MAP = {
  'Hadir': 'bg-green-500', 'Pulang': 'bg-red-500', 'Ijin': 'bg-yellow-500', 
  'Sakit': 'bg-orange-500', 'Lembur': 'bg-purple-500', 'Dinas': 'bg-indigo-500', 
  'Cuti': 'bg-pink-500',
  'Tukar Shift': 'bg-teal-500', 'Off': 'bg-gray-500' // Tambahkan Warna untuk Off
};


// --- MAIN APP COMPONENT ---
export default function AppAbsensi() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); 
  const [masterData, setMasterData] = useState({ menus: [], roles: [], divisions: [], shifts: [] });
  const [editItem, setEditItem] = useState(null);
  const logoutTimerRef = useRef(null);
  const CLIENT_VERSION = "1.0.5";

 // --- LOGIKA CEK UPDATE (DIPERBAIKI DENGAN PENGAMAN LOOP) ---
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const res = await fetch(SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'check_version' })
        });
        const data = await res.json();
        
        if (data.result === 'success') {
          const serverVersion = data.version;
          
          // Jika versi Server berbeda dengan Client
          if (serverVersion !== CLIENT_VERSION) {
             
             // [PENGAMAN] Cek apakah kita barusan mencoba update ke versi ini?
             // Jika ada di sessionStorage, berarti kita baru saja reload tapi versi client belum berubah.
             // Artinya: Developer mungkin lupa ganti CLIENT_VERSION atau Cache browser sangat kuat.
             const lastAttempt = sessionStorage.getItem('update_attempt_version');
             
             if (lastAttempt === serverVersion) {
                 console.warn("Versi Client masih lama. Mencegah reload loop.");
                 return; // BERHENTI DI SINI (Jangan alert/reload lagi)
             }

             // Jika belum pernah coba update ke versi ini, baru lakukan Alert & Reload
             alert(`Update Baru Tersedia! (v${serverVersion})\nSistem akan memuat pembaruan...`);
             
             // 1. Simpan tanda bahwa kita sedang mencoba update ke versi server ini
             sessionStorage.setItem('update_attempt_version', serverVersion);
             
             // 2. Hapus data master lama agar fresh
             localStorage.removeItem('app_master_data');
             
             // 3. Force Reload dengan parameter waktu (Cache Busting)
             const newUrl = window.location.href.split('?')[0] + '?time=' + new Date().getTime();
             window.location.href = newUrl;
          } else {
             // Jika versi SUDAH SAMA, hapus tanda pengaman (artinya update sukses)
             sessionStorage.removeItem('update_attempt_version');
          }
        }
      } catch (e) {
        console.error("Gagal cek versi", e);
      }
    };

    checkUpdate();
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('app_user');
    const storedMasterData = localStorage.getItem('app_master_data');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      if (storedMasterData) setMasterData(JSON.parse(storedMasterData));
      setView('dashboard');
    }
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    setMasterData({ menus: [], roles: [], divisions: [], shifts: [] });
    setView('login');
    localStorage.removeItem('app_user');
    localStorage.removeItem('app_master_data');
    sessionStorage.removeItem('announcement_shown');
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
  }, []);

  const resetTimer = useCallback(() => {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (user) {
      logoutTimerRef.current = setTimeout(() => {
        alert("Sesi Anda berakhir karena tidak ada aktivitas selama 5 menit.");
        handleLogout();
      }, TIMEOUT_DURATION);
    }
  }, [user, handleLogout]);

  useEffect(() => {
    if (!user) return; 
    resetTimer();
    const events = ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, resetTimer));
    return () => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [user, resetTimer]);

  const handleLogin = (userData, rawMasterData) => {
    const menus = rawMasterData.filter(m => m.kategori === 'Menu');
    const roles = rawMasterData.filter(m => m.kategori === 'Role');
    const divisions = rawMasterData.filter(m => m.kategori === 'Divisi');
    const shifts = rawMasterData.filter(m => m.kategori === 'Shift');
    
    const processedMasterData = { menus, roles, divisions, shifts };
    
    setMasterData(processedMasterData);
    setUser(userData);
    setView('dashboard');
    localStorage.setItem('app_user', JSON.stringify(userData));
    localStorage.setItem('app_master_data', JSON.stringify(processedMasterData));
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-slate-800">
      <div className="max-w-md mx-auto bg-white min-h-screen shadow-xl overflow-hidden relative">
        
        {/* HEADER UTAMA: Hanya muncul jika BUKAN Login DAN BUKAN Dashboard (karena Dashboard punya header sendiri) */}
        {view !== 'login' && view !== 'dashboard' && (
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center shadow-md z-10 relative">
            <div className="flex items-center gap-2">
                <button onClick={() => setView('dashboard')} className="flex items-center gap-2">
                   <Activity className="w-6 h-6" />
                   {/* TEXT ABSENSI ONLINE DIHAPUS SESUAI REQUEST */}
                   <span className="font-bold text-lg">Menu {view === 'form' ? 'Form' : (view === 'history' ? 'Riwayat' : 'Lainnya')}</span>
                </button>
            </div>
            {/* Tombol Logout & Password di sini DIHAPUS agar tidak double */}
            </div>
        )}

        <div className="p-0">
          {view === 'login' && <LoginScreen onLogin={handleLogin} />}
          {/* Dashboard menerima prop setView untuk navigasi */}
          {view === 'dashboard' && <Dashboard user={user} setUser={setUser} setView={setView} handleLogout={handleLogout} masterData={masterData} />}
          
          {/* ... (View lainnya TETAP SAMA) ... */}
          {view === 'form' && <AttendanceForm user={user} setUser={setUser} setView={setView} editItem={editItem} setEditItem={setEditItem} masterData={masterData} />}
          {view === 'history' && <HistoryScreen user={user} setView={setView} setEditItem={setEditItem} masterData={masterData} />}
          {view === 'db_absen' && <DbAbsenScreen user={user} setView={setView} />}
          {view === 'admin' && <AdminPanel user={user} setView={setView} masterData={masterData} />}
          {view === 'approval' && <ApprovalScreen user={user} setView={setView} />}
          {view === 'ganti_password' && <ChangePasswordScreen user={user} setView={setView} />}
          {view === 'remark' && <RemarkScreen user={user} setView={setView} />}
          {view === 'input_shift' && <ShiftScheduleScreen user={user} setView={setView} masterData={masterData} />}
        </div>
      </div>
    </div>
  );
}

// --- KOMPONEN JAM ANALOG ---
const AnalogClock = ({ time }) => {
  const seconds = time.getSeconds();
  const minutes = time.getMinutes();
  const hours = time.getHours();

  const secondDeg = (seconds / 60) * 360;
  const minuteDeg = (minutes / 60) * 360 + (seconds / 60) * 6;
  const hourDeg = ((hours % 12) / 12) * 360 + (minutes / 60) * 30;

  return (
    <div className="relative w-28 h-28 flex items-center justify-center bg-white rounded-full shadow-inner border-4 border-slate-100">
      {/* Angka Jam 1-12 */}
      {[...Array(12)].map((_, i) => {
        const num = i + 1;
        const rotation = num * 30;
        return (
          <div
            key={num}
            className="absolute w-full h-full text-center pt-1"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <span
              className="inline-block text-[10px] font-bold text-slate-400"
              style={{ transform: `rotate(-${rotation}deg)` }}
            >
              {num}
            </span>
          </div>
        );
      })}

      {/* Dial Markers (Titik Kecil) */}
      {[...Array(12)].map((_, i) => (
        <div key={i} className="absolute w-0.5 h-1 bg-slate-200 rounded-full" 
             style={{ transform: `rotate(${i * 30}deg) translate(0, -38px)` }}></div>
      ))}
      
      {/* Jarum Jam */}
      <div className="absolute w-1.5 h-7 bg-slate-800 rounded-full origin-bottom z-10"
           style={{ transform: `rotate(${hourDeg}deg)`, bottom: '50%' }}></div>
      {/* Jarum Menit */}
      <div className="absolute w-1 h-9 bg-blue-500 rounded-full origin-bottom z-10"
           style={{ transform: `rotate(${minuteDeg}deg)`, bottom: '50%' }}></div>
      {/* Jarum Detik */}
      <div className="absolute w-0.5 h-10 bg-red-500 rounded-full origin-bottom z-10"
           style={{ transform: `rotate(${secondDeg}deg)`, bottom: '50%' }}></div>
      
      {/* Titik Tengah */}
      <div className="absolute w-2.5 h-2.5 bg-slate-800 rounded-full z-20 border-2 border-white"></div>
    </div>
  );
};

// --- DASHBOARD SCREEN (LAYOUT BARU: FIXED GRID & HEADER ANIMASI) ---
function Dashboard({ user, setUser, setView, handleLogout, masterData }) { 
  const [time, setTime] = useState(new Date());
  const [stats, setStats] = useState({ 
    total_hadir: 0, total_ijin: 0, total_telat_freq: 0, total_telat_menit: 0, 
    total_cuti: 0, total_cuti_bersama: 0, total_sakit: 0, total_alpa: 0,
    total_no_scan_in: 0, total_no_scan_out: 0, periode_db: '-'
  });
  const [loadingStats, setLoadingStats] = useState(true);
  const [showNews, setShowNews] = useState(false);
  const [newsContent] = useState(null);

  useEffect(() => { const timer = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(timer); }, []);
  
  // (Pastikan fungsi checkExecutionTime, fetchStats, fetchNews ada di sini seperti script sebelumnya)
  // ... [PASTE CODE LOGIC DISINI] ...
  
  // FETCH STATS (CONTOH SINGKAT AGAR TIDAK ERROR, PASTE YANG LENGKAP DARI SCRIPT LAMA)
  useEffect(() => { 
    const fetchStats = async () => { 
      setLoadingStats(true); 
      try { 
        const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_stats', userId: user.id }) }); 
        const data = await res.json(); 
        if (data.result === 'success') { 
          const normalizedStats = {}; 
          Object.keys(data.stats).forEach(key => { normalizedStats[key.toLowerCase()] = data.stats[key]; }); 
          setStats({ ...data.stats, ...normalizedStats }); 
        } 
      } catch (e) { console.error("Gagal"); } finally { setLoadingStats(false); }
    }; 
    if (user) fetchStats(); 
  }, [user]);

  const checkExecutionTime = async () => { /* ... Logic Ping ... */ };
  useEffect(() => { checkExecutionTime(); }, []);

  if (!user) return null; 

  const availableMenus = masterData.menus || [];
  const allowedMenus = user.akses && user.akses.length > 0 ? availableMenus.filter(item => user.akses.includes(item.value)) : availableMenus; 
  const userRole = user.role ? String(user.role).toLowerCase() : '';
  const canApprove = ['admin', 'hrd', 'manager'].includes(userRole);
  const canAccessPanel = userRole === 'admin' && userRole !== 'hrd';
  const isHRDOrAdmin = ['admin', 'hrd'].includes(userRole);
  const isShiftWorker = userRole === 'karyawan_shift';

  const hour = time.getHours();
  let greeting = 'Selamat Pagi';
  if (hour >= 11 && hour < 15) { greeting = 'Selamat Siang'; }
  else if (hour >= 15 && hour < 18) { greeting = 'Selamat Sore'; }
  else if (hour >= 18) { greeting = 'Selamat Malam'; }

  const dateOptions = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' };
  const dateString = time.toLocaleDateString('id-ID', dateOptions);
  const Skeleton = ({ className }) => ( <div className={`bg-gray-200 animate-pulse rounded ${className}`}></div> );

  // --- RENDER UI ---
  return ( 
    <div className="p-4 pb-24 bg-gray-50 min-h-screen font-sans flex flex-col"> 
      
      {/* --- KARTU PROFIL HEADER (REVISI: POSISI/LOKASI DI BAWAH NAMA) --- */}
      <div className="relative rounded-[2.5rem] p-6 shadow-xl shadow-slate-200 mb-6 overflow-hidden bg-white border border-white">
        
        {/* Background Decorations */}
        <div className="absolute top-0 left-0 w-full h-28 bg-gradient-to-r from-blue-600 to-indigo-700"></div>
        <div className="absolute top-20 left-0 w-full h-10 bg-white rounded-t-[2.5rem]"></div>
 
        {/* HEADER KIRI ATAS: PROFESSIONAL ANIMATED ICON */}
        <div className="absolute top-5 left-6 z-20 flex items-center gap-2">
            <div className="bg-white/10 backdrop-blur-md p-2 rounded-full border border-white/20 shadow-lg animate-[pulse_3s_infinite]">
                <ScanLine className="w-5 h-5 text-blue-100" />
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] font-bold text-blue-100 tracking-widest uppercase">Secure</span>
                <span className="text-[10px] font-bold text-white tracking-widest uppercase leading-none">Access</span>
            </div>
        </div>

        {/* HEADER KANAN ATAS: TOMBOL ACTION (ANIMATED) */}
        <div className="absolute top-5 right-6 z-20 flex gap-2">
             {/* Tombol Password */}
             <button 
                onClick={() => setView('ganti_password')} 
                className="bg-white/20 hover:bg-white/40 p-2.5 rounded-full backdrop-blur-md transition-all duration-300 text-white border border-white/30 shadow-lg active:scale-90 hover:rotate-12 group"
                title="Ubah Password"
             >
                <KeyRound className="w-5 h-5 group-hover:text-yellow-300 transition-colors" />
             </button>
             {/* Tombol Logout (Animated Shake/Pulse on Hover) */}
             <button 
                onClick={handleLogout} 
                className="bg-red-500/80 hover:bg-red-600 p-2.5 rounded-full backdrop-blur-md transition-all duration-300 text-white border border-red-400/50 shadow-lg active:scale-90 hover:animate-[tada_1s_ease-in-out]"
                title="Keluar Aplikasi"
             >
                <LogOut className="w-5 h-5" />
             </button>
        </div>

        <div className="relative z-10 flex flex-col items-center mt-6">
            {/* 1. JAM ANALOG (DENGAN ANGKA 1-12) */}
            <div className="mb-4 transform hover:scale-105 transition-transform duration-500 ease-out shadow-2xl rounded-full bg-white p-1">
                 <AnalogClock time={time} />
            </div>

            {/* 2. NAMA, POSISI & LOKASI (REVISI) */}
            <div className="text-center mb-6 w-full">
                <div className="flex items-center justify-center gap-2 mb-1">
                    <CloudSun className="w-4 h-4 text-orange-400 animate-bounce-slow" />
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">{greeting}</p>
                </div>
                
                <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-tight truncate px-2">{user.nama}</h2>
                
                {/* INFO POSISI • LOKASI (DITARUH DISINI SESUAI REQUEST) */}
                <div className="flex items-center justify-center gap-2 mt-1 text-xs font-bold text-slate-500">
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 border border-slate-200">{user.divisi}</span>
                    <span className="text-slate-300">•</span>
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 border border-slate-200">{user.lokasi || 'All'}</span>
                </div>

                <p className="text-[10px] text-slate-400 font-medium mt-2">
                    {dateString}
                </p>
            </div>

            {/* 3. INFO CHIPS SISA (Perusahaan, ID, Status, Cuti) - POSISI & LOKASI DIHAPUS DARI SINI */}
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

      {/* --- STATISTIK (REVISI: SEMUA UKURAN KARTU SAMA) --- */}
      <div className="flex justify-between items-end mb-3 px-2">
          <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
             {loadingStats ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin"/> : <Activity className="w-4 h-4 text-blue-500"/>}
             Statistik
          </h3>
          <span className="text-[9px] bg-white border border-gray-200 px-3 py-1 rounded-full text-slate-500 font-medium shadow-sm">
             {loadingStats ? "Sinkronisasi..." : stats.periode_db}
          </span>
      </div>
      
      {/* GRID STATISTIK UNIFORM (3 KOLOM) - SEMUA UKURAN SAMA */}
      <div className="grid grid-cols-3 gap-3 mb-5">
          
          {/* 1. TOTAL HADIR (Sekarang ukuran kecil) */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-5"><CheckCircle className="w-12 h-12 text-emerald-600"/></div>
              <div className="bg-emerald-50 text-emerald-600 p-2 rounded-xl mb-1"><CheckCircle className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Hadir</span>
              {loadingStats ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="text-lg font-black text-slate-800">{stats.total_hadir || 0}</p>}
          </div>

          {/* 2. TERLAMBAT (Sekarang ukuran kecil) */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-5"><Clock className="w-12 h-12 text-orange-600"/></div>
              <div className="bg-orange-50 text-orange-600 p-2 rounded-xl mb-1"><Clock className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Telat</span>
              {loadingStats ? <Skeleton className="h-5 w-8 mt-1" /> : (
                  <div className="flex flex-col items-center">
                    <p className="text-lg font-black text-slate-800 leading-none">{stats.total_telat_freq || 0}x</p>
                    <span className="text-[8px] font-bold text-orange-500">{stats.total_telat_menit || 0}m</span>
                  </div>
              )}
          </div>

          {/* 3. IJIN */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="bg-blue-50 text-blue-600 p-2 rounded-xl mb-1"><FileText className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Ijin</span>
              {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700">{stats.total_ijin || 0}</p>}
          </div>
          
          {/* 4. CUTI */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="bg-pink-50 text-pink-600 p-2 rounded-xl mb-1"><Calendar className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Cuti Diambil</span>
              {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700">{stats.total_cuti || 0}</p>}
          </div>

          {/* 5. CUTI BERSAMA */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="bg-purple-50 text-purple-600 p-2 rounded-xl mb-1"><CalendarDays className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none">Cuti Bersama</span>
              {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700 mt-1">{stats.total_cuti_bersama || 0}</p>}
          </div>

          {/* 6. SAKIT */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="bg-orange-50 text-orange-600 p-2 rounded-xl mb-1"><AlertTriangle className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Sakit</span>
              {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700">{stats.total_sakit || 0}</p>}
          </div>

          {/* 7. ALPA */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="bg-red-50 text-red-600 p-2 rounded-xl mb-1"><X className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Alpa</span>
              {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700">{stats.total_alpa || 0}</p>}
          </div>

          {/* 8. NO CHECK IN */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="bg-yellow-50 text-yellow-600 p-2 rounded-xl mb-1"><DoorOpen className="w-4 h-4"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none">Tdk Absen-IN</span>
              {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700 mt-1">{stats.total_no_scan_in || 0}</p>}
          </div>

           {/* 9. NO CHECK OUT */}
           <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
                <div className="bg-rose-50 text-rose-600 p-2 rounded-xl mb-1"><DoorClosed className="w-4 h-4"/></div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none">Tdk Absen-OUT</span>
                {loadingStats ? <Skeleton className="h-5 w-6 mt-1" /> : <p className="text-lg font-black text-slate-700 mt-1">{stats.total_no_scan_out || 0}</p>}
           </div>
      </div>

      {/* --- MENU SHORTCUT --- */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide"> 
        <button onClick={() => setView('history')} className="flex-1 min-w-[90px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-blue-600 font-bold hover:bg-blue-50 transition active:scale-95">
            <History className="w-5 h-5" /><span className="text-[10px]">Riwayat</span>
        </button> 
        <button onClick={() => setView('db_absen')} className="flex-1 min-w-[90px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-indigo-600 font-bold hover:bg-indigo-50 transition active:scale-95">
            <Fingerprint className="w-5 h-5" /> <span className="text-[10px]">Data Mesin</span>
        </button>
        <button onClick={() => setView('remark')} className={`flex-1 min-w-[90px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 font-bold transition active:scale-95 ${isHRDOrAdmin ? 'text-purple-600 hover:bg-purple-50' : 'text-orange-600 hover:bg-orange-50'}`}>
            <MessageSquare className="w-5 h-5" />
            <span className="text-[10px]">{isHRDOrAdmin ? 'Respon Laporan' : 'Lapor HRD'}</span>
        </button>
        {canApprove && (
            <button onClick={() => setView('approval')} className="flex-1 min-w-[90px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-green-600 font-bold hover:bg-green-50 transition active:scale-95">
                <Users className="w-5 h-5" /><span className="text-[10px]">Approval</span>
            </button>
        )}
        {canAccessPanel && ( 
            <button onClick={() => setView('admin')} className="flex-1 min-w-[90px] bg-slate-800 text-white p-3 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 font-bold hover:bg-slate-700 transition active:scale-95">
                <Settings className="w-5 h-5" /><span className="text-[10px]">Panel</span>
            </button> 
        )} 
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

      {/* --- MENU ABSENSI GRID --- */}
      <h3 className="font-bold text-slate-700 mb-3 px-1 flex items-center gap-2 text-sm">
          <ScanFace className="w-4 h-4 text-blue-500"/> Menu e-Form
      </h3> 

      <div className="grid grid-cols-2 gap-3 flex-1"> 
        {allowedMenus.map((item) => { 
            const Icon = ICON_MAP[item.value] || Star; 
            const colorClass = COLOR_MAP[item.value] || 'bg-blue-400';
            const isCutiEmpty = item.value === 'Cuti' && (parseInt(user.sisaCuti) || 0) < 1;
            const isIjinFull = item.value === 'Ijin' && (stats.ijin_count || 0) >= 4;
            const isDisabled = isCutiEmpty || isIjinFull;
            return ( 
                <button 
                    key={item.value} 
                    disabled={isDisabled} 
                    onClick={() => { 
                        if(isCutiEmpty) { alert('Sisa Cuti Anda Habis (0).'); return; }
                        if(isIjinFull) { alert('Pengajuan IJIN Maksimal 4x.'); return; }
                        localStorage.setItem('absenType', item.value); 
                        setView('form'); 
                    }} 
                    className={`bg-white p-3 rounded-xl shadow-sm border border-gray-100 transition-all duration-300 text-left group relative overflow-hidden transform 
                    ${isDisabled ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:-translate-y-1 hover:shadow-md'}`}
                 > 
                    <div className={`absolute -right-4 -bottom-4 w-16 h-16 rounded-full opacity-10 group-hover:scale-150 transition duration-500 ${colorClass}`}></div>
                    <div className={`${colorClass} w-9 h-9 rounded-lg flex items-center justify-center text-white mb-2 shadow-sm group-hover:scale-110 group-hover:rotate-3 transition`}>
                       <Icon className="w-4 h-4" />
                    </div> 
                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition">{item.label}</h4> 
                    <p className="text-[9px] text-gray-400 mt-0.5">{(isCutiEmpty ? 'Sisa CUTI Habis' : (isIjinFull ? 'Limit IJIN Tercapai' : 'Pengajuan Form'))}</p> 
                 </button> 
            ) 
        })} 
      </div>

      {/* --- FOOTER --- */}
      <div className="p-6 text-center mt-4 border-t border-dashed border-gray-200">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
             Version {masterData?.appVersion || '1.0.5'} | &copy; {new Date().getFullYear()}
          </p>
      </div>

      {/* --- ANNOUNCEMENT POPUP --- */}
      {showNews && newsContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden transform animate-in zoom-in-95 duration-300">
             <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-5 text-white relative">
              <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-2xl"></div>
              <div className="flex items-center gap-2 mb-1">
                 <div className="bg-white/20 p-1.5 rounded-lg"><MessageSquare className="w-5 h-5 text-white" /></div>
                <h3 className="font-bold text-base tracking-tight">INFORMASI</h3>
              </div>
              <p className="text-blue-100 text-[10px] uppercase tracking-widest font-medium">{newsContent.waktu}</p>
            </div>
            <div className="p-5">
              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 mb-5 max-h-60 overflow-y-auto">
                <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">"{newsContent.isi}"</p>
              </div>
              <button onClick={() => { setShowNews(false); sessionStorage.setItem('announcement_shown', 'true'); }} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold shadow-lg text-sm">Tutup</button>
            </div>
          </div>
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
            const res = await fetch(SCRIPT_URL, {
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
            const res = await fetch(SCRIPT_URL, {
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
            const res = await fetch(SCRIPT_URL, {
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

// Pastikan import Wifi dan WifiOff ada di bagian paling atas file App.js
// import { ..., Wifi, WifiOff, ... } from 'lucide-react';

// --- 2. DASHBOARD SCREEN (UPDATED: NETWORK SPEED) ---
function DashboardScreen({ user, setView, handleLogout, masterData }) {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // STATE NETWORK SPEED
  const [pingMs, setPingMs] = useState(0);
  const [networkQuality, setNetworkQuality] = useState('checking'); // checking, good, fair, poor, offline

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- LOGIC NETWORK CHECK ---
  const checkNetworkSpeed = async () => {
      const startTime = Date.now();
      try {
          // Kirim request ringan 'ping' ke server
          await fetch(SCRIPT_URL, { 
              method: 'POST', 
              body: JSON.stringify({ action: 'ping' }) 
          });
          const endTime = Date.now();
          const duration = endTime - startTime;
          setPingMs(duration);

          // Tentukan Kualitas Sinyal
          if (duration < 500) setNetworkQuality('good');       // < 0.5 detik (Cepat)
          else if (duration < 1500) setNetworkQuality('fair'); // < 1.5 detik (Sedang)
          else setNetworkQuality('poor');                      // > 1.5 detik (Lambat)

      } catch (error) {
          setNetworkQuality('offline');
          setPingMs(0);
      }
  };

  // Cek ping pertama kali load, lalu ulangi setiap 10 detik
  useEffect(() => {
      checkNetworkSpeed();
      const intervalPing = setInterval(checkNetworkSpeed, 10000); 
      return () => clearInterval(intervalPing);
  }, []);

  // Helper Warna & Text Sinyal
  const getNetworkUI = () => {
      switch(networkQuality) {
          case 'good': return { color: 'text-emerald-500 bg-emerald-50 border-emerald-200', text: 'Stabil', icon: Wifi };
          case 'fair': return { color: 'text-amber-500 bg-amber-50 border-amber-200', text: 'Sedang', icon: Wifi };
          case 'poor': return { color: 'text-rose-500 bg-rose-50 border-rose-200', text: 'Lambat', icon: Wifi };
          case 'offline': return { color: 'text-gray-500 bg-gray-100 border-gray-200', text: 'Offline', icon: WifiOff };
          default: return { color: 'text-blue-400 bg-blue-50 border-blue-200', text: 'Cek...', icon: Activity };
      }
  };

  const netUI = getNetworkUI();
  const NetIcon = netUI.icon;

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 11) return "Selamat Pagi";
    if (hour < 15) return "Selamat Siang";
    if (hour < 19) return "Selamat Sore";
    return "Selamat Malam";
  };

  const MENU_ITEMS = [
    { id: 'absen_masuk', label: 'Absen Masuk', icon: CheckCircle, color: 'bg-green-500', action: () => { localStorage.setItem('absenType', 'Hadir'); setView('form'); } },
    { id: 'absen_pulang', label: 'Absen Pulang', icon: LogOut, color: 'bg-red-500', action: () => { localStorage.setItem('absenType', 'Pulang'); setView('form'); } },
    { id: 'ijin_cuti', label: 'Form Ijin/Cuti/Sakit', icon: FileText, color: 'bg-blue-500', action: () => { localStorage.setItem('absenType', 'Ijin'); setView('form'); } },
    { id: 'riwayat', label: 'Riwayat & Laporan', icon: History, color: 'bg-amber-500', action: () => setView('history') },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans">
      
      {/* HEADER DENGAN NETWORK INDICATOR */}
      <div className="bg-white p-5 rounded-b-3xl shadow-sm border-b border-gray-100 pb-6 relative overflow-hidden">
        {/* Dekorasi Background Halus */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full blur-3xl -mr-10 -mt-10 opacity-50"></div>
        
        <div className="flex justify-between items-start relative z-10">
          <div>
             <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">{getGreeting()},</h1>
             <p className="text-sm font-medium text-slate-500">{user.nama}</p>
             <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200 font-bold">{user.role}</span>
                <span className="text-[10px] bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full border border-indigo-100 font-bold">{user.lokasi || 'All'}</span>
             </div>
          </div>
          
          {/* INDIKATOR NETWORK SPEED (SWEET LOOK) */}
          <div className="flex flex-col items-end gap-1">
              <button onClick={handleLogout} className="bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-colors mb-1">
                <LogOut className="w-4 h-4 text-slate-600" />
              </button>
              
              <div 
                onClick={checkNetworkSpeed} 
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${netUI.color} transition-all cursor-pointer active:scale-95 shadow-sm`}
                title="Klik untuk refresh sinyal"
              >
                  <NetIcon className={`w-3 h-3 ${networkQuality === 'checking' ? 'animate-pulse' : ''}`} />
                  <div className="flex flex-col items-end leading-none">
                      <span className="text-[9px] font-bold uppercase">{netUI.text}</span>
                      {networkQuality !== 'offline' && networkQuality !== 'checking' && (
                          <span className="text-[8px] font-mono opacity-80">{pingMs}ms</span>
                      )}
                  </div>
              </div>
          </div>
        </div>
      </div>

      {/* JAM DIGITAL BESAR */}
      <div className="px-6 -mt-4 relative z-10">
         <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-5 rounded-2xl shadow-lg shadow-blue-200 flex items-center justify-between">
            <div>
                <p className="text-xs font-medium text-blue-100 mb-0.5 opacity-80">Waktu Sekarang</p>
                <div className="text-3xl font-black tracking-widest font-mono">
                    {currentTime.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                </div>
                <p className="text-[10px] font-medium text-blue-200 mt-1">
                    {currentTime.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
            </div>
            <div className="bg-white/10 p-2 rounded-xl backdrop-blur-sm">
                <Clock className="w-8 h-8 text-white opacity-90" />
            </div>
         </div>
      </div>

      {/* MENU GRID */}
      <div className="flex-1 overflow-y-auto p-6">
        <h3 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500"/> Menu Utama
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {MENU_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={item.action}
              className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:border-blue-200 transition-all group active:scale-[0.98]"
            >
              <div className={`${item.color} w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform`}>
                <item.icon className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold text-slate-600 text-center group-hover:text-blue-600 leading-tight px-2">{item.label}</span>
            </button>
          ))}
          
          {/* Menu Khusus Admin: Input Running Shift (Contoh) */}
          {(user.role === 'admin' || user.role === 'hrd') && (
               <button
                  onClick={() => { localStorage.setItem('absenType', 'Running Shift'); setView('form'); }} 
                  className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:border-blue-200 transition-all group active:scale-[0.98]"
               >
                  <div className="bg-indigo-500 w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform">
                    <CalendarCheck className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-slate-600 text-center group-hover:text-blue-600 leading-tight px-2">Input Jadwal Shift</span>
               </button>
          )}

          {/* Menu Khusus Admin: Input Absen Manual Tally */}
          {(user.role === 'admin' || user.role === 'hrd') && (
               <button
                  onClick={() => { localStorage.setItem('absenType', 'Absen Manual'); setView('form'); }} 
                  className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center gap-3 hover:shadow-md hover:border-blue-200 transition-all group active:scale-[0.98]"
               >
                  <div className="bg-pink-500 w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform">
                    <Fingerprint className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-slate-600 text-center group-hover:text-blue-600 leading-tight px-2">Input Absen Tally</span>
               </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- 2. REMARK SCREEN (LAYOUT UPDATED) ---
function RemarkScreen({ user, setView }) {
    const userRole = user.role ? String(user.role).toLowerCase() : '';
    const isHRDOrAdmin = ['admin', 'hrd'].includes(userRole);

    const [whatsapp, setWhatsapp] = useState('');
    const [kategori, setKategori] = useState('Koreksi Absensi');
    const [pesan, setPesan] = useState('');
    const [file, setFile] = useState(null);
    const [fileName, setFileName] = useState('');
    const [loading, setLoading] = useState(false);
    const [remarks, setRemarks] = useState([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [statusFilter, setStatusFilter] = useState('All');

    useEffect(() => {
        const fetchRemarks = async () => {
            try {
                const res = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'get_remarks', userId: user.id, role: userRole })
                });
                const data = await res.json();
                if (data.result === 'success') {
                    setRemarks(data.list);
                }
            } catch (e) { console.error("Gagal load remark"); }
        };
        fetchRemarks();
    }, [user.id, userRole, refreshTrigger]);

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
            const res = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'send_remark', userId: user.id, nama: user.nama, divisi: user.divisi,
                    whatsapp, kategori, pesan, file
                })
            }).then(r => r.json());

            if (res.result === 'success') {
                alert('Laporan berhasil dikirim ke HRD!');
                setPesan(''); setWhatsapp(''); setFile(null); setFileName('');
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
            const res = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'update_remark_status', uuid, response: responseText })
            }).then(r => r.json());
            if (res.result === 'success') {
                alert("Status diperbarui & Respon terkirim!");
                setRefreshTrigger(prev => prev + 1);
            } else alert(res.message);
        } catch (e) { alert("Gagal update"); }
    };

    const filteredRemarks = remarks.filter(item => {
        if (!isHRDOrAdmin) return true;
        if (user.lokasi) {
            const allowedLocations = user.lokasi.split(',').map(l => l.trim());
            if (allowedLocations.includes('All')) { } 
            else {
                const laporanLokasi = item.lokasi || '';
                if (!allowedLocations.includes(laporanLokasi)) return false;
            }
        }
        if (statusFilter === 'All') return true;
        return item.status === statusFilter;
    });

    return (
        <div className="p-4 h-full overflow-y-auto pb-20">
            {/* HEADER: TOMBOL KEMBALI DI KANAN */}
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">{isHRDOrAdmin ? 'Respon Laporan Masuk' : 'Lapor & Riwayat'}</h2>
                <BackButton onClick={() => setView('dashboard')} />
            </div>

            {!isHRDOrAdmin && (
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 mb-6">
                    <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Edit className="w-4 h-4"/> Buat Laporan</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-gray-700 block mb-1">No. WhatsApp *</label>
                            <div className="relative">
                                <Smartphone className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                                <input type="tel" required className="w-full p-2.5 pl-10 border rounded-lg text-sm" placeholder="628xxxxxxxx" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
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

            <div>
                {/* SUB-HEADER: JUDUL DAN FILTER SEJAJAR */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                     <h3 className="font-bold text-gray-700 flex items-center gap-2">
                        <History className="w-4 h-4"/> {isHRDOrAdmin ? `Daftar Laporan (${statusFilter})` : 'Status Laporan Anda'}
                    </h3>

                    {isHRDOrAdmin && (
                        <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200 self-end sm:self-auto">
                            <Filter className="w-4 h-4 text-gray-500" />
                            <select 
                                value={statusFilter} 
                                onChange={(e) => setStatusFilter(e.target.value)} 
                                className="text-sm bg-transparent border-none outline-none font-medium text-gray-700 cursor-pointer"
                            >
                                <option value="All">Semua Status</option>
                                <option value="Open">Open</option>
                                <option value="Done">Done</option>
                            </select>
                        </div>
                    )}
                </div>
                
                <div className="space-y-3">
                    {filteredRemarks.length === 0 && <p className="text-gray-400 text-sm text-center py-4">Belum ada data laporan.</p>}
                    
                    {filteredRemarks.map((item, idx) => (
                        <div key={idx} className={`bg-white p-4 rounded-xl shadow-sm border-l-4 relative ${item.status === 'Done' ? 'border-l-green-500' : 'border-l-yellow-500'}`}>
                            <div className="flex justify-between items-start mb-1">
                                <div>
                                    <h4 className="font-bold text-gray-800 text-sm">{item.nama} <span className="font-normal text-xs text-gray-500">({item.divisi})</span></h4>
                                    <p className="text-[10px] text-gray-400">{item.waktu}</p>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${item.status === 'Done' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`}>
                                    {item.status}
                                </span>
                            </div>
                            
                            <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 mt-2 mb-2 border border-gray-100">
                                <p className="font-bold text-purple-700 mb-1">{item.kategori}</p>
                                <p className="italic">"{item.pesan}"</p>
                                {isHRDOrAdmin && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <a href={`https://wa.me/${String(item.whatsapp || '').replace(/^0/, '62')}`} target="_blank" rel="noreferrer" className="bg-green-500 text-white px-2 py-1 rounded text-[10px] flex items-center gap-1 hover:bg-green-600 no-underline">
                                            <MessageCircle className="w-3 h-3"/> Chat WA
                                        </a>
                                        <span className="text-gray-500">{item.whatsapp}</span>
                                    </div>
                                )}
                            </div>

                            {item.respon && item.respon !== '' && (
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
                                                <span className="text-[10px] text-blue-600 font-bold font-mono">{item.waktuRespon}</span>
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
            </div>
        </div>
    );
}

// --- 3. ATTENDANCE FORM (CLEANED: NO WARNINGS) ---
function AttendanceForm({ user, setUser, setView, editItem, setEditItem, masterData }) {
  const type = localStorage.getItem('absenType') || 'Hadir';
  const isEditMode = !!editItem;

  // KONFIGURASI TIPE ABSEN
  const PHOTO_REQUIRED_TYPES = ['Hadir', 'Pulang', 'Dinas', 'Sakit'];
  const NO_GPS_TYPES = ['Ijin', 'Cuti', 'Dinas Luar', 'Sakit', 'Cuti EO', 'Tukar Shift'];
  const NO_TIME_TYPES = ['Cuti', 'Dinas Luar', 'Sakit', 'Cuti EO']; 
  const H3_REQUIRED_TYPES = ['Ijin', 'Tukar Shift']; 
  const UPLOAD_ALLOWED_TYPES = ['Dinas Luar', 'Cuti', 'Cuti EO', 'Ijin']; 

  const isPhotoRequired = PHOTO_REQUIRED_TYPES.includes(type);
  const isGpsRequired = !NO_GPS_TYPES.includes(type);
  const isTimeRequired = !NO_TIME_TYPES.includes(type);
  const isH3Required = H3_REQUIRED_TYPES.includes(type);
  const isUploadAllowed = UPLOAD_ALLOWED_TYPES.includes(type);
  const isIntervalType = !['Hadir', 'Pulang'].includes(type);
  const isShiftWorker = user.role === 'karyawan_shift'; 
  const isClockIn = type === 'Hadir';

  const [selectedShift, setSelectedShift] = useState('');
  const availableShifts = masterData?.shifts || [];

  // CAMERA REFS & STATE
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState(type === 'Sakit' ? 'environment' : 'user');

  // FORM DATA STATE
  const [location, setLocation] = useState(null);
  const [catatan, setCatatan] = useState('');
  const [intervalData, setIntervalData] = useState({ tglMulai: '', tglSelesai: '', jamMulai: '', jamSelesai: '' });
  
  // UPLOAD FILE STATE
  const [fileLampiran, setFileLampiran] = useState(null);
  const [fileName, setFileName] = useState('');
  const [fileMime, setFileMime] = useState('');
  
  // STATE BARU: Pilihan melampirkan file (Default: True untuk Dinas Luar, False untuk Cuti/EO agar opsional)
  const [isUploading, setIsUploading] = useState(type === 'Dinas Luar');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [minDateLimit, setMinDateLimit] = useState('');

  // --- INIT DATA ---
  useEffect(() => {
    if (isH3Required) {
      const d = new Date();
      d.setDate(d.getDate() - 3); 
      setMinDateLimit(d.toISOString().split('T')[0]);
    } else {
      setMinDateLimit('');
    }
  }, [type, isH3Required]);

  useEffect(() => {
    if (isEditMode) {
      setCatatan(editItem.catatan);
      const formatDate = (d) => d && d !== '-' ? new Date(d).toISOString().split('T')[0] : '';
      setIntervalData({ 
        tglMulai: formatDate(editItem.tglMulai), 
        tglSelesai: formatDate(editItem.tglSelesai), 
        jamMulai: editItem.jamMulai !== '-' ? editItem.jamMulai : '', 
        jamSelesai: editItem.jamSelesai !== '-' ? editItem.jamSelesai : '' 
      });
      setPhoto(editItem.foto); 
    }
  }, [editItem, isEditMode]);

  useEffect(() => { 
    if (!isEditMode && isGpsRequired && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }), 
        () => alert('Gagal lokasi. Pastikan GPS aktif.')
      ); 
    }
  }, [isGpsRequired, isEditMode]);

  // --- CAMERA LOGIC ---
  const stopCamera = () => {
      if (videoRef.current && videoRef.current.srcObject) {
          const tracks = videoRef.current.srcObject.getTracks();
          tracks.forEach(track => track.stop());
          videoRef.current.srcObject = null;
      }
      setCameraActive(false);
  };

  const startCamera = async () => { 
      stopCamera(); 
      try { 
          const stream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: facingMode } 
          });
          if (videoRef.current) { 
              videoRef.current.srcObject = stream; 
              setCameraActive(true); 
          } 
      } catch (err) { 
          alert("Gagal akses kamera. Pastikan izin diberikan."); 
      } 
  };

  useEffect(() => {
      if (cameraActive) {
          startCamera();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const toggleCamera = () => {
      setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const takePhoto = () => { 
      const video = videoRef.current; 
      const canvas = canvasRef.current;
      if (video && canvas) { 
          canvas.width = video.videoWidth; 
          canvas.height = video.videoHeight; 
          canvas.getContext('2d').drawImage(video, 0, 0); 
          setPhoto(canvas.toDataURL('image/jpeg', 0.8)); 
          stopCamera();
      } 
  };
  
  // --- FILE UPLOAD LOGIC ---
  const handleFileChange = (e) => {
      const file = e.target.files[0];
      if (file) {
          if (file.size > 5 * 1024 * 1024) { 
              alert("Ukuran file terlalu besar (Max 5MB)");
              return;
          }
          setFileName(file.name);
          setFileMime(file.type);
          
          const reader = new FileReader();
          reader.onloadend = () => {
              setFileLampiran(reader.result); 
          };
          reader.readAsDataURL(file);
      }
  };

  // --- SUBMIT ---
const handleSubmit = async () => {
  if (type === 'Cuti') {
    const sisa = parseInt(user.sisaCuti) || 0;
    
    // Hitung durasi dari input form
    const d1 = new Date(intervalData.tglMulai);
    const d2 = new Date(intervalData.tglSelesai);
    const diffTime = Math.abs(d2 - d1);
    const durasi = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (sisa < 1) {
      alert('Sisa Cuti Anda Habis.');
      return;
    }
    
    if (durasi > sisa) {
      alert(`Sisa cuti Anda (${sisa}) tidak cukup untuk mengambil ${durasi} hari.`);
      return;
    }
  }


    if (isH3Required && intervalData.tglMulai) {
        const dMulai = new Date(intervalData.tglMulai);
        const dBatas = new Date();
        dBatas.setDate(dBatas.getDate() - 3);
        dMulai.setHours(0,0,0,0);
        dBatas.setHours(0,0,0,0);
        if (dMulai < dBatas) {
             alert(`Pengajuan ${type} GAGAL! Batas waktu pengajuan maksimal 3 hari.`);
             return;
        }
    }

    if (isEditMode) {
        const entryTime = new Date(editItem.waktu).getTime();
        const now = new Date().getTime();
        if ((now - entryTime) / (1000 * 60 * 60) > 1) {
            alert('Waktu edit sudah habis (lebih dari 1 jam).');
            return;
        }
    }

    if (isIntervalType) {
        if (!intervalData.tglMulai || !intervalData.tglSelesai) { alert('Lengkapi Tanggal!'); return; }
    }

    if (isIntervalType && isTimeRequired) {
        if (!intervalData.jamMulai || !intervalData.jamSelesai) { alert('Lengkapi Jam!'); return; }
    }

    if (isShiftWorker && isClockIn && !isEditMode && !selectedShift) {
        alert('Harap pilih Jam Shift Anda!');
        return;
    }

    if (isPhotoRequired && !isEditMode && !photo) { 
        alert(type === 'Sakit' ? 'Mohon foto Surat Dokter menggunakan kamera.' : 'Foto Wajib untuk form absen ini.'); 
        return; 
    }
    
    // PERBAIKAN VALIDASI: Hanya wajib jika user mengaktifkan isUploading
    if (isUploadAllowed && isUploading && !isEditMode && !fileLampiran) {
        alert('Mohon pilih file lampiran atau matikan pilihan lampiran.');
        return;
    }

    if (isGpsRequired && !isEditMode && !location) { alert('Lokasi belum ditemukan.'); return; }

    setIsSubmitting(true);
    try {
      let shiftJamMulai = '';
      let shiftJamSelesai = '';
      if (selectedShift) {
           const splitJam = selectedShift.split('-');
           if(splitJam.length === 2) {
               shiftJamMulai = splitJam[0].trim();
               shiftJamSelesai = splitJam[1].trim();
           }
      }

      const payload = { 
          action: isEditMode ? 'edit_absen' : 'absen', 
          uuid: isEditMode ? editItem.uuid : null, 
          userId: user.id, 
          nama: user.nama, 
          tipe: type, 
          lokasi: location ? `${location.lat}, ${location.lng}` : '-', 
          catatan: catatan, 
          foto: photo, 
          // Jika isUploading false, kirim null meskipun state fileLampiran ada isinya
          fileLampiran: isUploading ? fileLampiran : null, 
          fileName: isUploading ? fileName : '',
          fileMime: isUploading ? fileMime : '',
          ...intervalData,
          jamMulai: isShiftWorker && isClockIn ? shiftJamMulai : intervalData.jamMulai,
          jamSelesai: isShiftWorker && isClockIn ? shiftJamSelesai : intervalData.jamSelesai
      };

      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') { 
        alert(data.message);
        if (data.newSisaCuti !== undefined) {
           const updatedUser = { ...user, sisaCuti: data.newSisaCuti };
           setUser(updatedUser);
           localStorage.setItem('app_user', JSON.stringify(updatedUser));
        }
        setEditItem(null); 
        setView(isEditMode ? 'history' : 'dashboard');
      } else { alert(data.message); }
    } catch (e) { alert('Gagal kirim.'); } finally { setIsSubmitting(false); }
  };
  
  const handleBack = () => { setEditItem(null); setView(isEditMode ? 'history' : 'dashboard'); }
  
  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold ml-2">{isEditMode ? 'Edit Data' : `Form ${type}`}</h2>
        <BackButton onClick={handleBack} />
      </div>
      
      {isH3Required && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-3 mb-4 text-xs">
          <p className="font-bold">Perhatian!</p>
          <p>Pengajuan {type} wajib dilakukan maksimal 3 hari setelahnya.</p>
        </div>
      )}

      {/* --- FORM CONTAINER --- */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4">
        
        {isShiftWorker && isClockIn && !isEditMode && (
            <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                <label className="text-xs font-bold text-indigo-800 block mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Pilih Jam Kerja Shift Hari Ini:
                </label>
                <select 
                    className="w-full p-2.5 text-sm border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                    value={selectedShift}
                    onChange={(e) => setSelectedShift(e.target.value)}
                >
                    <option value="">-- Pilih Jam Shift --</option>
                    {availableShifts.map((s, idx) => (
                        <option key={idx} value={s.value}>{s.label} ({s.value})</option>
                    ))}
                </select>
            </div>
        )}

        {isIntervalType && (
            <div className="bg-blue-50 p-3 rounded-lg space-y-3 border border-blue-100">
                <h4 className="font-bold text-blue-800 text-sm flex items-center gap-2"><Calendar className="w-4 h-4"/> Detail Waktu</h4>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-gray-500">Tgl Mulai *</label>
                        <input type="date" min={minDateLimit} className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.tglMulai} onChange={e => setIntervalData({...intervalData, tglMulai: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Tgl Selesai *</label>
                        <input type="date" min={intervalData.tglMulai || minDateLimit} className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.tglSelesai} onChange={e => setIntervalData({...intervalData, tglSelesai: e.target.value})} />
                    </div>
                    {isTimeRequired && (
                        <>
                            <div><label className="text-xs text-gray-500">Jam Mulai *</label><input type="time" className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.jamMulai} onChange={e => setIntervalData({...intervalData, jamMulai: e.target.value})} /></div>
                            <div><label className="text-xs text-gray-500">Jam Selesai *</label><input type="time" className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.jamSelesai} onChange={e => setIntervalData({...intervalData, jamSelesai: e.target.value})} /></div>
                        </>
                    )}
                </div>
            </div>
        )}

        {isUploadAllowed && (
            <div className="space-y-3">
                {/* TOMBOL PILIHAN: Upload atau Tidak */}
                <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2">
                        <FileIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-xs font-bold text-gray-700">Upload Lampiran</span>
                    </div>
                    <button 
                        type="button"
                        onClick={() => {
                            setIsUploading(!isUploading);
                            if (isUploading) { setFileLampiran(null); setFileName(''); }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isUploading ? 'bg-blue-600' : 'bg-gray-300'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isUploading ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {isUploading && (
                    <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 border-dashed animate-pulse-subtle">
                        <label className="text-xs font-bold text-orange-800 block mb-2 flex items-center gap-2">
                             Pilih File (Wajib jika opsi aktif)
                        </label>
                        <input 
                            type="file" 
                            id="lampiranInput"
                            accept="image/*,.pdf" 
                            className="hidden" 
                            onChange={handleFileChange}
                        />
                        <label htmlFor="lampiranInput" className="cursor-pointer w-full flex flex-col items-center justify-center p-4 bg-white border border-orange-200 rounded-lg hover:bg-orange-100 transition">
                            <Upload className="w-6 h-6 text-orange-500 mb-1" />
                            <span className="text-xs font-bold text-gray-600 text-center">
                                {fileName ? fileName : "Klik untuk Upload File"}
                            </span>
                            <span className="text-[9px] text-gray-400 mt-1">(Max 5MB - Gambar/PDF)</span>
                        </label>
                    </div>
                )}
            </div>
        )}

        {isPhotoRequired && (
          <>
            {!isEditMode && (
              <div className="bg-gray-100 rounded-lg h-72 flex items-center justify-center relative border-2 border-dashed overflow-hidden">
                {!photo && !cameraActive && (
                    <button onClick={startCamera} className="text-blue-600 flex flex-col items-center gap-2 p-4">
                        <div className="bg-blue-100 p-3 rounded-full"><Camera className="w-8 h-8" /></div>
                        <span className="text-sm font-bold">Buka Kamera (Wajib)</span>
                        {type === 'Sakit' && <span className="text-xs text-gray-500">(Foto Surat Dokter)</span>}
                    </button>
                )}
                
                <video ref={videoRef} autoPlay playsInline className={`absolute inset-0 w-full h-full object-cover ${cameraActive && !photo ? 'block' : 'hidden'}`} />
                <canvas ref={canvasRef} className="hidden" />
                
                {photo && <img src={photo} alt="Preview Absensi" className="absolute inset-0 w-full h-full object-cover" />}
                
                {cameraActive && (
                    <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-6">
                         <button onClick={toggleCamera} className="bg-white/30 backdrop-blur-sm p-3 rounded-full hover:bg-white/50 transition text-white border border-white/50 shadow-sm">
                            <History className="w-5 h-5" /> 
                         </button>
                         <button onClick={takePhoto} className="bg-white rounded-full p-1 shadow-lg transform active:scale-95 transition">
                            <div className="w-14 h-14 bg-red-600 rounded-full border-4 border-white"></div>
                        </button>
                         <div className="w-11"></div> 
                    </div>
                )}
                
                {cameraActive && (
                    <div className="absolute top-4 right-4 bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm">
                        {facingMode === 'user' ? 'Kamera Depan' : 'Kamera Belakang'}
                    </div>
                )}
              </div>
            )}
            {photo && !isEditMode && (
                <button onClick={() => {setPhoto(null); startCamera();}} className="w-full py-2 text-center text-blue-600 text-sm font-bold bg-blue-50 rounded-lg hover:bg-blue-100 transition">
                    Ambil Foto Ulang
                </button>
            )}
          </>
        )}
        
        {!isEditMode && isGpsRequired && (
            <div className="flex items-center gap-3 bg-blue-50 p-3 rounded-lg text-blue-800 border border-blue-100">
                <MapPin className="text-red-500"/><span className="text-sm font-medium">{location ? `${location.lat}, ${location.lng}` : 'Mencari Lokasi...'}</span>
            </div>
        )}

        <textarea className="w-full border p-3 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Alasan..." rows="2" value={catatan} onChange={e => setCatatan(e.target.value)}></textarea>
      </div>
      
      <button onClick={handleSubmit} disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold mt-6 mb-10 shadow-lg active:scale-95 transition-all">
          {isSubmitting ? 'Mengirim Data...' : (isEditMode ? 'Update Data' : 'Kirim Sekarang')}
      </button>
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
      const res = await fetch(SCRIPT_URL, { 
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

  // --- LOGIC APPROVE/REJECT (Sama seperti sebelumnya) ---
  const handleDecision = async (uuid, decision, namaUser) => {
      const isReject = decision === 'reject';
      const actionText = isReject ? 'Menolak' : 'Menyetujui';
      const pesanPrompt = isReject 
          ? `Alasan PENOLAKAN untuk ${namaUser} (Wajib diisi):` 
          : `Catatan PERSETUJUAN untuk ${namaUser} (Opsional):`;
      
      const alasanInput = window.prompt(pesanPrompt, "");
      if (alasanInput === null) return;
      if (isReject && alasanInput.trim() === "") {
          alert("Gagal! Anda wajib memberikan alasan jika menolak pengajuan.");
          return;
      }
  
      if (!window.confirm(`Yakin ingin ${actionText} pengajuan ini?`)) return;
      
      // Optimistic Update UI (Biar terasa cepat)
      const newList = list.filter(item => item.uuid !== uuid);
      setList(newList);

      try {
          const res = await fetch(SCRIPT_URL, { 
              method: 'POST', 
              body: JSON.stringify({ 
                  action: 'process_approval', 
                  uuid, 
                  decision, 
                  approverName: user.nama,
                  alasan: alasanInput.trim() 
              }) 
          }).then(r => r.json());
          
          if (res.result === 'success') { 
              alert(res.message);
              // fetchApprovalList(); // Tidak perlu fetch ulang jika optimistic update sukses
          } else {
              alert(res.message);
              fetchApprovalList(); // Revert jika gagal
          }
      } catch (e) {
          alert('Terjadi kesalahan koneksi');
          fetchApprovalList();
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
              <p className="text-[10px] text-slate-500 font-medium">Menunggu persetujuan Anda</p>
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

// --- 5. HISTORY SCREEN (FINAL: SWEET UI, DYNAMIC FONTS & COLORS) ---
function HistoryScreen({ user, setView, setEditItem, masterData }) {
  const [history, setHistory] = useState([]);
  const [shiftReport, setShiftReport] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);

  // FILTER STATE
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All'); 
  
  // REPORT STATE
  const [showWebReport, setShowWebReport] = useState(false);
  const [reportStatusFilter, setReportStatusFilter] = useState('All');
  const [reportCategory, setReportCategory] = useState('General'); 
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportFormFilter, setReportFormFilter] = useState('All');

  // REPORT FILTER STATE
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  // MULTI-SELECT FILTERS
  const [reportUserIds, setReportUserIds] = useState([]); 
  const [reportDivisiFilters, setReportDivisiFilters] = useState([]); 
  
  // UI TOGGLES
  const [isReportFilterExpanded, setIsReportFilterExpanded] = useState(false); 
  const [isPosisiFilterExpanded, setIsPosisiFilterExpanded] = useState(false); 
  const [searchReportUser, setSearchReportUser] = useState('');

  // REFS
  const filterPosisiRef = useRef(null);
  const filterNamaRef = useRef(null);

  const userRole = user.role ? String(user.role).toLowerCase() : '';
  const canViewAll = ['admin', 'hrd'].includes(userRole);
  const isSuperAdmin = userRole === 'admin' && (user.lokasi === 'All' || !user.lokasi);
  
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]); 
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [locationFilter, setLocationFilter] = useState('All');
  const [searchUser, setSearchUser] = useState('');

  const APPROVAL_TYPES = ['Cuti', 'Sakit', 'Dinas Luar', 'Lembur', 'Tukar Shift', 'Off', 'Cuti EO'];

  // --- EFFECT ---
  useEffect(() => {
      if (showWebReport) {
          setReportStartDate(filterStart);
          setReportEndDate(filterEnd);
          setIsReportLoading(true);
          setTimeout(() => setIsReportLoading(false), 800);
      }
  }, [showWebReport]);

  // --- FETCH DATA ---
  const fetchUsers = async () => {
    try {
        const res = await fetch(SCRIPT_URL, { 
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
        // [PERBAIKAN 1]: Menggunakan locationFilter jika user adalah Super Admin
        requestorLokasi: isSuperAdmin ? locationFilter : (user.lokasi || 'All'), 
        targetUserIds: canViewAll ? selectedUserIds : [] 
      };
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') setHistory(data.history);
    } catch (e) { alert('Gagal ambil data history'); } finally { setLoading(false); }
  };

  const fetchShiftReport = async () => {
    if (reportCategory !== 'RunningShift') return;
    setIsReportLoading(true);
    try {
       const res = await fetch(SCRIPT_URL, {
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
  }, [showWebReport, reportCategory]);

  // --- HELPER FORMAT ---
  const formatDateIndo = (d) => { if (!d || d === '-') return '-'; try { return new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return d; } };
  const formatDateShort = (d) => { if (!d || d === '-') return '-'; try { return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}); } catch (e) { return d; } };
  const formatTimeOnly = (val) => { if (!val || val === '-') return '-'; if (typeof val === 'string' && (val.includes('T') || val.length > 8)) { try { const d = new Date(val); if (!isNaN(d.getTime())) { return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':'); } } catch (e) { return val.substring(0, 5); } } return val.length >= 5 ? val.substring(0, 5) : val; };
  const uniqueForms = ['All', ...new Set(history.map(item => item.tipe))];
  const uniqueStatuses = ['All', ...new Set(history.map(item => item.status).filter(Boolean))];
  const formatDateTimeFull = (val) => { if (!val || val === '-') return '-'; try { const d = new Date(val); if(isNaN(d.getTime())) return val; const dd = String(d.getDate()).padStart(2, '0'); const mm = String(d.getMonth() + 1).padStart(2, '0'); const yy = String(d.getFullYear()).slice(-2); const hh = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0'); return `${dd}-${mm}-${yy} ${hh}:${min}`; } catch(e) { return val; } };
  const getDurasiHari = (start, end) => {
    if (!start || start === '-' || !end || end === '-') return '';
    try {
        const d1 = new Date(start);
        const d2 = new Date(end);
        const diffTime = Math.abs(d2 - d1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
        return `(${diffDays})`;
    } catch (e) { return ''; }
  };


  // --- FILTERS ---
  const toggleReportUserSelection = (id) => {
    if(reportUserIds.includes(id)) setReportUserIds(reportUserIds.filter(x => x !== id));
    else setReportUserIds([...reportUserIds, id]);
  };
  const toggleReportDivisiSelection = (div) => {
    if(reportDivisiFilters.includes(div)) setReportDivisiFilters(reportDivisiFilters.filter(x => x !== div));
    else setReportDivisiFilters([...reportDivisiFilters, div]);
  };

  // --- CORE DATA PROCESSING ---
  const processReportData = () => {
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
                      nama: item.nama,
                      idAkun: item.noPayroll || '-',
                      divisi: item.divisi || '-',
                      dateObj: new Date(item.waktu),
                      tanggal: item.waktu,
                      foto: item.foto || '-', 
                      catatan: item.catatan ? [item.catatan] : [],
                      masuk: '-', pulang: '-', standby: '-'
                  };
              } else {
                  if (item.catatan) groupedMap[groupKey].catatan.push(item.catatan);
                  if ((!groupedMap[groupKey].foto || groupedMap[groupKey].foto === '-') && item.foto) {
                      groupedMap[groupKey].foto = item.foto;
                  }
              }

              const timeStr = formatTimeOnly(item.waktu); 
              if (item.tipe === 'Hadir') groupedMap[groupKey].masuk = timeStr;
              else if (item.tipe === 'Pulang') groupedMap[groupKey].pulang = timeStr;
              else if (item.tipe === 'Standby' || item.tipe === 'Off') groupedMap[groupKey].standby = timeStr; 
          });

          finalData = Object.values(groupedMap).map(g => ({
              ...g,
              catatan: g.catatan.join('; ')
          }));
      } 
      else {
          let sourceData = (reportCategory === 'RunningShift') ? shiftReport : history;
          finalData = sourceData.filter(item => {
              const dateRef = reportCategory === 'RunningShift' ? item.tanggal : item.waktu;
              const itemDate = new Date(dateRef).setHours(0, 0, 0, 0);
              const matchDate = (!start && !end) || (itemDate >= start && itemDate <= end);
              
              let matchStatus = true;
              let matchForm = true; // [BARU]

              if (reportCategory === 'General') {
                 // Filter Status
                 matchStatus = (reportStatusFilter === 'All' || item.status === reportStatusFilter);
                 // [BARU]: Filter Form
                 matchForm = (reportFormFilter === 'All' || item.tipe === reportFormFilter);
              }
              
              return matchDate && matchStatus && matchForm; // [UPDATE RETURN]
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

      finalData.sort((a, b) => {
          const nameCompare = a.nama.localeCompare(b.nama);
          if (nameCompare !== 0) return nameCompare;
          const dA = new Date(a.dateObj || a.tanggal || a.waktu);
          const dB = new Date(b.dateObj || b.tanggal || b.waktu);
          return dB - dA;
      });

      return { finalData, availableUsers, availableDivisions };
  };

  const { finalData: currentReportData, availableUsers, availableDivisions } = processReportData();

  const selectAllReportUsers = () => {
     const visibleIds = availableUsers.filter(u => u.nama.toLowerCase().includes(searchReportUser.toLowerCase())).map(u => u.id);
     if(visibleIds.every(id => reportUserIds.includes(id))) { setReportUserIds(reportUserIds.filter(id => !visibleIds.includes(id))); } 
     else { setReportUserIds([...new Set([...reportUserIds, ...visibleIds])]); }
  };
  const selectAllDivisions = () => {
     if(availableDivisions.every(d => reportDivisiFilters.includes(d))) { setReportDivisiFilters([]); } 
     else { setReportDivisiFilters(availableDivisions); }
  };

  // --- EXCEL ---
  const generateExcel = () => {
    let tableHead = [];
    let tableBody = [];

    if (reportCategory === 'RunningShift') {
        tableHead = ["No", "ID Akun", "Nama", "Posisi", "Tanggal Shift", "Kode Shift", "Jam Kerja", "Waktu Input"];
        tableBody = currentReportData.map((item, index) => [
            index + 1, item.idAkun || '-', item.nama, item.divisi || '-',
            formatDateIndo(item.tanggal), item.shiftValue, item.shiftLabel, formatDateTimeFull(item.waktuInput)
        ]);
    } else if (reportCategory === 'Tally') {
        tableHead = ["No", "ID Akun", "Nama", "Posisi", "Tanggal", "Masuk", "Pulang", "Standby", "Foto URL", "Catatan"];
        tableBody = currentReportData.map((item, index) => [
            index + 1, item.idAkun || '-', item.nama, item.divisi || '-',
            formatDateIndo(item.tanggal), item.masuk, item.pulang, item.standby, item.foto || '-', item.catatan || '-'
        ]);
    } else {
        // [BARU]: Logika Excel untuk Laporan Absensi (General)
        tableHead = ["No", "ID Akun", "Payroll", "Nama", "Form", "Waktu Input", "Periode", "Catatan", "Status", "Approval"];
        tableBody = currentReportData.map((item, index) => {
            let p = item.tglMulai && item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : (item.jamMulai && item.jamMulai !== '-' ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-');
            return [
                index + 1, item.idAkun || '-', item.noPayroll || '-', item.nama, item.tipe, 
                formatDateTimeFull(item.waktu), p, item.catatan || '-', item.status, 
                item.approvalTime && item.approvalTime !== '-' ? formatDateTimeFull(item.approvalTime) : '-'
            ];
        });
    }
    
    const worksheet = XLSX.utils.aoa_to_sheet([tableHead, ...tableBody]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan");
    XLSX.writeFile(workbook, `Laporan_${reportCategory}_${reportStartDate || 'All'}.xlsx`);
  };

  // --- PDF ---
  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const marginLeft = 10; const marginTop = 10;
    
    doc.setFontSize(10); doc.setFont("helvetica", "bold");
    let judul = "LAPORAN DATA ABSENSI";
    if (reportCategory === 'RunningShift') judul = "LAPORAN RUNNING SHIFT (JADWAL)";
    if (reportCategory === 'Tally') judul = "LAPORAN ABSEN ONLINE TALLY";
    
    doc.text(judul, marginLeft, marginTop);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    
    const posisiText = reportDivisiFilters.length > 0 ? reportDivisiFilters.join(', ') : 'Semua Posisi';
    const infoFilter = `Periode: ${reportStartDate || 'Awal'} s/d ${reportEndDate || 'Akhir'} | Posisi: ${posisiText} | Total: ${currentReportData.length}`;
    doc.text(infoFilter, marginLeft, marginTop + 4);

    let tableColumn = [];
    let tableRows = [];

    if (reportCategory === 'RunningShift') {
        tableColumn = ["No", "ID Akun", "Nama", "Posisi", "Tanggal Shift", "Kode", "Jam Kerja", "Waktu Input"];
        currentReportData.forEach((item, index) => {
            tableRows.push([index + 1, item.idAkun || '-', item.nama, item.divisi || '-', formatDateIndo(item.tanggal), item.shiftValue, item.shiftLabel, formatDateTimeFull(item.waktuInput)]);
        });
    } else if (reportCategory === 'Tally') {
        tableColumn = ["No", "ID Akun", "Nama", "Posisi", "Tanggal", "Masuk", "Pulang", "Standby", "Foto URL", "Catatan"];
        currentReportData.forEach((item, index) => {
            tableRows.push([
                index + 1, item.idAkun, item.nama, item.divisi, formatDateIndo(item.tanggal), 
                item.masuk, item.pulang, item.standby, item.foto || '-', item.catatan || '-'
            ]);
        });
    } else {
        tableColumn = ["No", "ID Akun", "Payroll", "Nama", "Form", "Waktu Input", "Periode", "Catatan", "Status", "Approval"];
        currentReportData.forEach((item, index) => {
            let p = item.tglMulai && item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : (item.jamMulai && item.jamMulai !== '-' ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-');
            tableRows.push([index + 1, item.idAkun || '-', item.noPayroll || '-', item.nama, item.tipe, formatDateTimeFull(item.waktu), p, item.catatan || '-', item.status, item.approvalTime && item.approvalTime !== '-' ? formatDateTimeFull(item.approvalTime) : '-']);
        });
    }

    autoTable(doc, {
      head: [tableColumn], body: tableRows, startY: 18, theme: 'grid', 
      margin: { top: 15, right: 10, bottom: 10, left: 10 }, 
      styles: { fontSize: 6, cellPadding: 1, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [50, 50, 50], fontSize: 7, fontStyle: 'bold', halign: 'center' },
    });
    doc.save(`Laporan_${reportCategory}_${reportStartDate}.pdf`);
  };

  // --- ACTIONS ---
  const handleRequestApproval = async (item) => {
    const detailTanggal = item.tglMulai && item.tglMulai !== '-' ? `${formatDateIndo(item.tglMulai)} s/d ${formatDateIndo(item.tglSelesai)}` : formatDateIndo(item.waktu);
    if (!window.confirm(`Kirim ulang email approval untuk ${item.tipe} (${detailTanggal})?`)) return;
    setSendingEmail(true);
    try {
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'request_approval_email', uuid: item.uuid }) });
      const data = await res.json(); alert(data.message);
    } catch (e) { alert("Gagal kirim email"); } finally { setSendingEmail(false); }
  };
  const handleDelete = async (uuid) => { 
      if (!window.confirm('Yakin hapus data ini?')) return;
      try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'delete_absen', uuid }) });
      const data = await res.json(); if (data.result === 'success') { alert('Berhasil dihapus'); fetchHistory(); } else { alert(data.message); } } catch (e) { alert('Gagal hapus'); } 
  };
  const handleEdit = (item) => { setEditItem(item); localStorage.setItem('absenType', item.tipe); setView('form'); };
  const isEditable = (waktuStr, status) => { if (status === 'Approved' || status === 'Rejected') return false; if (!waktuStr || waktuStr === '-') return false; try { return (new Date().getTime() - new Date(waktuStr).getTime()) / (1000 * 60 * 60) <= 1; } catch (e) { return false; } };
  const getFilteredHistory = () => { return history.filter(item => { const itemDate = new Date(item.waktu).setHours(0, 0, 0, 0); const start = filterStart ? new Date(filterStart).setHours(0, 0, 0, 0) : null; const end = filterEnd ? new Date(filterEnd).setHours(23, 59, 59, 999) : null; return ((!start && !end) || (itemDate >= start && itemDate <= end)) && (filterType === 'All' || item.tipe === filterType) && (filterStatus === 'All' || item.status === filterStatus); }); };
  const getStatusColor = (status) => { if (status === 'Approved' || status === 'Verified') return 'bg-emerald-100 text-emerald-700 border-emerald-200'; if (status === 'Rejected') return 'bg-rose-100 text-rose-700 border-rose-200'; return 'bg-amber-100 text-amber-700 border-amber-200'; };
  const toggleUserSelection = (id) => { if(selectedUserIds.includes(id)) { setSelectedUserIds(selectedUserIds.filter(x => x !== id)); } else { setSelectedUserIds([...selectedUserIds, id]); } };
  const selectAllUsers = () => { const visibleIds = allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).map(u => u.id); if(visibleIds.every(id => selectedUserIds.includes(id))) { setSelectedUserIds(selectedUserIds.filter(id => !visibleIds.includes(id))); } else { setSelectedUserIds([...new Set([...selectedUserIds, ...visibleIds])]); } };
  const uniqueTypes = ['All', ...new Set(history.map(item => item.tipe))];
  const displayData = getFilteredHistory().filter(item => { if (canViewAll) { if (item.tipe === 'Hadir' || item.tipe === 'Pulang') return false; } return true; });

  return (
    <div className="p-4 h-full overflow-y-auto pb-20 bg-gray-50/50">
      
      {/* --- MODAL WEB REPORT (FIXED LAYOUT & SWEET UI) --- */}
      {showWebReport && (
        <div className="fixed inset-0 bg-slate-200/50 backdrop-blur-sm z-[60] flex flex-col font-sans animate-in fade-in duration-200">
          
          {/* 1. TOP HEADER (GRADIENT) */}
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

          {/* 2. CONTROL PANEL */}
          <div className="bg-white/90 backdrop-blur-md shadow-sm z-20 border border-gray-100 mx-2 mt-2 rounded-2xl flex-none flex flex-col overflow-visible">
              
              {/* Row 1: Main Controls */}
              <div className="p-4 flex flex-wrap gap-4 items-center justify-between">
                  
                  {/* Filter Kiri */}
                  <div className="flex flex-wrap gap-3 items-center">
                      {/* Periode Pill */}
                      <div className="flex items-center bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 shadow-sm hover:shadow-md transition-shadow">
                          <span className="text-[10px] text-slate-500 font-bold mr-2 uppercase tracking-wider">Periode</span>
                          <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-24 cursor-pointer" />
                          <span className="text-slate-300 mx-1">|</span>
                          <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-24 cursor-pointer" />
                      </div>

                      {/* Kategori Selector */}
                      <div className="relative">
                        <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)} className="appearance-none pl-4 pr-8 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 rounded-full cursor-pointer outline-none transition-all shadow-sm">
                            <option value="General">Laporan Absensi</option>
                            {canViewAll && <option value="RunningShift">Running Shift</option>}
                            {canViewAll && <option value="Tally">Absen Tally</option>}
                        </select>
                        <ChevronDown className="w-3 h-3 text-indigo-400 absolute right-3 top-2 pointer-events-none"/>
                      </div>

                      {/* [BARU] Filter FORM (Hanya muncul di General) */}
                      {reportCategory === 'General' && (
                          <div className="relative">
                            <select value={reportFormFilter} onChange={(e) => setReportFormFilter(e.target.value)} className="appearance-none pl-4 pr-8 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-full cursor-pointer outline-none transition-all shadow-sm">
                                <option value="All">Semua Form</option>
                                {uniqueForms.filter(t => t !== 'All').map((type, idx) => (
                                    <option key={idx} value={type}>{type}</option>
                                ))}
                            </select>
                            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-3 top-2 pointer-events-none"/>
                          </div>
                      )}

                      {/* Status Selector (DINAMIS) */}
                      {reportCategory !== 'RunningShift' && reportCategory !== 'Tally' && (
                          <div className="relative">
                            <select 
                                value={reportStatusFilter} 
                                onChange={(e) => setReportStatusFilter(e.target.value)} 
                                className="appearance-none pl-4 pr-8 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-full cursor-pointer outline-none transition-all shadow-sm"
                            >
                                {/* [PERUBAHAN DISINI]: Mapping dari uniqueStatuses */}
                                {uniqueStatuses.map((status, idx) => (
                                    <option key={idx} value={status}>
                                        {status === 'All' ? 'Semua Status' : status}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-3 top-2 pointer-events-none"/>
                          </div>
                      )}
                  </div>

                  {/* Actions Kanan */}
                  <div className="flex items-center gap-3">
                      {canViewAll && (
                          <button onClick={() => setShowAdvancedFilter(!showAdvancedFilter)} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border shadow-sm ${showAdvancedFilter ? 'bg-blue-50 text-blue-600 border-blue-200 ring-2 ring-blue-100' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                              <Filter className="w-3.5 h-3.5" /> Filter {reportDivisiFilters.length + reportUserIds.length > 0 && <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>}
                          </button>
                      )}
                      
                      <div className="h-6 w-px bg-slate-200 mx-1"></div>

                      <div className="flex gap-2">
                          <button onClick={generatePDF} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-200 transition-all active:scale-95" title="PDF">
                              <Printer className="w-3.5 h-3.5" /> PDF
                          </button>
                         
                          {/* [BARU] Tombol Excel dengan Logic Role */}
                          {/* Muncul Jika: RunningShift/Tally ATAU (General DAN user adalah Admin/HRD) */}
                          {(reportCategory === 'RunningShift' || reportCategory === 'Tally' || (reportCategory === 'General' && canViewAll)) && (
                              <button onClick={generateExcel} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-200 transition-all active:scale-95" title="Excel">
                                  <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                              </button>
                          )}
                      </div>
                  </div>
              </div>

              {/* Row 2: Advanced Filter (Sliding Panel) */}
              <div className={`transition-all duration-300 ease-in-out border-t border-dashed border-slate-200 bg-slate-50/50 ${showAdvancedFilter ? 'max-h-[500px] opacity-100 p-4' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Filter Posisi */}
                        <div className="relative">
                            <button onClick={() => setIsPosisiFilterExpanded(!isPosisiFilterExpanded)} className="w-full p-2.5 px-4 text-xs border border-slate-200 rounded-xl bg-white shadow-sm flex justify-between items-center text-left hover:border-indigo-300 hover:ring-2 hover:ring-indigo-50 transition-all">
                                <span className="truncate text-slate-600 font-bold">{reportDivisiFilters.length > 0 ? `${reportDivisiFilters.length} Posisi Dipilih` : 'Semua Posisi'}</span>
                                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isPosisiFilterExpanded ? 'rotate-180' : ''}`}/>
                            </button>
                            {isPosisiFilterExpanded && (
                                <div className="mt-2 bg-white p-3 rounded-xl border border-slate-100 shadow-xl z-10 animate-in fade-in slide-in-from-top-2">
                                    <button onClick={selectAllDivisions} className="text-[10px] font-bold text-indigo-600 mb-2 hover:underline w-full text-left uppercase tracking-wider">{reportDivisiFilters.length > 0 ? 'Reset Pilihan' : 'Pilih Semua'}</button>
                                    <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
                                        {availableDivisions.map((div, i) => (
                                            <label key={i} className="flex items-center gap-2.5 text-xs cursor-pointer hover:bg-indigo-50 p-1.5 rounded-lg transition-colors">
                                                <input type="checkbox" checked={reportDivisiFilters.includes(div)} onChange={() => toggleReportDivisiSelection(div)} className="w-4 h-4 text-indigo-600 rounded-md border-gray-300 focus:ring-indigo-500 transition duration-150 ease-in-out" />
                                                <span className="truncate font-medium text-slate-600">{div}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Filter Nama */}
                        <div className="relative">
                            <button onClick={() => setIsReportFilterExpanded(!isReportFilterExpanded)} className="w-full p-2.5 px-4 text-xs border border-slate-200 rounded-xl bg-white shadow-sm flex justify-between items-center text-left hover:border-blue-300 hover:ring-2 hover:ring-blue-50 transition-all">
                                <span className="truncate text-slate-600 font-bold">{reportUserIds.length > 0 ? `${reportUserIds.length} Karyawan Dipilih` : 'Semua Karyawan'}</span>
                                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isReportFilterExpanded ? 'rotate-180' : ''}`}/>
                            </button>
                            {isReportFilterExpanded && (
                                <div className="mt-2 bg-white p-3 rounded-xl border border-slate-100 shadow-xl z-10 animate-in fade-in slide-in-from-top-2">
                                    <div className="mb-2 relative">
                                        <input type="text" placeholder="Cari nama..." value={searchReportUser} onChange={(e) => setSearchReportUser(e.target.value)} className="w-full py-1.5 pl-8 pr-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none transition-all" />
                                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2"/>
                                    </div>
                                    <button onClick={selectAllReportUsers} className="text-[10px] font-bold text-blue-600 mb-2 hover:underline w-full text-left uppercase tracking-wider">{reportUserIds.length > 0 ? 'Reset Pilihan' : 'Pilih Semua'}</button>
                                    <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
                                        {availableUsers.map((u) => ( (u.nama.toLowerCase().includes(searchReportUser.toLowerCase())) && 
                                            <label key={u.id} className="flex items-center gap-2.5 text-xs cursor-pointer hover:bg-blue-50 p-1.5 rounded-lg transition-colors">
                                                <input type="checkbox" checked={reportUserIds.includes(u.id)} onChange={() => toggleReportUserSelection(u.id)} className="w-4 h-4 text-blue-600 rounded-md border-gray-300 focus:ring-blue-500 transition duration-150 ease-in-out" />
                                                <span className="truncate font-medium text-slate-600">{u.nama}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                  </div>
              </div>
          </div>

          {/* 3. TABLE AREA */}
          <div className="flex-1 overflow-hidden relative flex flex-col mx-2 mb-2 rounded-b-2xl">
                {isReportLoading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-50 flex flex-col items-center justify-center rounded-2xl">
                        <div className="bg-white p-4 rounded-2xl shadow-xl flex flex-col items-center animate-bounce-slow">
                             <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-2"/>
                             <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Loading...</span>
                        </div>
                    </div>
                )}
                
                <div className="flex-1 overflow-auto bg-white rounded-2xl shadow-sm border border-gray-100 custom-scrollbar">
                        <table className="w-full whitespace-nowrap">
                            <thead className="sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-center text-slate-600 uppercase bg-slate-100 border-b border-slate-200">No</th>
                                    <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">ID Akun</th>
                                    <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Nama</th>
                                    <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Posisi</th>
                                    
                                    {reportCategory === 'RunningShift' && (
                                        <>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Tanggal Shift</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Kode</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Jam Kerja</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Input</th>
                                        </>
                                    )}

                                    {reportCategory === 'Tally' && (
                                        <>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Tanggal</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-center text-emerald-700 uppercase bg-emerald-50 border-b border-emerald-100">Masuk</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-center text-rose-700 uppercase bg-rose-50 border-b border-rose-100">Pulang</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-center text-amber-700 uppercase bg-amber-50 border-b border-amber-100">Standby</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Foto</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Catatan</th>
                                        </>
                                    )}

                                    {reportCategory === 'General' && (
                                        <>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Form</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Input</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Periode/Jam</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-left text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Catatan</th>
                                            <th className="px-4 py-3 text-xs font-extrabold tracking-wider text-center text-slate-600 uppercase bg-slate-100 border-b border-slate-200">Status</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 bg-white">
                              {currentReportData.map((item, index) => (
                                    <tr key={index} className="hover:bg-blue-50/40 transition-colors group">
                                        <td className="px-4 py-3 text-[11px] font-medium text-center text-gray-400 group-hover:text-gray-600">{index + 1}</td>
                                        <td className="px-4 py-3 text-[11px] font-semibold text-gray-500 font-mono tracking-tight">{reportCategory === 'RunningShift' ? (item.idAkun || '-') : (item.idAkun || item.noPayroll || '-')}</td>
                                        <td className="px-4 py-3 text-[11px] font-bold text-gray-700 group-hover:text-blue-700">{item.nama}</td>
                                        <td className="px-4 py-3 text-[11px] font-medium text-gray-500">{item.divisi || '-'}</td>

                                        {reportCategory === 'RunningShift' && (
                                            <>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-600">{formatDateIndo(item.tanggal)}</td>
                                                <td className="px-4 py-3 text-[11px] font-bold text-gray-700 font-mono bg-gray-50/50 rounded">{item.shiftValue}</td>
                                                <td className="px-4 py-3 text-[11px] font-bold text-blue-600">{item.shiftLabel}</td>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-400">{formatDateTimeFull(item.waktuInput)}</td>
                                            </>
                                        )}

                                        {reportCategory === 'Tally' && (
                                            <>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-600">{formatDateIndo(item.tanggal)}</td>
                                                <td className="px-4 py-3 text-[11px] font-bold text-center text-emerald-600 bg-emerald-50/30 font-mono tracking-tight">{item.masuk}</td>
                                                <td className="px-4 py-3 text-[11px] font-bold text-center text-rose-600 bg-rose-50/30 font-mono tracking-tight">{item.pulang}</td>
                                                <td className="px-4 py-3 text-[11px] font-bold text-center text-amber-600 bg-amber-50/30 font-mono tracking-tight">{item.standby}</td>
                                                <td className="px-4 py-3 text-[11px]">
                                                    {(item.foto && item.foto !== '-') ? (
                                                        <a href={item.foto} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-700 font-bold bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors"><Camera className="w-3 h-3"/> Foto</a>
                                                    ) : <span className="text-gray-300 italic">-</span>}
                                                </td>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-500 italic truncate max-w-[150px]">{item.catatan}</td>
                                            </>
                                        )}

                                        {reportCategory === 'General' && (
                                            <>
                                                <td className="px-4 py-3 text-[11px]"><span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold border border-indigo-100">{item.tipe}</span></td>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-500">{formatDateTimeFull(item.waktu)}</td>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-700">{item.tglMulai && item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : (item.jamMulai && item.jamMulai !== '-' ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-')}</td>
                                                <td className="px-4 py-3 text-[11px] font-medium text-gray-500 italic truncate max-w-[150px]">{item.catatan}</td>
                                                <td className="px-4 py-3 text-[11px] text-center"><span className={`inline-block px-2.5 py-0.5 rounded-full font-bold border ${getStatusColor(item.status)} shadow-sm`}>{item.status}</span></td>
                                            </>
                                        )}
                                    </tr>
                              ))}
                              {currentReportData.length === 0 && ( <tr><td colSpan="10" className="p-12 text-center text-slate-400 italic bg-white"><div className="flex flex-col items-center gap-2"><div className="bg-slate-50 p-3 rounded-full"><FileText className="w-6 h-6 text-slate-300"/></div><span>Tidak ada data untuk periode ini.</span></div></td></tr> )}
                            </tbody>
                        </table>
                </div>
                <div className="bg-white px-4 py-2 border-t border-gray-100 flex justify-between items-center rounded-b-2xl mt-px shadow-sm">
                     <span className="text-[10px] text-slate-400 font-medium">Menampilkan <b>{currentReportData.length}</b> baris data</span>
                     <div className="text-[10px] text-slate-300 italic">E-Absensi System</div>
                </div>
          </div>
        </div>
      )}
      
      {/* --- HEADER UI UTAMA (MODIFIED) --- */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold ml-2 text-slate-800">Riwayat & Laporan</h2>
        <BackButton onClick={() => setView('dashboard')} />
      </div>

      {canViewAll && (
         <div className="bg-slate-800 text-white p-4 rounded-2xl shadow-lg shadow-slate-200 mb-4 ring-1 ring-black/5">
             <button onClick={() => setIsFilterExpanded(!isFilterExpanded)} className="flex items-center justify-between w-full font-bold text-sm hover:text-blue-200 transition-colors">
                <div className="flex items-center gap-2"><Users className="w-4 h-4 text-blue-400"/> Filter Karyawan ({selectedUserIds.length > 0 ? selectedUserIds.length : 'Semua di ' + locationFilter})</div>
                {isFilterExpanded ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
            </button>
            {isFilterExpanded && (
                  <div className="mt-4 bg-slate-700/50 p-4 rounded-xl max-h-[400px] overflow-y-auto animate-in slide-in-from-top-2 border border-slate-600">
                    {isSuperAdmin && (
                        <div className="mb-4 bg-slate-900/50 p-3 rounded-lg border border-slate-600">
                            <label className="text-[10px] text-slate-400 block mb-1 font-bold uppercase tracking-wider">Pilih Lokasi</label>
                             <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="w-full p-2 text-xs font-bold text-slate-200 bg-slate-800 rounded-lg border border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"><option value="All">Semua Lokasi</option><option value="Surabaya">Surabaya</option><option value="Jakarta">Jakarta</option></select>
                        </div>
                     )}
                    <div className="mb-3 relative">
                        <input type="text" placeholder="Cari Nama Karyawan..." value={searchUser} onChange={(e) => setSearchUser(e.target.value)} className="w-full p-2.5 pl-9 text-xs font-medium text-white bg-slate-600 rounded-lg border-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400" />
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3"/>
                    </div>
                    <button onClick={selectAllUsers} className="text-[10px] font-bold text-blue-300 mb-3 hover:text-white uppercase tracking-wider transition-colors">{selectedUserIds.length > 0 ? 'Reset Pilihan' : 'Pilih Semua'}</button>
                    <div className="space-y-1">
                        {allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).map(u => (
                            <label key={u.id} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-slate-600/80 p-2 rounded-lg transition-colors">
                                <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={() => toggleUserSelection(u.id)} className="w-4 h-4 rounded text-blue-500 bg-slate-700 border-slate-500 focus:ring-offset-slate-800" />
                                <span className="flex-1 font-medium text-slate-200">{u.nama}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
         </div>
      )}

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 mb-5">
        <div className="flex items-center gap-2 mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider"><Filter className="w-4 h-4 text-slate-400" /> Filter Data</div>
        <div className="grid grid-cols-2 gap-3 mb-3"> 
          <div><label className="text-[10px] font-bold text-slate-400 block mb-1">Dari Tanggal</label><input type="date" className="w-full border border-gray-300 rounded-lg p-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 outline-none" value={filterStart} onChange={e => setFilterStart(e.target.value)} /></div> 
          <div><label className="text-[10px] font-bold text-slate-400 block mb-1">Sampai Tanggal</label><input type="date" className="w-full border border-gray-300 rounded-lg p-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 outline-none" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></div> 
        </div>
        
        <div className="grid grid-cols-2 gap-3 mb-4">
             <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">Tipe Absen</label>
                <div className="relative">
                    <select className="w-full border border-gray-300 rounded-lg p-2 text-xs font-semibold text-slate-700 bg-white appearance-none focus:ring-2 focus:ring-blue-100 outline-none" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                        {uniqueTypes.map((t, i) => ( <option key={i} value={t}>{t === 'All' ? 'Semua Form' : t}</option> ))}
                    </select>
                    <ChevronDown className="w-3 h-3 text-gray-400 absolute right-3 top-2.5 pointer-events-none"/>
                </div>
             </div>
             <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">Status Approval</label>
                <div className="relative">
                    <select className="w-full border border-gray-300 rounded-lg p-2 text-xs font-semibold text-slate-700 bg-white appearance-none focus:ring-2 focus:ring-blue-100 outline-none" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                        <option value="All">Semua Status</option>
                        <option value="Pending">Pending</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Verified">Verified</option>
                    </select>
                    <ChevronDown className="w-3 h-3 text-gray-400 absolute right-3 top-2.5 pointer-events-none"/>
                </div>
             </div>
        </div>

        <div className="flex gap-2"> 
          <button onClick={() => setShowWebReport(true)} className="flex-1 flex items-center justify-center gap-2 p-2.5 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-colors text-xs font-bold border border-indigo-100 shadow-sm active:scale-[0.98]">
              <Eye className="w-4 h-4" /> Buka Menu Laporan
          </button> 
        </div>
      </div>

      {loading ? (
          <div className="flex flex-col items-center justify-center py-10">
              <Loader2 className="w-8 h-8 text-slate-300 animate-spin mb-2"/>
              <p className="text-xs font-bold text-slate-400">Memuat Riwayat...</p>
          </div>
      ) : (
        <div className="space-y-3">
          {displayData.map((item, idx) => {
            const canEdit = isEditable(item.waktu, item.status);
            const isRegularAbsen = item.tipe === 'Hadir' || item.tipe === 'Pulang';
            const showResendButton = APPROVAL_TYPES.includes(item.tipe) && item.status === 'Pending' && !canViewAll;
            return (
              <div key={idx} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative hover:shadow-md transition-shadow">
                
                {/* HEADER KARTU */}
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        {item.tipe} 
                        {canViewAll && <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">({item.nama})</span>}
                    </h4>
                    
                    {/* [UPDATE]: Timestamp */}
                    <p className="text-xs text-slate-400 font-medium flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3"/> 
                        {formatDateIndo(item.waktu)} 
                        <span className="opacity-50 mx-1">|</span> 
                        {formatTimeOnly(item.waktu)}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {!isRegularAbsen && (<span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${getStatusColor(item.status)}`}>{item.status || 'Pending'}</span>)}
                    {isRegularAbsen && (<span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full font-mono">{formatTimeOnly(item.waktu)}</span>)}
                    
                    {canEdit && !canViewAll && ( 
                        <div className="flex gap-1 mt-1">
                            <button onClick={() => handleEdit(item)} className="p-1.5 bg-yellow-50 text-yellow-600 rounded-lg border border-yellow-100 hover:bg-yellow-100"><Edit className="w-3.5 h-3.5"/></button>
                            <button onClick={() => handleDelete(item.uuid)} className="p-1.5 bg-red-50 text-red-600 rounded-lg border border-red-100 hover:bg-red-100"><Trash2 className="w-3.5 h-3.5"/></button>
                        </div> 
                    )}
                  </div>
                </div>

                {/* CONTENT CATATAN */}
                <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100 mb-2">
                    <p className="text-xs text-slate-600 italic leading-relaxed">"{item.catatan || '-'}"</p>
                </div>

                {/* --- TAMPILAN ALASAN REJECT (POSISI BARU) --- */}
                {item.status === 'Rejected' && item.alasan && item.alasan !== '-' && (
                    <div className="bg-red-50 border border-red-100 p-3 rounded-xl mb-2 animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-start gap-2">
                            <div className="mt-0.5 min-w-[16px]">
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                            </div>
                            <div className="flex-1">
                                <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide leading-none mb-1">
                                    (Ditolak):
                                </p>
                                <p className="text-xs text-red-600 italic leading-relaxed font-medium">
                                    "{item.alasan}"
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* [PERBAIKAN 4]: Tampilkan Durasi Hari */}
                {(item.tglMulai && item.tglMulai !== '-') && (
                    <div className="text-xs text-indigo-600 flex gap-1.5 mt-2 font-bold items-center bg-indigo-50 p-2 rounded-lg w-fit border border-indigo-100">
                        <Calendar className="w-3.5 h-3.5"/> 
                        {formatDateShort(item.tglMulai)} s/d {formatDateShort(item.tglSelesai)}
                        <span className="text-indigo-400 ml-1">{getDurasiHari(item.tglMulai, item.tglSelesai)}</span>
                    </div>
                )}

                {/* [PERBAIKAN 1]: Tampilkan Tombol Foto & Lampiran Kembali */}
                <div className="flex gap-2 mt-3">
                    {item.foto && item.foto.length > 10 && item.foto !== 'Error Upload' && (
                        <a href={item.foto} target="_blank" rel="noreferrer" className="flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-200 hover:bg-blue-100 transition no-underline">
                            <Camera className="w-3 h-3"/> Lihat Foto
                        </a>
                    )}
                    {item.lampiran && item.lampiran.length > 10 && item.lampiran !== '-' && (
                        <a href={item.lampiran} target="_blank" rel="noreferrer" className="flex items-center gap-1 bg-orange-50 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-bold border border-orange-200 hover:bg-orange-100 transition no-underline">
                            <FileIcon className="w-3 h-3"/> Lihat Lampiran
                        </a>
                    )}
                </div>

                {/* TOMBOL RESEND EMAIL */}
                {showResendButton && ( 
                    <button onClick={() => handleRequestApproval(item)} disabled={sendingEmail} className="w-full mt-3 bg-purple-50 text-purple-700 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-purple-100 border border-purple-200 transition-colors"> 
                        {sendingEmail ? 'Mengirim...' : <><CheckSquare className="w-3.5 h-3.5"/> Kirim Ulang Email Approval</>} 
                    </button> 
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- 6. ADMIN PANEL (DIPERBAIKI: TAMBAH MASTER SHIFT) ---
function AdminPanel({ user, setView, masterData }) {
  const [activeTab, setActiveTab] = useState('user');
  const [loading, setLoading] = useState(false);
  
  // State Baru: Untuk menampung teks pengumuman HRD
  const [newsInput, setNewsInput] = useState('');

  // State User Data (Tetap)
  const [userData, setUserData] = useState({ 
    username: '', password: '', nama: '', email: '', 
    divisi: 'Staff', role: 'karyawan', akses: [], 
    noPayroll: '', sisaCuti: '', perusahaan: '', 
    statusKaryawan: '', emailAtasan: '',
    lokasi: 'Surabaya' 
  });

  const [masterInput, setMasterInput] = useState({ kategori: 'Menu', value: '', label: '' });

  const LIST_LOKASI = [
      'Surabaya', 'Jakarta', 'Semarang', 'Cilegon', 'Citeureup', 
      'Makassar', 'Balikpapan', 'Medan', 'All'
  ];

  const handleLocationChange = (loc) => {
     let currentLocs = userData.lokasi ? userData.lokasi.split(',').map(l=>l.trim()).filter(l=>l!=='') : [];
     if (currentLocs.includes(loc)) {
         currentLocs = currentLocs.filter(l => l !== loc);
     } else {
         if(loc === 'All') {
             currentLocs = ['All']; 
         } else {
            currentLocs = currentLocs.filter(l => l !== 'All');
            currentLocs.push(loc);
         }
     }
     setUserData({ ...userData, lokasi: currentLocs.join(', ') });
  };

  const handleCheckboxChange = (val) => { 
    setUserData(prev => { 
      const current = prev.akses; 
      return current.includes(val) ? { ...prev, akses: current.filter(i => i !== val) } : { ...prev, akses: [...current, val] }; 
    });
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
            action: 'tambah_user', 
            roleRequester: user.role, 
            ...userData 
        }) 
      }).then(r => r.json());
      if(res.result === 'success') {
        alert('User Berhasil Ditambahkan!');
        setUserData({
          username: '', password: '', nama: '', email: '', 
          divisi: 'Staff', role: 'karyawan', akses: [], 
          noPayroll: '', sisaCuti: '', perusahaan: '', 
          statusKaryawan: '', emailAtasan: '', lokasi: 'Surabaya'
        });
      } else {
        alert(res.message);
      }
    } catch(e) { alert('Error koneksi server'); } finally { setLoading(false); }
  };

  const handleAddMaster = async (e) => { 
    e.preventDefault(); 
    setLoading(true);
    try { 
      const res = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
            action: 'tambah_master', 
            roleRequester: user.role,
            ...masterInput 
        }) 
      }).then(r=>r.json());
      if(res.result === 'success') { 
        alert('Data Ditambah!');
        setMasterInput({ kategori: 'Menu', value: '', label: '' }); 
      } else alert(res.message); 
    } catch(e) { alert('Error'); } finally { setLoading(false); } 
  };

  // --- HANDLER BARU: Untuk Mengirim Pengumuman HRD ---
  const handleAddAnnouncement = async () => {
    if (!newsInput.trim()) return alert("Isi informasi tidak boleh kosong!");
    setLoading(true);
    try {
      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ 
            action: 'tambah_announcement', // Sesuai dengan aksi di GAS 
            roleRequester: user.role,       // Untuk validasi HRD/Admin 
            isi: newsInput                 // Isi pesan pengumuman [cite: 1758]
        })
      }).then(r => r.json());
      
      if (res.result === 'success') {
        alert("Pengumuman berhasil diterbitkan!");
        setNewsInput(''); // Reset field input
      } else {
        alert(res.message);
      }
    } catch (e) {
      alert("Gagal koneksi ke server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold ml-2">Admin Panel</h2>
        <BackButton onClick={() => setView('dashboard')} />
      </div>

      {/* --- NAVIGASI TAB: Ditambahkan Tombol Update HRD --- */}
      <div className="flex gap-2 mb-6 bg-gray-200 p-1 rounded-lg">
        <button onClick={() => setActiveTab('user')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'user' ? 'bg-white shadow' : 'text-gray-500'}`}>Tambah User</button>
        {user.role === 'admin' && (
            <button onClick={() => setActiveTab('master')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'master' ? 'bg-white shadow' : 'text-gray-500'}`}>Tambah Master Data</button>
        )}
        {/* Tombol Tab Update HRD */}
        <button onClick={() => setActiveTab('news')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'news' ? 'bg-white shadow' : 'text-gray-500'}`}>Update HRD</button>
      </div>

      {/* --- KONTEN TAB: TAMBAH USER (Tetap) --- */}
      {activeTab === 'user' && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
               <input required type="text" className="w-full p-2 border rounded" value={userData.nama} onChange={e => setUserData({...userData, nama: e.target.value})} placeholder="Nama Karyawan" />
              <input required type="email" className="w-full p-2 border rounded" value={userData.email} onChange={e => setUserData({...userData, email: e.target.value})} placeholder="Email" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input required type="text" className="w-full p-2 border rounded" value={userData.username} onChange={e => setUserData({...userData, username: e.target.value})} placeholder="Username" />
              <input required type="text" className="w-full p-2 border rounded" value={userData.password} onChange={e => setUserData({...userData, password: e.target.value})} placeholder="Password" />
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <label className="text-xs font-bold text-gray-700 block mb-1">Email Kepala Divisi (Untuk Approval)</label>
              <input type="email" className="w-full p-2 border rounded bg-white text-sm" value={userData.emailAtasan} onChange={e => setUserData({...userData, emailAtasan: e.target.value})} placeholder="cth: manager@perusahaan.com" />
              <p className="text-[10px] text-gray-500 mt-1 italic">*Wajib diisi agar user ini bisa mengajukan approval via email.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" className="w-full p-2 border rounded" value={userData.perusahaan} onChange={e => setUserData({...userData, perusahaan: e.target.value})} placeholder="Perusahaan (PT)" />
              <input type="text" className="w-full p-2 border rounded" value={userData.statusKaryawan} onChange={e => setUserData({...userData, statusKaryawan: e.target.value})} placeholder="Status (Tetap/PKWT)" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" className="w-full p-2 border rounded" value={userData.noPayroll} onChange={e => setUserData({...userData, noPayroll: e.target.value})} placeholder="No Payroll" />
              <input type="number" className="w-full p-2 border rounded" value={userData.sisaCuti} onChange={e => setUserData({...userData, sisaCuti: e.target.value})} placeholder="Sisa Cuti Awal" />
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Divisi</label>
                <select className="w-full p-2 border rounded" value={userData.divisi} onChange={e => setUserData({...userData, divisi: e.target.value})}>
                  {masterData.divisions.map((d, i) => <option key={i} value={d.value}>{d.label}</option>)}
                  {masterData.divisions.length === 0 && <option>Staff</option>}
                </select>
              </div>
              <div className="bg-gray-50 p-3 rounded border border-gray-200">
                <label className="text-xs font-bold text-gray-700 block mb-2">Akses Lokasi (Bisa Pilih Lebih dari 1)</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {LIST_LOKASI.map((loc) => {
                    const isChecked = userData.lokasi && userData.lokasi.split(',').map(l=>l.trim()).includes(loc);
                    return (
                        <label key={loc} className="flex items-center gap-2 text-xs cursor-pointer bg-white p-2 rounded border hover:bg-blue-50 transition-colors">
                            <input 
                                type="checkbox" 
                                checked={!!isChecked} 
                                onChange={() => handleLocationChange(loc)}
                                className="w-4 h-4 text-blue-600 rounded" 
                            />
                            {loc}
                        </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 mt-2 bg-white px-2 py-1 border border-dashed rounded">
                    Data tersimpan: <strong>{userData.lokasi || '-'}</strong>
                </p>
              </div>
            </div>
             <div className="grid grid-cols-1 gap-2 mt-2">
                 <div>
                    <label className="text-xs text-gray-500">Role</label>
                    <select className="w-full p-2 border rounded" value={userData.role} onChange={e => setUserData({...userData, role: e.target.value})}>
                      {masterData.roles.map((r, i) => <option key={i} value={r.value}>{r.label}</option>)}
                    </select>
                 </div>
            </div>
            <div className="border p-3 rounded-lg bg-gray-50">
              <label className="text-xs font-bold text-gray-700 block mb-2">Hak Akses Menu:</label>
              <div className="grid grid-cols-2 gap-2">
                {masterData.menus.map(item => (
                  <label key={item.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={userData.akses.includes(item.value)} onChange={() => handleCheckboxChange(item.value)} className="w-4 h-4 text-blue-600 rounded" />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" disabled={loading} className="w-full bg-slate-800 text-white py-3 rounded-lg font-bold hover:bg-slate-700 transition">
              {loading ? 'Menyimpan...' : 'Simpan User Baru'}
            </button>
          </form>
        </div>
      )}

      {/* --- KONTEN TAB: MASTER DATA (Tetap) --- */}
      {activeTab === 'master' && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <form onSubmit={handleAddMaster} className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Kategori</label>
              <select className="w-full p-2 border rounded" value={masterInput.kategori} onChange={e => setMasterInput({...masterInput, kategori: e.target.value})}>
                <option value="Menu">Menu Absensi Baru</option>
                <option value="Role">Role User Baru</option>
                <option value="Divisi">Divisi Baru</option>
                <option value="Shift">Jam Kerja Shift</option>
              </select>
            </div>
            <input required type="text" className="w-full p-2 border rounded" value={masterInput.value} onChange={e => setMasterInput({...masterInput, value: e.target.value})} placeholder="Value (Contoh: 07:00-15:00)" />
            <input required type="text" className="w-full p-2 border rounded" value={masterInput.label} onChange={e => setMasterInput({...masterInput, label: e.target.value})} placeholder="Label (Contoh: Shift 1 Pagi)" />
            <button type="submit" disabled={loading} className="w-full bg-purple-700 text-white py-3 rounded-lg font-bold hover:bg-purple-800">
              {loading ? 'Simpan...' : 'Tambah Master Data'}
            </button>
          </form>
        </div>
      )}

      {/* --- KONTEN TAB BARU: UPDATE HRD --- */}
      {activeTab === 'news' && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <label className="text-xs font-bold text-gray-700 block mb-2">Isi Informasi Pengumuman HRD:</label>
          <textarea 
            className="w-full border p-3 rounded-xl text-sm mb-4 focus:ring-2 focus:ring-blue-500 outline-none" 
            rows="5" 
            placeholder="Ketik informasi penting untuk semua karyawan di sini..."
            value={newsInput}
            onChange={(e) => setNewsInput(e.target.value)}
          ></textarea>
          <button 
            onClick={handleAddAnnouncement}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold shadow-lg shadow-blue-200 active:scale-95 transition-all"
          >
            {loading ? 'Mengirim...' : 'Terbitkan Informasi Sekarang'}
          </button>
          <p className="text-[10px] text-gray-400 mt-3 italic text-center">
            Informasi yang diterbitkan akan muncul sebagai jendela melayang di Dashboard setiap user saat login.
          </p>
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
      const response = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ action: 'login', username, password }) 
      });
      const data = await response.json(); 
      if (data.result === 'success' && data.user) {
        onLogin(data.user, data.masterData || []);
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
      const res = await fetch(SCRIPT_URL, { 
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

// --- 9. DB ABSEN SCREEN (4 DAYS LIMIT) ---
function DbAbsenScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ijinCount, setIjinCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null); 

  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showFilter, setShowFilter] = useState(false);

  const KETERANGAN_MAP = {
      'H': 'Hadir', 'T': 'Terlambat', 'O': 'Off / Libur', 'CB': 'Cuti Bersama',
      'PC': 'Pulang Cepat', 'Si': 'Tdk Absen IN', 'So': 'Tdk Absen OUT',
      'I': 'Ijin', 'S': 'Sakit', 'C': 'Cuti', 'A': 'Alpa',
      'DL': 'Dinas Luar', 'TPC': 'Telat & Pulang Cepat', 'TSo': 'Telat & Tdk Absen OUT',
      'TSi': 'Telat & No Scan In', 'SiSo': 'Tdk Absen IN & OUT',
      'SiPC': 'Tdk Absen IN & Pulang Cepat', 'AC': 'Alpa (Lebih Cuti)',
      'EO': 'Extra Ordinary', 'NF': 'Tidak Absen'
  };

  // Dynamic Filter Options
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
    const fetchStats = async () => {
        try {
            const res = await fetch(SCRIPT_URL, { 
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
        const res = await fetch(SCRIPT_URL, { 
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

  const filteredList = list.filter(item => {
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
    let matchStatus = true;
    if (filterStatus !== 'All') { matchStatus = item.symbol === filterStatus; }
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

  return (
    <div className="p-4 h-full overflow-y-auto pb-24 bg-gray-50">
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
            <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">Status Kehadiran</label>
                <select className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="All">Semua Status</option>
                    {availableStatusOptions.map((sym) => (
                        <option key={sym} value={sym}>
                            {KETERANGAN_MAP[sym] || sym} ({sym})
                        </option>
                    ))}
                    {availableStatusOptions.length === 0 && (
                        <option disabled>Tidak ada status tersedia</option>
                    )}
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
                
                const isLateStatus = item.symbol && (item.symbol.toUpperCase().includes('T') || item.symbol.toUpperCase().includes('SI') || item.symbol.toUpperCase().includes('SO'));
                
                // --- LOGIKA BATAS 4 HARI ---
                let showButton = false;
                if (isLateStatus) {
                    const itemDate = parseDate(item.tanggal);
                    if (itemDate) {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        itemDate.setHours(0, 0, 0, 0);
                        
                        const diffTime = today - itemDate;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        
                        // Perubahan di sini: diffDays <= 4
                        if (diffDays >= 0 && diffDays <= 4) {
                            showButton = true;
                        }
                    }
                }
                // ---------------------------

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
                        
                        {/* HANYA TAMPIL JIKA TERLAMBAT & DALAM 4 HARI */}
                        {showButton && (
                            <div className="px-3 pb-3 pt-1">
                                <button 
                                    disabled={isIjinDisabled}
                                    onClick={() => {
                                        localStorage.setItem('absenType', 'Ijin');
                                        setView('form');
                                    }}
                                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all border
                                        ${isIjinDisabled ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-orange-600 border-orange-200 hover:bg-orange-50 shadow-sm' }`}
                                >
                                    <FileText className="w-3.5 h-3.5" />
                                    {isIjinDisabled ? 'Form IJIN Sudah Terpakai 4X' : 'Ajukan Form'}
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

// Pastikan helper formatTimeOnly tersedia
function formatTimeOnly(val) {
    if (!val || val === '-' || val === 'FALSE') return '-';
    // Jika formatnya string ISO Tanggal (contoh: 1899-12-29T17:25:48.000Z)
    if (typeof val === 'string' && val.includes('T')) {
        try {
            const date = new Date(val);
            if (isNaN(date.getTime())) return val;
            return date.toLocaleTimeString('id-ID', {
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false
            }).replace(/\./g, ':');
        } catch (e) { 
            return val;
        }
    }
    
    // Jika formatnya sudah jam (contoh: 08:30:00) potong detiknya
    if (typeof val === 'string' && val.includes(':')) {
        return val.substring(0, 5);
    }
    return val;
}