# Anti-Fake GPS — Deteksi & Blokir Manipulasi Lokasi

Ditulis 7 Sep 2026, setelah muncul indikasi seorang karyawan memakai aplikasi
Fake GPS untuk absen masuk/pulang.

---

## Masalahnya bukan "belum ada deteksi"

`src/utils/antiFakeGps.js` sudah ada sejak sebelumnya dan `handleSubmit` sudah
memblokir kalau `gpsValidation.isMock` bernilai true. Yang jadi masalah:

**Backend menerima `isMockGps` dan `gpsAccuracy`, lalu membuangnya.** Tidak
divalidasi, tidak disimpan. Seluruh proteksi hanya hidup di browser.

Akibatnya proteksi itu bisa dilewati dengan tiga cara sepele:

1. Ubah satu baris JavaScript lewat DevTools.
2. Kirim POST langsung ke URL Apps Script dengan `isMockGps: false`.
3. Pakai override lokasi di DevTools, yang tidak menyalakan `navigator.webdriver`.

Server tidak punya cara membedakan absen asli dari ketiganya.

---

## Tiga lapis pertahanan

| Lapis | Berkas | Bisa dipalsukan? |
|---|---|---|
| 1. Browser | `src/utils/antiFakeGps.js` | **Ya.** Anggap selalu bisa. Fungsinya mengumpulkan bukti, bukan memutuskan. |
| 2. Server | `apps-script/AntiFakeGps.gs` | **Tidak.** Memakai riwayat absensi karyawan yang tidak dikirim browser. |
| 3. Forensik | Sheet `GpsAudit` | Mencatat semua percobaan, termasuk yang ditolak. |

Keputusan menolak absen **hanya** ada di lapis 2.

---

## Yang diperiksa

### Cukup untuk MEMBLOKIR sendirian (skor 100)

- Flag Mock Location dari perangkat
- Akurasi 0 meter — mustahil pada perangkat asli
- Koordinat 0,0 (Null Island) — default banyak emulator
- Presisi koordinat < 4 desimal — indikasi diketik manual
- Browser berjalan di mode otomasi (Selenium/Puppeteer)
- **Perpindahan mustahil** — > 250 km/jam dihitung dari absen sebelumnya

### Menandai untuk ditinjau, tidak memblokir

| Sinyal | Skor |
|---|---|
| Koordinat identik ≥ 90% riwayat, tak dipakai karyawan lain | 50 |
| Jitter nol — dua pembacaan sama persis | 45 |
| Akurasi > 500 m | 60 |
| Timestamp GPS meleset > 45 detik | 30 |
| Koordinat identik berturut tanpa pola dominan | 25 |
| Akurasi > 200 m (indikasi lokasi jaringan) | 15 |

Ambang: **≥ 100 ditolak**, **≥ 50 ditandai TINJAU**, **≥ 20 WASPADA**.
Semua angka terkumpul di `GPS_AMBANG` pada `AntiFakeGps.gs`.

---

## Dua keputusan desain yang penting

### 1. Koordinat identik TIDAK PERNAH cukup untuk memblokir sendirian

Di dalam gedung, Chrome jatuh ke *network positioning*: daftar WiFi dikirim ke
layanan lokasi Google, dan yang kembali adalah satu koordinat dari basis data.
Selama titik akses WiFi-nya sama, **koordinatnya identik setiap kali** — tanpa
ada aplikasi palsu di perangkat.

Memblokir karena pola ini berarti menuduh setiap orang yang absen dari dalam
gedung. Bobotnya sengaja diset 50 (= ambang TINJAU), bukan 100.

### 2. Pembanding lintas-karyawan

Pembeda paling jujur antara Fake GPS dan lokasi WiFi:

> Apakah karyawan lain juga pernah tercatat di koordinat yang sama persis?

- **Ya** → titik lokasi jaringan kantor. Wajar. Tidak diberi skor sama sekali.
- **Tidak ada satu pun** → pin pribadi. Baru diberi skor.

Diimplementasikan di `_gpsPemakaiLain()`. Ini yang mencegah satu kantor penuh
kena tuduhan palsu.

---

## Jitter: sinyal terkuat yang tersedia di browser

`getVerifiedGeolocation()` sekarang mengambil **dua** pembacaan berjeda 1,2 detik
dan mengukur jaraknya.

GPS asli selalu bergetar — sensor, geometri satelit, dan filter penghalus membuat
dua pembacaan berturut praktis mustahil identik sampai digit terakhir. Aplikasi
Fake GPS mengunci satu titik dan mengembalikan angka yang sama persis.

Harganya: pembukaan form absen bertambah ~1,2 detik. Itu memang harga yang
dibayar untuk satu-satunya sinyal kuat yang bisa didapat dari dalam browser.

Kalau pembacaan kedua gagal atau timeout, jitter dicatat `null` dan **tidak
dihukum**. Sinyal yang hilang tidak boleh berubah jadi tuduhan.

---

## Penyimpanan

### Sheet `Absensi` — 4 kolom baru

`GPS Akurasi`, `GPS Skor`, `GPS Level`, `GPS Alasan`.

