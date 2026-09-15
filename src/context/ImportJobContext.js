// =======================================================
// JOB IMPORT dbabsen YANG BERJALAN DI LATAR APLIKASI
//
// Sebelumnya loop pengiriman chunk hidup di dalam komponen
// <ImportDbAbsen/>. Konsekuensinya: begitu admin pindah menu, komponen
// di-unmount, setState-nya menghilang, dan admin tidak punya cara tahu
// import-nya sampai mana. Praktis layar itu terkunci sampai selesai.
//
// Sekarang loop-nya dipindah ke provider yang dipasang di akar aplikasi,
// jadi ia tetap hidup walau layar Import ditutup. Layar Import cuma
// jadi tampilan; yang menyimpan kemajuan dan hasil adalah provider ini,
// dan hasil akhirnya muncul sebagai notifikasi di layar mana pun.
//
// BATASnya harus jujur: pengiriman tetap dilakukan oleh browser, bukan
// oleh server. Menutup tab atau me-reload halaman TETAP menghentikan
// import di tengah jalan. Karena itu ada penjaga beforeunload di bawah.
//
// PENGULANGAN POTONGAN — BOLEH, TAPI HANYA UNTUK ACTION INI [15 Sep 2026]
// -----------------------------------------------
// Dulu file ini sengaja memakai fetch sendiri, bukan fetchApi(), supaya
// TIDAK ada pengulangan otomatis: 'import_db_absen' adalah action TULIS,
// dan mengulang tulisan yang sebenarnya sudah berhasil akan menggandakan
// barisnya. Alasan itu benar — selama server tidak tahu potongan mana
// yang sudah masuk.
//
// Masalahnya, tanpa pengulangan sama sekali, import besar nyaris pasti
// gagal. Google membalas HALAMAN HTML alih-alih JSON pada ~1 dari 7
// request. Satu import 4.562 baris = 12 potongan, jadi peluang MINIMAL
// SATU potongan kena balasan HTML adalah 1 - (6/7)^12 ≈ 84%. Admin
// melihatnya sebagai "import selalu gagal", padahal datanya tidak
// bermasalah sedikit pun.
//
// Sejak 1.0.23 server MENGINGAT potongan terakhir yang sudah diterapkan
// (`chunkTerakhir` di apps-script/ImportDbAbsen.gs): potongan yang
// diulang dijawab sukses tanpa ditulis dua kali, dan sesi yang sudah
// selesai menjawab ringkasan yang sama. Karena itu — dan HANYA karena
// itu — pengulangan di bawah aman.
//
// JANGAN menyalin pola ini ke action tulis lain. Yang membuatnya aman
// bukan kode di file ini, melainkan pencatatan di sisi server.
//
// SATU IMPORT, BEBERAPA SHEET TUJUAN [Agu 2026]
// -----------------------------------------------
// Layar Import boleh mendeteksi lebih dari satu sheet tujuan dalam satu
// pengiriman (mis. sebagian baris ke dbabsen, sebagian ke sheet 'shift').
// `mulaiImport` sekarang menerima DAFTAR kelompok — satu kelompok per
// sheet tujuan — dan menjalankannya BERURUTAN (bukan paralel): kelompok
// berikutnya baru dikirim setelah kelompok sebelumnya selesai. Ini bukan
// sekadar pilihan desain — backend memakai satu LockService.getScriptLock()
// global untuk seluruh import, jadi mengirim beberapa kelompok sekaligus
// hanya akan saling menunggu di server. Progres bar tetap satu, dihitung
// dari total potongan SEMUA kelompok gabungan.
// =======================================================

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { SCRIPT_URL } from '../config/constants';

// 400 baris x 18 kolom masih jauh di bawah batas payload Apps Script,
// dan cukup kecil supaya satu eksekusi tidak mendekati batas 6 menit.
export const UKURAN_CHUNK = 400;

// Berapa kali satu potongan boleh dikirim ulang saat Google membalas
// halaman HTML (atau jaringan putus). Tiga sudah menurunkan peluang gagal
// satu import 12 potongan dari ~84% menjadi di bawah 0,5%.
const MAKS_KIRIM_ULANG = 3;
const JEDA_ULANG_MS = 1200;

const JOB_KOSONG = {
  status: 'idle',       // idle | berjalan | sukses | gagal
  progres: 0,           // 0-100, gabungan seluruh kelompok
  chunkSelesai: 0,
  totalChunk: 0,
  jumlahBaris: 0,
  mode: 'upsert',
  jumlahFile: 0,
  pesan: '',
  totalKelompok: 0,     // berapa sheet tujuan terlibat di import ini
  kelompokSelesai: 0,
  kelompokAktif: '',    // label sheet tujuan yang sedang dikirim
  ringkasanList: [],    // [{targetSheet, label, ...hasil server}], terisi progresif
  mulaiPada: null,
  selesaiPada: null,
  dibaca: true,         // false = notifikasi hasil belum ditutup user
};

