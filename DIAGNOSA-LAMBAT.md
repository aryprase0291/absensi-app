# Diagnosa: Kenapa Masuk Aplikasi Lambat

Ditelusuri 12 Agustus 2026 · file terkait: `src/App.js`, `apps-script/Code.gs`
Spreadsheet `absen` berukuran **1,25 MB** data sel.

---

## Ringkasan

Dari buka aplikasi sampai angka dashboard tampil, aplikasi menembak **4 request
Apps Script secara berurutan**, yang totalnya membaca **9 sheet secara penuh** —
3 di antaranya pembacaan ganda. Sama sekali **tidak ada cache** (`CacheService`
tidak dipakai satu kali pun di `Code.gs`).

Yang paling memberatkan bukan jumlah datanya, tapi satu hal: **`dbabsen` diduga
berisi formula/IMPORTRANGE, dan dibaca seluruhnya setiap kali user login.**

---

## Urutan request saat membuka aplikasi

| # | Kapan | Action | Sheet yang dibaca **penuh** |
|---|---|---|---|
| 1 | App mount (`App.js:27`) | `check_version` | – (hanya balikkan 1 string) |
| 2 | User klik Login (`App.js:3627`) | `login` | `Users`, `MasterData`, `MASTER-CUTI` |
| 3 | Dashboard mount (`App.js:104`) | `get_latest_announcement` | `Announcements` |
| 4 | Dashboard mount (`App.js:110`) | `get_stats` | `Absensi`, `dbabsen`, `MASTER-CUTI`, `Users`, `Remarks` |

Request #3 dan #4 ditembak "paralel" dari dua `useEffect`, **tapi Apps Script
menjalankan eksekusi milik user yang sama secara berurutan** — jadi keduanya
tetap mengantre, tidak benar-benar paralel.

Perlu diingat juga: setiap POST ke Apps Script Web App dijawab dengan **302
redirect** ke `script.googleusercontent.com`. Jadi 4 request di atas = **8 round
trip HTTP**, ditambah waktu boot container script tiap eksekusi.

---

## Penyebab, diurut dari paling berdampak

### 1. `dbabsen` dibaca penuh, dan isinya kemungkinan besar formula

`handleGetStats` (`Code.gs:1075`):

```js
const sheetDb = SS.getSheetByName(SHEET_DB_ABSEN);
const rowsDb = sheetDb ? sheetDb.getDataRange().getValues() : [];
```

Membaca **seluruh** sheet mesin absen — lalu memakainya hanya untuk menghitung
statistik **satu orang**:

```js
for (let j = 1; j < rowsDb.length; j++) {
  const rowNik = String(rowsDb[j][2]).trim();
  if (rowNik === userNik) { ... }     // sisanya dibuang
}
```

Buktinya kolom A:S `dbabsen` berisi formula ada di kode Anda sendiri —
`checkFormulaUpdates` (`Code.gs:1985`, `1990`):

```js
// 1. Ambil Data Kolom A sampai S (Area Formula)
const rangeData = sheet.getRange(2, 1, lastRow - 1, 19);
...
// --> DATA BERUBAH! (Ada update dari ImportRange)
```

Kalau kolom A:S memang formula/IMPORTRANGE, maka **setiap `getValues()` memaksa
Google Sheets menghitung ulang seluruh formula itu**, termasuk menarik data dari
spreadsheet lain. Untuk sheet berisi ribuan baris, ini sendiri sudah bisa
memakan beberapa detik — dan terjadi **setiap kali ada orang login**.

Jalankan `PROFILE_FORMULA_DBABSEN()` di `apps-script/Profiler.gs` untuk
memastikan dugaan ini dengan angka.

### 2. `Absensi` juga dibaca penuh untuk menghitung 1 user

`handleGetStats` (`Code.gs:1071`) membaca sheet `Absensi` seluruhnya lalu
menyaring `rowsAbsensi[i][2] === targetId`. Sheet ini **tumbuh terus** — makin
banyak pengajuan masuk, makin lambat login **semua orang**, termasuk user baru
yang belum punya satu pun record.

