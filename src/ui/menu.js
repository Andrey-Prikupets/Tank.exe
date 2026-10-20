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
    listEl.innerHTML = '';
    s.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.textContent = labelOf(it);
      if (i === s.index) li.classList.add('sel');
      li.addEventListener('mouseenter', () => {
        s.index = i;
        render();
      });
      li.addEventListener('click', () => activate(i));
      listEl.appendChild(li);
    });
  }

  function activate(i) {
    const s = top();
    if (!s || !s.items[i]) return;
    s.index = i;
    s.items[i].action();
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

      if (s.scrollable && scrollWrap) {
        if (e.code === 'PageDown') {
          scrollWrap.scrollTop += 180;
          return true;
        }
        if (e.code === 'PageUp') {
          scrollWrap.scrollTop -= 180;
          return true;
        }
        if (s.items.length <= 1) {
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

      if (s.items.length > 0) {
        if (C.MENU_KEYS.UP.includes(e.code)) {
          s.index = (s.index + s.items.length - 1) % s.items.length;
          render();
          return true;
        }
        if (C.MENU_KEYS.DOWN.includes(e.code)) {
          s.index = (s.index + 1) % s.items.length;
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
