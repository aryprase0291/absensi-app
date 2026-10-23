# =====================================================================
#  cek_mdb.ps1  -  Periksa isi salinan database Att (.mdb) lewat Jet OLEDB
#  HARUS jalan di PowerShell 32-bit (SysWOW64) karena Jet 4.0 hanya 32-bit.
#  Dipanggil backup_db.ps1. Keluaran: satu baris JSON
#     {"ok":true,"tabel":40,"scan":123456,"scan_terakhir":"2026-10-16 13:27:00","karyawan":217}
# =====================================================================
param([Parameter(Mandatory)] [string]$Mdb)
$ErrorActionPreference = 'Stop'
$h = [ordered]@{ ok = $false }
$cn = $null
foreach ($prov in @('Microsoft.Jet.OLEDB.4.0', 'Microsoft.ACE.OLEDB.12.0')) {
    try {
        $cn = New-Object System.Data.OleDb.OleDbConnection ("Provider=$prov;Data Source=$Mdb;Mode=Read;")
        $cn.Open(); $h.provider = $prov; break
    } catch { $h.pesan = $_.Exception.Message; $cn = $null }
}
if ($cn) {
    try {
        $t = $cn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, [object[]]@($null, $null, $null, 'TABLE'))
        $nama = @($t.Rows | ForEach-Object { [string]$_['TABLE_NAME'] })
        $h.tabel = $nama.Count
        function Skalar([string]$sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; return $c.ExecuteScalar() }
        if ($nama -contains 'CHECKINOUT') {
            $h.scan = [int64](Skalar 'SELECT COUNT(*) FROM CHECKINOUT')
            $m = Skalar 'SELECT MAX(CHECKTIME) FROM CHECKINOUT WHERE CHECKTIME <= Now()+1'
            if ($m -and $m -isnot [DBNull]) { $h.scan_terakhir = ([datetime]$m).ToString('yyyy-MM-dd HH:mm:ss') }
        }
        if ($nama -contains 'USERINFO') { $h.karyawan = [int](Skalar 'SELECT COUNT(*) FROM USERINFO') }
        $h.ok = $true; $h.Remove('pesan')
    } catch { $h.pesan = $_.Exception.Message }
    finally { $cn.Close(); $cn.Dispose() }
}
Write-Output ($h | ConvertTo-Json -Compress)
