# =====================================================================
#  impor_btr.ps1  -  Data Utama BTR-HARIAN & BTR (Att) -> web Daily_Bromo_Bwi
#     impor_btr.ps1 [-Dari yyyy-MM-dd -Sampai yyyy-MM-dd] [-Download [-SemuaMesin]] [-UjiSaja]
#                   [-Sumber telegram -Peminta "Nama" -Chat <id>]
#  Tanpa tanggal: periode berjalan (tgl 21) s/d hari ini.
#  Alur: (opsional download mesin: BTR saja / semua) -> ambil_btr.ps1 (Jet 32-bit) baca 2026.MDB
#        -> ekspor\btr_<waktu>\btr_*.tsv -> POST ke doPost web app (BTR_ApiImpor.gs) per departemen.
#        Duplikat (NIK + Tgl/Waktu) dibuang di server, sama seperti tombol Import di web.
#  Telegram: SATU pesan progres yang diperbarui (bar %, langkah, durasi) ke grup utama,
#  grup tambahan yang memakai /btr, dan chat peminta.
# =====================================================================
param([string]$Dari = '', [string]$Sampai = '', [string]$Sumber = 'manual', [string]$Peminta = '', [string]$Chat = '',
      [switch]$Download, [switch]$SemuaMesin, [switch]$UjiSaja)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'BTR'

$hari = (Get-Date).Date
$tAkhir = if ($Sampai) { [datetime]::ParseExact($Sampai, 'yyyy-MM-dd', $null) } else { $hari }
$tAwal  = if ($Dari)   { [datetime]::ParseExact($Dari, 'yyyy-MM-dd', $null) }   else { PeriodeBerjalan $tAkhir }
$rentangTeks = Rentang $tAwal.ToString('yyyy-MM-dd') $tAkhir.ToString('yyyy-MM-dd')
$siapa = if ($Peminta) { '👤 ' + (Html $Peminta) } elseif ($Sumber -eq 'jadwal') { '⏰ Jadwal otomatis' } else { '🖥 Manual di PC' }
$judul = 'Impor BTR → web Bromo' + $(if ($UjiSaja) { ' (uji)' } else { '' })
$c = KonfigBtr
$k = KonfigTelegram
$tujuan = @(@($k.Grup) + @($k.GrupLain.Keys | Where-Object { @($k.GrupLain[$_].perintah) -contains 'btr' }) + @($Chat) | Where-Object { $_ } | Select-Object -Unique)
$teksMesin = if ($SemuaMesin) { 'semua mesin' } else { Html (@($c.mesin) -join ', ') }
$sub = @(('📅 {0} · {1}' -f $rentangTeks, $siapa))
if ($Download) { $sub += ('📥 Download: {0}' -f $teksMesin) }

# ---- pesan progres ----
$langkah = @()
if ($Download) { $langkah += $AA_LangkahDownload }
$langkah += @{ k = 'baca'; n = 'Baca Data Utama dari database Att'; b = 1 }
foreach ($dn in @($c.departemen)) { $langkah += @{ k = "kirim:$dn"; n = ('Kirim {0} ke web' -f $dn); b = 2 } }
$P = ProgresBaru $judul $langkah $tujuan $sub
function Kirim([string]$teks) { foreach ($x in $tujuan) { KirimTelegram $teks $x } }   # cadangan bila pesan progres gagal

