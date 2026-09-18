# Fase 2 — `dbabsen` pindah ke Postgres

Dua tujuan, dan keduanya berasal dari satu sebab yang sama: sheet
`dbabsen` berisi ribuan baris, dan setiap kali ada yang membacanya, ia
disisir dari nol.

1. **Import jauh lebih cepat.** Potongan file dikirim langsung ke
   Postgres, bukan lewat Apps Script yang menulisnya ke sheet.
2. **Pengambilan data mesin jauh lebih cepat.** Postgres yang menyaring
   per NIK; yang dikirim balik puluhan baris, bukan 6.700.

---

## Arahnya BERLAWANAN dengan Fase 1 — dan itu disengaja

| Tabel | Penulis | Cermin |
|---|---|---|
| `karyawan` (Fase 1) | sheet `Users` | Postgres |
| `db_absen` (Fase 2) | Postgres | sheet `dbabsen` |

Aturannya tidak berubah: **satu tabel, satu penulis**. Yang berubah cuma
siapa penulisnya.

> **Sejak sakelar dinyalakan, sheet `dbabsen` tidak boleh lagi diedit
> tangan.** Isinya ditimpa seluruhnya setiap kali Postgres berubah.
> Suntingan manual akan hilang tanpa peringatan.

---

## Yang sudah berdiri

### Postgres — `supabase/migrations/20260918120000_fase2_dbabsen.sql`

- Tabel `db_absen`, 18 kolom yang persis sama dengan kolom B..S sheet.
- Kunci `(kunci, tanggal)`, dengan `kunci` = `A:<No.Akun>` bila ada, dan
  `N:<NIK>` bila kolom No.Akun kosong. Ini meniru persis dua ruang kunci
  di `_importCommit` — tanpa itu, baris warisan era IMPORTRANGE tidak
  akan pernah bisa ditimpa dan menumpuk selamanya.
- Tabel sementara `db_absen_impor` + tiga RPC: `impor_dbabsen_potongan`,
  `impor_dbabsen_commit`, `impor_dbabsen_batal`.
- Ketiga mode (`upsert`, `periode`, `replace`) sudah **diuji langsung di
  project produksi** dengan data contoh, lalu datanya dibersihkan:
  - `upsert` memperbarui baris yang kuncinya sama, membiarkan sisanya;
  - baris warisan tanpa No.Akun tergantikan oleh baris ber-No.Akun yang
    NIK + tanggalnya sama;
  - `periode` membuang tanggal yang tidak ada di file **hanya** untuk
    akun yang ikut diimpor, dan tidak menyentuh akun lain.

### Edge Function `dbabsen` — sudah ter-deploy (versi 2)

| Aksi | Pemanggil | Gerbang |
|---|---|---|
| `impor_potongan` / `impor_commit` / `impor_batal` | browser admin | token, role `admin` |
| `riwayat` | Apps Script | rahasia sinkron |
| `statistik` | Apps Script | rahasia sinkron |
| `versi` / `semua` | Apps Script | rahasia sinkron |

`_bersama/token.ts` sekarang juga bisa **membaca** token, bukan hanya
menerbitkannya — itulah yang membuat browser bisa memanggil import
tanpa menumpang Apps Script.

`riwayat` sengaja **tidak** dipanggil browser langsung:
`handleGetDbAbsen` menggabungkan data mesin dengan absensi online dari
sheet `Absensi`, yang belum pindah. Yang diganti hanya penyisiran
sheet-nya.

### Apps Script

- `SupabaseSync.gs` — `SUPABASE_SEMAI_DBABSEN()`, `SUPABASE_UJI_DBABSEN()`,
  `SUPABASE_TARIK_DBABSEN()`, `SUPABASE_DBABSEN_NYALAKAN/MATIKAN()`,
  plus header `Authorization` untuk Edge Function baru.
- `Code.gs` — `handleGetDbAbsen` mengambil baris mesin dari Postgres,
  dalam **bentuk larik 19 kolom yang sama persis** dengan baris sheet,
  sehingga seluruh logika penggabungan di bawahnya tidak berubah
  sebaris pun.
- `StatsIndex.gs` — `getIndeksDbAbsen(periode, nik)`: kalau NIK
  disebutkan dan sakelarnya menyala, angkanya diambil dari Postgres dan
  seluruh mesin indeks (scan + potong 8 KB + buang revisi lama) dilewati.

Semuanya jatuh ke jalur lama kalau Supabase mati atau sakelarnya belum
menyala. Tidak ada satu pun yang melempar error ke karyawan.

---

## Jalur import — sudah pindah

`src/utils/imporDbAbsenSupabase.js` mengirim potongan langsung ke Edge
Function; `ImportJobContext.js` memilih jalurnya **sekali di awal tiap
kelompok**, bukan per potongan.

Tiga batas yang dijaga:

- Sheet tujuan selain `dbabsen` (mis. `shift`) tidak punya padanan di
  Postgres, jadi tetap lewat Apps Script.
- Kalau potongan **pertama** gagal, seluruh kelompok itu jatuh ke Apps
  Script dari awal. Kalau yang gagal potongan berikutnya, error dilempar
  apa adanya — berpindah jalur di tengah jalan akan memecah satu import
  ke dua penyimpanan, dan itu jauh lebih buruk daripada gagal
  terang-terangan.
