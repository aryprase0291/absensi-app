# Periode Absensi Ganda — Panduan Pasang

21 Agustus 2026. Mengubah periode absensi dari **satu periode tunggal**
menjadi **daftar periode dengan saklar aktif/nonaktif**, di mana lebih dari
satu boleh aktif bersamaan.

---

## Aturan yang dipakai

| # | Aturan | Konsekuensi |
|---|---|---|
| 1 | Dashboard: karyawan pilih dari **dropdown periode aktif** | Angka per-periode, tidak dijumlah |
| 2 | Kuota ijin **4× per periode** | Yang menentukan: **tanggal ijin yang diajukan**, bukan tanggal hari ini |
| 3 | Periode nonaktif tetap bisa dipilih **semua orang** di Riwayat | Hanya dashboard yang dibatasi periode aktif |

### Periode default (saat dashboard pertama dibuka)

Periode aktif yang **memuat tanggal hari ini**. Kalau tidak ada, dipakai
periode aktif dengan tanggal mulai paling akhir. Kalau belum ada periode
sama sekali, dipakai siklus standar tanggal 21 s/d 20.

> Sengaja tidak ada saklar "default" terpisah di layar admin — satu hal
> lebih sedikit yang bisa salah diatur, dan hasilnya hampir selalu sama
> dengan yang diharapkan.

### Periode aktif tidak boleh tumpang tindih

Ini konsekuensi langsung dari aturan 2. Kalau `21 Jul–20 Agu` dan
`1 Agu–31 Agu` sama-sama aktif, tanggal 10 Agustus ada di dua-duanya dan
kuota ijinnya jadi tidak tentu — 4× atau 8× tergantung urutan pembacaan.
Karena itu tumpang tindih antar periode **aktif** ditolak saat disimpan,
dengan pesan yang menyebut pasangan mana yang bertabrakan.

Periode **nonaktif** bebas tumpang tindih — hanya dipakai melihat histori.

---

## Yang sudah dikerjakan

### 1. `apps-script/AbsencePeriod.gs` — ditulis ulang

Fungsi baru:

| Fungsi | Guna |
|---|---|
| `getSemuaPeriode_()` | seluruh periode, terbaru dulu. **Migrasi otomatis** dari properti lama |
| `getPeriodeAktifList_()` | isi dropdown dashboard |
| `getPeriodeAbsenAktif_()` | **nama tidak diubah** — periode default |
| `periodeKuotaUntukTanggal_(ymd)` | periode untuk menilai kuota ijin |
| `getPeriodeById_(id)` | termasuk nonaktif, untuk histori |
| `resolvePeriodeStats_(data)` | dashboard — hanya menerima periode aktif |
| `resolvePeriodeHistori_(data)` | riwayat — menerima aktif & nonaktif |
| `handleSaveAbsencePeriods(data)` | simpan seluruh daftar sekaligus |

**Migrasi tidak perlu langkah manual.** Saat pertama dibaca, periode
tunggal yang sedang berlaku (`ABSENCE_PERIOD_ACTIVE_V1`) otomatis menjadi
entri pertama daftar dalam keadaan aktif.

`getPeriodeAbsenAktif_()` **sengaja dipertahankan namanya** — ada 8
pemanggil di `Code.gs`/`StatsIndex.gs` yang tetap benar dengan memakai
periode default, jadi tidak perlu disentuh satu per satu.

Action lama `save_absence_period` juga dipertahankan (menambahkan satu
periode aktif + menonaktifkan yang bertabrakan), supaya bundle frontend
lama tidak error selama masa transisi.

### 2. `apps-script/StatsIndex.gs` — perbaikan wajib

⚠️ **Ini bug yang akan muncul kalau bagian ini tidak ikut ditempel.**

`_bersihkanPropsLama_` sebelumnya membuang semua properti indeks yang
kuncinya bukan kunci saat ini. Sejak periode boleh lebih dari satu,
**setiap periode punya indeksnya sendiri** — sehingga karyawan yang membuka
periode Agustus akan menghapus indeks periode Juli milik karyawan lain,
lalu sebaliknya. Keduanya bergantian menyisir ulang sheet.

Gejalanya sulit dikenali: dashboard cepat sesekali lalu tiba-tiba lambat
lagi tanpa pola, **tanpa error apa pun di log**.

Sekarang yang dibuang hanya sisa **revisi lama**; seluruh periode pada
revisi yang berlaku dipertahankan.

### 3. Sudah diuji

15 skenario dijalankan atas logika periode — semuanya lulus:

```
1. Dua periode aktif berurutan (kasus utama)
   default = periode yang memuat hari ini      ok
   dropdown berisi 2 periode aktif             ok
   kuota ijin 5 Sep  -> periode Agu-Sep        ok
   kuota ijin 5 Agu  -> periode Jul-Agu        ok
   tanggal di luar semua periode -> null       ok
2. Tumpang tindih antar periode AKTIF ditolak  ok
3. Tumpang tindih boleh kalau salah satu nonaktif, dan
   yang nonaktif tetap tersimpan untuk histori ok
4. Tidak ada aktif yang memuat hari ini -> aktif terbaru  ok
5. Semua dinonaktifkan -> fallback siklus standar         ok
6. Duplikat / tanggal terbalik / >366 hari ditolak        ok
```

---

## Yang perlu Anda lakukan

### Langkah 1 — tempel dua file

- `AbsencePeriod.gs` → timpa seluruhnya
- `StatsIndex.gs` → timpa seluruhnya (berisi perbaikan `_bersihkanPropsLama_`)

### Langkah 2 — `Auth.gs`

Tambahkan satu baris di `ACTION_ROLES`, di dekat `'save_absence_period'`:

```js
  'save_absence_periods': ['admin'],
```

