# =====================================================================
#  bot_telegram.ps1  -  Bot Telegram AutoAbsen (jalan terus, long-polling)
#
#  SETUP SEKALI (PowerShell admin):
#    1. Buat bot di @BotFather (/newbot), salin tokennya.
#    2. Masukkan bot ke grup laporan.
#    3. powershell -ExecutionPolicy Bypass -File D:\AutoAbsen\bot_telegram.ps1 -Daftar
#       tempel token, lalu ketik /daftar DI GRUP. Pengirim /daftar jadi admin.
#    Tambah admin lain: minta orangnya ketik /id di grup, lalu
#       bot_telegram.ps1 -TambahAdmin <id>
#
#  Perintah:
#    /status  /log [n]  /bantuan  /id           (semua anggota grup)
#    /download                                   (admin)
#    /impor [dari] [sampai]                      (admin, ada tombol pilih & konfirmasi)
#    /lengkap [dari] [sampai]                    (admin: download + impor)
#    /backup [sekarang|daftar|jadwal ..|simpan ..] (backup database Att; atur jadwal = admin)
#    /btr [dari] [sampai]                        (impor Data Utama BTR-HARIAN & BTR ke web Daily_Bromo_Bwi)
#    /sinkron [status]                           (Sinkron GSheet: Tabel Data -> db1-absen + Sinkron Absensi)
#    /deploy [status|balik|nama A=B]             (admin: .gs dari GitHub -> Apps Script -> versi baru)
#    /perbarui                                   (admin: skrip D:\AutoAbsen dari GitHub folder autoabsen/)
#  Tanggal: 2026-10-01, 01/10/2026, 01-10-2026, atau 01/10 (tahun ini)
# =====================================================================
param([switch]$Daftar, [string]$TambahAdmin = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'umum.ps1')
$T = 'BOT'
$FileOffset = Join-Path $AA_Dasar 'bot_offset.txt'

# ---------------------------------------------------------------- setup
if ($TambahAdmin) {
    $k = KonfigTelegram
    SimpanKonfigTelegram $k.Grup (@($k.Admin) + $TambahAdmin)
    Write-Output "Admin ditambahkan: $TambahAdmin"; exit 0
}
if ($Daftar) {
    $s = Read-Host 'Tempel token bot dari @BotFather' -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
    $me = Invoke-RestMethod "https://api.telegram.org/bot$token/getMe" -TimeoutSec 30
    SimpanDpapi (Join-Path $AA_Dasar 'telegram.dat') $token
    Write-Output ("Token OK: @{0}. Sekarang ketik /daftar di GRUP (bot sudah dimasukkan ke grup). Menunggu 5 menit..." -f $me.result.username)
    $k = KonfigTelegram; $grup = $k.Grup; $admin = @($k.Admin)
    $off = 0; $batas = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $batas) {
        $u = Invoke-RestMethod "https://api.telegram.org/bot$token/getUpdates?timeout=20&offset=$off" -TimeoutSec 40
        foreach ($x in $u.result) {
            $off = $x.update_id + 1
            $m = $x.message
            if (-not $m -or -not $m.text) { continue }
            if ($m.text -notmatch '^/daftar') { continue }
            $admin += [string]$m.from.id
            $nmAdmin = @{}; $nmAdmin[[string]$m.from.id] = (($m.from.first_name, $m.from.last_name) -join ' ').Trim()
            if ($m.chat.type -in @('group','supergroup')) {
                $grup = [string]$m.chat.id
                SimpanKonfigTelegram $grup $admin $null $nmAdmin
                Set-Content -Path $FileOffset -Value $off
                [void](PostJson "https://api.telegram.org/bot$token/sendMessage" @{ chat_id = $grup; text = "✅ Grup terdaftar untuk laporan AutoAbsen. Admin: $($m.from.first_name) ($($m.from.id)). Ketik /bantuan." })
                Write-Output "Grup tersimpan: $grup ($($m.chat.title)); admin: $($m.from.id) $($m.from.first_name)"
                exit 0
            } else {
                SimpanKonfigTelegram $grup $admin
                Write-Output "Admin tersimpan dari chat pribadi: $($m.from.id). Ketik /daftar di GRUP juga."
            }
        }
    }
    Write-Output 'Waktu habis. Ulangi -Daftar.'; exit 1
}

# ---------------------------------------------------------------- satu instance
$satu = New-Object System.Threading.Mutex($false, 'Global\AutoAbsenBot')
try { if (-not $satu.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] {}

# ---------------------------------------------------------------- utilitas
function Balas([string]$chat, [string]$teks, $tombol = $null) { KirimTelegram $teks $chat $tombol }
# Jalankan skrip AutoAbsen di latar belakang; skrip melapor sendiri ke $chat.
function JalankanLatar([string]$skrip, [string]$chat, [string]$nama, [string[]]$arg = @()) {
    $a = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar $skrip)`"",'-Chat',$chat,'-Peminta',"`"$nama`"") + $arg
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $a
    Catat $T ("Mulai {0} {1} oleh {2}" -f $skrip, ($arg -join ' '), $nama) | Out-Null
}

# Boleh menjalankan pekerjaan? Admin selalu boleh; anggota grup boleh bila /izin semua (hanya di grup).
function BolehJalan($k, [string]$uid, [string]$chat) {
    if ($k.Admin -contains $uid) { return $true }
    if ($k.GrupLain.ContainsKey($chat)) { return $true }   # perintahnya sudah disaring per grup
    return ($k.AnggotaBoleh -and $chat -eq $k.Grup)
}
function TolakIzin([string]$chat, [string]$nama) {
    Balas $chat ("⛔ {0}, perintah ini hanya untuk admin bot.`nAdmin bisa membuka untuk semua anggota dengan <code>/izin semua</code>, atau menjadikan Anda admin dengan me-reply pesan Anda: <code>/tambahadmin</code>" -f (Html $nama))
}

function ParseTanggal([string]$s) {
    $s = $s.Trim(); $th = (Get-Date).Year
    if ($s -match '^(\d{4})-(\d{1,2})-(\d{1,2})$') { return Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] }
    if ($s -match '^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$') { return Get-Date -Year $Matches[3] -Month $Matches[2] -Day $Matches[1] }
    if ($s -match '^(\d{1,2})[/\-.](\d{1,2})$') { return Get-Date -Year $th -Month $Matches[2] -Day $Matches[1] }
    throw "Tanggal tidak dikenali: $s"
}
function CekRentang([datetime]$a, [datetime]$b) {
    $a = $a.Date; $b = $b.Date
    if ($a -gt $b) { throw 'Tanggal awal lebih besar dari tanggal akhir.' }
    if ($b -gt (Get-Date).Date) { throw 'Tanggal akhir tidak boleh melewati hari ini.' }
    if (($b - $a).TotalDays -gt 62) { throw 'Rentang maksimal 62 hari.' }
}
function Fmt([datetime]$d) { return $d.ToString('yyyy-MM-dd') }