$antre = AmbilAntrean 5
if (-not $antre) {
    ProgresSub $P ($sub + '⏳ <i>menunggu pekerjaan lain selesai…</i>')
    $antre = AmbilAntrean (45 * 60)
    if (-not $antre) {
        if (-not (ProgresSelesai $P 'gagal' @('Antrean penuh lebih dari 45 menit.'))) { Kirim "❌ <b>$judul</b> dibatalkan: antrean penuh lebih dari 45 menit." }
        CatatRiwayat @{ tugas = 'btr'; sumber = $Sumber; status = 'gagal'; ringkasan = 'Antrean penuh > 45 menit'; peminta = $Peminta }
        exit 1
    }
    ProgresSub $P $sub
}
$mulai = Get-Date; $kode = 1; $isi = @(); $status = 'sukses'; $detail = @{ dept = @() }
try {
    Catat $T ("=== {0} {1} | sumber {2} {3} ===" -f $judul, $rentangTeks, $Sumber, $Peminta)
    if (-not $UjiSaja) {
        if (-not $c.url) { throw 'URL web app belum diisi di btr.json ("url").' }
        $rahasia = RahasiaBtr
        if (-not $rahasia) { throw 'Rahasia impor belum ada (btr.json "rahasia" / btr_rahasia.dat).' }
    }

    # ---- 1. download mesin (opsional) ----
    if ($Download) {
        Remove-Item (Join-Path $AA_Dasar 'hasil_download.json'), (Join-Path $AA_Dasar 'progres_download.json') -ErrorAction SilentlyContinue
        $argDl = @()
        if (-not $SemuaMesin -and @($c.mesin).Count) { $argDl += @('-Mesin', (@($c.mesin) -join ',')) }
        [void](JalankanAnak 'download_att.ps1' $argDl { ProgresDariDownload $P })
        $d = BacaHasil 'download'; $detail.download = $d
        if ($d -and $null -ne $d.ok) {
            $g = @($d.gagal | Where-Object { $_ })
            if ($d.status -ne 'sukses') { $status = 'sebagian'; $isi += ('⚠️ Mesin gagal ditarik: ' + (Html ($g -join ', ')) + ' — impor memakai data yang ada') }
        } else {
            ProgresLangkah $P 'tarik' 'gagal' $(if ($d) { Html ([string]$d.pesan) } else { 'tidak ada hasil' })
            $isi += '⚠️ Download mesin gagal — impor memakai data yang sudah ada di Att'; $status = 'sebagian'
        }
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar 'tutup_att.ps1')`"",'-JikaDiam','5')
    }

    # ---- 2. ambil Data Utama dari database Att (Jet 32-bit) ----
    ProgresLangkah $P 'baca' 'jalan' ('{0} · {1}' -f (Html (@($c.departemen) -join ' & ')), $rentangTeks)
    $dirEkspor = Join-Path $AA_Dasar 'ekspor'
    $keluar = Join-Path $dirEkspor ('btr_' + (Get-Date -Format 'yyyyMMdd_HHmm'))
    $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
    $arg = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $AA_Dasar 'ambil_btr.ps1'),
             '-Dari', $tAwal.ToString('yyyy-MM-dd'), '-Sampai', $tAkhir.ToString('yyyy-MM-dd'), '-Keluar', $keluar,
             '-Mdb', [string]$c.mdb, '-Departemen', (@($c.departemen) -join ';'))
    if ($c.status) { $arg += '-Status' }
    if ($c.kode_kerja) { $arg += '-KodeKerja' }
    $out = & $ps32 @arg 2>&1
    $json = @($out | ForEach-Object { [string]$_ } | Where-Object { $_ -like '{*' }) | Select-Object -Last 1
    if (-not $json) { ProgresLangkah $P 'baca' 'gagal'; throw ('Baca database Att gagal: ' + (($out | Out-String).Trim())) }
    $ambil = $json | ConvertFrom-Json
    if (-not $ambil.ok) { ProgresLangkah $P 'baca' 'gagal'; throw ('Baca database Att gagal: ' + $ambil.pesan) }
    foreach ($x in @($ambil.catatan)) { if ($x) { Catat $T $x | Out-Null } }
    ProgresLangkah $P 'baca' 'ok' ((@($ambil.dept) | ForEach-Object { '{0} {1}' -f (Html $_.nama), (Angka $_.baris) }) -join ' · ')

    # ---- 3. kirim per departemen ----
    $total = $null; $jmlBaru = 0
    foreach ($dp in @($ambil.dept)) {
        $kunci = 'kirim:' + [string]$dp.nama
        $L = @([IO.File]::ReadAllLines([string]$dp.file, [Text.Encoding]::UTF8) | Select-Object -Skip 1 | Where-Object { $_ })
        $r = [ordered]@{ nama = [string]$dp.nama; baris = $L.Count; karyawan = [int]$dp.karyawan; baru = 0; ada = 0; ganda = 0; rusak = 0 }
        Catat $T ("{0}: {1} baris, {2} karyawan ({3}) {4} s/d {5}" -f $dp.nama, $L.Count, $dp.karyawan, (@($dp.sub) -join ', '), $dp.min, $dp.max) | Out-Null
        if (-not $L.Count) { ProgresLangkah $P $kunci 'peringatan' 'tidak ada scan di rentang ini' }
        elseif ($UjiSaja) { ProgresLangkah $P $kunci 'lewat' ('{0} scan · uji, tidak dikirim' -f (Angka $L.Count)) }
        else {
            $potong = [Math]::Max(500, [int]$c.potong)
            ProgresLangkah $P $kunci 'jalan' ('0/{0} scan' -f (Angka $L.Count)) 0.02
            for ($i = 0; $i -lt $L.Count; $i += $potong) {
                $j = [Math]::Min($i + $potong, $L.Count)
                $tsv = ($L[$i..($j - 1)]) -join "`n"
                $badan = @{ rahasia = $rahasia; aksi = 'impor'; tsv = $tsv; file = ('AutoAbsen {0} {1}' -f $dp.nama, $rentangTeks) }
                $res = $null
                for ($coba = 1; $coba -le 3; $coba++) {
                    try { $res = PostJson ([string]$c.url) $badan @{} 300; break }
                    catch {
                        if ($coba -eq 3) { ProgresLangkah $P $kunci 'gagal'; throw ('Kirim ke web gagal: ' + $_.Exception.Message) }
                        ProgresLangkah $P $kunci 'jalan' ('coba lagi ({0}/3)…' -f ($coba + 1)); Start-Sleep -Seconds (10 * $coba)
                    }
                }
                if (-not $res -or -not $res.ok) { ProgresLangkah $P $kunci 'gagal'; throw ('Web menolak: ' + $(if ($res) { $res.pesan } else { 'tanpa jawaban' })) }
                $r.baru += [int]$res.baru; $r.ada += [int]$res.duplikatDb; $r.ganda += [int]$res.duplikatFile; $r.rusak += [int]$res.rusak
                $total = $res.totalDatabase
                ProgresLangkah $P $kunci 'jalan' ('{0}/{1} scan · ➕{2}' -f (Angka $j), (Angka $L.Count), (Angka $r.baru)) ($j / $L.Count)
            }
            $jmlBaru += $r.baru
            $info = '{0} scan · {1} karyawan · ➕ <b>{2} baru</b> · {3} sudah ada' -f (Angka $r.baris), (Angka $r.karyawan), (Angka $r.baru), (Angka $r.ada)
            if ($r.rusak) { $info += (' · ⚠️ {0} rusak' -f (Angka $r.rusak)) }
            ProgresLangkah $P $kunci $(if ($r.rusak) { 'peringatan' } else { 'ok' }) $info
        }
        $detail.dept += $r
    }
    # departemen di konfigurasi yang tidak ada hasil bacanya
    foreach ($dn in @($c.departemen)) { if (-not (@($ambil.dept) | Where-Object { $_.nama -eq $dn })) { ProgresLangkah $P "kirim:$dn" 'lewat' 'tidak terbaca' } }

    if ($null -ne $total) { $isi += ('🌐 Database web: <b>{0}</b> baris · ➕ {1} baru' -f (Angka $total), (Angka $jmlBaru)) }
    if (-not $UjiSaja -and $jmlBaru) { $isi += 'ℹ️ Laporan diperbarui setelah <i>Terapkan &amp; Rekap</i> di sheet / Refresh di web.' }
    $detail.baru = $jmlBaru; $detail.total = $total; $detail.folder = $keluar

    Get-ChildItem -LiteralPath $dirEkspor -Directory -Filter 'btr_*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $detik = [int]((Get-Date) - $mulai).TotalSeconds
    if (-not (ProgresSelesai $P $status $isi)) {
        Kirim ((@(("{0} <b>{1}</b>" -f $AA_Ikon[$status], $judul), ('📅 ' + $rentangTeks)) + @($detail.dept | ForEach-Object { '• {0}: {1} scan, ➕{2}' -f (Html $_.nama), (Angka $_.baris), (Angka $_.baru) }) + $isi) -join "`n")
    }
    $ringkas = (@($detail.dept | ForEach-Object { '{0}: {1} scan, baru {2}' -f $_.nama, $_.baris, $_.baru }) -join ' | ')
    Catat $T ("Selesai: {0} — {1}" -f $status, $ringkas)
    CatatRiwayat @{ tugas = 'btr'; sumber = $Sumber; status = $status; ringkasan = $ringkas; durasi_detik = $detik; peminta = $Peminta
                    dari = $tAwal.ToString('yyyy-MM-dd'); sampai = $tAkhir.ToString('yyyy-MM-dd'); detail = @{ btr = $detail } }
    $kode = if ($status -eq 'sukses') { 0 } else { 2 }
}
catch {
    $pesan = $_.Exception.Message
    Catat $T ('GAGAL: ' + $pesan)
    if (-not (ProgresSelesai $P 'gagal' @(('❌ ' + (Html $pesan))))) {
        Kirim ((("❌ <b>{0} — gagal</b>`n📅 {1}" -f $judul, $rentangTeks), (Html $pesan)) -join "`n")
    }
    CatatRiwayat @{ tugas = 'btr'; sumber = $Sumber; status = 'gagal'; ringkasan = $pesan; peminta = $Peminta
                    dari = $tAwal.ToString('yyyy-MM-dd'); sampai = $tAkhir.ToString('yyyy-MM-dd') }
}
finally { LepasAntrean $antre }
exit $kode
