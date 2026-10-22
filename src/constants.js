// =============================================================================
// ALL tunable numbers, colors and key bindings live in this single file.
// Units are part of the name (_M, _KMH, _S, _DEG, _DEG_S ...).
// =============================================================================

// ---- Conversions (the only place where raw conversion factors appear) -------
const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
export const kmhToMs = (kmh) => (kmh * METERS_PER_KM) / SECONDS_PER_HOUR;
export const msToKmh = (ms) => (ms * SECONDS_PER_HOUR) / METERS_PER_KM;
export const degToRad = (deg) => (deg * Math.PI) / 180;
export const radToDeg = (rad) => (rad * 180) / Math.PI;

// ---- Simulation loop --------------------------------------------------------
export const SIM_TICK_HZ = 60;
export const SIM_TICK_S = 1 / SIM_TICK_HZ;
export const SIM_MAX_FRAME_S = 0.1;
export const HUD_UPDATE_INTERVAL_MS = 100;
export const RENDER_TARGET_FPS = 45;
export const SAVE_FORMAT_VERSION = 2;
export const SAVE_SLOT_COUNT = 10;
export const SAVE_KEY_PREFIX = 'tank.exe.save.';
export const AUDIO_SETTINGS_KEY = 'tank.exe.audio';
export const PLAYERS_SETTINGS_KEY = 'tank.exe.players';
export const AI_LEVEL_SETTINGS_KEY = 'tank.exe.ai_level';
export const OBSTACLES_SETTINGS_KEY = 'tank.exe.obstacles';
export const PITS_SETTINGS_KEY = 'tank.exe.pits';
export const OBSTACLE_HEIGHT_M = 4.8;
export const OBSTACLE_ROOF_HEIGHT_M = 1.6;
export const OBSTACLE_ROOF_EAVE_M = 0.5;
export const PIT_DROP_OVERLAP_FRACTION = 0.30;
export const PLAYER_MODES = [
  { id: 'HvH', label: 'Human vs Human', leftAi: false, rightAi: false },
  { id: 'HvC', label: 'Human vs Computer', leftAi: false, rightAi: true },
  { id: 'CvH', label: 'Computer vs Human', leftAi: true, rightAi: false },
  { id: 'CvC', label: 'Computer vs Computer', leftAi: true, rightAi: true },
];
export const AI_LEVELS = ['HARD', 'MEDIUM', 'EASY'];
export const AI_MAX_FIRE_DIST_M = 115;
export const AI_ENGAGE_FAR_DIST_M = 55;
export const AI_SMOKE_LOW_AMMO_DIST_M = 35;
export const AI_SMOKE_INCOMING_SHELL_DIST_M = 30;
export const AI_SMOKE_SHELL_DOT_THRESHOLD = 0.8;
export const AI_MINE_BEHIND_ANGLE_RAD = 0.7;

// ---- Field ------------------------------------------------------------------
export const FIELD_LENGTH_M = 250;
export const FIELD_WIDTH_M = 100;
export const BORDER_WALL_HEIGHT_M = 4;
export const BORDER_WALL_THICKNESS_M = 1;
export const GATE_WIDTH_M = 7;
export const GATE_CENTER_Y_M = FIELD_WIDTH_M / 2;

export const GAME_NAME = 'Tank.exe';
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v0.1.0';
export const BUILD_NUMBER = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 1;
export const COMMIT_HASH = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : '';
export const VERSION_LABEL = APP_VERSION;
export const TANK_LENGTH_M = 6;
export const TANK_WIDTH_M = 4;
export const TANK_HEIGHT_M = 2.5;
export const TANK_CHAMFER_M = 0.7;
export const TANKS_ON_FIELD_MAX = 5;
export const TANKS_PER_PLAYER = 15;
export const TANK_NUMBERS = [
  ['1', '2', '3', '4', '5'],
  ['1', '2', '3', '4', '5'],
];
export const PLAYER_KEY_LABELS = [
  ['1', '2', '3', '4', '5'],
  ['6', '7', '8', '9', '0'],
];
export const TANK_MAX_SPEED_KMH = 36;
export const TANK_MAX_REVERSE_KMH = 12;
export const SPEED_STEP_KMH = 6;
export const TANK_LINEAR_ACCEL_MS2 = 3;
export const TANK_MAX_TURN_DEG_S = 60;
export const TANK_PIVOT_TURN_FACTOR = 1.25;
export const TANK_MAX_PIVOT_TURN_DEG_S = TANK_MAX_TURN_DEG_S * TANK_PIVOT_TURN_FACTOR;
export const TURN_STEP_DEG_S = 15;
export const TANK_TURN_ACCEL_DEG_S2 = 60;
export const BORDER_DRAG_FACTOR = 0.5;
export const TANK_CONTACT_TURN_FACTOR = 0.5;

