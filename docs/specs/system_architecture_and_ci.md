# System Architecture, Technical Decisions & CI/CD

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Technology Stack & Design Decisions

| Category | Decision | Rationale |
|---|---|---|
| **Target Platform** | Modern Desktop & Mobile Browsers (Chrome, Edge, Firefox, Safari) | Universal zero-install distribution |
| **Architecture** | 100% Static Client-Side Web Application | Loaded from any server or CDN using relative asset paths (`./`) with zero backend |
| **Language** | Vanilla JavaScript (ES Modules), HTML5, Vanilla CSS | Maximum transparency, zero framework lock-in, fast compile |
| **3D Engine** | Three.js (r160+) | Hardware-agnostic WebGL rendering with fallback support for software renderers |
| **2D Engine** | HTML5 `<canvas>` 2D Context | High-performance rasterization of the strategic radar map and UI icons |
| **Audio** | Programmatic Web Audio API Synthesis | Deterministic audio generation without external sound sample files |
| **Build System** | Vite 6 | Rapid development server, automated production tree-shaking, static asset bundling |
| **Networking** | WebRTC `RTCDataChannel` | True peer-to-peer UDP connectivity without relay servers |
| **Signaling** | Camera QR Code Scan (`uqr`) & Clipboard / Share | Serverless signaling operable across air-gapped or local networks |
| **Persistence** | Browser `localStorage` | Client-side storage of 10 save slots, settings, and binary match recordings |
| **Deployment** | GitHub Actions & GitHub Pages | Automated continuous deployment upon pushes to `main` |

---

## 2. Directory Structure & Module Architecture

```
Tank.exe/
├── index.html                  # HTML entry point, layout viewports & UI modals
├── vite.config.js              # Vite build configuration & version injection
├── package.json                # Project dependencies (three, uqr)
├── docs/                       # Project documentation
│   ├── functional_spec.md      # Master functional specification
│   └── specs/                  # Modular sub-specifications
│       ├── world_and_arena.md
│       ├── display_and_ui.md
│       ├── controls_and_input.md
│       ├── vehicle_and_combat.md
│       ├── tank_lifecycle_and_hangar.md
│       ├── game_flow_and_recording.md
│       ├── ai_system.md
│       ├── ai_strategic_control_plan.md
│       ├── ai_improvement_tasks.md
│       ├── audio_system.md
│       ├── network_multiplayer.md
│       └── system_architecture_and_ci.md
└── src/
    ├── constants.js            # Mandatory single source of truth for all game constants
    ├── main.js                 # Application bootstrap & decoupled main loop
    ├── input.js                # Keyboard & mobile touch input controller
    ├── net.js                  # WebRTC P2P networking, QR signaling, state sync
    ├── sim/                    # Pure deterministic simulation
    │   ├── world.js            # Simulation state container & lifecycle
    │   ├── tank.js             # Vehicle kinematics & acceleration
    │   ├── collision.js        # OBB collision resolution & hazard triggers
    │   ├── weapons.js          # Projectile ballistics, mines, smoke
    │   ├── hangar.js           # Numbering, reserves, gate doors, rearming
    │   ├── recording.js        # Binary match recorder & playback interpolator
    │   ├── nav.js              # Kinematic navigation grid, DWA rollout, gate mutex
    │   └── ai/                 # AI strategic brigade control hierarchy
    │       ├── controller.js   # Orchestration & high-level state
    │       ├── commander.js    # Tier 1: casualty monitoring, strategic plans, roles
    │       ├── dispatcher.js   # Tier 2: urgency time-slicing
    │       ├── executor.js     # Tier 3: target selection, tactical aiming, reflexes
    │       ├── slit.js         # Hangar slit window defense
    │       ├── roles.js        # Doctrines & tactical waypoints
    │       ├── urgency.js      # Urgency scoring & safe cruising trim
    │       ├── perception.js   # Smoke line-of-sight & enemy tracking
    │       ├── weapons.js      # Weapon firing reflex
    │       ├── profiles.js     # Difficulty level settings
    │       └── decision_log.js # Timestamped AI decision logger
    ├── render/                 # Visual rendering pipeline
    │   ├── map2d.js            # 2D strategic radar canvas rendering
    │   ├── view3d.js           # Three.js 3D cockpit views & slit apertures
    │   ├── textures.js         # Procedural canvas textures generator
    │   └── hud.js              # In-viewport rounded cockpit inventory overlay
    ├── audio/
    │   └── sfx.js              # Web Audio synthesized sound generator
    ├── ui/
    │   ├── menu.js             # Menus, modals, and screen navigation
    │   └── keyboard_layout.js  # Interactive desktop keyboard visual configurator
    ├── help/                   # Multilingual help manuals (EN, ES, RU)
    └── history/                # Multilingual lore and game history (EN, ES, RU)
```

