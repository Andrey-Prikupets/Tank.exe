import * as THREE from 'three';

/**
 * Procedural texture generator for Tank.exe.
 * Generates textures for:
 * 1. Ground (seamless multi-octave organic turf without obvious tiling)
 * 2. Water (cyan caustic ripples)
 * 3. Area walls (precast concrete panels with expansion joints)
 * 4. House walls (stone masonry blocks in running bond)
 * 5. Gate doors (heavy industrial steel blast door with ribs and rivets)
 * 6. Windows (multi-pane observation/building window with glare highlight)
 * 7. Tank body (military armor plates with weld seams and rivets)
 * 8. Tank turret (octagonal facet armor plates and commander's hatch)
 */

function createGroundCanvas() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  // Mathematically periodic 2D harmonics:
  // Using integer wave numbers ensures f(0, y) == f(size, y) and f(x, 0) == f(x, size)
  // so the texture tiles seamlessly with ZERO boundary seams.
  // We use multiple low, mid, and high frequencies with irrational phase offsets
  // and subtle contrast so repetition is not readily apparent.
  const waves = [
    // Low frequency (broad organic soil/turf variation)
    { kx: 1, ky: 1, a: 0.18, px: 0.3, py: 1.2 },
    { kx: 2, ky: 1, a: 0.15, px: 2.1, py: 0.7 },
    { kx: 1, ky: 2, a: 0.14, px: 1.4, py: 2.5 },
    { kx: 2, ky: 3, a: 0.12, px: 3.2, py: 1.1 },
    { kx: 3, ky: 2, a: 0.11, px: 0.8, py: 3.4 },
    // Mid frequency (turf clumps and grass clusters)
    { kx: 5, ky: 4, a: 0.09, px: 1.9, py: 2.3 },
    { kx: 4, ky: 6, a: 0.08, px: 4.1, py: 0.5 },
    { kx: 7, ky: 5, a: 0.07, px: 2.7, py: 3.8 },
    { kx: 6, ky: 8, a: 0.06, px: 0.4, py: 1.6 },
    // High frequency (fine blade grain and micro-roughness)
    { kx: 11, ky: 13, a: 0.05, px: 3.5, py: 4.2 },
    { kx: 17, ky: 14, a: 0.04, px: 1.2, py: 2.8 },
    { kx: 23, ky: 19, a: 0.035, px: 5.1, py: 0.9 },
    { kx: 31, ky: 29, a: 0.025, px: 2.4, py: 3.1 },
  ];

  const pi2 = Math.PI * 2;
  let idx = 0;

  for (let y = 0; y < size; y++) {
    const v = (y / size) * pi2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * pi2;

      let sum = 0;
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i];
        sum += w.a * Math.sin(w.kx * u + w.px) * Math.cos(w.ky * v + w.py);
      }

      // Add periodic micro-grain
      const micro = 0.03 * (Math.sin(u * 53 + v * 47) * Math.cos(u * 41 - v * 59));
      sum += micro;

      // Keep modulation gentle: range ~0.90 to 1.10 around baseline
      const factor = 1.0 + sum * 0.45;

      // Base tint: neutral off-white with faint warm-to-cool turf undertones
      // (Multiplying with Three.js material.color keeps COLOR_FIELD vibrant and natural)
      const r = Math.min(255, Math.max(0, Math.round(230 * factor * (1.0 + sum * 0.12))));
      const g = Math.min(255, Math.max(0, Math.round(242 * factor)));
      const b = Math.min(255, Math.max(0, Math.round(225 * factor * (1.0 - sum * 0.15))));

      data[idx++] = r;
      data[idx++] = g;
      data[idx++] = b;
      data[idx++] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function createWaterCanvas() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  const pi2 = Math.PI * 2;
  let idx = 0;

  for (let y = 0; y < size; y++) {
    const v = (y / size) * pi2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * pi2;

      // Periodic ripple waves
      const w1 = Math.sin(u * 2 + v * 3) * Math.cos(u * 3 - v * 2);
      const w2 = Math.sin(u * 4 - v * 2 + 1.2) * Math.cos(u * 2 + v * 4 + 0.5);
      const w3 = Math.sin(u * 6 + v * 5 + 2.1) * Math.cos(u * 5 - v * 6 + 1.7);
      const comb = (w1 + w2 * 0.6 + w3 * 0.35) / 1.95;

      // Caustic specular edge
      const caustic = Math.pow(Math.max(0, (comb + 1) * 0.5), 3.2);

      // Cyan pool water palette: deeper turquoise base with bright cyan highlights
      const r = Math.min(255, Math.round(30 + caustic * 180));
      const g = Math.min(255, Math.round(200 + caustic * 55));
      const b = Math.min(255, Math.round(225 + caustic * 30));

      data[idx++] = r;
      data[idx++] = g;
      data[idx++] = b;
      data[idx++] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function createWallCanvas() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Base concrete
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, w, h);

  // Concrete noise
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 16;
    data[i] = Math.min(255, Math.max(0, data[i] + grain));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
  }
  ctx.putImageData(imgData, 0, 0);

  // Precast concrete panel expansion joints (2 panels wide, 2 panels high)
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#a8a8a8';
  ctx.beginPath();
  // Horizontal center seam
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  // Vertical center seam
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  // Outer borders
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.stroke();

  // Highlight line under seams for 3D groove depth
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, h / 2 + 2);
  ctx.lineTo(w, h / 2 + 2);
  ctx.moveTo(w / 2 + 2, 0);
  ctx.lineTo(w / 2 + 2, h);
  ctx.stroke();

  // Circular tie-rod formwork indents at panel corners
  ctx.fillStyle = '#9c9c9c';
  const corners = [
    [16, 16], [w / 2 - 16, 16], [w / 2 + 16, 16], [w - 16, 16],
    [16, h / 2 - 16], [w / 2 - 16, h / 2 - 16], [w / 2 + 16, h / 2 - 16], [w - 16, h / 2 - 16],
    [16, h / 2 + 16], [w / 2 - 16, h / 2 + 16], [w / 2 + 16, h / 2 + 16], [w - 16, h / 2 + 16],
    [16, h - 16], [w / 2 - 16, h - 16], [w / 2 + 16, h - 16], [w - 16, h - 16],
  ];
  for (const [cx, cy] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 3, 0, Math.PI);
    ctx.stroke();
  }

  return canvas;
}

