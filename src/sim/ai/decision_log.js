import * as C from '../../constants.js';

/** Capped, de-duplicating, time-stamped log of AI decisions (shown in the side log panels). */
export class DecisionLog {
  constructor(clock) {
    this.clock = clock;
    this.entries = []; // { t, tag, msg }
    this.version = 0; // bumps on every change so the UI can skip redundant redraws
    this.memo = new Map();
  }

  /**
   * opts.key + opts.sig: skip when the same signature was already logged for that key
   * (unless opts.gap seconds have passed). With a gap, different signatures are rate-limited too.
   */
  add(tag, msg, opts = {}) {
    const { key, sig = msg, gap = 0 } = opts;
    const now = this.clock();
    if (key) {
      const m = this.memo.get(key);
      if (m) {
        if (m.sig === sig) {
          if (!gap || now - m.t < gap) return;
        } else if (gap && now - m.t < gap) {
          return;
        }
      }
      this.memo.set(key, { sig, t: now });
    }
    this.entries.push({ t: now, tag, msg });
    if (this.entries.length > C.AI_LOG_MAX_ENTRIES) this.entries.shift();
    this.version++;
  }

  clear() {
    this.entries.length = 0;
    this.memo.clear();
    this.version++;
  }
}
