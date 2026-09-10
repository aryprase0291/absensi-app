# PELACAKAN POSISI KARYAWAN & DASHBOARD GPS

Dokumen ini menjelaskan fitur pelacakan posisi yang ditambahkan pada
versi **1.0.16** — apa yang dibangun, cara memasangnya, dan yang
**tidak** bisa dilakukannya. Bagian terakhir itu sama pentingnya:
menjanjikan sesuatu yang tidak dapat dipenuhi teknologi web akan berakhir
sebagai keluhan HRD, bukan sebagai fitur.

---

## 1. RINGKAS

| Kebutuhan | Cara pemenuhannya |
|---|---|
| GPS untuk karyawan yang punya akses absen | Aplikasi mengirim posisi tiap 5 menit selama sesi hidup, plus otomatis saat absen |
| Tetap terkirim saat aplikasi tidak disentuh | Mode standby 1.0.18: sesi 60 menit, layar ditahan menyala, antrian titik offline |
| Menu dashboard untuk memantau | Menu **Dashboard GPS Karyawan** di Panel Administrator |
| Hanya admin yang bisa akses | Gerbang role di `Auth.gs` (`['admin']`, tanpa HRD) + pemeriksaan kedua di handler |
| Posisi terakhir tercatat | Sheet `GpsPosisiTerakhir` — satu baris per karyawan, selalu diperbarui |
| Report di GSheet | Sheet `LaporanGps`, dibuat dari tab **Laporan** di dashboard |
| Tampilan seperti aplikasi GPS umum | Peta OpenStreetMap (Leaflet): marker berinisial, status warna, lingkaran area kantor, jejak perjalanan |

---

## 2. BERKAS YANG DITAMBAH / DIUBAH

**Baru (1.0.18)**

- `src/utils/wakeLock.js` — penahan layar selama pelacakan aktif
- `src/utils/antrianGps.js` — antrian titik yang gagal terkirim (+ 13 uji)
- `handleTrackGpsAntrian` di `apps-script/GpsTracking.gs` — penerima susulan titik

**Baru (1.0.16)**

- `apps-script/GpsTracking.gs` — seluruh mesin pelacakan sisi server
- `src/utils/gpsTracker.js` — pengirim posisi berkala di sisi aplikasi
- `src/screens/GpsDashboardScreen.js` — layar dashboard admin (4 tab)
- `scripts/test-gps-tracking.js` — uji otomatis aturan pencatatan (67 uji per 1.0.18, termasuk 24 uji antrian susulan)

**Diubah (1.0.18)**

- `src/utils/gpsTracker.js` — siklus tidak lagi dilewati saat aplikasi di
  latar, wake lock dinyalakan, titik gagal masuk antrian dan disusulkan
- `src/config/constants.js` — `TIMEOUT_MINUTES` 5 → 60, `TIMEOUT_LABEL`,
  saklar `GPS_WAKE_LOCK_AKTIF`
- `src/App.js` — pesan akhir sesi memakai durasi yang sebenarnya
- `apps-script/Code.gs` — route `track_gps_antrian`, `APP_VERSION` → 1.0.18
- `apps-script/Auth.gs` — izin `'*'` untuk `track_gps_antrian`

**Diubah (1.0.16)**

- `apps-script/Code.gs` — 7 action baru di router, `APP_VERSION` → 1.0.16
- `apps-script/Auth.gs` — izin role untuk action baru
- `src/App.js` — menyalakan pelacak, indikator ke karyawan, menu & route dashboard, ping saat absen
- `updates/{frontend,backend}/releases/1.0.16.json` — catatan rilis

---

## 3. SHEET YANG DIBUAT OTOMATIS

| Sheet | Isi | Pertumbuhan |
|---|---|---|
| `GpsPosisiTerakhir` | Posisi terakhir tiap karyawan | **Tidak tumbuh** — 1 baris per karyawan |
| `GpsTracking` | Jejak perjalanan | Tumbuh, dipangkas otomatis di 45.000 baris |
| `GpsTrackingConfig` | Saklar aktif/nonaktif + interval per karyawan | 1 baris per karyawan yang pernah diatur |
| `LaporanGps` | Hasil rekap; ditimpa setiap kali laporan dibuat | Tetap |