function createHouseCanvas() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Base stone wall background (mortar color)
  ctx.fillStyle = '#6a645d';
  ctx.fillRect(0, 0, w, h);

  // 8 courses of stone blocks in running bond
  const rows = 8;
  const rowH = h / rows;
  const blockW = w / 4;

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const isOdd = r % 2 === 1;
    const startX = isOdd ? -blockW / 2 : 0;

    for (let x = startX; x < w + blockW; x += blockW) {
      // Deterministic slight tonal variation per block
      const hash = Math.sin(r * 37.1 + (x + 200) * 19.3) * 0.5 + 0.5;
      const light = Math.round(210 + hash * 35);
      ctx.fillStyle = `rgb(${light}, ${light}, ${light})`;

      // Leave 2px mortar gap
      ctx.fillRect(x + 1, y + 1, blockW - 2, rowH - 2);

      // Block bevel highlight on top/left
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(x + 1, y + 1, blockW - 2, 1.5);
      ctx.fillRect(x + 1, y + 1, 1.5, rowH - 2);

      // Block shadow on bottom/right
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(x + 1, y + rowH - 2.5, blockW - 2, 1.5);
      ctx.fillRect(x + blockW - 2.5, y + 1, 1.5, rowH - 2);
    }
  }

  // Stone grain noise
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 12;
    data[i] = Math.min(255, Math.max(0, data[i] + grain));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
  }
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}

