import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';

// Import Icons
import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, FileText, AlertTriangle, X, FileSpreadsheet, 
  File as FileIcon, Filter, CheckSquare, Users, Eye, Printer,
  ScanFace, Fingerprint, Smartphone, ChevronLeft, ChevronDown, ChevronUp, Search
} from 'lucide-react';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyt9qWwK6jpsLFcU93wRNBr3XqwgoRHJtmF-MIWxr3hdc3tJQn0hAdhODoSLqViM8Oj0Q/exec';

const ICON_MAP = {
  'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': FileText, 'Sakit': AlertTriangle, 'Lembur': Clock, 'Dinas': Briefcase, 'Cuti': Calendar
};

const COLOR_MAP = {
  'Hadir': 'bg-green-500', 'Pulang': 'bg-red-500', 'Ijin': 'bg-yellow-500', 'Sakit': 'bg-orange-500', 'Lembur': 'bg-purple-500', 'Dinas': 'bg-indigo-500', 'Cuti': 'bg-pink-500'
};

// --- COMPONENT: TOMBOL BACK DINAMIS ---
function BackButton({ onClick }) {
  return (
    <button 
      onClick={onClick} 
      className="group flex items-center gap-2 pl-1 pr-4 py-1.5 bg-white text-slate-600 rounded-full shadow-sm border border-slate-200 hover:bg-white hover:text-blue-600 hover:border-blue-200 hover:shadow-md transition-all duration-300 active:scale-95"
    >
      <div className="bg-slate-100 p-1.5 rounded-full group-hover:bg-blue-50 transition-colors">
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
      </div>
      <span className="text-sm font-bold">Kembali</span>
    </button>
  );
}

export default function AppAbsensi() {
  const [user, setUser] = useState(null); 
  const [view, setView] = useState('login'); 
  const [masterData, setMasterData] = useState({ menus: [], roles: [], divisions: [] });
  const [editItem, setEditItem] = useState(null);

  const logoutTimerRef = useRef(null);
  const TIMEOUT_DURATION = 5 * 60 * 1000; 

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
    setMasterData({ menus: [], roles: [], divisions: [] });
    setView('login');
    localStorage.removeItem('app_user');
    localStorage.removeItem('app_master_data');
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
    const processedMasterData = { menus, roles, divisions };
    
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
                <h1 className="font-bold text-lg">E-Absensi</h1>
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
          {view === 'form' && <AttendanceForm user={user} setUser={setUser} setView={setView} editItem={editItem} setEditItem={setEditItem} />}
          {view === 'history' && <HistoryScreen user={user} setView={setView} setEditItem={setEditItem} masterData={masterData} />}
          {view === 'admin' && <AdminPanel user={user} setView={setView} masterData={masterData} />}
          {view === 'approval' && <ApprovalScreen user={user} setView={setView} />}
          {view === 'ganti_password' && <ChangePasswordScreen user={user} setView={setView} />}
        </div>
      </div>
    </div>
  );
}

