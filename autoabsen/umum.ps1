# =====================================================================
#  umum.ps1  -  Fungsi bersama AutoAbsen (di-dot-source oleh script lain)
#    . (Join-Path $PSScriptRoot 'umum.ps1')
#  Isi: log file, rahasia DPAPI, kirim Telegram, catat riwayat ke Supabase,
#       antrean (mutex), tutup Att dengan aman, deteksi diam (idle).
# =====================================================================
$Global:AA_Dasar      = $PSScriptRoot
$Global:AA_DirLog     = Join-Path $AA_Dasar 'log'
$Global:AA_Supabase   = 'https://owbibqqaoeyrnatzqgso.supabase.co'
$Global:AA_Anon       = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93YmlicXFhb2V5cm5hdHpxZ3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MTY5ODgsImV4cCI6MjEwNTI5Mjk4OH0.fYkvj16tWN-7yh4zvRSbRg7aIb3tp4dnZQapNK50J3Q'
$Global:AA_Mesin = @(
    @{ No=1; Nama='Office Kumai'; IP='192.168.1.201'  },
    @{ No=2; Nama='Resepsionis';  IP='192.168.1.246'  },
    @{ No=3; Nama='Depo Kumai';   IP='192.168.1.126'  },
    @{ No=4; Nama='Romokalisari'; IP='192.168.62.201' },
    @{ No=5; Nama='Banyuwangi';   IP='192.168.61.201' },
    @{ No=6; Nama='Brumbung';     IP='192.168.33.201' },
    @{ No=7; Nama='Watudodol';    IP='192.168.63.201' }
)
$Global:AA_AttDir = 'C:\Program Files (x86)\Att'
$Global:AA_AttExe = Join-Path $AA_AttDir 'Att.exe'
New-Item -ItemType Directory -Force -Path $AA_DirLog | Out-Null
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Catat([string]$tag, [string]$teks) {
    $b = '{0}  [{1}]  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $tag, $teks
    $f = Join-Path $AA_DirLog ((Get-Date -Format 'yyyy-MM-dd') + '.log')
    try { Add-Content -Path $f -Value $b -Encoding UTF8 } catch {}
    Write-Output $b
}

