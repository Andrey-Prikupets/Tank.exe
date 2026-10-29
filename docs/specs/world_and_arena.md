# World, Coordinate System & Arena Hazards

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. World Dimensions & Coordinate System

- **Field Size:** 250 m ($X$) × 100 m ($Y$ on 2D map / $Z$ in 3D).
- **Surface:** Flat, solid green arena turf.
- **Coordinate System:**
  - Origin $(0, 0)$ is at the top-left corner of the field on the 2D map.
  - $+X$ extends to the right; $+Y$ extends downwards on the map.
  - In 3D: World $X$ = Map $X$, World $Z$ = Map $Y$, World $Y$ = Up.
- **Field Perimeter:** Enclosed by an impenetrable boundary wall (`BORDER_WALL_HEIGHT_M = 2.5m`).
- **Team Orientation:**
  - **Left Player (Red / Team 0):** Owns the gate in the left border ($X = 0$). Faces $+X$.
  - **Right Player (Blue / Team 1):** Owns the gate in the right border ($X = 250$). Faces $-X$.

| Constant | Value | Description |
|---|---|---|
| `FIELD_LENGTH_M` | 250 | Total arena length along $X$ |
| `FIELD_WIDTH_M` | 100 | Total arena width along $Y$ / $Z$ |
| `TANK_LENGTH_M` | 6 | Hull length (~3.1 m/char at 80-column scale) |
| `TANK_WIDTH_M` | 4 | Hull width |
| `TANK_HEIGHT_M` | 2.5 | 3D vertical hull height |
| `GATE_WIDTH_M` | 7 | Gate clearance opening |
| `GATE_CENTER_Y_M` | 50 | Vertical center of gate along side border |
| `BORDER_WALL_HEIGHT_M` | 2.5 | Perimeter wall height |

---

## 2. Gates & Base Hangars

- **Gate Opening:** Each border has a doorway opening of `GATE_WIDTH_M` (7 m), centered vertically at $Y = 50\text{ m}$.
- **Hangar Geometry:** Behind each gate (outside the field) is a base hangar containing **2 vertical rows × 5 slots** = 10 spare tank slots.
  - The row closer to the gate is the **inner row**; the other is the **outer row**.
  - Hangars are visually rendered in the side canvas margins of the 2D map.
- **Passage Rules:**
  - A team's gate is passable **only to that player's own tanks**, and only when the hangar has a free slot available.
  - To all other tanks (and when the hangar is full), the gate behaves as an impenetrable solid wall.
  - The opposing team's gate is always an impenetrable solid wall.
- **Sliding Blast Doors:**
  - Gates are closed by default (two sliding door panels, `COLOR_GATE_DOOR`).
  - Doors slide sideways into wall pockets (`GATE_OPEN_TIME_S = 1.0s` to open/close) only when:
    1. A tank is being deployed from the hangar (doors open, tank rolls out, doors close once clearing `GATE_DOOR_CLEAR_M`).
    2. An own tank approaches within `GATE_APPROACH_M` (14 m) to rearm, or occupies the doorway.
  - Closed doors block all tanks and shells. A tank can pass only when the opening is at least `GATE_PASSABLE_FRACTION` (0.8) wide.
- **Hangar Ballistic Exposure:** While doors are open, shells (fired from tanks or slit windows, friendly or enemy) pass through the opening into the hangar and can destroy parked reserve tanks visible through the doorway.
- **Gate Framing & Non-Overlapping Geometry:** Gateways are framed by team-colored structural pillars outside the opening width. Border walls meet the outer edges of pillars flush with zero overlap, and sliding door panels operate within recessed wall pockets with vertical clearance to prevent coplanar Z-fighting.

---

## 3. Battlefield Hazards: Obstacles & Water Pits

Battlefield hazards can be toggled on/off in the **Options** menu or via startup URL parameters (`?obstacles=Y&pits=Y`). Both are `OFF` by default to preserve the classic open arena experience.

### 3.1 Building Obstacles (Houses & Barracks)
- **Visuals:** 3D rectangular low-poly buildings with dark hipped roof slabs and window block facades. On the 2D tactical map, drawn as distinct brown/gray architectural structures with roof outlines and window markings.
- **Collision:** Impassable solid barriers for tanks with sliding border contact drag (`BORDER_DRAG_FACTOR = 0.5`).
- **Ballistics & Visibility:** Shells detonate upon impact with obstacle walls (`boom` SFX) and cannot penetrate. Obstacles completely block 3D line-of-sight and AI targeting.
- **Placement:** Procedurally generated in the central battlefield ($X \in [55, 195]\text{ m}$, $Y \in [18, 82]\text{ m}$), strictly outside gate approaches and initial deployment columns.

| Constant | Value | Description |
|---|---|---|
| `OBSTACLE_HEIGHT_M` | 4.8 | Building facade height |
| `OBSTACLE_ROOF_HEIGHT_M` | 1.6 | Roof peak elevation |
| `OBSTACLE_ROOF_EAVE_M` | 0.5 | Roof overhang |

### 3.2 Water Pits (Trenches / Moats / Рвы)
- **Visuals:** Excavated rectangular trenches filled with cyan water (`#00e5ff`) and framed by dark earthen borders. In 3D, the water plane and framing borders reside at top height 0.08 m above the ground field with decal polygon offset and depth-write enabled to prevent spatial overlap. A recessed dark pit bed sits beneath. On the 2D map, drawn with cyan water fill, ripple highlights, and dark trench rims.
- **Lethal Immersion Mechanic:** If a tank drives into a water pit such that more than 30% of its footprint area overlaps the pit (`tankPitOverlap >= 0.30`), the tank falls in, triggers an aquatic splash explosion (`splash` SFX), and is instantly destroyed.
- **Ballistics:** High-velocity shells fly over pits unimpeded.
- **Placement:** Procedurally placed in the central arena with safe clearance from obstacles and central bypass lanes.
