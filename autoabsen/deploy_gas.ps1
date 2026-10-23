# =====================================================================
#  deploy_gas.ps1  -  Kirim file .gs dari repo GitHub (apps-script/) ke
#                     project Apps Script `absen`, lalu deploy versi baru
#                     ke deployment PRODUKSI (URL /exec tetap sama).
#
#  Dari Telegram (admin bot, grup utama):
#    /deploy          cek: file apa yang berubah antara repo dan Apps Script
#                     -> tombol 🚀 Deploy / 💾 Simpan saja / ✖ Batal
#    /deploy status   versi yang sedang dipakai produksi + deploy terakhir
#    /deploy balik    kembalikan produksi ke versi sebelum deploy terakhir
#    /deploy nama Code=Kode   samakan nama file repo -> nama di Apps Script
#
#  PENGAMAN
#   - Yang dikirim: isi commit yang DITINJAU saat /deploy (bukan main terbaru
#     saat tombol ditekan). Rencana berlaku 30 menit.
#   - File yang hanya ada di Apps Script (mis. SendTelegram*.gs yang memuat
#     token, appsscript.json) TIDAK dihapus — dikirim balik apa adanya.
#   - Ditolak bila gabungan file punya const/let/class top-level yang sama
#     di dua file (SyntaxError -> seluruh project mati), mis. repo Code.gs
#     vs Apps Script Kode.gs. Atasi dengan /deploy nama Code=Kode.
#   - Ditandai bila file di Apps Script DIUBAH LANGSUNG DI EDITOR sejak
#     deploy terakhir; perlu tombol "timpa" khusus.
#   - Sebelum menulis, isi Apps Script lama disimpan ke
#     D:\AutoAbsen\_cadangan\gas\<waktu>.json (30 terakhir).
#   - Tepat sebelum menulis, isi Apps Script dibaca ulang; kalau berubah
#     sejak /deploy dicek, dibatalkan.
#
#  SETUP SEKALI  ->  lihat autoabsen/DEPLOY-GAS.md
#    powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\deploy_gas.ps1 -Setel
# =====================================================================
param(
    [ValidateSet('cek', 'jalan', 'simpan', 'balik', 'status', 'nama')][string]$Aksi = 'cek',
    [string]$Id = '',
    [switch]$Paksa,
    [switch]$Setel,
    [string]$Nilai = '',
    [string]$Chat = '',
    [string]$Peminta = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
. (Join-Path $PSScriptRoot 'repo.ps1')
$T = 'DEPLOY'
$FileRahasia = Join-Path $AA_Dasar 'deploy_gas.dat'
$FileKonfig = Join-Path $AA_Dasar 'deploy_gas.json'
$FileState = Join-Path $AA_Dasar 'deploy_gas_status.json'
$FileRencana = Join-Path $AA_Dasar 'deploy_gas_rencana.json'
$DirCadangan = Join-Path $AA_Dasar '_cadangan\gas'
$FolderRepo = 'apps-script/'
$Cakupan = 'https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments'
# ID deployment produksi = bagian AKfycb... di URL /exec (src/config/constants.js)
$DeploymentBawaan = 'AKfycbzUH1Q7iVAii82YGg_mObckPCZdMxd-bzjURra0VvaCulR0nS1PeE4HiGA-cRLVVDgD'

function Lapor([string]$teks, $tombol = $null) {
    if ($Chat) { KirimTelegram $teks $Chat $tombol } else { Write-Output (($teks -replace '<[^>]+>', '') -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&') }
}
function BacaJsonFile([string]$f) { if (Test-Path $f) { return (JsonBaca ([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))) }; return $null }
function TulisJsonFile([string]$f, $obj) { [IO.File]::WriteAllText($f, (JsonTulis $obj), (New-Object Text.UTF8Encoding($false))) }
function Ambil($kamus, [string]$k, $bawaan = $null) {
    if ($null -ne $kamus -and $kamus.ContainsKey($k) -and $null -ne $kamus[$k]) { return $kamus[$k] }
    return $bawaan
}

function KonfigDeploy {
    $k = BacaJsonFile $FileKonfig
    $nama = @{}
    $m = Ambil $k 'nama'
    if ($m) { foreach ($x in $m.Keys) { $nama[[string]$x] = [string]$m[$x] } }
    return [pscustomobject]@{
        scriptId     = [string](Ambil $k 'scriptId' '')
        deploymentId = [string](Ambil $k 'deploymentId' $DeploymentBawaan)
        nama         = $nama
        lewati       = @((Ambil $k 'lewati' @()) | ForEach-Object { [string]$_ })
    }
}
function SimpanKonfigDeploy($c) {
    TulisJsonFile $FileKonfig @{ scriptId = $c.scriptId; deploymentId = $c.deploymentId; nama = $c.nama; lewati = [object[]]@($c.lewati) }
}

# ---------------------------------------------------------------- OAuth
function FormPost([string]$url, [hashtable]$isi) {
    $pasang = ($isi.Keys | ForEach-Object { [Uri]::EscapeDataString($_) + '=' + [Uri]::EscapeDataString([string]$isi[$_]) }) -join '&'
    $r = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing -TimeoutSec 60 -ContentType 'application/x-www-form-urlencoded' -Body ([Text.Encoding]::ASCII.GetBytes($pasang))
    return JsonBaca ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))
}
function TokenAkses {
    $s = BacaDpapi $FileRahasia
    if (-not $s) { throw 'Deploy belum disetel. Di PC jalankan: deploy_gas.ps1 -Setel (lihat DEPLOY-GAS.md).' }
    $r = JsonBaca $s
    try {
        $t = FormPost 'https://oauth2.googleapis.com/token' @{ client_id = $r['client_id']; client_secret = $r['client_secret']; refresh_token = $r['refresh_token']; grant_type = 'refresh_token' }
    } catch {
        throw ('Token Google ditolak (' + (PesanGalat $_) + '). Ulangi deploy_gas.ps1 -Setel. Bila layar persetujuan OAuth masih "Testing", token kedaluwarsa tiap 7 hari — ubah ke "In production" / "Internal".')
    }
    return [string]$t['access_token']
}
function PesanGalat($er) {
    $teks = ''
    try { if ($er.ErrorDetails -and $er.ErrorDetails.Message) { $teks = $er.ErrorDetails.Message } } catch {}
    if (-not $teks) {
        try {
            $resp = $er.Exception.Response
            if ($resp -and $resp.GetResponseStream) { $teks = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
        } catch {}
    }
    if ($teks) {
        try {
            $j = JsonBaca $teks
            $e = Ambil $j 'error'
            if ($e -is [string]) { return ($e + ' ' + [string](Ambil $j 'error_description' '')).Trim() }
            if ($e) { return [string](Ambil $e 'message' $teks) }
        } catch {}
        return $teks.Substring(0, [Math]::Min(300, $teks.Length))
    }
    return $er.Exception.Message
}

$Global:DG_Token = $null
function GasApi([string]$metode, [string]$jalur, $isi = $null) {
    if (-not $DG_Token) { $Global:DG_Token = TokenAkses }
    $p = @{ Uri = ('https://script.googleapis.com/v1/' + $jalur); Method = $metode; UseBasicParsing = $true; TimeoutSec = 180
            Headers = @{ Authorization = "Bearer $DG_Token" } }
    if ($null -ne $isi) { $p.ContentType = 'application/json; charset=utf-8'; $p.Body = [Text.Encoding]::UTF8.GetBytes((JsonTulis $isi)) }
    try { $r = Invoke-WebRequest @p }
    catch {
        $m = PesanGalat $_
        if ($m -match 'has not enabled the Apps Script API|Apps Script API has not been used') {
            $m += ' -> nyalakan di https://script.google.com/home/usersettings dan aktifkan "Google Apps Script API" di project Google Cloud OAuth-nya.'
        }
        throw ("Apps Script API {0} {1}: {2}" -f $metode, ($jalur -replace '\?.*$', ''), $m)
    }
    $teks = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    if (-not $teks.Trim()) { return @{} }
    return JsonBaca $teks
}

function SetelOAuth {
    Write-Output ''
    Write-Output '=== Setel deploy Apps Script (sekali) ==='
    Write-Output 'Butuh OAuth client tipe "Desktop app" dari Google Cloud Console (lihat DEPLOY-GAS.md).'
    $jalur = Read-Host 'Path file client_secret_*.json (kosongkan untuk ketik manual)'
    if ($jalur) {
        $j = JsonBaca ([IO.File]::ReadAllText($jalur.Trim('"')))
        $inst = Ambil $j 'installed'; if (-not $inst) { $inst = Ambil $j 'web' }
        $cid = [string]$inst['client_id']; $csec = [string]$inst['client_secret']
    } else {
        $cid = (Read-Host 'Client ID').Trim()
        $csec = (Read-Host 'Client secret').Trim()
    }
    if (-not $cid -or -not $csec) { throw 'Client ID / secret kosong.' }

    # PKCE + redirect loopback (TcpListener, tidak butuh hak admin)
    $acak = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($acak)
    $verifier = [Convert]::ToBase64String($acak).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $sha = [Security.Cryptography.SHA256]::Create()
    $challenge = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $dengar = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $dengar.Start()
    $port = $dengar.LocalEndpoint.Port
    $redirect = "http://127.0.0.1:$port"
    $url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&access_type=offline&prompt=consent' +
           '&client_id=' + [Uri]::EscapeDataString($cid) + '&redirect_uri=' + [Uri]::EscapeDataString($redirect) +
           '&scope=' + [Uri]::EscapeDataString($Cakupan) + '&code_challenge=' + $challenge + '&code_challenge_method=S256'
    Write-Output ''
    Write-Output 'Membuka browser untuk login Google. LOGIN DENGAN AKUN PEMILIK PROJECT APPS SCRIPT `absen`.'
    Write-Output 'Bila browser tidak terbuka, salin URL ini ke browser di PC ini:'
    Write-Output $url
    try { Start-Process $url } catch {}
    Write-Output ''
    Write-Output 'Menunggu persetujuan (maks 5 menit)...'
    $kode = $null; $batas = (Get-Date).AddMinutes(5)
    try {
        while (-not $kode -and (Get-Date) -lt $batas) {
            if (-not $dengar.Pending()) { Start-Sleep -Milliseconds 300; continue }
            $kl = $dengar.AcceptTcpClient()
            try {
                $st = $kl.GetStream(); $baca = New-Object IO.StreamReader($st)
                $baris = $baca.ReadLine()
                $isiBalas = 'Selesai. Kembali ke PowerShell.'
                if ($baris -match 'GET /\?([^ ]+) HTTP') {
                    $q = @{}; foreach ($kv in ($Matches[1] -split '&')) { $a = $kv -split '=', 2; $q[$a[0]] = [Uri]::UnescapeDataString(($a[1] -replace '\+', ' ')) }
                    if ($q.code) { $kode = $q.code } elseif ($q.error) { $isiBalas = 'Ditolak: ' + $q.error }
                }
                $html = "<html><body style='font-family:sans-serif'><h3>AutoAbsen deploy</h3><p>$isiBalas</p></body></html>"
                $b = [Text.Encoding]::UTF8.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nContent-Length: $([Text.Encoding]::UTF8.GetByteCount($html))`r`nConnection: close`r`n`r`n$html")
                $st.Write($b, 0, $b.Length); $st.Flush()
            } finally { $kl.Close() }
        }
    } finally { $dengar.Stop() }
    if (-not $kode) {
        $tempel = Read-Host 'Tidak ada jawaban otomatis. Tempel URL lengkap dari address bar setelah menyetujui (http://127.0.0.1:...?code=...)'
        if ($tempel -match '[?&]code=([^&]+)') { $kode = [Uri]::UnescapeDataString($Matches[1]) } else { throw 'Kode persetujuan tidak ditemukan.' }
    }
    $t = FormPost 'https://oauth2.googleapis.com/token' @{ code = $kode; client_id = $cid; client_secret = $csec; redirect_uri = $redirect; grant_type = 'authorization_code'; code_verifier = $verifier }
    if (-not $t['refresh_token']) { throw 'Google tidak memberi refresh_token. Cabut akses lama di myaccount.google.com/permissions lalu ulangi.' }
    SimpanDpapi $FileRahasia (JsonTulis @{ client_id = $cid; client_secret = $csec; refresh_token = [string]$t['refresh_token'] })
    $Global:DG_Token = [string]$t['access_token']
    Write-Output 'Token tersimpan (DPAPI, hanya user Windows ini yang bisa membaca).'

    $c = KonfigDeploy
    Write-Output ''
    Write-Output 'Script ID: buka editor Apps Script project `absen` -> Setelan project (ikon roda gigi) -> ID Skrip.'
    $sid = (Read-Host ('Script ID' + $(if ($c.scriptId) { " [$($c.scriptId)]" } else { '' }))).Trim()
    if ($sid) { $c.scriptId = $sid }
    if (-not $c.scriptId) { throw 'Script ID wajib diisi.' }
    $d = GasApi 'Get' ("projects/{0}/deployments?pageSize=50" -f $c.scriptId)
    $list = @(Ambil $d 'deployments' @())
    Write-Output ''
    Write-Output 'Deployment yang ada:'
    foreach ($x in $list) {
        $cfg = Ambil $x 'deploymentConfig' @{}
        Write-Output ('  {0}  versi {1}  {2}{3}' -f $x['deploymentId'], (Ambil $cfg 'versionNumber' 'HEAD'), (Ambil $cfg 'description' ''), $(if ($x['deploymentId'] -eq $c.deploymentId) { '   <= PRODUKSI (dipakai /deploy)' } else { '' }))
    }
    if (-not ($list | Where-Object { $_['deploymentId'] -eq $c.deploymentId })) {
        $pil = (Read-Host 'Deployment produksi tidak ditemukan. Tempel deploymentId yang benar').Trim()
        if ($pil) { $c.deploymentId = $pil }
    }
    SimpanKonfigDeploy $c
    $isi = GasApi 'Get' ("projects/{0}/content" -f $c.scriptId)
    Write-Output ''
    Write-Output ('OK. Project berisi {0} file. Uji dari Telegram: /deploy' -f @(Ambil $isi 'files' @()).Count)
}

# ---------------------------------------------------------------- bantu
function NormalSumber([string]$s) { return (($s -replace "`r`n", "`n") -replace '\s+$', '') }
# Deklarasi top-level (kolom 0): function / const / let / var / class
function DeklarasiAtas([string]$s) {
    $hasil = @()
    foreach ($m in [regex]::Matches($s, '(?m)^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)')) { $hasil += [pscustomobject]@{ nama = $m.Groups[1].Value; jenis = 'function' } }
    foreach ($m in [regex]::Matches($s, '(?m)^(const|let|var|class)\s+([A-Za-z_$][\w$]*)')) { $hasil += [pscustomobject]@{ nama = $m.Groups[2].Value; jenis = $m.Groups[1].Value } }
    return $hasil
}
function CekBentrok($berkas) {
    # $berkas: list @{ name; type; source }
    $peta = @{}
    foreach ($f in $berkas) {
        if ($f['type'] -ne 'SERVER_JS') { continue }
        foreach ($d in (DeklarasiAtas ([string]$f['source']))) {
            if (-not $peta.ContainsKey($d.nama)) { $peta[$d.nama] = New-Object System.Collections.Generic.List[object] }
            $peta[$d.nama].Add([pscustomobject]@{ file = $f['name']; jenis = $d.jenis })
        }
    }
    $fatal = @(); $peringatan = @()
    foreach ($n in $peta.Keys) {
        $x = $peta[$n]
        if ($x.Count -lt 2) { continue }
        $teks = '{0} ({1})' -f $n, ((@($x | ForEach-Object { $_.file + ':' + $_.jenis }) | Select-Object -Unique) -join ', ')
        if (@($x | Where-Object { $_.jenis -in @('const', 'let', 'class') }).Count) { $fatal += $teks }
        elseif (@($x | Select-Object -ExpandProperty file -Unique).Count -gt 1) { $peringatan += $teks }
    }
    return [pscustomobject]@{ fatal = @($fatal | Sort-Object); peringatan = @($peringatan | Sort-Object) }
}
function SelisihBaris([string]$lama, [string]$baru) {
    $a = @((NormalSumber $lama) -split "`n"); $b = @((NormalSumber $baru) -split "`n")
    $hA = @{}; foreach ($x in $a) { $hA[$x] = 1 + [int]$hA[$x] }
    $hB = @{}; foreach ($x in $b) { $hB[$x] = 1 + [int]$hB[$x] }
    $tambah = 0; foreach ($k in $hB.Keys) { $tambah += [Math]::Max(0, $hB[$k] - [int]$hA[$k]) }
    $buang = 0; foreach ($k in $hA.Keys) { $buang += [Math]::Max(0, $hA[$k] - [int]$hB[$k]) }
    return ('+{0} −{1}' -f $tambah, $buang)
}
function SidikIsi($files) {
    $l = @($files | ForEach-Object { '{0}|{1}|{2}' -f $_['name'], $_['type'], (Sha1Teks (NormalSumber ([string]$_['source']))) } | Sort-Object)
    return Sha1Teks ($l -join "`n")
}
function BacaState { $s = BacaJsonFile $FileState; if (-not $s) { $s = @{} }; return $s }
function Daftar([string[]]$x, [int]$maks = 12) {
    $x = @($x)
    $t = (@($x | Select-Object -First $maks) | ForEach-Object { '• ' + (Html $_) }) -join "`n"
    if ($x.Count -gt $maks) { $t += ("`n• … +{0} lagi" -f ($x.Count - $maks)) }
    return $t
}

# ---------------------------------------------------------------- utama
$kunciDeploy = $null
try {
    if ($Setel) { SetelOAuth; exit 0 }

    $c = KonfigDeploy
    if ($Aksi -eq 'nama') {
        # Nilai: "Code=Kode" (petakan) atau "Code=" (hapus peta)
        if ($Nilai -notmatch '^\s*([\w\-. ]+?)(?:\.gs)?\s*=\s*([\w\-. ]*?)(?:\.gs)?\s*$') {
            $l = @('🗂 <b>Peta nama file repo → Apps Script</b>')
            if ($c.nama.Count) { foreach ($k in $c.nama.Keys) { $l += ('• {0}.gs → {1}' -f (Html $k), (Html $c.nama[$k])) } } else { $l += '(kosong — nama sama dengan di repo)' }
            $l += ''; $l += 'Ubah: <code>/deploy nama Code=Kode</code> · hapus: <code>/deploy nama Code=</code>'
            Lapor ($l -join "`n"); exit 0
        }
        $dari = $Matches[1].Trim(); $ke = $Matches[2].Trim()
        if ($ke) { $c.nama[$dari] = $ke } else { [void]$c.nama.Remove($dari) }
        SimpanKonfigDeploy $c
        Lapor ($(if ($ke) { ('✅ Repo <code>{0}.gs</code> akan dikirim sebagai <code>{1}</code> di Apps Script.' -f (Html $dari), (Html $ke)) } else { ('✅ Peta untuk <code>{0}.gs</code> dihapus.' -f (Html $dari)) }) + "`nCek ulang: /deploy")
        exit 0
    }
    if (-not $c.scriptId) { throw 'Script ID belum disetel. Di PC jalankan: deploy_gas.ps1 -Setel (lihat DEPLOY-GAS.md).' }

    if ($Aksi -eq 'status') {
        $dep = GasApi 'Get' ("projects/{0}/deployments/{1}" -f $c.scriptId, $c.deploymentId)
        $cfg = Ambil $dep 'deploymentConfig' @{}
        $s = BacaState
        $l = @('🚀 <b>Deploy Apps Script</b>', '')
        $l += ('Produksi sekarang: <b>versi {0}</b>{1}' -f (Ambil $cfg 'versionNumber' 'HEAD'), $(if (Ambil $cfg 'description') { ' · ' + (Html ([string]$cfg['description'])) } else { '' }))
        $l += ('Diperbarui: {0}' -f (Html ([string](Ambil $dep 'updateTime' '-'))))
        if (Ambil $s 'waktu') {
            $l += ''
            $l += ('Deploy terakhir lewat bot: <b>{0}</b> · versi {1} · commit <code>{2}</code> · oleh {3}' -f (Html ([string]$s['waktu'])), (Ambil $s 'versi' '-'), (Html ([string](Ambil $s 'pendek' '-'))), (Html ([string](Ambil $s 'oleh' '-'))))
            if (Ambil $s 'versiSebelumnya') { $l += ('Versi sebelumnya: {0} (kembali: /deploy balik)' -f $s['versiSebelumnya']) }
        }
        Lapor ($l -join "`n"); exit 0
    }

    # satu deploy dalam satu waktu
    $kunciDeploy = New-Object System.Threading.Mutex($false, 'Global\AutoAbsenDeployGas')
    try { if (-not $kunciDeploy.WaitOne(0)) { throw 'Deploy lain sedang berjalan. Tunggu sebentar.' } } catch [System.Threading.AbandonedMutexException] {}

    if ($Aksi -eq 'balik') {
        $s = BacaState
        $ke = [int](Ambil $s 'versiSebelumnya' 0)
        if (-not $ke) { throw 'Tidak ada versi sebelumnya yang tercatat.' }
        $dep = GasApi 'Get' ("projects/{0}/deployments/{1}" -f $c.scriptId, $c.deploymentId)
        $kini = [int](Ambil (Ambil $dep 'deploymentConfig' @{}) 'versionNumber' 0)
        if ($kini -eq $ke) { Lapor ("ℹ️ Produksi memang sudah versi $ke."); exit 0 }
        $desk = 'Kembali ke v{0} lewat Telegram · {1}' -f $ke, $Peminta
        [void](GasApi 'Put' ("projects/{0}/deployments/{1}" -f $c.scriptId, $c.deploymentId) @{ deploymentConfig = @{ scriptId = $c.scriptId; versionNumber = $ke; manifestFileName = 'appsscript'; description = $desk } })
        $s['versi'] = $ke; $s['versiSebelumnya'] = $kini; $s['waktu'] = (Get-Date).ToString('yyyy-MM-dd HH:mm'); $s['oleh'] = $Peminta + ' (balik)'
        TulisJsonFile $FileState $s
        Lapor ("↩️ <b>Produksi dikembalikan ke versi $ke</b> (sebelumnya $kini).`nURL web app tetap. Catatan: isi editor Apps Script (HEAD) masih versi baru — deploy berikutnya akan menimpanya lagi dari repo.")
        Catat $T "balik ke v$ke dari v$kini oleh $Peminta" | Out-Null
        exit 0
    }

    if ($Aksi -eq 'cek') {
        $cm = RepoCommitTerbaru
        $repo = @(RepoDaftarFile $cm.sha $FolderRepo | Where-Object { $n = $_.path.Substring($FolderRepo.Length); ($n -notmatch '/') -and ($n -match '\.gs$') })
        if (-not $repo.Count) { throw "Tidak ada file .gs di $FolderRepo pada commit $($cm.pendek)." }
        $live = GasApi 'Get' ("projects/{0}/content" -f $c.scriptId)
        $liveFiles = @(Ambil $live 'files' @())
        $petaLive = @{}; foreach ($f in $liveFiles) { $petaLive[[string]$f['name']] = $f }
        $s = BacaState
        $dorongLalu = Ambil $s 'file' @{}

        $gabung = New-Object System.Collections.Generic.List[object]
        $sama = @(); $ubah = @(); $baru = @(); $editor = @(); $dipakai = @{}
        foreach ($r in $repo) {
            $dasar = [IO.Path]::GetFileNameWithoutExtension($r.path.Substring($FolderRepo.Length))
            if ($c.lewati -contains $dasar) { continue }
            $nama = $(if ($c.nama.ContainsKey($dasar)) { $c.nama[$dasar] } else { $dasar })
            $src = ByteKeTeks (RepoUnduhFile $cm.sha $r.path)
            $dipakai[$nama] = $true
            $gabung.Add(@{ name = $nama; type = 'SERVER_JS'; source = $src })
            $label = $(if ($nama -ne $dasar) { "$dasar.gs → $nama" } else { "$nama.gs" })
            if (-not $petaLive.ContainsKey($nama)) { $baru += $label; continue }
            $lv = [string]$petaLive[$nama]['source']
            if ((NormalSumber $lv) -eq (NormalSumber $src)) { $sama += $label; continue }
            $ubah += ('{0} ({1})' -f $label, (SelisihBaris $lv $src))
            $jejak = Ambil $dorongLalu $nama
            if ($jejak -and $jejak -ne (Sha1Teks (NormalSumber $lv))) { $editor += $label }
        }
        $tetap = @()
        foreach ($f in $liveFiles) {
            if ($dipakai.ContainsKey([string]$f['name'])) { continue }
            $gabung.Add(@{ name = [string]$f['name']; type = [string]$f['type']; source = [string]$f['source'] })
            if ($f['type'] -ne 'JSON') { $tetap += ('{0}{1}' -f $f['name'], $(if ($f['type'] -eq 'HTML') { '.html' } else { '.gs' })) }
        }
        $bentrok = CekBentrok $gabung
        $idR = ([guid]::NewGuid().ToString('N')).Substring(0, 8)
        TulisJsonFile $FileRencana @{ id = $idR; commit = $cm.sha; pendek = $cm.pendek; pesan = $cm.pesan; dibuat = (Get-Date).ToString('o'); sidikLive = (SidikIsi $liveFiles); files = $gabung.ToArray(); editor = [object[]]$editor }

        $l = @('🚀 <b>Deploy Apps Script dari GitHub</b>', ('Commit <code>{0}</code> · {1}' -f $cm.pendek, (Html $cm.pesan)), '')
        if ($ubah.Count) { $l += ('✏️ <b>Berubah ({0})</b>' -f $ubah.Count); $l += (Daftar $ubah); $l += '' }
        if ($baru.Count) { $l += ('➕ <b>File baru di Apps Script ({0})</b>' -f $baru.Count); $l += (Daftar $baru); $l += '' }
        if ($editor.Count) { $l += ('⚠️ <b>Diubah langsung di editor sejak deploy terakhir ({0})</b> — perubahan itu akan hilang:' -f $editor.Count); $l += (Daftar $editor); $l += '' }
        $l += ('= {0} file sama' -f $sama.Count)
        if ($tetap.Count) { $l += ('📌 Hanya di Apps Script, dipertahankan: ' + (Html ($tetap -join ', '))) }
        if ($bentrok.fatal.Count) {
            $l += ''; $l += '⛔ <b>DITOLAK — nama ganda yang akan mematikan project:</b>'; $l += (Daftar $bentrok.fatal 8)
            $l += ''; $l += 'Biasanya karena nama file beda (repo <code>Code.gs</code> vs Apps Script <code>Kode</code>). Samakan dengan <code>/deploy nama Code=Kode</code>, lalu /deploy lagi.'
            Lapor ($l -join "`n"); exit 0
        }
        if ($bentrok.peringatan.Count) { $l += ''; $l += ('ℹ️ Fungsi bernama sama di beberapa file (yang terakhir menang): ' + (Html (($bentrok.peringatan | Select-Object -First 5) -join '; '))) }
        if (-not ($ubah.Count + $baru.Count)) {
            $l += ''; $l += '✅ Isi Apps Script sudah sama dengan repo. Tidak ada yang perlu dikirim.'
            Lapor ($l -join "`n"); exit 0
        }
        $l += ''; $l += '🚀 <b>Deploy</b> = simpan + versi baru + produksi pindah ke versi itu (URL tetap).'
        $l += '💾 <b>Simpan saja</b> = hanya isi editor (HEAD, uji lewat /dev); produksi tidak berubah.'
        $l += '<i>Berlaku 30 menit.</i>'
        $kb = New-Object System.Collections.Generic.List[object]
        $sufiks = $(if ($editor.Count) { '|paksa' } else { '' })
        $kb.Add(@(@{ text = $(if ($editor.Count) { '⚠️ Timpa & deploy' } else { '🚀 Deploy versi baru' }); callback_data = "dg|jalan|$idR$sufiks" }))
        $kb.Add(@(@{ text = '💾 Simpan saja (tanpa rilis)'; callback_data = "dg|simpan|$idR$sufiks" }, @{ text = '✖ Batal'; callback_data = 'x' }))
        Lapor ($l -join "`n") $kb.ToArray()
        Catat $T ("cek {0}: ubah {1}, baru {2}, editor {3}" -f $cm.pendek, $ubah.Count, $baru.Count, $editor.Count) | Out-Null
        exit 0
    }

    # ------------------------------------------------------ jalan / simpan
    $r = BacaJsonFile $FileRencana
    if (-not $r) { throw 'Tidak ada rencana. Kirim /deploy dulu.' }
    if ($Id -and $Id -ne [string]$r['id']) { throw 'Rencana sudah diganti oleh /deploy yang lebih baru. Pakai pesan terbaru.' }
    if (((Get-Date) - [datetime]$r['dibuat']).TotalMinutes -gt 30) { throw 'Rencana sudah lewat 30 menit. Kirim /deploy lagi.' }
    if (@(Ambil $r 'editor' @()).Count -and -not $Paksa) { throw 'Ada file yang diubah langsung di editor. Pakai tombol ⚠️ Timpa.' }
    Lapor ('⏳ {0} commit <code>{1}</code> ke Apps Script{2}…' -f $(if ($Aksi -eq 'jalan') { 'Deploy' } else { 'Menyimpan' }), $r['pendek'], $(if ($Peminta) { ' (oleh ' + (Html $Peminta) + ')' } else { '' }))

    $live = GasApi 'Get' ("projects/{0}/content" -f $c.scriptId)
    $liveFiles = @(Ambil $live 'files' @())
    if ((SidikIsi $liveFiles) -ne [string]$r['sidikLive']) { throw 'Isi Apps Script berubah sejak /deploy dicek (ada yang menyunting di editor). Kirim /deploy lagi.' }
    New-Item -ItemType Directory -Force -Path $DirCadangan | Out-Null
    $fCad = Join-Path $DirCadangan ((Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')
    [IO.File]::WriteAllText($fCad, (JsonTulis @{ scriptId = $c.scriptId; waktu = (Get-Date).ToString('o'); files = [object[]]$liveFiles }), (New-Object Text.UTF8Encoding($false)))
    Get-ChildItem $DirCadangan -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force -ErrorAction SilentlyContinue

    $kirim = @(@(Ambil $r 'files' @()) | ForEach-Object { @{ name = [string]$_['name']; type = [string]$_['type']; source = [string]$_['source'] } })
    [void](GasApi 'Put' ("projects/{0}/content" -f $c.scriptId) @{ files = [object[]]$kirim })

    $s = BacaState
    $jejak = @{}; foreach ($f in $kirim) { $jejak[$f.name] = Sha1Teks (NormalSumber $f.source) }
    $s['file'] = $jejak
    $hasil = @('✅ <b>Isi Apps Script diperbarui</b> dari commit <code>' + $r['pendek'] + '</code> · ' + (Html ([string]$r['pesan'])))
    if ($Aksi -eq 'jalan') {
        $desk = 'Telegram · {0} · {1}' -f $Peminta, $r['pendek']
        $v = GasApi 'Post' ("projects/{0}/versions" -f $c.scriptId) @{ description = $desk }
        $versi = [int]$v['versionNumber']
        $dep = GasApi 'Get' ("projects/{0}/deployments/{1}" -f $c.scriptId, $c.deploymentId)
        $lama = [int](Ambil (Ambil $dep 'deploymentConfig' @{}) 'versionNumber' 0)
        [void](GasApi 'Put' ("projects/{0}/deployments/{1}" -f $c.scriptId, $c.deploymentId) @{ deploymentConfig = @{ scriptId = $c.scriptId; versionNumber = $versi; manifestFileName = 'appsscript'; description = $desk } })
        $s['versi'] = $versi; $s['versiSebelumnya'] = $lama
        $hasil = @(('🚀 <b>Deploy selesai: produksi sekarang versi {0}</b> (sebelumnya {1})' -f $versi, $lama), ('Commit <code>{0}</code> · {1}' -f $r['pendek'], (Html ([string]$r['pesan']))), 'URL web app tetap sama.', ('Bermasalah? <code>/deploy balik</code> mengembalikan produksi ke versi {0}.' -f $lama))
    } else {
        $hasil += 'Produksi TIDAK berubah. Uji lewat URL /dev, lalu /deploy lagi untuk rilis.'
    }
    $s['commit'] = [string]$r['commit']; $s['pendek'] = [string]$r['pendek']; $s['waktu'] = (Get-Date).ToString('yyyy-MM-dd HH:mm'); $s['oleh'] = $Peminta
    TulisJsonFile $FileState $s
    Remove-Item $FileRencana -Force -ErrorAction SilentlyContinue
    $hasil += ('Cadangan isi lama: <code>{0}</code>' -f (Html $fCad))
    Lapor ($hasil -join "`n")
    Catat $T ("{0} {1} oleh {2}" -f $Aksi, $r['pendek'], $Peminta) | Out-Null
} catch {
    Catat $T ('gagal: ' + $_.Exception.Message) | Out-Null
    Lapor ('❌ Deploy gagal: ' + (Html $_.Exception.Message))
    exit 1
} finally {
    if ($kunciDeploy) { try { $kunciDeploy.ReleaseMutex() } catch {}; $kunciDeploy.Dispose() }
}
