# Tank.exe — Functional Specification

> Status: **DRAFT v0.3**. Incorporating **Tank.exe** branding, in-viewport rounded inventory HUD
> with graphical shell/mine/smoke icons, dual 1..5 numbering, scrollable Help modal, and Quit flow.

---

## 1. Overview

**Tank.exe** is a browser remake of a 90s split-screen 3D tank combat game for **two players sharing one keyboard**. The `.exe` extension evokes the golden era of 90s MS-DOS executable games.

- Each player commands up to **5 tanks on the field** and has **10 spare tanks** in a hangar
  (15 tanks total per player).
- **Initial Movement:** Tanks **do not** start moving automatically on game start. All tanks remain stationary at 0 km/h until commanded by player input.
- **Numbering:** Both Left and Right players have tanks numbered **1..5**.
  - Left player selects their tanks 1..5 using keys `1`, `2`, `3`, `4`, `5`.
  - Right player selects their tanks 1..5 using keys `6`, `7`, `8`, `9`, `0` (`6` selects Tank 1, `7` selects Tank 2, etc.).
- The screen shows a shared top-down **strategic map** (top half) and two first-person
  **3D views** (middle/bottom, one per player) with an integrated rounded HUD overlay.
- Players switch between their tanks instantly; unselected tanks **keep moving** with their
  last commanded linear and rotational speed.
- A player **loses** when all 15 of their tanks are destroyed.

---

## 2. Technology & Conventions

| Item | Decision |
|---|---|
| Platform | Desktop browser (Chrome, Edge, Firefox — latest). Keyboard only. |
| Architecture | **Zero backend, 100% static client-side web application**. Loaded as a static web page from any server or CDN (GitHub Pages, Netlify, Cloudflare Pages, S3 bucket) using relative asset paths (`./`). |
| Language | JavaScript (ES modules), HTML, vanilla CSS. |
| 3D | Three.js. **No textures** — solid colors, flat/Lambert shading. **[A1]** |
| Map | 2D `<canvas>` drawn each frame. |
| Build | Vite (`build.cmd` / `npm run build` generates standalone static files in `dist/`). **[A2]** |
| Simulation | Fixed timestep (`SIM_TICK_HZ`), rendering decoupled (requestAnimationFrame). Deterministic state → simple save/load. |
| Persistence | `localStorage`. |
| Deployment | Continuous Deployment to GitHub Pages on every commit to `main` via GitHub Actions. |
| Versioning | Automatic commit-based version counter (`v0.1.<commit_count>`) injected by Vite from git history and displayed in the game menu. |
| Performance | Optimized for software WebGL (no HW acceleration required): `MAX_PIXEL_RATIO = 1.0`, `antialias: false`, `RENDER_TARGET_FPS = 45`, static scene render skip when paused/on menus, and ephemeral Web Audio node disposal. |
| Favicon & Icons | In-game accurate blue tank (chamfered rectangular body, octagonal turret, cannon barrel, no tracks) diagonally oriented, prominent and lowered over battlefield green (`#3f9b3f`) background, crowned by widened retro yellow letters "EXE" across the top. Formats include scalable SVG (`favicon.svg`), multi-resolution ICO (`favicon.ico`), standard raster PNGs (`favicon-16x16.png`, `favicon-32x32.png`), and Apple Touch Icon (`apple-touch-icon.png`). The 64×64 SVG emblem is also integrated at the top of the multilingual Help manual modal. |

### 2.1 Constants rule (mandatory)

- **No magic numbers in code.** All tunable values live in **one file**: `src/constants.js`.
- Constants are expressed in **human units** with the unit in the name:
  `TANK_MAX_SPEED_KMH`, `SMOKE_LIFETIME_S`, `TANK_LENGTH_M`, `WINDOW_MAX_YAW_DEG`, etc.
- Conversion to internal units (m/s, rad, rad/s) is done once, in a helper next to the
  constants (e.g. `kmhToMs()`), never inline with literals.
- Key bindings are also constants (`KEYS.LEFT.FIRE = 'Tab'`, …).
- Colors are constants (`COLOR_LEFT_TEAM`, `COLOR_FIELD`, …).

---

## 3. World & Coordinate System

- Field: **250 m (X) × 100 m (Y on map / Z in 3D)**. Flat, solid green. No obstacles. **[A3]**
- Origin at top-left corner of the field on the map. +X → right, +Y → down on the map.
  In 3D: world X = map X, world Z = map Y, world Y = up.
- Field is enclosed by an impenetrable border (rendered in 3D as a low wall, `BORDER_WALL_HEIGHT_M`).
- **Left player** = red, owns the gate in the **left** border. **Right player** = blue, owns
  the gate in the **right** border.

### 3.1 Dimensions (initial values)

| Constant | Value | Notes |
|---|---|---|
| `FIELD_LENGTH_M` | 250 | |
| `FIELD_WIDTH_M` | 100 | |
| `TANK_LENGTH_M` | 6 | ≈ 2 map characters at 80-column scale (250 m / 80 ≈ 3.1 m/char) |
| `TANK_WIDTH_M` | 4 | |
| `TANK_HEIGHT_M` | 2.5 | 3D only |
| `GATE_WIDTH_M` | 7 | "about a tank size", must let a 4 m wide tank pass |
| `GATE_CENTER_Y_M` | 50 | vertically centered on each side border |

### 3.2 Gates & hangars

- Each side border has a gate opening of `GATE_WIDTH_M`, centered vertically.
- Behind each gate (outside the field) is that player's **hangar**: **2 vertical rows × 5 slots**
  = 10 slots. The row nearer the gate is the **inner row**, the other is the **outer row**.
- Hangars are drawn on the map in the margins left/right of the field.
- On either side of the gate, in the border wall, are two **hangar windows** (narrow, long
  horizontal slits) — one above the gate, one below it on the map (see §9).
- A player's gate is passable **only to that player's own tanks** and only when the hangar has a
  free slot (§10.3). To all other tanks, and when the hangar is full, the gate acts as wall.
- **Sliding doors:** each gate is **closed** by default (two door panels, `COLOR_GATE_DOOR`). The doors
  slide sideways into the wall (`GATE_OPEN_TIME_S` to fully open/close) **only** when needed:
  - a tank is being deployed from the hangar (opens, tank exits, doors close right after it clears
    the doorway `GATE_DOOR_CLEAR_M`);
  - an own tank drives toward its gate (within `GATE_APPROACH_M`) to rearm (§10.4), or stands in the doorway.
  Closed doors are a solid wall (tanks, shells). A tank can pass only when the opening is at least
  `GATE_PASSABLE_FRACTION` wide.
- **Hangar exposure:** while the doors are open, shells (from tanks or windows, friend or foe) fly through
  the opening into the hangar and **can destroy tanks parked inside** that are visible through it.
- **Gate pillars & non-overlapping geometry:** The gateway is framed by team-colored structural pillars positioned outside the gate opening width. Border walls meet the outer edges of the pillars flush with zero overlap, and sliding door panels operate within recessed wall pockets with vertical clearance to prevent coplanar Z-fighting/flashing.

---

## 4. Screen Layout

```
+-----------------------------------------------------------------+
| [hangar L] |               STRATEGIC MAP               | [hangar R] |   ~48%
|            |  (green field, red & blue tanks, shells,  |            |
|            |   mines, smoke, gates, windows)           |            |
+--------------------------------+--------------------------------+
|                                |                                |
|      LEFT PLAYER 3D VIEW       |      RIGHT PLAYER 3D VIEW      |   ~52%
|         (+ crosshair)          |         (+ crosshair)          |
|  [Rounded Inventory (Left)]    |   [Rounded Inventory (Right)]  |
+--------------------------------+--------------------------------+
```

- Map keeps the field aspect ratio 2.5:1 (plus hangar margins), letter-boxed if needed.
- Layout scales with window size; minimum supported resolution `MIN_SCREEN_W_PX × MIN_SCREEN_H_PX`
  (1280 × 720). **[A4]**

### 4.1 Strategic map

- Background: solid green (`COLOR_FIELD`) on field; outer canvas area is dark gray (`COLOR_OUTSIDE`). Hangar floor and walls are light gray (`COLOR_HANGAR_FLOOR`, `COLOR_HANGAR_WALL`). Border drawn as a thin line; gates as gaps.
- Tanks drawn as faceted bodies with 8 corners (chamfered corners from top view, to scale) with a short gun barrel
  extending forward directly from the **octagonal turret** head (`TURRET_RADIUS_M`), shaded in a darker team color.
  - Barrel length is compact (`BARREL_LENGTH_M = 2.4m`, overhang 0.2m) preventing it from touching hangar walls or neighboring tanks.
  - Left team red, right team blue.
  - **Selected tank** of each player drawn in a **brighter** shade of team color.
  - Tank **number digit** (1..5 for both teams) drawn large, bold, and centered **inside the octagonal turret** (always upright, drawn directly with analytical vector strokes to eliminate sub-pixel texture waving/jerking on refresh).
- Spare tanks drawn in their hangar slots; numbered spares show their digit (1..5), unnumbered ones are blank.
- Shells: small bright dots. Mines: small dark dots/crosses. **[A5]**
- Smoke clouds: gray filled circles drawn **above** tanks (tanks inside are hidden on the map). **[A6]**
- Hangar windows drawn as thin bars in the border; the window currently used by a player is highlighted.
- Explosions: short expanding orange circle.
- **Locked Target Arrows:** Thin directional arrows rendered on the map indicating currently locked targets (maximum 2 arrows: Red attacker to Blue target, and Blue attacker to Red target).
  - When a player (AI or active controller) has a locked target tank, a crisp line with a directional arrowhead is drawn from the selected active unit to the target tank's hull.
  - If the unit sits in a **hangar slit window**, the arrow originates directly from the active slit window on the outer wall (`startX = gateX`, `startY = windowY`).
  - Colors are team-specific (`COLOR_TARGET_ARROW_LEFT = #ff5544` for Left/Red, `COLOR_TARGET_ARROW_RIGHT = #4488ff` for Right/Blue) with width `MAP_TARGET_ARROW_WIDTH_PX`.
  - Arrow tips stop neatly at the target hull perimeter without obscuring unit numbers or turret geometry.

### 4.2 3D views

- Camera mounted on the selected tank at `CAMERA_HEIGHT_M` (2.0m), looking along the (fixed) gun,
  field of view `CAMERA_FOV_DEG`. Crosshair points squarely into the center-upper third of enemy turrets rather than their top roof plane.
