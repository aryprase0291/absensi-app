# Fase 1 — Login pindah ke Supabase

Ditulis 18 Sep 2026. Lanjutan dari `PERFORMA-1.0.24.md`.

**Status: SELESAI dan DINYALAKAN (18 Sep 2026).**

| | |
|---|---|
| Project | `absensi-app`, region **Singapore** (`ap-southeast-1`) |
| URL | `https://owbibqqaoeyrnatzqgso.supabase.co` |
| Migrasi | dijalankan & diuji di database itu |
| Edge Function | `login`, `sinkron-master`, `sesi-terbaru` — ACTIVE |
| Secret | `AUTH_SECRET`, `SINKRON_RAHASIA` terpasang |
| Cermin | 305 karyawan, 191 perangkat, 204 ikatan, 54 master data |
| Trigger | tarik sesi 1 menit, sinkron master 10 menit |
| Uji token | `SUPABASE_UJI_LOGIN()` → `>>> BERHASIL` |
| Sakelar | `SUPABASE_LOGIN_AKTIF` = **true** |

Yang tersisa hanya `npm run build` lalu mengunggah isi `build/`.

---

## 1. Kenapa hanya login

Setelah seluruh perbaikan di `PERFORMA-1.0.24.md`, membuka aplikasi
tinggal **satu request yang ditunggu** (login) ditambah satu lagi di
latar belakang. Sisa waktunya sebagian besar bukan pekerjaan server,
melainkan **ongkos tetap Apps Script**: setiap POST dijawab redirect 302
lalu diikuti GET kedua, ditambah boot container — 1–3 detik, apa pun isi
handler-nya.

Ongkos itu tidak bisa dihapus dari kode. Satu-satunya cara
menghilangkannya adalah tidak memanggil Apps Script pada jalur itu.

Login dipilih lebih dulu karena ia **satu-satunya request yang benar-benar
ditunggu karyawan** sebelum melihat layar.

---

## 2. Aturan yang menjaga semuanya tetap waras

### Satu tabel, satu penulis

| Data | Pemilik | Arah |
|---|---|---|
| karyawan, geofence, master data, periode, pengumuman, perangkat | Spreadsheet | Sheets → Postgres, tiap 10 menit |
| **sesi_aktif** | **Postgres** | Postgres → Script Properties, tiap 1 menit |

Tidak ada tabel yang ditulis dari dua sisi. Begitu ada, konfliknya tidak
punya cara penyelesaian yang benar — dan bug semacam itu tidak pernah
selesai, hanya berpindah.

### Tokennya sama persis

Edge Function `login` menerbitkan token dengan **bentuk dan rahasia yang
sama** dengan `createAuthToken()` di `Auth.gs`. Akibatnya seluruh endpoint
Apps Script yang belum dipindahkan — absen, riwayat, `buka_aplikasi`, ping
GPS — menerimanya tanpa satu baris pun diubah.

Ini bukan asumsi. `SUPABASE_UJI_TOKEN()` memverifikasi token buatan Edge
Function memakai `verifyAuthToken()` yang asli. Kalau fungsi itu berkata
BERHASIL, seluruh endpoint lama pasti menerimanya.

### Gerbang perangkat tetap di Apps Script

`Devices.gs` berisi 841 baris aturan: perangkat baru, ikatan baru, kuota,
pemblokiran, jejak audit. **Tidak satu pun disalin.** Edge Function hanya
menangani kasus yang bisa dipastikan aman dari dua baris data — perangkat
sudah dikenal, sudah terikat ke akun yang sama, tidak diblokir — dan
menyerahkan sisanya kembali ke Apps Script lewat kode
`FALLBACK_APPS_SCRIPT`.

Menduplikasi aturan keamanan di dua tempat adalah bentuk bug yang paling
mahal: yang satu diperbaiki, yang lain tertinggal, dan tidak ada yang
menyadarinya sampai ada yang memanfaatkannya.

**Konsekuensinya:** login pertama di sebuah HP tetap lewat jalur lama dan
tetap selambat dulu. Itu memang yang diinginkan — jalur itu jarang, dan di
situlah keputusan keamanannya diambil.

---

## 3. Yang berubah perilakunya — baca sebelum menyalakan

**Penggusuran sesi telat paling lama 60 detik.**

Aturan "satu akun hanya aktif di satu perangkat" bekerja dengan
membandingkan SessionID di token dengan yang tersimpan di Script
Properties. Kalau login pindah, SessionID diterbitkan di tempat yang tidak
diketahui Apps Script — dan tanpa penanganan, setiap request sesudah login
akan ditolak.

Penyelesaiannya: Postgres menjadi pemilik sesi, dan Apps Script menariknya
setiap menit. Semua endpoint lama tetap secepat sekarang, tanpa satu pun
tambahan request.

Harganya: ada jendela **sampai 60 detik** di mana satu akun bisa hidup di
dua perangkat sekaligus. Ini keputusan sadar — tujuan aturan itu mencegah
akun dipinjamkan seharian, bukan mencegah tumpang-tindih satu menit.

