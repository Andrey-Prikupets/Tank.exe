import './style.css';
import * as C from './constants.js';
import { createWorld, applyAction, step, syncWorldTerrain } from './sim/world.js';
import { slotInfo, saveSlot, loadSlot } from './sim/save.js';
import { Input, keyLabel } from './input.js';
import { createMap2D } from './render/map2d.js';
import { createAiLog } from './render/ai_log.js';
import { createView3D } from './render/view3d.js';
import { createHud } from './render/hud.js';
import { createMenu } from './ui/menu.js';
import { createKeyboardScreen } from './ui/keyboard_screen.js';
import { createTouchControls, enterFullscreen, exitFullscreen } from './ui/touch.js';
import { createReplaysModal } from './ui/replays_modal.js';
import { createPlaybackToolbar } from './ui/playback_toolbar.js';
import { createNetworkModal } from './ui/network_modal.js';
import { createInitPayload, serializeWorldSnapshot, applyWorldSnapshot } from './net/sync.js';
import {
  createRecorder,
  decodeRecording,
  createPlayback,
  saveRecording,
  loadRecording,
  listRecordings,
} from './sim/recording.js';
import { Sfx } from './audio/sfx.js';
import { AiController } from './sim/ai.js';
import historyRu from './history/history_ru.html?raw';
import historyEn from './history/history_en.html?raw';
import historyEs from './history/history_es.html?raw';
import helpRu from './help/help_ru.html?raw';
import helpEn from './help/help_en.html?raw';
import helpEs from './help/help_es.html?raw';

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

const HELP_DOCS = {
  ru: helpRu,
  en: helpEn,
  es: helpEs,
};

const HELP_TITLES = {
  en: 'HELP — TANK.EXE MANUAL',
  es: 'AYUDA — MANUAL TANK.EXE',
  ru: 'ПОМОЩЬ — РУКОВОДСТВО TANK.EXE',
};

const HELP_BACK_LABELS = {
  en: 'Back (Esc)',
  es: 'Volver (Esc)',
  ru: 'Назад (Esc)',
};

function getInitialHelpLang() {
  try {
    const saved = localStorage.getItem('tank_help_lang');
    if (saved && HELP_DOCS[saved]) return saved;
    const historySaved = localStorage.getItem('tank_history_lang');
    if (historySaved && HELP_DOCS[historySaved]) return historySaved;
  } catch {}
  const navLang = (navigator.language || (navigator.languages && navigator.languages[0]) || '').toLowerCase();
  if (navLang.startsWith('ru') || navLang.startsWith('be') || navLang.startsWith('uk')) return 'ru';
  if (navLang.startsWith('es')) return 'es';
  return 'en';
}

let helpLang = getInitialHelpLang();

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

let savedRecording = false;
try {
  const val = localStorage.getItem(C.RECORDING_SETTINGS_KEY);
  if (val !== null) savedRecording = JSON.parse(val);
} catch {}

let recordingEnabled = savedRecording;

const options = {
  obstacles: savedObstacles,
  pits: savedPits,
};

// URL query string parameters for startup overrides
const urlParams = new URLSearchParams(window.location.search);

function parseBoolParam(key) {
  const target = key.toLowerCase();
  for (const [k, v] of urlParams.entries()) {
    if (k.toLowerCase() === target) {
      const val = (v || '').trim().toUpperCase();
      if (val === 'Y') return true;
      if (val === 'N') return false;
      return null;
    }
  }
  return null;
}

// 1. Mode: ?mode=HvH | HvC | CvH | CvC (case-insensitive)
const modeVal = urlParams.get('mode');
if (modeVal) {
  const clean = modeVal.trim().toUpperCase();
  const idx = C.PLAYER_MODES.findIndex((m) => m.id.toUpperCase() === clean);
  if (idx >= 0) playerModeIndex = idx;
}

// 2. AI Level: ?level=EASY | MEDIUM | HARD (case-insensitive)
const levelVal = urlParams.get('level');
if (levelVal) {
  const clean = levelVal.trim().toUpperCase();
  const idx = C.AI_LEVELS.indexOf(clean);
  if (idx >= 0) aiLevelIndex = idx;
}