// --- 1. ATTENDANCE FORM ---
function AttendanceForm({ user, setUser, setView, editItem, setEditItem }) {
  const type = localStorage.getItem('absenType') || 'Hadir';
  const isEditMode = !!editItem;

  const PHOTO_REQUIRED_TYPES = ['Hadir', 'Pulang', 'Dinas', 'Sakit'];
  const NO_GPS_TYPES = ['Ijin', 'Cuti', 'Dinas Luar', 'Sakit', 'Cuti EO', 'Tukar Shift']; 
  const NO_TIME_TYPES = ['Cuti', 'Dinas Luar', 'Sakit', 'Cuti EO']; 
  const H3_REQUIRED_TYPES = ['Ijin', 'Tukar Shift']; 

  const isPhotoRequired = PHOTO_REQUIRED_TYPES.includes(type);
  const isGpsRequired = !NO_GPS_TYPES.includes(type);
  const isTimeRequired = !NO_TIME_TYPES.includes(type);
  const isH3Required = H3_REQUIRED_TYPES.includes(type);
  const isIntervalType = !['Hadir', 'Pulang'].includes(type);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState(null);
  const [catatan, setCatatan] = useState('');
  const [intervalData, setIntervalData] = useState({ tglMulai: '', tglSelesai: '', jamMulai: '', jamSelesai: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [minDateLimit, setMinDateLimit] = useState('');

  useEffect(() => {
    if (isH3Required) {
      const d = new Date();
      d.setDate(d.getDate() - 3); 
      const minDateStr = d.toISOString().split('T')[0];
      setMinDateLimit(minDateStr);
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
  }, [editItem]);

  useEffect(() => { 
    if (!isEditMode && isGpsRequired && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }), 
        () => alert('Gagal lokasi. Pastikan GPS aktif.')
      ); 
    }
  }, [isGpsRequired, isEditMode]);
  
  const startCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); if (videoRef.current) { videoRef.current.srcObject = stream; setCameraActive(true); } } catch (err) { alert("Gagal akses kamera."); } };
  const takePhoto = () => { const video = videoRef.current; const canvas = canvasRef.current; if (video && canvas) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); setPhoto(canvas.toDataURL('image/jpeg')); video.srcObject.getTracks().forEach(track => track.stop()); setCameraActive(false); } };
  
  const handleSubmit = async () => {
    if (type === 'Cuti' && (parseInt(user.sisaCuti) || 0) < 1) {
        alert('Maaf, Sisa Cuti Anda (0) tidak mencukupi untuk mengajukan Cuti.');
        return;
    }

    if (isEditMode) {
        const entryTime = new Date(editItem.waktu).getTime();
        const now = new Date().getTime();
        const diffHours = (now - entryTime) / (1000 * 60 * 60);
        if (diffHours > 1) {
            alert('Waktu edit sudah habis (lebih dari 1 jam).');
            return;
        }
    }

    if (isIntervalType) {
        if (!intervalData.tglMulai || !intervalData.tglSelesai) {
             alert('Lengkapi Tanggal!'); return;
        }
        if (isH3Required && minDateLimit && intervalData.tglMulai < minDateLimit) {
            alert('Pengajuan wajib dilakukan minimal 3 hari sebelumnya!'); return;
        }
    }

    if (isIntervalType && isTimeRequired) {
        if (!intervalData.jamMulai || !intervalData.jamSelesai) {
            alert('Lengkapi Jam!'); return; 
        }
    }

    if (isPhotoRequired && !isEditMode && !photo) { alert('Foto Wajib untuk tipe absen ini.'); return; }
    if (isGpsRequired && !isEditMode && !location) { alert('Lokasi belum ditemukan.'); return; }
    
    setIsSubmitting(true);
    try {
      const payload = { action: isEditMode ? 'edit_absen' : 'absen', uuid: isEditMode ? editItem.uuid : null, userId: user.id, nama: user.nama, tipe: type, lokasi: location ? `${location.lat}, ${location.lng}` : '-', catatan: catatan, foto: photo, ...intervalData };
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') { 
        alert(isEditMode ? 'Data diupdate!' : 'Absensi Berhasil!');
        if (data.newSisaCuti !== undefined && data.newSisaCuti !== null) {
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
        <h2 className="text-xl font-bold ml-2">{isEditMode ? 'Edit Data' : `Konfirmasi ${type}`}</h2>
      </div>
      
      {isH3Required && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-3 mb-4 text-xs">
          <p className="font-bold">Perhatian!</p>
          <p>Pengajuan {type} wajib dilakukan maksimal 3 hari setelahnya.</p>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4">
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

        {isPhotoRequired && (
          <>
            {!isEditMode && (
              <div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center relative border-2 border-dashed">
                {!photo && !cameraActive && <button onClick={startCamera} className="text-blue-600 flex flex-col items-center"><Camera /><span className="text-sm">Buka Kamera (Wajib)</span></button>}
                <video ref={videoRef} autoPlay playsInline className={`absolute inset-0 w-full h-full object-cover ${cameraActive && !photo ? 'block' : 'hidden'}`} />
                <canvas ref={canvasRef} className="hidden" />
                {photo && <img src={photo} className="absolute inset-0 w-full h-full object-cover" />}
                {cameraActive && <button onClick={takePhoto} className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white rounded-full p-1"><div className="w-12 h-12 bg-red-500 rounded-full border-4 border-white"></div></button>}
              </div>
            )}
            {photo && !isEditMode && <button onClick={() => {setPhoto(null); startCamera();}} className="w-full text-center text-blue-600 text-sm">Foto Ulang</button>}
          </>
        )}
        
        {!isEditMode && isGpsRequired && (
            <div className="flex items-center gap-3 bg-blue-50 p-3 rounded-lg text-blue-800">
                <MapPin /><span className="text-sm">{location ? `${location.lat}, ${location.lng}` : 'Mencari Lokasi...'}</span>
            </div>
        )}

        <textarea className="w-full border p-2 rounded text-sm" placeholder="Catatan..." value={catatan} onChange={e => setCatatan(e.target.value)}></textarea>
      </div>
      <button onClick={handleSubmit} disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold mt-6 mb-10">{isSubmitting ? 'Menyimpan...' : (isEditMode ? 'Update Data' : 'Kirim Absen')}</button>
    </div>
  );
}

// --- 2. APPROVAL SCREEN ---
function ApprovalScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchApprovalList = async () => {
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
  };

  useEffect(() => { fetchApprovalList(); }, []);

  const handleDecision = async (uuid, decision, namaUser) => {
    const actionText = decision === 'approve' ? 'Menyetujui' : 'Menolak';
    if (!window.confirm(`Yakin ingin ${actionText} pengajuan dari ${namaUser}?`)) return;

    try {
      const res = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ action: 'process_approval', uuid, decision, approverName: user.nama }) 
      });
      const data = await res.json();
      if (data.result === 'success') { 
          alert(data.message); 
          fetchApprovalList(); 
      } 
      else { alert(data.message); }
    } catch (e) { alert('Terjadi kesalahan koneksi'); }
  };

  const formatDateIndo = (dateString) => { if (!dateString || dateString === '-') return '-'; try { const date = new Date(dateString); return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return dateString; } };

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

