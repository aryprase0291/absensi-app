// =====================================================================
// JENDELA RINCIAN SATU KERANI — tampilan lembar kerja
//
// Dibuka dari tabel "Rincian per kerani":
//   - klik NAMA   -> seluruh hari kerja orang itu, satu baris per tanggal;
//   - klik ANGKA  -> hanya tanggal-tanggal yang membentuk angka itu.
//
// Hari TANPA absen tetap mendapat barisnya sendiri — justru itu yang
// dicari. Daftar tanggalnya diambil lewat tanggalPerKolom() dari
// rekapKerani.js, sumber yang sama dengan angka di tabel, jadi angka "4"
// selalu berisi tepat empat baris. Jendela ini tidak menghitung apa pun.
//
// Baris tabel dibangun SEKALI (susunBaris) lalu dipakai oleh tabel di
// layar dan oleh ekspor Excel — supaya isi file tidak pernah berbeda
// dengan yang dilihat.
// =====================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { X, Download, Camera, Loader2, Check } from 'lucide-react';
import { STATUS, tanggalPerKolom, jamDari } from './rekapKerani';
import { tangkapKeClipboard } from '../utils/tangkapLayar';

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function hariKe(ymd) {
  const t = Date.parse(ymd + 'T00:00:00Z');
  return isNaN(t) ? -1 : new Date(t).getUTCDay();
}
function tglTampil(ymd) {
  const b = String(ymd).split('-');
  return ('0' + Number(b[2])).slice(-2) + ' ' + (BULAN[Number(b[1]) - 1] || b[1]) + ' ' + b[0];
}
function urutJam(a, b) { return jamDari(a.waktu).localeCompare(jamDari(b.waktu)); }
function bersih(v) { const s = String(v == null ? '' : v).trim(); return s === '-' ? '' : s; }

const OFF = 'OFF';
const LABEL_STATUS = {
  [OFF]: 'Off',
  [STATUS.HADIR]: 'Hadir', [STATUS.STANDBY]: 'Standby',
  [STATUS.IZIN]: 'Izin', [STATUS.KOSONG]: 'Tidak absen'
};

/** Satu baris lembar kerja per tanggal. */
function susunBaris(orang, daftarTgl) {
  return daftarTgl.map((t, i) => {
    const diOff = !!(orang.hariOff && orang.hariOff[t]);
    const semua = diOff ? orang.hariOff[t] : ((orang.barisPer && orang.barisPer[t]) || []);
    const sah = semua.filter((x) => bersih(x.status) !== 'Rejected');
    const tipe = (x) => String(x.tipe || '').trim();
    const masuk = sah.filter((x) => tipe(x) === 'Hadir').sort(urutJam)[0];
    const pulang = sah.filter((x) => tipe(x) === 'Pulang').sort(urutJam).slice(-1)[0];
    const standby = sah.filter((x) => tipe(x) === 'Standby').sort(urutJam);
    const pengajuan = semua.filter((x) => ['Hadir', 'Pulang', 'Standby'].indexOf(tipe(x)) === -1);
    const status = diOff ? OFF : (orang.sel[t] || STATUS.KOSONG);
    const hadir = status === STATUS.HADIR;
    const ket = pengajuan.map((x) => {
      const st = bersih(x.status);
      return tipe(x) + (st ? ' (' + (st === 'Rejected' ? 'Ditolak' : st) + ')' : '') +
        (bersih(x.catatan) ? ': ' + bersih(x.catatan) : '');
    });
    if (hadir && !orang.lengkapPer[t]) ket.unshift(masuk ? 'Tidak absen pulang' : 'Tidak absen masuk');
    if (diOff) ket.unshift((hariKe(t) === 0 ? 'Hari Minggu' : 'Hari libur') + ' — masuk, tidak dihitung');
    const sumberLokasi = masuk || pulang || standby[0];
    return {
      no: i + 1,
      tanggal: t,
      hari: HARI[hariKe(t)] || '',
      minggu: hariKe(t) === 0,
      status,
      statusLabel: diOff ? (hariKe(t) === 0 ? 'Off · Minggu' : 'Off · Libur') : LABEL_STATUS[status],
      sebelah: hadir && !orang.lengkapPer[t],
      masuk: masuk ? (jamDari(masuk.waktu) || '✓') : '',
      pulang: pulang ? (jamDari(pulang.waktu) || '✓') : '',
      standby: standby.map((x) => jamDari(x.waktu) || '✓').join(', '),
      keterangan: ket.join(' · '),
      lokasi: sumberLokasi ? bersih(sumberLokasi.alamat) || bersih(sumberLokasi.lokasi) : ''
    };
  });
}

