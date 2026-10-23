# Sinkron Tabel Data (DB_FIX) → GSheet DB ABSEN

Isi **Tabel Data (DB_FIX)** di layar Rekap (mesin + absen online + koreksi)
ditulis otomatis ke sheet `db1-absen` di file DB_ABSEN bulan berjalan —
menggantikan salin-tempel dari Excel.

## Pasang (Apps Script project `absen`)

1. Tambah file **`SinkronGsheet`**, tempel isi `apps-script/SinkronGsheet.gs`.
2. `Code.gs`, di `doPost` setelah baris `get_rekap_admin`:
   ```js
   if (action === 'get_sinkron_gsheet') return handleGetSinkronGsheet(data);
   if (action === 'set_sinkron_gsheet') return handleSetSinkronGsheet(data);
   if (action === 'sinkron_gsheet') return handleSinkronGsheet(data);
   ```
3. `Code.gs`, di akhir isi `rekapCacheBatalkan_()`:
   ```js
   if (typeof sinkronGsheetJadwalkan_ === 'function') sinkronGsheetJadwalkan_();
   ```
4. `Auth.gs`, di `ACTION_ROLES`:
   ```js
   'get_sinkron_gsheet': ['admin'],
   'set_sinkron_gsheet': ['admin'],
   'sinkron_gsheet': ['admin'],
   ```
5. Jalankan **`SINKRON_GSHEET_IZIN`** sekali dari editor → izinkan akses
   (trigger + membuka spreadsheet lain).
6. Deploy ulang: **Terapkan → Kelola deployment → edit → Versi baru**.
7. Frontend: build & deploy seperti biasa.

## Pakai

- **Rekap → tab "Sinkron GSheet"**: tempel link file DB_ABSEN bulan ini
  (boleh link dengan `#gid=` — nama sheet terisi otomatis), pilih periode
  (bawaan: periode aktif), **Simpan setelan**, lalu **Sinkron sekarang**.
- Tiap bulan cukup ganti link ke file baru dan simpan.
- Otomatis: ±2 menit setelah impor data mesin atau simpan/hapus koreksi.
  Perubahan beruntun digabung jadi satu sinkron.
- Tombol **Sinkron ke GSheet** juga ada di kepala Tabel Data.

## Cara menulis

- Kolom dikenali dari header baris 1 (ID, NO AKUN, PAYROLL, NAMA, TANGGAL,
  JAM KERJA, M. TUGAS, A: TUGAS, MASUK, PULANG, TELAT, P. AWAL, BOLOS, TJK,
  ID2, DEPARTEMEN, ATT_TIME, WAKTU SCAN; juga WEEK, NOMINAL, SUMBER, KOREKSI
  kalau kolomnya ditambahkan).
- Kolom ID tetap rumus (meneruskan rumus baris 2, bawaan `=PAYROLL&TANGGAL`).
- TANGGAL ditulis sebagai nomor seri tanggal → tidak bisa bergeser sehari.
- Isi lama di bawah header diganti; sisa baris dikosongkan. Sheet tidak
  dihapus, jadi rumus di sheet lain (ABSENSI, db2-telat, DB1, …) tetap utuh.

## Sinkron Absensi ikut jalan (23 Okt 2026)

Setiap sinkron — manual maupun otomatis — urutannya:

1. Tabel Data ditulis ke `db1-absen`, lalu `flush` (rumus ABSENSI terhitung ulang).
2. **Sinkron Absensi** dijalankan di file yang sama: nilai `ABSENSI` disalin ke
   `ABSENSI-email` (sama persis dengan tombol "SINKRON ABSENSI" / menu
   *Sinkron Absensi → Pindah ABSENSI → ABSENSI-email*: isi "O" untuk absen
   kosong, nama merah → "A", sel rumus tidak ditimpa, ganti periode + arsip).

Kode ada di `_sgPindahAbsensi_` (SinkronGsheet.gs) — salinan dari script file
DB_ABSEN. Kalau script di file DB_ABSEN diubah, samakan juga di sini.
File tanpa sheet `ABSENSI`/`ABSENSI-email` → langkah 2 dilewati (dicatat di status).
Kalau langkah 2 gagal, status menampilkan "… TETAPI Sinkron Absensi gagal: …"
(db1-absen tetap sudah tertulis).

## Lebih cepat (23 Okt 2026, sore)

- Data rekap diambil dari simpanan berversi (tidak lagi `segarkan=1`).
  Simpanan otomatis kadaluarsa saat ada impor/koreksi, jadi tetap terbaru.
- Sinkron Absensi: zona waktu, pemisah rumus, dan format tanggal dibaca/ditulis
  sekali, bukan per sel header.
- Otomatis menunggu **1 menit** setelah perubahan terakhir (dulu 2 menit).
- Status menampilkan rincian waktu, mis.
  `(14,2 dtk: data 3,1 · db1-absen 6,8 · ABSENSI-email 4,0)` — untuk melihat
  tahap mana yang paling lama.

## Dari Telegram (bot AutoAbsen)

1. Apps Script project `absen`: jalankan **`SINKRON_BOT_KUNCI_BUAT`** sekali →
   salin kunci dari Log. Deploy ulang (Versi baru).
2. Pasang `scripts/autoabsen/SinkronGsheet.ps1` di `D:\AutoAbsen` — langkahnya
   ada di kepala file. Isi kunci + chat id grup yang boleh.
3. Di grup: `/sinkron` (jalankan) atau `/sinkronstatus` (lihat terakhir).
   Di layar Rekap tercatat sebagai `telegram, Telegram · <nama>`.
