import * as C from '../constants.js';
import { keyLabel } from '../input.js';

// Desktop 104-Key QWERTY Layout specification
// Keys have code, label, width multiplier (1u = standard square keycap)
const MAIN_ROWS = [
  // Function Row
  [
    { code: 'Escape', label: 'Esc', w: 1 },
    { spacer: true, w: 1 },
    { code: 'F1', label: 'F1', w: 1 },
    { code: 'F2', label: 'F2', w: 1 },
    { code: 'F3', label: 'F3', w: 1 },
    { code: 'F4', label: 'F4', w: 1 },
    { spacer: true, w: 0.5 },
    { code: 'F5', label: 'F5', w: 1 },
    { code: 'F6', label: 'F6', w: 1 },
    { code: 'F7', label: 'F7', w: 1 },
    { code: 'F8', label: 'F8', w: 1 },
    { spacer: true, w: 0.5 },
    { code: 'F9', label: 'F9', w: 1 },
    { code: 'F10', label: 'F10', w: 1 },
    { code: 'F11', label: 'F11', w: 1 },
    { code: 'F12', label: 'F12', w: 1 },
  ],
  // Number Row
  [
    { code: 'Backquote', label: '` ~', w: 1 },
    { code: 'Digit1', label: '1 !', w: 1 },
    { code: 'Digit2', label: '2 @', w: 1 },
    { code: 'Digit3', label: '3 #', w: 1 },
    { code: 'Digit4', label: '4 $', w: 1 },
    { code: 'Digit5', label: '5 %', w: 1 },
    { code: 'Digit6', label: '6 ^', w: 1 },
    { code: 'Digit7', label: '7 &', w: 1 },
    { code: 'Digit8', label: '8 *', w: 1 },
    { code: 'Digit9', label: '9 (', w: 1 },
    { code: 'Digit0', label: '0 )', w: 1 },
    { code: 'Minus', label: '- _', w: 1 },
    { code: 'Equal', label: '= +', w: 1 },
    { code: 'Backspace', label: 'Backspace', w: 2 },
  ],
  // QWERTY Row
  [
    { code: 'Tab', label: 'Tab', w: 1.5 },
    { code: 'KeyQ', label: 'Q', w: 1 },
    { code: 'KeyW', label: 'W', w: 1 },
    { code: 'KeyE', label: 'E', w: 1 },
    { code: 'KeyR', label: 'R', w: 1 },
    { code: 'KeyT', label: 'T', w: 1 },
    { code: 'KeyY', label: 'Y', w: 1 },
    { code: 'KeyU', label: 'U', w: 1 },
    { code: 'KeyI', label: 'I', w: 1 },
    { code: 'KeyO', label: 'O', w: 1 },
    { code: 'KeyP', label: 'P', w: 1 },
    { code: 'BracketLeft', label: '[ {', w: 1 },
    { code: 'BracketRight', label: '] }', w: 1 },
    { code: 'Backslash', label: '\\ |', w: 1.5 },
  ],
  // Home Row
  [
    { code: 'CapsLock', label: 'Caps', w: 1.75 },
    { code: 'KeyA', label: 'A', w: 1 },
    { code: 'KeyS', label: 'S', w: 1 },
    { code: 'KeyD', label: 'D', w: 1 },
    { code: 'KeyF', label: 'F', w: 1 },
    { code: 'KeyG', label: 'G', w: 1 },
    { code: 'KeyH', label: 'H', w: 1 },
    { code: 'KeyJ', label: 'J', w: 1 },
    { code: 'KeyK', label: 'K', w: 1 },
    { code: 'KeyL', label: 'L', w: 1 },
    { code: 'Semicolon', label: '; :', w: 1 },
    { code: 'Quote', label: "' \"", w: 1 },
    { code: 'Enter', label: 'Enter', w: 2.25 },
  ],
  // Shift Row
  [
    { code: 'ShiftLeft', label: 'Shift', w: 2.25 },
    { code: 'KeyZ', label: 'Z', w: 1 },
    { code: 'KeyX', label: 'X', w: 1 },
    { code: 'KeyC', label: 'C', w: 1 },
    { code: 'KeyV', label: 'V', w: 1 },
    { code: 'KeyB', label: 'B', w: 1 },
    { code: 'KeyN', label: 'N', w: 1 },
    { code: 'KeyM', label: 'M', w: 1 },
    { code: 'Comma', label: ', <', w: 1 },
    { code: 'Period', label: '. >', w: 1 },
    { code: 'Slash', label: '/ ?', w: 1 },
    { code: 'ShiftRight', label: 'Shift', w: 2.75 },
  ],
  // Space Row
  [
    { code: 'ControlLeft', label: 'Ctrl', w: 1.25 },
    { code: 'MetaLeft', label: 'Win', w: 1.25 },
    { code: 'AltLeft', label: 'Alt', w: 1.25 },
    { code: 'Space', label: 'Space', w: 6.25 },
    { code: 'AltRight', label: 'Alt', w: 1.25 },
    { code: 'MetaRight', label: 'Win', w: 1.25 },
    { code: 'ContextMenu', label: 'Menu', w: 1.25 },
    { code: 'ControlRight', label: 'Ctrl', w: 1.25 },
  ],
];