- Gun **cannot rotate** relative to the hull — aim by turning the tank. **[A7]**
- **Crosshair** fixed in the center of the view.
- Rendering: solid shaded polygons, no textures. Green ground plane, solid sky color, dark gray outside environment, light gray hangar buildings, border walls,
  gates (closed sliding doors), low-poly tanks (faceted 8-corner hull without lower tracks,
  **octagonal turret with vertical edges, 25% taller** [`TURRET_HEIGHT_M = 1.25m`] + compact barrel) in team colors, shells
  (bright small spheres), mines (flat discs), smoke (opaque gray blobs that block line of sight),
  explosions (expanding orange/yellow spheres + debris boxes).
- **Smoke Cloud Visibility:** When inside a smoke cloud, visible distance is restricted to ~2m; visibility gradually decreases to zero at 2m via dense distance fog.
- **The view may show own-tank barrel tip at the bottom-center for orientation.**
- **Faceted 3D Shading & Optimized Directional Lighting:** All tanks, turrets, barrels, obstacles, roofs, and mines use flat-shaded materials (`MeshPhongMaterial` with `flatShading: true`, `shininess: 12`, `specular: 0x222222`), producing distinct, readable shading on all 8 hull corners and octagonal turret facets. The primary directional sun light is positioned at an elevated lateral diagonal angle (`x: 0.25, y: 0.9, z: 0.75`), illuminating the top and side of both east- and west-bound tanks equally without blinding either player. A balanced cool ambient fill (`0.65`) and secondary soft fill light (`0.3` at `(-0.25, 0.6, -0.6)`) ensure shadowed facets remain legible and defined.
- **Slit Window Depth Stability:** Ground plane rendering uses high WebGL depth precision (`highp`), polygon offset on the combat arena floor, and a recessed outside terrain elevation (`y = -1.0m`) to prevent z-fighting flicker when viewing grazing angles through hangar slit apertures.

### 4.3 In-Viewport Rounded Inventory Overlay

The inventory is rendered **not** as a separate text table under the viewport, but as a **compact overlay inside the bottom of each tank's 3D viewport** inside a semi-transparent rounded frame (`border-radius: 8px`, dark cockpit visor style):
- **Two-Row Compact Layout:**
  - **1st row:** Ammo shells (horizontal row of vertically standing artillery shells).
  - **2nd row:** Mines and Smoke clouds separated by a thin vertical divider.
- **50% Reduced Spacing:** Distance between ammo shells and between elements is reduced by 50% (3px icon spacing, 4px padding) to minimize screen obstruction.
- **Left player's overlay:** docked at the bottom-left of the left 3D viewport; elements left-aligned.
- **Right player's overlay:** docked at the bottom-right of the right 3D viewport; elements right-aligned.
- **Pure Graphical Icons (No Text Labels):**
  - **Shells:** Vertically standing artillery projectile silhouettes (bright brass/yellow when available, ghost outline when expended).
  - **Anti-Tank Mines:** Isometric anti-tank mine seen from side and up angle with cylindrical casing depth, stepped concentric pressure plate, central arming fuze cap, and carry bracket.
  - **Smoke Clouds:** Non-symmetric organic billowing cloud silhouette embedded within a 1:1 square icon frame.
  - **No text labels:** Words such as `AMMO`, `MINES`, `SMOKE`, `RED`, or `BLUE` are strictly omitted.
  - **No tank numbers** in the inventory frame.
- **Bottom Screen Telemetry Removed:** Bottom debug strip telemetry is omitted to dedicate maximum vertical viewport height to the 3D battlefield.

Inventory is **per tank**.

## 5. Controls

Uses `KeyboardEvent.code` (layout-independent). All game keys call `preventDefault()`.

| Action | Left player | Right player |
|---|---|---|
| Select tank | `1` `2` `3` `4` `5` | `6` `7` `8` `9` `0` |
| Accelerate (step up) | `W` | `↑` |
| Decelerate / reverse (step down) | `S` | `↓` |
| Turn left (step) | `A` | `←` |
| Turn right (step) | `D` | `→` |
| Left hangar window | `Q` | `[` |
| Right hangar window | `E` | `]` |
| Fire | `Tab` | `Enter` (main + numpad) |
| Drop mine | `Z` | `,` (`<` key) |
| Release smoke | `X` | `.` (`>` key) |
| Menu / pause | `Esc` (shared) | |

- "Left/right window" is relative to looking **out of the gate into the field**:
  - Left player (looking +X): left = upper window on map, right = lower window.
  - Right player (looking −X): left = lower window on map, right = upper window.
- **[A8] Discrete steps:** each key press changes the **commanded** speed by one step
  (`SPEED_STEP_KMH`, `TURN_STEP_DEG_S`). Holding a key repeats the step every `KEY_REPEAT_MS`
  (own repeat logic; OS auto-repeat ignored).

### 5.1 Known keyboard caveats
- **Tab**: browser default (focus change) is always suppressed with `preventDefault()`, so Tab
  never moves focus away from the game (also in menus).
- **Key ghosting**: cheap keyboards may drop simultaneous keys. Not solvable in software; noted
  in the help screen.

### 5.2 Keyboard Layout Configuration Screen
- Accessible via **Options → Keyboard Layout**.
- **Non-colliding Function Overlays:** Mapped key overlays use rich team-colored shading with bottom-aligned, compact function badges (`8px`, single-line nowrap) shifted downward, while base key labels (letters, digits, modifiers) remain crisp and prominently visible at the top without visual collision (e.g., `ACCEL` cleanly under `W`).
- **Immediate Drag-and-Drop:** Keys can be dragged immediately on first mousedown drag from either the bottom function palettes or from already mapped keyboard keycaps without requiring a prior selection click.
- **Click-to-Bind:** Alternatively, clicking a function badge and then clicking a virtual keycap or pressing any physical keyboard key binds the action.

### 5.3 Mobile Touch Controls & Ergonomic Side-by-Side Adaptation
- **Touch & Hardware Keyboard Detection:**
  - Touch-first environments are detected via `'ontouchstart'`, `navigator.maxTouchPoints > 0`, and CSS `(pointer: coarse)`.
  - On touch-only devices without a physical keyboard, the **Keyboard layout** option is omitted from the Options menu.
  - A global physical `keydown` listener dynamically detects connected hardware keyboards (e.g. iPad Magic Keyboard or external USB/Bluetooth keyboards), immediately revealing the Keyboard layout menu upon first hardware keypress.
  - An explicit toggle (**Options → Touch controls: AUTO | ON | OFF**) allows players to force touch controls on or off as desired.
- **Natural Two-Hand Ergonomic Arrangement:**
  - **Human vs Human (`HvH` - Side-by-Side Shared Screen):**
    - **Left Player (Red, `#pane0`):** Movement controls (virtual joystick + `[STOP]`) and fire/weapons controls clustered on the left; non-interactive Cockpit Inventory HUD (`#inv0`) shifted to the right edge of `#pane0` (near the center seam).
    - **Right Player (Blue, `#pane1`):** Movement and fire/weapons controls clustered on the right of `#pane1`; non-interactive Cockpit Inventory HUD (`#inv1`) shifted to the left edge of `#pane1` (near the center seam).
    - **Center Seam Clearance:** Keeps both players' active thumbs at the outer corners, preventing hand collision across the central screen divider.
  - **Left Human vs Computer (`HvC`):**
    - Navigation controls (joystick + `[STOP]`) situated on the far left for the player's left hand.
    - Fire/weapons controls moved to the far right for the player's right hand (`touch-split-layout`).
    - Cockpit Inventory HUD (`#inv0`) moved to the horizontal center (`left: 50%; transform: translateX(-50%)`) between the two thumb clusters.
  - **Right Human vs Computer (`CvH`):**
    - Navigation controls (joystick + `[STOP]`) moved to the far left for the player's left hand (`touch-split-layout`).
    - Fire/weapons controls situated on the far right for the player's right hand.
    - Cockpit Inventory HUD (`#inv1`) moved to the horizontal center (`left: 50%; transform: translateX(-50%)`) between the two thumb clusters.
- **Option A Drone-Sim Style 2-Axis Analog Virtual Joystick:**
  - **Horizontal Axis (Steering / Angular Velocity):** Proportional deflection calculates continuous turning rate:
    - Slight deflection: subtle course correction (e.g. 15°/s).
    - Half deflection: medium turn (30°/s – 45°/s).
    - Full deflection: maximum combat turn rate (60°/s moving, 75°/s pivot at 0 km/h).
    - When released, spring-centers to 0°/s (straight line holding current cruise speed).
    - In Hangar Slit window view, smoothly rotates window slit yaw at continuous angular speed.
  - **Vertical Axis (Throttle / Acceleration):**
    - Pushing UP past deadzone steps speed forward (and repeats every `KEY_REPEAT_MS`, matching `W` / `↑`).
    - If a reserve tank in the hangar is selected, pushing UP deploys the tank into the field.
    - Pulling DOWN past deadzone steps speed backward / reverse (matching `S` / `↓`).
- **Quick Brake / Stop Button (`[STOP]`):** Semi-transparent dark red button (50% opacity, `58px` wide), instantly zeroes commanded speed (`0 km/h`) and commanded turn (`0°/s`).
- **Ergonomic Tactical Weapons Cluster:**
  - Top row: Secondary tactical **`[MINE]`** and **`[SMOKE]`** buttons with 50% transparent backgrounds and sharp black icon outlines (`stroke="#000"`) for high contrast against terrain.
  - Bottom row: Primary **`[FIRE]`** (ammo shell) button positioned below secondary weapons, closest to the player's thumb coming up from the bottom of the device for effortless rapid firing.
- **Unified Unit Selection & Hangar Slit Ribbon:**
  - Tank buttons `[1]` through `[5]` feature 50% transparent backgrounds (`rgba(20, 26, 23, 0.5)`) with crisp, bold digits. When selected, the active tank button highlights in amber gold (`border-color: #ffd54a`, `background: rgba(62, 50, 18, 0.5)`, `color: #ffd54a`, `box-shadow: 0 0 10px rgba(255, 213, 74, 0.6)`), matching the slit button active highlight color.
  - Slit buttons are 25% longer (`40px × 32px`), 50% transparent, and cleanly labeled simply as **`L`** and **`R`**.
  - Slit buttons highlight in amber gold (`#ffd54a`) when active in slit observation view.
