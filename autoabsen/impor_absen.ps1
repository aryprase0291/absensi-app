# =====================================================================
#  impor_absen.ps1  -  Import hasil kalkulasi Att (tab Status Shift,
#                      "Ekspor data") ke absensi.jpt.co.id (Supabase)
#  Lokasi : D:\AutoAbsen\impor_absen.ps1
#
#  Jalur yang dipakai SAMA dengan tombol Import di web:
#    Edge Function dbabsen -> impor_potongan (per 2000 baris) -> impor_commit
#  Bedanya: login pakai header x-sinkron-rahasia (seperti Apps Script),
#  bukan token admin.
#
#  PEMAKAIAN
#   1) Simpan rahasia sekali (nilai SUPABASE_SINKRON_RAHASIA dari Script
#      Properties Apps Script). Disimpan terenkripsi (DPAPI, hanya user ini):
#        powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\impor_absen.ps1 -SimpanRahasia
#   2) Uji tanpa mengirim (baca file, tampilkan ringkasan):
#        ... impor_absen.ps1 -File "D:\AutoAbsen\ekspor\contoh.xls" -UjiSaja
#   3) Import sungguhan:
#        ... impor_absen.ps1 -File "D:\AutoAbsen\ekspor\contoh.xls"
#      Tanpa -File: diambil file terbaru di folder ekspor (maks 3 jam).
#
#  Hasil: D:\AutoAbsen\log\YYYY-MM-DD.log dan status_terakhir.txt
# =====================================================================
param(
    [string]$File = '',
    [ValidateSet('upsert','periode','replace')]
    [string]$Mode = 'upsert',
    [switch]$UjiSaja,
    [switch]$SimpanRahasia,
    [switch]$Paksa,               # import walau file sama sudah pernah diimpor
    [int]$MaksUmurJam = 3,
    [string]$HarusDari = '',      # dipakai otomasi_att.ps1: rentang di file wajib sama
    [string]$HarusSampai = '',
    [int]$MinPersen = 80          # tolak bila baris < 80% dari isi web untuk rentang yang sama
)
$ErrorActionPreference = 'Stop'

# ---------- KONFIGURASI ----------
$SupabaseUrl = 'https://owbibqqaoeyrnatzqgso.supabase.co'
# Anon key publik (sama dengan yang ada di aplikasi web). Tidak memberi
# akses tabel; gerbang sebenarnya adalah x-sinkron-rahasia.
$AnonKey     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93YmlicXFhb2V5cm5hdHpxZ3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MTY5ODgsImV4cCI6MjEwNTI5Mjk4OH0.fYkvj16tWN-7yh4zvRSbRg7aIb3tp4dnZQapNK50J3Q'
$Potongan    = 2000
# ---------------------------------

$Dasar       = Split-Path -Parent $MyInvocation.MyCommand.Path
$DirEkspor   = Join-Path $Dasar 'ekspor'
$DirLog      = Join-Path $Dasar 'log'
$FileRahasia = Join-Path $Dasar 'rahasia.dat'
$FileRiwayat = Join-Path $Dasar 'impor_terakhir.txt'
$FileStatus  = Join-Path $Dasar 'status_terakhir.txt'
New-Item -ItemType Directory -Force -Path $DirLog, $DirEkspor | Out-Null
$FileLog = Join-Path $DirLog ((Get-Date -Format 'yyyy-MM-dd') + '.log')
$Inv = [Globalization.CultureInfo]::InvariantCulture