function BacaDpapi([string]$file) {
    if (-not (Test-Path $file)) { return $null }
    $sec = Get-Content $file | ConvertTo-SecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
function SimpanDpapi([string]$file, [string]$teks) {
    ConvertTo-SecureString -String $teks -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $file -Encoding ASCII
}

function KeJson($obj) { return ($obj | ConvertTo-Json -Depth 8 -Compress) }
# PowerShell 5.1 membaca respons "application/json" tanpa charset sebagai ISO-8859-1
# sehingga emoji/— jadi "â". Karena itu body dibaca sebagai byte lalu di-decode UTF-8.
function HttpJson([string]$metode, [string]$url, $obj = $null, [hashtable]$header = @{}, [int]$timeout = 60) {
    $p = @{ Method = $metode; Uri = $url; Headers = $header; TimeoutSec = $timeout; UseBasicParsing = $true }
    if ($null -ne $obj) { $p.ContentType = 'application/json; charset=utf-8'; $p.Body = [Text.Encoding]::UTF8.GetBytes((KeJson $obj)) }
    $r = Invoke-WebRequest @p
    $teks = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    return ($teks | ConvertFrom-Json)
}
function PostJson([string]$url, $obj, [hashtable]$header = @{}, [int]$timeout = 60) { return HttpJson 'Post' $url $obj $header $timeout }
function GetJson([string]$url, [int]$timeout = 60) { return HttpJson 'Get' $url $null @{} $timeout }

# Format tampilan (Indonesia)
$Global:AA_Id = [Globalization.CultureInfo]::GetCultureInfo('id-ID')
function Angka($n) { if ($null -eq $n -or "$n" -eq '') { return '0' }; return ([double]$n).ToString('n0', $AA_Id) }
function TglPendek([string]$ymd, [switch]$Tahun) {
    if (-not $ymd) { return '' }
    $d = [datetime]::ParseExact($ymd.Substring(0, 10), 'yyyy-MM-dd', $null)
    if ($Tahun) { return $d.ToString('dd/MM/yyyy') } else { return $d.ToString('dd/MM') }
}
function Rentang([string]$a, [string]$b) {
    if (-not $a) { return '' }
    if ($a -eq $b) { return (TglPendek $a -Tahun) }
    return ('{0}–{1}' -f (TglPendek $a), (TglPendek $b -Tahun))
}
$Global:AA_NamaMode = @{ upsert = 'tambah + perbarui'; periode = 'ganti periode'; replace = 'ganti seluruh isi' }
$Global:AA_Ikon = @{ sukses = '✅'; sebagian = '⚠️'; gagal = '❌'; dilewati = 'ℹ️'; info = 'ℹ️' }

# ---------- Telegram ----------
function KonfigTelegram {
    $f = Join-Path $AA_Dasar 'telegram.json'
    $k = $null
    if (Test-Path $f) { $k = Get-Content $f -Raw | ConvertFrom-Json }
    $token = BacaDpapi (Join-Path $AA_Dasar 'telegram.dat')
    $nama = @{}
    if ($k -and $k.admin_nama) { foreach ($pr in $k.admin_nama.PSObject.Properties) { $nama[$pr.Name] = [string]$pr.Value } }
    # grup tambahan: chat_id -> { nama, perintah[] } (mis. grup BTR yang hanya boleh /btr)
    $lain = @{}
    if ($k -and $k.grup_lain) {
        foreach ($pr in $k.grup_lain.PSObject.Properties) {
            $lain[$pr.Name] = [pscustomobject]@{ nama = [string]$pr.Value.nama; perintah = @($pr.Value.perintah | ForEach-Object { [string]$_ }) }
        }
    }
    return [pscustomobject]@{
        GrupLain     = $lain
        Token        = $token
        Grup         = $(if ($k) { [string]$k.grup_id } else { '' })
        Admin        = $(if ($k -and $k.admin) { @($k.admin | ForEach-Object { [string]$_ }) } else { @() })
        AdminNama    = $nama
        AnggotaBoleh = [bool]($k -and $k.anggota_boleh)
    }
}
function SimpanKonfigTelegram([string]$grup, [string[]]$admin, $anggotaBoleh = $null, [hashtable]$nama = $null, [hashtable]$lain = $null) {
    $f = Join-Path $AA_Dasar 'telegram.json'
    $lama = KonfigTelegram
    if ($null -eq $anggotaBoleh) { $anggotaBoleh = $lama.AnggotaBoleh }
    if ($null -eq $nama) { $nama = $lama.AdminNama }
    if ($null -eq $lain) { $lain = $lama.GrupLain }
    $lainJson = @{}; foreach ($c in $lain.Keys) { $lainJson[$c] = @{ nama = [string]$lain[$c].nama; perintah = [string[]]@($lain[$c].perintah) } }
    $admin = @($admin | Where-Object { $_ } | Select-Object -Unique)
    $namaBersih = @{}; foreach ($a in $admin) { if ($nama.ContainsKey($a)) { $namaBersih[$a] = $nama[$a] } }
    @{ grup_id = $grup; admin = $admin; anggota_boleh = [bool]$anggotaBoleh; admin_nama = $namaBersih; grup_lain = $lainJson } | ConvertTo-Json -Depth 5 | Set-Content -Path $f -Encoding UTF8
}
function Html([string]$s) { return ($s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;') }
function TelegramApi([string]$metode, $isi, [int]$timeout = 60) {
    $k = KonfigTelegram
    if (-not $k.Token) { throw 'Token Telegram belum disimpan (bot_telegram.ps1 -Daftar).' }
    return PostJson ("https://api.telegram.org/bot{0}/{1}" -f $k.Token, $metode) $isi @{} $timeout
}
function KirimTelegram([string]$teksHtml, [string]$chat = '', $tombol = $null) {
    # $chat kosong = grup. Gagal kirim tidak boleh menggagalkan pekerjaan.
    try {
        $k = KonfigTelegram
        if (-not $k.Token) { return }
        if (-not $chat) { $chat = $k.Grup }
        if (-not $chat) { return }
        $isi = @{ chat_id = $chat; text = $teksHtml; parse_mode = 'HTML'; disable_web_page_preview = $true }
        if ($tombol) { $isi.reply_markup = @{ inline_keyboard = $tombol } }
        [void](TelegramApi 'sendMessage' $isi)
    } catch { Catat 'TG' ('gagal kirim: ' + $_.Exception.Message) | Out-Null }
}

# ---------- Riwayat ke Supabase (Edge Function log-otomasi) ----------
function PanggilLogOtomasi($isi) {
    $r = BacaDpapi (Join-Path $AA_Dasar 'rahasia.dat')
    if (-not $r) { throw 'rahasia.dat belum ada' }
    $h = @{ apikey = $AA_Anon; Authorization = "Bearer $AA_Anon"; 'x-sinkron-rahasia' = $r }
    return PostJson "$AA_Supabase/functions/v1/log-otomasi" $isi $h 30
}
function CatatRiwayat([hashtable]$isi) {
    try {
        $isi.aksi = 'tulis'
        if (-not $isi.pc) { $isi.pc = $env:COMPUTERNAME }
        [void](PanggilLogOtomasi $isi)
    } catch { Catat 'RIWAYAT' ('gagal catat ke Supabase: ' + $_.Exception.Message) | Out-Null }
}

# ---------- Antrean: satu pekerjaan dalam satu waktu ----------
function AmbilAntrean([int]$detik) {
    $m = New-Object System.Threading.Mutex($false, 'Global\AutoAbsenPekerjaan')
    try { if ($m.WaitOne($detik * 1000)) { return $m } } catch [System.Threading.AbandonedMutexException] { return $m }
    $m.Dispose(); return $null
}
function LepasAntrean($m) { if ($m) { try { $m.ReleaseMutex() } catch {}; $m.Dispose() } }
function AdaPekerjaan {
    $m = AmbilAntrean 0
    if ($m) { LepasAntrean $m; return $false }
    return $true
}

# ---------- Win32: diam (idle), jendela Att ----------
if (-not ('AAWin' -as [type])) {
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class AAWin {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static double DiamDetik() {
    var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l);
    if (!GetLastInputInfo(ref l)) return 0;
    return ((uint)Environment.TickCount - l.dwTime) / 1000.0;
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static string Teks(IntPtr h) {
    int n = (int)SendMessage(h, 0x000E, IntPtr.Zero, IntPtr.Zero);
    if (n <= 0) return ""; if (n > 500) n = 500;
    var sb = new StringBuilder(n + 1); SendMessage(h, 0x000D, (IntPtr)(n + 1), sb); return sb.ToString();
  }
  public static string Kelas(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static List<IntPtr> Atas(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static List<IntPtr> Anak(IntPtr h) {
    var l = new List<IntPtr>(); EnumChildWindows(h, (c, x) => { l.Add(c); return true; }, IntPtr.Zero); return l;
  }
  public static uint PidDepan() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
}
"@
}

function AttJalan { return [bool](Get-Process -Name Att -ErrorAction SilentlyContinue) }

function TutupAtt([string]$tag = 'TUTUP') {
    # Tutup Att secara normal (WM_CLOSE). Konfirmasi keluar dijawab Ya/Yes/OK.
    # Kalau 90 detik tidak tertutup baru dipaksa.
    $p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $p) { return $true }
    $utama = [AAWin]::Atas([uint32]$p.Id) | Where-Object { [AAWin]::Kelas($_) -eq 'TFormAttMain' } | Select-Object -First 1
    if ($utama) { [void][AAWin]::PostMessage($utama, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    else { [void]$p.CloseMainWindow() }
    $mulai = Get-Date
    while (((Get-Date) - $mulai).TotalSeconds -lt 90) {
        Start-Sleep -Seconds 2
        $p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $p) { Catat $tag 'Att ditutup' | Out-Null; return $true }
        foreach ($w in [AAWin]::Atas([uint32]$p.Id)) {
            $k = [AAWin]::Kelas($w)
            if ($k -notin @('#32770', 'TMessageForm')) { continue }
            $btn = [AAWin]::Anak($w) | Where-Object { [AAWin]::Kelas($_) -in @('Button','TButton','TBitBtn') -and ([AAWin]::Teks($_) -match '^&?(Yes|Ya|OK|Ok)$') } | Select-Object -First 1
            if ($btn) {
                $isi = ([AAWin]::Anak($w) | ForEach-Object { [AAWin]::Teks($_) } | Where-Object { $_ }) -join ' / '
                Catat $tag ('dialog saat menutup: "{0}" {1} -> {2}' -f [AAWin]::Teks($w), $isi, [AAWin]::Teks($btn)) | Out-Null
                [void][AAWin]::PostMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
            }
        }
    }
    $p = Get-Process -Name Att -ErrorAction SilentlyContinue
    if ($p) { Catat $tag 'Att tidak mau tertutup 90 detik -> dipaksa' | Out-Null; $p | Stop-Process -Force; Start-Sleep -Seconds 3 }
    return -not (AttJalan)
}

# ---------- Att.log: hasil download per mesin sejak waktu tertentu ----------
function BacaBerbagi([string]$f, [int]$maksByte = 8MB) {
    # Att mengunci Att.log saat berjalan; baca dengan FileShare.ReadWrite|Delete.
    $fs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($fs.Length -gt $maksByte) { [void]$fs.Seek(-$maksByte, [IO.SeekOrigin]::End) }
        $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::Default)
        return ($sr.ReadToEnd() -split "`r?`n")
    } finally { $fs.Dispose() }
}
$Global:AA_LogTerkunci = $false
function HasilDownload([datetime]$sejak) {
    $baris = @(); $Global:AA_LogTerkunci = $false
    foreach ($f in @((Join-Path $AA_AttDir 'Att.log.TXT'), (Join-Path $AA_AttDir 'Att.log'))) {
        if (-not (Test-Path $f)) { continue }
        try { $baris += BacaBerbagi $f }
        catch { $Global:AA_LogTerkunci = $true; Catat 'DOWNLOAD' ("tidak bisa membaca {0}: {1}" -f (Split-Path $f -Leaf), $_.Exception.Message) | Out-Null }
    }
    $hasil = @{}
    foreach ($b in $baris) {
        if ($b -match '^end ReadAllGLogData from (\S+) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*(\S*)') {
            $w = [datetime]::ParseExact($Matches[2], 'yyyy-MM-dd HH:mm:ss', $null)
            if ($w -ge $sejak) { $hasil[$Matches[1]] = [pscustomobject]@{ Waktu = $w; Hasil = $Matches[3] } }
        }
    }
    return $hasil
}

function TesPort([string]$ip, [int]$port = 4370, [int]$ms = 3000) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $ar = $c.BeginConnect($ip, $port, $null, $null); if (-not $ar.AsyncWaitHandle.WaitOne($ms, $false)) { return $false }; $c.EndConnect($ar); return $true }
    catch { return $false } finally { $c.Close() }
}

function TulisHasil([string]$nama, [hashtable]$isi) {
    $isi.waktu = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $isi | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $AA_Dasar "hasil_$nama.json") -Encoding UTF8
}
function BacaHasil([string]$nama) {
    $f = Join-Path $AA_Dasar "hasil_$nama.json"
    if (Test-Path $f) { return (Get-Content $f -Raw | ConvertFrom-Json) }
    return $null
}

