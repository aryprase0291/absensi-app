import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- IMPORT DIPERBAIKI (Gunakan Kurung Kurawal { }) ---
import Cropper from 'react-easy-crop';
import { getCroppedImg } from './cropImageHelper'; // Perbaikan di sini

// Import Icon lengkap
import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, Upload, FileText, AlertTriangle, X, Download, FileSpreadsheet, 
  File as FileIcon, Filter, FileDown, Crop, Check
} from 'lucide-react';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyrdR6JVqyhOqY9RrZDbnUxFfNbUJ1FqQEioDsOjzMsQvOhA_bXwEzk4CGA8WeP47J5-g/exec';

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

  const handleLogout = useCallback(() => {
    setUser(null);
    setMasterData({ menus: [], roles: [], divisions: [] });
    setView('login');
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
    setMasterData({ menus, roles, divisions });
    setUser(userData);
    setView('dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-slate-800">
      <div className="max-w-md mx-auto bg-white min-h-screen shadow-xl overflow-hidden relative">
        {/* HEADER */}
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

        <div className="p-0">
          {view === 'login' && <LoginScreen onLogin={handleLogin} />}
          {view === 'dashboard' && <Dashboard user={user} setUser={setUser} setView={setView} masterData={masterData} />}
          {view === 'form' && <AttendanceForm user={user} setView={setView} editItem={editItem} setEditItem={setEditItem} />}
          {view === 'history' && <HistoryScreen user={user} setView={setView} setEditItem={setEditItem} />}
          {view === 'admin' && <AdminPanel user={user} setView={setView} masterData={masterData} />}
          {view === 'ganti_password' && <ChangePasswordScreen user={user} setView={setView} />}
        </div>
      </div>
    </div>
  );
}

// --- HISTORY SCREEN ---
function HistoryScreen({ user, setView, setEditItem }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');

  const fetchHistory = async () => {
    try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'get_history', userId: user.id }) });
      const data = await res.json(); if (data.result === 'success') setHistory(data.history);
    } catch (e) { alert('Gagal ambil data'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchHistory(); }, []);

  const handleDelete = async (uuid) => {
    if (!window.confirm('Yakin hapus data ini?')) return;
    try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'delete_absen', uuid }) });
      const data = await res.json(); if (data.result === 'success') { alert('Terhapus'); fetchHistory(); } else { alert(data.message); }
    } catch (e) { alert('Gagal hapus'); }
  };

  const handleEdit = (item) => { setEditItem(item); localStorage.setItem('absenType', item.tipe); setView('form'); };
  const isEditable = (waktuStr) => { return (new Date() - new Date(waktuStr)) / 36e5 < 1; };

  const formatDateIndo = (dateString) => {
    if (!dateString || dateString === '-') return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
    } catch (e) { return dateString; }
  };

  const formatDateShort = (dateString) => {
    if (!dateString || dateString === '-') return '-';
    try {
      return new Date(dateString).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'});
    } catch (e) { return dateString; }
  };

  const formatTimeOnly = (val) => {
    if (!val || val === '-') return '-';
    if (typeof val === 'string' && (val.includes('T') || val.length > 8)) {
        try {
            const dateObj = new Date(val);
            if (!isNaN(dateObj.getTime())) {
                return dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
            }
        } catch (e) { return val.substring(0, 5); }
    }
    return val.length >= 5 ? val.substring(0, 5) : val;
  };

  const getFilteredHistory = () => {
    if (!filterStart && !filterEnd) return history;
    return history.filter(item => {
      const itemDate = new Date(item.waktu).setHours(0, 0, 0, 0);
      const start = filterStart ? new Date(filterStart).setHours(0, 0, 0, 0) : null;
      const end = filterEnd ? new Date(filterEnd).setHours(23, 59, 59, 999) : null;
      if (start && end) return itemDate >= start && itemDate <= end;
      if (start) return itemDate >= start;
      if (end) return itemDate <= end;
      return true;
    });
  };

  const handleDownloadSingle = (item) => {
    const doc = new jsPDF();
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text((user.perusahaan || "PERUSAHAAN").toUpperCase(), 105, 20, null, null, "center");
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text("FORMULIR PENGAJUAN / LAPORAN HARIAN", 105, 26, null, null, "center");
    doc.setLineWidth(0.5); doc.line(20, 32, 190, 32); 
    doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text(`FORMULIR: ${item.tipe.toUpperCase()}`, 105, 45, null, null, "center");

    const tglMulaiIndo = formatDateShort(item.tglMulai);
    const tglSelesaiIndo = formatDateShort(item.tglSelesai);
    const detailPeriode = item.tglMulai !== '-' ? `${tglMulaiIndo} s/d ${tglSelesaiIndo}` : formatDateIndo(item.waktu);
    const detailJam = (item.jamMulai && item.jamMulai !== '-') 
      ? `${formatTimeOnly(item.jamMulai)} - ${formatTimeOnly(item.jamSelesai)}` 
      : '-';

    const tableData = [
      ["Nama Karyawan", user.nama], ["Divisi", user.divisi], ["Tanggal Pengajuan", formatDateIndo(item.waktu)],
      ["Jenis Laporan", item.tipe], ["Periode Ijin/Sakit", detailPeriode], ["Waktu (Jam)", detailJam], ["Catatan", item.catatan || "-"]
    ];

    autoTable(doc, {
      body: tableData, startY: 55, theme: 'grid', styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: { 0: { fontStyle: 'bold', width: 60, fillColor: [245, 245, 245] }, 1: { width: 110 } },
    });

    const finalY = doc.lastAutoTable.finalY + 30; 
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Surabaya, ${formatDateShort(new Date())}`, 30, finalY - 5); 
    doc.text("Pemohon,", 30, finalY); doc.text(`( ${user.nama} )`, 30, finalY + 25);
    doc.text("Menyetujui,", 140, finalY); doc.text("Kepala Divisi", 140, finalY + 5); doc.text("( ................................... )", 140, finalY + 25);
    doc.setFontSize(8); doc.setTextColor(150); doc.text("*Dokumen ini digenerate otomatis oleh sistem E-Absensi", 105, 285, null, null, "center");
    doc.save(`Form_${item.tipe}_${user.nama}_${item.waktu.substring(0,10)}.pdf`);
  };

  const exportToExcel = () => {
    const dataToDownload = getFilteredHistory();
    if (dataToDownload.length === 0) return alert("Data kosong");
    const dataToExport = dataToDownload.map(item => ({
      Tanggal: formatDateShort(item.waktu), Tipe: item.tipe, Catatan: item.catatan, Mulai: formatDateShort(item.tglMulai), Selesai: formatDateShort(item.tglSelesai)
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Riwayat"); XLSX.writeFile(wb, `Rekap_Absensi_${user.nama}.xlsx`);
  };

  const exportToPDF = () => {
    const dataToDownload = getFilteredHistory();
    if (dataToDownload.length === 0) return alert("Tidak ada data");
    const doc = new jsPDF();
    doc.text(`Laporan Absensi: ${user.nama}`, 14, 15); doc.setFontSize(10);
    const periodeText = filterStart && filterEnd ? `Periode: ${filterStart} s/d ${filterEnd}` : "Periode: Semua Riwayat";
    doc.text(`Divisi: ${user.divisi} | ${periodeText}`, 14, 22);
    const tableRows = [];
    dataToDownload.forEach(item => {
      const tanggalOnly = formatDateShort(item.waktu);
      const detail = item.tglMulai !== '-' ? `${formatDateShort(item.tglMulai)} - ${formatDateShort(item.tglSelesai)}` : '-';
      tableRows.push([tanggalOnly, item.tipe, item.catatan, detail]);
    });
    autoTable(doc, { head: [["Tanggal", "Tipe", "Catatan", "Detail"]], body: tableRows, startY: 30 });
    doc.save(`Riwayat_${user.nama}_${filterStart || 'All'}.pdf`);
  };

  const displayData = getFilteredHistory();

  return (
    <div className="p-4 h-full overflow-y-auto pb-20">
      <div className="flex items-center gap-2 mb-4"><button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">Riwayat & Laporan</h2></div>
      <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-200 mb-4">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-500"><Filter className="w-4 h-4" /> Filter Periode</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className="text-[10px] text-gray-400">Dari</label><input type="date" className="w-full border rounded p-1 text-sm" value={filterStart} onChange={e => setFilterStart(e.target.value)} /></div>
          <div><label className="text-[10px] text-gray-400">Sampai</label><input type="date" className="w-full border rounded p-1 text-sm" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportToExcel} className="flex-1 flex items-center justify-center gap-2 p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition text-sm font-bold"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
          <button onClick={exportToPDF} className="flex-1 flex items-center justify-center gap-2 p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition text-sm font-bold"><FileIcon className="w-4 h-4" /> PDF</button>
        </div>
      </div>
      {loading ? <p className="text-center text-gray-500">Memuat...</p> : (
        <div className="space-y-3">
          {displayData.length === 0 && <p className="text-center text-gray-400 text-sm py-4">Tidak ada data.</p>}
          {displayData.map((item, idx) => (
            <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative">
              <div className="flex justify-between items-start mb-2">
                <div><h4 className="font-bold text-gray-800 text-lg">{item.tipe}</h4><p className="text-xs text-gray-500 font-medium">{formatDateIndo(item.waktu)}</p></div>
                <div className="flex gap-1">
                  <button onClick={() => handleDownloadSingle(item)} className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100 hover:bg-blue-100"><FileDown className="w-4 h-4"/></button>
                  {isEditable(item.waktu) ? (<><button onClick={() => handleEdit(item)} className="p-2 bg-yellow-50 text-yellow-600 rounded-lg border border-yellow-100 hover:bg-yellow-100"><Edit className="w-4 h-4"/></button><button onClick={() => handleDelete(item.uuid)} className="p-2 bg-red-50 text-red-600 rounded-lg border border-red-100 hover:bg-red-100"><Trash2 className="w-4 h-4"/></button></>) : (<div className="flex items-center px-2 bg-gray-100 rounded text-[10px] text-gray-500 font-bold h-8">LOCKED</div>)}
                </div>
              </div>
              <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded mb-2 italic border border-gray-100">"{item.catatan || '-'}"</p>
              {(item.tglMulai && item.tglMulai !== '-') && (<div className="text-xs text-blue-600 flex gap-2 mt-1 font-medium items-center bg-blue-50 p-1.5 rounded w-fit"><Calendar className="w-3 h-3"/> {formatDateShort(item.tglMulai)} s/d {formatDateShort(item.tglSelesai)}</div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- LOGIN SCREEN ---
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'login', username, password }) });
      const data = await response.json();
      if (data.result === 'success' && data.user) onLogin(data.user, data.masterData || []);
      else alert(data.message || 'Login Gagal');
    } catch (err) { alert('Gagal koneksi server.'); } finally { setLoading(false); }
  };
  return (
    <div className="p-8 flex flex-col justify-center h-[80vh]">
      <div className="text-center mb-8"><div className="bg-blue-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"><User className="w-10 h-10 text-blue-600" /></div><h2 className="text-2xl font-bold text-gray-800">E-Absensi</h2><p className="text-gray-500 text-sm mt-1">Silakan login</p></div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full p-3 border rounded-lg" placeholder="Username" required />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 border rounded-lg" placeholder="Password" required />
        <button type="submit" disabled={loading} className="w-full py-3 rounded-lg text-white font-bold bg-blue-600 hover:bg-blue-700 shadow-lg">{loading ? 'Loading...' : 'Login'}</button>
      </form>
    </div>
  );
}

// --- DASHBOARD (DENGAN FITUR CROP) ---
function Dashboard({ user, setUser, setView, masterData }) {
  const [time, setTime] = useState(new Date());
  const [stats, setStats] = useState({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // STATE UNTUK CROPPER
  const [tempImageSrc, setTempImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [showCropper, setShowCropper] = useState(false);

  useEffect(() => { const timer = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(timer); }, []);
  
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

  // 1. Handler saat file dipilih (Buka Modal Cropper)
  const onFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const imageDataUrl = await readFile(file);
      setTempImageSrc(imageDataUrl);
      setShowCropper(true);
      // Reset input file agar bisa pilih file yang sama lagi jika dibatalkan
      e.target.value = null; 
    }
  };

  // Helper membaca file jadi URL
  const readFile = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result), false);
      reader.readAsDataURL(file);
    });
  };

  // Callback saat cropping selesai di UI
  const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  // 2. Handler saat tombol "Simpan Foto" diklik di Modal
  const handleSaveCroppedImage = async () => {
    if (!croppedAreaPixels || !tempImageSrc) return;
    setUploading(true);
    try {
      // Generate base64 gambar yang sudah dicrop
      const croppedImageBase64 = await getCroppedImg(tempImageSrc, croppedAreaPixels);
      
      // Kirim ke GAS
      const response = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
            action: 'upload_profile', 
            id: user.id, 
            nama: user.nama, 
            foto: croppedImageBase64 // Kirim hasil crop
        }) 
      });
      const data = await response.json();
      if (data.result === 'success') { 
        // Tambahkan timestamp agar browser me-refresh gambar (cache busting)
        const newPhotoUrl = data.fotoUrl + (data.fotoUrl.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
        setUser(prev => ({ ...prev, fotoProfil: newPhotoUrl })); 
        alert('Foto profil berhasil diperbarui!'); 
      } else { 
        alert('Gagal upload: ' + data.message); 
      }
    } catch (err) { 
      alert('Error: ' + err.message); 
    } finally { 
      setUploading(false);
      setShowCropper(false);
      setTempImageSrc(null);
    }
  };

  if (!user) return null;
  const availableMenus = masterData.menus || [];
  const allowedMenus = user.akses && user.akses.length > 0 ? availableMenus.filter(item => user.akses.includes(item.value)) : availableMenus;

  return (
    <div className="p-4 pb-20">
      {/* --- MODAL CROPPER --- */}
      {showCropper && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-75 flex flex-col items-center justify-center p-4">
          <div className="bg-white p-4 rounded-xl w-full max-w-md relative h-[400px] flex flex-col">
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2"><Crop className="w-5 h-5"/> Sesuaikan Foto</h3>
            <div className="relative flex-1 bg-gray-100 rounded-lg overflow-hidden">
               <Cropper
                  image={tempImageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1} // Rasio 1:1 (Kotak/Lingkaran)
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                  cropShape="round" // Bentuk crop lingkaran di UI
                  showGrid={false}
                />
            </div>
            <div className="flex gap-2 mt-4">
                <button 
                    onClick={() => setShowCropper(false)} 
                    className="flex-1 py-2 border border-gray-300 rounded-lg font-bold text-gray-600 hover:bg-gray-50"
                >
                    Batal
                </button>
                <button 
                    onClick={handleSaveCroppedImage} 
                    disabled={uploading}
                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700"
                >
                    {uploading ? 'Menyimpan...' : <><Check className="w-4 h-4"/> Simpan Foto</>}
                </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-r from-blue-500 to-blue-700 rounded-2xl p-6 text-white shadow-lg mb-6 relative">
        <div className="flex items-center gap-4 relative z-10">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current.click()}>
            <div className="bg-white/20 p-1 rounded-full w-16 h-16 flex items-center justify-center overflow-hidden border-2 border-white/30">
              {/* Tambahkan key timestamp agar React me-render ulang gambar saat URL berubah */}
              {user.fotoProfil ? <img key={user.fotoProfil} src={user.fotoProfil} alt="Profil" className="w-full h-full object-cover rounded-full" /> : <User className="w-8 h-8 text-white" />}
            </div>
            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><Upload className="w-5 h-5 text-white" /></div>
            {/* Ubah handler onChange */}
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={onFileChange} />
          </div>
          <div><h2 className="text-xl font-bold">{user?.nama || 'Tanpa Nama'}</h2><p className="text-blue-100 text-sm">{user?.divisi || '-'} {user?.role === 'admin' && <span className="bg-yellow-400 text-black text-[10px] px-2 rounded-full ml-1">ADMIN</span>}</p>{uploading && <p className="text-xs text-yellow-300 mt-1 italic">Mengupload foto...</p>}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
           <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex flex-col gap-1 border border-white/20"><div className="flex items-center gap-2 font-bold text-blue-100"><Building className="w-3 h-3"/> Perusahaan</div><div className="truncate">{user.perusahaan || '-'}</div></div>
           <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex flex-col gap-1 border border-white/20"><div className="flex items-center gap-2 font-bold text-green-100"><Briefcase className="w-3 h-3"/> Status</div><div>{user.statusKaryawan || '-'}</div></div>
           <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border border-white/20"><CreditCard className="w-3 h-3 text-yellow-300"/> Payroll: {user.noPayroll || '-'}</div>
           <div className="bg-white/10 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border border-white/20"><PieChart className="w-3 h-3 text-pink-300"/> Sisa Cuti: {user.sisaCuti}</div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-end relative z-10"><div><p className="text-xs text-blue-200">Hari ini</p><p className="font-semibold">{time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><div className="text-3xl font-bold tracking-widest">{time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div></div>
      </div>
      
      <div className="flex gap-2 mb-6"><button onClick={() => setView('history')} className="flex-1 bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center gap-2 text-blue-600 font-bold hover:bg-blue-50 transition"><History className="w-5 h-5" /> Riwayat</button>{user?.role === 'admin' && (<button onClick={() => setView('admin')} className="flex-1 bg-slate-800 text-white p-3 rounded-xl shadow-sm flex items-center justify-center gap-2 font-bold hover:bg-slate-700 transition"><Settings className="w-5 h-5" /> Panel</button>)}</div>

      <h3 className="font-bold text-gray-700 mb-3 px-1">Menu Absensi</h3>
      <div className="grid grid-cols-2 gap-4">
        {allowedMenus.map((item) => {
          const Icon = ICON_MAP[item.value] || Star;
          const colorClass = COLOR_MAP[item.value] || 'bg-blue-400';
          const count = stats[item.value] || stats[item.value.toLowerCase()] || 0;
          const isAttendance = ['Hadir', 'Pulang'].includes(item.value);

          return (
            <button 
                key={item.value} 
                onClick={() => { localStorage.setItem('absenType', item.value); setView('form'); }} 
                className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition text-left group relative overflow-hidden"
            >
              {!isAttendance && (
                  <div className="absolute top-0 right-0 bg-red-50 text-red-600 text-xl font-bold px-3 py-1 rounded-bl-2xl border-l border-b border-red-100 shadow-sm z-10">
                    {count}
                  </div>
              )}

              <div className={`${colorClass} w-10 h-10 rounded-lg flex items-center justify-center text-white mb-3 shadow-sm group-hover:scale-110 transition`}>
                <Icon className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-gray-800">{item.label}</h4>
              {!isAttendance ? 
                <p className="text-[10px] text-gray-400">Ajukan {item.label}</p> : 
                <p className="text-[10px] text-gray-400">Absen {item.label}</p>
              }
            </button>
          )
        })}
      </div>
    </div>
  );
}

// --- ATTENDANCE FORM ---
function AttendanceForm({ user, setView, editItem, setEditItem }) {
  const type = localStorage.getItem('absenType') || 'Hadir';
  const isEditMode = !!editItem;
  const PHOTO_REQUIRED_TYPES = ['Hadir', 'Pulang', 'Dinas', 'Sakit'];
  const isPhotoRequired = PHOTO_REQUIRED_TYPES.includes(type);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState(null);
  const [catatan, setCatatan] = useState('');
  const [intervalData, setIntervalData] = useState({ tglMulai: '', tglSelesai: '', jamMulai: '', jamSelesai: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  useEffect(() => {
    if (isEditMode) {
      setCatatan(editItem.catatan);
      const formatDate = (d) => d && d !== '-' ? new Date(d).toISOString().split('T')[0] : '';
      setIntervalData({ tglMulai: formatDate(editItem.tglMulai), tglSelesai: formatDate(editItem.tglSelesai), jamMulai: editItem.jamMulai !== '-' ? editItem.jamMulai : '', jamSelesai: editItem.jamSelesai !== '-' ? editItem.jamSelesai : '' });
      setPhoto(editItem.foto); 
    }
  }, [editItem]);
  useEffect(() => { if (!isEditMode && 'geolocation' in navigator) navigator.geolocation.getCurrentPosition((p) => setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }), () => alert('Gagal lokasi')); }, []);
  const isIntervalType = !['Hadir', 'Pulang'].includes(type);
  const startCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); if (videoRef.current) { videoRef.current.srcObject = stream; setCameraActive(true); } } catch (err) { alert("Gagal akses kamera."); } };
  const takePhoto = () => { const video = videoRef.current; const canvas = canvasRef.current; if (video && canvas) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); setPhoto(canvas.toDataURL('image/jpeg')); video.srcObject.getTracks().forEach(track => track.stop()); setCameraActive(false); } };
  const handleSubmit = async () => {
    if (isIntervalType && (!intervalData.tglMulai || !intervalData.tglSelesai || !intervalData.jamMulai || !intervalData.jamSelesai)) { alert('Lengkapi Tanggal dan Jam!'); return; }
    if (isPhotoRequired && !isEditMode && !photo) { alert('Foto Wajib untuk tipe absen ini.'); return; }
    if (!isEditMode && !location) { alert('Lokasi belum ditemukan.'); return; }
    setIsSubmitting(true);
    try {
      const payload = { action: isEditMode ? 'edit_absen' : 'absen', uuid: isEditMode ? editItem.uuid : null, userId: user.id, nama: user.nama, tipe: type, lokasi: location ? `${location.lat}, ${location.lng}` : '-', catatan: catatan, foto: photo, ...intervalData };
      const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.result === 'success') { alert(isEditMode ? 'Data diupdate!' : 'Absensi Berhasil!'); setEditItem(null); setView(isEditMode ? 'history' : 'dashboard'); } else { alert(data.message); }
    } catch (e) { alert('Gagal kirim.'); } finally { setIsSubmitting(false); }
  };
  const handleBack = () => { setEditItem(null); setView(isEditMode ? 'history' : 'dashboard'); }
  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto">
      <div className="flex items-center gap-2 mb-4"><button onClick={handleBack} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">{isEditMode ? 'Edit Data' : `Konfirmasi ${type}`}</h2></div>
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4">
        {isIntervalType && (<div className="bg-blue-50 p-3 rounded-lg space-y-3 border border-blue-100"><h4 className="font-bold text-blue-800 text-sm flex items-center gap-2"><Calendar className="w-4 h-4"/> Detail Waktu (Wajib)</h4><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-gray-500">Tgl Mulai *</label><input type="date" className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.tglMulai} onChange={e => setIntervalData({...intervalData, tglMulai: e.target.value})} /></div><div><label className="text-xs text-gray-500">Tgl Selesai *</label><input type="date" className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.tglSelesai} onChange={e => setIntervalData({...intervalData, tglSelesai: e.target.value})} /></div><div><label className="text-xs text-gray-500">Jam Mulai *</label><input type="time" className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.jamMulai} onChange={e => setIntervalData({...intervalData, jamMulai: e.target.value})} /></div><div><label className="text-xs text-gray-500">Jam Selesai *</label><input type="time" className="w-full p-1.5 text-sm border rounded bg-white" value={intervalData.jamSelesai} onChange={e => setIntervalData({...intervalData, jamSelesai: e.target.value})} /></div></div></div>)}
        {isPhotoRequired ? (<>{!isEditMode && (<div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center relative border-2 border-dashed">{!photo && !cameraActive && <button onClick={startCamera} className="text-blue-600 flex flex-col items-center"><Camera /><span className="text-sm">Buka Kamera (Wajib)</span></button>}<video ref={videoRef} autoPlay playsInline className={`absolute inset-0 w-full h-full object-cover ${cameraActive && !photo ? 'block' : 'hidden'}`} /><canvas ref={canvasRef} className="hidden" />{photo && <img src={photo} className="absolute inset-0 w-full h-full object-cover" />}{cameraActive && <button onClick={takePhoto} className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white rounded-full p-1"><div className="w-12 h-12 bg-red-500 rounded-full border-4 border-white"></div></button>}</div>)}{photo && !isEditMode && <button onClick={() => {setPhoto(null); startCamera();}} className="w-full text-center text-blue-600 text-sm">Foto Ulang</button>}</>) : (<div className="bg-gray-100 p-4 rounded-lg text-center text-gray-500 text-sm italic border border-gray-200">Foto tidak diperlukan untuk absen tipe ini.</div>)}
        {!isEditMode && <div className="flex items-center gap-3 bg-blue-50 p-3 rounded-lg text-blue-800"><MapPin /><span className="text-sm">{location ? `${location.lat}, ${location.lng}` : 'Mencari Lokasi...'}</span></div>}
        <textarea className="w-full border p-2 rounded text-sm" placeholder="Catatan..." value={catatan} onChange={e => setCatatan(e.target.value)}></textarea>
      </div>
      <button onClick={handleSubmit} disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold mt-6 mb-10">{isSubmitting ? 'Menyimpan...' : (isEditMode ? 'Update Data' : 'Kirim Absen')}</button>
    </div>
  );
}

// --- ADMIN PANEL ---
function AdminPanel({ user, setView, masterData }) {
  const [activeTab, setActiveTab] = useState('user');
  const [loading, setLoading] = useState(false);
  const [userData, setUserData] = useState({ username: '', password: '', nama: '', divisi: 'Staff', role: 'karyawan', akses: [], noPayroll: '', sisaCuti: '', perusahaan: '', statusKaryawan: '' });
  const [masterInput, setMasterInput] = useState({ kategori: 'Menu', value: '', label: '' });
  const handleCheckboxChange = (val) => { setUserData(prev => { const current = prev.akses; return current.includes(val) ? { ...prev, akses: current.filter(i => i !== val) } : { ...prev, akses: [...current, val] }; }); };
  const handleAddUser = async (e) => { e.preventDefault(); setLoading(true); try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'tambah_user', ...userData }) }).then(r=>r.json()); if(res.result === 'success') { alert('User Ditambah!'); setUserData({username:'', password:'', nama:'', divisi:'Staff', role:'karyawan', akses:[], noPayroll:'', sisaCuti:'', perusahaan: '', statusKaryawan: ''}); } else alert(res.message); } catch(e) { alert('Error'); } finally { setLoading(false); } };
  const handleAddMaster = async (e) => { e.preventDefault(); setLoading(true); try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'tambah_master', ...masterInput }) }).then(r=>r.json()); if(res.result === 'success') { alert('Data Ditambah!'); setMasterInput({ kategori: 'Menu', value: '', label: '' }); } else alert(res.message); } catch(e) { alert('Error'); } finally { setLoading(false); } };
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4"><button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">Admin Panel</h2></div>
      <div className="flex gap-2 mb-6 bg-gray-200 p-1 rounded-lg"><button onClick={() => setActiveTab('user')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'user' ? 'bg-white shadow' : 'text-gray-500'}`}>Tambah User</button><button onClick={() => setActiveTab('master')} className={`flex-1 py-2 text-sm font-bold rounded-md ${activeTab === 'master' ? 'bg-white shadow' : 'text-gray-500'}`}>Tambah Master Data</button></div>
      {activeTab === 'user' ? (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <form onSubmit={handleAddUser} className="space-y-4">
            <input required type="text" className="w-full p-2 border rounded" value={userData.nama} onChange={e => setUserData({...userData, nama: e.target.value})} placeholder="Nama Karyawan" />
            <input required type="text" className="w-full p-2 border rounded" value={userData.username} onChange={e => setUserData({...userData, username: e.target.value})} placeholder="Username" />
            <input required type="text" className="w-full p-2 border rounded" value={userData.password} onChange={e => setUserData({...userData, password: e.target.value})} placeholder="Password" />
            <div className="grid grid-cols-2 gap-2"><input type="text" className="w-full p-2 border rounded" value={userData.perusahaan} onChange={e => setUserData({...userData, perusahaan: e.target.value})} placeholder="Perusahaan (PT)" /><input type="text" className="w-full p-2 border rounded" value={userData.statusKaryawan} onChange={e => setUserData({...userData, statusKaryawan: e.target.value})} placeholder="Status Karyawan" /></div>
            <div className="grid grid-cols-2 gap-2"><input type="text" className="w-full p-2 border rounded" value={userData.noPayroll} onChange={e => setUserData({...userData, noPayroll: e.target.value})} placeholder="No Payroll" /><input type="number" className="w-full p-2 border rounded" value={userData.sisaCuti} onChange={e => setUserData({...userData, sisaCuti: e.target.value})} placeholder="Sisa Cuti" /></div>
            <div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-gray-500">Divisi</label><select className="w-full p-2 border rounded" value={userData.divisi} onChange={e => setUserData({...userData, divisi: e.target.value})}>{masterData.divisions.map((d, i) => <option key={i} value={d.value}>{d.label}</option>)}{masterData.divisions.length === 0 && <option>Staff</option>}</select></div><div><label className="text-xs text-gray-500">Role</label><select className="w-full p-2 border rounded" value={userData.role} onChange={e => setUserData({...userData, role: e.target.value})}>{masterData.roles.map((r, i) => <option key={i} value={r.value}>{r.label}</option>)}</select></div></div>
            <div className="border p-3 rounded-lg bg-gray-50"><label className="text-xs font-bold text-gray-700 block mb-2">Hak Akses Menu:</label><div className="grid grid-cols-2 gap-2">{masterData.menus.map(item => (<label key={item.value} className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={userData.akses.includes(item.value)} onChange={() => handleCheckboxChange(item.value)} className="w-4 h-4 text-blue-600 rounded" />{item.label}</label>))}</div></div>
            <button type="submit" disabled={loading} className="w-full bg-slate-800 text-white py-3 rounded-lg font-bold">{loading ? 'Simpan...' : 'Simpan User'}</button>
          </form>
        </div>
      ) : (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200"><form onSubmit={handleAddMaster} className="space-y-4"><div><label className="text-xs text-gray-500">Kategori</label><select className="w-full p-2 border rounded" value={masterInput.kategori} onChange={e => setMasterInput({...masterInput, kategori: e.target.value})}><option value="Menu">Menu Absensi Baru</option><option value="Role">Role User Baru</option><option value="Divisi">Divisi Baru</option></select></div><input required type="text" className="w-full p-2 border rounded" value={masterInput.value} onChange={e => setMasterInput({...masterInput, value: e.target.value})} placeholder="Value" /><input required type="text" className="w-full p-2 border rounded" value={masterInput.label} onChange={e => setMasterInput({...masterInput, label: e.target.value})} placeholder="Label" /><button type="submit" disabled={loading} className="w-full bg-purple-700 text-white py-3 rounded-lg font-bold hover:bg-purple-800">{loading ? 'Simpan...' : 'Tambah Master Data'}</button></form></div>
      )}
    </div>
  );
}

// --- GANTI PASSWORD ---
function ChangePasswordScreen({ user, setView }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const handleChangePassword = async (e) => { e.preventDefault(); setLoading(true); try { const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'ganti_password', id: user.id, oldPassword, newPassword }) }).then(r => r.json()); if (res.result === 'success') { alert('Password berhasil diubah!'); setView('dashboard'); } else { alert(res.message); } } catch (err) { alert('Gagal menghubungi server.'); } finally { setLoading(false); } };
  return (
    <div className="p-4"><div className="flex items-center gap-2 mb-6"><button onClick={() => setView('dashboard')} className="p-2 hover:bg-gray-200 rounded-full">Back</button><h2 className="text-xl font-bold">Ganti Password</h2></div><div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200"><form onSubmit={handleChangePassword} className="space-y-4"><input required type="password" className="w-full p-2 border rounded" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="Password Lama" /><input required type="password" className="w-full p-2 border rounded" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Password Baru" /><button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-blue-700">{loading ? 'Memproses...' : 'Ubah Password'}</button></form></div></div>
  );
}