**Kata sandi.** Di spreadsheet, kata sandi masih tersimpan polos. Itu
masalah tersendiri yang tidak diselesaikan di sini — tetapi juga tidak
diperburuk: tabel `karyawan` di Postgres **tidak pernah** menyimpannya
polos. Sinkronisasi mengubahnya menjadi bcrypt sebelum menyentuh tabel,
dan hash-nya tidak pernah meninggalkan Postgres. Menyeluruhkan perbaikan
ini (hash juga di sisi spreadsheet) layak dikerjakan terpisah.

---

## 4. Urutan pemasangan

Setiap langkah bisa dihentikan tanpa merusak apa pun. Aplikasi baru
memakai jalur baru pada langkah **7**.

### 1. Buat project Supabase — ✅ SELESAI

`absensi-app` di region **Singapore** (`ap-southeast-1`), paling dekat ke
Indonesia. Region tidak bisa diubah setelah project dibuat.

### 2. Jalankan migrasi — ✅ SELESAI & DIUJI

Tiga bug ditemukan justru karena dijalankan di Supabase sungguhan, bukan
di lingkungan tiruan:

| Bug | Kenapa tidak terlihat sebelumnya |
|---|---|
| `crypt()` tidak ditemukan | di Supabase, `pgcrypto` dipasang di skema `extensions`, bukan `public` — dan `search_path` ketiga fungsi memang dikunci |
| `relation "_k" already exists` | `on commit drop` baru berlaku saat commit, jadi dua panggilan dalam satu transaksi gagal |
| Geofence terhapus diam-diam | muatan berisi `karyawan` tanpa `geofence` ikut mengosongkan seluruh area |
| `DELETE requires a WHERE clause` | Supabase memasang pengaman `pg-safeupdate` pada peran yang dipakai **Edge Function**. Tidak terlihat lewat koneksi admin — perannya berbeda — jadi baru muncul saat Apps Script benar-benar memanggilnya |

Ketiganya sudah diperbaiki di berkas migrasi maupun di database.

### 3. Pasang secret di Supabase — ✅ SELESAI

Edge Functions → Secrets:

Buka **Edge Functions → Secrets** di dashboard project, tambahkan dua:

| Nama | Isi |
|---|---|
| `AUTH_SECRET` | **sama persis** dengan `AUTH_SECRET` di Script Properties — ambil lewat `SUPABASE_TAMPILKAN_RAHASIA()` di editor Apps Script |
| `SINKRON_RAHASIA` | teks acak panjang, bebas, asal **sama** dengan yang dipasang di langkah 5 |

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sudah tersedia sendiri.

> `AUTH_SECRET` tidak bisa diambil dari luar Apps Script, dan memang tidak
> seharusnya bisa. Inilah sebabnya langkah ini tidak dapat dikerjakan
> untuk Anda.

### 4. Deploy Edge Function — ✅ SELESAI

`login`, `sinkron-master`, dan `sesi-terbaru` sudah ACTIVE.

Ketiganya dipasang dengan `verify_jwt: false` **karena masing-masing
memeriksa wewenangnya sendiri**: `login` memverifikasi username/kata
sandi, dua lainnya memeriksa `SINKRON_RAHASIA` dengan perbandingan
berpanjang tetap. Menyandarkan diri pada kunci anon tidak menambah apa
pun — kunci itu memang publik.

### 5. Siapkan Apps Script — ✅ SELESAI

Salin `apps-script/SupabaseSync.gs` ke editor, isi `URL` dan `RAHASIA` di
dalam `SUPABASE_SETUP()`, lalu jalankan sekali.

### 6. Isi cermin & buktikan tokennya — ✅ SELESAI

Hasilnya di spreadsheet produksi:

```
base64EncodeWebSafe("ab") = "YWI="        <- padding DIPERTAHANKAN
Tanda tangan COCOK.
SessionID di token             : 0ec7ef75db8d4000adf1
SessionID di Script Properties : 0ec7ef75db8d4000adf1
>>> BERHASIL
```

Baris pertama menjawab satu-satunya hal yang tidak bisa dipastikan dari
luar Apps Script: padding memang dipertahankan, jadi
`PERTAHANKAN_PADDING = true` di `token.ts` sudah benar.

```
SUPABASE_SINKRON_MASTER()   -> harus melaporkan jumlah karyawan
SUPABASE_PASANG_TRIGGER()   -> tarik sesi 1 menit, sinkron master 10 menit
```

Lalu isi `USERNAME` dan `PASSWORD` di dalam **`SUPABASE_UJI_LOGIN()`**
dan jalankan. Tidak perlu curl, Postman, atau menyalin token: fungsi itu
memanggil Edge Function login sungguhan, mencarikan sendiri perangkat
yang sudah terikat ke akun itu, lalu memverifikasi tokennya dengan
`verifyAuthToken()` yang asli — kode yang sama persis yang dipakai setiap
request aplikasi.

> ⚠️ Login yang berhasil **menerbitkan sesi baru**, persis seperti login
> sungguhan. Karyawan pemilik akun itu akan terlempar ke layar login.
> Pakai akun uji atau akun Anda sendiri.

