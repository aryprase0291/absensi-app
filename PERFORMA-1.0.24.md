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

`handleLogin` juga ikut membawa `stats`, `gpsTracking`, dan `approval`,
sehingga **login pun tidak lagi disusul request apa pun**.

**Frontend** — `bootAwal` menampung jawaban itu, dan `bootMenunggu`
menahan layar-layar di bawah supaya tidak menembak request sendiri
selama jawabannya masih di perjalanan.

| Bentuk pembukaan | Sebelum | Sesudah |
|---|---|---|
| Sesi dipulihkan (karyawan biasa) | 4 request | **1** |
| Sesi dipulihkan (penyetuju) | 5 request | **1** |
| Login baru | 1 login + 3-4 susulan | **1** |

Angka lonceng approval sengaja dikirim **hanya jumlahnya**, bukan
daftarnya: layar Approval mengambil daftar lengkap sendiri saat
benar-benar dibuka. Menitipkan ratusan baris di sini justru akan membuat
pembukaan aplikasi lebih berat daripada sebelumnya.

### B. Jendela baris sheet Absensi (`apps-script/JendelaAbsensi.gs`)

Kolom B (Waktu Input) **selalu menaik**, karena setiap baris baru masuk
lewat `appendRow` dan tidak ada satu pun handler yang menulis ulang kolom
itu — sudah diperiksa: `handleEditAbsen` menyentuh kolom G, I, J, K, L;
`handleUpdateAbsensi` kolom E.

Karena menaik, baris pertama yang waktunya ≥ sebuah tanggal bisa dicari
dengan **pencarian biner**. Diuji atas data sintetis:

| Jumlah baris | Panggilan Sheets untuk menemukan batas |
|---|---|
| 200 | 3 |
| 5.000 | 8 |
| 20.000 | 10 |

Batasnya lalu disimpan di Script Properties dan **diverifikasi setiap
dipakai** (satu pembacaan 2 sel): baris sebelum batas harus masih di
bawah tanggal, baris batas harus masih di atasnya. Verifikasi itu yang
membuatnya aman terhadap penghapusan baris — kalau batasnya sudah tidak
tepat, pencarian biner diulang.

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
