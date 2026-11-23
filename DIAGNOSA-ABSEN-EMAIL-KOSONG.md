# Diagnosa: Tab ABSEN-EMAIL beda dengan GSheet (semua 'O' / kosong)

Kejadian: **24 Nov 2026**, periode **21 Okt – 20 Nov 2026**, file `DB_ABSEN_SEPT`.
Status: **sudah diperbaiki** (lihat bagian 5). Dokumen ini dibuat supaya kasus serupa cepat terdeteksi.

---

## 1. Gejala

- Tab **ABSEN-EMAIL** di aplikasi: kolom ABSEN/TELAT 21 Okt dst. tampil blok abu-abu (kosong) untuk hampir semua karyawan,
  dan merah untuk karyawan bernama merah.
- Data mesin ada (`db1-absen` penuh), tapi hasil di sheet `ABSENSI` dan `ABSENSI-email` tidak sesuai.

## 2. Cara kerja (alur data) — wajib dipahami

```
Aplikasi (Tabel Data DB_FIX)
   │  sinkron (SinkronGsheet.gs, bagian tulis db1-absen, baris ~460-500)
   ▼
db1-absen        kolom dikenal: ID, PAYROLL, NAMA, TANGGAL, MASUK, PULANG, ID2(=SIMBOL), DEPT, ...
   │  rumus DB1: =IFERROR(VLOOKUP($C$5:$C$517&$J$1:$BH$1; 'db1-absen'!$A$2:$Y$97924; <KOLOM>; FALSE);"")
   ▼
DB1              (matriks karyawan x tanggal, isi = simbol)
   │  ABSENSI!O..: =IF(F9="";"";VLOOKUP(F9;'DB1'!$C$5:$J$485;8;FALSE))   (ABSEN)
   │  ABSENSI!P..: ... VLOOKUP ke 'DB2' (TELAT, sumber: sheet db2-telat, diisi MANUAL)
   ▼
ABSENSI
   │  _sgPindahAbsensi_ (salin NILAI; sel kosong karyawan → 'O'; nama merah → 'A')
   ▼
ABSENSI-email  ──►  Tab ABSEN-EMAIL (aplikasi, hanya MEMBACA sheet ini apa adanya)
```

Kunci lookup: `PAYROLL & nomor-seri-tanggal` (contoh `G007046316` = G0070 + 46316 = 21/10/2026).

**Aturan emas:** tab ABSEN-EMAIL tidak menghitung apa pun. Kalau beda dengan GSheet → masalah ada di sheet,
bukan di aplikasi. Cek dari hulu ke hilir: `db1-absen` → `DB1` → `ABSENSI` → `ABSENSI-email`.

## 3. Akar masalah

1. Rumus `DB1` mengambil **kolom ke-23 `db1-absen` = ID4**.
2. Kolom **ID4** (dan `kode`, `FORM`, `FORM2`, `LATE`, `Alpa-Telat`, `SISA CUTI` … `JABATAN`) di `db1-absen`
   **kosong di semua baris** (rumusnya hilang; sudah hilang sebelum 3 Nov 2026).
3. Akibatnya `DB1` kosong → `ABSENSI` kosong → sinkron mengisi sel kosong dengan **'O'** → tab ABSEN-EMAIL abu-abu.

Mengapa rumus bisa hilang: `SinkronGsheet.gs` (baris ~473-499) menimpa SELURUH baris data dengan nilai
(`setValues`), termasuk kolom yang tidak dikenalnya (jadi `''`). Rumus hanya dipulihkan dari **rumus baris 2**
(`contohRumus`). Begitu baris 2 pernah kosong sekali, rumus hilang permanen dan sinkron berikutnya tidak bisa memulihkannya.

## 4. Cara deteksi cepat (5 menit)

Urutan cek, berhenti di langkah pertama yang salah:

| # | Cek | Cara | Normal | Rusak |
|---|-----|------|--------|-------|
| 1 | `db1-absen` terisi? | Buka sheet, kolom **ID2 (O)** & **SIMBOL (AJ)** | terisi H/A/So/… | kosong → sinkron aplikasi gagal |
| 2 | Kolom rumus `db1-absen` | Kolom **ID4 (W)** baris 2 | (lihat catatan) | kosong |
| 3 | `DB1` terisi? | Sheet `DB1` area tanggal (kolom J…) | simbol per hari | kosong |
| 4 | Rumus `DB1` | Klik `DB1!J5`, lihat nomor kolom lookup | menunjuk kolom yang BERISI | menunjuk kolom kosong |
| 5 | `ABSENSI` terisi? | Sheet `ABSENSI` kolom O dst. (teks bisa tersembunyi: warna isi = warna huruf, lihat warna biru dll.) | berwarna per simbol | polos |
| 6 | `ABSENSI-email` | Hitung porsi 'O' | <35% | >60% |
| 7 | Tab aplikasi | Klik **Muat ulang**, lihat jam "dibaca …" | baru | lama |

