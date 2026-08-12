// =======================================================
// TAB "IMPORT dbabsen" DI ADMIN PANEL
//
// Alur: pilih satu atau beberapa file .xlsx hasil download mesin absen ->
// file dibaca di browser -> seluruh isinya digabung jadi satu kumpulan
// baris -> ditampilkan pratinjau -> baru dikirim ke Apps Script secara
// bertahap (chunk) -> backend menimpa sheet dbabsen.
//
// Beberapa file digabung SEBELUM dikirim, bukan diimpor satu per satu.
// Alasannya: kalau tiap file jadi satu import sendiri, import kedua yang
// gagal meninggalkan dbabsen dalam keadaan setengah jadi. Dengan digabung,
// tetap berlaku jaminan yang sama seperti satu file — sheet baru disentuh
// pada potongan terakhir.
//
// Catatan penting soal pengiriman: action 'import_db_absen' adalah
// action TULIS, jadi permintaan yang gagal TIDAK BOLEH diulang otomatis.
// Karena itu komponen ini memakai fetch-nya sendiri, bukan fetchApi()
// di App.js yang punya logika retry.
// =======================================================

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Loader2, X, Info, Plus
} from 'lucide-react';
import { SCRIPT_URL } from '../config/constants';
import { parseWorkbook, KOLOM_SUMBER, JUMLAH_KOLOM, IDX } from './importDbAbsenParser';

// 400 baris x 18 kolom masih jauh di bawah batas payload Apps Script,
// dan cukup kecil supaya satu eksekusi tidak mendekati batas 6 menit.
const UKURAN_CHUNK = 400;

function buatSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'imp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

async function kirimSekali(payload) {
  let token = '';
  try {
    const saved = sessionStorage.getItem('app_user');
    if (saved) {
      const u = JSON.parse(saved);
      token = (u && u.token) || '';
    }
  } catch (e) { /* biarkan kosong; backend akan menolak */ }

  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ ...payload, token })
  });

  const teks = await res.text();
  try {
    return JSON.parse(teks);
  } catch (e) {
    throw new Error(
      'Server Google membalas halaman, bukan data. ' +
      'JANGAN langsung mengulang — periksa dulu isi sheet dbabsen.'
    );
  }
}

function tglTampil(ymd) {
  if (!ymd) return '-';
  const p = ymd.split('-');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : ymd;
}

