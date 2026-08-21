# Diagnosa: Kenapa Login Lambat Lagi (21 Agustus 2026)

Kelanjutan dari `DIAGNOSA-LAMBAT.md` (12 Agu) dan `PERBAIKAN-LOGIN.md` (13 Agu).
File yang diubah: `apps-script/StatsIndex.gs`, `apps-script/Cache.gs`.

---

## Kesimpulan

Ada **dua** masalah, dan yang kedua ternyata jauh lebih luas dari dugaan awal.

| | Masalah | Status |
|---|---|---|
| **A** | Menyisir `dbabsen` makan 15 detik, bukan 1-2 detik seperti seharusnya | **Selesai, terukur** |
| **B** | **CacheService di skrip ini tidak menyimpan apa pun** | **Selesai, terukur** |

Masalah B bukan cuma soal indeks `dbabsen`. `CacheService` dipakai di **empat**
tempat, dan **tidak satu pun pernah bekerja** sejak dibuat.

### Hasil terukur (jalur `get_stats` / login)

| | Awal | Sesudah |
|---|---|---|
| Panas (setiap login) | 16.692 ms | **276 ms** |
| Dingin (saat `dbabsen` berubah) | 15.107 ms | **1.810 ms** |
| Ukuran indeks | 113.196 byte | **5.408 byte** (5%) |

Dan simpanannya sekarang **tidak kedaluwarsa**, jadi scan dingin 1,8 detik itu
hanya terjadi saat import — bukan minimal 4× sehari seperti kalau pakai TTL
6 jam.

---

## Masalah A — kenapa menyisir 6.700 baris makan 15 detik

Membaca 6.700 × 15 sel dari Sheets hanya makan sekitar 1-2 detik. Sisanya
habis di dalam loop:

```js
const tanggalBaris = ts === null ? '' :
    Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
...
    const tanggal = Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
...
    const tanggal = Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
```

`Session.getScriptTimeZone()` dan `Utilities.formatDate()` **bukan operasi
JavaScript biasa** — keduanya panggilan ke layanan Apps Script yang harus
menyeberang batas proses, sekitar 0,3–0,7 ms sekali panggil. Dipanggil di
dalam loop, per baris, sampai 3 kali. Dan ketiga ekspresinya **persis sama**.

| | Panggilan layanan | Waktu |
|---|---|---|
| Sebelum | **20.910** | 15.107 ms |
| Sesudah | **32** | 1.810 ms |

Perbaikannya: zona waktu diambil sekali di luar loop, hasil format tanggal
di-memo per timestamp, dan `tanggalBaris` yang sudah dihitung di awal baris
dipakai ulang.

> **Rumus perhitungannya tidak disentuh.** Loop lama dan loop baru dijalankan
> berdampingan atas 6.636 baris sintetis — termasuk NIK kotor (`-`), tanggal
> berupa string vs objek `Date`, tanggal tidak valid, dan baris di luar
> periode. Hasilnya **identik, selisih 0**.

---

## Masalah B — CacheService tidak menyimpan apa pun

Empat percobaan, semuanya gagal dengan cara berbeda:

| Versi | Cara | Hasil |
|---|---|---|
| v1 | `cache.put()` satu kunci, 113 KB | gagal **diam-diam** (>100 KB) |
| v2 | dipecah per NIK + `cache.putAll()` | gagal — `putAll()` dibatasi **total** 100 KB per panggilan |
| v3 | loop `cache.put()` per potongan | error `The parameters () don't match...` |
| v4 | gzip+base64, **5.408 byte**, satu kunci | **ditulis tanpa error, hilang saat dibaca ulang** |

**v4 adalah bukti yang menentukan.** 5.408 byte itu hanya 5% dari batas
100 KB, dan tetap hilang. Jadi ukuran sama sekali bukan penyebabnya —
CacheService di skrip ini memang tidak menyimpan.

Selama ini kegagalannya tidak terlihat karena `cache.put()` **tidak melempar
error**. Tidak ada error, tidak ada log — yang tampak hanya "kok lambat lagi".

### Penyimpanannya sekarang: Script Properties

