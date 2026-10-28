import assert from 'assert';
import { renderQrToCanvas } from '../src/net/qr.js';

console.log('Testing QR Code Generator...');

// Mock canvas & 2D context
class MockContext2D {
  constructor() {
    this.fillStyle = '';
    this.rects = [];
  }
  fillRect(x, y, w, h) {
    this.rects.push({ x, y, w, h, fill: this.fillStyle });
  }
}

class MockCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.ctx = new MockContext2D();
  }
  getContext(type) {
    return this.ctx;
  }
}

const canvas = new MockCanvas();
const sampleText = 'TANK:ABC123XYZ';
renderQrToCanvas(canvas, sampleText);

assert(canvas.width > 0, 'Canvas width must be greater than 0');
assert(canvas.height === canvas.width, 'QR code canvas should be square');
assert(canvas.ctx.rects.length > 20, 'Should have drawn QR modules');

console.log(`✓ QR Code Generator test passed! Canvas size: ${canvas.width}x${canvas.height}, drawn modules: ${canvas.ctx.rects.length}`);
