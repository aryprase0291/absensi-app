# =====================================================================
#  cek_mesin.ps1  -  Pemantau mesin fingerprint & download Att (ZKTeco)
#  Lokasi : D:\AutoAbsen\cek_mesin.ps1
#
#  Mode:
#    -Mode cek       : (jalan 10 menit SEBELUM jadwal download)
#                      - tes koneksi TCP 4370 ke semua mesin (dengan ulang)
#                      - pastikan Att.exe sedang berjalan (dibuka kalau mati)
#    -Mode verifikasi : (jalan 20 menit SESUDAH jadwal download)
#                      - baca Att.log, pastikan tiap mesin tercatat
#                        "ReadAllGLogData ... Succeed" sejak jam jadwal
#
#  Hasil: D:\AutoAbsen\log\YYYY-MM-DD.log
#         D:\AutoAbsen\status_terakhir.txt
# =====================================================================
param(
    [ValidateSet('cek','verifikasi')]
    [string]$Mode = 'cek',
    [int]$MenitMundur = 40   # verifikasi: cari download sejak N menit lalu
)

$ErrorActionPreference = 'Continue'

# ---------- KONFIGURASI ----------
$AttExe  = 'C:\Program Files (x86)\Att\Att.exe'
$AttLog  = 'C:\Program Files (x86)\Att\Att.log'
$AttLog2 = 'C:\Program Files (x86)\Att\Att.log.TXT'   # log lama setelah rotasi
$Port    = 4370
$Ulang   = 3        # jumlah percobaan koneksi per mesin
$Jeda    = 10       # detik antar percobaan
$Mesin = @(
    @{ No=1; Nama='Office Kumai'; IP='192.168.1.201'  },
    @{ No=2; Nama='Resepsionis';  IP='192.168.1.246'  },
    @{ No=3; Nama='Depo Kumai';   IP='192.168.1.126'  },
    @{ No=4; Nama='Romokalisari'; IP='192.168.62.201' },
    @{ No=5; Nama='Banyuwangi';   IP='192.168.61.201' },
    @{ No=6; Nama='Brumbung';     IP='192.168.33.201' },
    @{ No=7; Nama='Watudodol';    IP='192.168.63.201' }
)
# ---------------------------------

# Log & status disimpan di folder yang sama dengan script (D:\AutoAbsen).
# Jangan taruh di Documents: bisa diblokir Windows Defender "Controlled Folder Access".
$Dasar  = Split-Path -Parent $MyInvocation.MyCommand.Path
$DirLog = Join-Path $Dasar 'log'
New-Item -ItemType Directory -Force -Path $DirLog -ErrorAction Stop | Out-Null
$FileLog    = Join-Path $DirLog ((Get-Date -Format 'yyyy-MM-dd') + '.log')
$FileStatus = Join-Path $Dasar 'status_terakhir.txt'

function Tulis([string]$teks) {
    $baris = '{0}  [{1}]  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mode.ToUpper(), $teks
    Add-Content -Path $FileLog -Value $baris -Encoding UTF8
    Write-Output $baris
}

function Tes-Port([string]$ip, [int]$port, [int]$timeoutMs = 3000) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $c.BeginConnect($ip, $port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) { return $false }
        $c.EndConnect($ar); return $true
    } catch { return $false } finally { $c.Close() }
}

# =====================================================================
if ($Mode -eq 'cek') {
    Tulis '=== Cek koneksi mesin sebelum download ==='
    $gagal = @()
    foreach ($m in $Mesin) {
        $ok = $false
        for ($i = 1; $i -le $Ulang; $i++) {
            if (Tes-Port $m.IP $Port) { $ok = $true; break }
            if ($i -lt $Ulang) { Start-Sleep -Seconds $Jeda }
        }
        if ($ok) { Tulis ("OK     #{0} {1,-13} {2}  (percobaan ke-{3})" -f $m.No, $m.Nama, $m.IP, $i) }
        else     { Tulis ("GAGAL  #{0} {1,-13} {2}  (tidak terjangkau {3}x)" -f $m.No, $m.Nama, $m.IP, $Ulang); $gagal += $m.Nama }
    }

    # Pastikan Att.exe berjalan (Auto Monitor di dalam Att yang melakukan download)
    $p = Get-Process -Name 'Att' -ErrorAction SilentlyContinue
    if (-not $p) {
        Tulis 'Att.exe tidak berjalan -> buka & login (buka_att.ps1)'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dasar 'buka_att.ps1')
        if ($LASTEXITCODE -eq 0) { Tulis 'Att.exe terbuka dan sudah login' }
        else { Tulis 'PERINGATAN: Att.exe gagal dibuka/login'; $gagal += 'Att.exe' }
    } else {
        Tulis ('Att.exe berjalan (PID {0})' -f $p[0].Id)
    }

    $ringkas = if ($gagal.Count -eq 0) { 'SEMUA MESIN TERJANGKAU' } else { 'BERMASALAH: ' + ($gagal -join ', ') }
    Tulis $ringkas
    Set-Content -Path $FileStatus -Encoding UTF8 -Value ("{0}  CEK  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $ringkas)
    exit ([int]($gagal.Count -gt 0))
}

# =====================================================================
if ($Mode -eq 'verifikasi') {
    $sejak = (Get-Date).AddMinutes(-$MenitMundur)
    Tulis ('=== Verifikasi download sejak {0:yyyy-MM-dd HH:mm} ===' -f $sejak)

    $baris = @()
    foreach ($f in @($AttLog2, $AttLog)) {
        if (Test-Path $f) { $baris += Get-Content -Path $f -Tail 60000 -ErrorAction SilentlyContinue }
    }
    $pola = '^end ReadAllGLogData from (\S+) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*(\S*)'
    $sukses = @{}
    foreach ($b in $baris) {
        if ($b -match $pola) {
            $ip = $Matches[1]; $hasil = $Matches[3]
            $wkt = [datetime]::ParseExact($Matches[2], 'yyyy-MM-dd HH:mm:ss', $null)
            if ($wkt -ge $sejak -and $hasil -eq 'Succeed') { $sukses[$ip] = $wkt }
        }
    }

    $gagal = @()
    foreach ($m in $Mesin) {
        if ($sukses.ContainsKey($m.IP)) { Tulis ("OK     #{0} {1,-13} {2}  terdownload {3:HH:mm:ss}" -f $m.No, $m.Nama, $m.IP, $sukses[$m.IP]) }
        else { Tulis ("GAGAL  #{0} {1,-13} {2}  TIDAK ada download sukses" -f $m.No, $m.Nama, $m.IP); $gagal += $m.Nama }
    }
    $ringkas = if ($gagal.Count -eq 0) { 'DOWNLOAD LENGKAP 7/7 MESIN' } else { ('DOWNLOAD {0}/7 - GAGAL: {1}' -f (7 - $gagal.Count), ($gagal -join ', ')) }
    Tulis $ringkas
    Set-Content -Path $FileStatus -Encoding UTF8 -Value ("{0}  VERIFIKASI  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $ringkas)
    exit ([int]($gagal.Count -gt 0))
}
