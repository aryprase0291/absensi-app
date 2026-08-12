# Menjalankan Aplikasi di Komputer Sendiri

Arsitektur: **React (localhost:3000) → Apps Script Web App → Google Spreadsheet**

Tidak ada database yang perlu diinstall. Yang perlu disiapkan hanya satu hal:
memastikan localhost Anda **tidak** menyentuh spreadsheet produksi.

---

## Jalan cepat (kalau hanya mau melihat tampilan)

```bash
cd ~/Claude/Projects/absensi-app-main
npm install
npm start
```

Buka `http://localhost:3000`.

> **Peringatan:** tanpa file `.env.local`, localhost tersambung ke spreadsheet
> **produksi**. Melihat-lihat aman, tapi jangan menekan tombol Approve, Reject,
> Simpan, Hapus, atau Reset Password.

---

## Setup aman (disarankan) — pakai spreadsheet uji

### Langkah 1 · Salin spreadsheet

Buka spreadsheet `absen` → **File › Buat salinan** → beri nama `absen-TEST`.

Karena `Code.gs` bersifat *container-bound* (menempel pada spreadsheet), seluruh
script ikut tersalin otomatis. Tidak perlu menempel ulang kode.

### Langkah 2 · Amankan script di salinan ⚠️ JANGAN DILEWATI

Salinan script masih menunjuk ke **spreadsheet dan email yang asli**. Kalau
langkah ini dilewati, testing di localhost tetap akan menulis ke payroll
sungguhan dan mengirim email ke HRD sungguhan.

Buka `absen-TEST` → **Ekstensi › Apps Script**, lalu ubah dua hal:

**a. Matikan sinkronisasi payroll eksternal** (`Code.gs` baris 20–33).
Kosongkan daftarnya:

```js
const EXTERNAL_TARGETS = [];   // dikosongkan khusus untuk lingkungan uji
```

Kalau dibiarkan, `syncToExternalPayroll` akan menulis simbol absensi ke tiga
spreadsheet payroll produksi:
`1EztinCf...` (NON-SHIFT/SHIFT), `1RWzfh7n...` (db_jakarta), `1cXuSsy5...` (MST).

**b. Alihkan email HRD ke email Anda sendiri** (`Code.gs` baris 16):

```js
const CONST_HRD_EMAILS = "ariieelink@gmail.com,";
```

Kalau dibiarkan `aryprasetyo@jpt.co.id,hrd@jpt.co.id`, setiap kali Anda menguji
pengajuan absen, email approval sungguhan terkirim ke HRD.

**c. Opsional — percepat testing.** Sisakan sekitar 500 baris di sheet `dbabsen`
dan `Absensi`, sisanya hapus. Bikin login jauh lebih cepat saat ngoprek
(alasannya ada di `DIAGNOSA-LAMBAT.md`).

### Langkah 3 · Deploy script salinan

Masih di editor Apps Script `absen-TEST`:

1. **Deploy › Deployment baru**
2. Jenis: **Aplikasi web**
3. *Jalankan sebagai:* **Saya**
4. *Siapa yang punya akses:* **Siapa saja**
5. **Deploy** → salin **URL Aplikasi web** (berakhiran `/exec`)

Google akan meminta izin akses saat deployment pertama — wajar, karena script
memang mengakses Spreadsheet, Drive, dan Gmail.

### Langkah 4 · Sambungkan ke localhost

```bash
cd ~/Claude/Projects/absensi-app-main
cp .env.local.example .env.local
```

Isi `.env.local`:

```
REACT_APP_SCRIPT_URL=https://script.google.com/macros/s/URL_TEST_ANDA/exec
REACT_APP_TIMEOUT_MINUTES=120
```

### Langkah 5 · Jalankan

```bash
npm install
npm start
```

Login pertama bisa memakai akun yang ada di sheet `Users` salinan Anda.

> CRA membaca env var **saat server start**. Setiap kali `.env.local` diubah,
> hentikan `npm start` (Ctrl+C) lalu jalankan ulang. Refresh browser saja tidak
> cukup.

---

## Kalau mau menguji dari HP

Kamera dan GPS **tidak akan jalan** lewat `http://192.168.x.x:3000`. Browser
hanya mengizinkan `getUserMedia` (`App.js:2127`) dan `geolocation`
(`App.js:2092`) di *secure context* — yaitu HTTPS, atau `localhost`. Alamat IP
lokal lewat HTTP tidak termasuk.

Solusinya buat tunnel HTTPS sambil `npm start` tetap berjalan:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Pakai URL `https://...trycloudflare.com` yang muncul untuk dibuka di HP.
Kamera dan GPS akan berfungsi normal.

---

## Kembali ke produksi

Hapus `.env.local`, atau kosongkan nilai `REACT_APP_SCRIPT_URL`, lalu jalankan
ulang `npm start`.

Deployment di Vercel **tidak terpengaruh** file ini — `.env.local` tidak ikut
ter-commit, jadi produksi tetap memakai URL default di `src/config/constants.js`.

---

## Kalau ada masalah

| Gejala | Penyebab biasanya |
|---|---|
| `Gagal koneksi server.` saat login | URL di `.env.local` salah, atau akses deployment belum diset "Siapa saja" |
| Perubahan `.env.local` tidak berpengaruh | `npm start` belum di-restart |
| Tombol kamera tidak merespons | Dibuka lewat HTTP dari IP LAN — pakai tunnel HTTPS |
| Login lambat sekali | Wajar untuk data sebanyak ini — lihat `DIAGNOSA-LAMBAT.md`, dan pangkas `dbabsen` di salinan uji |
| Terlempar ke login terus | `REACT_APP_TIMEOUT_MINUTES` belum diisi |
