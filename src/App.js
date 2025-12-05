import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from './cropImageHelper'; 

// UPDATE: Penambahan icon ScanFace, Fingerprint, dan Smartphone
import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, Upload, FileText, AlertTriangle, X, Download, FileSpreadsheet, 
  File as FileIcon, Filter, FileDown, Crop, Check, CheckSquare, ThumbsUp, ThumbsDown, Users,
  ScanFace, Fingerprint, Smartphone 
} from 'lucide-react';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwePCCyxWGbzStLtPxJglqw5c7sp5Sc8LqpjFB5rzpxoanXUitjVATljGSEE5bERvvmrQ/exec';

const ICON_MAP = {
  'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': FileText, 'Sakit': AlertTriangle, 'Lembur': Clock, 'Dinas': Briefcase, 'Cuti': Calendar
};

const COLOR_MAP = {
  'Hadir': 'bg-green-500', 'Pulang': 'bg-red-500', 'Ijin': 'bg-yellow-500', 'Sakit': 'bg-orange-500', 'Lembur': 'bg-purple-500', 'Dinas': 'bg-indigo-500', 'Cuti': 'bg-pink-500'
};

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
        {/* Navbar hanya muncul jika bukan di halaman login */}
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
          {view === 'history' && <HistoryScreen user={user} setView={setView} setEditItem={setEditItem} />}
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
      <div className="flex items-center gap-2 mb-4"><button onClick={handleBack} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">{isEditMode ? 'Edit Data' : `Konfirmasi ${type}`}</h2></div>
      
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

