# Gerbang GPS di komputer — kenapa selalu gagal, dan pengecualiannya (1.0.22)

15 Sep 2026. Laporan: login dari PC berhenti di "Memeriksa Lokasi…" lalu
berakhir **"GPS Perangkat Tidak Aktif — Waktu pencarian lokasi habis"**.

## Kenapa ini bukan salah karyawan

Komputer **tidak punya cip GPS**. Chrome di desktop mendapat lokasi dengan
mengirim daftar SSID/BSSID WiFi di sekitarnya ke server Google
(`www.googleapis.com/geolocation/v1/geolocate`), dan Google yang menjawab
koordinatnya. Tiga hal mematikannya total di PC kantor, dan ketiganya
berakhir sebagai **error code 3 (TIMEOUT)** — persis layar di atas:

1. **PC berkabel tanpa adapter WiFi.** Tidak ada data WiFi untuk dikirim.
   Tidak ada yang bisa dihitung. Ini permanen, bukan sesaat.
2. **Jaringan memblokir `www.googleapis.com`.** Permintaannya menggantung
   sampai timeout.
3. **Windows Location service mati** untuk aplikasi desktop.

Lamanya menunggu juga punya penjelasan: gerbang mencoba dua kali —
akurasi tinggi 12 detik, lalu lokasi jaringan 15 detik. **±27 detik** tanpa
satu pun tombol yang bisa ditekan. Itu yang membuatnya terasa menggantung.

## Yang diubah di 1.0.22

### 1. Pengecualian per karyawan (Panel Admin > Geofence)

Kotak centang baru: **"Kecualikan dari gerbang GPS (staf PC)"**.

- Disimpan di Script Properties `GPS_GERBANG_BEBAS` (daftar UserID dipisah
  koma) — bukan sheet baru. Dibaca sekali per login lewat memo Cache.gs,
  jadi biayanya nol untuk request yang sudah menyentuh properti.
- Respons login membawa `user.gpsGerbangBebas`.
- Frontend: gerbang tidak pernah muncul, DAN `isGpsRequired` ikut mati
  supaya tombol Kirim tidak buntu. Keduanya harus ikut — mematikan
  gerbangnya saja hanya memindahkan buntunya satu layar ke belakang.
- Posisi **tetap dibaca di latar belakang**. Kalau karyawan yang sama
  membuka aplikasi dari HP, titiknya tetap terkirim ke Dashboard GPS.
  Yang berbeda hanya satu: kegagalan membaca tidak menahan menu.

### 2. Kelonggaran di server dibuat sesempit mungkin

`analisaIntegritasGps` memblokir absen Hadir/Pulang tanpa koordinat dengan
skor 100. `handleAbsen` melewatinya **hanya bila kedua syarat terpenuhi**:

- UserID ada di daftar pengecualian, **dan**
- `data.lokasi` benar-benar kosong.

Kalau karyawan yang dikecualikan mengirim koordinat, analisanya berjalan
penuh seperti biasa — **tidak ada tiket bebas Fake GPS**. Absen tanpa
lokasi dicatat ke Audit GPS dengan keputusan tersendiri
**`DITERIMA-TANPA-LOKASI`**, supaya HRD bisa melihat siapa, kapan, dan
seberapa sering.

### 3. Pengecualian + geofence wajib DITOLAK

Dua-duanya menyala itu kontradiksi: karyawan yang lokasinya tidak bisa
dibaca mustahil dicocokkan dengan area kantor. Ditolak di klien dan di
server, dengan kalimat yang menjelaskan sebabnya.

### 4. Tiga perbaikan layar gerbang

- **Batas waktu milik sendiri.** Opsi `timeout` milik `getCurrentPosition`
  TIDAK berjalan selama dialog izin menggantung — spesifikasinya memang
  begitu, penghitungnya baru mulai setelah dialog dijawab. Kalau dialog
  tidak pernah dijawab (diabaikan, ditutup Esc, atau Chrome menekannya
  jadi ikon kecil karena situs pernah diblokir), callback sukses MAUPUN
  gagal tidak pernah dipanggil dan layar berputar selamanya. Sekarang
  setiap pembacaan dibungkus batas waktu sendiri.
- **Status baru `TAK_DIJAWAB`** dengan kalimatnya sendiri, bukan lagi
  disamakan dengan "sinyal GPS tidak ketemu".
- **Kalimat khusus komputer** untuk code 3: menyuruh orang "mencari sinyal
  GPS" pada perangkat yang tidak punya GPS hanya berakhir di telepon ke HRD.
- **Tombol "Keluar dari akun" ikut tampil selama memeriksa**, supaya layar
  itu tidak pernah lagi menjadi jalan buntu.

## Cek 10 detik sebelum menyalahkan aplikasi

Di PC yang bermasalah, buka `google.com/maps` lalu klik tombol
titik-lokasi. Kalau Maps juga tidak menemukan posisinya, masalahnya di
PC/jaringan — bukan di aplikasi absensi.

## Urutan deploy 1.0.22

**Frontend dulu, backend belakangan** (kebiasaan repo ini; lihat
`KUNCI-PERANGKAT.md`). Tidak ada sheet baru dan tidak ada perubahan
struktur data. Pengecualian pertama baru bisa disetel setelah backend
tayang, karena `save_geofence_config` yang menerima field barunya.
