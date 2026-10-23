# Setup Auto Download Fingerprint (Att / ZKTeco)

Status: aktif sejak 15 Okt 2026, diuji 7/7 mesin sukses (10:55).

## Cara kerja
- **Att.exe (Auto Monitor bawaan)** di PC ary-prasetyo: Pemeliharaan/Opsi → Opsi Sistem
  - Mulai menyambung saat program dibuka: ON (AutoMonitor=1)
  - Ulang koneksi gagal: 3 (TryConnectTimes=3)
  - Waktu download semua record: `12:00;18:00;01:00` (GetAllLogTimes di Option.dat)
- Database aktif: `\\192.168.1.60\att\2026.MDB` (bukan att2000.mdb lokal)
- Att berjalan sebagai Administrator → klik dari luar diblokir UIPI; automasi harus jalan elevated.

## Pemantau (D:\AutoAbsen)
- `cek_mesin.ps1 -Mode cek` — 11:50/17:50/00:50: tes TCP 4370 ke 7 mesin (3x ulang), buka Att bila mati
- `cek_mesin.ps1 -Mode verifikasi` — 12:20/18:20/01:20: baca Att.log, pastikan `ReadAllGLogData ... Succeed` untuk 7 IP
- Task Scheduler folder `\AutoAbsen\` (AutoAbsen-Cek, AutoAbsen-Verifikasi, AutoAbsen-BukaAtt saat login), Run with highest privileges
- Hasil: `D:\AutoAbsen\status_terakhir.txt`, `D:\AutoAbsen\log\YYYY-MM-DD.log`
- Jangan simpan log di Documents (diblokir Controlled Folder Access).

## Mesin
| No | Nama | IP |
|---|---|---|
| 1 | Office Kumai | 192.168.1.201 |
| 2 | Resepsionis | 192.168.1.246 |
| 3 | Depo Kumai | 192.168.1.126 |
| 4 | Romokalisari | 192.168.62.201 |
| 5 | Banyuwangi | 192.168.61.201 |
| 6 | Brumbung | 192.168.33.201 |
| 7 | Watudodol | 192.168.63.201 |

## Import ke absensi.jpt.co.id (D:\AutoAbsen\impor_absen.ps1) - dibuat 15 Okt 2026
- Jalur sama dengan tombol Import web: Edge Function `dbabsen` -> `impor_potongan` (2000 baris) -> `impor_commit` mode **upsert**.
- Login pakai header `x-sinkron-rahasia` (= Script Property `SUPABASE_SINKRON_RAHASIA`), disimpan terenkripsi DPAPI di `rahasia.dat` lewat `-SimpanRahasia`.
- File .xls Att = format BIFF2 (diblokir Excel), dibaca langsung tanpa Excel; xlsx/csv lewat Excel. Kolom, cari header No.Akun/NIK/Tanggal/Symbol, normalisasi sama dengan `importDbAbsenParser.js` (tanggal YYYY-MM-DD, jam HH:mm).
- Tanpa `-File`: ambil file terbaru di `D:\AutoAbsen\ekspor` (maks 3 jam). File yang sama (hash) tidak diimpor dua kali (`impor_terakhir.txt`).
- Uji: `impor_absen.ps1 -File <file> -UjiSaja` (tidak mengirim apa pun).
- Periode gaji: tanggal 21 s/d 20 (tabel `periode_absensi`).

- Pengaman: rentang tanggal di file harus sama dengan yang diminta; baris file >= 80% isi web (aksi `jumlah`) untuk rentang sama.

## Otomasi Att (D:\AutoAbsen\otomasi_att.ps1) - dibuat 15 Okt 2026
- Jendela `TfAttCalc` "Kalkulasi Kehadiran"; kalau tertutup dibuka lewat tombol toolbar "Laporan" (TJvToolBar).
- Tanggal: 2 TDateTimePicker di grup "Jarak Waktu" (atas=awal, bawah=akhir), diisi lewat tombol panah (WM_KEYDOWN VK_UP/DOWN/LEFT/RIGHT) dengan baca-ulang tampilan. DTM_SETSYSTEMTIME / WM_NOTIFY buatan TIDAK berhasil (Att tetap pakai tanggal lama). Teruji 15 Okt: 01/10-10/10 -> file 1789 baris tepat rentangnya.
- Tombol TBitBtn "Kalkulasi" lalu "Ekspor data" -> dialog Save As (Edit id 1148, Save id 1) -> `ekspor\absen_yyyyMMdd_HHmm.xls`.
- Lalu memanggil impor_absen.ps1 -HarusDari/-HarusSampai.
- Task Scheduler `AutoAbsen-Impor` 12:25/18:25/01:25 (pasang ulang lewat pasang_jadwal.ps1).
- Uji tanpa impor: `otomasi_att.ps1 -TanpaImpor [-Dari yyyy-MM-dd -Sampai yyyy-MM-dd]` (cek isi file, tidak kirim).
- Setelah selesai jendela Kalkulasi ditutup (Att kembali ke tampilan utama). Ekspor `absen_*.xls` > 14 hari dihapus otomatis.
- Alur Ekspor: tombol Ekspor data -> jendela "Pengaturan Ekspor" (OK) -> Save As -> pesan "Data telah sukses diekspor" (OK).

## Login Att (D:\AutoAbsen\buka_att.ps1)
- Att yang baru dibuka MEMINTA LOGIN (layar "Masuk ke sistem aplikasi"). Login disimpan terenkripsi DPAPI di `login_att.dat` (`buka_att.ps1 -SimpanLogin`).
- Dipakai cek_mesin.ps1 (bila Att mati), otomasi_att.ps1, dan task AutoAbsen-BukaAtt (saat login Windows).
- 15 Okt ~12:00 Att sempat tertutup -> download 12:00 gagal 0/7. Pantau verifikasi 18:20.

## Versi 2 (15 Okt 2026 sore): antrean + Telegram + Supabase + auto-close
- **Jadwal**: hanya `AutoAbsen-Lengkap` 12:00/18:00/01:00 -> `jalankan.ps1 -Tugas lengkap -Sumber jadwal`. Tugas lama Cek/Verifikasi/Impor/BukaAtt dihapus oleh pasang_jadwal.ps1. `AutoAbsen-Bot` saat login + tiap 10 menit (satu instance).
- **Download** (`download_att.ps1`): jadwal bawaan Att TIDAK diandalkan (Att menulis ulang Option.dat; 15 Okt 12:00 tidak download, Option.dat berisi AutoMonitor=0). Cara: tutup Att -> tulis Option.dat (AutoMonitor=1, IsAutoMonitor=1, GetAllLogTimes=12:00;18:00;01:00;<sekarang+3m>) -> buka_att.ps1 (login) -> tunggu `end ReadAllGLogData ... Succeed` per IP di Att.log (maks 9 menit). Backup: D:\AutoAbsen\Option.dat.bak.
- **Antrean**: mutex `Global\AutoAbsenPekerjaan`; jadwal & Telegram tidak tabrakan (tunggu maks 45 menit).
- **Auto-close**: setelah tiap pekerjaan, `tutup_att.ps1 -JikaDiam 5` (GetLastInputInfo); tidak menutup saat ada pekerjaan; menyerah setelah 3 jam bila PC dipakai. Tutup = WM_CLOSE, dialog Ya/OK dijawab, dipaksa setelah 90 dtk. Att.log mencatat "Access violation" saat Att keluar (bawaan Att).
- **Hasil**: hasil_download.json / hasil_ekspor.json / hasil_impor.json -> laporan Telegram (grup + chat peminta) + Supabase.
- **Supabase**: tabel `log_otomasi` (RLS tanpa policy) + Edge Function `log-otomasi` (aksi tulis/daftar, header x-sinkron-rahasia).
- **Telegram**: token di telegram.dat (DPAPI), grup & admin di telegram.json. Setup: `bot_telegram.ps1 -Daftar` lalu /daftar di grup. Tambah admin: `-TambahAdmin <id>` (cek ID via /id).
  Perintah: /status /log [n] /bantuan /id (anggota grup); /download [paksa], /impor [dari] [sampai], /lengkap [dari] [sampai] (admin, tombol rentang + konfirmasi; maks 62 hari, tidak melewati hari ini).
- Mesin selalu menyerahkan SEMUA scan baru; tanggal hanya berlaku untuk kalkulasi/impor.

## Versi 3 (15 Okt 2026 16:10): mode impor + tanggal manual di Telegram
- Alur /impor & /lengkap: pilih rentang (tombol atau **📅 Ketik tanggal sendiri**: balas `01/10/2026 10/10/2026`, `01/10 10/10`, `01/10 s/d 10/10`, atau satu tanggal) -> **pilih cara menulis** -> konfirmasi.
  - `upsert` Tambah + perbarui (normal, juga dipakai jadwal)
  - `periode` Ganti seluruh periode untuk No. Akun yang ada di file
  - `replace` Ganti seluruh isi db_absen (konfirmasi menampilkan jumlah baris yang akan dihapus)
  Perintah langsung: `/impor 01/10 10/10` juga lanjut ke pilihan mode.
- Mode diteruskan jalankan.ps1 -Mode -> otomasi_att.ps1 -Mode -> impor_absen.ps1 -Mode (impor_dbabsen_commit).
- **Att.dat** (C:\Program Files (x86)\Att) menyimpan pilihan Laporan: `Admin_RANGE_User` (-1 = <Semua>), `Admin_RANGE_Dept` (sekarang 56), `Admin_RANGE_D1/D2`. 15 Okt 14:41 impor hanya 22 baris karena User=211 (satu karyawan) -> ditolak pengaman 80%. Kini otomasi_att menutup Att, menyetel User=-1 + D1/D2 sesuai rentang, lalu membuka Att.
- Bot keluar sendiri bila bot_telegram.ps1/umum.ps1 diperbarui; Task Scheduler menyalakan versi baru (<= 10 menit).

## Versi 4 (16 Okt 2026): backup database terjadwal + atur dari Telegram
- `backup_db.ps1`: backup `\\192.168.1.60\att\*.mdb` (sekarang 2026.MDB; 2027.MDB nanti ikut otomatis) -> `D:\BackupAbsen\absen_yyyyMMdd_HHmm.zip`.
  Antre dengan download/impor; Att ditutup dulu bila PC diam >= 5 menit; salinan diulang bila .mdb berubah saat disalin;
  isi salinan dicek lewat Jet 32-bit (`cek_mdb.ps1`: jumlah scan CHECKINOUT, karyawan USERINFO, scan terakhir); isi zip dicocokkan.
  Jadwal: dilewati bila database tidak berubah sejak backup terakhir (manual/Telegram selalu backup).
- Simpan: 30 hari terakhir + backup pertama tiap bulan selama 12 bulan; 3 terbaru tidak pernah dihapus.
- Pengaturan `backup.json`; status terakhir `backup_terakhir.json`; riwayat Supabase `log_otomasi` tugas `backup`.
- Task `\AutoAbsen\AutoAbsen-Backup` (bawaan 02:00 & 19:00), dipasang/diubah oleh bot (jalan sebagai admin) atau `pasang_jadwal.ps1`.
- Telegram: `/backup` (status + tombol Backup sekarang / Ubah jadwal / Daftar), `/backup sekarang`, `/backup daftar`,
  admin: `/backup jadwal 02:00 19:00`, `/backup jadwal mati|aktif`, `/backup simpan 30 12`, `/backup tujuan <folder>`, `/backup sumber <pola>`.
- Pulihkan: tutup Att di semua PC, simpan dulu .MDB lama, ekstrak zip, salin .MDB ke \\192.168.1.60\att.

## Versi 5 (19 Okt 2026): impor BTR ke web Daily_Bromo_Bwi (/btr)
- Web: https://script.google.com/macros/s/AKfycbzS5zBWp-nJF7yHGubYsRolssBc9QGOpgLkhbI_qjsOtJCk735mQ5-SPZxUzI8kwLW-/exec
  (proyek Apps Script "database_btr" di spreadsheet Daily_Bromo_Bwi, sheet Database).
- Pengganti langkah manual: Att > Jejak > Data Utama (Dep BTR-HARIAN lalu BTR) > Ekspor > Import Absensi di web.
- `ambil_btr.ps1` (Jet 32-bit) baca \\192.168.1.60\att\{tahun}.MDB: CHECKINOUT + USERINFO, departemen
  BTR-HARIAN (76: BANYUWANGI, ROMOKALISARI) dan BTR (77: BTR Banyuwangi - GMS, BTR Romo-Operator, BTR Operasional)
  + semua sub-departemen. Kolom = ekspor Data Utama: Departemen, Nama, NIK.(Badgenumber), Tgl/Waktu, Status (kosong,
  seperti "Tampilkan Status" tidak dicentang), Lokasi ID (SENSORID), ID Number (SSN), Kode Kerja (kosong),
  Kode Verifikasi (1=Sidik Jari, 0=Password), No Kartu. Dicocokkan dengan 32.591 baris Database web (19 Okt).
  Salinan TSV: ekspor\btr_<waktu>\ (dihapus > 14 hari).
- `impor_btr.ps1` kirim per departemen (4000 baris/kiriman) ke deployment API khusus
  (Apps Script file `BTR_ApiImpor.gs`, doPost; Execute as Me, akses Anyone, wajib rahasia = Script Property IMPOR_RAHASIA).
  Duplikat NIK + Tgl/Waktu dibuang di server (aturan sama dengan tombol Import web). Deployment web pengguna tidak diubah.
- Pengaturan `btr.json` (url, departemen, mdb, status, kode_kerja, potong). Rahasia: `btr_rahasia.dat` (DPAPI;
  bila diganti, isi "rahasia" di btr.json -> dipindah otomatis saat jalan berikutnya).
- Telegram: `/btr` (tombol rentang / ketik tanggal) -> konfirmasi: Impor sekarang | Download mesin dulu + impor.
  `/btr 21/09 19/10` langsung ke konfirmasi. Riwayat Supabase tugas `btr`.
- Setelah impor, sheet Report diperbarui lewat "Terapkan & Rekap" seperti biasa.
- Perbaikan 19 Okt: otomasi_att memaksa Att.dat `Admin_RANGE_Dept=56` (JPT GRUP). Pilihan Dept di Att (mis. BTR saat
  ekspor manual Jejak) sempat membuat impor 12:00 hanya 993 baris -> ditolak pengaman 80%.

## Versi 6 (21 Okt 2026): grup tambahan khusus /btr
- telegram.json `grup_lain`: { "<chat_id>": { nama, perintah: ["btr"] } }. Didaftarkan dengan `/daftarbtr` (admin bot,
  diketik di grup tsb), dicabut dengan `/hapusgrup`. Contoh: grup "DAILY REPORT ATT BROMO".
- Di grup tambahan: semua anggota boleh /btr (tombol rentang, Impor sekarang / Download mesin dulu + impor);
  perintah lain diabaikan (dijawab "tidak aktif"); menu ☰ khusus grup (setMyCommands scope chat): btr, bantuan, id.
- Laporan impor_btr dikirim ke grup utama + semua grup tambahan yang punya btr + chat peminta.
- Grup biasa yang diubah Telegram jadi supergroup (ID baru) dipindah otomatis (migrate_to_chat_id).

## Versi 7 (21 Okt 2026): /btr download hanya mesin BTR
- `/btr` → "Download 3 mesin BTR dulu" menarik hanya Romokalisari, Banyuwangi, Watudodol (btr.json `mesin`).
- `download_att.ps1 -Mesin "A,B,C"`: Att tertutup → `mesin_att.ps1 -Aksi batasi` (Jet 32-bit) simpan status Enabled
  tabel Machines ke `mesin_enabled.json` dan menonaktifkan mesin lain → Att dibuka & download → Att ditutup →
  `-Aksi pulihkan` (Enabled dikembalikan, json dihapus). Bila gagal di tengah, json tersisa dipulihkan otomatis
  di awal download berikutnya (termasuk jadwal 12:00/18:00/01:00 yang tetap 7 mesin).
- Perbaikan 21 Okt 19:24: `mesin_att.ps1 -Aksi pulihkan` gagal di PS 5.1 (ConvertFrom-Json array terbungkus @()),
  4 mesin tertinggal nonaktif 12:35–19:24 (jadwal 18:00 & /download 18:23 hanya 3/7). Diperbaiki; bot juga
  memulihkan sisa `mesin_enabled.json` saat mulai dan melapor ke grup.
- /btr per grup: grup utama (Monitor absen) "Download semua mesin dulu + impor" (impor_btr -SemuaMesin);
  grup tambahan (DAILY REPORT ATT BROMO) hanya mesin btr.json `mesin` (Romokalisari, Banyuwangi, Watudodol).

## Versi 8 (21 Okt 2026 malam): pesan progres langsung
- /btr, /download, /impor, /lengkap & jadwal kini mengirim SATU pesan yang diperbarui: judul, bar ▰▱ + %, durasi,
  daftar langkah (▫️ menunggu, 🔄 berjalan + durasi, ✅/⚠️/❌/⏭) dengan rincian (mesin tertarik, baris terkirim, baru/sudah ada),
  lalu ringkasan di akhir. Fungsi di umum.ps1: ProgresBaru/ProgresLangkah/ProgresSelesai (edit >= 4 dtk bila isi berubah,
  >= 20 dtk bila hanya jam), JalankanAnak (anak dipantau tiap 1,5 dtk), TulisProgres/BacaProgres.
- download_att.ps1 menulis progres_download.json (cek/tutup/siapkan/login/tunggu/tarik per mesin/selesai);
  kalkulasi/ekspor/impor web dipantau dari log harian ([ATT]/[BUKA]/[IMPOR]); impor_absen mencatat "terkirim x/y baris".
- Bila pesan progres gagal terkirim, ringkasan lama dikirim sebagai cadangan.

## Perbaikan 23 Okt 2026: pengaman 80% hanya menghitung akun yang ada di file
- Masalah: 22 Okt ±16:00 masuk 2.640 baris (89 orang, 21/09–20/10) dari kantor lain lewat impor terpisah
  (Office Enggano, Garasi Kapuk, Depo Itp, Office Sequis, Depo Cilegon, dll). Data itu tidak ada di Att (Dept 56),
  jadi file 5.323 vs web 7.963 (67%) -> impor periode penuh selalu ditolak.
- impor_absen.ps1: pengaman kini membandingkan file dengan baris web milik No. Akun (atau NIK bila tanpa akun) yang ada
  di file. Kirim `jumlah` + no_akun/nik; bila balasan tidak `tersaring`, tarik `halaman` (2000/baris) dan hitung lokal.
  Log: "Di web untuk rentang ini: X baris milik akun di file (seluruh web Y)". Cadangan: impor_absen.ps1.bak_20261023.
- Supabase: fungsi SQL `dbabsen_jumlah` menerima filter opsional `no_akun`/`nik` (tanpa filter = perilaku lama).
  Edge Function `dbabsen` BELUM meneruskan filter itu (deploy belum dilakukan), jadi saat ini jalur `halaman` yang dipakai.

