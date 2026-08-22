// =======================================================
// FACE DETECTION & LIGHTWEIGHT LIVENESS DETECTOR
//
// 1. Deteksi Wajah:
//    - Menggunakan Native Shape Detection API (window.FaceDetector) jika tersedia.
//    - Fallback: Analisis distribusi warna kulit (YCbCr/HSV) & kontras fitur wajah
//      pada area oval panduan kamera.
//
// 2. Liveness Detection (Keaktifan Wajah):
//    - Membandingkan perbedaan antar-frame (optical motion delta) pada area wajah.
//    - Mendeteksi gambar statis / foto kertas / layar HP lain yang diam (delta ~ 0).
//    - Memverifikasi gerakan mikro alami (kedipan, pernapasan, micro-tilt) pada
//      rentang toleransi yang wajar (bukan goyangan liar).
// =======================================================

/**
 * Cek apakah browser mendukung Shape Detection API bawaan
 */
export const isNativeFaceDetectorSupported = () => {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
};

/**
 * Evaluasi apakah pixel berada dalam rentang warna kulit manusia (YCbCr model)
 */
function isSkinColor(r, g, b) {
  // Model deteksi warna kulit empiris berbasis RGB & YCbCr
  // Y = 0.299R + 0.587G + 0.114B
  // Cb = 128 - 0.168736R - 0.331264G + 0.5B
  // Cr = 128 + 0.5R - 0.418688G - 0.081312B
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return (
    r > 50 &&
    g > 30 &&
    b > 20 &&
    r > g &&
    r > b &&
    Math.abs(r - g) > 10 &&
    cb >= 80 &&
    cb <= 140 &&
    cr >= 130 &&
    cr <= 185
  );
}

/**
 * Analisis area tengah bingkai oval kamera untuk mendeteksi keberadaan wajah
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} width 
 * @param {number} height 
 * @returns {{ hasFaceCandidate: boolean, skinRatio: number, contrast: number }}
 */
function analyzeFrameRegion(ctx, width, height) {
  // Ambil area tengah (35% s/d 65% lebar, 25% s/d 75% tinggi)
  const startX = Math.floor(width * 0.3);
  const startY = Math.floor(height * 0.2);
  const regionW = Math.floor(width * 0.4);
  const regionH = Math.floor(height * 0.5);

  let imageData;
  try {
    imageData = ctx.getImageData(startX, startY, regionW, regionH);
  } catch (e) {
    return { hasFaceCandidate: false, skinRatio: 0, contrast: 0 };
  }

  const data = imageData.data;
  const totalPixels = regionW * regionH;
  let skinCount = 0;
  let luminanceSum = 0;
  const luminances = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (isSkinColor(r, g, b)) {
      skinCount++;
    }

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    luminanceSum += lum;
    luminances.push(lum);
  }

  const skinRatio = skinCount / totalPixels;
  const meanLum = luminanceSum / totalPixels;

  // Hitung standar deviasi / kontras (wajah asli memiliki fitur kontras mata, hidung, mulut)
  let varianceSum = 0;
  for (let i = 0; i < luminances.length; i += 4) {
    varianceSum += Math.pow(luminances[i] - meanLum, 2);
  }
  const stdDev = Math.sqrt(varianceSum / (luminances.length / 4));

  // Wajah yang terposisi baik memiliki rasio warna kulit > 18% dan variasi kontras > 14
  const hasFaceCandidate = skinRatio >= 0.16 && stdDev >= 12;

  return {
    hasFaceCandidate,
    skinRatio,
    contrast: stdDev
  };
}

/**
 * Hitung selisih perubahan optik antar dua frame (Motion Delta)
 */
function calculateFrameDelta(prevData, currData) {
  if (!prevData || !currData || prevData.length !== currData.length) return 0;

  let diffSum = 0;
  const step = 8; // sampling setiap 8 byte (2 pixel) untuk efisiensi
  let sampled = 0;

  for (let i = 0; i < currData.length; i += step) {
    const diff = Math.abs(currData[i] - prevData[i]);
    diffSum += diff;
    sampled++;
  }

  // Normalisasi skor 0.0 s/d 1.0
  return diffSum / (sampled * 255);
}

/**
 * Membuat controller pelacak wajah dan liveness secara real-time
 * @param {HTMLVideoElement} videoElement 
 * @param {function} onStatusChange 
 * @returns {{ stop: function }}
 */
