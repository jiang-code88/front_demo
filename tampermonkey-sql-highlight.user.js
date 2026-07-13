// ==UserScript==
// @name         SQL Editor (CodeMirror 6)
// @namespace    https://github.com/sql-highlight
// @version      1.0.0
// @description  使用 CodeMirror 6 为 SQL 工具页面提供语法高亮、自动补全、多 Tab 编辑
// @author       You
// @match        *://vinops.qipeipu.net/operate/sqltools*
// @match        file:///*test-sql-highlight.html
// @include      *test-sql-highlight.html
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

// @match        *://vinops.qipeipu.net/operate/sqltools*  // 匹配目标运维平台
// @match        file:///*test-sql-highlight.html           // 匹配本地测试页
// @include      *test-sql-highlight.html                   // 兜底匹配（Tampermonkey @include 通配）
// @grant        GM_getValue                                // 读取 Tampermonkey 存储
// @grant        GM_setValue                                // 写入 Tampermonkey 存储
// @grant        GM_registerMenuCommand                     // 注册 Tampermonkey 菜单命令
// @grant        unsafeWindow                               // 访问页面真实 window 对象（调用 sqlQPost）
// @run-at       document-idle                              // 文档加载完成后执行

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  //  整体架构说明
  // ════════════════════════════════════════════════════════════════════════
  //
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              用户交互层                          │
  //                     │  ┌─────────────────────────────────────────────┐ │
  //                     │  │  Tab 栏（新增/切换/关闭）                     │ │
  //                     │  ├─────────────────────────────────────────────┤ │
  //                     │  │  CodeMirror 6 编辑器                         │ │
  //                     │  │  • SQL 语法高亮（MySQL 方言）                │ │
  //                     │  │  • 自动补全（关键字/表名）                   │ │
  //                     │  │  • 行号 / 括号匹配 / 代码折叠                 │ │
  //                     │  │  • 暗色主题（One Dark）                      │ │
  //                     │  └─────────────────────────────────────────────┘ │
  //                     └─────────────────────────────────────────────────┘
  //                                          │
  //                                          ▼
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              同步层                              │
  //                     │  • CM6 doc → textarea.value（表单提交保障）     │
  //                     │  • CM6 selection → #select_sql + sqlQPost()    │
  //                     │  • Tab 状态 → GM_setValue（持久化）            │
  //                     └─────────────────────────────────────────────────┘
  //                                          │
  //                                          ▼
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              页面集成层                          │
  //                     │  • 原生 textarea 隐藏保留（表单提交兼容）        │
  //                     │  • onselect="sqlQPost()" 代理调用               │
  //                     │  • MutationObserver SPA 适配                    │
  //                     └─────────────────────────────────────────────────┘
  //
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  //  常量定义
  // ════════════════════════════════════════════════════════════════════════

  // GM 存储键名
  var STORAGE_KEY_TABS = 'sql_editor_tabs';
  var STORAGE_KEY_ENABLED = 'sql_hl_enabled';

  // CM6 模块 URL（esm.sh）
  // 注意：codemirror 元包不能使用 @6 范围，esm.sh 会错误解析为 CM5 代码（6.65.7）
  // 不带版本号时 esm.sh 正确解析到 npm latest（6.0.2，CM6 元包）
  var CM6_URLS = {
    codemirror: 'https://esm.sh/codemirror',
    state: 'https://esm.sh/@codemirror/state@6',
    view: 'https://esm.sh/@codemirror/view@6',
    langSql: 'https://esm.sh/@codemirror/lang-sql@6',
    themeOneDark: 'https://esm.sh/@codemirror/theme-one-dark@6'
  };

  // 编辑器默认高度（与原 textarea 一致）
  var EDITOR_HEIGHT = '250px';

  // ════════════════════════════════════════════════════════════════════════
  //  状态变量
  // ════════════════════════════════════════════════════════════════════════

  var editor = null;          // CodeMirror EditorView 实例
  var textarea = null;        // 原始 textarea 元素（#sql）
  var CM6 = null;             // 加载的 CodeMirror 模块缓存
  var tabs = [];              // Tab 列表 [{ id, name, content, scrollTop }]
  var activeTabId = null;     // 当前激活的 Tab ID
  var nextTabId = 1;          // 下一个 Tab 的 ID（递增不回收）
  var suppressSync = false;   // 阻止同步（切换 Tab 时避免循环触发）
  var tabBarEl = null;        // Tab 栏 DOM 元素
  var wrapperEl = null;       // CM6 wrapper DOM 元素

  // ════════════════════════════════════════════════════════════════════════
  //  CSS 样式注入
  // ════════════════════════════════════════════════════════════════════════

  function injectCSS() {
    if (document.getElementById('cm-sql-styles')) return;

    var style = document.createElement('style');
    style.id = 'cm-sql-styles';
    style.textContent = [
      '/* ── SQL Editor (CodeMirror 6) 样式 ── */',
      '',
      '.cm-sql-wrapper {',
      '  position: relative;',
      '  display: flex;',
      '  flex-direction: column;',
      '  width: 100%;',
      '  height: ' + EDITOR_HEIGHT + ';',
      '  min-height: 80px;',
      '  resize: vertical;',
      '  overflow: hidden;',
      '  border: 1px solid #181a1f;',
      '  border-radius: 4px;',
      '  background: #282c34;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '}',
      '',
      '/* ── Tab 栏 ── */',
      '.cm-tab-bar {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 2px;',
      '  background: #21252b;',
      '  padding: 4px 4px 0 4px;',
      '  border-bottom: 1px solid #181a1f;',
      '  flex: 0 0 auto;',
      '  flex-wrap: wrap;',
      '}',
      '',
      '.cm-tab {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '  padding: 4px 10px;',
      '  background: #2c313a;',
      '  color: #abb2bf;',
      '  border-radius: 4px 4px 0 0;',
      '  cursor: pointer;',
      '  font-size: 13px;',
      '  user-select: none;',
      '  border: 1px solid transparent;',
      '  border-bottom: none;',
      '  white-space: nowrap;',
      '  transition: background 0.15s, color 0.15s;',
      '}',
      '.cm-tab:hover { background: #353b45; color: #d7d7db; }',
      '.cm-tab.active { background: #282c34; color: #fff; border-color: #181a1f; }',
      '',
      '.cm-tab-close {',
      '  border: none;',
      '  background: none;',
      '  color: #5c6370;',
      '  cursor: pointer;',
      '  font-size: 14px;',
      '  padding: 0;',
      '  line-height: 1;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 16px;',
      '  height: 16px;',
      '  border-radius: 2px;',
      '  transition: background 0.15s, color 0.15s;',
      '}',
      '.cm-tab-close:hover { background: #e06c75; color: #fff; }',
      '',
      '.cm-tab-add {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 24px;',
      '  height: 24px;',
      '  background: #2c313a;',
      '  color: #abb2bf;',
      '  border: none;',
      '  border-radius: 4px;',
      '  cursor: pointer;',
      '  font-size: 16px;',
      '  margin-left: 4px;',
      '  flex: 0 0 auto;',
      '  transition: background 0.15s, color 0.15s;',
      '}',
      '.cm-tab-add:hover { background: #353b45; color: #fff; }',
      '',
      '/* ── CM6 编辑器区域 ── */',
      '.cm-sql-wrapper .cm-editor {',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  background: #282c34;',
      '}',
      '.cm-sql-wrapper .cm-editor .cm-scroller { overflow: auto; }',
      '.cm-sql-wrapper .cm-editor .cm-gutters {',
      '  border-right: 1px solid #181a1f;',
      '  background: #282c34;',
      '}',
      '.cm-sql-wrapper .cm-editor.cm-focused { outline: none; }',
      '',
      '/* ── 加载/错误状态 ── */',
      '.cm-loading {',
      '  display: flex;',
      '  flex: 1 1 auto;',
      '  align-items: center;',
      '  justify-content: center;',
      '  color: #abb2bf;',
      '  font-size: 14px;',
      '}',
      '.cm-loading::before {',
      '  content: "";',
      '  width: 16px;',
      '  height: 16px;',
      '  margin-right: 8px;',
      '  border: 2px solid #5c6370;',
      '  border-top-color: #61afef;',
      '  border-radius: 50%;',
      '  animation: cm-spin 0.8s linear infinite;',
      '}',
      '@keyframes cm-spin { to { transform: rotate(360deg); } }',
      '.cm-error {',
      '  display: flex;',
      '  flex: 1 1 auto;',
      '  align-items: center;',
      '  justify-content: center;',
      '  color: #e06c75;',
      '  font-size: 13px;',
      '  padding: 20px;',
      '  text-align: center;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CodeMirror 6 动态加载
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 使用浏览器原生 import() 从 esm.sh 动态加载 CodeMirror 6 ESM 模块。
   *
   * 使用 codemirror 元包（不带 @6 范围，避免 esm.sh 错误解析为 CM5），
   * 元包理论上 re-export 了 EditorView/EditorState/basicSetup/keymap/placeholder 等。
   *
   * 但实测 esm.sh 对该元包的 re-export 解析不稳定，会随机丢失个别具名导出
   * （曾观察到 EditorState 缺失，也观察到 placeholder 缺失，且并非固定的某一个）。
   * 因此对元包里缺失的每一项都单独 fallback 到其原始子包
   * （EditorState → @codemirror/state；keymap/placeholder → @codemirror/view）。
   *
   * 加载的模块：
   * - codemirror (元包 6.0.2): EditorView, basicSetup, keymap, placeholder, EditorState（部分可能缺失）
   * - @codemirror/state / @codemirror/view: 缺失项的兜底来源
   * - @codemirror/lang-sql: sql(), MySQL 方言
   * - @codemirror/theme-one-dark: oneDark 主题
   *
   * 失败场景：网络不通、CSP 阻止 import()、esm.sh 不可访问。
   * 调用方负责 try-catch 并降级为原生 textarea。
   */
  async function loadCM6() {
    var cm = await import(CM6_URLS.codemirror);
    var sqlMod = await import(CM6_URLS.langSql);
    var themeMod = await import(CM6_URLS.themeOneDark);

    // 缓存已加载的兜底子包，避免同一子包被 import() 两次
    var stateMod = null;
    var viewMod = null;

    var EditorState = cm.EditorState;
    if (!EditorState) {
      stateMod = stateMod || await import(CM6_URLS.state);
      EditorState = stateMod.EditorState;
    }

    var keymap = cm.keymap;
    if (!keymap) {
      viewMod = viewMod || await import(CM6_URLS.view);
      keymap = viewMod.keymap;
    }

    var placeholderFn = cm.placeholder;
    if (!placeholderFn) {
      viewMod = viewMod || await import(CM6_URLS.view);
      placeholderFn = viewMod.placeholder;
    }

    return {
      EditorView: cm.EditorView,
      EditorState: EditorState,
      basicSetup: cm.basicSetup,
      keymap: keymap,
      placeholder: placeholderFn,
      sql: sqlMod.sql,
      MySQL: sqlMod.MySQL,
      oneDark: themeMod.oneDark
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Tab 管理
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 创建 Tab 栏 DOM 容器（Tab 标签由 renderTabBar 填充）
   */
  function createTabBar(wrapper) {
    tabBarEl = document.createElement('div');
    tabBarEl.className = 'cm-tab-bar';
    wrapper.appendChild(tabBarEl);
  }

  /**
   * 渲染 Tab 栏：重建所有 Tab 标签 + "+" 按钮
   */
  function renderTabBar() {
    if (!tabBarEl) return;
    tabBarEl.innerHTML = '';

    // 渲染每个 Tab
    tabs.forEach(function (tab) {
      var tabEl = document.createElement('span');
      tabEl.className = 'cm-tab' + (tab.id === activeTabId ? ' active' : '');
      tabEl.dataset.tabId = tab.id;

      // Tab 名称
      var nameEl = document.createElement('span');
      nameEl.textContent = tab.name;
      tabEl.appendChild(nameEl);

      // 关闭按钮
      var closeBtn = document.createElement('button');
      closeBtn.className = 'cm-tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = '关闭此 Tab';
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(tab.id);
      });
      tabEl.appendChild(closeBtn);

      // 点击 Tab 标签（非关闭按钮）切换
      tabEl.addEventListener('click', function (e) {
        if (e.target === closeBtn || closeBtn.contains(e.target)) return;
        switchTab(tab.id);
      });

      tabBarEl.appendChild(tabEl);
    });

    // "+" 按钮（始终在末尾）
    var addBtn = document.createElement('button');
    addBtn.className = 'cm-tab-add';
    addBtn.textContent = '+';
    addBtn.title = '新建 Tab';
    addBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      addTab();
    });
    tabBarEl.appendChild(addBtn);
  }

  /**
   * 获取当前激活的 Tab 对象
   */
  function getActiveTab() {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === activeTabId) return tabs[i];
    }
    return null;
  }

  /**
   * 获取 Tab 在数组中的索引
   */
  function getTabIndex(id) {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === id) return i;
    }
    return -1;
  }

  /**
   * 新增 Tab
   * @param {string} content - 初始内容（可选）
   */
  function addTab(content) {
    // 先保存当前 Tab 状态
    saveCurrentTabState();

    // 创建新 Tab
    var id = nextTabId++;
    var tab = {
      id: id,
      name: 'Query ' + id,
      content: content || '',
      scrollTop: 0
    };
    tabs.push(tab);

    // 切换到新 Tab
    activeTabId = null;
    switchTab(id);

    // 重新渲染 Tab 栏
    renderTabBar();

    // 持久化
    persistTabs();

    console.log('[SQL Editor] 新增 Tab:', tab.name);
  }

  /**
   * 关闭 Tab（至少保留 1 个）
   * @param {number} id - 要关闭的 Tab ID
   */
  function closeTab(id) {
    if (tabs.length <= 1) {
      console.log('[SQL Editor] 至少保留一个 Tab');
      return;
    }

    var idx = getTabIndex(id);
    if (idx === -1) return;

    var wasActive = (id === activeTabId);

    // 从数组中移除
    tabs.splice(idx, 1);

    if (wasActive) {
      // 切换到相邻 Tab（优先同位置，越界则取末尾）
      var newIdx = Math.min(idx, tabs.length - 1);
      var newTab = tabs[newIdx];
      activeTabId = null; // 重置以强制 switchTab 执行加载逻辑
      switchTab(newTab.id);
    }

    renderTabBar();
    persistTabs();

    console.log('[SQL Editor] 关闭 Tab ID:', id);
  }

  /**
   * 切换 Tab
   * @param {number} id - 目标 Tab ID
   */
  function switchTab(id) {
    if (id === activeTabId) return;

    // 保存当前 Tab 的编辑器状态
    saveCurrentTabState();

    // 查找目标 Tab
    var tab = null;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === id) { tab = tabs[i]; break; }
    }
    if (!tab) return;

    activeTabId = id;

    // 加载目标 Tab 内容到编辑器
    loadTabState(tab);

    // 重新渲染 Tab 栏（高亮切换）
    renderTabBar();

    console.log('[SQL Editor] 切换到 Tab:', tab.name);
  }

  /**
   * 保存当前 Tab 的编辑器内容与滚动位置
   */
  function saveCurrentTabState() {
    if (!editor) return;
    var tab = getActiveTab();
    if (!tab) return;

    tab.content = editor.state.doc.toString();

    // 保存滚动位置
    var scroller = editor.dom.querySelector('.cm-scroller');
    if (scroller) {
      tab.scrollTop = scroller.scrollTop;
    }
  }

  /**
   * 将 Tab 的内容加载到编辑器（替换全文 + 恢复滚动位置）
   */
  function loadTabState(tab) {
    if (!editor) return;

    suppressSync = true;

    // 替换编辑器全文内容
    var docLen = editor.state.doc.length;
    editor.dispatch({
      changes: { from: 0, to: docLen, insert: tab.content || '' }
    });

    // 恢复滚动位置
    var scroller = editor.dom.querySelector('.cm-scroller');
    if (scroller && tab.scrollTop) {
      scroller.scrollTop = tab.scrollTop;
    }

    // 同步到 textarea
    syncToTextarea();

    // 清除选区同步（新 Tab 无选区，避免旧 Tab 的选区残留）
    var selectSql = document.getElementById('select_sql');
    if (selectSql) selectSql.value = '';

    suppressSync = false;
  }

  /**
   * 持久化 Tab 数据到 GM 存储
   */
  function persistTabs() {
    saveCurrentTabState();
    try {
      GM_setValue(STORAGE_KEY_TABS, JSON.stringify({
        tabs: tabs,
        nextTabId: nextTabId
      }));
    } catch (e) {
      console.error('[SQL Editor] 持久化 Tab 失败:', e);
    }
  }

  /**
   * 从 GM 存储恢复 Tab 数据
   * 如果没有保存的数据，使用 textarea 现有内容创建默认 Tab
   */
  function restoreTabs() {
    var saved = '';
    try {
      saved = GM_getValue(STORAGE_KEY_TABS, '');
    } catch (e) {
      saved = '';
    }

    if (saved) {
      try {
        var data = JSON.parse(saved);
        if (data.tabs && data.tabs.length > 0) {
          tabs = data.tabs;
          // 恢复 nextTabId（取最大 ID + 1，防止 ID 重复）
          var maxId = 0;
          for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].id > maxId) maxId = tabs[i].id;
          }
          nextTabId = data.nextTabId || (maxId + 1);
          activeTabId = tabs[0].id;
          return;
        }
      } catch (e) {
        console.warn('[SQL Editor] 恢复 Tab 失败:', e);
      }
    }

    // 没有保存的数据：用 textarea 现有内容创建默认 Tab
    var initialContent = textarea ? textarea.value : '';
    tabs = [{
      id: 1,
      name: 'Query 1',
      content: initialContent,
      scrollTop: 0
    }];
    nextTabId = 2;
    activeTabId = 1;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  值与选区同步
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 同步 CM6 编辑器内容到原始 textarea
   * 确保表单提交时 #sql 包含最新内容
   */
  function syncToTextarea() {
    if (!editor || !textarea) return;
    textarea.value = editor.state.doc.toString();
  }

  /**
   * 处理 CM6 选区变化：
   * 1. 更新 #select_sql 隐藏域
   * 2. 调用页面原有 sqlQPost() 函数（如果存在）
   *
   * 这使得页面原有的 "选中 SQL 优先提交" 逻辑在 CM6 下正常工作。
   */
  function handleSelectionChange() {
    if (!editor) return;

    var sel = editor.state.selection.main;
    var selectedText = (sel.from !== sel.to)
      ? editor.state.sliceDoc(sel.from, sel.to)
      : '';

    // 同步选区到 textarea（让 sqlQPost 能正确读取 selectionStart/End）
    try {
      if (textarea) {
        textarea.selectionStart = sel.from;
        textarea.selectionEnd = sel.to;
      }
    } catch (e) {
      // hidden textarea 在某些浏览器可能不支持选区设置，忽略
    }

    // 直接更新 #select_sql 隐藏域（兜底，不依赖 sqlQPost）
    var selectSql = document.getElementById('select_sql');
    if (selectSql) {
      selectSql.value = selectedText;
    }

    // 调用页面原有的 sqlQPost 函数
    try {
      if (typeof unsafeWindow.sqlQPost === 'function') {
        unsafeWindow.sqlQPost();
      }
    } catch (e) {
      // 页面 JS 可能未加载或 sqlQPost 在闭包内，忽略
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Textarea 增强（主函数）
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 增强目标 textarea，替换为 CodeMirror 6 编辑器
   *
   * 流程：
   * 1. 注入 CSS
   * 2. 创建 wrapper 并显示加载状态
   * 3. 隐藏原 textarea（保留在 DOM 中以兼容表单提交）
   * 4. 动态加载 CM6 模块
   * 5. 恢复/创建 Tab 数据
   * 6. 创建 EditorView
   * 7. 绑定同步监听器
   */
  async function enhanceTextarea(ta) {
    textarea = ta;
    textarea.dataset.cmEnhanced = '1';

    // 注入 CSS
    injectCSS();

    // 获取 textarea 的父容器
    var parent = textarea.parentElement;
    if (!parent) {
      console.error('[SQL Editor] textarea 无父容器，无法增强');
      return;
    }

    // 创建 wrapper
    wrapperEl = document.createElement('div');
    wrapperEl.className = 'cm-sql-wrapper';

    // 显示加载状态
    var loadingEl = document.createElement('div');
    loadingEl.className = 'cm-loading';
    loadingEl.textContent = '正在加载 CodeMirror 6 ...';
    wrapperEl.appendChild(loadingEl);

    // 插入 wrapper 到 textarea 之前（textarea 隐藏后 wrapper 占据原位置）
    parent.insertBefore(wrapperEl, textarea);

    // 隐藏原始 textarea（display:none 仍参与表单提交）
    textarea.style.display = 'none';

    // 创建 Tab 栏容器
    createTabBar(wrapperEl);

    // ── 动态加载 CodeMirror 6 ──
    try {
      CM6 = await loadCM6();
    } catch (e) {
      console.error('[SQL Editor] CodeMirror 6 加载失败:', e);
      // 显示错误信息
      loadingEl.className = 'cm-error';
      loadingEl.textContent = 'CodeMirror 6 加载失败: ' + (e.message || e)
        + '\n请检查网络连接或 esm.sh 是否可访问。';
      // 3 秒后恢复原生 textarea
      setTimeout(function () {
        textarea.style.display = '';
        textarea.dataset.cmEnhanced = '';
        if (wrapperEl) {
          wrapperEl.remove();
          wrapperEl = null;
        }
      }, 3000);
      return;
    }

    // 加载成功，验证关键 API 是否存在
    if (!CM6.EditorView || !CM6.EditorState || !CM6.basicSetup || !CM6.keymap || !CM6.placeholder) {
      console.error('[SQL Editor] CM6 模块加载不完整，缺少关键 API:', {
        EditorView: !!CM6.EditorView,
        EditorState: !!CM6.EditorState,
        basicSetup: !!CM6.basicSetup,
        keymap: !!CM6.keymap,
        placeholder: !!CM6.placeholder
      });
      loadingEl.className = 'cm-error';
      loadingEl.textContent = 'CodeMirror 6 模块加载不完整，缺少关键 API。';
      setTimeout(function () {
        textarea.style.display = '';
        textarea.dataset.cmEnhanced = '';
        if (wrapperEl) { wrapperEl.remove(); wrapperEl = null; }
      }, 3000);
      return;
    }

    // 移除加载提示
    loadingEl.remove();

    // 恢复或创建 Tab 数据
    restoreTabs();

    // 渲染 Tab 栏
    renderTabBar();

    // 获取初始内容（来自激活的 Tab 或 textarea 现有值）
    var activeTab = getActiveTab();
    var initialContent = activeTab ? (activeTab.content || '') : (textarea.value || '');

    // ── 创建 CodeMirror 6 编辑器 ──
    var EditorView = CM6.EditorView;
    var EditorState = CM6.EditorState;

    try {
      editor = new EditorView({
        state: EditorState.create({
          doc: initialContent,
          extensions: [
            // 基础设置：行号、括号匹配、代码折叠、光标行高亮、历史记录等
            CM6.basicSetup,

            // SQL 语言支持（MySQL 方言，关键字大写）
            CM6.sql({
              dialect: CM6.MySQL,
              upperCaseKeywords: true
            }),

            // 暗色主题（One Dark）
            CM6.oneDark,

            // Placeholder（复用原 textarea 的 placeholder）
            CM6.placeholder(textarea.placeholder || '请写sql语句...'),

            // 自动换行
            EditorView.lineWrapping,

            // 自定义主题（尺寸与字体适配）
            EditorView.theme({
              '&': {
                height: '100%',
                fontSize: '14px'
              },
              '.cm-scroller': {
                overflow: 'auto',
                fontFamily: '"Fira Code", "Consolas", "Monaco", monospace'
              },
              '.cm-content': {
                fontFamily: '"Fira Code", "Consolas", "Monaco", monospace'
              },
              '&.cm-focused': {
                outline: 'none'
              }
            }),

            // 键盘快捷键
            CM6.keymap.of([
              {
                // Ctrl+Enter / Cmd+Enter：提交表单
                key: 'Ctrl-Enter',
                mac: 'Cmd-Enter',
                run: function () {
                  var btn = document.getElementById('check_submit');
                  if (btn) btn.click();
                  return true;
                }
              },
              {
                // Ctrl+S / Cmd+S：保存 Tab 状态
                key: 'Ctrl-s',
                mac: 'Cmd-s',
                preventDefault: true,
                run: function () {
                  persistTabs();
                  console.log('[SQL Editor] Tab 状态已保存');
                  return true;
                }
              }
            ]),

            // 更新监听器：值与选区同步
            EditorView.updateListener.of(function (update) {
              if (suppressSync) return;
              if (update.docChanged) {
                syncToTextarea();
              }
              if (update.selectionSet) {
                handleSelectionChange();
              }
            })
          ]
        }),
        parent: wrapperEl
      });
    } catch (e) {
      console.error('[SQL Editor] 编辑器创建失败:', e);
      var errEl = document.createElement('div');
      errEl.className = 'cm-error';
      errEl.textContent = '编辑器创建失败: ' + (e.message || e);
      wrapperEl.appendChild(errEl);
      textarea.style.display = '';
      textarea.dataset.cmEnhanced = '';
      return;
    }

    // 初始同步到 textarea
    syncToTextarea();

    // ── 表单提交前同步（捕获阶段，确保最先执行）──
    var form = textarea.closest('form');
    if (form) {
      form.addEventListener('submit', function () {
        saveCurrentTabState();
        syncToTextarea();
      }, true);
    }

    // ── 页面卸载前持久化 Tab ──
    window.addEventListener('beforeunload', function () {
      persistTabs();
    });

    console.log('[SQL Editor] CodeMirror 6 初始化完成');
  }

  // ════════════════════════════════════════════════════════════════════════
  //  GM 菜单命令
  // ════════════════════════════════════════════════════════════════════════

  GM_registerMenuCommand('SQL 高亮：启用/禁用', function () {
    var enabled = !GM_getValue(STORAGE_KEY_ENABLED, true);
    GM_setValue(STORAGE_KEY_ENABLED, enabled);
    console.log('[SQL Editor] ' + (enabled ? '已启用' : '已禁用') + '，刷新页面生效');
    location.reload();
  });

  GM_registerMenuCommand('SQL 高亮：清除 Tab 数据', function () {
    GM_setValue(STORAGE_KEY_TABS, '');
    console.log('[SQL Editor] Tab 数据已清除，刷新页面生效');
    location.reload();
  });

  // ════════════════════════════════════════════════════════════════════════
  //  初始化与 SPA 适配
  // ════════════════════════════════════════════════════════════════════════

  var initTimer = null;

  /**
   * 初始化函数：扫描页面上的 textarea#sql 并增强
   * 使用防抖避免 MutationObserver 频繁触发
   */
  function init() {
    // 检查是否启用（默认启用）
    if (!GM_getValue(STORAGE_KEY_ENABLED, true)) return;

    // 防抖
    if (initTimer) clearTimeout(initTimer);
    initTimer = setTimeout(function () {
      initTimer = null;
      var ta = document.querySelector('textarea#sql');
      if (ta && !ta.dataset.cmEnhanced && !editor) {
        enhanceTextarea(ta);
      }
    }, 100);
  }

  // MutationObserver 监听动态加载（SPA 适配）
  var observer = new MutationObserver(function () {
    init();
  });

  // 延迟启动：等待 DOM 就绪
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    init();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      observer.observe(document.body, { childList: true, subtree: true });
      init();
    });
  }

})();
