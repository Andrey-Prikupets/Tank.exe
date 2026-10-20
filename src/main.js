import './style.css';
import * as C from './constants.js';
import { createWorld, applyAction, step } from './sim/world.js';
import { slotInfo, saveSlot, loadSlot } from './sim/save.js';
import { Input, keyLabel } from './input.js';
import { createMap2D } from './render/map2d.js';
import { createView3D } from './render/view3d.js';
import { createHud } from './render/hud.js';
import { createMenu } from './ui/menu.js';
import { Sfx } from './audio/sfx.js';

document.documentElement.style.setProperty('--mask-h', `${C.WINDOW_MASK_PERCENT}%`);

let world = createWorld();
let appState = 'TITLE'; // 'TITLE' | 'PLAYING'
let gameOverShown = false;

const input = new Input();
const sfx = new Sfx();
const menu = createMenu(document.getElementById('menu'));
const map = createMap2D(document.getElementById('map'));
const view = createView3D(document.getElementById('gl'));
const hud = createHud();

// ---------------------------------------------------------------- screens ---
const soundItem = () => ({
  label: () => `Sound: ${sfx.enabled ? 'ON' : 'OFF'}`,
  action: () => {
    sfx.resume();
    sfx.toggle();
  },
});

function helpScreen() {
  const rows = [
    ['Select tank', '1, 2, 3, 4, 5', '6, 7, 8, 9, 0 (tanks 1..5)'],
    ['Accelerate', 'W', '↑'],
    ['Decelerate / reverse', 'S', '↓'],
    ['Turn left', 'A', '←'],
    ['Turn right', 'D', '→'],
    ['Left window', 'Q', '['],
    ['Right window', 'R', ']'],
    ['Fire', 'Tab', 'Enter'],
    ['Drop mine', 'Z', ', (<)'],
    ['Smoke cloud', 'X', '. (>)'],
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
       • <strong>Gate Defense:</strong> Hangar slit windows allow defensive surveillance and firing with unlimited ammo. The area directly in front of the gate is a dead zone protected from window fire.<br>
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

function quitScreen() {
  return {
    title: 'QUIT TANK.EXE',
    text: `
      <div class="dos-box">
        C:\\GAMES\\TANK&gt; EXIT<br><br>
        [ Tank.exe ${C.VERSION_LABEL} session terminated ]<br>
        Memory released: 640K conventional RAM.<br><br>
        Thank you for playing Tank.exe!
      </div>
    `,
    items: [
      {
        label: 'Restart Tank.exe',
        action: () => {
          menu.clear();
          newGame();
        },
      },
      {
        label: 'Main menu',
        action: openTitle,
      },
    ],
    onEsc: openTitle,
  };
}

function newGame() {
  world = createWorld();
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
    items: [
      { label: 'Start game', action: newGame },
      { label: 'Help', action: () => menu.push(helpScreen()) },
      soundItem(),
      { label: 'Load game', action: () => menu.push(loadScreen()) },
      { label: 'Quit', action: () => menu.push(quitScreen()) },
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
    items: [
      { label: 'Resume', action: resume },
      { label: 'Help', action: () => menu.push(helpScreen()) },
      soundItem(),
      { label: 'Save game', action: () => menu.push(saveScreen()) },
      { label: 'Load game', action: () => menu.push(loadScreen()) },
      {
        label: 'New game',
        action: () => menu.push(confirmScreen('Current game will be lost.', newGame)),
      },
      {
        label: 'Quit',
        action: () => menu.push(confirmScreen('Quit match to main menu?', openTitle)),
      },
    ],
    onEsc: resume,
  });
}

function openGameOver() {
  const [a, b] = world.players;
  const winner = world.winner === 'draw' ? 'DRAW' : world.winner === 0 ? 'RED WINS' : 'BLUE WINS';
  menu.clear();
  dirty = true;
  menu.push({
    title: winner,
    text: `Red: lost ${a.lost}/15, shots ${a.shots}, hits ${a.hits}<br>Blue: lost ${b.lost}/15, shots ${b.shots}, hits ${b.hits}`,
    items: [
      { label: 'New game', action: newGame },
      { label: 'Main menu', action: openTitle },
    ],
    onEsc: null,
  });
}

// ----------------------------------------------------------------- input ----
window.addEventListener('keydown', (e) => {
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
  if (appState === 'PLAYING' && !menu.isOpen() && !world.over) openPause();
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
    for (const a of input.drain()) applyAction(world, a.player, a.action, a.arg);
    acc += dtFrame;
    while (acc >= C.SIM_TICK_S) {
      step(world, C.SIM_TICK_S, { windowTurn: [input.windowTurn(0), input.windowTurn(1)] });
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

openTitle();
hud.update(world, performance.now(), true);
requestAnimationFrame(frame);
