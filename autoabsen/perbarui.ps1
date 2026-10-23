# =====================================================================
#  perbarui.ps1  -  Samakan skrip D:\AutoAbsen dengan folder autoabsen/
#                   di repo GitHub aryprase0291/absensi-app
#
#  Arah: REPO -> PC. Edit skrip di repo (commit + push ke main), lalu
#  kirim /perbarui di Telegram. Bot menunjukkan file yang berubah, dan
#  baru menyalin setelah tombol Terapkan ditekan.
#
#  Pengaman:
#   - Hanya *.ps1 dan *.md di autoabsen/ (tanpa subfolder). File rahasia
#     (*.dat), konfigurasi (*.json), log, dan ekspor TIDAK pernah disentuh.
#   - File PC yang tidak ada di repo dibiarkan (tidak dihapus).
#   - File yang DIUBAH LANGSUNG DI PC sejak sinkron terakhir ditandai
#     "konflik" dan dilewati, kecuali dipilih "timpa".
#   - Sebelum menimpa, file lama disalin ke _cadangan\perbarui_<waktu>\.
#   - Isi unduhan dicek SHA-1-nya dengan daftar file GitHub.
#   - Menunggu pekerjaan AutoAbsen yang sedang jalan selesai dulu.
#   - bot_telegram.ps1 / umum.ps1 berubah -> bot menyala ulang sendiri.
#
#  Manual (PowerShell):
#    perbarui.ps1 -Aksi cek
#    perbarui.ps1 -Aksi terapkan -Id <id dari cek> [-Paksa]
# =====================================================================
param(
    [ValidateSet('cek', 'terapkan')][string]$Aksi = 'cek',
    [string]$Id = '',
    [switch]$Paksa,
    [string]$Chat = '',
    [string]$Peminta = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
. (Join-Path $PSScriptRoot 'repo.ps1')
$T = 'PERBARUI'
$FileStatus = Join-Path $AA_Dasar 'perbarui.json'
$FileRencana = Join-Path $AA_Dasar 'perbarui_rencana.json'
$FolderRepo = 'autoabsen/'

function Lapor([string]$teks, $tombol = $null) {
    if ($Chat) { KirimTelegram $teks $Chat $tombol } else { Write-Output (($teks -replace '<[^>]+>', '') -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&') }
}
function BacaStatus {
    $s = @{ commit = ''; file = @{} }
    if (Test-Path $FileStatus) {
        try {
            $j = Get-Content $FileStatus -Raw | ConvertFrom-Json
            $s.commit = [string]$j.commit
            if ($j.file) { foreach ($p in $j.file.PSObject.Properties) { $s.file[$p.Name] = [string]$p.Value } }
        } catch {}
    }
    return $s
}
function SimpanStatus($s) { $s | ConvertTo-Json -Depth 5 | Set-Content -Path $FileStatus -Encoding UTF8 }
function ShaLokal([string]$nama) {
    $f = Join-Path $AA_Dasar $nama
    if (-not (Test-Path -LiteralPath $f)) { return '' }
    return GitBlobSha ([IO.File]::ReadAllBytes($f))
}
function Daftar([string[]]$x, [int]$maks = 15) {
    $x = @($x)
    $t = (@($x | Select-Object -First $maks) | ForEach-Object { '• <code>' + (Html $_) + '</code>' }) -join "`n"
    if ($x.Count -gt $maks) { $t += ("`n• … +{0} lagi" -f ($x.Count - $maks)) }
    return $t
}

try {
    if ($Aksi -eq 'cek') {
        $c = RepoCommitTerbaru
        $remote = @(RepoDaftarFile $c.sha $FolderRepo | Where-Object {
            $n = $_.path.Substring($FolderRepo.Length)
            ($n -notmatch '/') -and ($n -match '\.(ps1|md)$')
        })
        if (-not $remote.Count) { throw "Folder $FolderRepo di repo kosong." }
        $st = BacaStatus
        $baru = @(); $ubah = @(); $konflik = @(); $sama = 0
        foreach ($r in $remote) {
            $nama = $r.path.Substring($FolderRepo.Length)
            $lokal = ShaLokal $nama
            if (-not $lokal) { $baru += $nama; continue }
            if ($lokal -eq $r.sha) { $sama++; $st.file[$nama] = $r.sha; continue }
            if ($st.file.ContainsKey($nama) -and $st.file[$nama] -ne $lokal) { $konflik += $nama } else { $ubah += $nama }
        }
        $namaRemote = @($remote | ForEach-Object { $_.path.Substring($FolderRepo.Length) })
        $hanyaPc = @(Get-ChildItem -Path $AA_Dasar -Filter *.ps1 -File | Where-Object { $namaRemote -notcontains $_.Name } | ForEach-Object { $_.Name })
        if (-not ($baru.Count + $ubah.Count + $konflik.Count)) { $st.commit = $c.sha }
        SimpanStatus $st

        $l = @(('🔄 <b>Perbarui AutoAbsen dari GitHub</b>'), ('Commit <code>{0}</code> · {1}' -f $c.pendek, (Html $c.pesan)), '')
        if (-not ($baru.Count + $ubah.Count + $konflik.Count)) {
            $l += ('✅ Semua {0} skrip sudah sama dengan repo.' -f $sama)
            if ($hanyaPc.Count) { $l += ''; $l += ('ℹ️ Hanya ada di PC (dibiarkan): ' + (Html ($hanyaPc -join ', '))) }
            Lapor ($l -join "`n"); exit 0
        }
        $idR = ([guid]::NewGuid().ToString('N')).Substring(0, 8)
        @{ id = $idR; commit = $c.sha; pendek = $c.pendek; dibuat = (Get-Date).ToString('o'); ubah = @($baru + $ubah); konflik = @($konflik) } |
            ConvertTo-Json -Depth 5 | Set-Content -Path $FileRencana -Encoding UTF8
        if ($ubah.Count) { $l += ('✏️ <b>Berubah ({0})</b>' -f $ubah.Count); $l += (Daftar $ubah); $l += '' }
        if ($baru.Count) { $l += ('➕ <b>Baru ({0})</b>' -f $baru.Count); $l += (Daftar $baru); $l += '' }
        if ($konflik.Count) {
            $l += ('⚠️ <b>Diubah langsung di PC ({0})</b> — dilewati kecuali pilih timpa' -f $konflik.Count); $l += (Daftar $konflik); $l += ''
        }
        $l += ('{0} file sama. Cadangan dibuat sebelum menimpa. Berlaku 30 menit.' -f $sama)
        $kb = New-Object System.Collections.Generic.List[object]
        if ($baru.Count + $ubah.Count) { $kb.Add(@(@{ text = ('✅ Terapkan ({0} file)' -f ($baru.Count + $ubah.Count)); callback_data = "pb|ya|$idR" })) }
        if ($konflik.Count) { $kb.Add(@(@{ text = ('⚠️ Terapkan + timpa {0} file PC' -f $konflik.Count); callback_data = "pb|paksa|$idR" })) }
        $kb.Add(@(@{ text = '✖ Batal'; callback_data = 'x' }))
        Lapor ($l -join "`n") $kb.ToArray()
        Catat $T ("cek {0}: ubah {1}, baru {2}, konflik {3}" -f $c.pendek, $ubah.Count, $baru.Count, $konflik.Count) | Out-Null
        exit 0
    }

    # ---------------------------------------------------------- terapkan
    if (-not (Test-Path $FileRencana)) { throw 'Tidak ada rencana. Kirim /perbarui dulu.' }
    $r = Get-Content $FileRencana -Raw | ConvertFrom-Json
    if ($Id -and $Id -ne [string]$r.id) { throw 'Rencana sudah diganti oleh /perbarui yang lebih baru. Pakai pesan terbaru.' }
    if (((Get-Date) - [datetime]$r.dibuat).TotalMinutes -gt 30) { throw 'Rencana sudah lewat 30 menit. Kirim /perbarui lagi.' }
    $daftar = @($r.ubah | Where-Object { $_ })
    if ($Paksa) { $daftar += @($r.konflik | Where-Object { $_ }) }
    if (-not $daftar.Count) { throw 'Tidak ada file yang perlu diterapkan.' }

    Lapor ('⏳ Menerapkan {0} file dari commit <code>{1}</code>{2}…' -f $daftar.Count, $r.pendek, $(if (AdaPekerjaan) { ' (menunggu pekerjaan yang sedang jalan selesai)' } else { '' }))
    $antre = AmbilAntrean 900
    if (-not $antre) { throw 'Pekerjaan lain belum selesai setelah 15 menit. Coba lagi nanti.' }
    try {
        $remote = @{}
        foreach ($x in (RepoDaftarFile $r.commit $FolderRepo)) { $remote[$x.path.Substring($FolderRepo.Length)] = $x.sha }
        $cadangan = Join-Path $AA_Dasar ('_cadangan\perbarui_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
        $st = BacaStatus
        $ok = @(); $gagal = @()
        foreach ($nama in $daftar) {
            try {
                if (-not $remote.ContainsKey($nama)) { throw 'tidak ada lagi di repo' }
                $isi = RepoUnduhFile $r.commit ($FolderRepo + $nama)
                if ((GitBlobSha $isi) -ne $remote[$nama]) { throw 'isi unduhan tidak cocok (SHA-1)' }
                $tujuan = Join-Path $AA_Dasar $nama
                if (Test-Path -LiteralPath $tujuan) {
                    New-Item -ItemType Directory -Force -Path $cadangan | Out-Null
                    Copy-Item -LiteralPath $tujuan -Destination (Join-Path $cadangan $nama) -Force
                }
                $tmp = $tujuan + '.baru'
                [IO.File]::WriteAllBytes($tmp, $isi)
                Move-Item -LiteralPath $tmp -Destination $tujuan -Force
                $st.file[$nama] = $remote[$nama]
                $ok += $nama
            } catch { $gagal += ('{0}: {1}' -f $nama, $_.Exception.Message) }
        }
        $st.commit = [string]$r.commit
        SimpanStatus $st
        Remove-Item $FileRencana -Force -ErrorAction SilentlyContinue
    } finally { LepasAntrean $antre }

    $l = @(('{0} <b>Perbarui AutoAbsen</b> · commit <code>{1}</code>' -f $(if ($gagal.Count) { '⚠️' } else { '✅' }), $r.pendek))
    if ($Peminta) { $l += ('oleh ' + (Html $Peminta)) }
    $l += ''
    if ($ok.Count) { $l += ('Diperbarui ({0}):' -f $ok.Count); $l += (Daftar $ok 20) }
    if ($gagal.Count) { $l += ''; $l += 'Gagal:'; $l += (Daftar $gagal 10) }
    if ($ok.Count -and (Test-Path $cadangan)) { $l += ''; $l += ('Cadangan file lama: <code>{0}</code>' -f (Html $cadangan)) }
    if ($ok | Where-Object { $_ -in @('bot_telegram.ps1', 'umum.ps1') }) { $l += '🤖 Bot menyala ulang sendiri dengan versi baru dalam ±1 menit.' }
    if ($ok -contains 'pasang_jadwal.ps1') { $l += 'ℹ️ pasang_jadwal.ps1 berubah — jalankan ulang di PC (PowerShell admin) bila jadwalnya ikut berubah.' }
    Lapor ($l -join "`n")
    Catat $T ("terapkan {0}: ok {1}, gagal {2} oleh {3}" -f $r.pendek, $ok.Count, $gagal.Count, $Peminta) | Out-Null
} catch {
    Catat $T ('gagal: ' + $_.Exception.Message) | Out-Null
    Lapor ('❌ Perbarui gagal: ' + (Html $_.Exception.Message))
    exit 1
}