> Tanpa baris ini, `authorizeRequest` membalas **"Action tidak dikenal"**
> dan layar admin tidak bisa menyimpan.

### Langkah 3 — `Code.gs`, empat suntingan

#### 3a. Kuota ijin ikut tanggal pengajuan (sekitar baris 263)

`periodeAktif` sekarang harus dihitung **setelah** `inputDateStr`.

**Cari:**
```js
      const rowsAbsen = sheet.getDataRange().getValues();
      const periodeAktif = getPeriodeAbsenAktif_();
      
      // Tentukan Tanggal Input yang akan dicek (Format: yyyy-MM-dd)
      let inputDateStr = "";
```

**Ganti jadi:**
```js
      const rowsAbsen = sheet.getDataRange().getValues();

      // Tentukan Tanggal Input yang akan dicek (Format: yyyy-MM-dd)
      let inputDateStr = "";
```

lalu **tepat setelah blok `if/else` yang mengisi `inputDateStr` selesai**
(sebelum `let countIjinExisting = 0;`), sisipkan:

```js
      // KUOTA IJIN 4x PER PERIODE (Agu 2026). Periode yang dipakai
      // ditentukan oleh TANGGAL PENGAJUAN, bukan tanggal hari ini —
      // supaya ijin untuk bulan depan dinilai terhadap kuota bulan depan.
      const periodeAktif = periodeKuotaUntukTanggal_(inputDateStr);
```

#### 3b. Validasi potongan ikut tanggal yang diajukan (baris ~955)

**Cari:**
```js
function validasiPotonganAbsensi_(rowsAbsen, userId, tipePotong, intervals) {
  const periodeAktif = getPeriodeAbsenAktif_();
```

**Ganti jadi:**
```js
function validasiPotonganAbsensi_(rowsAbsen, userId, tipePotong, intervals) {
  // Kuota dinilai terhadap periode yang memuat tanggal pengajuan.
  const periodeAktif = periodeKuotaUntukTanggal_(
    (intervals && intervals[0] && intervals[0].mulai) || _periodeHariIni_()
  );
```

#### 3c. `hitungStats` menerima periode pilihan (baris 1788 & 1794)

**Cari:**
```js
function hitungStats(targetId, role, nikDiketahui, petaCutiDiketahui) {
```
**Ganti jadi:**
```js
function hitungStats(targetId, role, nikDiketahui, petaCutiDiketahui, periodeDipilih) {
```

**Cari** (beberapa baris di bawahnya):
```js
    const periodeAktif = getPeriodeAbsenAktif_();
```
**Ganti jadi:**
```js
    const periodeAktif = periodeDipilih || getPeriodeAbsenAktif_();
```

> Pemanggilan lama di `handleLogin` (baris 1566) tidak perlu diubah —
> argumen kelima yang tidak dikirim bernilai `undefined` dan jatuh ke
> periode default, persis perilaku sekarang.

#### 3d. `handleGetStats` meneruskan pilihan periode (baris 1768)

**Cari:**
```js
function handleGetStats(data) {
    return responseJSON({
        result: 'success',
        stats: hitungStats(String(data.userId), data.role)
    });
}
```
**Ganti jadi:**
```js
function handleGetStats(data) {
    // periodeId dikirim dropdown dashboard. Kalau kosong / tidak dikenal /
    // sudah dinonaktifkan, resolvePeriodeStats_ jatuh ke periode default.
    const periode = resolvePeriodeStats_(data);
    return responseJSON({
        result: 'success',
        stats: hitungStats(String(data.userId), data.role, null, null, periode),
        periode: periode
    });
}
```

### Langkah 4 — deploy & uji cepat

Deploy versi baru, lalu di editor jalankan:

```js
function CEK_PERIODE() {
  Logger.log('Semua   : %s', JSON.stringify(getSemuaPeriode_()));
  Logger.log('Aktif   : %s', JSON.stringify(getPeriodeAktifList_()));
  Logger.log('Default : %s', JSON.stringify(getPeriodeAbsenAktif_()));
}
```

Yang diharapkan: periode lama Anda muncul sebagai satu entri aktif (hasil
migrasi), dan `Default` menunjuk ke periode yang memuat hari ini.

---

## Yang BELUM dikerjakan — frontend (`src/App.js`)

Backend sudah siap dan aman dipasang lebih dulu: selama frontend belum
diubah, aplikasi tetap berjalan seperti sekarang (satu periode), karena
`get_absence_period` masih membalas field `period` yang lama.

Tiga bagian yang perlu diubah, dan sudah saya petakan letaknya:

| # | Layar | Letak di `App.js` | Yang perlu dibuat |
|---|---|---|---|
| 1 | **Admin → Periode Absensi** | `fetchAbsencePeriod` (~5118), `handleSaveAbsencePeriod` (~5264), render tab `'period'` | Ubah dari satu pasang tanggal menjadi **daftar baris**: tanggal mulai, tanggal selesai, saklar aktif, tombol hapus, tombol "Tambah periode". Simpan sekali lewat `save_absence_periods` |
| 2 | **Dashboard** | `Dashboard()` (~487), efek fetch stats (~563) | Dropdown periode aktif di dekat label `stats.periode_db`. Saat diganti → tembak `get_stats` dengan `periodeId` |
| 3 | **Riwayat / Analisa** | `get_absence_period` (~1664) | Dropdown berisi **semua** periode (termasuk nonaktif) sebagai pilihan cepat pengisi `filterStart`/`filterEnd` |

Bilang saja kalau mau saya lanjutkan ke frontend — saya kerjakan bertahap
per layar supaya mudah ditinjau, dimulai dari layar admin (tanpa itu,
periode kedua belum bisa dibuat sama sekali).
