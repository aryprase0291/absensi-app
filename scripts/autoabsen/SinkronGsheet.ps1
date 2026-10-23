# =====================================================================
# Perintah Telegram /sinkron untuk bot AutoAbsen (D:\AutoAbsen)
# 23 Okt 2026
#
# /sinkron        -> jalankan Sinkron GSheet (Tabel Data -> db1-absen,
#                    lalu Sinkron Absensi ABSENSI -> ABSENSI-email)
# /sinkronstatus  -> lihat tujuan + hasil sinkron terakhir
#
# PASANG
# 1. Salin file ini ke D:\AutoAbsen\SinkronGsheet.ps1
# 2. Isi $SinkronGsheetUrl dan $SinkronGsheetKunci di bawah
#    (keduanya muncul di Log setelah menjalankan SINKRON_BOT_KUNCI_BUAT
#    di editor Apps Script project `absen`).
# 3. Di script bot utama, setelah fungsi kirim-pesan didefinisikan:
#       . "$PSScriptRoot\SinkronGsheet.ps1"
# 4. Di bagian yang memilah perintah (switch / if teks pesan), tambahkan:
#       if (Test-PerintahSinkron $text) {
#           $balas = Invoke-PerintahSinkron -Teks $text -ChatId $chatId -Oleh $fromName
#           <fungsi-kirim-pesan-bot> $chatId $balas
#       }
#    Ganti <fungsi-kirim-pesan-bot> dengan nama fungsi kirim yang sudah ada.
# =====================================================================

$SinkronGsheetUrl   = 'https://script.google.com/macros/s/AKfycbzUH1Q7iVAii82YGg_mObckPCZdMxd-bzjURra0VvaCulR0nS1PeE4HiGA-cRLVVDgD/exec'
$SinkronGsheetKunci = 'ISI_KUNCI_DARI_LOG_APPS_SCRIPT'

# Grup yang boleh menjalankan /sinkron. Kosongkan (@()) = semua chat.
# Isi chat id grup "Monitor absen" (angka negatif, mis. -1001234567890).
$SinkronGsheetChatBoleh = @()

function Test-PerintahSinkron([string]$Teks) {
    if (-not $Teks) { return $false }
    $cmd = ($Teks.Trim() -split '\s+')[0].ToLower() -replace '@.*$', ''
    return ($cmd -eq '/sinkron' -or $cmd -eq '/sinkronstatus')
}

function Invoke-PerintahSinkron {
    param([string]$Teks, [string]$ChatId, [string]$Oleh = '')
    if ($SinkronGsheetChatBoleh.Count -gt 0 -and ($SinkronGsheetChatBoleh -notcontains [string]$ChatId)) {
        return '⛔ /sinkron hanya bisa dari grup Monitor absen.'
    }
    $cmd = ($Teks.Trim() -split '\s+')[0].ToLower() -replace '@.*$', ''
    $perintah = if ($cmd -eq '/sinkronstatus') { 'status' } else { 'sinkron' }
    $body = @{ action = 'sinkron_gsheet_bot'; kunci = $SinkronGsheetKunci; perintah = $perintah; oleh = $Oleh } | ConvertTo-Json -Compress
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $res = Invoke-RestMethod -Uri $SinkronGsheetUrl -Method Post -ContentType 'application/json; charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 360
        if ($res.result -eq 'success') {
            if ($perintah -eq 'status') { return "📊 Status Sinkron GSheet`n`n$($res.message)" }
            return "🔄 Sinkron GSheet selesai`n`n$($res.message)"
        }
        return "❌ $($res.message)"
    } catch {
        return "❌ Gagal menghubungi web app: $($_.Exception.Message)"
    }
}
