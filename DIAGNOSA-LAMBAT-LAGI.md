# Diagnosa: Kenapa Login Lambat Lagi (21 Agustus 2026)

Kelanjutan dari `DIAGNOSA-LAMBAT.md` (12 Agu) dan `PERBAIKAN-LOGIN.md` (13 Agu).
File terkait: `apps-script/StatsIndex.gs`, `apps-script/Code.gs`.

---

## Kesimpulan singkat

Perbaikan 13 Agustus (indeks `dbabsen` di-cache) **berhenti bekerja sejak
18 Agustus**, bukan karena dibatalkan, tapi karena dua bug beruntun di
mekanisme cache-nya sendiri — keduanya jenis kegagalan yang **diam-diam**,
tidak muncul sebagai error di log:

1. **18–20 Agustus:** indeks melewati batas 100 KB per kunci cache
   (`cache.put()` satu kunci besar gagal tanpa exception).
2. **20–21 Agustus (hari ini):** setelah dipecah jadi beberapa kunci kecil,
   penyimpanannya memakai satu panggilan `cache.putAll()` — yang ternyata
   punya batas **gabungan seluruh potongan dalam satu panggilan, juga
   100 KB**. Karena index dipecah justru gara-gara totalnya sudah lebih dari
   itu, `putAll()` ini tetap gagal.

Akibatnya: sejak 18 Agustus, cache `dbabsen` **tidak pernah benar-benar
terisi**. Setiap login menyisir ulang seluruh sheet `dbabsen` (ribuan baris)
dari nol — persis kondisi sebelum perbaikan 13 Agustus dibuat, hanya
sekarang datanya sudah lebih besar. Ini kemungkinan besar penyebab utama
"lambat lagi".

Anda (atau sesi sebelumnya) sudah **mulai memperbaikinya hari ini** — ada
perubahan di `apps-script/StatsIndex.gs` yang belum di-commit ke git.

---

## Runtutan kejadian (dari git log + isi file)

| Tanggal | Commit | Yang terjadi |
|---|---|---|
| 13 Agu | `55df238` | Indeks `dbabsen` V1 dibuat + di-cache. Login jadi cepat, terukur 47.264 sel (dari 176.702). |
| 18 Agu | `f665836` | Indeks naik ke V3 — menambah `alpa_by_date`/`hadir_by_date` per NIK. Ukuran JSON ikut naik jauh. |
| 19 Agu | *(diketahui dari komentar kode)* | Terukur: 212 NIK → 109.536 byte, **lewat batas 100 KB per kunci**. `cache.put()` gagal diam-diam. Cache mati total sejak titik ini. |
| 20 Agu | `1398e3c` "fixed IDX_UJI" | Ditambahkan mekanisme pemecahan index jadi beberapa kunci (`_simpanIndeksTerpecah_`), disimpan lewat `cache.putAll()`. **Belum benar-benar memperbaiki** — lihat baris berikutnya. |
| 20–21 Agu | *(belum di-commit)* | `putAll()` ternyata punya batas 100 KB **gabungan semua value dalam satu panggilan** — bukan cuma per-key. Karena total potongan yang ditulis dalam satu `putAll()` sudah pasti >100 KB (itu sebabnya dipecah), penyimpanan tetap gagal. |
| 21 Agu (hari ini) | **belum di-commit** | `StatsIndex.gs` diubah: `putAll()` → loop `cache.put()` satu-satu per potongan. Ini **perbaikan yang benar** untuk akar masalah di atas. |

Cek `git status` sekarang menunjukkan `apps-script/StatsIndex.gs` berstatus
*modified, belum di-add*.

---

## Yang perlu dipastikan SEKARANG

1. **Cek apakah fix ini sudah ditempel di editor Apps Script dan sudah
   di-deploy.** Runtime produksi jalan dari kode yang ditempel manual di
   editor Apps Script (lihat cara kerja proyek ini di `PATCH-AUTH.md`),
   bukan otomatis dari file di repo. Kalau editor Apps Script masih pakai
   versi lama (`putAll()`), aplikasi **masih lambat** walau file lokal
   sudah benar.