const NAV_ROWS = [
  // F-row level
  [
    { code: 'PrintScreen', label: 'PrtSc', w: 1 },
    { code: 'ScrollLock', label: 'ScrLk', w: 1 },
    { code: 'Pause', label: 'Pause', w: 1 },
  ],
  // Ins Home PgUp
  [
    { code: 'Insert', label: 'Ins', w: 1 },
    { code: 'Home', label: 'Home', w: 1 },
    { code: 'PageUp', label: 'PgUp', w: 1 },
  ],
  // Del End PgDn
  [
    { code: 'Delete', label: 'Del', w: 1 },
    { code: 'End', label: 'End', w: 1 },
    { code: 'PageDown', label: 'PgDn', w: 1 },
  ],
  // Spacer row above arrows
  [
    { spacer: true, w: 3 },
  ],
  // Up arrow row
  [
    { spacer: true, w: 1 },
    { code: 'ArrowUp', label: '↑', w: 1 },
    { spacer: true, w: 1 },
  ],
  // Left Down Right
  [
    { code: 'ArrowLeft', label: '←', w: 1 },
    { code: 'ArrowDown', label: '↓', w: 1 },
    { code: 'ArrowRight', label: '→', w: 1 },
  ],
];

// Numpad rows
const NUMPAD_HEADER = [
  { spacer: true, w: 4 },
];
const NUMPAD_ROW1 = [
  { code: 'NumLock', label: 'NumLk', w: 1 },
  { code: 'NumpadDivide', label: '/', w: 1 },
  { code: 'NumpadMultiply', label: '*', w: 1 },
  { code: 'NumpadSubtract', label: '-', w: 1 },
];
const NUMPAD_GRID = [
  { code: 'Numpad7', label: '7', col: 1, row: 1 },
  { code: 'Numpad8', label: '8', col: 2, row: 1 },
  { code: 'Numpad9', label: '9', col: 3, row: 1 },
  { code: 'NumpadAdd', label: '+', col: 4, row: 1, rowSpan: 2 },
  { code: 'Numpad4', label: '4', col: 1, row: 2 },
  { code: 'Numpad5', label: '5', col: 2, row: 2 },
  { code: 'Numpad6', label: '6', col: 3, row: 2 },
  { code: 'Numpad1', label: '1', col: 1, row: 3 },
  { code: 'Numpad2', label: '2', col: 2, row: 3 },
  { code: 'Numpad3', label: '3', col: 3, row: 3 },
  { code: 'NumpadEnter', label: 'Ent', col: 4, row: 3, rowSpan: 2 },
  { code: 'Numpad0', label: '0', col: 1, row: 4, colSpan: 2 },
  { code: 'NumpadDecimal', label: '.', col: 3, row: 4 },
];

