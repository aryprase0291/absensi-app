# =====================================================================
#  jalankan.ps1  -  Pintu tunggal semua pekerjaan AutoAbsen
#     -Tugas download   : tarik transaksi dari 7 mesin
#     -Tugas impor      : Kalkulasi + Ekspor Att lalu impor ke web (rentang -Dari/-Sampai)
#     -Tugas lengkap    : download lalu impor (dipakai jadwal 12:00/18:00/01:00)
#  -Sumber jadwal|telegram|manual, -Peminta (nama pengirim Telegram), -Chat (chat peminta)
#  Satu pekerjaan dalam satu waktu (antrean). Telegram: SATU pesan progres yang
#  diperbarui (bar %, langkah, durasi) ke grup + chat peminta; riwayat di Supabase.
#  Setelah selesai, Att ditutup bila PC diam 5 menit (tutup_att.ps1).
# =====================================================================
param(
    [ValidateSet('download','impor','lengkap')] [string]$Tugas = 'lengkap',
    [string]$Dari = '', [string]$Sampai = '',
    [ValidateSet('upsert','periode','replace')] [string]$Mode = 'upsert',
    [string]$Sumber = 'manual', [string]$Peminta = '', [string]$Chat = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'JALANKAN'

$k = KonfigTelegram
$tujuan = @(@($k.Grup, $Chat) | Where-Object { $_ } | Select-Object -Unique)
function Kirim([string]$teks) { foreach ($x in $tujuan) { KirimTelegram $teks $x } }   # cadangan bila pesan progres gagal

# rentang tanggal (untuk impor)
$hari = (Get-Date).Date
if ($Sampai) { $tAkhir = [datetime]::ParseExact($Sampai, 'yyyy-MM-dd', $null) } else { $tAkhir = $hari }
if ($Dari)   { $tAwal  = [datetime]::ParseExact($Dari, 'yyyy-MM-dd', $null) }   else { $tAwal = PeriodeBerjalan $tAkhir }
$rentangTeks = Rentang $tAwal.ToString('yyyy-MM-dd') $tAkhir.ToString('yyyy-MM-dd')
$namaMode = $AA_NamaMode[$Mode]
$judul = @{ download = 'Download mesin'; impor = 'Impor ke web absensi'; lengkap = 'Download + impor web' }[$Tugas]
$pakaiRentang = $Tugas -ne 'download'
$siapa = if ($Peminta) { '👤 ' + (Html $Peminta) } elseif ($Sumber -eq 'jadwal') { '⏰ Jadwal otomatis' } else { '🖥 Manual di PC' }
$sub = @($(if ($pakaiRentang) { '📅 {0} · {1} · {2}' -f $rentangTeks, $namaMode, $siapa } else { $siapa }))

# ---- pesan progres ----
$langkah = @()
if ($Tugas -in @('download','lengkap')) { $langkah += $AA_LangkahDownload }
if ($Tugas -in @('impor','lengkap')) {
    $langkah += @{ k = 'kalkulasi'; n = 'Kalkulasi kehadiran di Att'; b = 3 }
    $langkah += @{ k = 'ekspor';    n = 'Ekspor laporan Excel'; b = 1 }
    $langkah += @{ k = 'web';       n = 'Impor ke web absensi'; b = 3 }
}
$P = ProgresBaru $judul $langkah $tujuan $sub

$antre = AmbilAntrean 5
if (-not $antre) {
    ProgresSub $P ($sub + '⏳ <i>menunggu pekerjaan lain selesai…</i>')
    $antre = AmbilAntrean (45 * 60)
    if (-not $antre) {
        if (-not (ProgresSelesai $P 'gagal' @('Antrean penuh lebih dari 45 menit.'))) { Kirim "❌ <b>$judul</b> dibatalkan: antrean penuh lebih dari 45 menit." }
        CatatRiwayat @{ tugas = $Tugas; sumber = $Sumber; status = 'gagal'; ringkasan = 'Antrean penuh > 45 menit'; peminta = $Peminta }
        exit 1
    }
    ProgresSub $P $sub
}

# Pantau log otomasi_att / impor_absen untuk langkah kalkulasi, ekspor, impor web
$Global:PantauImpor = @{ total = 0 }
function ProgresDariLog($P, [hashtable]$pos) {
    foreach ($b in (LogBaru $pos)) {
        if ($b -notmatch '^\S+ \S+\s+\[(ATT|BUKA|IMPOR)\]\s+(.*)$') { continue }
        $tag = $Matches[1]; $t = $Matches[2]
        switch -Regex ($t) {
            '^=== Kalkulasi'                { ProgresLangkah $P 'kalkulasi' 'jalan' 'menyiapkan Att' ; break }
            '^Login Att berhasil'           { if ($tag -eq 'BUKA') { ProgresLangkah $P 'kalkulasi' 'jalan' 'Att terbuka' 0.15 }; break }
            '^Buka Laporan'                 { ProgresLangkah $P 'kalkulasi' 'jalan' 'membuka jendela Laporan' 0.25; break }
            '^Tanggal terisi: (.*)$'        { ProgresLangkah $P 'kalkulasi' 'jalan' ('menghitung ' + $Matches[1]) 0.35; break }
            '^Kalkulasi selesai'            { ProgresLangkah $P 'kalkulasi' 'ok' ''; ProgresLangkah $P 'ekspor' 'jalan' ''; break }
            '^Ekspor tersimpan: .*\((.*)\)' { ProgresLangkah $P 'ekspor' 'ok' $Matches[1]; break }
            '^=== Import'                   { ProgresLangkah $P 'web' 'jalan' 'membaca file' 0.05; break }
            '^Terbaca (\d+) baris, (\d+) karyawan' {
                $Global:PantauImpor.total = [int]$Matches[1]
                ProgresLangkah $P 'web' 'jalan' ('{0} baris · {1} karyawan' -f (Angka $Matches[1]), (Angka $Matches[2])) 0.1; break }
            '^terkirim (\d+)/(\d+) baris'   { ProgresLangkah $P 'web' 'jalan' ('terkirim {0}/{1} baris' -f (Angka $Matches[1]), (Angka $Matches[2])) (0.1 + 0.75 * [int]$Matches[1] / [Math]::Max(1, [int]$Matches[2])); break }
            '^Menyimpan ke database web'    { ProgresLangkah $P 'web' 'jalan' 'menyimpan ke database web' 0.9; break }
            '^File ini sudah pernah diimpor' { ProgresLangkah $P 'web' 'lewat' 'file sama sudah pernah diimpor'; break }
            '^GAGAL: (.*)$'                 { ProgresLangkah $P $(if ($tag -eq 'IMPOR') { 'web' } else { @('kalkulasi','ekspor') | Where-Object { ($P.Langkah | Where-Object Kunci -eq $_).Status -ne 'ok' } | Select-Object -First 1 }) 'gagal' (Html $Matches[1]); break }
        }
    }
    ProgresTampil $P
}

$mulai = Get-Date
$kode = 1
try {
    Catat $T ("=== {0} {1} ({2}) | sumber {3} {4} ===" -f $judul, $rentangTeks, $Mode, $Sumber, $Peminta)
    Remove-Item (Join-Path $AA_Dasar 'hasil_*.json'), (Join-Path $AA_Dasar 'progres_*.json') -ErrorAction SilentlyContinue
    $isi = @(); $polos = @(); $status = 'sukses'; $detail = @{ mode = $Mode }

    # ---- download ----
    if ($Tugas -in @('download','lengkap')) {
        $kd = JalankanAnak 'download_att.ps1' @() { ProgresDariDownload $P }
        $d = BacaHasil 'download'
        $detail.download = $d
        if ($d -and $null -ne $d.ok) {
            $g = @($d.gagal | Where-Object { $_ })
            $polos += ('Download {0}/{1}{2}' -f $d.ok, $d.total, $(if ($g.Count) { ' (gagal: ' + ($g -join ', ') + ')' } else { '' }))
            if ($d.status -ne 'sukses') { $status = [string]$d.status }
        } else {
            $pesan = if ($d) { [string]$d.pesan } else { "kode $kd" }
            ProgresLangkah $P 'tarik' 'gagal' (Html $pesan)
            $polos += "Download gagal: $pesan"; $status = 'gagal'
        }
    }

    # ---- kalkulasi + ekspor + impor ----
    if ($Tugas -in @('impor','lengkap')) {
        if ($Tugas -eq 'lengkap' -and $status -eq 'gagal') {
            foreach ($x in 'kalkulasi','ekspor','web') { ProgresLangkah $P $x 'lewat' 'karena download gagal' }
            $polos += 'Impor dilewati'
        } else {
            $pos = PosisiLog
            ProgresLangkah $P 'kalkulasi' 'jalan' 'menyiapkan Att'
            $ki = JalankanAnak 'otomasi_att.ps1' @('-Dari', $tAwal.ToString('yyyy-MM-dd'), '-Sampai', $tAkhir.ToString('yyyy-MM-dd'), '-Mode', $Mode) { ProgresDariLog $P $pos }
            $e = BacaHasil 'ekspor'; $i = BacaHasil 'impor'
            $detail.ekspor = $e; $detail.impor = $i
            if ($e -and $e.status -eq 'sukses') {
                ProgresLangkah $P 'kalkulasi' 'ok'; ProgresLangkah $P 'ekspor' 'ok' ('{0} KB' -f (Angka $e.kb))
            } else {
                $pesan = if ($e) { [string]$e.pesan } else { "kode $ki" }
                foreach ($x in 'kalkulasi','ekspor') { if (($P.Langkah | Where-Object Kunci -eq $x).Status -ne 'ok') { ProgresLangkah $P $x 'gagal' (Html $pesan); break } }
                $isi += ('📄 Ekspor Att: ❌ ' + (Html $pesan)); $polos += "Ekspor gagal: $pesan"; $status = 'gagal'
            }
            if ($i) {
                if ($i.status -eq 'sukses') {
                    $r = '{0} baris · {1} karyawan · ➕{2} baru · ✏️{3} diperbarui' -f (Angka $i.baris), (Angka $i.karyawan), (Angka $i.baru), (Angka $i.diperbarui)
                    if ([int]$i.ditimpa -gt 0) { $r += (' · 🗑{0}' -f (Angka $i.ditimpa)) }
                    ProgresLangkah $P 'web' 'ok' $r
                    $isi += ('🌐 Database web: <b>{0}</b> baris' -f (Angka $i.total))
                    $polos += ('Impor {0} baris, {1} karyawan (baru {2}, diperbarui {3}{4})' -f $i.baris, $i.karyawan, $i.baru, $i.diperbarui, $(if ([int]$i.ditimpa -gt 0) { ", dibuang $($i.ditimpa)" } else { '' }))
                } else {
                    ProgresLangkah $P 'web' $(if ($i.status -eq 'gagal') { 'gagal' } else { 'lewat' }) (Html ([string]$i.pesan))
                    $polos += ('Impor {0}: {1}' -f $i.status, $i.pesan)
                    if ($i.status -eq 'gagal') { $status = 'gagal'; $isi += ('❌ ' + (Html ([string]$i.pesan))) }
                }
            } elseif ($e -and $e.status -eq 'sukses') { ProgresLangkah $P 'web' 'gagal' 'impor tidak berjalan'; $polos += 'Impor tidak berjalan'; $status = 'gagal' }
        }
    }

    $detik = [int]((Get-Date) - $mulai).TotalSeconds
    if ($status -eq 'sebagian' -and $detail.download) { $isi = @('⚠️ Mesin gagal ditarik: ' + (Html (@($detail.download.gagal) -join ', '))) + $isi }
    if (-not (ProgresSelesai $P $status $isi)) {
        Kirim ((@(('{0} <b>{1}</b>' -f $AA_Ikon[$status], $judul)) + $sub + $polos) -join "`n")
    }
    $ringkas = $polos -join ' | '
    Catat $T ("Selesai: {0} — {1}" -f $status, $ringkas)
    Set-Content -Path (Join-Path $AA_Dasar 'status_terakhir.txt') -Encoding UTF8 -Value ('{0}  {1}  {2}: {3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $Tugas.ToUpper(), $status.ToUpper(), $ringkas)
    $catatan = @{ tugas = $Tugas; sumber = $Sumber; status = $status; ringkasan = $ringkas; durasi_detik = $detik; peminta = $Peminta; detail = $detail }
    if ($pakaiRentang) { $catatan.dari = $tAwal.ToString('yyyy-MM-dd'); $catatan.sampai = $tAkhir.ToString('yyyy-MM-dd') }
    CatatRiwayat $catatan
    $kode = if ($status -eq 'sukses') { 0 } elseif ($status -eq 'sebagian') { 2 } else { 1 }
}
catch {
    $pesan = $_.Exception.Message
    Catat $T ('GAGAL: ' + $pesan)
    if (-not (ProgresSelesai $P 'gagal' @(('❌ ' + (Html $pesan))))) { Kirim ("❌ <b>$judul — error</b>`n" + (Html $pesan)) }
    CatatRiwayat @{ tugas = $Tugas; sumber = $Sumber; status = 'gagal'; ringkasan = $pesan; peminta = $Peminta }
}
finally {
    LepasAntrean $antre
    # tutup Att bila PC diam 5 menit
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar 'tutup_att.ps1')`"",'-JikaDiam','5')
}
exit $kode
