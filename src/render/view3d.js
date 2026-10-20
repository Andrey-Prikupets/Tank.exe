import * as THREE from 'three';
import * as C from '../constants.js';
import { viewPose, windowY, gateX } from '../sim/world.js';

const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

export function createView3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
  const field = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat(C.COLOR_FIELD));
  field.rotation.x = -Math.PI / 2;
  field.position.set(L / 2, 0, W / 2);
  scene.add(field);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(L * 4, W * 8), mat(C.COLOR_OUTSIDE));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(L / 2, -0.05, W / 2);
  scene.add(outside);

  const wallMat = mat(C.COLOR_BORDER);
  const T = C.BORDER_WALL_THICKNESS_M;
  const H = C.BORDER_WALL_HEIGHT_M;
  addBox(L + 2 * T, H, T, L / 2, H / 2, -T / 2, wallMat);
  addBox(L + 2 * T, H, T, L / 2, H / 2, W + T / 2, wallMat);
  const g0 = C.GATE_CENTER_Y_M - C.GATE_WIDTH_M / 2;
  const g1 = C.GATE_CENTER_Y_M + C.GATE_WIDTH_M / 2;
  for (const owner of [0, 1]) {
    const cx = owner === 0 ? -T / 2 : L + T / 2;
    addBox(T, H, g0, cx, H / 2, g0 / 2, wallMat);
    addBox(T, H, W - g1, cx, H / 2, g1 + (W - g1) / 2, wallMat);
    const teamMat = mat(owner === 0 ? C.COLOR_LEFT_TEAM : C.COLOR_RIGHT_TEAM);
    addBox(T, H + 1, T, cx, (H + 1) / 2, g0, teamMat);
    addBox(T, H + 1, T, cx, (H + 1) / 2, g1, teamMat);
    // window decals (field side)
    const dir = owner === 0 ? 1 : -1;
    for (const idx of [0, 1]) {
      addBox(0.1, 1, C.WINDOW_LENGTH_M, gateX(owner) + dir * 0.05, 2.2, windowY(owner, idx), basic(C.COLOR_WINDOW));
    }
    // hangar building
    const D = C.HANGAR_DEPTH_M;
    const hx = owner === 0 ? -(T + D / 2) : L + T + D / 2;
    const hw = C.HANGAR_HALF_WIDTH_M;
    addBox(D, 0.1, 2 * hw, hx, 0.05, C.GATE_CENTER_Y_M, mat(C.COLOR_HANGAR_FLOOR));
    addBox(T, H, 2 * hw, owner === 0 ? -(T + D) : L + T + D, H / 2, C.GATE_CENTER_Y_M, mat(C.COLOR_HANGAR_WALL));
    for (const s of [-1, 1]) addBox(D, H, T, hx, H / 2, C.GATE_CENTER_Y_M + s * hw, mat(C.COLOR_HANGAR_WALL));
  }

  // ---- dynamic objects ----
  const tankMeshes = new Map();
  function makeTank(owner) {
    const g = new THREE.Group();
    const color = owner === 0 ? C.COLOR_LEFT_TEAM : C.COLOR_RIGHT_TEAM;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(C.TANK_LENGTH_M, C.TANK_HEIGHT_M * 0.5, C.TANK_WIDTH_M), mat(color));
    hull.position.y = C.TANK_HEIGHT_M * 0.25 + 0.2;
    const turret = new THREE.Mesh(new THREE.BoxGeometry(C.TANK_LENGTH_M * 0.45, C.TANK_HEIGHT_M * 0.4, C.TANK_WIDTH_M * 0.6), mat(color));
    turret.position.set(-0.3, C.TANK_HEIGHT_M * 0.7 + 0.2, 0);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, C.TANK_LENGTH_M * 0.7, 8), mat(C.COLOR_TANK_DETAIL));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(C.TANK_LENGTH_M * 0.3, C.TANK_HEIGHT_M * 0.7 + 0.2, 0);
    const trackMat = mat(C.COLOR_TANK_DETAIL);
    for (const s of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(C.TANK_LENGTH_M, 0.7, 0.6), trackMat);
      track.position.set(0, 0.35, s * (C.TANK_WIDTH_M / 2));
      g.add(track);
    }
    g.add(hull, turret, barrel);
    scene.add(g);
    return g;
  }

  const pools = { shells: [], mines: [], smokes: [], explosions: [] };
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
  const unitSphere = new THREE.SphereGeometry(1, 16, 12);
  const mineGeo = new THREE.CylinderGeometry(C.MINE_RADIUS_M, C.MINE_RADIUS_M, 0.25, 12);
  const mineUnarmed = mat(C.COLOR_MINE_UNARMED);
  const mineArmed = mat(C.COLOR_MINE_ARMED);

  function updateDynamic(world) {
    const seen = new Set();
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
      m.position.set(e.x, C.TANK_HEIGHT_M, e.y);
      m.scale.setScalar(Math.max(0.1, (e.big ? C.MINE_EXPLOSION_RADIUS_M : C.EXPLOSION_RADIUS_M) * k));
      m.material.opacity = 1 - k;
    });
  }

  const camera = new THREE.PerspectiveCamera(C.CAMERA_FOV_DEG, 1, C.CAMERA_NEAR_M, C.CAMERA_FAR_M);
  let cw = 1;
  let ch = 1;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    cw = Math.max(1, Math.floor(r.width));
    ch = Math.max(1, Math.floor(r.height));
    renderer.setSize(cw, ch, false);
  }

  function render(world) {
    updateDynamic(world);
    renderer.setScissorTest(true);
    const half = Math.floor((cw - C.VIEW_GAP_PX) / 2);
    for (const p of [0, 1]) {
      const pose = viewPose(world, p);
      camera.aspect = half / ch;
      camera.updateProjectionMatrix();
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