export const RESERVED_SYSTEM_KEYS = new Set([
  'Escape',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'MetaLeft', 'MetaRight',
  'ContextMenu',
  'PrintScreen', 'ScrollLock', 'Pause',
  'NumLock', 'CapsLock',
]);

const ACTION_DEFS = [
  { action: 'FORWARD', label: 'ACCELERATE', short: 'ACCEL' },
  { action: 'BACK', label: 'DECELERATE', short: 'DECEL' },
  { action: 'TURN_L', label: 'TURN LEFT', short: 'TURN L' },
  { action: 'TURN_R', label: 'TURN RIGHT', short: 'TURN R' },
  { action: 'WIN_L', label: 'HANGAR TURRET (LEFT)', short: 'TUR L' },
  { action: 'WIN_R', label: 'HANGAR TURRET (RIGHT)', short: 'TUR R' },
  { action: 'FIRE', label: 'FIRE', short: 'FIRE' },
  { action: 'MINE', label: 'DROP MINE', short: 'MINE' },
  { action: 'SMOKE', label: 'SMOKE CLOUD', short: 'SMOKE' },
];

export function createKeyboardScreen(root) {
  let workingKeys = null;
  let activeDrag = null;
  let selectedFn = null; // { player, type, action, index, name }
  let callbacks = { onSave: () => {}, onClose: () => {} };
  let statusMsg = '';

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function getBindingForCode(code) {
    if (!workingKeys || !code) return null;
    // Check Left player (0)
    for (let i = 0; i < 5; i++) {
      if (workingKeys.LEFT.SELECT && workingKeys.LEFT.SELECT[i] === code) {
        return { player: 0, isTank: true, label: `${i + 1}`, short: `T${i + 1}`, full: `Tank ${i + 1}` };
      }
    }
    for (const def of ACTION_DEFS) {
      const val = workingKeys.LEFT[def.action];
      if (Array.isArray(val) ? val.includes(code) : val === code) {
        return { player: 0, isTank: false, action: def.action, short: def.short, full: def.label };
      }
    }
    // Check Right player (1)
    for (let i = 0; i < 5; i++) {
      if (workingKeys.RIGHT.SELECT && workingKeys.RIGHT.SELECT[i] === code) {
        return { player: 1, isTank: true, label: `${i + 1}`, short: `T${i + 1}`, full: `Tank ${i + 1}` };
      }
    }
    for (const def of ACTION_DEFS) {
      const val = workingKeys.RIGHT[def.action];
      if (Array.isArray(val) ? val.includes(code) : val === code) {
        return { player: 1, isTank: false, action: def.action, short: def.short, full: def.label };
      }
    }
    return null;
  }

  function getKeyForFn(player, type, action, index) {
    const side = player === 0 ? workingKeys.LEFT : workingKeys.RIGHT;
    if (type === 'select') {
      return (side.SELECT && side.SELECT[index]) || null;
    }
    const val = side[action];
    if (Array.isArray(val)) return val[0] || null;
    return val || null;
  }

  function clearKeyFromAll(code) {
    if (!code) return;
    [workingKeys.LEFT, workingKeys.RIGHT].forEach((side) => {
      if (Array.isArray(side.SELECT)) {
        side.SELECT = side.SELECT.map((c) => (c === code ? null : c));
      }
      for (const def of ACTION_DEFS) {
        const a = def.action;
        if (Array.isArray(side[a])) {
          side[a] = side[a].filter((c) => c !== code);
          if (side[a].length === 0) side[a] = null;
        } else if (side[a] === code) {
          side[a] = null;
        }
      }
    });
  }

  function assignKey(player, type, action, index, code) {
    if (!code) return;
    if (RESERVED_SYSTEM_KEYS.has(code)) {
      statusMsg = `Key "${keyLabel(code)}" is reserved by Browser / OS and cannot be mapped.`;
      render();
      return;
    }
    // Clear code from previous binding anywhere
    clearKeyFromAll(code);
    const side = player === 0 ? workingKeys.LEFT : workingKeys.RIGHT;
    if (type === 'select') {
      side.SELECT[index] = code;
    } else {
      side[action] = code;
    }
    statusMsg = `Mapped ${keyLabel(code)} to ${player === 0 ? 'Red' : 'Blue'} ${type === 'select' ? 'Tank ' + (index + 1) : action}`;
    render();
  }

  function createKeycap(def) {
    if (def.spacer) {
      const sp = document.createElement('div');
      sp.className = 'kb-spacer';
      sp.style.setProperty('--kw', def.w);
      return sp;
    }
    const cap = document.createElement('div');
    cap.className = 'kb-key';
    cap.dataset.code = def.code;
    cap.style.setProperty('--kw', def.w || 1);
    if (def.col) cap.style.gridColumn = def.colSpan ? `${def.col} / span ${def.colSpan}` : `${def.col}`;
    if (def.row) cap.style.gridRow = def.rowSpan ? `${def.row} / span ${def.rowSpan}` : `${def.row}`;

    const isReserved = RESERVED_SYSTEM_KEYS.has(def.code);
    if (isReserved) {
      cap.classList.add('reserved');
    }

    // Base letter label
    const label = document.createElement('span');
    label.className = 'kb-key-base-label';
    label.textContent = def.label;
    cap.appendChild(label);

    // Overlay shade if mapped
    const binding = getBindingForCode(def.code);
    if (binding) {
      cap.classList.add('mapped', binding.player === 0 ? 'p0' : 'p1');
      const shade = document.createElement('div');
      shade.className = `kb-shade ${binding.player === 0 ? 'red' : 'blue'}`;

      const badge = document.createElement('span');
      badge.className = `kb-badge ${binding.isTank ? 'circle' : 'rect'}`;
      badge.textContent = binding.short;
      shade.appendChild(badge);
      cap.appendChild(shade);
      cap.title = `${binding.player === 0 ? '[RED]' : '[BLUE]'} ${binding.full} (${def.code})`;
    } else if (isReserved) {
      cap.title = `${def.label} (${def.code}) — Reserved by Browser / OS`;
    } else {
      cap.title = `${def.label} (${def.code})`;
    }

    // Drag-over drop handling
    cap.addEventListener('dragover', (e) => {
      if (isReserved) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cap.classList.add('drop-target');
    });
    cap.addEventListener('dragleave', () => {
      cap.classList.remove('drop-target');
    });
    cap.addEventListener('drop', (e) => {
      e.preventDefault();
      cap.classList.remove('drop-target');
      if (isReserved) {
        statusMsg = `Key "${def.label}" is reserved by Browser / OS and cannot be mapped.`;
        render();
        return;
      }
      let data = activeDrag;
      if (!data) {
        try {
          data = JSON.parse(e.dataTransfer.getData('application/json'));
        } catch {}
      }
      if (data && def.code) {
        assignKey(data.player, data.type, data.action, data.index, def.code);
        selectedFn = null;
      }
    });

    // Click assignment
    cap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isReserved) {
        statusMsg = `Key "${def.label}" is reserved by Browser / OS and cannot be mapped.`;
        render();
        return;
      }
      if (selectedFn && def.code) {
        assignKey(selectedFn.player, selectedFn.type, selectedFn.action, selectedFn.index, def.code);
        selectedFn = null;
        render();
      }
    });

    return cap;
  }

  function renderKeyboard() {
    const chassis = document.createElement('div');
    chassis.className = 'kb-chassis';

    // 1. Main Block
    const mainBlock = document.createElement('div');
    mainBlock.className = 'kb-block kb-main';
    MAIN_ROWS.forEach((rowDefs) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      rowDefs.forEach((def) => rowEl.appendChild(createKeycap(def)));
      mainBlock.appendChild(rowEl);
    });
    chassis.appendChild(mainBlock);

    // 2. Navigation Block
    const navBlock = document.createElement('div');
    navBlock.className = 'kb-block kb-nav';
    NAV_ROWS.forEach((rowDefs) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      rowDefs.forEach((def) => rowEl.appendChild(createKeycap(def)));
      navBlock.appendChild(rowEl);
    });
    chassis.appendChild(navBlock);

    // 3. Numpad Block
    const numBlock = document.createElement('div');
    numBlock.className = 'kb-block kb-numpad';

    const numHdr = document.createElement('div');
    numHdr.className = 'kb-row';
    NUMPAD_HEADER.forEach((def) => numHdr.appendChild(createKeycap(def)));
    numBlock.appendChild(numHdr);

    const numR1 = document.createElement('div');
    numR1.className = 'kb-row';
    NUMPAD_ROW1.forEach((def) => numR1.appendChild(createKeycap(def)));
    numBlock.appendChild(numR1);

    const numGrid = document.createElement('div');
    numGrid.className = 'kb-numpad-grid';
    NUMPAD_GRID.forEach((def) => numGrid.appendChild(createKeycap(def)));
    numBlock.appendChild(numGrid);

    chassis.appendChild(numBlock);
    return chassis;
  }

  function createFunctionItem(player, type, action, index, labelText, isCircular) {
    const item = document.createElement('div');
    item.className = `kb-fn-item ${player === 0 ? 'red' : 'blue'}`;
    item.setAttribute('draggable', 'true');

    const isSelected =
      selectedFn &&
      selectedFn.player === player &&
      selectedFn.type === type &&
      (type === 'select' ? selectedFn.index === index : selectedFn.action === action);
    if (isSelected) item.classList.add('selected-fn');

    // The upper frame (circle or rounded rectangle)
    const frame = document.createElement('div');
    frame.className = `kb-fn-frame ${isCircular ? 'circle' : 'rounded'}`;
    frame.textContent = labelText;
    item.appendChild(frame);

    // The key mapped under it
    const code = getKeyForFn(player, type, action, index);
    const keyUnder = document.createElement('div');
    keyUnder.className = 'kb-fn-key';
    keyUnder.textContent = keyLabel(code);
    item.appendChild(keyUnder);

    // Drag-and-drop source
    item.addEventListener('dragstart', (e) => {
      activeDrag = { player, type, action, index, name: labelText };
      e.dataTransfer.setData('application/json', JSON.stringify(activeDrag));
      e.dataTransfer.effectAllowed = 'copyMove';
      item.classList.add('dragging');
      statusMsg = `Drag "${labelText}" to any keyboard key...`;
      document.querySelector('.kb-status-bar')?.classList.add('active');
    });
    item.addEventListener('dragend', () => {
      activeDrag = null;
      item.classList.remove('dragging');
    });

    // Click to select
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSelected) {
        selectedFn = null;
        statusMsg = '';
      } else {
        selectedFn = { player, type, action, index, name: labelText };
        statusMsg = `Selected "${labelText}". Click any keycap or press a key on your keyboard to assign.`;
      }
      render();
    });

    return item;
  }

  function renderPlayerPalette(player) {
    const panel = document.createElement('div');
    panel.className = `kb-player-panel ${player === 0 ? 'p-red' : 'p-blue'}`;

    const title = document.createElement('div');
    title.className = 'kb-player-title';
    title.textContent = player === 0 ? 'LEFT PLAYER (RED)' : 'RIGHT PLAYER (BLUE)';
    panel.appendChild(title);

    // Tanks row (circle frames)
    const tanksRow = document.createElement('div');
    tanksRow.className = 'kb-fn-row tanks-row';
    const tanksLabel = document.createElement('span');
    tanksLabel.className = 'kb-fn-row-label';
    tanksLabel.textContent = 'TANKS:';
    tanksRow.appendChild(tanksLabel);

    for (let i = 0; i < 5; i++) {
      tanksRow.appendChild(createFunctionItem(player, 'select', null, i, `${i + 1}`, true));
    }
    panel.appendChild(tanksRow);

    // Actions rows (rounded rectangle frames)
    const actionsRow = document.createElement('div');
    actionsRow.className = 'kb-fn-row actions-row';
    ACTION_DEFS.forEach((def) => {
      actionsRow.appendChild(createFunctionItem(player, 'action', def.action, null, def.label, false));
    });
    panel.appendChild(actionsRow);

    return panel;
  }

  function render() {
    root.innerHTML = '';
    if (!workingKeys) return;

    const modal = document.createElement('div');
    modal.className = 'kb-modal';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'kb-header';
    const h1 = document.createElement('h2');
    h1.className = 'kb-title';
    h1.textContent = 'KEYBOARD LAYOUT CONFIGURATION';
    hdr.appendChild(h1);
    const sub = document.createElement('p');
    sub.className = 'kb-subtitle';
    sub.textContent = 'Drag any action badge to a keyboard key, or click a badge then click/press a key to bind.';
    hdr.appendChild(sub);
    modal.appendChild(hdr);

    // Keyboard Visualizer
    modal.appendChild(renderKeyboard());

    // Status / Hint Bar
    const statusBar = document.createElement('div');
    statusBar.className = 'kb-status-bar';
    if (statusMsg) statusBar.classList.add('active');
    statusBar.textContent = statusMsg || 'Click or drag a function below to customize your layout.';
    modal.appendChild(statusBar);

    // Bottom Palettes for Left and Right Players
    const palettesWrap = document.createElement('div');
    palettesWrap.className = 'kb-palettes-wrap';
    palettesWrap.appendChild(renderPlayerPalette(0));
    palettesWrap.appendChild(renderPlayerPalette(1));
    modal.appendChild(palettesWrap);

    // Control Buttons: RESET LAYOUT, OK, CANCEL
    const btnsWrap = document.createElement('div');
    btnsWrap.className = 'kb-actions-bar';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'kb-btn kb-btn-reset';
    resetBtn.textContent = 'RESET LAYOUT';
    resetBtn.addEventListener('click', () => {
      workingKeys = clone(C.DEFAULT_KEYS);
      localStorage.removeItem(C.KEYS_SETTINGS_KEY);
      selectedFn = null;
      statusMsg = 'Layout reset to defaults and cleared from localStorage.';
      render();
    });
    btnsWrap.appendChild(resetBtn);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    btnsWrap.appendChild(spacer);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'kb-btn kb-btn-cancel';
    cancelBtn.textContent = 'CANCEL';
    cancelBtn.addEventListener('click', () => {
      closeScreen();
    });
    btnsWrap.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = 'kb-btn kb-btn-ok';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => {
      localStorage.setItem(C.KEYS_SETTINGS_KEY, JSON.stringify(workingKeys));
      callbacks.onSave(workingKeys);
      closeScreen();
    });
    btnsWrap.appendChild(okBtn);

    modal.appendChild(btnsWrap);
    root.appendChild(modal);
  }

  function closeScreen() {
    workingKeys = null;
    selectedFn = null;
    activeDrag = null;
    statusMsg = '';
    root.classList.add('hidden');
    callbacks.onClose();
  }

  const api = {
    isOpen: () => !root.classList.contains('hidden') && workingKeys !== null,
    open({ getKeys, onSave, onClose }) {
      workingKeys = clone(getKeys());
      selectedFn = null;
      activeDrag = null;
      statusMsg = '';
      callbacks = { onSave: onSave || (() => {}), onClose: onClose || (() => {}) };
      root.classList.remove('hidden');
      render();
    },
    close: closeScreen,
    handleKey(e) {
      if (!api.isOpen()) return false;
      if (e.code === 'Tab') {
        e.preventDefault();
      }
      if (selectedFn) {
        if (e.code === 'Escape') {
          selectedFn = null;
          statusMsg = '';
          render();
          return true;
        }
        assignKey(selectedFn.player, selectedFn.type, selectedFn.action, selectedFn.index, e.code);
        selectedFn = null;
        render();
        return true;
      }
      if (e.code === 'Escape') {
        closeScreen();
        return true;
      }
      return false;
    },
  };

  return api;
}
