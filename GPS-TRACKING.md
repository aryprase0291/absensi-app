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
| GPS untuk karyawan yang punya akses absen | Aplikasi mengirim posisi tiap 5 menit selama dibuka, plus otomatis saat absen |
| Menu dashboard untuk memantau | Menu **Dashboard GPS Karyawan** di Panel Administrator |
| Hanya admin yang bisa akses | Gerbang role di `Auth.gs` (`['admin']`, tanpa HRD) + pemeriksaan kedua di handler |
| Posisi terakhir tercatat | Sheet `GpsPosisiTerakhir` — satu baris per karyawan, selalu diperbarui |
| Report di GSheet | Sheet `LaporanGps`, dibuat dari tab **Laporan** di dashboard |
| Tampilan seperti aplikasi GPS umum | Peta OpenStreetMap (Leaflet): marker berinisial, status warna, lingkaran area kantor, jejak perjalanan |

---

## 2. BERKAS YANG DITAMBAH / DIUBAH

**Baru**

- `apps-script/GpsTracking.gs` — seluruh mesin pelacakan sisi server
- `src/utils/gpsTracker.js` — pengirim posisi berkala di sisi aplikasi
- `src/screens/GpsDashboardScreen.js` — layar dashboard admin (4 tab)
- `scripts/test-gps-tracking.js` — 43 uji otomatis untuk aturan pencatatan

**Diubah**

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

Aturan ini dikunci oleh `scripts/test-gps-tracking.js`. Jalankan setiap
kali angkanya disetel:

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

Urutannya penting: klien 1.0.16 yang menembak backend lama akan menerima
"Action tidak dikenal" dan **sengaja diam** — absensi tetap normal, hanya
pelacakannya yang belum hidup.

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

## 6. BATASAN YANG HARUS DIKOMUNIKASIKAN

1. **Pelacakan hanya berjalan saat aplikasi dibuka.** Web tidak
   mengizinkan pekerjaan latar belakang untuk lokasi. Aplikasi ditutup =
   tidak ada titik baru. Ini berlaku untuk semua aplikasi berbasis web,
   bukan kekurangan implementasi ini.
2. **Auto-logout ikut menghentikan pelacakan.** Aplikasi keluar sendiri
   setelah tidak ada aktivitas (bawaan **5 menit**, lihat
   `TIMEOUT_DURATION` di `src/config/constants.js`). Untuk karyawan
   lapangan, perpanjang lewat `REACT_APP_TIMEOUT_MINUTES` di `.env.local`
   — misalnya 120 menit. **Jangan** mematikan auto-logout sepenuhnya:
   HP yang tertinggal di meja akan menjadi sesi terbuka bagi siapa pun.
3. **Izin lokasi ada di tangan karyawan.** Kalau ditolak, indikator di
   aplikasi berubah menjadi "Izin lokasi mati" dan pelacakan berhenti.
   Ini terlihat oleh admin sebagai karyawan yang tidak pernah `ONLINE`.
4. **Akurasi di dalam gedung buruk.** Titik dengan akurasi > 1 km
   dibuang. Di dalam gedung, ponsel sering memakai lokasi jaringan WiFi —
   titiknya bisa meleset ratusan meter dan identik antar-karyawan. Jangan
   memakai satu titik sebagai bukti tunggal untuk sanksi.

---

## 7. PRIVASI

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

## 8. CACHE HOSTING — WAJIB DIATUR SEKALI

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

## 9. ACTION BARU

| Action | Role | Fungsi |
|---|---|---|
| `track_gps_ping` | semua yang login | Mengirim satu titik posisi (userId diambil dari token) |
| `get_gps_tracking_status` | semua yang login | Apakah akun ini dilacak & seberapa sering |
| `get_gps_live` | admin | Posisi terakhir seluruh karyawan + area kantor |
| `get_gps_trail` | admin | Jejak satu karyawan pada satu tanggal |
| `get_gps_tracking_admin` | admin | Daftar karyawan + status pelacakannya |
| `save_gps_tracking_config` | admin | Menyalakan/mematikan & mengatur interval |
| `buat_laporan_gps` | admin | Menyusun rekap dan menulisnya ke sheet `LaporanGps` |