- **50% Translucent Control Overlays:** All mobile touch control elements (unit selection ribbon, slit buttons, joystick base/knob, stop button, fire/mine/smoke buttons, top bar, and cockpit inventory frames) use 50% semi-transparent backgrounds so players maintain sight of the battlefield under control surfaces.
- **Automatic Mobile Fullscreen & Landscape Orientation Lock:** In mobile mode, entering fullscreen and automatically locking device orientation to landscape (`screen.orientation.lock('landscape')`) is triggered when the player presses **Start game** / **New game** or **Resume game** (trusted user gesture), delivering an immersive full-screen landscape battlefield without browser chrome. Fullscreen automatically exits and orientation unlocks (returning to standard non-fullscreen auto-rotation) whenever the player clicks the **`[⏸ MENU]`** button or opens the pause / title menu, keeping browser controls accessible while navigating menus. The top bar also maintains a manual **`[⛶ FULLSCREEN]`** toggle.
- **Cockpit Inventory HUD:** For both players in mobile mode, ammo shells and secondary counts are left-aligned within the inventory HUD frame.
- **Top System Bar:** Includes quick `[⏸ MENU]` button and `[⛶ FULLSCREEN]` toggle.

---

## 6. Tank Movement

### 6.1 Model
Each tank has:
- `heading` (rad), `pos` (x, y).
- **Commanded** linear speed `cmdSpeedKmh` and **commanded** turn rate `cmdTurnDeg` — set by key steps.
- **Actual** linear speed `speed` and **actual** turn rate `turn` — approach the commanded values
  with non-momentary step acceleration (**0.5s per step transition**).

Every tick:
```
speed += clamp(cmdSpeed - speed, ±getLinearAccelMs2(speed) * dt)
turn  += clamp(cmdTurn  - turn,  ±degToRad(TANK_TURN_ACCEL_DEG_S2) * dt)
heading += turn * dt
pos += (cos heading, sin heading) * speed * dt
```
then collisions (§7) are resolved.

### 6.2 Speed & Turn Steps

- **Linear Speed Steps:**
  - **Forward:** 3 discrete steps: `+6 km/h`, `+18 km/h`, `+36 km/h`.
  - **Neutral:** `0 km/h`.
  - **Backward / Reverse:** 1 discrete step: `-6 km/h`.
  - Commanded speed ladder: `[-6, 0, 6, 18, 36] km/h`.
- **Rotational Speed Steps:**
  - **While Moving (`speed ≠ 0`):** 3 steps in each direction: `15°/s`, `30°/s`, `45°/s` (ladder: `[-45, -30, -15, 0, 15, 30, 45] °/s`).
  - **While Stationary / Pivot Turn (`speed = 0`):** 2 steps in each direction: `15°/s`, `30°/s` (ladder: `[-30, -15, 0, 15, 30] °/s`).
- **Step Acceleration & Deceleration (0.5s per step transition):**
  - Switching between any adjacent speed steps takes **0.5 seconds**:
    - `0 ↔ ±6 km/h`: $12\text{ km/h/s} = 3.333\text{ m/s}^2$
    - `6 ↔ 18 km/h`: $24\text{ km/h/s} = 6.667\text{ m/s}^2$
    - `18 ↔ 36 km/h`: $36\text{ km/h/s} = 10.000\text{ m/s}^2$
  - Switching between any adjacent turn steps takes **0.5 seconds**:
    - `TANK_TURN_ACCEL_DEG_S2 = 30 °/s²`.
  - **STOP Command:** Setting commanded speed and turn to 0 decelerates the tank smoothly at 0.5 seconds per step:
    - Stopping from `36 km/h` takes 1.5 seconds (36 $\to$ 18 $\to$ 6 $\to$ 0).
    - Stopping from `18 km/h` takes 1.0 second (18 $\to$ 6 $\to$ 0).
    - Stopping from `6 km/h` or `-6 km/h` takes 0.5 seconds.
    - Stopping turn from `45°/s` takes 1.5 seconds; from `30°/s` takes 1.0 second; from `15°/s` takes 0.5 seconds.

| Constant | Value | Description |
|---|---|---|
| `TANK_MAX_SPEED_KMH` | 36 | 3 forward steps: +6, 18, 36 km/h |
| `TANK_MAX_REVERSE_KMH` | 6 | 1 backward step: -6 km/h |
| `TANK_SPEED_STEPS_KMH` | `[-6, 0, 6, 18, 36]` | Discrete speed step ladder |
| `TANK_MAX_TURN_DEG_S` | 45 | 3 moving steps: 15, 30, 45 °/s |
| `TANK_MAX_PIVOT_TURN_DEG_S` | 30 | 2 stationary steps: 15, 30 °/s |
| `TURN_STEP_DEG_S` | 15 | Rotational step size |
| `TANK_TURN_ACCEL_DEG_S2` | 30 | 0.5s per 15°/s step transition |
| `KEY_REPEAT_MS` | 150 | ms |

### 6.3 Persistence of motion
- Commanded speeds are kept per tank. Switching to another tank **does not** change the old tank's
  commands — it keeps moving (e.g. along an arc).
- Example: select 1, `W W`, select 2, `W W`, select 3 … → all tanks drive forward.

---

## 7. Collisions

Tanks are oriented rectangles (OBB). Collision is checked every tick.

### 7.1 Tank vs field border (and closed gate)
- The tank cannot penetrate the border; it is pushed back to the contact line.
- While in contact:
  - Velocity component **into** the wall = 0.
  - Velocity component **along** the wall = `BORDER_DRAG_FACTOR` (0.5) × normal value.
  - Actual turn rate = `BORDER_DRAG_FACTOR` × normal value.
- Commanded values are **not** changed; full speed resumes as soon as contact ends. **[A9]**

### 7.2 Tank vs tank
- Tanks cannot overlap; penetration is resolved by separation.
- While in contact:
  - Turn rate of both = `TANK_CONTACT_TURN_FACTOR` (0.5) × normal value.
  - A tank **cannot move toward** the tank it touches (that component is zeroed); it **can move
    away** (typically backward).
- Applies to friendly and enemy tanks alike. No damage from collisions.

---

## 8. Weapons

### 8.1 Gun / shells
- Fire key fires one shell if the tank has shells and is not reloading (`GUN_RELOAD_S` = 1). **[A10]**
- Shell starts at the muzzle and flies straight along the gun heading.
- Range `SHELL_RANGE_M` = 62.5 (¼ of field length); flight time `SHELL_FLIGHT_TIME_S` = 0.4
  → speed ≈ 156 m/s. Deliberately slow so a quick maneuver can dodge it.
- Shell is visible in both 3D views and on the map.
- Shell disappears when it: reaches max range, hits the border or a **closed** gate door, or hits a tank
  (including tanks inside a hangar through an open gate).
- **Hit = instant destruction** of the tank (one-shot kill). Friendly fire **is** possible. **[A11]**
- Shells pass through smoke (smoke only blocks vision). **[A12]**

### 8.2 Mines
- Drop key places a mine `MINE_DROP_BEHIND_M` (1.5) behind the tank's rear edge.
- A mine becomes armed after `MINE_ARM_DELAY_S` (1.5) — so the dropping tank does not trigger it
  instantly.
- Armed mine explodes when **any** tank's OBB touches its radius `MINE_TRIGGER_RADIUS_M` (1),
  destroying that tank (including own tanks). **[A13]**
- Mines persist **indefinitely** until triggered.
- Mines are visible on the map and in 3D to both players. **[A5]**
- Mines can be dropped directly in front of a gate; a tank exiting onto it is destroyed.

### 8.3 Smoke
- Smoke key creates a cloud centered on the tank: radius `SMOKE_RADIUS_M` (10), lifetime
  `SMOKE_LIFETIME_S` (10), fading during the last `SMOKE_FADE_S` (2).
- The cloud stays where it was released (does not follow the tank).
- Effect: blocks line of sight in 3D views (opaque), hides tanks inside it on the map. **[A6]**

---

## 9. Hangar Window View

- Each player can switch their 3D view to one of their two hangar windows (`Q`/`E` or `[`/`]`).
- Window positions: in the player's border wall, centered `WINDOW_OFFSET_FROM_GATE_M` (8) above and
  below the gate center, length `WINDOW_LENGTH_M` (5).
- View is rendered through a **narrow horizontal slit** mask (black above/below) to look like a
  window; crosshair in the center.
- Default facing: perpendicular to the wall, into the field.
- **Independent Window Yaw Persistence:** Each player tracks independent yaw angles for both hangar windows (`windowYaws: [0, 0]`). Switching between the Left and Right windows or temporarily returning to tank command retains the exact angular yaw position of each slit gun rather than resetting to center.
- Turn keys (`A`/`D`, `←`/`→`) **rotate the view** (not a tank) in discrete steps: **15°/s and 30°/s** (`WINDOW_YAW_STEP_DEG_S = 15`, `WINDOW_YAW_RATE_DEG_S = 30`), up to `WINDOW_MAX_YAW_DEG` (45°, i.e. 50 % of the 90° to the wall) each side. Angular acceleration between steps is non-momentary at **0.5s per 15°/s step transition** (`WINDOW_YAW_ACCEL_DEG_S2 = 30 °/s²`). The STOP command zeroes commanded window rotation with 0.5s per step deceleration (30 $\to$ 15 $\to$ 0 in 1.0s).
- Accelerate/decelerate keys have no effect in window view.
- Fire key shoots a shell from the window along the view direction. **Unlimited ammo**, limited by
  `WINDOW_RELOAD_S` (1.5) between shots (per window). Same shell range/speed as tank shells. **[A14]**
- **HUD:** While sitting in the hangar window slit view, the ammo inventory overlay is hidden (since window ammunition is unlimited).
- Mine/smoke keys have no effect in window view.
- Leaving window view: press a tank number key, or press the same window key again (returns to the
  last tank). Pressing the other window key switches windows.
- While in window view, the player's tanks continue moving per their commands.

### 9.1 Gate defense line of sight
- Slit windows provide direct defensive surveillance and ballistic line-of-sight across their full yaw range (`±WINDOW_MAX_YAW_DEG`).
- Shells fired from a window hit any target on the field intersecting their path according to standard projectile collision rules; there is no artificial dead zone immunity for targets close to the gate.

