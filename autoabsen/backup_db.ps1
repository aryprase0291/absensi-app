# =====================================================================
#  backup_db.ps1  -  Backup database Att (\\192.168.1.60\att\*.mdb) ke zip
#     backup_db.ps1 -Sumber jadwal            (Task Scheduler AutoAbsen-Backup)
#     backup_db.ps1 -Sumber telegram -Peminta "Nama" -Chat <id>
#     backup_db.ps1                            (manual, selalu backup)
#  Pengaturan di backup.json (diubah dari bot: /backup). Alur:
#   1. Antre (tidak bentrok dengan download/impor).
#   2. Jadwal: dilewati bila database tidak berubah sejak backup terakhir.
#   3. Att ditutup dulu bila PC diam >= 5 menit (salinan bersih).
#   4. Salin .mdb (baca bersama), ulang bila file berubah saat disalin.
#   5. Cek isi salinan (Jet 32-bit: jumlah scan, karyawan, scan terakhir).
#   6. Zip -> <tujuan>\absen_yyyyMMdd_HHmm.zip, cocokkan isi zip.
#   7. Hapus backup lama: simpan N hari + 1 per bulan selama M bulan (min. 3 terbaru).
#   8. Laporan ke grup Telegram + riwayat Supabase (tugas "backup").
# =====================================================================
param([string]$Sumber = 'manual', [string]$Peminta = '', [string]$Chat = '', [switch]$Paksa)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'BACKUP'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$wajib = $Paksa -or ($Sumber -ne 'jadwal')
$siapa = if ($Peminta) { '👤 ' + (Html $Peminta) } elseif ($Sumber -eq 'jadwal') { '⏰ Jadwal otomatis' } else { '🖥 Manual di PC' }
function Kirim([string]$teks) {
    KirimTelegram $teks
    $k = KonfigTelegram
    if ($Chat -and $Chat -ne $k.Grup) { KirimTelegram $teks $Chat }
}
function SalinBerbagi([string]$dari, [string]$ke) {
    # Att/Jet bisa sedang membuka file -> baca dengan FileShare.ReadWrite|Delete
    $in = [IO.File]::Open($dari, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        $out = [IO.File]::Create($ke)
        try { $in.CopyTo($out, 4MB) } finally { $out.Dispose() }
    } finally { $in.Dispose() }
}
function CekMdb([string]$mdb) {
    $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path $ps32)) { $ps32 = 'powershell.exe' }
    try {
        $out = & $ps32 -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AA_Dasar 'cek_mdb.ps1') -Mdb $mdb 2>&1
        $json = @($out | ForEach-Object { [string]$_ } | Where-Object { $_ -like '{*' }) | Select-Object -Last 1
        if ($json) { return ($json | ConvertFrom-Json) }
        return [pscustomobject]@{ ok = $false; pesan = ('tanpa hasil: ' + (($out | Out-String).Trim())) }
    } catch { return [pscustomobject]@{ ok = $false; pesan = $_.Exception.Message } }
}
function TanggalZip($f) {
    if ($f.Name -match '^absen_(\d{8})_') { return [datetime]::ParseExact($Matches[1], 'yyyyMMdd', $null) }
    return $f.LastWriteTime.Date
}
function BersihkanLama($c) {
    $semua = @(DaftarZipBackup)                                    # terbaru dulu
    $lindungi = @($semua | Select-Object -First 3 | ForEach-Object Name)
    $batasHari = (Get-Date).Date.AddDays(-[int]$c.simpan_hari)
    $batasBulan = (Get-Date).Date.AddMonths(-[int]$c.simpan_bulan)
    $bulanAda = @{}; $hapus = @()
    foreach ($z in ($semua | Sort-Object Name)) {                   # terlama dulu -> backup pertama tiap bulan disimpan
        $d = TanggalZip $z; $kunci = $d.ToString('yyyyMM')
        if ($lindungi -contains $z.Name -or $d -ge $batasHari) { $bulanAda[$kunci] = $true; continue }
        if ($d -ge $batasBulan -and -not $bulanAda.ContainsKey($kunci)) { $bulanAda[$kunci] = $true; continue }
        $hapus += $z
    }
    $byte = 0
    foreach ($z in $hapus) {
        try { $byte += $z.Length; Remove-Item -LiteralPath $z.FullName -Force; Catat $T "hapus backup lama: $($z.Name)" | Out-Null }
        catch { Catat $T ("gagal hapus {0}: {1}" -f $z.Name, $_.Exception.Message) | Out-Null }
    }
    return [pscustomobject]@{ jumlah = $hapus.Count; byte = $byte }
}

