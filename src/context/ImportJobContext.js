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
// Catatan yang tidak boleh hilang: 'import_db_absen' adalah action TULIS.
// Request yang gagal TIDAK BOLEH diulang otomatis — tulisnya mungkin
// sudah berhasil di server dan hanya responsnya yang rusak. Itu sebabnya
// file ini memakai fetch sendiri, bukan fetchApi() yang punya retry.
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

          for (let i = 0; i < totalChunkKelompok; i++) {
            const potongan = baris.slice(i * UKURAN_CHUNK, (i + 1) * UKURAN_CHUNK);

            const res = await kirimSekali({
              action: 'import_db_absen',
              sessionId,
              chunkIndex: i,
              totalChunks: totalChunkKelompok,
              mode,
              targetSheet,
              rows: potongan
            });

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
