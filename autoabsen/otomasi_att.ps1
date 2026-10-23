# =====================================================================
#  otomasi_att.ps1  -  Kalkulasi + Ekspor data di Att, lalu impor ke
#                      absensi.jpt.co.id (impor_absen.ps1)
#  Lokasi : D:\AutoAbsen\otomasi_att.ps1
#  WAJIB jalan elevated (Att berjalan sebagai admin). Dijadwalkan oleh
#  pasang_jadwal.ps1 jam 12:25, 18:25, 01:25 (sesudah verifikasi download).
#
#  Langkah:
#   1. Cari jendela "Kalkulasi Kehadiran" (TfAttCalc); kalau belum terbuka,
#      klik tombol toolbar "Laporan" di jendela utama Att.
#   2. Isi rentang tanggal: awal periode (tgl 21) s/d hari ini.
#   3. Klik "Kalkulasi", tunggu sampai Att selesai.
#   4. Klik "Ekspor data", isi nama file di dialog Save As, klik Save.
#   5. Cek file: rentang tanggal di file HARUS sama dengan yang diminta,
#      lalu jalankan impor_absen.ps1 untuk file itu.
#
#  Uji tanpa impor:  ... otomasi_att.ps1 -TanpaImpor
# =====================================================================
param(
    [switch]$TanpaImpor,
    [ValidateSet('upsert','periode','replace')] [string]$Mode = 'upsert',
    [string]$Dari = '',      # yyyy-MM-dd, kosong = awal periode berjalan (tgl 21)
    [string]$Sampai = ''     # yyyy-MM-dd, kosong = hari ini
)
$ErrorActionPreference = 'Stop'
$Dasar     = Split-Path -Parent $MyInvocation.MyCommand.Path
$DirEkspor = Join-Path $Dasar 'ekspor'
$DirLog    = Join-Path $Dasar 'log'
New-Item -ItemType Directory -Force -Path $DirLog, $DirEkspor | Out-Null
$FileLog    = Join-Path $DirLog ((Get-Date -Format 'yyyy-MM-dd') + '.log')
$FileStatus = Join-Path $Dasar 'status_terakhir.txt'
$AttExe     = 'C:\Program Files (x86)\Att\Att.exe'

