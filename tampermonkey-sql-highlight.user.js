// ==UserScript==
// @name         SQL Editor (CodeMirror 6)
// @namespace    https://github.com/sql-highlight
// @version      2.0.0
// @description  使用 CodeMirror 6 为 SQL 工具页面提供语法高亮、自动补全、语法诊断、多 Tab 独立查询
// @author       You
// @match        *://vinops.qipeipu.net/operate/sqltools*
// @match        file:///*test-sql-highlight.html
// @include      *test-sql-highlight.html
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

// @match        *://vinops.qipeipu.net/operate/sqltools*  // 匹配目标运维平台
// @match        file:///*test-sql-highlight.html           // 匹配本地测试页
// @include      *test-sql-highlight.html                   // 兜底匹配（Tampermonkey @include 通配）
// @grant        GM_getValue                                // 读取 Tampermonkey 存储（启用/禁用开关 + Tab 输入状态）
// @grant        GM_setValue                                // 写入 Tampermonkey 存储（启用/禁用开关 + Tab 输入状态）
// @grant        GM_deleteValue                             // 清除已保存的 Tab 输入状态（菜单命令用）
// @grant        GM_registerMenuCommand                     // 注册 Tampermonkey 菜单命令
// @grant        unsafeWindow                               // 访问页面真实 window 对象（调用 sqlQPost）
// @run-at       document-idle                               // 文档加载完成后执行

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  //  整体架构说明
  // ════════════════════════════════════════════════════════════════════════
  //
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              用户交互层                          │
  //                     │  ┌─────────────────────────────────────────────┐ │
  //                     │  │  Tab 栏（新增/切换/关闭/双击重命名）           │ │
  //                     │  ├─────────────────────────────────────────────┤ │
  //                     │  │  CodeMirror 6 编辑器                         │ │
  //                     │  │  • SQL 语法高亮（MySQL 方言）                │ │
  //                     │  │  • 自动补全（关键字 + 当前库表/字段名）       │ │
  //                     │  │  • 语法诊断（真实 MySQL 解析，波浪线+图标）   │ │
  //                     │  │  • 行号 / 括号匹配 / 代码折叠                 │ │
  //                     │  │  • 暗色主题（One Dark）                      │ │
  //                     │  ├─────────────────────────────────────────────┤ │
  //                     │  │  结果面板（每个 Tab 独立保存查询结果）        │ │
  //                     │  └─────────────────────────────────────────────┘ │
  //                     └─────────────────────────────────────────────────┘
  //                                          │
  //                                          ▼
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              同步层                              │
  //                     │  • CM6 doc → textarea.value（表单提交保障）     │
  //                     │  • CM6 selection → #select_sql + sqlQPost()    │
  //                     │  • Tab 切换 → 真实 #db_name/#database_suffix   │
  //                     │  • 提交/分页 → AJAX（不再整页刷新）             │
  //                     └─────────────────────────────────────────────────┘
  //                                          │
  //                                          ▼
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              页面集成层                          │
  //                     │  • 原生 textarea 隐藏保留（导出仍走真实表单）    │
  //                     │  • onselect="sqlQPost()" 代理调用               │
  //                     │  • MutationObserver SPA 适配                    │
  //                     └─────────────────────────────────────────────────┘
  //
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  //  常量定义
  // ════════════════════════════════════════════════════════════════════════

  // GM 存储键名：脚本启用/禁用开关
  var STORAGE_KEY_ENABLED = 'sql_hl_enabled';
  // GM 存储键名：Tab 输入状态（SQL 文本/所选数据库/Tab 名称），不含查询结果
  var STORAGE_KEY_TABS = 'sql_hl_tabs_v1';
  // 持久化写入防抖延迟（打字期间高频触发时降低写入频率）
  var PERSIST_DEBOUNCE_MS = 400;

  // CM6 模块 URL（esm.sh）
  // 注意：codemirror 元包不能使用 @6 范围，esm.sh 会错误解析为 CM5 代码（6.65.7）
  // 不带版本号时 esm.sh 正确解析到 npm latest（6.0.2，CM6 元包）
  var CM6_URLS = {
    codemirror: 'https://esm.sh/codemirror',
    state: 'https://esm.sh/@codemirror/state@6',
    view: 'https://esm.sh/@codemirror/view@6',
    langSql: 'https://esm.sh/@codemirror/lang-sql@6',
    autocomplete: 'https://esm.sh/@codemirror/autocomplete@6',
    themeOneDark: 'https://esm.sh/@codemirror/theme-one-dark@6',
    // SQL 语法诊断：0.x 阶段的包，次版本号也可能有破坏性变更，显式锁定版本号
    sqlLintPkg: 'https://esm.sh/@marimo-team/codemirror-sql@0.3.0',
    // lintGutter() 未被 @marimo-team/codemirror-sql 重新导出，需单独加载
    lint: 'https://esm.sh/@codemirror/lint@6'
  };

  // 编辑器默认高度（与原 textarea 一致）
  var EDITOR_HEIGHT = '250px';

  // ════════════════════════════════════════════════════════════════════════
  //  状态变量
  // ════════════════════════════════════════════════════════════════════════

  var editor = null;          // CodeMirror EditorView 实例
  var textarea = null;        // 原始 textarea 元素（#sql）
  var formEl = null;          // 真实查询表单（QueryToolForm）
  var CM6 = null;             // 加载的 CodeMirror 模块缓存
  var tabs = [];              // Tab 列表
  var activeTabId = null;     // 当前激活的 Tab ID
  var nextTabId = 1;          // 下一个 Tab 的 ID（递增不回收）
  var suppressSync = false;   // 阻止同步（切换 Tab 时避免循环触发）
  var tabBarEl = null;        // Tab 栏 DOM 元素
  var wrapperEl = null;       // CM6 wrapper DOM 元素
  var resultPanelEl = null;   // 结果面板 DOM 元素
  var persistTimer = null;    // Tab 输入状态持久化的防抖定时器
  // "清除已保存的 Tab 数据" 菜单命令触发 reload 前置位：防止 reload 前的
  // beforeunload 兜底持久化把刚清除的存储重新写回去
  var suppressPersistOnUnload = false;

  // 数据库字段/表名补全：以数据库名为 key 缓存 /operate/get_database_tokens 的结果
  var dbTokensCache = new Map();
  // 当前用于补全的数据库名（跟随 #db_name 的值 / Tab 切换同步）
  var completionDbName = '';
  // 关键字扩展口子：CM6 lang-sql 官方关键字源已覆盖标准 MySQL 关键字，这里只留给
  // 以后手动补充"CM6 词表里没有、平台特有"的伪关键字/自定义函数名
  var reserveds = [];

  /**
   * Tampermonkey 默认在隔离的 JS 沙箱环境执行脚本，直接引用的全局 fetch 可能
   * 不是页面实际使用/可能被页面自身覆盖的那个 window.fetch（本地测试页会覆盖
   * window.fetch 来 mock AJAX 响应，如果不走 unsafeWindow.fetch 会打到沙箱自带
   * 的原生 fetch，导致本地测试 mock 不生效）。统一走 unsafeWindow.fetch，行为
   * 与页面里其它脚本发起的请求完全一致（cookie/session 也不受沙箱隔离影响）。
   */
  function doFetch(url, options) {
    var f = (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.fetch)
      ? unsafeWindow.fetch
      : fetch;
    return f(url, options);
  }

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
      '.cm-tab-rename-input {',
      '  font-size: 13px;',
      '  padding: 1px 4px;',
      '  border: 1px solid #61afef;',
      '  border-radius: 2px;',
      '  outline: none;',
      '  width: 84px;',
      '  background: #fff;',
      '  color: #111;',
      '}',
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
      '}',
      '',
      '/* ── 结果面板（位于真实表单之后，跟随页面浅色风格）── */',
      '.cm-result-panel {',
      '  margin-top: 10px;',
      '  border-top: 2px solid lightblue;',
      '  padding-top: 10px;',
      '}',
      '.cm-result-hint {',
      '  color: #666;',
      '  font-size: 13px;',
      '  margin-bottom: 10px;',
      '}',
      '.cm-result-content { min-height: 20px; }',
      '.cm-result-placeholder {',
      '  color: #999;',
      '  font-size: 13px;',
      '  padding: 12px 0;',
      '}',
      '.cm-result-loading {',
      '  color: #3b82c4;',
      '  font-size: 13px;',
      '  padding: 12px 0;',
      '}',
      '.cm-result-warn { color: #b71c1c; font-weight: bold; }',
      '.cm-result-error {',
      '  border: 1px solid #e06c75;',
      '  background: #fdecea;',
      '  border-radius: 4px;',
      '  padding: 12px 16px;',
      '  color: #b71c1c;',
      '}',
      '.cm-result-error-title { font-weight: bold; margin-bottom: 6px; }',
      '.cm-result-error-msg {',
      '  font-family: "Fira Code", "Consolas", "Monaco", monospace;',
      '  font-size: 13px;',
      '  word-break: break-all;',
      '  white-space: pre-wrap;',
      '}',
      '',
      '/* ── 未选择数据库时的临时高亮 ── */',
      '.cm-db-highlight {',
      '  outline: 2px solid #e06c75;',
      '  border-radius: 3px;',
      '}',
      '',
      '/* ── 查询中按钮变为可点击的"取消查询" ── */',
      '.cm-btn-busy {',
      '  background: #f5a623 !important;',
      '  color: #fff !important;',
      '  border-color: #d4881a !important;',
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
   * （EditorState → @codemirror/state；keymap/placeholder/autocompletion → @codemirror/view / @codemirror/autocomplete）。
   *
   * 加载的模块：
   * - codemirror (元包 6.0.2): EditorView, basicSetup, keymap, placeholder, EditorState（部分可能缺失）
   * - @codemirror/state / @codemirror/view: 缺失项的兜底来源
   * - @codemirror/lang-sql: sql(), MySQL 方言, keywordCompletionSource（官方关键字补全源）
   * - @codemirror/autocomplete: autocompletion()（补全框架，多个补全源组合展示）
   * - @codemirror/theme-one-dark: oneDark 主题
   * - @marimo-team/codemirror-sql: sqlExtension()/NodeSqlParser（真实 MySQL 语法诊断，
   *   底层是 node-sql-parser，首次真正跑 lint 时才会懒加载该依赖，不影响初次加载耗时）
   * - @codemirror/lint: lintGutter()（诊断行号栏图标，未被上面的包重新导出，需单独取）
   *
   * 失败场景：网络不通、CSP 阻止 import()、esm.sh 不可访问。
   * 调用方负责 try-catch 并降级为原生 textarea。
   */
  async function loadCM6() {
    var cm = await import(CM6_URLS.codemirror);
    var sqlMod = await import(CM6_URLS.langSql);
    var themeMod = await import(CM6_URLS.themeOneDark);
    var sqlLintMod = await import(CM6_URLS.sqlLintPkg);
    var lintMod = await import(CM6_URLS.lint);

    // 缓存已加载的兜底子包，避免同一子包被 import() 两次
    var stateMod = null;
    var viewMod = null;
    var autocompleteMod = null;

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

    var autocompletionFn = cm.autocompletion;
    if (!autocompletionFn) {
      autocompleteMod = autocompleteMod || await import(CM6_URLS.autocomplete);
      autocompletionFn = autocompleteMod.autocompletion;
    }

    return {
      EditorView: cm.EditorView,
      EditorState: EditorState,
      basicSetup: cm.basicSetup,
      keymap: keymap,
      placeholder: placeholderFn,
      autocompletion: autocompletionFn,
      sql: sqlMod.sql,
      MySQL: sqlMod.MySQL,
      keywordCompletionSource: sqlMod.keywordCompletionSource,
      oneDark: themeMod.oneDark,
      sqlExtension: sqlLintMod.sqlExtension,
      NodeSqlParser: sqlLintMod.NodeSqlParser,
      lintGutter: lintMod.lintGutter
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  数据库字段/表名自动补全（CM6 原生补全，修复 CM6 接管后失效的问题）
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 确保 completionDbName 指向的数据库已拉取过 token 列表（表名/字段名），
   * 命中缓存则直接返回，不重复发请求。
   */
  function ensureDbTokens(dbName) {
    completionDbName = dbName || '';
    if (!completionDbName || dbTokensCache.has(completionDbName)) return;

    var params = new URLSearchParams();
    params.set('database', completionDbName);

    doFetch('/operate/get_database_tokens', {
      method: 'POST',
      body: params,
      credentials: 'same-origin'
    }).then(function (res) {
      return res.json();
    }).then(function (result) {
      if (result && result.status === 0 && Array.isArray(result.data)) {
        dbTokensCache.set(completionDbName, result.data);
      } else {
        dbTokensCache.set(completionDbName, []);
      }
    }).catch(function (e) {
      console.warn('[SQL Editor] 获取数据库字段补全失败:', e);
      dbTokensCache.set(completionDbName, []);
    });
  }

  /**
   * CM6 自定义补全源：只负责"当前所选数据库对应的表/字段名"（以及 reserveds 里
   * 以后手动补充的扩展词），标准 MySQL 关键字交给 keywordCompletionSource 负责。
   *
   * 触发条件与原 jquery.textcomplete 配置保持一致：至少 2 个连续单词字符才触发，
   * Ctrl+Space（context.explicit）强制触发不受此限制。
   */
  function dbTokenCompletionSource(context) {
    var word = context.matchBefore(/\w*/);
    if (!word) return null;
    if (!context.explicit && word.text.length < 2) return null;

    var tokens = reserveds.concat(dbTokensCache.get(completionDbName) || []);
    if (!tokens.length) return null;

    return {
      from: word.from,
      options: tokens.map(function (t) {
        return { label: t, type: 'keyword' };
      }),
      validFor: /^\w*$/
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Tab 输入状态持久化（仅 SQL 文本/所选数据库/Tab 名称，不含查询结果）
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 把 tabs 数组精简为只包含"输入状态"的快照（不含 resultHtml/status/page/
   * errorMsg/requestSeq/abortController 等查询结果与运行态字段），连同
   * activeTabId、nextTabId 一起打包，用于 GM 持久化。
   */
  function serializeTabsSnapshot() {
    return {
      activeTabId: activeTabId,
      nextTabId: nextTabId,
      tabs: tabs.map(function (t) {
        return {
          id: t.id,
          name: t.name,
          customName: t.customName,
          content: t.content,
          dbName: t.dbName,
          databaseSuffix: t.databaseSuffix,
          currentErp: t.currentErp
        };
      })
    };
  }

  /**
   * 立即持久化（低频操作：切换/新建/关闭/重命名 Tab、切换数据库时调用）
   */
  function persistTabsNow() {
    try {
      GM_setValue(STORAGE_KEY_TABS, JSON.stringify(serializeTabsSnapshot()));
    } catch (e) {
      console.warn('[SQL Editor] 持久化 Tab 状态失败:', e);
    }
  }

  /**
   * 防抖持久化（打字期间高频触发，降低写入频率）
   */
  function persistTabsDebounced() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      persistTimer = null;
      persistTabsNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * 尝试从 GM 存储恢复 Tab 输入状态。
   * @returns {boolean} 是否成功恢复（形状校验通过且至少有一个 Tab）
   */
  function tryRestorePersistedTabs() {
    var raw;
    try {
      raw = GM_getValue(STORAGE_KEY_TABS, null);
    } catch (e) {
      return false;
    }
    if (!raw) return false;

    var snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (e) {
      console.warn('[SQL Editor] 已保存的 Tab 数据解析失败，忽略:', e);
      return false;
    }
    if (!snapshot || !Array.isArray(snapshot.tabs) || snapshot.tabs.length === 0) return false;

    var restoredTabs = snapshot.tabs.map(function (t) {
      var tab = createTabData(t.id, t.content || '');
      tab.name = t.name || tab.name;
      tab.customName = !!t.customName;
      tab.dbName = t.dbName || '';
      tab.databaseSuffix = t.databaseSuffix || '';
      tab.currentErp = t.currentErp || '';
      return tab;
    });

    var maxId = restoredTabs.reduce(function (max, t) { return Math.max(max, t.id); }, 0);

    tabs = restoredTabs;
    nextTabId = Math.max(Number(snapshot.nextTabId) || 0, maxId + 1);

    var restoredActiveId = Number(snapshot.activeTabId);
    activeTabId = getTabIndex(restoredActiveId) !== -1 ? restoredActiveId : tabs[0].id;

    return true;
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
      nameEl.addEventListener('dblclick', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startRenameTab(tab, nameEl);
      });
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

      // 点击 Tab 标签（非关闭按钮/重命名输入框）切换
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
   * 双击 Tab 名称重命名：替换为内联输入框，blur/Enter 提交，Escape 取消
   */
  function startRenameTab(tab, nameEl) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'cm-tab-rename-input';
    input.value = tab.name;

    var cancelled = false;

    function commit() {
      if (cancelled) return;
      var val = input.value.trim();
      if (val) {
        tab.name = val;
        tab.customName = true;
      }
      renderTabBar();
      persistTabsNow();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        renderTabBar();
      }
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });

    nameEl.replaceWith(input);
    input.focus();
    input.select();
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
   * 创建一个新 Tab 的默认数据结构
   */
  function createTabData(id, content) {
    return {
      id: id,
      name: 'Query ' + id,
      customName: false,
      content: content || '',
      scrollTop: 0,
      // 与真实查询表单联动的字段（Tab 切换时保存/恢复）
      dbName: '',
      databaseSuffix: '',
      currentErp: '',
      // 查询结果相关字段
      page: 1,
      resultHtml: '',
      errorMsg: null,
      status: 'idle', // idle / loading / done / error / cancelled / session-expired / net-error / no-permission
      requestSeq: 0,  // 竞态防护：每次 submitQuery 自增，响应回来时比对
      abortController: null // 取消查询用：submitQuery 发起时创建，cancelQuery/请求结束后清空
    };
  }

  /**
   * 新增 Tab
   * @param {string} content - 初始内容（可选）
   */
  function addTab(content) {
    // 先保存当前 Tab 状态
    saveCurrentTabState();

    // 创建新 Tab（数据库默认置空，强制用户显式选择数据库，与原页面默认一致）
    var id = nextTabId++;
    var tab = createTabData(id, content);
    tabs.push(tab);

    // 切换到新 Tab
    activeTabId = null;
    switchTab(id);

    // 重新渲染 Tab 栏
    renderTabBar();

    persistTabsNow();

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

    persistTabsNow();

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

    // 加载目标 Tab 内容到编辑器 + 联动真实表单字段 + 刷新结果面板
    loadTabState(tab);

    // 重新渲染 Tab 栏（高亮切换）
    renderTabBar();

    persistTabsNow();

    console.log('[SQL Editor] 切换到 Tab:', tab.name);
  }

  /**
   * 保存当前 Tab 的编辑器内容、滚动位置，以及联动的真实表单字段
   * （#db_name / #database_suffix / #current_erp）
   */
  function saveCurrentTabState() {
    var tab = getActiveTab();
    if (!tab) return;

    if (editor) {
      tab.content = editor.state.doc.toString();

      var scroller = editor.dom.querySelector('.cm-scroller');
      if (scroller) {
        tab.scrollTop = scroller.scrollTop;
      }
    }

    var dbNameEl = document.getElementById('db_name');
    var suffixEl = document.getElementById('database_suffix');
    var erpEl = document.getElementById('current_erp');
    if (dbNameEl) tab.dbName = dbNameEl.value;
    if (suffixEl) tab.databaseSuffix = suffixEl.value;
    if (erpEl) tab.currentErp = erpEl.value;
  }

  /**
   * 将 Tab 的内容加载到编辑器（替换全文 + 恢复滚动位置），并联动：
   * - 真实 #db_name / #database_suffix / #current_erp（触发 change 事件，
   *   让页面自带的 ERP 子库下拉逻辑与我们自己的补全缓存都能正常响应）
   * - 结果面板（渲染该 Tab 保存的查询结果）
   */
  function loadTabState(tab) {
    suppressSync = true;

    if (editor) {
      // 替换编辑器全文内容
      var docLen = editor.state.doc.length;
      editor.dispatch({
        changes: { from: 0, to: docLen, insert: tab.content || '' }
      });

      // 恢复滚动位置
      var scroller = editor.dom.querySelector('.cm-scroller');
      if (scroller) {
        scroller.scrollTop = tab.scrollTop || 0;
      }

      // 同步到 textarea
      syncToTextarea();
    }

    // 清除选区同步（新 Tab 无选区，避免旧 Tab 的选区残留）
    var selectSql = document.getElementById('select_sql');
    if (selectSql) selectSql.value = '';

    // 联动真实的数据库选择（下拉框）
    var dbNameEl = document.getElementById('db_name');
    if (dbNameEl) {
      var targetDbName = tab.dbName || '';
      if (dbNameEl.value !== targetDbName) {
        dbNameEl.value = targetDbName;
        // 触发 change：页面自带的 ERP 子库下拉逻辑会响应，我们自己的补全缓存监听也会响应
        dbNameEl.dispatchEvent(new Event('change'));
      }
      // 无论是否触发了 change，都确保补全缓存指向当前数据库（cache 命中则不会重复请求）
      ensureDbTokens(dbNameEl.value);
    }

    var erpEl = document.getElementById('current_erp');
    if (erpEl) erpEl.value = tab.currentErp || '';

    // 已知次要限制（best-effort）：#database_suffix 的 options 是页面异步拉取填充的，
    // 这里赋值可能在 options 填充完成前落空，仅影响"选了 ERP/erp 且切 Tab 后子库
    // 后缀没有正确恢复"这一边缘场景，先不写等待/监听逻辑
    var suffixEl = document.getElementById('database_suffix');
    if (suffixEl && tab.databaseSuffix) {
      suffixEl.value = tab.databaseSuffix;
    }

    // 刷新结果面板为该 Tab 保存的结果
    renderResultPanel(tab);

    // 同步提交按钮的忙碌态：修复"从正在查询的 Tab 切到空闲 Tab，按钮还残留
    // 着查询中/取消查询文案"的问题
    setSubmitButtonBusy(tab.status === 'loading');

    suppressSync = false;
  }

  /**
   * 恢复 Tab 数据：优先从 GM 持久化存储恢复之前保存的多 Tab 输入状态
   * （SQL 文本/所选数据库/Tab 名称，不含查询结果——刷新后结果留空，需要重新
   * 点提交才能看到，避免展示过期数据）；恢复失败/无数据时，兜底创建 Tab 1：
   * 用当前 textarea 内容 + 当前 #db_name 选中值 +（若页面初次加载即带有结果）
   * 解析出的结果片段。
   */
  function restoreTabs(initialResult) {
    if (tryRestorePersistedTabs()) {
      console.log('[SQL Editor] 已恢复 ' + tabs.length + ' 个保存的 Tab');
      return;
    }

    var dbNameEl = document.getElementById('db_name');
    var suffixEl = document.getElementById('database_suffix');
    var erpEl = document.getElementById('current_erp');

    var tab = createTabData(1, textarea ? textarea.value : '');
    tab.dbName = dbNameEl ? dbNameEl.value : '';
    tab.databaseSuffix = suffixEl ? suffixEl.value : '';
    tab.currentErp = erpEl ? erpEl.value : '';

    if (initialResult) {
      tab.resultHtml = initialResult.html;
      tab.errorMsg = initialResult.errorMsg || null;
      tab.status = initialResult.status;
      tab.page = initialResult.page || 1;
    }

    tabs = [tab];
    nextTabId = 2;
    activeTabId = 1;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  值与选区同步
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 同步 CM6 编辑器内容到原始 textarea
   * 确保表单提交（导出）时 #sql 包含最新内容
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
  //  结果解析（AJAX 响应 / 页面初次加载时已有的结果，共用同一套抓取逻辑）
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 判断一个结果表格是否是报错形状：仅 2 行、每行仅 1 个单元格、
   * 第一行文本正好是 "Error"（对应 sqltools_error.html 的结构）。
   * 命中则返回第二行的错误信息文本，否则返回 null。
   */
  function getErrorMessage(table) {
    var rows = table.querySelectorAll('tr');
    if (rows.length !== 2) return null;
    var c0 = rows[0].querySelectorAll('td');
    var c1 = rows[1].querySelectorAll('td');
    if (c0.length !== 1 || c1.length !== 1) return null;
    if (c0[0].textContent.trim() !== 'Error') return null;
    return c1[0].textContent.trim();
  }

  /**
   * 检测响应 HTML 里是否带有"无权限"提示条（对应 sqltools_no_permission.html
   * 的 `<div class="alert alert-message">`：位于 `.container` 内、`.content`
   * 之外，跟结果表格是完全独立的两块 DOM，且没有权限时表单本身仍会正常渲染，
   * 所以不能靠"有没有结果表格"来判断，必须单独检测这个提示条）。
   * 命中则返回提示文案（已去掉关闭按钮 "×" 的文本），未命中返回 null。
   */
  function getPermissionDeniedMessage(doc) {
    var alertEl = doc.querySelector('.alert.alert-message');
    if (!alertEl) return null;
    var clone = alertEl.cloneNode(true);
    var closeBtn = clone.querySelector('.close');
    if (closeBtn) closeBtn.remove();
    var text = clone.textContent.replace(/\s+/g, ' ').trim();
    return text || '没有权限访问该数据库';
  }

  /**
   * 读取分页器里 #pageindex 输入框的当前页码（解析失败则回退为 1）。
   * 注意："共 N 页" 这段文字不解析（已知会出现 "共 1L页" 这种异常文本）。
   */
  function readPageIndexValue(pagerDiv) {
    var input = pagerDiv.querySelector('#pageindex');
    var n = input ? parseInt(input.value, 10) : 1;
    return isNaN(n) ? 1 : n;
  }

  /**
   * 精确提取结果表格容器（div[style*="overflow"]）与分页器（div.pager）。
   * 找不到 div[style*="overflow"] 时返回 null（由调用方决定如何兜底）。
   */
  function extractResultBlock(contentEl) {
    var overflowDiv = contentEl.querySelector('div[style*="overflow"]');
    if (!overflowDiv) return null;

    var pagerDiv = contentEl.querySelector('div.pager');
    var table = overflowDiv.querySelector('table');
    var errorMsg = table ? getErrorMessage(table) : null;

    return {
      html: overflowDiv.outerHTML + (pagerDiv ? pagerDiv.outerHTML : ''),
      status: errorMsg ? 'error' : 'done',
      errorMsg: errorMsg,
      page: pagerDiv ? readPageIndexValue(pagerDiv) : 1
    };
  }

  /**
   * 兜底：把 form 之后到末尾的所有节点原样拼接为 HTML 字符串
   */
  function collectHtmlAfter(form) {
    var parts = [];
    var node = form ? form.nextSibling : null;
    while (node) {
      if (node.nodeType === 1) {
        parts.push(node.outerHTML);
      } else if (node.nodeType === 3 && node.textContent && node.textContent.trim()) {
        parts.push(node.textContent);
      }
      node = node.nextSibling;
    }
    return parts.join('');
  }

  /**
   * 解析 submitQuery 的 AJAX 响应 HTML，提取结果片段
   * @returns {sessionExpired: true} | {html, status, errorMsg, page}
   */
  function parseSubmitResponse(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var contentEl = doc.querySelector('.content');
    if (!contentEl) {
      return { sessionExpired: true };
    }

    var permissionMsg = getPermissionDeniedMessage(doc);
    if (permissionMsg) {
      return { noPermission: true, errorMsg: permissionMsg };
    }

    var block = extractResultBlock(contentEl);
    if (block) return block;

    // 兜底：找不到 div[style*="overflow"]，把 </form> 之后的内容原样保留
    var form = contentEl.querySelector('form[name="QueryToolForm"]');
    return {
      html: collectHtmlAfter(form),
      status: 'done',
      errorMsg: null,
      page: null
    };
  }

  /**
   * 页面初次加载时，如果 .content 里已经带有结果（比如这是一次真实表单提交后的
   * 整页刷新），提取出来用于播种 Tab 1；没有结果（全新页面）则返回 null。
   */
  function captureInitialResult() {
    var contentEl = document.querySelector('.content');
    if (!contentEl) return null;
    return extractResultBlock(contentEl);
  }

  /**
   * 移除真实表单之后的所有旧节点（分隔线 / "支持操作" 提示段落 / 服务端渲染的
   * 结果表格与分页器），交由 resultPanelEl 统一管理，避免重复展示。
   */
  function clearNodesAfterForm(form) {
    if (!form) return;
    var node = form.nextSibling;
    while (node) {
      var next = node.nextSibling;
      if (node.parentNode) node.parentNode.removeChild(node);
      node = next;
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  结果面板
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 创建结果面板 DOM，插入到真实表单之后（按 DOM 结构关系定位），并在面板上
   * 做一次性事件委托实现分页交互（上一页/下一页/跳转页），不随内容刷新重新绑定。
   */
  function createResultPanel(form) {
    resultPanelEl = document.createElement('div');
    resultPanelEl.className = 'cm-result-panel';
    resultPanelEl.innerHTML =
      '<div class="cm-result-hint">支持操作: select，show, describe(desc)</div>' +
      '<div class="cm-result-content"></div>';
    form.insertAdjacentElement('afterend', resultPanelEl);

    resultPanelEl.addEventListener('click', function (e) {
      var prevLink = e.target.closest('#previousPage');
      var nextLink = e.target.closest('#nextPage');
      if (!prevLink && !nextLink) return;

      e.preventDefault();
      var tab = getActiveTab();
      if (!tab || tab.status === 'loading') return; // 上一次查询/分页还没结束或取消，避免重复请求

      var targetPage = (tab.page || 1) + (prevLink ? -1 : 1);
      if (targetPage < 1) targetPage = 1;
      submitQuery(tab, { page: targetPage });
    });

    resultPanelEl.addEventListener('keypress', function (e) {
      if (e.keyCode !== 13 && e.which !== 13) return;
      var input = e.target.closest('#pageindex');
      if (!input) return;

      e.preventDefault();
      var tab = getActiveTab();
      if (!tab || tab.status === 'loading') return; // 上一次查询/分页还没结束或取消，避免重复请求

      var n = parseInt(input.value, 10);
      if (isNaN(n) || n < 1) n = 1;
      submitQuery(tab, { page: n });
    });
  }

  /**
   * 根据 tab.status / tab.resultHtml 渲染结果面板的动态内容区域
   */
  function renderResultPanel(tab) {
    if (!resultPanelEl) return;
    var contentEl = resultPanelEl.querySelector('.cm-result-content');
    if (!contentEl) return;

    if (!tab) {
      contentEl.innerHTML = '';
      return;
    }

    switch (tab.status) {
      case 'loading':
        contentEl.innerHTML = '<div class="cm-result-loading">查询中...</div>';
        return;
      case 'session-expired':
        contentEl.innerHTML = '<div class="cm-result-placeholder cm-result-warn">会话可能已过期，请手动刷新页面重新登录</div>';
        return;
      case 'net-error':
        contentEl.innerHTML = '<div class="cm-result-placeholder cm-result-warn">' + escapeHtml(tab.errorMsg || '请求失败，请重试') + '</div>';
        return;
      case 'no-permission':
        // 效果与"未选择数据库"提示统一：结果面板内嵌一条红色提示文字，
        // 具体文案取自页面 `.alert-message` 里的真实提示，不写死
        contentEl.innerHTML = '<div class="cm-result-placeholder cm-result-warn">' + escapeHtml(tab.errorMsg || '没有权限访问该数据库') + '</div>';
        return;
      case 'cancelled':
        contentEl.innerHTML = '<div class="cm-result-placeholder">已取消查询，可修改 SQL 后重新提交</div>';
        return;
      case 'error':
        contentEl.innerHTML =
          '<div class="cm-result-error">' +
          '<div class="cm-result-error-title">⚠ 执行出错</div>' +
          '<div class="cm-result-error-msg">' + escapeHtml(tab.errorMsg || '') + '</div>' +
          '</div>';
        return;
      default:
        contentEl.innerHTML = tab.resultHtml
          ? tab.resultHtml
          : '<div class="cm-result-placeholder">尚未查询，输入 SQL 后点击提交</div>';
    }
  }

  /**
   * 提交期间切换真实"提交"按钮的文案与样式（仅影响当前激活 Tab 的展示）。
   * 按钮在查询期间**保持可点击**（不 disable），点击即触发取消——见提交按钮
   * click 绑定处的二态分支，这样才能让用户在长查询等待期间改 SQL 重新提交。
   */
  function setSubmitButtonBusy(busy) {
    var btn = formEl && formEl.querySelector('#check_submit');
    if (!btn) return;

    if (busy) {
      if (btn.dataset.origText === undefined) btn.dataset.origText = btn.textContent;
      btn.textContent = '取消查询';
      btn.classList.add('cm-btn-busy');
    } else {
      if (btn.dataset.origText !== undefined) btn.textContent = btn.dataset.origText;
      btn.classList.remove('cm-btn-busy');
    }
  }

  /**
   * 未选择数据库时的提示：临时高亮 #db_name 下拉框（1.5s 后自动移除）并
   * focus，同时在结果面板内嵌一条红色提示文字。不改变 tab.status/resultHtml
   * ——这只是一次性的操作反馈，不是查询状态，避免污染持久化模型或误导后续渲染。
   */
  function showDbRequiredHint() {
    var dbNameEl = document.getElementById('db_name');
    if (dbNameEl) {
      dbNameEl.classList.add('cm-db-highlight');
      dbNameEl.focus();
      setTimeout(function () {
        dbNameEl.classList.remove('cm-db-highlight');
      }, 1500);
    }

    if (resultPanelEl) {
      var contentEl = resultPanelEl.querySelector('.cm-result-content');
      if (contentEl) {
        contentEl.innerHTML = '<div class="cm-result-placeholder cm-result-warn">请先选择要查询的数据库</div>';
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  AJAX 提交
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 提交查询（新查询或分页），通过 AJAX 提交到 form.action，解析响应后更新
   * 该 Tab 的 resultHtml/page/status；仅当该 Tab 仍是当前激活 Tab 且竞态序号
   * 校验通过时才重新渲染结果区。
   *
   * @param {object} tab - 目标 Tab（始终是触发提交时的当前激活 Tab）
   * @param {object} opts - { page: number }，新查询固定为 1，分页操作递增/指定
   */
  function submitQuery(tab, opts) {
    if (!tab || !formEl) return;
    opts = opts || {};
    var page = opts.page != null ? opts.page : 1;

    // 提交前先把编辑器/真实表单的最新状态落回 tab 模型，避免用户在同一个 Tab 里
    // 改了数据库/SQL 却还没触发过 Tab 切换，导致这里读到的是旧值
    if (tab.id === activeTabId) {
      saveCurrentTabState();
    }

    // 未选择数据库：不发起请求，内嵌提示 + 高亮下拉框。这一处守卫同时覆盖
    // "点击提交"和"分页/跳转页"两条调用路径，不需要在多处重复判断
    if (!tab.dbName) {
      showDbRequiredHint();
      return;
    }

    var seq = ++tab.requestSeq;
    tab.status = 'loading';
    tab.page = page;

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    tab.abortController = controller;

    var isActive = (tab.id === activeTabId);
    if (isActive) {
      renderResultPanel(tab);
      setSubmitButtonBusy(true);
    }

    var params;
    try {
      params = new URLSearchParams(new FormData(formEl));
    } catch (e) {
      params = new URLSearchParams();
    }

    var selectSqlEl = document.getElementById('select_sql');
    params.set('db_name', tab.dbName || '');
    params.set('database_suffix', tab.databaseSuffix || '');
    params.set('sql', tab.content || '');
    params.set('select_sql', selectSqlEl ? selectSqlEl.value : '');
    params.set('current_erp', tab.currentErp || '');
    params.set('page', String(page));

    doFetch(formEl.action, {
      method: 'POST',
      body: params,
      credentials: 'same-origin',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      if (tab.requestSeq !== seq) return; // 竞态：已有更新的请求发出（或已被取消），丢弃本次响应

      var result = parseSubmitResponse(text);
      if (result.sessionExpired) {
        tab.status = 'session-expired';
      } else if (result.noPermission) {
        tab.status = 'no-permission';
        tab.errorMsg = result.errorMsg;
      } else {
        tab.resultHtml = result.html;
        tab.errorMsg = result.errorMsg || null;
        tab.status = result.status;
        if (result.page != null) tab.page = result.page;
      }
    }).catch(function (e) {
      if (tab.requestSeq !== seq) return; // 同上：包含用户主动取消（AbortError）的情形，无需特殊处理
      tab.status = 'net-error';
      tab.errorMsg = '请求失败: ' + (e && e.message ? e.message : e);
    }).then(function () {
      // 用 controller 身份比对而非直接置空：避免这是一次已被取消/竞态淘汰的
      // 旧请求收尾时，误把同一个 tab 上后续新请求刚创建的 abortController 清空
      if (tab.abortController === controller) tab.abortController = null;
      if (tab.requestSeq !== seq) return;
      if (tab.id === activeTabId) {
        renderResultPanel(tab);
        setSubmitButtonBusy(false);
      }
    });
  }

  /**
   * 取消正在等待的查询（长查询不想再等，可立即改 SQL 重新提交）。
   * 只中止前端对本次响应的等待，不保证服务端真的停止执行（没有可用的
   * 服务端 kill-query 接口）。
   */
  function cancelQuery(tab) {
    if (!tab || tab.status !== 'loading') return;

    if (tab.abortController) {
      tab.abortController.abort();
      tab.abortController = null;
    }
    // 让原请求即使之后才 resolve/reject，也会因序号不匹配被 submitQuery 里的
    // 竞态校验丢弃，不需要单独处理 AbortError
    tab.requestSeq++;
    tab.status = 'cancelled';

    if (tab.id === activeTabId) {
      renderResultPanel(tab);
      setSubmitButtonBusy(false);
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
   * 3. 隐藏原 textarea（保留在 DOM 中以兼容表单提交/导出）
   * 4. 动态加载 CM6 模块
   * 5. 捕获页面初次加载时已有的查询结果（如果有），清理旧的结果 DOM，
   *    创建结果面板
   * 6. 恢复/创建 Tab 数据
   * 7. 创建 EditorView
   * 8. 绑定同步监听器、拦截"提交"按钮、绑定分页/数据库切换联动
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

    // 隐藏原始 textarea（display:none 仍参与表单提交，导出按钮依赖它）
    textarea.style.display = 'none';

    // 创建 Tab 栏容器
    createTabBar(wrapperEl);

    formEl = textarea.closest('form');

    // ── 动态加载 CodeMirror 6 ──
    try {
      CM6 = await loadCM6();
    } catch (e) {
      console.error('[SQL Editor] CodeMirror 6 加载失败:', e);
      // 显示错误信息
      loadingEl.className = 'cm-error';
      loadingEl.textContent = 'CodeMirror 6 加载失败: ' + (e.message || e)
        + '\n请检查网络连接或 esm.sh 是否可访问。';
      // 3 秒后恢复原生 textarea（不触碰真实结果区域，原生表单流程完全不受影响）
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
    if (!CM6.EditorView || !CM6.EditorState || !CM6.basicSetup || !CM6.keymap || !CM6.placeholder
      || !CM6.autocompletion || !CM6.keywordCompletionSource
      || !CM6.sqlExtension || !CM6.NodeSqlParser || !CM6.lintGutter) {
      console.error('[SQL Editor] CM6 模块加载不完整，缺少关键 API:', {
        EditorView: !!CM6.EditorView,
        EditorState: !!CM6.EditorState,
        basicSetup: !!CM6.basicSetup,
        keymap: !!CM6.keymap,
        placeholder: !!CM6.placeholder,
        autocompletion: !!CM6.autocompletion,
        keywordCompletionSource: !!CM6.keywordCompletionSource,
        sqlExtension: !!CM6.sqlExtension,
        NodeSqlParser: !!CM6.NodeSqlParser,
        lintGutter: !!CM6.lintGutter
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

    // ── 捕获页面初次加载时已有的结果（如果有），并清理旧的结果 DOM ──
    var initialResult = captureInitialResult();
    clearNodesAfterForm(formEl);
    createResultPanel(formEl);

    // 恢复或创建 Tab 数据
    restoreTabs(initialResult);

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

            // 自动补全：官方关键字源 + 当前数据库的表/字段名源
            // 注意：override 是"完全替换"语义，必须显式带上官方关键字源，
            // 否则只放自定义源会导致关键字补全反而消失
            CM6.autocompletion({
              override: [
                CM6.keywordCompletionSource(CM6.MySQL, true),
                dbTokenCompletionSource
              ]
            }),

            // SQL 语法诊断：真实 MySQL 方言解析（node-sql-parser），只做语法检查，
            // 不启用依赖表结构 schema 的语义检查/hover/跳转（当前 dbTokensCache 是
            // 扁平 token 列表，没有表-字段从属关系，做语义检查容易误报）
            CM6.sqlExtension({
              enableSemanticLinting: false,
              enableHover: false,
              enableNavigation: false,
              enableGutterMarkers: false,
              linterConfig: {
                delay: 500,
                parser: new CM6.NodeSqlParser({
                  getParserOptions: function () {
                    return { database: 'MySQL' };
                  }
                })
              }
            }),

            // 诊断行号栏图标（悬浮可看错误详情）
            CM6.lintGutter(),

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
                // Ctrl+Enter / Cmd+Enter：提交查询
                key: 'Ctrl-Enter',
                mac: 'Cmd-Enter',
                run: function () {
                  var btn = document.getElementById('check_submit');
                  if (btn) btn.click();
                  return true;
                }
              }
            ]),

            // 更新监听器：值与选区同步
            EditorView.updateListener.of(function (update) {
              if (suppressSync) return;
              if (update.docChanged) {
                syncToTextarea();
                // Tab 数据模型里的 content 平时只在切换 Tab 时才更新，必须随
                // 打字实时更新，否则持久化写入的会是滞后的旧内容
                var activeTab = getActiveTab();
                if (activeTab) {
                  activeTab.content = update.state.doc.toString();
                  persistTabsDebounced();
                }
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

    // ── 暴露 AutoFill Helper 适配器（可选协议，见 tampermonkey-autofill.user.js）──
    // 挂载到 .cm-content（浏览器 focus/blur/input 事件实际派发到的节点），
    // 让第三方脚本无需了解 CM6 内部实现即可读写编辑器内容。setRange 走
    // editor.dispatch()，与用户真实输入走同一条状态更新通道，本脚本自身的
    // updateListener（同步 textarea / 持久化 Tab / 触发 lint 等）会自动跟着
    // 触发，不需要额外补发 input/change 事件。
    var cmContentEl = editor.dom.querySelector('.cm-content');
    if (cmContentEl) {
      cmContentEl.__afhAdapter = {
        getValue: function () { return editor.state.doc.toString(); },
        getSelectionStart: function () { return editor.state.selection.main.head; },
        setRange: function (start, end, text) {
          editor.dispatch({
            changes: { from: start, to: end, insert: text },
            selection: { anchor: start + text.length }
          });
        },
        focus: function () { editor.focus(); }
      };
    }

    // ── 拦截"提交"按钮：改为 AJAX 提交，不再整页刷新 ──
    // form 里有重复 id="check_submit"（提交/导出各一个），querySelector 取到的
    // 是第一个即"提交"按钮，与原生 getElementById 行为一致；导出按钮走
    // formaction="sqltools_excel" 单独定位，不受影响、不拦截
    if (formEl) {
      var submitBtn = formEl.querySelector('#check_submit');
      if (submitBtn) {
        submitBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var tab = getActiveTab();
          if (!tab) return;
          // 查询期间该按钮变身为"取消查询"；Ctrl+Enter 内部就是 btn.click()，
          // 所以查询期间按 Ctrl+Enter 也会自动变成取消，行为一致
          if (tab.status === 'loading') {
            cancelQuery(tab);
          } else {
            submitQuery(tab, { page: 1 });
          }
        }, true);
      }
    }

    // ── 数据库切换：更新补全用的 token 缓存（页面自带的 ERP 子库逻辑不受影响）──
    var dbNameEl = document.getElementById('db_name');
    if (dbNameEl) {
      dbNameEl.addEventListener('change', function () {
        ensureDbTokens(this.value);
        // 用户手动切换数据库下拉框：同步进当前 Tab 模型并立即持久化
        var activeTab = getActiveTab();
        if (activeTab) {
          activeTab.dbName = this.value;
          persistTabsNow();
        }
      });
      ensureDbTokens(dbNameEl.value);
    }

    // ── 表单提交前同步（捕获阶段，确保最先执行）──
    // 提交按钮已被上面的拦截逻辑接管，这里主要保障"导出"按钮的真实表单提交
    // 拿到的是最新内容（虽然 syncToTextarea 已经实时同步，这里再兜底一次）
    if (formEl) {
      formEl.addEventListener('submit', function () {
        saveCurrentTabState();
        syncToTextarea();
      }, true);
    }

    // ── 刷新/关闭页面前兜底持久化一次 ──
    // 防抖定时器可能还没触发（比如用户打完字立刻刷新），这里做最后一次同步保存
    window.addEventListener('beforeunload', function () {
      if (suppressPersistOnUnload) return;
      saveCurrentTabState();
      persistTabsNow();
    });

    // 渲染初次加载时（若有）捕获到的查询结果
    renderResultPanel(getActiveTab());

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

  GM_registerMenuCommand('SQL 高亮：清除已保存的 Tab 数据', function () {
    // 先置位，防止即将触发的 beforeunload 兜底持久化把刚清除的存储重新写回去
    suppressPersistOnUnload = true;
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    GM_deleteValue(STORAGE_KEY_TABS);
    console.log('[SQL Editor] 已清除保存的 Tab 数据，刷新页面生效');
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