| | CacheService | Script Properties |
|---|---|---|
| Di skrip ini | tidak menyimpan | **bekerja** |
| Masa berlaku | maksimal 6 jam | **tidak ada** |
| Batas | 100 KB per kunci | 9 KB per nilai, 500 KB total |
| Indeks 5.408 byte | — | muat dalam 1 properti |

Properties justru **lebih cocok** untuk indeks `dbabsen`: isinya hanya berubah
lewat tombol Import, jadi tidak ada gunanya kedaluwarsa sendiri. Model
invalidasi eksplisit yang sudah dipakai (`bersihkanIndeksDbAbsen()`) memang
pasangan yang tepat untuknya.

CacheService tetap dipasang sebagai lapisan cepat di depannya, tapi tidak
diandalkan — kalau gagal, semuanya tetap berjalan normal.

### Yang lebih penting: kegagalan tidak lagi senyap

Setiap penulisan sekarang **diverifikasi dengan dibaca kembali**, dan hasilnya
masuk log:

```
Indeks dbabsen tersimpan: 214 NIK, 113196 byte -> 5408 byte (1 potongan properti).
Cache: tidak terpakai (ditulis tanpa error, tapi hilang saat dibaca ulang).
```

---

## Dampak yang baru ketahuan: `Cache.gs` juga tidak pernah bekerja

Begitu terbukti CacheService mati di skrip ini, konsekuensinya melebar.
`Cache.gs` memakainya untuk **tiga** data, semuanya di jalur terpanas:

| Fungsi | Dipanggil dari | Yang dibaca ulang tiap kali |
|---|---|---|
| `getMasterDataCached()` | `handleLogin` (`Code.gs:1516`) | sheet `MasterData` penuh |
| `getPetaCutiCached()` | `handleLogin` (1522) **dan** `hitungStats` (1804) | `MASTER-CUTI` — 30.044 sel |
| `getGeofenceConfigCached()` | `handleAbsen` (1421) — **jalur paling sering dipakai** | sheet `Geofence` penuh |

Artinya tabel "cache hangat" di `PERBAIKAN-LOGIN.md` **tidak pernah tercapai**.
Yang selama ini berjalan adalah kolom "cache dingin" — setiap login membaca
`MasterData` + `MASTER-CUTI` dari sheet, dan **setiap tap Hadir/Pulang**
membaca sheet `Geofence`.

`Cache.gs` sudah diperbarui memakai lapisan penyimpanan yang sama.

**Satu perbedaan yang disengaja dari `StatsIndex.gs`:** ketiga data ini
**tetap punya masa berlaku 10 menit**. Indeks `dbabsen` boleh disimpan
selamanya karena hanya berubah lewat tombol Import — ada kejadian yang bisa
dipantau. `MASTER-CUTI` tidak begitu: bisa disunting langsung di sheet atau
oleh `SyncCuti`. Kalau disimpan tanpa batas waktu, angka cuti bisa basi tanpa
ada yang menyadarinya. Karena Properties tidak punya TTL, masa berlaku itu
dicatat sendiri sebagai stempel waktu.

---

## Yang perlu Anda lakukan

### 1. `StatsIndex.gs` — ✅ sudah selesai & terbukti

Sudah ditempel dan diuji. Hasilnya `>>> BERHASIL`.

### 2. `Cache.gs` — tempel & deploy

Timpa isi `Cache.gs` di editor Apps Script dengan
`apps-script/Cache.gs` yang sudah diperbarui.

### 3. ⚠️ Satu baris di `Code.gs` WAJIB diubah

`Code.gs` baris **1666** (di dalam `handleTambahMaster`) masih membersihkan
cache lewat CacheService langsung:

```js
try { CacheService.getScriptCache().remove(KUNCI_MASTERDATA); } catch (e) { ... }
```

Itu tidak lagi cukup — sumber kebenarannya sekarang Properties. Ganti menjadi:

```js
try { MASTERDATA_CACHE_BERSIHKAN(); } catch (e) { console.warn('Gagal bersihkan MasterData: ' + e.message); }
```

> Kalau baris ini tidak diubah, departemen/master baru yang ditambahkan admin
> baru muncul untuk user lain setelah 10 menit. Tidak merusak data, tapi
> membingungkan.

### 4. Deploy & uji