function createDoorCanvas() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Base steel door
  ctx.fillStyle = '#b0b6bc';
  ctx.fillRect(0, 0, w, h);

  // Vertical border frames with bolts
  const frameW = 20;
  ctx.fillStyle = '#8f969d';
  ctx.fillRect(0, 0, frameW, h);
  ctx.fillRect(w - frameW, 0, frameW, h);

  // Horizontal steel slats
  const slats = 8;
  const slatH = h / slats;
  for (let s = 0; s < slats; s++) {
    const y = s * slatH;

    // Slat body gradient
    const grad = ctx.createLinearGradient(0, y, 0, y + slatH);
    grad.addColorStop(0, '#dce0e4');
    grad.addColorStop(0.5, '#bdc3c8');
    grad.addColorStop(1, '#959ca2');
    ctx.fillStyle = grad;
    ctx.fillRect(frameW, y + 2, w - 2 * frameW, slatH - 4);

    // Deep groove between slats
    ctx.fillStyle = '#4c5258';
    ctx.fillRect(frameW, y + slatH - 2, w - 2 * frameW, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(frameW, y, w - 2 * frameW, 1);

    // Bolts on frame
    ctx.fillStyle = '#40454a';
    ctx.beginPath();
    ctx.arc(frameW / 2, y + slatH / 2, 3, 0, Math.PI * 2);
    ctx.arc(w - frameW / 2, y + slatH / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(frameW / 2 - 1, y + slatH / 2 - 1, 1, 0, Math.PI * 2);
    ctx.arc(w - frameW / 2 - 1, y + slatH / 2 - 1, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer border
  ctx.strokeStyle = '#3e444a';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  return canvas;
}

function createWindowCanvas() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Dark frame
  ctx.fillStyle = '#1c262e';
  ctx.fillRect(0, 0, size, size);

  // 4 window panes (2x2 grid)
  const pad = 6;
  const bar = 5;
  const paneW = (size - 2 * pad - bar) / 2;
  const paneH = (size - 2 * pad - bar) / 2;

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const px = pad + c * (paneW + bar);
      const py = pad + r * (paneH + bar);

      // Glass tint gradient
      const grad = ctx.createLinearGradient(px, py, px + paneW, py + paneH);
      grad.addColorStop(0, '#2d4558');
      grad.addColorStop(0.7, '#1b2c3a');
      grad.addColorStop(1, '#101a24');
      ctx.fillStyle = grad;
      ctx.fillRect(px, py, paneW, paneH);

      // Bevel inside pane frame
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(px, py, paneW, 1.5);
      ctx.fillRect(px, py, 1.5, paneH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(px, py + paneH - 1.5, paneW, 1.5);
      ctx.fillRect(px + paneW - 1.5, py, 1.5, paneH);
    }
  }

  // Diagonal reflection glare slash across window
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, size - 2 * pad, size - 2 * pad);
  ctx.clip();
  ctx.strokeStyle = 'rgba(220, 245, 255, 0.35)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(-10, size + 10);
  ctx.lineTo(size + 10, -10);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(220, 245, 255, 0.18)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(15, size + 20);
  ctx.lineTo(size + 20, 15);
  ctx.stroke();
  ctx.restore();

  return canvas;
}

