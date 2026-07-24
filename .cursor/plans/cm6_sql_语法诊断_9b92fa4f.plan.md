---
name: CM6 SQL 语法诊断
overview: 为 tampermonkey-sql-highlight.user.js 的 CodeMirror 6 编辑器接入真实的 SQL 语法诊断能力：引入 @marimo-team/codemirror-sql（底层用 node-sql-parser 按 MySQL 方言真实解析 SQL），在编辑器内实时显示语法错误的波浪线、行号栏图标与悬浮提示，同时保持现有语法高亮/补全/主题逻辑不变。
todos:
  - id: add-urls
    content: 在 CM6_URLS 新增 sqlLintPkg（@marimo-team/codemirror-sql@0.3.0）与 lint（@codemirror/lint@6）两个模块地址
    status: completed
  - id: load-modules
    content: loadCM6() 中动态加载这两个模块，返回对象新增 sqlExtension/NodeSqlParser/lintGutter
    status: completed
  - id: api-check
    content: 更新关键 API 完整性检查，加入新增的三个 API 校验
    status: completed
  - id: add-extension
    content: 在编辑器 extensions 列表中插入 CM6.sqlExtension({...MySQL 方言, 关闭语义检查/hover/导航...}) 与 CM6.lintGutter()
    status: completed
  - id: manual-verify
    content: 用 test-sql-highlight.html 手动验证语法错误能触发波浪线+行号栏图标+悬浮提示，且不影响现有高亮/补全/提交功能
    status: completed
isProject: false
---

# CM6 SQL 语法诊断集成方案

## 结论先行

`tampermonkey-sql-highlight.user.js` 目前用的 `@codemirror/lang-sql` 只提供语法高亮和关键字补全，其内部的 SQL 解析（用于高亮）是"宽容型"的，官方明确不带诊断能力——诊断必须通过独立的 `@codemirror/lint` 包接入，且需要自己提供一个"诊断源函数"。已确认社区包 `@marimo-team/codemirror-sql`（底层封装 `node-sql-parser`）可以直接提供这个诊断源，并且支持 `database: 'MySQL'` 方言，通过 esm.sh 动态加载也能正常工作，和现有的模块加载方式（`tampermonkey-sql-highlight.user.js` 第 365-411 行 `loadCM6()`）完全兼容，不需要改变现有的加载架构。

已实测确认的关键事实：
- `@marimo-team/codemirror-sql@0.3.0` 通过 esm.sh 加载后会 `export`：`sqlExtension`、`NodeSqlParser`、`sqlLinter` 等具名导出，与 GitHub 源码/文档一致。
- 它对 `node-sql-parser` 的引用是运行时动态 `import("node-sql-parser")`，esm.sh 会把这行改写成可直接解析的 URL（`import("/node-sql-parser@5.4.0/es2022/node-sql-parser.mjs")`），浏览器里能正常工作。
- `node-sql-parser` 是懒加载的：只有第一次真正跑 lint（用户输入 SQL 触发）才会去下载，不影响页面初次加载耗时；但这个包本身不小（压缩前约 2.5MB，走 gzip 传输后会小很多，具体以浏览器实测网络面板为准），是这个方案相对"客户端启发式检查"更重的地方，换来的是真实的 MySQL 语法解析而不是拍脑袋规则。
- `sqlExtension()` 除了语法诊断外还带"schema 感知语义检查"（未知表名/字段名）、hover 提示、go-to-definition 等功能，但这些都依赖"表名 → 字段名"这种结构化 schema；而现有 `dbTokensCache`（`tampermonkey-sql-highlight.user.js` 第 421-444 行 `ensureDbTokens`）拿到的是 `/operate/get_database_tokens` 返回的**扁平字符串数组**，不带表/字段从属关系（`sql编辑器多tab独立查询重构` 方案里也明确提到这一点），所以本次**只启用语法诊断**，语义检查/hover/跳转定义功能显式关闭，避免无意义的误报和与现有补全/快捷键功能产生冲突。

## 具体改动

### 1. 新增模块 URL（`CM6_URLS`，第 83-90 行）

新增两个 URL：
- `sqlLintPkg: 'https://esm.sh/@marimo-team/codemirror-sql@0.3.0'`（显式锁定版本号——这是 0.x 阶段的包，语义化版本下次版本号也可能有破坏性变更，不能像 `@codemirror/lang-sql@6` 那样用范围）
- `lint: 'https://esm.sh/@codemirror/lint@6'`（用于取 `lintGutter()`，给诊断加行号栏图标；`@marimo-team/codemirror-sql` 内部虽然依赖 `@codemirror/lint`，但不重新导出 `lintGutter`，需要单独加载）

### 2. `loadCM6()` 新增加载与导出（第 365-411 行）

```javascript
var sqlLintMod = await import(CM6_URLS.sqlLintPkg);
var lintMod = await import(CM6_URLS.lint);
```

返回对象新增：`sqlExtension: sqlLintMod.sqlExtension`、`NodeSqlParser: sqlLintMod.NodeSqlParser`、`lintGutter: lintMod.lintGutter`。

### 3. 关键 API 完整性检查（第 1449-1461 行）

在现有 `if (!CM6.EditorView || ...)` 的必需项列表里追加 `!CM6.sqlExtension || !CM6.NodeSqlParser || !CM6.lintGutter`，并在 `console.error` 的诊断对象里同步加上这三项，保持现有"缺关键 API 直接报错降级回原生 textarea"的行为一致。

### 4. 编辑器扩展列表新增诊断扩展（第 1493-1575 行 `extensions: [...]`）

在现有 `CM6.autocompletion({...})` 之后、`CM6.oneDark` 之前插入：

```javascript
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
```

其余现有扩展（`basicSetup`、`sql()`、`autocompletion()`、`oneDark`、`placeholder`、`lineWrapping`、自定义 `theme`、`keymap`、`updateListener`）保持不动。

### 5. 本地验证

`test-sql-highlight.html` 不需要改动（诊断是纯前端能力，不涉及 AJAX/后端交互）。用它打开脚本，在编辑器里输入明显语法错误的 SQL（例如 `SELECT FORM users`、缺右括号的 `SELECT * FROM users WHERE (id = 1`），验证：
- 错误片段出现红色波浪线
- 行号栏出现错误图标，悬浮/点击能看到具体错误信息
- 正常语句（含现有 `Ctrl+Enter` 提交、补全功能）不受影响，无误报

## 不在本次范围内

- 不接入 schema 感知的"未知表名/字段名"语义检查、hover 提示、跳转定义/重命名（`enableSemanticLinting`/`enableHover`/`enableNavigation` 均设为 `false`）。
- 不改动 `sql编辑器多tab独立查询重构` 计划里涉及的 AJAX 提交、多 Tab、后端报错展示等逻辑——那是另一份独立计划，本次只做编辑器侧的语法诊断能力。
