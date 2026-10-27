import * as C from '../../constants.js';
import { applyAction, selectedTank, isSpawnClear } from '../world.js';
import { NavigationGrid, gateReservationManager } from '../nav.js';
import { PROFILES } from './profiles.js';
import { updateEnemyTracking } from './perception.js';
import { BRIGADE_DOCTRINES } from './roles.js';
import { evaluateTankUrgency } from './urgency.js';
import { DecisionLog } from './decision_log.js';
import { updateCommander } from './commander.js';
import { updateSlit } from './slit.js';
import { runDispatcher } from './dispatcher.js';
import { executeTactics } from './executor.js';

export class AiController {
  constructor(owner) {
    this.owner = owner;
    this.log = new DecisionLog(() => this.simTime);
    this.currentPlan = C.AI_STRATEGY_PLANS.ALPHA;
    this.simTime = 0;
    this.sliceTimer = 0;
    this.commanderTimer = Math.random() * 0.4;
    this.reserveDeployTimer = 0;
    this.decisionTimer = Math.random() * 0.05;
    this.nextTickInterval = 0.1;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.lockedTargetId = null;
    this.windowTurn = 0;
    this.slitTimer = 0;
    this.standoffJitter = 0;
    this.speedJitter = 0;
    this.laneOffset = 0;
    this.deadTankIds = new Set();
    this.casualtyTimestamps = [];
    this.lastCommandedTime = new Map();
    this.tankRoles = new Map();
    this.enemyTracker = new Map();
    this.navGrid = new NavigationGrid();
    this.navGridTimer = 0;
    this.initBrigadePersonality();
    this.randomizeOffsets();
  }

  initBrigadePersonality() {
    // Select independent tactical doctrine for this brigade
    // To ensure asymmetry between opposing AI teams, owner 0 and 1 pick varied doctrines
    const offset = this.owner === 0 ? 0 : 2;
    const doctrineIdx =
      (Math.floor(Math.random() * BRIGADE_DOCTRINES.length) + offset) % BRIGADE_DOCTRINES.length;
    this.doctrine = BRIGADE_DOCTRINES[doctrineIdx];
    this.note('DOCTRINE', `Brigade doctrine: ${this.doctrine}`);

    this.tankCruiseSpeeds = new Map();
    this.tankDeployDelay = new Map();

    const speedOptions = [36, 30, 33, 27, 36];
    for (let id = 0; id < 25; id++) {
      const spd = speedOptions[(id + (this.owner === 0 ? 0 : 2)) % speedOptions.length];
      this.tankCruiseSpeeds.set(id, spd);
      const delay = (id % 5) * 0.4 + (Math.random() - 0.5) * 0.2;
      this.tankDeployDelay.set(id, Math.max(0, delay));
    }
  }

  randomizeOffsets() {
    this.standoffJitter = (Math.random() - 0.5) * 2 * C.AI_STANDOFF_JITTER_M;
    this.speedJitter = (Math.random() - 0.5) * 2 * C.AI_SPEED_JITTER_KMH;
    this.laneOffset = (Math.random() - 0.5) * 2 * C.AI_LANE_OFFSET_MAX_M;
  }

  get decisionLog() {
    return this.log.entries;
  }

  get logVersion() {
    return this.log.version;
  }

  note(tag, msg, opts) {
    this.log.add(tag, msg, opts);
  }

  /** Logs the current role assignment (rate-limited, only when it changes). */
  noteRoles(myField, roles) {
    const parts = myField.map((t) => `T${t.number}=${roles.get(t.id) || '-'}`);
    this.note('ROLES', parts.join(' '), { key: 'roles', gap: 2 });
  }

  reset() {
    this.log.clear();
    this.currentPlan = C.AI_STRATEGY_PLANS.ALPHA;
    this.simTime = 0;
    this.sliceTimer = 0;
    this.commanderTimer = Math.random() * 0.4;
    this.reserveDeployTimer = 0;
    this.decisionTimer = Math.random() * 0.05;
    this.nextTickInterval = 0.1;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.lockedTargetId = null;
    this.windowTurn = 0;
    this.slitTimer = 0;
    this.deadTankIds.clear();
    this.casualtyTimestamps.length = 0;
    this.lastCommandedTime.clear();
    this.tankRoles.clear();
    this.enemyTracker.clear();
    this.navGrid = new NavigationGrid();
    this.navGridTimer = 0;
    gateReservationManager.releaseGate(this.owner, this.owner);
    this.initBrigadePersonality();
    this.randomizeOffsets();
  }




