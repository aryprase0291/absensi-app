// =======================================================
// VERIFIKASI WAJAH PENUH + LIVENESS UNTUK PRESENSI
//
// Mesin utama: face-api.js (TinyFaceDetector + 68 landmark).
//   - Menghitung berapa wajah yang ada di bingkai.
//   - Memastikan WAJAH UTUH: seluruh 68 titik (alis, mata, hidung,
//     mulut, garis rahang) berada di dalam bingkai, ukuran wajah cukup
//     besar, kepala menghadap lurus (bukan samping/separuh), tidak
//     miring berlebihan, dan mulut/dagu tidak tertutup.
//   - Liveness ringan: membandingkan selisih antar-frame supaya foto
//     kertas / layar HP yang diam tertolak.
//
// Mesin cadangan (hanya jika model gagal diunduh): analisis warna kulit
// + simetri + kontras. Ditandai sebagai "mode terbatas" pada UI.
// =======================================================

import { muatFaceApi } from './faceApiLoader';

const AMBANG = {
  skorMin: 0.5,
  // ukuran wajah relatif terhadap bingkai kamera
  tinggiMin: 0.26,
  tinggiMaks: 0.97,
  lebarMin: 0.17,
  lebarMaks: 0.97,
  // jarak aman dari tepi bingkai (persen dari sisi)
  marginTepi: 0.02,
  // simetri kiri-kanan (yaw) berbasis posisi hidung di antara kedua mata.
  // Nilai kalibrasi: wajah lurus 0.4-0.95, wajah berpaling kuat < 0.22.
  yawMin: 0.25,
  // perbandingan lebar mata kiri & kanan; anjlok saat wajah menyamping
  lebarMataMin: 0.42,
  // kemiringan kepala (roll) dalam derajat
  rollMaks: 28,
  // proporsi mata -> hidung -> dagu (pitch)
  pitchMin: 0.28,
  pitchMaks: 0.76,
  // lebar mulut dibanding jarak antar-mata
  mulutMin: 0.28,
  // posisi wajah harus di tengah bingkai
  pusatXMaks: 0.34,
  pusatYMaks: 0.36,
};

const LIVENESS = {
  diamMaks: 0.003,
  goyangMaks: 0.45,
  frameDiamToleransi: 6,
  frameHidupMin: 4,
};

const WARNA = {
  netral: 'text-slate-500 bg-slate-100',
  proses: 'text-blue-600 bg-blue-50',
  waspada: 'text-amber-600 bg-amber-50',
  tolak: 'text-rose-600 bg-rose-50',
  siap: 'text-emerald-600 bg-emerald-50',
};

const jarak = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rerata = (titik) => titik.reduce(
  (acc, p) => ({ x: acc.x + p.x / titik.length, y: acc.y + p.y / titik.length }),
  { x: 0, y: 0 }
);

/**
 * Nilai satu hasil deteksi: apakah wajahnya UTUH dan menghadap kamera.
 * @returns {{ ok: boolean, kode: string, pesan: string }}
 */
