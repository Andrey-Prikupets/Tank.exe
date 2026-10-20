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

---

## 4. Screen Layout

```
+-----------------------------------------------------------------+
| [hangar L] |               STRATEGIC MAP               | [hangar R] |   ~48%
|            |  (green field, red & blue tanks, shells,  |            |
|            |   mines, smoke, gates, windows)           |            |
+--------------------------------+--------------------------------+
|                                |                                |
|      LEFT PLAYER 3D VIEW       |      RIGHT PLAYER 3D VIEW      |   ~50%
|         (+ crosshair)          |         (+ crosshair)          |
|  [Rounded Inventory (Left)]    |   [Rounded Inventory (Right)]  |
+--------------------------------+--------------------------------+
|  [Debug strip: Speed / Turn telemetry - hidden or low-contrast] |   ~2%
+-----------------------------------------------------------------+
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
- The view may show own-tank barrel tip at the bottom-center for orientation.

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
- **Debug Indicators:**
  - `SPEED` and `TURN` telemetry are debug indicators and are removed from the player's cockpit overlay, moved to a subtle, unobtrusive debug bar at the very bottom of the screen.

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
| Right hangar window | `R` | `]` |
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

---

## 6. Tank Movement

### 6.1 Model
Each tank has:
- `heading` (rad), `pos` (x, y).
- **Commanded** linear speed `cmdSpeed` and **commanded** turn rate `cmdTurn` — set by key steps.
- **Actual** linear speed `speed` and **actual** turn rate `turn` — approach the commanded values
  with limited acceleration (**inertia**).

Every tick:
```
speed += clamp(cmdSpeed - speed, ±TANK_LINEAR_ACCEL_MS2 * dt)
turn  += clamp(cmdTurn  - turn,  ±TANK_TURN_ACCEL_DEG_S2 * dt)
heading += turn * dt
pos += (cos heading, sin heading) * speed * dt
```
then collisions (§7) are resolved.

### 6.2 Limits (initial values)

| Constant | Value |
|---|---|
| `TANK_MAX_SPEED_KMH` | 36 (≈10 m/s; crosses the field in ~25 s) |
| `TANK_MAX_REVERSE_KMH` | 12 |
| `SPEED_STEP_KMH` | 6 (6 steps to full forward, 2 to full reverse) |
| `TANK_LINEAR_ACCEL_MS2` | 3 |
| `TANK_MAX_TURN_DEG_S` | 60 |
| `TURN_STEP_DEG_S` | 15 (4 steps to full rate each way) |
| `TANK_TURN_ACCEL_DEG_S2` | 60 |
| `KEY_REPEAT_MS` | 150 |

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

- Each player can switch their 3D view to one of their two hangar windows (`Q`/`R` or `[`/`]`).
- Window positions: in the player's border wall, centered `WINDOW_OFFSET_FROM_GATE_M` (8) above and
  below the gate center, length `WINDOW_LENGTH_M` (5).
- View is rendered through a **narrow horizontal slit** mask (black above/below) to look like a
  window; crosshair in the center.
- Default facing: perpendicular to the wall, into the field.
- Turn keys (`A`/`D`, `←`/`→`) **rotate the view** (not a tank) by up to `WINDOW_MAX_YAW_DEG` (45,
  i.e. 50 % of the 90° to the wall) each side, at `WINDOW_YAW_RATE_DEG_S`.
- Accelerate/decelerate keys have no effect in window view.
- Fire key shoots a shell from the window along the view direction. **Unlimited ammo**, limited by
  `WINDOW_RELOAD_S` (1.5) between shots (per window). Same shell range/speed as tank shells. **[A14]**
- Mine/smoke keys have no effect in window view.
- Leaving window view: press a tank number key, or press the same window key again (returns to the
  last tank). Pressing the other window key switches windows.
- While in window view, the player's tanks continue moving per their commands.

### 9.1 Gate dead zone
- Rectangle directly in front of the gate: width = `GATE_WIDTH_M` + 2 × 0.5 × `TANK_LENGTH_M`,
  depth `DEAD_ZONE_DEPTH_M` (= 1 tank length). **[A15]**
- A tank in the dead zone **is visible** from the windows but **cannot be hit** from them: shells
  fired from a window ignore any tank whose center is inside the dead zone.
- Window yaw limits and positions are chosen so that the crosshair cannot point into the dead zone
  anyway; the shell rule is the authoritative guarantee.

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

### 10.3 Deploying from the hangar
- Selecting a numbered tank that is in the hangar attempts to **deploy** it:
  - The gate doors **slide open**; once fully open the tank appears just outside the gate (rear edge
    `SPAWN_OFFSET_FROM_GATE_M` from the wall), facing into the field, speed zero; the doors close right after.
  - Spawn position: just outside the gate in the field, facing into the field, speed zero.
  - If the spawn area (`GATE_SPAWN_ZONE`, a tank-sized OBB + `SPAWN_CLEARANCE_M`) overlaps **any**
    tank (own or enemy), deployment is **blocked**; banner shows `GATE BLOCKED`. The tank stays
    selected and deploys automatically as soon as the area becomes clear.
  - Mines in the spawn area do **not** block deployment — the tank is destroyed on exit if one is there.
- While selected but still in the hangar, the 3D view looks out through the gate.

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
- `GAME_OVER` screen shows winner and stats (tanks lost, shots fired, hits); options:
  New game, Main menu.

### 11.3 Menus & Navigation

The game launches into the **Tank.exe Title Menu**:
- Title banner: `Tank.exe`
- Subtitle: `Two players · one keyboard · 90s split-screen tank combat`
- Options:
  1. **Start game**
  2. **Load game** (choose slot 1..10)
  3. **Players: Human vs Human | Human vs Computer | Computer vs Human** (1st is left player, 2nd is right)
  4. **Level: HARD | MEDIUM | EASY** (visible only when Computer mode is selected)
  5. **Options** (opens the Options submenu)
  6. **Help** (opens a scrollable modal detailing game concept, 90s lore, rules, and controls table)

**In-Game Pause Menu (`Esc`):**
- Pauses the fixed-step simulation immediately.
- Options:
  1. **Resume**
  2. **Save game** (choose slot 1..10)
  3. **Load game** (choose slot 1..10)
  4. **New game** (with loss confirmation)
  5. **Players: Human vs Human | Human vs Computer | Computer vs Human** (1st is left player, 2nd is right)
  6. **Level: HARD | MEDIUM | EASY** (visible only when Computer mode is selected)
  7. **Options** (opens the Options submenu)
  8. **Help** (scrollable modal with rules & controls)

**Options Submenu (`Options`):**
- Title: `OPTIONS`
- Subtitle: `Game & Audio Settings`
- Options:
  1. **Sound: ON | OFF** (toggles Web Audio master output)
  2. **Obstacles: ON | OFF** (toggles building obstacles generator; initial default: `OFF`)
  3. **Pits: ON | OFF** (toggles water pit / trench hazard generator; initial default: `OFF`)
  4. **Back** (returns to previous menu)

---

## 12. Computer AI & Difficulty Levels

When a player side is designated as **Computer** (`Human vs Computer` → Right player AI; `Computer vs Human` → Left player AI), an autonomous AI controller operates that player's battalion:

### 12.1 Core AI Capabilities
- **Autonomous Reserve Deployment:** When casualties occur or fewer than 5 tanks are deployed, the AI detects numbered spares in the hangar and issues deployment selection commands to restore battlefield strength.
- **Target Selection & Ballistics:** Evaluates all active enemy tanks on the field based on distance and angular deviation to designate priority targets.
- **Friendly Fire Prevention:** Performs line-of-fire raycast checks against friendly tanks before discharging shells to eliminate team-kills.
- **Terrain & Hazard Avoidance:** Proactively steers around building obstacles and detects forward water pits, turning away and executing emergency braking when near pit boundaries.
- **Obstacle Awareness:** Shell line-of-fire raycasting verifies that buildings do not obstruct the trajectory before firing, avoiding wasted munitions.
- **Defensive Smoke & Mines:** Deploys smoke screens when ammo is low or incoming high-velocity shells are detected; places anti-tank mines when closely pursued.
- **Tactical Rearming:** When all ammunition and defensive stores are depleted, retreats to the home base gate to rearm and redeploy.

### 12.2 Difficulty Profiles
- **EASY:**
  - Reaction / decision interval: ~0.35s.
  - Aim tolerance: ~16° direct line-of-sight aiming without predictive lead.
  - Max forward speed: 18 km/h.
  - Conservative weapon and countermeasure usage.
- **MEDIUM:**
  - Reaction / decision interval: ~0.18s.
  - Aim tolerance: ~8° with partial predictive lead calculation.
  - Max forward speed: 30 km/h.
  - Coordinates idle field tanks into battle; deploys smoke and mines tactically.
- **HARD:**
  - Reaction / decision interval: ~0.08s.
  - High precision aiming: ~3.5° tolerance with full predictive target velocity lead.
  - Full top speed: 36 km/h.
  - Aggressive multi-tank brigade maneuvers, active shell avoidance, smoke countermeasures, and relentless pursuit.

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

## 15. Out of Scope (v1)
Music, sampled audio, AI opponents, online play, gamepads, mobile/touch, terrain/obstacles.

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
| `TANK_MAX_SPEED_KMH` / `TANK_MAX_REVERSE_KMH` | 36 / 12 | km/h |
| `SPEED_STEP_KMH` | 6 | km/h |
| `TANK_LINEAR_ACCEL_MS2` | 3 | m/s² |
| `TANK_MAX_TURN_DEG_S` / `TURN_STEP_DEG_S` | 60 / 15 | °/s |
| `TANK_TURN_ACCEL_DEG_S2` | 60 | °/s² |
| `KEY_REPEAT_MS` | 150 | ms |
| `BORDER_DRAG_FACTOR` / `TANK_CONTACT_TURN_FACTOR` | 0.5 / 0.5 | |
| `TANK_START_SHELLS` / `MINES` / `SMOKES` | 5 / 2 / 2 | |
| `GUN_RELOAD_S` / `WINDOW_RELOAD_S` | 1 / 1.5 | s |
| `SHELL_RANGE_M` / `SHELL_FLIGHT_TIME_S` | 62.5 / 0.4 | m / s |
| `MINE_DROP_BEHIND_M` / `MINE_ARM_DELAY_S` / `MINE_TRIGGER_RADIUS_M` | 1.5 / 1.5 / 1 | m / s / m |
| `SMOKE_RADIUS_M` / `SMOKE_LIFETIME_S` / `SMOKE_FADE_S` | 10 / 10 / 2 | m / s / s |
| `WINDOW_OFFSET_FROM_GATE_M` / `WINDOW_LENGTH_M` | 8 / 5 | m |
| `WINDOW_MAX_YAW_DEG` / `WINDOW_YAW_RATE_DEG_S` | 45 / 45 | ° / °/s |
| `DEAD_ZONE_DEPTH_M` | 6 | m |
| `START_BORDER_GAP_M` / `START_SPACING_M` | 6 / 10 | m |
| `CAMERA_HEIGHT_M` / `CAMERA_FOV_DEG` | 2.2 / 60 | m / ° |
| `EXPLOSION_DURATION_S` | 1 | s |
| `SAVE_SLOT_COUNT` | 3 | |

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

## 18. Remaining Assumptions (not yet confirmed — defaults apply)

- **[A1]** Flat/Lambert shading, low-poly models.
- **[A3]** Field has no obstacles.
- **[A4]** Minimum resolution 1280×720.
- **[A7]** Gun fixed to hull (no turret rotation).
- **[A9]** Border/contact drag applies only while touching; commanded speeds are preserved.
- **[A10]** Gun reload delay `GUN_RELOAD_S` = 1 s.
- **[A15]** Dead zone depth = 1 tank length.
- **[A16]** Tanks 1 and 6 are selected at game start.
- All numeric values in §16 are starting points for play-testing.