Inilah kenapa dulu terasa cepat dan sekarang lambat: biayanya tumbuh seiring
data, bukan seiring jumlah user.

### 3. `Users` dan `MASTER-CUTI` dibaca dua kali dalam ~2 detik

`handleLogin` (`Code.gs:794`, `813`) sudah membaca keduanya dan **sudah
mengembalikan** `sisaCuti`, `cutiTerpakai`, `cutiBersama` ke frontend.
Lalu `handleGetStats` (`Code.gs:1080`, `1122`) membaca ulang dua sheet yang sama
untuk menghitung nilai yang sudah dipegang frontend.

Pekerjaan ini murni terbuang.

### 4. `check_version` = satu round trip penuh hanya untuk sebuah string

`Code.gs:88-90`:

```js
if (action === 'check_version') {
    return responseJSON({ result: 'success', version: APP_VERSION });
}
```

Tidak menyentuh sheet sama sekali, tapi tetap membayar redirect 302 + boot
script. Dan karena `SS` dideklarasikan di **global scope** (`Code.gs:1`):

```js
const SS = SpreadsheetApp.getActiveSpreadsheet();
```

spreadsheet tetap dibuka bahkan untuk `ping` dan `check_version` yang tidak
butuh spreadsheet.

### 5. Nol cache

`MasterData` (menu, role, divisi, shift) praktis tidak pernah berubah, tapi
dibaca ulang tiap login oleh tiap user. `CacheService` sama sekali belum dipakai
— hasil grep di `Code.gs`: **0 kemunculan** `CacheService`, **0** `LockService`.

### 6. ~~`onEdit` menulis timestamp per baris di `dbabsen`~~ — DIKOREKSI

**Poin ini keliru dan sudah dibatalkan.** Diagnosa awal ditulis tanpa melihat
seluruh isi project Apps Script — waktu itu hanya ada `Code.gs` dan
`SyncCuti.gs`. Setelah memeriksa editor secara langsung, ternyata ada dua file
lain: `SendTelegramRemark.gs` dan `SendTelegramForm.gs`.

Dan `onEdit` **dideklarasikan dua kali**:

| File | Baris | Menjaga sheet | Yang dilakukan |
|---|---|---|---|
| `Kode.gs` | 2607 | `dbabsen` | `setValue` timestamp ke kolom T |
| `SendTelegramForm.gs` | 268 | `Absensi` | memanggil `triggerTelegramUpdate()` |

Karena seluruh file `.gs` berbagi satu global scope, deklarasi terakhir menimpa
yang sebelumnya. Urutan file di project Anda:

```
Kode.gs → SyncCuti.gs → SendTelegramRemark.gs → SendTelegramForm.gs
```

`SendTelegramForm.gs` paling akhir, jadi **`onEdit` di `Kode.gs` tidak pernah
berjalan.** Penulisan timestamp kolom T di `dbabsen` sudah mati sejak file
Telegram itu ditambahkan — sehingga bukan penyebab lambat, karena tidak pernah
dieksekusi.

**Cara memastikan sendiri:** buka sheet `dbabsen`, lihat kolom T. Kalau isinya
kosong atau timestamp-nya lama padahal barisnya baru diubah, itu konfirmasinya.

**Kabar baiknya, perbaikannya mudah.** Keduanya menjaga sheet yang *berbeda*
(`dbabsen` vs `Absensi`), jadi tidak ada konflik logika — hanya konflik nama.
Cukup disatukan jadi satu `onEdit`:

```js
function onEdit(e) {
  if (!e) return;
  const nama = e.source.getActiveSheet().getName();
  if (nama === 'dbabsen')  onEditDbAbsen(e);        // eks Kode.gs
  if (nama === 'Absensi')  triggerTelegramUpdate(e); // eks SendTelegramForm.gs
}
```

lalu ganti nama `onEdit` di `Kode.gs` menjadi `onEditDbAbsen`, dan hapus
`onEdit` di `SendTelegramForm.gs`.