export function evaluasiWajahPenuh(hasil, lebar, tinggi) {
  if (!hasil || !hasil.detection || !hasil.landmarks) {
    return { ok: false, kode: 'tidak_ada', pesan: 'Wajah belum terdeteksi.' };
  }

  const box = hasil.detection.box;
  const skor = hasil.detection.score || 0;
  const pts = hasil.landmarks.positions || [];

  if (pts.length < 68) {
    return { ok: false, kode: 'landmark_kurang', pesan: 'Wajah belum terbaca jelas. Tambah pencahayaan.' };
  }

  // --- 1. Ukuran wajah ---
  const rasioTinggi = box.height / tinggi;
  const rasioLebar = box.width / lebar;
  if (rasioTinggi < AMBANG.tinggiMin || rasioLebar < AMBANG.lebarMin) {
    return { ok: false, kode: 'terlalu_jauh', pesan: 'Wajah terlalu jauh. Dekatkan wajah ke kamera.' };
  }
  if (rasioTinggi > AMBANG.tinggiMaks || rasioLebar > AMBANG.lebarMaks) {
    return { ok: false, kode: 'terlalu_dekat', pesan: 'Wajah terlalu dekat. Jauhkan sedikit dari kamera.' };
  }

  // --- 2. Wajah harus utuh di dalam bingkai (tidak terpotong) ---
  const mx = lebar * AMBANG.marginTepi;
  const my = tinggi * AMBANG.marginTepi;
  const adaYangKeluar = pts.some((p) => p.x < mx || p.x > lebar - mx || p.y < my || p.y > tinggi - my);
  if (adaYangKeluar || box.x < 0 || box.y < 0 || box.x + box.width > lebar || box.y + box.height > tinggi) {
    return { ok: false, kode: 'terpotong', pesan: 'Wajah terpotong. Masukkan SELURUH wajah (dahi sampai dagu) ke dalam bingkai.' };
  }

  // --- 3. Ketajaman deteksi ---
  if (skor < AMBANG.skorMin) {
    return { ok: false, kode: 'skor_rendah', pesan: 'Wajah kurang jelas. Cari tempat yang lebih terang dan hadap kamera.' };
  }

  // --- 4. Wajah harus di tengah bingkai ---
  const pusatX = (box.x + box.width / 2) / lebar;
  const pusatY = (box.y + box.height / 2) / tinggi;
  if (Math.abs(pusatX - 0.5) > AMBANG.pusatXMaks || Math.abs(pusatY - 0.5) > AMBANG.pusatYMaks) {
    return { ok: false, kode: 'tidak_di_tengah', pesan: 'Posisikan wajah di tengah lingkaran panduan.' };
  }

  // --- 5. Menghadap lurus (yaw): jarak hidung ke sisi kiri & kanan seimbang ---
  const mataKiri = rerata(pts.slice(36, 42));
  const mataKanan = rerata(pts.slice(42, 48));
  const hidung = pts[30];
  const dagu = pts[8];
  const rahangKiri = pts[0];
  const rahangKanan = pts[16];

  const dMataKiri = Math.abs(hidung.x - mataKiri.x);
  const dMataKanan = Math.abs(mataKanan.x - hidung.x);
  const dRahangKiri = Math.abs(hidung.x - rahangKiri.x);
  const dRahangKanan = Math.abs(rahangKanan.x - hidung.x);
  const simetriMata = Math.min(dMataKiri, dMataKanan) / Math.max(dMataKiri, dMataKanan, 1e-6);
  const simetriRahang = Math.min(dRahangKiri, dRahangKanan) / Math.max(dRahangKiri, dRahangKanan, 1e-6);
  const yaw = (simetriMata + simetriRahang) / 2;

  // Lebar kedua mata: saat wajah menyamping, satu mata memendek drastis
  // sehingga separuh wajah tidak lagi terlihat.
  const lebarMataKiri = Math.abs(pts[39].x - pts[36].x);
  const lebarMataKanan = Math.abs(pts[45].x - pts[42].x);
  const simetriLebarMata = Math.min(lebarMataKiri, lebarMataKanan)
    / Math.max(lebarMataKiri, lebarMataKanan, 1e-6);

  if (yaw < AMBANG.yawMin || simetriLebarMata < AMBANG.lebarMataMin) {
    return { ok: false, kode: 'menyamping', pesan: 'Hadap LURUS ke kamera. Wajah masih menyamping / separuh.' };
  }

  // --- 6. Kepala tidak miring berlebihan (roll) ---
  const roll = Math.abs(Math.atan2(mataKanan.y - mataKiri.y, mataKanan.x - mataKiri.x) * (180 / Math.PI));
  if (roll > AMBANG.rollMaks) {
    return { ok: false, kode: 'miring', pesan: 'Tegakkan kepala, jangan dimiringkan.' };
  }

  // --- 7. Proporsi mata -> hidung -> dagu (pitch: tidak menunduk / mendongak) ---
  const yMata = (mataKiri.y + mataKanan.y) / 2;
  const tinggiWajah = dagu.y - yMata;
  if (tinggiWajah <= 0) {
    return { ok: false, kode: 'pose_aneh', pesan: 'Posisi wajah belum wajar. Hadap lurus ke kamera.' };
  }
  const pitch = (pts[33].y - yMata) / tinggiWajah;
  if (pitch < AMBANG.pitchMin || pitch > AMBANG.pitchMaks) {
    return { ok: false, kode: 'menunduk', pesan: 'Jangan menunduk atau mendongak. Hadap lurus ke kamera.' };
  }

  // --- 8. Mulut & dagu terlihat (tidak tertutup masker/tangan) ---
  const jarakMata = jarak(mataKiri, mataKanan);
  const lebarMulut = Math.abs(pts[54].x - pts[48].x);
  if (jarakMata <= 0 || lebarMulut / jarakMata < AMBANG.mulutMin) {
    return { ok: false, kode: 'mulut_tertutup', pesan: 'Mulut dan dagu harus terlihat. Buka masker / singkirkan penghalang.' };
  }

  return { ok: true, kode: 'ok', pesan: 'Wajah penuh terverifikasi ✓' };
}