2. **Setelah dipastikan ter-deploy**, jalankan `IDX_UJI()` di editor Apps
   Script. Log harus menunjukkan waktu **"panas" jauh lebih kecil** dari
   "dingin" (di tanggal 13 Agustus perbandingannya beberapa detik → puluhan
   milidetik). Kalau tidak, cache masih belum bekerja — periksa baris
   "Ukuran JSON" di log, siapa tahu sudah melewati batas lagi.
3. **Commit `apps-script/StatsIndex.gs`** setelah dikonfirmasi jalan,
   supaya perbaikannya tidak hilang dan tercatat di riwayat — kebiasaan
   proyek ini menyimpan histori lewat commit + `.md`.

Catatan kecil (tidak urgent): perubahan yang sama juga mengganti pembacaan
`cache.getAll()` (satu panggilan, banyak kunci) menjadi loop `cache.get()`
satu-satu. Batas 100 KB itu cuma berlaku untuk `put`/`putAll` (menulis),
bukan `get`/`getAll` (membaca) — jadi sisi baca ini sebenarnya tidak perlu
diubah, dan sekarang melakukan N kali round-trip ke Cache Service alih-alih
1 kali. Tidak salah, cuma sedikit boros. Bisa dikembalikan ke `getAll()`
kapan-kapan, tapi bukan prioritas dibanding memastikan sisi tulis
(`put`/`putAll`) sudah benar dan ter-deploy.

---

## Kontributor lain yang sudah diprediksi sendiri, dan sekarang kemungkinan mulai terasa

`PERBAIKAN-LOGIN.md` (13 Agustus) sudah menulis ini di bagian penutup:

> Yang **belum** disentuh dan akan jadi penghambat berikutnya kalau data
> terus tumbuh: `Absensi` (30.368 sel) dan `Remarks` (8.630 sel) masih
> disisir penuh tiap `hitungStats`.

Delapan hari terakhir menambahkan cukup banyak fitur yang membuat sheet
`Absensi` bertambah baris: absen online + geofence (`bb3461d`, `348b528`),
potong jatah ijin/cuti tipe lapor HRD (`f7dab88`), approval kadiv
(`7394bbb`, `c69ca80`). Sudah dicek langsung di `hitungStats()`
(`Code.gs:1788`): sheet `Absensi` dan `Remarks` **masih dibaca penuh, tanpa
cache**, di setiap login/buka dashboard — biayanya naik seiring jumlah
pengajuan/keluhan **semua orang**, sama persis pola `dbabsen` dulu. Kalau
fix cache di atas sudah jalan tapi login masih terasa berat, ini kandidat
berikutnya untuk diprofilkan (`PROFILE_SHEETS()` di `Profiler.gs`).

Pendekatannya perlu beda dari `dbabsen`: `Absensi`/`Remarks` berubah
**terus-menerus** (bukan cuma sekali per import), jadi TTL cache biasa
kurang pas. Yang lebih cocok: sheet rekap per-NIK yang diperbarui saat ada
penulisan baru (di `handleAbsen`, submit Remarks, dll), bukan disisir ulang
tiap kali dibaca — sama seperti saran "RekapStats" di `DIAGNOSA-LAMBAT.md`
poin #2 yang belum dikerjakan.

---

## Ringkasan tindakan

| # | Tindakan | Prioritas |
|---|---|---|
| 1 | Pastikan fix `putAll → put` di `StatsIndex.gs` sudah ditempel di editor Apps Script + di-deploy versi baru | **Segera** |
| 2 | Jalankan `IDX_UJI()`, konfirmasi "panas" jauh lebih cepat dari "dingin" | Segera, setelah #1 |
| 3 | Commit `apps-script/StatsIndex.gs` ke git | Setelah #2 terkonfirmasi |
| 4 | Profilkan `Absensi`/`Remarks` (`PROFILE_SHEETS()`), buat rekap ter-update-saat-tulis kalau memang jadi penghambat berikutnya | Jangka menengah |
| 5 | (Opsional, tidak urgent) kembalikan pembacaan chunk dari loop `get()` ke satu `getAll()` | Rendah |