---

## 3. Mandatory Coding Conventions

### 3.1 Single Source of Truth for Constants
- **Strictly No Magic Numbers in Code:** All tunable gameplay metrics, dimensional constants, timings, speeds, colors, and layout configurations reside exclusively in `src/constants.js`.
- **Human-Readable Units:** Constants are declared with physical unit suffixes (`TANK_MAX_SPEED_KMH`, `SMOKE_LIFETIME_S`, `TANK_LENGTH_M`, `WINDOW_MAX_YAW_DEG`).
- **Standardized Conversion Helpers:** Unit conversions to internal SI units (m/s, rad, rad/s) occur once via helper functions in `constants.js` (e.g. `kmhToMs()`), never inline with literals.

### 3.2 Decoupled Simulation & Rendering
- The physics simulation advances at a fixed timestep (`SIM_TICK_HZ = 60Hz`, $dt \approx 16.66\text{ ms}$).
- Rendering is decoupled via `requestAnimationFrame()`, allowing smooth display interpolation regardless of monitor refresh rate.
- Deterministic simulation logic facilitates save/load state recreation and lossless replay streaming.

---

## 4. Non-Functional Requirements & Performance Targets

- **Frame Rate Target:** Consistent 60 FPS on mid-range laptop hardware with integrated graphics at $1920 \times 1080$.
- **Software WebGL Compatibility:** Optimized for environments lacking hardware acceleration:
  - `MAX_PIXEL_RATIO = 1.0`
  - `antialias: false`
  - `RENDER_TARGET_FPS = 45`
- **Render Caching & Power Saving:** Skips 3D scene rendering during title/pause menus when the simulation is stationary.
- **Resource Cleanup:** Web Audio oscillator and filter nodes are aggressively disposed when finished to avoid audio context memory leaks.

---

## 5. Master Constants Summary

| Constant | Value | Unit | Description |
|---|---|---|---|
| `SIM_TICK_HZ` | 60 | Hz | Fixed simulation tick rate |
| `FIELD_LENGTH_M` | 250 | m | Arena length |
| `FIELD_WIDTH_M` | 100 | m | Arena width |
| `TANK_LENGTH_M` / `WIDTH_M` / `HEIGHT_M` | 6 / 4 / 2.5 | m | Tank hull dimensions |
| `GATE_WIDTH_M` | 7 | m | Gate doorway opening |
| `TANKS_ON_FIELD_MAX` | 5 | units | Active field tank limit per player |
| `HANGAR_ROWS` × `SLOTS_PER_ROW` | 2 × 5 | slots | Reserve hangar capacity (10 per side) |
| `TANKS_PER_PLAYER` | 15 | units | Total living + reserve tanks |
| `TANK_MAX_SPEED_KMH` | 36 | km/h | Top forward speed (3rd step) |
| `TANK_MAX_REVERSE_KMH` | 6 | km/h | Top reverse speed (1st step) |
| `TANK_SPEED_STEPS_KMH` | `[-6, 0, 6, 18, 36]` | km/h | Discrete speed ladder |
| `TANK_MAX_TURN_DEG_S` | 45 | °/s | Maximum turn rate while moving |
| `TANK_MAX_PIVOT_TURN_DEG_S` | 30 | °/s | Maximum turn rate while stationary |
| `TURN_STEP_DEG_S` | 15 | °/s | Discrete steering increment |
| `TANK_TURN_ACCEL_DEG_S2` | 30 | °/s² | Turn rate acceleration (0.5s per step) |
| `KEY_REPEAT_MS` | 150 | ms | Command repeat interval on held key |
| `BORDER_DRAG_FACTOR` | 0.5 | factor | Wall contact speed/turn scale |
| `TANK_CONTACT_TURN_FACTOR` | 0.5 | factor | Vehicle contact turn rate scale |
| `TANK_START_SHELLS` / `MINES` / `SMOKES` | 5 / 2 / 2 | units | Default inventory per unit |
| `GUN_RELOAD_S` | 1.0 | s | Cannon reload delay |
| `WINDOW_RELOAD_S` | 1.5 | s | Slit gun reload delay |
| `SHELL_RANGE_M` | 32 | m | Default maximum shell reach |
| `SHELL_FLIGHT_TIME_S` | 0.4 | s | Shell flight time to maximum reach |
| `MINE_ARM_DELAY_S` | 1.5 | s | Arming delay after drop |
| `MINE_TRIGGER_RADIUS_M` | 1.0 | m | Mine contact trigger radius |
| `SMOKE_RADIUS_M` | 10 | m | Smoke screen radius |
| `SMOKE_LIFETIME_S` | 10 | s | Smoke duration before disappearance |
| `WINDOW_MAX_YAW_DEG` | 45 | ° | Slit window traverse limit |
| `WINDOW_YAW_RATE_DEG_S` | 30 | °/s | Maximum slit window traverse rate |
| `SAVE_SLOT_COUNT` | 10 | slots | Number of `localStorage` save slots |

