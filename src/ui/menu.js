import * as C from '../constants.js';

/** Stack-based keyboard + mouse menu. Screen: {title, text, items:[{label|fn, action}], index, onEsc, scrollable}. */
export function createMenu(root) {
  const stack = [];
  const titleEl = root.querySelector('.m-title');
  const versionEl = root.querySelector('.m-version');
  const textEl = root.querySelector('.m-text');
  const scrollWrap = root.querySelector('.m-scroll-wrap');
  const listEl = root.querySelector('.m-items');

  const top = () => stack[stack.length - 1];
  const labelOf = (it) => (typeof it.label === 'function' ? it.label() : it.label);
  const itemsOf = (s) => (s ? (typeof s.items === 'function' ? s.items() : s.items || []) : []);

  function render() {
    const s = top();
    root.classList.toggle('hidden', !s);
    if (!s) return;
    titleEl.textContent = s.title;
    if (versionEl) {
      versionEl.textContent = s.version || C.VERSION_LABEL;
    }
    textEl.innerHTML = typeof s.text === 'function' ? s.text() : s.text || '';
    if (scrollWrap) {
      scrollWrap.scrollTop = 0;
    }
    const items = itemsOf(s);
    if (s.index >= items.length) s.index = Math.max(0, items.length - 1);
    listEl.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.textContent = labelOf(it);
      if (i === s.index) li.classList.add('sel');
      // Only move the highlight: rebuilding the list here would destroy the element
      // between mousedown and mouseup, so the click would never fire.
      li.addEventListener('mouseenter', () => {
        if (s.index === i) return;
        s.index = i;
        [...listEl.children].forEach((el, k) => el.classList.toggle('sel', k === i));
      });
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
      screen.index = screen.index || 0;
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