function PeriodeBerjalan([datetime]$hari) {
    if ($hari.Day -ge 21) { $a = Get-Date -Year $hari.Year -Month $hari.Month -Day 21 }
    else { $b = $hari.AddMonths(-1); $a = Get-Date -Year $b.Year -Month $b.Month -Day 21 }
    return $a.Date
}

# ---------- Backup database Att (backup_db.ps1, diatur dari bot: /backup) ----------
$Global:AA_FileBackup  = Join-Path $AA_Dasar 'backup.json'
$Global:AA_TugasBackup = 'AutoAbsen-Backup'
function KonfigBackup {
    $d = [ordered]@{ sumber = '\\192.168.1.60\att\*.mdb'; tujuan = 'D:\BackupAbsen'; jam = @('02:00', '19:00'); aktif = $true; simpan_hari = 30; simpan_bulan = 12 }
    if (Test-Path $AA_FileBackup) {
        try { $j = Get-Content $AA_FileBackup -Raw | ConvertFrom-Json; foreach ($p in $j.PSObject.Properties) { $d[$p.Name] = $p.Value } }
        catch { Catat 'BACKUP' ('backup.json rusak, pakai bawaan: ' + $_.Exception.Message) | Out-Null }
    }
    $d.jam = @(@($d.jam) | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^\d{2}:\d{2}$' } | Sort-Object -Unique)
    $d.aktif = [bool]$d.aktif; $d.simpan_hari = [int]$d.simpan_hari; $d.simpan_bulan = [int]$d.simpan_bulan
    return [pscustomobject]$d
}
function SimpanKonfigBackup($c) {
    [ordered]@{ sumber = [string]$c.sumber; tujuan = [string]$c.tujuan; jam = [string[]]@($c.jam); aktif = [bool]$c.aktif
                simpan_hari = [int]$c.simpan_hari; simpan_bulan = [int]$c.simpan_bulan } |
        ConvertTo-Json -Depth 4 | Set-Content -Path $AA_FileBackup -Encoding UTF8
}
function PasangJadwalBackup {
    # Daftarkan / perbarui task \AutoAbsen\AutoAbsen-Backup sesuai backup.json (butuh hak admin)
    $c = KonfigBackup
    $ada = Get-ScheduledTask -TaskPath '\AutoAbsen\' -TaskName $AA_TugasBackup -ErrorAction SilentlyContinue
    if (-not $c.aktif -or @($c.jam).Count -eq 0) {
        if ($ada) { $ada | Disable-ScheduledTask | Out-Null }
        return
    }
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $trig = @($c.jam | ForEach-Object { New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add([TimeSpan]::Parse($_))) })
    $aksi = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Sumber jadwal' -f (Join-Path $AA_Dasar 'backup_db.ps1'))
    $pr  = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $AA_TugasBackup -TaskPath '\AutoAbsen\' -Force -Action $aksi -Trigger $trig -Principal $pr -Settings $set `
      -Description 'Backup database Att (\\192.168.1.60\att\*.mdb) ke zip, laporan ke Telegram. Jadwal diatur dari bot: /backup' | Out-Null
}
function JadwalBackupBerikut {
    try {
        $i = Get-ScheduledTask -TaskPath '\AutoAbsen\' -TaskName $AA_TugasBackup -ErrorAction Stop | Get-ScheduledTaskInfo
        if ($i.NextRunTime) { return [datetime]$i.NextRunTime }
    } catch {}
    return $null
}
function BacaBackupTerakhir {
    $f = Join-Path $AA_Dasar 'backup_terakhir.json'
    if (Test-Path $f) { try { return (Get-Content $f -Raw | ConvertFrom-Json) } catch {} }
    return $null
}
function Ukuran($b) {
    $b = [double]$b
    if ($b -ge 1GB) { return ($b / 1GB).ToString('n2', $AA_Id) + ' GB' }
    if ($b -ge 1MB) { return ($b / 1MB).ToString('n1', $AA_Id) + ' MB' }
    return ($b / 1KB).ToString('n0', $AA_Id) + ' KB'
}
function DaftarZipBackup {
    $c = KonfigBackup
    if (-not (Test-Path -LiteralPath $c.tujuan)) { return @() }
    return @(Get-ChildItem -LiteralPath $c.tujuan -Filter 'absen_*.zip' -File | Sort-Object Name -Descending)
}
function SisaDisk([string]$path) {
    try {
        $root = [IO.Path]::GetPathRoot($path)
        if ($root -like '\\*') { return -1 }
        return [double](New-Object IO.DriveInfo $root).AvailableFreeSpace
    } catch { return -1 }
}