// 3. Sound: ?sound=Y | N (case-insensitive)
const soundBool = parseBoolParam('sound');
if (soundBool !== null) {
  sfx.setEnabled(soundBool);
}

// 4. Obstacles: ?obstacles=Y | N (case-insensitive)
const obstaclesBool = parseBoolParam('obstacles');
if (obstaclesBool !== null) {
  options.obstacles = obstaclesBool;
}

// 5. Pits: ?pits=Y | N (case-insensitive)
const pitsBool = parseBoolParam('pits');
if (pitsBool !== null) {
  options.pits = pitsBool;
}

// 6. Recording: ?recording=Y | N or ?record=Y | N (case-insensitive)
const recordingBool = parseBoolParam('recording') ?? parseBoolParam('record');
if (recordingBool !== null) {
  recordingEnabled = recordingBool;
}

// 6. Language: ?lang=EN | ES | RU (case-insensitive)
const langVal = urlParams.get('lang');
if (langVal) {
  const clean = langVal.trim().toLowerCase();
  if (HISTORY_DOCS[clean]) historyLang = clean;
  if (HELP_DOCS[clean]) helpLang = clean;
}

// 7. Auto-start: ?start=Y | N (case-insensitive)
const autoStart = parseBoolParam('start') === true;

// 8. Mobile Mode: ?mobile=Y | N (case-insensitive)
const mobileBool = parseBoolParam('mobile');
const forceMobile = mobileBool === true;

// 9. Debug Vectors: ?debugVectors=Y | N (case-insensitive)
const debugVectorsBool = parseBoolParam('debugVectors');
const debugVectors = debugVectorsBool === true;

// 10. Maximum Shooting Distance: ?shootDist=32 (meters, default 32)
const shootDistParam =
  urlParams.get('shootDist') ??
  urlParams.get('shootDistance') ??
  urlParams.get('shellRange') ??
  urlParams.get('maxShootDist');
if (shootDistParam !== null && shootDistParam !== '') {
  const parsedDist = parseFloat(shootDistParam);
  if (!Number.isNaN(parsedDist) && parsedDist > 0) {
    options.shootDist = parsedDist;
  }
}

let world = createWorld(options);
world.isAiPlayer = isAiPlayer;
if (typeof window !== 'undefined') {
  window.__world = () => world;
}
let appState = 'TITLE'; // 'TITLE' | 'PLAYING'
let gameOverShown = false;

const menu = createMenu(document.getElementById('menu'));
const kbScreen = createKeyboardScreen(document.getElementById('keyboardScreen'));
const replaysModal = createReplaysModal(document.getElementById('replaysScreen'));
const playbackToolbar = createPlaybackToolbar(document.getElementById('playbackToolbar'));
const networkModal = createNetworkModal(document.getElementById('networkScreen'));
const map = createMap2D(document.getElementById('map'), { debugVectors });
const aiLog = createAiLog(document.getElementById('mapWrap'));
const view = createView3D(document.getElementById('gl'));
const hud = createHud();

let networkSession = null; // { isHost, p2p, localPlayer, remotePlayer }
let remoteWindowTurn = 0;
let lastSentWindowTurn = 0;
let lastNetworkSync = 0;
const networkSyncInterval = 33; // ~30 snapshots per second

let activeRecorder = null;
let activePlayback = null;
let playbackWorld = null;

function saveActiveRecording() {
  if (activeRecorder && activeRecorder.frameCount >= 5) {
    activeRecorder.sample(world);
    const rec = activeRecorder;
    activeRecorder = null;
    rec.finalize(world).then(({ metadata, base64Payload }) => {
      saveRecording(metadata, base64Payload);
    });
  } else {
    activeRecorder = null;
  }
}

// Hardware keyboard detection: desktop defaults to true; mobile/touch defaults to false until a physical key is pressed
const isTouchCapable =
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0 ||
  window.matchMedia('(pointer: coarse)').matches;

let hasKeyboard = !isTouchCapable && !forceMobile;

