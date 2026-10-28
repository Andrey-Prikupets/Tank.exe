// Lightweight QR Code Generator and Camera Scanner for Tank.exe
// Uses uqr (UnJS) for ultra-lightweight, zero-dependency QR matrix encoding.
import { encode } from 'uqr';

/**
 * Renders a high-contrast QR Code to an HTML Canvas element.
 */
export function renderQrToCanvas(canvas, text, options = {}) {
  const margin = options.margin !== undefined ? options.margin : (options.border !== undefined ? options.border : 2);
  const qr = encode(text, {
    ecc: options.ecc || 'L',
    border: margin,
  });

  const size = qr.size;
  const scale = options.scale || Math.max(3, Math.floor(260 / size));

  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#000000';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.data[y][x]) {
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}

/**
 * Initiates camera feed and scans for QR codes using BarcodeDetector.
 */
export function createQrScanner(videoEl, onScan, onError) {
  let stream = null;
  let animId = null;
  let active = true;

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      videoEl.srcObject = stream;
      await videoEl.play();

      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const scanLoop = async () => {
          if (!active) return;
          try {
            if (videoEl.readyState >= 2) {
              const barcodes = await detector.detect(videoEl);
              if (barcodes.length > 0) {
                const val = barcodes[0].rawValue;
                if (val) {
                  onScan(val);
                  return;
                }
              }
            }
          } catch {}
          animId = requestAnimationFrame(scanLoop);
        };
        animId = requestAnimationFrame(scanLoop);
      } else {
        if (onError) onError('BarcodeDetector not supported in this browser. Please paste the offer code manually.');
      }
    } catch (err) {
      if (onError) onError('Camera permission denied or camera unavailable.');
    }
  }

  function stop() {
    active = false;
    if (animId) cancelAnimationFrame(animId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  start();
  return { stop };
}