# ---------- Impor BTR ke web Daily_Bromo_Bwi (impor_btr.ps1, bot: /btr) ----------
$Global:AA_FileBtr = Join-Path $AA_Dasar 'btr.json'
function KonfigBtr {
    $d = [ordered]@{ url = ''; departemen = @('BTR-HARIAN', 'BTR'); mdb = '\\192.168.1.60\att\{tahun}.MDB'
                     status = $false; kode_kerja = $false; potong = 4000
                     mesin = @('Romokalisari', 'Banyuwangi', 'Watudodol') }   # mesin yang ditarik /btr "Download mesin dulu"
    if (Test-Path $AA_FileBtr) {
        try { $j = Get-Content $AA_FileBtr -Raw | ConvertFrom-Json; foreach ($p in $j.PSObject.Properties) { $d[$p.Name] = $p.Value } }
        catch { Catat 'BTR' ('btr.json rusak: ' + $_.Exception.Message) | Out-Null }
    }
    $d.departemen = @(@($d.departemen) | ForEach-Object { [string]$_ } | Where-Object { $_ })
    $d.mesin = @(@($d.mesin) | ForEach-Object { [string]$_ } | Where-Object { $_ })
    return [pscustomobject]$d
}
function RahasiaBtr {
    # Rahasia boleh ditaruh sekali di btr.json ("rahasia"); dipindah ke btr_rahasia.dat (DPAPI) lalu dihapus dari json.
    $fDat = Join-Path $AA_Dasar 'btr_rahasia.dat'
    if (Test-Path $AA_FileBtr) {
        $j = Get-Content $AA_FileBtr -Raw | ConvertFrom-Json
        if ($j.rahasia) {
            SimpanDpapi $fDat ([string]$j.rahasia)
            $j.PSObject.Properties.Remove('rahasia')
            $j | ConvertTo-Json -Depth 4 | Set-Content -Path $AA_FileBtr -Encoding UTF8
            Catat 'BTR' 'Rahasia BTR dipindah ke btr_rahasia.dat (terenkripsi)' | Out-Null
        }
    }
    return (BacaDpapi $fDat)
}

