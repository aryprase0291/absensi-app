# Perbaikan Kecepatan Login — Lanjutan Setelah `dbabsen` Statis

Dikerjakan 13 Agustus 2026. Kelanjutan dari `DIAGNOSA-LAMBAT.md` dan
`IMPORT-DBABSEN.md`.

---

## Kenapa baru sekarang bisa

`DIAGNOSA-LAMBAT.md` menyebut penyebab utama lambat adalah `dbabsen` yang
berisi IMPORTRANGE dan dibaca penuh tiap login. Itu sudah selesai lewat
import Excel. **Yang belum dimanfaatkan adalah efek sampingnya.**

Selama `dbabsen` diisi IMPORTRANGE, isinya bisa berubah kapan saja tanpa
ada kejadian yang bisa dipantau — jadi hasil perhitungannya haram di-cache,
karena tidak ada cara tahu kapan angkanya jadi basi.

Sejak diganti import, `dbabsen` **hanya berubah pada satu momen**: saat
admin menekan tombol Import. Itu titik yang bisa dipakai untuk membuang
cache. Perubahan terbesar di bawah bertumpu pada fakta ini.

---

## Yang diverifikasi dulu, bukan ditebak

Diambil langsung dari spreadsheet `absen` produksi (read-only, lewat
export Drive), 13 Agustus 2026:

| Sheet | Baris | Kolom | Sel formula |
|---|---|---|---|
| `dbabsen` | 6.920 (6.700 berisi NIK) | 49 | **0** ✅ |
| `MASTER-CUTI` | **7.511** | 27 | **7.854** ⚠️ |
| `Absensi` | 2.336 | 46 | 0 |
| `Users` | 305 | 18 | 521 (kolom O, P) |
| `Announcements` | 999 | 26 | 0 |
| `Remarks` | 863 | 26 | 0 |

Dua temuan yang mengubah rencana:

1. **`dbabsen` memang bersih** — 0 formula, `T1` = 12 Agu 2026 23:48.
   Import bekerja seperti yang diharapkan.

2. **`MASTER-CUTI` hanya berisi 325 baris data, tapi sheet-nya 7.511 baris.**
   Kolom U diisi `=B2` yang ter-drag sampai bawah — 7.510 sel formula di
   baris yang tidak ada datanya. Akibatnya `getDataRange()` menarik
   7.511 × 27 = **202.797 sel** dan memaksa 7.510 formula itu dihitung
   ulang, hanya untuk mengambil angka cuti satu orang.

---

## Perubahan

### 1. Jalur buka-aplikasi: 3 request → 1

Dulu:

```
POST login                      -> Users, MasterData, MASTER-CUTI
POST get_latest_announcement    -> Announcements
POST get_stats                  -> Absensi, dbabsen, Users, MASTER-CUTI, Remarks
```

Ketiganya **berurutan**, bukan paralel — Apps Script menjalankan eksekusi
milik user yang sama satu per satu. Dan tiap POST dijawab 302 redirect ke
`script.googleusercontent.com`, jadi 3 request = 6 round trip HTTP,
ditambah boot container tiga kali.

Sekarang `handleLogin` menitipkan keduanya di respons yang sama:

```js
stats: statsLogin,
pengumuman: pengumumanLogin,
pengumumanDisertakan: pengumumanOk
```

Gratis, karena `noPayroll` dan peta cuti sudah ada di memori — `hitungStats()`
dipanggil dengan keduanya sebagai argumen sehingga tidak membaca ulang sheet
`Users` maupun `MASTER-CUTI`.

**Kedua titipan dibungkus `try` terpisah.** Kalau perhitungan stats gagal,
login tetap berhasil dan frontend mengambil sendiri lewat `get_stats` —
persis perilaku lama.

Untuk pengumuman ada satu kehalusan: `null` bisa berarti dua hal berbeda —
"tidak ada pengumuman aktif" dan "gagal dibaca". Kalau tidak dibedakan,
pengumuman yang gagal dibaca akan hilang diam-diam. Karena itu ada penanda
`pengumumanDisertakan` yang hanya `true` kalau pembacaannya benar-benar
berhasil.

