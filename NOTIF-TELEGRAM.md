# Perubahan Notifikasi Telegram — 12 Agustus 2026

File yang diubah ada di project Apps Script (bukan di repo ini, karena
`SendTelegram*.gs` masuk `.gitignore` — memuat bot token).

## 1. Jadwal Rekap

Dulu: pemicu berjalan tiap jam.
Sekarang: **tiap hari pukul 09:00 dan 17:00 WIB** (GMT+7).

Diterapkan lewat fungsi baru `setupJadwalRekapTelegram()` di
`SendTelegramForm.gs`. Fungsi ini menghapus pemicu lama untuk
`triggerTelegramUpdate` + `sendReportToTelegram`, lalu membuat 4 pemicu baru
(2 fungsi × 2 jam). Jalankan ulang fungsi ini kalau jadwal perlu diubah lagi —
cukup edit array `jamKirim`.

Pemicu aktif sekarang (7):

| Fungsi | Jadwal |
|---|---|
| `triggerTelegramUpdate` | 09:00 & 17:00 |
| `sendReportToTelegram`  | 09:00 & 17:00 |
| `cekBarisBaru`          | tiap menit (notif pengajuan baru) |
| `cekRemarkBaru`         | tiap menit (notif remark baru) |
| `syncTotalCuti`         | tidak diubah |

## 2. Rekap Approved — waktu & pelaku jelas

`SendTelegramForm.gs` → `triggerTelegramUpdate()`.

Sebelum:

```
▪️ BUDI
   └ 🗓 12/08/2026 s.d 13/08/2026 (Oleh: Andi)
```

Sesudah:

```
▪️ BUDI
   └ 🗓 12/08/2026 s.d 13/08/2026
      └ ✅ Approved: 12/08/2026 10:35 WIB
      └ 👤 Oleh: Andi
```

Waktu approval dibaca dari kolom **O** (`colWktApprove = 14`), nama approver
dari kolom **N** (`colApprover = 13`) — sesuai yang ditulis
`processApprovalLogic()` di `Kode.gs`.

Helper baru: `fmtTglJamTelegram(val)` → `dd/MM/yyyy HH:mm WIB`.

> Dinamai `fmtTglJamTelegram`, bukan `formatDateTimeFull`, karena nama itu
> sudah dipakai di `Kode.gs`. Semua file `.gs` berbagi satu global scope, jadi
> nama yang sama akan saling menimpa.

## 3. Notif Pengajuan Baru

`SendTelegramForm.gs` → `cekBarisBaru()` dan `notifikasiInputBaru()`.

```
📥 ADA PENGAJUAN BARU MASUK 📥

🔵 PENGAJUAN IJIN

👤 Nama: BUDI
📌 Tipe Pengajuan: IJIN
📅 Tanggal Pengajuan: 14/08/2026 s.d 15/08/2026 (08:00 - 17:00)
📝 Alasan: Acara keluarga
🕒 Waktu Input: 12/08/2026 22:05
```

Sumber kolom: G = alasan/catatan, I & J = tanggal, K & L = jam.

Helper baru:

- `buildPeriodeStr()` — gabung tanggal + jam, tampilkan satu tanggal saja kalau
  mulai dan selesai sama.
- `safeMd()` — buang karakter `* _ \` [ ]` dari teks user. Tanpa ini, alasan
  yang mengandung underscore bikin Telegram menolak pesan (parse_mode Markdown).

## 4. Notif Remark Baru

`SendTelegramRemark.gs` → `cekRemarkBaru()`.

```
🚨 PENGAJUAN REMARK BARU

👤 Nama: BUDI
📅 Tanggal Pengajuan: 10 Agu 2026
📌 Tipe Pengajuan: Koreksi Absen
📝 Alasan: Lupa absen pulang
🕒 Waktu Lapor: 12 Agu 2026 22:05
📊 Status: OPEN
```

Sumber kolom sheet `Remarks`: F = tanggal koreksi, G = kategori, H = pesan.

Helper baru: `formatTglSederhana()` dan `esc()` (escape `& < >`, karena file ini
pakai parse_mode HTML).

Footer rekap juga diperbarui: "dikirim otomatis setiap jam" → "dikirim setiap
hari pukul 09:00 & 17:00 WIB".

---

## Catatan yang belum dikerjakan

**`onEdit` masih dideklarasikan dua kali** — di `Kode.gs` (jaga sheet `dbabsen`)
dan `SendTelegramForm.gs` (jaga sheet `Absensi`). Karena `SendTelegramForm.gs`
diproses terakhir, `onEdit` di `Kode.gs` tidak pernah jalan. Ini isu lama yang
sudah dicatat di `DIAGNOSA-LAMBAT.md` dan belum diperbaiki.

**Bot token masih hardcoded** di baris 1 kedua file Telegram
(`BOT_TOKEN`, `TELEGRAM_TOKEN_REMARK`). Sebaiknya dipindah ke
`PropertiesService.getScriptProperties()` supaya file bisa ikut di-commit.
