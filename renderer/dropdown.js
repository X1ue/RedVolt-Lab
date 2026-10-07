'use strict';
// 自绘下拉框：把原生 <select> 换成深色按钮 + 弹层，跟软件其它面板一个配色。
// Windows 上原生 <select> 的弹层是系统菜单，CSS 管不到它（白底蓝色高亮），只能自己画。
//
// 关键约定：原生 <select> 一直留在 DOM 里当唯一数据源，只是被隐藏。
// 既有代码（sel.value、sel.addEventListener('change')）和冒烟脚本都照旧工作，
// 本组件只负责显示，并把点击转成一次 value 赋值 + change 事件。
(function () {
  const REG = new WeakMap();
  const cur = { sel: null, inst: null, items: [], active: -1 };

  function options(s) {
    return Array.prototype.slice.call(s.options).map((o) => ({
      value: o.value,
      text: (o.textContent || '').trim(),
      disabled: !!o.disabled,
    }));
  }

  function close() {
    const inst = cur.inst;
    if (inst && inst.list) {
      inst.list.remove();
      inst.list = null;
      inst.btn.classList.remove('open');
      inst.btn.setAttribute('aria-expanded', 'false');
    }
    cur.sel = null;
    cur.inst = null;
    cur.items = [];
    cur.active = -1;
  }

  function place(inst) {
    const r = inst.btn.getBoundingClientRect();
    const list = inst.list;
    list.style.left = '0px';
    list.style.top = '0px';
    list.style.minWidth = Math.max(r.width, 150) + 'px';
    const h = list.offsetHeight;
    const w = list.offsetWidth;
    const flip = window.innerHeight - r.bottom - 8 < h && r.top > h + 8;
    list.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6)) + 'px';
    list.style.top = (flip ? r.top - h - 4 : r.bottom + 4) + 'px';
  }

  function pick(s, item) {
    const inst = REG.get(s);
    if (!item || item.disabled) return;
    if (s.value !== item.value) {
      s.value = item.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
    if (inst) inst.btn.focus();
  }

  function markActive(inst) {
    if (!inst.list) return;
    Array.prototype.forEach.call(inst.list.children, (row, i) => {
      row.classList.toggle('active', i === cur.active);
      if (i === cur.active) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function openList(inst) {
    const s = inst.sel;
    close();
    const box = document.createElement('div');
    box.className = 'dd-list';
    box.setAttribute('role', 'listbox');
    const items = options(s);
    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'dd-item' + (it.value === s.value ? ' on' : '') + (it.disabled ? ' dis' : '');
      row.setAttribute('role', 'option');
      const tick = document.createElement('span');
      tick.className = 'dd-tick';
      tick.textContent = '✓';
      const lab = document.createElement('span');
      lab.className = 'dd-label';
      lab.textContent = it.text;
      row.appendChild(tick);
      row.appendChild(lab);
      // 阻止默认，否则按钮先 blur、列表还没点上去就被关闭了
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', (e) => { e.stopPropagation(); pick(s, it); });
      box.appendChild(row);
    });
    document.body.appendChild(box);
    inst.list = box;
    place(inst);
    inst.btn.classList.add('open');
    inst.btn.setAttribute('aria-expanded', 'true');
    cur.sel = s;
    cur.inst = inst;
    cur.items = items;
    cur.active = Math.max(0, s.selectedIndex);
    markActive(inst);
  }

  function move(inst, d) {
    if (!inst.list) { openList(inst); return; }
    const n = cur.items.length;
    if (!n) return;
    cur.active = (cur.active + d + n) % n;
    markActive(inst);
  }

  function labelFor(s) {
    for (const o of options(s)) if (o.value === s.value) return o.text;
    return s.selectedIndex >= 0 ? (s.options[s.selectedIndex].textContent || '').trim() : '';
  }

  function render(inst) {
    const s = inst.sel;
    const label = labelFor(s);
    inst.cur.textContent = label;
    inst.cur.title = label;
    inst.btn.disabled = !!s.disabled;
    if (inst.list) {
      const rows = inst.list.children;
      for (let i = 0; i < rows.length && i < cur.items.length; i++) {
        const it = cur.items[i];
        rows[i].querySelector('.dd-label').textContent = it.text;
        rows[i].classList.toggle('on', it.value === s.value);
      }
    }
  }

  function variant(s) {
    if (s.classList.contains('lang')) return 'dd--lang';
    if (s.classList.contains('game-sel')) return 'dd--game';
    if (s.closest('.gpu-set')) return 'dd--gpu';
    return '';
  }

  function build(s) {
    if (REG.has(s) || s.closest('.dd')) return REG.get(s);
    const wrap = document.createElement('span');
    wrap.className = ('dd ' + variant(s)).trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const lab = document.createElement('span');
    lab.className = 'dd-cur';
    const arrow = document.createElement('span');
    arrow.className = 'dd-arrow';
    arrow.textContent = '▾';
    btn.appendChild(lab);
    btn.appendChild(arrow);
    wrap.appendChild(btn);
    s.parentNode.insertBefore(wrap, s);
    s.classList.add('dd-src');

    const inst = { sel: s, wrap, btn, cur: lab, list: null };
    REG.set(s, inst);

    // 代码里给 select.value 赋值不触发任何事件，补一个 setter 才能同步按钮文字
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(s, 'value', {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); render(inst); },
    });

    btn.addEventListener('click', (e) => {
      // 设置弹窗里 <select> 包在 <label> 内，不挡住默认行为的话点击会被转嫁给隐藏的 select
      e.preventDefault();
      e.stopPropagation();
      if (cur.sel === s) close();
      else openList(inst);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (cur.sel !== s) openList(inst);
        else move(inst, e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (cur.sel === s) { e.preventDefault(); pick(s, cur.items[cur.active]); }
      } else if (e.key === 'Escape') {
        if (cur.sel === s) { e.preventDefault(); close(); }
      }
    });
    btn.addEventListener('blur', () => { if (cur.sel === s) setTimeout(close, 80); });

    s.addEventListener('change', () => render(inst));
    new MutationObserver(() => render(inst)).observe(s, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['disabled', 'class'],
    });
    render(inst);
    return inst;
  }

  function upgrade(root) {
    if (!root || !root.querySelectorAll) return;
    for (const s of root.querySelectorAll('select')) if (!REG.has(s)) build(s);
  }

  document.addEventListener('mousedown', (e) => {
    const inst = cur.inst;
    if (!inst || !inst.list) return;
    if (inst.list.contains(e.target) || inst.wrap.contains(e.target)) return;
    close();
  }, true);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);

  // 动态生成的下拉框（游戏开关、显卡取值）在渲染时才出现，这里兜底升级
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.closest('.dd')) continue;
        if (n.tagName === 'SELECT') build(n);
        upgrade(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgrade(document));
  else upgrade(document);

  window.dropdown = { upgrade, close };
})();