function Tulis([string]$teks) {
    $b = '{0}  [ATT]  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $teks
    Add-Content -Path $FileLog -Value $b -Encoding UTF8
    Write-Output $b
}

Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class AttUi {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr a, uint s, uint t, uint pr);
  [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr p, IntPtr a, uint s, uint t);
  [DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr p, IntPtr a, byte[] b, uint s, out IntPtr w);
  [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr p, IntPtr a, byte[] b, uint s, out IntPtr r);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

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
  public static IntPtr CariAnak(IntPtr induk, string kelas, string teks) {
    foreach (var c in Anak(induk)) {
      if (kelas != null && Kelas(c) != kelas) continue;
      if (teks != null && Teks(c) != teks) continue;
      return c;
    }
    return IntPtr.Zero;
  }
  public static bool Responsif(IntPtr h, uint ms) {
    IntPtr r; return SendMessageTimeout(h, 0, IntPtr.Zero, IntPtr.Zero, 0x0002, ms, out r) != IntPtr.Zero;
  }
  static IntPtr L(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }
  public static void KlikKlien(IntPtr h, int x, int y) {
    PostMessage(h, 0x0201, (IntPtr)1, L(x, y)); PostMessage(h, 0x0202, IntPtr.Zero, L(x, y));
  }

  // --- memori di proses Att (Att 32-bit) ---
  static IntPtr Buka(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid); }

  static byte[] SystemTime(int y, int m, int d) {
    var b = new byte[16];
    BitConverter.GetBytes((ushort)y).CopyTo(b, 0); BitConverter.GetBytes((ushort)m).CopyTo(b, 2);
    BitConverter.GetBytes((ushort)(int)new DateTime(y, m, d).DayOfWeek).CopyTo(b, 4);
    BitConverter.GetBytes((ushort)d).CopyTo(b, 6);
    return b;
  }

  // Isi TDateTimePicker Delphi. DTM_SETSYSTEMTIME hanya mengubah TAMPILAN;
  // nilai yang dipakai Att (VCL) baru berubah lewat notifikasi. Karena itu
  // ditiru urutan orang memilih dari kalender: DROPDOWN -> DATETIMECHANGE ->
  // CLOSEUP (VCL membaca ulang tanggal & memicu OnChange/OnCloseUp).
  static void Kirim(IntPtr p, IntPtr mem, IntPtr dtp, int kode, byte[] st) {
    IntPtr w; var nm = new byte[32];
    BitConverter.GetBytes(dtp.ToInt32()).CopyTo(nm, 0);
    BitConverter.GetBytes(GetDlgCtrlID(dtp)).CopyTo(nm, 4);
    BitConverter.GetBytes(kode).CopyTo(nm, 8);
    BitConverter.GetBytes(0).CopyTo(nm, 12);          // GDT_VALID
    if (st != null) st.CopyTo(nm, 16);
    WriteProcessMemory(p, mem, nm, 32, out w);
    SendMessage(GetParent(dtp), 0x004E, (IntPtr)GetDlgCtrlID(dtp), mem); // WM_NOTIFY
  }
  public static string SetTanggal(IntPtr dtp, int y, int m, int d) {
    IntPtr p = Buka(dtp); if (p == IntPtr.Zero) return "OpenProcess gagal";
    IntPtr mem = VirtualAllocEx(p, IntPtr.Zero, 64, 0x3000, 0x04);
    try {
      IntPtr w; var st = SystemTime(y, m, d);
      WriteProcessMemory(p, mem, st, 16, out w);
      SendMessage(dtp, 0x1002, IntPtr.Zero, mem);   // DTM_SETSYSTEMTIME
      Kirim(p, mem, dtp, -754, null);               // DTN_DROPDOWN
      WriteProcessMemory(p, mem, st, 16, out w);
      SendMessage(dtp, 0x1002, IntPtr.Zero, mem);
      Kirim(p, mem, dtp, -759, st);                 // DTN_DATETIMECHANGE
      WriteProcessMemory(p, mem, st, 16, out w);
      SendMessage(dtp, 0x1002, IntPtr.Zero, mem);
      Kirim(p, mem, dtp, -753, null);               // DTN_CLOSEUP
      return "";
    } finally { VirtualFreeEx(p, mem, 0, 0x8000); CloseHandle(p); }
  }

  // ---- Isi tanggal lewat tombol panah (cara yang sama dengan orang mengetik) ----
  // Tiap tekanan VK_UP/VK_DOWN membuat kontrol sendiri mengirim
  // DTN_DATETIMECHANGE ke Att, jadi nilai yang dipakai Kalkulasi ikut berubah.
  // Tampilan dibaca ulang setelah tiap langkah (loop tertutup).
  static void Tekan(IntPtr h, int vk) {
    SendMessage(h, 0x0100, (IntPtr)vk, (IntPtr)1);
    SendMessage(h, 0x0101, (IntPtr)vk, unchecked((IntPtr)(int)0xC0000001));
  }
  public static int[] Baca(IntPtr dtp) {   // {hari, bulan, tahun} dari "dd/MM/yyyy"
    var m = System.Text.RegularExpressions.Regex.Match(Teks(dtp), @"(\d{1,2})\D(\d{1,2})\D(\d{4})");
    if (!m.Success) return null;
    return new int[] { int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value) };
  }
  static int FieldAktif(IntPtr dtp) {      // 0=hari 1=bulan 2=tahun, -1 tak diketahui
    var a = Baca(dtp); Tekan(dtp, 0x26); var b = Baca(dtp); Tekan(dtp, 0x28);
    if (a == null || b == null) return -1;
    if (a[2] != b[2]) return 2; if (a[1] != b[1]) return 1; if (a[0] != b[0]) return 0; return -1;
  }
  static bool KeField(IntPtr dtp, int target, StringBuilder log) {
    for (int coba = 0; coba < 6; coba++) {
      int f = FieldAktif(dtp);
      if (f == target) return true;
      if (f < 0) { Tekan(dtp, 0x27); continue; }
      int vk = target > f ? 0x27 : 0x25;            // VK_RIGHT / VK_LEFT
      for (int i = 0; i < Math.Abs(target - f); i++) Tekan(dtp, vk);
    }
    log.Append(" [field " + target + " tak tercapai]");
    return false;
  }
  static bool Atur(IntPtr dtp, int field, int nilai, StringBuilder log) {
    if (!KeField(dtp, field, log)) return false;
    for (int i = 0; i < 70; i++) {
      var v = Baca(dtp); if (v == null) return false;
      if (v[field] == nilai) return true;
      Tekan(dtp, v[field] < nilai ? 0x26 : 0x28);   // VK_UP / VK_DOWN
    }
    return false;
  }
  public static string SetTanggalKeyboard(IntPtr dtp, int y, int m, int d) {
    var log = new StringBuilder();
    // tahun dulu, lalu bulan, lalu hari (hari bisa terpotong saat bulan berubah)
    if (!Atur(dtp, 2, y, log)) return "tahun gagal" + log;
    if (!Atur(dtp, 1, m, log)) return "bulan gagal" + log;
    if (!Atur(dtp, 0, d, log)) return "hari gagal" + log;
    var v = Baca(dtp);
    if (v == null || v[0] != d || v[1] != m || v[2] != y) return "hasil akhir " + Teks(dtp) + log;
    return "";
  }

  // Cari tombol toolbar berdasarkan teksnya, kembalikan titik tengahnya (koordinat klien).
  public static int[] TombolToolbar(IntPtr tb, string teks) {
    int n = (int)SendMessage(tb, 0x0418, IntPtr.Zero, IntPtr.Zero); // TB_BUTTONCOUNT
    IntPtr p = Buka(tb); if (p == IntPtr.Zero) return null;
    IntPtr mem = VirtualAllocEx(p, IntPtr.Zero, 1024, 0x3000, 0x04);
    try {
      for (int i = 0; i < n; i++) {
        IntPtr r; var buf = new byte[20];
        SendMessage(tb, 0x0417, (IntPtr)i, mem);                    // TB_GETBUTTON -> TBBUTTON (32-bit, 20 byte)
        ReadProcessMemory(p, mem, buf, 20, out r);
        int id = BitConverter.ToInt32(buf, 4);
        int len = (int)SendMessage(tb, 0x044B, (IntPtr)id, mem);    // TB_GETBUTTONTEXTW
        string t = "";
        if (len > 0 && len < 200) { var tbuf = new byte[(len + 1) * 2]; ReadProcessMemory(p, mem, tbuf, (uint)tbuf.Length, out r); t = Encoding.Unicode.GetString(tbuf, 0, len * 2); }
        if (t.Replace("&", "").Trim() == teks) {
          SendMessage(tb, 0x041D, (IntPtr)i, mem);                  // TB_GETITEMRECT
          var rb = new byte[16]; ReadProcessMemory(p, mem, rb, 16, out r);
          int l = BitConverter.ToInt32(rb, 0), tp = BitConverter.ToInt32(rb, 4), rr = BitConverter.ToInt32(rb, 8), bb = BitConverter.ToInt32(rb, 12);
          return new int[] { (l + rr) / 2, (tp + bb) / 2 };
        }
      }
      return null;
    } finally { VirtualFreeEx(p, mem, 0, 0x8000); CloseHandle(p); }
  }
}
"@

