# Tank Kinematics, Combat & Ballistics

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Kinematic Movement Model

Each tank state contains:
- Heading $\theta$ (radians), position $(x, y)$ in metres.
- Commanded linear speed `cmdSpeedKmh` and commanded turn rate `cmdTurnDeg` (set by key steps).
- Actual linear speed `speed` and actual turn rate `turn` (converge toward commanded values via step acceleration).

### 1.1 Fixed-Timestep Update (Every Tick at 60 Hz)
```
speed   += clamp(cmdSpeed - speed, ±getLinearAccelMs2(speed) * dt)
turn    += clamp(cmdTurn  - turn,  ±degToRad(TANK_TURN_ACCEL_DEG_S2) * dt)
heading += turn * dt
pos     += (cos(heading), sin(heading)) * speed * dt
```
Followed immediately by collision resolution.

### 1.2 Speed & Turn Ladders
- **Linear Speed Steps:**
  - Forward: 3 discrete steps: `+6 km/h`, `+18 km/h`, `+36 km/h`.
  - Neutral: `0 km/h`.
  - Reverse: 1 discrete step: `-6 km/h`.
  - Complete ladder: `[-6, 0, 6, 18, 36] km/h`.
- **Rotational Turn Steps:**
  - While Moving (`speed ≠ 0`): 3 steps per direction: `15°/s`, `30°/s`, `45°/s` (ladder: `[-45, -30, -15, 0, 15, 30, 45] °/s`).
  - While Stationary (`speed = 0`, Pivot Turn): 2 steps per direction: `15°/s`, `30°/s` (ladder: `[-30, -15, 0, 15, 30] °/s`).

### 1.3 Acceleration Timing (0.5s per Step Transition)
- Transitioning between adjacent speed steps requires exactly **0.5 seconds**:
  - `0 ↔ ±6 km/h`: $12\text{ km/h/s} = 3.333\text{ m/s}^2$
  - `6 ↔ 18 km/h`: $24\text{ km/h/s} = 6.667\text{ m/s}^2$
  - `18 ↔ 36 km/h`: $36\text{ km/h/s} = 10.000\text{ m/s}^2$
- Transitioning between adjacent turn steps takes **0.5 seconds**:
  - `TANK_TURN_ACCEL_DEG_S2 = 30 °/s²`.
- **Deceleration on STOP:** Setting commanded speed and turn to 0 decelerates the tank smoothly through each intermediate step:
  - From $36\text{ km/h}$: 1.5 seconds (36 $\to$ 18 $\to$ 6 $\to$ 0).
  - From $18\text{ km/h}$: 1.0 second (18 $\to$ 6 $\to$ 0).
  - From $\pm 6\text{ km/h}$: 0.5 seconds.
  - From $45^\circ/\text{s}$ turn: 1.5 seconds.

### 1.4 Persistence of Motion
Commanded speeds and turn rates are preserved per tank. Switching selection to another tank does **not** reset or stop the previous tank—it continues moving along its commanded path (e.g. forward, arc, or pivot).

---

## 2. Collision Physics

Tanks are modeled as oriented bounding boxes (OBB, $6\text{ m} \times 4\text{ m}$). Checked and resolved every simulation tick:

### 2.1 Tank vs Border Wall (or Closed Gate)
- Penetration is prevented; the tank is projected back to the wall contact line.
- Velocity component directed **into** the wall is zeroed.
- Velocity component directed **along** the wall is multiplied by `BORDER_DRAG_FACTOR = 0.5`.
- Actual turning rate is multiplied by `BORDER_DRAG_FACTOR = 0.5`.
- Commanded values remain unaltered; full speed and turn resume once contact ends.

### 2.2 Tank vs Tank
- Overlaps are resolved by geometric separation along the collision normal.
- While in contact, turn rates are scaled by `TANK_CONTACT_TURN_FACTOR = 0.5`.
- A tank cannot move toward the touched tank (velocity component toward it is zeroed), but can move away or reverse.
- Collisions cause no direct structural damage.

---

