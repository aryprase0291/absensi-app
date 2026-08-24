// =======================================================
// TAB "IMPORT dbabsen" DI ADMIN PANEL
//
// Alur: pilih satu atau beberapa file .xlsx hasil download mesin absen ->
// file dibaca di browser -> seluruh isinya digabung jadi satu kumpulan
// baris -> ditampilkan pratinjau -> baru dikirim ke Apps Script secara
// bertahap (chunk) -> backend menimpa sheet tujuan.
//
// Beberapa file digabung SEBELUM dikirim, bukan diimpor satu per satu.
// Alasannya: kalau tiap file jadi satu import sendiri, import kedua yang
// gagal meninggalkan sheet tujuan dalam keadaan setengah jadi. Dengan
// digabung, tetap berlaku jaminan yang sama seperti satu file — sheet
// baru disentuh pada potongan terakhir.
//
// [Agu 2026] PENGIRIMANNYA SUDAH TIDAK LAGI DI SINI. Loop chunk pindah
// ke <ImportJobProvider> (context/ImportJobContext.js) yang hidup di akar
// aplikasi, sehingga admin boleh menutup layar ini dan memakai menu lain
// selagi import berjalan; hasilnya muncul sebagai notifikasi. Komponen ini
// tinggal mengurus: pilih file -> baca -> pratinjau -> picu job.
//
// [Agu 2026] SHEET TUJUAN BUKAN CUMA dbabsen. Tiap TAB di file sumber
// (mis. "NON-SHIFT", "SHIFT") dicocokkan otomatis ke salah satu sheet
// tujuan yang terdaftar di MasterData (kategori 'SheetImport') — admin
// bisa menambah sheet tujuan baru dari Admin Panel > Master Data tanpa
// perlu perubahan kode. dbabsen selalu jadi tujuan default kalau tidak
// ada yang cocok. Deteksi otomatis ini boleh ditimpa manual per tab lewat
// dropdown di bagian "Rute tujuan per sheet sumber" — bagian itu cuma
// muncul kalau memang ada lebih dari satu sheet tujuan terdaftar, supaya
// alur yang paling umum (semua ke dbabsen) tetap sesederhana sebelumnya.
// =======================================================

import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, UploadCloud, FileSpreadsheet, AlertTriangle, CheckCircle, Loader2, X, Plus, Route
} from 'lucide-react';
import { parseWorkbook, KOLOM_SUMBER, JUMLAH_KOLOM, IDX } from './importDbAbsenParser';
import { useImportJob } from '../context/ImportJobContext';

// Sheet tujuan yang selalu ada, apa pun isi MasterData — ini yang dipakai
// sistem sejak awal (StatsIndex.gs, dashboard, dst semuanya baca dbabsen),
// jadi tidak boleh hilang meski admin belum sempat mengisi kategori
// 'SheetImport' di MasterData.
const DEFAULT_TARGET = 'dbabsen';
const DEFAULT_TARGET_LABEL = 'Normal (dbabsen)';

function tglTampil(ymd) {
  if (!ymd) return '-';
  const p = ymd.split('-');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : ymd;
}

