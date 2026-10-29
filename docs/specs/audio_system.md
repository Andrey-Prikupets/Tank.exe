# Synthesized Audio Subsystem

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Architectural Principles

- **Zero External Audio Assets:** The game relies 100% on programmatic sound synthesis using the browser's native **Web Audio API** (`AudioContext`). No audio samples (`.mp3`, `.wav`, `.ogg`) are packaged, downloaded, or cached.
- **Instant Load & Zero Latency:** Sound generation is instantaneous and deterministic with zero network fetch latency.
- **Autoplay Compliance:** AudioContext is initialized lazily upon the user's first trusted interaction (keypress or click), conforming to browser autoplay security policies.

---

## 2. Synthesized Sound Effects

All sound effects are generated programmatically via oscillators, noise buffers, and dynamic gain/filter envelopes:

| Sound Effect | Synthesis Method | Acoustic Character | Trigger Condition |
|---|---|---|---|
| **Cannon Shot** | White noise burst + low exponential sine wave thump | Crisp artillery crack ($0.2\text{s}$) | Main cannon or slit gun firing |
| **Tank Explosion** | Bandpass filtered noise decay with low rumble | Heavy mechanical blast ($1.0\text{s}$) | Tank destruction by shell or mine |
| **Aquatic Splash** | Low-pass filtered noise burst with resonance dip | Liquid splash detonation ($0.8\text{s}$) | Tank driving into water pit |
| **Mine Arming / Drop** | High-frequency square pulse click | Metallic arming click | Releasing anti-tank mine |
| **Smoke Release** | Soft pink noise envelope with gradual release | Prolonged pneumatic hiss ($2.5\text{s}$) | Canister deployment |
| **Gate Blocked** | Short dual-tone square beep | Warning alarm tone | Attempting deployment into blocked gateway |
| **Engine Hum** | Continuous dual sawtooth oscillator + low-pass filter | Throaty diesel engine vibration | Active tank cruising or turning |

---

## 3. Spatial Panning & Volume Controls

- **Stereo Spatial Panning:**
  - Engine hum and combat cues for the **Left Player (Red)** are panned to the left audio channel (`StereoPannerNode.pan = -0.6`).
  - Engine hum and combat cues for the **Right Player (Blue)** are panned to the right audio channel (`StereoPannerNode.pan = +0.6`).
  - Common arena alerts and distant explosions are centered.
- **Engine Pitch Modulation:** Engine hum fundamental frequency scales dynamically with current linear velocity ($\propto |v|$).
- **Master Audio Settings:**
  - Configurable via the **Options** menu (`Sound: ON | OFF`) and URL query string (`?sound=N`).
  - Master gain (`AUDIO_MASTER_VOLUME`) and mute states are persisted to `localStorage` under `tank.exe.sound`.
  - When muted, audio nodes are disconnected or bypassed to conserve CPU cycles.
