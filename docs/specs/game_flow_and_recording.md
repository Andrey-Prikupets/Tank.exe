# Game Flow, Persistence & Match Recording

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Game State Machine

The top-level state machine governs transitions between screens and matches:

```
+------------+       Start / Resume       +-------------+
| TITLE MENU | -------------------------> |   PLAYING   |
+------------+                            +-------------+
      ^                                       |     ^
      | Quit                                  | Esc | Resume
      |                                       v     |
+------------+       Match Lost / Won     +-------------+
| GAME OVER  | <------------------------- | PAUSED MENU |
+------------+                            +-------------+
```

---

## 2. Win, Loss & Draw Conditions

- **Victory Condition:** A player loses when all **15 of their tanks** are destroyed. The surviving player is declared the winner.
- **Draw Condition:** If both players lose their final living tank within the exact same simulation tick, the match ends in a **DRAW**.
- **Game Over Screen Presentation:**
  - The tactical battlefield (2D strategic radar and 3D split-screen viewports) remains visible beneath a gentle desaturated tint (`grayscale(45%) contrast(85%)`) with a high-transparency overlay (`rgba(8, 12, 10, 0.21)`), allowing players to inspect final tank wrecks.
  - A floating combat statistics card appears, detailing side-by-side squadron telemetry:
    - Tanks Lost ($/ 15$)
    - Shots Fired
    - Direct Hits
    - Accuracy Percentage
  - **Draggable Modal:** The statistics card can be clicked and dragged anywhere on the screen by its header or background, allowing full visual debriefing of any obscured arena section while keeping *New Game* and *Main Menu* action buttons accessible.

---

## 3. Startup Query String Parameters

Allows configuring parameters and launching directly into matches via URL:

| Parameter | Values | Default | Description |
|---|---|---|---|
| `mode` | `HvH`, `HvC`, `CvH`, `CvC`, `HvH_NET` | `HvH` | Initial combat player mode |
| `level` | `EASY`, `MEDIUM`, `HARD` | `MEDIUM` | AI difficulty skill level |
| `sound` | `Y`, `N` | `Y` | Web Audio sound synthesis |
| `textures` | `Y`, `N` | `Y` | Procedural surface textures |
| `obstacles` | `Y`, `N` | `N` | Central building obstacles generator |
| `pits` | `Y`, `N` | `N` | Water pit / trench hazards generator |
| `recording` | `Y`, `N` | `N` | Real-time binary match recording |
| `shootDist` | Number (e.g. `50`) | `32` | Maximum shell range in metres |
| `debugVectors` | `Y`, `N` | `N` | Barrel aim vectors on 2D map |
| `mobile` | `Y`, `N` | Auto | Forces mobile touch controls |
| `lang` | `EN`, `ES`, `RU` | Browser | Pre-selects language for Help/History |
| `start` | `Y`, `N` | `N` | Bypasses title menu directly into match |

*Example:* `http://localhost:5174/?mode=HvC&level=HARD&recording=Y&start=Y`

---

## 4. LocalStorage Save / Load System

- **Slot Allocation:** 10 dedicated save slots stored under `tank.exe.save.<slot>` (1..10).
- **Snapshot Contents:** Deterministic, versioned JSON snapshot capturing:
  - All 15 tanks per side (positions, headings, speeds, turns, commands, inventories, status, hangar coordinates).
  - Projectiles in flight, deployed mines, active smoke screens, explosion animations.
  - Gate door positions, slit window yaws, player selections, viewport modes.
  - Game timers, combat statistics, and `SAVE_FORMAT_VERSION`.
- **Validation:** Snapshot format versions are verified upon loading; incompatible versions fail gracefully with an error modal.

---

## 5. Match Recording & Playback System (`Game playback`)

A deterministic, high-performance binary recording and playback engine:

