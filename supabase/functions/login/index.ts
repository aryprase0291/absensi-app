// =====================================================================
// LOGIN — FASE 1
//
// Menggantikan handleLogin di Apps Script HANYA untuk bentuk login
// sehari-hari. Bentuk respons dibuat sama persis, dan tokennya
// ditandatangani dengan rahasia yang sama, sehingga seluruh endpoint
// Apps Script yang belum dipindahkan tetap menerimanya apa adanya.
//
// YANG SENGAJA TIDAK DIKERJAKAN DI SINI
//
// Gerbang perangkat lengkap (perangkat baru, ikatan baru, kuota penuh,
// pelepasan) ada di Devices.gs, 841 baris, dan sudah teruji. Menyalinnya
// ke sini berarti menduplikasi aturan keamanan di dua tempat — bentuk
// bug yang paling mahal, karena yang satu bisa diperbaiki dan yang lain
// tertinggal tanpa ada yang sadar.
//
// Jadi fungsi ini hanya menangani kasus yang bisa dipastikan aman dari
// dua baris data: perangkat SUDAH dikenal, SUDAH terikat ke akun yang
// sama, dan TIDAK diblokir. Selain itu ia menjawab FALLBACK_APPS_SCRIPT,
// dan aplikasi mengulang loginnya ke Apps Script seperti sebelumnya.
//
// Konsekuensinya: login pertama di sebuah HP tetap lewat jalur lama dan
// tetap selambat dulu. Itu memang yang diinginkan — jalur itu jarang,
// dan di situlah keputusan keamanannya diambil.
// =====================================================================

import { klienAdmin, jawab, CORS } from "../_bersama/util.ts";
import { buatToken, buatSesiId } from "../_bersama/token.ts";

