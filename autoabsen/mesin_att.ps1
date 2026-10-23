# =====================================================================
#  mesin_att.ps1  -  Batasi / pulihkan mesin aktif di database Att (tabel Machines)
#  HARUS jalan di PowerShell 32-bit (Jet 4.0). Dipanggil download_att.ps1.
#     -Aksi batasi  -IP "192.168.62.201,192.168.61.201"  : simpan status Enabled semua
#                    mesin ke -Simpan (json), lalu Enabled=False untuk mesin di luar daftar
#     -Aksi pulihkan                                      : kembalikan Enabled dari -Simpan, hapus file
#  Att membaca daftar mesin saat dibuka, jadi Att harus tertutup saat batasi.
#  Keluaran: satu baris JSON.
# =====================================================================
param([Parameter(Mandatory)] [ValidateSet('batasi','pulihkan')] [string]$Aksi,
      [Parameter(Mandatory)] [string]$Mdb, [Parameter(Mandatory)] [string]$Simpan, [string]$IP = '')
$ErrorActionPreference = 'Stop'
$h = [ordered]@{ ok = $false; aksi = $Aksi; diubah = @() }
$cn = $null
try {
    if ($Aksi -eq 'pulihkan' -and -not (Test-Path -LiteralPath $Simpan)) { $h.ok = $true; $h.pesan = 'tidak ada yang perlu dipulihkan' }
    else {
        $cn = New-Object System.Data.OleDb.OleDbConnection ("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Mdb;Mode=Share Deny None;")
        $cn.Open()
        function Setel([int]$id, [bool]$aktif) {
            $c = $cn.CreateCommand(); $c.CommandText = 'UPDATE Machines SET Enabled = ? WHERE ID = ?'
            $p1 = $c.Parameters.Add('a', [System.Data.OleDb.OleDbType]::Boolean); $p1.Value = $aktif
            $p2 = $c.Parameters.Add('b', [System.Data.OleDb.OleDbType]::Integer); $p2.Value = $id
            [void]$c.ExecuteNonQuery()
        }
        if ($Aksi -eq 'batasi') {
            $izin = @($IP -split '[,; ]+' | Where-Object { $_ })
            if (-not $izin.Count) { throw 'Daftar IP kosong.' }
            if (Test-Path -LiteralPath $Simpan) { throw "Masih ada status lama di $Simpan (pulihkan dulu)." }
            $c = $cn.CreateCommand(); $c.CommandText = 'SELECT ID, MachineAlias, IP, Enabled FROM Machines'
            $rd = $c.ExecuteReader(); $semua = @()
            while ($rd.Read()) { $semua += [pscustomobject]@{ ID = [int]$rd['ID']; Nama = [string]$rd['MachineAlias']; IP = [string]$rd['IP']; Enabled = [bool]$rd['Enabled'] } }
            $rd.Close()
            ($semua | ConvertTo-Json -Compress) | Set-Content -LiteralPath $Simpan -Encoding UTF8
            foreach ($m in $semua) {
                if ($m.Enabled -and $izin -notcontains $m.IP) { Setel $m.ID $false; $h.diubah += $m.Nama }
            }
            $h.aktif = @($semua | Where-Object { $_.Enabled -and $izin -contains $_.IP } | ForEach-Object { $_.Nama })
        } else {
            # PS 5.1: ConvertFrom-Json mengeluarkan array sebagai satu objek -> diurai dulu lewat ForEach-Object
            $j = Get-Content -LiteralPath $Simpan -Raw | ConvertFrom-Json
            $semua = @($j | ForEach-Object { $_ })
            foreach ($m in $semua) { Setel ([int]$m.ID) ([bool]$m.Enabled); $h.diubah += [string]$m.Nama }
            Remove-Item -LiteralPath $Simpan -Force
        }
        $h.ok = $true
    }
} catch { $h.pesan = $_.Exception.Message }
finally { if ($cn) { $cn.Close(); $cn.Dispose() } }
Write-Output ($h | ConvertTo-Json -Compress)
