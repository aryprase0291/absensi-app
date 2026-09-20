// =====================================================================
// DASHBOARD ABSEN ONLINE — KERANI PABRIK
//
// Menjawab tiga pertanyaan, dalam urutan itu:
//   1. siapa kerani pabrik yang mengabsen lewat aplikasi hari-hari ini;
//   2. berapa persen yang Hadir, Standby, dan yang TIDAK absen sama
//      sekali;
//   3. berapa persen hari kerja yang absennya LENGKAP (produktifitas).
//
// DUA PERMINTAAN, BUKAN SATU.
//   `get_user_list_admin` membawa JABATAN (kolom Role di sheet Users);
//   `get_history` membawa baris absennya tapi hanya punya `divisi`.
//   Tidak ada satu action pun yang membawa keduanya, jadi keduanya
//   diambil lalu dijodohkan lewat userId di layar ini. Selama backend
//   belum menambahkan jabatan ke get_history, ini memang harga yang
//   dibayar — dan keduanya action baca yang aman diulang.
//
// SELURUH HITUNGAN ADA DI rekapKerani.js.
//   Berkas ini hanya mengambil, menyaring tampilan, dan menggambar.
//   Angka yang dipakai menilai orang harus bisa diuji tanpa merender.
//
// WARNA.
//   Empat keadaan memakai biru / kuning / ungu / merah — BUKAN
//   merah-hijau. Pasangan merah-hijau untuk hadir/tidak-hadir adalah
//   pilihan paling naluriah dan justru paling sering lolos tanpa
//   diperiksa: pada mata deuteranopia jaraknya ΔE 4,1, praktis warna
//   yang sama. Empat warna di bawah dijalankan lewat validator palet
//   (mode terang, latar putih, seluruh pasangan): jarak terburuk ΔE 13,0
//   pada deutan dan 16,3 pada penglihatan normal — lolos seluruh batas.
//   Kuning berada di bawah kontras 3:1 terhadap latar putih, jadi
//   angkanya SELALU tertulis dan tabelnya selalu ada; warna tidak pernah
//   menjadi satu-satunya penanda.
// =====================================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Users, CalendarDays, Gauge, CheckCircle2, Clock, FileText, XCircle,
  Download, RefreshCcw, Loader2, Search, AlertTriangle, Info
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';
import BackButton from '../components/BackButton';
import { useHariLibur } from '../utils/hariLibur';
import {
  susunRekapKerani, saringKerani, daftarDivisi, STATUS
} from './rekapKerani';

const WARNA = {
  hadir:   '#2a78d6',
  standby: '#eda100',
  izin:    '#4a3aa7',
  tidak:   '#e34948'
};

// Legenda, urutan tumpukan, dan urutan kolom tabel — satu daftar, supaya
// ketiganya tidak pernah berbeda urutan.
const KEADAAN = [
  { kunci: 'hadir',   status: STATUS.HADIR,   label: 'Hadir',            ikon: CheckCircle2, warna: WARNA.hadir },
  { kunci: 'standby', status: STATUS.STANDBY, label: 'Standby',          ikon: Clock,        warna: WARNA.standby },
  { kunci: 'izin',    status: STATUS.IZIN,    label: 'Izin / Cuti / Dinas', ikon: FileText,  warna: WARNA.izin },
  { kunci: 'tidak',   status: STATUS.KOSONG,  label: 'Tidak absen',      ikon: XCircle,      warna: WARNA.tidak }
];

const PETA_RINGKAS = { hadir: 'hadir', standby: 'standby', izin: 'izin', tidak: 'tidakAbsen' };
const PETA_PERSEN = { hadir: 'persenHadir', standby: 'persenStandby', izin: 'persenIzin', tidak: 'persenTidakAbsen' };

const HARI_DEFAULT = 30;

function ymd(d) {
  const t = new Date(d);
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function pct(n) {
  const v = Number(n) || 0;
  return (v >= 99.95 || v === 0 ? v.toFixed(0) : v.toFixed(1)) + '%';
}

function tglPendek(y) {
  const b = String(y || '').split('-');
  if (b.length !== 3) return String(y || '');
  const bl = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return Number(b[2]) + ' ' + (bl[Number(b[1]) - 1] || b[1]);
}

// --- Kartu angka ------------------------------------------------------
function Kartu({ ikon: Ikon, label, nilai, catatan, warna }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Ikon className="w-4 h-4" strokeWidth={1.75} style={{ color: warna || '#898781' }} />
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-[26px] leading-none font-semibold text-slate-900">{nilai}</p>
      {catatan ? <p className="text-[11px] text-slate-400 mt-1.5 leading-tight">{catatan}</p> : null}
    </div>
  );
}

