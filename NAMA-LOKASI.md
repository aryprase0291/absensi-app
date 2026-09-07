# Nama Lokasi — Koordinat Menjadi Alamat Terbaca

Ditulis 7 Sep 2026. Sebelumnya kolom Lokasi hanya berisi angka seperti
`-7.290039699999999, 112.73560859999999`. Tidak ada yang bisa membacanya, jadi
HRD harus menyalin-tempel ke Google Maps satu per satu untuk memverifikasi satu
baris absen.

Sekarang tampil sebagai **`Jl. Raya Darmo No. 68, Wonokromo, Surabaya`**.

---

## Dua aturan yang tidak boleh dilanggar

### 1. Kolom Lokasi (kolom F) TETAP berisi angka

Geofence (`validasiGeofence`) dan mesin anti-Fake GPS (`AntiFakeGps.gs`) membaca
kolom itu **sebagai angka**. Mengganti isinya dengan teks alamat akan mematikan
kedua fitur itu diam-diam — tidak ada error, hanya berhenti bekerja.

Alamat ditulis ke **kolom baru bernama `Alamat`**, dicari berdasarkan nama
header (`indeksKolomAlamat`), bukan index tetap. Alasannya sama seperti kolom
audit GPS: sheet Absensi memakai kolom Q (Catatan Admin) dan V (ID Akun) di luar
16 kolom yang ditulis `appendRow`, jadi menebak index adalah cara tercepat
merusak data yang sudah ada.

### 2. Geocoding gagal TIDAK boleh menggagalkan absen

Kuota habis, layanan Google bermasalah, koordinat di tengah laut — semuanya
berakhir dengan kolom Alamat kosong dan **absen tetap tersimpan**. Tampilan
jatuh kembali ke koordinat.

Absensi tidak boleh berhenti hanya karena penamaan lokasi gagal.

---

## Layanan & kuota

Memakai `Maps.newGeocoder()` — layanan Maps bawaan Apps Script. **Tanpa API key,
tanpa biaya.**

| Jenis akun | Kuota geocoding |
|---|---|
| Konsumer (gmail.com) | 1.000 / hari |
| Google Workspace | 10.000 / hari |

Dengan cache di bawah, pemakaian nyata jauh di bawah itu.

---

## Cache tiga lapis

| Lapis | Media | Umur | Guna |
|---|---|---|---|
| 0 | Memori eksekusi (`_geoMemo`) | 1 request | Backfill 500 baris hanya membaca sheet sekali |
| 1 | `CacheService` | 6 jam | Absen beruntun pagi hari |
| 2 | Sheet `GeoCache` | Permanen | **Satu titik hanya memakai kuota SEKALI seumur hidup** |

Lapis 2 yang paling penting. `CacheService` maksimal 6 jam, jadi tanpa sheet ini
koordinat kantor akan di-geocode ulang beberapa kali setiap hari selamanya.

Kunci cache dibulatkan ke **4 desimal (≈ 11 meter)**. Makin presisi kuncinya,
makin jarang cache kena dan makin banyak kuota terpakai; 11 meter masih di dalam
bangunan yang sama sehingga label alamatnya tetap benar.

`ZERO_RESULTS` (titik yang memang tidak punya alamat) ikut di-cache sebagai `-`
supaya tidak dipanggil berulang selamanya.

---

## Format alamat

Target: **Jalan + Kelurahan + Kota**.

Google mengembalikan `address_components` dengan tipe berbeda-beda tergantung
serapat apa titik itu dipetakan. Di Indonesia polanya:

| Komponen | Isi |
|---|---|
| `route` + `street_number` | Jalan Raya Darmo, 68 |
| `administrative_area_level_4` | Kelurahan (Wonokromo) |
| `administrative_area_level_3` | Kecamatan |
| `administrative_area_level_2` | Kota / Kabupaten |

Penyesuaian yang dilakukan:

- `Jalan Raya Darmo` → `Jl. Raya Darmo` (lebih lazim di dokumen HR, hemat lebar kolom)
- `Kota SBY` → `Surabaya` — singkatan ini benar-benar dikembalikan Google dan tidak terbaca siapa pun
- `Kabupaten Sidoarjo` → `Kab. Sidoarjo`
- Kelurahan yang sama dengan nama kota tidak diulang
- Plus Code (`JQ8H+2R ...`) dibuang — itu bukan alamat yang berguna
- Kode pos dibuang, baik yang berdiri sendiri maupun yang menempel di nama provinsi

Kalau `route` tidak ada, jatuh ke `formatted_address` yang dipotong tiga bagian
pertama tanpa provinsi, kode pos, dan "Indonesia".

---

## Di mana muncul

| Tempat | Perilaku |
|---|---|
| **Form absen** (Hadir, Pulang, Dinas, Standby, Lembur, Off) | Nama tempat muncul menggantikan angka, dengan indikator "Mencari nama lokasi…". Akurasi GPS tetap ditampilkan. |
| **Stempel di dalam foto absen** | Nama alamat dibakar ke foto menggantikan koordinat. Kalau alamat belum siap saat tombol jepret ditekan, koordinat dipakai sebagai cadangan (6 desimal, bukan 15). |
| **Detail riwayat harian** | Setiap catatan online menampilkan alamat; baris lama yang belum terisi jatuh ke koordinat. |
| **Monitoring Integritas GPS** | Kejadian mencurigakan menampilkan alamat — untuk percobaan yang **ditolak** ini paling berharga: HRD membaca "Jl. X, Sidoarjo", bukan sederet angka. |
| **Sheet Absensi** | Kolom `Alamat` |
| **Sheet GpsAudit** | Kolom `Alamat` |

Pengambilan alamat di form **tidak memblokir tombol kirim**. Nama lokasi itu
untuk dibaca manusia; yang menentukan sah tidaknya absen tetap koordinat dan
geofence di server.

Reverse geocoding dikerjakan **server**, bukan browser, supaya hasilnya bisa
di-cache lintas karyawan — satu titik hanya memakai kuota sekali, bukan sekali
per orang per absen.

---

## Data lama

Sesuai keputusan, data lama **tidak diisikan otomatis** dan tetap menampilkan
koordinat.

Kalau suatu saat berubah pikiran, atau ada baris yang alamatnya gagal didapat
saat absen, jalankan dari editor Apps Script:

```js
isiAlamatYangKosong(200)   // 200 baris per panggilan
```

Bekerja dari baris **terbaru** ke belakang, melewati baris yang alamatnya sudah
ada, dan berhenti sendiri setelah 5 kegagalan beruntun (indikasi kuota habis).
Jalankan lagi untuk sisanya. Batas per panggilan menjaga eksekusi di bawah 6
menit dan kuota harian tidak terkuras sekaligus.

---

## Uji

```bash
node scripts/test-geocode.js
```

16 kasus: alamat lengkap, komponen tidak lengkap, normalisasi `Kota SBY` dan
`Kabupaten`, jalan yang sudah berawalan `Jl.` (tidak boleh dobel), Plus Code,
kode pos yang menempel, respons kosong/null, dan parsing koordinat.

---

## Berkas yang berubah

| Berkas | Perubahan |
|---|---|
| `apps-script/Geocode.gs` | **Baru.** Reverse geocoding, cache 3 lapis, format alamat, backfill. |
| `apps-script/Code.gs` | Tulis kolom Alamat saat absen, endpoint `get_alamat`, kirim alamat di `get_history` & `get_db_absen`. |
| `apps-script/Auth.gs` | Daftarkan `get_alamat` (semua user) di `ACTION_ROLES`. **Wajib** — tanpa ini action ditolak. |
| `apps-script/AntiFakeGps.gs` | Kolom Alamat di sheet GpsAudit dan di laporan analisa. |
| `src/App.js` | State + efek ambil alamat, tampilan form, detail riwayat. |
| `src/screens/GpsAuditScreen.js` | Alamat pada kejadian dan analisa riwayat. |
| `scripts/test-geocode.js` | **Baru.** 16 kasus uji. |
| `scripts/test-router-auth.js` | **Baru.** Menjaga rute dan tabel izin tetap sinkron. |
| `scripts/test-stempel-foto.js` | **Baru.** 10 kasus uji pembungkusan teks stempel foto. |

