# Pencocokan Wajah Karyawan (v1.0.19)

Lanjutan dari `KAMERA-WAJAH.md`. Bacalah keduanya berurutan — yang satu
tidak menggantikan yang lain.

| Berkas | Pertanyaan yang dijawab | Sejak |
|---|---|---|
| `KAMERA-WAJAH.md` | "Apakah ini **wajah manusia** yang hidup dan utuh?" | 1.0.17 |
| **dokumen ini** | "Apakah ini wajah **si pemilik akun**?" | 1.0.19 |

Keduanya berjalan berurutan pada presensi **Masuk** dan **Pulang** saja.

**Dinas** mengunci kamera depan tetapi **tidak** memakai gerbang wajah mana
pun — foto dinas boleh berisi lebih dari satu orang. **Sakit** tidak berubah
sama sekali dan tetap default kamera belakang. Rinciannya ada di
`KAMERA-WAJAH.md` bagian 4.

---

## 1. Kenapa lapis 1.0.17 saja tidak cukup

Verifikasi 1.0.17 memastikan yang menghadap kamera adalah wajah manusia
hidup, utuh, menghadap lurus, tidak tertutup masker. Semua itu tetap
terpenuhi kalau **rekan kerja** yang menghadap kamera. Karyawan yang ingin
dititipi absen tidak perlu memalsukan apa pun — cukup menghadap kamera
dengan wajahnya sendiri di HP temannya.

Penguncian perangkat (`KUNCI-PERANGKAT.md`) mempersempitnya, tapi tidak
menutupnya: HP bisa dipinjamkan, dan mode penyamaran menghasilkan perangkat
yang tampak baru.

Yang benar-benar menutup adalah membandingkan wajah di kamera dengan wajah
acuan yang terdaftar untuk akun itu.

---

## 2. Yang disimpan bukan foto

Untuk setiap karyawan disimpan **deskriptor**: 128 angka hasil model
`face_recognition` dari face-api.js. Dua foto orang yang sama menghasilkan
dua deskriptor berdekatan; orang berbeda berjauhan. Jaraknya dihitung dengan
Euclidean.

Foto acuan **memang** ikut disimpan (satu berkas di Drive), tetapi hanya
supaya admin bisa melihat wajah siapa yang terdaftar. **Bukan foto itu yang
dipakai mencocokkan.**

### Deskriptor acuan TIDAK PERNAH dikirim ke HP

Ini keputusan desain yang paling penting di seluruh fitur ini, dan paling
mudah dirusak tanpa sengaja oleh perubahan yang tampak seperti optimasi.

Kalau acuan dikirim ke klien "supaya pencocokannya cepat dan tidak perlu
request", maka siapa pun yang membuka DevTools tinggal membaca 128 angka itu
dan mengirimkannya kembali. Ia lolos **tanpa pernah menghadap kamera**.
Seluruh fitur ini runtuh menjadi teater.

Karena itu:

```
HP  → mengirim 128 angka dari foto yang BARU SAJA dijepret
SERVER → membandingkan dengan acuan, menjawab cocok / tidak
```

Konsekuensinya jujur: layar absen butuh **satu request tambahan**
(`verifikasi_wajah`) sebelum tombol Kirim, supaya karyawan tahu lebih awal.
Itu ongkos yang dibayar sadar-sadar.

### Dua gerbang, bukan satu

| Gerbang | Kapan | Gunanya |
|---|---|---|
| `verifikasi_wajah` | saat tombol jepret ditekan | **kenyamanan** — memberi tahu karyawan lebih awal |
| `faceGerbangAbsen` di `handleAbsen` | saat Kirim | **penjagaan** — ini yang benar-benar menolak |

Gerbang kedua tidak boleh dihapus meski yang pertama sudah lolos. Yang
pertama berjalan di kode yang bisa diubah pengguna; yang kedua tidak.

---

## 3. Mendaftarkan wajah

**Panel Admin → Wajah karyawan.**

1. Pilih karyawan.
2. Unggah **maksimal 3 foto**. Analisisnya berjalan di **peramban admin**,
   bukan di server: Apps Script tidak bisa menjalankan model neural, dan
   mengirim foto mentah ke sana hanya menumpuk berkas besar tanpa gunanya.
