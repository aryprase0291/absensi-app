// =====================================================================
// LOGIN LEWAT SUPABASE — FASE 1
//
// Mencoba jalur baru lebih dulu, dan JATUH KE APPS SCRIPT pada setiap
// keadaan yang tidak benar-benar berhasil. Itulah seluruh nilai file ini:
// jalur lama tetap menjadi jaring pengaman, sehingga menyalakan fitur ini
// bukan taruhan.
//
// TIGA KEADAAN YANG SENGAJA DIBEDAKAN
//
//   1. Berhasil               -> pakai jawabannya, selesai.
//   2. FALLBACK_APPS_SCRIPT   -> Edge Function sengaja menyerah, karena
//                                kasusnya butuh gerbang perangkat lengkap
//                                (perangkat baru, ikatan baru, kuota,
//                                diblokir). Ulangi ke Apps Script.
//   3. Gagal / lambat / mati  -> sama: ulangi ke Apps Script.
//
// Yang TIDAK boleh diulang adalah kasus "username/password salah". Kalau
// itu ikut dilempar ke Apps Script, karyawan menunggu dua kali lebih lama
// hanya untuk mendapat penolakan yang sama — dan setiap salah ketik
// menjadi dua eksekusi Apps Script, persis beban yang sedang dikurangi.
// =====================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_AKTIF, SUPABASE_BATAS_MS } from '../config/constants';

/**
 * @returns {Promise<?Object>} respons login berbentuk SAMA PERSIS dengan
 *          handleLogin Apps Script, atau `null` yang berarti
 *          "jangan pakai jalur ini, ulangi ke Apps Script".
 */
export async function loginLewatSupabase(muatan) {
  if (!SUPABASE_AKTIF) return null;

  // AbortController, bukan sekadar Promise.race: tanpa ini request yang
  // sudah tidak ditunggu tetap berjalan di latar belakang dan tetap
  // menerbitkan sesi baru — yang justru akan menggusur sesi dari login
  // Apps Script yang sedang menggantikannya.
  const pembatal = new AbortController();
  const timer = setTimeout(() => pembatal.abort(), SUPABASE_BATAS_MS);

  try {
    const res = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/login', {
      method: 'POST',
      signal: pembatal.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify(muatan)
    });

    if (!res.ok) return null;

    const data = await res.json();

    if (data && data.result === 'success' && data.user && data.user.token) {
      return data;
    }

    // Penolakan yang MEMANG jawabannya — bukan kegagalan jalur.
    // Dikembalikan apa adanya supaya tidak diulang ke Apps Script.
    if (data && data.result === 'error' && data.code !== 'FALLBACK_APPS_SCRIPT' && data.message) {
      return data;
    }

    return null;
  } catch (e) {
    // Termasuk abort karena batas waktu, jaringan mati, dan CORS.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
