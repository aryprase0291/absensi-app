# Import `dbabsen` dari File Excel Mesin Absen

Menggantikan pengisian `dbabsen` lewat formula IMPORTRANGE/QUERY dengan
upload file Excel dari Admin Panel. Isinya jadi **nilai statis**, yang
sekaligus menghilangkan penyebab utama lambatnya login
(lihat `DIAGNOSA-LAMBAT.md`).

---

## Cara pasang

### 1. Apps Script

1. Buka editor Apps Script spreadsheet `absen`.
2. Tambah file baru bernama **`ImportDbAbsen`**, tempel isi
   `apps-script/ImportDbAbsen.gs`.
3. Di `Code.gs`, pada `doPost`, tambahkan baris ini di antara action lain:

   ```js
   if (action === 'import_db_absen') return handleImportDbAbsen(data);
   ```

4. Di `Auth.gs`, pada `ACTION_ROLES`, tambahkan:

   ```js
   'import_db_absen': ['admin']
   ```

5. Deploy ulang: **Deploy → Kelola deployment → edit → Versi baru**.

### 2. Frontend

Sudah termasuk di `src/screens/ImportDbAbsen.js`,
`src/screens/importDbAbsenParser.js`, dan tab baru di `AdminPanel`
(`src/App.js`). Cukup build & deploy seperti biasa.

Menunya: **Admin Panel → Menu → Import Data Mesin Absen**. Hanya muncul
untuk role `admin`; backend juga menolak role lain, jadi menyembunyikan
tombol saja tidak bisa diakali.

---

## Format file yang diterima

18 kolom, urutannya harus persis:

| # | Kolom | # | Kolom |
|---|---|---|---|
| 1 | No.Akun | 10 | Telat |
| 2 | NIK. | 11 | Pulang Awal |
| 3 | Nama | 12 | Bolos |
| 4 | Tanggal | 13 | Jam Kerja (durasi) |
| 5 | Jam Kerja (shift) | 14 | Symbol |
| 6 | Mulai Tugas | 15 | Departemen |
| 7 | Akhir Tugas | 16 | ATT_Time |
| 8 | Masuk | 17 | Waktu Scan |
| 9 | Pulang | 18 | week |

Yang sudah ditangani otomatis:

- **Beberapa file boleh diimpor sekaligus.** Pilih beberapa file dalam satu
  dialog, atau klik lagi untuk menambah ke daftar; tiap file bisa dihapus
  satu per satu. Semuanya digabung jadi **satu** import — bukan diimpor
  bergantian, karena import kedua yang gagal akan meninggalkan `dbabsen`
  setengah jadi.
- Semua sheet dalam tiap file dibaca; sheet tanpa header NIK./Tanggal/Symbol
  dilewati.
- Baris header yang berulang di tengah file (efek paginasi mesin) dikenali
  dan dilewati, bukan ikut jadi data.
- Tanggal campur `21/07/2026` dan `05-08-2026`, juga serial Excel dan sel
  Date asli — semua dibaca sebagai hari-bulan-tahun.
- Jam satu digit (`8:30`) dirapikan jadi `08:30`.
- Kolom shift seperti `BSL_08:30-17:00` dan `Kumai_19:00-07-00`
  **tidak** diutak-atik.
- Baris tanpa NIK atau dengan tanggal tak terbaca dilewati **dan
  dilaporkan** di pratinjau, tidak dibuang diam-diam.
- Kombinasi **No.Akun + tanggal** yang muncul lebih dari sekali — di satu
  file maupun antar file — disaring: **yang dibaca belakangan yang
  dipakai**, sesuai urutan file di daftar. Yang dibuang bisa dilihat di
  pratinjau lengkap dengan file, sheet, dan nomor barisnya. Baris tanpa
  No.Akun memakai NIK sebagai kunci cadangan.

---

## Pemetaan ke `dbabsen`

`dbabsen` punya 19 kolom (A:S) dengan kolom A kosong, jadi kolom ke-N file
masuk ke kolom ke-(N+1):

```
file → dbabsen        dipakai Code.gs
No.Akun    → B        -        KUNCI UPSERT (satu-satunya yang tidak berubah)
NIK.       → C        row[2]   kunci pencocokan user
Nama       → D        row[3]
Tanggal    → E        row[4]   ditulis sebagai objek Date
Jam Kerja  → F        row[5]   dipecah jadi shiftStart/shiftEnd
Masuk      → I        row[8]
Pulang     → J        row[9]
Telat      → K        row[10]
Symbol     → O        row[14]
Waktu Scan → R        row[17]
week       → S        row[18]
```

`T1` diisi timestamp import. Kolom T baris lain tidak disentuh.

---

## Mode penulisan

Layar Import hanya menampilkan **satu** jalur normal; dua mode lain
disembunyikan di balik "Opsi lain" karena keduanya membuang baris lama.

### Normal: Tambah + perbarui (`upsert`, default)

Satu mode ini melayani dua kebutuhan sekaligus, otomatis, tanpa perlu
memilih apa pun:

- Kombinasi **No.Akun + tanggal** yang **belum ada** di sheet →
  ditambahkan sebagai baris baru. Data lama tidak tersentuh.
- Kombinasi yang **sudah ada** → baris lamanya dibuang lalu ditulis ulang
  dari file, termasuk kalau kolom C:S (NIK, nama, jam, symbol) berubah.
- Selain itu **tidak ada yang disentuh**: No.Akun yang tidak ada di file,
  dan tanggal yang tidak ada di file, tetap seperti apa adanya.

Karena kuncinya No.Akun, mengoreksi NIK (mis. Sutiono `605` → `G0642`)
tetap terbaca sebagai baris yang sama, bukan orang baru.

