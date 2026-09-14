# Kenapa login jadi lambat sejak 1.0.19/1.0.20, dan apa yang diubah di 1.0.21

Ditulis 14 Sep 2026. Gejala yang dilaporkan: **"bisa login, tapi lama —
tidak seperti biasanya"**, mulai terasa setelah rilis penguncian perangkat.

---

## 1. Apa yang sebenarnya terjadi

Login bukan jadi lambat karena satu bug, tapi karena **jumlah pekerjaan per
login bertambah banyak** di 1.0.19, dan setiap tambahan itu dibayar oleh
setiap karyawan setiap kali membuka aplikasi.

Yang dikerjakan `handleLogin` sebelum 1.0.21:

| Pekerjaan | Sel dibaca | Catatan |
|---|---|---|
| `bacaSheet(Users, 14)` | ±4.270 | sudah ada sejak 1.0.14 |
| `bacaSheet(Devices, 11)` | ±3.300 | **baru di 1.0.19** |
| `bacaSheet(DeviceUser, 8)` | ±2.400 | **baru di 1.0.19** |
| `bacaSheet(SesiAktif, 8)` | ±2.400 | **baru di 1.0.19** |
| `cariPengumumanAktif()` | ±4.000 | sheet Announcements ±1.000 baris |
| **Total** | **±16.400** | |

Ditambah:

- **`LockService.getScriptLock().tryLock(8000)`** dipasang di sekitar
  SELURUH pemeriksaan perangkat. Lock ini **global untuk seluruh skrip**.
  Artinya: pada jam masuk, 300 karyawan yang login berbarengan saling
  mengantre satu per satu — padahal 95% dari mereka memakai HP yang sudah
  dikenal dan **tidak menulis satu baris baru pun**. Inilah penyumbang
  waktu terbesar, dan justru yang paling tidak terlihat: sendirian,
  loginnya cepat; ramai-ramai, loginnya menumpuk.
- 3-4 pembacaan `PropertiesService` terpisah (mode perangkat dibaca dua
  kali dalam satu login, kunci token dibaca lagi, dst.).
- Satu **request Apps Script terpisah** (`check_version`) yang ditembakkan
  pada setiap pembukaan aplikasi, berbarengan dengan login — mengantre di
  kuota eksekusi serentak yang sama, dan ikut menanggung risiko balasan
  HTML interstitial 1-dari-7 (lihat catatan `fetchApi` di `src/App.js`).

## 2. Yang diubah

### Backend

1. **Jalur cepat pemeriksaan perangkat** (`_deviceDaftarkanCepat` di
   `Devices.gs`). Kalau HP sudah dikenal dan sudah terikat ke akun yang
   sama — bentuk login sehari-hari — yang dilakukan hanya membaca DUA
   BARIS dan menulis pembukuannya. **Tanpa LockService**, karena jalur ini
   tidak pernah menambah baris. Lock hanya dipakai di jalur lengkap, yang
   kini jarang dicapai (perangkat baru / ikatan baru / kuota penuh).
2. **Indeks nomor baris** untuk `Devices`, `DeviceUser`, `SesiAktif`, dan
   `FaceProfiles`, disimpan lewat `Cache.gs`. Yang dibutuhkan dari ketiga
   sheet itu cuma "baris berapa", dan itu tidak berubah kecuali ada baris
   baru.
   **Invarian keamanannya:** nomor baris dari indeks SELALU diverifikasi
   dengan membaca baris itu sendiri sebelum ditulisi. Indeks basi tidak
   pernah menimpa baris milik karyawan lain — paling buruk ia meleset dan
   jatuh ke jalur lambat. Karena itu indeks ini aman walaupun lupa
   di-invalidasi.
3. **Pengumuman aktif ikut disimpan** (`getPengumumanAktifCached`, TTL 10
   menit). Konsekuensi yang disengaja: pengumuman yang diubah LANGSUNG DI
   SHEET baru terlihat setelah TTL habis. Yang diterbitkan lewat Panel
   Admin membersihkan simpanannya seketika.
