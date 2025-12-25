import React, { useState, useRef, useEffect, useCallback } from 'react';
// Import Icons
// PERBAIKAN: Menghapus 'Printer' dari import karena tidak digunakan
import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, FileText, AlertTriangle, X, 
  File as FileIcon, Filter, CheckSquare, Users, Eye, 
  ScanFace, Fingerprint, Smartphone, ChevronLeft, ChevronDown, ChevronUp, Search, 
  MessageSquare, Upload, Check, MessageCircle, Info, CalendarCheck,
  Venus
} from 'lucide-react';

import { SCRIPT_URL } from './config/constants';
import { TIMEOUT_DURATION } from './config/constants';
import BackButton from './components/BackButton';


const ICON_MAP = {
  'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': FileText, 'Sakit': AlertTriangle, 'Lembur': Clock, 'Dinas': Briefcase, 'Cuti': Calendar
};

const COLOR_MAP = {
  'Hadir': 'bg-green-500', 'Pulang': 'bg-red-500', 'Ijin': 'bg-yellow-500', 'Sakit': 'bg-orange-500', 'Lembur': 'bg-purple-500', 'Dinas': 'bg-indigo-500', 'Cuti': 'bg-pink-500'
};


// --- MAIN APP COMPONENT ---
export default function AppAbsensi() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); 
  const [masterData, setMasterData] = useState({ menus: [], roles: [], divisions: [], shifts: [] });
  const [editItem, setEditItem] = useState(null);

  const logoutTimerRef = useRef(null);

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
        {view !== 'login' && (
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center shadow-md z-10 relative">
            <div className="flex items-center gap-2">
                <Activity className="w-6 h-6" />
                <h1 className="font-bold text-lg">Absensi Online</h1>
            </div>
            {user && (
                <div className="flex items-center gap-3">
                <button onClick={() => setView('ganti_password')} className="text-white hover:text-blue-200" title="Ganti Password">
                   <Key className="w-5 h-5" />
                </button>
                <button 
                    onClick={handleLogout} 
                    className="bg-red-500/80 p-1.5 rounded-full hover:bg-red-600 transition shadow-sm"
                    title="Keluar Aplikasi"
                >
                    <X className="w-5 h-5 text-white" />
                </button>
                </div>
            )}
            </div>
        )}

        <div className="p-0">
          {view === 'login' && <LoginScreen onLogin={handleLogin} />}
          {view === 'dashboard' && <Dashboard user={user} setUser={setUser} setView={setView} masterData={masterData} />}
          {view === 'form' && <AttendanceForm user={user} setUser={setUser} setView={setView} editItem={editItem} setEditItem={setEditItem} masterData={masterData} />}
          {view === 'history' && <HistoryScreen user={user} setView={setView} setEditItem={setEditItem} masterData={masterData} />}
          {view === 'db_absen' && <DbAbsenScreen user={user} setView={setView} />}
          {view === 'admin' && <AdminPanel user={user} setView={setView} masterData={masterData} />}
          {view === 'approval' && <ApprovalScreen user={user} setView={setView} />}
          {view === 'ganti_password' && <ChangePasswordScreen user={user} setView={setView} />}
          {view === 'remark' && <RemarkScreen user={user} setView={setView} />}

          {/* MENU BARU: Input Shift (Updated) */}
          {view === 'input_shift' && <ShiftScheduleScreen user={user} setView={setView} masterData={masterData} />}
        
        
        </div>
      </div>
    </div>
  );
}

