# Audit Sistem Absensi — 12 Agustus 2026

Arsitektur yang dipakai: **React (Vercel) → Google Apps Script Web App → Google Spreadsheet**
(Spreadsheet: `1sVO4BHUE-cwZuqdt010mzrhoj9otzrUSToWkF7SWAxk`)

Backend kini ikut masuk repo di `apps-script/` (`Code.gs`, `SyncCuti.gs`) supaya versinya terlacak
bersama frontend. Migrasi PostgreSQL yang tadinya menggantung di working tree sudah diparkir ke
branch `migrasi-postgres` — tidak hilang, tapi tidak lagi mengganggu `main`.

---

## P0 · Keamanan — perlu ditangani lebih dulu

### 1. `doPost` tidak punya autentikasi sama sekali
`Code.gs:78-140` langsung merutekan `data.action` ke handler tanpa memverifikasi siapa pemanggilnya.
URL Web App di-hardcode di `src/config/constants.js:5`, dan file itu ikut ter-*bundle* ke JavaScript
publik — artinya URL tersebut bisa dibaca siapa pun yang membuka DevTools.

Pengecekan role yang ada pun bersandar pada field yang **dikirim oleh klien**:

```js
// Code.gs:2030 dan 2059
const role = data.roleRequester ? String(data.roleRequester).toLowerCase() : '';
if (role !== 'admin') return responseJSON({ result:'error', message:'Hanya Admin...' });
```

Siapa pun cukup mengirim `roleRequester: "admin"` untuk melewatinya. Action yang terekspos:

| Action | Akibat bila disalahgunakan |
|---|---|
| `reset_password_user` | Reset password karyawan mana pun menjadi `"123"` |
| `get_user_list_admin` | Seluruh data karyawan (UUID, username, nama, divisi, jabatan) terbaca |
| `delete_absensi` / `delete_absen` | Hapus record absensi |
| `update_absensi` / `edit_absen` | Ubah record absensi |
| `process_approval` | Approve/reject pengajuan atas nama orang lain |
| `tambah_user` | Buat akun baru |

**Rekomendasi:** terbitkan token saat `handleLogin` (HMAC berisi `userId|role|expiry`, ditandatangani
secret dari `PropertiesService.getScriptProperties()`), verifikasi token di awal `doPost` untuk semua
action kecuali `ping` / `check_version` / `login`, dan **ambil role dari token — bukan dari body request**.

### 2. Password tersimpan sebagai teks polos
`handleLogin` (`Code.gs:822`) membandingkan langsung ke kolom C sheet `Users`. Konsekuensinya siapa pun
yang punya akses *view* ke spreadsheet dapat membaca seluruh password karyawan.

**Rekomendasi:** simpan hash (`Utilities.computeDigest(SHA_256, password + salt)`) di kolom baru,
verifikasi terhadap hash, migrasikan bertahap (kalau kolom hash kosong → verifikasi teks polos, lalu
langsung tulis hash-nya).

### 3. Reset password ke nilai tetap `"123"`
`Code.gs:2074`. Nilainya bisa ditebak dan tidak ada paksaan ganti password saat login berikutnya.

**Rekomendasi:** generate password acak, tampilkan sekali ke admin, set flag `must_change_password`.

### 4. Perbandingan password memakai `==` (loose equality)
```js
// Code.gs:822
row[2] == data.password
```
Bila sel password di Sheets terbaca sebagai angka (misal `123`), maka `123 == "123"` bernilai `true` —
tapi kasus tepi lain bisa lolos tak terduga. Gunakan `String(row[2]) === String(data.password)`.

---

## P0 · Bug — 8 fungsi dideklarasikan ganda dan saling menimpa

Di Apps Script seluruh file `.gs` berbagi satu global scope, dan deklarasi `function` dengan nama sama
akan **ditimpa oleh deklarasi terakhir** (function hoisting). Jadi versi awal jadi *dead code* tanpa
peringatan apa pun.