window.addEventListener('keydown', (e) => {
  if (!forceMobile && !hasKeyboard && e.isTrusted) {
    hasKeyboard = true;
    if (menu.isOpen()) menu.refresh();
  }
});

const touchSteer = [0, 0];

const touch = createTouchControls({
  root: document.getElementById('app'),
  forceMobile,
  onAction: (player, action, arg) => {
    if (appState !== 'PLAYING' || menu.isOpen() || isAiPlayer(player)) return;
    if (action === 'STOP') {
      applyAction(world, player, 'STOP');
      return;
    }
    applyAction(world, player, action, arg);
  },
  onContinuousTurn: (player, factor) => {
    touchSteer[player] = factor;
    if (appState !== 'PLAYING' || menu.isOpen() || isAiPlayer(player)) return;
    const pl = world.players[player];
    const t = world.tanks.find((tank) => tank.owner === player && tank.number === pl.selected);
    if (t && t.status === 'field' && pl.view === 'tank') {
      const maxTurn = t.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
      t.cmdTurnDeg = Math.round(factor * maxTurn);
    }
  },
  isHumanPlayer: (p) => !isAiPlayer(p),
  openMenu: () => {
    if (appState === 'PLAYING') {
      if (touch.isEnabled()) {
        exitFullscreen();
      }
      input.clear();
      openPause();
    }
  },
  sfxResume: () => sfx.resume(),
});

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

const touchSettingItem = () => ({
  label: () => `Touch controls: ${touch.getSetting()}`,
  action: () => {
    const cur = touch.getSetting();
    const next = cur === 'AUTO' ? 'ON' : cur === 'ON' ? 'OFF' : 'AUTO';
    touch.setSetting(next);
  },
});

const recordingItem = () => ({
  label: () => `Recording: ${recordingEnabled ? 'ON' : 'OFF'}`,
  action: () => {
    recordingEnabled = !recordingEnabled;
    localStorage.setItem(C.RECORDING_SETTINGS_KEY, JSON.stringify(recordingEnabled));
  },
});

function optionsScreen() {
  return {
    title: 'OPTIONS',
    text: '<div class="center">Game & Audio Settings</div>',
    items: () => {
      const list = [
        soundItem(),
        obstaclesItem(),
        pitsItem(),
        touchSettingItem(),
        recordingItem(),
      ];
      if (hasKeyboard) {
        list.push({
          label: 'Keyboard layout',
          action: () => {
            document.getElementById('menu').classList.add('hidden');
            kbScreen.open({
              getKeys: () => input.getKeys(),
              getNetworkKeys: () => input.getNetworkKeys(),
              initialTab: input.getLayoutMode() === 'network' ? 'network' : 'splitscreen',
              onSave: (k, nk) => {
                input.setKeys(k);
                if (nk) input.setNetworkKeys(nk);
              },
              onClose: () => {
                document.getElementById('menu').classList.remove('hidden');
                menu.refresh();
              },
            });
          },
        });
      }
      list.push({ label: 'Back', action: () => menu.pop() });
      return list;
    },
    onEsc: () => menu.pop(),
  };
}

