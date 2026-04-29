// ==UserScript==
// @name         AutoFill Helper
// @namespace    https://github.com/autofill-helper
// @version      1.0.0
// @description  点击表单元素时在旁边出现小图标，点击图标可弹出候选内容列表自动填入，支持按域名管理数据
// @author       You
// @match        *://*/*
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════
  //  常量
  // ══════════════════════════════════════════════════════════
  var STORAGE_KEY = 'autofill_helper_data';

  var INPUT_SELECTOR = [
    'input[type="text"]',
    'input[type="email"]',
    'input[type="search"]',
    'input[type="number"]',
    'input[type="tel"]',
    'input[type="url"]',
    'input[type="password"]',
    'input:not([type])',
    'textarea'
  ].join(',');

  // ══════════════════════════════════════════════════════════
  //  数据读写层
  // ══════════════════════════════════════════════════════════

  function getData() {
    var raw = GM_getValue(STORAGE_KEY, null);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }

  function saveData(data) {
    GM_setValue(STORAGE_KEY, JSON.stringify(data));
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getItemsForDomain(domain) {
    var data = getData();
    return {
      global: data['global'] || [],
      domainItems: data[domain] || []
    };
  }

  function addItem(scope, label, value) {
    var data = getData();
    if (!data[scope]) data[scope] = [];
    data[scope].push({ id: genId(), label: label, value: value, createdAt: Date.now() });
    saveData(data);
  }

  function editItem(scope, id, label, value) {
    var data = getData();
    if (!data[scope]) return;
    var item = data[scope].find(function (i) { return i.id === id; });
    if (item) { item.label = label; item.value = value; }
    saveData(data);
  }

  function deleteItem(scope, id) {
    var data = getData();
    if (!data[scope]) return;
    data[scope] = data[scope].filter(function (i) { return i.id !== id; });
    if (data[scope].length === 0) delete data[scope];
    saveData(data);
  }

  function getCurrentDomain() {
    return location.hostname || 'localhost';
  }

  // ══════════════════════════════════════════════════════════
  //  Shadow DOM — 样式隔离容器
  // ══════════════════════════════════════════════════════════

  var hostEl = document.createElement('div');
  hostEl.id = '__afh_host__';
  Object.assign(hostEl.style, {
    position: 'fixed',
    top: '0', left: '0',
    width: '0', height: '0',
    overflow: 'visible',
    zIndex: '2147483647',
    pointerEvents: 'none'
  });
  document.body.appendChild(hostEl);

  var shadow = hostEl.attachShadow({ mode: 'open' });

  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '*, *::before, *::after { box-sizing: border-box; }',

    /* ── 触发图标 ── */
    '.afh-icon {',
    '  position: fixed;',
    '  width: 22px; height: 22px;',
    '  background: #4f46e5;',
    '  border-radius: 5px;',
    '  cursor: pointer;',
    '  pointer-events: all;',
    '  display: flex; align-items: center; justify-content: center;',
    '  opacity: 0.82;',
    '  transition: opacity .15s, transform .1s;',
    '  user-select: none;',
    '}',
    '.afh-icon:hover { opacity: 1; transform: scale(1.08); }',
    '.afh-icon svg { width: 12px; height: 12px; fill: #fff; pointer-events: none; }',

    /* ── 候选面板 ── */
    '.afh-panel {',
    '  position: fixed;',
    '  width: 300px; max-height: 400px;',
    '  background: #fff;',
    '  border: 1px solid #e5e7eb;',
    '  border-radius: 10px;',
    '  box-shadow: 0 8px 30px rgba(0,0,0,.13), 0 2px 8px rgba(0,0,0,.06);',
    '  pointer-events: all;',
    '  display: flex; flex-direction: column;',
    '  overflow: hidden;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-size: 13px; color: #111827;',
    '}',

    /* 顶部搜索栏 */
    '.afh-head { display: flex; align-items: center; gap: 6px;',
    '  padding: 8px 10px; border-bottom: 1px solid #f3f4f6; flex-shrink: 0; }',
    '.afh-search { flex: 1; height: 28px;',
    '  border: 1px solid #e5e7eb; border-radius: 6px;',
    '  padding: 0 8px; font-size: 12px; outline: none;',
    '  color: #111827; background: #f9fafb; }',
    '.afh-search:focus { border-color: #4f46e5; background: #fff; }',
    '.afh-xbtn { width: 22px; height: 22px; border: none; background: none;',
    '  cursor: pointer; border-radius: 4px; color: #9ca3af;',
    '  font-size: 16px; line-height: 1; padding: 0;',
    '  display: flex; align-items: center; justify-content: center; }',
    '.afh-xbtn:hover { background: #f3f4f6; color: #374151; }',

    /* 列表区 */
    '.afh-list { flex: 1; overflow-y: auto; padding: 4px 0; }',
    '.afh-list::-webkit-scrollbar { width: 4px; }',
    '.afh-list::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 2px; }',
    '.afh-glabel { font-size: 10px; font-weight: 700; color: #9ca3af;',
    '  text-transform: uppercase; letter-spacing: .08em; padding: 6px 10px 3px; }',
    '.afh-divider { height: 1px; background: #f3f4f6; margin: 3px 10px; }',
    '.afh-empty { text-align: center; color: #9ca3af; font-size: 12px; padding: 18px 10px; }',

    /* 条目行 */
    '.afh-item { display: flex; align-items: center; gap: 8px;',
    '  padding: 6px 10px; cursor: pointer; transition: background .08s; }',
    '.afh-item:hover { background: #f5f3ff; }',
    '.afh-item-info { flex: 1; min-width: 0; }',
    '.afh-item-lbl { font-size: 10px; color: #a78bfa; font-weight: 600; margin-bottom: 1px; }',
    '.afh-item-val { font-size: 12px; color: #1f2937;',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.afh-item-acts { display: none; gap: 2px; }',
    '.afh-item:hover .afh-item-acts { display: flex; }',

    /* 条目操作按钮 */
    '.afh-abtn { width: 20px; height: 20px; border: none; background: none;',
    '  cursor: pointer; border-radius: 3px; display: flex;',
    '  align-items: center; justify-content: center; color: #9ca3af; padding: 0; }',
    '.afh-abtn:hover { background: #ede9fe; color: #6d28d9; }',
    '.afh-abtn.del:hover { background: #fee2e2; color: #dc2626; }',
    '.afh-abtn svg { width: 11px; height: 11px; fill: currentColor; pointer-events: none; }',

    /* 底部工具栏 */
    '.afh-foot { flex-shrink: 0; padding: 7px 10px;',
    '  border-top: 1px solid #f3f4f6; display: flex; gap: 6px; }',
    '.afh-fbtn { flex: 1; height: 26px; border-radius: 6px;',
    '  border: 1px solid #e5e7eb; background: #f9fafb;',
    '  font-size: 11px; cursor: pointer; color: #374151; transition: background .1s; }',
    '.afh-fbtn:hover { background: #f3f4f6; }',
    '.afh-fbtn.pri { background: #4f46e5; color: #fff; border-color: #4f46e5; }',
    '.afh-fbtn.pri:hover { background: #4338ca; }',

    /* 内联添加/编辑表单 */
    '.afh-form { flex-shrink: 0; padding: 8px 10px;',
    '  border-top: 1px solid #f3f4f6; background: #fafafa;',
    '  display: flex; flex-direction: column; gap: 5px; }',
    '.afh-finput { width: 100%; height: 27px;',
    '  border: 1px solid #e5e7eb; border-radius: 5px;',
    '  padding: 0 8px; font-size: 12px; outline: none; color: #111827; background: #fff; }',
    '.afh-finput:focus { border-color: #4f46e5; }',
    '.afh-frow { display: flex; gap: 5px; }',
    '.afh-fsel { height: 27px; border: 1px solid #e5e7eb; border-radius: 5px;',
    '  padding: 0 6px; font-size: 11px; outline: none; color: #111827;',
    '  background: #fff; cursor: pointer; }',
    '.afh-fsel:focus { border-color: #4f46e5; }',
  ].join('\n');
  shadow.appendChild(styleEl);

  // ══════════════════════════════════════════════════════════
  //  SVG 图标
  // ══════════════════════════════════════════════════════════

  var ICON_PASTE = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M8 2a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>'
    + '<path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2'
    + ' 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>';

  var ICON_EDIT = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/>'
    + '<path d="M11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>';

  var ICON_DEL = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
    + '<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10'
    + 'a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9z'
    + 'M7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 112 0v6a1 1 0 11-2 0V8z"'
    + ' clip-rule="evenodd"/></svg>';

  // ══════════════════════════════════════════════════════════
  //  状态
  // ══════════════════════════════════════════════════════════

  var activeInput = null;
  var iconEl     = null;
  var panelEl    = null;
  var hideTimer  = null;

  // ══════════════════════════════════════════════════════════
  //  触发图标模块
  // ══════════════════════════════════════════════════════════

  function ensureIcon() {
    if (iconEl) return;
    iconEl = document.createElement('div');
    iconEl.className = 'afh-icon';
    iconEl.innerHTML = ICON_PASTE;
    iconEl.title = 'AutoFill Helper（点击填入）';
    iconEl.style.display = 'none';
    shadow.appendChild(iconEl);
    iconEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (panelEl) closePanel();
      else if (activeInput) openPanel(activeInput);
    });
  }

  function positionIcon(el) {
    if (!iconEl) return;
    var r = el.getBoundingClientRect();
    var sz = 22, gap = 4;
    // 图标放在输入框内部右侧
    var left = r.right - sz - gap;
    var top  = r.top + (r.height - sz) / 2;
    if (left < 4) left = 4;
    if (top < 2)  top  = 2;
    if (top + sz > window.innerHeight - 2) top = window.innerHeight - sz - 2;
    iconEl.style.left = left + 'px';
    iconEl.style.top  = top  + 'px';
  }

  function showIcon(el) {
    clearTimeout(hideTimer);
    ensureIcon();
    activeInput = el;
    positionIcon(el);
    iconEl.style.display = 'flex';
  }

  function scheduleHideIcon() {
    hideTimer = setTimeout(function () {
      if (iconEl && !panelEl) iconEl.style.display = 'none';
    }, 250);
  }

  // 监听 focus / blur（用 capture 保证最早捕获）
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.matches && e.target.matches(INPUT_SELECTOR)) {
      showIcon(e.target);
    }
  }, true);

  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.matches && e.target.matches(INPUT_SELECTOR)) {
      scheduleHideIcon();
    }
  }, true);

  // 滚动 / 缩放时同步位置
  window.addEventListener('scroll', function () {
    if (!activeInput) return;
    if (iconEl)  positionIcon(activeInput);
    if (panelEl) positionPanel(activeInput);
  }, true);

  window.addEventListener('resize', function () {
    if (!activeInput) return;
    if (iconEl)  positionIcon(activeInput);
    if (panelEl) positionPanel(activeInput);
  });

  // Esc 关闭面板
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelEl) closePanel();
  }, true);

  // ══════════════════════════════════════════════════════════
  //  候选面板模块
  // ══════════════════════════════════════════════════════════

  function positionPanel(el) {
    if (!panelEl) return;
    var r = el.getBoundingClientRect();
    var pw = 300, ph = 400, mg = 6;
    var left = r.left;
    var top  = r.bottom + mg;
    // 下方空间不足则翻转到上方
    if (top + ph > window.innerHeight - 10) top = r.top - ph - mg;
    if (top < 4) top = 4;
    // 右侧越界则左移
    if (left + pw > window.innerWidth - 6) left = window.innerWidth - pw - 6;
    if (left < 4) left = 4;
    panelEl.style.left = left + 'px';
    panelEl.style.top  = top  + 'px';
  }

  function openPanel(el) {
    closePanel();
    var domain = getCurrentDomain();
    panelEl = document.createElement('div');
    panelEl.className = 'afh-panel';
    shadow.appendChild(panelEl);
    renderPanel(el, domain, '', false, null);
    positionPanel(el);
  }

  function renderPanel(inputEl, domain, query, showForm, editingItem) {
    if (!panelEl) return;
    panelEl.innerHTML = '';

    var _ref = getItemsForDomain(domain);
    var globals     = _ref.global;
    var domainItems = _ref.domainItems;

    var q = query.toLowerCase();
    function filt(arr) {
      return !q ? arr : arr.filter(function (i) {
        return i.label.toLowerCase().indexOf(q) !== -1
            || i.value.toLowerCase().indexOf(q) !== -1;
      });
    }
    var fg = filt(globals);
    var fd = filt(domainItems);

    /* ── 顶部搜索栏 ── */
    var head = document.createElement('div');
    head.className = 'afh-head';

    var srch = document.createElement('input');
    srch.className = 'afh-search';
    srch.type = 'text';
    srch.placeholder = '搜索...';
    srch.value = query;
    srch.addEventListener('input', function (e) {
      renderPanel(inputEl, domain, e.target.value, false, null);
    });

    var xbtn = document.createElement('button');
    xbtn.className = 'afh-xbtn';
    xbtn.textContent = '×';
    xbtn.addEventListener('click', closePanel);

    head.appendChild(srch);
    head.appendChild(xbtn);
    panelEl.appendChild(head);

    /* ── 列表区 ── */
    var list = document.createElement('div');
    list.className = 'afh-list';

    if (fd.length === 0 && fg.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'afh-empty';
      empty.textContent = q ? '没有匹配的内容' : '暂无数据，点击下方"快速添加"';
      list.appendChild(empty);
    }

    // 当前域名分组
    if (fd.length > 0) {
      var lbl1 = document.createElement('div');
      lbl1.className = 'afh-glabel';
      lbl1.textContent = '当前站点 · ' + domain;
      list.appendChild(lbl1);
      fd.forEach(function (item) {
        list.appendChild(buildItemEl(item, domain, inputEl, domain, query));
      });
    }

    // 全局分组
    if (fg.length > 0) {
      if (fd.length > 0) {
        var div = document.createElement('div');
        div.className = 'afh-divider';
        list.appendChild(div);
      }
      var lbl2 = document.createElement('div');
      lbl2.className = 'afh-glabel';
      lbl2.textContent = '全局';
      list.appendChild(lbl2);
      fg.forEach(function (item) {
        list.appendChild(buildItemEl(item, 'global', inputEl, domain, query));
      });
    }

    panelEl.appendChild(list);

    /* ── 内联表单（快速添加 / 编辑）── */
    if (showForm || editingItem) {
      panelEl.appendChild(buildForm(inputEl, domain, query, editingItem));
    }

    /* ── 底部工具栏 ── */
    var foot = document.createElement('div');
    foot.className = 'afh-foot';

    var addBtn = document.createElement('button');
    var isAddActive = showForm && !editingItem;
    addBtn.className = 'afh-fbtn' + (isAddActive ? ' pri' : '');
    addBtn.textContent = isAddActive ? '取消' : '＋ 快速添加';
    addBtn.addEventListener('click', function () {
      renderPanel(inputEl, domain, query, !isAddActive, null);
    });

    var mgBtn = document.createElement('button');
    mgBtn.className = 'afh-fbtn';
    mgBtn.textContent = '管理全部';
    mgBtn.addEventListener('click', function () {
      closePanel();
      openSettingsPage();
    });

    foot.appendChild(addBtn);
    foot.appendChild(mgBtn);
    panelEl.appendChild(foot);

    // 自动聚焦搜索框
    if (!showForm && !editingItem) {
      setTimeout(function () {
        var s = panelEl && panelEl.querySelector('.afh-search');
        if (s) s.focus();
      }, 20);
    }
  }

  function buildItemEl(item, scope, inputEl, domain, query) {
    var el = document.createElement('div');
    el.className = 'afh-item';

    var info = document.createElement('div');
    info.className = 'afh-item-info';

    var lbl = document.createElement('div');
    lbl.className = 'afh-item-lbl';
    lbl.textContent = item.label;

    var val = document.createElement('div');
    val.className = 'afh-item-val';
    val.textContent = item.value;
    val.title = item.value;

    info.appendChild(lbl);
    info.appendChild(val);

    var acts = document.createElement('div');
    acts.className = 'afh-item-acts';

    var ebtn = document.createElement('button');
    ebtn.className = 'afh-abtn';
    ebtn.innerHTML = ICON_EDIT;
    ebtn.title = '编辑';
    (function (it, sc) {
      ebtn.addEventListener('click', function (e) {
        e.stopPropagation();
        renderPanel(inputEl, domain, query, false,
          { id: it.id, label: it.label, value: it.value, scope: sc });
      });
    })(item, scope);

    var dbtn = document.createElement('button');
    dbtn.className = 'afh-abtn del';
    dbtn.innerHTML = ICON_DEL;
    dbtn.title = '删除';
    (function (it, sc) {
      dbtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteItem(sc, it.id);
        renderPanel(inputEl, domain, query, false, null);
      });
    })(item, scope);

    acts.appendChild(ebtn);
    acts.appendChild(dbtn);
    el.appendChild(info);
    el.appendChild(acts);

    el.addEventListener('click', function () {
      fillInput(inputEl, item.value);
      closePanel();
    });

    return el;
  }

  function buildForm(inputEl, domain, query, editingItem) {
    var form = document.createElement('div');
    form.className = 'afh-form';

    var lblInput = document.createElement('input');
    lblInput.className = 'afh-finput';
    lblInput.placeholder = '标签（如：姓名、测试账号）';
    lblInput.value = editingItem ? editingItem.label : '';

    var valInput = document.createElement('input');
    valInput.className = 'afh-finput';
    valInput.placeholder = '填入内容';
    valInput.value = editingItem ? editingItem.value
                   : (activeInput ? activeInput.value : '');

    var row = document.createElement('div');
    row.className = 'afh-frow';

    var scopeSel = document.createElement('select');
    scopeSel.className = 'afh-fsel';

    var optG = document.createElement('option');
    optG.value = 'global'; optG.textContent = '全局';
    var optD = document.createElement('option');
    optD.value = domain; optD.textContent = domain;
    scopeSel.appendChild(optG);
    scopeSel.appendChild(optD);

    if (editingItem) {
      scopeSel.value = editingItem.scope;
      scopeSel.disabled = true;
    }

    var saveBtn = document.createElement('button');
    saveBtn.className = 'afh-fbtn pri';
    saveBtn.style.flex = '1';
    saveBtn.style.height = '27px';
    saveBtn.textContent = editingItem ? '保存修改' : '保存';
    saveBtn.addEventListener('click', function () {
      var lv = lblInput.value.trim();
      var vv = valInput.value.trim();
      if (!lv || !vv) return;
      if (editingItem) editItem(editingItem.scope, editingItem.id, lv, vv);
      else             addItem(scopeSel.value, lv, vv);
      renderPanel(inputEl, domain, query, false, null);
    });

    // Enter 触发保存
    function onEnter(e) { if (e.key === 'Enter') saveBtn.click(); }
    lblInput.addEventListener('keydown', onEnter);
    valInput.addEventListener('keydown', onEnter);

    row.appendChild(scopeSel);
    row.appendChild(saveBtn);
    form.appendChild(lblInput);
    form.appendChild(valInput);
    form.appendChild(row);

    setTimeout(function () { lblInput.focus(); }, 20);
    return form;
  }

  function fillInput(el, value) {
    el.focus();
    try {
      var proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } catch (_) {
      el.value = value;
    }
    // 触发 React / Vue / Angular 等框架的合成事件
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
    if (iconEl)  iconEl.style.display = 'none';
  }

  // 点击外部区域关闭面板（composedPath 可穿透 Shadow DOM）
  document.addEventListener('mousedown', function (e) {
    if (!panelEl && (!iconEl || iconEl.style.display === 'none')) return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(hostEl) === -1) closePanel();
  }, true);

  // ══════════════════════════════════════════════════════════
  //  设置页（新标签页 + DOM 动态构建，无模板字面量嵌套）
  // ══════════════════════════════════════════════════════════

  function openSettingsPage() {
    // Tampermonkey 沙箱隔离下，必须挂在 unsafeWindow（页面真实 window）上，
    // 设置页通过 window.opener 访问的才是同一个对象。
    unsafeWindow.__afhAPI = {
      getData:          getData,
      saveData:         saveData,
      addItem:          addItem,
      editItem:         editItem,
      deleteItem:       deleteItem,
      getCurrentDomain: getCurrentDomain
    };

    var win = window.open('about:blank', '_blank');
    if (!win) {
      alert('AutoFill Helper：请允许此页面打开弹出窗口，然后重试。');
      return;
    }
    win.document.write(buildSettingsHtml());
    win.document.close();
  }

  /* ── 设置页 HTML 骨架（脚本部分全用普通字符串拼接，避免模板字面量嵌套）── */

  function buildSettingsHtml() {
    return '<!DOCTYPE html><html lang="zh-CN"><head>'
      + '<meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>AutoFill Helper \u2014 \u6570\u636e\u7ba1\u7406</title>'
      + '<style>' + buildSettingsStyles() + '</style>'
      + '</head><body>'
      + '<div id="afh-root"></div>'
      + '<script>(function(){'
      + buildSettingsScript()
      + '})();<\/script>'
      + '</body></html>';
  }

  function buildSettingsStyles() {
    return ''
      + '* { box-sizing: border-box; margin: 0; padding: 0; }'
      + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;'
      + '  background: #f3f4f6; color: #111827; min-height: 100vh; }'

      + '.s-hd { background: #4f46e5; color: #fff; padding: 14px 24px;'
      + '  display: flex; align-items: center; gap: 16px; }'
      + '.s-hd-logo { width: 32px; height: 32px; background: rgba(255,255,255,.2);'
      + '  border-radius: 8px; display: flex; align-items: center; justify-content: center;'
      + '  font-size: 16px; flex-shrink: 0; }'
      + '.s-hd h1 { font-size: 17px; font-weight: 700; }'
      + '.s-hd p { font-size: 12px; opacity: .75; margin-top: 2px; }'

      + '.s-wrap { max-width: 880px; margin: 0 auto; padding: 20px 16px; }'

      + '.s-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;'
      + '  margin-bottom: 16px; overflow: hidden; }'
      + '.s-card-hd { padding: 12px 18px; border-bottom: 1px solid #f3f4f6;'
      + '  display: flex; align-items: center; justify-content: space-between; }'
      + '.s-card-title { font-size: 14px; font-weight: 600; color: #374151; }'

      + '.s-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 12px 18px 0; }'
      + '.s-chip { padding: 3px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;'
      + '  border: 1px solid #e5e7eb; background: #fff; color: #6b7280;'
      + '  transition: all .1s; user-select: none; }'
      + '.s-chip:hover { border-color: #a78bfa; color: #6d28d9; }'
      + '.s-chip.active { background: #4f46e5; color: #fff; border-color: #4f46e5; }'

      + '.s-toolbar { padding: 10px 18px; display: flex; gap: 8px;'
      + '  flex-wrap: wrap; align-items: center; }'

      + '.s-table { width: 100%; border-collapse: collapse; }'
      + '.s-table th { padding: 8px 16px; text-align: left; font-size: 11px; font-weight: 700;'
      + '  color: #6b7280; text-transform: uppercase; letter-spacing: .06em;'
      + '  border-bottom: 1px solid #f3f4f6; background: #fafafa; }'
      + '.s-table td { padding: 9px 16px; font-size: 13px;'
      + '  border-bottom: 1px solid #f9fafb; vertical-align: middle; }'
      + '.s-table tbody tr:last-child td { border-bottom: none; }'
      + '.s-table tbody tr:hover td { background: #fafafa; }'

      + '.s-tag { display: inline-block; padding: 1px 8px; border-radius: 999px;'
      + '  font-size: 11px; font-weight: 600; background: #ede9fe; color: #6d28d9; }'
      + '.s-tag.dm { background: #dbeafe; color: #1d4ed8; }'
      + '.s-empty { text-align: center; color: #9ca3af; font-size: 13px; padding: 28px; }'

      + '.s-btn { display: inline-flex; align-items: center; gap: 4px;'
      + '  padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;'
      + '  border: 1px solid #e5e7eb; background: #f9fafb; color: #374151;'
      + '  transition: background .1s; white-space: nowrap; }'
      + '.s-btn:hover { background: #f3f4f6; }'
      + '.s-btn.pri { background: #4f46e5; color: #fff; border-color: #4f46e5; }'
      + '.s-btn.pri:hover { background: #4338ca; }'
      + '.s-btn.danger { color: #dc2626; border-color: #fca5a5; background: #fff; }'
      + '.s-btn.danger:hover { background: #fef2f2; }'

      + '.s-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.4);'
      + '  display: flex; align-items: center; justify-content: center; z-index: 999; }'
      + '.s-modal { background: #fff; border-radius: 10px; width: 440px; max-width: 96vw;'
      + '  box-shadow: 0 20px 60px rgba(0,0,0,.18); }'
      + '.s-modal-hd { padding: 14px 18px; border-bottom: 1px solid #f3f4f6;'
      + '  display: flex; justify-content: space-between; align-items: center; }'
      + '.s-modal-title { font-size: 15px; font-weight: 600; }'
      + '.s-modal-close { background: none; border: none; font-size: 20px; cursor: pointer;'
      + '  color: #9ca3af; line-height: 1; }'
      + '.s-modal-close:hover { color: #111827; }'
      + '.s-modal-body { padding: 18px; }'
      + '.s-modal-ft { padding: 12px 18px; border-top: 1px solid #f3f4f6;'
      + '  display: flex; justify-content: flex-end; gap: 8px; }'

      + '.s-fg { margin-bottom: 12px; }'
      + '.s-fg:last-child { margin-bottom: 0; }'
      + '.s-label { font-size: 13px; font-weight: 500; color: #374151;'
      + '  margin-bottom: 4px; display: block; }'
      + '.s-input { width: 100%; height: 34px; border: 1px solid #e5e7eb;'
      + '  border-radius: 6px; padding: 0 10px; font-size: 13px; outline: none; color: #111827; }'
      + '.s-input:focus { border-color: #4f46e5;'
      + '  box-shadow: 0 0 0 3px rgba(79,70,229,.1); }'
      + '.s-select { width: 100%; height: 34px; border: 1px solid #e5e7eb;'
      + '  border-radius: 6px; padding: 0 10px; font-size: 13px; outline: none;'
      + '  background: #fff; color: #111827; cursor: pointer; }'
      + '.s-select:focus { border-color: #4f46e5; }'

      + '.s-io-box { background: #f9fafb; border-radius: 8px;'
      + '  padding: 14px 18px; margin: 0 18px 16px; }'
      + '.s-io-title { font-size: 11px; font-weight: 700; color: #6b7280;'
      + '  text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }'
      + '.s-textarea { width: 100%; height: 90px; border: 1px solid #e5e7eb;'
      + '  border-radius: 6px; padding: 8px 10px; font-size: 12px;'
      + '  font-family: monospace; outline: none; resize: vertical; color: #111827;'
      + '  background: #fff; }'
      + '.s-textarea:focus { border-color: #4f46e5; }'
      + '.s-io-row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }';
  }

  /* ── 设置页逻辑脚本（全部用普通字符串，零模板字面量）── */
  function buildSettingsScript() {
    /*
     * 这段字符串将被注入到设置页的 <script> 标签内执行。
     * 使用 Unicode 转义书写中文，避免潜在编码问题。
     * 使用 api = window.opener.__afhAPI 访问主窗口的 GM 数据层。
     */
    return ''
      /* 获取 API */
      + 'var api = window.opener && window.opener.__afhAPI;'
      + 'if (!api) {'
      + '  document.getElementById("afh-root").innerHTML'
      + '    = \'<p style="color:#dc2626;padding:40px 24px;text-align:center;font-size:14px">'
      + '\u8bf7\u901a\u8fc7 Tampermonkey \u83dc\u5355\u91cd\u65b0\u6253\u5f00\u6b64\u9875\u9762\u3002</p>\';'
      + '  return;'
      + '}'

      /* 状态 */
      + 'var filter = "all";'

      /* 工具函数 */
      + 'function esc(s) {'
      + '  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")'
      + '    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");'
      + '}'
      + 'function getData()    { return api.getData(); }'
      + 'function getDomains() {'
      + '  return Object.keys(getData()).filter(function(k){ return k !== "global"; });'
      + '}'
      + 'function getAllItems() {'
      + '  var d = getData(); var r = [];'
      + '  Object.keys(d).forEach(function(sc) {'
      + '    d[sc].forEach(function(it) {'
      + '      r.push({ id:it.id, label:it.label, value:it.value,'
      + '               createdAt:it.createdAt, scope:sc });'
      + '    });'
      + '  });'
      + '  return r;'
      + '}'

      /* ── render() ── */
      + 'function render() {'
      + '  var root = document.getElementById("afh-root");'
      + '  root.innerHTML = "";'
      + '  var domains  = getDomains();'
      + '  var allItems = getAllItems();'
      + '  var items = filter === "all" ? allItems'
      + '    : allItems.filter(function(i){ return i.scope === filter; });'

      /* 域名筛选 chip */
      + '  var chips = document.createElement("div");'
      + '  chips.className = "s-chips";'
      + '  var fs = ["all","global"].concat(domains);'
      + '  fs.forEach(function(f) {'
      + '    var c = document.createElement("div");'
      + '    c.className = "s-chip" + (filter === f ? " active" : "");'
      + '    c.textContent = f === "all" ? "\u5168\u90e8"'
      + '      : f === "global" ? "\ud83c\udf10 \u5168\u5c40" : f;'
      + '    c.addEventListener("click", function(){ filter = f; render(); });'
      + '    chips.appendChild(c);'
      + '  });'
      + '  root.appendChild(chips);'

      /* 主卡片 */
      + '  var card = document.createElement("div");'
      + '  card.className = "s-card";'
      + '  card.style.marginTop = "12px";'

      + '  var hd = document.createElement("div");'
      + '  hd.className = "s-card-hd";'
      + '  var ttl = document.createElement("span");'
      + '  ttl.className = "s-card-title";'
      + '  ttl.textContent = "\u6570\u636e\u5217\u8868\uff08" + items.length + " \u6761\uff09";'
      + '  hd.appendChild(ttl);'
      + '  card.appendChild(hd);'

      /* 工具栏 */
      + '  var tb = document.createElement("div");'
      + '  tb.className = "s-toolbar";'
      + '  var ab = document.createElement("button");'
      + '  ab.className = "s-btn pri";'
      + '  ab.textContent = "+ \u65b0\u589e\u6761\u76ee";'
      + '  ab.addEventListener("click", function(){ openModal(null); });'
      + '  tb.appendChild(ab);'
      + '  card.appendChild(tb);'

      /* 空态 / 表格 */
      + '  if (items.length === 0) {'
      + '    var emp = document.createElement("div");'
      + '    emp.className = "s-empty";'
      + '    emp.textContent = "\u6682\u65e0\u6570\u636e";'
      + '    card.appendChild(emp);'
      + '  } else {'
      + '    var tbl = document.createElement("table");'
      + '    tbl.className = "s-table";'
      + '    tbl.innerHTML = "<thead><tr>"'
      + '      + "<th>\u6807\u7b7e</th><th>\u586b\u5165\u5185\u5bb9</th>"'
      + '      + "<th>\u8303\u56f4</th>"'
      + '      + "<th style=\'width:130px\'>\u64cd\u4f5c</th>"'
      + '      + "</tr></thead>";'
      + '    var tbody = document.createElement("tbody");'
      + '    items.forEach(function(item) {'
      + '      var tr   = document.createElement("tr");'
      + '      var tdL  = document.createElement("td");'
      + '      tdL.innerHTML = "<strong>" + esc(item.label) + "</strong>";'
      + '      var tdV  = document.createElement("td");'
      + '      tdV.style.cssText'
      + '        = "max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";'
      + '      tdV.title = item.value; tdV.textContent = item.value;'
      + '      var tdS  = document.createElement("td");'
      + '      tdS.innerHTML = "<span class=\'s-tag"'
      + '        + (item.scope !== "global" ? " dm" : "") + "\'>"'
      + '        + esc(item.scope === "global" ? "\u5168\u5c40" : item.scope)'
      + '        + "</span>";'
      + '      var tdA  = document.createElement("td");'
      + '      var eb   = document.createElement("button");'
      + '      eb.className = "s-btn"; eb.textContent = "\u7f16\u8f91";'
      + '      eb.style.marginRight = "4px";'
      + '      var db   = document.createElement("button");'
      + '      db.className = "s-btn danger"; db.textContent = "\u5220\u9664";'
      + '      (function(it) {'
      + '        eb.addEventListener("click", function(){ openModal(it); });'
      + '        db.addEventListener("click", function() {'
      + '          if (confirm("\u786e\u8ba4\u5220\u9664\u300c"'
      + '              + it.label + "\u300d\uff1f")) {'
      + '            api.deleteItem(it.scope, it.id); render();'
      + '          }'
      + '        });'
      + '      })(item);'
      + '      tdA.appendChild(eb); tdA.appendChild(db);'
      + '      tr.appendChild(tdL); tr.appendChild(tdV);'
      + '      tr.appendChild(tdS); tr.appendChild(tdA);'
      + '      tbody.appendChild(tr);'
      + '    });'
      + '    tbl.appendChild(tbody);'
      + '    card.appendChild(tbl);'
      + '  }'
      + '  root.appendChild(card);'

      /* ── 导入/导出 卡片 ── */
      + '  var ioCard = document.createElement("div");'
      + '  ioCard.className = "s-card";'
      + '  var ioHd  = document.createElement("div");'
      + '  ioHd.className = "s-card-hd";'
      + '  var ioTtl = document.createElement("span");'
      + '  ioTtl.className = "s-card-title";'
      + '  ioTtl.textContent = "\u5bfc\u5165 / \u5bfc\u51fa";'
      + '  ioHd.appendChild(ioTtl); ioCard.appendChild(ioHd);'

      /* 导出 */
      + '  var expBox  = document.createElement("div");'
      + '  expBox.className = "s-io-box";'
      + '  var expTtl  = document.createElement("div");'
      + '  expTtl.className = "s-io-title";'
      + '  expTtl.textContent = "\u5bfc\u51fa JSON";'
      + '  var expTa   = document.createElement("textarea");'
      + '  expTa.className = "s-textarea"; expTa.readOnly = true;'
      + '  expTa.value = JSON.stringify(getData(), null, 2);'
      + '  var cpyBtn  = document.createElement("button");'
      + '  cpyBtn.className = "s-btn";'
      + '  cpyBtn.textContent = "\u590d\u5236";'
      + '  cpyBtn.addEventListener("click", function() {'
      + '    expTa.select(); document.execCommand("copy");'
      + '    cpyBtn.textContent = "\u5df2\u590d\u5236!";'
      + '    setTimeout(function(){ cpyBtn.textContent = "\u590d\u5236"; }, 1500);'
      + '  });'
      + '  var expRow = document.createElement("div");'
      + '  expRow.className = "s-io-row";'
      + '  expRow.appendChild(cpyBtn);'
      + '  expBox.appendChild(expTtl); expBox.appendChild(expTa);'
      + '  expBox.appendChild(expRow); ioCard.appendChild(expBox);'

      /* 导入 */
      + '  var impBox  = document.createElement("div");'
      + '  impBox.className = "s-io-box";'
      + '  var impTtl  = document.createElement("div");'
      + '  impTtl.className = "s-io-title";'
      + '  impTtl.textContent = "\u5bfc\u5165 JSON\uff08\u5c06\u8986\u76d6\u5168\u90e8\u6570\u636e\uff09";'
      + '  var impTa   = document.createElement("textarea");'
      + '  impTa.className = "s-textarea";'
      + '  impTa.placeholder = "\u7c98\u8d34 JSON \u6570\u636e...";'
      + '  var impBtn  = document.createElement("button");'
      + '  impBtn.className = "s-btn pri";'
      + '  impBtn.textContent = "\u5bfc\u5165";'
      + '  impBtn.addEventListener("click", function() {'
      + '    var v = impTa.value.trim();'
      + '    if (!v) return;'
      + '    try {'
      + '      var p = JSON.parse(v);'
      + '      if (typeof p !== "object" || Array.isArray(p)) throw 0;'
      + '      api.saveData(p); render();'
      + '      alert("\u5bfc\u5165\u6210\u529f\uff01");'
      + '    } catch(e) {'
      + '      alert("JSON \u683c\u5f0f\u6709\u8bef\uff0c\u8bf7\u68c0\u67e5\u540e\u91cd\u8bd5\u3002");'
      + '    }'
      + '  });'
      + '  var impRow = document.createElement("div");'
      + '  impRow.className = "s-io-row";'
      + '  impRow.appendChild(impBtn);'
      + '  impBox.appendChild(impTtl); impBox.appendChild(impTa);'
      + '  impBox.appendChild(impRow); ioCard.appendChild(impBox);'
      + '  root.appendChild(ioCard);'
      + '}'  /* end render */

      /* ── openModal(item) ── */
      + 'function openModal(item) {'
      + '  var old = document.getElementById("afh-modal");'
      + '  if (old) old.remove();'
      + '  var isEdit  = !!item;'
      + '  var domains = getDomains();'

      + '  var bg = document.createElement("div");'
      + '  bg.id = "afh-modal"; bg.className = "s-modal-bg";'
      + '  var modal = document.createElement("div");'
      + '  modal.className = "s-modal";'

      /* 头部 */
      + '  var mhd = document.createElement("div");'
      + '  mhd.className = "s-modal-hd";'
      + '  var mt  = document.createElement("span");'
      + '  mt.className = "s-modal-title";'
      + '  mt.textContent = isEdit ? "\u7f16\u8f91\u6761\u76ee" : "\u65b0\u589e\u6761\u76ee";'
      + '  var mc  = document.createElement("button");'
      + '  mc.className = "s-modal-close"; mc.textContent = "\xd7";'
      + '  mc.addEventListener("click", function(){ bg.remove(); });'
      + '  mhd.appendChild(mt); mhd.appendChild(mc); modal.appendChild(mhd);'

      /* 表单体 */
      + '  var mbody = document.createElement("div");'
      + '  mbody.className = "s-modal-body";'
      + '  function mkFg(lbTxt, inputEl) {'
      + '    var g  = document.createElement("div"); g.className = "s-fg";'
      + '    var lb = document.createElement("label"); lb.className = "s-label";'
      + '    lb.textContent = lbTxt;'
      + '    g.appendChild(lb); g.appendChild(inputEl); return g;'
      + '  }'
      + '  var lblIn = document.createElement("input");'
      + '  lblIn.className = "s-input";'
      + '  lblIn.placeholder = "\u5982\uff1a\u59d3\u540d\u3001\u624b\u673a\u53f7\u3001\u6d4b\u8bd5\u8d26\u53f7";'
      + '  lblIn.value = isEdit ? item.label : "";'
      + '  var valIn = document.createElement("input");'
      + '  valIn.className = "s-input";'
      + '  valIn.placeholder = "\u8981\u81ea\u52a8\u586b\u5165\u7684\u5185\u5bb9";'
      + '  valIn.value = isEdit ? item.value : "";'
      + '  var scopeSel = document.createElement("select");'
      + '  scopeSel.className = "s-select";'
      + '  var gOpt = document.createElement("option");'
      + '  gOpt.value = "global";'
      + '  gOpt.textContent = "\u5168\u5c40\uff08\u6240\u6709\u7ad9\u70b9\u53ef\u7528\uff09";'
      + '  scopeSel.appendChild(gOpt);'
      + '  domains.forEach(function(d) {'
      + '    var o = document.createElement("option");'
      + '    o.value = d; o.textContent = d; scopeSel.appendChild(o);'
      + '  });'
      + '  var custOpt = document.createElement("option");'
      + '  custOpt.value = "__custom__";'
      + '  custOpt.textContent = "\u624b\u52a8\u8f93\u5165\u57df\u540d...";'
      + '  scopeSel.appendChild(custOpt);'
      + '  var custG  = document.createElement("div"); custG.className = "s-fg";'
      + '  custG.style.display = "none";'
      + '  var custLb = document.createElement("label"); custLb.className = "s-label";'
      + '  custLb.textContent = "\u81ea\u5b9a\u4e49\u57df\u540d";'
      + '  var custIn = document.createElement("input"); custIn.className = "s-input";'
      + '  custIn.placeholder = "\u5982\uff1a example.com";'
      + '  custG.appendChild(custLb); custG.appendChild(custIn);'
      + '  if (isEdit) {'
      + '    var found = false;'
      + '    for (var i = 0; i < scopeSel.options.length; i++) {'
      + '      if (scopeSel.options[i].value === item.scope) { found = true; break; }'
      + '    }'
      + '    if (!found) {'
      + '      var extraOpt = document.createElement("option");'
      + '      extraOpt.value = item.scope; extraOpt.textContent = item.scope;'
      + '      scopeSel.insertBefore(extraOpt, custOpt);'
      + '    }'
      + '    scopeSel.value = item.scope;'
      + '    scopeSel.disabled = true;'
      + '  }'
      + '  scopeSel.addEventListener("change", function() {'
      + '    custG.style.display = scopeSel.value === "__custom__" ? "" : "none";'
      + '  });'
      + '  mbody.appendChild(mkFg("\u6807\u7b7e", lblIn));'
      + '  mbody.appendChild(mkFg("\u586b\u5165\u5185\u5bb9", valIn));'
      + '  mbody.appendChild(mkFg("\u8303\u56f4", scopeSel));'
      + '  mbody.appendChild(custG);'
      + '  modal.appendChild(mbody);'

      /* 底部按钮 */
      + '  var mft   = document.createElement("div"); mft.className = "s-modal-ft";'
      + '  var cancB = document.createElement("button");'
      + '  cancB.className = "s-btn"; cancB.textContent = "\u53d6\u6d88";'
      + '  cancB.addEventListener("click", function(){ bg.remove(); });'
      + '  var saveB = document.createElement("button");'
      + '  saveB.className = "s-btn pri"; saveB.textContent = "\u4fdd\u5b58";'
      + '  saveB.addEventListener("click", function() {'
      + '    var lv = lblIn.value.trim();'
      + '    var vv = valIn.value.trim();'
      + '    var sv = scopeSel.value;'
      + '    if (sv === "__custom__") sv = custIn.value.trim();'
      + '    if (!lv || !vv || !sv) {'
      + '      alert("\u8bf7\u586b\u5199\u6240\u6709\u5b57\u6bb5\u3002"); return;'
      + '    }'
      + '    if (isEdit) api.editItem(item.scope, item.id, lv, vv);'
      + '    else        api.addItem(sv, lv, vv);'
      + '    bg.remove(); render();'
      + '  });'
      + '  function onEnter(e) { if (e.key === "Enter") saveB.click(); }'
      + '  lblIn.addEventListener("keydown", onEnter);'
      + '  valIn.addEventListener("keydown", onEnter);'
      + '  mft.appendChild(cancB); mft.appendChild(saveB);'
      + '  modal.appendChild(mft);'
      + '  bg.appendChild(modal); document.body.appendChild(bg);'
      + '  bg.addEventListener("click", function(e){ if (e.target === bg) bg.remove(); });'
      + '  setTimeout(function(){ lblIn.focus(); }, 50);'
      + '}'  /* end openModal */

      /* 页面头部 + 初始渲染 */
      + 'var hdrEl = document.createElement("div");'
      + 'hdrEl.className = "s-hd";'
      + 'hdrEl.innerHTML'
      + '  = \'<div class="s-hd-logo">\u{1F4CB}</div>\''
      + '  + \'<div><h1>AutoFill Helper</h1>\''
      + '  + \'<p>\u81ea\u52a8\u586b\u5165\u6570\u636e\u7ba1\u7406</p></div>\';'
      + 'document.body.insertBefore(hdrEl, document.getElementById("afh-root"));'
      + 'var wrapEl = document.getElementById("afh-root");'
      + 'wrapEl.className = "s-wrap";'
      + 'render();';
  }

  // ══════════════════════════════════════════════════════════
  //  Tampermonkey 菜单注册
  // ══════════════════════════════════════════════════════════
  GM_registerMenuCommand('\u81ea\u52a8\u586b\u5165\u7ba1\u7406', openSettingsPage);

})();