// =====================================================================
// PENCATAT LOG LOGIN
//
// Dicatat HANYA pada hasil yang menentukan: login yang benar-benar
// berhasil, atau kredensial yang benar-benar salah. FALLBACK_APPS_SCRIPT
// SENGAJA tidak dicatat di sini — ia bukan hasil, melainkan penyerahan
// keputusan ke Apps Script, dan di sanalah hasilnya nanti dicatat.
// Mencatat keduanya akan menghitung satu login sebagai dua baris.
//
// Kegagalan mencatat TIDAK BOLEH menggagalkan login. Log ini alat bantu
// admin; karyawan yang mau bekerja tidak boleh tertahan karenanya.
// =====================================================================
async function catatLogin(db: ReturnType<typeof klienAdmin>, req: Request, isi: Record<string, unknown>) {
  try {
    // x-forwarded-for bisa berisi rantai proxy; yang pertama adalah
    // klien aslinya.
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const { error } = await db.from("log_login").insert({
      ip,
      jalur: "supabase",
      ...isi,
    });
    if (error) console.error("log_login gagal: " + error.message);
  } catch (e) {
    console.error("log_login gagal: " + (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const deviceId = String(body.deviceId || "").trim();

    const db = klienAdmin();

    if (!username || !password) {
      await catatLogin(db, req, {
        username, nama: "", karyawan_id: "", berhasil: false,
        sebab: "Username atau password kosong",
        device_id: deviceId, platform: String(body.devicePlatform || ""),
      });
      return jawab({ result: "error", message: "Username/Password salah!" });
    }

    // --- 1. Identitas ------------------------------------------------
    const { data: barisUser, error: galatUser } = await db
      .rpc("login_periksa", { p_username: username, p_password: password });

    if (galatUser) throw galatUser;

    const u = Array.isArray(barisUser) ? barisUser[0] : barisUser;
    if (!u) {
      // Pesannya disamakan dengan Apps Script. Membedakan "username tidak
      // ada" dari "password salah" akan memberi tahu penebak bahwa sebuah
      // username memang terdaftar.
      //
      // Di LOG boleh lebih terus terang: log hanya dibaca admin, dan
      // justru perbedaan inilah yang menunjukkan apakah seseorang
      // menebak-nebak NAMA AKUN atau menebak PASSWORD akun yang ia tahu
      // ada.
      await catatLogin(db, req, {
        username, nama: "", karyawan_id: "", berhasil: false,
        sebab: "Username tidak terdaftar atau password salah",
        device_id: deviceId, platform: String(body.devicePlatform || ""),
      });
      return jawab({ result: "error", message: "Username/Password salah!" });
    }

    // --- 2. Gerbang perangkat: HANYA jalur cepat ---------------------
    // Tanpa deviceId, aturan satu-perangkat tidak bisa dinilai sama
    // sekali. Apps Script punya perlakuan khusus untuk klien lama yang
    // memang tidak mengirimnya; biar jalur itu yang menanganinya.
    if (!deviceId) return jawab({ result: "error", code: "FALLBACK_APPS_SCRIPT" });

    const { data: dev } = await db
      .from("perangkat").select("status").eq("device_id", deviceId).maybeSingle();
    const { data: ikatan } = await db
      .from("perangkat_user").select("status")
      .eq("device_id", deviceId).eq("karyawan_id", u.id).maybeSingle();

    const statusDev = String(dev?.status || "").toLowerCase();
    const statusIkatan = String(ikatan?.status || "").toLowerCase();

    // Perangkat belum dikenal, belum terikat ke akun ini, sudah dilepas,
    // atau diblokir — keempatnya butuh keputusan yang hanya ada di
    // Devices.gs. Termasuk yang diblokir: pesan penolakannya pun disusun
    // di sana, dan percobaannya harus masuk DeviceAudit.
    if (!dev || !ikatan || statusIkatan === "dilepas" || statusDev === "diblokir") {
      return jawab({ result: "error", code: "FALLBACK_APPS_SCRIPT" });
    }

    // --- 3. Sesi tunggal ---------------------------------------------
    // Menulis baris ini SEKALIGUS menggusur sesi di perangkat lain.
    // Apps Script menariknya paling lambat satu menit kemudian.
    const sesiId = buatSesiId();
    const { error: galatSesi } = await db.from("sesi_aktif").upsert({
      karyawan_id: u.id,
      sesi_id: sesiId,
      device_id: deviceId,
      tanda: "",
      diperbarui_pada: new Date().toISOString(),
    });
    // Sesi gagal ditulis = tokennya akan ditolak Apps Script pada request
    // berikutnya. Lebih baik jatuh ke jalur lama sekarang daripada
    // meloloskan login yang sudah pasti mati beberapa detik lagi.
    if (galatSesi) return jawab({ result: "error", code: "FALLBACK_APPS_SCRIPT" });

    // --- 4. Bahan respons --------------------------------------------
    const [areas, master, periode, umum, cfg] = await Promise.all([
      db.from("geofence_area").select("nama,latitude,longitude,radius_meter,aktif")
        .eq("karyawan_id", u.id).eq("aktif", true),
      db.from("master_data").select("kategori,value,label").order("urutan"),
      db.from("periode_absensi").select("id,mulai,selesai,aktif,label").order("mulai", { ascending: false }),
      db.from("pengumuman").select("waktu,isi").eq("aktif", true).order("id", { ascending: false }).limit(1),
      db.from("konfigurasi").select("nilai").eq("kunci", "APP_VERSION").maybeSingle(),
    ]);

    const semuaPeriode = (periode.data || []).map((p) => ({
      id: p.id, mulai: p.mulai, selesai: p.selesai, aktif: p.aktif, label: p.label,
    }));
    const periodeAktif = semuaPeriode.filter((p) => p.aktif);
    const hariIni = new Date().toISOString().slice(0, 10);
    const periodeDefault =
      periodeAktif.find((p) => p.mulai <= hariIni && hariIni <= p.selesai) ||
      periodeAktif[0] || null;

    const token = await buatToken({
      id: u.id,
      sesiId,
      deviceId,
      tanda: "",
      role: u.role || "",
      divisi: u.divisi || "",
      lokasi: u.lokasi || "All",
    }, Deno.env.get("AUTH_SECRET")!);

    await catatLogin(db, req, {
      karyawan_id: u.id, username: u.username, nama: u.nama || "",
      berhasil: true, sebab: "",
      device_id: deviceId, platform: String(body.devicePlatform || ""),
      sesi_id: sesiId,
    });

    // Bentuknya sengaja SAMA PERSIS dengan handleLogin. Kalau ada field
    // yang ditambahkan di sana, tambahkan juga di sini — LoginScreen
    // membaca keduanya dengan kode yang sama.
    return jawab({
      result: "success",
      user: {
        id: u.id,
        username: u.username,
        nama: u.nama,
        divisi: u.divisi,
        role: u.role,
        akses: u.akses ? String(u.akses).split(",") : [],
        noPayroll: u.no_payroll || "-",
        sisaCuti: Number(u.cuti_tersedia || 0),
        cutiTerpakai: Number(u.cuti_terpakai || 0),
        cutiBersama: Number(u.cuti_bersama || 0),
        fotoProfil: u.foto_profil || "",
        perusahaan: u.perusahaan || "-",
        statusKaryawan: u.status_karyawan || "-",
        lokasi: u.lokasi || "All",
        geofenceRequired: !!u.geofence_wajib,
        geofenceAreas: (areas.data || []).map((a) => ({
          nama: a.nama, lat: a.latitude, lng: a.longitude, radius: a.radius_meter,
        })),
        gpsGerbangBebas: !!u.gps_gerbang_bebas,
        perangkatTanda: "",
        perangkatPemilik: "",
        token,
      },
      version: cfg.data?.nilai || "",
      masterData: master.data || [],
      stats: null, // sengaja: Dashboard mengambilnya lewat buka_aplikasi
      gpsTracking: {
        aktif: u.gps_dilacak !== false,
        intervalDetik: Number(u.gps_interval_detik || 300),
        pemberitahuan: u.gps_dilacak !== false
          ? "Lokasi Anda dibagikan ke Admin selama aplikasi ini terbuka."
          : "",
      },
      pengumuman: umum.data && umum.data.length ? umum.data[0] : null,
      pengumumanDisertakan: true,
      periods: semuaPeriode,
      periodsAktif: periodeAktif,
      periodeDefault,
      sumber: "supabase", // untuk diagnosa; frontend tidak bergantung padanya
    });
  } catch (e) {
    // Apa pun yang tidak terduga: lempar ke jalur lama, jangan menahan
    // karyawan di layar login karena sistem yang baru bermasalah.
    console.error("login gagal: " + (e as Error).message);
    return jawab({ result: "error", code: "FALLBACK_APPS_SCRIPT" });
  }
});
