import * as C from '../constants.js';
import { selectedTank } from '../sim/world.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try {
      const s = JSON.parse(localStorage.getItem(C.AUDIO_SETTINGS_KEY) || '{}');
      if (s.enabled === false) this.enabled = false;
    } catch {
      /* ignore */
    }
  }

  /** Must be called from a user gesture. */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? C.AUDIO_MASTER_VOLUME : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.engines = [0, 1].map((p) => this.makeEngine(p));
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem(C.AUDIO_SETTINGS_KEY, JSON.stringify({ enabled: this.enabled }));
    if (this.master) this.master.gain.value = this.enabled ? C.AUDIO_MASTER_VOLUME : 0;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    localStorage.setItem(C.AUDIO_SETTINGS_KEY, JSON.stringify({ enabled: this.enabled }));
    if (this.master) this.master.gain.value = this.enabled ? C.AUDIO_MASTER_VOLUME : 0;
  }

  panner(pan) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  makeEngine(p) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = C.AUDIO_ENGINE_BASE_HZ;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = C.AUDIO_ENGINE_LOWPASS_HZ;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(lp).connect(gain).connect(this.panner(p === 0 ? -C.AUDIO_PAN_STRENGTH : C.AUDIO_PAN_STRENGTH));
    osc.start();
    return { osc, gain, lastFreq: -1, lastGain: -1 };
  }

  updateEngines(world, playing) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    for (const p of [0, 1]) {
      const t = selectedTank(world, p);
      const active = playing && t && t.status === 'field' && world.players[p].view === 'tank';
      const ratio = active ? Math.abs(t.speed) / C.kmhToMs(C.TANK_MAX_SPEED_KMH) : 0;
      const g = active ? C.AUDIO_ENGINE_IDLE_GAIN + ratio * C.AUDIO_ENGINE_GAIN : 0;
      const freq = C.AUDIO_ENGINE_BASE_HZ + ratio * C.AUDIO_ENGINE_SPEED_HZ;
      const eng = this.engines[p];
      if (Math.abs(eng.lastFreq - freq) > 0.5 || Math.abs(eng.lastGain - g) > 0.002) {
        eng.lastFreq = freq;
        eng.lastGain = g;
        eng.osc.frequency.setTargetAtTime(freq, now, C.AUDIO_ENGINE_SMOOTH_S);
        eng.gain.gain.setTargetAtTime(g, now, C.AUDIO_ENGINE_SMOOTH_S);
      }
    }
  }

  burst({ pan, dur, freq, gain, thumpHz }) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, now);
    f.frequency.exponentialRampToValueAtTime(60, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    const out = this.panner(pan);
    src.connect(f).connect(g).connect(out);
    src.start(now, 0, dur);

    let o = null;
    let og = null;
    if (thumpHz) {
      o = ctx.createOscillator();
      o.frequency.setValueAtTime(thumpHz, now);
      o.frequency.exponentialRampToValueAtTime(30, now + dur);
      og = ctx.createGain();
      og.gain.setValueAtTime(gain, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.connect(og).connect(out);
      o.start(now);
      o.stop(now + dur);
    }

    const cleanup = () => {
      try {
        src.disconnect();
        f.disconnect();
        g.disconnect();
        out.disconnect();
        if (o) {
          o.disconnect();
          og.disconnect();
        }
      } catch {
        /* ignore */
      }
    };
    src.onended = cleanup;
    setTimeout(cleanup, Math.round((dur + 0.15) * 1000));
  }

  tone(pan, hz, dur, gain) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    const out = this.panner(pan);
    o.connect(g).connect(out);
    o.start(now);
    o.stop(now + dur);

    const cleanup = () => {
      try {
        o.disconnect();
        g.disconnect();
        out.disconnect();
      } catch {
        /* ignore */
      }
    };
    o.onended = cleanup;
    setTimeout(cleanup, Math.round((dur + 0.15) * 1000));
  }

  play(e) {
    if (!this.ctx || !this.enabled) return;
    const pan = (e.x / C.FIELD_LENGTH_M) * 2 - 1;
    switch (e.type) {
      case 'shot':
        this.burst({ pan, dur: C.AUDIO_SHOT_DURATION_S, freq: 3000, gain: 0.8, thumpHz: 140 });
        break;
      case 'boom':
        this.burst({ pan, dur: C.AUDIO_EXPLOSION_DURATION_S, freq: 1800, gain: 1, thumpHz: 90 });
        break;
      case 'mineBoom':
        this.burst({ pan, dur: C.AUDIO_MINE_EXPLOSION_DURATION_S, freq: 1400, gain: 1, thumpHz: 70 });
        break;
      case 'smoke':
        this.burst({ pan, dur: 0.6, freq: 6000, gain: 0.25 });
        break;
      case 'mine':
        this.tone(pan, 900, 0.05, 0.2);
        break;
      case 'blocked':
        this.tone(pan, 220, 0.2, 0.25);
        break;
      case 'rearm':
        this.tone(pan, 660, 0.12, 0.2);
        break;
      case 'splash':
        this.burst({ pan, dur: 0.8, freq: 700, gain: 0.95, thumpHz: 55 });
        break;
      default:
    }
  }
}
