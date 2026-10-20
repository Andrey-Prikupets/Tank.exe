import * as C from './constants.js';

const REPEATABLE = new Set(['FORWARD', 'BACK', 'TURN_L', 'TURN_R']);

export function loadSavedKeys() {
  try {
    const raw = localStorage.getItem(C.KEYS_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.LEFT && parsed.RIGHT) {
        return parsed;
      }
    }
  } catch {}
  return JSON.parse(JSON.stringify(C.DEFAULT_KEYS));
}

export class Input {
  constructor(keys = loadSavedKeys()) {
    this.keys = keys;
    this.map = new Map();
    this.down = new Set();
    this.held = new Map();
    this.queue = [];
    this.rebuildMap();
  }

  setKeys(keys) {
    this.keys = JSON.parse(JSON.stringify(keys));
    this.rebuildMap();
  }

  getKeys() {
    return this.keys;
  }

  rebuildMap() {
    this.map.clear();
    [[0, this.keys.LEFT], [1, this.keys.RIGHT]].forEach(([player, side]) => {
      (side.SELECT || []).forEach((code, i) => {
        if (code) this.map.set(code, { player, action: 'SELECT', arg: C.TANK_NUMBERS[player][i] });
      });
      for (const action of ['FORWARD', 'BACK', 'TURN_L', 'TURN_R', 'WIN_L', 'WIN_R', 'FIRE', 'MINE', 'SMOKE']) {
        [].concat(side[action] || []).forEach((code) => {
          if (code) this.map.set(code, { player, action });
        });
      }
    });
  }

  /** Returns true when the key is a gameplay key (caller should preventDefault). */
  keyDown(e) {
    const b = this.map.get(e.code);
    if (!b) return false;
    if (e.repeat) return true;
    this.down.add(e.code);
    this.queue.push({ ...b });
    if (REPEATABLE.has(b.action)) this.held.set(e.code, { b, next: performance.now() + C.KEY_REPEAT_DELAY_MS });
    return true;
  }

  keyUp(e) {
    this.down.delete(e.code);
    this.held.delete(e.code);
  }

  update(now) {
    for (const h of this.held.values()) {
      while (now >= h.next) {
        this.queue.push({ ...h.b });
        h.next += C.KEY_REPEAT_MS;
      }
    }
  }

  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  windowTurn(p) {
    const side = p === 0 ? this.keys.LEFT : this.keys.RIGHT;
    const l = [].concat(side.TURN_L || []).some((c) => this.down.has(c));
    const r = [].concat(side.TURN_R || []).some((c) => this.down.has(c));
    return (r ? 1 : 0) - (l ? 1 : 0);
  }

  clear() {
    this.down.clear();
    this.held.clear();
    this.queue = [];
  }
}

const SPECIAL_LABELS = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=',
  Enter: 'Enter', NumpadEnter: 'Num Ent', Tab: 'Tab', Escape: 'Esc', Space: 'Space',
  Backspace: 'Bksp', CapsLock: 'Caps', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Win', MetaRight: 'Win', ContextMenu: 'Menu',
  Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', NumLock: 'NumLk',
  NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+',
  NumpadDecimal: '.',
  Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad3: 'Num 3', Numpad4: 'Num 4',
  Numpad5: 'Num 5', Numpad6: 'Num 6', Numpad7: 'Num 7', Numpad8: 'Num 8', Numpad9: 'Num 9',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (SPECIAL_LABELS[code]) return SPECIAL_LABELS[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}
