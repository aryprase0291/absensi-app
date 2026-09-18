// =====================================================================
// IMPORT dbabsen LEWAT SUPABASE — FASE 2
//
// Jalur lamanya: browser -> Apps Script -> sheet sementara -> commit ke
// sheet tujuan. Tiap potongan satu eksekusi Apps Script, dan commit-nya
// menulis ribuan sel. Di situlah seluruh waktunya habis.
//
// Jalur ini: browser -> Edge Function -> Postgres. Sheet menyusul
// belakangan lewat SUPABASE_TARIK_DBABSEN di Apps Script, di latar
// belakang, tanpa admin menunggunya.
//
// KENAPA MENGULANG POTONGAN AMAN DI SINI — dan alasannya BERBEDA dengan
// alasan di ImportJobContext.js. Di sana, yang membuatnya aman adalah
// server mencatat potongan terakhir yang sudah diterapkan. Di sini,
// potongan hanya ditumpuk ke tabel sementara dan baru disaring saat
// commit: `distinct on (kunci, tanggal) ... order by urut desc`. Potongan
// yang terkirim dua kali menghasilkan baris kembar yang isinya sama, dan
// yang terakhir menang — hasil akhirnya identik.
//
// Yang TIDAK boleh diulang adalah commit. Ia memang tidak pernah diulang
// di sini: kegagalan commit dilempar apa adanya ke pemanggil.
// =====================================================================

import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_IMPOR_AKTIF_SAKELAR
} from '../config/constants';

// Sakelarnya sendiri ada di config/constants.js, bersama sakelar login,
// supaya semua sakelar Supabase duduk di satu tempat.
//
// Sengaja TIDAK ikut memeriksa SUPABASE_AKTIF: nilai itu termasuk
// sakelar LOGIN. Kalau login kelak dimatikan, import tidak ada alasan
// ikut mati — keduanya endpoint yang berbeda.
export const SUPABASE_IMPOR_AKTIF =
  !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_IMPOR_AKTIF_SAKELAR);

// Sheet tujuan yang boleh lewat jalur ini. Tabel db_absen hanya mencermin
// sheet `dbabsen`; sheet tujuan lain (mis. 'shift') tidak punya padanan
// di Postgres dan HARUS tetap lewat Apps Script.
const SHEET_DIDUKUNG = ['', 'dbabsen'];

export function supabaseBolehUntuk(targetSheet) {
  if (!SUPABASE_IMPOR_AKTIF) return false;
  return SHEET_DIDUKUNG.indexOf(String(targetSheet || '').trim().toLowerCase()) !== -1;
}

// Urutan kolom file mesin, sama dengan KOLOM_SUMBER di
// importDbAbsenParser.js. Baris sampai di sini sebagai larik 18 elemen;
// Postgres menerimanya sebagai objek bernama supaya urutan tidak pernah
// jadi asumsi diam-diam di dua tempat sekaligus.
const NAMA_KOLOM = [
  'no_akun', 'nik', 'nama', 'tanggal', 'jam_kerja', 'mulai_tugas',
  'akhir_tugas', 'masuk', 'pulang', 'telat', 'pulang_awal', 'bolos',
  'durasi_kerja', 'symbol', 'departemen', 'att_time', 'waktu_scan', 'minggu'
];

const MAKS_ULANG = 3;
const JEDA_ULANG_MS = 800;
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

function ambilToken() {
  try {
    const saved = sessionStorage.getItem('app_user');
    if (!saved) return '';
    const u = JSON.parse(saved);
    return (u && u.token) || '';
  } catch (e) {
    return '';
  }
}

async function panggil(muatan) {
  const res = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/dbabsen', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ ...muatan, token: ambilToken() })
  });

  const teks = await res.text();
  let data;
  try {
    data = JSON.parse(teks);
  } catch (e) {
    throw new Error('Supabase membalas bukan JSON (HTTP ' + res.status + ').');
  }
  if (!res.ok || (data && data.result === 'error')) {
    throw new Error((data && data.message) || 'Supabase menolak (HTTP ' + res.status + ').');
  }
  return data;
}

/** Ubah larik 18 kolom menjadi objek bernama. */
function keObjek(row) {
  const b = {};
  for (let i = 0; i < NAMA_KOLOM.length; i++) {
    const v = row[i];
    b[NAMA_KOLOM[i]] = (v === null || v === undefined) ? '' : String(v);
  }
  return b;
}

/**
 * Kirim satu potongan. Kalau `terakhir` true, commit sekalian dijalankan
 * dan yang dikembalikan adalah ringkasan lengkap — bentuknya sama dengan
 * balasan Apps Script (`stage: 'done'` + barisDitambahkan / barisDiperbarui
 * / barisDitimpa / barisDipertahankan / periodeAwal / periodeAkhir),
 * sehingga layar hasil dan notifikasi tidak perlu tahu import ini lewat
 * jalur yang mana.
 */
export async function kirimPotonganSupabase({ sesi, baris, mode, terakhir }) {
  const muatan = {
    aksi: 'impor_potongan',
    sesi,
    baris: (baris || []).map(keObjek)
  };

  let galatTerakhir = null;
  for (let percobaan = 0; percobaan < MAKS_ULANG; percobaan++) {
    try {
      await panggil(muatan);
      galatTerakhir = null;
      break;
    } catch (e) {
      galatTerakhir = e;
      if (percobaan < MAKS_ULANG - 1) await jeda(JEDA_ULANG_MS * (percobaan + 1));
    }
  }
  if (galatTerakhir) throw galatTerakhir;

  if (!terakhir) return { result: 'success', stage: 'chunk' };

  // Commit TIDAK diulang. Kalau ia gagal, tabel sementara masih utuh dan
  // db_absen belum tersentuh sama sekali — aman diimpor ulang dari awal,
  // dan sisa sesinya dibersihkan sendiri setelah 6 jam.
  const hasil = await panggil({ aksi: 'impor_commit', sesi, mode });
  return { ...hasil, result: 'success', stage: 'done', sumber: 'supabase' };
}

/** Membuang sesi yang ditinggalkan, mis. saat admin membatalkan. */
export async function batalkanImporSupabase(sesi) {
  try {
    await panggil({ aksi: 'impor_batal', sesi });
  } catch (e) {
    // Bukan kegagalan yang perlu dilaporkan: sisa sesi dibersihkan
    // sendiri oleh impor_dbabsen_potongan setelah 6 jam.
  }
}
