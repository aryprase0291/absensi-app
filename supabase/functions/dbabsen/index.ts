// =====================================================================
// dbabsen — FASE 2
//
// Satu Edge Function, dua jenis pemanggil, dua gerbang yang berbeda:
//
//   Browser admin  -> impor_potongan / impor_commit / impor_batal
//                     Diverifikasi TOKEN (role admin). Apps Script
//                     sengaja dikeluarkan dari jalur import: di sanalah
//                     seluruh kelambatannya berada — tiap potongan dulu
//                     satu eksekusi Apps Script plus commit ke sheet.
//
//   Apps Script    -> riwayat / statistik / tarik
//                     Diverifikasi RAHASIA SINKRON, seperti Fase 1.
//
// KENAPA `riwayat` TIDAK dipanggil browser langsung. handleGetDbAbsen
// tidak cuma membaca dbabsen — ia menggabungkannya dengan absensi online
// dari sheet `Absensi`, yang belum pindah ke sini. Kalau browser memanggil
// endpoint ini sendiri, penggabungan itu hilang dan kalender Data Absen
// kehilangan baris absen online. Jadi yang diganti HANYA penyisiran
// sheet dbabsen-nya: 6.700 baris x 19 kolom menjadi satu kueri berindeks
// yang mengembalikan puluhan baris.
// =====================================================================

import { klienAdmin, jawab, CORS, rahasiaSinkronSah } from "../_bersama/util.ts";
import { bacaToken } from "../_bersama/token.ts";

// Simbol yang dihitung HADIR. Disalin dari IDX_HADIR_SYMBOLS di
// apps-script/StatsIndex.gs. Kalau salah satu berubah, yang lain WAJIB
// ikut — kalau tidak, dashboard dan rekap akan berbeda angka tanpa ada
// yang error.
const SIMBOL_HADIR = [
  "H", "I", "T", "TPC", "PC", "Si", "So", "TSi", "TSo", "SiSo", "SiPC", "DL", "ONL",
];

const SIMBOL_TANPA_SCAN_MASUK = ["Si", "TSi", "SiPC", "SiSo"];
const SIMBOL_TANPA_SCAN_PULANG = ["So", "TSo", "SiSo"];

// Batas satu potongan import. Angka yang sama dipakai layar import.
const BATAS_BARIS_POTONGAN = 5000;

/** Cerminan parseTimeToMinutes() di apps-script/Code.gs. */
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

interface BarisDbAbsen {
  no_akun: string; nik: string; nama: string; tanggal: string;
  jam_kerja: string; masuk: string; pulang: string; telat: string;
  symbol: string; waktu_scan: string; minggu: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const aksi = String(body.aksi || "").trim();

    const dariAppsScript = rahasiaSinkronSah(req);

    // --- Gerbang token: hanya untuk jalur import dari browser ---------
    let peran = "";
    if (!dariAppsScript) {
      const rahasia = Deno.env.get("AUTH_SECRET") || "";
      const token = await bacaToken(body.token, rahasia);
      if (!token) {
        // Bentuk jawabannya disamakan dengan Apps Script supaya fetchApi
        // di App.js memperlakukannya seperti biasa.
        return jawab({ result: "error", code: "AUTH_REQUIRED", message: "Sesi Anda sudah berakhir. Silakan login ulang." });
      }
      peran = token.r;
    }

    const db = klienAdmin();

    // =================================================================
    // IMPORT — browser admin, atau Apps Script saat menyemai isi sheet
    // =================================================================
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