### 2. Statistik mesin tidak lagi menyisir `dbabsen` — file baru `StatsIndex.gs`

Dulu `handleGetStats` menyisir 6.700 baris `dbabsen` untuk menghitung angka
**satu orang**, setiap kali dashboard dibuka. Biayanya tumbuh tiap import.

Sekarang `dbabsen` disisir **sekali** menjadi indeks agregat per NIK, lalu
disimpan di `CacheService`:

```
{ "A0009": { hadir, telat_freq, telat_menit, sakit, alpa,
             no_scan_in, no_scan_out, min_ts, max_ts }, ... }
```

- 310 NIK = **30.045 byte**. Batas `CacheService` 100 KB per kunci, jadi
  margin ~72 KB. Kalau suatu saat lewat batas, `put()` gagal **diam-diam** —
  karena itu ada pemeriksaan ukuran yang menulis peringatan ke log, supaya
  penyebabnya kelihatan dan bukan muncul sebagai "kok lambat lagi ya".
- Invalidasi ada di akhir `handleImportDbAbsen` (`ImportDbAbsen.gs`).
  **Kalau baris itu hilang, dashboard akan menampilkan angka periode
  sebelumnya sampai TTL 6 jam habis.**
- Indeks langsung disusun ulang di sana juga (`IDX_HANGATKAN()`), supaya
  biaya scan ditanggung proses import — bukan orang pertama yang login.

**Angkanya sudah diuji identik.** Algoritma lama dan indeks baru dijalankan
berdampingan atas data asli untuk **seluruh 310 NIK**: selisih **0**.

### 3. `MASTER-CUTI` tidak lagi menyentuh kolom U

`getPetaCutiCached()` sekarang membaca dua rentang sempit — kolom B, lalu
kolom W:Y — bukan `getDataRange()`. Kolom U dilompati sepenuhnya.

**202.797 sel → 30.044 sel**, dan 7.510 formula tidak lagi dihitung ulang.

### 4. `Users` dibaca 14 kolom, bukan 18

Kolom O dan P berisi `VLOOKUP` ke `Sheet7` (519 sel). Nilainya tidak dipakai
sama sekali oleh `handleLogin`, tapi `getDataRange()` ikut menariknya dan
memicu perhitungan ulang. Berhenti di kolom N menghindari itu.

### 5. `get_stats` duplikat di layar DB Absen dibuang

Layar DB Absen menembak `get_stats` sendiri hanya untuk **satu angka**
(`ijin_count`), padahal Dashboard baru saja memegangnya. Sekarang dipakai
ulang dari `sessionStorage`; request hanya ditembak kalau nilainya benar-benar
belum ada.

---

## Hasil hitung baca sel

Jalur buka-aplikasi, cache hangat:

| | Sebelum | Sesudah |
|---|---|---|
| Jumlah request | **3** (6 round trip + 3× boot) | **1** (2 round trip + 1× boot) |
| `Users` | 5.490 sel + 519 formula | 4.270 sel, tanpa formula |
| `Announcements` | 25.974 sel | 3.996 sel |
| `Absensi` | 30.368 sel | 30.368 sel |
| `dbabsen` | 103.800 sel | **0** (dari indeks) |
| `Users` (baca kedua) | 2.440 sel | **0** |
| `Remarks` | 8.630 sel | 8.630 sel |
| **Total** | **176.702 sel** | **47.264 sel** |

Cache dingin (`MASTER-CUTI`): 202.797 sel → 30.044 sel.

Yang lebih penting daripada angka itu: **biaya `dbabsen` sekarang tetap,
tidak tumbuh lagi tiap import.**

---

## Yang perlu Anda lakukan

### A. Apps Script

1. Buka editor Apps Script spreadsheet `absen`.
2. Tambah file baru **`StatsIndex`**, tempel isi `apps-script/StatsIndex.gs`.
3. Tambah file baru **`MasterCutiBersih`**, tempel isi
   `apps-script/MasterCutiBersih.gs`.