### 5.1 Real-Time Binary Serialization & Compression
- **Sampling Rate:** Active match entities (tanks, shells, mines, smokes, gates, slit angles, explosions) are sampled at $10\text{ Hz}$ (`REPLAY_SAMPLE_HZ = 10`, $dt = 0.1\text{s}$) into an expandable binary `ArrayBuffer` via `DataView`.
- **Deflate Compression:** At match conclusion, the binary stream is compressed using native `CompressionStream('deflate-raw')` and serialized to Base64.
- **Extreme Space Efficiency:** Matches compress to only $\approx 20\text{--}30\text{ KB}$ per 90-second game, accommodating hundreds of stored matches within standard browser `localStorage` limits.

### 5.2 Dynamic Quota & Pinning Protection
- **Automatic Pruning:** If a `QuotaExceededError` occurs when saving a match, the system automatically purges the oldest unpinned match and retries saving.
- **Pinning (`📌`):** Players can pin valuable replays. Pinned matches are permanently immune to automatic pruning. Deleting a pinned match requires explicit confirmation.

### 5.3 Match Replays Grid Modal
Accessed from the Title Menu via **Game playback**:
- Sorted strictly by datetime descending (newest match first).
- Filter toggle: `[ ] Show only pinned recordings`.
- **Import Button (`📥 Import (.sav)`):** Allows loading `.sav` match recordings from disk or device storage directly into `localStorage`. Also supports drag-and-drop onto the modal.
- Telemetry Columns: Pin toggle (`📌`), Date & Time, Duration (`MM:SS`), Game Mode & Shooting Distance, Outcome & Final Score badge, Actions (`▶ Play`, `📤 Export / Share`, `🗑 Delete`).
- Incomplete/aborted matches are categorized with a neutral `INCOMPLETE` badge rather than inheriting winning colors.

### 5.4 Playback Viewer & Floating Toolbar
- **Full-Fidelity Reproduction:** Re-simulates match with live interpolation across both 3D viewports and the 2D strategic map.
- **Terrain Preloading:** Obstacles and pits are preloaded directly from replay metadata, guaranteeing 100% terrain fidelity.
- **Floating Scrubber Toolbar:** Docked at bottom-center with:
  - Play / Pause toggle (`Space`).
  - Continuous seek slider track for instant scrubbing across the timeline without resimulation lag.
  - Playback speed multiplier (`1x` $\to$ `2x` $\to$ `0.5x`).
  - Time elapsed counter (`MM:SS / MM:SS`), pin toggle, export/share button (`📤`), and delete.
- **Auto-Hide with Jitter Filtering:** The toolbar slides down offscreen after 3 seconds of mouse inactivity. Mouse movements $< 4\text{ px}$ are ignored to prevent table vibration or sensor jitter from unhiding the bar.

### 5.5 Replay Export & Mobile Sharing (`.sav`)
- Players can export any recorded match from the Replays list (`ACTIONS` column) or directly from the active playback toolbar.
- **File Naming Specification:** `tank.<local_date-time>_<score>.sav` (e.g. `tank.2026-11-01_23-21-06_15-3.sav`), constructed deterministically from the recording's local timestamp and final score.
- **Mobile Web Share API:** On supported mobile devices (iOS/Android), invokes `navigator.share({ files: [file] })` to summon the native system share sheet (AirDrop, WhatsApp, Telegram, Files, etc.). Seamlessly falls back to direct browser file download on desktop.
- **Encapsulated JSON Save Structure:** Stores metadata together with the compressed binary Base64 frame payload under `magic: "TANK_RECORDING"`.

### 5.6 Replay Import & Verification (`.sav`)
- Players can import `.sav` replay files into browser `localStorage` using the **Import (.sav)** button or by dragging and dropping `.sav` files onto the Replays modal.
- **Integrity Verification:** Replay files are validated through real-time JSON decoding, binary magic check (`0x544e4b52`), Deflate decompression, and frame stream validation before saving. World state snapshots or corrupted files are rejected with explanatory notifications.
- **Instant Playback Availability:** Successfully imported replays are assigned collision-free identifiers and immediately listed in the table sorted by timestamp, ready for instant playback, timeline scrubbing, pinning, or re-exporting.
