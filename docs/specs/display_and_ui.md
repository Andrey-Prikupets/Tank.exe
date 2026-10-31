# Display, Viewports & User Interface

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Master Screen Layout

The screen divides vertical space into a shared top-down strategic map and two first-person 3D cockpit viewports:

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

- **Aspect Ratio & Scaling:** Map maintains the 2.5:1 field aspect ratio (plus hangar side margins), letter-boxed if needed. Minimum target display resolution is $1280 \times 720\text{ px}$ (`MIN_SCREEN_W_PX × MIN_SCREEN_H_PX`).
- **Dynamic Viewport Height Scaling:** The root `#app` container dynamically tracks the visible screen height via `window.visualViewport` / `window.innerHeight` (`--app-h`, `100dvh` fallback) and computes a proportional UI scale (`--ui-scale`). When not in fullscreen (e.g., mobile browser toolbars visible), the game cleanly scales down to fit the smaller visible height; when the user enters fullscreen, the game immediately rescales to the full screen height.
- **Dual Viewports (Standard Modes):** Bottom area is split 50/50 horizontally between the Left player (Red) and Right player (Blue).
- **HUD Integration (Standard Modes):** Inventory telemetry is docked inside the 3D viewports rather than occupying separate bottom screen strips.

### 1.1 Dedicated Network HvH Layout (`#app.net-hvh-layout`)

Exclusively in **Human vs Human (Network)** mode, the screen layout reorganizes to maximize local situational awareness and keep the local player's 3D viewport 100% unobstructed:

```
+-----------------------------------------------+-----------------------+
|                                               |                       |
|                 STRATEGIC MAP                 |    OTHER PLAYER'S     |   ~48%
|             (shifted to very left)            |       3D SCREEN       |
|    [hangar L]   [250x100 field]   [hangar R]  |   (right of the map)  |
|                                               |  [+crosshair & HUD]   |
+-----------+-----------------------------------+-----------+-----------+
|   BLACK   |                                               |   BLACK   |
|  SIDEBAR  |            CURRENT PLAYER 3D SCREEN           |  SIDEBAR  |   ~52%
|   (25%)   |             (centered, 50% width)             |   (25%)   |
|           |                                               |           |
| [1..5|L|R]|                 (+ crosshair)                 | [Inv HUD] |
| [Joystick]|                                               | [MIN][SMK]|
|  [STOP]   |                                               |  [FIRE]   |
+-----------+-----------------------------------------------+-----------+
```

- **Top Half — Left-Aligned Map + Opponent 3D View:**
  - The 2D strategic map remains in the top half (`48%` height) but shifts to the **very left** (`left = 0`, capped at `NET_MAP_MAX_WIDTH_FRAC = 0.78` of width on narrow displays).
  - The **other player's 3D screen** is rendered in the available space to the **right of the map**, with its maximum height equal to the drawn map height and its width filling the remaining right-hand space. It displays the opponent's 3D view, crosshair, slit-window masks, banners, and proportionally scaled inventory HUD.
- **Bottom Half — Centered Local 3D View + 25% Black Sidebars:**
  - The **current (local) player's 3D screen** is centered horizontally in the middle of the bottom half at `50%` screen width (`NET_LOCAL_VIEW_WIDTH_FRAC = 0.5`), flanked by `25%` pure black sidebars on the left and right.
  - **Left Black Sidebar (25% width):** Houses the local player's unit & slit selection buttons (`[1]..[5]`, `[L]`, `[R]`) at the top and navigation controls (2-axis analog joystick + `[STOP]`) at the bottom.
  - **Right Black Sidebar (25% width):** Houses the local player's ammunition/mine/smoke inventory overlay (`.inv-overlay`) outside the 3D screen, plus the tactical weapon buttons (`[MINE]`, `[SMOKE]`, `[FIRE]`) at the bottom when touch controls are active.

---

## 2. 2D Strategic Map

The 2D map is rendered every frame to an HTML5 `<canvas>`:

- **Field & Margins:** Solid green arena turf (`COLOR_FIELD = #3f9b3f`) surrounded by dark outer margins (`COLOR_OUTSIDE = #1a1a1a`). Hangars feature light gray floors and walls (`COLOR_HANGAR_FLOOR`, `COLOR_HANGAR_WALL`).
- **Tank Representation:**
  - Faceted bodies with 8 chamfered corners drawn to exact world scale.
  - Short gun barrel extending forward from an octagonal turret head (`TURRET_RADIUS_M = 1.6m`, barrel length $2.4\text{ m}$).
  - Left team is red (`COLOR_LEFT_TEAM = #cc3333`), Right team is blue (`COLOR_RIGHT_TEAM = #3366cc`).
  - Active/selected tank is highlighted in a noticeably brighter tint.
  - Tactical unit digits (1..5) are rendered bold and upright inside the octagonal turret using analytical vector strokes to eliminate sub-pixel raster jitter.
  - Unnumbered reserve tanks in hangars appear blank until assigned.