function createTankBodyCanvas() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base steel armor plate (near white so it modulates cleanly with team colors)
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, size, size);

  // Armor plate sections separated by recessed weld seams
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#7a7a7a';
  ctx.strokeRect(10, 10, size - 20, size - 20);

  // Engine deck hatch in center
  ctx.fillStyle = '#e2e2e2';
  ctx.fillRect(36, 36, size - 72, size - 72);
  ctx.strokeRect(36, 36, size - 72, size - 72);

  // Slanted ventilation louver lines on deck
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 2;
  for (let y = 56; y < size - 56; y += 12) {
    ctx.beginPath();
    ctx.moveTo(52, y);
    ctx.lineTo(size - 52, y);
    ctx.stroke();
  }

  // Heavy armor perimeter rivets
  ctx.fillStyle = '#444444';
  const rivetStep = 24;
  for (let x = 18; x < size - 14; x += rivetStep) {
    // Top & bottom rows
    ctx.beginPath();
    ctx.arc(x, 18, 2.5, 0, Math.PI * 2);
    ctx.arc(x, size - 18, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Inner hatch rows
    ctx.beginPath();
    ctx.arc(x, 44, 2, 0, Math.PI * 2);
    ctx.arc(x, size - 44, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let y = 18; y < size - 14; y += rivetStep) {
    ctx.beginPath();
    ctx.arc(18, y, 2.5, 0, Math.PI * 2);
    ctx.arc(size - 18, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Steel plate roughness grain
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 14;
    data[i] = Math.min(255, Math.max(0, data[i] + grain));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
  }
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}

function createTankTurretCanvas() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base armor
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, size, size);

  // 8 vertical columns corresponding to the 8 facets of the octagonal turret
  const colW = size / 8;
  for (let i = 0; i < 8; i++) {
    const x = i * colW;
    ctx.strokeStyle = '#606060';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();

    // Rivet along top and bottom of each facet
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath();
    ctx.arc(x + colW / 2, 14, 2.5, 0, Math.PI * 2);
    ctx.arc(x + colW / 2, size - 14, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Center commander's circular hatch (maps onto the cylinder top face)
  const cx = size / 2;
  const cy = size / 2;
  const r = 50;
  ctx.fillStyle = '#e4e4e4';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#505050';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Hatch hinge & lock
  ctx.fillStyle = '#404040';
  ctx.fillRect(cx - 10, cy - r - 4, 20, 8);
  ctx.fillRect(cx - 6, cy + r - 4, 12, 8);

  // Periscope prism slits
  ctx.fillStyle = '#222222';
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
    const px = cx + Math.cos(a) * (r * 0.6);
    const py = cy + Math.sin(a) * (r * 0.6);
    ctx.fillRect(px - 6, py - 3, 12, 6);
  }

  return canvas;
}

/**
 * Creates and returns all Three.js textures ready for use.
 */
export function createGameTextures() {
  const makeTexture = (canvas, rx = 1, ry = 1) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  };

  // Ground: 250m x 100m field. 10x4 repeat means each tile is 25m x 25m.
  const ground = makeTexture(createGroundCanvas(), 10, 4);

  // Water: repeats across pit ponds
  const water = makeTexture(createWaterCanvas(), 3, 2);

  // Area walls: concrete panels
  const wall = makeTexture(createWallCanvas(), 1, 1);

  // House walls: stone masonry
  const house = makeTexture(createHouseCanvas(), 1, 1);

  // Gate doors: steel blast door
  const door = makeTexture(createDoorCanvas(), 1, 1);

  // Windows: framed multi-pane glass
  const window = makeTexture(createWindowCanvas(), 1, 1);

  // Tank body: military armor plate
  const tankBody = makeTexture(createTankBodyCanvas(), 0.35, 0.35);

  // Tank turret: 8-facet armor with hatch
  const tankTurret = makeTexture(createTankTurretCanvas(), 1, 1);

  return {
    ground,
    water,
    wall,
    house,
    door,
    window,
    tankBody,
    tankTurret,
  };
}

/**
 * Scales UVs on a BoxGeometry so textures tile proportionally to world dimensions.
 * @param {THREE.BoxGeometry} geo
 * @param {number} sx Box width along X
 * @param {number} sy Box height along Y
 * @param {number} sz Box depth along Z
 * @param {number} scale World meters per texture repeat
 */
export function scaleBoxUVs(geo, sx, sy, sz, scale = 4) {
  const uv = geo.getAttribute('uv');
  if (!uv) return;

  // Face order in Three.js BoxGeometry:
  // 0, 1: +X, -X (size: sz x sy)
  // 2, 3: +Y, -Y (size: sx x sz)
  // 4, 5: +Z, -Z (size: sx x sy)
  const faceDims = [
    [sz / scale, sy / scale], // +X
    [sz / scale, sy / scale], // -X
    [sx / scale, sz / scale], // +Y
    [sx / scale, sz / scale], // -Y
    [sx / scale, sy / scale], // +Z
    [sx / scale, sy / scale], // -Z
  ];

  for (let face = 0; face < 6; face++) {
    const [uScale, vScale] = faceDims[face];
    const offset = face * 4;
    for (let i = 0; i < 4; i++) {
      const idx = offset + i;
      uv.setXY(idx, uv.getX(idx) * uScale, uv.getY(idx) * vScale);
    }
  }
  uv.needsUpdate = true;
}