## 3. Weapons & Ballistics

### 3.1 Main Cannon & Shells
- Rigorously fixed gun: barrel is permanently aligned with hull heading; no turret rotation.
- **Capacity:** Each tank carries 5 shells initially.
- **Rate of Fire:** Reload cooldown `GUN_RELOAD_S = 1.0s` between shots.
- **Flight Characteristics:**
  - Range: `SHELL_RANGE_M = 32m` by default (configurable up to $62.5\text{ m}$ via `?shootDist=NN`).
  - Flight Time: `SHELL_FLIGHT_TIME_S = 0.4s` $\to$ velocity $80\text{ m/s}$ (at default range).
  - High velocity allows fast-reacting opponents to dodge at long range.
- **Collision & Lethality:**
  - One-shot kill: Direct hit instantly destroys the target tank.
  - Friendly fire is fully active: own shells destroy own tanks.
  - Shells detonate upon hitting arena boundary walls, closed gate doors, or building obstacles.
  - Shells fly through smoke clouds unimpeded (smoke blocks vision only).

### 3.2 Anti-Tank Mines
- **Capacity:** 2 mines per tank.
- **Deployment:** Dropped `MINE_DROP_BEHIND_M = 1.5m` behind the rear edge of the hull.
- **Arming Delay:** Becomes armed after `MINE_ARM_DELAY_S = 1.5s`, preventing the deploying tank from triggering its own mine immediately.
- **Triggering & Lethality:** Explodes instantly when touched by any tank hull (`MINE_TRIGGER_RADIUS_M = 1.0m`), destroying the unit. Friendly fire applies.
- **Persistence:** Armed mines remain active indefinitely until triggered.
- **Gate Traps:** Mines dropped directly in front of an enemy or friendly gateway will destroy emerging units.

### 3.3 Smoke Screens
- **Capacity:** 2 smoke canisters per tank.
- **Deployment:** Instantly releases an expanding smoke cloud centered on the tank: radius `SMOKE_RADIUS_M = 10m`, lifetime `SMOKE_LIFETIME_S = 10s`, fading over the final 2 seconds (`SMOKE_FADE_S = 2s`).
- **Stationary Cloud:** Cloud stays anchored at release coordinates (does not follow the tank).
- **Tactical Effect:** Completely blocks 3D line-of-sight (opaque fog) and conceals all tanks within it from the 2D strategic radar map. Shells pass through smoke freely.

---

## 4. Hangar Slit Window Defense View

Each player can toggle their 3D view to either of their two hangar observation slit apertures (`Q`/`E` for Left, `[`/`]` for Right).

- **Aperture Locations:** Built into the side border wall, centered `WINDOW_OFFSET_FROM_GATE_M = 8m` above and below the gate centerline ($Y = 42\text{ m}$ and $Y = 58\text{ m}$), length $5\text{ m}$.
- **Slit Masking:** Rendered through a letterbox horizontal slit aperture with central crosshair.
- **Independent Slit Yaw Persistence:** Each player tracks independent yaw angles (`windowYaws: [0, 0]`). Switching between windows or returning from tank command preserves each window's current aim angle.
- **Aiming & Traversal:**
  - Turn inputs rotate window yaw in discrete steps: $15^\circ/\text{s}$ and $30^\circ/\text{s}$, up to `WINDOW_MAX_YAW_DEG = 45°` each side ($50\%$ of the $90^\circ$ angle to the border wall).
  - Angular acceleration between steps is $0.5\text{ s}$ per $15^\circ/\text{s}$ step (`WINDOW_YAW_ACCEL_DEG_S2 = 30°/s²`).
- **Infinite Defensive Munitions:** Fire key launches high-velocity shells with unlimited ammunition, restricted only by `WINDOW_RELOAD_S = 1.5s` cooldown per window.
- **Unrestricted Ballistics:** Direct ballistic line of sight covers the entire $45^\circ$ traverse without artificial gate dead-zone immunity.
- **Simultaneous Combat:** While manned in window view, all unselected field tanks continue executing their last commanded movement orders.
