# Kenapa aplikasi jadi makin lambat dibuka & makin berat saat Kirim — dan apa yang diubah di 1.0.24

Ditulis 18 Sep 2026. Kelanjutan dari `PERFORMA-1.0.21.md` (14 Sep),
`DIAGNOSA-LAMBAT-LAGI.md` (21 Agu), dan `DIAGNOSA-LAMBAT.md` (12 Agu).

Gejala yang dilaporkan: **"membuka aplikasi jadi semakin lambat, apalagi
saat submit form."**

> **Catatan jujur soal angka.** Dokumen ini menyebut jumlah **request**,
> jumlah **sel** yang dibaca, dan jumlah **round trip** ke Sheets — semua
> itu bisa dihitung langsung dari kode dan tidak berubah oleh keadaan
> jaringan. Yang **belum** ada di sini adalah angka milidetik, karena
> pengukurannya harus dijalankan di spreadsheet produksi. Cara
> mengukurnya ada di bagian 5.

---

## 1. Dua sebab, dan keduanya memang tumbuh seiring waktu

Kata kuncinya di laporan adalah **"semakin"**. Itu bukan satu bug yang
muncul tiba-tiba, melainkan dua biaya yang memang naik terus:

| | Sebabnya tumbuh karena | Terasa saat |
|---|---|---|
| **A** | **Jumlah request** per pembukaan aplikasi bertambah setiap kali ada fitur baru | membuka aplikasi |
| **B** | **Sheet `Absensi`** hanya bertambah panjang, dan disisir UTUH oleh jalur terpanas | membuka aplikasi & menekan Kirim |

### A — membuka aplikasi = LIMA eksekusi Apps Script

Membuka aplikasi dengan sesi yang masih hidup menembakkan lima request
terpisah, masing-masing menjadi satu eksekusi Apps Script tersendiri:

| Request | Ditambahkan di | Dipanggil dari |
|---|---|---|
| `check_version` | lama | `src/App.js` — pemulihan sesi |
| `get_stats` | lama | Dashboard |
| `get_latest_announcement` | lama | Dashboard |
| `get_gps_tracking_status` | 1.0.16 | `utils/gpsTracker.js` |
| `get_approval_list` | — | notifikasi lonceng (khusus penyetuju) |

Empat di antaranya pekerjaannya sepele. Yang mahal **bukan
pekerjaannya**, melainkan ongkos tetap per eksekusi: redirect 302, boot
container, dan antrean kuota eksekusi serentak milik akun pemilik skrip.
Pada jam masuk, 300 karyawan × 5 request = **1.500 eksekusi** yang harus
diantre.

Inilah kenapa gejalanya memburuk justru setelah rilis-rilis yang tidak
menyentuh performa sama sekali: setiap fitur baru menambah satu request
lagi ke daftar ini, dan tagihannya dibayar oleh semua orang, setiap pagi.

Satu hal lagi yang ikut ketahuan: `handleLogin` mengirim **`stats: null`**.
Padahal `PERFORMA-1.0.21.md` dan komentar di `hitungStats` sama-sama
menyebut bahwa angkanya "ikut di respons login". Jadi penghematan yang
dicatat di 1.0.14 itu **tidak pernah benar-benar berjalan** — Dashboard
selalu menembak `get_stats` sendiri sesudahnya.

### B — sheet `Absensi` disisir utuh di tiga jalur terpanas

`Absensi` bersifat **append-only**: tidak pernah menyusut. Tiga jalur
membacanya dari baris pertama sampai terakhir:

| Fungsi | Dipanggil saat | Yang dibaca |
|---|---|---|
| `hitungStats` | **setiap dashboard dibuka** | seluruh baris × 13 kolom |
| `handleAbsen` | **setiap pengajuan form** (cek duplikat & kuota Ijin) | seluruh baris × 14 kolom |
| `handleEditAbsen` / `handleDeleteAbsen` | setiap edit/hapus pengajuan | seluruh baris × **seluruh lebar sheet** (46 kolom) |
| `handleGetApprovalList` | dashboard penyetuju | seluruh baris × **46 kolom** |