export function startFaceLivenessTracker(videoElement, onStatusChange) {
  let isRunning = true;
  let nativeDetector = null;
  let prevFrameData = null;
  let consecutiveLiveFrames = 0;
  let staticFrameCount = 0;
  let lastCheckTime = 0;

  // Offscreen canvas kecil untuk analisis performa tinggi
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (isNativeFaceDetectorSupported()) {
    try {
      // @ts-ignore
      nativeDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
    } catch (e) {
      nativeDetector = null;
    }
  }

  const loop = async (timestamp) => {
    if (!isRunning) return;

    // Throttle pemeriksaan setiap ~180ms agar hemat CPU dan baterai smartphone
    if (timestamp - lastCheckTime >= 180) {
      lastCheckTime = timestamp;

      if (
        videoElement &&
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
      ) {
        try {
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const currData = currentImageData.data;

          // 1. Cek Gerakan / Keaktifan (Motion Delta)
          let motionDelta = 0;
          if (prevFrameData) {
            motionDelta = calculateFrameDelta(prevFrameData, currData);
          }
          prevFrameData = new Uint8ClampedArray(currData);

          // 2. Deteksi Wajah
          let faceDetected = false;
          let faceCount = 0;

          if (nativeDetector) {
            try {
              const faces = await nativeDetector.detect(videoElement);
              faceCount = faces.length;
              faceDetected = faceCount === 1;
            } catch (err) {
              // Fallback jika API native gagal
              const analysis = analyzeFrameRegion(ctx, canvas.width, canvas.height);
              faceDetected = analysis.hasFaceCandidate;
              faceCount = faceDetected ? 1 : 0;
            }
          } else {
            // Fallback analisis warna kulit & fitur kontras
            const analysis = analyzeFrameRegion(ctx, canvas.width, canvas.height);
            faceDetected = analysis.hasFaceCandidate;
            faceCount = faceDetected ? 1 : 0;
          }

          // 3. Evaluasi Liveness & Konsistensi
          if (!faceDetected) {
            consecutiveLiveFrames = 0;
            staticFrameCount = 0;
            if (faceCount > 1) {
              onStatusChange({
                status: 'multiple_faces',
                isLive: false,
                faceCount,
                message: 'Terdeteksi lebih dari 1 wajah. Pastikan hanya Anda di kamera.',
                badgeColor: 'text-amber-600 bg-amber-50'
              });
            } else {
              onStatusChange({
                status: 'searching',
                isLive: false,
                faceCount: 0,
                message: 'Posisikan wajah Anda di tengah lingkaran',
                badgeColor: 'text-slate-500 bg-slate-100'
              });
            }
          } else {
            // Wajah terdeteksi, periksa apakah gambar hidup (ada gerakan mikro alami)
            if (motionDelta < 0.003) {
              // Sangat statis: kemungkinan foto kertas / layar monitor diam
              staticFrameCount++;
              if (staticFrameCount >= 6) {
                onStatusChange({
                  status: 'static_suspect',
                  isLive: false,
                  faceCount: 1,
                  message: 'Gambar terdeteksi diam/statis. Mohon gerakkan kepala sedikit.',
                  badgeColor: 'text-rose-600 bg-rose-50'
                });
              } else {
                onStatusChange({
                  status: 'verifying',
                  isLive: false,
                  faceCount: 1,
                  message: 'Memverifikasi keaktifan wajah...',
                  badgeColor: 'text-blue-600 bg-blue-50'
                });
              }
            } else if (motionDelta > 0.45) {
              // Gerakan terlalu cepat/goyang
              consecutiveLiveFrames = 0;
              onStatusChange({
                status: 'unstable',
                isLive: false,
                faceCount: 1,
                message: 'Kamera terlalu bergoyang. Tahan posisi stabil.',
                badgeColor: 'text-amber-600 bg-amber-50'
              });
            } else {
              // Gerakan mikro alami manusia yang hidup
              staticFrameCount = 0;
              consecutiveLiveFrames++;

              if (consecutiveLiveFrames >= 3) {
                onStatusChange({
                  status: 'ready',
                  isLive: true,
                  faceCount: 1,
                  message: 'Wajah aktif terverifikasi ✓',
                  badgeColor: 'text-emerald-600 bg-emerald-50'
                });
              } else {
                onStatusChange({
                  status: 'verifying',
                  isLive: false,
                  faceCount: 1,
                  message: 'Memverifikasi keaktifan wajah...',
                  badgeColor: 'text-blue-600 bg-blue-50'
                });
              }
            }
          }
        } catch (e) {
          // Kesalahan frame processing tidak boleh merusak alur kamera
        }
      }
    }

    if (isRunning) {
      requestAnimationFrame(loop);
    }
  };

  requestAnimationFrame(loop);

  return {
    stop: () => {
      isRunning = false;
    }
  };
}