function Baris { param([Parameter(ValueFromRemainingArguments)]$t) return ,([object[]]$t) }
function TombolRentang([string]$tugas) {
    $h = (Get-Date).Date; $p = PeriodeBerjalan $h
    $pl = PeriodeBerjalan $p.AddDays(-1); $plAkhir = $p.AddDays(-1)
    $kb = New-Object System.Collections.Generic.List[object]
    $kb.Add((Baris @{ text = ('Periode berjalan ({0:dd/MM}–{1:dd/MM})' -f $p, $h); callback_data = "r|$tugas|$(Fmt $p)|$(Fmt $h)" }))
    $kb.Add((Baris @{ text = 'Hari ini'; callback_data = "r|$tugas|$(Fmt $h)|$(Fmt $h)" } `
                   @{ text = 'Kemarin';  callback_data = "r|$tugas|$(Fmt $h.AddDays(-1))|$(Fmt $h.AddDays(-1))" } `
                   @{ text = '7 hari';   callback_data = "r|$tugas|$(Fmt $h.AddDays(-6))|$(Fmt $h)" }))
    $kb.Add((Baris @{ text = ('Periode lalu ({0:dd/MM}–{1:dd/MM})' -f $pl, $plAkhir); callback_data = "r|$tugas|$(Fmt $pl)|$(Fmt $plAkhir)" }))
    $kb.Add((Baris @{ text = '📅 Ketik tanggal sendiri'; callback_data = "t|$tugas" }))
    $kb.Add((Baris @{ text = '✖ Batal'; callback_data = 'x' }))
    return ,($kb.ToArray())
}
function TombolKonfirmasi([string]$tugas, [string]$a, [string]$b, [string]$mode) {
    $kb = New-Object System.Collections.Generic.List[object]
    $teksJalan = if ($mode -eq 'replace') { '⚠️ Ya, ganti SELURUH isi' } else { '✅ Jalankan' }
    $kb.Add((Baris @{ text = $teksJalan; callback_data = "k|$tugas|$a|$b|$mode" } @{ text = '✖ Batal'; callback_data = 'x' }))
    return ,($kb.ToArray())
}
function TombolMode([string]$tugas, [string]$a, [string]$b) {
    $kb = New-Object System.Collections.Generic.List[object]
    $kb.Add((Baris @{ text = '✅ Tambah + perbarui (normal)'; callback_data = "m|$tugas|$a|$b|upsert" }))
    $kb.Add((Baris @{ text = '♻️ Ganti seluruh periode (No. Akun di file)'; callback_data = "m|$tugas|$a|$b|periode" }))
    $kb.Add((Baris @{ text = '⚠️ Ganti seluruh isi tabel'; callback_data = "m|$tugas|$a|$b|replace" }))
    $kb.Add((Baris @{ text = '✖ Batal'; callback_data = 'x' }))
    return ,($kb.ToArray())
}
$PenjelasanMode = @{
    upsert  = "<b>Tambah + perbarui</b> (normal)`n• No. Akun + tanggal yang belum ada → ditambahkan.`n• Yang sudah ada → diperbarui dengan isi file (termasuk NIK, nama, jam, symbol).`n• Selain itu <b>tidak disentuh</b>."
    periode = "<b>Ganti seluruh periode untuk No. Akun yang ada di file</b>`n• Untuk tiap No. Akun di file, semua barisnya dalam rentang ini <b>dibuang dulu</b> — termasuk tanggal yang tidak ada di file — lalu diisi ulang.`n• No. Akun yang tidak ada di file tidak disentuh.`n• Pakai bila ada sisa baris import lama yang harus hilang."
    replace = "<b>⚠️ Ganti SELURUH isi tabel</b>`n• <b>Semua baris lama di db_absen dibuang</b> (semua periode, semua karyawan), lalu diisi hanya dengan hasil rentang ini.`n• Pakai hanya bila file ini berisi seluruh data yang Anda perlukan."
}
function JumlahDiWeb {
    try {
        $r = BacaDpapi (Join-Path $AA_Dasar 'rahasia.dat')
        $h = @{ apikey = $AA_Anon; Authorization = "Bearer $AA_Anon"; 'x-sinkron-rahasia' = $r }
        $v = PostJson "$AA_Supabase/functions/v1/dbabsen" @{ aksi = 'versi' } $h 20
        return [int]$v.total
    } catch { return -1 }
}
function TeksKonfirmasi([string]$tugas, [datetime]$a, [datetime]$b, [string]$mode) {
    $n = [int]($b.Date - $a.Date).TotalDays + 1
    $apa = if ($tugas -eq 'lengkap') { 'Download mesin lalu kalkulasi + <b>impor ke web</b>' } else { 'Kalkulasi + ekspor Att lalu <b>impor ke web</b>' }
    $t = "{0}`nRentang: <b>{1:dd/MM/yyyy} – {2:dd/MM/yyyy}</b> ({3} hari)`n`nCara menulis:`n{4}" -f $apa, $a, $b, $n, $PenjelasanMode[$mode]
    if ($mode -eq 'replace') {
        $tot = JumlahDiWeb
        if ($tot -ge 0) { $t += ("`n`n❗ Saat ini db_absen berisi <b>{0:n0} baris</b>. Semuanya akan dihapus dan diganti hasil rentang ini." -f $tot) }
    }
    return $t + "`n`nLanjut?"
}
$Menunggu = @{}   # "chat|user" -> @{ tugas; batas } untuk input tanggal manual
function MintaTanggal([string]$chat, [string]$uid, [string]$tugas) {
    $Menunggu["$chat|$uid"] = @{ tugas = $tugas; batas = (Get-Date).AddMinutes(5) }
    $isi = @{ chat_id = $chat; parse_mode = 'HTML'
              text = ("📅 Ketik rentang tanggal untuk <b>{0}</b> (balas pesan ini, maks 5 menit):`n<code>21/09/2026 - 20/10/2026</code>  ·  <code>01/10 10/10</code>  ·  satu tanggal <code>15/10</code>" -f $tugas)
              reply_markup = @{ force_reply = $true; selective = $true; input_field_placeholder = 'dd/mm/yyyy dd/mm/yyyy' } }
    [void](TelegramApi 'sendMessage' $isi)
}
function TerimaTanggal([string]$chat, [string]$tugas, [string]$teks) {
    # Ambil semua tanggal di teks: "21/09/2026 - 20/10/2026", "21/09/2026-20/10/2026",
    # "21/09 s/d 20/10", "2026-09-21 2026-10-20", atau satu tanggal.
    $pola = '\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{4})?'
    $tgl = @([regex]::Matches($teks, $pola) | ForEach-Object { $_.Value })
    if ($tgl.Count -eq 0) { throw 'Tanggal tidak ditemukan. Contoh: 21/09/2026 - 20/10/2026' }
    $a = (ParseTanggal $tgl[0]).Date
    $b = if ($tgl.Count -ge 2) { (ParseTanggal $tgl[1]).Date } else { $a }
    $catatan = ''
    $hari = (Get-Date).Date
    if ($b -gt $hari) {
        $catatan = "`nℹ️ Tanggal akhir {0:dd/MM/yyyy} belum terjadi, dipotong ke hari ini <b>{1:dd/MM/yyyy}</b> (hari yang belum lewat akan terhitung Alpa). Sisa hari diisi jadwal otomatis." -f $b, $hari
        $b = $hari
    }
    if ($a -gt $hari) { throw ('Tanggal awal {0:dd/MM/yyyy} belum terjadi.' -f $a) }
    CekRentang $a $b
    if ($tugas -eq 'btr') { Balas $chat ((TeksKonfirmasiBtr $a $b $chat) + $catatan) (TombolKonfirmasiBtr (Fmt $a) (Fmt $b) $chat); return }
    Balas $chat ("Rentang <b>{0:dd/MM/yyyy} – {1:dd/MM/yyyy}</b>.{2}`nPilih cara menulis ke web:" -f $a, $b, $catatan) (TombolMode $tugas (Fmt $a) (Fmt $b))
}

function Mulai([string]$tugas, [string]$a, [string]$b, [string]$peminta, [string]$chat, [string]$mode = 'upsert') {
    $arg = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar 'jalankan.ps1')`"",'-Tugas',$tugas,'-Sumber','telegram','-Peminta',"`"$peminta`"",'-Chat',$chat)
    if ($a) { $arg += @('-Dari', $a, '-Sampai', $b, '-Mode', $mode) }
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $arg
    Catat $T ("Mulai {0} {1} {2} mode {3} oleh {4}" -f $tugas, $a, $b, $mode, $peminta) | Out-Null
}