export default function RincianKerani({ orang, tanggal, kolomAwal, warna, periode, onClose }) {
  const [kolom, setKolom] = useState(kolomAwal || 'semua');
  const [proses, setProses] = useState('');   // '' | 'foto' | 'tersalin' | 'terunduh'
  const lembarRef = useRef(null);
  useEffect(() => { setKolom(kolomAwal || 'semua'); }, [orang, kolomAwal]);

  useEffect(() => {
    const tutup = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', tutup);
    return () => window.removeEventListener('keydown', tutup);
  }, [onClose]);

  const PILIHAN = useMemo(() => [
    { kunci: 'semua',   label: 'Semua hari' },
    { kunci: 'hadir',   label: 'Hadir',         warna: warna.hadir },
    { kunci: 'standby', label: 'Standby',       warna: warna.standby },
    { kunci: 'izin',    label: 'Izin',          warna: warna.izin },
    { kunci: 'tidak',   label: 'Tidak absen',   warna: warna.tidak },
    { kunci: 'lengkap', label: 'Lengkap' },
    { kunci: 'sebelah', label: 'Hanya sebelah' },
    { kunci: 'off',     label: 'Masuk hari off', warna: '#94a3b8' }
  ], [warna]);

  const jumlah = useMemo(() => {
    const h = {};
    PILIHAN.forEach((p) => { h[p.kunci] = tanggalPerKolom(orang, tanggal, p.kunci).length; });
    return h;
  }, [orang, tanggal, PILIHAN]);

  // Urut per tanggal, terlama di atas — dibaca seperti lembar absen.
  const baris = useMemo(
    () => susunBaris(orang, tanggalPerKolom(orang, tanggal, kolom)),
    [orang, tanggal, kolom]
  );

  if (!orang) return null;

  const labelKolom = (PILIHAN.find((p) => p.kunci === kolom) || {}).label || '';
  const teksPeriode = periode ? tglTampil(periode.dari) + ' – ' + tglTampil(periode.sampai) : '';
  const namaFile = 'riwayat-' + orang.nama.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() +
    (periode ? '_' + periode.dari + '_' + periode.sampai : '');

  const WARNA_SEL = {
    [STATUS.HADIR]:   { bg: '#e8f1fc', fg: '#1d5fb0', titik: warna.hadir },
    [STATUS.STANDBY]: { bg: '#fdf4dc', fg: '#8a5d00', titik: warna.standby },
    [STATUS.IZIN]:    { bg: '#eeebf8', fg: '#3b2e8a', titik: warna.izin },
    [STATUS.KOSONG]:  { bg: '#fcebea', fg: '#b4302f', titik: warna.tidak },
    [OFF]:            { bg: '#f1f5f9', fg: '#475569', titik: '#94a3b8' }
  };

  const eksporExcel = () => {
    const judul = [
      ['Riwayat Absen Online'],
      ['Nama', orang.nama],
      ['Divisi', orang.divisi],
      ['Periode', teksPeriode],
      ['Tampilan', labelKolom + ' (' + baris.length + ' hari)'],
      ['Ringkasan', 'Hadir ' + orang.hadir + ' · Standby ' + orang.standby + ' · Izin ' + orang.izin +
        ' · Tidak absen ' + orang.tidakAbsen + ' · Lengkap ' + orang.lengkap +
        ' · Absensi ' + orang.persenProduktif.toFixed(1) + '%'],
      []
    ];
    const kepala = ['No', 'Tanggal', 'Hari', 'Status', 'Masuk', 'Pulang', 'Standby', 'Keterangan', 'Lokasi'];
    const isi = baris.map((r) => [r.no, r.tanggal, r.hari, r.statusLabel, r.masuk, r.pulang,
      r.standby, r.keterangan, r.lokasi]);
    const ws = XLSX.utils.aoa_to_sheet(judul.concat([kepala], isi));
    ws['!cols'] = [6, 12, 9, 12, 8, 8, 14, 40, 50].map((w) => ({ wch: w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: judul.length, c: 0 }, e: { r: judul.length + isi.length, c: kepala.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Riwayat');
    XLSX.writeFile(wb, namaFile + '.xlsx');
  };

  // Tangkapan layar SELURUH lembar -> clipboard, siap paste ke WhatsApp.
  const ambilGambar = async () => {
    if (!lembarRef.current || proses === 'foto') return;
    setProses('foto');
    const h = await tangkapKeClipboard(lembarRef.current, {
      namaFile, lepas: ['[data-lembar-gulir]', '[data-lembar-panel]']
    });
    setProses(!h.ok ? '' : h.tersalin ? 'tersalin' : 'terunduh');
    if (h.ok) setTimeout(() => setProses(''), 2500);
  };

  const th = 'px-2.5 py-2 text-left font-semibold text-slate-600 border-r border-b border-slate-200 bg-slate-100 sticky top-0 z-10 whitespace-nowrap';
  const td = 'px-2.5 py-1.5 border-r border-b border-slate-200 align-top';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4"
      onClick={onClose}>
      <div data-lembar-panel className="bg-white w-full sm:max-w-6xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        {/* Bilah alat — tidak ikut tertangkap gambar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {PILIHAN.filter((p) => p.kunci !== 'off' || jumlah.off > 0).map((p) => {
              const aktif = kolom === p.kunci;
              return (
                <button key={p.kunci} onClick={() => setKolom(p.kunci)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors
                    ${aktif ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                  {p.warna && <span className="w-2 h-2 rounded-sm" style={{ background: p.warna }} />}
                  {p.label}
                  <span className={`tabular-nums ${aktif ? 'text-white/70' : 'text-slate-400'}`}>{jumlah[p.kunci]}</span>
                </button>
              );
            })}
          </div>
          <button onClick={eksporExcel} disabled={!baris.length}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
            <Download className="w-3.5 h-3.5" strokeWidth={1.75} /> Excel
          </button>
          <button onClick={ambilGambar} disabled={proses === 'foto'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 disabled:opacity-60">
            {proses === 'foto' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : proses ? <Check className="w-3.5 h-3.5 text-emerald-600" />
              : <Camera className="w-3.5 h-3.5" strokeWidth={1.75} />}
            {proses === 'tersalin' ? 'Tersalin — paste di WA' : proses === 'terunduh' ? 'Diunduh' : 'Screenshot'}
          </button>
          <button onClick={onClose} aria-label="Tutup" className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* LEMBAR — bagian ini yang tertangkap screenshot */}
        <div ref={lembarRef} className="flex flex-col min-h-0 bg-white">
          <div className="px-4 pt-3 pb-2.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-900">{orang.nama}</h3>
              <p className="text-[12px] text-slate-500">
                {orang.divisi}{teksPeriode && ' · ' + teksPeriode} · {labelKolom} ({baris.length} hari)
                {jumlah.off > 0 && kolom === 'semua' ? ' · ' + jumlah.off + ' di antaranya hari off, tidak dihitung' : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500 tabular-nums">
              <span>Hadir <b className="text-slate-900">{orang.hadir}</b></span>
              <span>Standby <b className="text-slate-900">{orang.standby}</b></span>
              <span>Izin <b className="text-slate-900">{orang.izin}</b></span>
              <span>Tidak absen <b className="text-rose-700">{orang.tidakAbsen}</b></span>
              <span>Lengkap <b className="text-slate-900">{orang.lengkap}</b></span>
              <span>Absensi <b className="text-slate-900">{orang.persenProduktif.toFixed(1)}%</b></span>
            </div>
          </div>

          <div data-lembar-gulir className="overflow-auto max-h-[68vh] border-t border-slate-200">
            <table className="min-w-full text-[12px] border-separate border-spacing-0 tabular-nums">
              <thead>
                <tr>
                  <th className={th + ' w-10 text-center text-slate-400'}>No</th>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Hari</th>
                  <th className={th}>Status</th>
                  <th className={th + ' text-center'}>Masuk</th>
                  <th className={th + ' text-center'}>Pulang</th>
                  <th className={th}>Standby</th>
                  <th className={th}>Keterangan</th>
                  <th className={th + ' border-r-0'}>Lokasi</th>
                </tr>
              </thead>
              <tbody>
                {baris.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Tidak ada tanggal untuk pilihan ini.</td></tr>
                )}
                {baris.map((r) => {
                  const w = WARNA_SEL[r.status];
                  const kosong = r.status === STATUS.KOSONG;
                  return (
                    <tr key={r.tanggal} className={kosong ? 'bg-rose-50/40' : r.status === OFF ? 'bg-slate-50 text-slate-500' : 'hover:bg-sky-50/50'}>
                      <td className={td + ' text-center text-slate-400 bg-slate-50'}>{r.no}</td>
                      <td className={td + ' whitespace-nowrap text-slate-900'}>{tglTampil(r.tanggal)}</td>
                      <td className={td + ' whitespace-nowrap ' + (r.minggu ? 'text-rose-600' : 'text-slate-600')}>{r.hari}</td>
                      <td className={td + ' whitespace-nowrap font-medium'} style={{ background: w.bg, color: w.fg }}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ background: w.titik }} />
                          {r.statusLabel}
                        </span>
                      </td>
                      <td className={td + ' text-center ' + (r.masuk ? 'text-slate-900' : r.sebelah ? 'text-rose-600' : 'text-slate-300')}>
                        {r.masuk || '—'}
                      </td>
                      <td className={td + ' text-center ' + (r.pulang ? 'text-slate-900' : r.sebelah ? 'text-rose-600' : 'text-slate-300')}>
                        {r.pulang || '—'}
                      </td>
                      <td className={td + ' whitespace-nowrap text-slate-700'}>{r.standby}</td>
                      <td className={td + ' text-slate-600 min-w-[160px] ' + (r.sebelah ? 'text-rose-700' : '')}>{r.keterangan}</td>
                      <td className={td + ' border-r-0 text-slate-500 min-w-[220px] max-w-[340px]'}>{r.lokasi}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
