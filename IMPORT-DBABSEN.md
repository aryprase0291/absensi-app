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

- Semua sheet dalam file dibaca; sheet tanpa header NIK./Tanggal/Symbol
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

---

## Pemetaan ke `dbabsen`

`dbabsen` punya 19 kolom (A:S) dengan kolom A kosong, jadi kolom ke-N file
masuk ke kolom ke-(N+1):

```
file → dbabsen        dipakai Code.gs
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

## Dua mode

**Perbarui periode ini saja (default).** Baris lama yang punya kombinasi
NIK + tanggal sama dengan file baru ditimpa; sisanya tetap. Ini yang
dipakai untuk import rutin per periode.

**Ganti seluruh isi.** Semua baris lama dibuang. Perlu mengetik `GANTI`
untuk mengaktifkan tombol. Pakai hanya kalau file berisi seluruh data yang
diperlukan.

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

26 test mencakup normalisasi tanggal/jam, header berulang, multi-sheet,
dan baris rusak — semua kasusnya diambil dari file draft asli.