**Deploy:** salin `Geocode.gs` sebagai file baru di editor Apps Script, perbarui
`Code.gs`, `Auth.gs`, dan `AntiFakeGps.gs`.

Lalu **Deploy → Kelola deployment → ikon pensil → Versi: Versi baru → Deploy.**

> Jangan pakai *Deployment baru*. Itu membuat URL `/exec` yang berbeda, dan
> aplikasi masih menembak URL lama di `src/config/constants.js` — jadi seolah-olah
> tidak ada yang berubah.

Frontend ikut lewat push ke git (Vercel build dari sumber; folder `build/`
di-gitignore jadi hasil build lokal tidak berpengaruh). Sheet `GeoCache`
dan kolom `Alamat` dibuat otomatis saat absen pertama masuk.

Saat pertama kali dijalankan, Apps Script akan meminta izin tambahan untuk
layanan Maps — setujui sekali di dialog otorisasi.

---

## Kenapa fitur ini sempat tidak jalan (7 Sep 2026)

Menambah action di aplikasi ini butuh **dua** langkah yang letaknya berjauhan:

1. Rute di `Code.gs` → `doPost`
2. Izin di `Auth.gs` → `ACTION_ROLES`

Langkah 2 terlewat. Yang bikin sulit ketahuan: lupa langkah ini **tidak
menimbulkan error apa pun** — `authorizeRequest` menjawab `"Action tidak
dikenal."`, client menganggapnya "alamat tidak tersedia", lalu jatuh ke
koordinat. Persis seperti kalau fiturnya memang belum di-deploy.

Sekarang dijaga oleh:

```bash
node scripts/test-router-auth.js
```

Membandingkan semua action yang dirutekan di `Code.gs` dengan tabel izin di
`Auth.gs`. **Jalankan setiap kali menambah action baru.**

Client juga sekarang menulis `console.warn('[alamat] server menolak: ...')`
supaya penyebabnya kelihatan di DevTools, bukan hilang diam-diam.

---

## Stempel di dalam foto (8 Sep 2026)

Ini terlewat pada perubahan pertama. Tampilan form sudah menampilkan nama
alamat, tapi foto absen **tetap** menunjukkan koordinat — karena stempel foto
adalah kode yang sama sekali terpisah: sebuah canvas yang membakar teks ke
gambar sebelum diunggah, dan barisnya masih berbunyi

```js
let gpsText = location ? `${location.lat}, ${location.lng}` : "No GPS";
```

Itulah asal angka `-7.247680086678265, 112.73673079382687` pada foto.

Sekarang stempel memakai nama alamat. Dua hal yang harus ditangani karena
teks alamat jauh lebih panjang dari koordinat:

- **Pembungkusan baris.** Alamat dipecah maksimal 2 baris; kalau masih tidak
  muat, ukuran huruf dikecilkan bertahap (maksimal 6 kali, tiap kali 15%).
- **Pemotong pengaman.** Satu kata yang lebih lebar dari foto tidak bisa
  dibungkus sama sekali, jadi dipotong dengan `…`. Tanpa ini teksnya meluber
  keluar bingkai dan justru bagian depan alamat yang hilang.

### Stempel digambar ULANG setelah alamat tiba

Perbaikan pertama masih kurang, dan gejalanya tetap sama: foto terus berisi
koordinat meski geocoding jelas berjalan.

