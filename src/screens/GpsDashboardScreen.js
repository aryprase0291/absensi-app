import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  MapPin, RefreshCcw, Loader2, Search, Users, Radio, Clock, Navigation,
  Battery, ExternalLink, Route, FileSpreadsheet, SlidersHorizontal,
  AlertTriangle, Crosshair, CircleDot, Building2, Check, X
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';

// =====================================================================
// DASHBOARD GPS KARYAWAN (ADMIN)
//
// Empat tab, empat pertanyaan berbeda:
//   Peta        — "siapa di mana SEKARANG"
//   Jejak       — "ke mana saja orang ini hari itu"
//   Laporan     — "berapa jauh dan berapa lama, untuk seluruh tim"
//   Pengaturan  — "siapa saja yang dilacak"
//
// PETA DIMUAT SESUAI KEBUTUHAN
// Leaflet (~150 KB) diambil dari CDN hanya saat layar ini dibuka, bukan
// dari index.html. Karyawan biasa tidak pernah membuka layar ini, dan
// mereka membuka aplikasi ini dari HP dengan kuota terbatas — tidak ada
// alasan membuat 300 orang mengunduh peta yang tidak mereka pakai.
//
// KENAPA OPENSTREETMAP, BUKAN GOOGLE MAPS
// Tanpa API key, tanpa kartu kredit, tanpa risiko tagihan mendadak saat
// dashboard dibuka semalaman di layar monitor ruang HRD.
// =====================================================================

const LEAFLET_VERSI = '1.9.4';
const LEAFLET_CSS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSI}/leaflet.css`;
const LEAFLET_JS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSI}/leaflet.js`;

const PUSAT_BAWAAN = [-7.2575, 112.7521]; // Surabaya
const AUTO_REFRESH_MS = 30000;

const WARNA_STATUS = {
  ONLINE: { titik: '#10b981', kelas: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Online' },
  IDLE: { titik: '#f59e0b', kelas: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Idle' },
  OFFLINE: { titik: '#94a3b8', kelas: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Offline' }
};

let _leafletPromise = null;

// Memuat Leaflet sekali per sesi browser. Promise-nya disimpan supaya dua
// tab yang dibuka bergantian tidak menyuntikkan <script> dua kali.
function muatLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;

  _leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet gagal dimuat.')));
    script.onerror = () => {
      _leafletPromise = null;
      reject(new Error('Peta gagal dimuat. Periksa koneksi internet.'));
    };
    document.body.appendChild(script);
  });
  return _leafletPromise;
}

const inisial = (nama) => String(nama || '?')
  .split(' ').filter(Boolean).slice(0, 2).map((k) => k[0].toUpperCase()).join('');

const umurTeks = (detik) => {
  if (detik === null || detik === undefined) return 'belum pernah';
  if (detik < 60) return 'baru saja';
  if (detik < 3600) return `${Math.floor(detik / 60)} menit lalu`;
  if (detik < 86400) return `${Math.floor(detik / 3600)} jam lalu`;
  return `${Math.floor(detik / 86400)} hari lalu`;
};