Padahal keempatnya hanya butuh potongan kecil:

- `hitungStats` membuang semua baris di luar periode aktif lewat penjaga
  `masukPeriode` — jadi baris tahun lalu dibaca, lalu dibuang.
- Cek duplikat di `handleAbsen` menilai terhadap **satu periode kuota**.
- Edit & hapus dibatasi **1 jam** sejak input, jadi mustahil menyentuh
  baris yang lebih tua dari itu.

Ini persis penghambat yang sudah ditulis di `PERFORMA-1.0.21.md` bagian 4
("`handleAbsen` menyisir sheet `Absensi` utuh … Biayanya tumbuh terus"),
dan sekarang giliran itu dikerjakan.

---

## 2. Yang diubah

### A. Satu request untuk membuka aplikasi

**Backend** — action baru `buka_aplikasi` (`handleBukaAplikasi` di
`Code.gs`) menjawab kelima hal di atas dalam **satu** eksekusi: versi,
statistik, pengumuman, daftar periode, status pelacakan GPS, dan angka
lonceng approval.

Setiap bagiannya dibungkus `try/catch` sendiri. Satu bagian yang gagal
(mis. sheet pengumuman dihapus) dikirim sebagai `null`, dan frontend
mengambil bagian itu sendiri seperti dulu — bukan menjatuhkan seluruh
pembukaan aplikasi.

`handleLogin` ikut membawa `gpsTracking` — murni Script Properties,
tidak menyentuh sheet. Statistik dan angka approval **sengaja tidak
ikut**; alasannya di bagian 7.

**Frontend** — `bootAwal` menampung jawaban itu, dan `bootMenunggu`
menahan layar-layar di bawah supaya tidak menembak request sendiri
selama jawabannya masih di perjalanan.

| Bentuk pembukaan | Sebelum | Sesudah |
|---|---|---|
| Sesi dipulihkan (karyawan biasa) | 4 request | **1** |
| Sesi dipulihkan (penyetuju) | 5 request | **1** |
| Login baru | 1 login + 3-4 susulan | **1 login + 1 latar belakang** |

> **Dikoreksi di 1.0.25 — lihat bagian 7.** Versi pertama dokumen ini
> menulis "login baru: 1 request", karena statistik dan angka approval
> ikut dititipkan di respons login. Hitungan requestnya benar, tetapi
> yang dirasakan karyawan justru memburuk.

Angka lonceng approval sengaja dikirim **hanya jumlahnya**, bukan
daftarnya: layar Approval mengambil daftar lengkap sendiri saat
benar-benar dibuka. Menitipkan ratusan baris di sini justru akan membuat
pembukaan aplikasi lebih berat daripada sebelumnya.

### B. Jendela baris sheet Absensi (`apps-script/JendelaAbsensi.gs`)

Kolom B (Waktu Input) **selalu menaik**, karena setiap baris baru masuk
lewat `appendRow` dan tidak ada satu pun handler yang menulis ulang kolom
itu — sudah diperiksa: `handleEditAbsen` menyentuh kolom G, I, J, K, L;
`handleUpdateAbsensi` kolom E.

Karena menaik, batas jendela bisa dicari tanpa membaca seluruh sheet.

> **Dikoreksi di 1.0.26 — lihat bagian 8.** Versi pertama memakai
> pencarian biner (~10 panggilan untuk 20.000 baris). Pengukuran di
> spreadsheet produksi membuktikan itu arah yang salah. Penggantinya
> membaca **ekor kolom B sekali jalan**: satu panggilan untuk kasus
> biasa, paling banyak dua, tanpa simpanan apa pun.

