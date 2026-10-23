# =====================================================================
#  sinkron_gsheet.ps1  -  Sinkron GSheet dari Telegram (/sinkron)
#
#  Memanggil aksi `sinkron_gsheet_bot` di web app Apps Script project
#  `absen` (lihat apps-script/SinkronGsheet.gs):
#    Tabel Data (DB_FIX) -> sheet db1-absen di file DB_ABSEN bulan berjalan,
#    lalu Sinkron Absensi (ABSENSI -> ABSENSI-email).
#  Tujuan & periode diatur dari web: Rekap -> tab "Sinkron GSheet".
#
#  SETUP SEKALI (PowerShell di PC ini):
#    1. Di editor Apps Script project `absen`, jalankan SINKRON_BOT_KUNCI_BUAT
#       lalu salin kunci dari Log (Eksekusi -> Log).
#    2. powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\sinkron_gsheet.ps1 -Setel
#       tempel kunci (disimpan terenkripsi DPAPI di sinkron_gsheet.dat).
#       URL web app bawaan = deployment produksi; ganti lewat sinkron_gsheet.json { "url": "..." }.
#    Atau dari Telegram, di CHAT PRIBADI dengan bot (admin): /sinkron kunci <kunci>
#
#  Dipanggil bot:  sinkron_gsheet.ps1 -Aksi sinkron|status -Chat <id> -Peminta <nama>
# =====================================================================
param(
    [ValidateSet('sinkron', 'status')][string]$Aksi = 'sinkron',
    [switch]$Setel,
    [string]$Kunci = '',
    [string]$Chat = '',
    [string]$Peminta = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'SINKRON'
$FileKunci = Join-Path $AA_Dasar 'sinkron_gsheet.dat'
$FileKonfig = Join-Path $AA_Dasar 'sinkron_gsheet.json'
$UrlBawaan = 'https://script.google.com/macros/s/AKfycbzUH1Q7iVAii82YGg_mObckPCZdMxd-bzjURra0VvaCulR0nS1PeE4HiGA-cRLVVDgD/exec'

function UrlWebApp {
    if (Test-Path $FileKonfig) {
        try { $j = Get-Content $FileKonfig -Raw | ConvertFrom-Json; if ($j.url) { return [string]$j.url } } catch {}
    }
    return $UrlBawaan
}
function Lapor([string]$teks) {
    if ($Chat) { KirimTelegram $teks $Chat } else { Write-Output (($teks -replace '<[^>]+>', '') -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&') }
}

# Titipan sekali pakai: kunci ditaruh polos di sinkron_gsheet_kunci.txt
# (mis. disalin dari jarak jauh) -> dienkripsi DPAPI lalu file polosnya dihapus.
$FileTitipan = Join-Path $AA_Dasar 'sinkron_gsheet_kunci.txt'
if (-not $Kunci -and (Test-Path $FileTitipan)) {
    $t = ([IO.File]::ReadAllText($FileTitipan)).Trim()
    if ($t -match '^[0-9a-fA-F]{32,128}$') {
        SimpanDpapi $FileKunci $t
        Catat $T 'kunci dari titipan disimpan (DPAPI)' | Out-Null
    } else { Catat $T 'titipan kunci tidak valid, diabaikan' | Out-Null }
    Remove-Item $FileTitipan -Force -ErrorAction SilentlyContinue
}

if ($Setel -or $Kunci) {
    if (-not $Kunci) {
        $s = Read-Host 'Tempel kunci dari Log SINKRON_BOT_KUNCI_BUAT' -AsSecureString
        $Kunci = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    }
    $Kunci = $Kunci.Trim()
    if ($Kunci -notmatch '^[0-9a-fA-F]{32,128}$') { Lapor '❌ Kunci tidak dikenali (harus 64 karakter heksadesimal dari Log Apps Script).'; exit 1 }
    SimpanDpapi $FileKunci $Kunci
    # langsung uji dengan perintah status (tidak mengubah apa pun)
    try {
        $res = PostJson (UrlWebApp) @{ action = 'sinkron_gsheet_bot'; kunci = $Kunci; perintah = 'status'; oleh = 'setel' } @{} 120
        if ($res.result -ne 'success') { throw [string]$res.message }
        Lapor ("✅ Kunci sinkron GSheet tersimpan dan diterima web app.`n`n" + (Html ([string]$res.message)))
    } catch {
        Lapor ('⚠️ Kunci tersimpan, tapi uji ke web app gagal: ' + (Html $_.Exception.Message))
    }
    Catat $T 'kunci disetel' | Out-Null
    exit 0
}

try {
    $kunciSah = BacaDpapi $FileKunci
    if (-not $kunciSah) {
        throw 'Kunci belum disetel. Jalankan di PC: sinkron_gsheet.ps1 -Setel (atau /sinkron kunci <kunci> di chat pribadi dengan bot).'
    }
    $mulai = Get-Date
    if ($Aksi -eq 'sinkron') { Lapor ('🔄 Sinkron GSheet dimulai{0}. Biasanya 1–3 menit…' -f $(if ($Peminta) { ' oleh ' + (Html $Peminta) } else { '' })) }
    $res = PostJson (UrlWebApp) @{ action = 'sinkron_gsheet_bot'; kunci = $kunciSah; perintah = $Aksi; oleh = $Peminta } @{} 380
    $dtk = [int]((Get-Date) - $mulai).TotalSeconds
    if ($res.result -ne 'success') { throw [string]$res.message }
    if ($Aksi -eq 'status') {
        Lapor ("📊 <b>Status Sinkron GSheet</b>`n`n" + (Html ([string]$res.message)))
    } else {
        Lapor (("🔄 <b>Sinkron GSheet selesai</b> · {0} dtk`n`n" -f $dtk) + (Html ([string]$res.message)))
    }
    Catat $T ("{0} oleh {1}: {2}" -f $Aksi, $Peminta, ([string]$res.message -replace '\s+', ' ')) | Out-Null
} catch {
    $pesan = $_.Exception.Message
    if ($pesan -match 'timed out|waktu habis|operation has timed out') {
        $pesan = 'Web app tidak menjawab dalam 6 menit. Sinkron mungkin tetap selesai di server — cek dengan /sinkron status.'
    }
    Catat $T ('gagal: ' + $pesan) | Out-Null
    Lapor ('❌ Sinkron GSheet gagal: ' + (Html $pesan))
    exit 1
}