const tglHariIni = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const linkPeta = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// Penanda karyawan: lingkaran berinisial, bukan pin polos. Dengan 30
// orang di satu peta, inisial adalah satu-satunya cara membedakan siapa
// yang mana tanpa mengklik satu per satu.
function ikonKaryawan(L, orang) {
  const warna = (WARNA_STATUS[orang.status] || WARNA_STATUS.OFFLINE).titik;
  const cincin = orang.statusArea === 'LUAR AREA' ? '#f43f5e' : '#ffffff';
  return L.divIcon({
    className: 'gps-marker',
    html: `<div style="
        width:34px;height:34px;border-radius:50%;
        background:${warna};color:#fff;
        display:flex;align-items:center;justify-content:center;
        font:700 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;
        border:3px solid ${cincin};
        box-shadow:0 2px 8px rgba(15,23,42,.35);
      ">${inisial(orang.nama)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18]
  });
}

function isiPopup(orang) {
  const baris = [];
  baris.push(`<div style="font:700 13px system-ui;margin-bottom:2px">${orang.nama}</div>`);
  baris.push(`<div style="font:500 11px system-ui;color:#64748b">${orang.divisi || '-'}</div>`);
  baris.push(`<div style="height:6px"></div>`);
  baris.push(`<div style="font:400 11px system-ui;color:#334155">🕒 ${orang.waktu}</div>`);
  if (orang.alamat) baris.push(`<div style="font:400 11px system-ui;color:#334155;max-width:210px">📍 ${orang.alamat}</div>`);
  if (orang.statusArea && orang.statusArea !== '-') {
    baris.push(`<div style="font:600 11px system-ui;color:${orang.statusArea === 'LUAR AREA' ? '#e11d48' : '#059669'}">${orang.statusArea}${orang.jarakArea !== null ? ` · ${orang.jarakArea} m dari ${orang.namaArea}` : ''}</div>`);
  }
  if (orang.akurasi !== null) baris.push(`<div style="font:400 11px system-ui;color:#64748b">Akurasi ±${orang.akurasi} m</div>`);
  if (orang.baterai !== null) baris.push(`<div style="font:400 11px system-ui;color:#64748b">Baterai ${orang.baterai}%</div>`);
  baris.push(`<div style="height:6px"></div>`);
  baris.push(`<a href="${linkPeta(orang.lat, orang.lng)}" target="_blank" rel="noopener noreferrer" style="font:600 11px system-ui;color:#2563eb">Buka di Google Maps ↗</a>`);
  return baris.join('');
}

function KartuAngka({ ikon: Ikon, label, nilai, warna }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${warna}`}>
        <Ikon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{label}</p>
        <p className="text-base font-bold leading-tight text-slate-800">{nilai}</p>
      </div>
    </div>
  );
}

