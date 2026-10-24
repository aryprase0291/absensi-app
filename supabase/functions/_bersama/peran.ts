// =====================================================================
// PERAN EFEKTIF (24 Okt 2026)
//
// Token membawa KODE role apa adanya dari kolom Role sheet Users
// (mis. "hrd_sby"). Aturan keamanan bekerja dengan TINGKAT
// (admin / hrd / manager / ... / karyawan). Tabel master_role
// menerjemahkan keduanya. Kode yang tidak terdaftar dipakai apa adanya
// sebagai tingkat — perilaku sebelum master role ada.
//
// Cerminan peranEfektif_() di apps-script/MasterRole.gs.
// =====================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface Peran {
  kode: string;
  nama: string;
  tingkat: string;
  lokasi: string[]; // [] = ikut lokasi user, ['*'] = semua
  menu: string[];
  terdaftar: boolean;
}

export async function peranDari(db: SupabaseClient, kodeRole: string): Promise<Peran> {
  const kode = String(kodeRole || "").trim().toLowerCase();
  const { data } = await db.from("master_role")
    .select("kode,nama,tingkat,lokasi,menu,aktif").eq("kode", kode).maybeSingle();
  if (!data) return { kode, nama: kode, tingkat: kode, lokasi: [], menu: [], terdaftar: false };
  // Role dinonaktifkan -> paling rendah. Lebih aman menurunkan hak daripada
  // membiarkan role yang sengaja dimatikan tetap berkuasa.
  if (!data.aktif) return { kode, nama: data.nama, tingkat: "karyawan", lokasi: [], menu: [], terdaftar: true };
  return {
    kode,
    nama: data.nama,
    tingkat: data.tingkat,
    lokasi: Array.isArray(data.lokasi) ? data.lokasi : [],
    menu: Array.isArray(data.menu) ? data.menu : [],
    terdaftar: true,
  };
}

/** Cakupan lokasi sebagai teks untuk token/klien: 'All' | 'Surabaya' | 'Surabaya,Jakarta'. */
export function cakupanLokasi(peran: Peran, lokasiUser: string): string {
  if (peran.lokasi.includes("*")) return "All";
  if (peran.lokasi.length) return peran.lokasi.join(",");
  return String(lokasiUser || "All");
}
