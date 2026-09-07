/**
 * UJI KONSISTENSI ROUTER vs TABEL IZIN
 *
 * Jalankan:  node scripts/test-router-auth.js
 *
 * KENAPA ADA: menambah action itu dua langkah yang letaknya berjauhan —
 * rutenya di Code.gs (doPost), izinnya di Auth.gs (ACTION_ROLES). Lupa
 * langkah kedua TIDAK menimbulkan error saat deploy; action-nya hanya
 * dijawab "Action tidak dikenal." di produksi.
 *
 * Ini persis yang terjadi pada get_alamat, get_gps_audit, dan
 * run_gps_audit_historis (7 Sep 2026): rutenya ada, izinnya belum,
 * sehingga fitur nama lokasi diam-diam tidak pernah jalan.
 *
 * Uji ini membaca kedua berkas sebagai teks dan membandingkan daftarnya.
 */

const fs = require('fs');
const path = require('path');

const AS = path.join(__dirname, '..', 'apps-script');
const kode = fs.readFileSync(path.join(AS, 'Code.gs'), 'utf8');
const auth = fs.readFileSync(path.join(AS, 'Auth.gs'), 'utf8');

// --- Action yang dirutekan di doPost ---
const dirutekan = new Set();
const polaRute = /action\s*===\s*'([a-z0-9_]+)'/gi;
let m;
while ((m = polaRute.exec(kode)) !== null) dirutekan.add(m[1]);

// Action yang ditangani di berkas lain (doGet / link email), bukan doPost.
['approve_via_email', 'reject_via_email'].forEach(a => dirutekan.delete(a));

// --- Action yang punya izin ---
const blokRoles = auth.match(/const ACTION_ROLES\s*=\s*\{([\s\S]*?)\n\};/);
if (!blokRoles) {
  console.error('GAGAL: blok ACTION_ROLES tidak ditemukan di Auth.gs');
  process.exit(1);
}
const berizin = new Set();
const polaKunci = /'([a-z0-9_]+)'\s*:/gi;
while ((m = polaKunci.exec(blokRoles[1])) !== null) berizin.add(m[1]);

const blokPublik = auth.match(/const PUBLIC_ACTIONS\s*=\s*\[([^\]]*)\]/);
const publik = new Set();
if (blokPublik) {
  const polaPublik = /'([a-z0-9_]+)'/gi;
  while ((m = polaPublik.exec(blokPublik[1])) !== null) publik.add(m[1]);
}

// --- Bandingkan ---
const tanpaIzin = [...dirutekan].filter(a => !berizin.has(a) && !publik.has(a)).sort();
const izinYatim = [...berizin].filter(a => !dirutekan.has(a)).sort();

console.log(`\nAction dirutekan di doPost : ${dirutekan.size}`);
console.log(`Action punya izin          : ${berizin.size} (+ ${publik.size} publik)\n`);

let gagal = 0;

if (tanpaIzin.length) {
  gagal++;
  console.log('GAGAL  Action dirutekan tapi TIDAK ada di ACTION_ROLES.');
  console.log('       Di produksi action ini dijawab "Action tidak dikenal."');
  tanpaIzin.forEach(a => console.log(`         - ${a}`));
  console.log('       Perbaikan: tambahkan ke ACTION_ROLES di Auth.gs.\n');
} else {
  console.log('LULUS  Semua action yang dirutekan punya izin.\n');
}

if (izinYatim.length) {
  // Peringatan saja, bukan kegagalan: izin tanpa rute tidak membuat apa pun
  // rusak, hanya menandakan sisa fitur lama yang perlu dibersihkan.
  console.log('CATATAN  Ada izin tanpa rute yang cocok (kemungkinan sisa fitur lama):');
  izinYatim.forEach(a => console.log(`           - ${a}`));
  console.log('');
}

console.log('=================================');
console.log(gagal ? '  ADA MASALAH' : '  SEMUA KONSISTEN');
console.log('=================================\n');
process.exit(gagal ? 1 : 0);
