import * as C from './constants.js';

const REPEATABLE = new Set(['FORWARD', 'BACK', 'TURN_L', 'TURN_R']);

export class Input {
  constructor() {
    this.map = new Map();
    this.down = new Set();
    this.held = new Map();
    this.queue = [];
    [[0, C.KEYS.LEFT], [1, C.KEYS.RIGHT]].forEach(([player, side]) => {
      side.SELECT.forEach((code, i) => this.map.set(code, { player, action: 'SELECT', arg: C.TANK_NUMBERS[player][i] }));
      for (const action of ['FORWARD', 'BACK', 'TURN_L', 'TURN_R', 'WIN_L', 'WIN_R', 'FIRE', 'MINE', 'SMOKE']) {
        [].concat(side[action]).forEach((code) => this.map.set(code, { player, action }));
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
    const side = p === 0 ? C.KEYS.LEFT : C.KEYS.RIGHT;
    const l = [].concat(side.TURN_L).some((c) => this.down.has(c));
    const r = [].concat(side.TURN_R).some((c) => this.down.has(c));
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
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.',
  Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Esc', Space: 'Space',
};
export function keyLabel(code) {
  if (SPECIAL_LABELS[code]) return SPECIAL_LABELS[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}
