// =======================================================
// PEMUAT MODEL DETEKSI WAJAH (face-api.js)
//
// Pustaka dan model TIDAK ikut di bundle utama supaya aplikasi tetap
// ringan saat dibuka. Keduanya baru diunduh saat kamera presensi dibuka,
// lalu disimpan di cache browser.
//
//   public/vendor/face-api.js              -> pustaka (UMD, global window.faceapi)
//   public/models/tiny_face_detector_*     -> detektor wajah (~195 KB)
//   public/models/face_landmark_68_tiny_*  -> 68 titik landmark (~80 KB)
// =======================================================

const BASE = process.env.PUBLIC_URL || '';
const URL_PUSTAKA = `${BASE}/vendor/face-api.js`;
const URL_MODEL = `${BASE}/models`;
const BATAS_UNDUH_MS = 25000;

let janjiMuat = null;
let janjiPengenal = null;

function muatSkrip(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Tidak ada dokumen HTML.'));
      return;
    }
    const adaSebelumnya = document.querySelector(`script[data-face-api="1"]`);
    if (adaSebelumnya && window.faceapi) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.setAttribute('data-face-api', '1');
    const timer = setTimeout(() => {
      el.onload = null;
      el.onerror = null;
      reject(new Error('Waktu unduh pustaka deteksi wajah habis.'));
    }, BATAS_UNDUH_MS);
    el.onload = () => { clearTimeout(timer); resolve(); };
    el.onerror = () => { clearTimeout(timer); reject(new Error('Berkas pustaka deteksi wajah tidak ditemukan.')); };
    document.head.appendChild(el);
  });
}

/**
 * Muat pustaka + model. Dipanggil berkali-kali aman (hasilnya dipakai ulang).
 * @returns {Promise<object>} objek faceapi
 */
export function muatFaceApi() {
  if (janjiMuat) return janjiMuat;

  janjiMuat = (async () => {
    if (!window.faceapi) await muatSkrip(URL_PUSTAKA);
    const faceapi = window.faceapi;
    if (!faceapi) throw new Error('Pustaka deteksi wajah gagal dimuat.');

    // Backend WebGL jauh lebih cepat di HP; CPU dipakai bila WebGL mati.
    try {
      if (faceapi.tf && typeof faceapi.tf.setBackend === 'function') {
        const ok = await faceapi.tf.setBackend('webgl').catch(() => false);
        if (ok === false) await faceapi.tf.setBackend('cpu').catch(() => {});
        if (typeof faceapi.tf.ready === 'function') await faceapi.tf.ready();
      }
    } catch (e) {
      /* biarkan backend bawaan */
    }

    if (!faceapi.nets.tinyFaceDetector.isLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromUri(URL_MODEL);
    }
    if (!faceapi.nets.faceLandmark68TinyNet.isLoaded) {
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(URL_MODEL);
    }
    return faceapi;
  })().catch((err) => {
    janjiMuat = null; // supaya bisa dicoba lagi saat kamera dibuka ulang
    throw err;
  });

  return janjiMuat;
}

// =======================================================
// MODEL PENGENAL WAJAH (identitas, bukan sekadar "ada wajah")
//
// face_recognition_model.bin berukuran ~6,2 MB — tiga puluh kali lipat
// detektor wajah. Karena itu ia SENGAJA DIPISAH dari muatFaceApi():
// kamera harus sudah bisa menyala dan memandu posisi wajah sementara
// berkas ini masih mengalir di latar. Kalau digabung, karyawan menatap
// layar kosong belasan detik di jaringan kantor yang pelan.
//
// Dipanggil dua kali dengan tujuan berbeda:
//   - saat kamera Hadir/Pulang dibuka  -> mulai mengunduh (hasil diabaikan)
//   - saat tombol jepret ditekan       -> ditunggu sampai selesai
// Karena janjinya dipakai ulang, panggilan kedua hampir selalu instan.
// =======================================================

export function muatPengenalWajah() {
  if (janjiPengenal) return janjiPengenal;

  janjiPengenal = (async () => {
    const faceapi = await muatFaceApi();
    if (!faceapi.nets.faceRecognitionNet.isLoaded) {
      await faceapi.nets.faceRecognitionNet.loadFromUri(URL_MODEL);
    }
    return faceapi;
  })().catch((err) => {
    janjiPengenal = null; // boleh dicoba lagi saat kamera dibuka ulang
    throw err;
  });

  return janjiPengenal;
}

export function pengenalWajahSiap() {
  return !!(window.faceapi && window.faceapi.nets.faceRecognitionNet.isLoaded);
}

export function faceApiSiap() {
  return !!(window.faceapi
    && window.faceapi.nets.tinyFaceDetector.isLoaded
    && window.faceapi.nets.faceLandmark68TinyNet.isLoaded);
}