### Kenapa jejak tidak ditulis setiap ping

50 karyawan × ping 5 menit × 8 jam = **4.800 baris per hari**. Dibiarkan,
spreadsheet absensi akan menabrak batas 10 juta sel dalam hitungan bulan —
dan yang berhenti bukan hanya fitur GPS, melainkan **seluruh aplikasi**.

Karena itu sebuah titik hanya menambah baris jejak bila salah satu benar:

- berasal dari absen atau permintaan manual;
- bergeser **≥ 50 meter** dari titik jejak terakhir;
- sudah **≥ 30 menit** sejak baris jejak terakhir (heartbeat);
- status area berubah (masuk/keluar area kantor).

Karyawan yang duduk di meja seharian menghasilkan ±16 baris. Karyawan
yang berkendara menghasilkan jejak rapat. Posisi terakhirnya tetap
diperbarui setiap ping pada keduanya.

Aturan ini dikunci oleh `scripts/test-gps-tracking.js` (67 uji, termasuk
titik susulan dari antrian). Jalankan setiap kali angkanya disetel:

```
node scripts/test-gps-tracking.js
```

---

## 4. CARA MEMASANG

1. **Salin `apps-script/GpsTracking.gs`** ke editor Apps Script sebagai
   berkas baru bernama `GpsTracking.gs`.
2. **Perbarui `Code.gs` dan `Auth.gs`** di editor dengan versi dari repo
   ini (routing action baru + tabel izin role).
3. Jalankan sekali fungsi **`GPSTRACK_SIAPKAN_SHEET()`** dari editor —
   keempat sheet dibuat dengan kolom yang benar. (Opsional: sheet juga
   terbuat sendiri saat ping pertama masuk.)
4. **Deploy ulang**: Deploy → Kelola deployment → edit → Versi baru.
5. `npm run build`, lalu unggah hasil `build/` seperti biasa.

Urutannya penting: klien yang menembak backend lama akan menerima
"Action tidak dikenal" dan **sengaja diam** — absensi tetap normal, hanya
pelacakannya yang belum hidup.

**Untuk 1.0.18 tidak ada sheet baru.** Yang perlu disalin ulang ke editor
Apps Script hanya `GpsTracking.gs` (fungsi `handleTrackGpsAntrian`),
`Code.gs`, dan `Auth.gs`, lalu deploy versi baru. Selama backend belum
di-deploy, titik antrian menumpuk di HP karyawan dan kedaluwarsa sendiri
setelah 12 jam — tidak ada yang rusak, hanya susulannya yang belum masuk.

---

## 5. CARA MEMAKAI DASHBOARD

**Panel Administrator → Menu → Dashboard GPS Karyawan** (hanya muncul
untuk role `admin`).

- **Peta** — posisi terkini semua karyawan. Warna marker: hijau `ONLINE`
  (≤ 10 menit), kuning `IDLE` (≤ 60 menit), abu `OFFLINE`. Cincin merah
  berarti di luar area kantor. Segarkan otomatis tiap 30 detik, dan
  otomatis berhenti saat tab tidak terlihat.
- **Jejak** — pilih karyawan + tanggal untuk melihat rute hari itu:
  titik A (awal), titik B (akhir), garis perjalanan, dan rincian per titik.
- **Laporan** — pilih rentang tanggal → tombol **Buat Laporan**. Hasilnya
  ditulis ke sheet `LaporanGps` (jumlah titik, jam pertama/terakhir,
  durasi terpantau, jarak tempuh km, menit di luar area, lokasi terakhir)
  dan bisa langsung dibuka lewat tautan yang muncul.
- **Pengaturan** — saklar pelacakan per karyawan dan pilihan interval
  (2/5/10/30 menit), plus tombol aktifkan/matikan semua.

