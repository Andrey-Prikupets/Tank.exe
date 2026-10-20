import * as C from '../constants.js';
import { selectedTank, hangarCount } from '../sim/world.js';

function shellSvg(active) {
  const cls = active ? 'icon-shell on' : 'icon-shell off';
  return `<svg class="${cls}" viewBox="0 0 9 20" aria-hidden="true">
    <path d="M2 19 L7 19 L7 10 L6 5 C5.5 2.5 4.5 0.8 4.5 0.8 C4.5 0.8 3.5 2.5 3 5 L2 10 Z"/>
    <rect x="1.5" y="17.5" width="6" height="1.8" rx="0.4"/>
  </svg>`;
}

function mineSvg(active) {
  const cls = active ? 'icon-mine on' : 'icon-mine off';
  return `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">
    <!-- Anti-tank carry handle loop -->
    <path d="M8 1.4 Q10 0.4 12 1.4" stroke="currentColor" stroke-width="1.2" fill="none"/>
    <!-- Outer heavy casing rim -->
    <circle cx="10" cy="10" r="8.8" fill="#141d16" stroke="currentColor" stroke-width="1.2"/>
    <!-- Stepped casing bevel -->
    <circle cx="10" cy="10" r="7.2" fill="#202c22"/>
    <!-- Concentric pressure plate -->
    <circle cx="10" cy="10" r="5.4" fill="currentColor"/>
    <circle cx="10" cy="10" r="3.8" fill="#152017"/>
    <!-- Central arming fuze cap -->
    <circle cx="10" cy="10" r="2.3" fill="#ffd54a"/>
    <line x1="8.8" y1="10" x2="11.2" y2="10" stroke="#111" stroke-width="0.8"/>
  </svg>`;
}

function smokeSvg(active) {
  const cls = active ? 'icon-smoke on' : 'icon-smoke off';
  return `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">
    <!-- Rounded symmetric cluster of smoke plumes -->
    <g fill="currentColor">
      <circle cx="10" cy="10" r="5.2"/>
      <circle cx="10" cy="5.8" r="3.5"/>
      <circle cx="13.6" cy="7.9" r="3.5"/>
      <circle cx="13.6" cy="12.1" r="3.5"/>
      <circle cx="10" cy="14.2" r="3.5"/>
      <circle cx="6.4" cy="12.1" r="3.5"/>
      <circle cx="6.4" cy="7.9" r="3.5"/>
    </g>
    <!-- Inner puffy billow lines -->
    <path d="M8.2 8.6 A2.4 2.4 0 0 1 11.8 8.6 M8.2 11.4 A2.4 2.4 0 0 0 11.8 11.4" stroke="#18241c" stroke-width="0.8" fill="none" opacity="0.65"/>
  </svg>`;
}

export function createHud() {
  const invPanels = [document.getElementById('inv0'), document.getElementById('inv1')];
  const panes = [document.getElementById('pane0'), document.getElementById('pane1')];
  const banners = [document.getElementById('banner0'), document.getElementById('banner1')];
  const debugEls = [document.getElementById('debug0'), document.getElementById('debug1')];
  let last = 0;

  function bannerText(world, p) {
    const pl = world.players[p];
    if (pl.msgT > 0) return pl.msg;
    const t = selectedTank(world, p);
    if (pl.view === 'window') return '';
    if (!t) {
      return p === 0 ? 'PRESS 1-5 TO SELECT TANK' : 'PRESS 6-0 TO SELECT TANK';
    }
    if (t.status === 'hangar') return pl.blocked ? 'GATE BLOCKED' : 'DEPLOYING…';
    return '';
  }

  function update(world, now, force) {
    for (const p of [0, 1]) {
      const pl = world.players[p];
      panes[p].classList.toggle('window', pl.view === 'window');
      const text = bannerText(world, p);
      banners[p].textContent = text;
      banners[p].classList.toggle('show', !!text);
    }
    if (!force && now - last < C.HUD_UPDATE_INTERVAL_MS) return;
    last = now;

    for (const p of [0, 1]) {
      const pl = world.players[p];
      const t = selectedTank(world, p);

      let shellCount = 0;
      let mineCount = 0;
      let smokeCount = 0;

      if (pl.view === 'window') {
        shellCount = pl.windowReload <= 0 ? C.TANK_START_SHELLS : 0;
        mineCount = 0;
        smokeCount = 0;
      } else if (t && t.status === 'field') {
        shellCount = t.shells;
        mineCount = t.mines;
        smokeCount = t.smokes;
      }

      const shellsHtml = Array.from({ length: C.TANK_START_SHELLS }, (_, i) => shellSvg(i < shellCount)).join('');
      const minesHtml = Array.from({ length: C.TANK_START_MINES }, (_, i) => mineSvg(i < mineCount)).join('');
      const smokesHtml = Array.from({ length: C.TANK_START_SMOKES }, (_, i) => smokeSvg(i < smokeCount)).join('');

      // 2-row inventory: row 1 ammo shells, row 2 mines + smoke clouds
      invPanels[p].innerHTML = `
        <div class="inv-row shells">${shellsHtml}</div>
        <div class="inv-row secondary">
          <div class="inv-group mines">${minesHtml}</div>
          <div class="inv-divider"></div>
          <div class="inv-group smokes">${smokesHtml}</div>
        </div>
      `;

      if (debugEls[p]) {
        const sp = t && t.status === 'field' ? Math.round(C.msToKmh(t.speed)) : 0;
        const trn = t && t.status === 'field' ? Math.round(C.radToDeg(t.turn)) : 0;
        const res = hangarCount(world, p);
        if (p === 0) {
          debugEls[0].textContent = `[DEBUG] P1: ${sp} km/h · ${trn}°/s · RESERVES: ${res} · LOST: ${pl.lost}/15`;
        } else {
          debugEls[1].textContent = `[DEBUG] P2: ${sp} km/h · ${trn}°/s · RESERVES: ${res} · LOST: ${pl.lost}/15`;
        }
      }
    }
  }

  return { update };
}