// ---- Initial setup ----------------------------------------------------------
export const START_BORDER_GAP_M = 6;
export const START_SPACING_M = 10;
export const SPAWN_OFFSET_FROM_GATE_M = 1.5;
export const SPAWN_CLEARANCE_M = 0.5;

// ---- Hangar -----------------------------------------------------------------
export const HANGAR_ROWS = 2;
export const HANGAR_SLOTS_PER_ROW = 5;
export const HANGAR_ROW_PITCH_M = 8;
export const HANGAR_FIRST_ROW_OFFSET_M = 4;
export const HANGAR_SLOT_PITCH_M = 8;
export const HANGAR_DEPTH_M = 17;
export const HANGAR_HALF_WIDTH_M = 22;

// ---- Sliding gate doors -----------------------------------------------------
export const GATE_OPEN_TIME_S = 0.8;
export const GATE_PASSABLE_FRACTION = 0.8;
export const GATE_APPROACH_M = 14;
export const GATE_DOOR_CLEAR_M = 1;
export const GATE_DOOR_THICKNESS_FRACTION = 0.8;

// ---- Tank turret (octagon with vertical edges) ------------------------------
export const TURRET_SIDES = 8;
export const TURRET_RADIUS_M = 1.6;
export const TURRET_TOP_RADIUS_M = TURRET_RADIUS_M;
export const TURRET_HEIGHT_M = 1.25; // 25% taller than 1.0m
export const TURRET_OFFSET_M = -0.3;
export const BARREL_LENGTH_M = 2.4; // Shorter gun so it does not touch hangar walls/tanks
export const BARREL_OFFSET_X_M = 2.0;
export const MAP_TURRET_STROKE_PX = 1;

// ---- Weapons ----------------------------------------------------------------
export const TANK_START_SHELLS = 5;
export const TANK_START_MINES = 2;
export const TANK_START_SMOKES = 2;
export const GUN_RELOAD_S = 1;
export const WINDOW_RELOAD_S = 1.5;
export const SHELL_RANGE_M = FIELD_LENGTH_M / 4;
export const SHELL_FLIGHT_TIME_S = 0.4;
export const SHELL_MUZZLE_OFFSET_M = 0.5;
export const SHELL_RADIUS_M = 0.5;
export const MINE_DROP_BEHIND_M = 1.5;
export const MINE_ARM_DELAY_S = 1.5;
export const MINE_TRIGGER_RADIUS_M = 1;
export const MINE_RADIUS_M = 0.8;
export const SMOKE_RADIUS_M = 10;
export const SMOKE_LIFETIME_S = 10;
export const SMOKE_FADE_S = 2;
export const SMOKE_VISIBLE_DISTANCE_M = 2.0; // Visibility inside smoke fades to 0 at 2m
export const EXPLOSION_DURATION_S = 1;
export const EXPLOSION_RADIUS_M = 5;
export const MINE_EXPLOSION_RADIUS_M = 7;

// ---- Hangar windows / gate view --------------------------------------------
export const WINDOW_OFFSET_FROM_GATE_M = 8;
export const WINDOW_LENGTH_M = 5;
export const WINDOW_MAX_YAW_DEG = 45;
export const WINDOW_YAW_RATE_DEG_S = 45;
export const WINDOW_CAMERA_INSET_M = 0.4;
export const DEAD_ZONE_DEPTH_M = TANK_LENGTH_M;
export const DEAD_ZONE_SIDE_MARGIN_M = TANK_LENGTH_M / 2;
export const WINDOW_MASK_PERCENT = 36;

// ---- Messages ---------------------------------------------------------------
export const MESSAGE_DURATION_S = 3;

// ---- Camera -----------------------------------------------------------------
export const CAMERA_HEIGHT_M = 2.0;
export const CAMERA_FOV_DEG = 60;
export const CAMERA_NEAR_M = 0.2;
export const CAMERA_FAR_M = 700;
export const CAMERA_LOOK_DISTANCE_M = 10;
export const VIEW_GAP_PX = 4;
export const MAX_PIXEL_RATIO = 1.0;

