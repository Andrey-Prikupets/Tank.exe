import * as C from '../constants.js';
import { setPinned, deleteRecording } from '../sim/recording.js';

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const trashSvg = `
<svg class="icon-trash" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="3 6 5 6 21 6"></polyline>
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  <line x1="10" y1="11" x2="10" y2="17"></line>
  <line x1="14" y1="11" x2="14" y2="17"></line>
</svg>
`;

const pinSvg = (pinned) => `
<svg class="icon-pin ${pinned ? 'pinned' : ''}" viewBox="0 0 24 24" width="16" height="16" fill="${pinned ? '#ffd54a' : 'none'}" stroke="${pinned ? '#ffd54a' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="12" y1="17" x2="12" y2="22"></line>
  <path d="M5 17h14v-2l-2-2V5a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v8l-2 2v2z"></path>
  <circle cx="12" cy="4" r="1"></circle>
</svg>
`;

const playSvg = `
<svg class="icon-play" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
  <polygon points="5 3 19 12 5 21 5 3"></polygon>
</svg>
`;

const pauseSvg = `
<svg class="icon-pause" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
  <rect x="6" y="4" width="4" height="16"></rect>
  <rect x="14" y="4" width="4" height="16"></rect>
</svg>
`;

export function createPlaybackToolbar(root) {
  let activePlayback = null;
  let activeMetadata = null;
  let onExitCb = null;
  let onDeleteCb = null;

  let hideTimer = null;
  let isHovered = false;
  let isDraggingSeek = false;
  let isVisible = false;
  let lastMouseX = -999;
  let lastMouseY = -999;

  let playBtn = null;
  let timeEl = null;
  let sliderEl = null;
  let speedBtn = null;
  let pinBtn = null;
  let trashBtn = null;
  let closeBtn = null;
  let confirmDialog = null;

  function show() {
    if (!activePlayback) return;
    isVisible = true;
    root.classList.add('visible');
    root.classList.remove('hidden-down');
    resetHideTimer();
  }

  function hide() {
    if (isHovered || isDraggingSeek || confirmDialog) return;
    isVisible = false;
    root.classList.remove('visible');
    root.classList.add('hidden-down');
  }

  function resetHideTimer() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hide();
    }, C.REPLAY_AUTO_HIDE_S * 1000);
  }

  function onGlobalMouseMove(e) {
    if (!activePlayback) return;
    const dist = Math.hypot(e.clientX - lastMouseX, e.clientY - lastMouseY);
    if (dist >= C.REPLAY_JITTER_THRESHOLD_PX) {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      show();
    }
  }

  window.addEventListener('mousemove', onGlobalMouseMove, { passive: true });

  function renderDom() {
    root.innerHTML = `
      <div class="pb-panel">
        <button type="button" class="pb-btn pb-play-btn" id="pbPlayBtn" title="Play/Pause (Space)">
          ${playSvg}
        </button>
        <div class="pb-time" id="pbTime">00:00 / 00:00</div>
        <div class="pb-seek-wrap">
          <input type="range" class="pb-seek-slider" id="pbSeekSlider" min="0" max="100" step="0.1" value="0" />
        </div>
        <button type="button" class="pb-btn pb-speed-btn" id="pbSpeedBtn" title="Cycle playback speed">1x</button>
        <button type="button" class="pb-btn pb-pin-btn" id="pbPinBtn" title="Pin / Unpin recording">
          ${pinSvg(false)}
        </button>
        <button type="button" class="pb-btn pb-trash-btn" id="pbTrashBtn" title="Delete recording">
          ${trashSvg}
        </button>
        <button type="button" class="pb-btn pb-close-btn" id="pbCloseBtn" title="Exit playback (Esc)">✕</button>
      </div>
      <div class="pb-confirm-overlay hidden" id="pbConfirmOverlay">
        <div class="pb-confirm-card">
          <div class="pb-confirm-text" id="pbConfirmText">Delete this recording?</div>
          <div class="pb-confirm-btns">
            <button type="button" class="rp-btn rp-btn-cancel" id="pbConfirmCancel">Cancel</button>
            <button type="button" class="rp-btn rp-btn-danger" id="pbConfirmDelete">Delete</button>
          </div>
        </div>
      </div>
    `;

    playBtn = root.querySelector('#pbPlayBtn');
    timeEl = root.querySelector('#pbTime');
    sliderEl = root.querySelector('#pbSeekSlider');
    speedBtn = root.querySelector('#pbSpeedBtn');
    pinBtn = root.querySelector('#pbPinBtn');
    trashBtn = root.querySelector('#pbTrashBtn');
    closeBtn = root.querySelector('#pbCloseBtn');
    confirmDialog = root.querySelector('#pbConfirmOverlay');

    root.addEventListener('mouseenter', () => {
      isHovered = true;
      if (hideTimer) clearTimeout(hideTimer);
    });

    root.addEventListener('mouseleave', () => {
      isHovered = false;
      resetHideTimer();
    });

    playBtn.onclick = (e) => {
      e.stopPropagation();
      if (!activePlayback) return;
      activePlayback.togglePlay();
      updatePlayBtn();
      resetHideTimer();
    };

    sliderEl.addEventListener('input', (e) => {
      isDraggingSeek = true;
      if (!activePlayback) return;
      const frac = parseFloat(e.target.value) / 100;
      activePlayback.seek(frac * activePlayback.duration);
    });

    sliderEl.addEventListener('change', () => {
      isDraggingSeek = false;
      resetHideTimer();
    });

    speedBtn.onclick = (e) => {
      e.stopPropagation();
      if (!activePlayback) return;
      const speeds = [1.0, 2.0, 0.5];
      const cur = activePlayback.speed;
      const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
      activePlayback.setSpeed(next);
      speedBtn.textContent = `${next}x`;
      resetHideTimer();
    };

    pinBtn.onclick = (e) => {
      e.stopPropagation();
      if (!activeMetadata) return;
      activeMetadata.pinned = !activeMetadata.pinned;
      setPinned(activeMetadata.id, activeMetadata.pinned);
      updatePinBtn();
      resetHideTimer();
    };

    trashBtn.onclick = (e) => {
      e.stopPropagation();
      if (!activeMetadata) return;
      const isPinned = activeMetadata.pinned;
      const textEl = root.querySelector('#pbConfirmText');
      if (textEl) {
        textEl.innerHTML = isPinned
          ? '⚠️ This recording is <strong>PINNED</strong>.<br>Delete anyway?'
          : 'Delete this recording?';
      }
      confirmDialog.classList.remove('hidden');
    };

    root.querySelector('#pbConfirmCancel').onclick = (e) => {
      e.stopPropagation();
      confirmDialog.classList.add('hidden');
      resetHideTimer();
    };

    root.querySelector('#pbConfirmDelete').onclick = (e) => {
      e.stopPropagation();
      confirmDialog.classList.add('hidden');
      if (activeMetadata) {
        deleteRecording(activeMetadata.id);
        if (onDeleteCb) onDeleteCb(activeMetadata.id);
        close();
      }
    };

    closeBtn.onclick = (e) => {
      e.stopPropagation();
      close();
    };
  }

  function updatePlayBtn() {
    if (!playBtn || !activePlayback) return;
    playBtn.innerHTML = activePlayback.isPlaying ? pauseSvg : playSvg;
  }

  function updatePinBtn() {
    if (!pinBtn || !activeMetadata) return;
    pinBtn.innerHTML = pinSvg(activeMetadata.pinned);
    pinBtn.title = activeMetadata.pinned ? 'Pinned (protected from deletion)' : 'Pin recording';
  }

  function open(playback, metadata, { onExit, onDelete }) {
    activePlayback = playback;
    activeMetadata = metadata;
    onExitCb = onExit;
    onDeleteCb = onDelete;

    renderDom();
    root.classList.remove('hidden');
    updatePlayBtn();
    updatePinBtn();
    if (speedBtn) speedBtn.textContent = `${playback.speed}x`;

    show();
  }

  function close() {
    if (hideTimer) clearTimeout(hideTimer);
    root.classList.add('hidden');
    root.classList.remove('visible');
    root.classList.remove('hidden-down');
    activePlayback = null;
    activeMetadata = null;
    if (onExitCb) onExitCb();
  }

  function update() {
    if (!activePlayback) return;
    updatePlayBtn();
    const cur = activePlayback.currentTime;
    const dur = activePlayback.duration;
    if (timeEl) {
      timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }
    if (sliderEl && !isDraggingSeek) {
      const frac = dur > 0 ? (cur / dur) * 100 : 0;
      sliderEl.value = frac.toFixed(1);
    }
  }

  function handleKey(e) {
    if (!activePlayback) return false;
    if (e.code === 'Space') {
      activePlayback.togglePlay();
      updatePlayBtn();
      show();
      return true;
    }
    if (e.code === 'ArrowLeft') {
      activePlayback.seek(activePlayback.currentTime - 5);
      show();
      return true;
    }
    if (e.code === 'ArrowRight') {
      activePlayback.seek(activePlayback.currentTime + 5);
      show();
      return true;
    }
    if (e.code === 'Escape') {
      if (confirmDialog && !confirmDialog.classList.contains('hidden')) {
        confirmDialog.classList.add('hidden');
        resetHideTimer();
      } else {
        close();
      }
      return true;
    }
    return false;
  }

  return { open, close, update, show, hide, handleKey, isOpen: () => !!activePlayback };
}
