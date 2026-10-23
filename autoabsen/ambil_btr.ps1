# =====================================================================
#  ambil_btr.ps1  -  Ambil data "Jejak > Data Utama" departemen BTR dari database Att
#  HARUS jalan di PowerShell 32-bit (Jet 4.0). Dipanggil impor_btr.ps1.
#  Isi sama dengan ekspor Excel menu Jejak - Data Utama (Tampilkan Status &
#  Kode Kerja tidak dicentang), termasuk semua sub-departemen:
#     BTR-HARIAN : BANYUWANGI, ROMOKALISARI
#     BTR        : BTR Banyuwangi - GMS, BTR Romo-Operator, BTR Operasional
#  Keluaran: satu file TSV per departemen di -Keluar + satu baris JSON ringkasan.
# =====================================================================
param(
    [Parameter(Mandatory)] [string]$Dari,      # yyyy-MM-dd
    [Parameter(Mandatory)] [string]$Sampai,    # yyyy-MM-dd
    [Parameter(Mandatory)] [string]$Keluar,
    [string]$Mdb = '\\192.168.1.60\att\{tahun}.MDB',
    [string]$Departemen = 'BTR-HARIAN;BTR',
    [switch]$Status, [switch]$KodeKerja
)
$ErrorActionPreference = 'Stop'
$KOLOM = @('Departemen','Nama','NIK.','Tgl/Waktu','Status','Lokasi ID','ID Number','Kode Kerja','Kode Verifikasi','No Kartu')
$inv = [Globalization.CultureInfo]::InvariantCulture
$hasil = [ordered]@{ ok = $false; dept = @(); catatan = @() }