function JendelaAtt([string]$kelas, [string]$judul = $null) {
    $p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $p) { return [IntPtr]::Zero }
    foreach ($w in [AttUi]::Atas([uint32]$p.Id)) {
        if ([AttUi]::Kelas($w) -ne $kelas) { continue }
        if ($judul -and ([AttUi]::Teks($w) -notlike $judul)) { continue }
        return $w
    }
    return [IntPtr]::Zero
}

function TungguIdle([IntPtr]$h, [int]$maksDetik) {
    # Att sibuk = UI thread tidak membalas. Dianggap selesai bila responsif 3x berturut-turut.
    $mulai = Get-Date; $ok = 0
    while (((Get-Date) - $mulai).TotalSeconds -lt $maksDetik) {
        Start-Sleep -Seconds 2
        if ([AttUi]::Responsif($h, 3000)) { $ok++ } else { $ok = 0 }
        if ($ok -ge 3) { return $true }
    }
    return $false
}

function Tombol([IntPtr]$w, [string]$pola) {
    [AttUi]::Anak($w) | Where-Object { ([AttUi]::Kelas($_) -in @('Button', 'TButton', 'TBitBtn')) -and ([AttUi]::Teks($_) -match $pola) } | Select-Object -First 1
}
function Klik([IntPtr]$h) { [void][AttUi]::PostMessage($h, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }

function JenisDialog([IntPtr]$w) {
    $judul = [AttUi]::Teks($w)
    if ($judul -like 'Pengaturan Ekspor*') { return 'pengaturan' }
    if ([AttUi]::Kelas($w) -ne '#32770' -and [AttUi]::Kelas($w) -ne 'TMessageForm') { return '' }
    if ([AttUi]::CariAnak($w, 'ComboBoxEx32', $null) -ne [IntPtr]::Zero) { return 'saveas' }
    if ($judul -like 'Confirm Save As*') { return 'timpa' }
    return 'pesan'
}

function TutupPesan([switch]$Semua) {
    # Tanpa -Semua: hanya pesan info Att (OK) yang ditutup.
    # Dengan -Semua (awal script): dialog sisa dibatalkan -- Save As -> Cancel,
    # Confirm Save As -> No, Pengaturan Ekspor -> Batal. Tidak pernah "Yes".
    $catat = @()
    for ($ulang = 0; $ulang -lt 4; $ulang++) {
        $p = Get-Process -Name Att -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $p) { break }
        $ada = $false
        foreach ($w in [AttUi]::Atas([uint32]$p.Id)) {
            $j = JenisDialog $w
            if (-not $j) { continue }
            if (-not $Semua -and $j -ne 'pesan') { continue }
            $isi = ([AttUi]::Anak($w) | Where-Object { [AttUi]::Kelas($_) -notin @('Button','TButton','TBitBtn') } | ForEach-Object { [AttUi]::Teks($_) } | Where-Object { $_ }) -join ' / '
            $catat += ('[{0}] "{1}": {2}' -f $j, [AttUi]::Teks($w), $isi)
            switch ($j) {
                'pesan'      { $t = Tombol $w '^&?(OK|Ok)$' }
                'saveas'     { $t = [AttUi]::Anak($w) | Where-Object { [AttUi]::GetDlgCtrlID($_) -eq 2 -and [AttUi]::Kelas($_) -eq 'Button' } | Select-Object -First 1 }
                'timpa'      { $t = Tombol $w '^&?(No|Tidak)$' }
                'pengaturan' { $t = Tombol $w '^&?(Batal|Cancel)$' }
            }
            if ($t) { Klik $t; $ada = $true } else { $catat += '  (tombol tidak ditemukan)' }
        }
        if (-not $ada) { break }
        Start-Sleep -Seconds 2
    }
    return $catat
}

