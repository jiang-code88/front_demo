// ==UserScript==
// @name         AutoFill Helper
// @namespace    https://github.com/autofill-helper
// @version      1.0.0
// @description  点击表单元素时在旁边出现小图标，点击图标可弹出候选内容列表自动填入，支持按域名管理数据
// @author       You
// @match        *://*/*                // 匹配所有 HTTP/HTTPS 协议的页面
// @match        file:///*              // 匹配本地文件协议
// @grant        GM_getValue            // 读取 Tampermonkey 存储
// @grant        GM_setValue            // 写入 Tampermonkey 存储
// @grant        GM_registerMenuCommand // 注册 Tampermonkey 菜单命令
// @grant        unsafeWindow           // 访问页面真实 window 对象（用于设置页通信）
// @run-at       document-idle          // 文档加载完成后执行
// ==/UserScript==

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  //  整体架构说明
  // ════════════════════════════════════════════════════════════════════════
  // 
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              用户交互层                          │
  //                     │  ┌─────────────┐    ┌─────────────────────────┐ │
  //                     │  │  触发图标    │────▶│    候选面板             │ │
  //                     │  │  (Icon)     │    │  • 搜索过滤             │ │
  //                     │  │  输入框聚焦  │    │  • 全局/域名分组        │ │
  //                     │  │  显示/隐藏   │    │  • 添加/编辑/删除       │ │
  //                     │  └─────────────┘    └─────────────────────────┘ │
  //                     └─────────────────────────────────────────────────┘
  //                                          │
  //                                          ▼
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              数据管理层                          │
  //                     │  ┌─────────────┐    ┌─────────────────────────┐ │
  //                     │  │  Local API  │────▶│   Tampermonkey Storage │ │
  //                     │  │  add/edit/  │    │   GM_getValue/SetValue │ │
  //                     │  │  delete/get │    │   JSON 序列化存储       │ │
  //                     │  └─────────────┘    └─────────────────────────┘ │
  //                     └─────────────────────────────────────────────────┘
  //                                          │
  //                                          ▼
  //                     ┌─────────────────────────────────────────────────┐
  //                     │              数据结构                            │
  //                     │  {                                              │
  //                     │    "global": [ {id, label, value, createdAt} ]  │
  //                     │    "example.com": [ {id, label, value, ...} ]   │
  //                     │  }                                              │
  //                     └─────────────────────────────────────────────────┘
  //
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  //  常量定义
  // ════════════════════════════════════════════════════════════════════════
  var STORAGE_KEY = 'autofill_helper_data';  // 存储键名

  // 匹配的表单输入元素选择器
  // 包含多种 input 类型和 textarea，覆盖绝大多数表单场景
  var INPUT_SELECTOR = [
    'input[type="text"]',       // 文本输入
    'input[type="email"]',      // 邮箱输入
    'input[type="search"]',     // 搜索框
    'input[type="number"]',     // 数字输入
    'input[type="tel"]',        // 电话输入
    'input[type="url"]',        // URL 输入
    'input[type="password"]',   // 密码输入
    'input:not([type])',        // 无 type 属性的 input
    'textarea'                  // 多行文本域
  ].join(',');

  // ════════════════════════════════════════════════════════════════════════
  //  数据读写层（Data Layer）
  //  负责与 Tampermonkey 存储进行交互，提供数据的 CRUD 操作
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 获取所有存储的数据
   * @returns {Object} 数据对象，key 为域名或 'global'，value 为条目数组
   */
  function getData() {
    var raw = GM_getValue(STORAGE_KEY, null);  // 从 TM 存储读取
    if (!raw) return {};                        // 无数据返回空对象
    try { return JSON.parse(raw); } catch (e) { return {}; }  // 解析失败返回空对象
  }

  /**
   * 保存数据到 Tampermonkey 存储
   * @param {Object} data - 要保存的数据对象
   */
  function saveData(data) {
    GM_setValue(STORAGE_KEY, JSON.stringify(data));  // JSON 序列化后存储
  }

  /**
   * 生成唯一 ID
   * 使用时间戳（36进制）+ 随机数（截取6位）组合，保证唯一性
   * @returns {string} 唯一 ID 字符串
   */
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * 获取当前域名的可用条目
   * @param {string} domain - 当前域名
   * @returns {Object} { global: 全局条目数组, domainItems: 当前域名条目数组 }
   */
  function getItemsForDomain(domain) {
    var data = getData();
    return {
      global: data['global'] || [],      // 全局条目（所有站点可用）
      domainItems: data[domain] || []    // 当前域名专属条目
    };
  }

  /**
   * 添加新条目
   * @param {string} scope - 作用域（'global' 或具体域名）
   * @param {string} label - 条目标签（用于显示）
   * @param {string} value - 条目值（实际填入的内容）
   */
  function addItem(scope, label, value) {
    var data = getData();
    if (!data[scope]) data[scope] = [];  // 作用域不存在则创建空数组
    data[scope].push({ 
      id: genId(), 
      label: label, 
      value: value, 
      createdAt: Date.now() 
    });
    saveData(data);
  }

  /**
   * 编辑已有条目
   * @param {string} scope - 作用域
   * @param {string} id - 条目 ID
   * @param {string} label - 新标签
   * @param {string} value - 新值
   */
  function editItem(scope, id, label, value) {
    var data = getData();
    if (!data[scope]) return;  // 作用域不存在则直接返回
    var item = data[scope].find(function (i) { return i.id === id; });
    if (item) { item.label = label; item.value = value; }  // 找到则更新
    saveData(data);
  }

  /**
   * 删除条目
   * @param {string} scope - 作用域
   * @param {string} id - 条目 ID
   */
  function deleteItem(scope, id) {
    var data = getData();
    if (!data[scope]) return;
    data[scope] = data[scope].filter(function (i) { return i.id !== id; });
    if (data[scope].length === 0) delete data[scope];  // 清空后删除空数组
    saveData(data);
  }

  /**
   * 获取当前页面域名
   * @returns {string} 当前域名，默认为 'localhost'
   */
  function getCurrentDomain() {
    /**
     * location 是 JavaScript 中的一个 全局对象 ，它包含了当前页面的 URL 信息
     * location.hostname 返回当前页面的 域名 （不包含协议、端口和路径）
     * - 例如：https://www.example.com 将返回 "www.example.com"
     * - 例如：https://www.baidu.com/search?q=test 将返回 "www.baidu.com"
     * - 例如：http://localhost:8080 将返回 "localhost"
     * - 例如：http://192.168.1.100:3000 将返回 "192.168.1.100"
     * - 如果当前页面没有域名，如本地文件 file:// 或 about:blank，将返回空字符串
     */
    return location.hostname || 'localhost';
    /**
     * JavaScript 的真值（truthy）和假值（falsy）概念
     * - 真值（在布尔上下文中会被转换为 true 的值）：
     *   任何非零、非空、非 null、非 undefined、非 false 的值、非 NaN 的值
     * - 假值（在布尔上下文中会被转换为 false 的值）：
     *   零（0，0n）、空字符串、null、undefined、false、NaN（Not a Number，非数字）
     */
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Shadow DOM — 样式隔离容器
  //  使用 Shadow DOM 确保脚本样式不会与页面样式冲突
  // ════════════════════════════════════════════════════════════════════════

  // 创建宿主元素
  /**
   * document.createElement(tagName): 创建指定标签名的HTML元素
   * - 参数: tagName (string) - 要创建的HTML标签名，如 'div', 'span'
   * - 返回值: 对应类型的DOM元素对象（如 HTMLDivElement）
   * - 注意: 新创建的元素仅存在于内存中，需通过 appendChild() 添加到页面
   * 
   * - (method)：表示这是一个 方法 （函数）
   * - Document.createElement：方法所属的对象和方法名
   * - <"div">：泛型参数 ，表示你传入的标签名是 "div"
   * - (tagName: "div",：参数列表 ，参数名是 tagName，类型是字符串 "div"，含义是标签名
   * - options?: ElementCreationOptions | undefined)：
   *   参数名 options，? 表示这个参数是 可选 的，类型是两种可能的值 ElementCreationOptions 配置对象或 undefined（不传参数时的值）
   * - : HTMLDivElement：返回值类型 ，调用这个方法会返回一个 HTMLDivElement 对象
   * - (+2 overloads)：表示这个方法还有 两种重载形式 （不同的参数组合）
   * 
   * - : 后面的内容 表示 类型 （如 : string 表示字符串类型）
   * - ? 表示 可选 （参数可传可不传）
   * - | 表示 或 （如 A | B 表示可以是 A 类型或 B 类型）
   * - <> 表示 泛型 （用来指定更具体的类型）
   * - (+N overloads) 表示有 N 种重载形式 （不同的参数组合）
   * 
   * 阅读顺序建议：先看方法名 → 再看返回值类型 → 最后看参数列表 → 重载信息
   */
  var hostEl = document.createElement('div');
  hostEl.id = '__afh_host__';  // 唯一 ID 标识
  // 定位样式：fixed 定位，左上角，宽高为 0（仅作为 Shadow DOM 容器）
  Object.assign(hostEl.style, {
    position: 'fixed',          // 固定定位：相对于视口，滚动时位置不变
    top: '0', left: '0',        // 定位到左上角，提供稳定的定位基准
    width: '0', height: '0',    // 宽高为 0，容器不可见，确保容器本身不占用空间
    overflow: 'visible',        // 允许子元素溢出显示，子元素可以显示在容器外
    zIndex: '2147483647',       // 最大 z-index 层级，内容始终在最顶层，确保内容不被遮挡
    pointerEvents: 'none'       // 默认不接收鼠标事件，让鼠标事件穿透到下面的页面内容，不影响用户正常操作
  });
  /**
   * 上述代码执行后 hostEl 的 HTML 结构：
   * <div id="__afh_host__" 
   *  style="position: fixed; top: 0; left: 0; width: 0; height: 0; 
   *         overflow: visible; z-index: 2147483647; pointer-events: none;">
   * </div>
   */
  document.body.appendChild(hostEl);

  // 创建 Shadow DOM（open 模式允许外部访问）
  /**
   * hostEl.attachShadow({ mode: 'open' }): 创建一个 Shadow DOM 容器
   * - 参数: { mode: 'open' } - 模式为 open，外部 JavaScript 可以通过 element.shadowRoot 访问 Shadow DOM
   * - 返回值: ShadowRoot 对象，用于操作 Shadow DOM 内容
   * 
   * ┌─────────────────────────────────────────────────────────┐
   * │                     主页面 DOM                           │
   * │                                                         │
   * │  <div id="__afh_host__">           ← 普通 DOM 元素       │
   * │    #shadow-root (open)             ← Shadow DOM 入口     │
   * │      ├── <style>...</style>                ← 隔离的样式   │
   * │      ├── <div class="afh-icon">...</div>   ← 隔离的内容   │
   * │      └── <div class="afh-panel">...</div>  ← 隔离的内容   │
   * │ </div>                                                  │
   * │                                                         │
   * │  其他页面元素...                                          │
   * └─────────────────────────────────────────────────────────┘
   * - Shadow DOM 内部的 CSS 样式 不会影响 外部页面，外部页面的样式也 不会影响 内部的 CSS 样式。
   * - Shadow DOM 内部的元素 不会被直接访问，只能通过 ShadowRoot 接口操作。
   * - Shadow DOM 可以将复杂的 UI 组件封装在独立的 Shadow DOM 中。
   */
  var shadow = hostEl.attachShadow({ mode: 'open' });

  // 创建样式元素并注入所有样式
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    /* ──────────────────────────────────────────────────────────────── */
    /* 全局重置样式 */
    /* ──────────────────────────────────────────────────────────────── */
    '*, *::before, *::after {',
    '  box-sizing: border-box;',  /* 盒模型：宽高包含 padding 和 border */
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 触发图标样式 (点击输入框时出现的小图标) */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-icon {',
    '  position: fixed;',        /* 固定定位：相对于视口，滚动时位置不变 */
    '  width: 22px;',            /* 宽度 22px */
    '  height: 22px;',           /* 高度 22px */
    '  background: #4f46e5;',    /* 背景色：紫色（主色调）*/
    '  border-radius: 5px;',     /* 圆角：5px，让图标呈圆角方形 */
    '  cursor: pointer;',        /* 鼠标样式：手型，提示可点击 */
    '  pointer-events: all;',    /* 鼠标事件：允许接收点击等事件 */
    '  display: flex;',          /* Flex 布局：子元素可灵活排列 */
    '  align-items: center;',    /* 垂直居中：子元素在垂直方向居中 */
    '  justify-content: center;',/* 水平居中：子元素在水平方向居中 */
    '  opacity: 0.82;',         /* 透明度：82%，稍微有点透明 */
    '  transition: opacity .15s, transform .1s;',  /* 过渡动画：透明度和缩放变化时平滑过渡 */
    '  user-select: none;',      /* 用户选择：禁止选中图标 */
    '}',
    '.afh-icon:hover {',
    '  opacity: 1;',             /* hover 时：完全不透明 */
    '  transform: scale(1.08);', /* hover 时：放大到 108% */
    '}',
    '.afh-icon svg {',
    '  width: 12px;',            /* SVG 图标宽度 */
    '  height: 12px;',           /* SVG 图标高度 */
    '  fill: #fff;',             /* SVG 填充颜色：白色 */
    '  pointer-events: none;',   /* SVG 不接收鼠标事件（点击穿透）*/
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 候选面板样式 (点击图标后弹出的面板) */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-panel {',
    '  position: fixed;',        /* 固定定位 */
    '  width: 300px;',           /* 面板宽度 300px */
    '  max-height: 400px;',      /* 最大高度 400px（超过则滚动）*/
    '  background: #fff;',       /* 背景色：白色 */
    '  border: 1px solid #e5e7eb;',  /* 边框：1px 灰色实线 */
    '  border-radius: 10px;',    /* 圆角：10px */
    '  box-shadow: 0 8px 30px rgba(0,0,0,.13), 0 2px 8px rgba(0,0,0,.06);',
                                 /* 阴影：两层阴影，外层柔和，内层清晰 */
    '  pointer-events: all;',    /* 允许接收鼠标事件 */
    '  display: flex;',          /* Flex 布局 */
    '  flex-direction: column;', /* 子元素垂直排列 */
    '  overflow: hidden;',       /* 超出部分隐藏（配合圆角）*/
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
                                 /* 字体：系统字体，适配不同平台 */
    '  font-size: 13px;',        /* 字体大小 */
    '  color: #111827;',         /* 文字颜色：深灰色 */
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 顶部搜索栏 */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-head {',
    '  display: flex;',          /* Flex 布局 */
    '  align-items: center;',    /* 垂直居中 */
    '  gap: 6px;',               /* 子元素间距 6px */
    '  padding: 8px 10px;',      /* 内边距：上下 8px，左右 10px */
    '  border-bottom: 1px solid #f3f4f6;',  /* 底部边框：浅灰色 */
    '  flex-shrink: 0;',         /* 不允许缩小 */
    '}',
    '.afh-search {',
    '  flex: 1;',                /* 占据剩余空间 */
    '  height: 28px;',           /* 高度 */
    '  border: 1px solid #e5e7eb;', /* 边框 */
    '  border-radius: 6px;',     /* 圆角 */
    '  padding: 0 8px;',         /* 水平内边距 */
    '  font-size: 12px;',        /* 字体大小 */
    '  outline: none;',          /* 移除默认聚焦轮廓 */
    '  color: #111827;',         /* 文字颜色 */
    '  background: #f9fafb;',    /* 背景色：浅灰 */
    '}',
    '.afh-search:focus {',
    '  border-color: #4f46e5;',  /* 聚焦时边框变紫色 */
    '  background: #fff;',       /* 聚焦时背景变白 */
    '}',
    '.afh-xbtn {',               /* 关闭按钮 */
    '  width: 22px;',
    '  height: 22px;',
    '  border: none;',           /* 无边框 */
    '  background: none;',       /* 无背景 */
    '  cursor: pointer;',        /* 手型鼠标 */
    '  border-radius: 4px;',     /* 圆角 */
    '  color: #9ca3af;',         /* 灰色 */
    '  font-size: 16px;',
    '  line-height: 1;',         /* 行高等于字号，垂直居中 */
    '  padding: 0;',             /* 无内边距 */
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '}',
    '.afh-xbtn:hover {',
    '  background: #f3f4f6;',    /* hover 时浅灰背景 */
    '  color: #374151;',         /* hover 时深灰文字 */
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 列表区 */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-list {',
    '  flex: 1;',                /* 占据剩余空间 */
    '  overflow-y: auto;',       /* 垂直方向超出时滚动 */
    '  padding: 4px 0;',         /* 上下内边距 */
    '}',
    '.afh-list::-webkit-scrollbar {',  /* 自定义滚动条宽度 */
    '  width: 4px;',
    '}',
    '.afh-list::-webkit-scrollbar-thumb {',  /* 自定义滚动条滑块 */
    '  background: #e5e7eb;',    /* 滑块颜色 */
    '  border-radius: 2px;',     /* 滑块圆角 */
    '}',
    '.afh-glabel {',             /* 分组标签（如"全局"、"当前站点"）*/
    '  font-size: 10px;',
    '  font-weight: 700;',       /* 粗体 */
    '  color: #9ca3af;',         /* 灰色 */
    '  text-transform: uppercase;', /* 转大写 */
    '  letter-spacing: .08em;',  /* 字母间距 */
    '  padding: 6px 10px 3px;',  /* 内边距 */
    '}',
    '.afh-divider {',            /* 分隔线 */
    '  height: 1px;',            /* 高度 1px（水平线）*/
    '  background: #f3f4f6;',    /* 浅灰色 */
    '  margin: 3px 10px;',       /* 上下边距 3px，左右 10px */
    '}',
    '.afh-empty {',              /* 空状态 */
    '  text-align: center;',     /* 文字居中 */
    '  color: #9ca3af;',         /* 灰色 */
    '  font-size: 12px;',
    '  padding: 18px 10px;',     /* 内边距 */
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 条目行 */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-item {',               /* 每个候选条目 */
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',               /* 内容和操作按钮间距 */
    '  padding: 6px 10px;',      /* 内边距 */
    '  cursor: pointer;',        /* 手型鼠标 */
    '  transition: background .08s;',  /* 背景变化过渡 */
    '}',
    '.afh-item:hover {',
    '  background: #f5f3ff;',    /* hover 时浅紫色背景 */
    '}',
    '.afh-item-info {',          /* 条目信息区 */
    '  flex: 1;',                /* 占据剩余空间 */
    '  min-width: 0;',           /* 允许缩小到 0（防止溢出）*/
    '}',
    '.afh-item-lbl {',           /* 条目标签 */
    '  font-size: 10px;',
    '  color: #a78bfa;',         /* 紫色 */
    '  font-weight: 600;',       /* 半粗体 */
    '  margin-bottom: 1px;',     /* 与下方内容间距 */
    '}',
    '.afh-item-val {',           /* 条目值 */
    '  font-size: 12px;',
    '  color: #1f2937;',         /* 深灰色 */
    '  white-space: nowrap;',    /* 不换行 */
    '  overflow: hidden;',       /* 超出隐藏 */
    '  text-overflow: ellipsis;',/* 超出显示省略号 */
    '}',
    '.afh-item-acts {',          /* 操作按钮区 */
    '  display: none;',          /* 默认隐藏 */
    '  gap: 2px;',               /* 按钮间距 */
    '}',
    '.afh-item:hover .afh-item-acts {',
    '  display: flex;',          /* hover 时显示 */
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 条目操作按钮（编辑/删除）*/
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-abtn {',
    '  width: 20px;',
    '  height: 20px;',
    '  border: none;',
    '  background: none;',
    '  cursor: pointer;',
    '  border-radius: 3px;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  color: #9ca3af;',         /* 默认灰色 */
    '  padding: 0;',
    '}',
    '.afh-abtn:hover {',
    '  background: #ede9fe;',    /* hover 浅紫背景 */
    '  color: #6d28d9;',         /* hover 深紫文字 */
    '}',
    '.afh-abtn.del:hover {',     /* 删除按钮特殊样式 */
    '  background: #fee2e2;',    /* 浅红背景 */
    '  color: #dc2626;',         /* 红色文字 */
    '}',
    '.afh-abtn svg {',
    '  width: 11px;',
    '  height: 11px;',
    '  fill: currentColor;',     /* 继承父元素颜色 */
    '  pointer-events: none;',
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 底部工具栏 */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-foot {',
    '  flex-shrink: 0;',         /* 不允许缩小 */
    '  padding: 7px 10px;',      /* 内边距 */
    '  border-top: 1px solid #f3f4f6;',  /* 顶部边框 */
    '  display: flex;',
    '  gap: 6px;',               /* 按钮间距 */
    '}',
    '.afh-fbtn {',               /* 底部按钮 */
    '  flex: 1;',                /* 平分空间 */
    '  height: 26px;',           /* 高度 */
    '  border-radius: 6px;',     /* 圆角 */
    '  border: 1px solid #e5e7eb;', /* 边框 */
    '  background: #f9fafb;',    /* 浅灰背景 */
    '  font-size: 11px;',        /* 小号字体 */
    '  cursor: pointer;',
    '  color: #374151;',         /* 深灰色文字 */
    '  transition: background .1s;',
    '}',
    '.afh-fbtn:hover {',
    '  background: #f3f4f6;',    /* hover 背景变深一点 */
    '}',
    '.afh-fbtn.pri {',           /* 主按钮（紫色）*/
    '  background: #4f46e5;',    /* 紫色背景 */
    '  color: #fff;',            /* 白色文字 */
    '  border-color: #4f46e5;',  /* 紫色边框 */
    '}',
    '.afh-fbtn.pri:hover {',
    '  background: #4338ca;',    /* hover 时紫色变深 */
    '}',

    /* ──────────────────────────────────────────────────────────────── */
    /* 内联添加/编辑表单 */
    /* ──────────────────────────────────────────────────────────────── */
    '.afh-form {',
    '  flex-shrink: 0;',
    '  padding: 8px 10px;',
    '  border-top: 1px solid #f3f4f6;',
    '  background: #fafafa;',    /* 浅灰背景 */
    '  display: flex;',
    '  flex-direction: column;', /* 垂直排列 */
    '  gap: 5px;',               /* 表单元素间距 */
    '}',
    '.afh-finput {',             /* 表单输入框 */
    '  width: 100%;',            /* 宽度 100% */
    '  height: 27px;',
    '  border: 1px solid #e5e7eb;',
    '  border-radius: 5px;',
    '  padding: 0 8px;',         /* 水平内边距 */
    '  font-size: 12px;',
    '  outline: none;',          /* 移除默认聚焦框 */
    '  color: #111827;',
    '  background: #fff;',
    '}',
    '.afh-finput:focus {',
    '  border-color: #4f46e5;',  /* 聚焦时紫色边框 */
    '}',
    '.afh-frow {',               /* 表单行 */
    '  display: flex;',
    '  gap: 5px;',
    '}',
    '.afh-fsel {',               /* 表单选择框 */
    '  height: 27px;',
    '  border: 1px solid #e5e7eb;',
    '  border-radius: 5px;',
    '  padding: 0 6px;',
    '  font-size: 11px;',
    '  outline: none;',
    '  color: #111827;',
    '  background: #fff;',
    '  cursor: pointer;',
    '}',
    '.afh-fsel:focus {',
    '  border-color: #4f46e5;',
    '}',
  ].join('\n');
  shadow.appendChild(styleEl);

  // ════════════════════════════════════════════════════════════════════════
  //  SVG 图标定义
  //  使用内联 SVG，无需外部资源
  // ════════════════════════════════════════════════════════════════════════

  // 粘贴图标
  var ICON_PASTE = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M8 2a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>'
    + '<path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2'
    + ' 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>';  

  // 编辑图标
  var ICON_EDIT = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/>'
    + '<path d="M11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>'; 
     
  // 删除图标
  var ICON_DEL = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
    + '<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10'
    + 'a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9z'
    + 'M7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 112 0v6a1 1 0 11-2 0V8z"'
    + ' clip-rule="evenodd"/></svg>';

  // ════════════════════════════════════════════════════════════════════════
  //  状态管理
  // ════════════════════════════════════════════════════════════════════════

  var activeInput = null;   // 当前聚焦的输入框元素
  var iconEl     = null;    // 触发图标 DOM 元素
  var panelEl    = null;    // 候选面板 DOM 元素
  var hideTimer  = null;    // 图标隐藏延迟定时器

  // ════════════════════════════════════════════════════════════════════════
  //  触发图标模块（Trigger Icon Module）
  //  负责图标的创建、定位、显示、隐藏
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 确保图标元素存在（懒创建）
   */
  function ensureIcon() {
    if (iconEl) return;  // 已存在则直接返回
    iconEl = document.createElement('div');
    iconEl.className = 'afh-icon';
    iconEl.innerHTML = ICON_PASTE;
    iconEl.title = 'AutoFill Helper（点击填入）';
    iconEl.style.display = 'none';  // 默认隐藏
    shadow.appendChild(iconEl);
    
    // 点击图标事件：切换面板显示/隐藏
    // mousedown：鼠标按下瞬间触发（更早）, click：按下并抬起（更晚）
    // 用 mousedown 比 click 更合适，原因是“要抢在页面默认行为和外部监听之前处理”
    // 例如你点了图标，不希望页面默认行为和外部监听器也被触发
    iconEl.addEventListener('mousedown', function (e) {
      // 先阻止默认行为（例如按下导致选中文本、焦点变化引发的副作用等）
      e.preventDefault();
      // 阻止事件传播，防止事件冒泡到父元素，
      // 例如你点了图标，不希望页面外层容器、document 上的点击监听器也被触发
      e.stopPropagation();  
      if (panelEl) closePanel();        // 面板已打开则关闭
      else if (activeInput) openPanel(activeInput);  // 否则打开面板
    });
  }

  /**
   * 定位图标到输入框旁边
   * @param {HTMLElement} el - 输入框元素
   */
  function positionIcon(el) {
    if (!iconEl) return;
    var r = el.getBoundingClientRect();  // 获取输入框位置信息
    var sz = 22, gap = 4;
    // 图标放在输入框内部右侧，留出一点空隙
    var left = r.right - sz - gap;
    var top  = r.top + (r.height - sz) / 2;  // 垂直居中
    
    // 边界检测：确保图标在可视区域内
    if (left < 4) left = 4;
    if (top < 2)  top  = 2;
    if (top + sz > window.innerHeight - 2) top = window.innerHeight - sz - 2;
    
    iconEl.style.left = left + 'px';
    iconEl.style.top  = top  + 'px';
  }

  /**
   * 显示图标
   * @param {HTMLElement} el - 输入框元素
   */
  function showIcon(el) {
    clearTimeout(hideTimer);  // 清除之前的隐藏定时器
    ensureIcon();
    activeInput = el;         // 记录当前活动输入框
    positionIcon(el);
    iconEl.style.display = 'flex';
  }

  /**
   * 延迟隐藏图标（250ms 后隐藏）
   * 使用延迟是为了处理快速切换输入框的场景
   */
  function scheduleHideIcon() {
    hideTimer = setTimeout(function () {
      if (iconEl && !panelEl) iconEl.style.display = 'none';  // 面板未打开才隐藏
    }, 250);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  事件监听注册
  // ════════════════════════════════════════════════════════════════════════

  // 监听输入框聚焦（使用 capture 模式确保最早捕获）
  /**
   * - 用户在页面上操作时，脚本需要知道用户什么时候聚焦到输入框
   * - 通过监听 focusin 事件，可以实时响应用户的操作
   * - 只有当聚焦的是匹配的输入框时，才显示自动填充图标
   * - 如果页面有多个匹配的输入框，当用户聚焦到任意一个时，都会显示图标
   * 
   * 工作流程：
   *  用户点击输入框
   *        │
   *        ▼
   *  触发 focusin 事件
   *        │
   *        ▼
   *  事件从 document 开始捕获传播
   *        │
   *        ▼
   *  检查 e.target 是否匹配 INPUT_SELECTOR
   *        │
   *        ├── 匹配 → 调用 showIcon() 显示图标
   *        │
   *        └── 不匹配 → 什么都不做
   * 
   * - document 监听整个文档
   * - addEventListener 添加事件监听的方法
   * - 'focusin' 事件类型：元素获得焦点时触发（支持冒泡，通过事件委托，页面上所有输入框聚焦时都能触发）
   * - function (e) {...} 事件处理函数（回调函数）
   * - true 表示在 捕获阶段 触发事件处理，默认 false 在 冒泡阶段 触发事件处理
   * 
   * - e 是 事件对象 ，包含了事件的所有信息
   * - e.target 触发事件的 具体元素 （即用户聚焦的输入框）
   * - e.target.matches(INPUT_SELECTOR) 检查触发事件的元素是否匹配指定的选择器
   * 
   * 事件传播有三个阶段：
   *  1. 捕获阶段 （从外到内）
   *  2. 目标阶段 （到达目标元素）
   *  3. 冒泡阶段 （从内到外）
   * 当用户点击 input 时，事件的传播就像 声音的传播 一样：
   *  1）捕获阶段（Capture Phase）
   *    - 事件从外向内传递，先触发父元素的事件处理函数，再触发子元素的事件处理函数，
   *      事件从 document 开始，逐级向下传到目标元素
   *    - 优先响应：捕获阶段比冒泡阶段先执行，确保脚本的监听器 优先于 页面其他脚本响应事件
   *    - 防止被阻止：有些页面脚本会在冒泡阶段调用 e.stopPropagation() 阻止事件传播，
   *      如果脚本在冒泡阶段监听，可能无法收到事件
   *  2）目标阶段（Target Phase）
   *    - 事件到达目标元素，触发目标元素的事件处理函数
   *  3）冒泡阶段（Bubbling Phase）
   *    - 事件从内向外传递，先触发子元素的事件处理函数，再触发父元素的事件处理函数，
   *      事件从目标元素逐级向上传回 document
   * 
   * (method)： 这是一个方法
   * Document.addEventListener：方法所属的对象和方法名
   * <"focusin">：泛型参数 ，表示你传入的事件类型是 "focusin"
   * (type: "focusin",：
   *   参数名 type，类型是字符串 "focusin" （表示事件类型），含义：指定要监听的事件名称
   * listener: (this: Document, ev: FocusEvent) => any,：
   *   参数名 listener （事件监听器/回调函数）
   *   类型 ：一个函数，签名为 (this: Document, ev: FocusEvent) => any
   *     - this: Document ：函数内部的 this 指向 document
   *     - ev: FocusEvent ：函数接收一个 FocusEvent 类型的参数（事件对象）
   *     - => any ：函数返回值可以是任意类型
   * options?: boolean | AddEventListenerOptions | undefined)：
   *   参数名 options
   *   ? ：表示这是 可选参数 
   *   类型：三种可能的值
   *     - boolean ： true （捕获阶段）或 false （冒泡阶段）
   *     - AddEventListenerOptions ：一个配置对象（如 { capture: true, once: true } ）
   *     - undefined ：不传参数时的值
   * : void：返回值类型，表示该方法没有返回值，只执行事件监听注册
   * (+1 overload)：表示这个方法还有 一种其他调用方式
   * 
   * 事件类型
   * - 参考：https://developer.mozilla.org/zh-CN/docs/Web/API/Document_Object_Model/Events
   * - 常用事件类型：事件类型 触发时机 示例
   * - 鼠标事件
   *   click 用户点击元素 点击按钮、链接等可点击元素时触发
   *   dblclick 用户双击元素 双击文本选中文本时触发
   *   mousedown 鼠标按钮按下 拖拽开始时触发
   *   mouseup 鼠标按钮松开 拖拽结束时触发
   *   mouseover 鼠标移入元素 悬停效果
   *   mouseout 鼠标移出元素 离开元素时触发
   *   mousemove 鼠标在元素上移动 实时追踪位置
   * - 键盘事件
   *   keydown 键盘按键按下 按下回车键提交表单
   *   keyup 键盘按键松开 释放按键时触发
   * - 表单事件
   *   focus 元素获得焦点（ 不冒泡 ） 点击输入框 
   *   focusin 元素获得焦点（ 支持冒泡 ） 点击输入框 
   *     - 使用 focusin （支持冒泡）通过事件委托在 document 级别统一监听，实现监听页面上所有输入框的聚焦事件
   *     - 使用 focus （不冒泡），只能监听单个元素，需要为每个输入框单独添加监听器，效率低
   *   blur 元素失去焦点（ 不冒泡 ） 离开输入框 
   *   focusout 元素失去焦点（ 支持冒泡 ） 离开输入框
   *   input 输入框内容改变 实时搜索 
   *   change 表单元素值改变且失焦 选择下拉框 
   *   submit 表单提交 点击提交按钮
   * - 窗口事件
   *   load 页面完全加载（包括图片、样式表） 页面初始化 
   *   DOMContentLoaded DOM 加载完成（不等待图片） 更快的初始化 
   *   resize 窗口大小改变 窗口大小改变时触发图标和面板位置更新
   *   scroll 页面滚动 页面滚动时触发图标和面板位置更新
   *   beforeunload 页面即将关闭 提醒用户保存未完成的工作
   * - 其他事件
   *   contextmenu 右键菜单触发 自定义右键菜单
   * 
   * 冒泡的作用：
   * - 如果事件支持冒泡，就可以在父元素上监听，然后通过 e.target 找到真正触发事件的子元素，
   *   只需添加一个监听器，减少内存占用，新增的子元素自动被监听，无需重新绑定，避免大量重复的监听器绑定代码。
   * - 如果事件不支持冒泡，就只能在每个子元素上单独添加监听器
   */
  document.addEventListener('focusin', function (e) {
    // e.target 存在，且支持 matches 方法，且匹配选择器，检查聚焦的元素是否是表单输入框
    if (e.target && e.target.matches && e.target.matches(INPUT_SELECTOR)) {
      // 如果是，调用 showIcon() 显示图标
      showIcon(e.target);
    }
    // 如果不是，什么都不做
  }, true);

  /**
   * - document 监听整个文档
   * - addEventListener 添加事件监听的方法
   * - 'focusout' 事件类型：元素失去焦点时触发
   * - function (e) {...} 事件处理函数（回调函数）
   * - true 表示在 捕获阶段 触发事件处理
   */
  // 监听输入框失焦
  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.matches && e.target.matches(INPUT_SELECTOR)) {
      scheduleHideIcon();
    }
  }, true);

  // 页面滚动时同步图标和面板位置
  /**
   * - window 监听整个窗口
   * - addEventListener 添加事件监听的方法
   * - 'scroll' 事件类型：页面滚动时触发
   * - function () {...} 事件处理函数（回调函数）
   * - true 表示在 捕获阶段 触发事件处理
   */
  window.addEventListener('scroll', function () {
    if (!activeInput) return;
    if (iconEl)  positionIcon(activeInput);
    if (panelEl) positionPanel(activeInput);
  }, true);  // capture 模式，确保在页面元素滚动前更新

  // 窗口大小改变时同步位置
  /**
   * - window 监听整个窗口
   * - addEventListener 添加事件监听的方法
   * - 'resize' 事件类型：窗口大小改变时触发
   * - function () {...} 事件处理函数（回调函数）
   */
  window.addEventListener('resize', function () {
    if (!activeInput) return;
    if (iconEl)  positionIcon(activeInput);
    if (panelEl) positionPanel(activeInput);
  });

  /**
   * - document 监听整个文档
   * - addEventListener 添加事件监听的方法
   * - 'keydown' 事件类型：键盘按键按下时触发
   * - function (e) {...} 事件处理函数（回调函数）
   * - true 表示在 捕获阶段 触发事件处理
   * - 检查 e.key 是否为 'Escape' 键，且面板存在时关闭面板
   */
  // ESC 键关闭面板
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelEl) closePanel();
  }, true);

  // ════════════════════════════════════════════════════════════════════════
  //  候选面板模块（Candidate Panel Module）
  //  负责面板的渲染、交互、表单操作
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 定位候选面板
   * @param {HTMLElement} el - 输入框元素
   */
  function positionPanel(el) {
    if (!panelEl) return;
    var r = el.getBoundingClientRect();
    var pw = 300, ph = 400, mg = 6;  // 面板宽高和边距
    var left = r.left;
    var top  = r.bottom + mg;  // 默认显示在输入框下方
    
    // 下方空间不足则翻转到上方
    if (top + ph > window.innerHeight - 10) top = r.top - ph - mg;
    if (top < 4) top = 4;
    // 右侧越界则左移
    if (left + pw > window.innerWidth - 6) left = window.innerWidth - pw - 6;
    if (left < 4) left = 4;
    
    panelEl.style.left = left + 'px';
    panelEl.style.top  = top  + 'px';
  }

  /**
   * 打开候选面板
   * @param {HTMLElement} el - 输入框元素
   */
  function openPanel(el) {
    closePanel();  // 先关闭已有面板
    var domain = getCurrentDomain();
    panelEl = document.createElement('div');
    panelEl.className = 'afh-panel';
    shadow.appendChild(panelEl);
    renderPanel(el, domain, '', false, null);  // 初始渲染
    positionPanel(el);
  }

  /**
   * 渲染面板内容（核心渲染函数）
   * @param {HTMLElement} inputEl - 当前输入框
   * @param {string} domain - 当前域名
   * @param {string} query - 搜索关键词
   * @param {boolean} showForm - 是否显示添加表单
   * @param {Object} editingItem - 正在编辑的条目（null 表示非编辑状态）
   */
  function renderPanel(inputEl, domain, query, showForm, editingItem) {
    if (!panelEl) return;
    panelEl.innerHTML = '';  // 清空面板

    // 获取数据并过滤
    var _ref = getItemsForDomain(domain);
    var globals     = _ref.global;
    var domainItems = _ref.domainItems;

    var q = query.toLowerCase();
    // 过滤函数：按标签或值搜索
    function filt(arr) {
      return !q ? arr : arr.filter(function (i) {
        return i.label.toLowerCase().indexOf(q) !== -1
            || i.value.toLowerCase().indexOf(q) !== -1;
      });
    }
    var fg = filt(globals);     // 过滤后的全局条目
    var fd = filt(domainItems); // 过滤后的域名条目

    /* ── 顶部搜索栏 ── */
    var head = document.createElement('div');
    head.className = 'afh-head';

    var srch = document.createElement('input');
    srch.className = 'afh-search';
    srch.type = 'text';
    srch.placeholder = '搜索...';
    srch.value = query;
    // 输入时重新渲染（实现实时搜索）
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

    // 空状态
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
        list.appendChild(div);  // 添加分隔线
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
      openSettingsPage();  // 打开设置页
    });

    foot.appendChild(addBtn);
    foot.appendChild(mgBtn);
    panelEl.appendChild(foot);

    // 自动聚焦搜索框（非表单状态）
    if (!showForm && !editingItem) {
      setTimeout(function () {
        var s = panelEl && panelEl.querySelector('.afh-search');
        if (s) s.focus();
      }, 20);
    }
  }

  /**
   * 构建单个条目元素
   * @param {Object} item - 条目数据
   * @param {string} scope - 作用域
   * @param {HTMLElement} inputEl - 当前输入框
   * @param {string} domain - 当前域名
   * @param {string} query - 当前搜索关键词
   * @returns {HTMLElement} 条目 DOM 元素
   */
  function buildItemEl(item, scope, inputEl, domain, query) {
    var el = document.createElement('div');
    el.className = 'afh-item';

    // 信息区
    var info = document.createElement('div');
    info.className = 'afh-item-info';

    var lbl = document.createElement('div');
    lbl.className = 'afh-item-lbl';
    lbl.textContent = item.label;

    var val = document.createElement('div');
    val.className = 'afh-item-val';
    val.textContent = item.value;
    val.title = item.value;  // 完整内容显示在 tooltip

    info.appendChild(lbl);
    info.appendChild(val);

    // 操作按钮区
    var acts = document.createElement('div');
    acts.className = 'afh-item-acts';

    // 编辑按钮
    var ebtn = document.createElement('button');
    ebtn.className = 'afh-abtn';
    ebtn.innerHTML = ICON_EDIT;
    ebtn.title = '编辑';
    // 使用闭包保存 item 和 scope 的引用
    (function (it, sc) {
      ebtn.addEventListener('click', function (e) {
        e.stopPropagation();
        renderPanel(inputEl, domain, query, false,
          { id: it.id, label: it.label, value: it.value, scope: sc });
      });
    })(item, scope);

    // 删除按钮
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

    // 点击条目填充内容
    el.addEventListener('click', function () {
      fillInput(inputEl, item.value);
      closePanel();
    });

    return el;
  }

  /**
   * 构建添加/编辑表单
   * @param {HTMLElement} inputEl - 当前输入框
   * @param {string} domain - 当前域名
   * @param {string} query - 当前搜索关键词
   * @param {Object} editingItem - 编辑条目（null 表示新增）
   * @returns {HTMLElement} 表单 DOM 元素
   */
  function buildForm(inputEl, domain, query, editingItem) {
    var form = document.createElement('div');
    form.className = 'afh-form';

    // 标签输入
    var lblInput = document.createElement('input');
    lblInput.className = 'afh-finput';
    lblInput.placeholder = '标签（如：姓名、测试账号）';
    lblInput.value = editingItem ? editingItem.label : '';

    // 值输入（默认填充当前输入框内容）
    var valInput = document.createElement('input');
    valInput.className = 'afh-finput';
    valInput.placeholder = '填入内容';
    valInput.value = editingItem ? editingItem.value
                   : (activeInput ? activeInput.value : '');

    var row = document.createElement('div');
    row.className = 'afh-frow';

    // 作用域选择
    var scopeSel = document.createElement('select');
    scopeSel.className = 'afh-fsel';

    var optG = document.createElement('option');
    optG.value = 'global'; optG.textContent = '全局';
    var optD = document.createElement('option');
    optD.value = domain; optD.textContent = domain;
    scopeSel.appendChild(optG);
    scopeSel.appendChild(optD);

    // 编辑模式：锁定作用域
    if (editingItem) {
      scopeSel.value = editingItem.scope;
      scopeSel.disabled = true;
    }

    // 保存按钮
    var saveBtn = document.createElement('button');
    saveBtn.className = 'afh-fbtn pri';
    saveBtn.style.flex = '1';
    saveBtn.style.height = '27px';
    saveBtn.textContent = editingItem ? '保存修改' : '保存';
    saveBtn.addEventListener('click', function () {
      var lv = lblInput.value.trim();
      var vv = valInput.value.trim();
      if (!lv || !vv) return;  // 必填校验
      if (editingItem) editItem(editingItem.scope, editingItem.id, lv, vv);
      else             addItem(scopeSel.value, lv, vv);
      renderPanel(inputEl, domain, query, false, null);  // 保存后重新渲染
    });

    // Enter 键触发保存
    function onEnter(e) { if (e.key === 'Enter') saveBtn.click(); }
    lblInput.addEventListener('keydown', onEnter);
    valInput.addEventListener('keydown', onEnter);

    row.appendChild(scopeSel);
    row.appendChild(saveBtn);
    form.appendChild(lblInput);
    form.appendChild(valInput);
    form.appendChild(row);

    // 聚焦标签输入框
    setTimeout(function () { lblInput.focus(); }, 20);
    return form;
  }

  /**
   * 将值填入输入框（支持 React/Vue/Angular 等框架）
   * @param {HTMLElement} el - 输入框元素
   * @param {string} value - 要填入的值
   */
  function fillInput(el, value) {
    el.focus();
    try {
      // 获取原型上的 value 属性描述符（解决某些框架的限制）
      var proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);  // 使用原型方法设置
      else el.value = value;
    } catch (_) {
      el.value = value;  // 降级方案
    }
    // 触发合成事件，通知框架数据变更
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * 关闭面板
   */
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

  // ════════════════════════════════════════════════════════════════════════
  //  设置页模块（Settings Page）
  //  新标签页形式打开，提供完整的数据管理功能
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 打开设置页
   */
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

  /**
   * 构建设置页完整 HTML
   * @returns {string} HTML 字符串
   */
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

  /**
   * 构建设置页样式
   * @returns {string} CSS 字符串
   */
  function buildSettingsStyles() {
    return ''
      /* ──────────────────────────────────────────────────────────────── */
      /* 设置页全局样式 */
      /* ──────────────────────────────────────────────────────────────── */
      + '* {',
      + '  box-sizing: border-box;',  /* 盒模型：宽高包含 padding/border */
      + '  margin: 0;',               /* 移除默认外边距 */
      + '  padding: 0;',              /* 移除默认内边距 */
      + '}'
      + 'body {',
      + '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',  /* 系统字体 */
      + '  background: #f3f4f6;',     /* 浅灰背景 */
      + '  color: #111827;',          /* 深灰文字 */
      + '  min-height: 100vh;',       /* 最小高度：视口高度 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 页面头部 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-hd {',
      + '  background: #4f46e5;',     /* 紫色背景 */
      + '  color: #fff;',             /* 白色文字 */
      + '  padding: 14px 24px;',      /* 内边距 */
      + '  display: flex;',           /* Flex 布局 */
      + '  align-items: center;',     /* 垂直居中 */
      + '  gap: 16px;',               /* 子元素间距 */
      + '}'
      + '.s-hd-logo {',
      + '  width: 32px;',             /* 宽高 32px */
      + '  height: 32px;',
      + '  background: rgba(255,255,255,.2);',  /* 白色半透明背景 */
      + '  border-radius: 8px;',      /* 圆角 */
      + '  display: flex;',
      + '  align-items: center;',
      + '  justify-content: center;',
      + '  font-size: 16px;',
      + '  flex-shrink: 0;',          /* 不缩小 */
      + '}'
      + '.s-hd h1 {',
      + '  font-size: 17px;',         /* 标题字体大小 */
      + '  font-weight: 700;',        /* 粗体 */
      + '}'
      + '.s-hd p {',
      + '  font-size: 12px;',         /* 副标题字体 */
      + '  opacity: .75;',            /* 半透明 */
      + '  margin-top: 2px;',         /* 与上方间距 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 内容容器 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-wrap {',
      + '  max-width: 880px;',        /* 最大宽度 */
      + '  margin: 0 auto;',          /* 水平居中 */
      + '  padding: 20px 16px;',      /* 内边距 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 卡片组件 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-card {',
      + '  background: #fff;',        /* 白色背景 */
      + '  border: 1px solid #e5e7eb;', /* 灰色边框 */
      + '  border-radius: 10px;',     /* 圆角 */
      + '  margin-bottom: 16px;',     /* 底部外边距 */
      + '  overflow: hidden;',        /* 溢出隐藏 */
      + '}'
      + '.s-card-hd {',
      + '  padding: 12px 18px;',      /* 内边距 */
      + '  border-bottom: 1px solid #f3f4f6;',  /* 底部边框 */
      + '  display: flex;',
      + '  align-items: center;',
      + '  justify-content: space-between;',  /* 两端对齐 */
      + '}'
      + '.s-card-title {',
      + '  font-size: 14px;',
      + '  font-weight: 600;',        /* 半粗体 */
      + '  color: #374151;',          /* 深灰文字 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 筛选标签（Chip） */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-chips {',
      + '  display: flex;',
      + '  gap: 6px;',                /* 标签间距 */
      + '  flex-wrap: wrap;',         /* 自动换行 */
      + '  padding: 12px 18px 0;',    /* 内边距 */
      + '}'
      + '.s-chip {',
      + '  padding: 3px 12px;',       /* 内边距 */
      + '  border-radius: 999px;',    /* 圆形（超大圆角）*/
      + '  font-size: 12px;',
      + '  cursor: pointer;',
      + '  border: 1px solid #e5e7eb;',
      + '  background: #fff;',
      + '  color: #6b7280;',          /* 灰色文字 */
      + '  transition: all .1s;',     /* 过渡动画 */
      + '  user-select: none;',       /* 禁止选中 */
      + '}'
      + '.s-chip:hover {',
      + '  border-color: #a78bfa;',   /* hover 紫色边框 */
      + '  color: #6d28d9;',          /* hover 紫色文字 */
      + '}'
      + '.s-chip.active {',           /* 选中状态 */
      + '  background: #4f46e5;',     /* 紫色背景 */
      + '  color: #fff;',             /* 白色文字 */
      + '  border-color: #4f46e5;',   /* 紫色边框 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 工具栏 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-toolbar {',
      + '  padding: 10px 18px;',
      + '  display: flex;',
      + '  gap: 8px;',
      + '  flex-wrap: wrap;',         /* 自动换行 */
      + '  align-items: center;',
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 数据表格 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-table {',
      + '  width: 100%;',             /* 宽度 100% */
      + '  border-collapse: collapse;', /* 合并边框 */
      + '}'
      + '.s-table th {',              /* 表头单元格 */
      + '  padding: 8px 16px;',
      + '  text-align: left;',        /* 左对齐 */
      + '  font-size: 11px;',
      + '  font-weight: 700;',
      + '  color: #6b7280;',          /* 灰色 */
      + '  text-transform: uppercase;', /* 转大写 */
      + '  letter-spacing: .06em;',   /* 字母间距 */
      + '  border-bottom: 1px solid #f3f4f6;',
      + '  background: #fafafa;',     /* 浅灰背景 */
      + '}'
      + '.s-table td {',              /* 数据单元格 */
      + '  padding: 9px 16px;',
      + '  font-size: 13px;',
      + '  border-bottom: 1px solid #f9fafb;',
      + '  vertical-align: middle;',  /* 垂直居中 */
      + '}'
      + '.s-table tbody tr:last-child td {',
      + '  border-bottom: none;',     /* 最后一行无边框 */
      + '}'
      + '.s-table tbody tr:hover td {',
      + '  background: #fafafa;',     /* hover 浅灰背景 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 标签和空状态 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-tag {',                   /* 小标签 */
      + '  display: inline-block;',   /* 行内块 */
      + '  padding: 1px 8px;',
      + '  border-radius: 999px;',    /* 圆形 */
      + '  font-size: 11px;',
      + '  font-weight: 600;',
      + '  background: #ede9fe;',     /* 浅紫背景 */
      + '  color: #6d28d9;',          /* 紫色文字 */
      + '}'
      + '.s-tag.dm {',                /* 域名标签变体 */
      + '  background: #dbeafe;',     /* 浅蓝背景 */
      + '  color: #1d4ed8;',          /* 蓝色文字 */
      + '}'
      + '.s-empty {',                 /* 空状态 */
      + '  text-align: center;',
      + '  color: #9ca3af;',          /* 灰色 */
      + '  font-size: 13px;',
      + '  padding: 28px;',
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 按钮样式 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-btn {',                   /* 基础按钮 */
      + '  display: inline-flex;',    /* 行内 Flex */
      + '  align-items: center;',
      + '  gap: 4px;',
      + '  padding: 5px 12px;',
      + '  border-radius: 6px;',
      + '  font-size: 12px;',
      + '  cursor: pointer;',
      + '  border: 1px solid #e5e7eb;',
      + '  background: #f9fafb;',     /* 浅灰背景 */
      + '  color: #374151;',          /* 深灰文字 */
      + '  transition: background .1s;',
      + '  white-space: nowrap;',      /* 不换行 */
      + '}'
      + '.s-btn:hover {',
      + '  background: #f3f4f6;',     /* hover 背景变深 */
      + '}'
      + '.s-btn.pri {',               /* 主按钮 */
      + '  background: #4f46e5;',     /* 紫色背景 */
      + '  color: #fff;',             /* 白色文字 */
      + '  border-color: #4f46e5;',   /* 紫色边框 */
      + '}'
      + '.s-btn.pri:hover {',
      + '  background: #4338ca;',     /* hover 深紫色 */
      + '}'
      + '.s-btn.danger {',            /* 危险按钮 */
      + '  color: #dc2626;',          /* 红色文字 */
      + '  border-color: #fca5a5;',   /* 浅红边框 */
      + '  background: #fff;',
      + '}'
      + '.s-btn.danger:hover {',
      + '  background: #fef2f2;',     /* hover 浅红背景 */
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 弹窗样式 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-modal-bg {',              /* 弹窗背景遮罩 */
      + '  position: fixed;',         /* 固定定位 */
      + '  inset: 0;',                /* 覆盖全屏 */
      + '  background: rgba(0,0,0,.4);',  /* 半透明黑色 */
      + '  display: flex;',
      + '  align-items: center;',     /* 垂直居中 */
      + '  justify-content: center;', /* 水平居中 */
      + '  z-index: 999;',            /* 层级最高 */
      + '}'
      + '.s-modal {',                 /* 弹窗内容 */
      + '  background: #fff;',
      + '  border-radius: 10px;',
      + '  width: 440px;',            /* 固定宽度 */
      + '  max-width: 96vw;',         /* 响应式最大宽度 */
      + '  box-shadow: 0 20px 60px rgba(0,0,0,.18);',  /* 深色阴影 */
      + '}'
      + '.s-modal-hd {',              /* 弹窗头部 */
      + '  padding: 14px 18px;',
      + '  border-bottom: 1px solid #f3f4f6;',
      + '  display: flex;',
      + '  justify-content: space-between;',
      + '  align-items: center;',
      + '}'
      + '.s-modal-title {',
      + '  font-size: 15px;',
      + '  font-weight: 600;',
      + '}'
      + '.s-modal-close {',           /* 关闭按钮 */
      + '  background: none;',
      + '  border: none;',
      + '  font-size: 20px;',
      + '  cursor: pointer;',
      + '  color: #9ca3af;',          /* 灰色 */
      + '  line-height: 1;',          /* 行高为 1 */
      + '}'
      + '.s-modal-close:hover {',
      + '  color: #111827;',          /* hover 变黑 */
      + '}'
      + '.s-modal-body {',            /* 弹窗内容区 */
      + '  padding: 18px;',
      + '}'
      + '.s-modal-ft {',              /* 弹窗底部 */
      + '  padding: 12px 18px;',
      + '  border-top: 1px solid #f3f4f6;',
      + '  display: flex;',
      + '  justify-content: flex-end;', /* 右对齐 */
      + '  gap: 8px;',
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 表单元素 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-fg {',                    /* 表单组 */
      + '  margin-bottom: 12px;',     /* 底部间距 */
      + '}'
      + '.s-fg:last-child {',
      + '  margin-bottom: 0;',        /* 最后一个无间距 */
      + '}'
      + '.s-label {',                 /* 表单标签 */
      + '  font-size: 13px;',
      + '  font-weight: 500;',
      + '  color: #374151;',
      + '  margin-bottom: 4px;',
      + '  display: block;',          /* 块级显示 */
      + '}'
      + '.s-input {',                 /* 文本输入框 */
      + '  width: 100%;',
      + '  height: 34px;',
      + '  border: 1px solid #e5e7eb;',
      + '  border-radius: 6px;',
      + '  padding: 0 10px;',
      + '  font-size: 13px;',
      + '  outline: none;',           /* 移除默认聚焦框 */
      + '  color: #111827;',
      + '}'
      + '.s-input:focus {',
      + '  border-color: #4f46e5;',   /* 聚焦紫色边框 */
      + '  box-shadow: 0 0 0 3px rgba(79,70,229,.1);',  /* 紫色光晕 */
      + '}'
      + '.s-select {',                /* 下拉选择框 */
      + '  width: 100%;',
      + '  height: 34px;',
      + '  border: 1px solid #e5e7eb;',
      + '  border-radius: 6px;',
      + '  padding: 0 10px;',
      + '  font-size: 13px;',
      + '  outline: none;',
      + '  background: #fff;',
      + '  color: #111827;',
      + '  cursor: pointer;',
      + '}'
      + '.s-select:focus {',
      + '  border-color: #4f46e5;',
      + '}'

      /* ──────────────────────────────────────────────────────────────── */
      /* 导入/导出区域 */
      /* ──────────────────────────────────────────────────────────────── */
      + '.s-io-box {',                /* 导入导出容器 */
      + '  background: #f9fafb;',     /* 浅灰背景 */
      + '  border-radius: 8px;',
      + '  padding: 14px 18px;',
      + '  margin: 0 18px 16px;',     /* 外边距 */
      + '}'
      + '.s-io-title {',              /* 标题 */
      + '  font-size: 11px;',
      + '  font-weight: 700;',
      + '  color: #6b7280;',
      + '  text-transform: uppercase;',
      + '  letter-spacing: .06em;',
      + '  margin-bottom: 8px;',
      + '}'
      + '.s-textarea {',              /* 文本域 */
      + '  width: 100%;',
      + '  height: 90px;',
      + '  border: 1px solid #e5e7eb;',
      + '  border-radius: 6px;',
      + '  padding: 8px 10px;',
      + '  font-size: 12px;',
      + '  font-family: monospace;',  /* 等宽字体 */
      + '  outline: none;',
      + '  resize: vertical;',        /* 仅允许垂直调整大小 */
      + '  color: #111827;',
      + '  background: #fff;',
      + '}'
      + '.s-textarea:focus {',
      + '  border-color: #4f46e5;',
      + '}'
      + '.s-io-row {',                /* 按钮行 */
      + '  display: flex;',
      + '  gap: 6px;',
      + '  margin-top: 8px;',         /* 顶部间距 */
      + '  align-items: center;',
      + '}';
  }

  /**
   * 构建设置页逻辑脚本
   * 注意：此函数返回的字符串将被注入到设置页的 <script> 标签内执行
   * @returns {string} JavaScript 代码字符串
   */
  function buildSettingsScript() {
    return ''
      /* 获取 API（从主窗口获取）*/
      + 'var api = window.opener && window.opener.__afhAPI;'
      + 'if (!api) {'
      + '  document.getElementById("afh-root").innerHTML'
      + '    = \'<p style="color:#dc2626;padding:40px 24px;text-align:center;font-size:14px">'
      + '\u8bf7\u901a\u8fc7 Tampermonkey \u83dc\u5355\u91cd\u65b0\u6253\u5f00\u6b64\u9875\u9762\u3002</p>\';'
      + '  return;'
      + '}'

      /* 状态：当前筛选条件 */
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

      /* ── render() 主渲染函数 ── */
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

      /* ── openModal(item) 弹窗函数 ── */
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

  // ════════════════════════════════════════════════════════════════════════
  //  Tampermonkey 菜单注册
  // ════════════════════════════════════════════════════════════════════════
  GM_registerMenuCommand('\u81ea\u52a8\u586b\u5165\u7ba1\u7406', openSettingsPage);

})();