Karyawan baru **otomatis aktif**. Matikan di tab Pengaturan untuk
mengecualikan seseorang.

---

## 6. GERBANG GPS WAJIB (1.0.16)

Setelah login, aplikasi **menahan seluruh menu** sampai lokasi perangkat
benar-benar terbaca. Ini yang membuat posisi semua karyawan pasti
tercatat, bukan hanya karyawan yang kebetulan mengizinkan lokasi.

**Alurnya**

1. Karyawan login seperti biasa.
2. Layar "Memeriksa Lokasi…" muncul, aplikasi membaca GPS.
3. Berhasil → menu terbuka, dan titik pertama **langsung dikirim** dari
   pembacaan itu juga (tanpa membaca GPS dua kali), sehingga karyawan
   segera muncul di Dashboard GPS.
4. Gagal → layar gerbang menahan, disertai panduan langkah yang berbeda
   untuk iPhone, Android, dan komputer.

**Dua percobaan, bukan satu.** Percobaan pertama memakai GPS presisi
tinggi; kalau gagal karena timeout atau sinyal, percobaan kedua memakai
lokasi jaringan (WiFi/seluler) yang hampir selalu berhasil di dalam
ruangan. Tanpa langkah kedua ini, karyawan jujur akan terkunci di lobi
kantornya sendiri — kegagalan yang jauh lebih mahal daripada akurasi
yang berkurang. Izin yang **ditolak** tidak pernah dicoba ulang, supaya
tidak muncul dua dialog beruntun.

**Sekali izinkan, tidak ditanya lagi.** Gerbang hanya muncul pada
karyawan yang izin lokasinya belum ada. Begitu izin diberikan sekali,
pembukaan aplikasi berikutnya langsung masuk ke menu — posisinya tetap
dibaca, hanya di latar belakang tanpa layar pemeriksaan. Sumber
kebenarannya Permissions API; Safari iOS tidak mendukungnya untuk
geolocation, jadi di sana dipakai catatan lokal "perangkat ini pernah
berhasil" yang berlaku 60 hari. Kalau izin dicabut atau layanan lokasi
dimatikan, pembacaan latar belakang itu gagal dan gerbang muncul lagi —
catatan lokalnya ikut dibuang saat izin terdeteksi `denied`.

**Tidak ada tombol lewati untuk karyawan.** Jalan keluar hanya terbuka
pada dua keadaan yang mustahil diperbaiki karyawan sendiri:

- halaman diakses lewat `http://` (browser mematikan Geolocation);
- browser sama sekali tidak punya fitur lokasi.

Ditambah satu pengaman: **role `admin`** mendapat tombol darurat setelah
tiga kali gagal, supaya pemilik sistem tidak pernah terkunci dari
sistemnya sendiri. Karyawan biasa tidak pernah melihat tombol itu.

> **WAJIB DIPERIKSA SEBELUM RILIS:** aplikasi harus disajikan lewat
> **https://**. Pada `http://`, Geolocation dimatikan browser dan
> SELURUH karyawan akan berhenti di gerbang.

**Pemeriksaan ulang** dilakukan saat aplikasi kembali dibuka, tetapi
paling cepat 15 menit sekali — karyawan yang sekadar membalas pesan lalu
kembali tidak boleh terlempar ke gerbang tanpa kesalahan. Gerbang
digambar sebagai lapisan di atas isi aplikasi, jadi form absen yang
sedang diisi (beserta fotonya) tidak hilang bila pemeriksaan ulang gagal
sesaat.

Uji otomatis: `CI=true npx react-scripts test --testPathPattern gpsWajib`
(14 uji: kasus dalam gedung, izin ditolak, dan ingatan izin).

---

## 7. BATASAN YANG HARUS DIKOMUNIKASIKAN

