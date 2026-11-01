# AI Hardening, Replay Forensics & Simulation Tools (`tools/`)

This directory contains command-line tools, helper libraries, and a dataset of real saved match recordings used for analyzing battles, slicing critical combat moments, simulating AI improvements, and running regression benchmarks.

> **Node Runtime Note:** Per project rules, run local Node scripts using Node.js 22 at `C:\Work\nodejs.22\node.exe` (or via the root wrapper scripts `.\vcr.cmd` and `.\bench.cmd`).

---

## 1. Directory Contents

| File / Folder | Purpose |
|---|---|
| `replays/` | Dataset of base64-encoded Deflate-compressed match recordings (`game1_hvc_hard.replay`, `game2_hvc_hard.replay`, `game3_hvc_hard.replay`). |
| `replay_utils.js` | Core library to decode saved games (`loadReplay`), extract combat timelines (`analyzeReplayEvents`), slice frame ranges (`sliceReplayFrames`), reconstruct live `world` state at any timestamp (`createWorldAtTime`), and simulate the AI against recorded opponent actions (`simulateMoment`). |
| `analyze_replay.js` | CLI forensics tool that decodes a `.replay` file and prints a chronological breakdown of tank losses, causes of death (tank shell, slit gun, mine, water pit), shooter distances, and active vs. unselected unit states. |
| `sim_replay.js` | Automated slice simulator and regression suite. Reconstructs critical combat moments from saved games, replays Red's recorded movements/shots/mines/slit-guns, and runs the live `AiController` for Blue to verify improvements. |
| `vcr.js` | Deterministic headless AI-vs-AI match runner that logs AI decisions and periodic 5-second battlefield snapshots to `vcr.log`. |
| `bench.js` | Multi-seed AI-vs-AI benchmark runner that aggregates win rates, tank casualties, shot accuracy, pit deaths, and mine kills. |

---

## 2. Analyzing a Saved Game (`analyze_replay.js`)

Use `analyze_replay.js` to inspect everything that happened in a saved game or within a specific time window `[start_sec, end_sec]`:

```powershell
# Analyze an entire saved game
C:\Work\nodejs.22\node.exe tools/analyze_replay.js tools/replays/game3_hvc_hard.replay

# Analyze a specific time slice (e.g., from t = 135s to t = 215s) including shell fire events
C:\Work\nodejs.22\node.exe tools/analyze_replay.js tools/replays/game3_hvc_hard.replay 135 215
```

### Adding a New Saved Game to the Dataset
1. Copy the exported base64 recording string from the game UI.
2. Save it as a plain-text file in `tools/replays/<name>.replay`.
3. Run `analyze_replay.js` on the file to identify timestamps where AI tanks were lost or missed opportunities.

---

## 3. Simulating Saved Game Moments (`sim_replay.js`)

Use `sim_replay.js` to test the current AI controller against recorded human gameplay from any timestamp:

```powershell
# 1. Run the full regression suite across all saved games (Game 3, Game 2, Game 1) on HARD
C:\Work\nodejs.22\node.exe tools/sim_replay.js

# 2. Run the regression suite for a single saved game
C:\Work\nodejs.22\node.exe tools/sim_replay.js tools/replays/game3_hvc_hard.replay

# 3. Simulate a custom time slice: <replay_file> <start_sec> <duration_sec> [EASY|MEDIUM|HARD]
# Prints a snapshot of field tanks/mines at start_sec, combat events, and the AI Decision Log
C:\Work\nodejs.22\node.exe tools/sim_replay.js tools/replays/game3_hvc_hard.replay 194.5 15.5 HARD

# 4. Run all saved game suites across EASY, MEDIUM, and HARD to compare level gradation & stability
C:\Work\nodejs.22\node.exe tools/sim_replay.js --levels
```

---

## 4. Programmatic Usage (`replay_utils.js`)

You can import `replay_utils.js` in custom diagnostic scripts:

```js
import {
  loadReplay,
  analyzeReplayEvents,
  sliceReplayFrames,
  createWorldAtTime,
  simulateMoment,
} from './replay_utils.js';

const rec = await loadReplay('tools/replays/game3_hvc_hard.replay');

// Extract frames between 120s and 150s
const slice = sliceReplayFrames(rec, 120, 150);

// Reconstruct a live simulation world at t = 138.0s
const { world } = createWorldAtTime(rec, 138.0);

// Simulate 38 seconds from t = 138.0s with Blue controlled by live HARD AI
const result = simulateMoment(rec, { startT: 138.0, duration: 38.0, level: 'HARD' });
console.log(result);
```

---

## 5. Headless AI-vs-AI VCR & Benchmark (`vcr.js`, `bench.js`)

```powershell
# Run a single seeded AI-vs-AI match (writes detailed log to vcr.log)
.\vcr.cmd 90 HARD 1

# Run a 6-seed AI-vs-AI benchmark (120s per match on HARD)
.\bench.cmd 6 120 HARD
```
