import * as THREE from 'three';
import * as C from '../constants.js';
import { viewPose, windowY, gateX } from '../sim/world.js';

const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

export function createView3D(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    precision: 'highp',
    depth: true,
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, C.MAX_PIXEL_RATIO));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.COLOR_SKY);
  scene.add(new THREE.AmbientLight(0xffffff, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);

  const addBox = (sx, sy, sz, x, y, z, material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // ---- static world ----
  const L = C.FIELD_LENGTH_M;
  const W = C.FIELD_WIDTH_M;
  const fieldMat = mat(C.COLOR_FIELD);
  fieldMat.polygonOffset = true;
  fieldMat.polygonOffsetFactor = -2;
  fieldMat.polygonOffsetUnits = -4;
  const field = new THREE.Mesh(new THREE.PlaneGeometry(L, W), fieldMat);
  field.rotation.x = -Math.PI / 2;
  field.position.set(L / 2, 0, W / 2);
  scene.add(field);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(L * 4, W * 8), mat(C.COLOR_OUTSIDE));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(L / 2, -1.0, W / 2);
  scene.add(outside);

  const wallMat = mat(C.COLOR_BORDER);
  const T = C.BORDER_WALL_THICKNESS_M;
  const H = C.BORDER_WALL_HEIGHT_M;
  addBox(L + 2 * T, H, T, L / 2, H / 2, -T / 2, wallMat);
  addBox(L + 2 * T, H, T, L / 2, H / 2, W + T / 2, wallMat);
  const g0 = C.GATE_CENTER_Y_M - C.GATE_WIDTH_M / 2;
  const g1 = C.GATE_CENTER_Y_M + C.GATE_WIDTH_M / 2;
  const doors = [[], []];
  const doorMat = mat(C.COLOR_GATE_DOOR);
  for (const owner of [0, 1]) {
    const cx = owner === 0 ? -T / 2 : L + T / 2;
    // Border walls ending flush with gate pillars (no Z overlap)
    const upperWallLen = g0 - T;
    addBox(T, H, upperWallLen, cx, H / 2, upperWallLen / 2, wallMat);
    const lowerWallLen = W - (g1 + T);
    addBox(T, H, lowerWallLen, cx, H / 2, (g1 + T) + lowerWallLen / 2, wallMat);

    // Gate pillars framing the gate opening [g0, g1], slightly proud in X to prevent coplanar fighting
    const teamMat = mat(owner === 0 ? C.COLOR_LEFT_TEAM : C.COLOR_RIGHT_TEAM);
    const postThickX = T + 0.08;
    const postHeight = H + 0.8;
    addBox(postThickX, postHeight, T, cx, postHeight / 2, g0 - T / 2, teamMat);
    addBox(postThickX, postHeight, T, cx, postHeight / 2, g1 + T / 2, teamMat);

    // sliding door panels (slide sideways into the wall pocket; height slightly lower to avoid top/bottom Z-fighting)
    const doorHeight = H - 0.08;
    for (const side of [-1, 1]) {
      const panel = addBox(T * C.GATE_DOOR_THICKNESS_FRACTION, doorHeight, C.GATE_WIDTH_M / 2, cx, H / 2, C.GATE_CENTER_Y_M, doorMat);
      panel.userData.side = side;
      doors[owner].push(panel);
    }
    // window decals (field side)
    const dir = owner === 0 ? 1 : -1;
    for (const idx of [0, 1]) {
      addBox(0.1, 1, C.WINDOW_LENGTH_M, gateX(owner) + dir * 0.06, 2.2, windowY(owner, idx), basic(C.COLOR_WINDOW));
    }
    // hangar building
    const D = C.HANGAR_DEPTH_M;
    const hx = owner === 0 ? -(T + D / 2) : L + T + D / 2;
    const hw = C.HANGAR_HALF_WIDTH_M;
    addBox(D, 0.1, 2 * hw, hx, 0.05, C.GATE_CENTER_Y_M, mat(C.COLOR_HANGAR_FLOOR));
    const backWallX = owner === 0 ? -(T + D + T / 2) : L + T + D + T / 2;
    addBox(T, H, 2 * hw + 2 * T, backWallX, H / 2, C.GATE_CENTER_Y_M, mat(C.COLOR_HANGAR_WALL));
    for (const s of [-1, 1]) addBox(D, H, T, hx, H / 2, C.GATE_CENTER_Y_M + s * hw, mat(C.COLOR_HANGAR_WALL));
  }

  // ---- dynamic objects (shared geometries and materials) ----
  const hl = C.TANK_LENGTH_M / 2;
  const hw = C.TANK_WIDTH_M / 2;
  const cf = C.TANK_CHAMFER_M;
  const hullShape = new THREE.Shape();
  hullShape.moveTo(hl, -hw + cf);
  hullShape.lineTo(hl - cf, -hw);
  hullShape.lineTo(-hl + cf, -hw);
  hullShape.lineTo(-hl, -hw + cf);
  hullShape.lineTo(-hl, hw - cf);
  hullShape.lineTo(-hl + cf, hw);
  hullShape.lineTo(hl - cf, hw);
  hullShape.lineTo(hl, hw - cf);
  hullShape.closePath();

  const hullH = C.TANK_HEIGHT_M * 0.5;
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: hullH,
    bevelEnabled: false,
  });
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.translate(0, hullH, 0);

  const turretH = C.TURRET_HEIGHT_M;
  const turretCenterY = hullH + turretH / 2;
  const turretGeo = new THREE.CylinderGeometry(
    C.TURRET_RADIUS_M,
    C.TURRET_RADIUS_M,
    turretH,
    C.TURRET_SIDES,
  );
  const barrelGeo = new THREE.CylinderGeometry(0.18, 0.18, C.BARREL_LENGTH_M, 6);
  barrelGeo.rotateZ(Math.PI / 2);

  const teamMats = [mat(C.COLOR_LEFT_TEAM), mat(C.COLOR_RIGHT_TEAM)];
  const turretMats = [mat(C.COLOR_LEFT_TURRET), mat(C.COLOR_RIGHT_TURRET)];
  const detailMat = mat(C.COLOR_TANK_DETAIL);
  const skyColor = new THREE.Color(C.COLOR_SKY);
  const smokeColor = new THREE.Color(C.COLOR_SMOKE);

  const tankMeshes = new Map();
  function makeTank(owner) {
    const g = new THREE.Group();
    const teamMat = teamMats[owner];
    const hull = new THREE.Mesh(hullGeo, teamMat);
    hull.position.y = 0;
    const turret = new THREE.Mesh(turretGeo, turretMats[owner]);
    turret.position.set(C.TURRET_OFFSET_M, turretCenterY, 0);
    const barrel = new THREE.Mesh(barrelGeo, detailMat);
    barrel.position.set(C.BARREL_OFFSET_X_M, turretCenterY, 0);
    g.add(hull, turret, barrel);
    scene.add(g);
    return g;
  }

  const pools = { shells: [], mines: [], smokes: [], explosions: [], obstacles: [], pits: [] };
  function sync(pool, list, make, update) {
    while (pool.length < list.length) {
      const m = make();
      scene.add(m);
      pool.push(m);
    }
    pool.forEach((m, i) => {
      if (i < list.length) {
        m.visible = true;
        update(m, list[i]);
      } else m.visible = false;
    });
  }
  const unitSphere = new THREE.SphereGeometry(1, 8, 6);
  const mineGeo = new THREE.CylinderGeometry(C.MINE_RADIUS_M, C.MINE_RADIUS_M, 0.25, 8);
  const mineUnarmed = mat(C.COLOR_MINE_UNARMED);
  const mineArmed = mat(C.COLOR_MINE_ARMED);
  const obstacleMats = C.OBSTACLE_WALL_COLORS.map((c) => mat(c));
  const roofMat = mat(C.COLOR_OBSTACLE_ROOF);
  const windowMat = basic(C.COLOR_OBSTACLE_WINDOW);
  const pitWaterMat = new THREE.MeshLambertMaterial({ color: C.COLOR_PIT_WATER, transparent: true, opacity: 0.88, flatShading: true });
  const pitRimMat = mat(C.COLOR_PIT_RIM);

  const roofGeoCache = new Map();
  function getHipRoofGeo(L, W, H) {
    const key = `${L}_${W}_${H}`;
    let geo = roofGeoCache.get(key);
    if (!geo) {
      const e = C.OBSTACLE_ROOF_EAVE_M;
      const bl = L / 2 + e;
      const bw = W / 2 + e;
      const rl = Math.max(0, (L - W) * 0.45);

      const positions = [
        // North slope (facing -Z)
        -bl, 0, -bw,   bl, 0, -bw,   rl, H, 0,
        -bl, 0, -bw,   rl, H, 0,    -rl, H, 0,

        // South slope (facing +Z)
        bl, 0, bw,   -bl, 0, bw,   -rl, H, 0,
        bl, 0, bw,   -rl, H, 0,     rl, H, 0,

        // East slope (facing +X)
        bl, 0, -bw,   bl, 0, bw,    rl, H, 0,

        // West slope (facing -X)
        -bl, 0, bw,  -bl, 0, -bw,  -rl, H, 0,

        // Bottom soffit (facing -Y)
        -bl, 0, -bw,  -bl, 0, bw,   bl, 0, bw,
        -bl, 0, -bw,   bl, 0, bw,   bl, 0, -bw,
      ];

      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      roofGeoCache.set(key, geo);
    }
    return geo;
  }

  function makeObstacle() {
    const g = new THREE.Group();
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), obstacleMats[0]);
    const roofMesh = new THREE.Mesh(new THREE.BufferGeometry(), roofMat);
    g.add(bodyMesh, roofMesh);
    const windowMeshes = [];
    for (let i = 0; i < 12; i++) {
      const wm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), windowMat);
      g.add(wm);
      windowMeshes.push(wm);
    }
    g.userData = { bodyMesh, roofMesh, windowMeshes };
    return g;
  }

  function updateObstacle(g, ob) {
    g.position.set(ob.x, 0, ob.y);
    g.rotation.y = -ob.h;
    const { bodyMesh, roofMesh, windowMeshes } = g.userData;
    const h = ob.height || C.OBSTACLE_HEIGHT_M;
    const matIdx = ((ob.id || 1) - 1) % obstacleMats.length;
    bodyMesh.material = obstacleMats[matIdx];
    bodyMesh.scale.set(ob.l, h, ob.w);
    bodyMesh.position.set(0, h / 2, 0);

    roofMesh.geometry = getHipRoofGeo(ob.l, ob.w, C.OBSTACLE_ROOF_HEIGHT_M);
    roofMesh.position.set(0, h, 0);

    let wIdx = 0;
    const yFloors = [h * 0.35, h * 0.72];
    const winW = 1.3;
    const winH = 1.1;
    const winD = 0.12;
    for (const sideZ of [-1, 1]) {
      const zPos = sideZ * (ob.w / 2 + winD / 2);
      for (const col of [-0.28, 0.28]) {
        for (const yf of yFloors) {
          if (wIdx < windowMeshes.length) {
            const wm = windowMeshes[wIdx++];
            wm.scale.set(winW, winH, winD);
            wm.position.set(col * ob.l, yf, zPos);
          }
        }
      }
    }
    for (const sideX of [-1, 1]) {
      const xPos = sideX * (ob.l / 2 + winD / 2);
      if (wIdx < windowMeshes.length) {
        const wm = windowMeshes[wIdx++];
        wm.scale.set(winD, winH, winW * 1.2);
        wm.position.set(xPos, yFloors[0], 0);
      }
    }
    while (wIdx < windowMeshes.length) {
      windowMeshes[wIdx++].scale.set(0.001, 0.001, 0.001);
    }
  }

  function makePit() {
    const g = new THREE.Group();
    const rimMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pitRimMat);
    const waterMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pitWaterMat);
    g.add(rimMesh, waterMesh);
    g.userData = { rimMesh, waterMesh };
    return g;
  }

  function updatePit(g, pit) {
    g.position.set(pit.x, 0, pit.y);
    g.rotation.y = -pit.h;
    const { rimMesh, waterMesh } = g.userData;
    rimMesh.scale.set(pit.l + 1.2, 0.04, pit.w + 1.2);
    rimMesh.position.set(0, 0.02, 0);

    waterMesh.scale.set(pit.l, 0.06, pit.w);
    waterMesh.position.set(0, 0.04, 0);
  }

  function updateDynamic(world) {
    const seen = new Set();
    const halfDoor = C.GATE_WIDTH_M / 2;
    for (const owner of [0, 1]) {
      const open = world.gates ? world.gates[owner].open : 0;
      for (const panel of doors[owner]) {
        panel.position.z = C.GATE_CENTER_Y_M + panel.userData.side * (halfDoor / 2 + open * halfDoor);
      }
    }
    for (const t of world.tanks) {
      let m = tankMeshes.get(t.id);
      if (!m) {
        m = makeTank(t.owner);
        tankMeshes.set(t.id, m);
      }
      seen.add(t.id);
      m.visible = t.status !== 'dead';
      m.position.set(t.x, 0, t.y);
      m.rotation.y = -t.heading;
    }
    sync(pools.obstacles, world.obstacles || [], makeObstacle, updateObstacle);
    sync(pools.pits, world.pits || [], makePit, updatePit);
    sync(pools.shells, world.shells, () => {
      const s = new THREE.Mesh(unitSphere, basic(C.COLOR_SHELL));
      s.scale.setScalar(C.SHELL_RADIUS_M);
      return s;
    }, (m, s) => m.position.set(s.x, C.CAMERA_HEIGHT_M * 0.7, s.y));
    sync(pools.mines, world.mines, () => new THREE.Mesh(mineGeo, mineUnarmed), (m, mine) => {
      m.position.set(mine.x, 0.15, mine.y);
      m.material = mine.armT > 0 ? mineUnarmed : mineArmed;
    });
    sync(pools.smokes, world.smokes, () => {
      const s = new THREE.Mesh(unitSphere, basic(C.COLOR_SMOKE, { side: THREE.DoubleSide, transparent: true }));
      s.scale.setScalar(C.SMOKE_RADIUS_M);
      return s;
    }, (m, s) => {
      m.position.set(s.x, 0, s.y);
      m.material.opacity = Math.min(1, (C.SMOKE_LIFETIME_S - s.t) / C.SMOKE_FADE_S);
    });
    sync(pools.explosions, world.explosions, () =>
      new THREE.Mesh(unitSphere, basic(C.COLOR_EXPLOSION, { transparent: true })), (m, e) => {
      const k = e.t / C.EXPLOSION_DURATION_S;
      if (e.splash) {
        m.material.color.set(C.COLOR_PIT_WATER);
        m.position.set(e.x, 1.2, e.y);
        m.scale.set(
          Math.max(0.1, C.EXPLOSION_RADIUS_M * 1.5 * k),
          Math.max(0.1, C.EXPLOSION_RADIUS_M * 2.2 * k),
          Math.max(0.1, C.EXPLOSION_RADIUS_M * 1.5 * k)
        );
      } else {
        m.material.color.set(C.COLOR_EXPLOSION);
        m.position.set(e.x, C.TANK_HEIGHT_M, e.y);
        m.scale.setScalar(Math.max(0.1, (e.big ? C.MINE_EXPLOSION_RADIUS_M : C.EXPLOSION_RADIUS_M) * k));
      }
      m.material.opacity = 1 - k;
    });
  }

  const camera = new THREE.PerspectiveCamera(C.CAMERA_FOV_DEG, 1, C.CAMERA_NEAR_M, C.CAMERA_FAR_M);
  let cw = 1;
  let ch = 1;
  let half = 1;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    cw = Math.max(1, Math.floor(r.width));
    ch = Math.max(1, Math.floor(r.height));
    half = Math.floor((cw - C.VIEW_GAP_PX) / 2);
    renderer.setSize(cw, ch, false);
    camera.aspect = half / ch;
    camera.updateProjectionMatrix();
  }

  function render(world) {
    updateDynamic(world);
    renderer.setScissorTest(true);
    for (const p of [0, 1]) {
      const pose = viewPose(world, p);

      // Visibility inside smoke is ~2m, gradually decreasing to none at 2m
      let maxSmokeIntensity = 0;
      if (world.smokes) {
        for (const s of world.smokes) {
          const remaining = C.SMOKE_LIFETIME_S - s.t;
          if (remaining <= 0) continue;
          const dist = Math.hypot(pose.x - s.x, pose.y - s.y);
          if (dist < C.SMOKE_RADIUS_M) {
            const density = Math.min(1, remaining / C.SMOKE_FADE_S);
            const pen = Math.max(0, Math.min(1, (C.SMOKE_RADIUS_M - dist) / 2.0));
            const intensity = pen * density;
            if (intensity > maxSmokeIntensity) maxSmokeIntensity = intensity;
          }
        }
      }

      if (maxSmokeIntensity > 0.01) {
        const fogFar = C.SMOKE_VISIBLE_DISTANCE_M + (1 - maxSmokeIntensity) * 40;
        scene.fog = new THREE.Fog(smokeColor, 0.2, fogFar);
        scene.background.copy(skyColor).lerp(smokeColor, maxSmokeIntensity);
      } else {
        scene.fog = null;
        scene.background.copy(skyColor);
      }

      camera.position.set(pose.x, C.CAMERA_HEIGHT_M, pose.y);
      camera.lookAt(
        pose.x + Math.cos(pose.heading) * C.CAMERA_LOOK_DISTANCE_M,
        C.CAMERA_HEIGHT_M,
        pose.y + Math.sin(pose.heading) * C.CAMERA_LOOK_DISTANCE_M,
      );
      const hidden = pose.hideId != null ? tankMeshes.get(pose.hideId) : null;
      const prev = hidden ? hidden.visible : false;
      if (hidden) hidden.visible = false;
      const x = p === 0 ? 0 : cw - half;
      renderer.setViewport(x, 0, half, ch);
      renderer.setScissor(x, 0, half, ch);
      renderer.render(scene, camera);
      if (hidden) hidden.visible = prev;
    }
  }

  return { resize, render };
}