1. **Pelacakan hanya berjalan saat aplikasi masih TERBUKA.** Web tidak
   mengizinkan pekerjaan latar belakang untuk lokasi — Service Worker
   sekalipun tidak boleh membaca GPS. Aplikasi ditutup (tab disapu dari
   daftar aplikasi) = tidak ada titik baru. Yang berhasil dijangkau
   1.0.18 adalah keadaan di antaranya: aplikasi terbuka tapi tidak
   disentuh. Lihat bagian **STANDBY** di bawah.
2. **Auto-logout ikut menghentikan pelacakan.** Aplikasi keluar sendiri
   setelah tidak ada aktivitas (**60 menit** sejak 1.0.18, sebelumnya 5;
   lihat `TIMEOUT_DURATION` di `src/config/constants.js`). Setelan per
   lingkungan tetap lewat `REACT_APP_TIMEOUT_MINUTES` di `.env.local`.
   **Jangan** mematikan auto-logout sepenuhnya: HP yang tertinggal di
   meja akan menjadi sesi terbuka bagi siapa pun.
3. **Izin lokasi ada di tangan karyawan.** Kalau ditolak, indikator di
   aplikasi berubah menjadi "Izin lokasi mati" dan pelacakan berhenti.
   Ini terlihat oleh admin sebagai karyawan yang tidak pernah `ONLINE`.
4. **Akurasi di dalam gedung buruk.** Titik dengan akurasi > 1 km
   dibuang. Di dalam gedung, ponsel sering memakai lokasi jaringan WiFi —
   titiknya bisa meleset ratusan meter dan identik antar-karyawan. Jangan
   memakai satu titik sebagai bukti tunggal untuk sanksi.

---

## 8. STANDBY — PELACAKAN SAAT APLIKASI TIDAK DISENTUH (1.0.18)

Sampai 1.0.17, pelacakan praktis mati justru pada karyawan yang paling
ingin dipantau. Tiga hal terjadi berurutan pada karyawan lapangan yang
menaruh HP di saku:

1. layar mati → pembacaan GPS berhenti sama sekali;
2. tab tersembunyi → siklus pengiriman **sengaja dilewati** oleh kode lama;
3. lima menit tanpa sentuhan → auto-logout → pelacakan berakhir.

1.0.18 menyerang ketiganya.

### Sesi 60 menit

`TIMEOUT_MINUTES` naik dari 5 menjadi **60**, dihitung sejak **aktivitas
terakhir** (bukan sejak login) — setiap sentuhan, klik, atau gulir
menyetel ulang hitungannya. Selama jendela itu aplikasi dianggap
"standby": tidak ada yang perlu dilakukan karyawan, sesinya tetap hidup,
dan pelacakan terus berjalan.

Kalimat pada layar keluar sesi kini disusun dari `TIMEOUT_LABEL`. Teks
lama menyebut "10 menit" padahal ambangnya 5 menit — karyawan yang
protes "baru ditinggal sebentar" ternyata benar.

### Layar ditahan (Screen Wake Lock)

Selama pelacakan aktif, `src/utils/wakeLock.js` menahan layar supaya
tidak mati sendiri, sehingga halaman tetap "terlihat" bagi browser dan
geolocation terus bekerja. Lock diminta ulang setiap kali aplikasi
kembali terlihat, karena browser melepasnya sendiri saat karyawan
berpindah aplikasi.

- Hanya untuk karyawan yang memang **dilacak**. Yang pelacakannya
  dimatikan admin tidak ikut ditahan layarnya.
- Tidak ada di Safari < iOS 16.4 dan sebagian WebView. Absennya tidak
  merusak apa pun — pelacakan tetap jalan, hanya lebih mudah terputus.
- **Biaya jujurnya: baterai lebih boros dan layar tidak mati sendiri.**
  Matikan lewat `REACT_APP_GPS_WAKE_LOCK=0` di `.env.local` bila suatu
  saat dianggap terlalu mahal.

### Antrian titik offline

Titik yang sudah terbaca tapi gagal terkirim (gudang tanpa sinyal,
basement, jalan antar-kota) tidak lagi hilang. Ia disimpan di
`localStorage` dan disusulkan begitu jaringan hidup.