3. Tiap foto langsung dilaporkan hasilnya (hijau = wajah terbaca, merah =
   ditolak beserta alasannya).
4. Simpan.

**Syarat foto:** menghadap depan, terang, tanpa masker atau kacamata gelap,
dan **hanya satu orang di dalam bingkai**. Foto berisi dua wajah ditolak —
bukan dipilih yang terbesar — karena menebak siapa yang dimaksud pada tahap
pendaftaran adalah kesalahan yang baru ketahuan berbulan-bulan kemudian.

Beberapa foto dari sudut sedikit berbeda membuat pencocokan lebih tahan
terhadap perubahan cahaya. Yang dipakai saat absen adalah **sampel
terdekat**, bukan rata-ratanya.

### Penjaga terhadap salah pilih berkas

Kalau dua foto yang diunggah berjarak > 0,7 satu sama lain, pendaftaran
ditolak dengan pesan *"Foto-foto yang diunggah tampaknya bukan orang yang
sama."* Ini menangkap kesalahan yang paling mungkin terjadi saat
mendaftarkan 300 orang berturut-turut: satu berkas nyasar dari folder
sebelah.

---

## 4. Ambang kemiripan

Model ini turunan dlib. Baik dlib maupun face-api memakai **0,60** sebagai
batas baku "orang yang sama". Kita mulai dari **0,52** — lebih ketat, karena
ongkos salah-terima (absen orang lain lolos) jauh lebih mahal daripada
salah-tolak (karyawan asli mengulang foto di tempat terang).

Ambangnya **bisa disetel dari Panel Admin**, dan itu bukan kemewahan. Kalau
foto acuan berasal dari arsip HRD yang lama, buram, atau menyerong, ambang
seketat ini akan menolak orang yang benar berulang kali — dan pada pagi hari
saat ratusan orang absen, satu-satunya jalan keluar yang tidak butuh deploy
adalah menaikkannya sedikit.

**Urutan tindakan yang benar ketika ada keluhan sering ditolak:**

1. Lihat foto acuannya. Kalau buram atau menyerong → **daftarkan ulang**.
   Ini penyelesaian yang benar.
2. Baru kalau foto acuannya sudah bagus dan tetap sering ditolak, naikkan
   ambang bertahap: 0,52 → 0,55 → 0,58.
3. **Jangan pernah lewat 0,60.** Di atas itu, orang berbeda mulai dianggap
   sama, dan fitur ini berubah dari penjaga menjadi hiasan.

---

## 5. Tiga mode, dan satu sakelar terpisah

| Mode | Wajah tidak cocok | Untuk kapan |
|---|---|---|
| `ketat` **(baku)** | **Absen ditolak**, foto dibuang | Setelah pendaftaran berjalan |
| `tandai` | Absen diterima, ketidakcocokan dicatat | Masa uji coba |
| `off` | — | Fitur mati |

**Sakelar "Wajib sudah terdaftar" berdiri sendiri**, dan inilah yang membuat
fitur ini bisa dinyalakan **sebelum** 300-an karyawan selesai didaftarkan:

* **Mati (baku):** karyawan yang belum punya wajah acuan tetap boleh absen
  (ditandai). Yang sudah terdaftar tetap dicocokkan dengan ketat.
* **Nyala:** karyawan tanpa wajah acuan tidak bisa presensi Masuk/Pulang
  sama sekali.

> Nyalakan sakelar ini **hanya setelah** bilah kemajuan di Panel Admin
> menunjukkan 100%. Menyalakannya lebih awal berarti mengunci setiap orang
> yang belum sempat didaftarkan — pada jam masuk, tanpa jalan keluar selain
> admin yang mendaftarkannya saat itu juga.

---

## 6. Berkas model — 6,4 MB, dan kapan diunduh

`public/models/face_recognition_model.bin` berukuran **6,4 MB**, tiga puluh
kali lipat detektor wajah yang sudah ada.

Karena itu ia **sengaja dipisah** dari `muatFaceApi()`:

