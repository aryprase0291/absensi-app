# KAMERA DEPAN & VERIFIKASI WAJAH PENUH (v1.0.17)

Dokumen ini menjawab dua hal: **kenapa dulu masih bisa absen pakai kamera
belakang / tanpa wajah**, dan **apa yang sekarang mengunci hal itu**.

---

## 1. Kenapa dulu masih kebobolan

### a. `facingMode: 'user'` hanya PERMINTAAN, bukan perintah

Kode lama:

```js
navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode, ... } })
```

`facingMode: 'user'` tanpa `exact` adalah *ideal constraint*. Browser boleh
mengabaikannya. Yang paling sering terjadi di lapangan:

* Di Chrome Android, izin kamera per-situs menyimpan **perangkat kamera
  pilihan**. Kalau karyawan pernah memilih kamera belakang, pilihan itu
  menang atas `facingMode`.
* WebView / in-app browser (WhatsApp, Instagram, Facebook) sering memberi
  kamera default sistem, yaitu kamera belakang.
* HP dengan banyak lensa kadang melaporkan lensa belakang sebagai default.

Kode lama **tidak pernah memeriksa kamera mana yang benar-benar menyala**
(`track.getSettings()`), jadi kamera belakang lolos tanpa jejak.

### b. Semua penjagaan digantung pada state `facingMode`, bukan kamera nyata

```js
if (facingMode === 'user' && ['Hadir','Pulang'].includes(type)) { ...liveness... }
```

Kalau stream sebenarnya kamera belakang sementara state tetap `'user'`,
pelacak wajah tetap jalan. Sebaliknya, ketika `facingMode === 'environment'`
(mis. sisa state dari jenis absen lain), **seluruh gerbang liveness dilewati**
dan tombol jepret langsung aktif.

### c. Detektor lama bukan detektor wajah

`faceLiveness.js` lama memakai:

1. `window.FaceDetector` — API ini **tidak ada di Chrome Android maupun iOS
   Safari**, jadi praktis tidak pernah terpakai; dan
2. cadangan berupa hitungan **warna kulit + kontras** di kotak tengah layar.

Syaratnya cuma `skinRatio >= 0.16` dan `stdDev >= 12` plus ada sedikit
gerakan. Telapak tangan, lengan, dahi saja, dinding warna kulit, atau foto di
layar HP yang digoyang sedikit — semuanya lolos. Itulah sebabnya ada absen
tanpa wajah.

### d. Tidak ada pemeriksaan pada foto yang benar-benar dijepret

Verifikasi hanya di *preview*. Setelah status hijau, isi frame saat tombol
ditekan tidak pernah diperiksa lagi.

---

## 2. Yang berlaku sekarang untuk Hadir & Pulang

### Lapis 1 — kamera depan dikunci (`src/utils/kameraDepan.js`)

1. Minta `facingMode: { exact: 'user' }` (tegas, bukan ideal).
2. Kalau gagal, cari `videoinput` berlabel depan lewat `enumerateDevices()`
   dan buka dengan `deviceId: { exact }`.
3. **Verifikasi ulang** stream yang didapat: `track.getSettings().facingMode`
   dan label perangkat. Kalau hasilnya kamera belakang, stream **dimatikan**
   dan muncul pesan merah + tombol "Coba lagi". Tidak ada foto yang bisa
   diambil.
4. Tombol ganti kamera dihapus untuk Hadir/Pulang, dan `toggleCamera()`
   menolak dijalankan (bukan sekadar disembunyikan di UI).

Catatan: sebagian laptop/webcam tidak melaporkan `facingMode` **maupun** label
yang jelas. Kamera seperti ini diteruskan tetapi ditandai di UI — penjaga
wajah di bawah tetap harus lolos.

### Lapis 2 — verifikasi wajah penuh (`src/utils/faceLiveness.js`)

Memakai **face-api.js** (TinyFaceDetector + 68 landmark), berkas lokal:

* `public/vendor/face-api.js` (1,3 MB, dimuat hanya saat kamera dibuka)
* `public/models/tiny_face_detector_model.*` (~195 KB)
* `public/models/face_landmark_68_tiny_model.*` (~80 KB)

Foto baru bisa diambil kalau **semua** syarat ini lolos:

| Syarat | Ambang | Pesan bila gagal |
|---|---|---|
| Tepat satu wajah | 1 | "Terdeteksi N wajah…" |
| Ukuran wajah | tinggi 26–97% bingkai | "Wajah terlalu jauh / terlalu dekat" |
| Wajah utuh | 68 titik di dalam bingkai (margin 2%) | "Wajah terpotong. Masukkan SELURUH wajah…" |
| Ketajaman | skor deteksi ≥ 0,5 | "Wajah kurang jelas…" |
| Di tengah | pusat wajah ±34% / ±36% | "Posisikan wajah di tengah lingkaran" |
| Menghadap depan | simetri hidung ≥ 0,25 dan lebar kedua mata ≥ 0,42 | "Hadap LURUS ke kamera…" |
| Tidak miring | roll ≤ 28° | "Tegakkan kepala…" |
| Tidak menunduk | proporsi mata–hidung–dagu 0,28–0,76 | "Jangan menunduk atau mendongak" |
| Mulut & dagu terlihat | lebar mulut ≥ 0,28 × jarak mata | "Buka masker / singkirkan penghalang" |
| Hidup (liveness) | selisih antar-frame 0,003–0,45 selama 4 frame | "Gambar terdeteksi diam/statis…" |

Ambang menghadap-depan dikalibrasi dengan foto uji: wajah lurus 0,4–0,95,
wajah berpaling kuat < 0,22.

### Lapis 3 — periksa ulang foto hasil jepretan

`takePhoto()` sekarang `async`. Setelah frame digambar ke canvas, frame itu
diperiksa sekali lagi dengan `periksaWajahPenuh()`. Kalau wajah tidak
terverifikasi, foto **dibuang**. Jadi kamera tidak bisa dialihkan sedetik
sebelum menjepret.

### Lapis 4 — gerbang saat kirim

`handleSubmit()` menolak kiriman Hadir/Pulang bila foto tidak berasal dari
alur terverifikasi (`fotoTerverifikasi`).

### Kalau model gagal diunduh

Aplikasi tidak mati total: turun ke "mode terbatas" (heuristik kulit +
simetri + pita atas/bawah + latar tepi), ditandai pada badge status. Pastikan
folder `models/` dan `vendor/` ikut ter-upload saat deploy supaya mode penuh
yang dipakai.

---

## 3. Yang perlu dilakukan saat deploy

1. Upload **seluruh isi `build/`**, termasuk folder baru `build/vendor/` dan
   `build/models/`, serta `build/.htaccess` (sudah berisi aturan cache untuk
   model).
2. Salin `apps-script/Code.gs` dan `apps-script/UpdateManifest.gs` ke Apps
   Script (versi backend naik ke 1.0.17 mengikuti aturan versi frontend =
   backend). Tidak ada perubahan struktur sheet.
3. Uji di HP: buka Hadir → kamera harus langsung depan, tombol ganti kamera
   tidak ada, tombol jepret baru menyala setelah badge hijau
   "Wajah penuh terverifikasi ✓".

## 4. Jenis absen lain

**Diperbarui 11 Sep 2026 (1.0.19).** Dua aturan yang sebelumnya menempel
pada satu penanda kini dipisah, karena ternyata tidak selalu berjalan
bersama:

| Jenis | Kamera depan dikunci | Verifikasi wajah |
|---|---|---|
| Hadir, Pulang | ya | ya — satu wajah, identitas dicocokkan |
| **Dinas** | **ya** | **tidak** |
| Sakit | tidak (default kamera belakang) | tidak |

**Dinas sengaja mengunci kamera depan tanpa gerbang wajah.** Foto dinas
memang sering berisi beberapa orang sekaligus — tim di lokasi, atau
karyawan bersama pihak yang ditemui — jadi syarat "tepat satu wajah" akan
menolak foto yang justru paling wajar. Yang tetap ingin dicegah adalah foto
dinas diambil dari kamera belakang (memotret layar, dokumen, atau
pemandangan sebagai pengganti kehadiran orangnya).

Di kode, keduanya sekarang dua penanda terpisah di `AttendanceForm`:
`wajibKameraDepan` dan `wajibWajah`. Menambahkan jenis absen baru ke salah
satunya **tidak** otomatis memasukkannya ke yang lain.