**Tidak ada jalur yang bisa menghasilkan data kurang secara diam-diam.**
Sel waktu yang tidak terbaca, tanggal yang tidak dikenal, atau periode
yang gagal dibaca semuanya berakhir dengan **membaca sheet penuh**,
yaitu perilaku lama. Kalau ragu, fungsinya mengembalikan lebih banyak
baris, bukan lebih sedikit.

Pemakaiannya:

| Fungsi | Jendela yang dibaca |
|---|---|
| `hitungStats` | sejak (awal periode − 180 hari) |
| cek duplikat `handleAbsen` | sejak (awal periode kuota − 180 hari) |
| `handleEditAbsen` / `handleDeleteAbsen` | ~30 jam terakhir, jatuh ke baca penuh bila tidak ketemu |

**Kenapa marginnya 180 hari.** Sebuah baris bisa jatuh di dalam periode
aktif walaupun waktu inputnya jauh lebih awal — cuti yang diajukan
berbulan-bulan sebelumnya adalah contohnya. Menaikkan angka ini selalu
aman (hanya membaca lebih banyak); **menurunkannya berisiko**, karena
pengajuan yang dikirim lebih awal dari margin akan hilang dari statistik
tanpa error apa pun. Angkanya ada di satu tempat:
`JENDELA_MARGIN_HARI`.

Edit & hapus memakai jalur yang berbeda dengan sengaja: kalau UUID-nya
tidak ada di jendela, sheet **tetap** dibaca penuh. Tanpa itu, pengajuan
lama akan dijawab "Data tidak ditemukan" padahal jawaban yang benar
adalah "Batas waktu edit (1 jam) habis."

### C. Round trip ke Sheets yang bisa dihapus begitu saja

Diukur per satu absen Hadir/Pulang:

| Yang dulu terjadi | Sekarang |
|---|---|
| `getLastRow()` dipanggil **2×** untuk baris yang sama | 1× |
| Kolom audit GPS ditulis **4 setValue** terpisah | 1 `setValues` (kolomnya memang berurutan) |
| Baris judul sheet Absensi dibaca **2×** (peta kolom GPS, lalu kolom Alamat) | masing-masing di-memo per eksekusi |
| Judul sheet GpsAudit diperiksa ulang tiap panggilan | di-memo per eksekusi |
| Sheet `GeoCache` dibaca **UTUH** setiap kali koordinat diterjemahkan | dari Script Properties |
| Edit pengajuan: **4 setValue** untuk kolom I–L | 1 `setValues` |
| `handleGetApprovalList`: 46 kolom × seluruh baris | 16 kolom |

`GeoCache` layak disebut tersendiri: fungsi `_geoMuatMemo()` membaca
seluruh sheet itu setiap kali sebuah koordinat diterjemahkan — pada
**setiap absen** dan pada **setiap ping pelacakan posisi** yang berpindah
cukup jauh (300 karyawan, tiap lima menit). Sheet-nya sendiri hanya
bertambah. Petanya sekarang disimpan lewat lapisan penyimpanan yang sama
dengan `Cache.gs` (gzip + Script Properties — CacheService terbukti tidak
menyimpan apa pun di skrip ini, lihat `DIAGNOSA-LAMBAT-LAGI.md`). Sheet
tetap menjadi sumber kebenaran: simpanan yang tidak ada, rusak, atau
kebesaran berarti sheet dibaca persis seperti dulu, dan batas ukurannya
ditulis ke log — bukan gagal diam-diam.

---

## 3. Yang SENGAJA tidak diubah

- **Rumus perhitungan statistik tidak disentuh sama sekali.** Yang
  berubah hanya baris mana yang dibaca, bukan apa yang dilakukan
  terhadapnya. `JENDELA_UJI()` membuktikannya (bagian 5).
