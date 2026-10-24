# Tank.exe 🎮

> **Two commanders. One keyboard. 90s split-screen 3D tactical tank combat.**

[![GitHub Pages Deployment](https://github.com/Andrey-Prikupets/Tank.exe/actions/workflows/deploy.yml/badge.svg)](https://github.com/Andrey-Prikupets/Tank.exe/actions/workflows/deploy.yml)
[![Live Demo](https://img.shields.io/badge/Play%20Online-GitHub%20Pages-brightgreen?logo=github)](https://andrey-prikupets.github.io/Tank.exe/)

**Tank.exe** pays homage to early 1990s PC DOS split-screen 3D vehicular combat simulations. Two players sit shoulder-to-shoulder, sharing a single physical keyboard to lead opposing tank battalions across an arena.

---

## 🕹️ Live Demo

Play directly in your modern desktop browser (Chrome, Edge, Firefox):
👉 **[https://andrey-prikupets.github.io/Tank.exe/](https://andrey-prikupets.github.io/Tank.exe/)**

---

## 📖 Concept & Gameplay

### 1. Forces & The Arena
* **Battalion Command:** Each commander leads **15 tanks total** — 5 active units deployed in line formation on the battlefield and 10 reserves held in the base hangar.
* **Dual 1–5 Numbering:** Both sides field tanks numbered **1 to 5**. Unselected tanks display their identifier in 3D and on the top-down tactical radar.
* **Zero Auto-Movement:** Tanks never move on their own. They start stationary at 0 km/h and only accelerate or steer upon your direct key commands.

### 2. Authentic Mass Inertia & Multi-Tank Assaults
Tanks possess true momentum. Accelerating or turning commands a speed/turn rate that the unit preserves even when you switch active control to another tank. 
* Initiate a flanking arc with **Tank 1**, switch instantly to **Tank 2** to push center, and orchestrate synchronized multi-tank assaults!

### 3. Arsenal & Defense
* **Artillery Shells (5):** High-velocity rounds capable of penetrating smoke screens. Lethal on direct impact to friend or foe.
* **Anti-Tank Mines (2):** Deployed behind your tank. Arms after a 1.5-second safety fuse and remains active indefinitely until detonated.
* **Thermal Smoke (2):** Deploys a dense 10-second aerosol cloud that blocks 3D line-of-sight and hides units from the strategic radar.

### 4. Base Hangars & Window Slits
* **Rearming:** Drive any surviving tank through your home gate into a free hangar slot to fully replenish ammo, mines, and smoke.
* **Gate Defense:** Hangar slit windows allow defensive surveillance and firing with unlimited ammo to protect against enemy assaults.
* **Gate Blockade:** Positioning a tank directly in front of the enemy gate prevents their reserve deployments!

### 5. Victory Condition
* Annihilate all 15 enemy tanks to secure victory.

---

## ⌨️ Controls

Two players share one keyboard. Controls are optimized for anti-ghosting layout on standard desktop keyboards.

| Action | Red Commander (Left) | Blue Commander (Right) |
|---|:---:|:---:|
| **Select Tank 1–5** | `1`, `2`, `3`, `4`, `5` | `6`, `7`, `8`, `9`, `0` |
| **Accelerate** | `W` | `↑` (Arrow Up) |
| **Decelerate / Reverse** | `S` | `↓` (Arrow Down) |
| **Steer Left** | `A` | `←` (Arrow Left) |
| **Steer Right** | `D` | `→` (Arrow Right) |
| **Slit Window Left** | `Q` | `[` (Left Bracket) |
| **Slit Window Right** | `E` | `]` (Right Bracket) |
| **Fire Cannon** | `Tab` | `Enter` / `Numpad Enter` |
| **Deploy Mine** | `Z` | `,` (Comma / `<`) |
| **Smoke Screen** | `X` | `.` (Period / `>`) |
| **Pause / Menu** | `Esc` (Shared) | `Esc` (Shared) |

---

## 🔗 Startup URL Parameters (Query String)

You can launch the game with pre-configured settings or start directly into battle (bypassing the title menu) using URL query string parameters. All parameters and string values are **case-insensitive**, and all boolean parameters accept only **`Y`** or **`N`**:

| Parameter | Type | Values | Description |
|---|:---:|---|---|
| **`mode`** | String | `HvH`, `HvC`, `CvH`, `CvC` | Player mode: Human vs Human, Human vs Computer, Computer vs Human, or Computer vs Computer |
| **`level`** | String | `EASY`, `MEDIUM`, `HARD` | AI difficulty level (defaults to `MEDIUM`) |
| **`sound`** | Boolean | `Y` / `N` | Enable (`Y`) or mute (`N`) procedural synthesized Web Audio |
| **`obstacles`** | Boolean | `Y` / `N` | Enable (`Y`) or disable (`N`) building obstacles on the field |
| **`pits`** | Boolean | `Y` / `N` | Enable (`Y`) or disable (`N`) water hazard trenches / moats |
| **`lang`** | String | `EN`, `ES`, `RU` | Pre-select language for the History dialog |
| **`mobile`** | Boolean | `Y` / `N` | When `Y`, forces mobile mode on even on desktop (activates on-screen touch controls, analog joystick, and mouse click/drag interaction while omitting the keyboard layout menu) |
| **`debugVectors`** | Boolean | `Y` / `N` | When `Y`, displays aiming vectors for each tank (red for Red team, blue for Blue team) with vector length equal to the ammo flight distance (`SHELL_RANGE_M` = 62.5m) |
| **`start`** | Boolean | `Y` / `N` | When `Y`, immediately starts a new game, bypassing the title menu |

### Quick Launch Examples:
* **Battle with Aiming Vectors Visualization:**  
  [`https://andrey-prikupets.github.io/Tank.exe/?mode=HvC&debugVectors=Y&start=Y`](https://andrey-prikupets.github.io/Tank.exe/?mode=HvC&debugVectors=Y&start=Y)
* **Mobile Touch Mode on Desktop with Mouse Controls:**  
  [`https://andrey-prikupets.github.io/Tank.exe/?mode=HvC&mobile=Y&start=Y`](https://andrey-prikupets.github.io/Tank.exe/?mode=HvC&mobile=Y&start=Y)
* **Computer vs Computer Spectator Mode:**  
  [`https://andrey-prikupets.github.io/Tank.exe/?mode=CvC&start=Y`](https://andrey-prikupets.github.io/Tank.exe/?mode=CvC&start=Y)
* **AI Duel with Hazards & Hard Difficulty:**  
  [`https://andrey-prikupets.github.io/Tank.exe/?mode=CvC&start=Y&level=HARD&obstacles=Y&pits=Y`](https://andrey-prikupets.github.io/Tank.exe/?mode=CvC&start=Y&level=HARD&obstacles=Y&pits=Y)
* **Human vs Computer with Obstacles & Sound Muted:**  
  [`https://andrey-prikupets.github.io/Tank.exe/?mode=HvC&start=Y&obstacles=Y&sound=N`](https://andrey-prikupets.github.io/Tank.exe/?mode=HvC&start=Y&obstacles=Y&sound=N)

---

## 🛠️ Tech Stack & Architecture

* **Zero Backend:** 100% static client-side web application. Can be hosted from any static server, CDN, or GitHub Pages.
* **3D Engine:** [Three.js](https://threejs.org/) — flat-shaded, untextured Lambert geometry capturing authentic 90s PC DOS aesthetics.
* **Strategic Map:** Pure HTML5 2D Canvas rendering real-time radar positions, smoke fade, and gate status.
* **Procedural Sound:** Web Audio API synth oscillators, stereo panners, and noise bursts without external audio asset downloads.
* **Build System:** [Vite 6](https://vitejs.dev/) with relative path asset resolution (`base: './'`).

---

## 💻 Local Development & Compilation

### Prerequisites
* [Node.js](https://nodejs.org/) (version 18+ or 20+ recommended)
* `npm` (packaged with Node.js)

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/Andrey-Prikupets/Tank.exe.git
cd Tank.exe
npm install
```

### 2. Development Server
Start the local Vite dev server with hot reload:
```bash
npm run dev
```
Open `http://localhost:5173/` in your browser.

### 3. Production Build / Compilation
Compile and minify the standalone static bundle into the `dist/` directory:
```bash
npm run build
```

### 4. Preview Production Build
Locally test the compiled `dist/` distribution:
```bash
npm run preview
```

---

## 🚀 GitHub Pages Deployment & Automated Versioning

The repository includes a GitHub Actions workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) that automatically builds and redeploys the game on every commit to `main`.

* **Continuous Deployment:** Every commit pushed to `main` triggers a GitHub Pages deployment.
* **Commit-Based Version Counter:** With each commit, an automated version counter increments (`v0.1.<commit_count> · build #<commit_count>`), which is injected at build time and displayed directly in the in-game menu.

### Enabling GitHub Pages in Repository Settings:
1. Go to your repository on GitHub: **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, select:
   * **GitHub Actions** (recommended — uses the automated workflow).
   * Or **Deploy from a branch** → select `gh-pages` branch and `/ (root)`.
3. The game will be live at:
   `https://<username>.github.io/<repo-name>/`


---

## 📜 License

MIT License. Designed and developed with retro passion.
