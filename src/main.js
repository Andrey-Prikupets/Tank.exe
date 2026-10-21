import './style.css';
import * as C from './constants.js';
import { createWorld, applyAction, step, syncWorldTerrain } from './sim/world.js';
import { slotInfo, saveSlot, loadSlot } from './sim/save.js';
import { Input, keyLabel } from './input.js';
import { createMap2D } from './render/map2d.js';
import { createView3D } from './render/view3d.js';
import { createHud } from './render/hud.js';
import { createMenu } from './ui/menu.js';
import { createKeyboardScreen } from './ui/keyboard_screen.js';
import { Sfx } from './audio/sfx.js';
import { AiController } from './sim/ai.js';
import historyRu from './history/history_ru.html?raw';
import historyEn from './history/history_en.html?raw';
import historyEs from './history/history_es.html?raw';

const HISTORY_DOCS = {
  ru: historyRu,
  en: historyEn,
  es: historyEs,
};

const HISTORY_TITLES = {
  en: 'HISTORY — TANK.EXE',
  es: 'HISTORIA — TANK.EXE',
  ru: 'ИСТОРИЯ — TANK.EXE',
};

const HISTORY_BACK_LABELS = {
  en: 'Back (Esc)',
  es: 'Volver (Esc)',
  ru: 'Назад (Esc)',
};

function getInitialHistoryLang() {
  try {
    const saved = localStorage.getItem('tank_history_lang');
    if (saved && HISTORY_DOCS[saved]) return saved;
  } catch {}
  const navLang = (navigator.language || (navigator.languages && navigator.languages[0]) || '').toLowerCase();
  if (navLang.startsWith('ru') || navLang.startsWith('be') || navLang.startsWith('uk')) return 'ru';
  if (navLang.startsWith('es')) return 'es';
  return 'en';
}

let historyLang = getInitialHistoryLang();

document.documentElement.style.setProperty('--mask-h', `${C.WINDOW_MASK_PERCENT}%`);

const aiControllers = [new AiController(0), new AiController(1)];
const input = new Input();
const sfx = new Sfx();

let playerModeIndex = 0;
const savedMode = localStorage.getItem(C.PLAYERS_SETTINGS_KEY);
if (savedMode) {
  const idx = C.PLAYER_MODES.findIndex((m) => m.id === savedMode);
  if (idx >= 0) playerModeIndex = idx;
}
const currentMode = () => C.PLAYER_MODES[playerModeIndex];

let aiLevelIndex = 1; // Default 'MEDIUM' (C.AI_LEVELS = ['HARD', 'MEDIUM', 'EASY'])
const savedLevel = localStorage.getItem(C.AI_LEVEL_SETTINGS_KEY);
if (savedLevel) {
  const idx = C.AI_LEVELS.indexOf(savedLevel);
  if (idx >= 0) aiLevelIndex = idx;
}
const currentAiLevel = () => C.AI_LEVELS[aiLevelIndex];

function isAiPlayer(p) {
  const mode = currentMode();
  return p === 0 ? mode.leftAi : mode.rightAi;
}

let savedObstacles = false;
try {
  const val = localStorage.getItem(C.OBSTACLES_SETTINGS_KEY);
  if (val !== null) savedObstacles = JSON.parse(val);
} catch {}

let savedPits = false;
try {
  const val = localStorage.getItem(C.PITS_SETTINGS_KEY);
  if (val !== null) savedPits = JSON.parse(val);
} catch {}

const options = {
  obstacles: savedObstacles,
  pits: savedPits,
};

// URL query string parameters for startup overrides
const urlParams = new URLSearchParams(window.location.search);

const modeParam = urlParams.get('mode') || urlParams.get('players');
if (modeParam) {
  const clean = modeParam.trim().toLowerCase().replace(/[\s-_]+/g, '');
  const idx = C.PLAYER_MODES.findIndex(
    (m) => m.id.toLowerCase() === clean || m.label.toLowerCase().replace(/[\s-_]+/g, '') === clean
  );
  if (idx >= 0) playerModeIndex = idx;
}

const levelParam = urlParams.get('level') || urlParams.get('ai');
if (levelParam) {
  const clean = levelParam.trim().toUpperCase();
  const idx = C.AI_LEVELS.indexOf(clean);
  if (idx >= 0) aiLevelIndex = idx;
}

const soundParam = urlParams.get('sound') || urlParams.get('audio');
if (soundParam !== null) {
  const on = !['0', 'false', 'off', 'no'].includes(soundParam.trim().toLowerCase());
  sfx.setEnabled(on);
}