**Deploy → Kelola deployment → pensil → Versi baru → Deploy** (pakai
deployment yang ada supaya URL tidak berubah), lalu jalankan:

- **`CACHE_UJI()`** — harus `>>> BERHASIL: ketiganya tersimpan.`
- **`IDX_DIAGNOSA()`** (di `StatsIndex.gs`) — opsional tapi berguna: menguji
  penyimpanan sendirian tanpa menyentuh sheet, dan menunjukkan di dimensi mana
  CacheService gagal (ukuran / TTL / panjang kunci / UserCache / DocumentCache).
  Aplikasi tidak butuh hasilnya untuk jadi cepat.

### 5. Commit

```bash
git add apps-script/StatsIndex.gs apps-script/Cache.gs apps-script/Code.gs DIAGNOSA-LAMBAT-LAGI.md
git commit -m "perf: hilangkan 20rb panggilan layanan di scan dbabsen + pindah simpanan ke Script Properties"
```

---

## Catatan perubahan perilaku

- Kunci dinaikkan: `DBABSEN_IDX_V5`, `MASTERDATA_V2`, `PETACUTI_V2`,
  `GEOFENCE_V2` — wajib karena format simpanannya berubah.
- Nama fungsi yang dipakai file lain **tidak berubah**
  (`getIndeksDbAbsen`, `bersihkanIndeksDbAbsen`, `IDX_HANGATKAN`,
  `getMasterDataCached`, `getPetaCutiCached`, `getGeofenceConfigCached`,
  `GEOFENCE_CACHE_BERSIHKAN`, `CACHE_BERSIHKAN`, `_lastRowKolom`).
  Sudah diperiksa: tidak ada bentrok nama global antara `Cache.gs` dan
  `StatsIndex.gs` — penting, karena seluruh file `.gs` berbagi satu global scope.
- `bersihkanIndeksDbAbsen()` sekarang hanya menaikkan nomor revisi; properti
  revisi lama dibersihkan otomatis pada penulisan berikutnya.
- Pemakaian Script Properties diperkirakan ~12 KB dari kuota 500 KB.
  `CACHE_UJI()` menampilkan angka sebenarnya.

---

## Yang masih menunggu giliran

`PERBAIKAN-LOGIN.md` sudah memprediksi ini 13 Agustus:

> `Absensi` (30.368 sel) dan `Remarks` (8.630 sel) masih disisir penuh tiap
> `hitungStats`.

Sudah dicek ulang di `Code.gs:1788` — masih benar. Delapan hari terakhir
menambah banyak fitur yang menumbuhkan sheet `Absensi`: absen online +
geofence, approval kadiv, potong jatah ijin/cuti lapor HRD.

**Ukur dulu sebelum mengubah.** Setelah dua perbaikan di atas ter-deploy,
kalau login masih terasa berat, jalankan `PROFILE_SHEETS()` di `Profiler.gs`.
Pendekatannya harus beda: kedua sheet itu berubah terus-menerus, jadi masa
berlaku 10 menit pun kurang cocok — yang lebih pas adalah sheet rekap per-NIK
yang diperbarui saat ada penulisan baru, seperti saran "RekapStats" di
`DIAGNOSA-LAMBAT.md` poin #2.

Satu lagi: `hitungStats` memanggil `getIndeksDbAbsen()` yang membaca seluruh
indeks 214 NIK hanya untuk satu orang. Setelah dikompres jadi 5,4 KB itu
murah, tapi kalau karyawan bertambah banyak, menyimpan per-NIK di properti
terpisah akan lebih hemat. Belum perlu sekarang.

---

## Pelajaran yang layak diingat

Tiga bug di kasus ini punya bentuk yang sama: **operasi yang gagal tanpa
melempar error.** `cache.put()` yang kebesaran, `putAll()` yang melewati batas
gabungan, dan CacheService yang menerima tulisan lalu membuangnya — ketiganya
diam.

Karena itu setiap penulisan di kedua file sekarang **dibaca kembali untuk
diverifikasi**, dan hasilnya ditulis ke log dengan alasan yang jelas. Yang
membuat bug ini bertahan seminggu bukan kesulitan teknisnya, tapi tidak adanya
sinyal bahwa ada yang salah.
