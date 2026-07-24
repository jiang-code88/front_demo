---
name: AutoFill 适配 CodeMirror6 编辑器
overview: 让 AutoFill Helper 油猴脚本通过一个通用的、可选实现的"适配器协议"来支持 CodeMirror 6 编辑器，从而在 sqltools.html 页面上，被 SQL 高亮脚本替换成 CM6 的文本框里也能正常弹出图标/候选面板并完成填充，同时完全不影响 AutoFill Helper 在普通 input/textarea 上的现有行为。
todos:
  - id: autofill-helper-adapter
    content: 在 tampermonkey-autofill.user.js 中新增 getAdapter/isFillTarget/getElValue/getElCaret helper，并替换 focusin/focusout/input 监听、getInlineQuery、handleInlineInput、fillInput、fillInlineInput、buildForm 中的相关逻辑
    status: completed
  - id: sql-highlight-expose-adapter
    content: 在 tampermonkey-sql-highlight.user.js 的 enhanceTextarea() 中，为 CM6 的 .cm-content 元素挂载 __afhAdapter（getValue/getSelectionStart/setRange/focus）
    status: completed
  - id: manual-verify
    content: 在 sqltools.html 手动验证：CM6 编辑器中点击出现图标、点击候选整体替换、打字触发 inline 面板、行内替换均正常，且不影响普通 input/textarea 页面上的原有行为
    status: completed
isProject: false
---

# 为 AutoFill Helper 增加 CodeMirror 6 编辑器兼容支持

## 问题根因

`tampermonkey-sql-highlight.user.js` 会把 `sqltools.html` 里的 `textarea#sql`（见 `sqltools.html` 第 256 行）替换/隐藏，改用 CodeMirror 6 渲染一个 `contenteditable` 的 `.cm-content` 元素来承载输入。

`tampermonkey-autofill.user.js` 的图标/面板触发逻辑始终依赖：

```76:95:tampermonkey-autofill.user.js
var INPUT_SELECTOR = [
    'input[type="text"]', 'input[type="email"]', 'input[type="search"]',
    'input[type="number"]', 'input[type="tel"]', 'input[type="url"]',
    'input[type="password"]', 'input:not([type])', 'textarea'
  ].join(',');
```

以及对 `el.value` / `el.selectionStart` 的直接读写（`getInlineQuery`、`fillInput`、`fillInlineInput`）。CM6 的 `.cm-content` 是一个 `<div contenteditable>`，既不匹配 `INPUT_SELECTOR`，也没有 `.value` 属性，所以：
- `focusin` 时图标不会出现（选择器不匹配）；
- 即使匹配了，`el.value = xxx` 对 contenteditable div 也不会生效。

CM6 官方虽然有 `EditorView.findFromDOM()` 可以拿到编辑器实例，但那需要 AutoFill 脚本自己再 `import()` 一份 `@codemirror/view`，属于强耦合且有版本风险；社区常用的 `.cmView` 私有属性在新版本 CM6 中已改名/不稳定（见调研），不适合依赖。

## 方案：两个脚本之间约定一个极简"适配器协议"

不去猜测/依赖 CM6 内部实现，而是由**加载了 CM6 的脚本自己**把一个标准接口挂到被聚焦的 DOM 节点上；AutoFill Helper 只需要检测这个约定属性，不需要知道 CM6 是什么。这样两个脚本零耦合，未来任何自定义编辑器（不只是 CM6）都能用同样方式接入 AutoFill。

约定属性名沿用项目已有的 `__afh` 前缀（参考现有的 `__afh_host__`、`__afhAPI`）：`element.__afhAdapter = { getValue, getSelectionStart, setRange, focus }`。

### 1）`tampermonkey-sql-highlight.user.js`：在创建 `editor` 后挂载适配器

在 `enhanceTextarea()` 里创建 CM6 `editor` 成功之后（大约 `tampermonkey-sql-highlight.user.js` 第 1510-1628 行的 `try{...}` 块之后），追加：

```js
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
```

`.cm-content` 正是浏览器 focus/blur/input 事件实际派发到的节点，所以 AutoFill 的 `focusin` 能直接在 `e.target` 上摸到这个适配器。`setRange` 用 `editor.dispatch()` 修改文档——这与用户真实输入走的是同一条状态更新通道，脚本自身的 `EditorView.updateListener`（同步到隐藏 textarea、防抖持久化 Tab、触发 lint 等，见 1596-1611 行）会自动跟着触发，不需要额外补发 `input`/`change` 事件。