- **Email approval (`kirimRequestApproval`) tetap sinkron.** `MailApp`
  memang menahan tombol Kirim pada form yang butuh persetujuan, dan
  memindahkannya ke trigger time-driven akan mempercepatnya. Tapi itu
  mengubah keandalan pengiriman email, bukan sekadar kecepatan — layak
  dikerjakan terpisah, dengan ujinya sendiri.
- **Daftar approval tidak dijendela.** Pengajuan berstatus Pending bisa
  berumur berapa pun. Memotongnya berdasarkan tanggal berarti pengajuan
  lama menghilang dari layar penyetuju. Yang diambil hanya penyempitan
  kolom (46 → 16), yang hasilnya identik.
- **Dua gerbang wajah tetap dua**, dan **deskriptor acuan tetap tidak
  pernah dikirim ke klien** (lihat `WAJAH-COCOK.md`).

---

## 4. Kompatibilitas & urutan deploy

Tidak ada perubahan struktur data maupun kontrak API yang memutus versi
lama:

- **Klien 1.0.24 di backend lama:** `buka_aplikasi` dijawab "Action tidak
  dikenal", `bootAwal` tetap kosong, dan aplikasi kembali memakai
  kelima request lama. Tidak ada yang rusak, hanya tidak lebih cepat.
- **Klien lama di backend 1.0.24:** semua action lama masih dirutekan
  seperti biasa.
- **`Code.gs` baru tanpa `JendelaAbsensi.gs`:** setiap pemanggilnya
  dibungkus `typeof` dan jatuh ke pembacaan penuh — lambat seperti
  sebelumnya, tapi hasilnya tetap benar.

Urutannya bebas, tapi tetap ikuti kebiasaan repo ini — **frontend dulu,
backend belakangan** — supaya layar "Update Tersedia" tidak muncul
sebelum bundle barunya benar-benar tayang.

1. `npm run build`, unggah isi `build/` ke hosting.
2. Salin ke editor Apps Script: **`JendelaAbsensi.gs` (file BARU)**,
   `Code.gs`, `Auth.gs`, `AntiFakeGps.gs`, `Geocode.gs`,
   `GpsTracking.gs`, dan `UpdateManifest.gs`. Lalu **Deploy → Kelola
   deployment → pensil → Versi baru → Deploy** pada deployment yang sudah
   ada, supaya URL-nya tidak berubah.

---

## 5. Cara membuktikannya di spreadsheet produksi

### `JENDELA_UJI()` — jalankan dari editor Apps Script

Membandingkan baca penuh dengan baca jendela untuk periode aktif, **baris
per baris**, lalu melaporkan berapa baris periode yang terlewat:

```
Sheet Absensi: 2336 baris. Periode 2026-09-01 s/d 2026-09-30
Baca penuh   : 2335 baris, ... ms
Jendela dingin: ... baris (mulai ...), ... ms
Jendela panas : ... baris (mulai ...), ... ms
Baris periode yang TERLEWAT: 0
>>> BERHASIL: tidak ada baris periode yang terlewat.
```

Yang harus dilihat: **`TERLEWAT: 0`**. Kalau bukan nol, naikkan
`JENDELA_MARGIN_HARI` — jangan diabaikan, karena artinya ada pengajuan
yang tidak ikut terhitung.

Selisih "dingin" dan "panas" menunjukkan berapa yang dihemat simpanan
batas jendela.

### `PROFILE_SHEETS()` (`Profiler.gs`) — untuk angka milidetik

Jalankan **sebelum dan sesudah** deploy, supaya perbandingannya dilakukan
di spreadsheet yang sama dengan jumlah baris yang sama.

### Jumlah request — dari sisi HP

Buka aplikasi dengan DevTools → Network, saring `script.google.com`.
Sebelum: 4-5 permintaan POST. Sesudah: **1**.

---

## 6. Penghambat berikutnya (belum dikerjakan)

Urut dari yang paling layak dikerjakan lebih dulu:

1. **`kirimRequestApproval` (MailApp) dan `tulisAlamatAbsensi` (geocode)
   masih berjalan sinkron setelah baris absen tersimpan.** Keduanya bisa
   dipindah ke trigger time-driven tanpa mengubah apa yang dilihat
   karyawan. Catatan ini sudah ada sejak `PERFORMA-1.0.21.md` dan masih
   berlaku.
2. **`Remarks` masih disisir penuh** di jalur laporan (catatan lama dari
   1.0.14).
3. **`handleGetHistory`, `handleGetTeamHistory`, `handleGetAnalysisData`
   masih memakai `getDataRange()`** — seluruh lebar sheet Absensi,
   padahal kolom yang dipakai jauh lebih sedikit. Sama persis dengan yang
   sudah diperbaiki di `handleGetApprovalList`, tinggal menyalin polanya.
4. **Sheet `GeoCache` tidak pernah dipangkas.** Setelah melewati
   `GEOCACHE_PETA_MAKS_ENTRI`, simpanannya berhenti dipakai dan sheet
   dibaca lagi setiap kali. Log akan menyebutkannya lebih dulu, jadi ini
   tidak akan menjadi kejutan.

---

## 7. KOREKSI (1.0.25) — kenapa statistik dikeluarkan lagi dari respons login

Ditambahkan 18 Sep 2026, setelah laporan: **"login butuh ~10 detik baru
masuk dashboard."**

### Apa yang salah

1.0.24 menitipkan `stats` dan angka lonceng approval di respons login,
dengan alasan menghemat satu request. Hitungan requestnya benar. Yang
diabaikan adalah **apa yang sebenarnya ditunggu karyawan**.

| | Sebelum 1.0.24 | 1.0.24 |
|---|---|---|
| Yang dikerjakan respons login | baca Users + simpanan | + `hitungStats` + (penyetuju) sisir sheet Absensi |
| Layar dashboard muncul setelah | respons login | respons login **dan** seluruh perhitungan selesai |
| Angka statistik muncul setelah | request kedua (layar sudah terlihat) | bersamaan dengan layar |

Jadi 1.0.24 menukar **satu request** dengan **layar yang muncul lebih
lambat**. Total kerja server memang turun; yang naik justru satu-satunya
angka yang diperhatikan karyawan — berapa lama menatap layar kosong.

Untuk akun **admin/HRD** efeknya paling parah: `_susunApprovalList_`
menyisir sheet `Absensi` untuk SEMUA orang, dan itu ikut ditunggu
sebelum dashboard-nya muncul.

### Aturannya sekarang

Yang boleh ikut di respons login hanyalah yang **dibutuhkan untuk
menggambar layar** DAN **tidak menyentuh sheet besar**:

| Boleh | Tidak boleh |
|---|---|
| `masterData`, `pengumuman`, `periode` (dari simpanan) | `stats` — menyisir jendela `Absensi` + indeks `dbabsen` |
| `gpsTracking` (Script Properties) | `approval` — menyisir `Absensi` untuk semua orang |

Statistik dan angka approval diambil Dashboard lewat **satu** request
`buka_aplikasi` di **latar belakang** — layar sudah terlihat, angkanya
menyusul. Empat request lama tetap menjadi satu; yang berubah hanya
kapan ia dijalankan.

Aturan ini ditulis sebagai komentar panjang di dua tempat yang paling
mungkin dilanggar lagi: nomor 6 di `handleLogin` (`Code.gs`) dan
`handleLogin` di `src/App.js`.

### Pelajarannya

**Menghitung request bukan mengukur kecepatan.** Yang diukur karyawan
adalah jarak antara menekan tombol dan melihat layar. Menggabungkan dua
request menjadi satu hanya membantu kalau keduanya memang sama-sama
ditunggu; kalau yang satu tadinya berjalan di belakang layar,
menggabungkannya justru memindahkan biayanya ke depan mata.