- Ukuran potongan tetap 400 baris supaya perhitungan progres tidak
  berubah. Yang menghemat waktu bukan potongan yang lebih besar,
  melainkan hilangnya eksekusi Apps Script dan commit ke sheet di setiap
  potongan.

Balasan commit sengaja memakai **nama field yang sama persis** dengan
`_importCommit` di Apps Script (`barisDitambahkan`, `barisDiperbarui`,
`barisDitimpa`, `barisDipertahankan`, `periodeAwal`, `periodeAkhir`),
jadi layar hasil dan notifikasi tidak perlu tahu import lewat jalur yang
mana.

Pengulangan potongan aman di sini, tapi **alasannya berbeda** dengan
jalur lama. Di Apps Script yang membuatnya aman adalah pencatatan
`chunkTerakhir` di server. Di sini potongan hanya ditumpuk ke tabel
sementara dan baru disaring saat commit (`distinct on (kunci, tanggal)
order by urut desc`), jadi kiriman kembar menghasilkan hasil akhir yang
identik. Commit sendiri tidak pernah diulang.

---

## DUA sakelar, dan urutannya tidak boleh terbalik

| Sakelar | Di mana | Yang dinyalakan |
|---|---|---|
| `REACT_APP_SUPABASE_IMPOR=1` | build frontend | import menulis ke Postgres |
| `SUPABASE_DBABSEN` = `'1'` | Script Properties | pembacaan + cermin sheet |

**Import dulu, baru baca.** Kalau sakelar Apps Script dinyalakan lebih
dulu sementara import masih lewat Apps Script, urutannya jadi:

1. admin mengimpor → Apps Script menulis hasilnya ke **sheet**;
2. `SUPABASE_TARIK_DBABSEN` berjalan → menulis ulang sheet dari
   **Postgres**, yang belum tahu apa-apa soal import barusan;
3. hasil import hilang.

---

## Urutan pemasangan (JANGAN dilompati)

1. Tempel ulang `SupabaseSync.gs`, `Code.gs`, `StatsIndex.gs` ke editor,
   lalu Deploy → Versi baru.
2. **Simpan anon key**: jalankan `SUPABASE_SETUP_ANON()` sekali di editor,
   lalu `SUPABASE_UJI_ANON()` untuk membuktikannya. Nilainya sudah
   terisi di dalam fungsinya — tidak ada yang perlu disalin.

   Ini perlu karena Edge Function `dbabsen` di-deploy lewat API, dan di
   jalur itu `verify_jwt` menyala secara bawaan — berbeda dengan `login`,
   `sesi-terbaru` dan `sinkron-master` yang di-deploy dengan satpam itu
   dimatikan. Tanpa kunci ini, panggilan Apps Script ditolak Supabase di
   depan pintu dengan HTTP 401, sebelum kode kita sempat berjalan.

   Anon key bukan rahasia: ia memang dirancang untuk sisi klien dan sudah
   ikut terkirim ke setiap HP karyawan di dalam bundle aplikasi. Penjaga
   isinya tetap RLS dan `SINKRON_RAHASIA`.
3. **Nyalakan import Supabase**: build frontend dengan
   `REACT_APP_SUPABASE_IMPOR=1`, lalu impor satu file kecil dan buktikan
   barisnya masuk — `SUPABASE_UJI_ANON()` akan menyebut jumlah barisnya.
   Selama langkah ini, sheet masih diisi jalur lama, jadi tidak ada yang
   bisa hilang.
4. `SUPABASE_SEMAI_DBABSEN()` — sekali, manual. Menyalin isi sheet yang
   ada sekarang ke Postgres dengan mode `replace`, jadi aman diulang
   kalau gagal di tengah.
5. `SUPABASE_UJI_DBABSEN()` — membandingkan angka statistik 10 NIK
   tersibuk, versi sheet lawan versi Postgres. Ia mencetak selisihnya,
   bukan sekadar berkata gagal. **Harus `>>> BERHASIL` dulu.**
6. `SUPABASE_DBABSEN_NYALAKAN()`.
7. `SUPABASE_PASANG_TRIGGER()` — memasang ulang ketiganya, termasuk
   cermin `dbabsen` tiap 5 menit.

Mematikannya kembali: `SUPABASE_DBABSEN_MATIKAN()`. Satu properti, dan
seluruh pembacaan kembali ke sheet.

---

## Catatan biaya

- Cermin sheet menulis **seluruh** isi, bukan baris per baris. Terdengar
  boros, tapi dijaga sidik isi: selama `versi` menjawab jumlah baris dan
  stempel terbaru yang sama, tidak ada satu sel pun yang disentuh.
  Yang mengubah `dbabsen` hanya import — beberapa kali sehari.
- Statistik dihitung dengan perulangan di Edge Function, bukan SQL
  agregat. Untuk beberapa puluh baris selisihnya nol koma sekian detik,
  dan bentuknya bisa dibandingkan baris per baris dengan
  `_susunIndeksDbAbsen` di `StatsIndex.gs`. Angka ini dipakai payroll;
  bisa dibaca ulang lebih berharga daripada bisa dijalankan lebih cepat.
- `SIMBOL_HADIR` sekarang ada di **dua** tempat: `StatsIndex.gs` dan
  `functions/dbabsen/index.ts`. Kalau salah satu berubah, yang lain
  WAJIB ikut — kalau tidak, dashboard dan rekap berbeda angka tanpa ada
  yang error.