/** Identitas file, supaya file yang sama tidak terbaca dua kali. */
function kunciFile(f) {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

/** Satu File -> daftar sheet siap dilempar ke parseWorkbook(). */
async function bacaSatuFile(file) {
  const buf = await file.arrayBuffer();
  // cellDates:true -> sel tanggal & jam jadi objek Date, sisanya
  // dibiarkan mentah supaya normalisasi kita yang menentukan.
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  return wb.SheetNames.map((nama) => ({
    file: file.name,
    nama,
    aoa: XLSX.utils.sheet_to_json(wb.Sheets[nama], {
      header: 1, raw: true, defval: '', blankrows: false
    })
  }));
}

export default function ImportDbAbsen({ user }) {
  const [daftarFile, setDaftarFile] = useState([]);  // File[]
  const [hasil, setHasil] = useState(null);          // hasil parseWorkbook
  const [mode, setMode] = useState('upsert');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [membaca, setMembaca] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  const [progres, setProgres] = useState(0);
  const [pesan, setPesan] = useState(null);          // { tipe, teks }
  const [ringkasanServer, setRingkasanServer] = useState(null);
  const inputRef = useRef(null);

  const kosongkanInput = () => {
    // Tanpa ini, memilih file yang sama dua kali berturut-turut tidak
    // memicu onChange sama sekali.
    if (inputRef.current) inputRef.current.value = '';
  };

  const reset = () => {
    setDaftarFile([]); setHasil(null); setKonfirmasi('');
    setProgres(0); setPesan(null); setRingkasanServer(null);
    kosongkanInput();
  };

  /**
   * Seluruh daftar dibaca ulang dari nol setiap kali berubah, bukan
   * ditambal. Lebih boros sedikit, tapi hasil pratinjau selalu cocok
   * dengan daftar yang terlihat — termasuk setelah satu file dihapus.
   */
  const bacaSemua = async (files) => {
    setMembaca(true);
    setPesan(null);
    setRingkasanServer(null);
    setHasil(null);

    try {
      const semuaSheet = [];
      for (const f of files) {
        semuaSheet.push(...await bacaSatuFile(f));
      }

      const parsed = parseWorkbook(semuaSheet);

      if (parsed.baris.length === 0) {
        setPesan({
          tipe: 'error',
          teks: 'Tidak ada baris yang bisa dibaca. Pastikan file punya baris header ' +
                'dengan kolom NIK., Tanggal, dan Symbol.'
        });
      }
      setHasil(parsed);
    } catch (err) {
      setPesan({ tipe: 'error', teks: 'Gagal membaca file: ' + err.message });
      setHasil(null);
    } finally {
      setMembaca(false);
    }
  };

  const handlePilihFile = async (e) => {
    const dipilih = Array.from(e.target.files || []);
    kosongkanInput();
    if (dipilih.length === 0) return;

    const sudahAda = new Set(daftarFile.map(kunciFile));
    const baru = dipilih.filter((f) => !sudahAda.has(kunciFile(f)));

    if (baru.length === 0) {
      setPesan({ tipe: 'error', teks: 'File itu sudah ada di daftar.' });
      return;
    }

    const gabungan = [...daftarFile, ...baru];
    setDaftarFile(gabungan);
    await bacaSemua(gabungan);
  };

  const handleHapusFile = async (f) => {
    const sisa = daftarFile.filter((x) => kunciFile(x) !== kunciFile(f));
    setDaftarFile(sisa);
    if (sisa.length === 0) {
      setHasil(null);
      setPesan(null);
      return;
    }
    await bacaSemua(sisa);
  };

  const handleImport = async () => {
    if (!hasil || hasil.baris.length === 0) return;

    if (mode === 'replace' && konfirmasi.trim().toUpperCase() !== 'GANTI') {
      setPesan({ tipe: 'error', teks: 'Ketik GANTI pada kotak konfirmasi dulu.' });
      return;
    }

    const asal = daftarFile.length > 1 ? `${daftarFile.length} file` : 'file ini';
    const kalimat = mode === 'replace'
      ? `SELURUH isi sheet dbabsen akan dihapus dan diganti ${hasil.baris.length} baris dari ${asal}. Lanjutkan?`
      : `${hasil.baris.length} baris dari ${asal} akan dimasukkan. Baris lama dengan NIK + tanggal yang sama akan ditimpa, sisanya tetap. Lanjutkan?`;
    if (!window.confirm(kalimat)) return;

    const sessionId = buatSessionId();
    const total = Math.ceil(hasil.baris.length / UKURAN_CHUNK);

    setMengirim(true);
    setPesan(null);
    setRingkasanServer(null);
    setProgres(0);

    try {
      for (let i = 0; i < total; i++) {
        const potongan = hasil.baris.slice(i * UKURAN_CHUNK, (i + 1) * UKURAN_CHUNK);

        const res = await kirimSekali({
          action: 'import_db_absen',
          sessionId,
          chunkIndex: i,
          totalChunks: total,
          mode,
          rows: potongan
        });

        if (res.result !== 'success') {
          const catatan = (i === total - 1)
            ? ' Ini potongan terakhir, jadi periksa sheet dbabsen sebelum mengulang.'
            : ' Sheet dbabsen belum tersentuh, aman untuk diulang dari awal.';
          throw new Error((res.message || 'Ditolak server.') + catatan);
        }

        setProgres(Math.round(((i + 1) / total) * 100));

        if (res.stage === 'done') {
          setRingkasanServer(res);
          setPesan({ tipe: 'sukses', teks: 'Import selesai.' });
        }
      }
    } catch (err) {
      setPesan({ tipe: 'error', teks: err.message });
    } finally {
      setMengirim(false);
    }
  };

  if (user && String(user.role).toLowerCase() !== 'admin') {
    return (
      <div className="bg-white p-5 rounded-xl border border-gray-200 text-sm text-slate-500">
        Fitur import hanya untuk admin.
      </div>
    );
  }

  const adaData = hasil && hasil.baris.length > 0;
  const adaFile = daftarFile.length > 0;
  const banyakFile = daftarFile.length > 1;

  return (
    <div className="space-y-4 animate-in fade-in duration-300">

      {/* PENJELASAN */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <p className="font-bold text-blue-800 mb-1">Import data mesin absen</p>
          Upload file <strong>.xlsx</strong> hasil download mesin absen — boleh
          beberapa file sekaligus, isinya digabung jadi satu import. Hasilnya
          ditulis sebagai nilai statis ke sheet <code className="bg-white px-1 rounded">dbabsen</code>,
          menggantikan formula IMPORTRANGE. Semua sheet di dalam tiap file dibaca
          otomatis; sheet tanpa kolom NIK./Tanggal/Symbol dilewati.
        </div>
      </div>

      {/* PILIH FILE */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
        <label className="block">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={handlePilihFile}
            disabled={membaca || mengirim}
            className="hidden"
          />
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-all">
            {membaca ? (
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
            ) : adaFile ? (
              <Plus className="w-8 h-8 text-slate-400 mx-auto" />
            ) : (
              <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
            )}
            <p className="mt-2 text-sm font-bold text-slate-700">
              {adaFile ? 'Tambah file lagi' : 'Pilih file Excel'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              {membaca
                ? 'Membaca file...'
                : 'Klik untuk memilih — boleh pilih beberapa sekaligus (.xlsx / .xls / .csv)'}
            </p>
          </div>
        </label>

        {adaFile && (
          <div className="mt-3 space-y-1.5">
            {daftarFile.map((f) => {
              const ringkas = hasil && hasil.perFile.find((p) => p.nama === f.name);
              return (
                <div
                  key={kunciFile(f)}
                  className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2"
                >
                  <FileSpreadsheet className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-700 truncate">{f.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {membaca
                        ? 'membaca...'
                        : ringkas
                          ? `${ringkas.diterima} baris · ${ringkas.sheets} sheet` +
                            (ringkas.dilewati > 0 ? ` · ${ringkas.dilewati} dilewati` : '')
                          : 'tidak ada baris terbaca'}
                    </p>
                  </div>
                  {!mengirim && !membaca && (
                    <button
                      onClick={() => handleHapusFile(f)}
                      title="Hapus file ini dari daftar"
                      className="text-slate-400 hover:text-red-600 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {adaFile && !mengirim && (
          <button
            onClick={reset}
            className="mt-3 text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 font-bold"
          >
            <X className="w-3 h-3" /> Bersihkan semua
          </button>
        )}
      </div>

      {/* PRATINJAU */}
      {hasil && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="font-extrabold text-slate-800 text-sm">
            Pratinjau
            {banyakFile && (
              <span className="ml-1.5 font-medium text-slate-400">
                gabungan {daftarFile.length} file
              </span>
            )}
          </h3>

          <div className="grid grid-cols-2 gap-2">
            <Kotak label="Baris terbaca" nilai={hasil.baris.length} />
            <Kotak label="Karyawan (NIK)" nilai={hasil.jumlahNik} />
            <Kotak label="Tanggal awal" nilai={tglTampil(hasil.tanggalMin)} />
            <Kotak label="Tanggal akhir" nilai={tglTampil(hasil.tanggalMaks)} />
          </div>

          {hasil.perSheet.length > 0 && (
            <div className="text-xs">
              <p className="font-bold text-slate-600 mb-1">Per sheet</p>
              <div className="space-y-1">
                {hasil.perSheet.map((s, i) => (
                  <div key={i} className="flex justify-between gap-2 bg-gray-50 px-3 py-1.5 rounded-lg">
                    <span className="text-slate-700 font-medium truncate">
                      {banyakFile && s.file && (
                        <span className="text-slate-400 font-normal">{s.file} · </span>
                      )}
                      {s.nama}
                    </span>
                    <span className="text-slate-500 shrink-0">
                      {s.diterima} baris
                      {s.dilewati > 0 && <span className="text-amber-600"> · {s.dilewati} dilewati</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasil.duplikat > 0 && (
            <div>
              <Peringatan>
                {hasil.duplikat} baris punya kombinasi NIK + tanggal yang sama dengan
                baris lain{banyakFile ? ' di kumpulan file ini' : ' di file ini'}. Yang
                dibaca belakangan dipakai, yang sebelumnya dibuang — jadi angka
                "baris terbaca" di atas sudah bersih dari duplikat.
              </Peringatan>

              <details className="text-xs mt-2">
                <summary className="cursor-pointer font-bold text-amber-700">
                  Lihat {hasil.duplikat} baris yang bertabrakan
                </summary>
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {hasil.bentrok.slice(0, 50).map((b, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-100 px-2 py-1 rounded">
                      <span className="font-bold">{b.nik} · {tglTampil(b.tanggal)}</span>
                      <div className="text-slate-500">
                        dibuang: {b.lama}
                        <br />
                        dipakai: {b.baru}
                      </div>
                    </div>
                  ))}
                  {hasil.bentrok.length > 50 && (
                    <p className="text-slate-400">...dan {hasil.bentrok.length - 50} lainnya</p>
                  )}
                </div>
              </details>
            </div>
          )}

          {hasil.dilewati.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-bold text-amber-700">
                {hasil.dilewati.length} baris dilewati — lihat detail
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {hasil.dilewati.slice(0, 50).map((d, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-100 px-2 py-1 rounded">
                    <span className="font-bold">
                      {banyakFile && d.file ? `${d.file} · ` : ''}{d.sheet} baris {d.baris}
                    </span> — {d.alasan}
                    <div className="text-slate-400 truncate">{d.cuplikan}</div>
                  </div>
                ))}
                {hasil.dilewati.length > 50 && (
                  <p className="text-slate-400">...dan {hasil.dilewati.length - 50} lainnya</p>
                )}
              </div>
            </details>
          )}

          {adaData && (
            <div className="overflow-x-auto">
              <p className="font-bold text-slate-600 mb-1 text-xs">5 baris pertama</p>
              <table className="text-[10px] w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    {['NIK', 'Nama', 'Tanggal', 'Shift', 'Masuk', 'Pulang', 'Symbol'].map((h) => (
                      <th key={h} className="border px-1.5 py-1 text-left font-bold text-slate-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hasil.baris.slice(0, 5).map((r, i) => (
                    <tr key={i} className="odd:bg-white even:bg-gray-50">
                      <td className="border px-1.5 py-1">{r[IDX.NIK]}</td>
                      <td className="border px-1.5 py-1">{r[IDX.NAMA]}</td>
                      <td className="border px-1.5 py-1">{tglTampil(r[IDX.TANGGAL])}</td>
                      <td className="border px-1.5 py-1">{r[IDX.SHIFT]}</td>
                      <td className="border px-1.5 py-1">{r[7]}</td>
                      <td className="border px-1.5 py-1">{r[8]}</td>
                      <td className="border px-1.5 py-1 font-bold">{r[IDX.SYMBOL]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODE + TOMBOL */}
      {adaData && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="font-extrabold text-slate-800 text-sm">Cara menulis</h3>

          <label className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'upsert' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
            <input type="radio" name="mode" checked={mode === 'upsert'} onChange={() => setMode('upsert')} className="mt-1" />
            <div className="text-xs">
              <p className="font-bold text-slate-800">Perbarui periode ini saja</p>
              <p className="text-slate-500 mt-0.5">
                Baris lama dengan NIK + tanggal yang sama ditimpa. Data di luar
                rentang {tglTampil(hasil.tanggalMin)} – {tglTampil(hasil.tanggalMaks)} tetap utuh.
              </p>
            </div>
          </label>

          <label className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'replace' ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}>
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1" />
            <div className="text-xs">
              <p className="font-bold text-slate-800">Ganti seluruh isi dbabsen</p>
              <p className="text-slate-500 mt-0.5">
                Semua baris lama dibuang. Pakai ini hanya kalau
                {banyakFile ? ' kumpulan file ini berisi' : ' file ini berisi'} seluruh
                data yang Anda perlukan.
              </p>
            </div>
          </label>

          {mode === 'replace' && (
            <div>
              <Peringatan>
                Data lama di luar file ini akan hilang permanen. Sebaiknya buat
                salinan spreadsheet dulu.
              </Peringatan>
              <input
                type="text"
                value={konfirmasi}
                onChange={(e) => setKonfirmasi(e.target.value)}
                placeholder='Ketik GANTI untuk mengaktifkan tombol'
                className="mt-2 w-full p-2.5 border border-red-200 rounded-lg text-sm"
              />
            </div>
          )}

          {mengirim && (
            <div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progres}%` }} />
              </div>
              <p className="text-[11px] text-slate-500 mt-1 text-center">
                Mengirim {progres}% — jangan tutup halaman ini
              </p>
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={mengirim || (mode === 'replace' && konfirmasi.trim().toUpperCase() !== 'GANTI')}
            className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-slate-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
          >
            {mengirim
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengimpor...</>
              : <><Upload className="w-4 h-4" /> Import {hasil.baris.length} baris ke dbabsen</>}
          </button>
        </div>
      )}

      {/* PESAN */}
      {pesan && (
        <div className={`p-4 rounded-xl border flex gap-3 text-xs ${pesan.tipe === 'sukses' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {pesan.tipe === 'sukses'
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <div>
            <p className="font-bold">{pesan.teks}</p>
            {ringkasanServer && (
              <ul className="mt-2 space-y-0.5 text-green-700">
                <li>Baris dari file: {ringkasanServer.barisBaru}</li>
                {ringkasanServer.mode === 'upsert' && (
                  <>
                    <li>Baris lama ditimpa: {ringkasanServer.barisDitimpa}</li>
                    <li>Baris lama dipertahankan: {ringkasanServer.barisDipertahankan}</li>
                  </>
                )}
                <li className="font-bold">Total isi dbabsen sekarang: {ringkasanServer.totalBaris}</li>
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ACUAN KOLOM */}
      <details className="bg-white p-4 rounded-xl border border-gray-200 text-xs">
        <summary className="cursor-pointer font-bold text-slate-700">
          Format kolom yang diharapkan ({JUMLAH_KOLOM} kolom)
        </summary>
        <ol className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-500 list-decimal list-inside">
          {KOLOM_SUMBER.map((k, i) => <li key={i}>{k}</li>)}
        </ol>
        <p className="mt-2 text-slate-400">
          Urutan kolom harus persis seperti ini. Baris header boleh muncul
          berulang di tengah file.
        </p>
      </details>
    </div>
  );
}

function Kotak({ label, nilai }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <p className="text-[10px] text-slate-500 font-bold uppercase">{label}</p>
      <p className="text-sm font-extrabold text-slate-800">{nilai}</p>
    </div>
  );
}

function Peringatan({ children }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-800">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
