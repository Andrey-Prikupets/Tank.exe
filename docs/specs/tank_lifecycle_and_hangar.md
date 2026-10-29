# Tank Lifecycle, Reserve Logistics & Hangar Subsystem

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Initial Match Setup

- **Squadron Allocation:** Each player possesses **15 tanks in total**:
  - **5 active tanks on the field** (numbered 1..5).
  - **10 spare tanks in the hangar** (initially unnumbered, filling both inner and outer hangar rows).
- **Initial Field Formation:**
  - Field tanks line up in a vertical column parallel to their team's border wall, one tank length (`START_BORDER_GAP_M = 6m`) out.
  - Centered vertically around the gate ($Y = 50\text{ m}$), with vertical spacing `START_SPACING_M = 10m` between tanks.
  - Facing the opponent across the arena ($+X$ for Red, $-X$ for Blue).
  - **Initial Speed is strictly zero (0 km/h) and turn rate is 0°/s.** Tanks remain stationary until commanded.
- **Selection & Numbering:**
  - Left player selects field tanks 1..5 using keys `1`, `2`, `3`, `4`, `5`.
  - Right player selects field tanks 1..5 using keys `6`, `7`, `8`, `9`, `0` (`6` selects Tank 1, `7` selects Tank 2, etc.).
  - Tank 1 is automatically selected on match start.

---

## 2. Destruction & Reserve Succession

- **Destruction Event:** When hit by a shell, mine, or water pit, a tank triggers an explosion and is permanently eliminated, counting toward the player's 15 total losses.
- **Number Succession:**
  - The destroyed tank's number $n$ ($1\dots 5$) is transferred to the next **unnumbered spare tank** in the hangar (inner row first, then outer row).
  - If inner row slots open up, outer row spares shift forward into the inner row.
  - If all 10 spares are depleted, number $n$ becomes permanently lost; pressing its selection key produces no action.
- **Destroyed Viewport Feedback:**
  - If the destroyed tank was currently selected, the 3D viewport displays `TANK n DESTROYED` (or `TANK n DESTROYED — NO SPARES` if reserves are exhausted).
  - When no living tank is selected, the viewport banner prompts `SELECT TANK` (or `COMPUTER` if AI controlled).

---

## 3. Deploying Reserves from the Hangar

- **Standby Selection:** Selecting a numbered reserve tank resting in the hangar selects the unit for surveillance through slit windows without deploying it automatically.
- **Explicit Deployment Command:** To deploy the selected reserve through the gate into the field, the player must explicitly press **Forward** (`W` for Red, `↑` for Blue):
  1. The gate blast doors slide open.
  2. The tank rolls through the doorway into the arena (`SPAWN_OFFSET_FROM_GATE_M = 4m` from the border wall).
  3. The tank starts moving forward into the arena at base speed (`SPEED_STEP_KMH = 6 km/h`).
  4. The doors close behind the exiting tank once it clears `GATE_DOOR_CLEAR_M`.
- **Doorway Obstruction (`GATE BLOCKED`):**
  - If any tank (friendly or enemy) occupies the doorway spawn zone (`GATE_SPAWN_ZONE`), deployment is blocked and the HUD banner displays `GATE BLOCKED`.
  - The tank remains on standby inside the hangar until the exit is cleared.
  - Note: Mines dropped in front of the gate do not block deployment; an exiting tank will roll onto the mine and be destroyed.

---

## 4. Returning to Hangar for Rearmament

- **Rearm Procedure:** An active field tank can drive into its **own** gate to rearm and repair if there is at least one free slot in the hangar:
  - Gate doors open automatically as the friendly tank approaches within `GATE_APPROACH_M = 14m` and close once inside.
  - On entry, the tank preserves its identity number, docks in a free hangar slot, speed zeroes, and its inventory is replenished to full capacity:
    - **5 Shells**
    - **2 Mines**
    - **2 Smoke Canisters**
- **Re-deployment:** The rearmed tank can be deployed back to the battlefield at any time by selecting it and pressing Forward.
- **Capacity Restrictions:** If all 10 hangar slots are full, the gate remains closed and acts as a solid wall.
- **Enemy Infiltration Forbidden:** The opponent's gate is permanently an impenetrable wall.

---

## 5. System Invariants

The lifecycle subsystem rigorously enforces these invariants at every simulation tick:
1. Each digit ($1\dots 5$) per player maps to at most one living tank (field or hangar).
2. At most 5 tanks per player can be deployed on the field simultaneously.
3. Each team's hangar holds at most 10 reserve tanks.
4. Total tanks per player: $\text{Active on field} + \text{Parked in hangar} + \text{Destroyed} = 15$.