function TutupKalkulasi {
    # Kembalikan Att ke tampilan utama supaya Auto Monitor (download 12:00/18:00/01:00) tidak terganggu.
    try {
        foreach ($x in (TutupPesan)) { Tulis "Pesan ditutup: $x" }
        $c = JendelaAtt 'TfAttCalc'
        if ($c -ne [IntPtr]::Zero) { [void][AttUi]::PostMessage($c, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); Tulis 'Jendela Kalkulasi ditutup' }
    } catch {}
}

# =====================================================================
try {
    $hariIni = (Get-Date).Date
    if ($Sampai) { $tAkhir = [datetime]::ParseExact($Sampai, 'yyyy-MM-dd', $null) } else { $tAkhir = $hariIni }
    if ($Dari) { $tAwal = [datetime]::ParseExact($Dari, 'yyyy-MM-dd', $null) }
    else {
        # periode gaji 21 s/d 20
        if ($tAkhir.Day -ge 21) { $tAwal = Get-Date -Year $tAkhir.Year -Month $tAkhir.Month -Day 21 }
        else { $b = $tAkhir.AddMonths(-1); $tAwal = Get-Date -Year $b.Year -Month $b.Month -Day 21 }
        $tAwal = $tAwal.Date
    }
    Tulis ('=== Kalkulasi {0:dd/MM/yyyy} s/d {1:dd/MM/yyyy} ===' -f $tAwal, $tAkhir)

    # 0a. Pilihan Laporan tersimpan di Att.dat (Nama, Dept, tanggal) dan dibaca Att saat dibuka.
    #     Paksa Nama = <Semua> (-1) dan tanggal = rentang ini, supaya pilihan manual
    #     seseorang (mis. satu karyawan) tidak terbawa. Att menulis Att.dat saat keluar,
    #     jadi Att ditutup dulu.
    . (Join-Path $Dasar 'umum.ps1')
    if (AttJalan) { [void](TutupAtt 'ATT'); Start-Sleep -Seconds 2 }
    $datFile = Join-Path $AA_AttDir 'Att.dat'
    if (Test-Path $datFile) {
        $enc = [Text.Encoding]::Default
        $isiDat = [IO.File]::ReadAllText($datFile, $enc)
        $isiBaru = [regex]::Replace($isiDat, '(?m)^((?!Temp-)\w+_RANGE_User)=.*$', '$1=-1')
        $isiBaru = [regex]::Replace($isiBaru, '(?m)^((?!Temp-)\w+_RANGE_D1)=.*$', ('$1=' + $tAwal.ToString('yyyy-MM-dd') + ' 00:00:00'))
        $isiBaru = [regex]::Replace($isiBaru, '(?m)^((?!Temp-)\w+_RANGE_D2)=.*$', ('$1=' + $tAkhir.ToString('yyyy-MM-dd') + ' 23:59:00'))
        # Dept dipaksa JPT GRUP (56): pilihan Dept di Att (menu Laporan / Jejak) ikut tersimpan di sini,
        # mis. 19 Okt 12:00 tersisa Dept=77 (BTR) -> ekspor cuma 993 baris dan impor ditolak pengaman 80%.
        $isiBaru = [regex]::Replace($isiBaru, '(?m)^((?!Temp-)\w+_RANGE_Dept)=.*$', '$1=56')
        if ($isiBaru -ne $isiDat) { [IO.File]::WriteAllText($datFile, $isiBaru, $enc); Tulis 'Att.dat: Nama=<Semua>, Dept=JPT GRUP, tanggal disetel' }
        $dept = [regex]::Match($isiBaru, '(?m)^Admin_RANGE_Dept=(.*)$').Groups[1].Value.Trim()
        if ($dept) { Tulis "Att.dat: Dept=$dept" }
    }

    # 0. Att harus jalan & sudah login
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dasar 'buka_att.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Att tidak bisa dibuka/login (lihat baris [BUKA] di log).' }
    foreach ($s in (TutupPesan -Semua)) { Tulis "Dialog sisa ditutup: $s" }

    # 1. Jendela Kalkulasi Kehadiran
    $calc = JendelaAtt 'TfAttCalc'
    if ($calc -eq [IntPtr]::Zero) {
        $utama = JendelaAtt 'TFormAttMain'
        if ($utama -eq [IntPtr]::Zero) { throw 'Jendela utama Att tidak ditemukan.' }
        $tb = [AttUi]::CariAnak($utama, 'TJvToolBar', $null)
        $pt = [AttUi]::TombolToolbar($tb, 'Laporan')
        if (-not $pt) { throw 'Tombol toolbar "Laporan" tidak ditemukan.' }
        Tulis ('Buka Laporan (toolbar {0},{1})' -f $pt[0], $pt[1])
        [AttUi]::KlikKlien($tb, $pt[0], $pt[1])
        for ($i = 0; $i -lt 30 -and $calc -eq [IntPtr]::Zero; $i++) { Start-Sleep -Seconds 2; $calc = JendelaAtt 'TfAttCalc' }
        if ($calc -eq [IntPtr]::Zero) { throw 'Jendela Kalkulasi Kehadiran tidak muncul.' }
        [void](TungguIdle $calc 60)
    }

    # 2. Rentang tanggal: dua TDateTimePicker yang terlihat di grup "Jarak Waktu" (atas = awal, bawah = akhir)
    $grup = [AttUi]::CariAnak($calc, 'TGroupBox', 'Jarak Waktu')
    if ($grup -eq [IntPtr]::Zero) { throw 'Grup "Jarak Waktu" tidak ditemukan.' }
    $dtp = [AttUi]::Anak($grup) | Where-Object { [AttUi]::Kelas($_) -eq 'TDateTimePicker' -and [AttUi]::IsWindowVisible($_) } |
           ForEach-Object { $r = New-Object AttUi+RECT; [void][AttUi]::GetWindowRect($_, [ref]$r); [pscustomobject]@{ H = $_; Y = $r.T } } |
           Sort-Object Y
    if (@($dtp).Count -ne 2) { throw ('Kolom tanggal tidak ditemukan (ketemu {0}).' -f @($dtp).Count) }
    foreach ($pasang in @(@($dtp[0].H, $tAwal), @($dtp[1].H, $tAkhir))) {
        $e = [AttUi]::SetTanggalKeyboard($pasang[0], $pasang[1].Year, $pasang[1].Month, $pasang[1].Day)
        if ($e) { throw ("Gagal mengisi tanggal {0:dd/MM/yyyy}: {1}" -f $pasang[1], $e) }
    }
    Start-Sleep -Milliseconds 500
    Tulis ('Tanggal terisi: {0} s/d {1}' -f [AttUi]::Teks($dtp[0].H), [AttUi]::Teks($dtp[1].H))

    # 3. Kalkulasi
    $btnCalc = [AttUi]::CariAnak($calc, 'TBitBtn', 'Kalkulasi')
    if ($btnCalc -eq [IntPtr]::Zero) { throw 'Tombol Kalkulasi tidak ditemukan.' }
    if (-not [AttUi]::IsWindowEnabled($btnCalc)) { throw 'Tombol Kalkulasi nonaktif (ada dialog lain terbuka di Att?).' }
    $t0 = Get-Date
    Klik $btnCalc
    Start-Sleep -Seconds 15
    $selesai = $false; $ok = 0
    while (((Get-Date) - $t0).TotalSeconds -lt 900) {
        Start-Sleep -Seconds 3
        foreach ($s in (TutupPesan)) { Tulis "Pesan saat kalkulasi: $s" }
        if ([AttUi]::Responsif($calc, 3000) -and [AttUi]::IsWindowEnabled($btnCalc) -and [AttUi]::IsWindowEnabled($calc)) { $ok++ } else { $ok = 0 }
        if ($ok -ge 4) { $selesai = $true; break }
    }
    if (-not $selesai) { throw 'Kalkulasi tidak selesai dalam 15 menit.' }
    Tulis ('Kalkulasi selesai ({0:n0} detik)' -f ((Get-Date) - $t0).TotalSeconds)

    # 4. Ekspor data -> dialog Save As
    $tab = [AttUi]::CariAnak($calc, 'TTabSheet', 'Status Shift')
    if ($tab -ne [IntPtr]::Zero -and -not [AttUi]::IsWindowVisible($tab)) { Tulis 'PERINGATAN: tab Status Shift tidak aktif' }
    $btnEks = [AttUi]::CariAnak($calc, 'TBitBtn', 'Ekspor data')
    if ($btnEks -eq [IntPtr]::Zero) { throw 'Tombol Ekspor data tidak ditemukan.' }
    $nama = Join-Path $DirEkspor ('absen_{0:yyyyMMdd_HHmm}.xls' -f (Get-Date))
    Klik $btnEks
    $dlg = [IntPtr]::Zero; $sudahOk = $false
    for ($i = 0; $i -lt 90 -and $dlg -eq [IntPtr]::Zero; $i++) {
        Start-Sleep -Seconds 1
        $p = Get-Process -Name Att | Select-Object -First 1
        foreach ($w in [AttUi]::Atas([uint32]$p.Id)) {
            $j = JenisDialog $w
            if ($j -eq 'saveas') { $dlg = $w; break }
            if ($j -eq 'pengaturan' -and -not $sudahOk) {
                $t = Tombol $w '^&?(OK|Ok)$'
                if (-not $t) { throw 'Tombol OK di "Pengaturan Ekspor" tidak ditemukan.' }
                Tulis 'Pengaturan Ekspor -> OK'
                Klik $t; $sudahOk = $true
            }
        }
    }
    if ($dlg -eq [IntPtr]::Zero) { throw 'Dialog Save As tidak muncul setelah Ekspor data.' }
    $cbx  = [AttUi]::CariAnak($dlg, 'ComboBoxEx32', $null)
    $edit = [AttUi]::CariAnak($cbx, 'Edit', $null)
    [void][AttUi]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $nama)              # WM_SETTEXT
    Start-Sleep -Milliseconds 300
    $save = [AttUi]::Anak($dlg) | Where-Object { [AttUi]::GetDlgCtrlID($_) -eq 1 -and [AttUi]::Kelas($_) -eq 'Button' } | Select-Object -First 1
    Klik $save

    # tunggu file selesai ditulis (ukuran stabil & Att idle)
    $ok = $false; $ukuran = -1
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Path $nama) {
            $u = (Get-Item $nama).Length
            if ($u -gt 0 -and $u -eq $ukuran -and [AttUi]::Responsif($calc, 2000)) { $ok = $true; break }
            $ukuran = $u
        }
    }
    foreach ($s in (TutupPesan)) { Tulis "Pesan saat ekspor: $s" }
    if (-not $ok) { throw "File ekspor tidak terbentuk: $nama" }
    Tulis ('Ekspor tersimpan: {0} ({1:n0} KB)' -f $nama, ($ukuran / 1KB))
    @{ status = 'sukses'; file = (Split-Path $nama -Leaf); dari = $tAwal.ToString('yyyy-MM-dd'); sampai = $tAkhir.ToString('yyyy-MM-dd');
       kb = [int]($ukuran / 1KB); waktu = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') } | ConvertTo-Json | Set-Content -Path (Join-Path $Dasar 'hasil_ekspor.json') -Encoding UTF8

    # 5. Impor (impor_absen.ps1 memeriksa isi; di sini cek rentang tanggal dulu)
    TutupKalkulasi
    # bersihkan file ekspor buatan script ini yang berumur > 14 hari (file lain tidak disentuh)
    Get-ChildItem -Path $DirEkspor -Filter 'absen_*.xls' -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        ForEach-Object { try { Remove-Item $_.FullName -Force; Tulis "Hapus ekspor lama: $($_.Name)" } catch {} }
    $impor = Join-Path $Dasar 'impor_absen.ps1'
    if ($TanpaImpor) {
        Tulis 'TanpaImpor: cek isi file saja (tidak dikirim).'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $impor -File $nama -UjiSaja `
            -HarusDari ($tAwal.ToString('yyyy-MM-dd')) -HarusSampai ($tAkhir.ToString('yyyy-MM-dd'))
        exit $LASTEXITCODE
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $impor -File $nama `
        -HarusDari ($tAwal.ToString('yyyy-MM-dd')) -HarusSampai ($tAkhir.ToString('yyyy-MM-dd')) -Mode $Mode
    exit $LASTEXITCODE
}
catch {
    TutupKalkulasi
    Tulis ('GAGAL: ' + $_.Exception.Message)
    try { @{ status = 'gagal'; pesan = $_.Exception.Message; waktu = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') } | ConvertTo-Json | Set-Content -Path (Join-Path $Dasar 'hasil_ekspor.json') -Encoding UTF8 } catch {}
    Set-Content -Path $FileStatus -Encoding UTF8 -Value ('{0}  ATT  GAGAL: {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $_.Exception.Message)
    exit 1
}
