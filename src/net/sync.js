// Network synchronization engine for Tank.exe P2P multiplayer

/**
 * Creates an initialization payload from the Host's world.
 */
export function createInitPayload(world, hostPlayer, joinerPlayer, options) {
  return {
    type: 'INIT',
    hostPlayer,
    joinerPlayer,
    options: {
      obstacles: options.obstacles,
      pits: options.pits,
      shootDist: options.shootDist,
    },
    obstacles: world.obstacles,
    pits: world.pits,
    shellRange: world.shellRange,
  };
}

/**
 * Serializes the authoritative world state into a compact snapshot.
 */
export function serializeWorldSnapshot(world) {
  return {
    type: 'STATE',
    time: world.time,
    over: world.over,
    winner: world.winner,
    gates: world.gates.map((g) => ({ open: g.open })),
    players: world.players.map((p) => ({
      id: p.id,
      selected: p.selected,
      view: p.view,
      windowIdx: p.windowIdx,
      windowYaw: p.windowYaw,
      windowYaws: [...p.windowYaws],
      windowReload: p.windowReload,
      lost: p.lost,
      shots: p.shots,
      hits: p.hits,
      msg: p.msg,
      msgT: p.msgT,
      blocked: p.blocked,
    })),
    tanks: world.tanks.map((t) => ({
      id: t.id,
      owner: t.owner,
      number: t.number,
      status: t.status,
      deployRequested: t.deployRequested,
      row: t.row,
      i: t.i,
      x: t.x,
      y: t.y,
      heading: t.heading,
      speed: t.speed,
      turn: t.turn,
      cmdSpeedKmh: t.cmdSpeedKmh,
      cmdTurnDeg: t.cmdTurnDeg,
      shells: t.shells,
      mines: t.mines,
      smokes: t.smokes,
      reload: t.reload,
      contacts: [...t.contacts],
    })),
    // Projectiles and particles are plain data objects: copy them whole so every field the
    // renderers read (dx/dy/win, armT, big/splash, ...) is replicated on the client.
    shells: world.shells.map((s) => ({ ...s })),
    mines: world.mines.map((m) => ({ ...m })),
    smokes: world.smokes.map((s) => ({ ...s })),
    explosions: world.explosions.map((e) => ({ ...e })),
  };
}

/**
 * Applies an incoming authoritative snapshot onto the local replica world.
 */
export function applyWorldSnapshot(world, snap) {
  world.time = snap.time;
  world.over = snap.over;
  world.winner = snap.winner;

  // Sync gates
  if (snap.gates && world.gates) {
    for (let i = 0; i < snap.gates.length; i++) {
      if (world.gates[i]) world.gates[i].open = snap.gates[i].open;
    }
  }

  // Sync players
  if (snap.players) {
    for (let i = 0; i < snap.players.length; i++) {
      const sp = snap.players[i];
      const wp = world.players[i];
      if (wp && sp) {
        // The host is authoritative for both players (selection, tank/slit view, slit yaw).
        wp.selected = sp.selected;
        wp.view = sp.view;
        wp.windowIdx = sp.windowIdx;
        wp.windowYaw = sp.windowYaw;
        if (sp.windowYaws) wp.windowYaws = [...sp.windowYaws];
        wp.windowReload = sp.windowReload;
        wp.lost = sp.lost;
        wp.shots = sp.shots;
        wp.hits = sp.hits;
        wp.msg = sp.msg;
        wp.msgT = sp.msgT;
        wp.blocked = sp.blocked;
      }
    }
  }

  // Sync tanks
  if (snap.tanks) {
    for (let i = 0; i < snap.tanks.length; i++) {
      const st = snap.tanks[i];
      const wt = world.tanks[i];
      if (wt && st) {
        wt.status = st.status;
        wt.deployRequested = st.deployRequested;
        wt.row = st.row;
        wt.i = st.i;
        wt.x = st.x;
        wt.y = st.y;
        wt.heading = st.heading;
        wt.speed = st.speed;
        wt.turn = st.turn;
        wt.cmdSpeedKmh = st.cmdSpeedKmh;
        wt.cmdTurnDeg = st.cmdTurnDeg;
        wt.shells = st.shells;
        wt.mines = st.mines;
        wt.smokes = st.smokes;
        wt.reload = st.reload;
        wt.contacts = st.contacts;
      }
    }
  }

  // Sync projectiles & particles
  if (snap.shells) world.shells = snap.shells;
  if (snap.mines) world.mines = snap.mines;
  if (snap.smokes) world.smokes = snap.smokes;
  if (snap.explosions) world.explosions = snap.explosions;
}
