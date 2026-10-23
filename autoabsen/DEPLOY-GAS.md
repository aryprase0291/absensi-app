# Deploy Apps Script dari Telegram (`/deploy`)

File `.gs` di folder `apps-script/` repo ini dikirim ke project Apps Script
`absen`, disimpan sebagai **versi baru**, lalu deployment **produksi**
dipindah ke versi itu. URL `/exec` tidak berubah, jadi frontend tidak perlu
diubah.

```
GitHub (main) ──/deploy──► bot AutoAbsen (PC Att) ──Apps Script API──► project `absen`
                              cek → tombol 🚀 Deploy / 💾 Simpan saja
```

## Perintah

| Perintah | Isi |
|---|---|
| `/deploy` | Bandingkan repo vs Apps Script, lalu muncul tombol |
| 🚀 Deploy versi baru | simpan isi + buat versi + produksi pindah ke versi itu |
| 💾 Simpan saja | hanya isi editor (HEAD); uji lewat URL `/dev`, produksi tetap |
| `/deploy status` | versi produksi sekarang + deploy terakhir |
| `/deploy balik` | produksi kembali ke versi sebelum deploy terakhir |
| `/deploy nama Code=Kode` | file repo `Code.gs` dikirim sebagai `Kode` di Apps Script |

Hanya **admin bot** (`/admin`), dan hanya di grup utama atau chat pribadi.

## Pengaman

- Yang dikirim adalah commit yang **ditinjau** saat `/deploy` (rencana berlaku 30 menit).
- File yang hanya ada di Apps Script **tidak dihapus**: `SendTelegram*.gs`
  (berisi token, sengaja tidak di repo), `appsscript.json`, file HTML, dll.
- **Ditolak** kalau gabungan file punya `const`/`let`/`class` dengan nama sama
  di dua file. Itu SyntaxError yang mematikan seluruh project, dan biasanya
  muncul karena nama file beda (repo `Code.gs`, Apps Script `Kode`). Atasi
  dengan `/deploy nama Code=Kode`.
- File yang **disunting langsung di editor** sejak deploy terakhir ditandai ⚠️.
  Tombolnya berubah jadi "Timpa & deploy" supaya tidak ada yang hilang tanpa sadar.
- Isi Apps Script dibaca ulang tepat sebelum ditulis. Kalau ada yang berubah
  sejak dicek, deploy dibatalkan.
- Isi lama disimpan ke `D:\AutoAbsen\_cadangan\gas\<waktu>.json` (30 terakhir).

## Setup sekali (±10 menit, di PC Att)

1. **Nyalakan Apps Script API** untuk akun pemilik project `absen`:
   https://script.google.com/home/usersettings → *Google Apps Script API* → On.
2. **Google Cloud Console** (https://console.cloud.google.com), project apa saja
   milik akun yang sama, atau buat baru:
   1. *APIs & Services → Library* → aktifkan **Apps Script API**.
   2. *OAuth consent screen*: untuk akun Workspace jpt.co.id pilih **Internal**.
      Untuk akun gmail pilih *External* lalu **Publish app** ("In production").
      Status *Testing* membuat token kedaluwarsa tiap 7 hari.
   3. *Credentials → Create credentials → OAuth client ID → Desktop app* →
      **Download JSON**, simpan di PC Att, mis. `D:\AutoAbsen\client_secret.json`.
3. Di PC Att (PowerShell biasa, tidak perlu admin):
   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\deploy_gas.ps1 -Setel
   ```
   - Tempel path file JSON tadi.
   - Browser terbuka: **login dengan akun pemilik project `absen`**, lalu izinkan.
   - Tempel **Script ID** (editor Apps Script → ⚙️ Setelan project → ID Skrip).
   - Skrip menampilkan daftar deployment dan menandai yang PRODUKSI
     (`AKfycbzUH1Q7…`, sama dengan URL di `src/config/constants.js`).
4. Hapus `client_secret.json` dari folder kalau sudah tidak perlu. Kredensial
   sudah disimpan terenkripsi (DPAPI) di `deploy_gas.dat`, dan hanya user
   Windows ini yang bisa membukanya.
5. Uji di Telegram: `/deploy`. Kalau muncul ⛔ nama ganda, jalankan
   `/deploy nama Code=Kode` (sesuaikan nama), lalu `/deploy` lagi.

## Alur kerja harian

1. Ubah `.gs` di repo (lewat Claude / VS Code), commit + push ke `main`.
2. Telegram: `/deploy` → baca daftar perubahannya → 🚀 Deploy.
3. Ada masalah? `/deploy balik`.

File baru di `apps-script/` (mis. `NotifKaryawan.gs`) otomatis ikut terkirim
sebagai file baru di Apps Script. File yang dihapus dari repo **tidak** ikut
terhapus di Apps Script. Hapus manual di editor kalau memang perlu.
