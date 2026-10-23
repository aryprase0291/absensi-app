# =====================================================================
#  download_att.ps1  -  Tarik transaksi absen dari 7 mesin lewat Att
#  Cara: tutup Att -> tulis Option.dat (AutoMonitor=1, waktu download =
#  sekarang + 3 menit) -> buka & login Att -> tunggu Att.log mencatat
#  "ReadAllGLogData ... Succeed" untuk tiap mesin.
#  (Att menulis ulang Option.dat sendiri, jadi jadwal bawaannya tidak
#   bisa diandalkan; yang dipakai cara yang teruji 7/7 tgl 15 Okt 10:55.)
#  Exit: 0 = 7/7, 2 = sebagian, 1 = gagal. Hasil: hasil_download.json
#  -Mesin "Romokalisari,Banyuwangi,Watudodol" : hanya mesin itu (dipakai /btr). Mesin lain
#   dinonaktifkan sementara di tabel Machines (mesin_att.ps1), Att ditutup setelah download,
#   lalu status Enabled dikembalikan. Sisa pembatasan yang tidak sempat dipulihkan
#   (mesin_enabled.json) selalu dipulihkan di awal download berikutnya.
# =====================================================================
param([int]$TungguMenit = 8, [string]$Mesin = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'DOWNLOAD'

function SetOption([string]$kunci, [string]$nilai, [string[]]$baris) {
    $ada = $false
    for ($i = 0; $i -lt $baris.Count; $i++) {
        if ($baris[$i] -match ('^' + [regex]::Escape($kunci) + '=')) { $baris[$i] = "$kunci=$nilai"; $ada = $true }
    }
    if (-not $ada) {
        $idx = [array]::IndexOf($baris, '[System]')
        $l = New-Object System.Collections.Generic.List[string]; $l.AddRange($baris); $l.Insert($idx + 1, "$kunci=$nilai"); $baris = $l.ToArray()
    }
    return ,$baris
}

$fStatusMesin = Join-Path $AA_Dasar 'mesin_enabled.json'
$mdbAtt = '\\192.168.1.60\att\{0}.MDB' -f (Get-Date).Year
function MesinAtt([string]$aksi, [string]$ip = '') {
    $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
    $a = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $AA_Dasar 'mesin_att.ps1'),'-Aksi',$aksi,'-Mdb',$mdbAtt,'-Simpan',$fStatusMesin)
    if ($ip) { $a += @('-IP', $ip) }
    $out = & $ps32 @a 2>&1
    $j = @($out | ForEach-Object { [string]$_ } | Where-Object { $_ -like '{*' }) | Select-Object -Last 1
    if (-not $j) { throw ("mesin_att $aksi gagal: " + (($out | Out-String).Trim())) }
    $r = $j | ConvertFrom-Json
    if (-not $r.ok) { throw ("mesin_att $aksi gagal: " + $r.pesan) }
    return $r
}
function PulihkanMesin {
    if (-not (Test-Path $fStatusMesin)) { return }
    try {
        if (AttJalan) { [void](TutupAtt $T); Start-Sleep -Seconds 3 }
        $r = MesinAtt 'pulihkan'
        Catat $T ('Mesin diaktifkan kembali: ' + (@($r.diubah) -join ', ')) | Out-Null
    } catch { Catat $T ('PERINGATAN: gagal memulihkan mesin: ' + $_.Exception.Message) | Out-Null }
}
$daftar = $AA_Mesin
if ($Mesin) {
    $pilih = @($Mesin -split '[,;]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $daftar = @($AA_Mesin | Where-Object { $pilih -contains $_.Nama })
    if ($daftar.Count -ne $pilih.Count) { throw ('Nama mesin tidak dikenal: ' + (@($pilih | Where-Object { @($AA_Mesin.Nama) -notcontains $_ }) -join ', ')) }
}
$batas3 = [bool]$Mesin

# status tahap untuk pesan progres Telegram (progres_download.json, dibaca induk)
$putus = @(); $Global:picuTeks = ''
function TP([string]$tahap, [hashtable]$x = @{}) {
    $x.tahap = $tahap; $x.mesin = @($daftar | ForEach-Object { $_.Nama }); $x.putus = @($putus); $x.picu = $Global:picuTeks
    TulisProgres 'download' $x
}
TP 'cek'

$mulai = Get-Date
try {
    Catat $T ('=== Download transaksi dari mesin ===' + $(if ($batas3) { ' (hanya: ' + (@($daftar.Nama) -join ', ') + ')' } else { '' }))
    # 1. cek jaringan (info saja)
    $putus = @()
    foreach ($m in $daftar) { if (-not (TesPort $m.IP)) { if (-not (TesPort $m.IP)) { $putus += $m.Nama } } }
    if ($putus.Count) { Catat $T ('Tidak terjangkau (port 4370): ' + ($putus -join ', ')) } else { Catat $T 'Semua mesin terjangkau (port 4370)' }

    # 2. tutup Att supaya Option.dat bisa ditulis & dibaca ulang
    TP 'tutup'
    if (AttJalan) { if (-not (TutupAtt $T)) { throw 'Att tidak bisa ditutup.' } ; Start-Sleep -Seconds 3 }

    # 2b. sisa pembatasan mesin dari proses sebelumnya -> pulihkan; lalu batasi bila diminta
    PulihkanMesin
    if ($batas3) {
        $r = MesinAtt 'batasi' (@($daftar.IP) -join ',')
        Catat $T ('Mesin dinonaktifkan sementara: ' + (@($r.diubah) -join ', '))
    }

    # 3. Option.dat
    TP 'siapkan'
    $optFile = Join-Path $AA_AttDir 'Option.dat'
    $enc = [Text.Encoding]::Default
    $teks = [IO.File]::ReadAllText($optFile, $enc)
    Copy-Item $optFile (Join-Path $AA_Dasar 'Option.dat.bak') -Force
    $baris = $teks -split "`r?`n"
    $picu = (Get-Date).AddMinutes(3)
    $jam = $picu.ToString('HH:mm')
    $baris = SetOption 'AutoMonitor' '1' $baris
    $baris = SetOption 'IsAutoMonitor' '1' $baris
    $baris = SetOption 'GetAllLogTimes' ("12:00;18:00;01:00;$jam") $baris
    [IO.File]::WriteAllText($optFile, ($baris -join "`r`n"), $enc)
    Catat $T "Option.dat: AutoMonitor=1, download dipicu jam $jam"

    # 4. buka & login
    $Global:picuTeks = $picu.ToString('HH:mm')
    TP 'login'
    $sejak = (Get-Date).AddSeconds(-5)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AA_Dasar 'buka_att.ps1') -TungguDetik 120
    if ($LASTEXITCODE -ne 0) { throw 'Att tidak bisa dibuka/login.' }
    if ((Get-Date) -gt $picu.AddSeconds(-20)) { Catat $T 'PERINGATAN: login selesai mepet dengan jam picu' }

    # 5. tunggu hasil di Att.log
    $batas = $picu.AddMinutes($TungguMenit - 3)
    TP 'tunggu'
    do {
        Start-Sleep -Seconds 5
        $h = HasilDownload $sejak
        $ok = @($daftar | Where-Object { $h.ContainsKey($_.IP) -and $h[$_.IP].Hasil -eq 'Succeed' })
        $gg = @($daftar | Where-Object { $h.ContainsKey($_.IP) -and $h[$_.IP].Hasil -ne 'Succeed' })
        if ((Get-Date) -ge $picu.AddSeconds(-5) -or $ok.Count) { TP 'tarik' @{ ok = @($ok | ForEach-Object { $_.Nama }); gagal = @($gg | ForEach-Object { $_.Nama }); terkunci = [bool]$AA_LogTerkunci } }
    } while ($ok.Count -lt $daftar.Count -and (Get-Date) -lt $batas)

    # Att.log terkunci / belum lengkap -> tutup Att lalu baca ulang (log pasti bisa dibaca setelah Att keluar).
    if ($ok.Count -lt $daftar.Count) {
        Catat $T ('Baru terbaca {0}/{1}{2} -> tutup Att lalu baca ulang Att.log' -f $ok.Count, $daftar.Count, $(if ($AA_LogTerkunci) { ' (log terkunci)' } else { '' }))
        [void](TutupAtt $T); Start-Sleep -Seconds 3
        $h = HasilDownload $sejak
    }

    # mode terbatas: Att ditutup lalu semua mesin diaktifkan kembali
    if ($batas3) {
        if (AttJalan) { [void](TutupAtt $T); Start-Sleep -Seconds 3; $h = HasilDownload $sejak }
        PulihkanMesin
        $lain = @($AA_Mesin | Where-Object { @($daftar.IP) -notcontains $_.IP -and $h.ContainsKey($_.IP) } | ForEach-Object { $_.Nama })
        if ($lain.Count) { Catat $T ('Catatan: Att tetap menarik mesin lain: ' + ($lain -join ', ')) }
    }

    $rinci = @(); $gagal = @()
    foreach ($m in $daftar) {
        if ($h.ContainsKey($m.IP) -and $h[$m.IP].Hasil -eq 'Succeed') { $rinci += ('{0} OK {1:HH:mm:ss}' -f $m.Nama, $h[$m.IP].Waktu) }
        elseif ($h.ContainsKey($m.IP)) { $rinci += ('{0} GAGAL ({1})' -f $m.Nama, $h[$m.IP].Hasil); $gagal += $m.Nama }
        else { $rinci += ('{0} tidak ada download' -f $m.Nama); $gagal += $m.Nama }
    }
    foreach ($r in $rinci) { Catat $T $r }
    $n = $daftar.Count - $gagal.Count
    $status = if ($gagal.Count -eq 0) { 'sukses' } elseif ($n -gt 0) { 'sebagian' } else { 'gagal' }
    Catat $T ("Download {0}/{1} mesin" -f $n, $daftar.Count)
    TP 'selesai' @{ ok = @($daftar | Where-Object { $gagal -notcontains $_.Nama } | ForEach-Object { $_.Nama }); gagal = @($gagal) }
    TulisHasil 'download' @{ status = $status; ok = $n; total = $daftar.Count; mesin = @($daftar.Nama); gagal = $gagal; putus = $putus; rinci = $rinci; detik = [int]((Get-Date) - $mulai).TotalSeconds }
    if ($status -eq 'sukses') { exit 0 } elseif ($status -eq 'sebagian') { exit 2 } else { exit 1 }
}
catch {
    Catat $T ('GAGAL: ' + $_.Exception.Message)
    if ($batas3) { PulihkanMesin }
    TP 'gagal' @{ pesan = $_.Exception.Message }
    TulisHasil 'download' @{ status = 'gagal'; pesan = $_.Exception.Message; detik = [int]((Get-Date) - $mulai).TotalSeconds }
    exit 1
}