### Cara mengukurnya sekarang

`Profiler.gs` punya dua fungsi baru:

- **`PROFILE_MASUK()`** — merinci waktu SETIAP bagian jalur masuk
  (baca Users, simpanan, indeks dbabsen, jendela Absensi, `hitungStats`,
  daftar approval) dalam satu tabel, lengkap dengan bagian terberatnya.
  Tanpa efek samping: tidak menerbitkan SessionID, tidak menulis sel.
- **`PROFILE_MASUK_DINGIN()`** — sama, tetapi seluruh simpanan dibuang
  lebih dulu, sehingga yang terukur adalah kondisi terburuk: karyawan
  pertama yang login sesudah import data mesin.

Dari sisi HP, buka console browser lalu login — ada baris
`[absensi] request login: N ms`. Itu memisahkan tiga kemungkinan yang
sering tertukar:

| Yang terlihat | Artinya |
|---|---|
| angka besar | server atau jaringan |
| angka kecil, dashboard tetap lama | pengisian dashboard, atau **gerbang GPS** |

Gerbang GPS layak dicurigai lebih dulu daripada yang terlihat. Pada
login pertama di sebuah perangkat (izin lokasi belum pernah diberikan),
`src/utils/gpsWajib.js` mencoba **GPS presisi tinggi dengan batas 12
detik** sebelum jatuh ke lokasi jaringan. Di dalam gedung, percobaan
pertama itu hampir selalu habis waktunya — dan selama itu layar
dashboard ditutup lapisan "Memeriksa Lokasi…". Karyawan yang izinnya
SUDAH diberikan tidak mengalaminya, karena gerbangnya berjalan diam-diam
di belakang layar.

**Ongkos tetap Apps Script tidak bisa dihilangkan dari kode.** Setiap
POST ke web app dijawab redirect 302 lalu diikuti GET kedua, ditambah
boot container — biasanya 1-3 detik. Jadi target "3 detik" hanya masuk
akal kalau kerja servernya sendiri di bawah ~1 detik. `PROFILE_MASUK()`
yang akan memberi tahu apakah sudah begitu.

---

## 8. KOREKSI KEDUA (1.0.26) — biaya membaca sheet itu PER PANGGILAN, bukan per sel

Ditambahkan 18 Sep 2026, setelah `PROFILE_SHEETS()` dijalankan di
spreadsheet produksi.

### Angka yang mengubah kesimpulan

| Sheet | Baris | Kolom | Sel | Baca |
|---|---|---|---|---|
| Announcements | 9 | 4 | 36 | **214 ms** |
| MasterData | 55 | 7 | 385 | **188 ms** |
| Users | 307 | 18 | 5.526 | **247 ms** |
| Remarks | 809 | 16 | 12.944 | 236 ms |
| running shift | 2.177 | 7 | 15.239 | 306 ms |
| dbabsen | 5.167 | 20 | 103.340 | 736 ms |
| Absensi | 3.431 | 30 | 102.930 | **1.218 ms** |
| MASTER-CUTI | 7.511 | 25 | 187.775 | 827 ms |

**36 sel dan 5.526 sel memakan waktu hampir sama.** Artinya biaya
membaca sheet ≈ **200 ms ongkos tetap per panggilan** + sekitar
0,003–0,010 ms per sel.

Dua hal langsung terbaca dari situ:

1. **Pencarian biner adalah arah yang salah.** Ia menukar sedikit sel
   dengan banyak panggilan. Sepuluh pembacaan satu sel bukan "sangat
   murah" seperti dugaan saya — itu **sekitar 2 detik**, dan dibayar
   setiap kali batasnya belum tersimpan. Penggantinya membaca ekor
   kolom B sekali jalan: **satu panggilan** (~215 ms) untuk jendela di
   bawah 1.500 baris, **paling banyak dua** untuk yang lebih lebar.
   Simpanan batas di Script Properties beserta verifikasi dan
   pembersihannya ikut dihapus — tidak lagi dibutuhkan, dan itu
   menghilangkan satu sumber bug saat ada baris dihapus.