### 9.2 AI Hazard and Mine Avoidance
- AI-controlled tanks actively scan the field ahead and behind for mine hazards (`world.mines`).
- When a mine is detected in the travel corridor (width equal to hull width + trigger radius + safety margin), the AI calculates tangent escape headings to steer safely around the mine.
- If approaching a mine at close proximity, emergency braking is engaged to pivot-turn clear before proceeding.
- Reverse maneuvers check the rear corridor and disallow reversing if a mine is located directly behind the tank.

---

## 10. Tank Lifecycle, Numbering and Hangar

### 10.1 Initial setup
- Per player: 5 tanks on the field, 10 spare tanks in the hangar (all hangar slots full).
- Field tanks stand in a vertical column parallel to their border, one tank length
  (`START_BORDER_GAP_M`) from it, centered vertically on the gate, spacing `START_SPACING_M` (10),
  facing the opponent, **speed strictly zero, turn rate zero**. Tanks do not move until explicit player input.
- **Numbering:**
  - Both Left and Right player field tanks display numbers `1..5` (top to bottom).
  - Left player selects their tanks 1..5 using keys `1`, `2`, `3`, `4`, `5`.
  - Right player selects their tanks 1..5 using keys `6`, `7`, `8`, `9`, `0` (`6` selects Tank 1, `7` selects Tank 2, `8` selects Tank 3, `9` selects Tank 4, `0` selects Tank 5).
- Spare tanks are initially **unnumbered**.
- Each player's tank 1 is initially selected on start.