const ImportJobContext = createContext(null);

export function useImportJob() {
  const ctx = useContext(ImportJobContext);
  if (!ctx) throw new Error('useImportJob dipakai di luar <ImportJobProvider>');
  return ctx;
}

function buatSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'imp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const err = new Error('Server Google membalas halaman, bukan data.');
    err.bukanJson = true;
    throw err;
  }
}

/**
 * Kirim satu potongan, ulangi bila Google membalas halaman atau jaringan
 * putus. Aman HANYA karena server mencatat potongan terakhir yang sudah
 * diterapkan — lihat catatan panjang di kepala file.
 */
async function kirimPotongan(payload, bolehUlang) {
  // Potongan 0 SELALU aman diulang, bahkan pada backend lama: ia memulai
  // sesi dari nol dan me-reset sheet sementara. Potongan berikutnya hanya
  // aman kalau server sudah memasang penanda `idempoten` — lihat catatan
  // di kepala file. Inilah yang membuat urutan deploy tidak mengikat.
  const maks = (payload.chunkIndex === 0 || bolehUlang) ? MAKS_KIRIM_ULANG : 1;
  let terakhir = null;
  for (let percobaan = 1; percobaan <= maks; percobaan++) {
    try {
      return await kirimSekali(payload);
    } catch (e) {
      terakhir = e;
      // Hanya dua keadaan ini yang layak diulang: balasan bukan JSON
      // (halaman interstitial Google) dan kegagalan jaringan murni.
      // Keduanya tidak memberi tahu apa pun tentang isi sheet — dan
      // itulah yang membuat pencatatan di server jadi wajib.
      if (percobaan < maks) {
        console.warn(
          `Potongan ${payload.chunkIndex + 1}/${payload.totalChunks} gagal ` +
          `(percobaan ${percobaan}): ${e.message}. Mengulang…`
        );
        await jeda(JEDA_ULANG_MS * percobaan);
        continue;
      }
    }
  }
  throw new Error(
    (terakhir && terakhir.bukanJson
      ? 'Server Google membalas halaman, bukan data' + (maks > 1 ? ' sebanyak ' + maks + ' kali berturut-turut' : '') + '. '
      : 'Jaringan gagal' + (maks > 1 ? ' ' + maks + ' kali berturut-turut' : '') + '. ') +
    'Sheet tujuan BELUM tersentuh — potongan hanya ditumpuk di sheet sementara sampai potongan terakhir. ' +
    'Aman diulang dari awal.'
  );
}