**Jangan lanjut ke langkah 7 sebelum fungsi itu berkata `>>> BERHASIL`.**
Itu satu-satunya bukti bahwa token Supabase diterima Apps Script.

### 7. Nyalakan di aplikasi — ✅ SUDAH DINYALAKAN

Alamat dan kunci project sudah tertanam di `src/config/constants.js`.
Yang tersisa hanya sakelarnya:

```js
export const SUPABASE_LOGIN_AKTIF =
  process.env.REACT_APP_SUPABASE_LOGIN === '1' || true;   // <- false menjadi true
```

lalu `npm run build` dan unggah isi `build/`.

**Jangan lakukan ini sebelum langkah 6 berkata `>>> BERHASIL`.** Kalau
`AUTH_SECRET` di Supabase berbeda, karyawan akan berhasil login lalu
seketika terlempar kembali ke layar login — jauh lebih buruk daripada
login yang lambat.

### 8. Mematikannya kembali

Kembalikan `true` menjadi `false`, build, unggah. Selesai — login kembali
lewat Apps Script. Tidak ada data yang perlu dipulihkan, karena Postgres
di fase ini hanya berisi cermin dan sesi.

---

## 5. Apa yang sudah diuji, dan apa yang belum

**Sudah diuji sungguhan** — migrasi dijalankan di PostgreSQL 16 asli,
bukan sekadar dibaca:

| Yang diuji | Hasil |
|---|---|
| Migrasi dijalankan dari nol | seluruh pernyataan berhasil |
| Kata sandi tidak pernah polos di tabel | tersimpan sebagai bcrypt |
| Login benar / huruf besar-kecil / sandi salah / user tak ada | keempatnya sesuai harapan |
| Hash tidak berubah kalau sandi tidak berubah | stabil |
| Ganti sandi di sheet | sandi lama ditolak, sandi baru diterima |
| Username ganda di sheet | tidak menggagalkan sinkronisasi, yang pertama menang |
| Area geofence milik ID yang tidak ada | dibuang |
| Karyawan yang hilang dari sheet | ikut terhapus |
| **Muatan karyawan kosong** | **penghapusan dilewati** + peringatan di log |
| Token: rahasia berbeda | ditolak |
| Token: payload diutak-atik | ditolak |

**Belum bisa diuji dari sini** — hanya bisa dibuktikan di Apps Script:

Apakah `Utilities.base64EncodeWebSafe` mempertahankan tanda `=` di ujung.
Kalau ternyata tidak, tanda tangan token tidak akan pernah cocok.
`SUPABASE_UJI_LOGIN()` mencetak jawabannya secara langsung, dan
perbaikannya satu baris (`PERTAHANKAN_PADDING` di
`supabase/functions/_bersama/token.ts`).

Inilah alasan langkah 6 tidak boleh dilewati.

### Yang TIDAK bisa dikerjakan dari sisi Claude

Dua hal, dan keduanya memang seharusnya begitu:

1. **Memasang secret di Supabase.** `AUTH_SECRET` tersimpan di Script
   Properties milik Apps Script Anda. Tidak ada jalan mengambilnya dari
   luar sana — dan kalau ada, itu justru lubang keamanan.
2. **Membuka dashboard Supabase lewat browser.** Lingkungan Claude
   terisolasi: tidak ada rute ke komputer Anda, dan kebijakan jaringannya
   memblokir `*.supabase.co` untuk permintaan langsung. Yang bisa
   dijangkau hanyalah API Supabase lewat konektor resmi — itulah yang
   dipakai untuk membuat project, menjalankan migrasi, dan men-deploy
   Edge Function.

---

## 6. Cara membuktikan berhasil

Buka console browser lalu login. Akan muncul salah satu dari:

```
[absensi] request login (supabase): 412 ms
[absensi] request login (apps-script): 2840 ms
```

`(supabase)` berarti jalur baru dipakai. `(apps-script)` berarti jalur
lama — dan itu **bukan kegagalan**: bisa jadi memang belum dinyalakan,
atau kasusnya butuh gerbang perangkat lengkap.

Kalau semua login jatuh ke `apps-script`, periksa berurutan:
`SUPABASE_UJI_TOKEN()` → log Edge Function → apakah `SUPABASE_SINKRON_MASTER()`
sudah pernah berhasil.

---

## 7. Yang BELUM dikerjakan

Fase ini sengaja berhenti di login. Yang berikutnya, urut dari yang paling
menguntungkan:

1. **`buka_aplikasi`** — statistik dihitung satu kueri di Postgres, bukan
   menyisir ribuan baris. Read-only, jadi risikonya rendah.
2. **Absen (tulis)** — fase terberat. Geofence, anti-Fake GPS, dan gerbang
   wajah ikut pindah, dan ketiganya harus **diuji ulang**, bukan
   disalin-tempel.
3. **Ping GPS** — paling banyak menghemat kuota eksekusi Apps Script.
4. **Panel Admin & approval** — setelah ini sheet `Absensi` resmi menjadi
   cermin baca-saja.

Jangan mengerjakan nomor 2 sebelum nomor 1 berjalan stabil beberapa hari.