### 2）`tampermonkey-autofill.user.js`：识别适配器并走通用取值/赋值路径

新增两个小helper（放在 `INPUT_SELECTOR` 定义附近）：

```js
function getAdapter(el) {
  var a = el && el.__afhAdapter;
  return (a && typeof a.getValue === 'function') ? a : null;
}
function isFillTarget(el) {
  return !!(el && el.matches && (el.matches(INPUT_SELECTOR) || getAdapter(el)));
}
function getElValue(el) {
  var a = getAdapter(el);
  return a ? a.getValue() : el.value;
}
function getElCaret(el) {
  var a = getAdapter(el);
  if (a) return a.getSelectionStart();
  return (typeof el.selectionStart === 'number') ? el.selectionStart : getElValue(el).length;
}
```

把现有 3 处 `e.target.matches(INPUT_SELECTOR)` 判断（`focusin` 第 1069 行、`focusout` 第 1085 行、`input` 第 1095 行）统一换成 `isFillTarget(e.target)`。

`getInlineQuery(el)`（1600-1615 行）内部的 `el.value` / `el.selectionStart` 改为 `getElValue(el)` / `getElCaret(el)`；`handleInlineInput` 里 `el.value === ''` 的判断同样换成 `getElValue(el) === ''`。

`fillInput(el, value)`（1571-1589 行）和 `fillInlineInput(el, item, matchType)`（1679-1714 行）各自开头加一个适配器分支，命中则调用 `a.setRange(start, end, text)` + `a.focus()` 后直接 `return`，未命中则完全走现有的原生 `input`/`textarea` 逻辑（原样保留，一行不改）：

```js
function fillInput(el, value) {
  var a = getAdapter(el);
  if (a) { a.setRange(0, a.getValue().length, value); if (a.focus) a.focus(); return; }
  // ...原有逻辑不变...
}
```

`buildForm` 里"快速添加"默认带入当前输入框内容那一行（约 1508-1509 行）也改成 `getElValue(activeInput)`。

### 3）`sqltools.html`

不需要任何修改。

## 效果与非回归说明

- 在 CM6 编辑器里点击 → 出现自动填充图标；点击图标 → 弹出候选面板，点击条目会整体替换 SQL 内容（走 `setRange(0, len, value)`），并自动同步到隐藏 textarea / Tab 持久化。
- 在 CM6 编辑器里打字触发 inline 面板：contenteditable 的原生 `input` 事件本来就会冒泡到 `document`，现有的防抖监听不需要改动即可捕获；取词逻辑改用 `getElValue`/`getElCaret` 后对 CM6 同样成立（CM6 文档默认用 `\n` 分行，和字符串语义一致）。
- 对于所有普通网站的 `input`/`textarea`：`getAdapter(el)` 恒返回 `null`，所有分支都会落到与今天完全相同的原生代码路径，行为零变化。
- 已知小 caveat（不在本次修复范围）：当 CM6 自带的补全下拉框和 AutoFill 的 inline 候选面板同时弹出时，两者都会用方向键/Enter 做导航，键盘事件会被 AutoFill 的 `document` 捕获阶段监听优先拦截，可能与 CM6 自身补全的键盘导航产生冲突——这与目前 AutoFill 在普通多行 textarea 上已有的行为一致（原生 textarea 没有类似的第三方补全下拉框，所以现网暂未暴露），后续如需可以在拦截前判断 `.cm-tooltip-autocomplete` 是否存在来避让。

## 涉及改动文件

- [tampermonkey-autofill.user.js](tampermonkey-autofill.user.js)：新增 `getAdapter`/`isFillTarget`/`getElValue`/`getElCaret` 四个 helper；`focusin`/`focusout`/`input` 三处监听改用 `isFillTarget`；`getInlineQuery`/`handleInlineInput`/`fillInput`/`fillInlineInput`/`buildForm` 五处改为通过 helper 读写，新增适配器分支。
- [tampermonkey-sql-highlight.user.js](tampermonkey-sql-highlight.user.js)：`enhanceTextarea()` 中 CM6 `editor` 创建成功后，给 `.cm-content` 挂载 `__afhAdapter`。