const obstaclesParam = urlParams.get('obstacles');
if (obstaclesParam !== null) {
  options.obstacles = !['0', 'false', 'off', 'no'].includes(obstaclesParam.trim().toLowerCase());
}

const pitsParam = urlParams.get('pits');
if (pitsParam !== null) {
  options.pits = !['0', 'false', 'off', 'no'].includes(pitsParam.trim().toLowerCase());
}

const langParam = urlParams.get('lang');
if (langParam && HISTORY_DOCS[langParam.trim().toLowerCase()]) {
  historyLang = langParam.trim().toLowerCase();
}

const startVal = urlParams.get('start') || urlParams.get('autostart') || urlParams.get('play');
const autoStart =
  (urlParams.has('start') || urlParams.has('autostart') || urlParams.has('play')) &&
  !['0', 'false', 'no'].includes(String(startVal).trim().toLowerCase());

let world = createWorld(options);
world.isAiPlayer = isAiPlayer;
let appState = 'TITLE'; // 'TITLE' | 'PLAYING'
let gameOverShown = false;

const menu = createMenu(document.getElementById('menu'));
const kbScreen = createKeyboardScreen(document.getElementById('keyboardScreen'));
const map = createMap2D(document.getElementById('map'));
const view = createView3D(document.getElementById('gl'));
const hud = createHud();

// ---------------------------------------------------------------- screens ---
const playersItem = () => ({
  label: () => `Players: ${currentMode().label}`,
  action: () => {
    playerModeIndex = (playerModeIndex + 1) % C.PLAYER_MODES.length;
    localStorage.setItem(C.PLAYERS_SETTINGS_KEY, currentMode().id);
    aiControllers.forEach((c) => c.reset());
  },
});

const levelItem = () => ({
  label: () => `Level: ${currentAiLevel()}`,
  action: () => {
    aiLevelIndex = (aiLevelIndex + 1) % C.AI_LEVELS.length;
    localStorage.setItem(C.AI_LEVEL_SETTINGS_KEY, currentAiLevel());
  },
});

const soundItem = () => ({
  label: () => `Sound: ${sfx.enabled ? 'ON' : 'OFF'}`,
  action: () => {
    sfx.resume();
    sfx.toggle();
  },
});

const obstaclesItem = () => ({
  label: () => `Obstacles: ${options.obstacles ? 'ON' : 'OFF'}`,
  action: () => {
    options.obstacles = !options.obstacles;
    localStorage.setItem(C.OBSTACLES_SETTINGS_KEY, JSON.stringify(options.obstacles));
    syncWorldTerrain(world, options);
  },
});

const pitsItem = () => ({
  label: () => `Pits: ${options.pits ? 'ON' : 'OFF'}`,
  action: () => {
    options.pits = !options.pits;
    localStorage.setItem(C.PITS_SETTINGS_KEY, JSON.stringify(options.pits));
    syncWorldTerrain(world, options);
  },
});

function optionsScreen() {
  return {
    title: 'OPTIONS',
    text: '<div class="center">Game & Audio Settings</div>',
    items: () => [
      soundItem(),
      obstaclesItem(),
      pitsItem(),
      {
        label: 'KEYBOARD LAYOUT',
        action: () => {
          document.getElementById('menu').classList.add('hidden');
          kbScreen.open({
            getKeys: () => input.getKeys(),
            onSave: (k) => {
              input.setKeys(k);
            },
            onClose: () => {
              document.getElementById('menu').classList.remove('hidden');
              menu.refresh();
            },
          });
        },
      },
      { label: 'Back', action: () => menu.pop() },
    ],
    onEsc: () => menu.pop(),
  };
}

