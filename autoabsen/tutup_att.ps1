# =====================================================================
#  tutup_att.ps1  -  Tutup Att bila PC diam (tanpa mouse/keyboard) N menit
#  Dijalankan jalankan.ps1 setelah download/ekspor/impor selesai.
#     tutup_att.ps1 -JikaDiam 5      (default)
#     tutup_att.ps1 -Sekarang
#  Tidak menutup bila ada pekerjaan AutoAbsen yang sedang berjalan.
#  Menyerah setelah 3 jam bila PC terus dipakai (Att dibiarkan terbuka).
# =====================================================================
param([int]$JikaDiam = 5, [switch]$Sekarang, [int]$MaksJam = 3, [string]$Chat = '', [string]$Peminta = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'TUTUP'

# hanya satu penunggu
# (hanya untuk mode menunggu diam; -Sekarang selalu jalan)
$satu = New-Object System.Threading.Mutex($false, 'Global\AutoAbsenTutup')
if (-not $Sekarang) { try { if (-not $satu.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] {} }

try {
    $mulai = Get-Date
    while ($true) {
        if (-not (AttJalan)) { if ($Chat) { KirimTelegram 'ℹ️ Att memang sedang tertutup.' $Chat }; exit 0 }
        $diam = [AAWin]::DiamDetik()
        if ($Sekarang -or $diam -ge $JikaDiam * 60) {
            $antre = AmbilAntrean 0
            if (-not $antre) {                     # ada pekerjaan berjalan -> pekerjaan itu yang akan menutup
                if ($Chat) { KirimTelegram '⏳ Ada pekerjaan AutoAbsen yang sedang berjalan; Att tidak ditutup sekarang (akan ditutup otomatis setelah selesai).' $Chat }
                exit 0
            }
            try {
                if ($Sekarang) { Catat $T ('Tutup Att atas permintaan {0}' -f $(if ($Peminta) { $Peminta } else { 'manual' })) }
                else { Catat $T ('PC diam {0:n0} menit -> menutup Att' -f ($diam / 60)) }
                $ok = TutupAtt $T
                if ($Chat) {
                    if ($ok) { KirimTelegram ('✅ Attendance Management (Att) ditutup{0}.' -f $(if ($Peminta) { " oleh $(Html $Peminta)" } else { '' })) $Chat }
                    else { KirimTelegram '❌ Att gagal ditutup. Cek PC.' $Chat }
                    CatatRiwayat @{ tugas = 'tutup'; sumber = 'telegram'; status = $(if ($ok) { 'sukses' } else { 'gagal' }); ringkasan = 'Tutup Att'; peminta = $Peminta }
                }
            } finally { LepasAntrean $antre }
            exit 0
        }
        if (((Get-Date) - $mulai).TotalHours -ge $MaksJam) { Catat $T 'PC terus dipakai, Att dibiarkan terbuka'; exit 0 }
        Start-Sleep -Seconds 30
    }
} finally { try { $satu.ReleaseMutex() } catch {}; $satu.Dispose() }
