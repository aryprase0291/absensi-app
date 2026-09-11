# 1 Perangkat 1 Akun & Sesi Tunggal (v1.0.19)

Dokumen ini menjawab: **apa persisnya yang dikunci**, **apa yang masih bisa
lolos**, dan **urutan pemasangan yang tidak boleh ditukar**.

---

## 1. Dua celah yang berbeda — jangan tertukar

| | Celah | Yang menutupnya |
|---|---|---|
| **A** | **Titip absen.** Satu HP dipakai bergantian oleh beberapa karyawan. | Pengikatan `DeviceID → UserID` + **kuota** per perangkat. |
| **B** | **Akun dipinjamkan.** Satu akun dipakai dari dua HP sekaligus. | **Sesi tunggal**: login baru menerbitkan SessionID baru dan menggusur sesi lama. |

Keduanya sering disebut "1 device 1 login", padahal mekanismenya berbeda dan
bisa aktif sendiri-sendiri. Celah B **selalu** tertutup selama mode bukan
`off`. Celah A tergantung mode (lihat bagian 3).

---

## 2. Bagaimana perangkat dikenali

`src/utils/perangkat.js` membuat ID berbentuk:

```
a3f19c02-4b8e1d770f22a9c35de1
└──────┘ └──────────────────┘
  sidik          acak
```

**Kenapa dua bagian.**

* Bagian **acak** saja tidak jujur: ia hilang begitu karyawan membersihkan
  data situs, dan HP yang sama akan tampak sebagai HP baru setiap kali —
  penguncian jadi tidak ada artinya, tanpa satu pun jejak.
* Bagian **sidik** saja juga tidak cukup: dua HP dengan model, resolusi, dan
  zona waktu yang sama menghasilkan sidik identik. Di kantor yang membagikan
  HP dinas seragam, puluhan orang akan dianggap memakai satu perangkat.

Digabung, ID tetap unik per perangkat, **tetapi kalau localStorage
dibersihkan, ID barunya masih berawalan 8 karakter yang sama.** Panel Admin
menandainya:

> *3 perangkat memiliki sidik yang sama (a3f19c02). Kemungkinan satu HP yang
> data situsnya dibersihkan berulang kali.*

Sidiknya dihitung dari properti yang memang dipublikasikan browser (user
agent, platform, ukuran layar, jumlah inti, zona waktu). **Tidak ada** canvas
atau WebGL fingerprinting, dan tidak ada pembacaan daftar font — sengaja
tidak lebih tajam dari yang dibutuhkan.

### Yang masih bisa lolos, dengan jujur

* Ganti HP + akun yang sama → terdeteksi sebagai perangkat baru (ditandai).
* Bersihkan data situs → ID baru, tapi awalan sidik tetap sama → terlihat.
* Mode penyamaran / ganti browser → ID baru **dan** kemungkinan sidik
  berbeda. Ini yang paling sulit dilihat. Penangkalnya bukan di sini,
  melainkan pencocokan wajah (lihat `WAJAH-COCOK.md`).

---

## 3. Tiga mode

Disimpan di Script Properties `DEVICE_MODE`, diubah dari **Panel Admin →
Perangkat & sesi login**.

| Mode | Login diblokir? | Untuk kapan |
|---|---|---|
| `tandai` **(baku)** | Tidak pernah | Bulan pertama. Semua pelanggaran dicatat, tidak ada yang terhalang absen. |
| `ketat` | Ya, bila kuota perangkat penuh dan akunnya asing | Setelah daftar perangkat terlihat wajar |
| `off` | — | Fitur mati total |

Perangkat ber-status **diblokir** ditolak pada semua mode kecuali `off`. Itu
tuas admin yang tetap punya gigi selagi mode masih `tandai`.

> **Jangan menyalakan `ketat` di minggu pertama.** Selama semua orang belum
> login sekali pun, sheet perangkat masih kosong; menyalakan `ketat` lebih
> awal tidak menambah keamanan apa pun dan hanya menyiapkan antrean keluhan
> dari karyawan yang kebetulan baru ganti HP.

---

## 4. Kuota untuk HP milik PIC

Permintaan aslinya: PIC mengabsenkan timnya dari satu HP. Solusinya bukan
mengecualikan orangnya, melainkan **menaikkan kuota perangkatnya**.

Panel Admin → Perangkat → cari HP itu → ubah **Kuota akun pada perangkat
ini** → Simpan.

Kenapa kuota melekat pada **perangkat**, bukan pada role PIC:

* Kalau melekat pada role, PIC bisa mengabsenkan timnya dari HP mana pun,
  termasuk HP pribadinya di rumah. Yang ingin diizinkan adalah *HP itu*, di
  tangan orang itu — bukan status jabatannya.
* Batasnya jadi terlihat angka: kuota 6 berarti maksimal 6 akun, dan akun
  ke-7 muncul sebagai pelanggaran. Role tidak punya angka.

Akun yang terikat melebihi kuota tetap tercatat dan ditandai kuning pada
kartu perangkatnya, walau mode masih `tandai`.

---

## 5. Sesi tunggal — dan kenapa disimpan di Script Properties

Token login sekarang membawa `SessionID`. Pemeriksaannya berjalan di
`authorizeRequest()`, artinya **pada setiap request**.

Menaruh daftar sesi di sheet berarti menambah ratusan sel pada tiap
pemanggilan API — persis jenis biaya yang susah payah dipangkas di 1.0.14
(`PERBAIKAN-LOGIN.md`). Karena itu:

* **Script Properties** = sumber kebenaran. Satu pembacaan kunci, murah.
* Sheet **`SesiAktif`** = cermin untuk dibaca admin. Ditulis saat login,
  **tidak pernah dibaca di jalur panas.**

Konsekuensi yang perlu diketahui: tanda tangan token yang sah **tidak
cukup**. Token lama tetap sah sampai 12 jam meski pemiliknya sudah login di
HP lain — yang menentukan mana yang berlaku adalah SessionID.

### Token tanpa SessionID

Bundle < 1.0.19 menerbitkan token tanpa `s`. Token semacam itu diperlakukan
sebagai **sesi habis**, bukan diloloskan. `fetchApi` di App.js akan
membersihkan sesi dan melempar ke login — dan login itulah yang mendaftarkan
perangkatnya. Ini perilaku yang diinginkan, bukan bug.

---

## 6. Sheet yang dibuat

Keempatnya dibuat otomatis dan **disembunyikan** (`hideSheet`).

| Sheet | Isi | Satu baris per |
|---|---|---|
| `Devices` | label, kuota, status, platform, kapan terakhir dipakai | perangkat |
| `DeviceUser` | ikatan akun ke perangkat + jumlah login | pasangan perangkat–akun |
| `SesiAktif` | sesi yang sedang berlaku (cermin) | karyawan |
| `DeviceAudit` | kejadian: login ditandai, absen dari perangkat asing, tindakan admin | kejadian |

`DeviceAudit` dipangkas otomatis di angka ~4.000 baris. Tanpa itu, sheet ini
tumbuh tiap hari dan membuat layar admin makin lambat tiap bulan.

---

## 7. Urutan pemasangan — jangan ditukar

**Frontend dulu, backend belakangan.** Backend 1.0.19 menaikkan
`APP_VERSION`, dan kenaikan itulah yang memunculkan layar "Update Tersedia".
Kalau backend lebih dulu sementara berkas frontend baru belum ter-upload, HP
karyawan akan memuat ulang, mendapat bundle lama lagi, dan terjebak di layar
update yang tidak pernah selesai.

1. `npm run build` → upload **seluruh isi `build/`** (termasuk `build/models/`
   dan `build/vendor/`, serta `build/.htaccess`).
2. Di editor Apps Script: tempel `Devices.gs` dan `FaceProfile.gs` sebagai
   file baru, lalu perbarui `Auth.gs`, `Code.gs`, dan `UpdateManifest.gs`.
3. Jalankan **`SETUP_DEVICE_LOCK()`** sekali. Log harus menyebut mode
   yang berlaku.
4. **Deploy › Kelola deployment › ikon pensil › Versi baru › Deploy.**
   Pakai deployment yang **sudah ada** supaya URL tidak berubah.

> Menyimpan kode di editor **tidak** mengubah apa pun bagi user. Web App
> menjalankan versi yang di-*deploy*, bukan yang tersimpan. Jadi langkah 2–3
> aman dikerjakan kapan saja.

Hindari jam masuk dan jam pulang: saat deploy, semua karyawan akan diminta
login ulang satu kali.

### Opsional: mulai pendaftaran perangkat serentak

`SETUP_CABUT_SEMUA_SESI()` mencabut semua sesi sekaligus. Berguna kalau Anda
ingin seluruh karyawan mendaftarkan perangkatnya pada hari yang sama —
misalnya sebelum menyalakan mode `ketat`.

---

## 8. Rollback

**Deploy › Kelola deployment › pensil › pilih versi sebelumnya › Deploy.**
Backend kembali seperti semula dalam hitungan detik. Sheet perangkat boleh
ditinggal apa adanya; backend lama tidak menyentuhnya.

Frontend tidak perlu di-rollback: bundle 1.0.19 mengirim field `deviceId`
yang akan diabaikan begitu saja oleh backend lama.

Kalau yang bermasalah hanya aturannya (bukan kodenya), **jangan rollback** —
cukup ubah mode ke `off` dari Panel Admin. Efeknya seketika, tanpa deploy.

---

## 9. Uji setelah deploy

| Uji | Harapan |
|---|---|
| Login karyawan biasa di HP-nya | Berhasil; muncul satu baris baru di `Devices` |
| Login akun yang sama di HP kedua | Berhasil; HP pertama mendapat pesan "Akun Anda baru saja dipakai login di perangkat lain" pada aksi berikutnya |
| Login akun B di HP milik akun A (mode `tandai`) | Berhasil, tapi muncul tanda kuning di kartu perangkat |
| Sama, setelah mode diubah ke `ketat` | Ditolak dengan pesan menyebut nama pemilik HP |
| Naikkan kuota HP itu jadi 2, ulangi | Berhasil, tanpa tanda |
| Blokir sebuah perangkat, lalu login dari situ | Ditolak: "Perangkat ini diblokir oleh admin" |
| Admin klik "Lepas" pada satu ikatan | Ikatan hilang **dan** karyawan itu ter-logout |

---

## 10. Yang belum ditutup

1. **Mode penyamaran / browser berbeda** menghasilkan ID *dan* sidik baru.
   Ini batas nyata dari pengenalan perangkat berbasis web; yang menutupnya
   adalah pencocokan wajah, bukan dokumen ini.
2. **Absen dari perangkat berbeda dengan saat login** hanya *ditandai*,
   tidak ditolak — sengaja, karena karyawan lapangan kadang berpindah
   jaringan dan memuat ulang aplikasi di tengah jalan.
3. **`DeviceAudit` tidak menampilkan absen yang sah.** Isinya hanya
   pelanggaran dan tindakan admin. Untuk melihat absen normal, tetap ke
   Riwayat.