# ---------- Pemulihan mesin Att yang dinonaktifkan sementara oleh download terbatas (/btr) ----------
function PulihkanMesinAtt {
    $f = Join-Path $AA_Dasar 'mesin_enabled.json'
    if (-not (Test-Path $f)) { return $null }
    $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
    $mdb = '\\192.168.1.60\att\{0}.MDB' -f (Get-Date).Year
    $out = & $ps32 -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AA_Dasar 'mesin_att.ps1') -Aksi pulihkan -Mdb $mdb -Simpan $f 2>&1
    $j = @($out | ForEach-Object { [string]$_ } | Where-Object { $_ -like '{*' }) | Select-Object -Last 1
    if (-not $j) { throw ('mesin_att pulihkan: ' + (($out | Out-String).Trim())) }
    $r = $j | ConvertFrom-Json
    if (-not $r.ok) { throw ('mesin_att pulihkan: ' + $r.pesan) }
    return $r
}

# =====================================================================
#  PROGRES — satu pesan Telegram yang diperbarui selama pekerjaan berjalan
#    $P = ProgresBaru 'Judul' @(@{k='tarik'; n='Tarik data mesin'; b=3}, ...) @(chat...) @('📅 ...','👤 ...')
#    ProgresLangkah $P 'tarik' 'jalan' 'info' 0.5      (status: tunggu|jalan|ok|peringatan|gagal|lewat)
#    ProgresSelesai $P 'sukses' @('baris ringkasan', ...)
#  Edit dibatasi: >= 4 dtk bila isi berubah, >= 20 dtk bila hanya jam yang bergerak.
# =====================================================================
function DurasiTeks([double]$detik) {
    $d = [int][Math]::Round([Math]::Max(0, $detik))
    if ($d -lt 60) { return ('{0}d' -f $d) }
    if ($d -lt 3600) { return ('{0}m {1}d' -f [int][Math]::Floor($d / 60), ($d % 60)) }
    return ('{0}j {1}m' -f [int][Math]::Floor($d / 3600), [int][Math]::Floor(($d % 3600) / 60))
}
function ProgresBaru([string]$judul, [object[]]$langkah, [string[]]$chats, [string[]]$sub = @()) {
    $P = [pscustomobject]@{ Judul = $judul; Sub = @($sub); Mulai = Get-Date; Selesai = $null; Status = 'jalan'; Persen = 0
                             Langkah = New-Object System.Collections.Generic.List[object]; Pesan = @{}
                             Terakhir = [datetime]::MinValue; Inti = ''; Akhir = @() }
    foreach ($x in $langkah) {
        $P.Langkah.Add([pscustomobject]@{ Kunci = [string]$x.k; Nama = [string]$x.n; Bobot = $(if ($x.b) { [double]$x.b } else { 1.0 })
                                          Status = 'tunggu'; Info = ''; Fraksi = 0.0; Mulai = $null; Selesai = $null })
    }
    $teks = ProgresTeks $P
    foreach ($c in @($chats | Where-Object { $_ } | Select-Object -Unique)) {
        try {
            $r = TelegramApi 'sendMessage' @{ chat_id = $c; text = $teks; parse_mode = 'HTML'; disable_web_page_preview = $true; disable_notification = $true }
            $P.Pesan[[string]$c] = $r.result.message_id
        } catch { Catat 'PROGRES' ("kirim ke {0} gagal: {1}" -f $c, $_.Exception.Message) | Out-Null }
    }
    $P.Terakhir = Get-Date; $P.Inti = ProgresTeks $P -TanpaWaktu
    return $P
}
function ProgresPersen($P) {
    $tot = 0.0; $isi = 0.0
    foreach ($x in $P.Langkah) {
        $tot += $x.Bobot
        $isi += $x.Bobot * $(if ($x.Status -in @('ok', 'peringatan', 'gagal', 'lewat')) { 1.0 } else { $x.Fraksi })
    }
    if ($tot -le 0) { return 0 }
    return [int][Math]::Min(99, [Math]::Floor(100 * $isi / $tot))
}
function ProgresTeks($P, [switch]$TanpaWaktu) {
    $ikon = @{ tunggu = '▫️'; jalan = '🔄'; ok = '✅'; peringatan = '⚠️'; gagal = '❌'; lewat = '⏭' }
    $pct = switch ($P.Status) { 'jalan' { ProgresPersen $P } 'gagal' { $P.Persen } default { 100 } }
    $n = [int][Math]::Round($pct / 100 * 16)
    $bar = ('▰' * $n) + ('▱' * (16 - $n))
    $kepala = switch ($P.Status) { 'jalan' { '⏳' } 'sukses' { '✅' } 'sebagian' { '⚠️' } default { '❌' } }
    $judul = switch ($P.Status) { 'jalan' { $P.Judul } 'gagal' { $P.Judul + ' — gagal' } default { $P.Judul + ' selesai' } }
    $l = @(('{0} <b>{1}</b>' -f $kepala, $judul))
    $l += @($P.Sub | Where-Object { $_ })
    $akhirWaktu = if ($P.Selesai) { $P.Selesai } else { Get-Date }
    $l += ('<code>{0}</code> <b>{1}%</b>{2}' -f $bar, $pct, $(if ($TanpaWaktu -and -not $P.Selesai) { '' } else { ' · ' + (DurasiTeks ($akhirWaktu - $P.Mulai).TotalSeconds) }))
    $l += ''
    foreach ($x in $P.Langkah) {
        $b = '{0} {1}' -f $ikon[$x.Status], $x.Nama
        $tamb = @()
        if ($x.Info) { $tamb += $x.Info }
        if ($x.Status -eq 'jalan' -and $x.Mulai -and -not $TanpaWaktu) { $tamb += (DurasiTeks ((Get-Date) - $x.Mulai).TotalSeconds) }
        elseif ($x.Status -in @('ok', 'peringatan', 'gagal') -and $x.Mulai -and $x.Selesai -and ($x.Selesai - $x.Mulai).TotalSeconds -ge 1) {
            $tamb += (DurasiTeks ($x.Selesai - $x.Mulai).TotalSeconds)
        }
        if ($tamb.Count) { $b += (' · <i>{0}</i>' -f ($tamb -join ' · ')) }
        $l += $b
    }
    if (@($P.Akhir).Count) { $l += ''; $l += @($P.Akhir) }
    return ($l -join "`n")
}
function ProgresTampil($P, [switch]$Paksa) {
    if (-not $P -or -not $P.Pesan.Count) { return }
    $inti = ProgresTeks $P -TanpaWaktu
    $jeda = ((Get-Date) - $P.Terakhir).TotalSeconds
    if (-not $Paksa) {
        if ($inti -ne $P.Inti) { if ($jeda -lt 4) { return } }
        elseif ($jeda -lt 20) { return }
    }
    $teks = ProgresTeks $P
    foreach ($c in @($P.Pesan.Keys)) {
        try { [void](TelegramApi 'editMessageText' @{ chat_id = $c; message_id = $P.Pesan[$c]; text = $teks; parse_mode = 'HTML'; disable_web_page_preview = $true } 30) }
        catch { if ($_.Exception.Message -notmatch 'not modified') { Catat 'PROGRES' ('edit gagal: ' + $_.Exception.Message) | Out-Null } }
    }
    $P.Terakhir = Get-Date; $P.Inti = $inti
}
function ProgresLangkah($P, [string]$k, [string]$status = '', $info = $null, $fraksi = $null) {
    if (-not $P) { return }
    $x = $P.Langkah | Where-Object { $_.Kunci -eq $k } | Select-Object -First 1
    if (-not $x) { return }
    if ($status -and $status -ne $x.Status) {
        $x.Status = $status
        if ($status -eq 'jalan' -and -not $x.Mulai) { $x.Mulai = Get-Date }
        if ($status -in @('ok', 'peringatan', 'gagal', 'lewat')) { if (-not $x.Mulai) { $x.Mulai = Get-Date }; $x.Selesai = Get-Date; $x.Fraksi = 1.0 }
    }
    if ($null -ne $info) { $x.Info = [string]$info }
    if ($null -ne $fraksi) { $x.Fraksi = [Math]::Max(0.0, [Math]::Min(1.0, [double]$fraksi)) }
    ProgresTampil $P
}
function ProgresSub($P, [string[]]$sub) { if ($P) { $P.Sub = @($sub); ProgresTampil $P -Paksa } }
function ProgresSelesai($P, [string]$status, [string[]]$akhir = @()) {
    if (-not $P) { return $false }
    $P.Persen = ProgresPersen $P
    foreach ($x in $P.Langkah) {
        if ($x.Status -eq 'tunggu') { $x.Status = 'lewat' }
        elseif ($x.Status -eq 'jalan') { $x.Status = $(if ($status -eq 'gagal') { 'gagal' } else { 'ok' }); $x.Selesai = Get-Date }
    }
    $P.Status = $status; $P.Selesai = Get-Date; $P.Akhir = @($akhir)
    ProgresTampil $P -Paksa
    return [bool]$P.Pesan.Count
}