function Lencana({ status }) {
  const w = WARNA_STATUS[status] || WARNA_STATUS.OFFLINE;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${w.kelas}`}>
      <CircleDot size={9} /> {w.label}
    </span>
  );
}

// ---------------------------------------------------------------------
// PETA POSISI TERKINI
//
// Instance Leaflet disimpan di ref, bukan di state: memasukkan objek peta
// ke state akan memicu render ulang setiap kali peta digeser, dan React
// akan mencoba membandingkan objek raksasa itu pada setiap perubahan.
// ---------------------------------------------------------------------
function PetaLive({ daftar, area, fokus, onPilih, tinggi = '58vh' }) {
  const wadahRef = useRef(null);
  const petaRef = useRef(null);
  const markerRef = useRef({});
  const pernahFitRef = useRef(false);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    let batal = false;
    muatLeaflet().then((L) => {
      if (batal || !wadahRef.current || petaRef.current) return;
      const peta = L.map(wadahRef.current, { zoomControl: true, attributionControl: true })
        .setView(PUSAT_BAWAAN, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(peta);
      petaRef.current = peta;
      // Peta yang dibuat saat wadahnya baru saja muncul kerap salah ukur
      // tingginya dan menampilkan petak abu-abu; satu invalidateSize
      // setelah layout selesai menyelesaikannya.
      setTimeout(() => { try { peta.invalidateSize(); } catch (e) { /* abaikan */ } }, 250);
    }).catch((e) => { if (!batal) setGalat(e.message); });

    return () => {
      batal = true;
      if (petaRef.current) {
        try { petaRef.current.remove(); } catch (e) { /* abaikan */ }
        petaRef.current = null;
        markerRef.current = {};
        pernahFitRef.current = false;
      }
    };
  }, []);

  // Lingkaran area kantor (geofence). Digambar sekali, lalu dibiarkan.
  useEffect(() => {
    const L = window.L;
    const peta = petaRef.current;
    if (!L || !peta || !area || !area.length) return;
    const lapisan = area.map((a) => L.circle([a.lat, a.lng], {
      radius: a.radius, color: '#2563eb', weight: 1,
      fillColor: '#3b82f6', fillOpacity: 0.07
    }).bindTooltip(`${a.nama} · radius ${a.radius} m`).addTo(peta));
    return () => lapisan.forEach((l) => { try { peta.removeLayer(l); } catch (e) { /* abaikan */ } });
  }, [area]);

  // Marker karyawan: diperbarui, bukan dibuat ulang. Membuat ulang seluruh
  // marker setiap 30 detik akan menutup popup yang sedang dibaca admin.
  useEffect(() => {
    const L = window.L;
    const peta = petaRef.current;
    if (!L || !peta) return;

    const terpakai = {};
    daftar.forEach((orang) => {
      terpakai[orang.userId] = true;
      const posisi = [orang.lat, orang.lng];
      const adaMarker = markerRef.current[orang.userId];
      if (adaMarker) {
        adaMarker.setLatLng(posisi);
        adaMarker.setIcon(ikonKaryawan(L, orang));
        adaMarker.setPopupContent(isiPopup(orang));
      } else {
        const m = L.marker(posisi, { icon: ikonKaryawan(L, orang), title: orang.nama })
          .bindPopup(isiPopup(orang))
          .addTo(peta);
        m.on('click', () => onPilih && onPilih(orang.userId));
        markerRef.current[orang.userId] = m;
      }
    });

    Object.keys(markerRef.current).forEach((id) => {
      if (terpakai[id]) return;
      try { peta.removeLayer(markerRef.current[id]); } catch (e) { /* abaikan */ }
      delete markerRef.current[id];
    });

    if (!pernahFitRef.current && daftar.length) {
      pernahFitRef.current = true;
      try {
        peta.fitBounds(L.latLngBounds(daftar.map((o) => [o.lat, o.lng])).pad(0.25), { maxZoom: 16 });
      } catch (e) { /* satu titik saja: biarkan pada zoom bawaan */ }
    }
  }, [daftar, onPilih]);

  // Klik nama di daftar samping -> peta terbang ke orangnya.
  useEffect(() => {
    const peta = petaRef.current;
    const m = fokus ? markerRef.current[fokus] : null;
    if (!peta || !m) return;
    peta.flyTo(m.getLatLng(), Math.max(peta.getZoom(), 16), { duration: 0.6 });
    m.openPopup();
  }, [fokus]);

  if (galat) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <AlertTriangle className="text-amber-500" size={22} />
        <p className="text-sm font-semibold text-slate-700">{galat}</p>
        <p className="text-xs text-slate-500">Data karyawan di bawah tetap dapat dibaca tanpa peta.</p>
      </div>
    );
  }

  return <div ref={wadahRef} style={{ height: tinggi, width: '100%' }} className="rounded-xl border border-slate-200 z-0" />;
}

// ---------------------------------------------------------------------
// PETA JEJAK HARIAN
// ---------------------------------------------------------------------
function PetaJejak({ titik, tinggi = '52vh' }) {
  const wadahRef = useRef(null);
  const petaRef = useRef(null);
  const lapisanRef = useRef(null);
  const [galat, setGalat] = useState('');

  useEffect(() => {
    let batal = false;
    muatLeaflet().then((L) => {
      if (batal || !wadahRef.current || petaRef.current) return;
      const peta = L.map(wadahRef.current).setView(PUSAT_BAWAAN, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap'
      }).addTo(peta);
      petaRef.current = peta;
      setTimeout(() => { try { peta.invalidateSize(); } catch (e) { /* abaikan */ } }, 250);
    }).catch((e) => { if (!batal) setGalat(e.message); });

    return () => {
      batal = true;
      if (petaRef.current) {
        try { petaRef.current.remove(); } catch (e) { /* abaikan */ }
        petaRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const L = window.L;
    const peta = petaRef.current;
    if (!L || !peta) return;

    if (lapisanRef.current) {
      try { peta.removeLayer(lapisanRef.current); } catch (e) { /* abaikan */ }
      lapisanRef.current = null;
    }
    if (!titik || !titik.length) return;

    const grup = L.layerGroup();
    const jalur = titik.map((t) => [t.lat, t.lng]);
    L.polyline(jalur, { color: '#2563eb', weight: 3, opacity: 0.75 }).addTo(grup);

    titik.forEach((t, i) => {
      const awal = i === 0;
      const akhir = i === titik.length - 1;
      if (awal || akhir) {
        L.marker([t.lat, t.lng], {
          icon: L.divIcon({
            className: 'gps-jejak',
            html: `<div style="width:26px;height:26px;border-radius:50%;background:${awal ? '#10b981' : '#e11d48'};color:#fff;display:flex;align-items:center;justify-content:center;font:700 10px system-ui;border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.3)">${awal ? 'A' : 'B'}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          })
        }).bindPopup(`<b>${awal ? 'Titik awal' : 'Titik akhir'}</b><br>${t.waktu}<br>${t.alamat || ''}`).addTo(grup);
      } else {
        L.circleMarker([t.lat, t.lng], {
          radius: 4, color: '#1d4ed8', weight: 1, fillColor: '#60a5fa', fillOpacity: 0.9
        }).bindPopup(`${t.waktu}${t.kecepatan ? ` · ${t.kecepatan} km/j` : ''}<br>${t.alamat || ''}`).addTo(grup);
      }
    });

    grup.addTo(peta);
    lapisanRef.current = grup;
    try { peta.fitBounds(L.latLngBounds(jalur).pad(0.2), { maxZoom: 17 }); } catch (e) { /* abaikan */ }
  }, [titik]);

  if (galat) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-600">
        {galat}
      </div>
    );
  }
  return <div ref={wadahRef} style={{ height: tinggi, width: '100%' }} className="rounded-xl border border-slate-200 z-0" />;
}