// --- 2. APPROVAL SCREEN (LIST USER LAIN YANG PERLU DI-APPROVE) ---
function ApprovalScreen({ user, setView }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fungsi Fetch untuk mengambil data "Pending" milik user lain (sesuai role)
  const fetchApprovalList = async () => {
    setLoading(true);
    try {
      const res = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
            action: 'get_approval_list', 
            userId: user.id, 
            divisi: user.divisi, 
            role: user.role // Server side logic akan cek jika admin/hrd return semua data pending
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
          fetchApprovalList(); // Refresh list setelah approve/reject
      } 
      else { alert(data.message); }
    } catch (e) { alert('Terjadi kesalahan koneksi'); }
  };

  const formatDateIndo = (dateString) => { if (!dateString || dateString === '-') return '-'; try { const date = new Date(dateString); return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return dateString; } };

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button>
        <h2 className="text-xl font-bold">Daftar Approval</h2>
      </div>

      <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg mb-4 text-xs text-blue-800">
        <p className="font-bold">Info:</p>
        <p>Halaman ini menampilkan semua pengajuan dari karyawan yang berstatus <strong>Pending</strong>.</p>
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
                      <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 font-bold border border-gray-200">
                        {item.divisi}
                      </span>
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
function Dashboard({ user, setUser, setView, masterData }) { const [time, setTime] = useState(new Date()); const [stats, setStats] = useState({}); const [uploading, setUploading] = useState(false); const fileInputRef = useRef(null); const [tempImageSrc, setTempImageSrc] = useState(null); const [crop, setCrop] = useState({ x: 0, y: 0 }); const [zoom, setZoom] = useState(1); const [croppedAreaPixels, setCroppedAreaPixels] = useState(null); const [showCropper, setShowCropper] = useState(false); useEffect(() => { const timer = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(timer); }, []); useEffect(() => { const fetchStats = async () => { try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_stats', userId: user.id }) }); const data = await res.json(); if (data.result === 'success') { const normalizedStats = {}; Object.keys(data.stats).forEach(key => { normalizedStats[key.toLowerCase()] = data.stats[key]; }); setStats({ ...data.stats, ...normalizedStats }); } } catch (e) { console.error("Gagal load stats"); } }; if (user) fetchStats(); }, [user]); const onFileChange = async (e) => { if (e.target.files && e.target.files.length > 0) { const file = e.target.files[0]; const imageDataUrl = await readFile(file); setTempImageSrc(imageDataUrl); setShowCropper(true); e.target.value = null; } }; const readFile = (file) => { return new Promise((resolve) => { const reader = new FileReader(); reader.addEventListener('load', () => resolve(reader.result), false); reader.readAsDataURL(file); }); }; const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => { setCroppedAreaPixels(croppedAreaPixels); }, []); const handleSaveCroppedImage = async () => { if (!croppedAreaPixels || !tempImageSrc) return; setUploading(true); try { const croppedImageBase64 = await getCroppedImg(tempImageSrc, croppedAreaPixels); const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'upload_profile', id: user.id, nama: user.nama, foto: croppedImageBase64 }) }); const data = await response.json(); if (data.result === 'success') { const newPhotoUrl = data.fotoUrl + (data.fotoUrl.includes('?') ? '&' : '?') + 't=' + new Date().getTime(); const updatedUser = { ...user, fotoProfil: newPhotoUrl }; setUser(updatedUser); localStorage.setItem('app_user', JSON.stringify(updatedUser)); alert('Foto profil berhasil diperbarui!'); } else { alert('Gagal upload: ' + data.message); } } catch (err) { alert('Error: ' + err.message); } finally { setUploading(false); setShowCropper(false); setTempImageSrc(null); } }; if (!user) return null; const availableMenus = masterData.menus || []; const allowedMenus = user.akses && user.akses.length > 0 ? availableMenus.filter(item => user.akses.includes(item.value)) : availableMenus; 
  
  // Logic cek role untuk menampilkan tombol Approval List
  const canApprove = ['admin', 'hrd'].includes(user.role);

  return ( 
    <div className="p-4 pb-20"> 
      {showCropper && ( <div className="fixed inset-0 z-50 bg-black bg-opacity-75 flex flex-col items-center justify-center p-4"> <div className="bg-white p-4 rounded-xl w-full max-w-md relative h-[400px] flex flex-col"> <h3 className="text-lg font-bold mb-2 flex items-center gap-2"><Crop className="w-5 h-5"/> Sesuaikan Foto</h3> <div className="relative flex-1 bg-gray-100 rounded-lg overflow-hidden"><Cropper image={tempImageSrc} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onCropComplete={onCropComplete} onZoomChange={setZoom} cropShape="round" showGrid={false} /></div> <div className="flex gap-2 mt-4"><button onClick={() => setShowCropper(false)} className="flex-1 py-2 border border-gray-300 rounded-lg font-bold text-gray-600 hover:bg-gray-50">Batal</button><button onClick={handleSaveCroppedImage} disabled={uploading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700">{uploading ? 'Menyimpan...' : <><Check className="w-4 h-4"/> Simpan Foto</>}</button></div> </div> </div> )} 
      <div className="bg-gradient-to-r from-blue-500 to-blue-700 rounded-2xl p-6 text-white shadow-lg mb-6 relative"> <div className="flex items-center gap-4 relative z-10"> <div className="relative group cursor-pointer" onClick={() => fileInputRef.current.click()}> <div className="bg-white/20 p-1 rounded-full w-16 h-16 flex items-center justify-center overflow-hidden border-2 border-white/30"> {user.fotoProfil ? <img key={user.fotoProfil} src={user.fotoProfil} alt="Profil" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" /> : <User className="w-8 h-8 text-white" />} </div> <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><Upload className="w-5 h-5 text-white" /></div> <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={onFileChange} /> </div> <div><h2 className="text-xl font-bold">{user?.nama || 'Tanpa Nama'}</h2><p className="text-blue-100 text-sm">{user?.divisi || '-'} {user?.role === 'admin' && <span className="bg-yellow-400 text-black text-[10px] px-2 rounded-full ml-1">ADMIN</span>}</p>{uploading && <p className="text-xs text-yellow-300 mt-1 italic">Mengupload foto...</p>}</div> </div> <div className="mt-4 grid grid-cols-2 gap-2"> <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex flex-col gap-1 border border-white/20"><div className="flex items-center gap-2 font-bold text-blue-100"><Building className="w-3 h-3"/> Perusahaan</div><div className="truncate">{user.perusahaan || '-'}</div></div> <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex flex-col gap-1 border border-white/20"><div className="flex items-center gap-2 font-bold text-green-100"><Briefcase className="w-3 h-3"/> Status</div><div>{user.statusKaryawan || '-'}</div></div> <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border border-white/20"><CreditCard className="w-3 h-3 text-yellow-300"/> Payroll: {user.noPayroll || '-'}</div> <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border border-white/20"><PieChart className="w-3 h-3 text-pink-300"/> Sisa Cuti: {user.sisaCuti}</div> </div> <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-end relative z-10"><div><p className="text-xs text-blue-200">Hari ini</p><p className="font-semibold">{time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><div className="text-3xl font-bold tracking-widest">{time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div></div> </div> 
      
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2"> 
        <button onClick={() => setView('history')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-blue-600 font-bold hover:bg-blue-50 transition"><History className="w-5 h-5" /><span className="text-xs">Riwayat</span></button> 
        
        {/* --- TOMBOL APPROVAL LIST (HANYA MUNCUL JIKA ADMIN/HRD) --- */}
        {canApprove && (
            <button onClick={() => setView('approval')} className="flex-1 min-w-[100px] bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-1 text-orange-600 font-bold hover:bg-orange-50 transition">
                <Users className="w-5 h-5" />
                <span className="text-xs">Approval</span>
            </button>
        )}

        {user?.role === 'admin' && ( <button onClick={() => setView('admin')} className="flex-1 min-w-[100px] bg-slate-800 text-white p-3 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 font-bold hover:bg-slate-700 transition"><Settings className="w-5 h-5" /><span className="text-xs">Panel</span></button> )} 
      </div> 

      <h3 className="font-bold text-gray-700 mb-3 px-1">Menu Absensi</h3> 
      <div className="grid grid-cols-2 gap-4"> 
        {allowedMenus.map((item) => { const Icon = ICON_MAP[item.value] || Star; const colorClass = COLOR_MAP[item.value] || 'bg-blue-400'; const count = stats[item.value] || stats[item.value.toLowerCase()] || 0; const isAttendance = ['Hadir', 'Pulang'].includes(item.value); return ( <button key={item.value} onClick={() => { localStorage.setItem('absenType', item.value); setView('form'); }} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition text-left group relative overflow-hidden"> {!isAttendance && (<div className="absolute top-0 right-0 bg-red-50 text-red-600 text-xl font-bold px-3 py-1 rounded-bl-2xl border-l border-b border-red-100 shadow-sm z-10">{count}</div>)} <div className={`${colorClass} w-10 h-10 rounded-lg flex items-center justify-center text-white mb-3 shadow-sm group-hover:scale-110 transition`}><Icon className="w-5 h-5" /></div> <h4 className="font-bold text-gray-800">{item.label}</h4> {!isAttendance ? <p className="text-[10px] text-gray-400">Ajukan Form {item.label}</p> : <p className="text-[10px] text-gray-400">Mulai {item.label}</p>} </button> ) })} 
      </div> 
    </div> 
  ); 
}

function HistoryScreen({ user, setView, setEditItem }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterType, setFilterType] = useState('All'); 

  const fetchHistory = async () => {
    try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_history', userId: user.id }) });
      const data = await res.json(); if (data.result === 'success') setHistory(data.history);
    } catch (e) { alert('Gagal ambil data'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchHistory(); }, []);

  const formatDateIndo = (dateString) => { if (!dateString || dateString === '-') return '-'; try { const date = new Date(dateString); return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}); } catch (e) { return dateString; } };
  const formatDateShort = (dateString) => { if (!dateString || dateString === '-') return '-'; try { return new Date(dateString).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}); } catch (e) { return dateString; } };
  const formatTimeOnly = (val) => { if (!val || val === '-') return '-'; if (typeof val === 'string' && (val.includes('T') || val.length > 8)) { try { const dateObj = new Date(val); if (!isNaN(dateObj.getTime())) { return dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':'); } } catch (e) { return val.substring(0, 5); } } return val.length >= 5 ? val.substring(0, 5) : val; };

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

  const handleDownloadSingle = (item) => { const doc = new jsPDF(); doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.text((user.perusahaan || "PERUSAHAAN").toUpperCase(), 105, 20, null, null, "center"); doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("FORMULIR PENGAJUAN / LAPORAN HARIAN", 105, 26, null, null, "center"); doc.setLineWidth(0.5); doc.line(20, 32, 190, 32); doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text(`FORMULIR: ${item.tipe.toUpperCase()}`, 105, 45, null, null, "center"); const tglMulaiIndo = formatDateShort(item.tglMulai); const tglSelesaiIndo = formatDateShort(item.tglSelesai); const detailPeriode = item.tglMulai !== '-' ? `${tglMulaiIndo} s/d ${tglSelesaiIndo}` : formatDateIndo(item.waktu); const detailJam = (item.jamMulai && item.jamMulai !== '-') ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-'; const tableData = [ ["Nama Karyawan", user.nama], ["Divisi", user.divisi], ["Tanggal Pengajuan", formatDateIndo(item.waktu)], ["Jenis Laporan", item.tipe], ["Periode Ijin/Sakit", detailPeriode], ["Waktu (Jam)", detailJam], ["Catatan", item.catatan || "-"], ["Status Approval", item.status || "Pending"] ]; autoTable(doc, { body: tableData, startY: 55, theme: 'grid', styles: { fontSize: 10, cellPadding: 4 }, columnStyles: { 0: { fontStyle: 'bold', width: 60, fillColor: [245, 245, 245] }, 1: { width: 110 } }, }); const finalY = doc.lastAutoTable.finalY + 30; doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(`Surabaya, ${formatDateShort(new Date())}`, 30, finalY - 5); doc.text("Pemohon,", 30, finalY); doc.text(`( ${user.nama} )`, 30, finalY + 25); doc.text("Menyetujui,", 140, finalY); doc.text("Kepala Divisi", 140, finalY + 5); doc.text("( ................................... )", 140, finalY + 25); doc.save(`Form_${item.tipe}_${user.nama}.pdf`); };
  
  const exportToExcel = () => {
    const dataToExport = getFilteredHistory().map((item, index) => ({
      'No': index + 1,
      'Tipe': item.tipe,
      'Tanggal Input': formatDateIndo(item.waktu),
      'Detail Periode': item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : '-',
      'Jam': (item.jamMulai && item.jamMulai !== '-') ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` : '-',
      'Lokasi': item.lokasi || '-',
      'Catatan': item.catatan || '-',
      'Status': item.status || 'Pending'
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Rekap Absensi"); XLSX.writeFile(wb, `Laporan_Absensi_${user.nama}_${new Date().getTime()}.xlsx`);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Laporan Riwayat: ${user.nama}`, 14, 20); doc.setFontSize(10); doc.text(`Divisi: ${user.divisi} | Dicetak: ${new Date().toLocaleDateString('id-ID')}`, 14, 26);
    const tableColumn = ["No", "Tipe", "Tanggal", "Detail", "Status"]; const tableRows = [];
    getFilteredHistory().forEach((item, index) => {
      const detailInfo = item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : (item.catatan || '-');
      const rowData = [ index + 1, item.tipe, formatDateShort(item.waktu), detailInfo, item.status || 'Pending' ]; tableRows.push(rowData);
    });
    autoTable(doc, { head: [tableColumn], body: tableRows, startY: 32 }); doc.save(`Laporan_Riwayat_${user.nama}.pdf`);
  };

  const displayData = getFilteredHistory();
  const getStatusColor = (status) => { if (status === 'Approved') return 'bg-green-100 text-green-700 border-green-200'; if (status === 'Rejected') return 'bg-red-100 text-red-700 border-red-200'; return 'bg-yellow-100 text-yellow-700 border-yellow-200'; };
  const uniqueTypes = ['All', ...new Set(history.map(item => item.tipe))];

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center gap-2 mb-4"><button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">Riwayat & Laporan</h2></div>
      
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
          <button onClick={exportToExcel} className="flex-1 flex items-center justify-center gap-2 p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition text-sm font-bold"><FileSpreadsheet className="w-4 h-4" /> Download Excel</button> 
          <button onClick={exportToPDF} className="flex-1 flex items-center justify-center gap-2 p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition text-sm font-bold"><FileIcon className="w-4 h-4" /> Download PDF</button> 
        </div>
      </div>

      {loading ? <p className="text-center text-gray-500">Memuat...</p> : (
        <div className="space-y-3">
          {displayData.length === 0 && <p className="text-center text-gray-400 text-sm py-4">Tidak ada data sesuai filter.</p>}
          {displayData.map((item, idx) => {
            const canEdit = isEditable(item.waktu, item.status);
            return (
              <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative">
                <div className="flex justify-between items-start mb-2">
                  <div><h4 className="font-bold text-gray-800 text-lg">{item.tipe}</h4><p className="text-xs text-gray-500 font-medium">{formatDateIndo(item.waktu)}</p></div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getStatusColor(item.status)}`}>{item.status || 'Pending'}</span>
                    <div className="flex gap-1 mt-1">
                      <button onClick={() => handleDownloadSingle(item)} className="p-1.5 bg-blue-50 text-blue-600 rounded border border-blue-100" title="Download Form"><FileDown className="w-4 h-4"/></button>
                      
                      {canEdit && (
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
                
                {item.tipe === 'Cuti' && item.status === 'Pending' && (
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
    statusKaryawan: '', emailAtasan: '' 
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
          statusKaryawan: '', emailAtasan: ''
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
        <button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button>
        <h2 className="text-xl font-bold">Admin Panel</h2>
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

// --- NEW LOGIN SCREEN (UPDATED) ---
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
            &copy; {new Date().getFullYear()} E-Absensi Online | By: IT Support
          </p>
        </div>
      </div>
    </div> 
  ); 
}

function ChangePasswordScreen({ user, setView }) { const [oldPassword, setOldPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [loading, setLoading] = useState(false); const handleChangePassword = async (e) => { e.preventDefault(); setLoading(true); try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'ganti_password', id: user.id, oldPassword, newPassword }) }).then(r => r.json()); if (res.result === 'success') { alert('Password berhasil diubah!'); setView('dashboard'); } else { alert(res.message); } } catch (err) { alert('Gagal menghubungi server.'); } finally { setLoading(false); } }; return ( <div className="p-4"><div className="flex items-center gap-2 mb-6"><button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">Ganti Password</h2></div><div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200"><form onSubmit={handleChangePassword} className="space-y-4"><input required type="password" className="w-full p-2 border rounded" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="Password Lama" /><input required type="password" className="w-full p-2 border rounded" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Password Baru" /><button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-blue-700">{loading ? 'Memproses...' : 'Ubah Password'}</button></form></div></div> ); }