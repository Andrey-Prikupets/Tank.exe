# Tank.exe — Master Functional Specification

> Status: **RELEASE v1.0 Architecture**.  
> Architecture: 100% Static Client-Side Web Application (Zero Backend).  
> Detailed subsystem specifications are maintained in the modular [`docs/specs/`](./specs/) directory.

---

## 1. Vision & Core Concept

**Tank.exe** is a modern browser tribute to the golden era of 90s split-screen MS-DOS tank combat games. It captures the tension, tactile strategy, and split-second reflexes of two players competing either side-by-side on a **single shared keyboard** or across separate devices via **serverless peer-to-peer WebRTC**.

Rather than piloting a single vehicle, each player commands a **battalion of 15 tanks** (up to 5 active simultaneously on the battlefield, backed by 10 hangar reserves). The player time-slices attention between units; unselected tanks maintain their last commanded course and speed, turning the arena into a living multi-unit tactical engagement.

---

## 2. Design Goals

1. **Pure Squadron Warfare (Command over Driving):** Success demands coordinating multiple tanks across the field, establishing flanking ambushes, laying mine traps, managing ammunition, and cycling depleted tanks back to base hangars for rearmament.
2. **Authentic Tactile Physics & Hull Aiming:** Tanks feature a rigidly mounted main cannon. Turrets do not swivel independently; aiming requires tactical hull steering and pivot maneuvers.
3. **Zero-Backend, Air-Gapped Operation:** Loaded as a 100% static client-side web application from any static host or CDN. Operates completely offline without requiring accounts, databases, game servers, or internet access.
4. **Universal Accessibility & Performance:** Runs at a stable 60 FPS across mid-range laptops, Chromebooks, and mobile tablets using lightweight WebGL (Three.js) and 2D canvas rasterization with procedural textures and zero external asset downloads.
5. **Instant Local & P2P Multiplayer:** Supports single-keyboard local split-screen, human vs. computer, computer vs. computer simulation, and seamless serverless P2P network multiplayer via camera QR code scanning or messenger code exchange.

---

## 3. High-Level Feature Overview

| Feature Category | High-Level Summary | Detailed Sub-Spec |
|---|---|---|
| **World & Arena** | 250 m × 100 m bounded battlefield, team base hangars with automated sliding blast doors, optional procedural building obstacles and lethal water trenches. | [`specs/world_and_arena.md`](./specs/world_and_arena.md) |
| **Display & Viewports** | Shared top-down 2D strategic radar map (48% height) + dual first-person 3D cockpit viewports (52% height) with docked rounded visor HUD overlay. | [`specs/display_and_ui.md`](./specs/display_and_ui.md) |
| **Controls & Input** | Layout-independent `KeyboardEvent.code` mapping, dual Split-Screen vs Network desktop layouts, visual keyboard configurator, and 2-axis virtual analog touch joystick for mobile. | [`specs/controls_and_input.md`](./specs/controls_and_input.md) |
| **Vehicle & Combat** | Skid-steer acceleration, discrete speed & turn step ladders, persistence of motion, fixed-gun ballistics (one-shot kill shells), anti-tank mines, smoke screens, and hangar slit defense. | [`specs/vehicle_and_combat.md`](./specs/vehicle_and_combat.md) |
| **Battalion Logistics** | 15 tanks per side (5 field + 10 reserves), automatic number succession upon casualty, explicit forward deployment, and hangar rearming cycles. | [`specs/tank_lifecycle_and_hangar.md`](./specs/tank_lifecycle_and_hangar.md) |
| **Game Flow & Replays** | Title/Pause state machines, 10 `localStorage` save slots, draggable game-over debriefing card, and 10 Hz binary Deflate-compressed match recording with timeline scrubber. | [`specs/game_flow_and_recording.md`](./specs/game_flow_and_recording.md) |
| **Computer AI** | Autonomous three-tier command hierarchy (Brigade Commander $\to$ Urgency Dispatcher $\to$ Tactical Executor), dynamic window rollout (DWA), and 3 difficulty tiers. | [`specs/ai_system.md`](./specs/ai_system.md) |
| **Synthesized Audio** | 100% programmatic Web Audio API synthesis for cannon cracks, blasts, diesel hum, and pneumatic smoke hisses without external audio files. | [`specs/audio_system.md`](./specs/audio_system.md) |
| **P2P Multiplayer** | Serverless WebRTC DataChannel connectivity over UDP, QR code camera signaling, host-authoritative simulation sync, and automatic network layout. | [`specs/network_multiplayer.md`](./specs/network_multiplayer.md) |
| **Architecture & CI/CD** | Decoupled 60 Hz simulation, mandatory constants rule, Vite 6 build pipeline, and GitHub Actions continuous deployment. | [`specs/system_architecture_and_ci.md`](./specs/system_architecture_and_ci.md) |

---

## 4. Key Architectural Decisions

- **Client-Only Architecture:** The application contains zero server-side code. Assets are referenced with relative paths (`./`) so the build directory (`dist/`) can be served from any directory or filesystem.
- **Fixed-Timestep Decoupled Simulation:** Game physics and rules step at a strictly deterministic $60\text{ Hz}$ (`SIM_TICK_HZ = 60`), while Three.js visual rendering executes on `requestAnimationFrame()`. This ensures consistent physics across all devices and simplifies state serialization.
- **Single Source of Truth for Constants:** All tunable parameters, dimensional bounds, speeds, timings, colors, and key codes are strictly centralized in `src/constants.js`. Magic numbers in implementation code are strictly forbidden.
- **Authoritative Host P2P Topology:** In multiplayer sessions, the host runs the authoritative simulation loop, calculating collisions, projectile flights, and damage, while the client transmits input states and renders state snapshots.
- **Programmatic Procedural Generation:** All textures (turf, concrete, steel plates, water caustics) and audio sound effects are synthesized at runtime using HTML5 `<canvas>` and Web Audio API, minimizing bundle size and removing network asset dependencies.