function helpScreen() {
  const s = {
    title: () => HELP_TITLES[helpLang] || HELP_TITLES.en,
    text: () => renderMarkup(HELP_DOCS[helpLang] || HELP_DOCS.en),
    scrollable: true,
    langSwitch: {
      get current() {
        return helpLang;
      },
      onChange: (lang) => {
        if (!HELP_DOCS[lang]) return;
        helpLang = lang;
        try {
          localStorage.setItem('tank_help_lang', lang);
        } catch {}
        menu.refresh();
      },
    },
    items: () => [{ label: HELP_BACK_LABELS[helpLang] || 'Back (Esc)', action: () => menu.pop() }],
    onEsc: () => menu.pop(),
  };
  return s;
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

function leaveNetworkGame() {
  if (networkSession) {
    try {
      networkSession.p2p.close();
    } catch {}
    networkSession = null;
  }
  input.setLayoutMode('splitscreen');
  openTitle();
}

function handleHostNetworkMessage(msg) {
  if (!networkSession || !networkSession.isHost) return;
  if (msg.type === 'INPUT') {
    applyAction(world, networkSession.remotePlayer, msg.action, msg.arg);
    dirty = true;
  } else if (msg.type === 'STEER') {
    remoteWindowTurn = msg.windowTurn || 0;
    dirty = true;
  }
}

function handleClientNetworkMessage(msg) {
  if (!networkSession || networkSession.isHost) return;
  if (msg.type === 'INIT') {
    options.obstacles = msg.options.obstacles;
    options.pits = msg.options.pits;
    if (msg.options.shootDist) options.shootDist = msg.options.shootDist;
    world = createWorld(options);
    world.obstacles = msg.obstacles;
    world.pits = msg.pits;
    world.shellRange = msg.shellRange;
    syncWorldTerrain(world);
    world.isAiPlayer = () => false;

    networkSession.localPlayer = msg.joinerPlayer;
    networkSession.remotePlayer = msg.hostPlayer;
    input.setLayoutMode('network', networkSession.localPlayer);

    appState = 'PLAYING';
    gameOverShown = false;
    input.clear();
    menu.clear();
    dirty = true;
    hud.update(world, performance.now(), true);
  } else if (msg.type === 'STATE') {
    applyWorldSnapshot(world, msg);
    dirty = true;
  } else if (msg.type === 'EVENTS') {
    if (Array.isArray(msg.events)) {
      for (const e of msg.events) {
        sfx.play(e);
      }
    }
  }
}

function startNetworkGame(session) {
  saveActiveRecording();
  if (touch.isEnabled()) {
    enterFullscreen();
  }
  networkSession = session;
  remoteWindowTurn = 0;
  lastSentWindowTurn = 0;
  lastNetworkSync = 0;

  if (session.isHost) {
    world = createWorld(options);
    world.isAiPlayer = () => false;
    input.setLayoutMode('network', session.localPlayer);
    session.p2p.onMessage = handleHostNetworkMessage;
    // Send INIT to client with identical landscape and match rules
    session.p2p.send(createInitPayload(world, session.localPlayer, session.remotePlayer, options));
    appState = 'PLAYING';
    gameOverShown = false;
    input.clear();
    menu.clear();
    dirty = true;
    hud.update(world, performance.now(), true);
  } else {
    // Client joins: listener will wait for INIT packet
    session.p2p.onMessage = handleClientNetworkMessage;
    menu.clear();
    dirty = true;
  }
}

function newGame() {
  saveActiveRecording();
  if (touch.isEnabled()) {
    enterFullscreen();
  }
  world = createWorld(options);
  world.isAiPlayer = isAiPlayer;
  aiControllers.forEach((c) => c.reset());
  appState = 'PLAYING';
  gameOverShown = false;
  input.clear();
  menu.clear();
  dirty = true;
  hud.update(world, performance.now(), true);

  if (recordingEnabled) {
    activeRecorder = createRecorder(world, {
      mode: currentMode().id,
      modeLabel: currentMode().label,
      aiLevel: currentAiLevel(),
      shootDist: world.shellRange || options.shootDist || C.SHELL_RANGE_M,
    });
  } else {
    activeRecorder = null;
  }
}

async function startPlayback(id) {
  const base64 = loadRecording(id);
  if (!base64) return;
  const replays = listRecordings();
  const metadata = replays.find((r) => r.id === id) || { id, duration: 0, mode: 'HvH' };

  try {
    const decoded = await decodeRecording(base64);
    playbackWorld = createWorld({
      obstacles: decoded.obstacles,
      pits: decoded.pits,
      shootDist: decoded.shootDist || metadata.shootDist || C.SHELL_RANGE_M,
    });
    playbackWorld.isReplay = true;
    playbackWorld.isCvC = metadata.mode === 'CvC';
    playbackWorld.mode = metadata.mode;
    playbackWorld.showVectors = metadata.mode === 'CvC' || debugVectors;
    playbackWorld.isAiPlayer = () => false;

    activePlayback = createPlayback(decoded, playbackWorld, sfx);
    appState = 'PLAYBACK';
    document.getElementById('menu').classList.add('hidden');
    menu.clear();
    input.clear();
    dirty = true;

    playbackToolbar.open(activePlayback, metadata, {
      onExit: () => {
        stopPlayback();
      },
      onDelete: () => {
        stopPlayback();
      },
    });
  } catch (err) {
    console.error('Error starting playback:', err);
  }
}

function stopPlayback() {
  if (appState !== 'PLAYBACK') return;
  appState = 'TITLE';
  activePlayback = null;
  playbackWorld = null;
  playbackToolbar.close();
  dirty = true;
  openTitle();
  document.getElementById('menu').classList.add('hidden');
  replaysModal.open({
    onPlay: (id) => startPlayback(id),
    onClose: () => {
      document.getElementById('menu').classList.remove('hidden');
      if (appState === 'TITLE') menu.refresh();
    },
  });
}

function openTitle() {
  saveActiveRecording();
  if (touch.isEnabled()) {
    exitFullscreen();
  }
  appState = 'TITLE';
  menu.clear();
  dirty = true;
  menu.push({
    title: C.GAME_NAME,
    text: '<div class="center">Two players · one keyboard · 90s split-screen tank combat</div>',
    items: () => [
      { label: 'Start game', action: newGame },
      {
        label: 'Multiplayer (Network)',
        action: () => {
          document.getElementById('menu').classList.add('hidden');
          networkModal.open({
            onStartGame: (session) => {
              startNetworkGame(session);
            },
            onClose: () => {
              document.getElementById('menu').classList.remove('hidden');
              if (appState === 'TITLE') menu.refresh();
            },
          });
        },
      },
      { label: 'Load game', action: () => menu.push(loadScreen()) },
      playersItem(),
      ...(currentMode().id !== 'HvH' ? [levelItem()] : []),
      {
        label: 'Game Playback',
        action: () => {
          document.getElementById('menu').classList.add('hidden');
          replaysModal.open({
            onPlay: (id) => startPlayback(id),
            onClose: () => {
              document.getElementById('menu').classList.remove('hidden');
              if (appState === 'TITLE') menu.refresh();
            },
          });
        },
      },
      { label: 'Options', action: () => menu.push(optionsScreen()) },
      { label: 'Help', action: () => menu.push(helpScreen()) },
      { label: 'History', action: () => menu.push(historyScreen()) },
    ],
    onEsc: null,
  });
}

function resume() {
  if (touch.isEnabled()) {
    enterFullscreen();
  }
  menu.clear();
  input.clear();
  dirty = true;
}

function openPause() {
  if (touch.isEnabled()) {
    exitFullscreen();
  }
  dirty = true;
  menu.push({
    title: C.GAME_NAME,
    text: '<div class="center">Game is paused</div>',
    items: () => {
      const items = [{ label: 'Resume game', action: resume }];
      if (networkSession) {
        items.push({ label: 'Leave network match', action: leaveNetworkGame });
      } else {
        items.push(
          { label: 'Save game', action: () => menu.push(saveScreen()) },
          { label: 'Load game', action: () => menu.push(loadScreen()) },
          {
            label: 'New game',
            action: () => menu.push(confirmScreen('Current game will be lost.', newGame)),
          },
          {
            label: 'Main menu',
            action: () => menu.push(confirmScreen('Current game will be lost.', openTitle)),
          }
        );
      }
      items.push(
        playersItem(),
        ...(currentMode().id !== 'HvH' ? [levelItem()] : []),
        { label: 'Options', action: () => menu.push(optionsScreen()) },
        { label: 'Help', action: () => menu.push(helpScreen()) },
        { label: 'History', action: () => menu.push(historyScreen()) }
      );
      return items;
    },
    onEsc: resume,
  });
}

function openGameOver() {
  saveActiveRecording();
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
      {
        label: 'New game',
        action: () => {
          if (networkSession) leaveNetworkGame();
          else newGame();
        },
      },
      {
        label: 'Main menu',
        action: () => {
          if (networkSession) leaveNetworkGame();
          else openTitle();
        },
      },
    ],
    onEsc: null,
  });
}