2. **Sheet `Absensi` 2-3× lebih mahal per sel daripada sheet lain**
   (0,0099 ms/sel vs 0,0033 untuk MASTER-CUTI). Dugaan terkuat: kolom
   tanggalnya — `Waktu`, `tglMulai`, `tglSelesai`, `timeStamp` — dan
   setiap sel tanggal harus diterjemahkan menjadi objek `Date`. Belum
   dibuktikan; kalau kelak perlu, bandingkan `getValues()` dengan
   `getDisplayValues()` pada sheet yang sama.

### Sejujurnya: pada ukuran sekarang, jendela nyaris impas

Dengan 3.431 baris dan margin 180 hari, jendela masih memuat sebagian
besar sheet. Hitungan kasarnya:

| | Panggilan | Perkiraan |
|---|---|---|
| Baca penuh 13 kolom | 1 | ~640 ms |
| Jendela (batas + isi) | 2 | ~600 ms |

Jadi **hari ini jendela bukan penghematan besar** — nilainya adalah
menahan biaya agar tidak ikut tumbuh. Pada 20.000 baris selisihnya
menjadi ~2,8 detik lawan ~1,0 detik, dan di situlah ia benar-benar
terbayar.

`JENDELA_UJI()` sekarang mencetak selisih waktu yang sebenarnya, jadi
klaim ini bisa diperiksa, bukan dipercaya.

### Margin 180 hari tidak perlu ditebak lagi

`JENDELA_UJI()` melaporkan **"selisih terjauh sebenarnya"**: dari semua
baris yang jatuh di dalam periode aktif, berapa hari paling awal sebuah
baris pernah diinput sebelum periode itu dimulai. Itulah margin minimum
yang sah untuk data ini. Kalau angkanya jauh di bawah 180, margin boleh
diturunkan — dan jendelanya langsung menyempit.

Ia juga menghitung **baris yang kolom Waktu-nya tidak terbaca**. Seluruh
keamanan jendela bersandar pada kolom B yang selalu terisi; baris yang
dikosongkan manual di sheet tidak bisa dinilai posisinya. Jumlahnya
sekarang dilaporkan, bukan diasumsikan nol.

### Pelajarannya

Dua koreksi berturut-turut di dokumen ini punya bentuk yang sama:
**mengoptimalkan besaran yang salah.** Bagian 7 menghitung request
padahal yang ditunggu karyawan adalah layar. Bagian 8 menghitung sel
padahal yang dibayar adalah panggilan. Keduanya baru ketahuan setelah
ada angka dari spreadsheet yang sebenarnya — bukan dari penalaran.

---

## 9. HASIL PENGUKURAN SEBENARNYA (`PROFILE_MASUK`, 18 Sep 2026)

Dijalankan di spreadsheet produksi, akun admin, simpanan dalam keadaan
kedaluwarsa (kondisi terburuk):

| Bagian | ms | Keterangan |
|---|---|---|
| `bacaSheet(Users,14)` | 187 | 306 baris |
| `getMasterDataCached` | 588 | 54 entri |
| `getPetaCutiCached` | 756 | 325 NIK |
| `_ambilGeofenceUser` | 220 | |
| `getPengumumanAktifCached` | 369 | |
| `getSemuaPeriode_` | 44 | |
| **`_ringkasGpsTracking_`** | **540** | hanya membaca SATU nilai konfigurasi |
| `getIndeksDbAbsen` | 89 | 219 NIK |
| **`jendela sheet Absensi`** | **2.112** | **3.340 dari 3.433 baris** |
| `hitungStats` (utuh) | 2.009 | |
| `_susunApprovalList_` | 933 | 500 pengajuan pending |

