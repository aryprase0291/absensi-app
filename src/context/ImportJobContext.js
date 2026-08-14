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
// =======================================================

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { SCRIPT_URL } from '../config/constants';

// 400 baris x 18 kolom masih jauh di bawah batas payload Apps Script,
// dan cukup kecil supaya satu eksekusi tidak mendekati batas 6 menit.
export const UKURAN_CHUNK = 400;

const JOB_KOSONG = {
  status: 'idle',       // idle | berjalan | sukses | gagal
  progres: 0,           // 0-100
  chunkSelesai: 0,
  totalChunk: 0,
  jumlahBaris: 0,
  mode: 'upsert',
  jumlahFile: 0,
  pesan: '',
  ringkasan: null,      // ringkasan dari server saat stage === 'done'
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
   * @param {Array<Array>} baris  seluruh baris hasil parseWorkbook
   * @param {'upsert'|'replace'} mode
   * @param {number} jumlahFile   hanya untuk teks notifikasi
   */
  const mulaiImport = useCallback((baris, mode, jumlahFile) => {
    if (sedangJalanRef.current) return false;
    if (!baris || baris.length === 0) return false;

    sedangJalanRef.current = true;

    const sessionId = buatSessionId();
    const totalChunk = Math.ceil(baris.length / UKURAN_CHUNK);

    setJob({
      ...JOB_KOSONG,
      status: 'berjalan',
      totalChunk,
      jumlahBaris: baris.length,
      mode,
      jumlahFile: jumlahFile || 1,
      mulaiPada: Date.now(),
      dibaca: false,
    });

    (async () => {
      try {
        for (let i = 0; i < totalChunk; i++) {
          const potongan = baris.slice(i * UKURAN_CHUNK, (i + 1) * UKURAN_CHUNK);

          const res = await kirimSekali({
            action: 'import_db_absen',
            sessionId,
            chunkIndex: i,
            totalChunks: totalChunk,
            mode,
            rows: potongan
          });

          if (res.result !== 'success') {
            // Pesannya berbeda tergantung potongan ke berapa yang gagal,
            // karena konsekuensinya ke sheet memang berbeda.
            const catatan = (i === totalChunk - 1)
              ? ' Ini potongan terakhir, jadi periksa sheet dbabsen sebelum mengulang.'
              : ' Sheet dbabsen belum tersentuh, aman untuk diulang dari awal.';
            throw new Error((res.message || 'Ditolak server.') + catatan);
          }

          const selesai = i + 1;
          setJob((j) => ({
            ...j,
            chunkSelesai: selesai,
            progres: Math.round((selesai / totalChunk) * 100),
          }));

          if (res.stage === 'done') {
            setJob((j) => ({
              ...j,
              status: 'sukses',
              progres: 100,
              ringkasan: res,
              pesan: 'Import selesai.',
              selesaiPada: Date.now(),
              dibaca: false,
            }));
          }
        }

        // Jaring pengaman: kalau server tidak pernah mengirim stage 'done'
        // (mis. versi backend lama), jangan tinggalkan job menggantung
        // di status 'berjalan' selamanya.
        setJob((j) => (j.status === 'berjalan'
          ? { ...j, status: 'sukses', progres: 100, pesan: 'Import selesai.', selesaiPada: Date.now(), dibaca: false }
          : j));

      } catch (err) {
        setJob((j) => ({
          ...j,
          status: 'gagal',
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