> **Sekalian catatan keamanan:** kedua file Telegram memuat bot token dan chat ID
> langsung di dalam kode (`TELEGRAM_TOKEN_REMARK`, `BOT_TOKEN`). Repo GitHub
> masih Public — **jangan commit kedua file itu.** Sebaiknya token dipindah ke
> `PropertiesService.getScriptProperties()` seperti `AUTH_SECRET`.

---

## Bukan penyebab utama, tapi tetap perlu dibetulkan

**Listener `mousemove` untuk auto-logout** (`App.js:59`):

```js
const ev = ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'];
ev.forEach(e => window.addEventListener(e, resetTimer));
```

`resetTimer` dipanggil setiap gerakan mouse, masing-masing melakukan
`clearTimeout` + `setTimeout`. Tidak memperlambat login, tapi membuat UI
tersendat — terutama di HP kelas bawah. Perlu di-*throttle* (misal maksimal
sekali per 5 detik).

**Durasi timeout tidak cocok dengan pesannya.** `TIMEOUT_DURATION` =
`5 * 60 * 1000` (5 menit) di `constants.js:7`, tapi alert-nya berbunyi
*"tidak ada aktivitas selama 10 menit"* (`App.js:56`).

---

## Rencana perbaikan

Diurut berdasarkan hasil dibanding usaha. Semuanya **tanpa ganti database** —
tetap Google Sheets.

| # | Perbaikan | Cara | Perkiraan hasil |
|---|---|---|---|
| 1 | Hapus `get_stats` dari jalur login | Kirim statistik menyusul setelah dashboard tampil, atau gabungkan ke respons `login` | Dashboard muncul seketika; **hemat 1 request penuh** |
| 2 | Berhenti membaca `dbabsen` & `Absensi` secara penuh | Buat sheet `RekapStats` berisi 1 baris per NIK, diperbarui trigger tiap 15 menit. `get_stats` cukup baca 1 baris | **Penghematan terbesar** — biaya jadi tetap, tidak tumbuh lagi |
| 3 | Bekukan `dbabsen` jadi nilai statis | Jalankan impor berkala yang menulis hasil formula sebagai nilai biasa, bukan formula hidup | Hilangkan perhitungan ulang formula tiap request |
| 4 | Hapus pembacaan ganda `Users`/`MASTER-CUTI` di `get_stats` | Frontend sudah punya datanya dari respons `login` | Hemat 2 pembacaan sheet penuh |
| 5 | Cache `MasterData` + `MASTER-CUTI` | `CacheService.getScriptCache()`, TTL 10 menit | Login lebih ringan untuk semua user |
| 6 | Buang request `check_version` | Sertakan `version` di dalam respons `login` | Hemat 1 round trip (~1–2 detik) |
| 7 | Pindahkan `SS` ke dalam fungsi | `function getSS(){ return SpreadsheetApp.getActiveSpreadsheet(); }` | `ping`/`check_version` tidak lagi membuka spreadsheet |
| 8 | Throttle listener `mousemove` | Batasi 1 panggilan / 5 detik | UI tidak tersendat |

Setelah #1–#4, target masuk aplikasi **di bawah 2 detik** dan yang lebih penting:
**tidak melambat lagi seiring bertambahnya data**.

---

## Langkah selanjutnya

Dugaan di atas sudah kuat dari sisi kode, tapi belum ada angka nyata dari
spreadsheet Anda. Saya sudah siapkan `apps-script/Profiler.gs` — **read-only,
tidak mengubah data apa pun**.

Jalankan ini di editor Apps Script, lalu kirimkan log-nya:

1. `PROFILE_SHEETS()` — jumlah baris tiap sheet + waktu bacanya
2. `PROFILE_FORMULA_DBABSEN()` — memastikan apakah `dbabsen` berformula
3. `PROFILE_STATS()` — durasi `handleGetStats` (isi dulu `USER_ID` di dalamnya)

Dari angka itu saya bisa memastikan mana yang benar-benar dominan sebelum
mengubah kode, supaya perbaikannya tepat sasaran dan bukan tebakan.