- **Projectiles & Tactical Entities:**
  - Shells: Crisp bright flying dots.
  - Mines: Isometric cross/disc markers.
  - Smoke Clouds: Semi-opaque gray filled circles rendered above tanks (tanks underneath are obscured on radar).
  - Explosions: Expanding orange blast circles.
- **Locked Target Arrows:**
  - Thin directional arrows (`MAP_TARGET_ARROW_WIDTH_PX = 1.5px`) connect an active unit to its locked target (Red: `#ff5544`, Blue: `#4488ff`).
  - When observing through a hangar slit window, the arrow originates directly from the active slit aperture on the wall.
  - Arrowheads stop neatly at the target hull perimeter without obscuring unit numbers.
- **Aiming Debug Vectors (`?debugVectors=Y`):**
  - Renders physical shell flight reach vectors ($50\text{ m}$) from tank gun barrels with terminal range circles in matching team colors.

---

## 3. 3D Viewports & Three.js Rendering

- **Camera Mounting:** Positioned on the active tank at `CAMERA_HEIGHT_M = 2.0m`, aligned directly with the forward gun axis. Field of view: `CAMERA_FOV_DEG = 60°`.
- **Target Reticle:** Fixed crosshair centered in each viewport, calibrated to align with the upper-center of enemy tank hulls.
- **Gun Rigidity:** The cannon is rigidly fixed to the hull—aiming requires steering or pivoting the tank.
- **Visual Styling & Lighting:**
  - Low-poly aesthetic: faceted 8-corner hulls, elevated octagonal turrets (`TURRET_HEIGHT_M = 1.25m`), chamfered details.
  - Shading: `MeshPhongMaterial` with `flatShading: true` produces readable facet contrast across all hull corners.
  - Directional Sun Light: Elevated diagonal angle $(0.25, 0.9, 0.75)$ balances illumination for east- and west-bound tanks equally.
  - Ambient & Fill Light: Cool ambient fill ($0.65$) and secondary fill ($0.30$) keep shadowed facets legible.
- **Smoke Obscuration:** Entering a smoke cloud engages dense distance fog restricting visibility to $\le 2\text{ m}$.
- **Depth Stability:** Hangar slit aperture views utilize high WebGL depth precision (`highp`), polygon offset on the combat arena floor, and a recessed outside terrain elevation ($Y = -1.0\text{ m}$) to eliminate Z-fighting flicker.

---

## 4. In-Viewport Rounded Inventory Overlay

Docked inside the bottom corner of each player's 3D viewport inside a semi-transparent cockpit visor frame (`border-radius: 8px`, `background: rgba(10, 16, 12, 0.7)`):

- **Left Player:** Docked at bottom-left, elements left-aligned.
- **Right Player:** Docked at bottom-right, elements right-aligned.
- **Two-Row Compact Layout:**
  - **Row 1:** Main cannon ammunition shells (horizontal row of vertical projectiles).
  - **Row 2:** Anti-tank mines and smoke canisters, separated by a thin vertical divider.
- **Pure Graphical Icons:**
  - Available shells appear bright brass/yellow; expended shells render as dim wireframe ghost outlines.
  - Isometric mine icons showing casing depth and arming fuze cap.
  - Billowing smoke cloud icon.
  - Strictly no textual labels (`AMMO`, `MINES`, `SMOKE`, or team names) and no tank numbers within the frame.
- **Slit Window Mode:** The inventory overlay automatically hides while observing through a hangar slit window (since window artillery ammunition is unlimited).

---

## 5. Menus & Navigation UX

- **Title Menu:**
  - Options: *Start game*, *Load game* (slots 1..10), *Game Mode*, *Level* (when Computer is selected), *Game Playback*, *Options*, *Help*, *History*.
- **Pause Menu (`Esc`):**
  - Instantly suspends the fixed-step physics simulation.
  - Options: *Resume game*, *Save game*, *Load game*, *New game*, *Main menu*, *Game Mode*, *Level*, *Options*, *Help*, *History*.
- **Options Submenu:**
  - *Sound: ON | OFF*, *Textures: ON | OFF*, *Obstacles: ON | OFF*, *Pits: ON | OFF*, *Touch controls: AUTO | ON | OFF*, *Recording: ON | OFF*, *Keyboard layout*, *Back*.
- **Layout Behavior:**
  - Menu cards anchor to a fixed top offset and expand downwards to prevent vertical jitter when toggling mode options.
  - Fixed responsive width (`min(620px, 94vw)`) eliminates horizontal width shifting between submenus.
  - Hovering does not move keyboard navigation focus; selection requires explicit click or Enter.
  - Help and History modals offer English, Spanish, and Russian translations with in-header language switchers and keyboard shortcut `L`.