Empat hal langsung terbaca, dan tiga di antaranya sudah diperbaiki.

### 9.1 `_ringkasGpsTracking_` 540 ms — CacheService yang terlewat

540 ms untuk membaca satu nilai konfigurasi. Sebabnya: `GpsTracking.gs`
masih memakai **CacheService langsung**, padahal `DIAGNOSA-LAMBAT-LAGI.md`
sudah membuktikan CacheService di skrip ini menerima tulisan lalu
membuangnya. `Cache.gs` dan `StatsIndex.gs` sudah dipindahkan waktu itu;
**`GpsTracking.gs` terlewat.**

Artinya sheet `GpsTrackConfig` dibaca ulang pada SETIAP pemanggilan —
bukan hanya saat login, tetapi juga pada **setiap ping posisi**: 300
karyawan, tiap lima menit. Diperbaiki di 1.0.27.

Nomor baris "posisi terakhir" sekalian diubah menjadi **satu peta**, bukan
satu properti per karyawan: 300 kunci tambahan di Script Properties akan
memperlambat semua pembacaan simpanan di seluruh skrip.

### 9.2 Jendela Absensi memuat 3.340 dari 3.433 baris — praktis tidak memotong apa pun

Jendela mulai di **baris 95**. Dengan margin 180 hari, ia menjangkau
hampir ke awal sheet: **97% baris tetap dibaca.** Biayanya tetap dibayar,
manfaatnya nyaris nol.

Angka 2.112 ms itu juga masih memakai pencarian biner versi 1.0.25 —
1.0.26 sudah memangkasnya menjadi paling banyak dua panggilan. Tetapi
sisanya, pembacaan 3.340 baris itu sendiri, **hanya bisa dipotong dengan
mempersempit margin.**

Inilah **satu-satunya lever besar yang tersisa**, dan angkanya tidak boleh
ditebak. `JENDELA_UJI()` mencetak **"selisih terjauh sebenarnya"** — dari
semua baris yang jatuh di dalam periode aktif, berapa hari paling awal
sebuah baris pernah diinput sebelum periode itu dimulai. Itulah margin
minimum yang sah untuk data ini.

Kalau angkanya, misalnya, 20 hari, maka `JENDELA_MARGIN_HARI` boleh
diturunkan ke 90 dan jendelanya menyempit dari 3.340 baris menjadi sekitar
sepertiganya — **tanpa kehilangan satu baris pun**, dan itu bisa dibuktikan
dengan menjalankan `JENDELA_UJI()` lagi (harus tetap `TERLEWAT: 0`).

### 9.3 MasterData & Geofence: 10 menit terlalu pendek

588 ms dan 220 ms, dibayar ulang setiap sepuluh menit seumur hidup
aplikasi, untuk data yang nyaris tidak pernah berubah — dan keduanya
sudah punya pembersihan eksplisit di titik tulisnya. Masa berlakunya
dinaikkan menjadi 6 jam dan 1 jam.

`MASTER-CUTI` (756 ms) dan Pengumuman (369 ms) **sengaja tetap 10 menit**:
keduanya lazim disunting langsung di sheet, dan angka cuti yang basi jauh
lebih berbahaya daripada lambat.

### 9.4 500 pengajuan berstatus Pending

`_susunApprovalList_` memakan 933 ms, dan sebab terbesarnya bukan kode:
ada **500 pengajuan yang tidak pernah disetujui atau ditolak**. Itu
persoalan proses, bukan performa — tetapi selama tumpukannya dibiarkan,
biayanya dibayar setiap kali seorang penyetuju membuka aplikasi.

### 9.5 Yang masih belum diukur

`devicePeriksaLogin` tidak ikut terukur karena memanggilnya berarti
menerbitkan SessionID baru dan menggusur sesi karyawan. Kalau setelah
semua perbaikan di atas login masih terasa berat, di situlah tempat
berikutnya yang harus dilihat.
