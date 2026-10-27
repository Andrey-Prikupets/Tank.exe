import * as C from '../constants.js';

/**
 * Scrolling "AI chain of thought" panels shown in the empty side areas of the strategic map
 * for every AI-controlled side. Left column = seconds since game start.
 */
export function createAiLog(host) {
  const panels = [0, 1].map((owner) => {
    const el = document.createElement('div');
    el.className = `ai-log ${owner === 0 ? 'left' : 'right'}`;
    el.id = `aiLog${owner}`;
    el.innerHTML =
      `<div class="ai-log-head">${owner === 0 ? 'RED' : 'BLUE'} AI</div>` +
      '<div class="ai-log-body"></div>';
    el.style.display = 'none';
    host.appendChild(el);
    return { el, body: el.querySelector('.ai-log-body'), version: -1, controller: null };
  });

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function rowHtml(e) {
    const color = C.AI_LOG_TAG_COLORS[e.tag] || '#cccccc';
    return (
      `<div class="ai-row"><span class="ai-t">${e.t.toFixed(1)}</span>` +
      `<span class="ai-tag" style="color:${color}">${e.tag}</span>` +
      `<span class="ai-msg">${escapeHtml(e.msg)}</span></div>`
    );
  }

  /**
   * @param controllers AiController[2]
   * @param isAi (owner) => bool
   * @param sideWidthPx free black width on each side of the map
   * @param visible whether panels may be shown at all (game running)
   */
  function update(controllers, isAi, sideWidthPx, visible) {
    const showPanels = visible && sideWidthPx >= C.AI_LOG_MIN_PANEL_WIDTH_PX;
    panels.forEach((p, owner) => {
      const on = showPanels && isAi(owner);
      p.el.style.display = on ? 'flex' : 'none';
      if (!on) return;
      p.el.style.width = `${sideWidthPx - C.AI_LOG_PANEL_PADDING_PX * 2}px`;
      const ctl = controllers[owner];
      const ver = ctl.logVersion;
      if (p.version === ver && p.controller === ctl) return;
      p.version = ver;
      p.controller = ctl;
      const rows = ctl.decisionLog.slice(-C.AI_LOG_MAX_ROWS_RENDERED);
      p.body.innerHTML = rows.map(rowHtml).join('');
      p.body.scrollTop = p.body.scrollHeight;
    });
  }

  return { update };
}
