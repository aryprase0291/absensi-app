# AutoAbsen (D:\AutoAbsen)

Salinan skrip PowerShell yang berjalan di PC Att (ZKTeco Attendance
Management): bot Telegram, download mesin, impor ke web, backup database,
impor BTR, Sinkron GSheet, dan deploy Apps Script.

## Repo ↔ PC

```
GitHub  autoabsen/*.ps1 *.md  ──/perbarui──►  D:\AutoAbsen
GitHub  apps-script/*.gs      ──/deploy────►  Apps Script project `absen`
```

- **Sumber kebenaran = repo.** Ubah skrip di sini, commit + push ke `main`,
  lalu kirim `/perbarui` di grup Monitor absen (admin bot). Bot menunjukkan
  file yang berubah, lalu menyalin setelah tombol **Terapkan** ditekan.
- Yang disalin hanya `*.ps1` dan `*.md`. File rahasia (`*.dat`), konfigurasi
  (`telegram.json`, `btr.json`, `backup.json`, …), `log\`, dan `ekspor\`
  tidak pernah masuk repo (lihat `.gitignore`) dan tidak disentuh `/perbarui`.
- File yang diubah **langsung di PC** sejak sinkron terakhir ditandai ⚠️
  dan dilewati, kecuali dipilih "timpa". File lama disalin dulu ke
  `D:\AutoAbsen\_cadangan\perbarui_<waktu>\`.
- `bot_telegram.ps1` / `umum.ps1` berubah → bot menyala ulang sendiri.
- `.gitattributes` menyimpan file di folder ini byte-per-byte (BOM UTF-8
  wajib ada untuk PowerShell 5.1 karena skrip memuat emoji).

> ⚠️ Repo ini **public**. Skrip memuat IP internal mesin (192.168.x.x) dan
> anon key Supabase, yang memang sudah publik di aplikasi web. Jangan pernah
> menaruh token, password, atau kunci di file `.ps1`. Simpan lewat DPAPI
> (`SimpanDpapi`) seperti yang sudah dilakukan skrip-skrip ini.

## Perintah Telegram baru (24 Okt 2026)

| Perintah | Siapa | Isi |
|---|---|---|
| `/sinkron` | sesuai `/izin` | Sinkron GSheet: Tabel Data → `db1-absen` + Sinkron Absensi |
| `/sinkron status` | sesuai `/izin` | tujuan & hasil sinkron terakhir |
| `/sinkron kunci <kunci>` | admin, **chat pribadi** | simpan kunci bot sinkron |
| `/deploy` … | admin | lihat [DEPLOY-GAS.md](DEPLOY-GAS.md) |
| `/perbarui` | admin | samakan skrip PC dengan repo |

## Setup sekali

1. **Skrip baru masuk PC.** Sudah disalin langsung pada 24 Okt 2026.
   Berikutnya cukup `/perbarui`.
2. **Sinkron GSheet**: editor Apps Script `absen` → jalankan
   `SINKRON_BOT_KUNCI_BUAT` → salin kunci dari Log. Kirim ke bot lewat chat
   pribadi `/sinkron kunci <kunci>`, atau di PC jalankan
   `sinkron_gsheet.ps1 -Setel`.
3. **Deploy Apps Script**: ikuti [DEPLOY-GAS.md](DEPLOY-GAS.md).
