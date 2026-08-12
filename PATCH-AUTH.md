# Menutup Celah Autentikasi — Panduan Deploy

Menutup temuan P0 di `AUDIT-SISTEM.md`: `doPost` menerima action apa pun tanpa
memverifikasi pemanggil, dan role dibaca dari `data.roleRequester` yang dikirim
klien sehingga bisa dipalsukan.

**Urutan langkah di bawah tidak boleh ditukar.** Frontend harus lebih dulu,
karena backend baru akan menolak request tanpa token.

---

## Cara kerjanya

```
login  ──> handleLogin memverifikasi password
           lalu menerbitkan token (HMAC-SHA256, berlaku 12 jam)
           token = base64url(payload) + "." + tanda_tangan

setiap request berikutnya
       ──> frontend menyisipkan token (helper fetchApi di App.js)
       ──> doPost memanggil authorizeRequest() SEBELUM merutekan action
       ──> role, userId, dan scope diambil DARI TOKEN, bukan dari body
```

Kuncinya ada di `authorizeRequest()`: fungsi ini **menimpa** field yang tadinya
dipercaya mentah dari klien, jadi seluruh handler lama otomatis ikut aman tanpa
perlu diubah satu per satu.

| Field | Sebelumnya | Sekarang |
|---|---|---|
| `data.userId`, `data.id` | dikirim klien — bisa membaca data orang lain | dipaksa = userId dari token |
| `data.role`, `data.roleRequester` | dikirim klien — kirim `"admin"` lolos | dipaksa = role dari token |
| `data.canViewAll` | kirim `true` → baca riwayat semua karyawan | dihitung server: hanya admin & hrd |
| `data.noPayroll` | dikirim klien → baca data mesin orang lain | dihapus, diturunkan dari token |
| `data.requestorLokasi` | bebas pilih lokasi mana pun | hanya super admin bebas; lain dipaksa ke lokasinya |

> **Catatan teknis penting:** `data.lokasi` **tidak** ditimpa menyeluruh, karena
> artinya berbeda antar action — di `handleAbsen` itu koordinat GPS absen
> (data user), sementara di `handleGetApprovalList` itu lokasi kantor admin
> (scope). Penimpaan hanya dilakukan pada action yang memang memakainya sebagai
> scope. Kalau ini diseragamkan, record absensi akan rusak.

Diuji dengan 46 skenario (token dipalsukan, kedaluwarsa, expiry diperpanjang,
eskalasi role, pemalsuan field, role berspasi) — semuanya lolos.

---

## Langkah 0 · Pre-flight ⚠️ JANGAN DILEWATI

Satu risiko nyata sebelum ke produksi: **kalau ada role di sheet `Users` yang
tidak terdaftar di `ACTION_ROLES`, user itu kehilangan akses** ke menu approval
atau admin begitu patch aktif.

Tabel izin saya susun dari `App.js` (`admin`, `hrd`, `manager`). Tapi data
nyata di sheet Anda belum saya lihat seluruhnya — bisa saja ada `pimpinan`,
`spv`, atau `Manager Ops`.

Setelah menempel `Auth.gs`, jalankan **`PREFLIGHT_CEK_ROLE()`** (read-only,
tidak mengubah apa pun). Fungsi ini melaporkan:

- semua role yang benar-benar dipakai + jumlah orangnya
- role yang punya spasi di depan/belakang (mis. `"admin "`)
- user tanpa role
- role yang **namanya terdengar berwenang tapi tidak ada di tabel izin** —
  ini yang paling penting

Kalau muncul role berwenang yang belum terdaftar, tambahkan dulu ke
`ACTION_ROLES` di `Auth.gs` **sebelum** deploy.

Log harus berakhir dengan `HASIL: aman untuk lanjut deploy.`

---

## Langkah 1 · Frontend lebih dulu ✅ sudah dikerjakan

Sudah masuk repo:

- `src/App.js` — helper `fetchApi` menyisipkan token ke 29 pemanggilan API,
  dan menangani respons `AUTH_REQUIRED` dengan membersihkan sesi lalu reload
- `CLIENT_VERSION` dinaikkan ke `1.0.13`

Push ke GitHub → Vercel deploy otomatis.

**Ini aman dilakukan sebelum backend diperbarui.** Backend lama hanya
mengabaikan field `token` yang tidak dikenalnya, jadi aplikasi tetap jalan
normal selama masa transisi.

---

## Langkah 2 · Pasang Auth.gs

Buka spreadsheet `absen` → **Ekstensi › Apps Script**.

1. Klik **+** di samping Files → **Script** → beri nama `Auth`
2. Tempel seluruh isi `apps-script/Auth.gs`
3. **Simpan**

---

## Langkah 3 · Patch doPost di Code.gs

Di file `Code.gs`, cari awal `function doPost(e)`. Sisipkan blok gerbang tepat
**setelah** baris `const action = data.action;`:

```js
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // ===== SISIPKAN MULAI DARI SINI =====
    const gate = authorizeRequest(data);
    if (!gate.ok) {
      return responseJSON({
        result: 'error',
        code: gate.message === 'SESI_HABIS' ? 'AUTH_REQUIRED' : 'FORBIDDEN',
        message: gate.message === 'SESI_HABIS'
          ? 'Sesi Anda sudah berakhir. Silakan login ulang.'
          : gate.message
      });
    }
    // ===== SAMPAI SINI =====

    if (action === 'ping') {
```