* saat kamera Masuk/Pulang dibuka → **mulai** diunduh di latar, tidak
  ditunggu. Detik-detik yang dipakai karyawan memosisikan wajahnya adalah
  detik-detik yang dipakai berkas ini mengalir.
* saat tombol jepret ditekan → baru **ditunggu** sampai selesai. Karena
  janjinya dipakai ulang, panggilan kedua hampir selalu instan.

Kalau digabung ke pemuatan awal, karyawan menatap layar kosong belasan detik
di jaringan kantor yang pelan.

`public/.htaccess` sudah menyimpannya di cache HP selama 30 hari, jadi
ongkos 6,4 MB itu **sekali per HP per bulan** — bukan sekali per absen.
Pastikan folder `build/models/` benar-benar ikut ter-upload.

### Kalau modelnya gagal dimuat

Absen **tetap diteruskan**, dan itu disengaja. Menolak presensi karena
jaringan kantor sedang buruk adalah kegagalan yang salah alamat: yang
dihukum orang yang benar, dan yang menitipkan absen tetap lolos di hari
lain. Gerbang server tetap berjalan saat Kirim, dan kegagalannya ditandai
untuk ditinjau.

---

## 7. Apa yang dilihat karyawan

* Lingkaran panduan hijau + "Wajah penuh terverifikasi ✓" → lapis 1.0.17
  lolos.
* Baris biru "Menyiapkan pencocokan wajah…" → model masih diunduh.
* Setelah jepret: kotak hijau **"Wajah cocok dengan data karyawan ✓"**.
* Kalau tidak cocok: foto **dibuang**, kamera tetap menyala, dan muncul
  pesan yang menyebut apa yang harus dilakukan — coba di tempat lebih
  terang, lepas masker/topi, hubungi admin bila tetap gagal.

Kalau penolakan datang dari server saat Kirim (bukan saat jepret), fotonya
juga dibuang. Tanpa itu, ada jalan mengirim ulang isi yang sama tanpa
menghadap kamera lagi.

---

## 8. Pemasangan

1. `npm run build` → upload **seluruh isi `build/`**. Periksa khusus:
   `build/models/face_recognition_model.bin` (6,4 MB) harus ada.
2. Tempel `apps-script/FaceProfile.gs` sebagai file baru di editor Apps
   Script.
3. Jalankan **`SETUP_FACE_PROFILE()`** sekali.
4. Deploy (lihat urutan lengkap di `KUNCI-PERANGKAT.md` bagian 7 — frontend
   dulu, backend belakangan).
5. Daftarkan wajah karyawan lewat Panel Admin. Fitur sudah aman berjalan
   selama proses ini karena "Wajib sudah terdaftar" masih mati.

---

## 9. Yang belum ditutup

1. **Foto dari layar HP lain** (foto wajah rekan yang ditampilkan di layar,
   lalu digoyang) masih dijaga oleh liveness 1.0.17, bukan oleh lapis ini.
   Lapis ini justru akan bilang "cocok" kalau yang ditampilkan memang wajah
   pemilik akun — jadi liveness tetap penting dan tidak boleh dilonggarkan.
2. **Kembar identik.** Tidak ada ambang yang memisahkan mereka. Kalau ini
   nyata di perusahaan Anda, andalkan penguncian perangkat untuk kasus itu.
3. **Perubahan wajah besar** (berjenggot lebat setelah sebelumnya bersih,
   jilbab yang menutupi garis rahang) akan menaikkan jarak. Penyelesaiannya
   mendaftarkan ulang, bukan menaikkan ambang untuk semua orang.
4. **Deskriptor bisa diputar ulang.** Klien yang dimodifikasi bisa menyimpan
   128 angka dari absen yang berhasil dan mengirimkannya lagi besok. Yang
   membatasi kerusakannya: ia harus punya akses ke akun itu, ke sesinya yang
   masih berlaku, dan lolos gerbang GPS serta geofence. Kalau ini perlu
   ditutup rapat, langkah berikutnya adalah menandatangani deskriptor
   bersama timestamp foto dan menolak yang berulang.
