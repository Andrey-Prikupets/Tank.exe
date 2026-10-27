import * as C from '../constants.js';
import { gateX, windowY, slotPos, selectedTank, baseHeading } from '../sim/world.js';

const TEAM = [
  { base: C.COLOR_LEFT_TEAM, sel: C.COLOR_LEFT_SELECTED },
  { base: C.COLOR_RIGHT_TEAM, sel: C.COLOR_RIGHT_SELECTED },
];

export function createMap2D(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const debugVectors = !!options.debugVectors;
  let w = 0;
  let h = 0;
  let dpr = 1;

  function drawTacticalDigit(ctx, num, tr, scale) {
    const s = tr * 0.85;
    const w = s * 0.46;
    const h = s * 0.68;
    const th = Math.max(1.8, s * 0.32);
    const outlineExtra = Math.max(1.5, 0.35 * scale);

    function tracePath() {
      ctx.beginPath();
      switch (num) {
        case '1':
          ctx.moveTo(w * 0.2, -h);
          ctx.lineTo(w * 0.2, h);
          ctx.moveTo(-w * 0.7, -h * 0.35);
          ctx.lineTo(w * 0.2, -h);
          ctx.moveTo(-w * 0.7, h);
          ctx.lineTo(w * 0.9, h);
          break;
        case '2':
          ctx.moveTo(-w, -h);
          ctx.lineTo(w, -h);
          ctx.lineTo(w, 0);
          ctx.lineTo(-w, 0);
          ctx.lineTo(-w, h);
          ctx.lineTo(w, h);
          break;
        case '3':
          ctx.moveTo(-w, -h);
          ctx.lineTo(w, -h);
          ctx.lineTo(w, h);
          ctx.lineTo(-w, h);
          ctx.moveTo(-w * 0.35, 0);
          ctx.lineTo(w, 0);
          break;
        case '4':
          ctx.moveTo(-w, -h);
          ctx.lineTo(-w, 0.05 * h);
          ctx.lineTo(w, 0.05 * h);
          ctx.moveTo(w * 0.45, -h);
          ctx.lineTo(w * 0.45, h);
          break;
        case '5':
          ctx.moveTo(w, -h);
          ctx.lineTo(-w, -h);
          ctx.lineTo(-w, 0);
          ctx.lineTo(w, 0);
          ctx.lineTo(w, h);
          ctx.lineTo(-w, h);
          break;
      }
    }

    ctx.save();
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    // Outer dark silhouette for high contrast against turret color
    tracePath();
    ctx.lineWidth = th + outlineExtra * 2;
    ctx.strokeStyle = '#050a06';
    ctx.stroke();

    // Solid crisp white foreground
    tracePath();
    ctx.lineWidth = th;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.restore();
  }

  function drawTargetArrow(ctx, startX, startY, endX, endY, owner, scale, px, py) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5) return;

    const ux = dx / dist;
    const uy = dy / dist;
    const color = owner === 0 ? C.COLOR_TARGET_ARROW_LEFT : C.COLOR_TARGET_ARROW_RIGHT;

    // Stop arrow tip slightly outside target hull so it cleanly points at it
    const tipOffset = Math.min(dist * 0.4, C.TANK_LENGTH_M * 0.48);
    const tipX = endX - ux * tipOffset;
    const tipY = endY - uy * tipOffset;

    const headLen = Math.max(4.5, C.MAP_TARGET_ARROW_HEAD_LEN_M * scale);
    const headAngle = C.MAP_TARGET_ARROW_HEAD_ANGLE_RAD;
    const angle = Math.atan2(uy, ux);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.2, C.MAP_TARGET_ARROW_WIDTH_PX * scale * 0.25);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    // Thin shaft line
    ctx.beginPath();
    ctx.moveTo(px(startX), py(startY));
    ctx.lineTo(px(tipX), py(tipY));
    ctx.stroke();

    // Sharp arrowhead
    const x1 = tipX - Math.cos(angle - headAngle) * (headLen / scale);
    const y1 = tipY - Math.sin(angle - headAngle) * (headLen / scale);
    const x2 = tipX - Math.cos(angle + headAngle) * (headLen / scale);
    const y2 = tipY - Math.sin(angle + headAngle) * (headLen / scale);

    ctx.beginPath();
    ctx.moveTo(px(tipX), py(tipY));
    ctx.lineTo(px(x1), py(y1));
    ctx.lineTo(px(x2), py(y2));
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, C.MAX_PIXEL_RATIO);
    const r = canvas.parentElement.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  function render(world) {
    const worldW = C.FIELD_LENGTH_M + 2 * C.MAP_MARGIN_X_M;
    const worldH = C.FIELD_WIDTH_M + 2 * C.MAP_MARGIN_Y_M;
    const scale = Math.min(w / worldW, h / worldH);
    const ox = (w - worldW * scale) / 2 + C.MAP_MARGIN_X_M * scale;
    const oy = (h - worldH * scale) / 2 + C.MAP_MARGIN_Y_M * scale;
    const px = (x) => ox + x * scale;
    const py = (y) => oy + y * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.COLOR_OUTSIDE;
    ctx.fillRect(0, 0, w, h);

    // hangars
    for (const owner of [0, 1]) {
      const x0 = owner === 0 ? -C.HANGAR_DEPTH_M : C.FIELD_LENGTH_M;
      ctx.fillStyle = C.COLOR_HANGAR_FLOOR;
      ctx.fillRect(px(x0), py(C.GATE_CENTER_Y_M - C.HANGAR_HALF_WIDTH_M), C.HANGAR_DEPTH_M * scale, 2 * C.HANGAR_HALF_WIDTH_M * scale);
    }

    // field
    ctx.fillStyle = C.COLOR_FIELD;
    ctx.fillRect(px(0), py(0), C.FIELD_LENGTH_M * scale, C.FIELD_WIDTH_M * scale);

    // border (with gates as gaps)
    ctx.strokeStyle = C.COLOR_BORDER;
    ctx.lineWidth = C.MAP_BORDER_LINE_PX;
    const g0 = C.GATE_CENTER_Y_M - C.GATE_WIDTH_M / 2;
    const g1 = C.GATE_CENTER_Y_M + C.GATE_WIDTH_M / 2;
    ctx.beginPath();
    ctx.moveTo(px(0), py(g0));
    ctx.lineTo(px(0), py(0));
    ctx.lineTo(px(C.FIELD_LENGTH_M), py(0));
    ctx.lineTo(px(C.FIELD_LENGTH_M), py(g0));
    ctx.moveTo(px(0), py(g1));
    ctx.lineTo(px(0), py(C.FIELD_WIDTH_M));
    ctx.lineTo(px(C.FIELD_LENGTH_M), py(C.FIELD_WIDTH_M));
    ctx.lineTo(px(C.FIELD_LENGTH_M), py(g1));
    ctx.stroke();
    // gate doors: two sliding panels; the closed remainder sits at the edges of the gap
    [0, 1].forEach((o) => {
      const open = world.gates ? world.gates[o].open : 0;
      const closedLen = ((1 - open) * C.GATE_WIDTH_M) / 2;
      if (closedLen <= 0.01) return;
      ctx.strokeStyle = TEAM[o].sel;
      ctx.beginPath();
      ctx.moveTo(px(gateX(o)), py(g0));
      ctx.lineTo(px(gateX(o)), py(g0 + closedLen));
      ctx.moveTo(px(gateX(o)), py(g1 - closedLen));
      ctx.lineTo(px(gateX(o)), py(g1));
      ctx.stroke();
    });
    // windows
    ctx.lineWidth = C.MAP_WINDOW_LINE_PX;
    for (const owner of [0, 1]) {
      const pl = world.players[owner];
      for (const idx of [0, 1]) {
        const active = pl.view === 'window' && pl.windowIdx === idx;
        ctx.strokeStyle = active ? C.COLOR_WINDOW_ACTIVE : C.COLOR_WINDOW;
        const wy = windowY(owner, idx);
        ctx.beginPath();
        ctx.moveTo(px(gateX(owner)), py(wy - C.WINDOW_LENGTH_M / 2));
        ctx.lineTo(px(gateX(owner)), py(wy + C.WINDOW_LENGTH_M / 2));
        ctx.stroke();
      }
    }

    // pits (water ditches)
    if (world.pits) {
      for (const p of world.pits) {
        ctx.save();
        ctx.translate(px(p.x), py(p.y));
        ctx.rotate(p.h);
        const pl = p.l * scale;
        const pw = p.w * scale;
        const rim = Math.max(1, 0.6 * scale);
        ctx.fillStyle = C.COLOR_PIT_RIM;
        ctx.fillRect(-pl / 2 - rim, -pw / 2 - rim, pl + rim * 2, pw + rim * 2);
        ctx.fillStyle = C.COLOR_PIT_WATER;
        ctx.fillRect(-pl / 2, -pw / 2, pl, pw);
        // Water ripples
        ctx.strokeStyle = '#bbfaff';
        ctx.lineWidth = Math.max(1, 0.25 * scale);
        ctx.beginPath();
        ctx.moveTo(-pl * 0.28, -pw * 0.2);
        ctx.lineTo(pl * 0.28, -pw * 0.2);
        ctx.moveTo(-pl * 0.2, pw * 0.2);
        ctx.lineTo(pl * 0.2, pw * 0.2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // obstacles (houses/buildings)
    if (world.obstacles) {
      for (const ob of world.obstacles) {
        ctx.save();
        ctx.translate(px(ob.x), py(ob.y));
        ctx.rotate(ob.h);
        const obl = ob.l * scale;
        const obw = ob.w * scale;
        // Wall base with house-specific bright gray/brown shade
        ctx.fillStyle = C.getObstacleWallColor(ob.id);
        ctx.fillRect(-obl / 2, -obw / 2, obl, obw);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = Math.max(1, 0.25 * scale);
        ctx.strokeRect(-obl / 2, -obw / 2, obl, obw);

        // Hipped / conical barrack roof
        const margin = Math.max(1.5, 0.4 * scale);
        const rbl = obl / 2 - margin;
        const rbw = obw / 2 - margin;
        const rl = Math.max(0, (rbl - rbw) * 0.45);

        ctx.fillStyle = C.COLOR_OBSTACLE_ROOF;
        ctx.fillRect(-rbl, -rbw, rbl * 2, rbw * 2);

        // Conical / hipped roof ridge and hip slope lines
        ctx.strokeStyle = C.COLOR_OBSTACLE_ROOF_RIDGE;
        ctx.lineWidth = Math.max(1, 0.3 * scale);
        ctx.beginPath();
        // Central ridge line
        ctx.moveTo(-rl, 0);
        ctx.lineTo(rl, 0);
        // Hip slope lines from ridge ends to the 4 roof corners
        ctx.lineTo(rbl, -rbw);
        ctx.moveTo(rl, 0);
        ctx.lineTo(rbl, rbw);
        ctx.moveTo(-rl, 0);
        ctx.lineTo(-rbl, -rbw);
        ctx.moveTo(-rl, 0);
        ctx.lineTo(-rbl, rbw);
        ctx.stroke();

        // Window dots on facades
        ctx.fillStyle = C.COLOR_OBSTACLE_WINDOW;
        const winW = Math.max(1.5, 0.22 * scale);
        ctx.fillRect(-obl * 0.35, -obw / 2, winW, winW * 1.6);
        ctx.fillRect(0, -obw / 2, winW, winW * 1.6);
        ctx.fillRect(obl * 0.35 - winW, -obw / 2, winW, winW * 1.6);
        ctx.fillRect(-obl * 0.35, obw / 2 - winW * 1.6, winW, winW * 1.6);
        ctx.fillRect(0, obw / 2 - winW * 1.6, winW, winW * 1.6);
        ctx.fillRect(obl * 0.35 - winW, obw / 2 - winW * 1.6, winW, winW * 1.6);
        ctx.restore();
      }
    }

    // mines
    for (const m of world.mines) {
      ctx.fillStyle = m.armT > 0 ? C.COLOR_MINE_UNARMED : C.COLOR_MINE_ARMED;
      ctx.beginPath();
      ctx.arc(px(m.x), py(m.y), Math.max(2, C.MINE_RADIUS_M * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // tanks selection lookup
    const selIds = world.players.map((pl) => {
      const t = world.tanks.find((x) => x.owner === pl.id && x.number === pl.selected && x.status !== 'dead');
      return t ? t.id : -1;
    });

    // debug aiming vectors (debugVectors=Y)
    if (debugVectors) {
      const muzzleDist = C.TANK_LENGTH_M / 2 + C.SHELL_MUZZLE_OFFSET_M;
      for (const t of world.tanks) {
        if (t.status !== 'field') continue;
        const selected = t.id === selIds[t.owner] && world.players[t.owner].view === 'tank';
        const color = selected ? TEAM[t.owner].sel : TEAM[t.owner].base;
        const startX = t.x + Math.cos(t.heading) * muzzleDist;
        const startY = t.y + Math.sin(t.heading) * muzzleDist;
        const endX = startX + Math.cos(t.heading) * C.DEBUG_VECTOR_LENGTH_M;
        const endY = startY + Math.sin(t.heading) * C.DEBUG_VECTOR_LENGTH_M;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = selected ? Math.max(1.8, 0.45 * scale) : Math.max(1.2, 0.35 * scale);
        ctx.lineCap = 'round';

        // Aiming vector line
        ctx.beginPath();
        ctx.moveTo(px(startX), py(startY));
        ctx.lineTo(px(endX), py(endY));
        ctx.stroke();

        // Terminal range indicator (circle at max ammo flight range)
        ctx.beginPath();
        ctx.arc(px(endX), py(endY), selected ? Math.max(3, 0.75 * scale) : Math.max(2, 0.55 * scale), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // Slit gun aiming vectors for both windows (0 and 1) for both players (0 and 1)
      for (const owner of [0, 1]) {
        const pl = world.players[owner];
        if (!pl) continue;
        const yaws = pl.windowYaws || [0, 0];
        const gx = gateX(owner);

        for (let idx = 0; idx < 2; idx++) {
          const isActive = pl.view === 'window' && pl.windowIdx === idx;
          const yaw = isActive ? pl.windowYaw : (yaws[idx] || 0);
          const heading = baseHeading(owner) + yaw;
          const color = isActive ? TEAM[owner].sel : TEAM[owner].base;
          const startX = gx;
          const startY = windowY(owner, idx);
          const endX = startX + Math.cos(heading) * C.DEBUG_VECTOR_LENGTH_M;
          const endY = startY + Math.sin(heading) * C.DEBUG_VECTOR_LENGTH_M;

          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = isActive ? Math.max(1.8, 0.45 * scale) : Math.max(1.2, 0.35 * scale);
          ctx.lineCap = 'round';

          // Slit gun aiming vector line
          ctx.beginPath();
          ctx.moveTo(px(startX), py(startY));
          ctx.lineTo(px(endX), py(endY));
          ctx.stroke();

          // Terminal range indicator
          ctx.beginPath();
          ctx.arc(px(endX), py(endY), isActive ? Math.max(3, 0.75 * scale) : Math.max(2, 0.55 * scale), 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      }
    }

    // Locked target arrows (max 2 arrows on the map: Red -> Blue, Blue -> Red)
    for (const owner of [0, 1]) {
      const pl = world.players[owner];
      if (!pl || !pl.lockedTarget) continue;

      const targetTank = world.tanks.find((t) => t.id === pl.lockedTarget.id && t.status === 'field');
      if (!targetTank) continue;

      let startX = null;
      let startY = null;
      if (pl.view === 'window') {
        startX = gateX(owner);
        startY = windowY(owner, pl.windowIdx);
      } else if (pl.view === 'tank') {
        const tank = selectedTank(world, owner);
        if (tank && tank.status === 'field') {
          startX = tank.x;
          startY = tank.y;
        }
      }

      if (startX != null && startY != null) {
        drawTargetArrow(ctx, startX, startY, targetTank.x, targetTank.y, owner, scale, px, py);
      }
    }

    // tanks
    for (const t of world.tanks) {
      if (t.status === 'dead') continue;
      const selected = t.id === selIds[t.owner] && world.players[t.owner].view === 'tank';
      const tl = C.TANK_LENGTH_M * scale;
      const tw = C.TANK_WIDTH_M * scale;
      const hl = tl / 2;
      const hw = tw / 2;
      const cf = C.TANK_CHAMFER_M * scale;
      const tx = C.TURRET_OFFSET_M * scale;
      const tr = C.TURRET_RADIUS_M * scale;

      ctx.save();
      ctx.translate(px(t.x), py(t.y));
      ctx.rotate(t.heading);

      // Faceted body: 8 corners (chamfered corners from top view)
      ctx.beginPath();
      ctx.moveTo(hl, -hw + cf);
      ctx.lineTo(hl - cf, -hw);
      ctx.lineTo(-hl + cf, -hw);
      ctx.lineTo(-hl, -hw + cf);
      ctx.lineTo(-hl, hw - cf);
      ctx.lineTo(-hl + cf, hw);
      ctx.lineTo(hl - cf, hw);
      ctx.lineTo(hl, hw - cf);
      ctx.closePath();
      ctx.fillStyle = selected ? TEAM[t.owner].sel : TEAM[t.owner].base;
      ctx.fill();

      // Gun barrel: shorter gun extending only slightly past the hull nose
      const barrelStart = tx + tr * 0.4;
      const barrelEnd = hl + 0.2 * scale;
      const barrelWidth = Math.max(2, 0.36 * scale);
      ctx.fillStyle = C.COLOR_TANK_DETAIL;
      ctx.fillRect(barrelStart, -barrelWidth / 2, barrelEnd - barrelStart, barrelWidth);

      // Octagonal turret seen from above
      ctx.beginPath();
      for (let k = 0; k < C.TURRET_SIDES; k++) {
        const a = (k * 2 * Math.PI) / C.TURRET_SIDES;
        const vx = tx + Math.cos(a) * tr;
        const vy = Math.sin(a) * tr;
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = t.owner === 0 ? C.COLOR_LEFT_TURRET : C.COLOR_RIGHT_TURRET;
      ctx.fill();
      ctx.lineWidth = C.MAP_TURRET_STROKE_PX;
      ctx.strokeStyle = C.COLOR_TANK_DETAIL;
      ctx.stroke();

      // Digit inside octagonal head: upright, pure analytical vector strokes (zero shimmering/waving)
      if (t.number != null) {
        ctx.save();
        ctx.translate(tx, 0);
        ctx.rotate(-t.heading); // Un-rotate to stay upright
        drawTacticalDigit(ctx, t.number, tr, scale);
        ctx.restore();
      }

      ctx.restore();
    }

    // shells
    ctx.fillStyle = C.COLOR_SHELL;
    for (const s of world.shells) {
      ctx.beginPath();
      ctx.arc(px(s.x), py(s.y), Math.max(C.MAP_SHELL_MIN_RADIUS_PX, C.SHELL_RADIUS_M * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // smoke (above tanks: hides them)
    for (const s of world.smokes) {
      const remaining = C.SMOKE_LIFETIME_S - s.t;
      const a = Math.min(1, remaining / C.SMOKE_FADE_S) * C.MAP_SMOKE_MAX_ALPHA;
      ctx.globalAlpha = a;
      ctx.fillStyle = C.COLOR_SMOKE;
      ctx.beginPath();
      ctx.arc(px(s.x), py(s.y), C.SMOKE_RADIUS_M * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // explosions
    for (const e of world.explosions) {
      const k = e.t / C.EXPLOSION_DURATION_S;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = C.COLOR_EXPLOSION;
      ctx.beginPath();
      ctx.arc(px(e.x), py(e.y), (e.big ? C.MINE_EXPLOSION_RADIUS_M : C.EXPLOSION_RADIUS_M) * scale * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { resize, render };
}

export { slotPos };
