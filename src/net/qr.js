// Pure JS QR Code Generator and Camera Scanner for Tank.exe
// Self-contained, zero-dependency.

// ---- QR Code Generator (Based on ISO/IEC 18004) -----------------------------
class QrCode {
  constructor(version, errorCorrectionLevel, dataCodewords, msk) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => Array(this.size).fill(false));

    this.drawFunctionPatterns(errorCorrectionLevel, msk);
    const allCodewords = this.addEccAndInterleave(dataCodewords, errorCorrectionLevel);
    this.drawCodewords(allCodewords);
    this.applyMask(msk);
  }

  drawFunctionPatterns(ecl, msk) {
    const s = this.size;
    // Finder patterns
    this.drawFinder(0, 0);
    this.drawFinder(s - 7, 0);
    this.drawFinder(0, s - 7);

    // Alignment patterns (for v >= 2)
    const alignPos = QrCode.ALIGNMENT_PATTERN_POS[this.version];
    if (alignPos) {
      for (const r of alignPos) {
        for (const c of alignPos) {
          if (!((r <= 8 && c <= 8) || (r <= 8 && c >= s - 8) || (r >= s - 8 && c <= 8))) {
            this.drawAlignment(c, r);
          }
        }
      }
    }

    // Timing patterns
    for (let i = 0; i < s; i++) {
      this.setFunction(i, 6, i % 2 === 0);
      this.setFunction(6, i, i % 2 === 0);
    }

    // Format bits
    const formatBits = QrCode.FORMAT_BITS[ecl][msk];
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, ((formatBits >> i) & 1) !== 0);
    this.setFunction(8, 7, ((formatBits >> 6) & 1) !== 0);
    this.setFunction(8, 8, ((formatBits >> 7) & 1) !== 0);
    this.setFunction(7, 8, ((formatBits >> 8) & 1) !== 0);
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, ((formatBits >> i) & 1) !== 0);

    for (let i = 0; i < 8; i++) this.setFunction(s - 1 - i, 8, ((formatBits >> i) & 1) !== 0);
    for (let i = 8; i < 15; i++) this.setFunction(8, s - 15 + i, ((formatBits >> i) & 1) !== 0);
    this.setFunction(8, s - 8, true);
  }

  setFunction(x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  drawFinder(x, y) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const isDark = (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        this.setFunction(x + dx, y + dy, isDark);
      }
    }
    // Separator ring
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        if (dx === -1 || dx === 7 || dy === -1 || dy === 7) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && px < this.size && py >= 0 && py < this.size) {
            this.setFunction(px, py, false);
          }
        }
      }
    }
  }

  drawAlignment(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const isDark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        this.setFunction(x + dx, y + dy, isDark);
      }
    }
  }

  drawCodewords(allCodewords) {
    let bitIndex = 0;
    const s = this.size;
    let right = s - 1;
    let upward = true;

    while (right > 0) {
      if (right === 6) right--; // Skip vertical timing pattern
      for (let vert = 0; vert < s; vert++) {
        const y = upward ? s - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (!this.isFunction[y][x]) {
            let dark = false;
            if (bitIndex < allCodewords.length * 8) {
              const byte = allCodewords[bitIndex >>> 3];
              dark = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0;
              bitIndex++;
            }
            this.modules[y][x] = dark;
          }
        }
      }
      upward = !upward;
      right -= 2;
    }
  }

  applyMask(msk) {
    const s = this.size;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!this.isFunction[y][x]) {
          let invert = false;
          switch (msk) {
            case 0: invert = (x + y) % 2 === 0; break;
            case 1: invert = y % 2 === 0; break;
            case 2: invert = x % 3 === 0; break;
            case 3: invert = (x + y) % 3 === 0; break;
            case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: invert = ((x * y) % 2 + (x * y) % 3) === 0; break;
            case 6: invert = (((x * y) % 2 + (x * y) % 3) % 2) === 0; break;
            case 7: invert = (((x + y) % 2 + (x * y) % 3) % 2) === 0; break;
          }
          if (invert) this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  addEccAndInterleave(dataCodewords, ecl) {
    const numBlocks = QrCode.NUM_BLOCKS[this.version][ecl];
    const totalData = QrCode.NUM_DATA_CODEWORDS[this.version][ecl];
    const eccPerBlock = QrCode.ECC_PER_BLOCK[this.version][ecl];
    const totalEcc = eccPerBlock * numBlocks;

    const shortBlockLen = Math.floor(totalData / numBlocks);
    const numShortBlocks = numBlocks - (totalData % numBlocks);

    const blocks = [];
    const eccBlocks = [];
    const genPoly = QrCode.getGeneratorPoly(eccPerBlock);

    let offset = 0;
    for (let i = 0; i < numBlocks; i++) {
      const blockLen = i < numShortBlocks ? shortBlockLen : shortBlockLen + 1;
      const b = dataCodewords.slice(offset, offset + blockLen);
      offset += blockLen;
      blocks.push(b);
      eccBlocks.push(QrCode.calcReedSolomon(b, genPoly));
    }

    const result = [];
    // Interleave data
    const maxDataLen = shortBlockLen + 1;
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < blocks[b].length) result.push(blocks[b][i]);
      }
    }
    // Interleave ECC
    for (let i = 0; i < eccPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) {
        result.push(eccBlocks[b][i]);
      }
    }
    return result;
  }

  static getGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = [];
      const root = QrCode.EXP_TABLE[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] = (next[j] || 0) ^ QrCode.gfMul(poly[j], root);
        next[j + 1] = poly[j];
      }
      poly = next;
    }
    return poly;
  }

  static calcReedSolomon(data, genPoly) {
    const ecc = Array(genPoly.length - 1).fill(0);
    for (const b of data) {
      const factor = b ^ ecc[0];
      ecc.shift();
      ecc.push(0);
      for (let i = 0; i < ecc.length; i++) {
        ecc[i] ^= QrCode.gfMul(genPoly[i + 1], factor);
      }
    }
    return ecc;
  }

  static gfMul(x, y) {
    if (x === 0 || y === 0) return 0;
    return QrCode.EXP_TABLE[(QrCode.LOG_TABLE[x] + QrCode.LOG_TABLE[y]) % 255];
  }

  static encodeText(text, ecl = 1) { // 1 = Low (L), 0 = Medium (M)
    const bytes = new TextEncoder().encode(text);
    // Find minimal version
    let version = 1;
    while (version <= 20) {
      const capacity = QrCode.NUM_DATA_CODEWORDS[version][ecl];
      // Mode indicator (4 bits) + Character count indicator (8 or 16 bits)
      const countBits = version < 10 ? 8 : 16;
      const headerBits = 4 + countBits;
      const totalBits = headerBits + bytes.length * 8;
      if (Math.ceil(totalBits / 8) <= capacity) {
        break;
      }
      version++;
    }
    if (version > 20) throw new Error('Data too large for QR Code');

    const capacity = QrCode.NUM_DATA_CODEWORDS[version][ecl];
    const countBits = version < 10 ? 8 : 16;

    // Bit buffer
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    // Byte mode: 0100
    pushBits(0b0100, 4);
    pushBits(bytes.length, countBits);
    for (const b of bytes) pushBits(b, 8);

    // Terminator (up to 4 zero bits)
    const padZeros = Math.min(4, capacity * 8 - bits.length);
    for (let i = 0; i < padZeros; i++) bits.push(0);

    // Pad to multiple of 8
    while (bits.length % 8 !== 0) bits.push(0);

    // Pad bytes 0xEC, 0x11
    const padBytes = [0xec, 0x11];
    let padIndex = 0;
    while (bits.length < capacity * 8) {
      pushBits(padBytes[padIndex % 2], 8);
      padIndex++;
    }

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }

    // Default mask 0 for simplicity and robust reading
    return new QrCode(version, ecl, codewords, 0);
  }
}