function TeksStatus {
    $l = @('📋 <b>Status AutoAbsen</b>', '')
    $st = Join-Path $AA_Dasar 'status_terakhir.txt'
    $l += ('⚙️ Pekerjaan: ' + $(if (AdaPekerjaan) { '<b>sedang berjalan</b> ⏳' } else { 'tidak ada' }))
    $l += ('🖥 Att: ' + $(if (AttJalan) { 'terbuka' } else { 'tertutup' }) + (' · PC diam {0} mnt' -f (Angka ([AAWin]::DiamDetik() / 60))))
    $l += ''
    $l += '📡 <b>Mesin</b>'
    foreach ($m in $AA_Mesin) { $l += ('{0} {1}' -f $(if (TesPort $m.IP 4370 1500) { '🟢' } else { '🔴' }), $m.Nama) }
    try {
        $r = PanggilLogOtomasi @{ aksi = 'daftar'; batas = 1 }
        if ($r.list -and @($r.list).Count) { $l += ''; $l += '🕘 <b>Terakhir</b>'; $l += (BarisLog $r.list[0]) }
    } catch {
        if (Test-Path $st) { $l += ''; $l += ('🕘 ' + (Html ((Get-Content $st -Raw).Trim()))) }
    }
    $ab = BacaBackupTerakhir; $cb = KonfigBackup
    if ($ab -and $ab.waktu) { $l += ''; $l += ('💾 Backup terakhir: {0:dd/MM HH:mm} · zip {1}' -f [datetime]::ParseExact([string]$ab.waktu, 'yyyy-MM-dd HH:mm:ss', $null), (Ukuran $ab.ukuran_zip)) }
    $l += ''; $l += ('<i>Jadwal otomatis: 12:00 · 18:00 · 01:00 · backup {0}</i>' -f $(if ($cb.aktif -and @($cb.jam).Count) { @($cb.jam) -join ', ' } else { 'mati' }))
    return ($l -join "`n")
}
function BarisLog($x) {
    $label = @{ download = 'Download mesin'; impor = 'Impor ke web'; lengkap = 'Download + impor'; tutup = 'Tutup Att'; backup = 'Backup database'; btr = 'Impor BTR → web Bromo' }[[string]$x.tugas]
    if (-not $label) { $label = [string]$x.tugas }
    $w = ([datetime]$x.dibuat_pada).ToLocalTime().ToString('dd/MM HH:mm')
    $ik = $AA_Ikon[[string]$x.status]; if (-not $ik) { $ik = '•' }
    $l = @(('{0} <b>{1}</b> · {2}' -f $ik, $label, $w))
    $dt = $x.detail
    $mode = if ($dt -and $dt.mode) { $AA_NamaMode[[string]$dt.mode] } else { '' }
    if ($x.dari) { $l += ('📅 {0}{1}' -f (Rentang ([string]$x.dari) ([string]$x.sampai)), $(if ($mode) { " · $mode" } else { '' })) }
    $adaRinci = $false
    if ($dt -and $dt.download -and $null -ne $dt.download.ok) {
        $g = @($dt.download.gagal | Where-Object { $_ })
        $l += ('📥 Mesin {0}/{1}{2}' -f $dt.download.ok, $dt.download.total, $(if ($g.Count) { ' · gagal: ' + (Html ($g -join ', ')) } else { '' }))
        $adaRinci = $true
    }
    if ($dt -and $dt.impor) {
        if ($dt.impor.status -eq 'sukses') {
            $r = '🌐 {0} baris · ➕{1} · ✏️{2}' -f (Angka $dt.impor.baris), (Angka $dt.impor.baru), (Angka $dt.impor.diperbarui)
            if ([int]$dt.impor.ditimpa -gt 0) { $r += (' · 🗑{0}' -f (Angka $dt.impor.ditimpa)) }
            $l += $r
        } else { $l += ('🌐 ' + (Html ([string]$dt.impor.pesan))) }
        $adaRinci = $true
    }
    if ($dt -and $dt.btr) {
        foreach ($d in @($dt.btr.dept)) { $l += ('🏭 {0}: {1} scan · ➕{2}' -f (Html ([string]$d.nama)), (Angka $d.baris), (Angka $d.baru)) }
        $adaRinci = $true
    }
    if ($dt -and $dt.backup) {
        $r = '💾 {0} · zip {1}' -f (Html ([string]$dt.backup.nama)), (Ukuran $dt.backup.ukuran_zip)
        if ($dt.backup.scan) { $r += (' · {0} scan' -f (Angka $dt.backup.scan)) }
        $l += $r; $adaRinci = $true
    }
    if (-not $adaRinci -and $x.ringkasan) {
        $rs = ([string]$x.ringkasan) -replace '[^\u0000-ɏ\s\|\(\)\[\]\.,:;/\-+%<>=]', '' -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&'
        $rs = ($rs -replace '\s+', ' ').Trim(' ', '|')
        if ($rs.Length -gt 120) { $rs = $rs.Substring(0, 120) + '…' }
        if ($rs) { $l += ('💬 ' + (Html $rs)) }
    }
    $oleh = if ($x.peminta) { '👤 ' + (Html ([string]$x.peminta)) } elseif ($x.sumber -eq 'jadwal') { '⏰ jadwal' } else { '🖥 ' + [string]$x.sumber }
    if ($x.durasi_detik) { $oleh += (' · {0} dtk' -f (Angka $x.durasi_detik)) }
    $l += ('<i>{0}</i>' -f $oleh)
    return ($l -join "`n")
}
function TeksLog([int]$n) {
    $r = PanggilLogOtomasi @{ aksi = 'daftar'; batas = $n }
    if (-not $r.list -or @($r.list).Count -eq 0) { return 'Belum ada riwayat.' }
    $blok = @("🗒 <b>Riwayat $n terakhir</b>")
    foreach ($x in $r.list) { $blok += ''; $blok += (BarisLog $x) }
    return ($blok -join "`n")
}
$Bantuan = @"
🤖 <b>AutoAbsen</b>
/status — kondisi PC, Att, 7 mesin, hasil terakhir
/log [n] — riwayat (default 10)
/download — tarik scan dari 7 mesin (admin)
/impor [dari] [sampai] — kalkulasi + impor ke web (admin)
/lengkap [dari] [sampai] — download + impor (admin)
/tutup — tutup aplikasi Attendance Management di PC (admin; /tutup paksa bila sedang dipakai)
/btr [dari] [sampai] — impor Data Utama BTR-HARIAN &amp; BTR ke web Daily_Bromo_Bwi
/daftarbtr — (admin, ketik di grup lain) izinkan grup itu memakai /btr saja · /hapusgrup untuk mencabut
/backup — backup database absen: status, backup sekarang, atur jadwal (<code>/backup bantuan</code>)
/sinkron — Sinkron GSheet (Tabel Data → db1-absen + Sinkron Absensi) · <code>/sinkron status</code>
/deploy — (admin) kirim .gs dari GitHub ke Apps Script + versi baru · <code>/deploy status</code> · <code>/deploy balik</code>
/perbarui — (admin) perbarui skrip AutoAbsen di PC ini dari GitHub
/id — lihat ID Telegram Anda
/admin — daftar admin bot &amp; izin
/izin semua | /izin admin — buka/tutup perintah untuk semua anggota grup (admin)
/tambahadmin · /hapusadmin — reply pesan orangnya (admin)
Tanpa tanggal: muncul tombol rentang (termasuk 📅 ketik tanggal sendiri), lalu pilihan cara menulis: tambah+perbarui / ganti periode / ganti seluruh isi.
Contoh: <code>/impor 01/10 10/10</code>
Catatan: mesin selalu menyerahkan SEMUA scan baru; tanggal hanya berlaku untuk kalkulasi/impor.
Jadwal otomatis: 12:00, 18:00, 01:00. Jadwal backup: lihat /backup.
"@

# ---------------------------------------------------------------- grup tambahan (perintah terbatas)
$DeskripsiPerintah = @{
    btr = 'Impor BTR-HARIAN & BTR ke web Daily_Bromo_Bwi (+ download mesin)'
    status = 'Kondisi PC, Att, 7 mesin & hasil terakhir'
    log = 'Riwayat download/impor'
}
function PasangMenuGrupLain([string]$chat, [string[]]$perintah) {
    $c = @($perintah | ForEach-Object { @{ command = $_; description = $(if ($DeskripsiPerintah.ContainsKey($_)) { $DeskripsiPerintah[$_] } else { $_ }) } })
    $c += @{ command = 'bantuan'; description = 'Cara pakai bot di grup ini' }
    $c += @{ command = 'id'; description = 'Lihat ID Telegram Anda' }
    try { [void](TelegramApi 'setMyCommands' @{ commands = $c; scope = @{ type = 'chat'; chat_id = $chat } }) }
    catch { Catat $T ("setMyCommands grup {0} gagal: {1}" -f $chat, $_.Exception.Message) | Out-Null }
}
function BantuanGrupLain([string]$chat, $k) {
    $g = $k.GrupLain[$chat]
    $l = @(('🤖 <b>AutoAbsen</b> · {0}' -f (Html $g.nama)), '')
    if (@($g.perintah) -contains 'btr') {
        $l += '/btr — impor scan <b>BTR-HARIAN</b> &amp; <b>BTR</b> ke web Daily_Bromo_Bwi'
        $l += '     pilih rentang tanggal → <b>Impor sekarang</b> atau <b>Download mesin BTR dulu + impor</b>'
        $l += ('     mesin yang ditarik: ' + (Html (@((KonfigBtr).mesin) -join ', ')))
        $l += '     contoh langsung: <code>/btr 21/09 20/10</code>'
    }
    foreach ($p in @($g.perintah | Where-Object { $_ -ne 'btr' })) { $l += ('/{0}' -f $p) }
    $l += '/id — lihat ID Telegram Anda'
    $l += ''; $l += '<i>Semua anggota grup ini boleh menjalankan perintah di atas.</i>'
    return ($l -join "`n")
}

