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
    <!-- Isometric drop shadow under base -->
    <ellipse cx="10" cy="14" rx="8.5" ry="3.8" fill="#080e0a" opacity="0.6"/>
    <!-- Outer cylindrical casing wall -->
    <path d="M1.5 10 C1.5 13.8 18.5 13.8 18.5 10 L18.5 13.2 C18.5 17 1.5 17 1.5 13.2 Z" fill="#1b241c" stroke="currentColor" stroke-width="0.8"/>
    <!-- Top rim of main casing -->
    <ellipse cx="10" cy="10" rx="8.5" ry="3.8" fill="#243327" stroke="currentColor" stroke-width="0.9"/>
    <!-- Stepped inner bevel -->
    <ellipse cx="10" cy="9.5" rx="6.8" ry="3.0" fill="#152017"/>
    <!-- Raised pressure plate wall -->
    <path d="M4.6 8.2 C4.6 10.8 15.4 10.8 15.4 8.2 L15.4 9.1 C15.4 11.7 4.6 11.7 4.6 9.1 Z" fill="#1c2b20"/>
    <!-- Raised pressure plate top -->
    <ellipse cx="10" cy="8.2" rx="5.4" ry="2.4" fill="currentColor"/>
    <!-- Central arming fuze well -->
    <ellipse cx="10" cy="8.0" rx="2.8" ry="1.3" fill="#141e16"/>
    <ellipse cx="10" cy="7.7" rx="1.8" ry="0.8" fill="#ffd54a"/>
    <!-- Side carrying bracket/handle in isometry -->
    <path d="M2.2 10 C1.2 8.5 2.5 6.8 4.2 7.2" stroke="currentColor" stroke-width="1.1" fill="none"/>
  </svg>`;
}

function smokeSvg(active) {
  const cls = active ? 'icon-smoke on' : 'icon-smoke off';
  return `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true">
    <!-- Non-symmetric organic cloud silhouette embedded in a square -->
    <path d="M4.5 14.8
             C2.2 14.8 1.2 12.8 2.0 10.8
             C2.5 9.4 3.8 8.6 5.2 8.7
             C5.6 6.2 7.6 4.2 10.2 4.3
             C12.4 4.4 14.2 5.8 14.8 7.8
             C16.8 7.8 18.5 9.4 18.5 11.4
             C18.5 13.5 16.9 15.1 14.8 15.0
             C13.8 15.7 12.4 16.0 11.0 15.8
             C9.5 16.2 7.8 16.0 6.6 15.2
             Z"
          fill="currentColor"/>
    <!-- Internal non-symmetric billowing shading highlights -->
    <path d="M4.2 10.4 C4.8 8.2 7.2 7.5 9.4 7.8" stroke="#16221a" stroke-width="0.8" fill="none" opacity="0.45"/>
    <path d="M10.8 6.5 C13.2 6.8 14.8 8.8 14.6 11.2" stroke="#16221a" stroke-width="0.8" fill="none" opacity="0.45"/>
    <path d="M7.5 14.5 C9.0 13.2 12.2 13.5 13.8 14.8" stroke="#16221a" stroke-width="0.8" fill="none" opacity="0.4"/>
  </svg>`;
}

export function createHud() {
  const invPanels = [document.getElementById('inv0'), document.getElementById('inv1')];
  const panes = [document.getElementById('pane0'), document.getElementById('pane1')];
  const banners = [document.getElementById('banner0'), document.getElementById('banner1')];
  let last = 0;

  // Initialize inventory DOM once
  const shellSvgs = [[], []];
  const mineSvgs = [[], []];
  const smokeSvgs = [[], []];
  const lastCounts = [{ shells: -1, mines: -1, smokes: -1 }, { shells: -1, mines: -1, smokes: -1 }];
  const lastBanners = ['', ''];
  const lastIsWin = [false, false];

  for (const p of [0, 1]) {
    const shellsHtml = Array.from({ length: C.TANK_START_SHELLS }, () => shellSvg(false)).join('');
    const minesHtml = Array.from({ length: C.TANK_START_MINES }, () => mineSvg(false)).join('');
    const smokesHtml = Array.from({ length: C.TANK_START_SMOKES }, () => smokeSvg(false)).join('');

    invPanels[p].innerHTML = `
      <div class="inv-row shells">${shellsHtml}</div>
      <div class="inv-row secondary">
        <div class="inv-group mines">${minesHtml}</div>
        <div class="inv-divider"></div>
        <div class="inv-group smokes">${smokesHtml}</div>
      </div>
    `;

    shellSvgs[p] = Array.from(invPanels[p].querySelectorAll('.icon-shell'));
    mineSvgs[p] = Array.from(invPanels[p].querySelectorAll('.icon-mine'));
    smokeSvgs[p] = Array.from(invPanels[p].querySelectorAll('.icon-smoke'));
  }

  function bannerText(world, p) {
    const pl = world.players[p];
    if (pl.msgT > 0) return pl.msg;
    const t = selectedTank(world, p);
    if (pl.view === 'window') return '';
    if (!t) {
      if (world.isAiPlayer && world.isAiPlayer(p)) return 'COMPUTER';
      return 'SELECT TANK';
    }
    if (t.status === 'hangar') return pl.blocked ? 'GATE BLOCKED' : 'DEPLOYING…';
    return '';
  }

  function updateIcons(elements, count, prevCount) {
    if (count === prevCount) return;
    for (let i = 0; i < elements.length; i++) {
      const on = i < count;
      elements[i].classList.toggle('on', on);
      elements[i].classList.toggle('off', !on);
    }
  }

  function update(world, now, force) {
    for (const p of [0, 1]) {
      const pl = world.players[p];
      const isWin = pl.view === 'window';
      if (isWin !== lastIsWin[p] || force) {
        panes[p].classList.toggle('window', isWin);
        invPanels[p].style.display = isWin ? 'none' : '';
        lastIsWin[p] = isWin;
      }
      const text = bannerText(world, p);
      if (text !== lastBanners[p] || force) {
        banners[p].textContent = text;
        banners[p].classList.toggle('show', !!text);
        lastBanners[p] = text;
      }
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

      const prev = lastCounts[p];
      if (force || prev.shells !== shellCount) {
        updateIcons(shellSvgs[p], shellCount, prev.shells);
        prev.shells = shellCount;
      }
      if (force || prev.mines !== mineCount) {
        updateIcons(mineSvgs[p], mineCount, prev.mines);
        prev.mines = mineCount;
      }
      if (force || prev.smokes !== smokeCount) {
        updateIcons(smokeSvgs[p], smokeCount, prev.smokes);
        prev.smokes = smokeCount;
      }
    }
  }

  return { update };
}