Skrip pembanding (Python, dari export file ke CSV/Excel):
- Bandingkan sel ABSEN `ABSENSI` (kolom +3) vs `ABSENSI-email` (offset 3 kolom: D→A).
- Hitung isi `db1-absen` per hari per kolom (ID2, ID4, SIMBOL). Kolom yang isinya 0 dari N baris = rumus/isian hilang.
- Tanda khas kasus ini: `ABSENSI` kosong 100% sedangkan `db1-absen` punya data untuk 31 hari.

> Catatan: `db1-absen` kini ditulis aplikasi ke kolom **ID2** dan **SIMBOL** (keduanya = simbol final).
> Kolom ID4 dulu rumus; setelah perbaikan 24 Nov 2026 `DB1` tidak lagi memakainya.

## 5. Perbaikan yang sudah dilakukan (24 Nov 2026)

1. Di sheet `DB1`: Cari & ganti (dalam formula, sheet ini saja) `97924;23;FALSE` → `97924;15;FALSE`
   (**16.236 sel**). Lookup kini ke kolom **ID2**.
2. Menu **Sinkron Absensi → Pindah ABSENSI → ABSENSI-email (semua baris)**.
3. Hasil: `ABSENSI-email` berisi H ≈5.900, O ≈2.650, A ≈1.570, I, T, NF, So, PC, C, DL, S, Si, TSo, EO
   (sama dengan sebaran `db1-absen`).

**Membatalkan:** `DB1` → Ctrl+H → cari `97924;15;FALSE` ganti `97924;23;FALSE`, centang "Telusuri juga dalam formula",
"Sheet ini", Ganti semua. (Perubahan rumus `DB1` memicu hitung ulang ±16 ribu sel; halaman bisa 1–2 menit tidak merespons.)

---

## 6. Jawaban: dari 3 hal yang perlu diketahui, mana yang perlu diperbaiki?

### 6.1 Kolom TELAT masih kosong → **perlu keputusan/perbaikan (data)**
- TELAT di `ABSENSI` diambil dari `DB2` → sheet **`db2-telat`**, yang diisi **manual** (isi saat ini masih data 21 Sep 2026).
- Perbaikan: isi `db2-telat` dengan data periode berjalan (paste dari Excel seperti dulu), **atau** (disarankan)
  minta aplikasi menulis `db2-telat` otomatis seperti `db1-absen`. Itu pekerjaan baru (belum dibuat).
- Sampai itu dilakukan, TELAT periode ini tetap kosong.

### 6.2 Nama merah otomatis 'A' → **bukan bug, tapi perlu dicek isinya**
- Aturan bawaan `_sgPindahAbsensi_`: nama (kolom NAMA `ABSENSI`) berlatar merah = RESIGN/OUT → semua ABSEN diisi 'A',
  HARI KERJA dikosongkan. Saat ini ±43 baris.
- Yang perlu dicek manual: apakah semua yang merah memang sudah resign/out. Yang masih aktif → hapus warna merah di `ABSENSI`.
- Tidak perlu perubahan kode.

### 6.3 Kode sinkron menghapus kolom rumus → **SUDAH DIPERBAIKI di kode (24 Nov 2026)**
- Lokasi: `apps-script/SinkronGsheet.gs` (`_sgTulis_`).
- Perbaikan: sinkron kini menulis HANYA kolom yang dikenal (per deret kolom berurutan); kolom tak dikenal
  (T–Y, AA–AI, AK–AV, dst.) tidak disentuh lagi. Diuji dengan simulasi sheet: hanya PAYROLL, TANGGAL, ID2, DEPT, SIMBOL yang ditulis.
- **Belum aktif sampai di-deploy:** tempel ulang isi `SinkronGsheet.gs` ke project Apps Script `absen`, lalu
  Terapkan → Kelola deployment → edit → **Versi baru**. (Versi aplikasi tidak dinaikkan.)

---

## 7. Antisipasi supaya tidak terulang

Urut dari paling murah/penting:

1. **Perbaiki kode sinkron (6.3)** — tulis per kolom dikenal saja. Ini menutup penyebab langsung. ✅ *Selesai di kode (perlu deploy).*
2. **Pakai kolom berdasar nama header, bukan nomor** — di `DB1` ganti angka `15` dengan
   `MATCH("ID2";'db1-absen'!$A$1:$Y$1;0)` (atau `SIMBOL`). Jadi geser kolom tidak merusak lookup.