/** Identitas file, supaya file yang sama tidak terbaca dua kali. */
function kunciFile(f) {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

/** Identitas satu TAB di dalam kumpulan file terpilih. */
function kunciSumber(s) {
  return `${s.file}||${s.nama}`;
}

/** Nama tab -> bentuk yang bisa dibandingkan apa adanya (tanpa spasi/strip). */
function normalisasiNama(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Sheet tujuan mana yang cocok untuk satu TAB SUMBER, berdasarkan
 * kecocokan PERSIS (bukan "mengandung") antara nama tab dan `value`
 * salah satu entri di daftar tujuan.
 *
 * Sengaja persis, bukan substring: file mesin sungguhan punya tab
 * "NON-SHIFT" DAN "SHIFT" sekaligus. Kalau dicocokkan dengan
 * `includes('shift')`, "NON-SHIFT" ikut kebawa ke sheet "shift" karena
 * sama-sama mengandung kata itu — persis kebalikan dari yang dimaksud.
 * Kecocokan persis (setelah dirapikan dari spasi/strip) membedakan
 * keduanya dengan benar.
 */
function deteksiTujuan(namaTabSumber, daftarTujuan) {
  const target = normalisasiNama(namaTabSumber);
  const cocok = daftarTujuan.find(
    (t) => t.value !== DEFAULT_TARGET && normalisasiNama(t.value) === target
  );
  return cocok ? cocok.value : DEFAULT_TARGET;
}

const EKSTENSI_DITERIMA = ['.xlsx', '.xls', '.csv'];

/**
 * Penyaring untuk file yang DI-DRAG. Lewat tombol pilih, atribut `accept`
 * sudah menyaring di tingkat sistem; drag-and-drop tidak punya penyaring
 * itu, jadi apa pun bisa jatuh ke sini — termasuk PDF, gambar, atau folder.
 * Tanpa penyaringan, XLSX.read() akan melempar error mentah yang tidak
 * memberi tahu apa pun soal penyebabnya.
 */
function ekstensiCocok(f) {
  const n = (f.name || '').toLowerCase();
  return EKSTENSI_DITERIMA.some((e) => n.endsWith(e));
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

export default function ImportDbAbsen({ user, masterData }) {
  const [daftarFile, setDaftarFile] = useState([]);  // File[]
  const [sumberSheets, setSumberSheets] = useState([]); // {file, nama, aoa}[] — hasil baca mentah semua tab
  const [overrideTujuan, setOverrideTujuan] = useState({}); // kunciSumber -> value sheet tujuan pilihan admin
  const [mode, setMode] = useState('upsert');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [membaca, setMembaca] = useState(false);
  const [pesan, setPesan] = useState(null);          // { tipe, teks } — hanya error lokal (baca file / validasi)
  const [seret, setSeret] = useState(false);         // ada file melayang di atas kotak
  const inputRef = useRef(null);

  // dragenter/dragleave juga ikut menyala untuk tiap elemen ANAK di dalam
  // kotak. Kalau hanya memakai boolean, sorotan berkedip setiap kali kursor
  // melewati ikon atau teks di dalamnya. Penghitung ini yang menahannya:
  // baru dianggap keluar setelah semua enter berpasangan dengan leave.
  const hitungSeret = useRef(0);

  // Kemajuan dan hasil import TIDAK disimpan di komponen ini lagi:
  // begitu admin pindah menu, state lokal ikut hilang. Sumbernya sekarang
  // provider di akar aplikasi.
  const { job, mulaiImport, sedangJalan } = useImportJob();
  const mengirim = sedangJalan;
  const progres = job.progres;

  // --- DAFTAR SHEET TUJUAN ---
  // dbabsen selalu ada dan selalu pertama. Sisanya datang dari MasterData
  // kategori 'SheetImport' (diatur admin lewat tab Master Data) — value
  // dipakai sebagai nama sheet Google SEKALIGUS kata kunci pencocokan nama
  // tab sumber, label untuk teks yang dilihat admin.
  const daftarSheetTujuan = useMemo(() => {
    const tambahan = (masterData?.sheetImport || [])
      .filter((m) => m.value && String(m.value).trim().toLowerCase() !== DEFAULT_TARGET)
      .map((m) => ({ value: String(m.value).trim(), label: m.label || m.value }));

    // dedup berdasar value (huruf kecil semua) — entri belakangan menang,
    // konsisten dengan cara MasterData dibaca di tempat lain.
    const peta = new Map();
    [{ value: DEFAULT_TARGET, label: DEFAULT_TARGET_LABEL }, ...tambahan]
      .forEach((t) => peta.set(t.value.toLowerCase(), t));
    return Array.from(peta.values());
  }, [masterData]);

  const adaTujuanLain = daftarSheetTujuan.length > 1;

  const labelTujuan = (value) => {
    const t = daftarSheetTujuan.find((x) => x.value === value);
    return t ? t.label : value;
  };

  const kosongkanInput = () => {
    // Tanpa ini, memilih file yang sama dua kali berturut-turut tidak
    // memicu onChange sama sekali.
    if (inputRef.current) inputRef.current.value = '';
  };

  const reset = () => {
    setDaftarFile([]); setSumberSheets([]); setOverrideTujuan({}); setKonfirmasi('');
    setPesan(null);
    kosongkanInput();
  };

  /**
   * Seluruh daftar dibaca ulang dari nol setiap kali berubah, bukan
   * ditambal. Lebih boros sedikit, tapi hasil pratinjau selalu cocok
   * dengan daftar yang terlihat — termasuk setelah satu file dihapus.
   *
   * Bedanya dengan versi lama: di sini cuma menyimpan tab MENTAH
   * (sumberSheets). Deteksi tujuan + parseWorkbook per kelompok dihitung
   * lewat useMemo di bawah, supaya mengubah override tujuan tidak perlu
   * membaca ulang file dari disk.
   */
  const bacaSemua = async (files) => {
    setMembaca(true);
    setPesan(null);
    setSumberSheets([]);

    try {
      const semuaSheet = [];
      for (const f of files) {
        semuaSheet.push(...await bacaSatuFile(f));
      }
      setSumberSheets(semuaSheet);
    } catch (err) {
      setPesan({ tipe: 'error', teks: 'Gagal membaca file: ' + err.message });
      setSumberSheets([]);
    } finally {
      setMembaca(false);
    }
  };

  // --- ANOTASI TUJUAN PER TAB SUMBER ---
  const sumberBeranotasi = useMemo(() => {
    return sumberSheets.map((s) => {
      const key = kunciSumber(s);
      const auto = deteksiTujuan(s.nama, daftarSheetTujuan);
      const override = overrideTujuan[key];
      const valid = override && daftarSheetTujuan.some((t) => t.value === override);
      return { ...s, key, auto, target: valid ? override : auto };
    });
  }, [sumberSheets, overrideTujuan, daftarSheetTujuan]);

  // --- PARSING PER KELOMPOK TUJUAN ---
  // parseWorkbook() dipanggil sekali per sheet tujuan yang punya sumber,
  // bukan sekali untuk semuanya — supaya deteksi duplikat
  // No.Akun+tanggal tidak menyilang antar sheet tujuan yang berbeda
  // (baris "SHIFT" dan "NON-SHIFT" untuk kunci yang sama bukan duplikat,
  // dua populasi berbeda yang kebetulan sama tanggalnya).
  const hasilPerTarget = useMemo(() => {
    const kelompok = new Map();
    sumberBeranotasi.forEach((s) => {
      if (!kelompok.has(s.target)) kelompok.set(s.target, []);
      kelompok.get(s.target).push(s);
    });
    const out = {};
    kelompok.forEach((entries, target) => {
      out[target] = parseWorkbook(entries);
    });
    return out;
  }, [sumberBeranotasi]);

  // Urut sesuai daftarSheetTujuan (dbabsen selalu pertama) supaya kartu
  // pratinjau dan ringkasan konsisten antar render.
  const targetList = useMemo(() => {
    return daftarSheetTujuan
      .map((t) => t.value)
      .filter((v) => hasilPerTarget[v] && hasilPerTarget[v].baris.length > 0);
  }, [daftarSheetTujuan, hasilPerTarget]);

  const totalBarisSemua = targetList.reduce((n, t) => n + hasilPerTarget[t].baris.length, 0);

  // Ringkasan per file, digabung dari SEMUA kelompok tujuan — dipakai di
  // daftar file supaya angkanya tetap benar walau satu file punya tab
  // yang tersebar ke lebih dari satu sheet tujuan.
  const perFileGabungan = useMemo(() => {
    const peta = new Map();
    targetList.forEach((t) => {
      hasilPerTarget[t].perFile.forEach((f) => {
        const cur = peta.get(f.nama) || { nama: f.nama, diterima: 0, dilewati: 0, sheets: 0 };
        cur.diterima += f.diterima;
        cur.dilewati += f.dilewati;
        cur.sheets += f.sheets;
        peta.set(f.nama, cur);
      });
    });
    return peta;
  }, [targetList, hasilPerTarget]);

  // Pesan "tidak ada baris terbaca" — dihitung, bukan disimpan lewat
  // setPesan, supaya tetap akurat walau override tujuan berubah setelah
  // pembacaan file selesai.
  const tidakAdaBarisTerbaca = !membaca && sumberSheets.length > 0 && totalBarisSemua === 0;

  /**
   * Jalur masuk tunggal untuk file baru — dipakai tombol pilih MAUPUN
   * drag-and-drop, supaya keduanya tidak pernah berbeda perilaku.
   */
  const tambahFile = async (dipilih) => {
    if (dipilih.length === 0) return;

    // Yang salah format dibuang di sini, tapi disebut namanya. Membuang
    // diam-diam membuat orang mengira file-nya terbaca padahal tidak.
    const salahFormat = dipilih.filter((f) => !ekstensiCocok(f));
    const cocok = dipilih.filter(ekstensiCocok);

    if (cocok.length === 0) {
      setPesan({
        tipe: 'error',
        teks: `Format tidak didukung: ${salahFormat.map((f) => f.name).join(', ')}. ` +
              `Hanya ${EKSTENSI_DITERIMA.join(' / ')} yang bisa dibaca.`
      });
      return;
    }

    const sudahAda = new Set(daftarFile.map(kunciFile));
    const baru = cocok.filter((f) => !sudahAda.has(kunciFile(f)));

    if (baru.length === 0) {
      setPesan({ tipe: 'error', teks: 'File itu sudah ada di daftar.' });
      return;
    }

    const gabungan = [...daftarFile, ...baru];
    setDaftarFile(gabungan);
    await bacaSemua(gabungan);

    // Peringatan format ditampilkan SETELAH pembacaan, supaya tidak
    // langsung tertimpa oleh setPesan(null) di dalam bacaSemua().
    if (salahFormat.length > 0) {
      setPesan({
        tipe: 'error',
        teks: `${salahFormat.length} file dilewati karena formatnya tidak didukung: ` +
              salahFormat.map((f) => f.name).join(', ')
      });
    }
  };

  const handlePilihFile = async (e) => {
    const dipilih = Array.from(e.target.files || []);
    kosongkanInput();
    await tambahFile(dipilih);
  };

  // --- DRAG AND DROP ---
  const bolehTerima = !membaca && !mengirim;

  const onDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!bolehTerima) return;
    hitungSeret.current += 1;
    setSeret(true);
  };

  const onDragOver = (e) => {
    // Wajib. Tanpa preventDefault di dragover, event 'drop' TIDAK PERNAH
    // dipicu browser — ini penyebab paling umum dropzone "tidak berfungsi".
    e.preventDefault(); e.stopPropagation();
    if (bolehTerima) e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    hitungSeret.current = Math.max(0, hitungSeret.current - 1);
    if (hitungSeret.current === 0) setSeret(false);
  };

  const onDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    hitungSeret.current = 0;
    setSeret(false);
    if (!bolehTerima) return;
    await tambahFile(Array.from(e.dataTransfer.files || []));
  };

  // Menjatuhkan file di LUAR kotak akan membuat browser membuka file itu
  // dan meninggalkan halaman. Sejak import berjalan di latar, itu bukan
  // gangguan kecil lagi: halaman yang ditinggalkan memutus import yang
  // sedang jalan. Jadi drop di mana pun selain kotak diabaikan.
  useEffect(() => {
    const tahan = (e) => { e.preventDefault(); };
    window.addEventListener('dragover', tahan);
    window.addEventListener('drop', tahan);
    return () => {
      window.removeEventListener('dragover', tahan);
      window.removeEventListener('drop', tahan);
    };
  }, []);

  const handleHapusFile = async (f) => {
    const sisa = daftarFile.filter((x) => kunciFile(x) !== kunciFile(f));
    setDaftarFile(sisa);
    if (sisa.length === 0) {
      setSumberSheets([]);
      setOverrideTujuan({});
      setPesan(null);
      return;
    }
    await bacaSemua(sisa);
  };

  const handleImport = () => {
    if (totalBarisSemua === 0) return;

    if (mode === 'replace' && konfirmasi.trim().toUpperCase() !== 'GANTI') {
      setPesan({ tipe: 'error', teks: 'Ketik GANTI pada kotak konfirmasi dulu.' });
      return;
    }

    const asal = daftarFile.length > 1 ? `${daftarFile.length} file` : 'file ini';
    const rincian = targetList
      .map((t) => `• ${hasilPerTarget[t].baris.length} baris → sheet ${labelTujuan(t)}`)
      .join('\n');

    const kalimat = (mode === 'replace'
      ? `SELURUH isi tiap sheet tujuan di bawah akan dihapus dan diganti data dari ${asal}:\n${rincian}`
      : `Data dari ${asal} akan dimasukkan ke ${targetList.length > 1 ? 'sheet-sheet' : 'sheet'} berikut:\n${rincian}\n\n` +
        `Baris lama dengan No. Akun + tanggal yang sama (per sheet) akan ditimpa, sisanya tetap.`)
      + '\n\nImport berjalan di latar — Anda boleh menutup layar ini dan memakai menu lain. '
      + 'Tapi JANGAN menutup atau me-reload tab browser sampai notifikasi selesai muncul.'
      + '\n\nLanjutkan?';
    if (!window.confirm(kalimat)) return;

    setPesan(null);

    const kelompok = targetList.map((t) => ({
      targetSheet: t,
      label: labelTujuan(t),
      baris: hasilPerTarget[t].baris
    }));

    const jadi = mulaiImport(kelompok, mode, daftarFile.length);
    if (!jadi) {
      setPesan({ tipe: 'error', teks: 'Masih ada import lain yang sedang berjalan. Tunggu sampai selesai.' });
    }
  };

  if (user && String(user.role).toLowerCase() !== 'admin') {
    return (
      <div className="bg-white p-5 rounded-xl border border-gray-200 text-sm text-slate-500">
        Fitur import hanya untuk admin.
      </div>
    );
  }

  const adaFile = daftarFile.length > 0;
  const banyakFile = daftarFile.length > 1;

  return (
    <div className="space-y-4 animate-in fade-in duration-300">

      {/* JOB YANG SEDANG BERJALAN — ditampilkan juga di sini supaya admin
          yang kembali ke layar ini tahu ada import yang belum kelar. */}
      {mengirim && (
        <div className="bg-slate-900 text-white rounded-xl p-4 flex gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-blue-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold">
              Import sedang berjalan — {progres}%
              {job.totalKelompok > 1 && ` · sheet ${job.kelompokAktif}`}
            </p>
            <div className="mt-2 h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full transition-all duration-300" style={{ width: `${progres}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 tabular-nums">
              {job.chunkSelesai}/{job.totalChunk} bagian · {job.jumlahBaris} baris ·
              {job.totalKelompok > 1 && ` sheet ${job.kelompokSelesai}/${job.totalKelompok} ·`}
              {' '}mode {job.mode === 'replace' ? 'ganti total' : 'perbarui'}
            </p>
          </div>
        </div>
      )}

      {/* PILIH / TARIK FILE */}
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
          <div
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
              ${seret
                ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/40'}`}
          >
            {membaca ? (
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
            ) : seret ? (
              <UploadCloud className="w-8 h-8 text-blue-600 mx-auto" />
            ) : adaFile ? (
              <Plus className="w-8 h-8 text-slate-400 mx-auto" />
            ) : (
              <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
            )}

            <p className={`mt-2 text-sm font-bold ${seret ? 'text-blue-700' : 'text-slate-700'}`}>
              {membaca
                ? 'Membaca file…'
                : seret
                  ? 'Lepaskan di sini'
                  : adaFile ? 'Tambah file lagi' : 'Tarik file ke sini atau klik'}
            </p>

            {/* Kalau cuma dbabsen yang terdaftar, tampilkan seperti dulu.
                Begitu admin menambah sheet tujuan lain di MasterData, teks
                ini ikut menyebutkan bahwa tujuannya dideteksi otomatis. */}
            <p className="text-[11px] text-slate-400 mt-1">
              {membaca ? (
                'Sebentar…'
              ) : adaTujuanLain ? (
                <>.xlsx · .xls · .csv &nbsp;→&nbsp; sheet terdeteksi otomatis per tab
                  ({daftarSheetTujuan.map((t) => t.label).join(', ')})</>
              ) : (
                <>.xlsx · .xls · .csv &nbsp;→&nbsp; sheet <code className="bg-slate-100 text-slate-600 px-1 rounded">dbabsen</code></>
              )}
            </p>
          </div>
        </label>

        {adaFile && (
          <div className="mt-3 space-y-1.5">
            {daftarFile.map((f) => {
              const ringkas = perFileGabungan.get(f.name);
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

      {tidakAdaBarisTerbaca && (
        <div className="p-4 rounded-xl border flex gap-3 text-xs bg-red-50 border-red-200 text-red-800">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="font-bold">
            Tidak ada baris yang bisa dibaca. Pastikan file punya baris header
            dengan kolom NIK., Tanggal, dan Symbol.
          </p>
        </div>
      )}

      {/* RUTE TUJUAN PER SHEET SUMBER — hanya muncul kalau memang ada
          sheet tujuan selain dbabsen terdaftar. Alur paling umum (semua
          otomatis ke dbabsen) tidak perlu melihat bagian ini sama sekali. */}
      {adaTujuanLain && sumberBeranotasi.length > 0 && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-3">
          <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
            <Route className="w-4 h-4 text-slate-400" /> Rute tujuan per sheet sumber
          </h3>
          <p className="text-[11px] text-slate-400 -mt-2">
            Otomatis dari nama tab di file. Ubah lewat pilihan di kanan kalau deteksinya salah.
          </p>
          <div className="space-y-1.5">
            {sumberBeranotasi.map((s) => (
              <div key={s.key} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-700 truncate">{s.nama}</p>
                  {banyakFile && <p className="text-[10px] text-slate-400 truncate">{s.file}</p>}
                </div>
                <select
                  className="text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white shrink-0"
                  value={overrideTujuan[s.key] || ''}
                  onChange={(e) => setOverrideTujuan((prev) => ({ ...prev, [s.key]: e.target.value }))}
                  disabled={mengirim}
                >
                  <option value="">Otomatis ({labelTujuan(s.auto)})</option>
                  {daftarSheetTujuan.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PRATINJAU — satu kartu per sheet tujuan yang punya baris. Kalau
          semuanya jatuh ke dbabsen (kasus paling umum), yang tampil cuma
          satu kartu, persis seperti sebelum fitur ini ada. */}
      {targetList.map((target) => (
        <PratinjauTarget
          key={target}
          label={labelTujuan(target)}
          tampilkanLabel={targetList.length > 1}
          hasil={hasilPerTarget[target]}
          banyakFile={banyakFile}
          jumlahFile={daftarFile.length}
        />
      ))}

      {/* MODE + TOMBOL — satu kontrol untuk seluruh import ini, berlaku
          sama ke semua sheet tujuan yang terlibat. Memecahnya per-sheet
          akan menambah pilihan yang jarang dibutuhkan; kalau perlu mode
          berbeda per sheet, import-nya cukup dipisah jadi dua kali. */}
      {totalBarisSemua > 0 && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="font-extrabold text-slate-800 text-sm">
            Cara menulis
            {targetList.length > 1 && (
              <span className="ml-1.5 font-medium text-slate-400">berlaku untuk semua sheet tujuan</span>
            )}
          </h3>

          <label className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'upsert' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
            <input type="radio" name="mode" checked={mode === 'upsert'} onChange={() => setMode('upsert')} className="mt-1" />
            <div className="text-xs">
              <p className="font-bold text-slate-800">Perbarui periode ini saja</p>
              <p className="text-slate-500 mt-0.5">
                Baris lama dengan No. Akun + tanggal yang sama (per sheet) ditimpa —
                termasuk kalau NIK, nama, jam, atau symbol-nya sudah berubah.
                Data lain tetap utuh.
              </p>
            </div>
          </label>

          <label className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'replace' ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}>
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1" />
            <div className="text-xs">
              <p className="font-bold text-slate-800">
                Ganti seluruh isi {targetList.length > 1 ? 'tiap sheet tujuan' : 'sheet tujuan'}
              </p>
              <p className="text-slate-500 mt-0.5">
                Semua baris lama di sheet itu dibuang. Pakai ini hanya kalau
                {banyakFile ? ' kumpulan file ini berisi' : ' file ini berisi'} seluruh
                data yang Anda perlukan untuk sheet tersebut.
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

          <button
            onClick={handleImport}
            disabled={mengirim || (mode === 'replace' && konfirmasi.trim().toUpperCase() !== 'GANTI')}
            className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-slate-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
          >
            {mengirim
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Import sedang berjalan…</>
              : <><Upload className="w-4 h-4" /> Import {totalBarisSemua} baris
                  {targetList.length > 1 ? ` ke ${targetList.length} sheet` : ` ke ${labelTujuan(targetList[0])}`}
                </>}
          </button>
        </div>
      )}

      {/* PESAN LOKAL — gagal baca file / validasi. Hasil import sendiri
          dilaporkan oleh notifikasi global, bukan di sini. */}
      {pesan && (
        <div className={`p-4 rounded-xl border flex gap-3 text-xs ${pesan.tipe === 'sukses' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {pesan.tipe === 'sukses'
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <div><p className="font-bold">{pesan.teks}</p></div>
        </div>
      )}

      {/* HASIL IMPORT TERAKHIR — tetap terbaca di layar ini walau notifikasi
          melayangnya sudah ditutup admin. Satu blok per sheet tujuan. */}
      {!mengirim && (job.status === 'sukses' || job.status === 'gagal') && (
        <div className={`p-4 rounded-xl border flex gap-3 text-xs ${job.status === 'sukses' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {job.status === 'sukses'
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {job.status === 'sukses' ? 'Import terakhir selesai.' : job.pesan}
            </p>
            {job.status === 'sukses' && (job.ringkasanList || []).map((r, i) => (
              <div key={i} className={(job.ringkasanList.length > 1) ? 'mt-2 pt-2 border-t border-green-100 first:border-t-0 first:pt-0 first:mt-2' : 'mt-2'}>
                {job.ringkasanList.length > 1 && (
                  <p className="font-bold text-green-800 text-[11px] uppercase tracking-wide">{r.label}</p>
                )}
                <ul className="mt-0.5 space-y-0.5 text-green-700">
                  <li>Baris dari file: {r.barisBaru}</li>
                  {r.mode === 'upsert' && (
                    <>
                      <li>Baris lama ditimpa: {r.barisDitimpa}</li>
                      <li>Baris lama dipertahankan: {r.barisDipertahankan}</li>
                    </>
                  )}
                  <li className="font-bold">Total {r.label} sekarang: {r.totalBaris}</li>
                </ul>
              </div>
            ))}
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
          Urutan kolom harus persis seperti ini — berlaku untuk semua sheet tujuan.
          Baris header boleh muncul berulang di tengah file.
        </p>
        {adaTujuanLain && (
          <p className="mt-2 text-slate-400">
            Sheet tujuan diatur di Admin Panel &gt; Master Data, kategori
            "Sheet tujuan import mesin absen". Value = nama sheet Google
            sekaligus kata kunci pencocokan nama tab sumber (persis, tanpa
            spasi/strip); label = teks yang tampil di sini.
          </p>
        )}
      </details>
    </div>
  );
}

/** Satu kartu pratinjau, dipakai berulang — satu per sheet tujuan. */
function PratinjauTarget({ label, tampilkanLabel, hasil, banyakFile, jumlahFile }) {
  const adaData = hasil && hasil.baris.length > 0;
  if (!adaData) return null;

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-4">
      <h3 className="font-extrabold text-slate-800 text-sm">
        Pratinjau
        {tampilkanLabel && <span className="ml-1.5 text-slate-500">→ {label}</span>}
        {banyakFile && (
          <span className="ml-1.5 font-medium text-slate-400">
            gabungan {jumlahFile} file
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
            {hasil.duplikat} baris punya kombinasi No. Akun + tanggal yang sama dengan
            baris lain{banyakFile ? ' di kumpulan file ini' : ' di file ini'} untuk sheet tujuan
            yang sama. Yang dibaca belakangan dipakai, yang sebelumnya dibuang — jadi angka
            "baris terbaca" di atas sudah bersih dari duplikat.
          </Peringatan>

          <details className="text-xs mt-2">
            <summary className="cursor-pointer font-bold text-amber-700">
              Lihat {hasil.duplikat} baris yang bertabrakan
            </summary>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {hasil.bentrok.slice(0, 50).map((b, i) => (
                <div key={i} className="bg-amber-50 border border-amber-100 px-2 py-1 rounded">
                  <span className="font-bold">
                    {b.akun ? `Akun ${b.akun}` : `NIK ${b.nik}`} · {tglTampil(b.tanggal)}
                  </span>
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