# ---- status antar-proses (skrip anak menulis, induk membaca) ----
function TulisProgres([string]$nama, [hashtable]$isi) {
    try {
        $isi.waktu = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        [IO.File]::WriteAllText((Join-Path $AA_Dasar "progres_$nama.json"), ($isi | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding($false)))
    } catch {}
}
function BacaProgres([string]$nama) {
    $f = Join-Path $AA_Dasar "progres_$nama.json"
    if (-not (Test-Path $f)) { return $null }
    try { return ([IO.File]::ReadAllText($f) | ConvertFrom-Json) } catch { return $null }
}
# Baris log hari ini yang baru ditulis sejak posisi $Pos.Nilai (byte); $Pos = @{ Nilai = <panjang awal> }
function PosisiLog { $f = Join-Path $AA_DirLog ((Get-Date -Format 'yyyy-MM-dd') + '.log'); if (Test-Path $f) { return @{ File = $f; Nilai = (Get-Item $f).Length } }; return @{ File = $f; Nilai = 0 } }
function LogBaru([hashtable]$Pos) {
    if (-not (Test-Path $Pos.File)) { return @() }
    $fs = [IO.File]::Open($Pos.File, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($fs.Length -le $Pos.Nilai) { return @() }
        [void]$fs.Seek($Pos.Nilai, [IO.SeekOrigin]::Begin)
        $buf = New-Object byte[] ($fs.Length - $Pos.Nilai)
        $n = $fs.Read($buf, 0, $buf.Length)
        $teks = [Text.Encoding]::UTF8.GetString($buf, 0, $n)
        $akhir = $teks.LastIndexOf("`n")
        if ($akhir -lt 0) { return @() }
        $Pos.Nilai += [Text.Encoding]::UTF8.GetByteCount($teks.Substring(0, $akhir + 1))
        return @($teks.Substring(0, $akhir) -split "`r?`n" | Where-Object { $_ })
    } finally { $fs.Dispose() }
}
# Jalankan skrip anak tanpa menunggu buta: $tiap dipanggil tiap ±1,5 dtk selama anak berjalan.
function JalankanAnak([string]$skrip, [string[]]$arg = @(), [scriptblock]$tiap = $null) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $AA_Dasar $skrip))) +
         @($arg | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $a -WindowStyle Hidden -PassThru
    $null = $p.Handle
    while (-not $p.HasExited) {
        Start-Sleep -Milliseconds 1500
        if ($tiap) { try { & $tiap } catch { Catat 'PROGRES' ('pantau: ' + $_.Exception.Message) | Out-Null } }
    }
    $p.WaitForExit()
    if ($tiap) { try { & $tiap } catch {} }
    return $p.ExitCode
}