// ---- Input ------------------------------------------------------------------
export const KEY_REPEAT_DELAY_MS = 300;
export const KEY_REPEAT_MS = 150;
export const KEYS_SETTINGS_KEY = 'tank.exe.keys';
export const DEFAULT_KEYS = {
  MENU: 'Escape',
  LEFT: {
    SELECT: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
    FORWARD: 'KeyW',
    BACK: 'KeyS',
    TURN_L: 'KeyA',
    TURN_R: 'KeyD',
    WIN_L: 'KeyQ',
    WIN_R: 'KeyE',
    FIRE: 'Tab',
    MINE: 'KeyZ',
    SMOKE: 'KeyX',
  },
  RIGHT: {
    SELECT: ['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
    FORWARD: 'ArrowUp',
    BACK: 'ArrowDown',
    TURN_L: 'ArrowLeft',
    TURN_R: 'ArrowRight',
    WIN_L: 'BracketLeft',
    WIN_R: 'BracketRight',
    FIRE: ['Enter', 'NumpadEnter'],
    MINE: 'Comma',
    SMOKE: 'Period',
  },
};
export const KEYS = DEFAULT_KEYS;
export const MENU_KEYS = {
  UP: ['ArrowUp', 'ArrowLeft'],
  DOWN: ['ArrowDown', 'ArrowRight'],
  ACTIVATE: ['Space', 'Enter', 'NumpadEnter'],
  BACK: ['Escape'],
};

// ---- Colors -----------------------------------------------------------------
export const COLOR_FIELD = '#3f9b3f';
export const COLOR_OUTSIDE = '#2e3338';
export const COLOR_SKY = '#8cc0ea';
export const COLOR_BORDER = '#e8e8e8';
export const COLOR_HANGAR_FLOOR = '#c0c4c8';
export const COLOR_HANGAR_WALL = '#d4d8dc';
export const COLOR_WINDOW = '#14202c';
export const COLOR_WINDOW_ACTIVE = '#ffd54a';
export const COLOR_LEFT_TEAM = '#b5372b';
export const COLOR_LEFT_SELECTED = '#ff7060';
export const COLOR_RIGHT_TEAM = '#2c55b8';
export const COLOR_RIGHT_SELECTED = '#6fa0ff';
export const COLOR_SHELL = '#ffe44d';
export const COLOR_MINE_UNARMED = '#8a8a3a';
export const COLOR_MINE_ARMED = '#3a1010';
export const COLOR_SMOKE = '#b8b8b8';
export const COLOR_EXPLOSION = '#ff8a1f';
export const COLOR_TANK_DETAIL = '#222222';
export const COLOR_LEFT_TURRET = '#7a2219';
export const COLOR_RIGHT_TURRET = '#1d3a82';
export const COLOR_GATE_DOOR = '#9aa0a6';
export const OBSTACLE_WALL_COLORS = [
  '#b8b0a5', // Warm light stone gray
  '#c4b7a4', // Bright sandy tan
  '#b8a89b', // Light khaki brown
  '#bdb9ad', // Bright concrete gray
  '#cbbfae', // Light plaster beige
  '#b2a297', // Warm dusty gray-brown
  '#c0b7a6', // Light desert stone
  '#aab0b4', // Bright cool slate gray
];
export const COLOR_OBSTACLE = OBSTACLE_WALL_COLORS[0];
export const COLOR_OBSTACLE_ROOF = '#524c46';
export const COLOR_OBSTACLE_ROOF_RIDGE = '#38322c';
export const COLOR_OBSTACLE_WINDOW = '#324759';
export const getObstacleWallColor = (id) =>
  OBSTACLE_WALL_COLORS[((id || 1) - 1) % OBSTACLE_WALL_COLORS.length];
export const COLOR_PIT_WATER = '#00e5ff';
export const COLOR_PIT_RIM = '#19241b';

// ---- Map rendering ----------------------------------------------------------
export const MAP_MARGIN_X_M = HANGAR_DEPTH_M + 2;
export const MAP_MARGIN_Y_M = 2;
export const MAP_DIGIT_SCALE = 0.8;
export const MAP_SHELL_MIN_RADIUS_PX = 2;
export const MAP_BORDER_LINE_PX = 2;
export const MAP_WINDOW_LINE_PX = 3;
export const MAP_SMOKE_MAX_ALPHA = 1;

// ---- Audio ------------------------------------------------------------------
export const AUDIO_MASTER_VOLUME = 0.35;
export const AUDIO_ENGINE_BASE_HZ = 38;
export const AUDIO_ENGINE_SPEED_HZ = 55;
export const AUDIO_ENGINE_GAIN = 0.06;
export const AUDIO_ENGINE_IDLE_GAIN = 0.015;
export const AUDIO_ENGINE_LOWPASS_HZ = 260;
export const AUDIO_ENGINE_SMOOTH_S = 0.1;
export const AUDIO_PAN_STRENGTH = 0.8;
export const AUDIO_SHOT_DURATION_S = 0.25;
export const AUDIO_EXPLOSION_DURATION_S = 0.9;
export const AUDIO_MINE_EXPLOSION_DURATION_S = 1.4;