Kalau di sheet ada dua baris lama untuk satu No.Akun + tanggal (sisa bug
kunci-NIK yang lama), keduanya ikut dibuang dan diganti satu baris — jadi
duplikat lama membersihkan diri pada import berikutnya. Angka
`barisDitimpa` bisa lebih besar dari `barisDiperbarui` justru karena ini;
selisihnya dilaporkan terpisah di layar hasil.

### Opsi lain 1: Ganti seluruh periode untuk No.Akun yang ada di file (`periode`)

Backend menghitung tanggal paling awal dan paling akhir di antara baris
yang masuk ke satu sheet tujuan, lalu untuk **setiap No.Akun yang ada di
file** membuang semua baris lamanya yang jatuh di rentang itu — termasuk
tanggal yang TIDAK ada di file — sebelum menulis isi file.

Dua batas yang dijaga:

- **No.Akun yang tidak ada di file tidak disentuh**, walau tanggalnya
  persis sama.
- **Tanggal di luar rentang tidak disentuh**, untuk akun mana pun.

Bedanya dengan mode normal cuma satu: baris lama pada tanggal yang tidak
ada di file ikut dibuang. Pakai kalau ada baris sisa import lama yang
memang harus hilang; untuk pemakaian rutin, mode normal sudah cukup.

Rentangnya `min..maks`, bukan daftar tanggal yang persis ada di file.
Baris lama yang kolom tanggalnya tidak terbaca **dipertahankan** — tidak
bisa dipastikan masuk periode ini atau tidak.

### Opsi lain 2: Ganti seluruh isi (`replace`)

Semua baris lama dibuang. Perlu mengetik `GANTI` untuk mengaktifkan
tombol. Pakai hanya kalau file — atau kumpulan file — berisi seluruh data
yang diperlukan.

### Kenapa kuncinya No.Akun, bukan NIK

Hanya kolom B yang tetap untuk satu karyawan. Selama kuncinya NIK, satu
NIK yang dikoreksi (mis. Sutiono `605` → `G0642`) membuat baris lama tidak
cocok dengan baris baru mana pun — baris itu lolos sebagai "dipertahankan"
dan orang yang sama jadi punya dua baris untuk tanggal yang sama.

NIK dipakai **hanya sebagai cadangan untuk baris lama yang kolom B-nya
kosong** (warisan era IMPORTRANGE); tanpa itu baris seperti ini tidak akan
pernah bisa ditimpa import mana pun. Baris yang punya No.Akun sengaja
TIDAK ikut dicocokkan lewat NIK — kalau akunnya tidak ada di file, baris
itu bukan urusan import ini, walau NIK-nya kebetulan sama dengan NIK orang
lain di file. Berlaku untuk semua mode.

### 3. Ganti seluruh isi (`replace`)

Semua baris lama dibuang. Perlu mengetik `GANTI` untuk mengaktifkan
tombol. Pakai hanya kalau file — atau kumpulan file — berisi seluruh data
yang diperlukan.

---

## NIK berubah: yang WAJIB ikut diubah

Import hanya mengisi `dbabsen`. Pencocokan ke karyawan terjadi di tempat
lain dan memakai **kolom C (NIK)**, bukan No.Akun: `StatsIndex.gs`
mengagregasi per NIK, dan `Code.gs` mencocokkannya dengan NIK di sheet
`Users` (kolom H).

Jadi kalau NIK di mesin berubah (`605` → `G0642`), **NIK di sheet `Users`
harus diubah juga**. Kalau tidak, import-nya benar tapi data orang itu
tidak muncul di dashboard — bukan karena import gagal, melainkan karena
tidak ada user yang ber-NIK `G0642`.

---

## Yang perlu diperhatikan

- **Kolom jam ditulis sebagai teks, bukan nilai jam.** `setValues()` di
  Apps Script menafsirkan string `"08:06"` persis seperti diketik manual,
  jadi isinya berubah jadi angka serial dan tampil sebagai `30/12/1899`
  karena format kolomnya tanggal. Sebelum diganti import, kolom ini berisi
  teks dan `handleGetDbAbsen()` meneruskannya apa adanya ke frontend —
  jadi teks memang bentuk yang benar. `_importSetFormatKolom()` memasang
  format `@` sebelum menulis; hanya kolom E (Tanggal) yang tetap Date.
  Jangan hapus urutan ini: format harus dipasang **sebelum** `setValues`.
- **Formula di A:S akan hilang** pada import pertama. Itu memang tujuannya,
  tapi buat salinan spreadsheet dulu sebelum mencoba pertama kali.
- Setelah import dipakai rutin, **hapus trigger waktu `checkFormulaUpdates()`** —
  fungsinya hanya mendeteksi perubahan hasil formula, sudah tidak relevan.
- Data dikirim per 400 baris. Kalau upload putus sebelum potongan terakhir,
  `dbabsen` **tidak tersentuh sama sekali** — aman diulang dari awal.
  Kalau yang gagal potongan terakhir, periksa dulu isi `dbabsen` sebelum
  mengulang.
- Import bersifat action tulis, jadi sengaja **tidak** memakai `fetchApi()`
  yang punya retry otomatis (retry pada action tulis pernah jadi akar bug
  pengajuan ganda — commit `017b033` dan `f1f8255`).
- Kalau ada sisa sheet `_import_dbabsen_tmp` gara-gara proses yang putus,
  jalankan `IMPORT_BERSIHKAN_SISA()` dari editor Apps Script.

---

## Pengujian

```bash
npx react-scripts test --testPathPattern=importDbAbsenParser --watchAll=false
```

32 test mencakup normalisasi tanggal/jam, header berulang, multi-sheet,
multi-file, penyaringan duplikat (termasuk NIK yang berubah sementara
No.Akun tetap), dan baris rusak — semua kasusnya diambil dari file draft
asli.
