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
| Jitter nol — koordinat sama pada ≥ 2 fix GPS **berbeda** | 20 |
| Jitter nol **+** riwayat berpola pin Fake GPS (saling menguatkan) | +30 |
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

## Jitter: bukti, bukan vonis

### Aturan lama, dan kenapa ia salah tuduh

Sampai 9 Sep 2026 `getVerifiedGeolocation()` membaca posisi **dua kali berjarak
1,2 detik**, lalu mencap **Mock GPS** bila kedua koordinatnya sama persis.
Asumsinya: "GPS asli selalu bergetar."

Asumsi itu **salah pada perangkat modern**, dan sudah terbukti menuduh karyawan
yang tidak memakai Fake GPS sama sekali (dilaporkan 10 Sep 2026, akurasi ±6 m —
justru fix yang bagus). Tiga sebabnya:

1. **Chip GNSS menghasilkan fix ±1 kali per detik.** Meminta posisi 1,2 detik
   kemudian sering mengembalikan **objek fix yang sama**, bukan pembacaan kedua.
   `maximumAge: 0` tidak menolong — ia hanya melarang cache lama, tidak memaksa
   chip menghitung ulang.
2. **Android Fused Location dan CoreLocation iOS menahan posisi saat perangkat
   diam** ("static hold"), justru supaya titiknya tidak melompat-lompat.
   Karyawan yang berdiri diam saat absen adalah kasus yang paling mungkin
   menghasilkan jitter 0,000 m.
3. **Makin bagus lock GPS-nya, makin stabil koordinatnya.** Sinyal paling jujur
   justru yang paling mudah salah tuduh.

### Aturan sekarang

- **Sampel dibedakan dari `position.timestamp`.** Timestamp yang sama = fix yang
  sama dipakai ulang; jitternya dilaporkan `null` (**tidak diketahui**), bukan
  nol, dan tidak dihukum sama sekali.
- **`watchPosition`, bukan getCurrentPosition berulang.** Fix dikirim begitu chip
  menghasilkannya, jadi tidak perlu menebak lama menunggu. Target 3 fix berbeda,
  batas keras **3,5 detik**, dan berhenti **1,2 detik** setelah fix kedua didapat
  (jitter sudah bisa dihitung; fix ketiga hanya memperkuat).
- **Badge merah "Mock GPS" di layar karyawan tidak lagi menyala karena jitter.**
  Yang menyalakannya hanya sinyal keras: flag Mock Location dari sistem,
  lingkungan otomasi, koordinat 0,0, akurasi 0 m, presisi desimal rendah.
- **Bobot di server turun 45 → 20** (level WASPADA: tercatat, tidak pernah cukup
  untuk menyeret seseorang ke TINJAU sendirian).
- **Tetapi jitter nol + riwayat yang sudah mencurigakan = +30 tambahan.** Riwayat
  ada di server dan tidak bisa disentuh dari browser. Ketika keduanya menunjuk
  arah yang sama — titik yang tidak pernah berubah di riwayat DAN tidak bergetar
  saat dibaca — kasus aslinya tetap tertangkap dan tetap diblokir (uji "Pola
  identik DITAMBAH koordinat beku" menghasilkan skor 115).

Harganya: pembukaan form absen bertambah hingga ~3,5 detik pada perangkat yang
menahan posisinya. Itu dibayar untuk menghentikan tuduhan palsu.

Bidang bukti baru yang dikirim klien: `sampelBerbeda` (jumlah fix dengan
timestamp berbeda), `fixTerulang` (berapa kali browser menyerahkan fix yang sama),
dan `jitterNol`. Klien lama yang tidak mengirim `sampelBerbeda` tetap diterima —
tidak ada cara membedakannya secara surut.

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
node scripts/test-antifakegps.js                              # sisi server
CI=true npx react-scripts test --testPathPattern antiFakeGps  # sisi klien
```

16 kasus di sisi server, memuat `AntiFakeGps.gs` apa adanya dalam sandbox dengan
SpreadsheetApp tiruan — jadi yang diuji adalah kode produksi, bukan salinannya.

Enam kasus "harus ditolak", empat "harus ditandai tapi jangan diblokir", dan enam
**"tidak boleh kena"** — termasuk skenario WiFi kantor dan karyawan lapangan yang
berpindah 40 km dalam 2 jam.

12 kasus di sisi klien (`src/utils/antiFakeGps.test.js`) mengunci aturan sampel:
fix dengan timestamp sama tidak boleh dihitung sebagai dua pembacaan, dan jitter
nol tidak boleh menyalakan badge Mock GPS sendirian.

**Jalankan ini setiap kali menyetel `GPS_AMBANG`.** Melonggarkan satu ambang
untuk menangkap satu kasus gampang sekali berubah jadi menuduh sepuluh orang
yang tidak bersalah.

---

## Batas yang harus disadari

Aplikasi ini **web app murni** (React + Apps Script), bukan aplikasi Android
native. Konsekuensinya:

- API Geolocation browser **tidak mengekspos** `isFromMockProvider()` milik
  Android. Flag mock hanya terbaca kalau dibuka lewat WebView yang menyediakannya.
- Override lokasi lewat DevTools tidak menyalakan `navigator.webdriver`. Sejak
  bobot jitter diturunkan, yang benar-benar menangkapnya adalah **pemeriksaan
  riwayat di server** — jitter hanya menguatkannya. Ini konsekuensi yang
  disengaja: menuduh sepuluh karyawan jujur demi menangkap satu pemalsu adalah
  pertukaran yang buruk.

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
| `src/utils/antiFakeGps.js` | Sampel `watchPosition` dibedakan per timestamp, jitter sebagai bukti, sidik perangkat, paket bukti. |
| `src/utils/antiFakeGps.test.js` | **Baru (10 Sep 2026).** 12 uji aturan sampel & anti salah tuduh. |
| `src/screens/GpsAuditScreen.js` | **Baru.** Panel monitoring. |
| `src/App.js` | Import, rute `gps_audit`, menu di AdminPanel, kirim `gpsBukti`. |
| `scripts/test-antifakegps.js` | **Baru.** 16 kasus uji. |

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
