# AI Improvement Tasks

Constraint reminder: **tank gun is fixed to the hull** - aiming = steering the body.
Each task: implement -> `.\test.cmd` (+ `.\vcr.cmd` log analysis where useful) -> update
`functional_spec.md` / `ai_strategic_control_plan.md` -> commit (no push). One push after the last task.

## Task 0 - Documentation fixes and AI decision log
- [x] Rewrite `ai_strategic_control_plan.md` to match the implementation
- [x] Fix spec: slit trigger, dispatcher (not round-robin), unused constants, fixed-gun rule
- [x] `AiController` emits timestamped decision events (plan change, roles, attack, pursue, avoid, slit, rearm, deploy, fire)
- [x] Scrolling log panels in the side black areas of the map for AI-controlled sides, with a
      left column showing seconds since game start
- [x] VCR tool: headless CvC run printing the decision log + periodic tank states (`vcr.cmd`)
- [x] Spec section 15.11 (log panel) + tests for the log

## Task 0.5 - Restructure `ai.js` (god object -> modules under `src/sim/ai/`)
- [ ] `profiles.js` (difficulty profiles), `perception.js` (smoke LOS, line of fire, prediction, tracking)
- [ ] `weapons.js` (fire reflex), `roles.js` (doctrines, role assignment, role waypoints)
- [ ] `urgency.js` (urgency scoring, safe cruising trim), `decision_log.js` (log class)
- [ ] `controller.js` split into commander / dispatcher / executor / slit modules; `ai.js` re-exports
- [ ] Behaviour unchanged: `.\test.cmd` + identical `.\vcr.cmd` output for the same seed

## Task 1 - Commander correctness (doctrine, roles, plan hysteresis)
- [ ] Pass `doctrine` and `owner` to every `assignBrigadeRoles` call (doctrine bug)
- [ ] Sticky roles: keep existing assignments, only fill roles for new tanks / free dead tanks' roles
- [ ] Give Bravo and Delta distinct role sets (spearhead pair + echelon, `PURSUER`)
- [ ] Exits for Bravo/Delta (minimum dwell, revert when condition ends)
- [ ] Charlie trigger needs a real threat (>= 2 enemies, or 1 within the inner radius) + cooldown
- [ ] Tests: doctrine survives commander ticks; roles do not change when an unrelated tank dies

## Task 2 - Hull aiming (fixed gun)
- [ ] Aim state for the selected tank: when a visible target is in effective range, steer/pivot the hull toward the lead point
- [ ] Hold fire until aligned, keep hull on target while reloading
- [ ] Dispatcher "aimed shot ready" urgency uses the real firing tolerance
- [ ] VCR metric: shots fired / hits per brigade; test: hit ratio does not regress

## Task 3 - Shot allocation and ammo discipline
- [ ] Dispatcher scores expected kill value (distance, alignment, target emerging from gate) to choose whose gun fires
- [ ] Effective-range rule for firing (per level) and hit-probability gate for moving targets
- [ ] Early rearm at <= 1 shell when the gate is free
- [ ] Ammo-aware plan inputs (own ammo state feeds plan choice)

## Task 4 - Slit window continuity and base defence
- [ ] Keep commander/dispatcher/tracking running while in window view
- [ ] Smarter window entry/exit (no random trigger; leave when no target and field tank needs control)
- [ ] Sentry role actually coordinates with the slit gun

## Task 5 - Breach plan and weapon use
- [ ] Timed assault: smoke screen, flank run to the corner, strike at the gate; mines in the gate lane
- [ ] Commit rule when enemy is nearly eliminated (Delta)
- [ ] Offensive smoke/mine usage

## Task 6 - Movement robustness
- [ ] `applySafeCruisingTrim`: slow down / steer along the best DWA arc instead of STOP
- [ ] Coarse A* over the cost grid for waypoints blocked by buildings
- [ ] Better stuck recovery (choose reverse direction by clearance)

## Task 7 - Final verification
- [ ] Full `.\test.cmd`, VCR comparison before/after, spec/plan doc sync
- [ ] Single `git push`
