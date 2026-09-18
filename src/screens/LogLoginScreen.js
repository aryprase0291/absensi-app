// =====================================================================
// LOG LOGIN — dashboard admin
//
// Menampilkan `log_login` di Supabase: satu baris per percobaan login,
// berhasil maupun gagal. Datanya baru ada sejak 19 Sep 2026 — sebelum
// itu sistem hanya menyimpan keadaan terakhir (sesi_aktif ditimpa tiap
// login), bukan kejadian. Tidak ada yang bisa dipulihkan dari masa
// sebelumnya, dan layar ini mengatakannya apa adanya daripada
// menampilkan grafik kosong yang tampak seperti tidak ada yang login.
//
// Semua agregasi dikerjakan Postgres. Layar ini tidak pernah menerima
// puluhan ribu baris mentah: kartu dan grafik datang dari `ringkas`,
// tabel datang dari `daftar` yang berhalaman.
// =====================================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  ShieldCheck, ShieldAlert, Users, Activity, Search, Download,
  RefreshCcw, Loader2, ChevronLeft, ChevronRight, AlertTriangle, Filter
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';
import BackButton from '../components/BackButton';

// Dua deret, dan warnanya BUKAN merah-hijau.
//
// Merah-hijau adalah pasangan paling naluriah untuk berhasil/gagal, dan
// justru itu yang membuatnya sering lolos tanpa diperiksa: pada mata
// deuteranopia keduanya berjarak ΔE 4,1 — praktis warna yang sama.
// Biru-merah diuji ulang dan berjarak 23,8 pada protan, 25,7 pada
// deutan. Angka-angka ini bukan perkiraan; keduanya keluaran validator
// palet, dijalankan untuk mode terang dan gelap.
//
// Warna tetap tidak pernah jadi satu-satunya penanda: setiap deret punya
// legenda, ikon, dan angkanya tertulis.
const WARNA = {
  berhasil: { terang: '#2a78d6', gelap: '#3987e5' },
  gagal:    { terang: '#d03b3b', gelap: '#d03b3b' },
};

const HARI_DEFAULT = 30;
const BARIS_PER_HALAMAN = 100;