      // impor_commit
      const mode = String(body.mode || "upsert");
      const { data, error } = await db.rpc("impor_dbabsen_commit", { p: { sesi, mode } });
      if (error) throw error;
      return jawab({ result: "success", stage: "done", ...data });
    }

    // =================================================================
    // Sisanya HANYA untuk Apps Script.
    // =================================================================
    if (!dariAppsScript) {
      return jawab({ result: "error", message: "Tidak berwenang." }, 401);
    }

    // --- Riwayat mesin satu karyawan ---------------------------------
    if (aksi === "riwayat") {
      const nik = String(body.nik || "").trim();
      if (!nik) return jawab({ result: "success", list: [] });

      const { data, error } = await db
        .from("db_absen")
        .select("no_akun,nik,nama,tanggal,jam_kerja,masuk,pulang,telat,symbol,waktu_scan,minggu")
        .eq("nik", nik)
        .order("tanggal", { ascending: false })
        .limit(2000);
      if (error) throw error;

      return jawab({ result: "success", list: data || [] });
    }

    // --- Agregat statistik satu karyawan -----------------------------
    //
    // Sengaja dihitung di sini dengan perulangan, BUKAN dengan SQL
    // agregat. Aturannya (simbol mana hadir, kapan telat dihitung dua
    // kali, tanggal mana masuk penyebut) disalin baris per baris dari
    // _susunIndeksDbAbsen di StatsIndex.gs, dan dalam bentuk yang sama
    // ia bisa dibandingkan langsung dengan aslinya. SQL agregat akan
    // lebih cepat, tapi perbedaannya nol koma sekian detik untuk
    // beberapa puluh baris — tidak sepadan dengan risiko salah tafsir
    // pada angka yang dipakai payroll.
    if (aksi === "statistik") {
      const nik = String(body.nik || "").trim();
      const dari = String(body.dari || "").trim();
      const sampai = String(body.sampai || "").trim();
      if (!nik || !dari || !sampai) {
        return jawab({ result: "error", message: "nik, dari, dan sampai wajib diisi." });
      }

      const { data, error } = await db
        .from("db_absen")
        .select("tanggal,symbol,telat")
        .eq("nik", nik)
        .gte("tanggal", dari)
        .lte("tanggal", sampai);
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
        // Tanggal Postgres adalah YYYY-MM-DD murni, tanpa jam dan tanpa
        // zona — jadi tidak ada lagi pergeseran hari seperti saat nilai
        // sheet dibaca sebagai Date lalu diformat ulang.
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

        if (symbol.indexOf("T") !== -1 ||
            (telat && telat !== "00:00:00" && telat !== "-" && telat !== "FALSE")) {
          if (symbol.indexOf("T") !== -1) e.telat_freq++;
          e.telat_menit += menitDariJam(telat);
        }

        if (SIMBOL_TANPA_SCAN_MASUK.indexOf(symbol) !== -1) e.no_scan_in++;
        if (SIMBOL_TANPA_SCAN_PULANG.indexOf(symbol) !== -1) e.no_scan_out++;
      }

      return jawab({ result: "success", stats: e });
    }

    // --- Tarikan bertahap untuk cermin sheet --------------------------
    if (aksi === "tarik") {
      const sejak = String(body.sejak || "1970-01-01T00:00:00Z");
      const batas = Math.min(Number(body.batas) || 2000, 5000);
      // Tumpang tindih 5 detik, alasannya sama dengan sesi-terbaru:
      // jam Postgres dan Apps Script tidak dijamin sama persis.
      const sejakLonggar = new Date(new Date(sejak).getTime() - 5000).toISOString();

      const { data, error } = await db
        .from("db_absen")
        .select("*")
        .gt("diperbarui_pada", sejakLonggar)
        .order("diperbarui_pada", { ascending: true })
        .limit(batas);
      if (error) throw error;

      const baris = (data || []) as Array<Record<string, unknown>>;
      return jawab({
        result: "success",
        baris,
        sampai: baris.length ? baris[baris.length - 1].diperbarui_pada : sejak,
        terpotong: baris.length >= batas,
      });
    }

    // --- Jumlah baris, untuk pembuktian setelah migrasi ---------------
    if (aksi === "hitung") {
      const { count, error } = await db
        .from("db_absen")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return jawab({ result: "success", total: count || 0 });
    }

    return jawab({ result: "error", message: "Aksi tidak dikenal: " + aksi }, 400);
  } catch (e) {
    console.error("dbabsen gagal: " + (e as Error).message);
    return jawab({ result: "error", message: (e as Error).message }, 500);
  }
});