function Tulis([string]$teks) {
    $b = '{0}  [IMPOR]  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $teks
    Add-Content -Path $FileLog -Value $b -Encoding UTF8
    Write-Output $b
}
function Hasil([hashtable]$isi) {
    if ($UjiSaja) { return }
    $isi.waktu = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    try { $isi | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $Dasar 'hasil_impor.json') -Encoding UTF8 } catch {}
}
function Status([string]$teks) {
    Set-Content -Path $FileStatus -Encoding UTF8 -Value ('{0}  IMPOR  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $teks)
}

# ---------- simpan rahasia ----------
if ($SimpanRahasia) {
    $s = Read-Host 'Tempel nilai SUPABASE_SINKRON_RAHASIA' -AsSecureString
    $s | ConvertFrom-SecureString | Set-Content -Path $FileRahasia -Encoding ASCII
    Write-Output "Rahasia tersimpan terenkripsi di $FileRahasia (hanya bisa dibaca user $env:USERNAME di PC ini)."
    exit 0
}

# ---------- normalisasi (meniru importDbAbsenParser.js) ----------
function Dua([int]$n) { $n.ToString('00') }

function KeTanggal($v) {
    if ($null -eq $v) { return '' }
    if ($v -is [double]) {
        $n = [math]::Floor($v)
        if ($n -ge 20000 -and $n -le 80000) { return ([datetime]'1899-12-30').AddDays($n).ToString('yyyy-MM-dd') }
        return ''
    }
    if ($v -is [datetime]) { return $v.ToString('yyyy-MM-dd') }
    $s = ([string]$v).Trim()
    if ($s -match '^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$') { $y=[int]$Matches[1]; $bl=[int]$Matches[2]; $hr=[int]$Matches[3] }
    elseif ($s -match '^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$') { $hr=[int]$Matches[1]; $bl=[int]$Matches[2]; $y=[int]$Matches[3] }
    else { return '' }
    if ($bl -lt 1 -or $bl -gt 12 -or $hr -lt 1 -or $hr -gt 31) { return '' }
    return ('{0}-{1}-{2}' -f $y, (Dua $bl), (Dua $hr))
}

function KeJam($v) {
    if ($null -eq $v) { return '' }
    if ($v -is [double]) {
        $menit = [int][math]::Round($v * 1440)
        return ('{0}:{1}' -f (Dua ([math]::Floor($menit / 60))), (Dua ($menit % 60)))
    }
    if ($v -is [datetime]) { return $v.ToString('HH:mm') }
    $s = ([string]$v).Trim()
    if ($s -match '^(\d{1,2}):(\d{2})(?::\d{2})?$') {
        if ([int]$Matches[1] -gt 47) { return $s }
        return ('{0}:{1}' -f (Dua ([int]$Matches[1])), $Matches[2])
    }
    return $s
}

function KeTeks($v) {
    if ($null -eq $v) { return '' }
    if ($v -is [double]) {
        if ($v -eq [math]::Floor($v)) { return $v.ToString('0', $Inv) }
        return $v.ToString($Inv)
    }
    return ([string]$v).Trim()
}

$KolomNama = 'no_akun','nik','nama','tanggal','jam_kerja','mulai_tugas','akhir_tugas','masuk','pulang','telat','pulang_awal','bolos','durasi_kerja','symbol','departemen','att_time','waktu_scan','minggu'
$KolomJam  = 5,6,7,8,9,10,12,15

function Normalisasi($sel) {   # $sel = larik 18 nilai mentah
    $o = [ordered]@{}
    for ($i = 0; $i -lt 18; $i++) {
        $v = $sel[$i]
        if ($i -eq 3)                  { $t = KeTanggal $v }
        elseif ($KolomJam -contains $i) { $t = KeJam $v }
        elseif ($i -eq 16) {
            if ($v -is [double]) { $t = KeJam $v } else { $t = (([string]$v) -replace '\s+', ' ').Trim() }
        }
        else { $t = KeTeks $v }
        $o[$KolomNama[$i]] = $t
    }
    return $o
}

function AdalahHeader($sel) {
    $t = (($sel | ForEach-Object { [string]$_ }) -join '|').ToLower()
    return ($t.Contains('nik') -and $t.Contains('tanggal') -and $t.Contains('symbol'))
}

# ---------- baca file ekspor ----------
# File .xls dari Att memakai format Excel lama (BIFF2) yang DIBLOKIR Excel
# modern (Trust Center > File Block). Karena itu file .xls dibaca langsung
# dari bytenya; Excel hanya dipakai untuk .xlsx/.csv.
function BacaBiff([string]$path) {
    $d = [IO.File]::ReadAllBytes($path)
    try { [Text.Encoding]::RegisterProvider([Text.CodePagesEncodingProvider]::Instance) } catch {}
    $enc = [Text.Encoding]::GetEncoding(1252)
    $sel = @{}; $maksBaris = -1; $i = 0
    while ($i + 4 -le $d.Length) {
        $t = [BitConverter]::ToUInt16($d, $i); $l = [BitConverter]::ToUInt16($d, $i + 2); $b = $i + 4; $i = $b + $l
        if ($i -gt $d.Length) { break }
        if ($t -eq 0x0004 -or $t -eq 0x0003 -or $t -eq 0x0002 -or $t -eq 0x0005 -or
            $t -eq 0x0204 -or $t -eq 0x0203) {
            $r = [BitConverter]::ToUInt16($d, $b); $c = [BitConverter]::ToUInt16($d, $b + 2)
            switch ($t) {
                0x0004 { $n = $d[$b + 7]; $v = $enc.GetString($d, $b + 8, $n) }                       # LABEL (BIFF2)
                0x0003 { $v = [BitConverter]::ToDouble($d, $b + 7) }                                  # NUMBER (BIFF2)
                0x0002 { $v = [double][BitConverter]::ToUInt16($d, $b + 7) }                          # INTEGER (BIFF2)
                0x0005 { $v = if ($d[$b + 8] -eq 0) { [bool]$d[$b + 7] } else { '' } }               # BOOLERR (BIFF2)
                0x0204 { $n = [BitConverter]::ToUInt16($d, $b + 6); $v = $enc.GetString($d, $b + 8, $n) } # LABEL (BIFF3/4)
                0x0203 { $v = [BitConverter]::ToDouble($d, $b + 6) }                                  # NUMBER (BIFF3/4)
            }
            if ($c -lt 18) { $sel["$r,$c"] = $v; if ($r -gt $maksBaris) { $maksBaris = $r } }
        }
    }
    if ($maksBaris -lt 0) { throw 'Format .xls tidak dikenali (bukan file ekspor Att?).' }
    $hasil = New-Object System.Collections.Generic.List[object]
    $adaHeader = $false
    for ($r = 0; $r -le $maksBaris; $r++) {
        $baris = New-Object object[] 18; $kosong = $true
        for ($c = 0; $c -lt 18; $c++) {
            $baris[$c] = $sel["$r,$c"]
            if ($null -ne $baris[$c] -and ([string]$baris[$c]).Trim() -ne '') { $kosong = $false }
        }
        if ($kosong) { continue }
        if (AdalahHeader $baris) { $adaHeader = $true; continue }
        if (-not $adaHeader) { continue }
        $hasil.Add([pscustomobject]@{ Sheet = 'xls'; Baris = $r + 1; Sel = $baris })
    }
    return ,$hasil
}

function BacaExcel([string]$path) {
    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false; $xl.DisplayAlerts = $false
    $hasil = New-Object System.Collections.Generic.List[object]
    try {
        $wb = $xl.Workbooks.Open($path, 0, $true)
        foreach ($ws in $wb.Worksheets) {
            $nilai = $ws.UsedRange.Value2
            if ($null -eq $nilai -or $nilai -isnot [array]) { continue }
            $r0 = $nilai.GetLowerBound(0); $r1 = $nilai.GetUpperBound(0)
            $c0 = $nilai.GetLowerBound(1); $c1 = $nilai.GetUpperBound(1)
            $adaHeader = $false
            for ($r = $r0; $r -le $r1; $r++) {
                $sel = New-Object object[] 18
                $kosong = $true
                for ($c = 0; $c -lt 18; $c++) {
                    $cc = $c0 + $c
                    if ($cc -le $c1) { $sel[$c] = $nilai[$r, $cc] }
                    if ($null -ne $sel[$c] -and ([string]$sel[$c]).Trim() -ne '') { $kosong = $false }
                }
                if ($kosong) { continue }
                if (AdalahHeader $sel) { $adaHeader = $true; continue }
                if (-not $adaHeader) { continue }
                $hasil.Add([pscustomobject]@{ Sheet = $ws.Name; Baris = $r; Sel = $sel })
            }
        }
        $wb.Close($false)
    } finally {
        $xl.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    }
    return ,$hasil
}

function BacaWorkbook([string]$path) {
    $kepala = New-Object byte[] 2
    $fs = [IO.File]::OpenRead($path); [void]$fs.Read($kepala, 0, 2); $fs.Close()
    # BOF BIFF2/3/4 = 09 00 / 09 02 / 09 04 ; BIFF5+ (OLE) dan xlsx (PK) lewat Excel
    if ($kepala[0] -eq 0x09 -and ($kepala[1] -eq 0x00 -or $kepala[1] -eq 0x02 -or $kepala[1] -eq 0x04 -or $kepala[1] -eq 0x08)) {
        return BacaBiff $path
    }
    return BacaExcel $path
}

# ---------- panggil Edge Function ----------
function BacaRahasia {
    if (-not (Test-Path $FileRahasia)) { throw "Rahasia belum disimpan. Jalankan dulu: impor_absen.ps1 -SimpanRahasia" }
    $sec = Get-Content $FileRahasia | ConvertTo-SecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

function Panggil($muatan, [string]$rahasia) {
    $json  = $muatan | ConvertTo-Json -Depth 5 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $h = @{ 'apikey' = $AnonKey; 'Authorization' = "Bearer $AnonKey"; 'x-sinkron-rahasia' = $rahasia }
    $res = Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/functions/v1/dbabsen" -Headers $h `
             -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 180
    if ($res.result -ne 'success') { throw ("Supabase menolak: " + $res.message) }
    return $res
}

# =====================================================================
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    if (-not $File) {
        $f = Get-ChildItem -Path $DirEkspor -File -Include *.xls,*.xlsx,*.csv,*.txt -Recurse -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $f) { throw "Tidak ada file ekspor di $DirEkspor" }
        if ($f.LastWriteTime -lt (Get-Date).AddHours(-$MaksUmurJam)) {
            throw ("File ekspor terbaru sudah basi ({0:yyyy-MM-dd HH:mm}): {1}" -f $f.LastWriteTime, $f.Name)
        }
        $File = $f.FullName
    }
    $File = (Resolve-Path $File).Path
    $hash = (Get-FileHash -Path $File -Algorithm SHA256).Hash
    Tulis ("=== Import {0} (mode {1}{2}) ===" -f $File, $Mode, $(if ($UjiSaja) { ', UJI SAJA' } else { '' }))

    if (-not $UjiSaja -and -not $Paksa -and (Test-Path $FileRiwayat) -and ((Get-Content $FileRiwayat -Raw) -match [regex]::Escape($hash))) {
        Tulis 'File ini sudah pernah diimpor (hash sama) -> dilewati. Pakai -Paksa untuk mengulang.'
    Hasil @{ status = 'dilewati'; pesan = 'file sama sudah pernah diimpor' }
        exit 0
    }

    $mentah = BacaWorkbook $File
    $peta = [ordered]@{}; $lewat = 0; $dup = 0
    foreach ($m in $mentah) {
        $n = Normalisasi $m.Sel
        if (-not $n.nik)     { $lewat++; Tulis ("  lewati {0} baris {1}: NIK kosong" -f $m.Sheet, $m.Baris); continue }
        if (-not $n.tanggal) { $lewat++; Tulis ("  lewati {0} baris {1}: tanggal tidak terbaca '{2}'" -f $m.Sheet, $m.Baris, $m.Sel[3]); continue }
        $k = if ($n.no_akun) { 'A|' + $n.no_akun + '|' + $n.tanggal } else { 'N|' + $n.nik + '|' + $n.tanggal }
        if ($peta.Contains($k)) { $dup++ }
        $peta[$k] = $n
    }
    $baris = @($peta.Values)
    if ($baris.Count -eq 0) { throw 'Tidak ada baris data yang terbaca (header No.Akun/NIK/Tanggal/Symbol tidak ditemukan?).' }

    $tgl  = $baris | ForEach-Object { $_.tanggal } | Sort-Object
    $nik  = ($baris | ForEach-Object { $_.nik } | Sort-Object -Unique).Count
    Tulis ("Terbaca {0} baris, {1} karyawan, {2} s/d {3}; dilewati {4}, duplikat {5}" -f $baris.Count, $nik, $tgl[0], $tgl[-1], $lewat, $dup)

    if ($HarusDari -and $tgl[0] -ne $HarusDari) { throw ("Tanggal awal di file {0}, seharusnya {1} (rentang di Att tidak terisi benar)" -f $tgl[0], $HarusDari) }
    if ($HarusSampai -and $tgl[-1] -ne $HarusSampai) { throw ("Tanggal akhir di file {0}, seharusnya {1} (rentang di Att tidak terisi benar)" -f $tgl[-1], $HarusSampai) }

    if ($UjiSaja) {
        Tulis 'Contoh 3 baris pertama:'
        $baris | Select-Object -First 3 | ForEach-Object { Tulis ('  ' + (($_.Values) -join ' | ')) }
        Tulis 'UJI SAJA: tidak ada yang dikirim.'
        exit 0
    }

    $rahasia = BacaRahasia
    # Pengaman: file yang jauh lebih sedikit barisnya dari isi web untuk rentang
    # yang sama (mis. departemen salah pilih) tidak diimpor.
    # 23 Okt 2026: yang dihitung hanya baris web milik No. Akun / NIK yang ada di file.
    # Data kantor lain yang masuk lewat impor terpisah (mis. Enggano/Kapuk/ITP, 22 Okt,
    # 2.640 baris) tidak pernah ada di ekspor Att dan sebelumnya membuat impor selalu ditolak.
    try {
        $setAkun = New-Object 'System.Collections.Generic.HashSet[string]'
        $setNik  = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($b in $baris) { if ($b.no_akun) { [void]$setAkun.Add([string]$b.no_akun) } else { [void]$setNik.Add([string]$b.nik) } }
        $j = Panggil @{ aksi = 'jumlah'; dari = $tgl[0]; sampai = $tgl[-1]; no_akun = @($setAkun); nik = @($setNik) } $rahasia
        $diWeb = 0; foreach ($k in 'jumlah','total','count') { if ($j.$k) { $diWeb = [int]$j.$k; break } }
        $semuaWeb = $diWeb
        if (-not $j.tersaring) {
            # Server belum mendukung filter akun -> tarik baris rentang ini (aksi halaman) dan hitung di sini.
            $diWeb = 0; $semuaWeb = 0; $kk = $null; $kt = $null
            for ($hal = 0; $hal -lt 50; $hal++) {
                $m = @{ aksi = 'halaman'; dari = $tgl[0]; sampai = $tgl[-1]; batas = 2000 }
                if ($kk) { $m.sesudah_kunci = $kk; $m.sesudah_tanggal = $kt }
                $h = Panggil $m $rahasia
                foreach ($r in @($h.baris)) {
                    if (-not $r) { continue }
                    $semuaWeb++
                    if (($r.no_akun -and $setAkun.Contains([string]$r.no_akun)) -or ($r.nik -and $setNik.Contains([string]$r.nik))) { $diWeb++ }
                }
                if ($h.habis -or -not $h.kunci_akhir) { break }
                $kk = $h.kunci_akhir; $kt = $h.tanggal_akhir
            }
        }
        if ($diWeb -gt 0) {
            Tulis ("Di web untuk rentang ini: {0} baris milik akun di file (seluruh web {1})" -f $diWeb, $semuaWeb)
            if ($baris.Count * 100 -lt $diWeb * $MinPersen) { throw ("File hanya {0} baris, di web {1} (< {2}%). Dibatalkan." -f $baris.Count, $diWeb, $MinPersen) }
        }
    } catch { if ($_.Exception.Message -like 'File hanya*') { throw } else { Tulis ('  cek jumlah dilewati: ' + $_.Exception.Message) } }
    $sesi = 'auto-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
    for ($i = 0; $i -lt $baris.Count; $i += $Potongan) {
        $akhir = [math]::Min($i + $Potongan, $baris.Count) - 1
        $muatan = @{ aksi = 'impor_potongan'; sesi = $sesi; baris = @($baris[$i..$akhir]) }
        $ok = $false
        for ($p = 1; $p -le 3 -and -not $ok; $p++) {
            try { [void](Panggil $muatan $rahasia); $ok = $true }
            catch { Tulis ("  potongan {0}-{1} gagal (percobaan {2}): {3}" -f $i, $akhir, $p, $_.Exception.Message); Start-Sleep -Seconds (3 * $p) }
        }
        if (-not $ok) {
            try { [void](Panggil @{ aksi = 'impor_batal'; sesi = $sesi } $rahasia) } catch {}
            throw "Potongan $i-$akhir gagal 3x. db_absen belum disentuh."
        }
        Tulis ("  terkirim {0}/{1} baris" -f ($akhir + 1), $baris.Count)
    }
    Tulis 'Menyimpan ke database web (commit)...'
    # commit TIDAK diulang
    $h = Panggil @{ aksi = 'impor_commit'; sesi = $sesi; mode = $Mode } $rahasia
    $ring = ('SUKSES {0} baris ({1} s/d {2}): baru {3}, diperbarui {4}, total db {5}' -f `
             $h.barisBaru, $h.periodeAwal, $h.periodeAkhir, $h.barisDitambahkan, $h.barisDiperbarui, $h.totalSetelah)
    Tulis $ring
    Status $ring
    Hasil @{ status = 'sukses'; baris = [int]$h.barisBaru; baru = [int]$h.barisDitambahkan; diperbarui = [int]$h.barisDiperbarui;
             total = [int]$h.totalSetelah; ditimpa = [int]$h.barisDitimpa - [int]$h.barisDiperbarui; mode = $Mode; dari = [string]$h.periodeAwal; sampai = [string]$h.periodeAkhir; karyawan = $nik; file = (Split-Path $File -Leaf) }
    Add-Content -Path $FileRiwayat -Value ('{0}  {1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $hash, $File) -Encoding UTF8
    exit 0
}
catch {
    Tulis ('GAGAL: ' + $_.Exception.Message)
    Status ('GAGAL: ' + $_.Exception.Message)
    Hasil @{ status = 'gagal'; pesan = $_.Exception.Message }
    exit 1
}