# ---- tampilan bersama: tahap download mesin (dibaca dari progres_download.json) ----
$Global:AA_LangkahDownload = @(
    @{ k = 'koneksi'; n = 'Cek koneksi mesin'; b = 1 },
    @{ k = 'att';     n = 'Siapkan & buka Att'; b = 2 },
    @{ k = 'tarik';   n = 'Tarik data dari mesin'; b = 5 }
)
function ProgresDariDownload($P) {
    $d = BacaProgres 'download'
    if (-not $d) { return }
    $mesin = @($d.mesin); $n = $mesin.Count
    $putus = @($d.putus | Where-Object { $_ })
    if ($d.tahap -eq 'cek') { ProgresLangkah $P 'koneksi' 'jalan' ('{0} mesin' -f $n); return }
    ProgresLangkah $P 'koneksi' $(if ($putus.Count) { 'peringatan' } else { 'ok' }) $(if ($putus.Count) { ('{0}/{1} terjangkau · ❗ {2}' -f ($n - $putus.Count), $n, (Html ($putus -join ', '))) } else { ('{0}/{0} terjangkau' -f $n) })
    $teksAtt = @{ tutup = 'menutup Att'; siapkan = 'menyiapkan jadwal tarik'; login = 'membuka & login Att' }
    if ($teksAtt.ContainsKey([string]$d.tahap)) { ProgresLangkah $P 'att' 'jalan' $teksAtt[[string]$d.tahap]; return }
    ProgresLangkah $P 'att' 'ok' ''
    $ok = @($d.ok | Where-Object { $_ }); $gagal = @($d.gagal | Where-Object { $_ })
    if ($d.tahap -eq 'tunggu') { ProgresLangkah $P 'tarik' 'jalan' ('Att mulai menarik pukul {0}' -f $d.picu) 0.03; return }
    if ($d.tahap -eq 'tarik') {
        $info = '{0}/{1}' -f $ok.Count, $n
        if ($ok.Count) { $info += ' · ✓ ' + (Html ($ok -join ', ')) }
        if ($gagal.Count) { $info += ' · ✗ ' + (Html ($gagal -join ', ')) }
        if ($d.terkunci -and -not $ok.Count) { $info += ' · menunggu log Att' }
        ProgresLangkah $P 'tarik' 'jalan' $info ([Math]::Max(0.05, ($ok.Count + $gagal.Count) / [Math]::Max(1, $n)))
        return
    }
    if ($d.tahap -eq 'selesai') {
        $info = '{0}/{1} berhasil' -f $ok.Count, $n
        if ($gagal.Count) { $info += ' · ✗ ' + (Html ($gagal -join ', ')) }
        ProgresLangkah $P 'tarik' $(if (-not $ok.Count) { 'gagal' } elseif ($gagal.Count) { 'peringatan' } else { 'ok' }) $info
    }
    if ($d.tahap -eq 'gagal') { ProgresLangkah $P 'tarik' 'gagal' (Html ([string]$d.pesan)) }
}