function TeksStatus([string]$t) {
    switch -CaseSensitive ($t) {
        'I' { 'C/Masuk' } 'O' { 'C/Keluar' } 'i' { 'Lembur Masuk' } 'o' { 'Lembur Keluar' }
        '0' { 'Istirahat Keluar' } '1' { 'Istirahat Masuk' } default { $t }
    }
}
function TeksVerifikasi($v) {
    if ($v -is [DBNull] -or $null -eq $v) { return '' }
    switch ([int]$v) { 0 { 'Password' } 1 { 'Sidik Jari' } 2 { 'Kartu' } 15 { 'Wajah' } default { [string]$v } }
}
function Bersih($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' }; return (([string]$v) -replace '[\t\r\n]+', ' ').Trim() }

try {
    $a = [datetime]::ParseExact($Dari, 'yyyy-MM-dd', $inv)
    $b = [datetime]::ParseExact($Sampai, 'yyyy-MM-dd', $inv).AddDays(1)
    $akar = @($Departemen -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $baris = @{}; foreach ($n in $akar) { $baris[$n] = New-Object System.Collections.Generic.List[object] }

    foreach ($th in ($a.Year)..($b.AddSeconds(-1).Year)) {
        $f = $Mdb -replace '\{tahun\}', $th
        if (-not (Test-Path -LiteralPath $f)) { $hasil.catatan += "file tidak ada: $f"; continue }
        $cn = New-Object System.Data.OleDb.OleDbConnection ("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$f;Mode=Share Deny None;")
        $cn.Open()
        try {
            # pohon departemen
            $nama = @{}; $anak = @{}
            $cmd = $cn.CreateCommand(); $cmd.CommandText = 'SELECT DEPTID, DEPTNAME, SUPDEPTID FROM DEPARTMENTS'
            $rd = $cmd.ExecuteReader()
            while ($rd.Read()) {
                $id = [int]$rd['DEPTID']; $sup = [int]$rd['SUPDEPTID']
                $nama[$id] = Bersih $rd['DEPTNAME']
                if (-not $anak.ContainsKey($sup)) { $anak[$sup] = New-Object System.Collections.Generic.List[int] }
                $anak[$sup].Add($id)
            }
            $rd.Close()
            $milik = @{}   # DEPTID -> nama akar
            foreach ($n in $akar) {
                $ids = @($nama.Keys | Where-Object { $nama[$_] -eq $n })
                if (-not $ids.Count) { throw "Departemen '$n' tidak ada di $f" }
                $antre = New-Object System.Collections.Generic.Queue[int]
                foreach ($i in $ids) { $antre.Enqueue($i) }
                while ($antre.Count) {
                    $i = $antre.Dequeue()
                    if ($milik.ContainsKey($i)) { continue }
                    $milik[$i] = $n
                    if ($anak.ContainsKey($i)) { foreach ($c in $anak[$i]) { $antre.Enqueue($c) } }
                }
            }
            # scan dalam rentang
            $cmd = $cn.CreateCommand()
            $cmd.CommandText = 'SELECT u.Badgenumber, u.Name, u.SSN, u.CardNo, u.DEFAULTDEPTID, c.CHECKTIME, c.CHECKTYPE, c.VERIFYCODE, c.SENSORID, c.WorkCode ' +
                               'FROM CHECKINOUT AS c INNER JOIN USERINFO AS u ON c.USERID = u.USERID WHERE c.CHECKTIME >= ? AND c.CHECKTIME < ?'
            $p1 = $cmd.Parameters.Add('p1', [System.Data.OleDb.OleDbType]::Date); $p1.Value = $a
            $p2 = $cmd.Parameters.Add('p2', [System.Data.OleDb.OleDbType]::Date); $p2.Value = $b
            $rd = $cmd.ExecuteReader()
            while ($rd.Read()) {
                $dep = if ($rd['DEFAULTDEPTID'] -is [DBNull]) { 0 } else { [int]$rd['DEFAULTDEPTID'] }
                if (-not $milik.ContainsKey($dep)) { continue }
                $nik = Bersih $rd['Badgenumber']
                $t = [datetime]$rd['CHECKTIME']
                $angka = 0L; [void][int64]::TryParse($nik, [ref]$angka)
                $baris[$milik[$dep]].Add([pscustomobject]@{
                    dept = $nama[$dep]; nik = $nik; urut = $angka; t = $t
                    isi = @($nama[$dep], (Bersih $rd['Name']), $nik, $t.ToString('dd/MM/yyyy HH:mm:ss', $inv),
                            $(if ($Status) { TeksStatus (Bersih $rd['CHECKTYPE']) } else { '' }),
                            (Bersih $rd['SENSORID']), (Bersih $rd['SSN']),
                            $(if ($KodeKerja) { Bersih $rd['WorkCode'] } else { '' }),
                            (TeksVerifikasi $rd['VERIFYCODE']), (Bersih $rd['CardNo'])) -join "`t"
                })
            }
            $rd.Close()
        } finally { $cn.Close(); $cn.Dispose() }
    }

    New-Item -ItemType Directory -Force -Path $Keluar | Out-Null
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($n in $akar) {
        $L = @($baris[$n] | Sort-Object dept, urut, nik, t)
        $file = Join-Path $Keluar ('btr_' + ($n -replace '[^A-Za-z0-9]+', '_') + '.tsv')
        $isi = @($KOLOM -join "`t") + @($L | ForEach-Object { $_.isi })
        [IO.File]::WriteAllText($file, ($isi -join "`r`n") + "`r`n", $utf8)
        $hasil.dept += [ordered]@{
            nama = $n; file = $file; baris = $L.Count
            karyawan = @($L | Select-Object -ExpandProperty nik -Unique).Count
            sub = @($L | Select-Object -ExpandProperty dept -Unique)
            min = $(if ($L.Count) { ($L | ForEach-Object { $_.t } | Sort-Object | Select-Object -First 1).ToString('yyyy-MM-dd HH:mm:ss', $inv) } else { '' })
            max = $(if ($L.Count) { ($L | ForEach-Object { $_.t } | Sort-Object | Select-Object -Last 1).ToString('yyyy-MM-dd HH:mm:ss', $inv) } else { '' })
        }
    }
    $hasil.ok = $true
} catch { $hasil.pesan = $_.Exception.Message }
Write-Output ($hasil | ConvertTo-Json -Depth 5 -Compress)
