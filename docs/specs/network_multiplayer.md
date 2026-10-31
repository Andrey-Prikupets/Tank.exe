# Serverless Peer-to-Peer Network Multiplayer

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).

---

## 1. Architectural Principles

- **Zero Backend / 100% Static & Serverless:** Peer-to-peer gameplay connects two web browsers directly using WebRTC `RTCDataChannel` over UDP. No custom multiplayer servers, WebSocket brokers, or matchmaking daemons are required.
- **NAT Traversal:** Leverages standard ICE gathering with Google's free public STUN servers (`stun:stun.l.google.com:19302`) for internet play, or operates completely offline over a local LAN / mobile Wi-Fi hotspot without any external internet connection (`iceServers: []`).
- **Air-Gapped Signaling:** The initial 2-step WebRTC handshake (Offer $\leftrightarrow$ Answer) is conducted without central servers:
  1. **QR Code Scanning:** Rendered directly to an HTML5 `<canvas>` via the ultra-lightweight open-source `uqr` library. Scanned instantly using the device's camera via the browser's hardware `BarcodeDetector` API.
  2. **Messenger Copy & Web Share:** Single-click clipboard copy (`navigator.clipboard.writeText`) on PC and native OS share dialog (`navigator.share`) on mobile devices.
- **SDP Compression:** Raw SDP descriptors (~1.5 KB) are compressed using native browser `CompressionStream('deflate-raw')` into compact Base64 strings (`TANK:...`), achieving a ~72% size reduction down to ~400 characters for instant, low-density QR code scanning.

---

## 2. Connection & Role Negotiation Flow

- **Access Flow:** Activated directly by selecting **Human vs Human** (`Network`) from the **Game Mode** submenu on the Title Menu and clicking **Start game**, opening the connection dialog (`#networkScreen`).
- **Host Role:**
  - Selects Squadron Team: **RED TEAM (P1 · LEFT / Player 0)** or **BLUE TEAM (P2 · RIGHT / Player 1)**.
  - Automatically initializes WebRTC offer and renders Offer QR Code (+ Copy Offer / Share buttons).
  - Provides **Scan Client QR** (camera viewfinder overlay) and **Paste Answer Code** buttons to ingest the client's answer.
- **Joiner Role:**
  - Automatically assigned the opposite team upon connection.
  - Provides **Scan Host QR Code** and **Paste Host Offer** to ingest the host's offer.
  - Automatically generates the answer and displays Answer QR Code (+ Copy Answer / Share buttons) for the host to scan.

---

## 3. State & Battlefield Synchronization

To ensure both players experience the exact same picture without desynchronization:

### 3.1 Landscape & Rules Consolidation
- On connection establishment, Host transmits an `INIT` message containing exact obstacle structures (`world.obstacles`), pit positions (`world.pits`), projectile ranges (`world.shellRange`), and match options.
- Client adopts the identical landscape geometry and calls `syncWorldTerrain(world)` so obstacle walls, water plane levels, and craters match to the millimeter.

### 3.2 Authoritative Simulation & Physics
- Host is the authoritative simulation master, executing the fixed-timestep `step(world, dt, ...)` loop and computing all collisions, pit traps, projectile impacts, gate door kinematics, and victories.
- Client routes all physical commands (keyboard actions and mobile touch overlays) exclusively to the host via `{ type: 'INPUT', action, arg }`, joystick steering via `{ type: 'TURN', factor }`, and observation slit panning via `{ type: 'STEER', windowTurn }`.
- Simulation continues seamlessly if a player opens an in-game menu or switches tabs, preventing desync or accidental pausing of the shared battlefield.

### 3.3 Control Isolation, Dedicated Network Layout & Fullscreen Ergonomics
- Entering the network modal or clicking **Scan QR** / **Paste Code** (or pasting via clipboard) synchronously requests browser fullscreen (`enterFullscreen()`) and landscape orientation lock (`screen.orientation.lock('landscape')`) within the user gesture. If fullscreen is unavailable or exited, the game dynamically scales to the visible viewport height and rescales to full height when the user clicks the `[⛶]` Fullscreen button.
- During Network HvH play, the screen uses the dedicated Network HvH layout: the strategic map shifts to the top-left, the opponent's 3D view renders to the right of the map, and the local player's 3D view is centered in the bottom half (`50%` width) with all touch controls and inventory moved into the left and right `25%` black sidebars.
- On mobile devices during network play, touch controls and cockpit manipulation overlays are rendered strictly for the locally assigned player seat (`isLocallyControlled`), never displaying duplicate touch controls on both 3D viewports.

### 3.4 Snapshot Replication & Visual Fidelity
- Host broadcasts regular state snapshots (~30 Hz, `NET_SNAPSHOT_INTERVAL_MS = 33`) streaming tank coordinates, headings, velocities, ammunition inventories (shells, mines, smokes), reload states, active projectile vectors (`dx, dy, dist, win`), arming timers, explosion frames, player observation slit camera angles (`windowIdx`, `windowYaw`, `windowYaws`, `view`), and hangar gate statuses.
- Client applies these snapshots directly to its local world model, rendering the 3D views, strategic 2D map, and Cockpit Inventory HUD identically.

### 3.5 Synchronized Hits, Kills & Audio SFX
- Host streams simulation event records (`'shot'`, `'hit'`, `'kill'`, `'mine_drop'`, `'smoke'`, `'gate_open'`, `'hangar_exit'`, `'hangar_enter'`).
- Client immediately pipes received events into the Web Audio synthesizer (`sfx.play(e)`), ensuring audio cues, gate sound effects, and explosion feedback trigger simultaneously on both players' machines.

### 3.6 Heartbeat, Disconnection Detection & Session Recovery
- Peers exchange bidirectional heartbeat `PING` packets every 500 ms (`NET_HEARTBEAT_MS`).
- If no network packets are received for 2,000 ms (`NET_TIMEOUT_MS`) or if WebRTC ICE connection fails or closes, both players are gracefully transitioned to a "DISCONNECTED" modal with clear guidance to return to the Title Menu. If the match has already concluded, disconnection triggers no disruptive alerts.
- Both host and client independently record the full match into local storage for replay playback and tactical debriefing.
