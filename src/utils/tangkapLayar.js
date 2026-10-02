// =======================================================
// TANGKAP LAYAR -> CLIPBOARD (siap Ctrl/Cmd+V ke WhatsApp)
//
// KENAPA ClipboardItem DIBUAT SEBELUM GAMBARNYA JADI.
//   Safari (Mac & iPhone) hanya mengizinkan clipboard.write di dalam
//   "gestur pengguna" yang masih hidup. html2canvas butuh waktu; kalau
//   kita menunggu gambar selesai dulu lalu menulis, Safari sudah
//   menganggap klik-nya kedaluwarsa dan menolak diam-diam. Jalan
//   keluarnya: ClipboardItem dibuat SEKETIKA saat klik dengan isi berupa
//   Promise<Blob> — Chrome dan Safari sama-sama menerimanya.
//
// Kalau clipboard tetap ditolak (http biasa, Firefox lama, WebView),
// gambar diunduh sebagai PNG supaya tetap bisa dikirim manual.
//
// `pilihGulir`: selector elemen bergulir di dalam target. Di salinan
// DOM untuk html2canvas, batas tinggi & scroll-nya dilepas supaya
// SELURUH isi tertangkap, bukan hanya bagian yang terlihat.
// =======================================================

export async function tangkapKeClipboard(el, opsi) {
  const o = opsi || {};
  if (!el) return { ok: false };

  let selesaikan, gagalkan;
  const janjiBlob = new Promise((ok, no) => { selesaikan = ok; gagalkan = no; });

  // 1) Daftarkan tulisan clipboard SEKARANG, selagi gestur klik masih sah.
  let janjiSalin = Promise.reject(new Error('tidak didukung'));
  try {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      janjiSalin = navigator.clipboard.write([new window.ClipboardItem({ 'image/png': janjiBlob })]);
    }
  } catch (e) { /* lanjut ke unduhan */ }
  janjiSalin.catch(() => {});

  // 2) Baru gambar dibuat.
  let blob;
  try {
    const html2canvas = (await import('html2canvas')).default;
    const kanvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      onclone: (doc) => {
        (o.lepas || []).forEach((q) => {
          doc.querySelectorAll(q).forEach((x) => {
            x.style.maxHeight = 'none';
            x.style.overflow = 'visible';
          });
        });
        // Elemen bertanda data-tanpa-foto (tombol, dsb.) tidak ikut.
        doc.querySelectorAll('[data-tanpa-foto]').forEach((x) => { x.style.display = 'none'; });
        doc.querySelectorAll('th').forEach((x) => { if (x.style) x.style.position = 'static'; });
      }
    });
    blob = await new Promise((ok) => kanvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('kanvas kosong');
    selesaikan(blob);
  } catch (e) {
    gagalkan(e);
    return { ok: false };
  }

  let tersalin = false;
  try { await janjiSalin; tersalin = true; } catch (e) { tersalin = false; }

  if (!tersalin || o.unduhJuga) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (o.namaFile || 'tangkapan') + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return { ok: true, tersalin };
}
