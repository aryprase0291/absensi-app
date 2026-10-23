# =====================================================================
#  pasang_jadwal.ps1  -  Daftarkan jadwal AutoAbsen ke Task Scheduler
#  Jalankan SEKALI dari PowerShell "Run as administrator":
#     powershell -ExecutionPolicy Bypass -File "D:\AutoAbsen\pasang_jadwal.ps1"
#  (aman diulang: tugas dengan nama sama ditimpa)
#
#  AutoAbsen-Lengkap  12:00, 18:00, 01:00 -> download 7 mesin + kalkulasi/ekspor + impor web,
#                                            laporan ke grup Telegram, Att ditutup bila PC diam 5 menit
#  AutoAbsen-Backup   jam dari backup.json (bawaan 02:00 & 19:00) -> backup_db.ps1; ubah via bot /backup
#  AutoAbsen-Bot      saat login + tiap 10 menit (hidupkan lagi bila mati) -> bot Telegram
#  Tugas lama (Cek, Verifikasi, Impor, BukaAtt) dihapus: Att tidak lagi harus terbuka terus.
# =====================================================================
$ErrorActionPreference = 'Stop'
$Dasar = Split-Path -Parent $MyInvocation.MyCommand.Path
$User  = "$env:USERDOMAIN\$env:USERNAME"
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest

function Aksi([string]$file, [string]$arg = '') {
    New-ScheduledTaskAction -Execute 'powershell.exe' `
      -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`" {1}" -f (Join-Path $Dasar $file), $arg)
}

foreach ($lama in 'AutoAbsen-Cek','AutoAbsen-Verifikasi','AutoAbsen-Impor','AutoAbsen-BukaAtt') {
    if (Get-ScheduledTask -TaskPath '\AutoAbsen\' -TaskName $lama -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskPath '\AutoAbsen\' -TaskName $lama -Confirm:$false
        Write-Host "Dihapus: $lama"
    }
}

$tLengkap = @('12:00','18:00','01:00') | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
$sLengkap = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -MultipleInstances Queue
Register-ScheduledTask -TaskName 'AutoAbsen-Lengkap' -TaskPath '\AutoAbsen\' -Force `
  -Action (Aksi 'jalankan.ps1' '-Tugas lengkap -Sumber jadwal') -Trigger $tLengkap -Principal $Principal -Settings $sLengkap `
  -Description 'Download 7 mesin + kalkulasi/ekspor Att + impor absensi.jpt.co.id, laporan ke Telegram' | Out-Null

$tBot1 = New-ScheduledTaskTrigger -AtLogOn -User $User; $tBot1.Delay = 'PT1M'
$tBot2 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$sBot = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'AutoAbsen-Bot' -TaskPath '\AutoAbsen\' -Force `
  -Action (Aksi 'bot_telegram.ps1') -Trigger @($tBot1, $tBot2) -Principal $Principal -Settings $sBot `
  -Description 'Bot Telegram AutoAbsen (perintah /download /impor /lengkap /status /log)' | Out-Null

. (Join-Path $Dasar 'umum.ps1')
if (-not (Test-Path $AA_FileBackup)) { SimpanKonfigBackup (KonfigBackup) }
PasangJadwalBackup

Write-Host ''
Write-Host 'Jadwal terpasang:' -ForegroundColor Green
Get-ScheduledTask -TaskPath '\AutoAbsen\' | ForEach-Object {
    $info = $_ | Get-ScheduledTaskInfo
    '  {0,-22} berikutnya: {1}' -f $_.TaskName, $info.NextRunTime
}
Start-ScheduledTask -TaskPath '\AutoAbsen\' -TaskName 'AutoAbsen-Bot'
Write-Host 'Bot dijalankan. Coba ketik /status di grup Telegram.'
