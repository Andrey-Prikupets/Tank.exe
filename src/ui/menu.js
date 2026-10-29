import * as C from '../constants.js';

/** Stack-based keyboard + mouse menu. Screen: {title, text, items:[{label|fn, action}], index, onEsc, scrollable}. */
export function createMenu(root) {
  const stack = [];
  const titleEl = root.querySelector('.m-title');
  const versionEl = root.querySelector('.m-version');
  const textEl = root.querySelector('.m-text');
  const scrollWrap = root.querySelector('.m-scroll-wrap');
  const cardEl = root.querySelector('.card');
  const listEl = root.querySelector('.m-items');
  const hintEl = root.querySelector('.m-hint');
  const langSwitchEl = root.querySelector('.m-lang-switch');

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let curX = 0;
  let curY = 0;

  function resetDrag() {
    isDragging = false;
    curX = 0;
    curY = 0;
    if (cardEl) {
      cardEl.style.transform = '';
      cardEl.classList.remove('dragging');
    }
  }

  if (cardEl) {
    cardEl.addEventListener('pointerdown', (e) => {
      const s = top();
      if (!s || !s.gameOver) return;
      if (e.target.closest('.m-items') || e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX - curX;
      startY = e.clientY - curY;
      cardEl.classList.add('dragging');
      cardEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      curX = e.clientX - startX;
      curY = e.clientY - startY;
      cardEl.style.transform = `translate(${curX}px, ${curY}px)`;
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      cardEl.classList.remove('dragging');
      try {
        cardEl.releasePointerCapture(e.pointerId);
      } catch {}
    };

    cardEl.addEventListener('pointerup', endDrag);
    cardEl.addEventListener('pointercancel', endDrag);
  }

  const top = () => stack[stack.length - 1];
  const labelOf = (it) => (typeof it.label === 'function' ? it.label() : it.label);
  const subtitleOf = (it) => (typeof it.subtitle === 'function' ? it.subtitle() : it.subtitle);
  const badgeOf = (it) => (typeof it.badge === 'function' ? it.badge() : it.badge);
  const itemsOf = (s) => (s ? (typeof s.items === 'function' ? s.items() : s.items || []) : []);

  function render() {
    const s = top();
    root.classList.toggle('hidden', !s);
    root.classList.toggle('gameover', !!(s && s.gameOver));
    root.classList.toggle('winner-red', !!(s && s.winner === 0));
    root.classList.toggle('winner-blue', !!(s && s.winner === 1));
    root.classList.toggle('winner-draw', !!(s && s.winner === 'draw'));
    if (!s || !s.gameOver) {
      resetDrag();
    }
    if (!s) return;
    titleEl.textContent = typeof s.title === 'function' ? s.title() : s.title;
    if (versionEl) {
      versionEl.textContent = s.version || C.VERSION_LABEL;
    }
    if (langSwitchEl) {
      if (s.langSwitch) {
        langSwitchEl.classList.remove('hidden');
        const btns = langSwitchEl.querySelectorAll('.lang-btn');
        btns.forEach((btn) => {
          const l = btn.dataset.lang;
          btn.classList.toggle('active', l === s.langSwitch.current);
          btn.onclick = (e) => {
            e.stopPropagation();
            if (s.langSwitch.onChange && l !== s.langSwitch.current) {
              s.langSwitch.onChange(l);
            }
          };
        });
      } else {
        langSwitchEl.classList.add('hidden');
      }
    }
    textEl.innerHTML = typeof s.text === 'function' ? s.text() : s.text || '';
    if (hintEl) {
      hintEl.textContent = s.hint || '↑ ↓ select  ·  Space / Enter confirm  ·  Esc back';
    }
    if (scrollWrap) {
      scrollWrap.scrollTop = 0;
    }
    const items = itemsOf(s);
    if (s.index >= items.length) s.index = Math.max(0, items.length - 1);
    listEl.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      const label = labelOf(it);
      const sub = subtitleOf(it);
      const badge = badgeOf(it);
      if (sub || badge) {
        if (sub) li.classList.add('has-subtitle');
        const contentDiv = document.createElement('div');
        contentDiv.className = 'm-item-content';
        const labelDiv = document.createElement('div');
        labelDiv.className = 'm-item-title';
        labelDiv.textContent = label;
        contentDiv.appendChild(labelDiv);
        if (sub) {
          const subDiv = document.createElement('div');
          subDiv.className = 'm-item-subtitle';
          subDiv.textContent = sub;
          contentDiv.appendChild(subDiv);
        }
        li.appendChild(contentDiv);
        if (badge) {
          const badgeSpan = document.createElement('span');
          badgeSpan.className = 'm-item-badge';
          badgeSpan.textContent = badge;
          li.appendChild(badgeSpan);
        }
      } else {
        li.textContent = label;
      }
      if (i === s.index) li.classList.add('sel');
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        activate(i);
      });
      listEl.appendChild(li);
    });
  }

  function activate(i) {
    const s = top();
    if (!s) return;
    const items = itemsOf(s);
    if (!items[i]) return;
    s.index = i;
    items[i].action();
    render();
  }

  const api = {
    isOpen: () => stack.length > 0,
    depth: () => stack.length,
    push(screen) {
      screen.index = typeof screen.index === 'number' ? screen.index : 0;
      stack.push(screen);
      render();
    },
    pop() {
      stack.pop();
      render();
    },
    clear() {
      stack.length = 0;
      render();
    },
    refresh: render,
    /** Returns true when the key was consumed. */
    handleKey(e) {
      const s = top();
      if (!s) return false;
      if (e.code === 'Tab') return true;

      const items = itemsOf(s);
      if (s.langSwitch && e.code === 'KeyL') {
        const langs = ['en', 'es', 'ru'];
        const cur = s.langSwitch.current || 'en';
        const next = langs[(langs.indexOf(cur) + 1) % langs.length];
        if (s.langSwitch.onChange) s.langSwitch.onChange(next);
        return true;
      }
      if (s.scrollable && scrollWrap) {
        if (e.code === 'PageDown') {
          scrollWrap.scrollTop += 180;
          return true;
        }
        if (e.code === 'PageUp') {
          scrollWrap.scrollTop -= 180;
          return true;
        }
        if (items.length <= 1) {
          if (e.code === 'ArrowDown') {
            scrollWrap.scrollTop += 45;
            return true;
          }
          if (e.code === 'ArrowUp') {
            scrollWrap.scrollTop -= 45;
            return true;
          }
        }
      }

      if (items.length > 0) {
        if (C.MENU_KEYS.UP.includes(e.code)) {
          s.index = (s.index + items.length - 1) % items.length;
          render();
          return true;
        }
        if (C.MENU_KEYS.DOWN.includes(e.code)) {
          s.index = (s.index + 1) % items.length;
          render();
          return true;
        }
        if (C.MENU_KEYS.ACTIVATE.includes(e.code)) {
          if (!e.repeat) activate(s.index);
          return true;
        }
      }

      if (C.MENU_KEYS.BACK.includes(e.code)) {
        if (!e.repeat && s.onEsc) s.onEsc();
        return true;
      }

      return false;
    },
  };
  return api;
}
