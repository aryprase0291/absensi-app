// Edge Function `koreksi` (24 Sep 2026)
//
// Hanya dipanggil Apps Script (gerbang: rahasia sinkron). Browser tidak
// pernah memanggilnya langsung — rekap tetap disusun di Apps Script
// karena ia menggabungkan koreksi dengan data mesin dan absen online.
//
// Aksi:
//   daftar  {dari?, sampai?}  -> koreksi yang bersinggungan dengan rentang
//                                (tanpa rentang = semua)
//   simpan  {koreksi}         -> upsert satu baris (id wajib)
//   hapus   {id}              -> hapus satu baris
//   semai   {list}            -> ganti SELURUH isi tabel (penyemaian awal)
//   jumlah  {}                -> jumlah baris (uji)
import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";

const KOLOM = "id,no_akun,payroll,nama,tgl_mulai,tgl_selesai,id2,keterangan,dibuat_pada";
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// deno-lint-ignore no-explicit-any
function keBaris(k: any) {
  const mulai = String(k.tglMulai || k.tgl_mulai || "").slice(0, 10);
  const selesai = String(k.tglSelesai || k.tgl_selesai || mulai).slice(0, 10) || mulai;
  if (!YMD.test(mulai) || !YMD.test(selesai)) throw new Error("Tanggal koreksi tidak sah: " + mulai + " / " + selesai);
  return {
    id: String(k.id || "").trim(),
    no_akun: String(k.noAkun ?? k.no_akun ?? "").trim(),
    payroll: String(k.payroll ?? "").trim(),
    nama: String(k.nama ?? "").trim(),
    tgl_mulai: mulai,
    tgl_selesai: selesai < mulai ? mulai : selesai,
    id2: String(k.id2 || "H").trim().toUpperCase(),
    keterangan: String(k.keterangan ?? "").trim(),
    dibuat_pada: String(k.createdAt ?? k.dibuat_pada ?? "").trim(),
    diperbarui_pada: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!rahasiaSinkronSah(req)) return jawab({ result: "error", message: "Tidak berwenang." }, 401);
    const body = await req.json().catch(() => ({}));
    const aksi = String(body.aksi || "").trim();
    const db = klienAdmin();

    if (aksi === "daftar") {
      const dari = String(body.dari || "").slice(0, 10);
      const sampai = String(body.sampai || "").slice(0, 10);
      let q = db.from("koreksi_absen").select(KOLOM).order("tgl_mulai", { ascending: false }).limit(20000);
      // Bersinggungan: mulai <= sampai DAN selesai >= dari.
      if (YMD.test(sampai)) q = q.lte("tgl_mulai", sampai);
      if (YMD.test(dari)) q = q.gte("tgl_selesai", dari);
      const { data, error } = await q;
      if (error) throw error;
      return jawab({ result: "success", list: data || [] });
    }

    if (aksi === "simpan") {
      const baris = keBaris(body.koreksi || {});
      if (!baris.id) return jawab({ result: "error", message: "id koreksi kosong." });
      const { error } = await db.from("koreksi_absen").upsert(baris, { onConflict: "id" });
      if (error) throw error;
      return jawab({ result: "success", id: baris.id });
    }

    if (aksi === "hapus") {
      const id = String(body.id || "").trim();
      if (!id) return jawab({ result: "error", message: "id koreksi kosong." });
      const { data, error } = await db.from("koreksi_absen").delete().eq("id", id).select("id");
      if (error) throw error;
      return jawab({ result: "success", terhapus: (data || []).length });
    }

    if (aksi === "semai") {
      const list = Array.isArray(body.list) ? body.list : [];
      const baris = list.map(keBaris).filter((b) => b.id);
      const { error: e1 } = await db.from("koreksi_absen").delete().neq("id", "");
      if (e1) throw e1;
      for (let i = 0; i < baris.length; i += 500) {
        const { error } = await db.from("koreksi_absen").upsert(baris.slice(i, i + 500), { onConflict: "id" });
        if (error) throw error;
      }
      return jawab({ result: "success", total: baris.length });
    }

    if (aksi === "jumlah") {
      const { count, error } = await db.from("koreksi_absen").select("id", { count: "exact", head: true });
      if (error) throw error;
      return jawab({ result: "success", total: count || 0 });
    }

    return jawab({ result: "error", message: "Aksi tidak dikenal: " + aksi });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));
    return jawab({ result: "error", message: pesan }, 500);
  }
});