// =====================================================================
// LAYAR UTAMA
// =====================================================================
export default function GpsDashboardScreen({ user, setView, fetchApi }) {
  const [tab, setTab] = useState('peta');
  const [error, setError] = useState('');

  // --- Tab Peta ---
  const [live, setLive] = useState({ daftar: [], area: [], ringkasan: null });
  const [loadingLive, setLoadingLive] = useState(false);
  const [cari, setCari] = useState('');
  const [filterStatus, setFilterStatus] = useState('SEMUA');
  const [fokus, setFokus] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [terakhirMuat, setTerakhirMuat] = useState(null);

  // --- Tab Jejak ---
  const [jejakUser, setJejakUser] = useState('');
  const [jejakTgl, setJejakTgl] = useState(tglHariIni());
  const [jejak, setJejak] = useState(null);
  const [loadingJejak, setLoadingJejak] = useState(false);

  // --- Tab Laporan ---
  const [lapMulai, setLapMulai] = useState(tglHariIni());
  const [lapSelesai, setLapSelesai] = useState(tglHariIni());
  const [lapTarget, setLapTarget] = useState('SEMUA');
  const [laporan, setLaporan] = useState(null);
  const [loadingLaporan, setLoadingLaporan] = useState(false);

  // --- Tab Pengaturan ---
  const [konfig, setKonfig] = useState([]);
  const [loadingKonfig, setLoadingKonfig] = useState(false);
  const [menyimpanId, setMenyimpanId] = useState('');
  const [cariKonfig, setCariKonfig] = useState('');

  const panggil = useCallback(async (payload) => {
    const res = await fetchApi(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ ...payload, roleRequester: user.role })
    });
    return res.json();
  }, [fetchApi, user.role]);

  // ------------------------------------------------------------------
  // PEMUATAN DATA
  // ------------------------------------------------------------------
  const muatLive = useCallback(async (diam) => {
    if (!diam) setLoadingLive(true);
    try {
      const d = await panggil({ action: 'get_gps_live' });
      if (d.result === 'success') {
        setLive({ daftar: d.daftar || [], area: d.area || [], ringkasan: d.ringkasan || null });
        setTerakhirMuat(new Date());
        setError('');
      } else {
        setError(d.message || 'Gagal memuat posisi karyawan.');
      }
    } catch (e) {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setLoadingLive(false);
    }
  }, [panggil]);

  useEffect(() => { muatLive(); }, [muatLive]);

  // Penyegaran otomatis hanya saat tab Peta terbuka DAN halaman terlihat.
  // Dashboard yang ditinggal terbuka semalaman di monitor ruang HRD akan
  // menembak 2.880 request per hari kalau syarat ini dilupakan.
  useEffect(() => {
    if (!autoRefresh || tab !== 'peta') return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      muatLive(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [autoRefresh, tab, muatLive]);

  const muatJejak = useCallback(async () => {
    if (!jejakUser) { setError('Pilih karyawan terlebih dahulu.'); return; }
    setLoadingJejak(true);
    setError('');
    try {
      const d = await panggil({ action: 'get_gps_trail', targetUserId: jejakUser, tanggal: jejakTgl });
      if (d.result === 'success') setJejak(d);
      else setError(d.message || 'Gagal memuat jejak.');
    } catch (e) {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setLoadingJejak(false);
    }
  }, [panggil, jejakUser, jejakTgl]);

  const buatLaporan = useCallback(async () => {
    setLoadingLaporan(true);
    setError('');
    try {
      const d = await panggil({
        action: 'buat_laporan_gps',
        tglMulai: lapMulai, tglSelesai: lapSelesai, targetUserId: lapTarget
      });
      if (d.result === 'success') setLaporan(d);
      else setError(d.message || 'Gagal membuat laporan.');
    } catch (e) {
      setError('Tidak bisa menghubungi server. Laporan membaca banyak baris jejak, jadi butuh waktu lebih lama.');
    } finally {
      setLoadingLaporan(false);
    }
  }, [panggil, lapMulai, lapSelesai, lapTarget]);

  const muatKonfig = useCallback(async () => {
    setLoadingKonfig(true);
    setError('');
    try {
      const d = await panggil({ action: 'get_gps_tracking_admin' });
      if (d.result === 'success') setKonfig(d.daftar || []);
      else setError(d.message || 'Gagal memuat pengaturan.');
    } catch (e) {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setLoadingKonfig(false);
    }
  }, [panggil]);

  useEffect(() => { if (tab === 'pengaturan' && !konfig.length) muatKonfig(); }, [tab, konfig.length, muatKonfig]);

  const simpanKonfig = useCallback(async (targetUserId, aktif, intervalDetik) => {
    setMenyimpanId(targetUserId);
    try {
      const d = await panggil({
        action: 'save_gps_tracking_config',
        targetUserId, aktif, intervalDetik
      });
      if (d.result === 'success') {
        setKonfig((lama) => lama.map((k) => (
          targetUserId === 'SEMUA' || k.userId === targetUserId
            ? { ...k, aktif, intervalDetik }
            : k
        )));
      } else {
        setError(d.message || 'Gagal menyimpan pengaturan.');
      }
    } catch (e) {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setMenyimpanId('');
    }
  }, [panggil]);

  // ------------------------------------------------------------------
  // TURUNAN
  // ------------------------------------------------------------------
  const daftarTersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return live.daftar.filter((o) => {
      if (filterStatus === 'LUAR_AREA') { if (o.statusArea !== 'LUAR AREA') return false; }
      else if (filterStatus !== 'SEMUA' && o.status !== filterStatus) return false;
      if (!q) return true;
      return String(o.nama).toLowerCase().includes(q) ||
        String(o.divisi).toLowerCase().includes(q) ||
        String(o.userId).toLowerCase().includes(q);
    });
  }, [live.daftar, cari, filterStatus]);

  const konfigTersaring = useMemo(() => {
    const q = cariKonfig.trim().toLowerCase();
    if (!q) return konfig;
    return konfig.filter((k) => String(k.nama).toLowerCase().includes(q) || String(k.divisi).toLowerCase().includes(q));
  }, [konfig, cariKonfig]);

  const opsiKaryawan = useMemo(() => {
    const dariLive = live.daftar.map((o) => ({ id: o.userId, nama: o.nama }));
    const dariKonfig = konfig.map((k) => ({ id: k.userId, nama: k.nama }));
    const gabung = {};
    dariKonfig.concat(dariLive).forEach((o) => { gabung[o.id] = o.nama; });
    return Object.keys(gabung).map((id) => ({ id, nama: gabung[id] }))
      .sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
  }, [live.daftar, konfig]);

  const r = live.ringkasan || { total: 0, online: 0, idle: 0, offline: 0, luarArea: 0 };
  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const tabCls = (id) => `flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

  return (
    <div className="pb-24">
      {/* Kepala layar tidak dipasang di sini: App.js sudah memasang bar
          navigasi global untuk semua view selain dashboard/form. */}

      {/* RINGKASAN */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KartuAngka ikon={Users} label="Karyawan" nilai={r.total} warna="bg-slate-100 text-slate-600" />
        <KartuAngka ikon={Radio} label="Online" nilai={r.online} warna="bg-emerald-100 text-emerald-600" />
        <KartuAngka ikon={Clock} label="Idle" nilai={r.idle} warna="bg-amber-100 text-amber-600" />
        <KartuAngka ikon={Battery} label="Offline" nilai={r.offline} warna="bg-slate-100 text-slate-500" />
        <KartuAngka ikon={Building2} label="Luar Area" nilai={r.luarArea} warna="bg-rose-100 text-rose-600" />
      </div>

      {/* TAB */}
      <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1">
        <button onClick={() => setTab('peta')} className={tabCls('peta')}>Peta</button>
        <button onClick={() => setTab('jejak')} className={tabCls('jejak')}>Jejak</button>
        <button onClick={() => setTab('laporan')} className={tabCls('laporan')}>Laporan</button>
        <button onClick={() => setTab('pengaturan')} className={tabCls('pengaturan')}>Pengaturan</button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="shrink-0 text-rose-400 hover:text-rose-600"><X size={14} /></button>
        </div>
      )}

      {/* ================= TAB PETA ================= */}
      {tab === 'peta' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari nama / divisi"
                className={`${inputCls} pl-8`}
              />
            </div>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="SEMUA">Semua status</option>
              <option value="ONLINE">Online</option>
              <option value="IDLE">Idle</option>
              <option value="OFFLINE">Offline</option>
              <option value="LUAR_AREA">Di luar area</option>
            </select>
            <button
              onClick={() => muatLive()}
              disabled={loadingLive}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingLive ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
              Segarkan
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-medium text-slate-600">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-blue-600" />
              Auto 30 dtk
            </label>
          </div>

          <PetaLive daftar={daftarTersaring} area={live.area} fokus={fokus} onPilih={setFokus} />

          <div className="flex items-center justify-between px-0.5">
            <p className="text-[11px] text-slate-500">
              {daftarTersaring.length} dari {live.daftar.length} karyawan
              {terakhirMuat ? ` · diperbarui ${terakhirMuat.toLocaleTimeString('id-ID')}` : ''}
            </p>
            <p className="text-[11px] text-slate-400">Cincin merah = di luar area kantor</p>
          </div>

          {/* DAFTAR KARYAWAN */}
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {loadingLive && !live.daftar.length && (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" /> Memuat posisi…
              </div>
            )}
            {!loadingLive && !daftarTersaring.length && (
              <div className="p-6 text-center text-sm text-slate-500">
                Belum ada posisi tercatat. Posisi mulai muncul setelah karyawan membuka aplikasi
                dan mengizinkan akses lokasi.
              </div>
            )}
            {daftarTersaring.map((o) => (
              // Sengaja <div role="button">, bukan <button>: di dalamnya ada
              // tautan Google Maps, dan menyarangkan <a> di dalam <button>
              // adalah HTML yang tidak sah — browser boleh "memperbaikinya"
              // dengan memindahkan elemen keluar, dan barisnya jadi berantakan.
              <div
                key={o.userId}
                role="button"
                tabIndex={0}
                onClick={() => setFokus(o.userId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFokus(o.userId); } }}
                className={`flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${fokus === o.userId ? 'bg-blue-50/60' : ''}`}
              >
                <div
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: (WARNA_STATUS[o.status] || WARNA_STATUS.OFFLINE).titik }}
                >
                  {inisial(o.nama)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-slate-800">{o.nama}</span>
                    <Lencana status={o.status} />
                    {o.statusArea === 'LUAR AREA' && (
                      <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                        Luar area{o.jarakArea !== null ? ` · ${o.jarakArea} m` : ''}
                      </span>
                    )}
                    {!o.pelacakanAktif && (
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        Pelacakan mati
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-slate-500">{o.divisi} · {umurTeks(o.umurDetik)} · {o.waktu}</p>
                  {o.alamat && <p className="truncate text-[11px] text-slate-600">{o.alamat}</p>}
                  <p className="text-[10px] text-slate-400">
                    {o.akurasi !== null ? `±${o.akurasi} m` : 'akurasi -'}
                    {o.baterai !== null ? ` · baterai ${o.baterai}%` : ''}
                    {o.jarakHariIniKm ? ` · ${o.jarakHariIniKm} km hari ini` : ''}
                    {o.titikHariIni ? ` · ${o.titikHariIni} titik` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    onClick={(e) => { e.stopPropagation(); setJejakUser(o.userId); setJejakTgl(tglHariIni()); setTab('jejak'); }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    <Route size={11} /> Jejak
                  </span>
                  <a
                    href={linkPeta(o.lat, o.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    <ExternalLink size={11} /> Maps
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB JEJAK ================= */}
      {tab === 'jejak' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Karyawan</label>
              <select value={jejakUser} onChange={(e) => setJejakUser(e.target.value)} className={inputCls}>
                <option value="">— pilih karyawan —</option>
                {opsiKaryawan.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Tanggal</label>
              <input type="date" value={jejakTgl} max={tglHariIni()} onChange={(e) => setJejakTgl(e.target.value)} className={inputCls} />
            </div>
            <button
              onClick={muatJejak}
              disabled={loadingJejak}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loadingJejak ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
              Tampilkan
            </button>
          </div>

          {jejak && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KartuAngka ikon={Crosshair} label="Titik" nilai={jejak.jumlah} warna="bg-blue-100 text-blue-600" />
              <KartuAngka ikon={Route} label="Jarak" nilai={`${jejak.jarakKm} km`} warna="bg-indigo-100 text-indigo-600" />
              <KartuAngka ikon={Clock} label="Mulai" nilai={jejak.jamPertama} warna="bg-emerald-100 text-emerald-600" />
              <KartuAngka ikon={Clock} label="Terakhir" nilai={jejak.jamTerakhir} warna="bg-rose-100 text-rose-600" />
            </div>
          )}

          {jejak && jejak.titik && jejak.titik.length > 0 && <PetaJejak titik={jejak.titik} />}

          {jejak && (!jejak.titik || !jejak.titik.length) && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Tidak ada jejak untuk {jejak.nama} pada tanggal tersebut.
            </div>
          )}

          {jejak && jejak.titik && jejak.titik.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Rincian titik — {jejak.nama}
              </div>
              <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {jejak.titik.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2">
                    <span className="mt-0.5 w-14 shrink-0 text-[11px] font-bold text-slate-700">{t.waktu}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-slate-600">{t.alamat || `${t.lat}, ${t.lng}`}</p>
                      <p className="text-[10px] text-slate-400">
                        {t.sumber}
                        {t.jarak !== null ? ` · +${t.jarak} m` : ''}
                        {t.kecepatan ? ` · ${t.kecepatan} km/j` : ''}
                        {t.statusArea && t.statusArea !== '-' ? ` · ${t.statusArea}` : ''}
                      </p>
                    </div>
                    <a href={linkPeta(t.lat, t.lng)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-blue-600">
                      <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB LAPORAN ================= */}
      {tab === 'laporan' && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] text-slate-500">
              Laporan ditulis ke sheet <b>LaporanGps</b> di spreadsheet absensi — bisa langsung
              difilter, di-pivot, atau dibagikan HRD tanpa membuka aplikasi ini.
              Isi sheet ditimpa setiap kali laporan dibuat.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600">Dari</label>
                <input type="date" value={lapMulai} max={tglHariIni()} onChange={(e) => setLapMulai(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-600">Sampai</label>
                <input type="date" value={lapSelesai} max={tglHariIni()} onChange={(e) => setLapSelesai(e.target.value)} className={inputCls} />
              </div>
              <div className="min-w-[160px] flex-1">
                <label className="mb-1 block text-[11px] font-semibold text-slate-600">Karyawan</label>
                <select value={lapTarget} onChange={(e) => setLapTarget(e.target.value)} className={inputCls}>
                  <option value="SEMUA">Semua karyawan</option>
                  {opsiKaryawan.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
                </select>
              </div>
              <button
                onClick={buatLaporan}
                disabled={loadingLaporan}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {loadingLaporan ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                Buat Laporan
              </button>
            </div>
          </div>

          {laporan && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-[12px] font-medium text-emerald-800">{laporan.message}</p>
                {laporan.sheetUrl && (
                  <a
                    href={laporan.sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100"
                  >
                    <ExternalLink size={12} /> Buka Google Sheet
                  </a>
                )}
              </div>

              {laporan.laporan && laporan.laporan.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-[760px] w-full text-[11px]">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-2.5 py-2 font-semibold">Tanggal</th>
                        <th className="px-2.5 py-2 font-semibold">Nama</th>
                        <th className="px-2.5 py-2 font-semibold">Divisi</th>
                        <th className="px-2.5 py-2 font-semibold text-right">Titik</th>
                        <th className="px-2.5 py-2 font-semibold">Mulai</th>
                        <th className="px-2.5 py-2 font-semibold">Akhir</th>
                        <th className="px-2.5 py-2 font-semibold">Durasi</th>
                        <th className="px-2.5 py-2 font-semibold text-right">Jarak (km)</th>
                        <th className="px-2.5 py-2 font-semibold text-right">Menit luar area</th>
                        <th className="px-2.5 py-2 font-semibold">Lokasi terakhir</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {laporan.laporan.map((b, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-2.5 py-1.5">{b.tanggal}</td>
                          <td className="px-2.5 py-1.5 font-medium text-slate-700">{b.nama}</td>
                          <td className="px-2.5 py-1.5 text-slate-500">{b.divisi}</td>
                          <td className="px-2.5 py-1.5 text-right">{b.titik}</td>
                          <td className="px-2.5 py-1.5">{b.jamPertama}</td>
                          <td className="px-2.5 py-1.5">{b.jamTerakhir}</td>
                          <td className="px-2.5 py-1.5">{b.durasi}</td>
                          <td className="px-2.5 py-1.5 text-right font-semibold">{b.km}</td>
                          <td className={`px-2.5 py-1.5 text-right ${b.menitLuar > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{b.menitLuar}</td>
                          <td className="max-w-[220px] truncate px-2.5 py-1.5 text-slate-500">{b.alamat || b.koordinat}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {laporan.jumlah > laporan.laporan.length && (
                    <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                      Menampilkan {laporan.laporan.length} dari {laporan.jumlah} baris. Seluruh baris ada di sheet LaporanGps.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================= TAB PENGATURAN ================= */}
      {tab === 'pengaturan' && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[11px] leading-relaxed text-amber-800">
              <b>Yang perlu diketahui sebelum mengubah:</b> pelacakan hanya berjalan selama karyawan
              membuka aplikasi ini dan mengizinkan akses lokasi — browser tidak dapat melacak saat
              aplikasi ditutup. Karyawan baru otomatis <b>aktif</b>; matikan di sini untuk mengecualikan.
              Indikator "lokasi dibagikan" di layar karyawan sudah dihapus atas permintaan, jadi
              pemberitahuan ke karyawan kini menjadi tanggung jawab perusahaan — sampaikan lewat
              Info HRD atau surat kebijakan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={cariKonfig} onChange={(e) => setCariKonfig(e.target.value)} placeholder="Cari nama / divisi" className={`${inputCls} pl-8`} />
            </div>
            <button onClick={muatKonfig} disabled={loadingKonfig} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {loadingKonfig ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Muat ulang
            </button>
            <button
              onClick={() => { if (window.confirm('Aktifkan pelacakan untuk SELURUH karyawan?')) simpanKonfig('SEMUA', true, 300); }}
              disabled={menyimpanId === 'SEMUA'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check size={14} /> Aktifkan semua
            </button>
            <button
              onClick={() => { if (window.confirm('Matikan pelacakan untuk SELURUH karyawan?')) simpanKonfig('SEMUA', false, 300); }}
              disabled={menyimpanId === 'SEMUA'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <X size={14} /> Matikan semua
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {loadingKonfig && !konfig.length && (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" /> Memuat daftar karyawan…
              </div>
            )}
            {konfigTersaring.map((k) => (
              <div key={k.userId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-800">{k.nama}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {k.divisi} · {k.lokasi} · terakhir terlihat {k.terakhirTerlihat}
                  </p>
                </div>

                <select
                  value={k.intervalDetik}
                  disabled={!k.aktif || menyimpanId === k.userId}
                  onChange={(e) => simpanKonfig(k.userId, true, Number(e.target.value))}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-40"
                >
                  <option value={120}>2 menit</option>
                  <option value={300}>5 menit</option>
                  <option value={600}>10 menit</option>
                  <option value={1800}>30 menit</option>
                </select>

                <button
                  onClick={() => simpanKonfig(k.userId, !k.aktif, k.intervalDetik)}
                  disabled={menyimpanId === k.userId}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${k.aktif ? 'bg-emerald-500' : 'bg-slate-300'} disabled:opacity-50`}
                  aria-label={`Pelacakan ${k.nama}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${k.aktif ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
            {!loadingKonfig && !konfigTersaring.length && (
              <div className="p-6 text-center text-sm text-slate-500">Tidak ada karyawan yang cocok.</div>
            )}
          </div>

          <p className="px-1 text-[10px] text-slate-400">
            <SlidersHorizontal size={10} className="mr-1 inline" />
            Interval lebih rapat berarti jejak lebih detail, tetapi juga lebih banyak baris di sheet
            dan baterai HP lebih cepat habis. 5 menit adalah kompromi yang dipakai secara bawaan.
          </p>
        </div>
      )}

      <p className="mt-6 px-1 text-center text-[10px] leading-relaxed text-slate-400">
        <MapPin size={10} className="mr-1 inline" />
        Peta: OpenStreetMap. Posisi terekam selama aplikasi karyawan terbuka dan izin lokasi aktif.
      </p>
    </div>
  );
}