Kolom dicari **berdasarkan nama header**, bukan index tetap
(`tulisKolomAuditAbsensi`). Ini disengaja: sheet Absensi sudah memakai kolom Q
(Catatan Admin, index 16) dan V (ID Akun, index 21) di luar 16 kolom yang ditulis
`appendRow`. Menambah elemen ke `appendRow` akan **menimpa Catatan Admin**.

### Sheet `GpsAudit` — dibuat otomatis

Satu baris per percobaan absen, termasuk yang **ditolak**. Percobaan yang ditolak
tidak pernah masuk sheet Absensi, jadi tanpa sheet ini HRD tidak akan pernah tahu
ada yang mencoba.

Berisi: koordinat, akurasi, skor, level, keputusan, alasan, jarak geofence,
kecepatan, jitter, device ID, platform, user agent.

---

## Panel HRD/Admin

**Panel Administrator → Monitoring Integritas GPS**

- **Tab Kejadian** — per-percobaan, real time, termasuk yang ditolak.
- **Tab Analisa Riwayat** — per-karyawan, memindai seluruh sheet Absensi yang
  sudah ada. Inilah yang menjawab "siapa saja yang polanya mencurigakan selama
  ini", tanpa perlu menunggu data baru.

Kolom **"Dipakai karyawan lain"** adalah yang harus dibaca lebih dulu sebelum
menyimpulkan apa pun.

Alternatif tanpa aplikasi: jalankan `tulisLaporanAuditGpsKeSheet()` dari editor
Apps Script — hasilnya ditulis ke sheet `LaporanAuditGPS`.

---

## Uji

```bash
node scripts/test-antifakegps.js
```

15 kasus, memuat `AntiFakeGps.gs` apa adanya dalam sandbox dengan SpreadsheetApp
tiruan — jadi yang diuji adalah kode produksi, bukan salinannya.

Enam kasus "harus ditolak", tiga "harus ditandai tapi jangan diblokir", dan enam
**"tidak boleh kena"** — termasuk skenario WiFi kantor dan karyawan lapangan yang
berpindah 40 km dalam 2 jam.

**Jalankan ini setiap kali menyetel `GPS_AMBANG`.** Melonggarkan satu ambang
untuk menangkap satu kasus gampang sekali berubah jadi menuduh sepuluh orang
yang tidak bersalah.

---

## Batas yang harus disadari

Aplikasi ini **web app murni** (React + Apps Script), bukan aplikasi Android
native. Konsekuensinya:

- API Geolocation browser **tidak mengekspos** `isFromMockProvider()` milik
  Android. Flag mock hanya terbaca kalau dibuka lewat WebView yang menyediakannya.
- Override lokasi lewat DevTools tidak menyalakan `navigator.webdriver`. Yang
  menangkapnya adalah jitter nol dan pemeriksaan riwayat di server.

Deteksi mock location yang benar-benar tuntas butuh lapisan native (Capacitor,
TWA, atau APK) yang memanggil `Location.isFromMockProvider()`. Selama masih web
app, pertahanan paling kuat justru **geofence + pemeriksaan riwayat di server** —
bukan deteksi mock itu sendiri.

Geofence saat ini baru aktif sebagian. Memperluas cakupannya memberi hasil lebih
besar daripada menambah heuristik baru.

---

## Berkas yang berubah

| Berkas | Perubahan |
|---|---|
| `apps-script/AntiFakeGps.gs` | **Baru.** Mesin skor, audit historis, endpoint. |
| `apps-script/Code.gs` | Gerbang integritas di `handleAbsen`, 2 action baru di router. |
| `apps-script/Auth.gs` | Daftarkan `get_gps_audit` & `run_gps_audit_historis` (admin/hrd) di `ACTION_ROLES`. **Wajib.** |
| `src/utils/antiFakeGps.js` | Dua sampel + jitter, sidik perangkat, paket bukti. |
| `src/screens/GpsAuditScreen.js` | **Baru.** Panel monitoring. |
| `src/App.js` | Import, rute `gps_audit`, menu di AdminPanel, kirim `gpsBukti`. |
| `scripts/test-antifakegps.js` | **Baru.** 15 kasus uji. |

### Judul kolom sheet GpsAudit

Sheet `GpsAudit` yang sudah terlanjur dibuat SEBELUM kolom `Alamat` ada akan
punya judul lama (18 nama) sementara baris barunya ditulis 19 nilai — kolom
Alamat muncul di bawah judul `Akurasi(m)`. `_pastikanSheetGpsAudit()` kini
memeriksa dan memperbaiki baris judul setiap kali menulis audit.

Baris yang tercatat sebelum perbaikan tetap bergeser satu kolom mulai dari
Alamat. Karena hanya menyangkut baris uji awal, tidak diperbaiki otomatis.

Lihat juga `NAMA-LOKASI.md` — koordinat ditampilkan sebagai nama alamat, dan
sheet `GpsAudit` ikut menyimpan alamat setiap percobaan.

**Deploy:** salin `AntiFakeGps.gs` sebagai file baru di editor Apps Script,
perbarui `Code.gs` dan `Auth.gs`, lalu **Deploy → Kelola deployment → ikon
pensil → Versi: Versi baru → Deploy**. Jangan pakai *Deployment baru* — itu
membuat URL `/exec` berbeda dari yang dipakai aplikasi. Sheet `GpsAudit` dan kolom
audit dibuat otomatis saat absen pertama masuk.