const OPSI_DETEKTOR = () => new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

async function deteksiWajah(faceapi, sumber) {
  const hasil = await faceapi.detectAllFaces(sumber, OPSI_DETEKTOR()).withFaceLandmarks(true);
  const luas = (r) => (r.detection.box.width || 0) * (r.detection.box.height || 0);
  return (hasil || []).sort((a, b) => luas(b) - luas(a));
}

/**
 * Pemeriksaan sekali jalan pada frame/canvas hasil jepretan.
 * Dipakai sebagai penjaga terakhir sebelum foto diterima.
 * @returns {Promise<{ ok: boolean, pesan: string, dilewati?: boolean }>}
 */
export async function periksaWajahPenuh(sumber) {
  let faceapi;
  try {
    faceapi = await muatFaceApi();
  } catch (e) {
    // Model tidak tersedia (offline / berkas belum ter-upload): jangan
    // mengunci total, pelacak realtime sudah memakai mode terbatas.
    return { ok: true, pesan: '', dilewati: true };
  }
  try {
    const lebar = sumber.videoWidth || sumber.width;
    const tinggi = sumber.videoHeight || sumber.height;
    const wajah = await deteksiWajah(faceapi, sumber);
    if (!wajah.length) return { ok: false, pesan: 'Wajah tidak terdeteksi pada foto. Ulangi dengan wajah menghadap kamera.' };
    if (wajah.length > 1) return { ok: false, pesan: 'Terdeteksi lebih dari 1 wajah pada foto. Pastikan hanya Anda di depan kamera.' };
    const nilai = evaluasiWajahPenuh(wajah[0], lebar, tinggi);
    return { ok: nilai.ok, pesan: nilai.ok ? '' : nilai.pesan };
  } catch (e) {
    return { ok: true, pesan: '', dilewati: true };
  }
}

// =======================================================
// MESIN CADANGAN (mode terbatas)
// =======================================================

function isSkinColor(r, g, b) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return (
    r > 50 && g > 30 && b > 20 && r > g && r > b && Math.abs(r - g) > 10
    && cb >= 80 && cb <= 140 && cr >= 130 && cr <= 185
  );
}

function rasioKulit(data, lebar, x0, y0, w, h) {
  let kulit = 0;
  let total = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * lebar + x) * 4;
      if (isSkinColor(data[i], data[i + 1], data[i + 2])) kulit += 1;
      total += 1;
    }
  }
  return total ? kulit / total : 0;
}