---

## 5. Architectural Compromises & Trade-Offs

| Decision | Compromise Made | Rationale & Benefit |
|---|---|---|
| **Rigid Hull Cannon (No Swivel Turret)** | Players cannot aim freely with mouse/crosshair independently of vehicle heading. | Forces tactical positioning and authentic retro 90s feel; enables symmetrical shared-keyboard input without requiring two mice. |
| **Discrete Speed/Turn Steps** | Movement is ladder-based (e.g. 6, 18, 36 km/h) rather than continuous analog acceleration. | Allows players to tap commands and switch to another tank knowing exactly how the unattended unit will cruise; prevents unselected tanks from drifting unpredictably. |
| **Single Active Firing Unit** | Only the actively selected tank can fire; unselected tanks do not shoot automatically. | Preserves deep tactical choice: the player (and AI) must actively decide which tank's gun to operate, preventing chaotic automated bullet storms. |
| **Serverless QR / Messenger Signaling** | Requires players to scan a QR code or copy-paste an SDP string to establish a multiplayer match. | Avoids recurring server costs, maintenance, and privacy liabilities; enables fully air-gapped gameplay over local Wi-Fi or mobile hotspots. |
| **Software-Tuned 3D Graphics** | Uses low-poly geometry, flat shading, and `MAX_PIXEL_RATIO = 1.0` without heavy post-processing shaders. | Guarantees fluid 60 FPS execution on weak integrated GPUs, mobile tablets, and software WebGL rasterizers. |
| **Single Keyboard Sharing** | High-intensity keyboard mash can encounter hardware "ghosting" (dropped keys) on cheap keyboards. | Preserves the nostalgic couch co-op camaraderie of 90s gaming; mitigated by providing dedicated Network Multiplayer and mobile touch modes. |

---

## 6. System Boundaries & Constraints

1. **Squadron Scale:** Maximum of 15 total tanks per side (5 active on the field, 10 in hangar reserve).
2. **Arena Bounds:** Fixed arena dimensions of $250\text{ m} \times 100\text{ m}$ enclosed by solid perimeter walls.
3. **Multiplayer Limits:** Strictly 1-on-1 (2 players: Red vs. Blue).
4. **Storage Quotas:** Binary match recordings adapt dynamically to browser `localStorage` limits through automated oldest-unpinned pruning.
5. **No Wallhacks for AI:** Autonomous AI controllers obey the exact same line-of-sight restrictions as humans; smoke screens completely obscure targets from AI targeting.

---

## 7. Modular Sub-Specifications Directory

For complete algorithmic formulas, geometry parameters, protocol specifications, and constants, refer to the individual sub-documents:

| Sub-Document | Scope & Contents |
|---|---|
| [`specs/world_and_arena.md`](./specs/world_and_arena.md) | Arena boundaries, coordinate frames, gate geometry, sliding blast doors, building obstacles, and lethal water pits. |
| [`specs/display_and_ui.md`](./specs/display_and_ui.md) | Screen layout proportions, 2D strategic canvas radar, Three.js 3D cockpit views, in-viewport rounded inventory HUD, and menu systems. |
| [`specs/controls_and_input.md`](./specs/controls_and_input.md) | Keyboard mapping tables, Split-Screen vs. Network layouts, visual desktop configurator, and mobile virtual analog joystick. |
| [`specs/vehicle_and_combat.md`](./specs/vehicle_and_combat.md) | Vehicle kinematics, discrete step ladders, persistence of motion, OBB collisions, shell ballistics, mines, smoke, and hangar slit guns. |
| [`specs/tank_lifecycle_and_hangar.md`](./specs/tank_lifecycle_and_hangar.md) | Initial squadron setup, numbering succession, explicit forward deployment, gate blocking, rearming cycles, and lifecycle invariants. |
| [`specs/game_flow_and_recording.md`](./specs/game_flow_and_recording.md) | Match state machine, win/draw conditions, draggable statistics modal, startup query parameters, save/load, and binary replay engine. |
| [`specs/ai_system.md`](./specs/ai_system.md) | Three-tier command architecture, urgency scoring, dynamic window rollout (DWA), mine/smoke tactics, difficulty tiers, and telemetry. |
| [`specs/ai_strategic_control_plan.md`](./specs/ai_strategic_control_plan.md) | Detailed operational brigade control reference, doctrines, role waypoints, and plan transition state machines. |
| [`specs/ai_improvement_tasks.md`](./specs/ai_improvement_tasks.md) | Historical task roadmap and verification metrics for the AI autonomous control framework. |
| [`specs/audio_system.md`](./specs/audio_system.md) | Web Audio programmatic synthesis specifications, oscillator envelopes, noise filters, and spatial stereo panning. |
| [`specs/network_multiplayer.md`](./specs/network_multiplayer.md) | Serverless WebRTC DataChannel protocol, QR code / messenger signaling, SDP Deflate compression, and authoritative host sync. |
| [`specs/system_architecture_and_ci.md`](./specs/system_architecture_and_ci.md) | Codebase directory layout, constants rule, non-functional performance benchmarks, master constants summary, and CI/CD pipelines. |