// Galois Field Tables
QrCode.EXP_TABLE = Array(256);
QrCode.LOG_TABLE = Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QrCode.EXP_TABLE[i] = x;
    QrCode.LOG_TABLE[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  QrCode.EXP_TABLE[255] = QrCode.EXP_TABLE[0];
})();

QrCode.FORMAT_BITS = [
  // M (0)
  [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  // L (1)
  [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
];

// Data capacity and ECC specification per version for L and M
QrCode.NUM_DATA_CODEWORDS = [
  null,
  [16, 19], [28, 34], [44, 55], [64, 80], [86, 108],
  [108, 136], [124, 156], [154, 194], [182, 232], [216, 274],
  [254, 324], [290, 370], [334, 428], [365, 461], [415, 523],
  [453, 589], [507, 647], [563, 721], [627, 795], [669, 861],
];

QrCode.NUM_BLOCKS = [
  null,
  [1, 1], [1, 1], [1, 1], [2, 1], [2, 1],
  [4, 2], [4, 2], [4, 2], [5, 2], [5, 4],
  [5, 4], [8, 4], [9, 4], [9, 4], [10, 6],
  [10, 6], [11, 6], [13, 6], [14, 7], [16, 8],
];

QrCode.ECC_PER_BLOCK = [
  null,
  [10, 7], [16, 10], [26, 15], [18, 20], [24, 26],
  [16, 18], [18, 20], [22, 24], [22, 30], [26, 18],
  [30, 20], [22, 24], [22, 26], [24, 30], [24, 22],
  [28, 24], [28, 28], [26, 30], [26, 28], [26, 28],
];

QrCode.ALIGNMENT_PATTERN_POS = [
  null,
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
  [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

/**
 * Renders a high-contrast QR Code to an HTML Canvas element.
 */
export function renderQrToCanvas(canvas, text, options = {}) {
  const qr = QrCode.encodeText(text, options.ecl !== undefined ? options.ecl : 1);
  const margin = options.margin !== undefined ? options.margin : 2;
  const size = qr.size + margin * 2;
  const scale = options.scale || Math.max(3, Math.floor(260 / size));

  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#000000';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) {
        ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
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