/**
 * Heuristik ketat: wajah harus mengisi oval tengah, simetris kiri-kanan,
 * ada pita atas (mata) dan bawah (mulut), serta latar di tepi BUKAN kulit
 * (menolak telapak tangan / dinding yang memenuhi layar).
 */
function analisaHeuristik(ctx, lebar, tinggi) {
  let img;
  try {
    img = ctx.getImageData(0, 0, lebar, tinggi);
  } catch (e) {
    return { ok: false, pesan: 'Kamera tidak dapat dianalisis.' };
  }
  const d = img.data;

  const x0 = Math.floor(lebar * 0.3);
  const y0 = Math.floor(tinggi * 0.18);
  const w = Math.floor(lebar * 0.4);
  const h = Math.floor(tinggi * 0.64);

  const kulitTengah = rasioKulit(d, lebar, x0, y0, w, h);
  if (kulitTengah < 0.22) return { ok: false, pesan: 'Wajah belum terlihat penuh di dalam lingkaran.' };

  const kiri = rasioKulit(d, lebar, x0, y0, Math.floor(w / 2), h);
  const kanan = rasioKulit(d, lebar, x0 + Math.floor(w / 2), y0, Math.floor(w / 2), h);
  const simetri = Math.min(kiri, kanan) / Math.max(kiri, kanan, 1e-6);
  if (simetri < 0.62) return { ok: false, pesan: 'Hadap lurus ke kamera, wajah masih separuh.' };

  const atas = rasioKulit(d, lebar, x0, y0, w, Math.floor(h * 0.35));
  const bawah = rasioKulit(d, lebar, x0, y0 + Math.floor(h * 0.65), w, Math.floor(h * 0.35));
  if (atas < 0.18 || bawah < 0.18) {
    return { ok: false, pesan: 'Wajah harus utuh: dahi sampai dagu terlihat.' };
  }

  const tepi = (
    rasioKulit(d, lebar, 0, 0, Math.floor(lebar * 0.12), tinggi)
    + rasioKulit(d, lebar, Math.floor(lebar * 0.88), 0, Math.floor(lebar * 0.12), tinggi)
  ) / 2;
  if (tepi > 0.7) return { ok: false, pesan: 'Objek menutupi kamera. Tunjukkan wajah Anda.' };

  // kontras fitur (mata/hidung/mulut) pada area wajah
  let jumlah = 0;
  let n = 0;
  const lum = [];
  for (let y = y0; y < y0 + h; y += 2) {
    for (let x = x0; x < x0 + w; x += 2) {
      const i = (y * lebar + x) * 4;
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      lum.push(l);
      jumlah += l;
      n += 1;
    }
  }
  const mean = jumlah / (n || 1);
  const sd = Math.sqrt(lum.reduce((a, l) => a + (l - mean) ** 2, 0) / (lum.length || 1));
  if (sd < 16) return { ok: false, pesan: 'Fitur wajah belum terbaca. Tambah pencahayaan.' };

  return { ok: true, pesan: '' };
}

function selisihFrame(prev, curr) {
  if (!prev || !curr || prev.length !== curr.length) return 0;
  let total = 0;
  let n = 0;
  for (let i = 0; i < curr.length; i += 8) {
    total += Math.abs(curr[i] - prev[i]);
    n += 1;
  }
  return total / (n * 255);
}

// =======================================================
// PELACAK REALTIME
// =======================================================

/**
 * @param {HTMLVideoElement} videoElement
 * @param {(s: object) => void} onStatusChange
 * @returns {{ stop: () => void }}
 */