$c = KonfigBackup
$antre = AmbilAntrean 5
if (-not $antre) {
    if ($Sumber -ne 'jadwal') { Kirim ("⏳ <b>Backup database</b> — menunggu pekerjaan lain selesai`n{0}" -f $siapa) }
    $antre = AmbilAntrean (45 * 60)
    if (-not $antre) {
        Kirim '❌ <b>Backup database</b> dibatalkan: antrean penuh lebih dari 45 menit.'
        CatatRiwayat @{ tugas = 'backup'; sumber = $Sumber; status = 'gagal'; ringkasan = 'Antrean penuh > 45 menit'; peminta = $Peminta }
        exit 1
    }
}
$mulai = Get-Date; $kerja = $null; $kode = 1
try {
    Catat $T ("=== Backup database | sumber {0} {1} ===" -f $Sumber, $Peminta)
    if ($Sumber -ne 'jadwal') { Kirim ("💾 <b>Backup database — dimulai</b>`n{0}" -f $siapa) }

    $folder = Split-Path $c.sumber -Parent; $pola = Split-Path $c.sumber -Leaf
    if (-not (Test-Path -LiteralPath $folder)) { throw "Folder sumber tidak bisa dibuka: $folder (PC 192.168.1.60 mati / share tidak terjangkau?)" }
    $file = @(Get-ChildItem -LiteralPath $folder -Filter $pola -File | Sort-Object Name)
    if ($file.Count -eq 0) { throw "Tidak ada file $pola di $folder" }
    $sidik = ($file | ForEach-Object { '{0}|{1}|{2}' -f $_.Name, $_.Length, $_.LastWriteTimeUtc.Ticks }) -join ';'
    $akhir = BacaBackupTerakhir
    $fAkhir = Join-Path $AA_Dasar 'backup_terakhir.json'

    if (-not $wajib -and $akhir -and $akhir.sidik -eq $sidik -and $akhir.file -and (Test-Path -LiteralPath ([string]$akhir.file))) {
        # tidak berubah: catat waktu cek saja
        $akhir | Add-Member -NotePropertyName dicek -NotePropertyValue (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Force
        $akhir | ConvertTo-Json -Depth 6 | Set-Content -Path $fAkhir -Encoding UTF8
        $msg = 'Database tidak berubah sejak backup terakhir ({0})' -f (Split-Path ([string]$akhir.file) -Leaf)
        Catat $T "Dilewati: $msg"
        Kirim ("ℹ️ <b>Backup database</b> — dilewati`n{0}`n<i>{1} · {2}</i>" -f (Html $msg), $siapa, (Get-Date -Format 'dd/MM HH:mm'))
        CatatRiwayat @{ tugas = 'backup'; sumber = $Sumber; status = 'dilewati'; ringkasan = $msg; peminta = $Peminta }
        $kode = 0
    } else {
        # ---- Att: tutup dulu bila PC diam, agar salinan bersih ----
        $infoAtt = @()
        if (AttJalan) {
            if ([AAWin]::DiamDetik() -ge 300) {
                if (TutupAtt $T) { $infoAtt += 'Att ditutup dulu (PC diam) agar salinan bersih'; Start-Sleep -Seconds 3 }
                else { $infoAtt += '⚠️ Att gagal ditutup — database disalin saat terbuka' }
            } else { $infoAtt += '⚠️ Att sedang dipakai di PC — database disalin saat terbuka' }
        }
        foreach ($f in $file) {
            if (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($f.FullName, '.ldb'))) {
                if (-not (AttJalan)) { $infoAtt += ('ℹ️ {0} masih dibuka di komputer lain (.ldb ada)' -f $f.Name) }
            }
        }

        # ---- tujuan & ruang disk ----
        New-Item -ItemType Directory -Force -Path $c.tujuan | Out-Null
        $total = [double]($file | Measure-Object Length -Sum).Sum
        $sisa = SisaDisk $c.tujuan
        if ($sisa -ge 0 -and $sisa -lt $total * 1.6) { throw ('Ruang disk tujuan kurang: sisa {0}, perlu ± {1}' -f (Ukuran $sisa), (Ukuran ($total * 1.6))) }
        Get-ChildItem -LiteralPath $c.tujuan -Directory -Filter '_proses_*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $c.tujuan -File -Filter '*.part' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        $cap = Get-Date -Format 'yyyyMMdd_HHmm'
        $kerja = Join-Path $c.tujuan "_proses_$cap"
        New-Item -ItemType Directory -Force -Path $kerja | Out-Null

        # ---- salin + cek isi ----
        $rinci = @(); $status = 'sukses'; $isi = @()
        foreach ($f in $file) {
            $ke = Join-Path $kerja $f.Name
            for ($coba = 1; $coba -le 3; $coba++) {
                $sebelum = (Get-Item -LiteralPath $f.FullName).LastWriteTimeUtc
                SalinBerbagi $f.FullName $ke
                $sesudah = Get-Item -LiteralPath $f.FullName
                if ($sesudah.LastWriteTimeUtc -eq $sebelum -and (Get-Item -LiteralPath $ke).Length -eq $sesudah.Length) { break }
                Catat $T ("{0} berubah saat disalin (percobaan {1})" -f $f.Name, $coba) | Out-Null
                if ($coba -eq 3) { throw "$($f.Name) terus berubah saat disalin (Att sedang menulis?). Coba lagi nanti." }
                Start-Sleep -Seconds 20
            }
            $uk = (Get-Item -LiteralPath $ke).Length
            $hash = (Get-FileHash -LiteralPath $ke -Algorithm SHA256).Hash
            $cek = CekMdb $ke
            Get-ChildItem -LiteralPath $kerja -File -Filter '*.ldb' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
            $rinci += [pscustomobject]@{ nama = $f.Name; ukuran = $uk; diubah = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'); sha256 = $hash; cek = $cek }
            $isi += ('📁 <b>{0}</b> · {1} · diubah {2:dd/MM HH:mm}' -f (Html $f.Name), (Ukuran $uk), $f.LastWriteTime)
            if ($cek.ok) {
                if ($null -ne $cek.scan) {
                    $r = '     🔎 {0} scan' -f (Angka $cek.scan)
                    if ($null -ne $cek.karyawan) { $r += (' · {0} karyawan' -f (Angka $cek.karyawan)) }
                    if ($cek.scan_terakhir) { $r += (' · terakhir {0:dd/MM HH:mm}' -f [datetime]::ParseExact([string]$cek.scan_terakhir, 'yyyy-MM-dd HH:mm:ss', $null)) }
                    $isi += $r
                } else { $isi += ('     🔎 Database terbuka normal ({0} tabel)' -f $cek.tabel) }
                Catat $T ("{0}: {1} byte, scan {2}, karyawan {3}, terakhir {4}" -f $f.Name, $uk, $cek.scan, $cek.karyawan, $cek.scan_terakhir) | Out-Null
            } else {
                $p = [string]$cek.pesan
                if ($p -match 'not registered|tidak terdaftar|provider') { $isi += ('     ℹ️ Cek isi dilewati: ' + (Html $p)) }
                else { $isi += ('     ⚠️ Cek isi GAGAL: ' + (Html $p)); $status = 'sebagian' }
                Catat $T ("{0}: cek isi gagal: {1}" -f $f.Name, $p) | Out-Null
            }
        }

        # ---- zip ----
        $nama = "absen_$cap.zip"
        if (Test-Path -LiteralPath (Join-Path $c.tujuan $nama)) { $nama = 'absen_{0}.zip' -f (Get-Date -Format 'yyyyMMdd_HHmmss') }
        $zip = Join-Path $c.tujuan $nama; $part = "$zip.part"
        [IO.Compression.ZipFile]::CreateFromDirectory($kerja, $part, [IO.Compression.CompressionLevel]::Optimal, $false)
        $za = [IO.Compression.ZipFile]::OpenRead($part)
        try {
            foreach ($r in $rinci) {
                $e = $za.GetEntry($r.nama)
                if (-not $e -or $e.Length -ne $r.ukuran) { throw "Isi zip tidak cocok untuk $($r.nama)" }
            }
        } finally { $za.Dispose() }
        Move-Item -LiteralPath $part -Destination $zip
        $ukZip = (Get-Item -LiteralPath $zip).Length
        Remove-Item -LiteralPath $kerja -Recurse -Force -ErrorAction SilentlyContinue; $kerja = $null
        Catat $T ("Zip: {0} ({1} byte)" -f $zip, $ukZip) | Out-Null

        # ---- bersihkan backup lama ----
        $b = BersihkanLama $c
        $semua = @(DaftarZipBackup)
        $totZip = ($semua | Measure-Object Length -Sum).Sum
        $sisa = SisaDisk $c.tujuan

        # ---- simpan status & laporan ----
        $info = [ordered]@{ waktu = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); file = $zip; ukuran_asli = $total; ukuran_zip = $ukZip; sidik = $sidik; status = $status; rinci = $rinci }
        $info | ConvertTo-Json -Depth 6 | Set-Content -Path $fAkhir -Encoding UTF8

        $detik = [int]((Get-Date) - $mulai).TotalSeconds
        $l = @(('{0} <b>Backup database absen</b>' -f $AA_Ikon[$status])) + $isi
        $l += ('🗜 Zip <b>{0}</b> → <code>{1}</code>' -f (Ukuran $ukZip), (Html $zip))
        foreach ($x in $infoAtt) { $l += (Html $x) }
        $l += ('🗄 {0} backup tersimpan ({1}){2}' -f $semua.Count, (Ukuran $totZip), $(if ($sisa -ge 0) { ' · sisa disk ' + (Ukuran $sisa) } else { '' }))
        if ($b.jumlah) { $l += ('🧹 {0} backup lama dihapus ({1})' -f $b.jumlah, (Ukuran $b.byte)) }
        $l += ''; $l += ('<i>{0} · {1} · {2} dtk</i>' -f $siapa, (Get-Date -Format 'dd/MM HH:mm'), (Angka $detik))
        Kirim ($l -join "`n")

        $ringkas = 'Backup {0} -> {1} ({2})' -f (($rinci | ForEach-Object nama) -join ', '), $nama, (Ukuran $ukZip)
        Catat $T ("Selesai: {0} — {1}" -f $status, $ringkas)
        $cek0 = $rinci[0].cek
        CatatRiwayat @{ tugas = 'backup'; sumber = $Sumber; status = $status; ringkasan = $ringkas; durasi_detik = $detik; peminta = $Peminta
                        detail = @{ backup = @{ nama = (($rinci | ForEach-Object nama) -join ', '); file = $zip; ukuran_asli = $total; ukuran_zip = $ukZip; scan = $cek0.scan; karyawan = $cek0.karyawan; scan_terakhir = $cek0.scan_terakhir; dihapus = $b.jumlah } } }
        $kode = if ($status -eq 'sukses') { 0 } else { 2 }
    }
}
catch {
    Catat $T ('GAGAL: ' + $_.Exception.Message)
    Kirim ("❌ <b>Backup database — gagal</b>`n{0}`n<i>{1} · {2}</i>" -f (Html $_.Exception.Message), $siapa, (Get-Date -Format 'dd/MM HH:mm'))
    CatatRiwayat @{ tugas = 'backup'; sumber = $Sumber; status = 'gagal'; ringkasan = $_.Exception.Message; peminta = $Peminta }
}
finally {
    if ($kerja) { Remove-Item -LiteralPath $kerja -Recurse -Force -ErrorAction SilentlyContinue }
    LepasAntrean $antre
}
exit $kode