// ----------------------------------------------------------------- input ----
window.addEventListener('keydown', (e) => {
  if (networkModal.isOpen()) {
    if (e.code === 'Escape') {
      networkModal.close();
      e.preventDefault();
    }
    return;
  }
  if (replaysModal.isOpen()) {
    if (replaysModal.handleKey(e)) e.preventDefault();
    return;
  }
  if (appState === 'PLAYBACK') {
    if (playbackToolbar.handleKey(e)) e.preventDefault();
    return;
  }
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
  const isPlayback = appState === 'PLAYBACK' && activePlayback && playbackWorld;
  if (isPlayback) {
    activePlayback.update(dtFrame);
    playbackToolbar.update();
    dirty = true;
  }

  const playing = appState === 'PLAYING' && !menu.isOpen() && !world.over;
  if (playing) {
    input.update(now);
    const drainedActions = input.drain();

    if (networkSession) {
      if (networkSession.isHost) {
        for (const a of drainedActions) {
          applyAction(world, networkSession.localPlayer, a.action, a.arg);
        }
      } else {
        for (const a of drainedActions) {
          if (a.action === 'SELECT' || a.action === 'WIN_L' || a.action === 'WIN_R') {
            applyAction(world, networkSession.localPlayer, a.action, a.arg);
          }
          networkSession.p2p.send({ type: 'INPUT', action: a.action, arg: a.arg });
        }
        const wTurn = touchSteer[networkSession.localPlayer] !== 0 ? touchSteer[networkSession.localPlayer] : input.windowTurn(networkSession.localPlayer);
        if (wTurn !== lastSentWindowTurn) {
          lastSentWindowTurn = wTurn;
          networkSession.p2p.send({ type: 'STEER', windowTurn: wTurn });
        }
      }
    } else {
      for (const a of drainedActions) {
        if (!isAiPlayer(a.player)) {
          applyAction(world, a.player, a.action, a.arg);
        }
      }
    }

    if (!networkSession) {
      for (let p = 0; p < 2; p++) {
        if (isAiPlayer(p)) {
          aiControllers[p].update(world, dtFrame, currentAiLevel());
        }
      }
    }

    if (!networkSession || networkSession.isHost) {
      acc += dtFrame;
      while (acc >= C.SIM_TICK_S) {
        step(world, C.SIM_TICK_S, {
          windowTurn: [
            networkSession
              ? (networkSession.localPlayer === 0 ? input.windowTurn(0) : remoteWindowTurn)
              : (isAiPlayer(0) ? aiControllers[0].windowTurn : (touchSteer[0] !== 0 ? touchSteer[0] : input.windowTurn(0))),
            networkSession
              ? (networkSession.localPlayer === 1 ? input.windowTurn(1) : remoteWindowTurn)
              : (isAiPlayer(1) ? aiControllers[1].windowTurn : (touchSteer[1] !== 0 ? touchSteer[1] : input.windowTurn(1))),
          ],
        });
        acc -= C.SIM_TICK_S;
      }

      if (networkSession && networkSession.isHost) {
        if (now - lastNetworkSync >= networkSyncInterval) {
          lastNetworkSync = now;
          networkSession.p2p.send(serializeWorldSnapshot(world));
        }
        if (world.events.length > 0) {
          networkSession.p2p.send({ type: 'EVENTS', events: [...world.events] });
        }
      }

      if (activeRecorder) {
        activeRecorder.sample(world);
      }
      dirty = true;
    } else {
      acc = 0;
      dirty = true;
    }
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

  const renderWorld = isPlayback ? playbackWorld : world;
  map.render(renderWorld);
  aiLog.update(aiControllers, isAiPlayer, map.sideWidthPx(), appState === 'PLAYING');
  view.render(renderWorld);
  hud.update(renderWorld, now, false);
  touch.update(renderWorld, appState, menu.isOpen());
}

if (autoStart) {
  newGame();
} else {
  openTitle();
}
hud.update(world, performance.now(), true);
touch.update(world, appState, menu.isOpen());
requestAnimationFrame(frame);