# ---------------------------------------------------------------- impor BTR (web Daily_Bromo_Bwi)
# Grup utama (Monitor absen) -> download SEMUA mesin; grup tambahan (DAILY REPORT ATT BROMO) -> hanya mesin BTR (btr.json "mesin")
function BtrSemuaMesin([string]$chat) { return -not (KonfigTelegram).GrupLain.ContainsKey($chat) }
function TeksMesinBtr([string]$chat) { if (BtrSemuaMesin $chat) { return 'semua mesin' }; return (Html (@((KonfigBtr).mesin) -join ', ')) }
function TeksKonfirmasiBtr([datetime]$a, [datetime]$b, [string]$chat = '') {
    $c = KonfigBtr; $n = [int]($b.Date - $a.Date).TotalDays + 1
    return ("🏭 <b>Impor BTR → web Daily_Bromo_Bwi</b>`nDepartemen: <b>{0}</b> (+ sub-departemen)`nRentang: <b>{1:dd/MM/yyyy} – {2:dd/MM/yyyy}</b> ({3} hari)`n`n" +
            "Data <i>Jejak › Data Utama</i> diambil langsung dari database Att lalu ditambahkan ke sheet Database. Scan yang sudah ada (NIK + waktu sama) dilewati.`n" +
            "Pilih <b>Download mesin dulu</b> bila scan terbaru belum ditarik dari mesin <b>{4}</b> (±5 menit lebih lama{5}).`n`nLanjut?") -f (Html (@($c.departemen) -join ' & ')), $a, $b, $n, (TeksMesinBtr $chat), $(if (BtrSemuaMesin $chat) { '' } else { '; mesin lain dilewati' })
}
function TombolKonfirmasiBtr([string]$a, [string]$b, [string]$chat = '') {
    $kb = New-Object System.Collections.Generic.List[object]
    $kb.Add((Baris @{ text = '✅ Impor sekarang'; callback_data = "k|btr|$a|$b|biasa" }))
    $kb.Add((Baris @{ text = $(if (BtrSemuaMesin $chat) { '📥 Download semua mesin dulu + impor' } else { '📥 Download {0} mesin BTR dulu + impor' -f @((KonfigBtr).mesin).Count }); callback_data = "k|btr|$a|$b|download" }))
    $kb.Add((Baris @{ text = '✖ Batal'; callback_data = 'x' }))
    return ,($kb.ToArray())
}
function MulaiBtr([string]$a, [string]$b, [string]$nama, [string]$chat, [bool]$download) {
    $arg = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar 'impor_btr.ps1')`"",'-Dari',$a,'-Sampai',$b,'-Sumber','telegram','-Peminta',"`"$nama`"",'-Chat',$chat)
    if ($download) { $arg += '-Download'; if (BtrSemuaMesin $chat) { $arg += '-SemuaMesin' } }
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $arg
    Catat $T ("Mulai impor BTR {0} {1} download={2} oleh {3}" -f $a, $b, $download, $nama) | Out-Null
}

# ---------------------------------------------------------------- backup database
function TeksBackup {
    $c = KonfigBackup; $a = BacaBackupTerakhir
    $l = @('💾 <b>Backup database absen</b>', '')
    if ($c.aktif -and @($c.jam).Count) {
        $nx = JadwalBackupBerikut
        $l += ('⏰ Jadwal: <b>{0}</b> setiap hari{1}' -f (@($c.jam) -join ' · '), $(if ($nx) { ' (berikutnya {0:dd/MM HH:mm})' -f $nx } else { ' (⚠️ belum terpasang di Task Scheduler)' }))
    } else { $l += '⏸ Jadwal: <b>mati</b>' }
    $l += ('📁 Sumber: <code>{0}</code>' -f (Html $c.sumber))
    $l += ('📂 Tujuan: <code>{0}</code>' -f (Html $c.tujuan))
    $l += ('🧹 Disimpan: {0} hari terakhir + 1 per bulan selama {1} bulan' -f $c.simpan_hari, $c.simpan_bulan)
    $l += ''
    if ($a -and $a.waktu) {
        $w = [datetime]::ParseExact([string]$a.waktu, 'yyyy-MM-dd HH:mm:ss', $null)
        $l += ('🕘 Terakhir: <b>{0:dd/MM/yyyy HH:mm}</b> · zip {1} {2}' -f $w, (Ukuran $a.ukuran_zip), $AA_Ikon[[string]$a.status])
        $cekTerakhir = $w
        if ($a.dicek) { $d = [datetime]::ParseExact([string]$a.dicek, 'yyyy-MM-dd HH:mm:ss', $null); if ($d -gt $cekTerakhir) { $cekTerakhir = $d }; $l += ('     dicek lagi {0:dd/MM HH:mm} (tidak berubah)' -f $d) }
        $jam = ((Get-Date) - $cekTerakhir).TotalHours
        if ($c.aktif -and $jam -gt 26) { $l += ('⚠️ Sudah {0:n0} jam tanpa backup — cek PC / log.' -f $jam) }
    } else { $l += '🕘 Belum pernah backup.' }
    $z = @(DaftarZipBackup)
    if ($z.Count) {
        $s = SisaDisk $c.tujuan
        $l += ('🗄 {0} file · {1}{2}' -f $z.Count, (Ukuran (($z | Measure-Object Length -Sum).Sum)), $(if ($s -ge 0) { ' · sisa disk ' + (Ukuran $s) } else { '' }))
    }
    return ($l -join "`n")
}
function TombolBackup {
    $kb = New-Object System.Collections.Generic.List[object]
    $kb.Add((Baris @{ text = '💾 Backup sekarang'; callback_data = 'b|sekarang' }))
    $kb.Add((Baris @{ text = '⏰ Ubah jadwal'; callback_data = 'b|jadwal' } @{ text = '📂 Daftar backup'; callback_data = 'b|daftar' }))
    return ,($kb.ToArray())
}
function TombolJadwalBackup {
    $c = KonfigBackup
    $kb = New-Object System.Collections.Generic.List[object]
    $kb.Add((Baris @{ text = '1× sehari · 02:00'; callback_data = 'bj|02:00' }))
    $kb.Add((Baris @{ text = '2× · 02:00 & 19:00'; callback_data = 'bj|02:00,19:00' }))
    $kb.Add((Baris @{ text = '3× · 02:00, 13:00 & 19:00'; callback_data = 'bj|02:00,13:00,19:00' }))
    $kb.Add((Baris @{ text = '✏️ Ketik jam sendiri'; callback_data = 'bj|ketik' }))
    if ($c.aktif) { $kb.Add((Baris @{ text = '⏸ Matikan jadwal'; callback_data = 'bj|mati' })) }
    else { $kb.Add((Baris @{ text = '▶️ Aktifkan lagi'; callback_data = 'bj|aktif' })) }
    $kb.Add((Baris @{ text = '✖ Batal'; callback_data = 'x' }))
    return ,($kb.ToArray())
}
function ParseJam([string]$s) {
    $j = @([regex]::Matches($s, '(\d{1,2})[:.](\d{2})') | ForEach-Object {
        $h = [int]$_.Groups[1].Value; $m = [int]$_.Groups[2].Value
        if ($h -gt 23 -or $m -gt 59) { throw "Jam tidak valid: $($_.Value)" }
        '{0:00}:{1:00}' -f $h, $m
    })
    $j = @($j | Sort-Object -Unique)
    if ($j.Count -eq 0) { throw 'Jam tidak ditemukan. Contoh: 02:00 19:00' }
    if ($j.Count -gt 6) { throw 'Maksimal 6 jam backup per hari.' }
    return ,$j
}
function AturJadwalBackup([string]$chat, [string[]]$jam, $aktif, [string]$nama) {
    $c = KonfigBackup
    if ($jam) { $c.jam = @($jam) }
    if ($null -ne $aktif) { $c.aktif = [bool]$aktif }
    SimpanKonfigBackup $c
    try { PasangJadwalBackup }
    catch { Balas $chat ('❌ Pengaturan tersimpan, tapi gagal memasang Task Scheduler: ' + (Html $_.Exception.Message)); return }
    Catat $T ("Jadwal backup: {0} aktif={1} oleh {2}" -f (@($c.jam) -join ','), $c.aktif, $nama) | Out-Null
    $catatan = ''
    if ($c.aktif -and (@($c.jam) | Where-Object { $_ -in @('12:00','18:00','01:00') })) { $catatan = "`nℹ️ Jam yang sama dengan download/impor akan menunggu antrean (tidak bentrok)." }
    Balas $chat (('✅ Jadwal backup diubah oleh {0}.{1}' -f (Html $nama), $catatan) + "`n`n" + (TeksBackup)) (TombolBackup)
}
function MintaJamBackup([string]$chat, [string]$uid) {
    $Menunggu["$chat|$uid"] = @{ tugas = 'jambackup'; batas = (Get-Date).AddMinutes(5) }
    $isi = @{ chat_id = $chat; parse_mode = 'HTML'
              text = "⏰ Ketik jam backup harian (balas pesan ini, maks 5 menit), pisahkan dengan spasi:`n<code>02:00 19:00</code>  ·  <code>23:30</code>  ·  maks 6 jam"
              reply_markup = @{ force_reply = $true; selective = $true; input_field_placeholder = '02:00 19:00' } }
    [void](TelegramApi 'sendMessage' $isi)
}
function TeksDaftarBackup {
    $z = @(DaftarZipBackup | Select-Object -First 15)
    if (-not $z.Count) { return '📂 Belum ada file backup.' }
    $l = @('📂 <b>Backup terbaru</b>')
    foreach ($f in $z) { $l += ('• {0:dd/MM/yyyy HH:mm} · {1} · <code>{2}</code>' -f $f.LastWriteTime, (Ukuran $f.Length), $f.Name) }
    $l += ''; $l += ('Folder: <code>{0}</code>' -f (Html (KonfigBackup).tujuan))
    $l += '<i>Pulihkan: tutup Att di semua PC, ekstrak zip, ganti file .MDB di \\192.168.1.60\att (simpan dulu yang lama).</i>'
    return ($l -join "`n")
}
function MulaiBackup([string]$nama, [string]$chat) {
    $arg = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar 'backup_db.ps1')`"",'-Sumber','telegram','-Peminta',"`"$nama`"",'-Chat',$chat)
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $arg
    Catat $T "Mulai backup oleh $nama" | Out-Null
}
$BantuanBackup = @"
💾 <b>Backup database</b>
<code>/backup</code> — status + tombol
<code>/backup sekarang</code> — backup saat ini juga
<code>/backup daftar</code> — file backup terbaru
<code>/backup jadwal 02:00 19:00</code> · <code>/backup jadwal mati</code> · <code>/backup jadwal aktif</code> (admin)
<code>/backup simpan 30 12</code> — simpan 30 hari + 1/bulan selama 12 bulan (admin)
<code>/backup tujuan D:\BackupAbsen</code> · <code>/backup sumber \\192.168.1.60\att\*.mdb</code> (admin)
"@
function PerintahBackup([string]$chat, [string]$uid, [string]$nama, [string]$argStr, $k) {
    $kata = @($argStr -split '\s+' | Where-Object { $_ })
    $sub = if ($kata.Count) { $kata[0].ToLower() } else { '' }
    $sisa = (@($kata | Select-Object -Skip 1)) -join ' '
    if (-not $sub) { Balas $chat (TeksBackup) (TombolBackup); return }
    if ($sub -in @('daftar','list')) { Balas $chat (TeksDaftarBackup); return }
    if ($sub -in @('bantuan','help')) { Balas $chat $BantuanBackup; return }
    if ($sub -in @('sekarang','now','jalan')) {
        if (-not (BolehJalan $k $uid $chat)) { TolakIzin $chat $nama; return }
        Balas $chat ('⏳ Backup database dimulai oleh {0}. Laporan menyusul (±1–3 menit).' -f (Html $nama))
        MulaiBackup $nama $chat; return
    }
    if ($k.Admin -notcontains $uid) { Balas $chat '⛔ Mengubah pengaturan backup hanya untuk admin bot.'; return }
    switch ($sub) {
        'jadwal' {
            if (-not $sisa) { Balas $chat '⏰ Pilih jadwal backup harian:' (TombolJadwalBackup); return }
            if ($sisa -match '^(mati|off|stop)$') { AturJadwalBackup $chat $null $false $nama; return }
            if ($sisa -match '^(aktif|on|nyala)$') { AturJadwalBackup $chat $null $true $nama; return }
            AturJadwalBackup $chat (ParseJam $sisa) $true $nama; return
        }
        'simpan' {
            if ($sisa -notmatch '^(\d+)(?:\s+(\d+))?$') { Balas $chat 'Cara pakai: <code>/backup simpan 30</code> (hari) atau <code>/backup simpan 30 12</code> (hari, bulan)'; return }
            $h = [int]$Matches[1]; $bl = $Matches[2]
            if ($h -lt 3 -or $h -gt 365) { throw 'Hari simpan harus 3–365.' }
            $c = KonfigBackup; $c.simpan_hari = $h
            if ($bl) { if ([int]$bl -gt 60) { throw 'Bulan simpan maksimal 60.' }; $c.simpan_bulan = [int]$bl }
            SimpanKonfigBackup $c
            Balas $chat ('✅ Disimpan: {0} hari terakhir + 1 per bulan selama {1} bulan (berlaku saat backup berikutnya).' -f $c.simpan_hari, $c.simpan_bulan); return
        }
        'tujuan' {
            if (-not $sisa) { Balas $chat ('Tujuan sekarang: <code>{0}</code>' -f (Html (KonfigBackup).tujuan)); return }
            New-Item -ItemType Directory -Force -Path $sisa | Out-Null
            $uji = Join-Path $sisa '_uji_tulis.tmp'; Set-Content -Path $uji -Value 'ok'; Remove-Item $uji -Force
            $c = KonfigBackup; $c.tujuan = $sisa; SimpanKonfigBackup $c
            Balas $chat ('✅ Folder tujuan backup: <code>{0}</code> (bisa ditulis). Backup lama di folder sebelumnya tidak dipindah.' -f (Html $sisa)); return
        }
        'sumber' {
            if (-not $sisa) { Balas $chat ('Sumber sekarang: <code>{0}</code>' -f (Html (KonfigBackup).sumber)); return }
            $f = @(Get-ChildItem -LiteralPath (Split-Path $sisa -Parent) -Filter (Split-Path $sisa -Leaf) -File -ErrorAction Stop)
            if (-not $f.Count) { throw "Tidak ada file yang cocok: $sisa" }
            $c = KonfigBackup; $c.sumber = $sisa; SimpanKonfigBackup $c
            Balas $chat ('✅ Sumber backup: <code>{0}</code> → {1}' -f (Html $sisa), (Html (($f | ForEach-Object { '{0} ({1})' -f $_.Name, (Ukuran $_.Length) }) -join ', '))); return
        }
        default { Balas $chat $BantuanBackup }
    }
}

