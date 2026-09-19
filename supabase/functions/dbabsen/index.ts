import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";
import { bacaToken } from "../_bersama/token.ts";

const SIMBOL_HADIR = ["H","I","T","TPC","PC","Si","So","TSi","TSo","SiSo","SiPC","DL","ONL"];
const SIMBOL_TANPA_SCAN_MASUK = ["Si","TSi","SiPC","SiSo"];
const SIMBOL_TANPA_SCAN_PULANG = ["So","TSo","SiSo"];
const BATAS_BARIS_POTONGAN = 5000;
const KOLOM_URUT = "no_akun,nik,nama,tanggal,jam_kerja,mulai_tugas,akhir_tugas,masuk,pulang,telat,pulang_awal,bolos,durasi_kerja,symbol,departemen,att_time,waktu_scan,minggu";

function menitDariJam(nilai: unknown): number {
  if (!nilai || nilai === "-" || nilai === "FALSE") return 0;
  const s = String(nilai);
  if (s.includes(":")) {
    const bagian = s.split(":");
    const j = parseInt(bagian[0], 10) || 0;
    const m = parseInt(bagian[1], 10) || 0;
    return j * 60 + m;
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const aksi = String(body.aksi || "").trim();
    const dariAppsScript = rahasiaSinkronSah(req);

    let peran = "";
    if (!dariAppsScript) {
      const rahasia = Deno.env.get("AUTH_SECRET") || "";
      const token = await bacaToken(body.token, rahasia);
      if (!token) {
        return jawab({ result: "error", code: "AUTH_REQUIRED", message: "Sesi Anda sudah berakhir. Silakan login ulang." });
      }
      peran = token.r;
    }

    const db = klienAdmin();

    if (aksi === "impor_potongan" || aksi === "impor_commit" || aksi === "impor_batal") {
      if (!dariAppsScript && peran !== "admin") {
        return jawab({ result: "error", message: "Hanya Admin yang boleh mengimpor data mesin." });
      }
      const sesi = String(body.sesi || "").trim();
      if (!sesi) return jawab({ result: "error", message: "sesi kosong." });

      if (aksi === "impor_batal") {
        const { data, error } = await db.rpc("impor_dbabsen_batal", { p: { sesi } });
        if (error) throw error;
        return jawab({ result: "success", ...data });
      }
      if (aksi === "impor_potongan") {
        const baris = Array.isArray(body.baris) ? body.baris : [];
        if (baris.length > BATAS_BARIS_POTONGAN) {
          return jawab({ result: "error", message: "Potongan terlalu besar (maks " + BATAS_BARIS_POTONGAN + " baris)." });
        }
        const { data, error } = await db.rpc("impor_dbabsen_potongan", { p: { sesi, baris } });
        if (error) throw error;
        return jawab({ result: "success", stage: "chunk", ...data });
      }
      const mode = String(body.mode || "upsert");
      const { data, error } = await db.rpc("impor_dbabsen_commit", { p: { sesi, mode } });
      if (error) throw error;
      return jawab({ result: "success", stage: "done", ...data });
    }

    if (!dariAppsScript) return jawab({ result: "error", message: "Tidak berwenang." }, 401);

    if (aksi === "riwayat") {
      const nik = String(body.nik || "").trim();
      if (!nik) return jawab({ result: "success", list: [] });
      const { data, error } = await db.from("db_absen")
        .select("no_akun,nik,nama,tanggal,jam_kerja,masuk,pulang,telat,symbol,waktu_scan,minggu")
        .eq("nik", nik).order("tanggal", { ascending: false }).limit(2000);
      if (error) throw error;
      return jawab({ result: "success", list: data || [] });
    }

    if (aksi === "statistik") {
      const nik = String(body.nik || "").trim();
      const dari = String(body.dari || "").trim();
      const sampai = String(body.sampai || "").trim();
      if (!nik || !dari || !sampai) return jawab({ result: "error", message: "nik, dari, dan sampai wajib diisi." });
      const { data, error } = await db.from("db_absen").select("tanggal,symbol,telat")
        .eq("nik", nik).gte("tanggal", dari).lte("tanggal", sampai);
      if (error) throw error;

      const e = {
        hadir: 0, telat_freq: 0, telat_menit: 0, sakit: 0, alpa: 0,
        no_scan_in: 0, no_scan_out: 0,
        min_ts: null as number | null, max_ts: null as number | null,
        alpa_by_date: {} as Record<string, number>,
        hadir_by_date: {} as Record<string, number>,
        hari_by_date: {} as Record<string, number>,
      };
      for (const r of (data || [])) {
        const tanggal = String(r.tanggal);
        const ts = Date.parse(tanggal + "T00:00:00Z");
        if (e.min_ts === null || ts < e.min_ts) e.min_ts = ts;
        if (e.max_ts === null || ts > e.max_ts) e.max_ts = ts;
        e.hari_by_date[tanggal] = 1;
        const symbol = String(r.symbol || "");
        const telat = r.telat;
        if (SIMBOL_HADIR.indexOf(symbol) !== -1) {
          e.hadir++;
          e.hadir_by_date[tanggal] = (e.hadir_by_date[tanggal] || 0) + 1;
        }
        if (symbol === "S") e.sakit++;
        if (symbol === "A" || symbol === "AC") {
          e.alpa++;
          e.alpa_by_date[tanggal] = (e.alpa_by_date[tanggal] || 0) + 1;
        }
        if (symbol.indexOf("T") !== -1 || (telat && telat !== "00:00:00" && telat !== "-" && telat !== "FALSE")) {
          if (symbol.indexOf("T") !== -1) e.telat_freq++;
          e.telat_menit += menitDariJam(telat);
        }
        if (SIMBOL_TANPA_SCAN_MASUK.indexOf(symbol) !== -1) e.no_scan_in++;
        if (SIMBOL_TANPA_SCAN_PULANG.indexOf(symbol) !== -1) e.no_scan_out++;
      }
      return jawab({ result: "success", stats: e });
    }

    // Penanda versi. Dipakai SUPABASE_TARIK_DBABSEN untuk memutuskan
    // apakah sheet perlu ditulis ulang sama sekali — jauh lebih murah
    // daripada menarik ribuan baris hanya untuk menemukan tidak ada yang
    // berubah.
    if (aksi === "versi") {
      const { count, error: e1 } = await db.from("db_absen").select("*", { count: "exact", head: true });
      if (e1) throw e1;
      const { data, error: e2 } = await db.from("db_absen")
        .select("diperbarui_pada").order("diperbarui_pada", { ascending: false }).limit(1);
      if (e2) throw e2;
      return jawab({
        result: "success",
        total: count || 0,
        terbaru: (data && data[0]) ? data[0].diperbarui_pada : "",
      });
    }

    // --- Halaman isi penuh, lewat RPC ---------------------------------
    //
    // MENGGANTIKAN `semua`. Bedanya bukan gaya, tapi jumlah perjalanan:
    //
    //   `semua` memakai PostgREST biasa, yang punya batas keras
    //   db-max-rows = 1.000 baris per permintaan dan TIDAK bisa dinaikkan
    //   dari sisi klien — permintaan 2.000 baris tetap dijawab 1.000.
    //   10.977 baris karena itu butuh 11 halaman + 1 halaman kosong; dari
    //   Apps Script ke Singapura itu ~9-12 detik, hampir seluruhnya
    //   waktu jaringan.
    //
    //   `halaman` memanggil RPC yang membalas SATU nilai jsonb. Batas
    //   db-max-rows menghitung BARIS, dan satu skalar jsonb adalah satu
    //   baris berapa pun isinya — jadi 5.000 record pulang sekali angkut
    //   dan 10.977 baris cukup 3 halaman.
    //
    // Kursornya keyset (kunci, tanggal), bukan offset: (kunci, tanggal)
    // adalah primary key, jadi halaman terakhir sama cepatnya dengan
    // halaman pertama (terukur 0,8 ms lawan 195 ms pada offset 9.000).
    //
    // `semua` sengaja DIBIARKAN hidup di bawah ini. Selama ia masih ada,
    // membatalkan perubahan ini cukup dilakukan di sisi Apps Script —
    // tanpa deploy ulang fungsi ini.
    //
    // RENTANG TANGGAL (19 Sep 2026). `dari`/`sampai` boleh kosong — kalau
    // kosong, seluruh isi ditarik seperti semula. Yang memakainya adalah
    // rekap admin: layar itu selalu punya rentang, dan menarik dua bulan
    // penuh untuk menampilkan satu bulan adalah muatan yang tidak pernah
    // dibaca. Agustus 5.400 baris lawan 10.977 baris seluruh tabel.
    if (aksi === "halaman") {
      const { data, error } = await db.rpc("dbabsen_halaman", {
        p: {
          sesudah_kunci: body.sesudah_kunci ?? null,
          sesudah_tanggal: body.sesudah_tanggal ?? null,
          dari: body.dari ?? null,
          sampai: body.sampai ?? null,
          batas: Math.min(Math.max(Number(body.batas) || 5000, 1), 20000),
        },
      });
      if (error) throw error;
      return jawab({ result: "success", ...data });
    }

    // Jumlah baris untuk SATU rentang — patokan kelengkapan penarikan.
    //
    // Berbeda dengan `versi`, yang menghitung SELURUH tabel dan dipakai
    // cermin sheet untuk memutuskan perlu-tidaknya menulis ulang. Dipakai
    // di sini karena penarikan yang kurang satu halaman tidak menghasilkan
    // error apa pun — ia hanya menghasilkan rekap yang angkanya lebih
    // kecil, dan angka itu dipakai menghitung gaji.
    if (aksi === "jumlah") {
      const { data, error } = await db.rpc("dbabsen_jumlah", {
        p: { dari: body.dari ?? null, sampai: body.sampai ?? null },
      });
      if (error) throw error;
      return jawab({ result: "success", ...data });
    }

    // Halaman isi penuh, URUTANNYA PASTI (kunci, tanggal).
    //
    // Sengaja TIDAK memakai diperbarui_pada sebagai penanda halaman:
    // satu import menulis ribuan baris dengan now() yang sama persis,
    // sehingga penanda waktu tidak pernah maju dan penarikan berputar
    // di halaman yang sama selamanya. offset+urutan tetap tidak punya
    // masalah itu.
    //
    // DIPERTAHANKAN SEBAGAI JALUR MUNDUR. Pemanggil sekarang memakai
    // `halaman` di atas; ini tetap ada supaya rollback tidak perlu
    // menyentuh Edge Function.
    if (aksi === "semua") {
      const offset = Math.max(Number(body.offset) || 0, 0);
      const batas = Math.min(Number(body.batas) || 2000, 5000);
      const { data, error } = await db.from("db_absen")
        .select(KOLOM_URUT)
        .order("kunci", { ascending: true })
        .order("tanggal", { ascending: true })
        .range(offset, offset + batas - 1);
      if (error) throw error;
      const baris = data || [];
      return jawab({ result: "success", baris, offset, jumlah: baris.length, habis: baris.length < batas });
    }

    return jawab({ result: "error", message: "Aksi tidak dikenal: " + aksi }, 400);
  } catch (e) {
    console.error("dbabsen gagal: " + (e as Error).message);
    return jawab({ result: "error", message: (e as Error).message }, 500);
  }
});
