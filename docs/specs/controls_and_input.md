# Controls & Input Subsystem

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Physical Keyboard Mapping

All inputs use `KeyboardEvent.code` to maintain physical key location independence regardless of OS language layout. In-game keys invoke `preventDefault()` to suppress browser defaults (e.g. `Tab` focus shifting).

### 1.1 Out-of-the-Box Split-Screen Layout (`tank.exe.keys.splitscreen`)
Designed for two human players sharing a single physical keyboard:

| Action | Left Player (Red) | Right Player (Blue) |
|---|---|---|
| Select Tank 1..5 | `Digit1` `Digit2` `Digit3` `Digit4` `Digit5` | `Digit6` `Digit7` `Digit8` `Digit9` `Digit0` |
| Accelerate (Step Up) | `KeyW` (`W`) | `ArrowUp` (`↑`) |
| Decelerate / Reverse (Step Down) | `KeyS` (`S`) | `ArrowDown` (`↓`) |
| Turn Left (Step) | `KeyA` (`A`) | `ArrowLeft` (`←`) |
| Turn Right (Step) | `KeyD` (`D`) | `ArrowRight` (`→`) |
| Left Hangar Slit Window | `KeyQ` (`Q`) | `BracketLeft` (`[`) |
| Right Hangar Slit Window | `KeyE` (`E`) | `BracketRight` (`]`) |
| Main Cannon Fire | `Tab` | `Enter` / `NumpadEnter` |
| Deploy Mine | `KeyZ` (`Z`) | `Comma` (`,`) |
| Release Smoke Screen | `KeyX` (`X`) | `Period` (`.`) |
| Pause / Menu (Shared) | `Escape` | `Escape` |

*Note on Slit Windows:* "Left/Right" is relative to looking out of the gate into the field:
- Left Player (+X): Left = upper window ($Y = 42\text{ m}$), Right = lower window ($Y = 58\text{ m}$).
- Right Player (-X): Left = lower window ($Y = 58\text{ m}$), Right = upper window ($Y = 42\text{ m}$).

### 1.2 Dedicated Network Layout (`tank.exe.keys.network`)
Automatically engaged when entering a serverless P2P network match, giving the local player full single-player keyboard access:
- Tank Selection: `1`, `2`, `3`, `4`, `5`
- Speed & Steering: `↑` forward/accelerate, `↓` reverse/decelerate, `←` steer left, `→` steer right
- Hangar Slit Windows: `Q` left window, `E` right window
- Main Cannon Fire: `Tab`
- Tactical Weapons: `Z` drop mine, `X` smoke screen

---

## 2. Key Repeat & Discrete Stepping Mechanics

- Each key press modifies commanded speed or turn rate by one discrete increment (`SPEED_STEP_KMH`, `TURN_STEP_DEG_S`).
- Holding a key repeats the command step every `KEY_REPEAT_MS = 150ms` using custom internal game timers, ignoring unpredictable OS auto-repeat settings.

---

## 3. Visual Desktop Keyboard Layout Configurator

Accessed via **Options → Keyboard layout**:
- **104-Key Desktop Keyboard Visualizer:** Renders a complete QWERTY desktop chassis with function keys, main typing block, inverted-T navigation arrows, and numeric keypad.
- **Color-Coded Overlays:** Assigned keycaps display tinted overlays (Red for Left player, Blue for Right player, Emerald Green for Network layout) with compact function badges.
- **Drag-and-Drop & Click-to-Bind:**
  - Function frames from bottom palettes can be dragged directly onto keycaps.
  - Alternatively, clicking a function badge and subsequently clicking a keycap or pressing any physical key binds the action.
- **OS & Browser Protection:** Essential system keys (`F1`..`F12`, `Win`/`Meta`, `ContextMenu`, `Escape`, `PrintScreen`) are locked with a `not-allowed` indicator and cannot be overwritten.
- **Segmented Layout Switcher:** Allows players to toggle between customizing the Split-Screen layout and the Network layout independently.

---

## 4. Mobile Touch Controls & Ergonomic Adaptation

Touch environments are detected dynamically via `'ontouchstart'`, `navigator.maxTouchPoints > 0`, and CSS `(pointer: coarse)`.

### 4.1 Layout Ergonomics by Match Mode
- **Split-Screen Human vs Human (`HvH` on one mobile device):**
  - Left Player (Red): Controls clustered at the bottom-left; inventory HUD shifted to the inner seam.
  - Right Player (Blue): Controls clustered at the bottom-right; inventory HUD shifted to the inner seam.
  - Keeps both players' active thumbs at the outer screen corners, preventing hand collision across the central divider.
- **Human vs Computer (`HvC` or `CvH`):**
  - Two-handed thumb spread: Steering joystick and `[STOP]` on the left screen edge; tactical weapons (`[MINE]`, `[SMOKE]`, `[FIRE]`) on the right screen edge.
  - Cockpit Inventory HUD centered between thumb pads.

### 4.2 2-Axis Drone-Style Virtual Analog Joystick
- **Horizontal Axis (Steering):** Proportional deflection calculates continuous rotational velocity:
  - Subtle deflection: Course trim (~15°/s).
  - Half deflection: Standard combat turn (30°/s – 45°/s).
  - Full deflection: Maximum turn rate (60°/s moving, 75°/s stationary pivot).
  - Spring-centers to 0°/s on touch release.
  - In slit window view, smoothly rotates observation yaw.
- **Vertical Axis (Throttle):**
  - Deflecting UP past deadzone steps forward speed (repeats every 150 ms). Deploys reserve tanks if selected in hangar.
  - Deflecting DOWN past deadzone steps reverse speed.
- **Emergency Stop (`[STOP]`):** Dedicated button instantly zeroes commanded speed and turn rate.

### 4.3 Tactical Weapons & Selection Ribbons
- **Tactical Buttons:** `[MINE]` and `[SMOKE]` situated on top row; large `[FIRE]` button on bottom row closest to the thumb.
- **Selection Ribbon:** Semi-transparent unit buttons `[1]` through `[5]` plus slit window toggles `[L]` and `[R]`, highlighting in amber gold (`#ffd54a`) when active.
- **Automatic Landscape Lock:** Entering a match automatically requests fullscreen and locks screen orientation to landscape (`screen.orientation.lock('landscape')`). Fullscreen exits and orientation unlocks upon opening pause or title menus.