# ---------------------------------------------------------------- loop utama
Catat $T 'Bot mulai' | Out-Null
# Daftar perintah untuk tombol menu (☰) dan saran saat mengetik "/" di Telegram
$DaftarPerintah = @(
    @{ command = 'status';   description = 'Kondisi PC, Att, 7 mesin & hasil terakhir' },
    @{ command = 'log';      description = 'Riwayat download/impor — /log 15' },
    @{ command = 'download'; description = 'Tarik scan dari 7 mesin (admin)' },
    @{ command = 'impor';    description = 'Kalkulasi + impor ke web, pilih tanggal (admin)' },
    @{ command = 'lengkap';  description = 'Download + impor sekaligus (admin)' },
    @{ command = 'tutup';    description = 'Tutup aplikasi Attendance Management (admin)' },
    @{ command = 'btr';      description = 'Impor BTR-HARIAN & BTR ke web Daily_Bromo_Bwi' },
    @{ command = 'backup';   description = 'Backup database absen: status, jadwal, backup sekarang' },
    @{ command = 'sinkron';  description = 'Sinkron GSheet: Tabel Data -> db1-absen (+ status)' },
    @{ command = 'deploy';   description = 'Kirim .gs dari GitHub ke Apps Script + rilis (admin)' },
    @{ command = 'perbarui'; description = 'Perbarui skrip AutoAbsen dari GitHub (admin)' },
    @{ command = 'admin';    description = 'Daftar admin bot & izin anggota' },
    @{ command = 'izin';     description = 'Atur siapa yang boleh menjalankan (admin)' },
    @{ command = 'tambahadmin'; description = 'Reply pesan orang → jadikan admin bot' },
    @{ command = 'id';       description = 'Lihat ID Telegram Anda' },
    @{ command = 'bantuan';  description = 'Daftar perintah & cara pakai' }
)
foreach ($ruang in @(@{ type = 'default' }, @{ type = 'all_group_chats' }, @{ type = 'all_private_chats' })) {
    try { [void](TelegramApi 'setMyCommands' @{ commands = $DaftarPerintah; scope = $ruang }) }
    catch { Catat $T ('setMyCommands gagal: ' + $_.Exception.Message) | Out-Null }
}
try { [void](TelegramApi 'setChatMenuButton' @{ menu_button = @{ type = 'commands' } }) } catch {}
# Mesin Att yang masih dinonaktifkan sementara oleh /btr -> aktifkan kembali
try {
    if ((Test-Path (Join-Path $AA_Dasar 'mesin_enabled.json')) -and -not (AdaPekerjaan)) {
        $rp = PulihkanMesinAtt
        if ($rp) {
            Catat $T ('Mesin diaktifkan kembali: ' + (@($rp.diubah) -join ', ')) | Out-Null
            KirimTelegram ('🔧 Mesin Att diaktifkan kembali: ' + (Html (@($rp.diubah) -join ', ')))
        }
    }
} catch { Catat $T ('Pulihkan mesin gagal: ' + $_.Exception.Message) | Out-Null }
# Menu perintah khusus tiap grup tambahan
try { $kg = KonfigTelegram; foreach ($c in $kg.GrupLain.Keys) { PasangMenuGrupLain $c @($kg.GrupLain[$c].perintah) } } catch {}
# Jadwal backup database: pasang otomatis bila belum ada
try {
    $cb = KonfigBackup
    if (-not (Test-Path $AA_FileBackup)) { SimpanKonfigBackup $cb }
    if ($cb.aktif -and -not (Get-ScheduledTask -TaskPath '\AutoAbsen\' -TaskName $AA_TugasBackup -ErrorAction SilentlyContinue)) {
        PasangJadwalBackup
        Catat $T ('Jadwal backup dipasang: ' + (@($cb.jam) -join ', ')) | Out-Null
        KirimTelegram ("💾 <b>Backup database terjadwal aktif</b>`n" + (TeksBackup) + "`n`nUbah lewat /backup.")
    }
} catch { Catat $T ('Pasang jadwal backup gagal: ' + $_.Exception.Message) | Out-Null }
# Bila file script diperbarui, bot keluar sendiri; Task Scheduler (tiap 10 menit) menyalakan versi baru.
$versiFile = @($PSCommandPath, (Join-Path $AA_Dasar 'umum.ps1')) | ForEach-Object { (Get-Item $_).LastWriteTimeUtc.Ticks }
$off = 0; if (Test-Path $FileOffset) { $off = [int64](Get-Content $FileOffset -Raw) }
while ($true) {
    $sekarang = @($PSCommandPath, (Join-Path $AA_Dasar 'umum.ps1')) | ForEach-Object { (Get-Item $_).LastWriteTimeUtc.Ticks }
    if (($sekarang -join ',') -ne ($versiFile -join ',')) {
        # versi baru: lepas kunci, nyalakan diri sendiri lagi (tanpa menunggu Task Scheduler), lalu keluar
        Catat $T 'Script diperbarui -> bot dinyalakan ulang dengan versi baru' | Out-Null
        Start-Sleep -Seconds 3
        try { $satu.ReleaseMutex() } catch {}
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',"`"$PSCommandPath`"")
        exit 0
    }
    try {
        $k = KonfigTelegram
        if (-not $k.Token -or -not $k.Grup) { Catat $T 'Belum di-setup (-Daftar). Tidur 5 menit.' | Out-Null; Start-Sleep -Seconds 300; continue }
        $u = GetJson ("https://api.telegram.org/bot{0}/getUpdates?timeout=50&offset={1}" -f $k.Token, $off) 70
        foreach ($x in $u.result) {
            $off = [int64]$x.update_id + 1
            Set-Content -Path $FileOffset -Value $off
            try {
                # ---------- tombol ----------
                if ($x.callback_query) {
                    $cq = $x.callback_query; $chat = [string]$cq.message.chat.id; $uid = [string]$cq.from.id
                    $nama = (($cq.from.first_name, $cq.from.last_name) -join ' ').Trim()
                    [void](TelegramApi 'answerCallbackQuery' @{ callback_query_id = $cq.id })
                    if ($chat -ne $k.Grup -and $k.Admin -notcontains $chat -and -not $k.GrupLain.ContainsKey($chat)) { continue }
                    if ($k.GrupLain.ContainsKey($chat)) {
                        # grup tambahan: hanya tombol untuk perintah yang diizinkan (mis. btr) + batal
                        $pp = ([string]$cq.data) -split '\|'
                        if ($pp[0] -ne 'x' -and (@($k.GrupLain[$chat].perintah) -notcontains $pp[1])) { continue }
                    }
                    if (-not (BolehJalan $k $uid $chat)) { TolakIzin $chat $nama; continue }
                    $p = ([string]$cq.data) -split '\|'
                    $mid = $cq.message.message_id
                    if ($p[0] -in @('pb','dg')) {
                        # perbarui skrip / deploy Apps Script: khusus admin bot
                        if ($k.Admin -notcontains $uid) { Balas $chat ('⛔ {0}, tombol ini hanya untuk admin bot.' -f (Html $nama)); continue }
                        if ($p[0] -eq 'pb') {
                            [void](TelegramApi 'editMessageReplyMarkup' @{ chat_id = $chat; message_id = $mid; reply_markup = @{ inline_keyboard = @() } })
                            $argPb = @('-Aksi','terapkan','-Id',$p[2]); if ($p[1] -eq 'paksa') { $argPb += '-Paksa' }
                            JalankanLatar 'perbarui.ps1' $chat $nama $argPb
                        } elseif ($p[0] -eq 'dg' -and $p[1] -eq 'balik') {
                            [void](TelegramApi 'editMessageReplyMarkup' @{ chat_id = $chat; message_id = $mid; reply_markup = @{ inline_keyboard = @() } })
                            JalankanLatar 'deploy_gas.ps1' $chat $nama @('-Aksi','balik')
                        } elseif ($p[0] -eq 'dg' -and $p[1] -in @('jalan','simpan')) {
                            [void](TelegramApi 'editMessageReplyMarkup' @{ chat_id = $chat; message_id = $mid; reply_markup = @{ inline_keyboard = @() } })
                            $argDg = @('-Aksi',$p[1],'-Id',$p[2]); if ($p.Count -ge 4 -and $p[3] -eq 'paksa') { $argDg += '-Paksa' }
                            JalankanLatar 'deploy_gas.ps1' $chat $nama $argDg
                        }
                        continue
                    }
                    if ($p[0] -eq 'b') {
                        if ($p[1] -eq 'sekarang') {
                            [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; parse_mode = 'HTML'; text = ('⏳ Backup database dimulai oleh {0}. Laporan menyusul (±1–3 menit).' -f (Html $nama)) })
                            MulaiBackup $nama $chat
                        } elseif ($p[1] -eq 'jadwal') {
                            if ($k.Admin -notcontains $uid) { Balas $chat '⛔ Mengubah jadwal backup hanya untuk admin bot.'; continue }
                            [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = '⏰ Pilih jadwal backup harian:'; reply_markup = @{ inline_keyboard = (TombolJadwalBackup) } })
                        } elseif ($p[1] -eq 'daftar') { Balas $chat (TeksDaftarBackup) }
                        continue
                    }
                    if ($p[0] -eq 'bj') {
                        if ($k.Admin -notcontains $uid) { Balas $chat '⛔ Mengubah jadwal backup hanya untuk admin bot.'; continue }
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = '⏰ Jadwal backup dipilih.' })
                        if ($p[1] -eq 'ketik') { MintaJamBackup $chat $uid }
                        elseif ($p[1] -eq 'mati') { AturJadwalBackup $chat $null $false $nama }
                        elseif ($p[1] -eq 'aktif') { AturJadwalBackup $chat $null $true $nama }
                        else { AturJadwalBackup $chat (ParseJam ($p[1] -replace ',', ' ')) $true $nama }
                        continue
                    }
                    if ($p[0] -eq 'x') { [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = '✖ Dibatalkan.' }); continue }
                    if ($p[0] -eq 't') {
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = '📅 Tanggal manual dipilih.' })
                        MintaTanggal $chat $uid $p[1]; continue
                    }
                    if ($p[0] -eq 'r' -and $p[1] -eq 'btr') {
                        $a = ParseTanggal $p[2]; $b = ParseTanggal $p[3]; CekRentang $a $b
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; parse_mode = 'HTML'; text = (TeksKonfirmasiBtr $a $b $chat)
                            reply_markup = @{ inline_keyboard = (TombolKonfirmasiBtr $p[2] $p[3] $chat) } })
                        continue
                    }
                    if ($p[0] -eq 'k' -and $p[1] -eq 'btr') {
                        $dl = ($p.Count -ge 5 -and $p[4] -eq 'download')
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = ("⏳ Diterima: impor BTR {0} s/d {1}{2} (oleh {3})" -f $p[2], $p[3], $(if ($dl) { ' + download ' + $(if (BtrSemuaMesin $chat) { 'semua mesin' } else { (@((KonfigBtr).mesin) -join ', ') }) } else { '' }), $nama) })
                        MulaiBtr $p[2] $p[3] $nama $chat $dl
                        continue
                    }
                    if ($p[0] -eq 'r') {
                        $a = ParseTanggal $p[2]; $b = ParseTanggal $p[3]; CekRentang $a $b
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; parse_mode = 'HTML'
                            text = ("Rentang <b>{0:dd/MM/yyyy} – {1:dd/MM/yyyy}</b>. Pilih cara menulis ke web:" -f $a, $b)
                            reply_markup = @{ inline_keyboard = (TombolMode $p[1] $p[2] $p[3]) } })
                        continue
                    }
                    if ($p[0] -in @('m','k') -and $p.Count -ge 5 -and $p[4] -eq 'replace' -and $k.Admin -notcontains $uid) {
                        Balas $chat ('⛔ {0}, mode <b>ganti seluruh isi</b> hanya untuk admin bot.' -f (Html $nama)); continue
                    }
                    if ($p[0] -eq 'm') {
                        $a = ParseTanggal $p[2]; $b = ParseTanggal $p[3]; CekRentang $a $b
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = (TeksKonfirmasi $p[1] $a $b $p[4]); parse_mode = 'HTML'
                            reply_markup = @{ inline_keyboard = (TombolKonfirmasi $p[1] $p[2] $p[3] $p[4]) } })
                        continue
                    }
                    if ($p[0] -eq 'k') {
                        $mode = if ($p.Count -ge 5 -and $p[4]) { $p[4] } else { 'upsert' }
                        if ($mode -notin @('upsert','periode','replace')) { throw "mode tidak dikenal: $mode" }
                        [void](TelegramApi 'editMessageText' @{ chat_id = $chat; message_id = $mid; text = ("⏳ Diterima: {0} {1} s/d {2}, mode {3} (oleh {4})" -f $p[1], $p[2], $p[3], $mode, $nama) })
                        Mulai $p[1] $p[2] $p[3] $nama $chat $mode
                    }
                    continue
                }
                # ---------- pesan ----------
                $m = $x.message
                if ($m -and $m.migrate_to_chat_id -and $k.GrupLain.ContainsKey([string]$m.chat.id)) {
                    # grup biasa diubah Telegram jadi supergroup -> ID chat berganti
                    $lama = [string]$m.chat.id; $baru = [string]$m.migrate_to_chat_id
                    $gl = $k.GrupLain; $gl[$baru] = $gl[$lama]; $gl.Remove($lama)
                    SimpanKonfigTelegram $k.Grup $k.Admin $null $null $gl
                    PasangMenuGrupLain $baru @($gl[$baru].perintah)
                    Catat $T "Grup tambahan pindah ID $lama -> $baru" | Out-Null
                    continue
                }
                if (-not $m -or -not $m.text) { continue }
                $chat = [string]$m.chat.id; $uid = [string]$m.from.id
                $nama = (($m.from.first_name, $m.from.last_name) -join ' ').Trim()
                $teks = ([string]$m.text).Trim()
                $kunciTunggu = "$chat|$uid"
                if ($teks -notmatch '^/' -and $Menunggu.ContainsKey($kunciTunggu)) {
                    $w = $Menunggu[$kunciTunggu]; $Menunggu.Remove($kunciTunggu)
                    if ((Get-Date) -gt $w.batas) { Balas $chat '⌛ Waktu input habis. Ulangi perintahnya.'; continue }
                    if ($w.tugas -eq 'jambackup') {
                        if ($k.Admin -notcontains $uid) { continue }
                        AturJadwalBackup $chat (ParseJam $teks) $true $nama
                        continue
                    }
                    if (-not (BolehJalan $k $uid $chat)) { continue }
                    TerimaTanggal $chat $w.tugas $teks
                    continue
                }
                if ($teks -notmatch '^/(\w+)(@\w+)?\s*(.*)$') { continue }
                $cmd = $Matches[1].ToLower(); $argStr = $Matches[3].Trim()
                if ($cmd -eq 'sinkronstatus') { $cmd = 'sinkron'; $argStr = 'status' }
                $alias = @{ sync = 'sinkron'; update = 'perbarui'; deployment = 'deploy'; rilis = 'deploy'; import = 'impor'; unduh = 'download'; tarik = 'download'; full = 'lengkap'; help = 'bantuan'; riwayat = 'log'; close = 'tutup'; tutupatt = 'tutup'; closeatt = 'tutup'; bromo = 'btr' }
                if ($alias.ContainsKey($cmd)) { $cmd = $alias[$cmd] }
                if ($cmd -eq 'id') { Balas $chat ("ID Anda: <code>{0}</code> · chat: <code>{1}</code>" -f $uid, $chat); continue }
                # daftarkan grup ini sebagai grup tambahan yang hanya boleh /btr (khusus admin bot)
                if ($cmd -in @('daftarbtr','hapusgrup')) {
                    if ($k.Admin -notcontains $uid) { Balas $chat '⛔ Hanya admin bot yang bisa mendaftarkan / menghapus grup.'; continue }
                    if ($m.chat.type -notin @('group','supergroup')) { Balas $chat 'ℹ️ Ketik perintah ini <b>di dalam grup</b> yang ingin didaftarkan.'; continue }
                    if ($chat -eq $k.Grup) { Balas $chat 'ℹ️ Ini grup utama AutoAbsen; /btr sudah bisa dipakai di sini.'; continue }
                    $gl = $k.GrupLain
                    if ($cmd -eq 'daftarbtr') {
                        $gl[$chat] = [pscustomobject]@{ nama = [string]$m.chat.title; perintah = @('btr') }
                        SimpanKonfigTelegram $k.Grup $k.Admin $null $null $gl
                        PasangMenuGrupLain $chat @('btr')
                        Catat $T ("Grup tambahan didaftarkan: {0} ({1}) oleh {2}" -f $m.chat.title, $chat, $nama) | Out-Null
                        Balas $chat (("✅ Grup <b>{0}</b> terdaftar untuk impor BTR.`nSemua anggota grup ini bisa memakai <b>/btr</b> (impor ke web Daily_Bromo_Bwi, bisa sekalian download mesin). Laporan hasil juga dikirim ke sini.`nPerintah lain AutoAbsen tidak aktif di grup ini.`n`n" -f (Html $m.chat.title)) + (BantuanGrupLain $chat (KonfigTelegram)))
                    } else {
                        if (-not $gl.ContainsKey($chat)) { Balas $chat 'ℹ️ Grup ini memang tidak terdaftar.'; continue }
                        $gl.Remove($chat)
                        SimpanKonfigTelegram $k.Grup $k.Admin $null $null $gl
                        try { [void](TelegramApi 'deleteMyCommands' @{ scope = @{ type = 'chat'; chat_id = $chat } }) } catch {}
                        Catat $T ("Grup tambahan dihapus: {0} oleh {1}" -f $chat, $nama) | Out-Null
                        Balas $chat '🗑 Grup ini tidak lagi terdaftar; bot tidak akan menanggapi perintah di sini.'
                    }
                    continue
                }
                if ($k.GrupLain.ContainsKey($chat)) {
                    if ($cmd -in @('start','bantuan','help')) { Balas $chat (BantuanGrupLain $chat $k); continue }
                    if (@($k.GrupLain[$chat].perintah) -notcontains $cmd) {
                        if ($cmd -in @('status','log','download','impor','lengkap','tutup','backup','admin','izin','tambahadmin','hapusadmin')) {
                            Balas $chat ('ℹ️ /{0} tidak aktif di grup ini. Ketik /bantuan.' -f $cmd)
                        }
                        continue
                    }
                }
                elseif ($chat -ne $k.Grup -and $k.Admin -notcontains $chat) { Catat $T "abaikan chat tak dikenal $chat ($nama): $teks" | Out-Null; continue }
                switch ($cmd) {
                    { $_ -in @('start','bantuan','help') } { Balas $chat $Bantuan }
                    'status' { Balas $chat (TeksStatus) }
                    'log' { $n = 10; if ($argStr -match '^\d+$') { $n = [Math]::Min([int]$argStr, 15) }; Balas $chat (TeksLog $n) }
                    'izin' {
                        if ($k.Admin -notcontains $uid) { Balas $chat '⛔ Hanya admin bot yang bisa mengubah izin.'; break }
                        $pil = $argStr.ToLower()
                        if ($pil -in @('semua','all','anggota')) {
                            SimpanKonfigTelegram $k.Grup $k.Admin $true
                            Balas $chat "🔓 <b>Semua anggota grup</b> sekarang bisa menjalankan /download, /impor, /lengkap, /tutup.`nMode <i>ganti seluruh isi</i> tetap khusus admin.`nKembalikan dengan <code>/izin admin</code>."
                        } elseif ($pil -in @('admin','tutup','khusus')) {
                            SimpanKonfigTelegram $k.Grup $k.Admin $false
                            Balas $chat '🔒 Perintah kerja sekarang <b>khusus admin bot</b>. Anggota lain tetap bisa /status dan /log.'
                        } else {
                            Balas $chat ("Izin sekarang: <b>{0}</b>`n<code>/izin semua</code> — semua anggota grup boleh menjalankan perintah`n<code>/izin admin</code> — hanya admin bot" -f $(if ($k.AnggotaBoleh) { 'semua anggota grup' } else { 'khusus admin' }))
                        }
                    }
                    'admin' {
                        $l = @('👮 <b>Admin bot</b>')
                        foreach ($a in $k.Admin) { $l += ('• {0} <code>{1}</code>' -f $(if ($k.AdminNama.ContainsKey($a)) { Html $k.AdminNama[$a] } else { '(tanpa nama)' }), $a) }
                        $l += ''; $l += ('Izin anggota grup: <b>{0}</b>' -f $(if ($k.AnggotaBoleh) { 'semua boleh' } else { 'khusus admin' }))
                        $l += '<i>Tambah: reply pesan orangnya dengan /tambahadmin · Hapus: reply dengan /hapusadmin</i>'
                        Balas $chat ($l -join "`n")
                    }
                    { $_ -in @('tambahadmin','hapusadmin') } {
                        if ($k.Admin -notcontains $uid) { Balas $chat '⛔ Hanya admin bot yang bisa mengatur admin.'; break }
                        $tid = ''; $tnama = ''
                        if ($m.reply_to_message -and $m.reply_to_message.from) {
                            $tid = [string]$m.reply_to_message.from.id
                            $tnama = (($m.reply_to_message.from.first_name, $m.reply_to_message.from.last_name) -join ' ').Trim()
                            if ($m.reply_to_message.from.is_bot) { Balas $chat 'ℹ️ Itu akun bot, bukan orang.'; break }
                        } elseif ($argStr -match '^\d+$') { $tid = $argStr }
                        if (-not $tid) { Balas $chat ('Cara pakai: <b>reply</b> salah satu pesan orangnya lalu ketik <code>/{0}</code>, atau <code>/{0} 123456789</code> (ID dari /id).' -f $cmd); break }
                        $daftar = @($k.Admin); $nm = $k.AdminNama
                        if ($cmd -eq 'tambahadmin') {
                            if ($daftar -contains $tid) { Balas $chat 'ℹ️ Sudah admin.'; break }
                            $daftar += $tid; if ($tnama) { $nm[$tid] = $tnama }
                            SimpanKonfigTelegram $k.Grup $daftar $null $nm
                            Balas $chat ('✅ <b>{0}</b> sekarang admin bot.' -f (Html $(if ($tnama) { $tnama } else { $tid })))
                        } else {
                            if ($tid -eq $uid) { Balas $chat '⛔ Tidak bisa menghapus diri sendiri.'; break }
                            if ($daftar -notcontains $tid) { Balas $chat 'ℹ️ Orang itu bukan admin.'; break }
                            SimpanKonfigTelegram $k.Grup @($daftar | Where-Object { $_ -ne $tid }) $null $nm
                            Balas $chat ('🗑 {0} tidak lagi admin bot.' -f (Html $(if ($tnama) { $tnama } elseif ($nm.ContainsKey($tid)) { $nm[$tid] } else { $tid })))
                        }
                        Catat $T ("{0} {1} ({2}) oleh {3}" -f $cmd, $tid, $tnama, $nama) | Out-Null
                    }
                    'tutup' {
                        if (-not (BolehJalan $k $uid $chat)) { TolakIzin $chat $nama; break }
                        if (-not (AttJalan)) { Balas $chat 'ℹ️ Att memang sedang tertutup.'; break }
                        if (AdaPekerjaan) { Balas $chat '⏳ Ada pekerjaan AutoAbsen yang sedang berjalan; Att akan ditutup otomatis setelah selesai.'; break }
                        $pAtt = Get-Process Att -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($argStr -ne 'paksa' -and $pAtt -and [AAWin]::DiamDetik() -lt 120 -and [AAWin]::PidDepan() -eq $pAtt.Id) {
                            Balas $chat '⚠️ Att sedang dipakai seseorang di PC (aktif &lt; 2 menit lalu). Kirim <code>/tutup paksa</code> bila tetap ingin menutup.'
                            break
                        }
                        Balas $chat '⏳ Menutup Attendance Management...'
                        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $AA_Dasar 'tutup_att.ps1')`"",'-Sekarang','-Chat',$chat,'-Peminta',"`"$nama`"")
                        Catat $T "Tutup Att diminta oleh $nama" | Out-Null
                    }
                    { $_ -in @('download','impor','lengkap') } {
                        if (-not (BolehJalan $k $uid $chat)) { TolakIzin $chat $nama; break }
                        if ($cmd -eq 'download') {
                            if ($argStr -ne 'paksa' -and (AttJalan) -and [AAWin]::DiamDetik() -lt 120 -and [AAWin]::PidDepan() -eq (Get-Process Att | Select-Object -First 1).Id) {
                                Balas $chat '⚠️ Att sedang dipakai seseorang di PC (aktif &lt; 2 menit lalu). Download akan menutup &amp; membuka ulang Att. Kirim <code>/download paksa</code> bila tetap ingin.'
                                break
                            }
                            Mulai 'download' '' '' $nama $chat; break
                        }
                        $kata = @($argStr -split '\s+' | Where-Object { $_ })
                        if ($kata.Count -eq 0) { Balas $chat ('Pilih rentang untuk <b>{0}</b>:' -f $cmd) (TombolRentang $cmd); break }
                        TerimaTanggal $chat $cmd $argStr
                    }
                    { $_ -in @('btr','bromo') } {
                        if (-not (BolehJalan $k $uid $chat)) { TolakIzin $chat $nama; break }
                        if (-not (KonfigBtr).url) { Balas $chat '⚠️ Impor BTR belum siap: URL web app belum diisi di D:\AutoAbsen\btr.json.'; break }
                        if (-not @($argStr -split '\s+' | Where-Object { $_ }).Count) { Balas $chat '🏭 Pilih rentang untuk <b>impor BTR</b> ke web Daily_Bromo_Bwi:' (TombolRentang 'btr'); break }
                        TerimaTanggal $chat 'btr' $argStr
                    }
                    'sinkron' {
                        $sub = ($argStr -split '\s+')[0].ToLower()
                        if ($sub -eq 'kunci') {
                            # rahasia: hanya admin, hanya di chat pribadi; pesannya dihapus
                            try { [void](TelegramApi 'deleteMessage' @{ chat_id = $chat; message_id = $m.message_id }) } catch {}
                            if ($k.Admin -notcontains $uid -or $m.chat.type -ne 'private') { Balas $chat '⛔ Kunci sinkron hanya boleh dikirim admin bot lewat <b>chat pribadi</b> dengan bot. Pesan Anda sudah dihapus; buat kunci baru (SINKRON_BOT_KUNCI_BUAT) bila tadi terkirim di grup.'; break }
                            $kn = (($argStr -split '\s+', 2)[1] + '').Trim()
                            JalankanLatar 'sinkron_gsheet.ps1' $chat $nama @('-Kunci', $kn)
                            break
                        }
                        if (-not (BolehJalan $k $uid $chat)) { TolakIzin $chat $nama; break }
                        if ($sub -in @('status','cek')) { JalankanLatar 'sinkron_gsheet.ps1' $chat $nama @('-Aksi','status'); break }
                        JalankanLatar 'sinkron_gsheet.ps1' $chat $nama @('-Aksi','sinkron')
                    }
                    'deploy' {
                        if ($k.Admin -notcontains $uid) { Balas $chat '⛔ /deploy hanya untuk admin bot.'; break }
                        $kata = @($argStr -split '\s+' | Where-Object { $_ })
                        $sub = if ($kata.Count) { $kata[0].ToLower() } else { '' }
                        if ($sub -eq 'status') { JalankanLatar 'deploy_gas.ps1' $chat $nama @('-Aksi','status'); break }
                        if ($sub -eq 'nama') { JalankanLatar 'deploy_gas.ps1' $chat $nama @('-Aksi','nama','-Nilai',("`"" + ((@($kata | Select-Object -Skip 1)) -join ' ') + "`"")); break }
                        if ($sub -in @('balik','rollback')) {
                            Balas $chat '↩️ Kembalikan web app PRODUKSI ke versi sebelum deploy terakhir?' @(,@(@{ text = '↩️ Ya, kembalikan'; callback_data = 'dg|balik' }, @{ text = '✖ Batal'; callback_data = 'x' }))
                            break
                        }
                        if ($sub -in @('bantuan','help')) {
                            Balas $chat "🚀 <b>/deploy</b> — cek perbedaan repo GitHub (apps-script/*.gs) vs Apps Script, lalu tombol Deploy / Simpan saja`n<code>/deploy status</code> — versi produksi sekarang`n<code>/deploy balik</code> — kembali ke versi sebelumnya`n<code>/deploy nama Code=Kode</code> — samakan nama file repo dengan nama di Apps Script"
                            break
                        }
                        Balas $chat '⏳ Membandingkan repo GitHub dengan Apps Script…'
                        JalankanLatar 'deploy_gas.ps1' $chat $nama @('-Aksi','cek')
                    }
                    'perbarui' {
                        if ($k.Admin -notcontains $uid) { Balas $chat '⛔ /perbarui hanya untuk admin bot.'; break }
                        Balas $chat '⏳ Membandingkan skrip di PC dengan GitHub…'
                        JalankanLatar 'perbarui.ps1' $chat $nama @('-Aksi','cek')
                    }
                    { $_ -in @('backup','jadwalbackup') } {
                        $argB = if ($cmd -eq 'jadwalbackup') { ('jadwal ' + $argStr).Trim() } else { $argStr }
                        PerintahBackup $chat $uid $nama $argB $k
                    }
                    default { }
                }
            } catch {
                Catat $T ('error perintah: ' + $_.Exception.Message) | Out-Null
                try { Balas $chat ('❌ ' + (Html $_.Exception.Message)) } catch {}
            }
        }
    } catch {
        Catat $T ('error loop: ' + $_.Exception.Message) | Out-Null
        Start-Sleep -Seconds 15
    }
}
try { $satu.ReleaseMutex() } catch {}
