// =====================================================================
// Edge Function `master-role` (24 Okt 2026)
//
// Penulis tunggal tabel master_role & master_lokasi.
//
// Pemanggil:
//   - Browser Admin Panel  -> body.token (token login aplikasi), tingkat admin
//   - Apps Script          -> header x-sinkron-rahasia (hanya aksi `semua`)
//
// Aksi:
//   semua                      -> { roles, lokasi, pemakai }   (admin & Apps Script)
//   simpan_role   {role}       -> upsert satu role              (admin)
//   hapus_role    {kode}       -> hapus role yang tidak dipakai (admin)
//   simpan_lokasi {lokasi}     -> upsert satu lokasi            (admin)
//   hapus_lokasi  {kode}       -> hapus lokasi yang tidak dipakai role (admin)
// =====================================================================
import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";
import { bacaToken } from "../_bersama/token.ts";
import { peranDari } from "../_bersama/peran.ts";

const TINGKAT = ["admin", "hrd", "manager", "kepala", "kepala_divisi", "supervisor", "spv", "pimpinan", "karyawan"];
const MENU = ["approval", "respon_laporan", "laporan_semua", "rekap", "info_hrd", "data_karyawan", "gps", "panel_admin"];

const teks = (v: unknown, maks = 200) => String(v ?? "").trim().slice(0, maks);
const daftar = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(","))
  .map((x) => teks(x, 60)).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const aksi = teks(body.aksi, 40);
    const db = klienAdmin();

    // --- Gerbang -------------------------------------------------------
    const dariAppsScript = rahasiaSinkronSah(req);
    let oleh = "Apps Script";
    if (!dariAppsScript) {
      const t = await bacaToken(body.token, Deno.env.get("AUTH_SECRET")!);
      if (!t) return jawab({ result: "error", code: "AUTH_REQUIRED", message: "SESI_HABIS" }, 401);
      const p = await peranDari(db, t.r);
      if (p.tingkat !== "admin") return jawab({ result: "error", message: "Hanya admin yang boleh mengatur master role." }, 403);
      oleh = teks(body.oleh || t.u, 80);
    } else if (aksi !== "semua") {
      return jawab({ result: "error", message: "Apps Script hanya boleh membaca." }, 403);
    }

    if (aksi === "semua") {
      const [r, l, k] = await Promise.all([
        db.from("master_role").select("*").order("urut").order("kode"),
        db.from("master_lokasi").select("*").order("urut").order("kode"),
        db.from("karyawan").select("role,lokasi"),
      ]);
      if (r.error) throw r.error;
      if (l.error) throw l.error;
      // Pemakai per kode role (huruf kecil) + per lokasi mentah di sheet Users.
      const pemakai: Record<string, number> = {};
      const lokasiUser: Record<string, number> = {};
      (k.data || []).forEach((x) => {
        const kode = String(x.role || "").trim().toLowerCase() || "(kosong)";
        pemakai[kode] = (pemakai[kode] || 0) + 1;
        const lok = String(x.lokasi || "").trim() || "(kosong)";
        lokasiUser[lok] = (lokasiUser[lok] || 0) + 1;
      });
      return jawab({ result: "success", roles: r.data || [], lokasi: l.data || [], pemakai, lokasiUser, tingkat: TINGKAT, menu: MENU });
    }

    if (aksi === "simpan_role") {
      const x = body.role || {};
      const kode = teks(x.kode, 40).toLowerCase();
      if (!/^[a-z0-9_]{2,40}$/.test(kode)) return jawab({ result: "error", message: "Kode role hanya huruf kecil, angka, dan _ (2–40 karakter)." });
      const tingkat = teks(x.tingkat, 20).toLowerCase();
      if (!TINGKAT.includes(tingkat)) return jawab({ result: "error", message: "Tingkat tidak dikenal: " + tingkat });
      const { data: lama } = await db.from("master_role").select("sistem,tingkat").eq("kode", kode).maybeSingle();
      if (lama?.sistem && lama.tingkat !== tingkat) return jawab({ result: "error", message: "Tingkat role bawaan '" + kode + "' tidak boleh diganti." });
      if (lama?.sistem && x.aktif === false) return jawab({ result: "error", message: "Role bawaan '" + kode + "' tidak boleh dinonaktifkan." });
      const lokasi = daftar(x.lokasi);
      const menu = daftar(x.menu).filter((m) => MENU.includes(m));
      const baris = {
        kode,
        nama: teks(x.nama, 80) || kode,
        tingkat,
        lokasi: lokasi.includes("*") ? ["*"] : lokasi,
        menu,
        keterangan: teks(x.keterangan, 300),
        urut: Number(x.urut) || 0,
        aktif: x.aktif !== false,
        sistem: !!lama?.sistem,
        diperbarui_pada: new Date().toISOString(),
        diperbarui_oleh: oleh,
      };
      const { error } = await db.from("master_role").upsert(baris, { onConflict: "kode" });
      if (error) throw error;
      return jawab({ result: "success", role: baris });
    }

    if (aksi === "hapus_role") {
      const kode = teks(body.kode, 40).toLowerCase();
      const { data: lama } = await db.from("master_role").select("sistem").eq("kode", kode).maybeSingle();
      if (!lama) return jawab({ result: "error", message: "Role tidak ditemukan." });
      if (lama.sistem) return jawab({ result: "error", message: "Role bawaan tidak bisa dihapus." });
      const { count } = await db.from("karyawan").select("id", { count: "exact", head: true }).ilike("role", kode.replace(/_/g, "\\_"));
      if ((count || 0) > 0) return jawab({ result: "error", message: `Role masih dipakai ${count} karyawan. Ganti dulu role mereka di data karyawan, atau nonaktifkan role ini.` });
      const { error } = await db.from("master_role").delete().eq("kode", kode);
      if (error) throw error;
      return jawab({ result: "success" });
    }

    if (aksi === "simpan_lokasi") {
      const x = body.lokasi || {};
      const kode = teks(x.kode, 60);
      if (!kode || kode === "*" || /,/.test(kode)) return jawab({ result: "error", message: "Nama lokasi tidak sah." });
      const baris = {
        kode,
        nama: teks(x.nama, 80) || kode,
        alias: Array.from(new Set([kode, ...daftar(x.alias)])),
        urut: Number(x.urut) || 0,
        aktif: x.aktif !== false,
        diperbarui_pada: new Date().toISOString(),
        diperbarui_oleh: oleh,
      };
      const { error } = await db.from("master_lokasi").upsert(baris, { onConflict: "kode" });
      if (error) throw error;
      return jawab({ result: "success", lokasi: baris });
    }

    if (aksi === "hapus_lokasi") {
      const kode = teks(body.kode, 60);
      const { data: dipakai } = await db.from("master_role").select("kode").contains("lokasi", [kode]);
      if ((dipakai || []).length) return jawab({ result: "error", message: "Lokasi masih dipakai role: " + dipakai!.map((d) => d.kode).join(", ") });
      const { error } = await db.from("master_lokasi").delete().eq("kode", kode);
      if (error) throw error;
      return jawab({ result: "success" });
    }

    return jawab({ result: "error", message: "Aksi tidak dikenal: " + aksi });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));
    return jawab({ result: "error", message: pesan }, 500);
  }
});