// --- 1. DASHBOARD SCREEN ---
function Dashboard({ user, setUser, setView, masterData }) { 
  const [time, setTime] = useState(new Date());
  const [stats, setStats] = useState({}); 
  const [showNews, setShowNews] = useState(false);
  const [newsContent, setNewsContent] = useState(null);
  
  useEffect(() => { 
    const timer = setInterval(() => setTime(new Date()), 1000); 
    return () => clearInterval(timer); 
  }, []);

  useEffect(() => { 
    const fetchStats = async () => { 
      try { 
        const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_stats', userId: user.id }) }); 
        const data = await res.json(); 
        if (data.result === 'success') { 
          const normalizedStats = {}; 
          Object.keys(data.stats).forEach(key => { normalizedStats[key.toLowerCase()] = data.stats[key]; }); 
          setStats({ ...data.stats, ...normalizedStats }); 
        } 
      } catch (e) { console.error("Gagal load stats"); } 
    }; 
    if (user) fetchStats(); 
  }, [user]);

  useEffect(() => {
    const fetchNews = async () => {
      // CEK APAKAH SUDAH PERNAH DITAMPILKAN DALAM SESI INI
      const hasBeenShown = sessionStorage.getItem('announcement_shown');
      if (hasBeenShown) return; // Jika sudah pernah, jangan fetch/tampilkan lagi

      try {
        const res = await fetch(SCRIPT_URL, { 
          method: 'POST', 
          body: JSON.stringify({ action: 'get_latest_announcement' }) 
        });
        const data = await res.json();
        if (data.result === 'success' && data.data) {
          setNewsContent(data.data);
          setShowNews(true); 
        }
      } catch (e) { console.error("Gagal load pengumuman"); }
    };
    fetchNews();
  }, []);

  // Validasi user harus di atas return utama
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
  let greetingIcon = '☀️';

  if (hour >= 11 && hour < 15) { greeting = 'Selamat Siang'; greetingIcon = '🌤️'; }
  else if (hour >= 15 && hour < 18) { greeting = 'Selamat Sore'; greetingIcon = '🌥️'; }
  else if (hour >= 18) { greeting = 'Selamat Malam'; greetingIcon = '🌙'; }

  const formatDigit = (num) => num.toString().padStart(2, '0');
  
  return ( 
    <div className="p-4 pb-20"> 
      {/* --- KARTU DASHBOARD UTAMA --- */}
      <div className="relative rounded-3xl p-6 shadow-xl mb-6 overflow-hidden text-white group">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 bg-[length:400%_400%] animate-[gradient_6s_ease_infinite]"></div>
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-700"></div>

        <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <p className="text-blue-100 text-sm font-medium mb-1 flex items-center gap-2">
                       {greetingIcon} {greeting}
                    </p>
                    <h2 className="text-2xl font-bold tracking-tight">{user.nama}</h2>
                    <p className="text-xs text-blue-200 bg-blue-800/30 px-2 py-0.5 rounded-full w-fit mt-1 border border-blue-400/30">
                        {user.divisi} • {user.lokasi || 'Indonesia'}
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-4xl font-black font-mono tracking-widest flex items-center justify-end">
                        <span>{formatDigit(time.getHours())}</span>
                        <span className="animate-[pulse_1s_infinite] mx-1 text-blue-300">:</span>
                        <span>{formatDigit(time.getMinutes())}</span>
                    </div>
                    <p className="text-xs font-medium text-blue-100 mt-1 uppercase tracking-wider">
                        {time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                </div>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/20 shadow-inner">
                 <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1"><Building className="w-3 h-3"/> Perusahaan</span>
                        <span className="text-sm font-semibold truncate" title={user.perusahaan}>{user.perusahaan || '-'}</span>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1"><CreditCard className="w-3 h-3"/> Payroll</span>
                        <span className="text-sm font-semibold font-mono tracking-wide">{user.noPayroll || '-'}</span>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1"><Briefcase className="w-3 h-3"/> Status</span>
                        <span className="text-sm font-semibold">{user.statusKaryawan || '-'}</span>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1"><PieChart className="w-3 h-3"/> Sisa Cuti</span>
                        <span className="text-lg font-bold text-yellow-300">{user.sisaCuti} Hari</span>
                     </div>
                 </div>
            </div>
        </div>
      </div> 
      
      {/* MENU SHORTCUT */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide"> 
        <button onClick={() => setView('history')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-blue-600 font-bold hover:bg-blue-50 transition active:scale-95"><History className="w-5 h-5" /><span className="text-xs">Riwayat</span></button> 
        <button onClick={() => setView('db_absen')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-indigo-600 font-bold hover:bg-indigo-50 transition active:scale-95">
            <Fingerprint className="w-5 h-5" /> 
            <span className="text-xs">Data Mesin</span>
         </button>
        <button 
            onClick={() => setView('remark')} 
            className={`flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 font-bold transition active:scale-95 ${isHRDOrAdmin ? 'text-purple-600 hover:bg-purple-50' : 'text-orange-600 hover:bg-orange-50'}`}
        >
            <MessageSquare className="w-5 h-5" />
            <span className="text-xs">{isHRDOrAdmin ? 'Respon Laporan' : 'Lapor HRD'}</span>
        </button>

        {canApprove && (
            <button onClick={() => setView('approval')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-green-600 font-bold hover:bg-green-50 transition active:scale-95">
                <Users className="w-5 h-5" />
                <span className="text-xs">Approval</span>
            </button>
        )}

        {canAccessPanel && ( 
            <button onClick={() => setView('admin')} className="flex-1 min-w-[100px] bg-slate-800 text-white p-3 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 font-bold hover:bg-slate-700 transition active:scale-95">
                <Settings className="w-5 h-5" /><span className="text-xs">Panel</span>
            </button> 
        )} 
      </div> 

      {/* MENU KHUSUS KARYAWAN SHIFT --- */}
      {isShiftWorker && (
         <div className="mb-6">
            <h3 className="font-bold text-gray-700 mb-2 px-1 flex items-center gap-2">
                 <div className="w-1 h-5 bg-indigo-600 rounded-full"></div>
                 Menu Running Shift
            </h3>
            <button 
                onClick={() => setView('input_shift')}
                className="w-full bg-indigo-50 border border-indigo-200 p-4 rounded-xl flex items-center justify-between group active:scale-95 transition-all shadow-sm hover:shadow-md hover:bg-indigo-100"
            >
                <div className="flex items-center gap-3">
                     <div className="bg-indigo-600 text-white p-2.5 rounded-lg shadow-sm group-hover:rotate-12 transition-transform">
                        <CalendarCheck className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                        <h4 className="font-bold text-indigo-900">Input Jadwal Shift</h4>
                        <p className="text-xs text-indigo-600">Atur tanggal & jam kerja Shift Anda</p>
                    </div>
                </div>
                <div className="bg-white p-1.5 rounded-full text-indigo-400">
                    <ChevronDown className="-rotate-90 w-4 h-4" />
                </div>
            </button>
         </div>
      )}

      <h3 className="font-bold text-gray-700 mb-3 px-1 flex items-center gap-2">
          <div className="w-1 h-5 bg-blue-600 rounded-full"></div>
          Menu Absensi
      </h3> 

      {/* <div className="grid grid-cols-2 gap-4"> 
        {allowedMenus.map((item) => { 
            const Icon = ICON_MAP[item.value] || Star; 
            const colorClass = COLOR_MAP[item.value] || 'bg-blue-400'; 
            const count = stats[item.value] || stats[item.value.toLowerCase()] || 0; 
            const isAttendance = ['Hadir', 'Pulang'].includes(item.value);
            const isCutiEmpty = item.value === 'Cuti' && (parseInt(user.sisaCuti) || 0) < 1;

            return ( 
                <button 
                    key={item.value} 
                    onClick={() => { 
                        if(isCutiEmpty) { alert('Sisa Cuti Anda Habis (0). Tidak dapat mengajukan cuti.'); return; }
                        localStorage.setItem('absenType', item.value); 
                        setView('form'); 
                    }} 
                    className={`bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 text-left group relative overflow-hidden transform hover:-translate-y-1 ${isCutiEmpty ? 'opacity-50 grayscale' : ''}`}
                > 
                    <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full opacity-10 group-hover:scale-150 transition duration-500 ${colorClass}`}></div>
                    {!isAttendance && count > 0 && (<div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-bl-xl shadow-sm z-10 animate-bounce">{count}</div>)} 
 
                    <div className={`${colorClass} w-10 h-10 rounded-xl flex items-center justify-center text-white mb-3 shadow-md group-hover:scale-110 group-hover:rotate-3 transition`}>
                        <Icon className="w-5 h-5" />
                    </div> 
                    
                    <h4 className="font-bold text-gray-800 group-hover:text-blue-600 transition">{item.label}</h4> 
                    <p className="text-[10px] text-gray-400 mt-1">
                        {isAttendance ? `Tap untuk ${item.label}` : (isCutiEmpty ? 'Kuota Habis' : 'Pengajuan Form')}
                    </p> 
                </button> 
            ) 
        })} 
      </div>  */}

      <div className="grid grid-cols-2 gap-4"> 
        {allowedMenus.map((item) => { 
            const Icon = ICON_MAP[item.value] || Star; 
            const colorClass = COLOR_MAP[item.value] || 'bg-blue-400'; 
            const count = stats[item.value] || stats[item.value.toLowerCase()] || 0; 
            const isAttendance = ['Hadir', 'Pulang'].includes(item.value);
            
            // --- LOGIKA DISABLE CUTI (LAMA) ---
            const isCutiEmpty = item.value === 'Cuti' && (parseInt(user.sisaCuti) || 0) < 1;

            // --- LOGIKA BARU: DISABLE IJIN JIKA SUDAH >= 4 HARI ---
            // stats.ijin_usage kita dapat dari backend handleGetStats yang baru
            const isIjinFull = item.value === 'Ijin' && (stats.ijin_usage || 0) >= 4;
            
            // Gabungkan kondisi disable
            const isDisabled = isCutiEmpty || isIjinFull;

            return ( 
                <button 
                    key={item.value} 
                    disabled={isDisabled} // Matikan tombol
                    onClick={() => { 
                        if(isCutiEmpty) { alert('Sisa Cuti Anda Habis (0). Tidak dapat mengajukan cuti.'); return; }
                        if(isIjinFull) { alert('Kuota Ijin bulan ini habis (Maks 4 Hari).'); return; }

                        localStorage.setItem('absenType', item.value); 
                        setView('form'); 
                    }} 
                    className={`bg-white p-4 rounded-xl shadow-sm border border-gray-100 transition-all duration-300 
                    text-left group relative overflow-hidden transform 
                    ${isDisabled ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:-translate-y-1 hover:shadow-lg'}`} 
                > 
                    <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full opacity-10 group-hover:scale-150 transition duration-500 ${colorClass}`}></div>
                    
                    {!isAttendance && count > 0 && !isDisabled && (
                        <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-bl-xl shadow-sm z-10 animate-bounce">{count}</div>
                    )} 
 
                    <div className={`${colorClass} w-10 h-10 rounded-xl flex items-center justify-center text-white mb-3 shadow-md group-hover:scale-110 group-hover:rotate-3 transition`}>
                        <Icon className="w-5 h-5" />
                    </div> 
                    
                    <h4 className="font-bold text-gray-800 group-hover:text-blue-600 transition">{item.label}</h4> 
                    <p className="text-[10px] text-gray-400 mt-1">
                        {isAttendance 
                            ? `Tap untuk ${item.label}` 
                            : (isCutiEmpty ? 'Kuota Habis' : (isIjinFull ? 'Limit Tercapai (4/4)' : 'Pengajuan Form'))
                        }
                    </p> 
                </button> 
            ) 
        })} 
      </div>

      {/* --- PINDAHKAN MODAL KE SINI (DI DALAM RETURN) --- */}
      {showNews && newsContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden transform animate-in zoom-in-95 duration-300">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white relative">
              <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
              <div className="flex items-center gap-3 mb-1">
                <div className="bg-white/20 p-2 rounded-lg">
                  <MessageSquare className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-lg tracking-tight">INFORMASI</h3>
              </div>
              <p className="text-blue-100 text-[10px] uppercase tracking-widest font-medium">
                {newsContent.waktu}
              </p>
            </div>
            
            <div className="p-6">
              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 mb-6">
                <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                  "{newsContent.isi}"
                </p>
              </div>
              
              <button 
                onClick={() => {
                  setShowNews(false);
                  // TANDAI BAHWA PENGUMUMAN SUDAH DILIHAT DALAM SESI INI
                  sessionStorage.setItem('announcement_shown', 'true');
                }}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold shadow-lg"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes gradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      `}</style>
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
            <div className="flex items-center gap-2 mb-6">
                <BackButton onClick={() => setView('dashboard')} />
                <h2 className="text-xl font-bold ml-2">Jadwal Shift</h2>
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

// --- 2. REMARK SCREEN (LAPORAN & RESPON HRD) ---
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



    // --- LOGIC FILTERING MULTI-LOKASI ---
    const filteredRemarks = remarks.filter(item => {
        // 1. Jika User Biasa (Bukan HRD/Admin), tampilkan semua (karena backend sdh filter data dia sendiri)
        if (!isHRDOrAdmin) return true;

        // 2. Filter Berdasarkan Lokasi Admin (MULTI LOKASI SUPPORT)
        // Jika user.lokasi ada isinya
        if (user.lokasi) {
            // Pecah string lokasi user menjadi array. Contoh: "Jakarta, Surabaya" -> ['Jakarta', 'Surabaya']
            // .map(l => l.trim()) berguna untuk membuang spasi di depan/belakang koma
            const allowedLocations = user.lokasi.split(',').map(l => l.trim());

            // Jika User punya akses 'All', lewati filter ini (bisa lihat semua)
            if (allowedLocations.includes('All')) {
                // Lanjut ke filter status...
            } 
            // Cek apakah lokasi pelapor ada di dalam daftar akses user
            else {
                const laporanLokasi = item.lokasi || ''; // Antisipasi jika lokasi pelapor kosong
                if (!allowedLocations.includes(laporanLokasi)) {
                    return false; // Sembunyikan jika tidak cocok
                }
            }
        }

        // 3. Filter Status (Existing)
        if (statusFilter === 'All') return true;
        return item.status === statusFilter;
    });

    return (
        <div className="p-4 h-full overflow-y-auto pb-20">
            <div className="flex items-center gap-2 mb-6">
                <BackButton onClick={() => setView('dashboard')} />
                <h2 className="text-xl font-bold ml-2">{isHRDOrAdmin ? 'Respon Laporan Masuk' : 'Lapor & Riwayat'}</h2>
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
                                <option>Koreksi Absensi (Lupa Absen Masuk/Pulang)</option>
                                <option>Koreksi Cuti / Sisa Cuti</option>
                                <option>Koreksi Shift Kerja</option>
                                <option>Koreksi Jam Kerja</option>
                                <option>Masukan dan Keluhan</option>
                                <option>Pertanyaan</option>
                                <option>Lainnya</option>
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

            {isHRDOrAdmin && (
                <div className="flex justify-end mb-4">
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200">
                        <Filter className="w-4 h-4 text-gray-500" />
                        <select 
                            value={statusFilter} 
                            onChange={(e) => setStatusFilter(e.target.value)} 
                            className="text-sm bg-transparent border-none outline-none font-medium text-gray-700 cursor-pointer"
                        >
                            <option value="All">Semua Status</option>
                            <option value="Open">Open (Belum Diproses)</option>
                            <option value="Done">Done (Selesai)</option>
                        </select>
                    </div>
                </div>
            )}

            <div>
                <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <History className="w-4 h-4"/> {isHRDOrAdmin ? `Daftar Laporan (${statusFilter})` : 'Status Laporan Anda'}
                </h3>
                
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
                                <div className="bg-blue-50 p-2 rounded text-xs text-blue-800 border border-blue-200 mt-2">
                                    <div className="flex items-center gap-1 font-bold mb-1">
                                        <Info className="w-3 h-3"/> Tanggapan HRD:
                                    </div>
                                    <p className="italic">"{item.respon}"</p>
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
        alert(type === 'Sakit' ? 'Mohon ambil foto Surat Dokter menggunakan kamera.' : 'Foto Wajib untuk form absen ini.'); 
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
      <div className="flex items-center gap-2 mb-4">
        <BackButton onClick={handleBack} />
        <h2 className="text-xl font-bold ml-2">{isEditMode ? 'Edit Data' : `Form ${type}`}</h2>
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

        <textarea className="w-full border p-3 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Catatan tambahan..." rows="2" value={catatan} onChange={e => setCatatan(e.target.value)}></textarea>
      </div>
      
      <button onClick={handleSubmit} disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold mt-6 mb-10 shadow-lg active:scale-95 transition-all">
          {isSubmitting ? 'Mengirim Data...' : (isEditMode ? 'Update Data' : 'Kirim Sekarang')}
      </button>
    </div>
  );
}

// --- 4. APPROVAL SCREEN ---
function ApprovalScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  // FIX WARNING: Wrap in useCallback
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

const handleDecision = async (uuid, decision, namaUser) => {
    const isReject = decision === 'reject';
    const actionText = isReject ? 'Menolak' : 'Menyetujui';
    
    // 1. Munculkan Prompt Alasan
    const pesanPrompt = isReject 
        ? `Alasan PENOLAKAN untuk ${namaUser} (Wajib diisi):` 
        : `Catatan PERSETUJUAN untuk ${namaUser} (Opsional):`;
        
    const alasanInput = window.prompt(pesanPrompt, "");

    // 2. Validasi
    if (alasanInput === null) return; // Klik Batal di prompt
    if (isReject && alasanInput.trim() === "") {
        alert("Gagal! Anda wajib memberikan alasan jika menolak pengajuan.");
        return;
    }

    if (!window.confirm(`Yakin ingin ${actionText} pengajuan ini?`)) return;

    try {
        const res = await fetch(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'process_approval', 
                uuid, 
                decision, 
                approverName: user.nama,
                alasan: alasanInput.trim() // Kirim alasan ke backend
            }) 
        }).then(r => r.json());

        if (res.result === 'success') { 
            alert(res.message);
            fetchApprovalList(); 
        } else {
            alert(res.message);
        }
    } catch (e) {
        alert('Terjadi kesalahan koneksi');
    }
};

  const formatDateIndo = (dateString) => { 
  if (!dateString || dateString === '-') return '-';
  try { 
    const date = new Date(dateString); 
    // Menggunakan Intl.DateTimeFormat untuk format DD-MM-YYYY
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}-${month}-${year}`;
  } catch (e) { 
    return dateString; 
  } 
};
  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center gap-2 mb-4">
        <BackButton onClick={() => setView('dashboard')} />
        <h2 className="text-xl font-bold ml-2">Daftar Approval ({user.lokasi || 'All'})</h2>
      </div>

      <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg mb-4 text-xs text-blue-800">
        <p className="font-bold">Info:</p>
        <p>Halaman ini menampilkan pengajuan dari karyawan di <strong>{user.lokasi}</strong> yang berstatus <strong>Pending</strong>.</p>
      </div>

      {loading ? <p className="text-center text-gray-500 mt-10">Memuat data pengajuan...</p> : (
        <div className="space-y-4">
          {list.length === 0 && (
              <div className="text-center py-10 flex flex-col items-center">
                  <CheckCircle className="w-12 h-12 text-gray-300 mb-2" />
                   <p className="text-gray-400">Tidak ada pengajuan pending saat ini.</p>
              </div>
          )}
          
          {list.map((item, idx) => (
            <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-l-4 border-l-orange-400 relative overflow-hidden">
              <div className="flex justify-between items-start mb-2">
                  <div>
                      <h4 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-500"/> {item.nama}
                      </h4>
                      <div className="flex gap-1 mt-1">
                        <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 font-bold border border-gray-200">
                            {item.divisi}
                        </span>
                        <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded font-bold border border-blue-200">
                            {item.lokasi}
                        </span>
                      </div>
                  </div>
                  <div className="text-right">
                      <span className="text-xs font-bold px-2 py-1 bg-orange-100 text-orange-700 rounded border border-orange-200">
                            {item.tipe}
                      </span>
                  </div>
              </div>
              
              <div className="text-sm text-gray-600 mb-3 bg-gray-50 p-2 rounded border border-gray-100 mt-2">
                <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-3 h-3 text-gray-400"/> 
                    <span className="font-medium">{item.tglMulai && item.tglMulai !== '-' ? `${formatDateIndo(item.tglMulai)} - ${formatDateIndo(item.tglSelesai)}` : formatDateIndo(item.waktu)}</span>
                </div>
                <p className="italic text-gray-500">"{item.catatan || 'Tidak ada catatan'}"</p>
              </div>

              <div className="flex gap-2">
                  <button 
                    onClick={() => handleDecision(item.uuid, 'approve', item.nama)} 
                    className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-bold hover:bg-green-700 flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4"/> Approve
                  </button>
                  <button 
                    onClick={() => handleDecision(item.uuid, 'reject', item.nama)} 
                    className="flex-1 bg-red-100 text-red-600 py-2 rounded-lg text-sm font-bold hover:bg-red-200 flex items-center justify-center gap-2 border border-red-200"
                  >
                    <X className="w-4 h-4"/> Reject
                  </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- 5. HISTORY SCREEN ---
function HistoryScreen({ user, setView, setEditItem, masterData }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterType, setFilterType] = useState('All'); 
  const [showWebReport, setShowWebReport] = useState(false);
  const [reportStatusFilter, setReportStatusFilter] = useState('All');

  const userRole = user.role ? String(user.role).toLowerCase() : '';
  const canViewAll = ['admin', 'hrd'].includes(userRole);
  const isSuperAdmin = userRole === 'admin' && (user.lokasi === 'All' || !user.lokasi);
  const [allUsers, setAllUsers] = useState([]); 
  const [selectedUserIds, setSelectedUserIds] = useState([]); 
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [locationFilter, setLocationFilter] = useState('All');
  const [searchUser, setSearchUser] = useState(''); 

  const fetchUsers = async () => {
    try {
        const res = await fetch(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'get_user_list_simple',
                lokasi: user.lokasi || 'All', 
                filterLokasi: locationFilter 
            }) 
        });
        const data = await res.json();
        if(data.result === 'success') {
             setAllUsers(data.list);
             setSelectedUserIds([]); 
        }
    } catch(e) { console.error("Gagal load users"); }
  }

  const fetchHistory = async () => {
    setLoading(true);
    try { 
      const payload = { 
        action: 'get_history', 
        userId: user.id,
        canViewAll: canViewAll, 
        requestorLokasi: user.lokasi || 'All', 
        targetUserIds: canViewAll ? selectedUserIds : [] 
      };
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') setHistory(data.history);
    } catch (e) { alert('Gagal ambil data'); } finally { setLoading(false); }
  };

  useEffect(() => { 
      if(canViewAll) fetchUsers();
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationFilter]);

  useEffect(() => {
      fetchHistory(); 
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserIds]);

  const formatDateIndo = (dateString) => { if (!dateString || dateString === '-') return '-';
    try { const date = new Date(dateString); return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
    } catch (e) { return dateString; } };
  const formatDateShort = (dateString) => { if (!dateString || dateString === '-') return '-';
    try { return new Date(dateString).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}); } catch (e) { return dateString; } };
  const formatTimeOnly = (val) => { if (!val || val === '-') return '-';
    if (typeof val === 'string' && (val.includes('T') || val.length > 8)) { try { const dateObj = new Date(val);
    if (!isNaN(dateObj.getTime())) { return dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
    } } catch (e) { return val.substring(0, 5); } } return val.length >= 5 ? val.substring(0, 5) : val; };
  const formatDateTimeFull = (val) => {
    if (!val || val === '-') return '-';
    try {
        const d = new Date(val);
        if(isNaN(d.getTime())) return val;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${dd}-${mm}-${yy} ${hh}:${min}`;
    } catch(e) { return val; }
  };

  const handleRequestApproval = async (item) => {
    const detailTanggal = item.tglMulai && item.tglMulai !== '-' 
        ? `${formatDateIndo(item.tglMulai)} s/d ${formatDateIndo(item.tglSelesai)}`
        : formatDateIndo(item.waktu);
    const message = `Kirim email pengajuan approval untuk:\n\nForm: ${item.tipe}\nTanggal: ${detailTanggal}\n\nLanjutkan kirim ke Kepala Divisi?`;
    if (!window.confirm(message)) return;
    setSendingEmail(true);
    try {
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'request_approval_email', uuid: item.uuid }) });
      const data = await res.json(); alert(data.message);
    } catch (e) { alert("Gagal kirim email"); } 
    finally { setSendingEmail(false); }
  };
  const handleDelete = async (uuid) => { if (!window.confirm('Yakin hapus data ini?')) return;
    try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'delete_absen', uuid }) });
    const data = await res.json(); if (data.result === 'success') { alert('Terhapus'); fetchHistory(); } else { alert(data.message);
    } } catch (e) { alert('Gagal hapus'); } };
  const handleEdit = (item) => { setEditItem(item); localStorage.setItem('absenType', item.tipe); setView('form'); };
  
  const isEditable = (waktuStr, status) => {
    if (status === 'Approved' || status === 'Rejected') return false;
    if (!waktuStr || waktuStr === '-') return false;
    try {
        const entryTime = new Date(waktuStr).getTime();
        const now = new Date().getTime();
        const diffInHours = (now - entryTime) / (1000 * 60 * 60);
        return diffInHours <= 1;
    } catch (e) { return false; }
  };

  const getFilteredHistory = () => { 
    return history.filter(item => { 
      const itemDate = new Date(item.waktu).setHours(0, 0, 0, 0); 
      const start = filterStart ? new Date(filterStart).setHours(0, 0, 0, 0) : null; 
      const end = filterEnd ? new Date(filterEnd).setHours(23, 59, 59, 999) : null; 
      const matchDate = (!start && !end) || (start && end && itemDate >= start && itemDate <= end) || (start && itemDate >= start) || (end && itemDate <= end);
      const matchType = filterType === 'All' || item.tipe === filterType;
      return matchDate && matchType;
    });
  };
  
  const toggleUserSelection = (id) => {
     if(selectedUserIds.includes(id)) {
        setSelectedUserIds(selectedUserIds.filter(x => x !== id));
     } else {
        setSelectedUserIds([...selectedUserIds, id]);
     }
  };

  const selectAllUsers = () => {
     const visibleUsers = allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase()));
     const visibleIds = visibleUsers.map(u => u.id);
     const allVisibleSelected = visibleIds.every(id => selectedUserIds.includes(id));
     if(allVisibleSelected) {
         setSelectedUserIds(selectedUserIds.filter(id => !visibleIds.includes(id)));
     } else {
         const newSelection = [...new Set([...selectedUserIds, ...visibleIds])];
         setSelectedUserIds(newSelection);
     }
  };

  const displayData = getFilteredHistory().filter(item => {
      if (canViewAll) {
          if (item.tipe === 'Hadir' || item.tipe === 'Pulang') return false;
      }
      return true;
  });

  const reportData = [...getFilteredHistory()]
    .filter(item => reportStatusFilter === 'All' || item.status === reportStatusFilter)
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const getStatusColor = (status) => { 
      if (status === 'Approved' || status === 'Verified') return 'bg-green-100 text-green-700 border-green-200';
      if (status === 'Rejected') return 'bg-red-100 text-red-700 border-red-200'; 
      return 'bg-yellow-100 text-yellow-700 border-yellow-200'; 
  };
  const uniqueTypes = ['All', ...new Set(history.map(item => item.tipe))];

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      
      {showWebReport && (
        <div className="fixed inset-0 bg-white z-[60] overflow-auto flex flex-col font-sans">
            <div className="bg-slate-800 p-4 text-white flex justify-between items-center shadow-md sticky top-0 z-10">
                <h3 className="font-bold flex items-center gap-2"><FileIcon className="w-5 h-5"/> Laporan</h3>
                <div className="flex items-center gap-2">
                    <select 
                        value={reportStatusFilter}
                        onChange={(e) => setReportStatusFilter(e.target.value)}
                        className="text-xs text-black p-1 rounded border-none outline-none cursor-pointer"
                    >
                        <option value="All">Semua Status</option>
                        <option value="Pending">Pending</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Verified">Verified</option>
                    </select>
                    <button onClick={() => setShowWebReport(false)} className="bg-white/20 p-1.5 rounded-full hover:bg-white/30"><X className="w-5 h-5"/></button>
                </div>
            </div>
            
            <div className="p-6 flex-1">
                <div className="mb-6 border-b pb-4">
                    <h2 className="text-2xl font-bold text-slate-800 uppercase mb-2 tracking-tight">Laporan Data Absensi</h2>
                    <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm text-gray-600">
                        <div><span className="font-semibold text-gray-800">Dicetak Oleh:</span> {user.nama}</div>
                        <div><span className="font-semibold text-gray-800">Waktu Cetak:</span> {formatDateTimeFull(new Date())}</div>
                        <div><span className="font-semibold text-gray-800">Lokasi:</span> {user.lokasi || 'All'}</div>
                        <div><span className="font-semibold text-gray-800">Filter Lokasi:</span> {locationFilter}</div>
                    </div>
                </div>

                <div className="overflow-auto max-h-[70vh] rounded-lg border border-gray-200 shadow-sm relative">
                    <table className="w-full text-xs text-left divide-y divide-gray-200 whitespace-nowrap">
                        <thead className="bg-slate-100 text-slate-700 uppercase font-bold sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 text-center w-12 bg-slate-100">No.</th>
                                <th className="px-4 py-3 bg-slate-100">No Payroll</th>
                                <th className="px-4 py-3 bg-slate-100">Nama</th>
                                <th className="px-4 py-3 bg-slate-100">Form</th>
                                <th className="px-4 py-3 bg-slate-100">Waktu Input</th>
                                <th className="px-4 py-3 bg-slate-100">Periode / Jam</th>
                                <th className="px-4 py-3 bg-slate-100">Catatan</th>
                                <th className="px-4 py-3 text-center bg-slate-100">Status</th>
                                <th className="px-4 py-3 bg-slate-100">Approved Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {reportData.map((item, index) => (
                                <tr key={index} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3 text-center font-medium text-gray-500">{index + 1}</td>
                                    <td className="px-4 py-3 font-mono text-gray-600">{item.noPayroll || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-gray-800">{item.nama}</td>
                                    <td className="px-4 py-3">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                            {item.tipe}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">{formatDateTimeFull(item.waktu)}</td>
                                    <td className="px-4 py-3 text-gray-600">
                                        {item.tglMulai && item.tglMulai !== '-' 
                                            ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` 
                                            : (item.jamMulai && item.jamMulai !== '-' ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-')
                                        }
                                    </td>
                                    <td className="px-4 py-3 italic text-gray-500 max-w-[200px] truncate" title={item.catatan}>{item.catatan || '-'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-block px-2 py-1 text-[10px] font-bold rounded-full border ${getStatusColor(item.status)}`}>
                                            {item.status || 'Pending'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 text-[10px]">{formatDateTimeFull(item.approvalTime)}</td>
                                </tr>
                            ))}
                            {reportData.length === 0 && (
                                <tr><td colSpan="9" className="p-8 text-center text-gray-400 italic">Tidak ada data untuk ditampilkan.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4 text-center text-xs text-gray-400 print:hidden">
                    Gunakan fitur cetak bawaan browser (Ctrl + P) untuk menyimpan sebagai PDF.
                </div>
            </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <BackButton onClick={() => setView('dashboard')} />
        <h2 className="text-xl font-bold ml-2">Riwayat & Laporan</h2>
      </div>
      
      {canViewAll && (
         <div className="bg-slate-800 text-white p-3 rounded-xl shadow-sm mb-4">
             <button 
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                className="flex items-center justify-between w-full font-bold text-sm"
            >
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4"/> Filter Karyawan ({selectedUserIds.length > 0 ? selectedUserIds.length : 'Semua di ' + locationFilter})
                </div>
                {isFilterExpanded ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
            </button>
            
            {isFilterExpanded && (
                 <div className="mt-3 bg-slate-700 p-3 rounded-lg max-h-[400px] overflow-y-auto">
                    {isSuperAdmin && (
                        <div className="mb-3 bg-slate-600 p-2 rounded">
                            <label className="text-[10px] text-gray-300 block mb-1">Pilih Lokasi:</label>
                             <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="w-full p-2 text-sm text-black rounded">
                                <option value="All">Semua Lokasi</option>
                                <option value="Surabaya">Surabaya</option>
                                <option value="Jakarta">Jakarta</option>
                            </select>
                        </div>
                    )}
                    <div className="mb-3 relative">
                        <input type="text" placeholder="Cari Nama Karyawan..." value={searchUser} onChange={(e) => setSearchUser(e.target.value)} className="w-full p-2 pl-8 text-sm text-black rounded" />
                        <Search className="w-4 h-4 text-gray-500 absolute left-2.5 top-2.5"/>
                    </div>
                    <button onClick={selectAllUsers} className="text-xs font-bold text-blue-300 mb-2 hover:text-white">
                        {selectedUserIds.length > 0 ? 'Reset Pilihan' : 'Pilih Semua (Hasil Pencarian)'}
                    </button>
                    <div className="space-y-1">
                        {allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).length === 0 && <p className="text-xs text-gray-400">User tidak ditemukan.</p>}
                        {allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).map(u => (
                            <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-600 p-1 rounded">
                                <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={() => toggleUserSelection(u.id)} className="w-4 h-4" />
                                <span className="flex-1">{u.nama}</span>
                                {isSuperAdmin && <span className="text-[10px] bg-slate-500 px-1 rounded text-white">{u.lokasi}</span>}
                            </label>
                        ))}
                    </div>
                </div>
            )}
         </div>
      )}

      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-200 mb-4">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-500"><Filter className="w-4 h-4" /> Filter Data</div>
        <div className="grid grid-cols-2 gap-2 mb-2"> 
          <div><label className="text-[10px] text-gray-400">Dari Tanggal</label><input type="date" className="w-full border rounded p-1 text-sm" value={filterStart} onChange={e => setFilterStart(e.target.value)} /></div> 
          <div><label className="text-[10px] text-gray-400">Sampai Tanggal</label><input type="date" className="w-full border rounded p-1 text-sm" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></div> 
        </div>
        <div className="mb-3">
            <label className="text-[10px] text-gray-400">Form Absen</label>
            <select className="w-full border rounded p-1.5 text-sm bg-white" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                {uniqueTypes.map((t, i) => ( <option key={i} value={t}>{t === 'All' ? 'Semua Form' : t}</option> ))}
            </select>
        </div>
        <div className="flex gap-2"> 
          <button onClick={() => setShowWebReport(true)} className="flex-1 flex items-center justify-center gap-2 p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition text-sm font-bold"><Eye className="w-4 h-4" /> Lihat Laporan</button> 
        </div>
      </div>

      {loading ? <p className="text-center text-gray-500">Memuat...</p> : (
        <div className="space-y-3">
          {displayData.length === 0 && <p className="text-center text-gray-400 text-sm py-4">Tidak ada data sesuai filter.</p>}
          {displayData.map((item, idx) => {
            const canEdit = isEditable(item.waktu, item.status);
            const isRegularAbsen = item.tipe === 'Hadir' || item.tipe === 'Pulang';

            return (
              <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                        {item.tipe} {canViewAll && <span className="text-xs font-normal text-gray-500">({item.nama})</span>}
                    </h4>
                    <p className="text-xs text-gray-500 font-medium">{formatDateIndo(item.waktu)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                      {!isRegularAbsen && (<span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getStatusColor(item.status)}`}>{item.status || 'Pending'}</span>)}
                     {isRegularAbsen && (<span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">{formatTimeOnly(item.waktu)}</span>)}
                    <div className="flex gap-1 mt-1">
                      {canEdit && !canViewAll && (
                        <>
                          <button onClick={() => handleEdit(item)} className="p-1.5 bg-yellow-50 text-yellow-600 rounded border border-yellow-100" title="Edit (Batas 1 Jam)"><Edit className="w-4 h-4"/></button>
                          <button onClick={() => handleDelete(item.uuid)} className="p-1.5 bg-red-50 text-red-600 rounded border border-red-100" title="Hapus (Batas 1 Jam)"><Trash2 className="w-4 h-4"/></button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                
                <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded mb-2 italic border border-gray-100">"{item.catatan || '-'}"</p>
                {(item.tglMulai && item.tglMulai !== '-') && (<div className="text-xs text-blue-600 flex gap-2 mt-1 font-medium items-center bg-blue-50 p-1.5 rounded w-fit"><Calendar className="w-3 h-3"/> {formatDateShort(item.tglMulai)} s/d {formatDateShort(item.tglSelesai)}</div>)}
                
                {item.tipe === 'Cuti' && item.status === 'Pending' && !canViewAll && (
                  <button onClick={() => handleRequestApproval(item)} disabled={sendingEmail} className="w-full mt-3 bg-purple-100 text-purple-700 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-purple-200 border border-purple-200">
                    {sendingEmail ? 'Mengirim...' : <><CheckSquare className="w-3 h-3"/> Kirim Ulang Email Approval</>}
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
      <div className="flex items-center gap-2 mb-4">
        <BackButton onClick={() => setView('dashboard')} />
        <h2 className="text-xl font-bold ml-2">Admin Panel</h2>
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

// --- 7. LOGIN SCREEN (TIDAK BERUBAH) ---
function LoginScreen({ onLogin }) { 
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); 
  const [loading, setLoading] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-700 to-purple-800 p-4 relative overflow-hidden">
      
      {/* Dekorasi Background */}
      <div className="absolute top-10 left-10 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl animate-pulse"></div>
      <div className="absolute bottom-10 right-10 w-48 h-48 bg-purple-400 opacity-10 rounded-full blur-3xl"></div>

      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-3xl shadow-2xl w-full max-w-sm border border-white/50 relative z-10">
        
        {/* Ilustrasi Mesin Absensi */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative group">
            {/* Efek Glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            
            <div className="relative bg-white p-4 rounded-2xl border border-gray-100 shadow-lg flex items-center justify-center w-24 h-24">
              {/* Animasi Garis Scan */}
              <div className="absolute w-full h-1 bg-blue-500/50 top-4 animate-[bounce_2s_infinite]"></div>
              <ScanFace className="w-12 h-12 text-blue-600" />
            </div>
            
            {/* Icon Fingerprint kecil */}
            <div className="absolute -bottom-2 -right-2 bg-purple-600 text-white p-1.5 rounded-full border-2 border-white shadow-sm">
              <Fingerprint className="w-4 h-4" />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold text-slate-800 mt-5 tracking-tight">Absensi Online</h2>
          <p className="text-slate-500 text-xs mt-1 text-center px-4">
            Silakan Anda masuk ke sistem.
        </p>
        </div>

        {/* Form Login */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 ml-1">ID FingerPrint</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Smartphone className="h-5 w-5 text-gray-400" />
              </div>
              <input 
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors bg-gray-50/50" 
                placeholder="Masukkan ID FingerPrint Anda" 
                required 
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 ml-1">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Key className="h-5 w-5 text-gray-400" />
              </div>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors bg-gray-50/50" 
                placeholder="Masukkan Kata Sandi" 
                required 
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full py-3.5 px-4 rounded-xl text-white font-bold text-sm bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-lg shadow-blue-500/30 transform transition hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Memproses...</span>
              </div>
            ) : 'Masuk Sekarang'}
          </button>
        </form>
        
        <div className="mt-6 text-center">
          <p className="text-[11px] text-gray-400">
            &copy; {new Date().getFullYear()} Absensi Online | by : IT SUPPORT
          </p>
        </div>
      </div>
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
      <div className="flex items-center gap-2 mb-6">
        <BackButton onClick={() => setView('dashboard')} />
        <h2 className="text-xl font-bold ml-2">Ganti Password</h2>
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

// --- 9. DB ABSEN SCREEN (DATA MESIN - FIX FILTER TANGGAL) ---
function DbAbsenScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  // STATE FILTER
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterStatus, setFilterStatus] = useState('All'); 
  const [showFilter, setShowFilter] = useState(false);

  // MAP KETERANGAN
  const KETERANGAN_MAP = {
      'H': 'Hadir', 'T': 'Telat', 'O': 'Off / Libur', 'CB': 'Cuti Bersama',
      'PC': 'Pulang Cepat', 'Si': 'Tdk Absen Masuk', 'So': 'Tdk Absen Pulang',
      'I': 'Ijin', 'S': 'Sakit', 'C': 'Cuti', 'A': 'Alpa',
      'DL': 'Dinas Luar', 'TPC': 'Telat, Pulang Cepat', 'TSo': 'Telat, Tdk Absen Pulang',
      'TSi': 'Telat, Tdk Absen Masuk', 'SiSo': 'Tdk Absen Masuk & Pulang',
      'SiPC': 'Tdk Absen Masuk, Pulang Cepat', 'AC': 'Alpa Lebih Cuti',
      'EO': 'Extra Ordinary', 'NF': 'Tidak Absen Mesin'
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'get_db_absen', 
                userId: user.id,
                noPayroll: user.noPayroll 
            }) 
        });
        const data = await res.json();
        if (data.result === 'success') {
            setList(data.list);
        } else {
            alert(data.message);
        }
      } catch (e) {
        console.error(e);
        alert("Gagal memuat data mesin.");
      } finally {
        setLoading(false);
      }
    };
    
    if (user) fetchData();
  }, [user]);

  // --- HELPER: PARSING TANGGAL YANG LEBIH KUAT ---
  // Fungsi ini mengatasi masalah format DD-MM-YYYY atau DD/MM/YYYY
  const parseDate = (dateStr) => {
      if (!dateStr) return null;
      try {
          // Jika format sudah YYYY-MM-DD (ISO)
          if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return new Date(dateStr);
          
          // Jika format DD-MM-YYYY atau DD/MM/YYYY (Indonesia)
          const parts = dateStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
          if (parts) {
             // parts[1]=Tgl, parts[2]=Bulan, parts[3]=Tahun
             // Ubah ke format ISO YYYY-MM-DD agar bisa dibaca new Date()
             return new Date(`${parts[3]}-${parts[2]}-${parts[1]}`);
          }
          // Fallback
          return new Date(dateStr);
      } catch (e) {
          return null;
      }
  };

  // --- LOGIC FILTERING ---
  const filteredList = list.filter(item => {
    // 1. Filter Tanggal (DIPERBAIKI)
    let matchDate = true;
    if (filterStart || filterEnd) {
        const itemDateObj = parseDate(item.tanggal); // Gunakan helper parseDate
        
        if (itemDateObj && !isNaN(itemDateObj.getTime())) {
             const itemTime = itemDateObj.setHours(0, 0, 0, 0);
             
             const startTime = filterStart ? new Date(filterStart).setHours(0, 0, 0, 0) : null;
             const endTime = filterEnd ? new Date(filterEnd).setHours(23, 59, 59, 999) : null;

             matchDate = (!startTime || itemTime >= startTime) && (!endTime || itemTime <= endTime);
        } else {
             // Jika tanggal item tidak valid/kosong, jangan tampilkan jika sedang filter tanggal
             matchDate = false;
        }
    }

    // 2. Filter Status
    let matchStatus = true;
    if (filterStatus !== 'All') {
        matchStatus = item.symbol === filterStatus;
    }

    return matchDate && matchStatus;
  });

  const getSymbolColor = (sym) => {
      if(!sym) return 'bg-gray-100 text-gray-600';
      const s = sym.toUpperCase();
      if(s === 'H' || s === 'A') return 'bg-green-100 text-green-700'; 
      if(s === 'T' || s.includes('T')) return 'bg-red-100 text-red-700'; 
      return 'bg-blue-100 text-blue-700';
  };

  const translateDay = (dayName) => {
      if (!dayName) return '-';
      const map = { 'SUN': 'MINGGU', 'MON': 'SENIN', 'TUE': 'SELASA', 'WED': 'RABU', 'THU': 'KAMIS', 'FRI': 'JUMAT', 'SAT': 'SABTU' };
      const key = String(dayName).toUpperCase().substring(0, 3);
      return map[key] || dayName;
  };

  const clearFilter = () => {
    setFilterStart('');
    setFilterEnd('');
    setFilterStatus('All');
  };

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
            <BackButton onClick={() => setView('dashboard')} />
            <h2 className="text-xl font-bold ml-2">Data Mesin</h2>
        </div>
        
        <button 
            onClick={() => setShowFilter(!showFilter)} 
            className={`p-2 rounded-lg border transition-colors ${showFilter ? 'bg-blue-100 text-blue-600 border-blue-300' : 'bg-white text-gray-500 border-gray-200'}`}
            title="Filter Data"
        >
            <Filter className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-indigo-50 border border-indigo-200 p-3 rounded-lg mb-4 text-xs text-indigo-800">
        <p className="font-bold flex items-center gap-1"><Info className="w-3 h-3"/> Informasi:</p>
        <p>Data ini sinkron langsung dari Mesin Fingerprint ID - <strong>{user.noPayroll}</strong>.</p>
      </div>

      {showFilter && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-4 animate-in fade-in slide-in-from-top-2">
            <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs font-bold text-gray-700 flex items-center gap-2"><Filter className="w-4 h-4"/> Filter Data</h4>
                {(filterStart || filterEnd || filterStatus !== 'All') && (
                    <button onClick={clearFilter} className="text-[10px] text-red-500 font-bold hover:underline flex items-center gap-1">
                        <Trash2 className="w-3 h-3"/> Reset Filter
                    </button>
                )}
            </div>
            
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] text-gray-400 block mb-1">Dari Tanggal</label>
                        <input 
                            type="date" 
                            className="w-full p-2 border rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={filterStart}
                            onChange={(e) => setFilterStart(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400 block mb-1">Sampai Tanggal</label>
                        <input 
                            type="date" 
                            className="w-full p-2 border rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={filterEnd}
                            onChange={(e) => setFilterEnd(e.target.value)}
                        />
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Status / Keterangan</label>
                    <select 
                        className="w-full p-2 border rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="All">-- Semua Status --</option>
                        {Object.entries(KETERANGAN_MAP).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label} ({key})
                            </option>
                        ))}
                    </select>
                </div>
            </div>

             <div className="mt-3 pt-2 border-t text-[10px] text-blue-600 font-medium text-right">
                Ditemukan: <strong>{filteredList.length}</strong> Data
            </div>
        </div>
      )}

      {loading ? (
          <p className="text-center text-gray-500 mt-10 animate-pulse">Sedang sinkronisasi data mesin...</p>
      ) : (
        <div className="space-y-3">
            {filteredList.length === 0 && (
                <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <p>Tidak ada data ditemukan.</p>
                    {(filterStart || filterEnd || filterStatus !== 'All') && <p className="text-xs mt-1">Coba ubah filter pencarian Anda.</p>}
                </div>
            )}
{filteredList.map((item, idx) => {
    const textKeterangan = KETERANGAN_MAP[item.symbol] ? `(${KETERANGAN_MAP[item.symbol]})` : '';
    
    // LOGIKA BARU: Cek apakah simbol mengandung "T" atau "TELAT"
    const isLate = item.symbol && (
        item.symbol.toUpperCase() === 'T' || 
        item.symbol.toUpperCase().includes('TELAT') ||
        item.symbol.toUpperCase().includes('TSO') ||
        item.symbol.toUpperCase().includes('TSI')
    );

    return (
        <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start border-b border-gray-100 pb-2 mb-2">
                <div>
                    <p className="text-xs text-gray-500 font-bold uppercase">
                        {translateDay(item.week)}
                    </p>
                    <h4 className="font-bold text-gray-800">{item.tanggal}</h4>
                </div>
                <div className="text-right">
                     <span className={`text-xs font-bold px-2 py-1 rounded ${getSymbolColor(item.symbol)} block`}>
                          {item.symbol || '-'} <br/>
                          <span className="text-[10px] opacity-80 font-normal">{textKeterangan}</span>
                     </span>
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-y-2 text-sm">
                {/* ... (Konten Jam Masuk, Pulang, dsb tetap sama) ... */}
                <div>
                    <p className="text-[10px] text-gray-400">Jam Masuk</p>
                    <p className="font-medium font-bold text-blue-600">{formatTimeOnly(item.masuk)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-gray-400">Jam Pulang</p>
                    <p className="font-medium font-bold text-blue-600">{formatTimeOnly(item.pulang)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-gray-400">Jam Kerja</p>
                     <p className="font-medium">{item.jamKerja}</p>
                </div>
                <div>
                    <p className="text-[10px] text-gray-400">Telat</p>
                    <p className={`font-medium ${item.telat ? 'text-red-600' : 'text-gray-600'}`}>
                    {formatTimeOnly(item.telat)} 
                    </p>
              </div>
            </div>

 {/* --- [RESTORE] LOG WAKTU SCAN --- */}
            <div className="mt-3">
                <p className="text-[10px] text-gray-400 mb-1">Log Scan Mesin:</p>
                <div className="bg-gray-50 p-2.5 rounded border border-gray-200 text-xs font-mono text-gray-600 break-words leading-relaxed">
                    {item.waktuScan ? item.waktuScan.replace(/,/g, ', ') : '-'}
                </div>
            </div>

            {/* --- TOMBOL TAMBAHAN UNTUK IJIN --- */}
            {isLate && (
                <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                    <button 
                        onClick={() => {
                            // Simpan tipe absen ke localStorage
                            localStorage.setItem('absenType', 'Ijin');
                            // SetView ke form
                            setView('form');
                            // Opsional: Anda bisa menambahkan logic untuk mengisi otomatis catatan
                            // berdasarkan tanggal telat tersebut jika diperlukan.
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2 bg-orange-50 text-orange-600 border border-orange-200 rounded-lg text-xs font-bold hover:bg-orange-100 transition-colors active:scale-95"
                    >
                        <FileText className="w-3.5 h-3.5" />
                        Ajukan Form Ijin ({item.tanggal})
                    </button>
                </div>
            )}

            {/* ... (Bagian Log Waktu Scan tetap sama) ... */}
        </div>
        );
        })}
        </div>
      )}
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