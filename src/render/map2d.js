import * as C from '../constants.js';
import { gateX, windowY, slotPos } from '../sim/world.js';

const TEAM = [
  { base: C.COLOR_LEFT_TEAM, sel: C.COLOR_LEFT_SELECTED },
  { base: C.COLOR_RIGHT_TEAM, sel: C.COLOR_RIGHT_SELECTED },
];

export function createMap2D(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dpr = 1;

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
    // gate markers
    [0, 1].forEach((o) => {
      ctx.strokeStyle = TEAM[o].sel;
      ctx.beginPath();
      ctx.moveTo(px(gateX(o)), py(g0));
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

    // mines
    for (const m of world.mines) {
      ctx.fillStyle = m.armT > 0 ? C.COLOR_MINE_UNARMED : C.COLOR_MINE_ARMED;
      ctx.beginPath();
      ctx.arc(px(m.x), py(m.y), Math.max(2, C.MINE_RADIUS_M * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // tanks
    const selIds = world.players.map((pl) => {
      const t = world.tanks.find((x) => x.owner === pl.id && x.number === pl.selected && x.status !== 'dead');
      return t ? t.id : -1;
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of world.tanks) {
      if (t.status === 'dead') continue;
      const selected = t.id === selIds[t.owner] && world.players[t.owner].view === 'tank';
      const tl = C.TANK_LENGTH_M * scale;
      const tw = C.TANK_WIDTH_M * scale;
      ctx.save();
      ctx.translate(px(t.x), py(t.y));
      ctx.rotate(t.heading);
      ctx.fillStyle = selected ? TEAM[t.owner].sel : TEAM[t.owner].base;
      ctx.fillRect(-tl / 2, -tw / 2, tl, tw);
      ctx.fillStyle = C.COLOR_TANK_DETAIL;
      ctx.fillRect(tl / 2 - 1, -1, tl * 0.35, 2);
      ctx.restore();
      if (t.number != null) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(tw * C.MAP_DIGIT_SCALE)}px "Share Tech Mono", monospace`;
        ctx.fillText(t.number, px(t.x), py(t.y) + 1);
      }
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