  update(world, dt, levelName = 'MEDIUM') {
    if (world.over) return;
    const profile = PROFILES[levelName] || PROFILES.MEDIUM;
    const owner = this.owner;
    const pl = world.players[owner];

    this.simTime += dt;
    this.sliceTimer += dt;
    this.reserveDeployTimer += dt;
    this.navGridTimer += dt;
    this.windowTurn = 0;

    if (this.navGridTimer >= 0.8 || this.simTime <= dt) {
      this.navGrid.update(world);
      this.navGridTimer = 0;
    }

    // 1. Slit window view
    if (pl.view === 'window') {
      updateSlit(this, world, dt, profile);
      return;
    }

    if (pl.view !== 'tank') {
      applyAction(world, owner, 'SELECT', C.TANK_NUMBERS[owner][0]);
    }

    const myField = world.tanks.filter((t) => t.owner === owner && t.status === 'field');
    const enemyField = world.tanks.filter((t) => t.owner !== owner && t.status === 'field');

    // 2. Commander update
    updateCommander(this, world, dt, myField, enemyField, profile);

    let tank = selectedTank(world, owner);

    // 3. Update Visual Intelligence & Memory
    if (tank && tank.status === 'field') {
      updateEnemyTracking(this, world, tank, enemyField);
    }

    // 4. Hangar tank handling
    if (tank && tank.status === 'hangar') {
      if (pl.blocked) {
        const alt = myField.find((t) => t.number);
        if (alt) {
          applyAction(world, owner, 'SELECT', alt.number);
          tank = alt;
        }
      } else {
        applyAction(world, owner, 'FORWARD');
      }
      return;
    }

    // 5. Dead or missing selection
    if (!tank || tank.status === 'dead') {
      const reserves = world.tanks.filter(
        (t) => t.owner === owner && t.status === 'hangar' && t.number != null,
      );
      const armedReserve = reserves.find((t) => t.shells > 0);
      const allFieldEmpty = myField.length > 0 && myField.every((t) => t.shells === 0);

      // Prioritize immediately deploying recharged/armed tanks from hangar
      if (
        armedReserve &&
        myField.length < C.TANKS_ON_FIELD_MAX &&
        (myField.length === 0 || allFieldEmpty || (myField.length < 3 && isSpawnClear(world, owner)))
      ) {
        applyAction(world, owner, 'SELECT', armedReserve.number);
        applyAction(world, owner, 'FORWARD');
        this.note('DEPLOY', `Armed reserve tank ${armedReserve.number} leaves hangar`, { key: 'deploy', gap: 1 });
        this.sliceTimer = 0;
        this.reserveDeployTimer = 0;
        this.lastCommandedTime.set(armedReserve.id, this.simTime);
        return;
      }

      if (myField.length > 0) {
        let best = myField[0];
        let maxU = -Infinity;
        for (const t of myField) {
          const timeSince = this.simTime - (this.lastCommandedTime.get(t.id) || 0);
          const u = evaluateTankUrgency(
            world,
            owner,
            t,
            enemyField,
            profile,
            timeSince,
            this.enemyTracker,
            this.simTime,
          ).urgency;
          if (u > maxU) {
            maxU = u;
            best = t;
          }
        }
        applyAction(world, owner, 'SELECT', best.number);
        tank = best;
        this.sliceTimer = 0;
        this.lastCommandedTime.set(best.id, this.simTime);
      } else if (reserves.length > 0) {
        const reserve = armedReserve || reserves[Math.floor(Math.random() * reserves.length)];
        applyAction(world, owner, 'SELECT', reserve.number);
        applyAction(world, owner, 'FORWARD');
        this.sliceTimer = 0;
        this.reserveDeployTimer = 0;
        this.lastCommandedTime.set(reserve.id, this.simTime);
        return;
      }
    }
    // 6. Tier 2: urgency dispatcher (may switch selection or deploy a reserve)
    const dispatched = runDispatcher(this, world, myField, enemyField, profile, tank);
    if (dispatched.done) return;
    tank = dispatched.tank;

    if (!tank || tank.status !== 'field') return;
    this.lastCommandedTime.set(tank.id, this.simTime);
    // 7-15. Tactical executor: fire reflex, slit trigger, stuck recovery, target, navigation, smoke/mines
    executeTactics(this, world, dt, tank, enemyField, profile, levelName);
  }
}