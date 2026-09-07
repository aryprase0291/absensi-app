/**
 * UJI STEMPEL LOKASI PADA FOTO ABSEN
 *
 * Jalankan:  node scripts/test-stempel-foto.js
 *
 * KENAPA ADA: stempel foto dulu menulis koordinat (pendek, selalu muat).
 * Sekarang menulis nama alamat yang bisa 2-3 kali lebih panjang. Kalau
 * pembungkusan barisnya salah, gejalanya hanya terlihat setelah foto
 * terlanjur diambil karyawan — nama jalan terpotong di tepi kiri, dan
 * bukti absennya jadi tidak terbaca.
 *
 * Fungsi diambil langsung dari src/App.js supaya yang diuji kode nyata.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.js'), 'utf8');
const ambil = (nama) => {
  const i = src.indexOf('function ' + nama);
  if (i === -1) throw new Error('fungsi ' + nama + ' tidak ditemukan di App.js');
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) break; }
  }
  return src.slice(i, j + 1);
};
// eslint-disable-next-line no-eval
eval(['pecahBarisTeks', 'potongAgarMuat', 'gambarStempelKanan'].map(ambil).join('\n'));

// --- Canvas tiruan -------------------------------------------------
// Lebar huruf didekati 0,55 x fontSize: cukup mendekati bold sans-serif
// untuk menguji logika pembungkusan.
function buatCtx() {
  const ctx = {
    font: '',
    _size: 10,
    digambar: [],
    measureText(t) { return { width: t.length * this._size * 0.55 }; },
    strokeText(t, x, y) { this.digambar.push({ t, x, y, size: this._size }); },
    fillText() { /* pasangan strokeText, tidak dicatat dua kali */ }
  };
  Object.defineProperty(ctx, 'font', {
    get() { return this._font; },
    set(v) { this._font = v; this._size = parseInt(String(v).match(/(\d+)px/)[1], 10); }
  });
  return ctx;
}

let lulus = 0, gagal = 0;
function uji(nama, teks, lebarFoto, maksBaris) {
  const ctx = buatCtx();
  const fontSize = Math.floor(lebarFoto / 25);
  const paddingX = 20;
  const maxWidth = lebarFoto - paddingX * 2;
  ctx.font = `bold ${fontSize}px sans-serif`;
  gambarStempelKanan(ctx, teks, lebarFoto - paddingX, 1000, fontSize, maxWidth, maksBaris || 2);

  const baris = ctx.digambar;
  const gabung = baris.map(b => b.t).join(' ');
  const semuaKata = teks.split(/\s+/).filter(Boolean).join(' ');

  const tidakAdaYangHilang = gabung === semuaKata;
  const semuaMuat = baris.every(b => b.t.length * b.size * 0.55 <= maxWidth + 0.01);
  const jumlahBarisOk = baris.length <= (maksBaris || 2) && baris.length >= 1;

  if (tidakAdaYangHilang && semuaMuat && jumlahBarisOk) {
    lulus++;
    console.log(`  LULUS  ${nama}`);
    console.log(`         ${baris.length} baris @ ${baris[0].size}px: ${baris.map(b => '"' + b.t + '"').join(' / ')}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}`);
    if (!tidakAdaYangHilang) console.log(`         teks terpotong! hilang: "${semuaKata.replace(gabung, '').trim()}"`);
    if (!semuaMuat) console.log(`         ada baris melebihi lebar foto`);
    if (!jumlahBarisOk) console.log(`         jumlah baris ${baris.length}, maksimum ${maksBaris || 2}`);
    console.log(`         hasil: ${baris.map(b => '"' + b.t + '" @' + b.size + 'px').join(' / ')}`);
  }
}

console.log('\n=== FOTO POTRET 720px (kamera depan umum) ===');
uji('Alamat khas', 'Jl. Raya Darmo No. 68, Wonokromo, Surabaya', 720);
uji('Alamat panjang', 'Jl. Mayjend Sungkono No. 149, Dukuh Pakis, Kota Surabaya', 720);
uji('Alamat sangat panjang', 'Jl. Raya Kalirungkut Ruko Rungkut Megah Raya Blok C No. 21, Kali Rungkut, Kab. Sidoarjo', 720);
uji('Ringkas tanpa jalan', 'Wonokromo, Surabaya', 720);

console.log('\n=== FOTO 1080px ===');
uji('Alamat khas', 'Jl. Raya Darmo No. 68, Wonokromo, Surabaya', 1080);
uji('Alamat sangat panjang', 'Jl. Raya Kalirungkut Ruko Rungkut Megah Raya Blok C No. 21, Kali Rungkut, Kab. Sidoarjo', 1080);

console.log('\n=== CADANGAN & KASUS EKSTREM ===');
uji('Koordinat (saat alamat belum siap)', '-7.247680, 112.736731', 720);
uji('Tanpa GPS', 'No GPS', 720);
uji('Satu kata sangat panjang', 'Jalanrayakalirungkutmegahrayablokcnomorduapuluhsatu', 720);
uji('Foto sempit 480px', 'Jl. Mayjend Sungkono No. 149, Dukuh Pakis, Kota Surabaya', 480);

console.log(`\n=================================`);
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log(`=================================\n`);
process.exit(gagal > 0 ? 1 : 0);