function helpScreen() {
  const k = input.getKeys();
  const fmtKey = (val) => [].concat(val || []).map(keyLabel).join(' / ') || '—';
  const leftSel = (k.LEFT.SELECT || []).map(keyLabel).join(', ');
  const rightSel = (k.RIGHT.SELECT || []).map(keyLabel).join(', ');
  const rows = [
    ['Select tank', leftSel, rightSel],
    ['Accelerate', fmtKey(k.LEFT.FORWARD), fmtKey(k.RIGHT.FORWARD)],
    ['Decelerate / reverse', fmtKey(k.LEFT.BACK), fmtKey(k.RIGHT.BACK)],
    ['Turn left', fmtKey(k.LEFT.TURN_L), fmtKey(k.RIGHT.TURN_L)],
    ['Turn right', fmtKey(k.LEFT.TURN_R), fmtKey(k.RIGHT.TURN_R)],
    ['Left window', fmtKey(k.LEFT.WIN_L), fmtKey(k.RIGHT.WIN_L)],
    ['Right window', fmtKey(k.LEFT.WIN_R), fmtKey(k.RIGHT.WIN_R)],
    ['Fire', fmtKey(k.LEFT.FIRE), fmtKey(k.RIGHT.FIRE)],
    ['Drop mine', fmtKey(k.LEFT.MINE), fmtKey(k.RIGHT.MINE)],
    ['Smoke cloud', fmtKey(k.LEFT.SMOKE), fmtKey(k.RIGHT.SMOKE)],
  ];
  const tableRows = rows
    .map(([name, k1, k2]) => `<tr><td><strong>${name}</strong></td><td>${k1}</td><td>${k2}</td></tr>`)
    .join('');

  const html = `
    <h3>1. CONCEPT & LORE</h3>
    <p><strong>Tank.exe</strong> pays homage to early 1990s PC DOS split-screen 3D vehicular combat simulations. Two commanders share a single keyboard to lead opposing tank battalions across a 250m × 100m tactical arena.</p>

    <h3>2. INITIAL STATUS & FORCES</h3>
    <p>Each army commands 15 tanks total: 5 active units deployed in line formation on the field and 10 reserves waiting in the hangar. Tanks on both sides display numbers <strong>1 to 5</strong>.</p>
    <p><strong>Zero Auto-Movement:</strong> Tanks never move on their own. They start stationary at 0 km/h and only accelerate or steer upon your direct key commands.</p>

    <h3>3. CONTROLS TABLE</h3>
    <table>
      <tr><th>ACTION</th><th>RED (Left Player)</th><th>BLUE (Right Player)</th></tr>
      ${tableRows}
      <tr><td>Pause / Menu</td><td colspan="2">Esc (shared)</td></tr>
    </table>

    <h3>4. INERTIA & MULTI-TANK ARCS</h3>
    <p>Tanks possess authentic mass inertia. Accelerating or turning commands a speed/turn rate that the tank preserves. You can initiate an arcing maneuver on Tank 1, switch instantly to Tank 2 to push forward, and advance multiple units in coordinated multi-tank assaults!</p>

    <h3>5. ARSENAL & DEFENSE</h3>
    <p>• <strong>Shells (5):</strong> High-velocity artillery round. Passes through smoke. Lethal on impact to friend or foe.<br>
       • <strong>Mines (2):</strong> Deployed behind your tank. Arms after 1.5 seconds. Remains indefinitely until triggered.<br>
       • <strong>Smoke (2):</strong> Deploys a dense 10-second thermal cloud blocking 3D line-of-sight and obscuring tanks from radar.</p>

    <h3>6. BASE HANGARS & WINDOWS</h3>
    <p>• <strong>Rearming:</strong> Drive any of your surviving tanks through your home gate into a free hangar slot to fully replenish ammo, mines, and smoke.<br>
       • <strong>Gate Defense:</strong> Hangar slit windows allow defensive surveillance and firing with unlimited ammo to protect against enemy assaults.<br>
       • <strong>Gate Blockade:</strong> A tank standing in front of an opponent's gate blocks reserve deployments!</p>

    <h3>7. VICTORY CONDITIONS</h3>
    <p>Destroy all 15 enemy tanks to win the war.</p>
  `;

  return {
    title: 'HELP — TANK.EXE MANUAL',
    text: html,
    scrollable: true,
    items: [{ label: 'Back (Esc)', action: () => menu.pop() }],
    onEsc: () => menu.pop(),
  };
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatInline(str) {
  return str
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function renderMarkup(content) {
  if (!content) return '';
  const trimmed = content.trim();
  if (/<(p|h[1-6]|div|table|ul|ol|section|article)[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (b.startsWith('### ')) return `<h3>${escapeHtml(b.slice(4))}</h3>`;
      if (b.startsWith('## ')) return `<h2>${escapeHtml(b.slice(3))}</h2>`;
      if (b.startsWith('# ')) return `<h1>${escapeHtml(b.slice(2))}</h1>`;
      if (b.startsWith('- ') || b.startsWith('* ')) {
        const items = b
          .split('\n')
          .map((l) => l.replace(/^[-*]\s+/, '').trim())
          .filter(Boolean)
          .map((item) => `<li>${formatInline(item)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${formatInline(b.replace(/\n/g, '<br>'))}</p>`;
    })
    .join('\n');
}

function historyScreen() {
  const s = {
    title: () => HISTORY_TITLES[historyLang] || HISTORY_TITLES.en,
    text: () => renderMarkup(HISTORY_DOCS[historyLang] || HISTORY_DOCS.en),
    scrollable: true,
    langSwitch: {
      get current() {
        return historyLang;
      },
      onChange: (lang) => {
        if (!HISTORY_DOCS[lang]) return;
        historyLang = lang;
        try {
          localStorage.setItem('tank_history_lang', lang);
        } catch {}
        menu.refresh();
      },
    },
    items: () => [{ label: HISTORY_BACK_LABELS[historyLang] || 'Back (Esc)', action: () => menu.pop() }],
    onEsc: () => menu.pop(),
  };
  return s;
}

const fmtSlot = (i) => {
  const info = slotInfo(i);
  return `Slot ${i + 1} — ${info ? new Date(info.savedAt).toLocaleString() : 'empty'}`;
};

function saveScreen() {
  const s = {
    title: 'SAVE GAME',
    text: '',
    items: [],
    onEsc: () => menu.pop(),
  };
  for (let i = 0; i < C.SAVE_SLOT_COUNT; i++) {
    s.items.push({
      label: () => fmtSlot(i),
      action: () => {
        saveSlot(i, world);
        s.text = `Saved to slot ${i + 1}`;
      },
    });
  }
  s.items.push({ label: 'Back', action: () => menu.pop() });
  return s;
}

function loadScreen() {
  const s = { title: 'LOAD GAME', text: '', items: [], onEsc: () => menu.pop() };
  for (let i = 0; i < C.SAVE_SLOT_COUNT; i++) {
    s.items.push({
      label: () => fmtSlot(i),
      action: () => {
        const r = loadSlot(i);
        if (r.error) {
          s.text = r.error;
          return;
        }
        world = r.world;
        world.isAiPlayer = isAiPlayer;
        aiControllers.forEach((c) => c.reset());
        appState = 'PLAYING';
        gameOverShown = world.over;
        input.clear();
        menu.clear();
        openPause();
      },
    });
  }
  s.items.push({ label: 'Back', action: () => menu.pop() });
  return s;
}

function confirmScreen(text, onYes) {
  return {
    title: 'ARE YOU SURE?',
    text,
    items: [
      { label: 'No', action: () => menu.pop() },
      { label: 'Yes', action: onYes },
    ],
    onEsc: () => menu.pop(),
  };
}

function newGame() {
  world = createWorld(options);
  world.isAiPlayer = isAiPlayer;
  aiControllers.forEach((c) => c.reset());
  appState = 'PLAYING';
  gameOverShown = false;
  input.clear();
  menu.clear();
  dirty = true;
  hud.update(world, performance.now(), true);
}

function openTitle() {
  appState = 'TITLE';
  menu.clear();
  dirty = true;
  menu.push({
    title: C.GAME_NAME,
    text: '<div class="center">Two players · one keyboard · 90s split-screen tank combat</div>',
    items: () => [
      { label: 'Start game', action: newGame },
      { label: 'Load game', action: () => menu.push(loadScreen()) },
      playersItem(),
      ...(currentMode().id !== 'HvH' ? [levelItem()] : []),
      { label: 'Options', action: () => menu.push(optionsScreen()) },
      { label: 'Help', action: () => menu.push(helpScreen()) },
      { label: 'History', action: () => menu.push(historyScreen()) },
    ],
    onEsc: null,
  });
}

function resume() {
  menu.clear();
  input.clear();
  dirty = true;
}

function openPause() {
  dirty = true;
  menu.push({
    title: C.GAME_NAME,
    text: '<div class="center">Game is paused</div>',
    items: () => [
      { label: 'Resume', action: resume },
      { label: 'Save game', action: () => menu.push(saveScreen()) },
      { label: 'Load game', action: () => menu.push(loadScreen()) },
      {
        label: 'New game',
        action: () => menu.push(confirmScreen('Current game will be lost.', newGame)),
      },
      playersItem(),
      ...(currentMode().id !== 'HvH' ? [levelItem()] : []),
      { label: 'Options', action: () => menu.push(optionsScreen()) },
      { label: 'Help', action: () => menu.push(helpScreen()) },
      { label: 'History', action: () => menu.push(historyScreen()) },
    ],
    onEsc: resume,
  });
}

function openGameOver() {
  const [a, b] = world.players;
  const winner = world.winner === 'draw' ? 'DRAW' : world.winner === 0 ? 'RED WINS' : 'BLUE WINS';
  const redAcc = a.shots ? Math.round((a.hits / a.shots) * 100) : 0;
  const blueAcc = b.shots ? Math.round((b.hits / b.shots) * 100) : 0;
  menu.clear();
  dirty = true;
  menu.push({
    title: winner,
    gameOver: true,
    winner: world.winner,
    hint: '← → / ↑ ↓ select  ·  Space / Enter confirm',
    text: `
      <div class="gameover-stats">
        <div class="stat-col red">
          <div class="stat-team">RED SQUADRON</div>
          <div class="stat-line"><span>Tanks Lost:</span><strong>${a.lost} / 15</strong></div>
          <div class="stat-line"><span>Shots Fired:</span><strong>${a.shots}</strong></div>
          <div class="stat-line"><span>Direct Hits:</span><strong>${a.hits}</strong></div>
          <div class="stat-line"><span>Accuracy:</span><strong>${redAcc}%</strong></div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-col blue">
          <div class="stat-team">BLUE SQUADRON</div>
          <div class="stat-line"><span>Tanks Lost:</span><strong>${b.lost} / 15</strong></div>
          <div class="stat-line"><span>Shots Fired:</span><strong>${b.shots}</strong></div>
          <div class="stat-line"><span>Direct Hits:</span><strong>${b.hits}</strong></div>
          <div class="stat-line"><span>Accuracy:</span><strong>${blueAcc}%</strong></div>
        </div>
      </div>
    `,
    items: [
      { label: 'New game', action: newGame },
      { label: 'Main menu', action: openTitle },
    ],
    onEsc: null,
  });
}

// ----------------------------------------------------------------- input ----
window.addEventListener('keydown', (e) => {
  if (kbScreen.isOpen()) {
    if (kbScreen.handleKey(e)) e.preventDefault();
    return;
  }
  if (e.code === 'Tab') e.preventDefault();
  sfx.resume();
  if (menu.isOpen()) {
    if (menu.handleKey(e)) e.preventDefault();
    return;
  }
  if (e.code === C.KEYS.MENU) {
    e.preventDefault();
    if (appState === 'PLAYING' && !e.repeat) {
      input.clear();
      openPause();
    }
    return;
  }
  if (appState === 'PLAYING' && input.keyDown(e)) e.preventDefault();
});
window.addEventListener('keyup', (e) => input.keyUp(e));
window.addEventListener('pointerdown', () => sfx.resume());
window.addEventListener('blur', () => {
  input.clear();
  if (appState === 'PLAYING' && !menu.isOpen() && !kbScreen.isOpen() && !world.over) openPause();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) dirty = true;
});

// ---------------------------------------------------------------- loop ------
let dirty = true;
function resizeAll() {
  map.resize();
  view.resize();
  dirty = true;
}
new ResizeObserver(resizeAll).observe(document.getElementById('app'));
resizeAll();

let last = performance.now();
let lastRender = 0;
let acc = 0;
const minRenderInterval = 1000 / C.RENDER_TARGET_FPS;

function frame(now) {
  requestAnimationFrame(frame);

  if (document.hidden) {
    last = now;
    return;
  }

  const dtFrame = Math.min((now - last) / 1000, C.SIM_MAX_FRAME_S);
  last = now;
  const playing = appState === 'PLAYING' && !menu.isOpen() && !world.over;
  if (playing) {
    input.update(now);
    for (const a of input.drain()) {
      if (!isAiPlayer(a.player)) {
        applyAction(world, a.player, a.action, a.arg);
      }
    }

    for (let p = 0; p < 2; p++) {
      if (isAiPlayer(p)) {
        aiControllers[p].update(world, dtFrame, currentAiLevel());
      }
    }

    acc += dtFrame;
    while (acc >= C.SIM_TICK_S) {
      step(world, C.SIM_TICK_S, {
        windowTurn: [
          isAiPlayer(0) ? 0 : input.windowTurn(0),
          isAiPlayer(1) ? 0 : input.windowTurn(1),
        ],
      });
      acc -= C.SIM_TICK_S;
    }
    dirty = true;
  } else {
    acc = 0;
  }
  for (const e of world.events) sfx.play(e);
  world.events.length = 0;
  sfx.updateEngines(world, playing);

  if (world.over && !gameOverShown && appState === 'PLAYING') {
    gameOverShown = true;
    openGameOver();
  }

  // Throttle rendering: if static or rendered within target FPS interval, skip render
  if (!dirty) return;
  if (playing && now - lastRender < minRenderInterval) return;

  lastRender = now;
  dirty = false;

  map.render(world);
  view.render(world);
  hud.update(world, now, false);
}

if (autoStart) {
  newGame();
} else {
  openTitle();
}
hud.update(world, performance.now(), true);
requestAnimationFrame(frame);