export default function DashboardKerani({ user, setView, fetchApi: customFetchApi }) {
  const [dari, setDari] = useState(() => ymd(new Date(Date.now() - HARI_DEFAULT * 86400000)));
  const [sampai, setSampai] = useState(() => ymd(new Date()));
  const [kataKunci, setKataKunci] = useState('KERANI');
  const [divisiDipilih, setDivisiDipilih] = useState([]);
  const [cari, setCari] = useState('');
  const [hitungMinggu, setHitungMinggu] = useState(false);
  const [hitungLibur, setHitungLibur] = useState(false);

  const [pegawai, setPegawai] = useState([]);
  const [history, setHistory] = useState([]);
  const [rentangDipakai, setRentangDipakai] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState('');
  const [hover, setHover] = useState(null);

  const { libur } = useHariLibur();
  // Divisi hanya disetel otomatis SATU KALI, saat daftar pegawai pertama
  // datang. Tanpa penjaga ini, setiap muat ulang akan mengembalikan
  // pilihan divisi admin ke bawaan — diam-diam mengubah angka yang
  // sedang dibacanya.
  const divisiTersetel = useRef(false);

  const panggil = useCallback(async (payload) => {
    if (typeof customFetchApi === 'function') {
      const res = await customFetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      return await res.json();
    }
    let token = '';
    try {
      const simpan = sessionStorage.getItem('app_user');
      if (simpan) token = (JSON.parse(simpan) || {}).token || '';
    } catch (e) { /* biarkan kosong; backend yang menolak */ }
    const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ ...payload, token }) });
    return await res.json();
  }, [customFetchApi]);

  const muat = useCallback(async () => {
    if (!user) return;
    setMemuat(true);
    setGalat('');
    try {
      // Dua permintaan berbarengan. Keduanya hanya membaca, dan yang satu
      // tidak butuh hasil yang lain — menunggu berurutan hanya membuat
      // layar ini dua kali lebih lama terbuka.
      const [jwbPegawai, jwbHistory] = await Promise.all([
        panggil({ action: 'get_user_list_admin', roleRequester: user.role }),
        panggil({
          action: 'get_history',
          userId: user.id,
          canViewAll: true,
          requestorLokasi: user.lokasi || 'All',
          targetUserIds: [],
          filterStart: dari,
          filterEnd: sampai
        })
      ]);

      if (jwbPegawai && jwbPegawai.result === 'success') {
        setPegawai(jwbPegawai.list || []);
      } else {
        setGalat((jwbPegawai && jwbPegawai.message) || 'Gagal mengambil daftar pegawai.');
      }

      if (jwbHistory && jwbHistory.result === 'success') {
        setHistory(jwbHistory.history || []);
        setRentangDipakai(jwbHistory.period || null);
      } else {
        setGalat((jwbHistory && jwbHistory.message) || 'Gagal mengambil riwayat absen.');
      }
    } catch (e) {
      setGalat('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      setMemuat(false);
    }
  }, [user, dari, sampai, panggil]);

  useEffect(() => { muat(); /* sekali saat layar dibuka */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kerani sebelum saringan divisi — dipakai untuk menyusun daftar divisi
  // yang ditawarkan. Kalau daftarnya disusun SESUDAH saringan divisi,
  // memilih satu divisi akan menghapus pilihan lainnya dari layar.
  const keraniSemua = useMemo(
    () => saringKerani(pegawai, kataKunci, []),
    [pegawai, kataKunci]
  );
  const divisiTersedia = useMemo(() => daftarDivisi(keraniSemua), [keraniSemua]);

  useEffect(() => {
    if (divisiTersetel.current || !divisiTersedia.length) return;
    divisiTersetel.current = true;
    // Bawaan: divisi yang namanya menyebut PABRIK. Kalau tidak ada satu
    // pun, seluruh divisi dipakai — layar kosong dengan filter yang
    // "benar" lebih membingungkan daripada angka yang terlalu luas.
    const pabrik = divisiTersedia.filter((d) => d.toUpperCase().indexOf('PABRIK') !== -1);
    setDivisiDipilih(pabrik.length ? pabrik : []);
  }, [divisiTersedia]);

  const kerani = useMemo(
    () => saringKerani(pegawai, kataKunci, divisiDipilih),
    [pegawai, kataKunci, divisiDipilih]
  );

  const rekap = useMemo(() => susunRekapKerani({
    kerani, history, dari, sampai, libur, hitungMinggu, hitungLibur
  }), [kerani, history, dari, sampai, libur, hitungMinggu, hitungLibur]);

  const barisTampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return rekap.perOrang;
    return rekap.perOrang.filter((b) =>
      b.nama.toLowerCase().includes(q) || b.divisi.toLowerCase().includes(q));
  }, [rekap, cari]);

  const R = rekap.ringkas;
  const puncakHarian = useMemo(
    () => Math.max(1, ...rekap.perHari.map((h) => h.hadir + h.standby + h.izin + h.tidakAbsen)),
    [rekap]
  );

  const togglDivisi = (d) => {
    setDivisiDipilih((lama) => lama.includes(d) ? lama.filter((x) => x !== d) : lama.concat([d]));
  };

  const eksporExcel = () => {
    const wb = XLSX.utils.book_new();

    const ringkas = [
      ['Dashboard Absen Online Kerani Pabrik'],
      ['Periode', dari + ' s/d ' + sampai],
      ['Kata kunci jabatan', kataKunci],
      ['Divisi', divisiDipilih.length ? divisiDipilih.join(', ') : 'Semua divisi'],
      ['Minggu dihitung hari kerja', hitungMinggu ? 'Ya' : 'Tidak'],
      ['Libur nasional dihitung hari kerja', hitungLibur ? 'Ya' : 'Tidak'],
      [],
      ['Jumlah kerani', R.jumlahOrang],
      ['Hari kerja', R.hariKerja],
      ['Total hari-orang', R.totalHariOrang],
      ['Hari-orang efektif (dikurangi izin)', R.hariEfektif],
      [],
      ['Keadaan', 'Hari-orang', 'Persentase'],
      ['Hadir', R.hadir, pct(R.persenHadir)],
      ['Standby', R.standby, pct(R.persenStandby)],
      ['Izin / Cuti / Dinas', R.izin, pct(R.persenIzin)],
      ['Tidak absen sama sekali', R.tidakAbsen, pct(R.persenTidakAbsen)],
      [],
      ['Absen lengkap (Hadir + Pulang)', R.lengkap, pct(R.persenProduktif)],
      ['Produktifitas = absen lengkap / hari-orang efektif']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ringkas), 'Ringkas');

    const perOrang = [['No', 'Nama', 'Divisi', 'Jabatan', 'Hari kerja', 'Hadir', 'Standby',
      'Izin', 'Tidak absen', 'Absen lengkap', 'Hari efektif', 'Produktifitas %']];
    rekap.perOrang.forEach((b, i) => {
      perOrang.push([i + 1, b.nama, b.divisi, b.jabatan, rekap.tanggal.length, b.hadir,
        b.standby, b.izin, b.tidakAbsen, b.lengkap, b.hariEfektif,
        Number(b.persenProduktif.toFixed(1))]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perOrang), 'Per Kerani');

    const kode = { HADIR: 'H', STANDBY: 'STB', IZIN: 'I', KOSONG: '-' };
    const matriks = [['Nama', 'Divisi'].concat(rekap.tanggal.map(tglPendek))];
    rekap.perOrang.forEach((b) => {
      matriks.push([b.nama, b.divisi].concat(rekap.tanggal.map((t) => kode[b.sel[t]] || '-')));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriks), 'Matriks Harian');

    XLSX.writeFile(wb, 'dashboard-kerani-' + dari + '_' + sampai + '.xlsx');
  };

  const adaKerani = R.jumlahOrang > 0;

  return (
    <div className="pb-8">
      {/* KEPALA */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[18px] font-semibold text-slate-900 leading-tight">
            Absen Online Kerani Pabrik
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {rentangDipakai
              ? 'Data ' + tglPendek(rentangDipakai.mulai) + ' – ' + tglPendek(rentangDipakai.selesai)
              : 'Rekap kehadiran dari aplikasi, bukan mesin fingerprint'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={muat} disabled={memuat}
            className="p-2.5 bg-white text-slate-700 hover:text-blue-600 rounded-xl border border-slate-200 hover:border-blue-200 hover:bg-blue-50/50 active:scale-95 transition-all shadow-sm disabled:opacity-50">
            {memuat ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" strokeWidth={1.75} />}
          </button>
          <BackButton onClick={() => setView('admin')} />
        </div>
      </div>

      {/* FILTER */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Dari tanggal</label>
            <input type="date" value={dari} onChange={(e) => setDari(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Sampai tanggal</label>
            <input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Kata kunci jabatan</label>
            <input value={kataKunci} onChange={(e) => setKataKunci(e.target.value)}
              placeholder="KERANI"
              className="w-[130px] px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 outline-none focus:border-slate-400" />
          </div>
          <div className="flex-1 min-w-[170px]">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Cari nama / divisi</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={1.75} />
              <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Ketik untuk menyaring tabel"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 outline-none focus:border-slate-400" />
            </div>
          </div>
          <button onClick={muat} disabled={memuat}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
            Terapkan
          </button>
          <button onClick={eksporExcel} disabled={memuat || !adaKerani}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            <Download className="w-3.5 h-3.5" strokeWidth={1.75} /> Export Excel
          </button>
        </div>

        {/* Divisi + aturan hari kerja */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500 mr-1">Divisi:</span>
          {divisiTersedia.length === 0 && (
            <span className="text-[12px] text-slate-400">Belum ada divisi — muat data dulu.</span>
          )}
          {divisiTersedia.map((d) => {
            const aktif = divisiDipilih.includes(d);
            return (
              <button key={d} onClick={() => togglDivisi(d)}
                className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors
                  ${aktif ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {d}
              </button>
            );
          })}
          {divisiDipilih.length > 0 && (
            <button onClick={() => setDivisiDipilih([])}
              className="px-2.5 py-1 rounded-full text-[12px] text-slate-500 border border-dashed border-slate-300 hover:bg-slate-50">
              Semua divisi
            </button>
          )}

          <span className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={hitungMinggu} onChange={(e) => setHitungMinggu(e.target.checked)}
                className="rounded border-slate-300" />
              Minggu ikut hari kerja
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={hitungLibur} onChange={(e) => setHitungLibur(e.target.checked)}
                className="rounded border-slate-300" />
              Libur nasional ikut
            </label>
          </span>
        </div>
      </div>

      {galat && (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl p-3.5 mb-4">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-[13px] text-rose-800">{galat}</p>
        </div>
      )}

      {history.length >= 5000 && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-4">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-[13px] text-amber-900">
            Server memotong riwayat di 5.000 baris. Rentang ini kemungkinan belum utuh —
            persempit tanggalnya supaya angkanya bisa dipercaya.
          </p>
        </div>
      )}

      {/* KARTU */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kartu ikon={Users} label="Kerani terpantau" nilai={R.jumlahOrang}
          catatan={divisiDipilih.length ? divisiDipilih.join(', ') : 'Semua divisi'} />
        <Kartu ikon={CalendarDays} label="Hari kerja" nilai={R.hariKerja}
          catatan={R.totalHariOrang + ' hari-orang' + (hitungMinggu ? '' : ' · Minggu & libur dikecualikan')} />
        <Kartu ikon={CheckCircle2} label="Hadir" nilai={pct(R.persenHadir)} warna={WARNA.hadir}
          catatan={R.hadir + ' hari-orang'} />
        <Kartu ikon={Gauge} label="Produktifitas" nilai={pct(R.persenProduktif)} warna={WARNA.hadir}
          catatan={R.lengkap + ' absen lengkap / ' + R.hariEfektif + ' hari efektif'} />
      </div>

      {/* KOMPOSISI — satu batang 100%, angkanya tertulis */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-4 mb-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-[14px] font-semibold text-slate-900">Komposisi kehadiran</h3>
          <p className="text-[11px] text-slate-400">
            Penyebut: {R.totalHariOrang} hari-orang ({R.hariKerja} hari × {R.jumlahOrang} kerani)
          </p>
        </div>

        {!adaKerani ? (
          <p className="py-10 text-center text-[13px] text-slate-400">
            Belum ada kerani yang cocok. Periksa kata kunci jabatan dan pilihan divisi.
          </p>
        ) : (
          <>
            <div className="flex w-full h-9 rounded-lg overflow-hidden gap-[2px] bg-white">
              {KEADAAN.map((k) => {
                const p = R[PETA_PERSEN[k.kunci]];
                if (p <= 0) return null;
                return (
                  <div key={k.kunci} style={{ width: p + '%', background: k.warna }}
                    className="flex items-center justify-center min-w-[2px] first:rounded-l-lg last:rounded-r-lg"
                    title={k.label + ' ' + pct(p)}>
                    {p >= 9 && (
                      <span className="text-[11px] font-semibold text-white tabular-nums px-1">{pct(p)}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              {KEADAAN.map((k) => {
                const Ikon = k.ikon;
                return (
                  <div key={k.kunci} className="flex items-start gap-2">
                    <Ikon className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} style={{ color: k.warna }} />
                    <div className="min-w-0">
                      <p className="text-[12px] text-slate-600 leading-tight">{k.label}</p>
                      <p className="text-[15px] font-semibold text-slate-900 tabular-nums leading-tight">
                        {pct(R[PETA_PERSEN[k.kunci]])}
                        <span className="text-[11px] font-normal text-slate-400 ml-1.5">
                          {R[PETA_RINGKAS[k.kunci]]} hari
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* TREN HARIAN */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-[14px] font-semibold text-slate-900">Kehadiran per hari kerja</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {KEADAAN.map((k) => (
              <span key={k.kunci} className="flex items-center gap-1.5 text-[12px] text-slate-600">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: k.warna }} /> {k.label}
              </span>
            ))}
          </div>
        </div>

        {rekap.perHari.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-slate-400">
            Tidak ada hari kerja pada rentang ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5 h-[180px] min-w-full">
              {rekap.perHari.map((h) => {
                const tinggi = (n) => (n / puncakHarian) * 150;
                return (
                  <div key={h.tanggal}
                    onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}
                    className="flex-1 min-w-[9px] flex flex-col justify-end items-center gap-[2px] relative cursor-default">
                    {h.tidakAbsen > 0 && <div className="w-full rounded-t" style={{ height: tinggi(h.tidakAbsen) + 'px', background: WARNA.tidak }} />}
                    {h.izin > 0 && <div className="w-full" style={{ height: tinggi(h.izin) + 'px', background: WARNA.izin }} />}
                    {h.standby > 0 && <div className="w-full" style={{ height: tinggi(h.standby) + 'px', background: WARNA.standby }} />}
                    {h.hadir > 0 && <div className="w-full" style={{ height: tinggi(h.hadir) + 'px', background: WARNA.hadir }} />}
                    {hover && hover.tanggal === h.tanggal && (
                      <div className="absolute bottom-full mb-1.5 z-20 whitespace-nowrap bg-slate-900 text-white text-[11px] rounded-lg px-2.5 py-2 shadow-lg pointer-events-none">
                        <p className="font-semibold mb-1">{tglPendek(h.tanggal)}</p>
                        <p>Hadir {h.hadir}</p>
                        <p>Standby {h.standby}</p>
                        <p>Izin {h.izin}</p>
                        <p>Tidak absen {h.tidakAbsen}</p>
                        <p className="mt-1 pt-1 border-t border-white/20">Absen lengkap {h.lengkap}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-slate-400 tabular-nums">
              <span>{tglPendek(rekap.perHari[0].tanggal)}</span>
              <span>{tglPendek(rekap.perHari[rekap.perHari.length - 1].tanggal)}</span>
            </div>
          </div>
        )}
      </div>

      {/* TABEL PER KERANI */}
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <div className="flex items-baseline justify-between flex-wrap gap-2 px-4 pt-4 pb-2">
          <h3 className="text-[14px] font-semibold text-slate-900">Rincian per kerani</h3>
          <p className="text-[11px] text-slate-400">
            Produktifitas terendah di atas · {barisTampil.length} dari {R.jumlahOrang} orang
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className="px-3 py-2 text-left font-medium">Nama</th>
                <th className="px-3 py-2 text-left font-medium">Divisi</th>
                <th className="px-3 py-2 text-right font-medium">Hadir</th>
                <th className="px-3 py-2 text-right font-medium">Standby</th>
                <th className="px-3 py-2 text-right font-medium">Izin</th>
                <th className="px-3 py-2 text-right font-medium">Tidak absen</th>
                <th className="px-3 py-2 text-right font-medium">Lengkap</th>
                <th className="px-3 py-2 text-right font-medium w-[150px]">Produktifitas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {barisTampil.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  Tidak ada baris untuk ditampilkan.
                </td></tr>
              )}
              {barisTampil.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/70">
                  <td className="px-3 py-2 text-slate-900 font-medium">{b.nama}</td>
                  <td className="px-3 py-2 text-slate-500">{b.divisi}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{b.hadir}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{b.standby}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{b.izin}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${b.tidakAbsen > 0 ? 'text-rose-700' : 'text-slate-400'}`}>
                    {b.tidakAbsen}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{b.lengkap}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-[70px] h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full"
                          style={{ width: Math.min(100, b.persenProduktif) + '%', background: WARNA.hadir }} />
                      </div>
                      <span className="tabular-nums font-semibold text-slate-900 w-[46px] text-right">
                        {pct(b.persenProduktif)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="px-4 py-3 text-[11px] text-slate-400 leading-relaxed border-t border-slate-100">
          Produktifitas = hari dengan absen LENGKAP (ada Hadir dan ada Pulang) dibagi hari kerja
          efektif — yaitu hari kerja dikurangi hari izin/cuti/sakit/dinas orang itu. Hadir tanpa
          absen pulang tidak dihitung lengkap.
        </p>
      </div>
    </div>
  );
}