| Fungsi | Baris deklarasi | Yang benar-benar aktif | Dampak |
|---|---|---|---|
| `handleGetHistory` | 963, **1652** | 1652 | **Kritis** — lihat di bawah |
| `formatDate` | 1895, 2412, **2532** | 2532 → `dd-mm-yyyy HH:mm` | Pemanggil yang menulis kode berharap `yyyy-mm-dd HH:mm` (versi 2412) mendapat urutan terbalik |
| `formatDateTimeFull` | 2439, **2466** | 2466 → `12/8/2026 \| 08:30` | Versi 2439 menghasilkan `12-08-2026 08:30`. Format laporan jadi tidak konsisten |
| `formatDateDDMMYYYY` | 2304, 2496, **2555** | 2555 → return `'-'` bila invalid | Versi 2496 mengembalikan nilai aslinya; teks non-tanggal sekarang berubah jadi `-` |
| `formatDateYMD` | 1897, **2399** | 2399 | Perilaku setara — aman |
| `formatDateYMD_Strict` | 2295, 2327, **2572** | 2572 | Ketiganya identik — aman |
| `formatTimeOnly_Backend` | 2339, **2586** | 2586 | Identik — aman |
| `isValidDate` | 2319, **2548** | 2548 | Identik — aman |

### Detail `handleGetHistory` — kemungkinan besar ini akar bug laporan absensi

Versi **963** (mati) memformat tanggal & jam sebelum dikirim:

```js
waktu:        formatDate(row[1]),
tglMulai:     formatDateYMD(row[8]),
jamMulai:     formatTimeSimple(row[10]),
approvalTime: formatDate(row[14]),
idAkun:       rowUserId,          // ID user
// limit admin: 1000 baris
```

Versi **1652** (aktif) mengirim **nilai mentah dari Sheets**:

```js
waktu:        rowsAbsen[i][1],    // Date object → jadi ISO string di JSON
tglMulai:     rowsAbsen[i][8],
jamMulai:     rowsAbsen[i][10],
approvalTime: rowsAbsen[i][14] || '-',
idAkun:       rowsAbsen[i][21] || '-',   // kolom V — kemungkinan kosong → selalu '-'
// limit admin: 500 baris
```

Tiga konsekuensi nyata:

1. Tanggal/jam terkirim mentah, sehingga frontend harus menebak formatnya — cocok dengan riwayat commit
   `koreksi laporan absensi, modifikasi tampilan tanggal dan jam semua pengajuan` dan
   `update posisi kode`.
2. Kolom **ID Akun** di laporan hampir pasti selalu `-`, karena membaca kolom V sheet `Absensi`
   (bukan `noPayroll` dari sheet `Users` seperti versi 963).
3. Limit data admin turun dari 1000 → 500 baris tanpa disengaja.

**Rekomendasi:** hapus salah satu, pertahankan satu implementasi. Kalau perilaku hari ini (mentah) yang
sudah "dikompensasi" di frontend, maka hapus versi 963 dan perbaiki `idAkun` → `userData.noPayroll`.
Kalau tampilan laporan masih bermasalah, pakai versi 963 dan hapus 1652.

---

## P1 · Performa

- **49 pemanggilan `getDataRange().getValues()`** di `Code.gs`. Setiap kali membaca **seluruh** sheet,
  bukan hanya rentang yang dibutuhkan. `handleLogin` sendiri membaca 3 sheet penuh
  (`Users` + `MasterData` + `MASTER-CUTI`) hanya untuk memverifikasi satu baris login.
- Pola loop-lalu-`setValue()` per baris (mis. `handleResetPasswordUser:2074`) memicu satu round-trip
  API per operasi. `setValues()` batch jauh lebih cepat.
- **Belum ada cache.** `MasterData` dan `MASTER-CUTI` jarang berubah tapi dibaca ulang tiap request —
  kandidat kuat untuk `CacheService.getScriptCache()` dengan TTL 5–10 menit.
- `syncToExternalPayroll` (`Code.gs:2636`) membuka 3 spreadsheet eksternal secara sinkron di dalam
  request user. Ini menahan respons UI dan berisiko kena batas 6 menit Apps Script.
  Sebaiknya dipindah ke queue + `ScriptApp.newTrigger` agar berjalan di latar belakang.