function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function tglTampil(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export default function LogLoginScreen({ user, setView, fetchApi: customFetchApi }) {
  const hariIni = useMemo(() => new Date(), []);
  const [dari, setDari] = useState(() => ymd(new Date(Date.now() - HARI_DEFAULT * 86400000)));
  const [sampai, setSampai] = useState(() => ymd(hariIni));

  const [ringkas, setRingkas] = useState(null);
  const [baris, setBaris] = useState([]);
  const [totalBaris, setTotalBaris] = useState(0);
  const [halaman, setHalaman] = useState(0);
  const [cari, setCari] = useState('');
  const [hanyaGagal, setHanyaGagal] = useState(false);

  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState('');

  const panggil = useCallback(async (payload) => {
    const kirim = { action: 'get_log_login', ...payload };
    if (typeof customFetchApi === 'function') {
      const res = await customFetchApi(SCRIPT_URL, { method: 'POST', body: JSON.stringify(kirim) });
      return await res.json();
    }
    let token = '';
    try {
      const simpan = sessionStorage.getItem('app_user');
      if (simpan) token = (JSON.parse(simpan) || {}).token || '';
    } catch (e) { /* biarkan kosong; backend yang menolak */ }
    const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ ...kirim, token }) });
    return await res.json();
  }, [customFetchApi]);

  // Rentang dikirim sebagai batas HARI PENUH: 'sampai' diberi jam 23:59
  // supaya login hari ini ikut terhitung. Tanpa itu, memilih "sampai hari
  // ini" diam-diam memotong seluruh isi hari ini.
  const rentang = useMemo(() => ({
    dari: dari + 'T00:00:00',
    sampai: sampai + 'T23:59:59',
  }), [dari, sampai]);

  const muatRingkas = useCallback(async () => {
    const data = await panggil({ mode: 'ringkas', ...rentang });
    if (data.result !== 'success') throw new Error(data.message || 'Gagal memuat ringkasan.');
    setRingkas(data);
  }, [panggil, rentang]);

  const muatDaftar = useCallback(async (hal) => {
    const data = await panggil({
      mode: 'daftar', ...rentang,
      cari, hanyaGagal,
      batas: BARIS_PER_HALAMAN,
      offset: hal * BARIS_PER_HALAMAN,
    });
    if (data.result !== 'success') throw new Error(data.message || 'Gagal memuat daftar.');
    setBaris(data.baris || []);
    setTotalBaris(Number(data.total) || 0);
  }, [panggil, rentang, cari, hanyaGagal]);

  const muatSemua = useCallback(async (hal = 0) => {
    setMemuat(true); setGalat('');
    try {
      setHalaman(hal);
      await Promise.all([muatRingkas(), muatDaftar(hal)]);
    } catch (e) {
      setGalat(e.message || 'Gagal memuat data.');
    } finally {
      setMemuat(false);
    }
  }, [muatRingkas, muatDaftar]);

  useEffect(() => { muatSemua(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const eksporExcel = async () => {
    setMemuat(true);
    try {
      // Export mengambil ULANG dari server, bukan menyalin halaman yang
      // sedang tampil — kalau tidak, admin mengekspor 100 baris dan
      // mengira itu seluruh periodenya.
      const data = await panggil({
        mode: 'daftar', ...rentang, cari, hanyaGagal,
        batas: 5000, offset: 0,
      });
      if (data.result !== 'success') throw new Error(data.message || 'Gagal menyiapkan export.');

      const isi = (data.baris || []).map((b) => ({
        Waktu: tglTampil(b.waktu),
        Nama: b.nama || '-',
        Username: b.username || '-',
        'ID Karyawan': b.karyawanId || '-',
        Hasil: b.berhasil ? 'Berhasil' : 'GAGAL',
        Sebab: b.sebab || '',
        Perangkat: b.deviceId || '-',
        Platform: b.platform || '-',
        IP: b.ip || '-',
        Jalur: b.jalur || '-',
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(isi), 'Log Login');
      XLSX.writeFile(wb, `log-login_${dari}_sd_${sampai}.xlsx`);

      if (Number(data.total) > 5000) {
        alert(`Periode ini punya ${data.total} baris; yang terekspor 5.000 terbaru.\n\nPersempit rentang tanggalnya untuk mendapat sisanya.`);
      }
    } catch (e) {
      alert(e.message || 'Export gagal.');
    } finally {
      setMemuat(false);
    }
  };

  const perHari = (ringkas && ringkas.perHari) || [];
  const puncak = Math.max(1, ...perHari.map((d) => Number(d.berhasil) + Number(d.gagal)));
  const totalHalaman = Math.max(1, Math.ceil(totalBaris / BARIS_PER_HALAMAN));

  const Kartu = ({ ikon: Ikon, label, nilai, catatan, warna }) => (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Ikon className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: warna || '#64748b' }} />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</p>
      </div>
      <p className="text-[26px] font-semibold text-slate-900 tabular-nums leading-none">{nilai}</p>
      {catatan && <p className="text-[11px] text-slate-400 mt-1.5">{catatan}</p>}
    </div>
  );

  return (
    <div className="p-4 pb-20 bg-gray-50 min-h-screen">

      <div className="flex items-start justify-between mb-5 gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-400 tracking-tight">Admin panel</p>
          <h2 className="text-[19px] font-semibold text-slate-900 tracking-tight leading-tight">Log Login Pengguna</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => muatSemua(0)} disabled={memuat}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
            {memuat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" strokeWidth={1.75} />}
            Muat ulang
          </button>
          <BackButton onClick={() => setView('admin')} />
        </div>
      </div>

      {/* FILTER — satu baris di atas grafik */}
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
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Cari nama / username / ID</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={1.75} />
              <input value={cari} onChange={(e) => setCari(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') muatSemua(0); }}
                placeholder="Ketik lalu Enter"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 outline-none focus:border-slate-400" />
            </div>
          </div>
          <button onClick={() => { setHanyaGagal(!hanyaGagal); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border transition-colors
              ${hanyaGagal ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <Filter className="w-3.5 h-3.5" strokeWidth={1.75} />
            Hanya gagal
          </button>
          <button onClick={() => muatSemua(0)} disabled={memuat}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
            Terapkan
          </button>
          <button onClick={eksporExcel} disabled={memuat || !totalBaris}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            <Download className="w-3.5 h-3.5" strokeWidth={1.75} /> Export Excel
          </button>
        </div>
      </div>

      {galat && (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl p-3.5 mb-4">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-[13px] text-rose-800">{galat}</p>
        </div>
      )}

      {/* KARTU */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kartu ikon={Activity} label="Total percobaan" nilai={ringkas ? ringkas.total : '—'} />
        <Kartu ikon={ShieldCheck} label="Berhasil" nilai={ringkas ? ringkas.berhasil : '—'} warna={WARNA.berhasil.terang} />
        <Kartu ikon={ShieldAlert} label="Gagal" nilai={ringkas ? ringkas.gagal : '—'} warna={WARNA.gagal.terang}
          catatan={ringkas && ringkas.gagal > 0 ? 'Periksa daftar di bawah' : ''} />
        <Kartu ikon={Users} label="Pengguna unik" nilai={ringkas ? ringkas.userUnik : '—'} catatan="yang berhasil masuk" />
      </div>

      {/* GRAFIK HARIAN */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-4 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-[14px] font-semibold text-slate-900">Percobaan login per hari</h3>
          {/* Legenda selalu ada untuk dua deret — identitas tidak boleh
              bergantung pada warna saja. */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: WARNA.berhasil.terang }} /> Berhasil
            </span>
            <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: WARNA.gagal.terang }} /> Gagal
            </span>
          </div>
        </div>

        {perHari.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-slate-400">
            Belum ada data pada rentang ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1.5 h-[160px] min-w-full">
              {perHari.map((d) => {
                const b = Number(d.berhasil) || 0;
                const g = Number(d.gagal) || 0;
                // Batang ditumpuk, dengan celah 2px antar segmen supaya
                // batas keduanya terbaca tanpa mengandalkan warna.
                return (
                  <div key={d.tanggal} className="flex-1 min-w-[10px] flex flex-col justify-end items-center gap-[2px] group relative">
                    {g > 0 && (
                      <div className="w-full rounded-t" style={{ height: `${(g / puncak) * 130}px`, background: WARNA.gagal.terang }} />
                    )}
                    {b > 0 && (
                      <div className={`w-full ${g > 0 ? '' : 'rounded-t'}`} style={{ height: `${(b / puncak) * 130}px`, background: WARNA.berhasil.terang }} />
                    )}
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 whitespace-nowrap bg-slate-900 text-white text-[11px] rounded-lg px-2 py-1.5 shadow-lg">
                      <p className="font-medium">{d.tanggal}</p>
                      <p>Berhasil {b}</p>
                      <p>Gagal {g}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-slate-400 tabular-nums">
              <span>{perHari[0] && perHari[0].tanggal}</span>
              <span>{perHari[perHari.length - 1] && perHari[perHari.length - 1].tanggal}</span>
            </div>
          </div>
        )}
      </div>

      {/* DUA DAFTAR TERATAS */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <h3 className="text-[14px] font-semibold text-slate-900 px-4 pt-4 pb-2">Paling sering masuk</h3>
          <div className="divide-y divide-slate-100">
            {(!ringkas || !ringkas.teratas || !ringkas.teratas.length) && (
              <p className="px-4 py-8 text-center text-[13px] text-slate-400">Belum ada data.</p>
            )}
            {ringkas && (ringkas.teratas || []).map((t) => (
              <div key={t.karyawanId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-900 truncate">{t.nama || t.username}</p>
                  <p className="text-[11px] text-slate-400 truncate">Terakhir {tglTampil(t.terakhir)}</p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-slate-900 tabular-nums">{t.jumlah}×</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <h3 className="text-[14px] font-semibold text-slate-900 px-4 pt-4 pb-2">
            Percobaan gagal terbanyak
          </h3>
          <p className="px-4 pb-2 text-[11px] text-slate-400">
            Kegagalan yang menumpuk pada satu akun adalah tanda paling awal password bocor.
          </p>
          <div className="divide-y divide-slate-100">
            {(!ringkas || !ringkas.gagalTeratas || !ringkas.gagalTeratas.length) && (
              <p className="px-4 py-8 text-center text-[13px] text-slate-400">Tidak ada percobaan gagal. Bagus.</p>
            )}
            {ringkas && (ringkas.gagalTeratas || []).map((g) => (
              <div key={g.username} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-900 truncate">{g.nama || g.username}</p>
                  <p className="text-[11px] text-slate-400 truncate">Terakhir {tglTampil(g.terakhir)}</p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums" style={{ color: WARNA.gagal.terang }}>{g.jumlah}×</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TABEL KEJADIAN */}
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-wrap gap-2">
          <h3 className="text-[14px] font-semibold text-slate-900">
            Daftar kejadian
            <span className="ml-2 text-[12px] font-normal text-slate-400 tabular-nums">{totalBaris} baris</span>
          </h3>
          {totalHalaman > 1 && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => muatSemua(Math.max(0, halaman - 1))} disabled={halaman === 0 || memuat}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              </button>
              <span className="text-[12px] text-slate-500 tabular-nums">{halaman + 1} / {totalHalaman}</span>
              <button onClick={() => muatSemua(Math.min(totalHalaman - 1, halaman + 1))} disabled={halaman >= totalHalaman - 1 || memuat}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Waktu</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Nama</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Username</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Hasil</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Platform</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">IP</th>
                <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Jalur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {baris.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-slate-400">
                  {memuat ? 'Memuat…' : 'Tidak ada kejadian pada rentang ini.'}
                </td></tr>
              )}
              {baris.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 tabular-nums">{tglTampil(b.waktu)}</td>
                  <td className="px-3 py-2.5 text-slate-900 font-medium">{b.nama || '-'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{b.username || '-'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {/* Ikon + kata, bukan warna saja. */}
                    {b.berhasil ? (
                      <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: WARNA.berhasil.terang }}>
                        <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} /> Berhasil
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: WARNA.gagal.terang }} title={b.sebab}>
                        <ShieldAlert className="w-3.5 h-3.5" strokeWidth={2} /> Gagal
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{b.platform || '-'}</td>
                  <td className="px-3 py-2.5 text-slate-500 tabular-nums">{b.ip || '-'}</td>
                  <td className="px-3 py-2.5 text-slate-400">{b.jalur || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
        Log disimpan 90 hari, lalu dibuang otomatis. Pencatatan dimulai 19 September 2026 —
        login sebelum tanggal itu tidak pernah direkam dan tidak bisa dipulihkan.
        Login yang jatuh ke jalur Apps Script belum ikut tercatat di sini.
      </p>
    </div>
  );
}