4. **Memo properti per-eksekusi** (`_propGetCepat_` di `Cache.gs`).
   Sengaja BUKAN `getProperties()`: menarik seluruh Script Properties
   (termasuk potongan `CACHESTORE_*` dan ratusan kunci `SESI_*`) justru
   lebih mahal untuk request ringan. Memo ini hanya menghapus pembacaan
   BERULANG kunci yang sama di dalam satu eksekusi.

Hasil untuk login harian (indeks sudah hangat):

| | Sebelum | Sesudah |
|---|---|---|
| Sel dibaca | ±16.400 | ±4.300 |
| `getValues` | 5 (penuh) | 1 penuh + 3 sepotong |
| Sheet dibuka | 6 | 3 |
| LockService | sampai 8 detik | tidak ada |

### Frontend

5. **`check_version` hanya dijalankan saat sesi dipulihkan.** Saat belum
   ada sesi, layar berikutnya pasti layar login, dan respons login SUDAH
   membawa `version`. Satu eksekusi Apps Script penuh hilang dari
   pembukaan dingin — bentuk pembukaan yang paling sering dialami.
   Bundle frontend basi tetap terdeteksi, karena `cekVersiFrontend()`
   membaca `update-manifest.json` langsung dari hosting tanpa menyentuh
   Apps Script sama sekali.
6. **Foto absen dikecilkan ke maksimal 1280 px** sebelum dikirim
   (`kecilkanCanvas`, `ukuranTerbatas`). Kamera depan HP sekarang
   menghasilkan frame 1080p ke atas; dikirim apa adanya satu foto menjadi
   ±400-900 KB base64. Di jaringan seluler jam masuk, ITULAH bagian
   terlama dari menekan "Kirim".
   **Pengecilan dilakukan SETELAH seluruh pemeriksaan wajah.** Deteksi dan
   deskriptor 128-dimensi tetap dihitung dari frame resolusi penuh, jadi
   ketelitian pencocokan tidak berubah sedikit pun.

## 3. Yang SENGAJA tidak diubah

- **Dua gerbang wajah tetap dua.** `verifikasi_wajah` saat jepret dan
  `faceGerbangAbsen` saat Kirim memang terlihat seperti pekerjaan ganda,
  tetapi yang kedua adalah penjagaannya (lihat `WAJAH-COCOK.md`).
- **Deskriptor acuan tetap tidak pernah dikirim ke klien.** "Kirim acuan
  ke HP supaya tidak perlu request" akan menghapus satu request dan
  meruntuhkan seluruh fiturnya.
- **Sesi tunggal tetap di Script Properties**, bukan sheet.

## 4. Penghambat berikutnya (belum dikerjakan)

- `handleAbsen` menyisir sheet `Absensi` utuh (±2.336 × 14 = ±32.000 sel)
  untuk cek duplikat & kuota Ijin pada setiap pengajuan form. Biayanya
  tumbuh terus. Jalan keluarnya: jendela waktu (kolom B urut karena sheet
  append-only, bisa dicari biner) atau indeks per-NIK seperti
  `StatsIndex.gs`.
- `Absensi` dan `Remarks` masih disisir penuh di setiap `hitungStats`
  (catatan lama dari 1.0.14 — masih berlaku).
- `kirimRequestApproval` (MailApp) dan `tulisAlamatAbsensi` (geocode)
  berjalan sinkron SETELAH baris absen tersimpan. Keduanya bisa dipindah
  ke trigger time-driven tanpa mengubah apa yang dilihat karyawan.

## 5. Urutan deploy 1.0.21

Tidak ada perubahan struktur data maupun kontrak API, jadi urutannya
bebas. Tetap ikuti kebiasaan repo ini — **frontend dulu, backend
belakangan** — supaya layar "Update Tersedia" tidak muncul sebelum
bundle barunya benar-benar tayang.

1. `npm run build`, unggah isi `build/` ke hosting.
2. Salin `Cache.gs`, `Devices.gs`, `FaceProfile.gs`, `Auth.gs`, `Code.gs`,
   dan `UpdateManifest.gs` ke editor Apps Script, lalu **Deploy versi baru**
   pada deployment produksi.
3. Login pertama setiap karyawan setelah deploy masih memakai jalur
   lengkap (indeks belum ada). Mulai login kedua barulah jalur cepat
   terpakai. Ini normal — tidak perlu menjalankan apa pun secara manual.