| Aturan | Nilai | Alasan |
|---|---|---|
| Maksimal titik disimpan | 200 (tertua dibuang) | localStorage ±5 MB dipakai bersama penanda versi & ingatan izin GPS |
| Umur maksimal | 12 jam | posisi kemarin tidak menjelaskan apa pun hari ini |
| Titik per kiriman | 50 | satu panggilan Apps Script memakan 1–34 detik |
| Pemilik | disaring per `userId` | HP bersama tidak boleh menyusulkan titik orang lain |

Antrian dicoba ulang pada tiga kesempatan: setelah ping berkala berhasil
(bukti jaringan hidup), saat event `online` browser, dan sekali di awal
sesi — titik dari sesi kemarin yang belum terkirim ikut tersusul.

Titik hanya dibuang dari antrian setelah server benar-benar menjawab
sukses. Backend lama (< 1.0.18) menjawab "Action tidak dikenal", dan
titiknya sengaja **dibiarkan** sampai kedaluwarsa sendiri — deploy
backend bisa saja menyusul beberapa menit kemudian.

### Yang dijaga di sisi server

`handleTrackGpsAntrian` bukan pemanggilan berulang `handleTrackGpsPing`:

- **Waktu asli dari HP dipakai**, bukan waktu tiba di server. Kalau
  tidak, jejak perjalanan sepagi penuh akan tercatat pada menit yang
  sama dan laporan jarak tempuh ikut salah.
- **Baris posisi terakhir tidak boleh mundur.** Titik lama yang
  disusulkan hanya menambah jejak dan penghitung harian; marker di peta
  admin baru bergerak bila titik yang masuk memang lebih baru.
- **Aturan penipisan jejak tetap berlaku** (≥ 50 m, heartbeat 30 menit,
  perubahan status area), dihitung di dalam kiriman itu sendiri.
- **Alamat tidak dicari per titik** — 50 titik × geocoding akan
  menghabiskan kuota harian satu karyawan sendirian. Alamat tetap dicari
  untuk titik terbaru saat baris posisi terakhir diperbarui.
- Jam HP yang salah setel disaring: titik di masa depan (> 5 menit) dan
  yang lebih tua dari 12 jam ditolak.

Sumber pada sheet `GpsTracking` ditulis **`antrian`**, bukan `periodik`:
admin yang membaca jejak berhak tahu titik itu disusulkan.

### Yang MASIH tidak bisa dilakukan

Aplikasi yang benar-benar **ditutup** (tab disapu, browser dimatikan,
HP di-restart) tidak menghasilkan titik apa pun. Tidak ada cara di web
untuk mengubah itu. Kalau perusahaan membutuhkan pelacakan penuh 24 jam
tanpa aplikasi terbuka, yang dibutuhkan adalah aplikasi Android/iOS
native — bukan tambalan pada aplikasi web ini.

Uji otomatis antrian: `CI=true npx react-scripts test --testPathPattern antrianGps`
(13 uji: batas, kedaluwarsa, pemisahan antar karyawan, localStorage mode privat).


## 9. PRIVASI

- Indikator "Lokasi dibagikan ke Admin" di layar karyawan **dihapus pada
  8 Sep 2026** atas permintaan (menutupi baris data terbawah di HP).
  Konsekuensinya: aplikasi tidak lagi memberi tahu karyawan bahwa
  lokasinya direkam. Sampaikan kebijakan ini lewat Info HRD atau surat
  pemberitahuan — di banyak wilayah, memberi tahu karyawan bukan sekadar
  etika tapi kewajiban hukum.
- Aksesnya **admin saja** — HRD sekalipun tidak dapat membuka dashboard
  ini, berbeda dengan Monitoring Integritas GPS yang boleh dilihat HRD.
- Retensi: jalankan `PANGKAS_JEJAK_GPS(60)` dari editor Apps Script untuk
  membuang jejak yang lebih tua dari 60 hari. Sesuaikan angkanya dengan
  kebijakan perusahaan.