3. **Pemeriksa otomatis setelah sinkron** ✅ *Selesai di kode (perlu deploy).* `_sgPindahAbsensi_` menghitung porsi sel ABSEN
   karyawan yang kosong (diisi 'O'). Bila >60% (`SG_BATAS_O`; normal ±20-35%) status sinkron berisi
   `PERINGATAN: NN% sel ABSEN kosong di ABSENSI … cek DB1 …` — tampil di pesan status tab Sinkron GSheet, riwayat sinkron,
   dan toast di GSheet. Sinkron tetap dianggap berhasil (`ok`), peringatan ada di `st.peringatan`.
   (Banner kuning di tab ABSEN-EMAIL belum dibuat — opsional.)
4. **Backup rumus** — simpan di sheet `TEMPLATE-RUMUS` (nilai teks rumus baris 2 tiap sheet: `db1-absen`, `DB1`, `DB2`,
   `ABSENSI`). Revisi Drive hanya menyimpan ±sebulan dan tidak bisa mengunduh versi lama via konektor.
5. **Beri nama versi** (File → Histori versi → Beri nama) sebelum mengubah rumus besar / ganti periode.
6. **Awal periode baru** — jalankan "Rule Harian/Awal Periode" di bagian 8, bagian cek cepat.
7. **Mulai periode baru dari file/sheet yang sehat** — saat membuat `DB_ABSEN_<BULAN>` baru, salin dari file bulan lalu
   (bukan membuat kosong) lalu jalankan cek di tabel 4.

---

## 8. RULE — prosedur khusus (SOP) bila tab ABSEN-EMAIL tidak sesuai GSheet

> Rule: **diagnosa dulu, ubah belakangan. Jangan menjalankan "Sinkron Absensi" berulang sebelum `ABSENSI` terisi
> (hasilnya tetap 'O').** Jangan menimpa rumus tanpa nama-versi/backup.

**A. Persiapan (1 menit)**
1. Catat jam tab "dibaca …". Klik **Muat ulang**. Bila sudah sama dengan GSheet → selesai (cache).
2. File → Histori versi → **Beri nama versi** "sebelum perbaikan <tanggal>".

**B. Diagnosa (urut)**
1. `db1-absen`: ID2/SIMBOL terisi untuk semua hari periode? Tidak → jalankan **Sinkron Tabel Data** dari aplikasi
   (tab Sinkron GSheet / `/sinkron` di bot) dulu; berhenti di sini.
2. `db1-absen` kolom **yang dipakai rumus `DB1`** (lihat nomor kolom di `DB1!J5`) terisi? Tidak → lanjut C.
3. `DB1` terisi? `ABSENSI` terisi (warna per simbol)? Cari titik pertama yang kosong.
4. Cek header tanggal `DB1!J1:AS1` benar-benar **tanggal** (bukan teks) dan = periode `ABSENSI`.
5. Sinkron gagal? Lihat status sinkron: "Header tanggal beda …" / "Periode ABSENSI lebih lama …".

**C. Perbaikan**
1. Rumus hilang di `db1-absen`: pulihkan dari revisi/backup (`TEMPLATE-RUMUS`) ke **baris 2**, salin ke bawah
   (setelah itu sinkron berikutnya mempertahankannya). Jika tidak ada backup: arahkan `DB1` ke kolom yang berisi
   (cara 24 Nov 2026: `;23;` → `;15;`, Cari-ganti hanya di sheet `DB1`).
2. Tunggu hitung ulang selesai (DB1 terisi simbol).
3. Jalankan **Sinkron Absensi → Pindah ABSENSI → ABSENSI-email (semua baris)** satu kali.

**D. Verifikasi (wajib)**
1. Ekspor/baca `ABSENSI-email`: sebaran simbol harus mirip `db1-absen` (H terbanyak, 'O' wajar ≈ hari libur; bukan 100% 'O').
2. Bandingkan 3 karyawan acak (tanggal, simbol) antara `db1-absen`, `ABSENSI-email`, dan tab aplikasi (Muat ulang).
3. Cek TELAT: bila kosong, lihat 6.1 (`db2-telat`).
4. Catat di bawah ini (riwayat kejadian).

**E. Jangan**
- Jangan mengubah kode aplikasi bila sheet-nya yang salah.
- Jangan menjalankan sinkron berulang saat `ABSENSI` kosong.
- Jangan Cari-ganti di "Semua sheet" — pilih **Sheet ini**.
- Jangan menekan "Pulihkan versi ini" (mengembalikan seluruh file, termasuk data hari ini).

---

## 9. Riwayat kejadian

| Tanggal | Periode | Penyebab | Perbaikan |
|---------|---------|----------|-----------|
| 24 Nov 2026 | 21 Okt – 20 Nov 2026 | Kolom ID4 `db1-absen` kosong (rumus hilang) → DB1/ABSENSI kosong → 'O' | `DB1` lookup `;23;` → `;15;` (ID2), sinkron ulang ABSENSI-email; kode sinkron diperbaiki + peringatan otomatis |