export function ImportJobProvider({ children }) {
  const [job, setJob] = useState(JOB_KOSONG);

  // Dipakai untuk menolak job kedua yang dimulai sebelum job pertama
  // selesai. State React tidak bisa dipakai untuk ini karena
  // pembacaannya tertinggal satu render dari klik tombol.
  const sedangJalanRef = useRef(false);

  const sedangJalan = job.status === 'berjalan';

  // Penjaga terakhir sebelum data terpotong di tengah. Browser modern
  // mengabaikan teksnya dan memakai dialog bawaannya sendiri, tapi
  // dialognya tetap muncul — itu yang kita butuhkan.
  useEffect(() => {
    if (!sedangJalan) return;
    const cegah = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', cegah);
    return () => window.removeEventListener('beforeunload', cegah);
  }, [sedangJalan]);

  const tutupNotifikasi = useCallback(() => {
    setJob((j) => (j.status === 'berjalan' ? j : { ...j, dibaca: true }));
  }, []);

  const resetJob = useCallback(() => {
    if (sedangJalanRef.current) return;
    setJob(JOB_KOSONG);
  }, []);

  /**
   * Menjalankan import di latar. Fungsi ini SENGAJA tidak di-await oleh
   * pemanggilnya: tombol di layar Import cukup memicunya lalu bebas.
   *
   * @param {Array<{targetSheet:string, label:string, baris:Array<Array>}>} kelompok
   *   Satu entri per sheet tujuan. Dikirim BERURUTAN — lihat catatan di
   *   kepala file soal kenapa tidak paralel.
   * @param {'periode'|'upsert'|'replace'} mode  berlaku sama untuk semua kelompok
   * @param {number} jumlahFile        hanya untuk teks notifikasi
   */
  const mulaiImport = useCallback((kelompok, mode, jumlahFile) => {
    if (sedangJalanRef.current) return false;
    if (!Array.isArray(kelompok) || kelompok.length === 0) return false;

    const isi = kelompok.filter((k) => k && Array.isArray(k.baris) && k.baris.length > 0);
    if (isi.length === 0) return false;

    sedangJalanRef.current = true;

    const jumlahBarisTotal = isi.reduce((n, k) => n + k.baris.length, 0);
    const chunkPerKelompok = isi.map((k) => Math.ceil(k.baris.length / UKURAN_CHUNK));
    const totalChunk = chunkPerKelompok.reduce((n, c) => n + c, 0);

    setJob({
      ...JOB_KOSONG,
      status: 'berjalan',
      totalChunk,
      jumlahBaris: jumlahBarisTotal,
      mode,
      jumlahFile: jumlahFile || 1,
      totalKelompok: isi.length,
      kelompokSelesai: 0,
      kelompokAktif: isi[0].label || isi[0].targetSheet,
      mulaiPada: Date.now(),
      dibaca: false,
    });

    (async () => {
      let chunkSelesaiGlobal = 0;
      const ringkasanList = [];

      try {
        for (let g = 0; g < isi.length; g++) {
          const { targetSheet, label, baris } = isi[g];
          const labelTampil = label || targetSheet;
          const sessionId = buatSessionId();
          const totalChunkKelompok = chunkPerKelompok[g];

          setJob((j) => ({ ...j, kelompokAktif: labelTampil }));

          // Diisi dari balasan potongan pertama. Backend < 1.0.23 tidak
          // mengirimnya, dan di sana pengulangan potongan > 0 memang tidak
          // aman — jadi tetap mati.
          let serverIdempoten = false;

          for (let i = 0; i < totalChunkKelompok; i++) {
            const potongan = baris.slice(i * UKURAN_CHUNK, (i + 1) * UKURAN_CHUNK);

            const res = await kirimPotongan({
              action: 'import_db_absen',
              sessionId,
              chunkIndex: i,
              totalChunks: totalChunkKelompok,
              mode,
              targetSheet,
              rows: potongan
            }, serverIdempoten);

            if (res && res.idempoten === true) serverIdempoten = true;

            if (res.result !== 'success') {
              // Pesannya berbeda tergantung potongan ke berapa yang gagal,
              // karena konsekuensinya ke sheet memang berbeda. Kelompok
              // SEBELUM yang gagal ini sudah tertulis permanen di server —
              // itu tidak bisa "dibatalkan" dari sini, jadi disebutkan.
              const catatan = (i === totalChunkKelompok - 1)
                ? ` Ini potongan terakhir sheet "${labelTampil}", jadi periksa sheet itu sebelum mengulang.`
                : ` Sheet "${labelTampil}" belum tersentuh, aman untuk diulang dari awal.`;
              const sudahJalan = g > 0
                ? ` (${g} sheet sebelumnya sudah selesai tertulis dan TIDAK ikut diulang.)`
                : '';
              throw new Error(`Sheet "${labelTampil}": ` + (res.message || 'Ditolak server.') + catatan + sudahJalan);
            }

            chunkSelesaiGlobal += 1;
            const selesaiSnapshot = chunkSelesaiGlobal;
            setJob((j) => ({
              ...j,
              chunkSelesai: selesaiSnapshot,
              progres: Math.round((selesaiSnapshot / totalChunk) * 100),
            }));

            if (res.stage === 'done') {
              ringkasanList.push({ targetSheet, label: labelTampil, ...res });
              const kelompokSelesaiSnapshot = g + 1;
              setJob((j) => ({
                ...j,
                kelompokSelesai: kelompokSelesaiSnapshot,
                ringkasanList: [...ringkasanList],
              }));
            }
          }
        }

        setJob((j) => ({
          ...j,
          status: 'sukses',
          progres: 100,
          ringkasanList,
          pesan: 'Import selesai.',
          selesaiPada: Date.now(),
          dibaca: false,
        }));

      } catch (err) {
        setJob((j) => ({
          ...j,
          status: 'gagal',
          ringkasanList,
          pesan: err.message || 'Import gagal.',
          selesaiPada: Date.now(),
          dibaca: false,
        }));
      } finally {
        sedangJalanRef.current = false;
      }
    })();

    return true;
  }, []);

  return (
    <ImportJobContext.Provider value={{ job, mulaiImport, tutupNotifikasi, resetJob, sedangJalan }}>
      {children}
    </ImportJobContext.Provider>
  );
}
