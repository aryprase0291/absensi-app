# =====================================================================
#  repo.ps1  -  Akses repo GitHub aryprase0291/absensi-app (baca saja)
#    . (Join-Path $PSScriptRoot 'repo.ps1')   (setelah umum.ps1)
#
#  Dipakai perbarui.ps1 (skrip AutoAbsen dari folder autoabsen/) dan
#  deploy_gas.ps1 (file .gs dari folder apps-script/).
#  Repo public -> tidak perlu token. Batas GitHub API tanpa token:
#  60 permintaan/jam per IP; satu /perbarui atau /deploy memakai 2.
#  File diunduh dari raw.githubusercontent.com (tidak dihitung batas API).
#
#  Ganti repo/cabang lewat repo.json: { "pemilik": "...", "repo": "...", "cabang": "main" }
# =====================================================================
function KonfigRepo {
    $d = [ordered]@{ pemilik = 'aryprase0291'; repo = 'absensi-app'; cabang = 'main' }
    $f = Join-Path $AA_Dasar 'repo.json'
    if (Test-Path $f) {
        try {
            $j = Get-Content $f -Raw | ConvertFrom-Json
            foreach ($k in @('pemilik', 'repo', 'cabang')) { if ($j.$k) { $d[$k] = [string]$j.$k } }
        } catch {}
    }
    return [pscustomobject]$d
}

function UnduhByte([string]$url, [int]$timeout = 60) {
    $p = @{ Uri = $url; Method = 'Get'; UseBasicParsing = $true; TimeoutSec = $timeout; Headers = @{ 'User-Agent' = 'AutoAbsen' } }
    $r = Invoke-WebRequest @p
    return ,($r.RawContentStream.ToArray())
}
function GitHubApi([string]$jalur) {
    $byte = UnduhByte ('https://api.github.com' + $jalur) 60
    return ([Text.Encoding]::UTF8.GetString($byte) | ConvertFrom-Json)
}

# Commit terbaru di cabang -> @{ sha; pesan; waktu; pendek }
function RepoCommitTerbaru {
    $c = KonfigRepo
    $x = GitHubApi ('/repos/{0}/{1}/commits/{2}' -f $c.pemilik, $c.repo, $c.cabang)
    $pesan = ([string]$x.commit.message -split "`n")[0]
    return [pscustomobject]@{ sha = [string]$x.sha; pendek = ([string]$x.sha).Substring(0, 7); pesan = $pesan; waktu = [string]$x.commit.author.date }
}

# Daftar file (blob) pada commit, opsional disaring awalan folder -> @{ path; sha; size }
function RepoDaftarFile([string]$sha, [string]$awalan = '') {
    $c = KonfigRepo
    $t = GitHubApi ('/repos/{0}/{1}/git/trees/{2}?recursive=1' -f $c.pemilik, $c.repo, $sha)
    if ($t.truncated) { throw 'Daftar file repo terpotong (repo terlalu besar untuk satu permintaan).' }
    return @($t.tree | Where-Object { $_.type -eq 'blob' -and ([string]$_.path).StartsWith($awalan) } |
        ForEach-Object { [pscustomobject]@{ path = [string]$_.path; sha = [string]$_.sha; size = [int64]$_.size } })
}

function RepoUnduhFile([string]$sha, [string]$path) {
    $c = KonfigRepo
    $jalur = (@($path -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    $url = 'https://raw.githubusercontent.com/{0}/{1}/{2}/{3}' -f $c.pemilik, $c.repo, $sha, $jalur
    return ,(UnduhByte $url 90)
}

# SHA-1 blob git dari isi file (sama dengan kolom sha di daftar file GitHub)
function GitBlobSha([byte[]]$isi) {
    $kepala = [Text.Encoding]::ASCII.GetBytes(('blob {0}' -f $isi.Length) + [char]0)
    $semua = New-Object byte[] ($kepala.Length + $isi.Length)
    [Array]::Copy($kepala, 0, $semua, 0, $kepala.Length)
    [Array]::Copy($isi, 0, $semua, $kepala.Length, $isi.Length)
    $h = [Security.Cryptography.SHA1]::Create()
    try { return (($h.ComputeHash($semua) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}

function Sha1Teks([string]$s) {
    $h = [Security.Cryptography.SHA1]::Create()
    try { return (($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}

# UTF-8 tanpa BOM -> string
function ByteKeTeks([byte[]]$b) {
    $t = [Text.Encoding]::UTF8.GetString($b)
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    return $t
}

# ---------- JSON besar ----------
# ConvertFrom-Json / ConvertTo-Json di PowerShell 5.1 lambat & bermasalah untuk
# JSON ~1 MB (isi project Apps Script). Pakai JavaScriptSerializer bila ada;
# di PowerShell 7 jatuh ke ConvertFrom-Json -AsHashtable. Keduanya memberi
# kamus yang dibaca dengan $x['kunci'].
$Global:AA_JsonSer = $null
try {
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    $Global:AA_JsonSer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $Global:AA_JsonSer.MaxJsonLength = [int]::MaxValue
    $Global:AA_JsonSer.RecursionLimit = 200
} catch { $Global:AA_JsonSer = $null }
function JsonBaca([string]$s) {
    if ($AA_JsonSer) { return $AA_JsonSer.DeserializeObject($s) }
    return ($s | ConvertFrom-Json -AsHashtable -Depth 100)
}
# Lepas pembungkus PSObject (JavaScriptSerializer akan menulis properti
# PSObject-nya, bukan nilainya) dan ubah semua kamus/larik ke bentuk polos.
function Polos($x) {
    if ($null -eq $x) { return $null }
    if ($x -is [System.Management.Automation.PSCustomObject]) {
        # properti PSCustomObject ada di pembungkusnya: baca SEBELUM dibuka
        $d = New-Object 'System.Collections.Generic.Dictionary[string,object]'
        foreach ($p in $x.PSObject.Properties) { $d[$p.Name] = (Polos $p.Value) }
        return $d
    }
    if ($x -is [System.Management.Automation.PSObject]) { $x = $x.PSObject.BaseObject }
    if ($x -is [string] -or $x -is [ValueType]) { return $x }
    if ($x -is [System.Collections.IDictionary]) {
        $d = New-Object 'System.Collections.Generic.Dictionary[string,object]'
        foreach ($k in @($x.Keys)) { $d[[string]$k] = (Polos $x[$k]) }
        return $d
    }
    if ($x -is [System.Collections.IEnumerable]) {
        $l = New-Object System.Collections.Generic.List[object]
        foreach ($e in $x) { $l.Add((Polos $e)) }
        return ,($l.ToArray())
    }
    return $x
}
function JsonTulis($obj) {
    $obj = Polos $obj
    if ($AA_JsonSer) { return $AA_JsonSer.Serialize($obj) }
    return ($obj | ConvertTo-Json -Depth 100 -Compress)
}
