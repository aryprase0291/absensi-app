# =====================================================================
#  intip_att.ps1  -  Catat struktur jendela Att (nama tombol, kelas,
#                    ID) supaya langkah Kalkulasi + Ekspor bisa diotomasi
#                    tanpa klik koordinat.
#  Jalankan dari PowerShell "Run as administrator" SAAT jendela Laporan
#  (tab Status Shift) dan, kalau bisa, dialog Ekspor data sedang terbuka:
#     powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\intip_att.ps1
#  Hasil: D:\AutoAbsen\log\att_jendela_<jam>.txt  (hanya membaca, tidak mengklik apa pun)
# =====================================================================
$Dasar = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Dasar ('log\att_jendela_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null

Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class Intip {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static string Teks(IntPtr h) {
    int n = (int)SendMessage(h, 0x000E, IntPtr.Zero, IntPtr.Zero);
    if (n <= 0) return ""; if (n > 300) n = 300;
    var sb = new StringBuilder(n + 1); SendMessage(h, 0x000D, (IntPtr)(n + 1), sb); return sb.ToString();
  }
  public static string Kelas(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static List<IntPtr> Atas(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static List<IntPtr> Anak(IntPtr h) {
    var l = new List<IntPtr>(); EnumChildWindows(h, (c, x) => { l.Add(c); return true; }, IntPtr.Zero); return l;
  }
}
"@

$p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { "Att.exe tidak berjalan." | Tee-Object -FilePath $Out; exit 1 }
$baris = New-Object System.Collections.Generic.List[string]
$baris.Add("Att PID $($p.Id)  $(Get-Date)")
foreach ($w in [Intip]::Atas([uint32]$p.Id)) {
    if (-not [Intip]::IsWindowVisible($w)) { continue }
    $r = New-Object Intip+RECT; [void][Intip]::GetWindowRect($w, [ref]$r)
    $baris.Add(('=== TOP {0}  kelas={1}  judul="{2}"  rect={3},{4},{5},{6}' -f $w, [Intip]::Kelas($w), [Intip]::Teks($w), $r.L, $r.T, $r.R, $r.B))
    foreach ($c in [Intip]::Anak($w)) {
        $r = New-Object Intip+RECT; [void][Intip]::GetWindowRect($c, [ref]$r)
        $baris.Add(('  {0}  induk={1}  id={2}  vis={3}  kelas={4}  teks="{5}"  rect={6},{7},{8},{9}' -f `
            $c, [Intip]::GetParent($c), [Intip]::GetDlgCtrlID($c), [int][Intip]::IsWindowVisible($c), `
            [Intip]::Kelas($c), ([Intip]::Teks($c) -replace '\r?\n', ' '), $r.L, $r.T, $r.R, $r.B))
    }
}
# Menu utama (nama menu & item) lewat UI Automation
try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $root = [Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    $baris.Add('=== UI Automation ===')
    foreach ($e in $root.FindAll([Windows.Automation.TreeScope]::Children, $cond)) {
        foreach ($d in $e.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) {
            $ci = $d.Current
            if ($ci.Name -or $ci.AutomationId) {
                $baris.Add(('  {0,-14} name="{1}"  id="{2}"  kelas={3}' -f $ci.ControlType.ProgrammaticName.Replace('ControlType.', ''), $ci.Name, $ci.AutomationId, $ci.ClassName))
            }
        }
    }
} catch { $baris.Add("UIA gagal: $($_.Exception.Message)") }

$baris | Set-Content -Path $Out -Encoding UTF8
"Tersimpan: $Out  ($($baris.Count) baris)"
