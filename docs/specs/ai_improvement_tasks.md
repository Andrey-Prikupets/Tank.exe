# AI Improvement Tasks

> Task tracker for AI capabilities.  
> Master document: [functional_spec.md](../functional_spec.md).  
> Sub-specifications: [ai_system.md](./ai_system.md) and [ai_strategic_control_plan.md](./ai_strategic_control_plan.md).

Constraint reminder: **tank gun is fixed to the hull** - aiming = steering the body.
Each task: implement -> `.\test.cmd` (+ `.\vcr.cmd` log analysis where useful) -> update
specs -> commit (no push). One push after the last task.

## Task 0 - Documentation fixes and AI decision log
- [x] Rewrite `ai_strategic_control_plan.md` to match the implementation
- [x] Fix spec: slit trigger, dispatcher (not round-robin), unused constants, fixed-gun rule
- [x] `AiController` emits timestamped decision events (plan change, roles, attack, pursue, avoid, slit, rearm, deploy, fire)
- [x] Scrolling log panels in the side black areas of the map for AI-controlled sides, with a
      left column showing seconds since game start
- [x] VCR tool: headless CvC run printing the decision log + periodic tank states (`vcr.cmd`)
- [x] Spec documentation for decision log panels + tests for the log

## Task 0.5 - Restructure `ai.js` (god object -> modules under `src/sim/ai/`)
- [x] `profiles.js` (difficulty profiles), `perception.js` (smoke LOS, line of fire, prediction, tracking)
- [x] `weapons.js` (fire reflex), `roles.js` (doctrines, role assignment, role waypoints)
- [x] `urgency.js` (urgency scoring, safe cruising trim), `decision_log.js` (log class)
- [x] `controller.js` split into commander / dispatcher / executor / slit modules; `ai.js` re-exports
- [x] Behaviour unchanged: `.\test.cmd` + identical `.\vcr.cmd` output for the same seed (byte-identical 40 s log)

## Task 1 - Commander correctness (doctrine, roles, plan hysteresis)
- [x] Pass `doctrine` and `owner` to every `assignBrigadeRoles` call (doctrine bug)
- [x] Sticky roles: keep existing assignments, only fill roles for new tanks / free dead tanks' roles
- [x] Give Bravo and Delta distinct role sets (spearhead pair + echelon, `PURSUER`)
- [x] Exits for Bravo/Delta (minimum dwell, revert when condition ends)
- [x] Charlie trigger needs a real threat (>= 2 enemies, or 1 within the inner radius) + dwell
- [x] Tests: `test/test_ai_commander.js` (sticky roles, plan role sets, no role flapping)

## Task 2 - Hull aiming (fixed gun)
- [x] Aim state for the selected tank: when a visible target is in effective range, stop and pivot the hull toward the lead point
- [x] Fire reflex fires once heading is within tolerance (hull kept on target while reloading)
- [x] Dispatcher "aimed shot ready" urgency uses real aim error (done in Task 3)
- [x] `.\bench.cmd` metrics + `test/test_ai_aiming.js`. Bench (6 seeds x 120 s HARD): hit rate 55.0 % -> 56.9 %,
      shots/match 18.5 -> 18.2 (little change; real gains need Task 3 shot allocation, see mine-kill note there)

## Task 3 - Shot allocation and ammo discipline
- [x] Dispatcher scores time-to-shot (reload vs pivot) + gate-emerging bonus to choose whose gun fires
- [x] Effective-range rule for moving targets (38 m). Bench (6x120 s HARD): hit rate 56.9 % -> 71.7 %, shots/match 18.2 -> 16.5
- [ ] Early rearm at <= 1 shell when the gate is free (deferred to Task 5)
- [ ] Ammo-aware plan inputs (deferred to Task 5)

## Task 4 - Slit window continuity and base defence
- [x] Keep commander and visual intelligence tracking running while in window view
- [x] Smarter window entry/exit (deterministic entry on threat < 40 m with 4 s cooldown; urgency-aware exit at U >= 80 or idle 1.5 s; emergency rescue on pit hazard)
- [x] Sentry role actually coordinates with the slit gun (flanks at y = 50 +/- 16 m opposite active window; keeps gate corridor clear)
- [x] Bench (6x120 s HARD): decided matches 2 -> 3 / 6, hit rate 71.7 % -> 73.5 %, pit deaths 0; test suite `test/test_ai_slit.js` added

## Task 5 - Breach plan and weapon use
- [ ] Timed assault: flank run to the corner and strike at the gate (smoke part done; rest deferred - few matches finish in 120 s)
- [ ] Commit rule when enemy is nearly eliminated (Delta)
- [x] Offensive smoke (assault run at 50-62 m); mines disabled after bench showed 28/36 mine kills were friendly (HARD 6x120 s: tanks lost/match 21.5 -> 17.7)

## Task 6 - Movement robustness
- [x] `applySafeCruisingTrim`: veer away at creep speed instead of STOP (HARD 6x120 s: tanks lost/match 17.7 -> 16.0, hit rate 71.3 % -> 77.5 %, first loss 13 s -> 17 s)
- [ ] Coarse A* over the cost grid for waypoints blocked by buildings (deferred: 0 freezes / 0 pit deaths in tests)
- [ ] Better stuck recovery (deferred: 0 stuck events in 120 s VCR)

## Task 7 - Final verification
- [x] Full `.\test.cmd` green, `.\build.cmd` OK, bench 4x300 s HARD: 27 tanks lost/match, hit rate 67 %, 1/4 matches decided (stalemates remain: ~30 shots per 300 s; real assault logic = open follow-up)
- [x] Single `git push`
