# PAKSA UPDATE & "CUKUP REFRESH" (v1.0.17)

## 1. Kenapa HP karyawan masih memakai versi lama

### a. Versi yang dicek adalah versi BACKEND, bukan versi frontend di server

`cekVersi()` lama dipanggil dengan `data.version` dari `check_version`
(Apps Script). Artinya:

* Deploy **frontend saja** (upload folder `build/`) tidak pernah memicu
  layar update — backend masih melapor angka lama, jadi menurut aplikasi
  "sudah paling baru", padahal bundle di HP tertinggal.
* Layar update baru muncul setelah `Code.gs` ikut disalin ke Apps Script.
  Selama itu belum dilakukan, seluruh karyawan tetap di versi lama.

### b. Pengecekan hanya sekali, saat aplikasi dibuka

Karyawan yang membiarkan aplikasi terbuka seharian (kasus paling umum di
HP) tidak pernah mengecek ulang.

### c. Ada pintu keluar permanen

`localStorage['update_lewati']` membuat overlay tidak pernah muncul lagi
untuk versi tersebut — sekali ditekan "Lanjutkan dengan versi ini", HP itu
berhenti di versi lama selamanya.

### d. Sisa Service Worker / Cache Storage

Aplikasi ini tidak memakai Service Worker, tetapi HP yang pernah memuat
rilis lama bisa masih menyimpannya. Selama itu ada, **refresh tidak
menolong**: yang disajikan tetap `index.html` lama dari cache, yang
menunjuk bundle lama. Pembersihan cache dulu hanya terjadi di dalam
`performUpdate()`, yaitu setelah user menekan tombol — padahal justru
overlay-nya tidak pernah muncul (poin a).

---

## 2. Yang berlaku sekarang

### Sumber kebenaran: `update-manifest.json`

Berkas ini ikut ter-upload bersama `build/`, jadi isinya **selalu
mencerminkan versi frontend yang ada di server saat itu juga** — tidak
bergantung pada deploy Apps Script.

`src/utils/pembaruan.js` mengambilnya dengan `cache: 'no-store'` plus
penanda waktu `?t=…` supaya tidak mungkin terbaca dari cache:

```js
const { versi } = await ambilVersiFrontendServer();
if (bandingkanVersi(versi, FRONTEND_VERSION) > 0) → paksa update
```

### Kapan dicek

| Momen | Keterangan |
|---|---|
| Aplikasi dibuka | `useEffect` saat mount |
| Kembali ke tab / app | `visibilitychange` + `focus` |
| Halaman dipulihkan dari bfcache | `pageshow` (`persisted`) |

Ukuran berkas ±3 KB, jadi hemat kuota. Tidak ada polling berkala.

### Apa yang terjadi saat versi baru terdeteksi

1. Overlay "Update Tersedia!" muncul dan **tidak bisa ditutup**.
2. Hitung mundur **5 detik**, lalu otomatis:
   * `localStorage` & `sessionStorage` dibersihkan,
   * seluruh Service Worker di-`unregister()`,
   * seluruh Cache Storage dihapus,
   * `location.replace()` dengan `?v=<versi>&t=<waktu>`.
3. **Ditunda selama karyawan berada di layar form absen** (`view === 'form'`)
   supaya foto dan titik GPS yang sudah diisi tidak hilang. Overlay tetap
   menutupi layar; hitung mundur berjalan begitu keluar dari form.

### Rem darurat (anti putaran tanpa henti)

Kalau `update-manifest.json` sudah versi baru tetapi bundle di server
ternyata masih lama (upload belum lengkap), aplikasi akan memuat ulang
sendiri **maksimal 3 kali**, lalu berhenti dan menampilkan tombol
"Lanjutkan dengan versi ini" beserta penjelasan bahwa ini masalah server,
bukan HP karyawan. Sudah diuji: 3 kali muat ulang, `update_percobaan = 3`,
lalu berhenti.

`update_lewati` hanya dihormati setelah rem darurat aktif — bukan lagi
pintu keluar permanen.

### Supaya "cukup refresh" benar-benar cukup

1. **Pembersihan saat boot** (`src/index.js` → `bersihkanSisaCacheSaatBoot()`):
   setiap kali aplikasi dimuat, sisa Service Worker & Cache Storage dihapus.
   Kalau memang ditemukan sisa, halaman dimuat ulang **satu kali** (dijaga
   penanda `sessionStorage`, tidak mungkin berputar) supaya berkas benar-benar
   diambil dari server.
2. **Header cache** (`public/.htaccess`): `index.html` dan seluruh `.json`
   memakai `no-store`; berkas `/static/*` ber-hash disimpan selamanya. Blok
   `mod_expires` ditambahkan karena sebagian hosting cPanel memasang masa
   kedaluwarsa bawaan untuk HTML yang menimpa aturan di atas.

   Padanan untuk **Nginx** (bila hosting bukan Apache):

   ```nginx
   location = /index.html            { add_header Cache-Control "no-store, no-cache, must-revalidate"; }
   location ~* \.json$               { add_header Cache-Control "no-store, no-cache, must-revalidate"; }
   location ~* ^/static/.*\.(js|css)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
   ```

---

## 3. Catatan rilis pertama

Bundle yang sekarang ada di HP karyawan (**1.0.16**) belum memiliki logika
di atas — ia hanya mengenal versi backend. Jadi untuk rilis 1.0.17 ini:

1. Upload seluruh isi `build/` (termasuk `vendor/` dan `models/`), **dan**
2. Salin `apps-script/Code.gs` + `UpdateManifest.gs` ke Apps Script.

Langkah 2 yang memicu layar update pada bundle 1.0.16 sehingga semua HP
berpindah ke 1.0.17. **Setelah itu**, deploy frontend saja sudah cukup:
karyawan cukup membuka atau me-refresh aplikasi dan pembaruan berjalan
otomatis.

## 4. Efek samping yang perlu diketahui

`performUpdate()` membersihkan `localStorage` dan `sessionStorage`, jadi
karyawan **login ulang satu kali** setiap kali versi naik. Ini perilaku lama
yang dipertahankan: data master yang tersimpan dari bundle lama tidak boleh
dipakai bundle baru.