Sebabnya urutan layar. Seksi **Foto** berada di ATAS seksi **Lokasi**, jadi
karyawan menekan jepret lebih dulu — sementara nama alamat baru tiba beberapa
detik kemudian, setelah GPS terkunci (dua sampel + jeda 1,2 detik untuk
pengukuran jitter) lalu satu perjalanan bolak-balik ke Apps Script. Praktis
tidak pernah ada alamat pada saat tombol jepret ditekan.

Sekarang foto **polos** disimpan di `fotoMentahRef` beserta jam jepretnya.
Begitu alamat tiba, stempel digambar ulang di atas gambar polos itu, dan
pratinjau ikut diperbarui. Jam yang tertulis tetap jam saat foto diambil,
bukan jam saat alamat datang.

Pengambilan foto tetap **tidak ditahan** menunggu jaringan. Kalau alamat tidak
pernah datang, koordinat dipakai sebagai cadangan — kini 6 desimal, bukan 15
digit penuh.

Satu hal yang wajib ikut: tombol ambil ulang foto **harus mengosongkan**
`fotoMentahRef`. Tanpa itu, efek penggambaran ulang akan memunculkan kembali
foto yang baru saja dibuang karyawan.

Koordinat aslinya tetap tersimpan penuh di kolom Lokasi dan sheet `GpsAudit`,
jadi nilai forensiknya tidak berkurang sedikit pun.

Diuji dengan `node scripts/test-stempel-foto.js` — 10 kasus pada lebar foto
480/720/1080 px, memastikan tidak ada teks yang hilang maupun meluber.

---

## Laporan & Cetak Data mendadak kosong (8 Sep 2026)

Gejalanya: layar **Laporan & Cetak Data** menampilkan "Tidak ada data sesuai
filter" untuk periode yang jelas-jelas berisi data (49 Hadir + 41 Pulang pada
1–8 Sep di sheet).

Penyebabnya bukan di repo ini. Saat `Code.gs` digabungkan **manual** ke
`Kode.gs` di editor Apps Script, tiga baris deklarasi ini ikut hilang —

```js
let _idxAlamatHistory = -1;
if (typeof indeksKolomAlamat === 'function') { ... }
```

— sementara baris yang MEMAKAI `_idxAlamatHistory` tetap tertinggal di dalam
`handleGetHistory`. Hasilnya `ReferenceError` setiap kali riwayat diminta.

Yang membuatnya sulit dilacak: `doPost` membungkus semuanya dengan try/catch,
jadi Apps Script tetap mencatat eksekusi sebagai **"Selesai"** (tidak ada
eksekusi gagal sama sekali di log), dan client hanya menjalankan
`if (data.result === 'success')` tanpa cabang else — errornya hilang tanpa
jejak, menyisakan tabel kosong.

**Dua perbaikan:**

1. Akses kolom Alamat sekarang berupa **satu pemanggilan mandiri**
   (`nilaiAlamatBaris()` dan `lebarBacaAbsensi()` di `Geocode.gs`). Tidak ada
   lagi pasangan "deklarasi di atas, pemakaian jauh di bawah" yang bisa
   terpisah saat digabung manual.

2. Gerbang baru `node scripts/test-apps-script-lint.js` memeriksa SELURUH
   berkas `.gs` sebagai satu ruang lingkup (seperti runtime Apps Script) dan
   menolak identifier yang dipakai tapi tidak pernah dideklarasikan. Diuji
   dengan menyisipkan kembali bug aslinya — gerbang menangkapnya beserta
   nomor barisnya.

**Pelajaran yang lebih besar:** repo dan project Apps Script tidak identik
(`Kode.gs` punya blok Telegram, ada `Geofence.gs` yang tidak ada di repo), jadi
penggabungan manual akan terus terjadi dan akan terus berisiko. `handleGetHistory`
dan `handleGetDbAbsen` tidak mengandung kode Telegram sama sekali — keduanya aman
disalin utuh dari repo, tidak perlu digabung baris per baris.