### 10.2 Destruction and replacement
- A destroyed tank explodes and is removed (counts toward that player's 15 losses).
- Its number `n` (1..5) is transferred to an **unnumbered spare** in the hangar — inner row first, then
  outer row. When an inner-row slot frees up, outer-row spares shift into it (cosmetic).
- If no unnumbered spare exists, number `n` becomes unavailable (selection key does nothing).
- If the destroyed tank was selected, the player's 3D view shows a "destroyed" screen with the
  message `TANK n DESTROYED` (or `TANK n DESTROYED — NO SPARES` if no spare can take its number).
- While no tank is selected, the viewport banner prompts **`SELECT TANK`** (or **`COMPUTER`** if controlled by AI).

### 10.3 Deploying from the hangar
- Selecting a numbered tank that is in the hangar selects the unit for surveillance and standby without automatically deploying it.
- To deploy the selected reserve tank through the gate into the field, the player must explicitly press **Forward** (`W` for Red, `↑` for Blue).
- Once Forward is pressed:
  - The gate doors **slide open**; once fully open, the tank emerges through the gate (rear edge `SPAWN_OFFSET_FROM_GATE_M` from the wall) facing into the field, and **immediately begins moving forward at slowest speed** (`SPEED_STEP_KMH` = 6 km/h).
  - The doors close behind the exiting tank once it clears the doorway.
  - If the spawn area (`GATE_SPAWN_ZONE`, a tank-sized OBB + `SPAWN_CLEARANCE_M`) overlaps **any** tank (own or enemy), deployment is **blocked**; banner shows `GATE BLOCKED`. The tank remains in standby until the doorway is cleared.
  - Mines in the spawn area do **not** block deployment — the tank is destroyed on exit if one is there.
- While selected in the hangar prior to deployment, the 3D view observes the arena through the gate slit windows.

### 10.4 Returning to the hangar (rearm)
- A field tank driving into **its own** gate enters the hangar if there is a free slot. The doors open
  automatically as the tank approaches (`GATE_APPROACH_M`) and close once it is in.
- On entry: tank keeps its number, goes to a free slot, speed zeroed, inventory refilled to
  5 / 2 / 2.
- It can be deployed again by selecting it (if it is selected while entering, it stays in hangar
  until re-selected).
- If the hangar is full, the gate acts as a wall.
- Enemy gates are always walls.

### 10.5 Invariants
- Each digit (1..5) per player maps to at most one living tank (on field or in hangar).
- At most 5 tanks per player on the field.
- Hangar holds at most 10 tanks.
- Tanks per player alive + lost = 15.

---

## 11. Game Flow

### 11.1 States
`TITLE` → `PLAYING` ⇄ `PAUSED (menu)` → `GAME_OVER` / `QUIT`.

### 11.2 Win condition
- A player loses when all **15** of their tanks are destroyed; the other player wins.
- If both lose their last tank in the same tick → **draw**.
- `GAME_OVER` screen:
  - The tactical battlefield (2D strategic radar and 3D split-screen viewports) remains fully visible rather than hidden or blurred, gently grayed out (`grayscale(45%) contrast(85%)`) with a high-transparency shade overlay (`rgba(8, 12, 10, 0.21)`, 50% more transparent than standard menus) so players can clearly observe final unit wrecks and battlefield layout.
  - A sleek floating statistics card appears above the field displaying side-by-side squadron combat telemetry (tanks lost / 15, shots fired, direct hits, accuracy percentage) with options: `New game`, `Main menu`.
  - The statistics modal window is draggable across the screen via mouse/pointer by clicking and holding on the modal background or header, allowing players to move the card out of the way to inspect any part of the battlefield while keeping action menu buttons immediately clickable.

### 11.3 Menus & Navigation

The game launches into the **Tank.exe Title Menu**:
- Title banner: `Tank.exe`
- Subtitle: `Two players · one keyboard · 90s split-screen tank combat`
- Options:
  1. **Start game**
  2. **Load game** (choose slot 1..10)
  3. **Players: Human vs Human | Human vs Computer | Computer vs Human | Computer vs Computer** (1st is left player, 2nd is right)
  4. **Level: HARD | MEDIUM | EASY** (visible only when Computer mode is selected)
  5. **Options** (opens the Options submenu)
  6. **Help** (opens a scrollable modal detailing game concept, initial status, controls table with remapping note, arsenal & defense, base hangars, and victory conditions with multilingual support for English, Spanish, and Russian (`src/help/help_en.html`, `src/help/help_es.html`, `src/help/help_ru.html`). Features an in-header language switcher (`[ EN | ES | RU ]`) and keyboard shortcut (`L`), default locale detection from the browser (`navigator.language`), and `localStorage` persistence)
  7. **History** (opens a scrollable modal displaying the game's origins and lore with multilingual support for English, Spanish, and Russian (`src/history/history_en.html`, `src/history/history_es.html`, `src/history/history_ru.html`). Features an in-header language switcher (`[ EN | ES | RU ]`) and keyboard shortcut (`L`), default locale detection from the browser (`navigator.language`), and `localStorage` persistence)

**In-Game Pause Menu (`Esc`):**
- Pauses the fixed-step simulation immediately.
- Options:
  1. **Resume game** (or **Resume**)
  2. **Save game** (choose slot 1..10)
  3. **Load game** (choose slot 1..10)
  4. **New game** (with loss confirmation)
  5. **Players: Human vs Human | Human vs Computer | Computer vs Human | Computer vs Computer** (1st is left player, 2nd is right)
  6. **Level: HARD | MEDIUM | EASY** (visible only when Computer mode is selected)
  7. **Options** (opens the Options submenu)
  8. **Help** (opens the scrollable game manual modal with in-header language switcher)
  9. **History** (opens the scrollable game history and lore modal with in-header language switcher)

**Options Submenu (`Options`):**
- Title: `OPTIONS`
- Subtitle: `Game & Audio Settings`
- Options:
  1. **Sound: ON | OFF** (toggles Web Audio master output)
  2. **Obstacles: ON | OFF** (toggles building obstacles generator; initial default: `OFF`)
  3. **Pits: ON | OFF** (toggles water pit / trench hazard generator; initial default: `OFF`)
  4. **Touch controls: AUTO | ON | OFF** (toggles mobile on-screen virtual joystick and tactical combat overlays)
  5. **Keyboard layout** (opens the interactive desktop keyboard layout configuration screen; dynamically hidden on mobile touch devices when no hardware keyboard is plugged in)
  6. **Back** (returns to previous menu)

**Menu Navigation & Layout Behavior:**
- **Click-Only Selection:** Menu selection highlight is controlled strictly by mouse clicks or keyboard arrow keys; moving the mouse cursor over items does not shift the active selection.
- **Top-Anchored Downward Expansion:** The menu card is anchored to a fixed top offset rather than vertically centered, so when dynamic items appear or disappear (such as toggling `Players` mode to reveal or hide the `Level` item), the menu expands downward without shifting vertically or shaking the active item under the mouse pointer.

### 11.4 Startup Query String Parameters

The application supports URL query string parameters on startup to configure settings or launch directly into combat without manual menu interaction. All parameters and string values are **case-insensitive**, and all boolean parameters accept only **`Y`** or **`N`**:
- **`mode`:** Configures game player mode (`HvH`, `HvC`, `CvH`, `CvC`).
- **`level`:** Configures AI difficulty level (`EASY`, `MEDIUM`, `HARD`).
- **`sound`:** Toggles procedural sound output (`Y` / `N`).
- **`obstacles`:** Toggles building obstacles (`Y` / `N`).
- **`pits`:** Toggles water pit / moat hazard trenches (`Y` / `N`).
- **`lang`:** Pre-selects history language (`EN`, `ES`, `RU`).
- **`mobile`:** When set to `Y`, forces mobile mode on even on desktop (activates on-screen touch controls, analog joystick, and mouse click/drag interaction while omitting the keyboard layout menu).
- **`debugVectors`:** When set to `Y`, renders aiming vectors for each tank deployed on the battlefield on the 2D strategic/tactical radar map view, with vector color matching the tank color (bright for active/selected tank, dark for passive/unselected tanks: `#ff7060`/`#b5372b` for Red, `#6fa0ff`/`#2c55b8` for Blue), and vector length equal to 65% of the ammo flight distance (`DEBUG_VECTOR_LENGTH_M` = `65%` of `SHELL_RANGE_M` = `40.625m`). Vectors are not shown for tanks parked in the hangar, nor in the 3D first-person viewport.
- **`start`:** When set to `Y`, immediately starts a new game with the configured options, bypassing the title menu.

*Example:* `http://localhost:5174/?mode=HvC&debugVectors=Y&start=Y` launches directly into combat with live aiming vectors displayed on the map for all deployed field tanks.

### 11.5 Keyboard Layout Configuration (`Options` → `Keyboard layout`)

The game provides a full visual desktop keyboard layout configuration tool:
- **Desktop QWERTY Keyboard Visualizer:**
  - Renders a standard full 104-key desktop keyboard (function row with `Esc` and `F1`–`F12`, main alphanumeric typing block, navigation cluster with inverted-T arrow keys, and full numeric keypad with dual-height `+` and `Enter` keys).
  - Displays physical key letters and symbols on all keycaps.
  - When a key is assigned to a player function, displays a shaded color-coded overlay on top of the keycap with an illuminated function badge:
    - **Red shade:** Left Player actions (e.g. `ACCEL`, `DECEL`, `TURN L`, `TURN R`, `TUR L`, `TUR R`, `FIRE`, `MINE`, `SMOKE`, or circular badge `1`..`5`).
    - **Blue shade:** Right Player actions.
- **Player Function Palettes (Bottom Section):**
  - Positioned directly beneath the keyboard, separated into **LEFT PLAYER (RED)** and **RIGHT PLAYER (BLUE)**.
  - **Tank Numbers:** Functions 1 to 5 rendered inside distinct **circular frames**.
  - **Action Functions:** Movement and combat actions rendered inside **rounded rectangular frames** (`ACCELERATE`, `DECELERATE`, `TURN LEFT`, `TURN RIGHT`, `HANGAR TURRET (LEFT)`, `HANGAR TURRET (RIGHT)`, `FIRE`, `DROP MINE`, `SMOKE CLOUD`).
  - **Mapped Key Display:** Directly underneath every function frame, the currently mapped key name is displayed (e.g., `Q` under `HANGAR TURRET (LEFT)`, `W` under `ACCELERATE`, `1` under `1`).
- **Drag-and-Drop & Click-to-Bind Interaction:**
  - Users can drag any function frame directly onto a virtual keyboard keycap to bind it.
  - Users can also click a function badge to select it, then click any keycap or press the desired physical key.
  - If a key was already assigned to another action, remapping cleanly transfers the key and frees the previous binding.
- **Browser & OS Reserved Key Protection:**
  - Standard browser and OS control keys cannot be bound to prevent conflicting with system operations:
    - Function keys: `F1` through `F12` (Help, Refresh, Fullscreen, DevTools, etc.).
    - System / OS modifiers: `MetaLeft` / `MetaRight` (Windows keys), `ContextMenu`.
    - Print / Lock keys: `PrintScreen`, `ScrollLock`, `Pause`, `NumLock`, `CapsLock`.
    - Menu / Pause key: `Escape` (reserved for opening menu / cancel).
  - Reserved keys are visually dimmed on the keyboard chassis with a `not-allowed` indicator; attempting to bind them displays a clear informational status notice.
- **Persistence & Controls:**
  - **RESET LAYOUT:** Restores default out-of-the-box (OOTB) key mappings and removes custom bindings from `localStorage`.
  - **OK:** Persists custom layout to `localStorage` (`tank.exe.keys`), updates the active input controller, and returns to Options.
  - **CANCEL:** Discards uncommitted modifications and returns to Options.
  - **Dynamic In-Game Help Table:** The Controls table in the Help manual dynamically reflects whatever custom layout is actively configured.

---

## 12. Computer AI & Difficulty Levels

When a player side is designated as **Computer** (`Human vs Computer` → Right player AI; `Computer vs Human` → Left player AI; `Computer vs Computer` → Both players AI), an autonomous AI controller operates that player's battalion:

### 12.1 Strategic Brigade Control Architecture

The AI controller operates a three-tier command hierarchy:

```
+-------------------------------------------------------------+
|             TIER 1: BRIGADE COMMANDER                      |
|  - Assesses global battlefield state every 0.8s             |
|  - Selects active Brigade Strategic Plan                    |
|  - Assigns tactical roles to all 5 brigade tanks            |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             TIER 2: TIME-SLICE DISPATCHER                   |
|  - Urgency-Weighted Priority Dispatcher (220ms - 850ms)     |
|  - Evaluates immediate micro-needs across all 5 tanks       |
|  - Instantly switches selection to the most critical unit   |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             TIER 3: TACTICAL UNIT EXECUTOR                  |
|  - Executes role-specific waypoints (Vanguard, Flanker)     |
|  - Pre-switch Safe Cruising Course Projection (3.0s lookahead)
|  - Aim alignment, predictive lead, reflex fire, and evasion |
+-------------------------------------------------------------+
```

### 12.2 Brigade Strategic Plans & Formations (Tier 1)

The Brigade Commander dynamically switches between 4 tactical doctrines:
- **Plan Alpha ("Pincer Envelopment", Default Offensive):**
  - **Objective:** Flank the opponent from opposing outer corridors while pinning the center.
  - **Tank 1 (Vanguard):** Advances along centerline ($Y \approx 50$), maintaining a conservative standoff distance ($30\text{ m}$) to pin enemy forces and attract fire.
  - **Tanks 2 & 3 (North Flankers):** Move along upper boundary ($Y \approx 22\text{--}26$), outflanking buildings and attacking from the enemy's northern flank.
  - **Tanks 4 & 5 (South Flankers):** Move along lower boundary ($Y \approx 74\text{--}78$), coordinating convergence upon the enemy gate.
- **Plan Bravo ("Wedge Breach", Concentrated Assault):**
  - **Objective:** Punch through a single sector with high-speed spearhead when enemy forces are scattered.
  - **Spearheads (Tanks 1 & 2):** Abreast along center corridor ($Y \approx 46, 54$) cruising aggressively at top speed ($36\text{ km/h}$).
  - **Trailing Echelons (Tanks 3 & 4):** Trailing $12\text{ m}$ behind spearhead ($Y \approx 42, 58$), providing supporting fire.
  - **Rearguard (Tank 5):** Holding rear approach ($Y \approx 50$) to intercept counter-flanks.
- **Plan Charlie ("Base Defense & Slit Crossfire", Defensive Retraction):**
  - **Objective:** Defend home gate when opponent penetrates within $45\text{ m}$ of the gate (`AI_PLAN_DEFENSE_TRIGGER_DIST_M`).
  - **Hangar Slit Sentry:** Commander switches view to active slit window, exploiting infinite munitions to suppress attackers.
  - **Defensive Arc (Tanks 1--3):** Positioned $26\text{ m}$ out from the gateway ($Y \approx 35, 50, 65$), dropping mines in approach corridors.
  - **Rearm Cycling (Tanks 4 & 5):** Empty tanks retreat into hangar to replenish ammunition.
  - **Disengage:** Returns to Plan Alpha once threats are repelled past $60\text{ m}$ (`AI_PLAN_DEFENSE_CLEAR_DIST_M`).
- **Plan Delta ("All-Out Pursuit", Exploitation):**
  - **Objective:** Triggered when enemy tanks are out of ammunition ($\le 0.5$ average shells remaining) or heavily outnumbered ($\ge 3:1$).
  - **Pursuit Charge:** All available units charge at full speed ($36\text{ km/h}$), cutting off escape routes to the enemy hangar.

### 12.3 Urgency-Weighted Time-Slice Dispatcher (Tier 2)

Replaces fixed round-robin cycling with continuous priority evaluation across all 5 brigade tanks:
- **Urgency Score ($U_i$):**
  $$U_i = \max(H_i, C_i, R_i) + 0.4 \cdot S_i$$
  - **Hazards ($H_i$):** Water pit collision in $1.8\text{ s}$ path = 95; mine in path = 90; obstacle/boundary collision = 80.
  - **Combat Opportunities ($C_i$):** Gun aimed within $8.5^\circ$ with clear LOS = 85; incoming hostile shell requiring evasion/smoke = 75; engaging enemy in range = 65.
  - **Rearm ($R_i$):** 0 shells remaining = 50.
  - **Starvation ($S_i$):** $+5\text{ points/second}$ since unit was last commanded (capped at 40), ensuring no tank is neglected.
- **Micro-Slice Scheduling:**
  - Minimum slice duration: $220\text{ ms}$ (`AI_MIN_SLICE_S`) to prevent thrashing.
  - Maximum slice duration: $850\text{ ms}$ (`AI_MAX_SLICE_S`) to force re-evaluation.
  - Switch threshold: switches to tank $t^*$ if $\max(U_i) - U_{\text{curr}} \ge 15$ (`AI_DISPATCH_THRESHOLD_DELTA`), or if $t^*$ faces an acute hazard ($H \ge 90$).

### 12.4 Safe Cruising Course Projection (Tier 3)

Because unselected tanks preserve their last commanded linear speed and turn rate indefinitely:
- **Zero-Turn Trim:** Before deselecting a tank, the AI zeroes its turn rate (`cmdTurnDeg = 0`) to prevent unselected units from spiraling or turning erratically.
- **3.0-Second Lookahead Trajectory:** The AI projects the tank's forward path for $3.0\text{ s}$ (`AI_COURSE_PROJECT_TIME_S`).
  - If clear: locks stable forward cruising speed ($18$ or $36\text{ km/h}$) along its tactical lane.
  - If a boundary, pit, building, or mine is ahead: issues an emergency stop (`STOP`, $0\text{ km/h}$) so the unattended tank waits safely until re-selected.

### 12.5 Tactical Target Selection & 2D Map UI

- **LOS Obstacle & Friendly Checking:** Raycasts verify that shells will not hit buildings (`segmentVsObb`) or friendly tanks before firing.
- **Threat Weighting & Lock Hysteresis:** Target scoring evaluates distance, gun deflection angle, incoming facing threat, and applies a $+20$ stickiness bonus (`AI_TARGET_STICKINESS_BONUS`) to prevent rapid target oscillation.
- **Organic Asymmetry & Personality Jitter:** Random phase desynchronization, decision interval jitter ($\pm 25\%$), standoff jitter ($\pm 3.5\text{ m}$), and tie-breaking noise ensure left and right AI forces behave organically without symmetric mirroring.
- **Strategic Map Directional Target Arrows:**
  - Thin colored arrows (`1.5px` width) drawn on the 2D map from each active unit to its locked target:
    - Red player: `#ff5544`
    - Blue player: `#4488ff`
  - Rendered from the active selected tank or from the active hangar slit window. Maximum of 2 target arrows on the map at any time.

### 12.6 Active Mine Maneuvering Avoidance

- **Forward Hazard Lookahead:** Tanks project a continuous $16\text{ m}\dots 25\text{ m}$ forward path (`AI_MINE_LOOKAHEAD_MIN_M = 16.0m`).
- **Lateral Detour Arc:** When an armed mine is detected within the forward or planned heading path, the AI determines whether passing left or right provides the safest clearance, ensuring a lateral margin of $\ge 5.8\text{ m}$ (`AI_MINE_CLEARANCE_PASS_M`).
- **Maneuvering Cruise Speed:** Rather than stopping or slamming into reverse, the tank maintains controlled forward cruising speed ($18\text{ km/h}$), banking along the calculated detour arc to actively maneuver smoothly around the mine.
- **Point-Blank Pivot Clearance:** If a mine is directly ahead at point-blank range ($< 5.0\text{ m}$, `AI_MINE_EMERGENCY_BRAKE_DIST_M`), the tank temporarily brakes to $0\text{ km/h}$ to pivot its hull until pointing safely past the mine trigger perimeter, then accelerates forward to complete the bypass.
- **Reverse Mine Check:** When reversing during stuck recovery or combat standoff adjustment, the AI verifies that no mine is situated behind the hull ($mlx \in [-8.0, 0.5]$ and $|mly| < 3.8\text{ m}$), preventing reversing into mines.

### 12.7 Smoke Cloud Line of Sight & Blind Fire Prediction

- **Smoke Obscuration:** Active smoke clouds (`world.smokes`, radius $10\text{ m}$) completely obstruct direct line-of-sight for both tank crews and hangar slit window sentries. Any target inside or behind a smoke cloud cannot be seen directly if the observer is $> 2.0\text{ m}$ away (`SMOKE_VISIBLE_DISTANCE_M`).
- **Visual Intelligence & Memory Tracker:** AI controllers maintain memory (`enemyTracker`) recording each enemy's last-known coordinates, heading, linear speed, and stationary state when visible.
- **Stationary Target Blind Fire:**
  - If the enemy was stationary (`speed < 0.35 m/s`) when entering/obscured by smoke, its position is known to remain fixed.
  - Initial hit probability remains high ($\ge 0.95$, decaying slowly at only $0.04/\text{s}$).
  - AI tanks actively fire blindly into the smoke at the known coordinates.
- **Moving Target Dead-Reckoning & Uncertainty Decay:**
  - If the enemy was moving, the AI extrapolates its position using dead-reckoning vector projection:
    $$\text{predPos} = \text{lastPos} + \vec{v} \cdot \Delta t$$
  - With each passing second in smoke, uncertainty accumulates and hit probability decays rapidly ($0.22/\text{s}$, `AI_SMOKE_PREDICT_DECAY_PER_S`):
    - $t = 0\text{s}$: $P_{\text{hit}} \approx 0.85$ (high blind-fire probability)
    - $t = 1\text{s}$: $P_{\text{hit}} \approx 0.63$ (medium blind-fire probability)
    - $t = 2\text{s}$: $P_{\text{hit}} \approx 0.41$ (low blind-fire probability)
    - $t \ge 3\text{s}$: $P_{\text{hit}} \le 0.19$ (estimate quality too degraded)
  - When hit probability drops below the difficulty profile threshold (`EASY: 0.65`, `MEDIUM: 0.45`, `HARD: 0.30`), the AI decides **not to fire blindly**, conserving munitions and redirecting focus to visible targets or tactical lane maneuvering.

### 12.8 Hangar Slit Window Tactical Defense

- **Autonomous Sentry Mode:** When in slit view, scans field for enemies within $\pm 45^\circ$ FOV and up to $60\text{ m}$.
- **Smoke Respect:** Obey smoke line-of-sight obscuration; sentries evaluate smoke prediction before taking blind shots.
- **Aiming & Unlimited Fire:** Tracks targets smoothly at $15\text{--}30^\circ/\text{s}$ using slit yaw steps and fires infinite defensive shells.
- **Window Cycling & Auto-Exit:** Switches between Left and Right slit windows if threats flank the hangar, and returns to field tanks once the gate approach is secure.

### 12.9 Difficulty Profiles
- **EASY:**
  - Decision interval: ~0.16s; aim tolerance: ~7° without lead (`leadFactor: 0.0`); fire distance: 30m; max speed: 18 km/h; standoff: 22m; countermeasure use: 0.2; blind fire threshold: $P_{\text{hit}} \ge 0.65$.
- **MEDIUM:**
  - Decision interval: ~0.10s; aim tolerance: ~4.5° with partial lead (`leadFactor: 0.5`); fire distance: 40m; max speed: 36 km/h; standoff: 26m; countermeasure use: 0.6; blind fire threshold: $P_{\text{hit}} \ge 0.45$.
- **HARD:**
  - Decision interval: ~0.05s; aim tolerance: ~3° with full predictive lead (`leadFactor: 1.0`); fire distance: 62.5m (maximum physical shell range); max speed: 36 km/h; standoff: 30m; countermeasure use: 0.9; blind fire threshold: $P_{\text{hit}} \ge 0.30$; aggressive pursuit and evasive maneuvers.

---

## 13. Battlefield Hazards: Obstacles & Pits

Battlefield hazards can be toggled on/off in the **Options** menu (initial state is `OFF` for both).

### 13.1 Obstacles (Houses & Buildings)
- **Visuals:** 3D rectangular low-poly buildings with dark roof slabs and multiple window blocks along the facades. On the 2D tactical map, rendered as distinct brown/gray architectural structures with roof outlines and window markings.
- **Collision:** Acts as solid impassable walls for tanks with realistic sliding border drag.
- **Ballistics & Visibility:** Shells detonate upon impact with obstacle walls (`boom` SFX) and cannot pass through. Obstacles block 3D line-of-sight.
- **Placement:** Randomly generated in the central field (X: 55m to 195m, Y: 18m to 82m), strictly outside gate approaches and initial deployment lines.

### 13.2 Pits (Water Trenches / Moats / Рвы, Траншеи)
- **Visuals:** Excavated rectangular trenches filled with vibrant cyan water (`#00e5ff`) and surrounded by dark earthen borders. On the 2D map, drawn with cyan water fill, rippled surface highlights, and dark trench rims.
- **Lethal Immersion Mechanic:** When a tank drives into a water pit such that more than 30% of its footprint area overlaps the pit (`tankPitOverlap >= 0.30`), the tank drops into the pit, triggers an aquatic splash explosion (`splash` SFX), and is destroyed.
- **Shells:** High-velocity shells fly over pits unimpeded.
- **Placement:** Randomly distributed throughout the central arena with safe clearance from obstacles and central bypass lanes.

- Keyboard navigation (all menus & modals):
  - `↑` / `↓` move the selection highlight (wraps around).
  - `Space` or `Enter` (main + numpad) activates the highlighted item.
  - `Esc` goes back one level; at top pause level it resumes the game.
  - **Mouse:** hovering an item highlights it; a left click activates it (same as `Space`/`Enter`).
  - Menu item selection indicator: A reserved-space triangle mark (`▶`) precedes items; space is permanently reserved so navigating does not shift item text horizontally.
  - When Help modal is open, `↑` / `↓` / `PageUp` / `PageDown` scroll the modal content.
- The game auto-pauses when the browser tab loses focus.

### 11.4 Save / Load
- `SAVE_SLOT_COUNT` (10) slots in `localStorage` under `tank.exe.save.<slot>`, each storing a versioned JSON snapshot of the full
  simulation state (tanks, commands, inventories, hangars, numbering, shells in flight, mines,
  smoke, selections, view modes, timers, stats) plus timestamp.
- Loading restores the exact state and returns to `PAUSED` (player presses Resume).
- Snapshot includes `SAVE_FORMAT_VERSION`; incompatible versions are rejected with a message.

---

## 12. Audio
Simple **synthesized** sounds via Web Audio API (no sound files): **[A19]**
- Shot (short noise burst + low thump).
- Explosion (longer filtered noise, louder for mines).
- Engine hum for each player's **selected** tank, pitch proportional to |speed|; left player's
  engine panned left, right player's panned right.
- Smoke release (soft hiss), mine drop (click), gate blocked (short beep).
- Master volume and mute toggle in the menu (`AUDIO_MASTER_VOLUME`, persisted in `localStorage`).
- Audio context is started on the first key press (browser autoplay policy).

---

## 13. Architecture (proposed)

```
index.html
src/
  constants.js      # ALL tunable numbers, colors, key bindings
  main.js           # bootstrap, game loop (fixed tick + render)
  input.js          # keyboard state, per-player action mapping, repeat logic
  sim/
    world.js        # game state container, serialize/deserialize
    tank.js         # movement & inertia
    collision.js    # OBB tests, border/tank contact rules
    weapons.js      # shells, mines, smoke
    hangar.js       # numbering, deploy, rearm
  render/
    map2d.js        # strategic map canvas
    view3d.js       # Three.js scene, per-player cameras/viewports, window slit
    hud.js          # inventory/status panels
  audio/
    sfx.js          # Web Audio synthesized sound effects
  ui/
    menu.js         # Esc menu, save/load slots, game over
docs/
  functional_spec.md
```

Simulation is pure and independent from rendering, allowing deterministic save/load.

---

## 14. Non-Functional Requirements
- 60 FPS on a mid-range laptop with integrated GPU at 1920×1080.
- Single Three.js renderer using scissor/viewport for both player views.
- No network, no backend.

---

## 15. AI Player Controller & Combat Modes

The game supports 4 battle modes (`HvH`, `HvC`, `CvH`, `CvC`) with 3 selectable skill tiers (`EASY`, `MEDIUM`, `HARD`).

### 15.1 Organic Decision Asymmetry & Randomness
- **Phase Desynchronization:** AI controllers initialize with randomized phase timers and jittered decision tick intervals (`AI_TICK_JITTER_FRACTION = 0.25`) and brigade coordination intervals (`AI_COORD_JITTER_FRACTION = 0.35`). This prevents mirror symmetry and simultaneous actions in AI vs AI (`CvC`) battles.
- **Tactical Jitter & Spreading:** Each AI unit applies organic standoff variance (`±AI_STANDOFF_JITTER_M = 3.5m`), cruising speed variance (`±AI_SPEED_JITTER_KMH = 3 km/h`), and tactical lateral spreading (`AI_LANE_OFFSET_MAX_M = 16m`) across the battlefield to fan out across multiple lanes rather than forming a single-file column.
- **Organic Trigger Reflex:** Weapon firing tolerances incorporate jitter (`±8%`) and micro-latency variance to simulate natural reflexes.

### 15.2 Target Locking & Obstacle Line-of-Sight Check
- **LOS Verification:** Targets behind buildings/obstacles (`world.obstacles`) receive a heavy score penalty (`AI_TARGET_LOS_BLOCKED_PENALTY = 70`), preventing tanks from charging blindly into walls or trying to shoot through cover.
- **Lock Hysteresis:** The currently locked target receives a stickiness bonus (`AI_TARGET_STICKINESS_BONUS = 20`) to eliminate rapid target fluttering/oscillation.
- **Threat Weighting & Tie-Breaking:** Targets pointing weapons directly at the unit are prioritized (`AI_TARGET_FACING_US_BONUS = 14`), and tie-breaking noise (`AI_TARGET_NOISE_AMPLITUDE = 6`) ensures diverse target distribution across the enemy brigade.
- **Locked Target Arrow & Slit Gun Aim Vectors:**
  - The strategic map displays thin, crisp arrows (`MAP_TARGET_ARROW_WIDTH_PX = 1.5`) from active tanks (or active slit windows) to their locked targets (maximum 2 arrows: Red -> Blue, Blue -> Red).
  - Slit gun aiming vectors (`DEBUG_VECTOR_LENGTH_M = 32.5m`) are rendered for both windows on both home bases. The currently manned/active window is highlighted in vivid team color with a circular target reticle at its terminus.

### 15.3 Slit Window Tactical Defense
- When enemies penetrate within `AI_SLIT_DEFENSE_TRIGGER_DIST_M = 40m` of the home gate and active tanks are distant, the AI can enter a hangar slit window to deliver defensive fire with unlimited ammo.
- The AI aims through the slit window's angular limits (`WINDOW_MAX_YAW_DEG = 45°`), fires upon alignment (within `AI_SLIT_MAX_FIRE_DIST_M = 50m`), switches to the opposing slit window if enemies cross the gate axis, and returns to tank command once threats subside.

### 15.4 Strategic Brigade Control Architecture
- For comprehensive multi-tank coordination, urgency-based time-slice dispatching, attack formations (Pincer Envelopment, Wedge Breach), and dynamic plan switching, refer to the full architectural specification in [`docs/ai_strategic_control_plan.md`](./ai_strategic_control_plan.md).

### 15.5 Hangar Rearm Navigation & Doorway Alignment Corridor
- **Two-Stage Alignment Trajectory:** When an empty AI tank returns to the base to rearm (`profile.rearm` with 0 shells), it targets an external standoff alignment waypoint located `AI_REARM_STANDOFF_DIST_M = 22.0m` in front of the gate along the central axis ($Y = 50.0\text{ m}$).
- **Standoff Reset for Misaligned Approaches:** If an empty tank approaches within `AI_REARM_RESET_DIST_M = 18.0m` of the gate but is misaligned laterally ($|Y - 50.0| > \text{AI\_REARM\_ALIGN\_LATERAL\_M} = 1.2\text{ m}$) or has an angular error $> 30^\circ$ relative to the doorway, it steers away from the gate into the open field toward the standoff waypoint $(22.0, 50.0)$. If close to the wall ($< 8\text{ m}$) and facing the boundary, it pivots in place to face outward before moving forward, completely eliminating gate wall collisions, loops, and figure-8 entrapment.
- **Deep Hangar Penetration Target:** Once aligned within the corridor ($dist \le 22.0\text{ m}$, lateral offset $\le 1.2\text{ m}$, heading error $\le 25^\circ$), the target waypoint penetrates deep inside the hangar (`AI_REARM_PENETRATION_DEPTH_M = 12.0m` beyond the gate line) without field-boundary clamping. The AI locks steering commands to zero (`cmdTurnDeg = 0`) when heading error is $< 6^\circ$ and cruises straight through the doorway at a controlled $18\text{ km/h}$.

### 15.6 Armed Reserve Deployment Priority
- **Immediate Recharged Reserve Deployment:** When an empty tank berths in a hangar slot, it instantly reloads to full capacity (5 shells, 2 mines, 2 smokes). If active field tanks are out of ammunition (`shells === 0`) or field strength is below maximum, the AI prioritizes selecting and deploying the recharged armed reserve (`AI_URGENCY_DEPLOY_ARMED_RESERVE = 92`) rather than idling in the hangar or solely managing out-of-ammo field tanks.
- **Spawn Area Clearance Verification:** The AI verifies that the gate exit corridor is unblocked (`isSpawnClear(world, owner)`) before issuing deployment commands, ensuring departing reserves enter cleanly without jamming returning units.

### 15.7 Whole-Brigade Rollout & Initial Mobilization
- **Simultaneous Brigade Advance:** At match start, instead of only moving the selected tank while the remaining 4 units remain stationary, the AI immediately mobilizes all field tanks (`t.status === 'field'`) into their assigned tactical roles (Vanguard, Flanks, Echelons). Each tank is given its initial cruising speed (`AI_MOBILIZE_CRUISE_KMH = 18` or up to 36 km/h on HARD) and heading, so the entire brigade sweeps across the battlefield simultaneously.
- **Active Time-Slice Dispatcher Cycling:** The active unit continuously updates its commanded timestamp (`lastCommandedTime`), allowing starvation score to grow for unselected tanks. Every time slice (`AI_MAX_SLICE_S = 0.85s`), the dispatcher rotates control across all 5 tanks in balanced round-robin fashion unless acute combat/hazard emergencies take precedence.

### 15.8 Dynamic Organic Trajectories & Oblique Combat Maneuvers
- **Organic S-Curve Weaving:** Rather than advancing down identical straight lines, each role waypoint applies an organic sinusoidal lateral weave (`AI_TRAJECTORY_WEAVE_AMP_M = 5.0m`, `AI_TRAJECTORY_WEAVE_FREQ = 0.65Hz`) parameterized by simulation time and individual tank ID. Center Vanguard units apply an asymmetric lane bias ($Y \approx 45\text{ m}$ for Red, $Y \approx 55\text{ m}$ for Blue), eliminating head-on central collisions along $Y = 50.0\text{ m}$.
- **Oblique Combat Approach (Jinking):** When engaging enemy tanks that are facing directly on a head-on collision course, the AI applies an oblique lateral offset (`AI_OBLIQUE_ENGAGE_LATERAL_M = 10.0m`) rather than charging straight down the enemy's gun barrel, evading predictable incoming fire while maintaining firing lead.
- **Live Vehicle Collision Avoidance:** The steering reflex checks for both friendly and enemy vehicles directly in the forward path within `AI_VEHICLE_AVOIDANCE_LOOKAHEAD_M = 16.0m` (`AI_VEHICLE_AVOIDANCE_CLEARANCE_M = 5.2m`), steering laterally away to pass smoothly without ramming, and braking if within 8.0m.

### 15.9 Custom Kinematic Navigation & Pathfinding Framework (`src/sim/nav.js`)
- **Macro-Scale 2D Cost Grid:**
  - $250\text{ m} \times 100\text{ m}$ field discretized into $2.0\text{ m}$ cells ($125 \times 50 = 6,250$ entries stored in a `Uint8Array`).
  - **Fatal Hazards (Pits & Mines):** Marked with `COST_LETHAL = 255`. Configuration-space safety buffers ensure lethal pits ($+1.6\text{ m}$) and armed mines ($+3.6\text{ m}$) are treated as hard barriers that trajectory evaluators strictly reject.
  - **Soft Obstacles (Houses & Border Walls):** Marked with `COST_HOUSE = 12` (caution zone $= 4$). Instead of failing or blocking routing, paths may graze or brush house walls with a proportional drag penalty (`BORDER_DRAG_FACTOR = 0.5`) if open detours are unavailable or to avoid lethal hazards.
  - **Open Terrain:** Standard movement cost `COST_OPEN = 1`.
- **Target Maneuver & Curvilinear Intercept:**
  - `predictTargetCurvilinear(target, dt)` models moving enemy units using circular arc dead-reckoning when turning ($\omega \ne 0$), avoiding linear overshoots.
  - `getAttackStandoffWaypoint(tank, target, world, profile)` calculates tactical attack positions at $20\text{--}30\text{ m}$ standoff outside the target's forward firing cone ($\pm 45^\circ$) with verified line-of-sight past buildings, falling back to safe perimeter standoff ($52\text{m}$) outside shell range if no standoff is clear.
- **Gate Reservation Mutex & Corridor Alignment:**
  - `GateReservationManager` assigns a single-token gate mutex per team so only one tank approaches or transits the 7m gateway at a time. Secondary retreating/deploying tanks hold at lateral staging waypoints ($Y = 32\text{ m}$ or $68\text{ m}$) until the gateway is clear.
  - Two-stage docking corridor: locks speed to $18\text{ km/h}$ and aligns heading to $\pm 4^\circ$ in the approach zone, then locks turn commands to zero (`cmdTurnDeg = 0`) to cruise straight through the doorway at $Y = 50.0\text{ m}$.
- **Kinematic Dynamic Window Trajectory Rollout (DWA):**
  - Evaluates reachable steering arcs over a $1.8\text{ s}$ horizon (6 simulation steps) adhering to skid-steer acceleration limits, evaluating forward cruising, zero-speed turns, and reverse ($-6\text{ km/h}$) arcs near targets or inside hazard sectors.
  - Hard discard ($-\infty$) for any arc contacting pit overlap, mine trigger radii, or entering the enemy slit gun sector when currently outside.
  - Time-to-Collision (TTC) prediction penalizes arcs approaching within $6.0\text{ m}$ of unselected friendly tanks, eliminating team bunching and speed-draining collisions.
  - High-speed bonus maintains full $36\text{ km/h}$ cruising velocity on HARD difficulty by choosing wide, curvature-safe arcs around obstacles rather than jerky pivot stops.
- **Friendly Safe Cruising Trim:**
  - Trajectory projection during time-slice selection switching checks for teammates ahead in the lane and projects forward hazard clearance ($3.5\text{s}$ horizon), issuing a stop command if a teammate or enemy slit cone intersects the path.
- **Organic Asymmetry & Bounded Control Iterations:**
  - Trajectory evaluation incorporates per-tank personality bias ($\sin(\text{id} \cdot 1.7 \pm 1.35 + t \cdot 0.45)$) and stochastic tie-breaking noise, breaking CvC mirror symmetry and ensuring over 90% trajectory variance between opposing brigades.
  - Command adjustments (`applyKinematicCommands`, `applySafeCruisingTrim`) clamp target turn rates to speed-dependent vehicle limits and bound execution to at most 6 step iterations, eliminating infinite loops or UI thread freezes.
- **Lateral Gate Flank Approach & Safe Edge Crawl Corridors:**
  - When advancing towards the enemy base, tanks avoid the lethal central frontal corridor ($Y \in [36, 64]$ within $45\text{ m}$ of the enemy wall) covered by the base slit guns (`isInEnemySlitGunSector`).
  - Beyond the $50\text{m}$ shell range (plus $2\text{m}$ safety margin), tanks can operate freely without hazard penalties.
  - Safe edge crawl corridors along the North ($Y \le 9.0\text{m}$, routing at $Y = 7.5\text{m}$) and South ($Y \ge 91.0\text{m}$, routing at $Y = 92.5\text{m}$) arena walls lie strictly outside the $\pm 45^\circ$ traverse limit of the slit windows, allowing flankers to bypass defensive fire.
- **Tactical Gate Ambush & Outgoing Intercept:**
  - Ambush posts are positioned at $X = X_{\text{gate}} \mp 8.5\text{ m}$, $Y = 30.0\text{ m}$ (North post) and $Y = 70.0\text{ m}$ (South post), outside the 45° traverse limit of both hangar slit guns.
  - Ambush tanks hold position with zero commanded speed and guns pre-aimed across the doorway threshold ($(X_{\text{gate}} \mp 2.0, 50.0)$), prioritizing outgoing enemy tanks to destroy them immediately upon exiting the hangar.
- **Asymmetric Brigade Doctrines:**
  - Opposing brigades randomly roll independent tactical doctrines (`NORTH_SWEEP`, `SOUTH_SWEEP`, `PINCER_AMBUSH`, `SPEARHEAD_WEDGE`, `ASYMMETRIC_SPLIT`), assigning varied roles (`NORTH_GATE_AMBUSH`, `SOUTH_GATE_AMBUSH`, `VANGUARD`, flankers, and sentries).
  - Main offensive formations hold safe standoff at $52\text{m}$ from the enemy gate until a doorway breach is initiated.
  - Individual tank cruising speeds (27 to 36 km/h on HARD) and staggered mobilization delays (0.0 to 2.0s) spread out the brigade into dynamic echelons, completely eliminating mirror symmetry.

### 15.10 Test Harness (`test.cmd` & `test/run_tests.js`)
- Fixed batch command `.\test.cmd` executing `node test/run_tests.js` without dynamic arguments.
- Executes unit test suites (`test/test_nav.js`) covering cost grid differentiation, curvilinear prediction, gate reservation, trajectory rollout, and slit gun sector avoidance/ambush geometry, alongside end-to-end CvC 60Hz physics simulations (`test/test_ai_integration.js`).

---

## 16. Constants Summary (initial)

| Constant | Value | Unit |
|---|---|---|
| `SIM_TICK_HZ` | 60 | Hz |
| `FIELD_LENGTH_M` / `FIELD_WIDTH_M` | 250 / 100 | m |
| `TANK_LENGTH_M` / `TANK_WIDTH_M` / `TANK_HEIGHT_M` | 6 / 4 / 2.5 | m |
| `GATE_WIDTH_M` | 7 | m |
| `TANKS_ON_FIELD_MAX` | 5 | |
| `HANGAR_ROWS` × `HANGAR_SLOTS_PER_ROW` | 2 × 5 | |
| `TANKS_PER_PLAYER` | 15 | |
| `TANK_MAX_SPEED_KMH` / `TANK_MAX_REVERSE_KMH` | 36 / 6 | km/h |
| `TANK_SPEED_STEPS_KMH` | `[-6, 0, 6, 18, 36]` | km/h |
| `TANK_LINEAR_ACCEL_MS2` | 3.33 / 6.67 / 10.0 (0.5s per step) | m/s² |
| `TANK_MAX_TURN_DEG_S` / `TANK_MAX_PIVOT_TURN_DEG_S` | 45 / 30 | °/s |
| `TURN_STEP_DEG_S` | 15 | °/s |
| `TANK_TURN_ACCEL_DEG_S2` | 30 (0.5s per step) | °/s² |
| `KEY_REPEAT_MS` | 150 | ms |
| `BORDER_DRAG_FACTOR` / `TANK_CONTACT_TURN_FACTOR` | 0.5 / 0.5 | |
| `TANK_START_SHELLS` / `MINES` / `SMOKES` | 5 / 2 / 2 | |
| `GUN_RELOAD_S` / `WINDOW_RELOAD_S` | 1 / 1.5 | s |
| `SHELL_RANGE_M` / `SHELL_FLIGHT_TIME_S` | 50 / 0.4 | m / s |
| `MINE_DROP_BEHIND_M` / `MINE_ARM_DELAY_S` / `MINE_TRIGGER_RADIUS_M` | 1.5 / 1.5 / 1 | m / s / m |
| `SMOKE_RADIUS_M` / `SMOKE_LIFETIME_S` / `SMOKE_FADE_S` | 10 / 10 / 2 | m / s / s |
| `WINDOW_OFFSET_FROM_GATE_M` / `WINDOW_LENGTH_M` | 8 / 5 | m |
| `WINDOW_MAX_YAW_DEG` / `WINDOW_YAW_RATE_DEG_S` | 45 / 30 | ° / °/s |
| `WINDOW_YAW_STEP_DEG_S` / `WINDOW_YAW_ACCEL_DEG_S2` | 15 / 30 (0.5s per step) | °/s / °/s² |
| `DEAD_ZONE_DEPTH_M` | 6 | m |
| `START_BORDER_GAP_M` / `START_SPACING_M` | 6 / 10 | m |
| `CAMERA_HEIGHT_M` / `CAMERA_FOV_DEG` | 2.2 / 60 | m / ° |
| `EXPLOSION_DURATION_S` | 1 | s |
| `SAVE_SLOT_COUNT` | 10 | |
| `AI_MAX_FIRE_DIST_M` | 115 | m |
| `AI_ENGAGE_FAR_DIST_M` | 55 | m |
| `AI_SMOKE_LOW_AMMO_DIST_M` | 35 | m |
| `AI_SMOKE_INCOMING_SHELL_DIST_M` | 30 | m |
| `AI_SMOKE_SHELL_DOT_THRESHOLD` | 0.8 | |
| `AI_MINE_BEHIND_ANGLE_RAD` | 0.7 | rad |
| `AI_TARGET_STICKINESS_BONUS` | 20 | |
| `AI_TARGET_LOS_BLOCKED_PENALTY` | 70 | |
| `AI_TARGET_THREAT_ANGLE_WEIGHT` | 18 | |
| `AI_TARGET_FACING_US_BONUS` | 14 | |
| `AI_TARGET_NOISE_AMPLITUDE` | 6 | |
| `AI_TICK_JITTER_FRACTION` | 0.25 | |
| `AI_COORD_JITTER_FRACTION` | 0.35 | |
| `AI_STANDOFF_JITTER_M` | 3.5 | m |
| `AI_SPEED_JITTER_KMH` | 3 | km/h |
| `AI_LANE_OFFSET_MAX_M` | 16 | m |
| `AI_SLIT_DEFENSE_TRIGGER_DIST_M` | 40 | m |
| `AI_SLIT_AIM_TOLERANCE_RAD` / `FIRE_TOLERANCE_RAD` | 0.08 / 0.12 | rad |
| `AI_SLIT_MAX_FIRE_DIST_M` | 50 | m |
| `AI_MOBILIZE_CRUISE_KMH` | 18 | km/h |
| `AI_TRAJECTORY_WEAVE_AMP_M` | 5.0 | m |
| `AI_TRAJECTORY_WEAVE_FREQ` | 0.65 | Hz |
| `AI_VEHICLE_AVOIDANCE_LOOKAHEAD_M` | 16.0 | m |
| `AI_VEHICLE_AVOIDANCE_CLEARANCE_M` | 5.2 | m |
| `AI_OBLIQUE_ENGAGE_LATERAL_M` | 10.0 | m |
| `AI_REARM_STANDOFF_DIST_M` | 22.0 | m |
| `AI_REARM_ALIGN_LATERAL_M` | 1.2 | m |
| `AI_REARM_PENETRATION_DEPTH_M` | 12.0 | m |
| `AI_REARM_RESET_DIST_M` | 18.0 | m |
| `AI_URGENCY_DEPLOY_ARMED_RESERVE` | 92 | |
| `MAP_TARGET_ARROW_WIDTH_PX` | 1.5 | px |
| `MAP_TARGET_ARROW_HEAD_LEN_M` | 3.2 | m |
| `MAP_TARGET_ARROW_HEAD_ANGLE_RAD` | 0.42 | rad |
| `OBSTACLE_HEIGHT_M` | 4.8 | m |
| `OBSTACLE_ROOF_HEIGHT_M` | 1.6 | m |
| `OBSTACLE_ROOF_EAVE_M` | 0.5 | m |

---

## 17. Decisions Log (confirmed by user)

| Ref | Topic | Decision |
|---|---|---|
| A8 | Control model | One speed/turn step per key press; holding repeats every `KEY_REPEAT_MS`. |
| A14 | Window shooting | Allowed, unlimited ammo, `WINDOW_RELOAD_S` between shots. |
| A11, A13 | Friendly fire | Own shells and own mines destroy own tanks. |
| A5 | Mine visibility | Visible to both players on the map and in 3D. |
| A6, A12 | Smoke | Blocks 3D vision, hides tanks on the map; shells pass through. |
| A17 | Blocked gate | Selected hangar tank deploys automatically once the exit is clear. |
| A18 | Rearm | Tank enters a hangar slot, is refilled, must be re-deployed via its number key. |
| A2 | Build tooling | Vite + Three.js from npm. |
| A19 | Sound | Simple synthesized Web Audio effects in v1. |
| A15 | Window targeting | Direct ballistic line of sight without dead zone immunity. |
| A20 | Barracks Architecture | Buildings feature slightly conical / hipped roofs with overhangs and per-building wall variations in bright, unsaturated gray and brown tones. |

## 18. Remaining Assumptions (not yet confirmed — defaults apply)

- **[A1]** Flat/Lambert shading, low-poly models.
- **[A3]** Field has no obstacles.
- **[A4]** Minimum resolution 1280×720.
- **[A7]** Gun fixed to hull (no turret rotation).
- **[A9]** Border/contact drag applies only while touching; commanded speeds are preserved.
- **[A10]** Gun reload delay `GUN_RELOAD_S` = 1 s.
- **[A16]** Tanks 1 and 6 are selected at game start.
- All numeric values in §16 are starting points for play-testing.