- `GPSTRACK_CACHE_BERSIHKAN()` memaksa perubahan sheet `Users` /
  `GpsTrackingConfig` berlaku seketika tanpa menunggu cache 10 menit.

---

## 10. CACHE HOSTING — WAJIB DIATUR SEKALI

Gejala "layar putih" dan "layar Update Tersedia berulang" di Safari iOS /
Chrome Android hampir selalu satu penyakit yang sama: **HP menyimpan
`index.html` lama.**

Berkas di `/static/` namanya mengandung hash isi, jadi aman disimpan
selamanya. `index.html` namanya selalu sama tetapi isinya berganti tiap
rilis — dialah yang menunjuk bundle mana yang dipakai. Kalau ia
tersimpan di HP:

- index.html lama menunjuk `/static/js/main.<hash-lama>.js` yang sudah
  diganti di server → **404 → layar putih**;
- bundle lama melapor versi lama ke server yang sudah baru → **layar
  "Update Tersedia" yang tidak pernah selesai**.

**Apache / cPanel** — sudah ditangani: `public/.htaccess` ikut tersalin
ke `build/` setiap kali `npm run build`. Pastikan berkas tersembunyi ini
**ikut terunggah** (di FileZilla: Server → Force showing hidden files).

**Nginx** — tambahkan di server block:

```nginx
location = /index.html {
  add_header Cache-Control "no-store, no-cache, must-revalidate";
}
location /static/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

**Netlify / Vercel / Cloudflare Pages** — sudah benar secara bawaan.

### Saat mengunggah build baru

Jangan menghapus isi `/static` yang lama lebih dulu. Unggah menimpa saja.
HP yang masih memegang index.html lama tetap menemukan berkasnya,
sehingga bisa masuk ke aplikasi lalu ikut jalur update secara normal —
bukan langsung menabrak layar putih.

### Jaring pengaman di aplikasi (1.0.16)

Kalau tetap ada yang lolos, `public/index.html` kini berisi skrip kecil
non-React yang berjalan lebih dulu daripada bundle:

- berkas `/static` gagal diunduh → cache dibersihkan, halaman dimuat
  ulang sekali secara otomatis;
- bundle termuat tetapi layar tetap kosong 8 detik → perlakuan sama;
- kalau percobaan kedua masih gagal → tampil kartu "Aplikasi gagal
  dimuat" beserta tombol Muat Ulang, bukan layar putih tanpa penjelasan.

Layar "Update Tersedia" juga tidak lagi menjadi jalan buntu: setelah dua
kali gagal, muncul tombol **Lanjutkan dengan versi ini** supaya karyawan
tetap bisa absen sementara build baru diunggah.

### Membebaskan HP yang sudah terlanjur macet

- **Safari iOS**: Pengaturan → Safari → Hapus Riwayat dan Data Situs;
  atau buka sekali lewat Tab Pribadi.
- **Chrome Android**: ⋮ → Setelan → Privasi → Hapus data penjelajahan →
  centang "Gambar dan file dalam cache".

---

## 11. ACTION BARU

| Action | Role | Fungsi |
|---|---|---|
| `track_gps_ping` | semua yang login | Mengirim satu titik posisi (userId diambil dari token) |
| `track_gps_antrian` | semua yang login | Menyusulkan titik yang tertinggal saat sinyal hilang (maks. 50 per kiriman) |
| `get_gps_tracking_status` | semua yang login | Apakah akun ini dilacak & seberapa sering |
| `get_gps_live` | admin | Posisi terakhir seluruh karyawan + area kantor |
| `get_gps_trail` | admin | Jejak satu karyawan pada satu tanggal |
| `get_gps_tracking_admin` | admin | Daftar karyawan + status pelacakannya |
| `save_gps_tracking_config` | admin | Menyalakan/mematikan & mengatur interval |
| `buat_laporan_gps` | admin | Menyusun rekap dan menulisnya ke sheet `LaporanGps` |
