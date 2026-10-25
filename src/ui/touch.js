import * as C from '../constants.js';

/**
 * Mobile Touch Screen Controls Overlay.
 *
 * Implements:
 * - Option A drone-sim style 2-axis proportional joystick for steering angular velocity & throttle.
 * - Fire, Mine, Smoke, and Stop buttons ergonomically separated to outer corners:
 *   - Player 0 (Left/Red): all controls clustered on the LEFT & bottom of the left viewport;
 *     non-interactive inventory HUD shifted to the RIGHT (inner center seam).
 *   - Player 1 (Right/Blue): all controls clustered on the RIGHT & bottom of the right viewport;
 *     non-interactive inventory HUD shifted to the LEFT (inner center seam).
 * - Tank 1..5 selection ribbon with live tactical status indicators.
 * - Hangar slit buttons [SLIT L] and [SLIT R].
 * - Top bar with [⏸ MENU] and [⛶ FULLSCREEN] buttons.
 */
export function createTouchControls({ root, onAction, onContinuousTurn, isHumanPlayer, openMenu, sfxResume, forceMobile = false }) {
  // Check touch capability
  const isTouchCapable =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches;

  // Touch setting: 'AUTO' (default), 'ON', or 'OFF'
  let touchSetting = 'AUTO';
  try {
    const saved = localStorage.getItem(C.TOUCH_SETTINGS_KEY);
    if (saved) touchSetting = JSON.parse(saved);
  } catch {}

  function isEnabled() {
    if (forceMobile) return true;
    if (touchSetting === 'ON') return true;
    if (touchSetting === 'OFF') return false;
    return isTouchCapable;
  }

  // Create Top Bar ([MENU] and [FULLSCREEN])
  const topBar = document.createElement('div');
  topBar.id = 'touchTopBar';
  topBar.className = 'touch-top-bar';
  topBar.innerHTML = `
    <button type="button" class="touch-bar-btn touch-btn-menu" aria-label="Menu / Pause">
      <span class="icon">⏸</span> <span class="label">MENU</span>
    </button>
    <button type="button" class="touch-bar-btn touch-btn-fs" aria-label="Toggle Fullscreen">
      <span class="icon">⛶</span>
    </button>
  `;
  root.appendChild(topBar);

  const btnMenu = topBar.querySelector('.touch-btn-menu');
  const btnFs = topBar.querySelector('.touch-btn-fs');

  btnMenu.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    sfxResume();
    openMenu();
  });

  function tryAutoFullscreen() {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    window.scrollTo(0, 1);
  }
  window.addEventListener('touchstart', tryAutoFullscreen, { once: true, passive: true });
  window.addEventListener('pointerdown', tryAutoFullscreen, { once: true });

  btnFs.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    sfxResume();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // SVG Icons
  const SHELL_ICON_SVG = `
    <svg viewBox="0 0 24 32" class="touch-svg-icon" width="22" height="30">
      <path d="M12 2 C8 7 7 12 7 24 L17 24 C17 12 16 7 12 2 Z" fill="#ffd54a" stroke="#000" stroke-width="1.3" />
      <rect x="6.5" y="24" width="11" height="5" rx="1" fill="#c99818" stroke="#000" stroke-width="1.3" />
    </svg>
  `;

  const MINE_ICON_SVG = `
    <svg viewBox="0 0 28 28" class="touch-svg-icon" width="22" height="22">
      <ellipse cx="14" cy="15" rx="10" ry="7" fill="#8a8a3a" stroke="#000" stroke-width="1.4"/>
      <ellipse cx="14" cy="13" rx="7" ry="4.5" fill="#ffd54a"/>
      <ellipse cx="14" cy="11.5" rx="4" ry="2.5" fill="#3a1010"/>
      <circle cx="14" cy="11.5" r="1.5" fill="#ff7060"/>
    </svg>
  `;

  const SMOKE_ICON_SVG = `
    <svg viewBox="0 0 28 28" class="touch-svg-icon" width="22" height="22">
      <path d="M14 6 C10 6 7.5 9 8 13 C5.5 13.5 4 16 5 19 C6 22 9 23 12 23 C14 23 16 22 17 21 C19 22 22 21 23 19 C24.5 16 23 13 21 12 C21.5 9.5 19 6.5 15.5 6 C15 6 14.5 6 14 6 Z" fill="#b8b8b8" stroke="#000" stroke-width="1.4"/>
    </svg>
  `;

  // Overlay container elements for both players
  const pane0 = root.querySelector('#pane0');
  const pane1 = root.querySelector('#pane1');

  function createPlayerOverlay(player) {
    const isLeft = player === 0;
    const overlay = document.createElement('div');
    overlay.className = `touch-player-overlay touch-side-${isLeft ? 'left' : 'right'}`;
    overlay.id = `touchOverlay${player}`;

    overlay.innerHTML = `
      <div class="touch-top-ribbon">
        <div class="touch-tanks-row" role="group" aria-label="Tank and slit selection">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button type="button" class="touch-tank-btn" data-tank="${n}" aria-label="Tank ${n}">
                  <span class="tank-num">${n}</span>
                </button>`
            )
            .join('')}
          <div class="touch-ribbon-divider"></div>
          <button type="button" class="touch-slit-btn" data-slit="L" aria-label="Left slit window">L</button>
          <button type="button" class="touch-slit-btn" data-slit="R" aria-label="Right slit window">R</button>
        </div>
      </div>

      <div class="touch-controls-cluster">
        <!-- Drone-sim Style Analog Joystick (Left Hand Movement) -->
        <div class="touch-stick-wrap">
          <div class="touch-stick-base">
            <div class="stick-crosshair-h"></div>
            <div class="stick-crosshair-v"></div>
            <div class="touch-stick-knob"></div>
          </div>
          <button type="button" class="touch-btn-stop" aria-label="Stop / Brake">STOP</button>
        </div>

        <!-- Action Weapons Cluster (Right Hand Fire: Mine/Smoke above, Ammo below) -->
        <div class="touch-weapons-cluster">
          <div class="touch-secondary-row">
            <button type="button" class="touch-action-btn touch-btn-mine" aria-label="Drop mine">
              ${MINE_ICON_SVG}
              <span class="action-label">MINE</span>
            </button>
            <button type="button" class="touch-action-btn touch-btn-smoke" aria-label="Release smoke">
              ${SMOKE_ICON_SVG}
              <span class="action-label">SMOKE</span>
            </button>
          </div>
          <button type="button" class="touch-action-btn touch-btn-fire" aria-label="Fire cannon">
            ${SHELL_ICON_SVG}
            <span class="action-label">FIRE</span>
          </button>
        </div>
      </div>
    `;

    return overlay;
  }

  const overlay0 = createPlayerOverlay(0);
  const overlay1 = createPlayerOverlay(1);
  pane0.appendChild(overlay0);
  pane1.appendChild(overlay1);

  // Bind buttons and joysticks
  function setupOverlayInteractions(overlay, player) {
    // Tank select buttons
    const tankBtns = overlay.querySelectorAll('.touch-tank-btn');
    tankBtns.forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        sfxResume();
        const n = String(btn.dataset.tank);
        onAction(player, 'SELECT', n);
      });
    });

    // Slit buttons
    const slitL = overlay.querySelector('.touch-slit-btn[data-slit="L"]');
    const slitR = overlay.querySelector('.touch-slit-btn[data-slit="R"]');
    slitL.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      sfxResume();
      onAction(player, 'WIN_L');
    });
    slitR.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      sfxResume();
      onAction(player, 'WIN_R');
    });

    // Action buttons: Fire, Mine, Smoke, Stop
    const btnFire = overlay.querySelector('.touch-btn-fire');
    const btnMine = overlay.querySelector('.touch-btn-mine');
    const btnSmoke = overlay.querySelector('.touch-btn-smoke');
    const btnStop = overlay.querySelector('.touch-btn-stop');

    btnFire.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      sfxResume();
      onAction(player, 'FIRE');
    });

    btnMine.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      sfxResume();
      onAction(player, 'MINE');
    });

    btnSmoke.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      sfxResume();
      onAction(player, 'SMOKE');
    });

    btnStop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      sfxResume();
      onAction(player, 'STOP');
    });

    // Option A: 2-Axis Drone-Style Proportional Virtual Joystick
    const stickBase = overlay.querySelector('.touch-stick-base');
    const stickKnob = overlay.querySelector('.touch-stick-knob');

    let activePointerId = null;
    let originX = 0;
    let originY = 0;
    let throttleTimer = null;
    let currentThrottle = null; // 'FORWARD' or 'BACK'

    function startThrottleRepeat(action) {
      if (currentThrottle === action) return;
      currentThrottle = action;
      if (throttleTimer) clearInterval(throttleTimer);
      onAction(player, action);
      throttleTimer = setInterval(() => {
        onAction(player, action);
      }, C.KEY_REPEAT_MS);
    }

    function stopThrottleRepeat() {
      currentThrottle = null;
      if (throttleTimer) {
        clearInterval(throttleTimer);
        throttleTimer = null;
      }
    }

    function resetStick() {
      activePointerId = null;
      stickKnob.style.transform = 'translate(0px, 0px)';
      stickKnob.classList.remove('dragging');
      stopThrottleRepeat();
      onContinuousTurn(player, 0);
    }

    stickBase.addEventListener('pointerdown', (e) => {
      if (activePointerId !== null) return;
      e.stopPropagation();
      e.preventDefault();
      sfxResume();

      activePointerId = e.pointerId;
      stickBase.setPointerCapture(e.pointerId);
      stickKnob.classList.add('dragging');

      const rect = stickBase.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;

      handlePointerMove(e);
    });

    function handlePointerMove(e) {
      if (e.pointerId !== activePointerId) return;
      const rawDx = e.clientX - originX;
      const rawDy = e.clientY - originY;
      const dist = Math.hypot(rawDx, rawDy);
      const maxR = C.TOUCH_JOYSTICK_MAX_RADIUS_PX;

      const angle = Math.atan2(rawDy, rawDx);
      const clampedDist = Math.min(dist, maxR);
      const clampedX = Math.cos(angle) * clampedDist;
      const clampedY = Math.sin(angle) * clampedDist;

      stickKnob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;

      // Horizontal axis: Proportional Steering / Angular Velocity
      const deadzone = C.TOUCH_JOYSTICK_DEADZONE_PX;
      if (Math.abs(clampedX) > deadzone) {
        const sign = Math.sign(clampedX);
        const norm = (Math.abs(clampedX) - deadzone) / (maxR - deadzone);
        const factor = sign * Math.min(1.0, norm);
        onContinuousTurn(player, factor);
      } else {
        onContinuousTurn(player, 0);
      }

      // Vertical axis: Throttle (Push up = FORWARD, Pull down = BACK)
      // Screen coordinates: UP is negative Y
      const ny = clampedY / maxR;
      if (ny < -C.TOUCH_THROTTLE_THRESHOLD) {
        startThrottleRepeat('FORWARD');
      } else if (ny > C.TOUCH_THROTTLE_THRESHOLD) {
        startThrottleRepeat('BACK');
      } else {
        stopThrottleRepeat();
      }
    }

    stickBase.addEventListener('pointermove', handlePointerMove);

    stickBase.addEventListener('pointerup', (e) => {
      if (e.pointerId === activePointerId) {
        try {
          stickBase.releasePointerCapture(e.pointerId);
        } catch {}
        resetStick();
      }
    });

    stickBase.addEventListener('pointercancel', (e) => {
      if (e.pointerId === activePointerId) {
        try {
          stickBase.releasePointerCapture(e.pointerId);
        } catch {}
        resetStick();
      }
    });
  }

  setupOverlayInteractions(overlay0, 0);
  setupOverlayInteractions(overlay1, 1);

  // Sync state per tick / frame
  function update(world, appState, menuOpen) {
    const enabled = isEnabled();
    const playing = appState === 'PLAYING' && !menuOpen && !world.over;

    // Apply touch-active class to app root so inventory HUDs reposition towards center seam
    root.classList.toggle('touch-active', enabled);

    topBar.classList.toggle('hidden', !enabled || appState !== 'PLAYING');
    overlay0.classList.toggle('hidden', !enabled || !playing || !isHumanPlayer(0));
    overlay1.classList.toggle('hidden', !enabled || !playing || !isHumanPlayer(1));

    if (!enabled || !playing) return;

    // Update Player 0 and Player 1 tactical status ribbons
    [0, 1].forEach((p) => {
      if (!isHumanPlayer(p)) return;
      const overlay = p === 0 ? overlay0 : overlay1;
      const pl = world.players[p];

      // Update 1..5 Tank buttons
      const tankBtns = overlay.querySelectorAll('.touch-tank-btn[data-tank]');
      tankBtns.forEach((btn) => {
        const num = String(btn.dataset.tank);
        const tank = world.tanks.find((t) => t.owner === p && String(t.number) === num);
        const isSelected = pl.view === 'tank' && String(pl.selected) === num;

        btn.classList.toggle('selected', isSelected);
        btn.classList.toggle('in-field', !!(tank && tank.status === 'field'));
        btn.classList.toggle('in-hangar', !!(tank && tank.status === 'hangar'));
        btn.classList.toggle('destroyed', !tank);
      });

      // Update Slit Buttons
      const slitL = overlay.querySelector('.touch-slit-btn[data-slit="L"]');
      const slitR = overlay.querySelector('.touch-slit-btn[data-slit="R"]');
      if (slitL) slitL.classList.toggle('active', pl.view === 'window' && pl.windowIdx === 0);
      if (slitR) slitR.classList.toggle('active', pl.view === 'window' && pl.windowIdx === 1);
    });
  }

  return {
    update,
    getSetting: () => touchSetting,
    setSetting: (val) => {
      touchSetting = val;
      localStorage.setItem(C.TOUCH_SETTINGS_KEY, JSON.stringify(val));
    },
    isEnabled,
  };
}
