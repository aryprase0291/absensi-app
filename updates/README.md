# Alur update aplikasi

Folder `updates/frontend/releases` dan `updates/backend/releases` adalah sumber riwayat rilis.
Satu file JSON = satu versi. Jangan mengubah versi langsung di `src/App.js` atau `apps-script/Code.gs`.

Apps Script Editor tidak memiliki folder di dalam project. Karena itu riwayat backend
disimpan di folder `updates/backend` pada VS Code dan dikompilasi menjadi satu file
`apps-script/UpdateManifest.gs` yang dapat ditempel sebagai file terpisah di Apps Script.

## Membuat update baru

1. Tambahkan file dengan nama versi, misalnya `updates/frontend/releases/1.0.16.json` dan `updates/backend/releases/1.0.16.json`.
2. Isi `version`, `releasedAt`, `required`, dan `notes`.
3. Jalankan `npm run update:prepare`.
4. Jalankan `npm run build`, lalu publish folder `build` ke hosting frontend.
5. Salin file `apps-script/UpdateManifest.gs` dan perubahan `apps-script/Code.gs` ke project Apps Script, simpan, dan deploy sebagai versi baru pada deployment produksi.

Saat user login, backend mengirim versi terbaru. Jika bundle frontend masih lama, popup update wajib tampil dan tombol **Update Sekarang** membersihkan cache lalu memuat bundle terbaru.

## Catatan penting

Folder VS Code tidak dapat mengubah deployment Google Apps Script atau hosting secara langsung tanpa kredensial/deployment pipeline. Perintah di atas membuat keduanya konsisten dan menyimpan history; langkah publish tetap harus dijalankan oleh pemilik project atau pipeline CI yang diberi akses.