4. Timpa isi **`Kode.gs`** dengan `apps-script/Code.gs`.
5. Timpa isi **`Cache.gs`** dengan `apps-script/Cache.gs`.
6. Timpa isi **`ImportDbAbsen.gs`** dengan `apps-script/ImportDbAbsen.gs`.
7. Deploy ulang: **Deploy → Kelola deployment → edit → Versi baru**.
8. Jalankan `IDX_UJI()` sekali. Log-nya akan menunjukkan selisih dingin vs
   panas. Kalau "panas" tidak jauh lebih kecil, cache tidak bekerja —
   periksa dulu baris ukuran JSON-nya.

> Jangan lupa dua file Telegram (`SendTelegramRemark.gs`,
> `SendTelegramForm.gs`) yang hanya ada di editor dan tidak di repo —
> keduanya tidak disentuh perubahan ini.

### B. Frontend

```bash
npm run build
```

lalu deploy seperti biasa. `APP_VERSION` dan `CLIENT_VERSION` sudah dinaikkan
ke **1.0.14**.

Kenaikan versi ini **tidak wajib untuk kompatibilitas** — backend baru tetap
melayani klien 1.0.13, dan klien baru tetap jalan di backend lama (`data.stats`
tinggal `undefined`, lalu jatuh ke `get_stats` seperti dulu). Dinaikkan supaya
semua HP menarik bundle baru dan benar-benar ikut merasakan penghematannya.

### C. Membersihkan `MASTER-CUTI` (opsional)

Aplikasi **tetap cepat walau ini tidak dijalankan** — `Cache.gs` sudah tidak
menyentuh kolom U. Membersihkannya membuat sheet lebih ringan dibuka manual
dan menghilangkan sumber kebingungan.

Urutannya jangan dilangkahi:

1. **Buat salinan spreadsheet dulu** (File → Buat salinan).
2. Jalankan `MASTERCUTI_PERIKSA()` — **read-only**, tidak mengubah apa pun.
   Baca log-nya. Kalau ada sel berisi nilai (bukan formula) di zona yang mau
   dihapus, dia akan bilang **JANGAN DIBERSIHKAN DULU** dan menunjukkan
   letaknya. Periksa manual dulu kalau itu terjadi.
3. Baru jalankan `MASTERCUTI_BERSIHKAN()`. Fungsi ini punya pengaman sendiri
   dan akan membatalkan diri kalau menemukan nilai di zona itu.
4. Jalankan `CACHE_BERSIHKAN()` supaya peta cuti disusun ulang.

---

## Catatan untuk perubahan berikutnya

- **Kalau nanti ada kode lain yang menulis ke `dbabsen` selain import,
  kode itu WAJIB memanggil `bersihkanIndeksDbAbsen()`.** Kalau tidak,
  dashboard menampilkan angka periode sebelumnya sampai TTL 6 jam habis.
  Ini jenis bug yang tidak melempar error dan tidak muncul di log — hanya
  terlihat sebagai "angkanya kok tidak berubah".

- `IDX_HADIR_SYMBOLS` di `StatsIndex.gs` adalah salinan dari daftar yang
  dulu ada di `handleGetStats`. Kalau daftar simbol berubah, ubah di sana
  **dan** naikkan `KUNCI_IDX_DBABSEN` ke `_V2`, kalau tidak cache lama tetap
  terpakai dengan aturan lama.

- Yang **belum** disentuh dan akan jadi penghambat berikutnya kalau data
  terus tumbuh: `Absensi` (30.368 sel) dan `Remarks` (8.630 sel) masih
  disisir penuh tiap `hitungStats`. Keduanya tumbuh tiap ada pengajuan.
  Polanya sama persis dengan `dbabsen` — bedanya keduanya berubah setiap
  saat, jadi butuh pendekatan berbeda (misal sheet rekap yang diperbarui
  saat penulisan, bukan cache).