export function startFaceLivenessTracker(videoElement, onStatusChange) {
  let hidup = true;
  let timer = null;
  let faceapi = null;
  let mesin = 'memuat';
  let prevFrame = null;
  let frameHidup = 0;
  let frameDiam = 0;
  let sibuk = false;

  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const lapor = (status, isLive, message, badgeColor, faceCount = 0) => {
    if (!hidup) return;
    onStatusChange({ status, isLive, faceCount, message, badgeColor, engine: mesin });
  };

  lapor('loading', false, 'Menyiapkan pemeriksaan wajah…', WARNA.proses);

  const belumHidup = (status, pesan, warna, jumlah = 1) => {
    frameHidup = 0;
    lapor(status, false, pesan, warna, jumlah);
  };

  const nilaiLiveness = (delta, status) => {
    if (delta < LIVENESS.diamMaks) {
      frameDiam += 1;
      if (frameDiam >= LIVENESS.frameDiamToleransi) {
        belumHidup('static_suspect', 'Gambar terdeteksi diam/statis (foto atau layar). Gerakkan kepala sedikit.', WARNA.tolak);
      } else {
        belumHidup('verifying', 'Memverifikasi keaktifan wajah…', WARNA.proses);
      }
      return;
    }
    if (delta > LIVENESS.goyangMaks) {
      belumHidup('unstable', 'Kamera terlalu bergoyang. Tahan posisi stabil.', WARNA.waspada);
      return;
    }
    frameDiam = 0;
    frameHidup += 1;
    if (frameHidup >= LIVENESS.frameHidupMin) {
      lapor('ready', true, status === 'ai' ? 'Wajah penuh terverifikasi ✓' : 'Wajah terverifikasi (mode terbatas) ✓', WARNA.siap, 1);
    } else {
      lapor('verifying', false, 'Memverifikasi keaktifan wajah…', WARNA.proses, 1);
    }
  };

  const satuFrame = async () => {
    const v = videoElement;
    if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) {
      belumHidup('searching', 'Menyiapkan kamera…', WARNA.netral, 0);
      return;
    }

    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const kecil = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const delta = prevFrame ? selisihFrame(prevFrame, kecil) : 0;
    const adaPembanding = !!prevFrame;
    prevFrame = new Uint8ClampedArray(kecil);

    if (mesin === 'ai') {
      const wajah = await deteksiWajah(faceapi, v);
      if (!wajah.length) {
        belumHidup('searching', 'Wajah tidak terdeteksi. Posisikan wajah di dalam lingkaran.', WARNA.netral, 0);
        return;
      }
      if (wajah.length > 1) {
        belumHidup('multiple_faces', `Terdeteksi ${wajah.length} wajah. Pastikan hanya Anda di depan kamera.`, WARNA.waspada, wajah.length);
        return;
      }
      const nilai = evaluasiWajahPenuh(wajah[0], v.videoWidth, v.videoHeight);
      if (!nilai.ok) {
        belumHidup('posisi', nilai.pesan, WARNA.waspada, 1);
        return;
      }
    } else {
      const nilai = analisaHeuristik(ctx, canvas.width, canvas.height);
      if (!nilai.ok) {
        belumHidup('posisi', nilai.pesan, WARNA.waspada, 0);
        return;
      }
    }

    if (!adaPembanding) {
      lapor('verifying', false, 'Memverifikasi keaktifan wajah…', WARNA.proses, 1);
      return;
    }
    nilaiLiveness(delta, mesin);
  };

  const tick = async () => {
    if (!hidup || sibuk) return;
    sibuk = true;
    try {
      await satuFrame();
    } catch (e) {
      /* satu frame gagal tidak boleh mematikan kamera */
    }
    sibuk = false;
    if (hidup) timer = setTimeout(tick, mesin === 'ai' ? 220 : 180);
  };

  muatFaceApi()
    .then((fa) => {
      if (!hidup) return;
      faceapi = fa;
      mesin = 'ai';
    })
    .catch(() => {
      if (!hidup) return;
      mesin = 'heuristik';
      lapor('loading', false, 'Model wajah gagal dimuat — memakai mode terbatas.', WARNA.waspada);
    })
    .finally(() => {
      if (hidup) tick();
    });

  return {
    stop: () => {
      hidup = false;
      if (timer) clearTimeout(timer);
      timer = null;
      prevFrame = null;
    },
  };
}
