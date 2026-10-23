# =====================================================================
#  buka_att.ps1  -  Pastikan Att berjalan DAN sudah login
#  Lokasi : D:\AutoAbsen\buka_att.ps1   (wajib elevated)
#
#  Simpan login Att sekali (terenkripsi DPAPI, hanya user ini di PC ini):
#     powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\buka_att.ps1 -SimpanLogin
#  Dipanggil oleh: cek_mesin.ps1, otomasi_att.ps1, task AutoAbsen-BukaAtt.
#  Exit 0 = Att jalan & sudah di jendela utama; 1 = gagal.
# =====================================================================
param([switch]$SimpanLogin, [int]$TungguDetik = 90)
$ErrorActionPreference = 'Stop'
$Dasar     = Split-Path -Parent $MyInvocation.MyCommand.Path
$FileLogin = Join-Path $Dasar 'login_att.dat'
$DirLog    = Join-Path $Dasar 'log'
New-Item -ItemType Directory -Force -Path $DirLog | Out-Null
$FileLog   = Join-Path $DirLog ((Get-Date -Format 'yyyy-MM-dd') + '.log')
$AttExe    = 'C:\Program Files (x86)\Att\Att.exe'

function Tulis([string]$teks) {
    $b = '{0}  [BUKA]  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $teks
    Add-Content -Path $FileLog -Value $b -Encoding UTF8
    Write-Output $b
}

if ($SimpanLogin) {
    $n = Read-Host 'Nama login Att'
    $p = Read-Host 'Password Att (kosongkan bila tanpa password)' -AsSecureString
    $pt = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))
    ConvertTo-SecureString -String ($n + "`n" + $pt) -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $FileLogin -Encoding ASCII
    Write-Output "Login Att tersimpan terenkripsi di $FileLogin"
    exit 0
}

Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class AttLogin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
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
  public static int Atas_(IntPtr h) { RECT r; GetWindowRect(h, out r); return r.T; }
}
"@

function Jendela([uint32]$procId) {
    $hasil = @{ Utama = [IntPtr]::Zero; Login = [IntPtr]::Zero }
    foreach ($w in [AttLogin]::Atas($procId)) {
        $k = [AttLogin]::Kelas($w); $j = [AttLogin]::Teks($w)
        if ($k -eq 'TFormAttMain') { $hasil.Utama = $w }
        elseif ($j -like 'Masuk ke sistem*') { $hasil.Login = $w }
    }
    return $hasil
}

try {
    $p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $p) {
        Tulis 'Att.exe tidak berjalan -> membuka'
        Start-Process -FilePath $AttExe -WorkingDirectory (Split-Path $AttExe)
    }
    $sudahIsi = $false
    $mulai = Get-Date
    while (((Get-Date) - $mulai).TotalSeconds -lt $TungguDetik) {
        Start-Sleep -Seconds 2
        $p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $p) { continue }
        $j = Jendela ([uint32]$p.Id)
        if ($j.Utama -ne [IntPtr]::Zero -and $j.Login -eq [IntPtr]::Zero) {
            if ($sudahIsi) { Tulis 'Login Att berhasil' }
            exit 0
        }
        if ($j.Login -ne [IntPtr]::Zero -and -not $sudahIsi) {
            if (-not (Test-Path $FileLogin)) { throw 'Att meminta login, tapi login belum disimpan. Jalankan: buka_att.ps1 -SimpanLogin' }
            $sec = Get-Content $FileLogin | ConvertTo-SecureString
            $isi = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
            $nama, $sandi = $isi -split "`n", 2
            # dua kotak isian: atas = Nama, bawah = Password
            $kotak = [AttLogin]::Anak($j.Login) | Where-Object { [AttLogin]::Kelas($_) -in @('TEdit','Edit','TMaskEdit') -and [AttLogin]::IsWindowVisible($_) } |
                     Sort-Object { [AttLogin]::Atas_($_) }
            if (@($kotak).Count -lt 2) { throw ('Kotak Nama/Password tidak ditemukan (ketemu {0}).' -f @($kotak).Count) }
            [void][AttLogin]::SendMessage($kotak[0], 0x000C, [IntPtr]::Zero, $nama)
            [void][AttLogin]::SendMessage($kotak[1], 0x000C, [IntPtr]::Zero, $sandi)
            $btn = [AttLogin]::Anak($j.Login) | Where-Object { [AttLogin]::Teks($_) -match '^&?Masuk$' } | Select-Object -First 1
            if (-not $btn) { throw 'Tombol Masuk tidak ditemukan.' }
            Start-Sleep -Milliseconds 300
            [void][AttLogin]::PostMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)   # BM_CLICK
            Tulis ('Login Att diisi sebagai "{0}"' -f $nama)
            $sudahIsi = $true
        }
    }
    throw ('Att belum sampai jendela utama setelah {0} detik.' -f $TungguDetik)
}
catch {
    Tulis ('GAGAL: ' + $_.Exception.Message)
    exit 1
}