// --- 3. DASHBOARD ---
function Dashboard({ user, setUser, setView, masterData }) { 
  const [time, setTime] = useState(new Date()); 
  const [stats, setStats] = useState({}); 
  
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

  if (!user) return null; 
  const availableMenus = masterData.menus || []; 
  const allowedMenus = user.akses && user.akses.length > 0 ? availableMenus.filter(item => user.akses.includes(item.value)) : availableMenus; 
  const canApprove = ['admin', 'hrd', 'manager'].includes(user.role);

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
        
        {/* Animated Background Layer */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 bg-[length:400%_400%] animate-[gradient_6s_ease_infinite]"></div>
        
        {/* Floating Bubbles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-700"></div>

        {/* Content Layer */}
        <div className="relative z-10">
            
            {/* Header: Sapaan & Jam */}
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
                
                {/* JAM DIGITAL ANIMASI */}
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

            {/* INFO USER CARD (Glassmorphism) */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/20 shadow-inner">
                 <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                     {/* Perusahaan */}
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1">
                            <Building className="w-3 h-3"/> Perusahaan
                        </span>
                        <span className="text-sm font-semibold truncate" title={user.perusahaan}>{user.perusahaan || '-'}</span>
                     </div>

                     {/* Payroll */}
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1">
                            <CreditCard className="w-3 h-3"/> Payroll
                        </span>
                        <span className="text-sm font-semibold font-mono tracking-wide">{user.noPayroll || '-'}</span>
                     </div>

                     {/* Status */}
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1">
                            <Briefcase className="w-3 h-3"/> Status
                        </span>
                        <span className="text-sm font-semibold">{user.statusKaryawan || '-'}</span>
                     </div>

                     {/* Sisa Cuti */}
                     <div className="flex flex-col">
                        <span className="text-[10px] text-blue-200 uppercase tracking-wider flex items-center gap-1">
                            <PieChart className="w-3 h-3"/> Sisa Cuti
                        </span>
                        <span className="text-lg font-bold text-yellow-300">{user.sisaCuti} Hari</span>
                     </div>
                 </div>
            </div>

        </div>
      </div> 
      
      {/* MENU SHORTCUT */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide"> 
        <button onClick={() => setView('history')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-blue-600 font-bold hover:bg-blue-50 transition active:scale-95"><History className="w-5 h-5" /><span className="text-xs">Riwayat</span></button> 
        
        {canApprove && (
            <button onClick={() => setView('approval')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-orange-600 font-bold hover:bg-orange-50 transition active:scale-95">
                <Users className="w-5 h-5" />
                <span className="text-xs">Approval</span>
            </button>
        )}

        {user?.role === 'admin' && ( <button onClick={() => setView('admin')} className="flex-1 min-w-[100px] bg-slate-800 text-white p-3 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 font-bold hover:bg-slate-700 transition active:scale-95"><Settings className="w-5 h-5" /><span className="text-xs">Panel</span></button> )} 
      </div> 

      <h3 className="font-bold text-gray-700 mb-3 px-1 flex items-center gap-2">
         <div className="w-1 h-5 bg-blue-600 rounded-full"></div>
         Menu Absensi
      </h3> 

      <div className="grid grid-cols-2 gap-4"> 
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
      </div> 
      
      <style>{`
        @keyframes gradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
      `}</style>

    </div> 
  ); 
}

// --- HISTORY SCREEN (UPDATE: ADMIN LOCATION FILTER & SEARCH NAME) ---
function HistoryScreen({ user, setView, setEditItem, masterData }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterType, setFilterType] = useState('All'); 
  const [showWebReport, setShowWebReport] = useState(false);
  
  // -- ADMIN SPECIFIC STATES --
  const isAdmin = user.role === 'admin';
  const isSuperAdmin = isAdmin && (user.lokasi === 'All' || !user.lokasi);
  
  const [allUsers, setAllUsers] = useState([]); 
  const [selectedUserIds, setSelectedUserIds] = useState([]); 
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  
  // New: States for Filtering Users
  const [locationFilter, setLocationFilter] = useState('All'); // For Dropdown
  const [searchUser, setSearchUser] = useState(''); // For Name Search

  // FETCH USERS (With Location Filter)
  const fetchUsers = async () => {
    try {
        const res = await fetch(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'get_user_list_simple',
                lokasi: user.lokasi || 'All', // Lokasi Admin (Permission)
                filterLokasi: locationFilter // Lokasi yg ingin dilihat (Filter UI)
            }) 
        });
        const data = await res.json();
        if(data.result === 'success') {
             setAllUsers(data.list);
             // Reset selection when location changes to avoid ID mismatch
             setSelectedUserIds([]); 
        }
    } catch(e) { console.error("Gagal load users"); }
  }

  // FETCH HISTORY (With Location Security)
  const fetchHistory = async () => {
    setLoading(true);
    try { 
      const payload = { 
        action: 'get_history', 
        userId: user.id,
        isAdmin: isAdmin,
        adminLokasi: user.lokasi || 'All', // Kirim Lokasi Admin
        targetUserIds: isAdmin ? selectedUserIds : [] 
      };
      
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json(); 
      if (data.result === 'success') setHistory(data.history);
    } catch (e) { alert('Gagal ambil data'); } finally { setLoading(false); }
  };

  useEffect(() => { 
      if(isAdmin) fetchUsers();
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationFilter]); // Re-fetch users when location filter changes

  useEffect(() => {
      fetchHistory(); 
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserIds]); // Re-fetch history when user selection changes

  // -- HELPER FORMATTERS --
  const formatDateIndo = (dateString) => { if (!dateString || dateString === '-') return '-'; try { const date = new Date(dateString); return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return dateString; } };
  const formatDateShort = (dateString) => { if (!dateString || dateString === '-') return '-'; try { return new Date(dateString).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}); } catch (e) { return dateString; } };
  const formatTimeOnly = (val) => { if (!val || val === '-') return '-'; if (typeof val === 'string' && (val.includes('T') || val.length > 8)) { try { const dateObj = new Date(val); if (!isNaN(dateObj.getTime())) { return dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':'); } } catch (e) { return val.substring(0, 5); } } return val.length >= 5 ? val.substring(0, 5) : val; };
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
    const message = `Kirim email pengajuan approval untuk:\n\nTipe: ${item.tipe}\nTanggal: ${detailTanggal}\n\nLanjutkan kirim ke Kepala Divisi?`;
    if (!window.confirm(message)) return;
    setSendingEmail(true);
    try {
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'request_approval_email', uuid: item.uuid }) });
      const data = await res.json(); alert(data.message);
    } catch (e) { alert("Gagal kirim email"); } 
    finally { setSendingEmail(false); }
  };

  const handleDelete = async (uuid) => { if (!window.confirm('Yakin hapus data ini?')) return; try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'delete_absen', uuid }) }); const data = await res.json(); if (data.result === 'success') { alert('Terhapus'); fetchHistory(); } else { alert(data.message); } } catch (e) { alert('Gagal hapus'); } };
  const handleEdit = (item) => { setEditItem(item); localStorage.setItem('absenType', item.tipe); setView('form'); };

  const isEditable = (waktuStr, status) => {
    if (status !== 'Pending') return false;
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
     // Filter users visible in list (after search)
     const visibleUsers = allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase()));
     const visibleIds = visibleUsers.map(u => u.id);
     
     // Check if all visible are selected
     const allVisibleSelected = visibleIds.every(id => selectedUserIds.includes(id));

     if(allVisibleSelected) {
         // Deselect visible ones
         setSelectedUserIds(selectedUserIds.filter(id => !visibleIds.includes(id)));
     } else {
         // Select visible ones
         // Merge unique IDs
         const newSelection = [...new Set([...selectedUserIds, ...visibleIds])];
         setSelectedUserIds(newSelection);
     }
  };

  const displayData = getFilteredHistory();
  const getStatusColor = (status) => { 
      if (status === 'Approved' || status === 'Verified') return 'bg-green-100 text-green-700 border-green-200'; 
      if (status === 'Rejected') return 'bg-red-100 text-red-700 border-red-200'; 
      return 'bg-yellow-100 text-yellow-700 border-yellow-200'; 
  };
  
  const uniqueTypes = ['All', ...new Set(history.map(item => item.tipe))];

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      
      {/* MODAL VIEW WEB (WEB REPORT) */}
      {showWebReport && (
        <div className="fixed inset-0 bg-white z-[60] overflow-auto flex flex-col">
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center shadow-md sticky top-0 z-10">
                <h3 className="font-bold flex items-center gap-2"><FileIcon className="w-5 h-5"/> Laporan Web</h3>
                <button onClick={() => setShowWebReport(false)} className="bg-white/20 p-1.5 rounded-full hover:bg-white/30"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="p-4 flex-1">
                {/* Header Laporan */}
                <div className="mb-6 border-b pb-4">
                    <h2 className="text-xl font-bold text-gray-800 uppercase mb-2">Laporan Data Absensi</h2>
                    <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                        <div><strong>Dicetak Oleh:</strong> {user.nama}</div>
                        <div><strong>Periode Cetak:</strong> {formatDateTimeFull(new Date())}</div>
                        <div><strong>Lokasi Admin:</strong> {user.lokasi || 'All'}</div>
                        <div><strong>Filter Lokasi:</strong> {locationFilter}</div>
                    </div>
                </div>

                {/* Tabel Data (Responsive) */}
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse border border-gray-200">
                        <thead className="bg-gray-100 text-gray-700 uppercase font-bold">
                            <tr>
                                <th className="border p-2">No Payroll</th>
                                <th className="border p-2">Nama</th>
                                <th className="border p-2">Tipe</th>
                                <th className="border p-2">Tanggal Input</th>
                                <th className="border p-2">Detail Periode</th>
                                <th className="border p-2">Jam</th>
                                <th className="border p-2">Catatan</th>
                                <th className="border p-2">Status</th>
                                <th className="border p-2">Waktu Approved</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayData.map((item, index) => (
                                <tr key={index} className="hover:bg-gray-50 border-b">
                                    <td className="border p-2">{item.noPayroll || '-'}</td>
                                    <td className="border p-2">{item.nama}</td>
                                    <td className="border p-2 font-bold">{item.tipe}</td>
                                    <td className="border p-2">{formatDateTimeFull(item.waktu)}</td>
                                    <td className="border p-2">{item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} s/d ${formatDateShort(item.tglSelesai)}` : '-'}</td>
                                    <td className="border p-2">{(item.jamMulai && item.jamMulai !== '-') ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-'}</td>
                                    <td className="border p-2 italic">{item.catatan || '-'}</td>
                                    <td className="border p-2 font-bold">{item.status || 'Pending'}</td>
                                    <td className="border p-2">{formatDateTimeFull(item.approvalTime)}</td>
                                </tr>
                            ))}
                            {displayData.length === 0 && (
                                <tr><td colSpan="9" className="border p-4 text-center text-gray-400">Tidak ada data.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                
                <div className="mt-4 flex justify-end">
                    <button onClick={() => window.print()} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 print:hidden hover:bg-slate-700">
                        <Printer className="w-4 h-4"/> Cetak Layar
                    </button>
                </div>
            </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <BackButton onClick={() => setView('dashboard')} />
        <h2 className="text-xl font-bold ml-2">Riwayat & Laporan</h2>
      </div>
      
      {/* FILTER ADMIN USER CHECKLIST */}
      {isAdmin && (
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
                    
                    {/* DROPDOWN FILTER LOKASI (HANYA UNTUK SUPER ADMIN / LOKASI 'ALL') */}
                    {isSuperAdmin && (
                        <div className="mb-3 bg-slate-600 p-2 rounded">
                            <label className="text-[10px] text-gray-300 block mb-1">Pilih Lokasi:</label>
                            <select 
                                value={locationFilter} 
                                onChange={(e) => setLocationFilter(e.target.value)}
                                className="w-full p-2 text-sm text-black rounded"
                            >
                                <option value="All">Semua Lokasi</option>
                                <option value="Surabaya">Surabaya</option>
                                <option value="Jakarta">Jakarta</option>
                                {/* Opsi dinamis jika ada master data lokasi bisa ditambahkan disini */}
                            </select>
                        </div>
                    )}

                    {/* SEARCH USER */}
                    <div className="mb-3 relative">
                        <input 
                            type="text" 
                            placeholder="Cari Nama Karyawan..." 
                            value={searchUser}
                            onChange={(e) => setSearchUser(e.target.value)}
                            className="w-full p-2 pl-8 text-sm text-black rounded"
                        />
                        <Search className="w-4 h-4 text-gray-500 absolute left-2.5 top-2.5"/>
                    </div>

                    <button 
                        onClick={selectAllUsers} 
                        className="text-xs font-bold text-blue-300 mb-2 hover:text-white"
                    >
                        {selectedUserIds.length > 0 ? 'Reset Pilihan' : 'Pilih Semua (Hasil Pencarian)'}
                    </button>

                    <div className="space-y-1">
                        {allUsers.filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase())).length === 0 && <p className="text-xs text-gray-400">User tidak ditemukan.</p>}
                        
                        {allUsers
                            .filter(u => u.nama.toLowerCase().includes(searchUser.toLowerCase()))
                            .map(u => (
                            <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-600 p-1 rounded">
                                <input 
                                    type="checkbox" 
                                    checked={selectedUserIds.includes(u.id)}
                                    onChange={() => toggleUserSelection(u.id)}
                                    className="w-4 h-4"
                                />
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
            <label className="text-[10px] text-gray-400">Tipe Absen</label>
            <select className="w-full border rounded p-1.5 text-sm bg-white" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                {uniqueTypes.map((t, i) => ( <option key={i} value={t}>{t === 'All' ? 'Semua Tipe' : t}</option> ))}
            </select>
        </div>
        <div className="flex gap-2"> 
          <button onClick={() => setShowWebReport(true)} className="flex-1 flex items-center justify-center gap-2 p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition text-sm font-bold"><Eye className="w-4 h-4" /> Lihat Laporan Web</button> 
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
                        {item.tipe} {isAdmin && <span className="text-xs font-normal text-gray-500">({item.nama})</span>}
                    </h4>
                    <p className="text-xs text-gray-500 font-medium">{formatDateIndo(item.waktu)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    
                    {!isRegularAbsen && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getStatusColor(item.status)}`}>{item.status || 'Pending'}</span>
                    )}
                    {isRegularAbsen && (
                         <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                             {formatTimeOnly(item.waktu)}
                        </span>
                    )}

                    <div className="flex gap-1 mt-1">
                      {canEdit && !isAdmin && (
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
                
                {item.tipe === 'Cuti' && item.status === 'Pending' && !isAdmin && (
                  <button 
                    onClick={() => handleRequestApproval(item)} 
                    disabled={sendingEmail}
                    className="w-full mt-3 bg-purple-600 text-white py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-purple-700"
                  >
                    {sendingEmail ? 'Mengirim...' : <><CheckSquare className="w-4 h-4"/> Ajukan Approval</>}
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

function AdminPanel({ user, setView, masterData }) {
  const [activeTab, setActiveTab] = useState('user');
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState({ 
    username: '', password: '', nama: '', email: '', 
    divisi: 'Staff', role: 'karyawan', akses: [], 
    noPayroll: '', sisaCuti: '', perusahaan: '', 
    statusKaryawan: '', emailAtasan: '',
    lokasi: 'Surabaya' 
  }); 
  const [masterInput, setMasterInput] = useState({ kategori: 'Menu', value: '', label: '' });

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
        body: JSON.stringify({ action: 'tambah_user', ...userData }) 
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
        body: JSON.stringify({ action: 'tambah_master', ...masterInput }) 
      }).then(r=>r.json()); 
      if(res.result === 'success') { 
        alert('Data Ditambah!'); 
        setMasterInput({ kategori: 'Menu', value: '', label: '' }); 
      } else alert(res.message); 
    } catch(e) { alert('Error'); } finally { setLoading(false); } 
  };

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center gap-2 mb-4">
        <BackButton onClick={() => setView('dashboard')} />
        <h2 className="text-xl font-bold ml-2">Admin Panel</h2>
      </div>

      <div className="flex gap-2 mb-6 bg-gray-200 p-1 rounded-lg">
        <button onClick={() => setActiveTab('user')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'user' ? 'bg-white shadow' : 'text-gray-500'}`}>Tambah User</button>
        <button onClick={() => setActiveTab('master')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'master' ? 'bg-white shadow' : 'text-gray-500'}`}>Tambah Master Data</button>
      </div>

      {activeTab === 'user' ? (
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Divisi</label>
                <select className="w-full p-2 border rounded" value={userData.divisi} onChange={e => setUserData({...userData, divisi: e.target.value})}>
                  {masterData.divisions.map((d, i) => <option key={i} value={d.value}>{d.label}</option>)}
                  {masterData.divisions.length === 0 && <option>Staff</option>}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500">Lokasi Penempatan</label>
                <select className="w-full p-2 border rounded" value={userData.lokasi} onChange={e => setUserData({...userData, lokasi: e.target.value})}>
                  <option value="Surabaya">Surabaya</option>
                  <option value="Jakarta">Jakarta</option>
                </select>
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
      ) : (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <form onSubmit={handleAddMaster} className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Kategori</label>
              <select className="w-full p-2 border rounded" value={masterInput.kategori} onChange={e => setMasterInput({...masterInput, kategori: e.target.value})}>
                <option value="Menu">Menu Absensi Baru</option>
                <option value="Role">Role User Baru</option>
                <option value="Divisi">Divisi Baru</option>
              </select>
            </div>
            <input required type="text" className="w-full p-2 border rounded" value={masterInput.value} onChange={e => setMasterInput({...masterInput, value: e.target.value})} placeholder="Value (Contoh: WorkFromHome)" />
            <input required type="text" className="w-full p-2 border rounded" value={masterInput.label} onChange={e => setMasterInput({...masterInput, label: e.target.value})} placeholder="Label (Contoh: WFH)" />
            <button type="submit" disabled={loading} className="w-full bg-purple-700 text-white py-3 rounded-lg font-bold hover:bg-purple-800">
              {loading ? 'Simpan...' : 'Tambah Master Data'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// --- NEW LOGIN SCREEN ---
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
          
          <h2 className="text-2xl font-bold text-slate-800 mt-5 tracking-tight">E-Absensi Online</h2>
          <p className="text-slate-500 text-xs mt-1 text-center px-4">
            Silakan scan kredensial Anda untuk masuk ke sistem.
          </p>
        </div>

        {/* Form Login */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 ml-1">Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Smartphone className="h-5 w-5 text-gray-400" />
              </div>
              <input 
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors bg-gray-50/50" 
                placeholder="Masukkan ID / Username" 
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
          <p className="text-[10px] text-gray-400">
            &copy; {new Date().getFullYear()} E-Absensi Online | By : IT SUPPORT
          </p>
        </div>
      </div>
    </div> 
  ); 
}

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
      {/* UPDATE: Menggunakan BackButton */}
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