Lalu di `handleLogin`, ubah dua bagian:

**a. Perbandingan password jadi ketat**

```js
  const foundUser = userRows.slice(1).find(row =>
    String(row[1]).toLowerCase() === String(data.username).toLowerCase() &&
    String(row[2]) === String(data.password)
  );
```

**b. Sertakan token di respons** — tambahkan setelah `lokasi: foundUser[13] || 'All'`
(jangan lupa koma di baris sebelumnya):

```js
          lokasi: foundUser[13] || 'All',

          token: createAuthToken({
            id: foundUser[0],
            role: foundUser[5],
            divisi: foundUser[4],
            lokasi: foundUser[13] || 'All'
          })
      },
      version: APP_VERSION,
      masterData: masterData
    });
```

**c. Naikkan versi** di baris 58: `const APP_VERSION = "1.0.13";`

> Versi `1.0.13` inilah yang memaksa user dengan bundle lama (`1.0.12`) melihat
> layar **"Update Tersedia"**, lalu reload dan mendapat bundle baru yang
> mengirim token. Tanpa menaikkan versi, user yang aplikasinya masih terbuka
> akan mendapat error sesi.

Versi lengkap yang sudah dipatch ada di `apps-script/Code.gs` — bisa dipakai
sebagai pembanding.

---

## Langkah 4 · Buat secret

Di editor Apps Script, pilih fungsi **`SETUP_GENERATE_SECRET`** dari dropdown,
klik **Run**. Jalankan **sekali saja**.

Cek log — harus muncul `Secret berhasil dibuat dan disimpan di Script Properties.`

> Melewatkan langkah ini membuat **semua login gagal**, karena
> `createAuthToken` tidak menemukan secret.

---

## Langkah 5 · Deploy

**Deploy › Kelola deployment** → ikon pensil pada deployment aktif →
Versi: **Versi baru** → **Deploy**.

Gunakan **deployment yang sudah ada**, jangan buat yang baru — supaya URL-nya
tidak berubah dan `constants.js` tidak perlu disentuh.

---

## Langkah 6 · Uji

| Uji | Harapan |
|---|---|
| Login karyawan biasa | Berhasil, dashboard tampil normal |
| Absen + kirim pengajuan | Berhasil, lokasi GPS tersimpan benar di sheet |
| Login admin → Panel Admin | Daftar user tampil, reset password jalan |
| Login HRD → Approval | Daftar approval tampil sesuai lokasi |
| Diamkan >12 jam lalu klik menu | Muncul "Sesi berakhir", diarahkan ke login |

Uji celah yang sudah ditutup — jalankan di Console browser (tanpa login):

```js
fetch('URL_WEB_APP_ANDA', {
  method: 'POST',
  body: JSON.stringify({ action: 'get_user_list_admin', roleRequester: 'admin' })
}).then(r => r.json()).then(console.log);
```

Sebelum patch: mengembalikan **seluruh data karyawan**.
Setelah patch: `{ result: 'error', code: 'AUTH_REQUIRED', ... }`

---

## Rollback — kalau ada yang tidak beres

Ini jaring pengaman yang membuat penerapan ke produksi relatif tenang: Apps
Script menyimpan setiap versi deployment.

**Deploy › Kelola deployment** → pensil → Versi: pilih **versi sebelumnya**
→ **Deploy**. Backend kembali seperti semula dalam hitungan detik, tanpa perlu
menyentuh kode.

Frontend tidak perlu di-rollback — bundle 1.0.13 mengirim field `token` yang
akan diabaikan begitu saja oleh backend versi lama.

Dua sifat yang membantu:

- **Menyimpan kode di editor tidak mengubah apa pun bagi user.** Web App
  menjalankan versi yang di-*deploy*, bukan yang tersimpan. Jadi Anda bisa
  menempel `Auth.gs`, mematut-matut patch, dan menjalankan
  `PREFLIGHT_CEK_ROLE()` dengan aman — user tidak terpengaruh sampai Anda
  menekan Deploy.
- **Waktu penerapan.** Hindari jam masuk dan jam pulang kantor. Saat deploy,
  user yang sedang membuka aplikasi akan melihat layar "Update Tersedia" dan
  harus reload sekali.

---

## Yang BELUM ditutup

**1. Password masih teks polos** di kolom C sheet `Users`. Siapa pun yang punya
akses *view* ke spreadsheet bisa membacanya. Ini P0 berikutnya —
hashing bertahap, rencananya ada di `AUDIT-SISTEM.md`.

**2. Reset password masih ke nilai tetap `"123"`** (`Code.gs:2074`).

**3. Approval via email (`doGet`) belum bertoken.** Alur
`approve_via_email` / `reject_via_email` hanya mengandalkan `uuid` di URL. Siapa
pun yang punya uuid bisa menyetujui pengajuan. Risikonya lebih rendah karena
uuid tidak mudah ditebak dan hanya dikirim ke email atasan, tapi idealnya
diberi token bertanda tangan sekali pakai.

**4. Repo GitHub masih Public.** Setelah patch ini, URL Web App tidak lagi
berbahaya karena request tanpa token ditolak. Yang masih terekspos di
`apps-script/Code.gs` hanya tiga ID spreadsheet payroll dan dua alamat email
HRD. ID spreadsheet sendiri bukan kredensial — aksesnya tetap dijaga izin
Google Drive — tapi menjadikan repo private tetap lebih rapi.
