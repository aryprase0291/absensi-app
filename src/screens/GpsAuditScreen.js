import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MapPin, RefreshCcw, Loader2, Search, AlertTriangle,
  CheckCircle2, Gauge, Users, ExternalLink, Info, Radar, FileSearch
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';

// =====================================================================
// PANEL MONITORING GPS (Admin / HRD)
//
// Dua sudut pandang yang saling melengkapi:
//
//   Tab "Kejadian"  — per-percobaan, real time. Termasuk percobaan yang
//                     DITOLAK, yang tidak pernah muncul di sheet Absensi.
//   Tab "Analisa"   — per-karyawan, menilai seluruh riwayat yang sudah
//                     ada. Inilah yang menjawab "siapa saja yang polanya
//                     mencurigakan selama ini".
//
// CATATAN PENTING YANG SENGAJA DITAMPILKAN DI LAYAR:
// koordinat identik berulang TIDAK otomatis berarti Fake GPS. Absen dari
// dalam gedung sering memakai lokasi jaringan WiFi, dan itu mengembalikan
// titik yang sama persis setiap kali. Pembedanya ada di kolom "Dipakai
// karyawan lain" — kalau titik yang sama juga dipakai rekan kerja, itu
// justru bukti kuat bahwa titik tersebut adalah lokasi jaringan kantor.
// =====================================================================

const WARNA_LEVEL = {
  BLOKIR: 'bg-rose-50 text-rose-700 border-rose-200',
  TINJAU: 'bg-amber-50 text-amber-700 border-amber-200',
  WASPADA: 'bg-sky-50 text-sky-700 border-sky-200',
  AMAN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  TINGGI: 'bg-rose-50 text-rose-700 border-rose-200',
  SEDANG: 'bg-amber-50 text-amber-700 border-amber-200',
  RENDAH: 'bg-sky-50 text-sky-700 border-sky-200'
};

const badge = (level) =>
  `inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${WARNA_LEVEL[level] || 'bg-slate-100 text-slate-600 border-slate-200'}`;

const linkPeta = (lat, lng) =>
  `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`;