---

## 6. Architecture Decisions Log (ADR)

| Ref | Topic | Decision & Rationale |
|---|---|---|
| **A1** | Rendering & Visuals | Procedural textures (ground turf, concrete, steel, armored plating) enabled by default; user-toggleable in Options to flat solid colors. |
| **A2** | Build Tooling | Vite + Three.js bundled from npm; deterministic scripts `build.cmd`, `dev.cmd`, `preview.cmd`. |
| **A3** | Battlefield Hazards | Unobstructed green field by default; procedural building obstacles and water pits toggled via Options. |
| **A4** | Display Baseline | Minimum display baseline $1280 \times 720$ with responsive CSS flex/grid scaling. |
| **A5** | Mine Visibility | Anti-tank mines are visible on both the 2D map and 3D viewports to both players. |
| **A6** | Smoke Mechanics | Smoke screens block 3D vision and radar map icons; shells pass through smoke without detonating. |
| **A7** | Weapon Mounting | Main cannon is rigidly mounted to the hull (aiming requires steering/pivoting the entire tank). |
| **A8** | Movement Control | Discrete speed and turn steps with 0.5s transition times; holding keys repeats steps. |
| **A9** | Contact Dynamics | Wall collisions apply drag reduction; commanded speed and turn settings are preserved. |
| **A10** | Gun Reload Delay | 1.0-second fixed reload cooldown between shell firings. |
| **A11** | Friendly Fire | Shells and mines damage both friendly and enemy units indiscriminately. |
| **A14** | Hangar Window Fire | Slit apertures feature unlimited ammunition restricted only by reload cooldown. |
| **A15** | Window Ballistics | Direct ballistic line of sight without artificial gate immunity zones. |
| **A18** | Rearm Logistics | Driving into home gate enters hangar, zeroes speed, refills ammunition, and requires explicit Forward command to redeploy. |
| **A19** | Audio System | 100% programmatic Web Audio synthesis without static audio asset files. |
| **A20** | Building Architecture | Procedural obstacles feature conical/hipped roofs with eaves and variation in wall shading. |
| **A21** | Menu Typography | Game Mode submenu presents all player modes simultaneously with clean sans-serif secondary descriptors and fixed responsive card widths. |

---

## 7. CI/CD & Deployment Pipeline

- **GitHub Actions Workflow:** Deployments to GitHub Pages are managed via `.github/workflows/deploy.yml` on pushes to `main` or manual trigger.
- **Dependency Management:** Pipeline executes `npm install --no-audit --no-fund` with dependency caching keyed on `package.json`.
- **Lockfile Policy:** `package-lock.json` is excluded via `.gitignore` to prevent environment divergence issues across different OS environments.
- **Automatic Versioning:** Injects automated commit-based version counters (`v0.1.<commit_count>`) directly from git history into the application title menu.