**Target realistis:** login & dashboard dari beberapa detik menjadi di bawah 1 detik, tanpa perlu ganti
database.

---

## P2 · Refactor `src/App.js`

`src/App.js` = **4.213 baris / 264 KB dalam satu file**, memuat 15 komponen + 114 `useState` +
29 pemanggilan `fetch`. Folder `src/screens/` sudah ada tapi kedua file di dalamnya kosong (0 byte).

Rencana pemecahan (tanpa mengubah perilaku, murni memindahkan kode):

```
src/
├── api/client.js              ← satu helper fetch: token, error, timeout, retry
├── hooks/
│   ├── useAuth.js
│   └── useMasterData.js
├── utils/
│   ├── date.js                ← formatDateIndo, formatDateShort, formatTimeOnly
│   └── export.js              ← jsPDF + xlsx
├── components/
│   ├── BackButton.js          ← sudah ada
│   ├── AnalogClock.js
│   ├── Skeleton.js
│   └── DateRangeModal.js
└── screens/
    ├── LoginScreen.js         (3643)
    ├── Dashboard.js           (101)
    ├── DashboardScreen.js     (1226)
    ├── AttendanceForm.js      (2018)
    ├── ApprovalScreen.js      (2375)   ← file placeholder 0 byte sudah ada
    ├── HistoryScreen.js       (2616)
    ├── AdminPanel.js          (3387)   ← file placeholder 0 byte sudah ada
    ├── AnalysisScreen.js      (793)
    ├── RemarkScreen.js        (1346)
    ├── ShiftScheduleScreen.js (492)
    ├── DbAbsenScreen.js       (3843)
    └── ChangePasswordScreen.js (3800)
```

Urutan aman: mulai dari `utils/date.js` dan `api/client.js` (dipakai semua screen, risiko paling
rendah), lalu pindahkan screen satu per satu — commit terpisah tiap screen agar mudah di-*revert*
kalau ada yang lepas.

Catatan tambahan: `formatTimeOnly` didefinisikan di **baris 4214**, yaitu *setelah* semua komponen yang
memakainya. Berhasil hanya karena function hoisting — akan langsung terlihat sebagai masalah begitu
file dipecah.

---

## Prioritas yang diusulkan

| # | Pekerjaan | Dampak | Risiko | Estimasi |
|---|---|---|---|---|
| 1 | Hapus 8 fungsi duplikat, sisakan satu versi per fungsi | Menghentikan bug tanggal/jam & `idAkun` | Rendah | 1–2 jam |
| 2 | Token auth di `doPost` + role dari token | Menutup celah reset password & kebocoran data karyawan | Sedang | 3–4 jam |
| 3 | Hash password + reset password acak | Password tak lagi terbaca dari spreadsheet | Sedang | 2–3 jam |
| 4 | Cache `MasterData`/`MASTER-CUTI` + `handleLogin` baca terbatas | Login & dashboard di bawah 1 detik | Rendah | 2 jam |
| 5 | `syncToExternalPayroll` jadi trigger latar belakang | Approval tidak lagi menggantung | Sedang | 2–3 jam |
| 6 | Pecah `App.js` menjadi modul | Pengembangan fitur ke depan jauh lebih mudah | Rendah (bertahap) | 1–2 hari |
| 7 | Fitur baru | — | — | menunggu detail |

---

## Yang masih perlu dikonfirmasi

1. **`handleGetHistory` mana yang benar** menurut tampilan laporan yang Anda harapkan — yang memformat
   tanggal di backend (963), atau yang mentah lalu diformat di frontend (1652)?
2. **Bug spesifik** yang sedang Anda alami — apakah termasuk masalah tanggal/`idAkun` di atas, atau hal lain?
3. **Fitur baru** apa yang ingin ditambahkan?
4. Branch `migrasi-postgres` — dipertahankan sebagai arsip, atau dihapus saja?