function KartuAngka({ ikon: Ikon, label, nilai, warna }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${warna}`}>
        <Ikon size={17} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-lg font-bold leading-tight text-slate-800">{nilai}</p>
      </div>
    </div>
  );
}

export default function GpsAuditScreen({ user, setView, fetchApi }) {
  const [tab, setTab] = useState('kejadian');
  const [kejadian, setKejadian] = useState([]);
  const [laporan, setLaporan] = useState([]);
  const [loadingKejadian, setLoadingKejadian] = useState(false);
  const [loadingLaporan, setLoadingLaporan] = useState(false);
  const [error, setError] = useState('');
  const [cari, setCari] = useState('');
  const [filterLevel, setFilterLevel] = useState('SEMUA');
  const [sudahAudit, setSudahAudit] = useState(false);

  const panggil = useCallback(async (payload) => {
    const res = await fetchApi(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ ...payload, roleRequester: user.role })
    });
    return res.json();
  }, [fetchApi, user.role]);

  const muatKejadian = useCallback(async () => {
    setLoadingKejadian(true);
    setError('');
    try {
      const d = await panggil({ action: 'get_gps_audit', limit: 500 });
      if (d.result === 'success') setKejadian(d.kejadian || []);
      else setError(d.message || 'Gagal memuat data audit.');
    } catch (e) {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setLoadingKejadian(false);
    }
  }, [panggil]);

  const jalankanAudit = useCallback(async () => {
    setLoadingLaporan(true);
    setError('');
    try {
      const d = await panggil({ action: 'run_gps_audit_historis' });
      if (d.result === 'success') {
        setLaporan(d.laporan || []);
        setSudahAudit(true);
      } else {
        setError(d.message || 'Gagal menjalankan audit historis.');
      }
    } catch (e) {
      setError('Tidak bisa menghubungi server. Audit historis membaca seluruh sheet Absensi, jadi butuh waktu lebih lama.');
    } finally {
      setLoadingLaporan(false);
    }
  }, [panggil]);

  useEffect(() => { muatKejadian(); }, [muatKejadian]);

  const kejadianTersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return kejadian.filter((k) => {
      if (filterLevel !== 'SEMUA' && k.level !== filterLevel) return false;
      if (!q) return true;
      return String(k.nama).toLowerCase().includes(q) || String(k.userId).toLowerCase().includes(q);
    });
  }, [kejadian, cari, filterLevel]);

  const laporanTersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return laporan;
    return laporan.filter((l) =>
      String(l.nama).toLowerCase().includes(q) || String(l.userId).toLowerCase().includes(q));
  }, [laporan, cari]);

  const ringkasan = useMemo(() => ({
    blokir: kejadian.filter((k) => k.level === 'BLOKIR').length,
    tinjau: kejadian.filter((k) => k.level === 'TINJAU').length,
    total: kejadian.length
  }), [kejadian]);

  return (
    <div className="pb-24">
      {/* Kepala layar sengaja tidak dibuat di sini: App.js sudah memasang
          bar navigasi global untuk semua view selain dashboard/form, dan
          menambah kepala kedua hanya menghasilkan judul dobel. */}
      <div className="px-0">
        <div className="grid grid-cols-3 gap-2">
          <KartuAngka ikon={AlertTriangle} label="Ditolak" nilai={ringkasan.blokir} warna="bg-rose-100 text-rose-600" />
          <KartuAngka ikon={Gauge} label="Perlu Tinjau" nilai={ringkasan.tinjau} warna="bg-amber-100 text-amber-600" />
          <KartuAngka ikon={Radar} label="Total Tercatat" nilai={ringkasan.total} warna="bg-slate-200 text-slate-600" />
        </div>
      </div>

      <div className="mt-4 flex gap-1.5 px-0">
        {[
          { id: 'kejadian', label: 'Kejadian Terbaru' },
          { id: 'analisa', label: 'Analisa Riwayat' }
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
              tab === t.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2 px-0">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama atau User ID..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[13px] outline-none focus:border-slate-400"
          />
        </div>
        {tab === 'kejadian' ? (
          <>
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 text-[13px] outline-none"
            >
              <option value="SEMUA">Semua</option>
              <option value="BLOKIR">Ditolak</option>
              <option value="TINJAU">Perlu Tinjau</option>
              <option value="WASPADA">Waspada</option>
            </select>
            <button
              onClick={muatKejadian}
              disabled={loadingKejadian}
              className="grid h-[38px] w-[38px] place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50"
            >
              {loadingKejadian ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            </button>
          </>
        ) : (
          <button
            onClick={jalankanAudit}
            disabled={loadingLaporan}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {loadingLaporan ? <Loader2 size={15} className="animate-spin" /> : <FileSearch size={15} />}
            {loadingLaporan ? 'Menganalisa...' : 'Jalankan'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---------------- TAB KEJADIAN ---------------- */}
      {tab === 'kejadian' && (
        <div className="mt-3 space-y-2 px-0">
          {loadingKejadian && kejadian.length === 0 && (
            <div className="grid place-items-center py-14 text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          )}

          {!loadingKejadian && kejadianTersaring.length === 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center">
              <CheckCircle2 size={26} className="mx-auto text-emerald-500" />
              <p className="mt-2 text-[13px] font-semibold text-emerald-800">Belum ada kejadian mencurigakan</p>
              <p className="mt-1 text-[12px] text-emerald-700">
                Catatan mulai terkumpul setelah karyawan melakukan absen berikutnya.
              </p>
            </div>
          )}

          {kejadianTersaring.map((k, i) => (
            <div key={`${k.uuid}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-slate-800">{k.nama}</p>
                  <p className="text-[11.5px] text-slate-500">{k.waktu} &middot; {k.tipe} &middot; ID {k.userId}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={badge(k.level)}>{k.keputusan}</span>
                  <p className="mt-1 text-[11px] text-slate-500">Skor {k.skor}</p>
                </div>
              </div>

              {k.alasan && k.alasan !== '-' && (
                <ul className="mt-2.5 space-y-1">
                  {String(k.alasan).split(' | ').map((a, j) => (
                    <li key={j} className="flex gap-1.5 text-[12px] leading-snug text-slate-600">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      {a}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11.5px] text-slate-500">
                {k.akurasi !== '-' && <span>Akurasi ±{k.akurasi} m</span>}
                {k.jitter !== '-' && k.jitter !== '' && <span>Jitter {k.jitter} m</span>}
                {k.kecepatan !== '-' && k.kecepatan !== '' && <span>{k.kecepatan} km/j</span>}
                {k.deviceId && k.deviceId !== '-' && <span>Perangkat {k.deviceId}</span>}
                {k.lat !== '-' && (
                  <a
                    href={linkPeta(k.lat, k.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-blue-600"
                  >
                    <MapPin size={12} /> Lihat peta <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- TAB ANALISA ---------------- */}
      {tab === 'analisa' && (
        <div className="mt-3 space-y-2 px-0">
          <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-[12px] leading-relaxed text-sky-800">
            <Info size={15} className="mt-px shrink-0" />
            <span>
              Koordinat identik berulang <b>belum tentu</b> Fake GPS — absen dari dalam gedung sering
              memakai lokasi WiFi yang selalu mengembalikan titik sama. Perhatikan kolom
              <b> &ldquo;dipakai karyawan lain&rdquo;</b>: kalau titik yang sama juga muncul pada rekan kerja,
              itu justru menandakan lokasi jaringan kantor, bukan kecurangan.
            </span>
          </div>

          {!sudahAudit && !loadingLaporan && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center">
              <FileSearch size={26} className="mx-auto text-slate-400" />
              <p className="mt-2 text-[13px] font-semibold text-slate-700">Analisa belum dijalankan</p>
              <p className="mt-1 text-[12px] text-slate-500">
                Tekan <b>Jalankan</b> untuk memindai seluruh riwayat absensi yang sudah ada.
              </p>
            </div>
          )}

          {loadingLaporan && (
            <div className="grid place-items-center py-14 text-slate-400">
              <Loader2 size={24} className="animate-spin" />
              <p className="mt-2 text-[12px]">Memindai seluruh sheet Absensi...</p>
            </div>
          )}

          {laporanTersaring.map((l) => (
            <div key={l.userId} className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-slate-800">{l.nama}</p>
                  <p className="text-[11.5px] text-slate-500">
                    ID {l.userId} &middot; {l.totalAbsen} absen &middot; {l.titikUnik} titik berbeda
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={badge(l.level)}>{l.level}</span>
                  <p className="mt-1 text-[11px] text-slate-500">Skor {l.skor}</p>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-[11.5px]">
                <div>
                  <p className="text-slate-500">Koordinat dominan</p>
                  <p className="font-semibold text-slate-700">
                    {l.hitungDominan}x ({l.rasioDominan}%)
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Dipakai karyawan lain</p>
                  <p className={`font-semibold ${l.dipakaiKaryawanLain > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {l.dipakaiKaryawanLain > 0 ? `${l.dipakaiKaryawanLain} orang` : 'Tidak ada'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Rentetan sama persis</p>
                  <p className="font-semibold text-slate-700">{l.rentetanTerpanjang}x berturut</p>
                </div>
                <div>
                  <p className="text-slate-500">Perpindahan mustahil</p>
                  <p className={`font-semibold ${l.jumlahTeleport > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                    {l.jumlahTeleport}x
                  </p>
                </div>
              </div>

              {l.alasan && l.alasan.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {l.alasan.map((a, j) => (
                    <li key={j} className="flex gap-1.5 text-[12px] leading-snug text-slate-600">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      {a}
                    </li>
                  ))}
                </ul>
              )}

              {l.koordinatDominan && (
                <div className="mt-2.5 flex items-center gap-3 border-t border-slate-100 pt-2 text-[11.5px]">
                  <span className="truncate text-slate-500">{l.koordinatDominan}</span>
                  <a
                    href={linkPeta(l.koordinatDominan.split(',')[0], l.koordinatDominan.split(',')[1])}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-blue-600"
                  >
                    <MapPin size={12} /> Peta <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          ))}

          {sudahAudit && !loadingLaporan && laporanTersaring.length === 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center">
              <Users size={26} className="mx-auto text-emerald-500" />
              <p className="mt-2 text-[13px] font-semibold text-emerald-800">Tidak ada pola mencurigakan</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
