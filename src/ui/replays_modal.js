import * as C from '../constants.js';
import { listRecordings, setPinned, deleteRecording } from '../sim/recording.js';

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDatetime(iso) {
  try {
    const d = new Date(iso);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hr = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yr}-${mo}-${da} ${hr}:${mi}`;
  } catch {
    return iso || 'Unknown';
  }
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

export function createReplaysModal(root) {
  let callbacks = null;
  let showPinnedOnly = false;
  let deleteConfirmId = null;

  function render() {
    if (!root) return;
    const allReplays = listRecordings();
    const replays = showPinnedOnly ? allReplays.filter((r) => r.pinned) : allReplays;

    const confirmItem = deleteConfirmId ? allReplays.find((r) => r.id === deleteConfirmId) : null;

    let contentHtml = '';
    if (confirmItem) {
      contentHtml = `
        <div class="replays-confirm-dialog">
          <div class="confirm-msg ${confirmItem.pinned ? 'warn' : ''}">
            ${confirmItem.pinned ? '⚠️ This recording is <strong>PINNED</strong>. Delete anyway?' : 'Delete this recorded match?'}
          </div>
          <div class="confirm-match-info">
            <span>${formatDatetime(confirmItem.savedAt)}</span> · <span>${confirmItem.modeLabel || confirmItem.mode}</span> · <span>${confirmItem.winnerLabel || 'END'}</span>
          </div>
          <div class="confirm-actions">
            <button type="button" class="rp-btn rp-btn-cancel" id="btnConfirmCancel">Cancel (Esc)</button>
            <button type="button" class="rp-btn rp-btn-danger" id="btnConfirmDelete">Delete Recording</button>
          </div>
        </div>
      `;
    } else if (replays.length === 0) {
      const msg = showPinnedOnly
        ? 'No pinned recordings found. Click the 📌 icon on any recording to pin it.'
        : 'No recorded games found.<br><br>Enable <strong>Recording: ON</strong> in Options to record your matches.';
      contentHtml = `<div class="replays-empty">${msg}</div>`;
    } else {
      const rowsHtml = replays
        .map((r) => {
          const outcomeClass =
            r.winner === 0 ? 'red' : r.winner === 1 ? 'blue' : 'draw';
          const modeDisplay = r.aiLevel && r.mode !== 'HvH'
            ? `${r.modeLabel || r.mode} (${r.aiLevel})`
            : (r.modeLabel || r.mode);
          const isCustomDist = r.shootDist != null && r.shootDist !== C.SHELL_RANGE_M;
          const customDistNotice = isCustomDist
            ? `<div class="replays-custom-dist">This game has customized maximum shooting distance = ${r.shootDist} m</div>`
            : '';

          return `
            <tr class="replays-row" data-id="${r.id}">
              <td class="col-pin">
                <button type="button" class="rp-icon-btn pin-toggle" data-id="${r.id}" title="${r.pinned ? 'Pinned (protected from auto-deletion)' : 'Click to pin'}">
                  ${pinSvg(r.pinned)}
                </button>
              </td>
              <td class="col-date">${formatDatetime(r.savedAt)}</td>
              <td class="col-dur">${formatDuration(r.duration || 0)}</td>
              <td class="col-mode">
                ${modeDisplay}
                ${customDistNotice}
              </td>
              <td class="col-score">
                <span class="outcome-tag ${outcomeClass}">${r.winnerLabel || 'END'}</span>
                <span class="score-tag">${r.score || ''}</span>
              </td>
              <td class="col-actions">
                <button type="button" class="rp-btn rp-btn-play" data-id="${r.id}">▶ Play</button>
                <button type="button" class="rp-icon-btn delete-btn" data-id="${r.id}" title="Delete recording">
                  ${trashSvg}
                </button>
              </td>
            </tr>
          `;
        })
        .join('');

      contentHtml = `
        <div class="replays-table-wrap">
          <table class="replays-table">
            <thead>
              <tr>
                <th class="col-pin">PIN</th>
                <th class="col-date">DATE & TIME</th>
                <th class="col-dur">DURATION</th>
                <th class="col-mode">MODE</th>
                <th class="col-score">OUTCOME & SCORE</th>
                <th class="col-actions">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    root.innerHTML = `
      <div class="replays-modal">
        <div class="replays-header">
          <div class="replays-title-row">
            <h1 class="replays-title">GAME PLAYBACK</h1>
            <button type="button" class="replays-close-btn" id="btnReplaysClose" title="Close (Esc)">✕</button>
          </div>
          <div class="replays-subtitle">
            Recorded combat matches · Sorted by date (newest first)
          </div>
          <div class="replays-bar">
            <label class="replays-filter-label">
              <input type="checkbox" id="pinnedFilterCheckbox" ${showPinnedOnly ? 'checked' : ''} />
              <span>Show only pinned recordings</span>
            </label>
            <div class="replays-count">
              ${allReplays.length} match${allReplays.length === 1 ? '' : 'es'} (${allReplays.filter((r) => r.pinned).length} pinned)
            </div>
          </div>
        </div>
        <div class="replays-body">
          ${contentHtml}
        </div>
        <div class="replays-footer">
          <button type="button" class="rp-btn rp-btn-back" id="btnReplaysBack">Back to Menu (Esc)</button>
        </div>
      </div>
    `;

    // Wire up events
    const closeBtn = root.querySelector('#btnReplaysClose');
    if (closeBtn) closeBtn.onclick = close;
    const backBtn = root.querySelector('#btnReplaysBack');
    if (backBtn) backBtn.onclick = close;

    const filterCheckbox = root.querySelector('#pinnedFilterCheckbox');
    if (filterCheckbox) {
      filterCheckbox.onchange = (e) => {
        showPinnedOnly = e.target.checked;
        deleteConfirmId = null;
        render();
      };
    }

    // Delete confirmation handlers
    const cancelDeleteBtn = root.querySelector('#btnConfirmCancel');
    if (cancelDeleteBtn) {
      cancelDeleteBtn.onclick = () => {
        deleteConfirmId = null;
        render();
      };
    }
    const confirmDeleteBtn = root.querySelector('#btnConfirmDelete');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.onclick = () => {
        if (deleteConfirmId) {
          deleteRecording(deleteConfirmId);
          deleteConfirmId = null;
          render();
        }
      };
    }

    // Row clicks
    root.querySelectorAll('.pin-toggle').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const current = allReplays.find((r) => r.id === id);
        if (current) {
          setPinned(id, !current.pinned);
          render();
        }
      };
    });

    root.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        deleteConfirmId = btn.dataset.id;
        render();
      };
    });

    root.querySelectorAll('.rp-btn-play').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (callbacks && callbacks.onPlay) {
          close();
          callbacks.onPlay(id);
        }
      };
    });

    root.querySelectorAll('.replays-row').forEach((row) => {
      row.onclick = () => {
        const id = row.dataset.id;
        if (callbacks && callbacks.onPlay) {
          close();
          callbacks.onPlay(id);
        }
      };
    });
  }

  function open(cbs) {
    callbacks = cbs;
    deleteConfirmId = null;
    root.classList.remove('hidden');
    render();
  }

  function close() {
    deleteConfirmId = null;
    root.classList.add('hidden');
    if (callbacks && callbacks.onClose) {
      callbacks.onClose();
    }
  }

  function isOpen() {
    return !root.classList.contains('hidden');
  }

  function handleKey(e) {
    if (!isOpen()) return false;
    if (e.code === 'Escape') {
      if (deleteConfirmId) {
        deleteConfirmId = null;
        render();
      } else {
        close();
      }
      return true;
    }
    return false;
  }

  return { open, close, isOpen, refresh: render, handleKey };
}
