// ==UserScript==
// @name         SQL Highlight
// @namespace    https://github.com/sql-highlight
// @version      1.0.0
// @description  自动检测 textarea 中的 SQL 内容并进行实时语法高亮，保留原生编辑体验
// @author       You
// @match        *://*/*
// @match        file:///*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

// @match        *://*/*         匹配所有 HTTP/HTTPS 页面
// @match        file:///*       匹配本地文件
// @grant        GM_registerMenuCommand  注册 Tampermonkey 菜单
// @grant        GM_getValue             读取持久化存储
// @grant        GM_setValue             写入持久化存储
// @run-at       document-idle   文档加载完毕后运行

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  //  架构概览
  //
  //   ┌─ textarea（z-index:1, color:transparent）──── 用户在此输入
  //   │         ↓ input/scroll 事件
  //   └─ pre.sh-backdrop（z-index:0）─────────────── 渲染高亮 HTML
  //
  //   两者叠放在 div.sh-wrapper（position:relative）内，字体/内边距完全一致，
  //   视觉上无缝合并，用户的光标/选区依然正常显示。
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  //  全局开关（持久化到 Tampermonkey 存储）
  // ══════════════════════════════════════════════════════════════════════════
  var ENABLED_KEY = 'sql_hl_enabled';
  var enabled = GM_getValue(ENABLED_KEY, true);

  // ══════════════════════════════════════════════════════════════════════════
  //  辅助：将数组转为 O(1) 查找对象
  // ══════════════════════════════════════════════════════════════════════════
  function makeSet(arr) {
    var obj = Object.create(null);
    for (var i = 0; i < arr.length; i++) obj[arr[i]] = 1;
    return obj;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SQL 内置函数（优先于关键字检查，显示为黄色）
  // ══════════════════════════════════════════════════════════════════════════
  var SQL_FN = makeSet([
    // 聚合函数
    'COUNT', 'SUM', 'AVG', 'MAX', 'MIN',
    'GROUP_CONCAT', 'STRING_AGG', 'ARRAY_AGG', 'LISTAGG', 'BIT_AND', 'BIT_OR',
    // 字符串函数
    'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'MID', 'SUBSTRING_INDEX',
    'LENGTH', 'LEN', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'BIT_LENGTH', 'OCTET_LENGTH',
    'UPPER', 'LOWER', 'UCASE', 'LCASE',
    'TRIM', 'LTRIM', 'RTRIM', 'LPAD', 'RPAD', 'BTRIM', 'INITCAP',
    'REPLACE', 'TRANSLATE', 'OVERLAY',
    'POSITION', 'LOCATE', 'CHARINDEX', 'PATINDEX', 'INSTR', 'STRPOS',
    'REPEAT', 'REPLICATE', 'REVERSE', 'SPACE', 'STUFF',
    'FORMAT', 'CHAR', 'CHR', 'ASCII', 'ORD', 'UNICODE', 'NCHAR',
    'SPLIT_PART', 'LEFT', 'RIGHT',
    'REGEXP_REPLACE', 'REGEXP_LIKE', 'REGEXP_SUBSTR', 'REGEXP_INSTR',
    'QUOTE_IDENT', 'QUOTE_LITERAL', 'TO_HEX', 'ENCODE', 'DECODE',
    'SOUNDEX', 'DIFFERENCE',
    // 日期时间函数
    'NOW', 'SYSDATE', 'GETDATE', 'GETUTCDATE', 'SYSDATETIME',
    'DATEADD', 'DATE_ADD', 'ADDDATE', 'DATE_SUB', 'SUBDATE',
    'DATEDIFF', 'TIMESTAMPDIFF',
    'DATE_TRUNC', 'DATE_PART', 'EXTRACT', 'DATEPART',
    'TO_DATE', 'TO_TIMESTAMP', 'TO_CHAR', 'TO_TIME',
    'DATE_FORMAT', 'TIME_FORMAT', 'STR_TO_DATE',
    'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND',
    'WEEK', 'WEEKDAY', 'WEEKOFYEAR', 'QUARTER',
    'DAYOFWEEK', 'DAYOFYEAR', 'DAYOFMONTH',
    'LAST_DAY', 'EOMONTH', 'MAKEDATE', 'MAKETIME',
    'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'CONVERT_TZ', 'TIMESTAMPADD',
    // 数学函数
    'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC',
    'POWER', 'POW', 'SQRT', 'EXP', 'LN', 'LOG', 'LOG2', 'LOG10',
    'MOD', 'SIGN', 'PI', 'RADIANS', 'DEGREES',
    'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2', 'COT',
    'RAND', 'RANDOM',
    'GREATEST', 'LEAST',
    // 条件函数
    'COALESCE', 'NULLIF', 'IFNULL', 'NVL', 'NVL2', 'IIF', 'ISNULL',
    'DECODE', 'CHOOSE',
    // 类型转换函数
    'CAST', 'CONVERT', 'TRY_CAST', 'TRY_CONVERT',
    'TO_NUMBER', 'PARSE', 'TRY_PARSE',
    // 窗口函数
    'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD',
    'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
    'CUME_DIST', 'PERCENT_RANK', 'PERCENTILE_CONT', 'PERCENTILE_DISC',
    // JSON 函数
    'JSON_EXTRACT', 'JSON_VALUE', 'JSON_QUERY', 'JSON_OBJECT', 'JSON_ARRAY',
    'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'JSON_BUILD_OBJECT', 'JSON_BUILD_ARRAY',
    'JSON_AGG', 'JSONB_AGG', 'JSON_EACH', 'JSONB_EACH', 'JSON_TABLE',
    'JSON_CONTAINS', 'JSON_TYPE', 'JSON_KEYS', 'JSON_DEPTH', 'JSON_LENGTH',
    'JSON_MERGE', 'JSON_REMOVE', 'JSON_SET',
    // 数组函数
    'GENERATE_SERIES', 'UNNEST', 'ARRAY_LENGTH', 'CARDINALITY',
    'ARRAY_TO_STRING', 'STRING_TO_ARRAY', 'ARRAY_APPEND', 'ARRAY_PREPEND', 'ARRAY_CAT',
    // UUID / 哈希
    'GEN_RANDOM_UUID', 'UUID_GENERATE_V4', 'NEWID',
    'MD5', 'SHA1', 'SHA2', 'SHA256', 'HASH', 'HASHBYTES',
    // 系统信息函数
    'VERSION', 'CONNECTION_ID', 'FOUND_ROWS', 'LAST_INSERT_ID', 'ROW_COUNT',
    'PG_TYPEOF', 'TYPEOF',
    // 字符串转 JSON
    'ROW_TO_JSON', 'TO_JSON', 'TO_JSONB'
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  //  SQL 关键字（显示为蓝色）
  // ══════════════════════════════════════════════════════════════════════════
  var SQL_KW = makeSet([
    // DML
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE',
    // DDL
    'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'RENAME',
    // 对象类型
    'TABLE', 'VIEW', 'INDEX', 'DATABASE', 'SCHEMA', 'SEQUENCE',
    'PROCEDURE', 'FUNCTION', 'TRIGGER', 'PACKAGE', 'SYNONYM',
    // 核心子句
    'FROM', 'WHERE', 'HAVING', 'GROUP', 'ORDER', 'BY',
    'LIMIT', 'OFFSET', 'FETCH', 'NEXT', 'ONLY', 'TOP', 'ROWNUM',
    'INTO', 'VALUES', 'SET', 'RETURNING', 'OUTPUT',
    // JOIN
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'NATURAL',
    'ON', 'USING',
    // 集合操作
    'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'DISTINCT',
    // CTE
    'WITH', 'AS', 'RECURSIVE',
    // 逻辑条件
    'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE', 'BETWEEN',
    'EXISTS', 'ANY', 'SOME',
    // CASE 表达式
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    // 排序
    'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
    // 事务
    'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'SAVEPOINT', 'WORK',
    // 窗口函数关键字
    'OVER', 'PARTITION', 'RANGE', 'ROWS', 'PRECEDING', 'FOLLOWING',
    'UNBOUNDED', 'CURRENT', 'ROW',
    // 约束定义
    'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'CONSTRAINT',
    'DEFAULT', 'NOT', 'AUTO_INCREMENT', 'IDENTITY', 'SERIAL', 'GENERATED', 'ALWAYS',
    'ADD', 'COLUMN', 'MODIFY', 'CHANGE', 'FIRST',
    // 数据类型
    'BOOLEAN', 'BOOL',
    'INTEGER', 'INT', 'INT2', 'INT4', 'INT8', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
    'FLOAT', 'FLOAT4', 'FLOAT8', 'DOUBLE', 'REAL', 'DECIMAL', 'NUMERIC', 'MONEY',
    'CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BYTEA', 'BINARY', 'VARBINARY',
    'DATE', 'TIME', 'TIMESTAMP', 'DATETIME', 'INTERVAL', 'YEAR',
    'JSON', 'JSONB', 'XML', 'UUID', 'ARRAY', 'ENUM',
    // 字面量
    'TRUE', 'FALSE', 'UNKNOWN',
    // 分析 / 维护
    'EXPLAIN', 'ANALYZE', 'VACUUM', 'REINDEX', 'REFRESH',
    // 其他
    'LATERAL', 'TABLESAMPLE', 'MATCHED',
    'SHOW', 'DESCRIBE', 'USE', 'CALL', 'EXEC', 'EXECUTE',
    'GRANT', 'REVOKE', 'DENY',
    // MySQL 扩展
    'IGNORE', 'FORCE', 'STRAIGHT_JOIN', 'SQL_NO_CACHE',
    // 存储过程 / 流程控制
    'IF', 'ELSEIF', 'ELSIF', 'LOOP', 'WHILE', 'FOR', 'DO',
    'DECLARE', 'RETURN', 'RAISE', 'EXCEPTION', 'NOTICE',
    // 其他常用
    'MATERIALIZED', 'TEMPORARY', 'TEMP', 'UNLOGGED', 'GLOBAL', 'LOCAL',
    'CASCADE', 'RESTRICT', 'NO', 'ACTION', 'DEFERRABLE', 'INITIALLY', 'DEFERRED',
    'AT', 'ZONE', 'WITHIN', 'FILTER', 'EXCLUDE',
    'PIVOT', 'UNPIVOT', 'APPLY', 'CROSS', 'OUTER'
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  //  词法分析器（Tokenizer）
  //  按优先级顺序识别：注释 → 字符串 → 标识符 → 数字 → 关键字/函数 → 运算符 → 标点
  // ══════════════════════════════════════════════════════════════════════════
  var WORD_RE = /^[a-zA-Z_@#$][a-zA-Z0-9_@#$]*/;
  var NUM_RE  = /^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/;
  var WS_RE   = /^\s+/;
  // 多字符运算符（长的排在前，防止被短的截断）
  var OP2_RE  = /^(?:->>|->|<=>|<>|<=|>=|!=|\|\||::)/;

  function tokenize(sql) {
    var tokens = [];
    var i = 0;
    var n = sql.length;

    while (i < n) {
      var ch   = sql[i];
      var next = sql[i + 1];
      var j, m, word, upper, type;

      // ── 空白（整批消费）──────────────────────────────
      if (ch <= ' ') {
        m = WS_RE.exec(sql.slice(i));
        tokens.push({ t: 'plain', v: m[0] });
        i += m[0].length;
        continue;
      }

      // ── 块注释 /* ... */ ──────────────────────────────
      if (ch === '/' && next === '*') {
        j = sql.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        tokens.push({ t: 'cmt', v: sql.slice(i, j) });
        i = j;
        continue;
      }

      // ── 行注释 -- 或 # ────────────────────────────────
      if ((ch === '-' && next === '-') || ch === '#') {
        j = sql.indexOf('\n', i);
        j = j < 0 ? n : j;
        tokens.push({ t: 'cmt', v: sql.slice(i, j) });
        i = j;
        continue;
      }

      // ── 单引号字符串 '...' ────────────────────────────
      if (ch === "'") {
        j = i + 1;
        while (j < n) {
          if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; } // '' 转义
          else if (sql[j] === "'") { j++; break; }
          else { j++; }
        }
        tokens.push({ t: 'str', v: sql.slice(i, j) });
        i = j;
        continue;
      }

      // ── 反引号标识符 `...` （MySQL）───────────────────
      if (ch === '`') {
        j = sql.indexOf('`', i + 1);
        j = j < 0 ? n : j + 1;
        tokens.push({ t: 'id', v: sql.slice(i, j) });
        i = j;
        continue;
      }

      // ── 双引号标识符 "..." （SQL 标准 / PostgreSQL）───
      if (ch === '"') {
        j = i + 1;
        while (j < n) {
          if (sql[j] === '"' && sql[j + 1] === '"') { j += 2; } // "" 转义
          else if (sql[j] === '"') { j++; break; }
          else { j++; }
        }
        tokens.push({ t: 'id', v: sql.slice(i, j) });
        i = j;
        continue;
      }

      // ── 方括号标识符 [...] （T-SQL / SQL Server）──────
      if (ch === '[') {
        j = sql.indexOf(']', i);
        j = j < 0 ? n - 1 : j;
        tokens.push({ t: 'id', v: sql.slice(i, j + 1) });
        i = j + 1;
        continue;
      }

      // ── 数字（整数、小数、十六进制、科学计数）────────
      if ((ch >= '0' && ch <= '9') || (ch === '.' && next >= '0' && next <= '9')) {
        m = NUM_RE.exec(sql.slice(i));
        if (m) {
          tokens.push({ t: 'num', v: m[0] });
          i += m[0].length;
          continue;
        }
      }

      // ── 单词：关键字 / 内置函数 / 普通标识符 ─────────
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
          ch === '_' || ch === '@' || ch === '#' || ch === '$') {
        m = WORD_RE.exec(sql.slice(i));
        if (m) {
          word  = m[0];
          upper = word.toUpperCase();
          // 内置函数优先于关键字
          type  = SQL_FN[upper] ? 'fn' : SQL_KW[upper] ? 'kw' : 'plain';
          tokens.push({ t: type, v: word });
          i += word.length;
          continue;
        }
      }

      // ── 多字符运算符 ─────────────────────────────────
      m = OP2_RE.exec(sql.slice(i));
      if (m) {
        tokens.push({ t: 'op', v: m[0] });
        i += m[0].length;
        continue;
      }

      // ── 单字符运算符 ─────────────────────────────────
      if ('=<>+-*/%&|^~!\\'.indexOf(ch) !== -1) {
        tokens.push({ t: 'op', v: ch });
        i++;
        continue;
      }

      // ── 标点符号 ─────────────────────────────────────
      if ('(),;:.'.indexOf(ch) !== -1) {
        tokens.push({ t: 'pu', v: ch });
        i++;
        continue;
      }

      // ── 其他字符（原样保留）──────────────────────────
      tokens.push({ t: 'plain', v: ch });
      i++;
    }

    return tokens;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  HTML 渲染器
  //  将 Token 数组转为带 <span> 标签的高亮 HTML 字符串
  // ══════════════════════════════════════════════════════════════════════════
  var T_CLS = {
    kw:    'sh-kw',
    fn:    'sh-fn',
    str:   'sh-str',
    num:   'sh-num',
    cmt:   'sh-cmt',
    op:    'sh-op',
    id:    'sh-id',
    pu:    'sh-pu',
    plain: ''
  };

  function escHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function tokensToHTML(tokens) {
    var parts = [];
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var esc = escHtml(tok.v);
      var cls = T_CLS[tok.t];
      parts.push(cls ? '<span class="' + cls + '">' + esc + '</span>' : esc);
    }
    return parts.join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  样式同步：将 textarea 的排版属性复制给 pre，使两者像素级对齐
  // ══════════════════════════════════════════════════════════════════════════
  var SYNC_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'tabSize'
  ];

  function applySyncStyles(ta, pre) {
    var cs = window.getComputedStyle(ta);
    for (var k = 0; k < SYNC_PROPS.length; k++) {
      try { pre.style[SYNC_PROPS[k]] = cs[SYNC_PROPS[k]]; } catch (e) { /* 跳过不支持的属性 */ }
    }
    // 显式宽高：跟随 textarea 尺寸（用户可拖拽调整时也会同步）
    pre.style.width           = ta.offsetWidth  + 'px';
    pre.style.height          = ta.offsetHeight + 'px';
    // 背景色继承自 textarea，保持页面原有风格
    pre.style.backgroundColor = cs.backgroundColor;
    // 透明边框（宽度与 textarea 相同，维持 box-sizing 对齐）
    pre.style.borderStyle     = 'solid';
    pre.style.borderColor     = 'transparent';
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  高亮渲染（将 textarea 内容解析并写入 pre）
  // ══════════════════════════════════════════════════════════════════════════
  var taPreMap = new WeakMap(); // textarea → pre 映射

  function renderBackdrop(ta, pre) {
    // 末尾追加 '\n ' 防止 pre 最后一行高度计算偏低导致错位
    pre.innerHTML  = tokensToHTML(tokenize(ta.value)) + '\n ';
    pre.scrollTop  = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Textarea 增强器
  //  核心：用 wrapper+pre 叠层替换原 textarea，赋予语法高亮能力
  // ══════════════════════════════════════════════════════════════════════════
  function enhanceTextarea(ta) {
    if (ta.dataset.shActive) return;
    ta.dataset.shActive = '1';

    var cs = window.getComputedStyle(ta);

    // ── 创建 wrapper div ──────────────────────────────
    var wrapper = document.createElement('div');
    wrapper.className = 'sh-wrapper';
    var disp = cs.display;
    wrapper.style.display =
      (disp === 'inline' || disp === 'inline-block' || disp === 'inline-flex')
        ? 'inline-block' : 'block';

    // 将 textarea 的外边距转移到 wrapper，避免破坏页面布局
    wrapper.style.marginTop    = cs.marginTop;
    wrapper.style.marginRight  = cs.marginRight;
    wrapper.style.marginBottom = cs.marginBottom;
    wrapper.style.marginLeft   = cs.marginLeft;
    ta.style.setProperty('margin', '0', 'important');

    ta.parentNode.insertBefore(wrapper, ta);
    wrapper.appendChild(ta);

    // ── 创建高亮背景层 pre ────────────────────────────
    var pre = document.createElement('pre');
    pre.className = 'sh-backdrop';
    pre.setAttribute('aria-hidden', 'true'); // 无障碍：屏幕阅读器忽略此元素
    wrapper.insertBefore(pre, ta);           // pre 在 DOM 中排在 ta 前（视觉上在其下方）

    taPreMap.set(ta, pre);
    applySyncStyles(ta, pre);

    // ── 让 textarea 文字透明，只保留光标和选区 ───────
    var caretColor = cs.color;
    ta.style.setProperty('color', 'transparent', 'important');
    ta.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    ta.style.setProperty('caret-color', caretColor); // 光标保持可见
    ta.style.setProperty('background',  'transparent', 'important');
    ta.style.position = 'relative';
    ta.style.zIndex   = '1';

    // ── 初始渲染 ──────────────────────────────────────
    renderBackdrop(ta, pre);

    // ── 滚动同步 ──────────────────────────────────────
    ta.addEventListener('scroll', function () {
      pre.scrollTop  = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    });

    // ── 尺寸变化同步（用户拖拽 resize 手柄时触发）───
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () {
        applySyncStyles(ta, pre);
      }).observe(ta);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SQL 自动检测
  //  策略：以 SQL 起始关键字开头，或同时包含 FROM+WHERE / JOIN+ON 组合
  // ══════════════════════════════════════════════════════════════════════════
  var SQL_START_RE = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|EXPLAIN|MERGE)\b/im;

  function isLikelySql(text) {
    if (!text || text.length < 8) return false;
    if (SQL_START_RE.test(text)) return true;
    var up = text.toUpperCase();
    if (/\bFROM\b/.test(up) && /\bWHERE\b/.test(up)) return true;
    if (/\bJOIN\b/.test(up) && /\bON\b/.test(up))    return true;
    return false;
  }

  var debounceMap = new WeakMap();

  function checkAndEnhance(ta) {
    if (!enabled || ta.dataset.shActive) return;
    if (isLikelySql(ta.value)) enhanceTextarea(ta);
  }

  // ── 为每个 textarea 挂载侦听，支持懒检测（聚焦/输入时触发）
  function setupTextarea(ta) {
    if (ta.dataset.shWatched) return;
    ta.dataset.shWatched = '1';

    // 聚焦时立即检测（页面初始已有内容的情况）
    ta.addEventListener('focus', function () {
      checkAndEnhance(ta);
    });

    // 输入时：若已激活高亮则直接渲染，否则防抖检测
    ta.addEventListener('input', function () {
      var pre = taPreMap.get(ta);
      if (pre) {
        renderBackdrop(ta, pre);
      } else {
        clearTimeout(debounceMap.get(ta));
        debounceMap.set(ta, setTimeout(function () {
          checkAndEnhance(ta);
        }, 500));
      }
    });

    // IME 输入法输入结束后也触发渲染
    ta.addEventListener('compositionend', function () {
      var pre = taPreMap.get(ta);
      if (pre) renderBackdrop(ta, pre);
    });

    // 页面加载时如果 textarea 已有内容则立即检测
    if (ta.value) checkAndEnhance(ta);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CSS 注入
  // ══════════════════════════════════════════════════════════════════════════
  function injectCSS() {
    if (document.getElementById('sh-styles')) return;
    var s = document.createElement('style');
    s.id = 'sh-styles';
    s.textContent =
      /* ── 叠层布局 ── */
      '.sh-wrapper{' +
        'position:relative!important;' +
        'vertical-align:bottom;' +           // 行内场景对齐修正
      '}' +

      '.sh-backdrop{' +
        'position:absolute!important;' +
        'top:0!important;' +
        'left:0!important;' +
        'margin:0!important;' +
        'pointer-events:none!important;' +   // 鼠标事件穿透到 textarea
        'z-index:0!important;' +
        'overflow:scroll!important;' +       // 允许 scrollTop 同步
        'scrollbar-width:none!important;' +  // 隐藏滚动条（Firefox）
        'white-space:pre-wrap!important;' +  // 与 textarea 换行一致
        'word-wrap:break-word!important;' +
        'word-break:normal!important;' +
        'text-align:left!important;' +
      '}' +

      '.sh-backdrop::-webkit-scrollbar{' +
        'display:none!important;' +          // 隐藏滚动条（Chrome/Safari）
      '}' +

      'textarea.sh-active{' +
        'position:relative!important;' +
        'z-index:1!important;' +
        'color:transparent!important;' +
        '-webkit-text-fill-color:transparent!important;' + // WebKit 额外处理
        'background:transparent!important;' +
      '}' +

      /* ── Token 颜色：亮色主题（VS Code Light 风格）── */
      '.sh-kw{ color:#0000cd; font-weight:600 }' +    // 蓝色 关键字
      '.sh-fn{ color:#7a3e9d }' +                      // 紫色 内置函数
      '.sh-str{ color:#a31515 }' +                     // 红色 字符串
      '.sh-num{ color:#098658 }' +                     // 绿色 数字
      '.sh-cmt{ color:#008000; font-style:italic }' +  // 绿色斜体 注释
      '.sh-op{ color:#555555 }' +                      // 灰色 运算符
      '.sh-id{ color:#001080 }' +                      // 深蓝色 引号标识符
      '.sh-pu{ color:#666666 }' +                      // 浅灰 标点

      /* ── Token 颜色：暗色主题（VS Code Dark 风格）── */
      '@media(prefers-color-scheme:dark){' +
        '.sh-kw{ color:#569cd6; font-weight:600 }' +
        '.sh-fn{ color:#dcdcaa }' +
        '.sh-str{ color:#ce9178 }' +
        '.sh-num{ color:#b5cea8 }' +
        '.sh-cmt{ color:#6a9955; font-style:italic }' +
        '.sh-op{ color:#d4d4d4 }' +
        '.sh-id{ color:#9cdcfe }' +
        '.sh-pu{ color:#d4d4d4 }' +
      '}';

    (document.head || document.documentElement).appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════════════════════════════════════════
  function init() {
    if (!enabled) return;

    injectCSS();

    // 扫描页面现有 textarea
    var tas = document.querySelectorAll('textarea');
    for (var i = 0; i < tas.length; i++) {
      setupTextarea(tas[i]);
    }

    // 监听动态新增的 textarea（单页应用、动态表单等场景）
    var observer = new MutationObserver(function (mutations) {
      for (var mi = 0; mi < mutations.length; mi++) {
        var added = mutations[mi].addedNodes;
        for (var ni = 0; ni < added.length; ni++) {
          var node = added[ni];
          if (node.nodeType !== 1) continue; // 只处理元素节点
          if (node.tagName === 'TEXTAREA') {
            setupTextarea(node);
          } else if (node.querySelectorAll) {
            var found = node.querySelectorAll('textarea');
            for (var fi = 0; fi < found.length; fi++) {
              setupTextarea(found[fi]);
            }
          }
        }
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree:   true
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Tampermonkey 菜单命令（点击可切换启用/禁用，刷新后生效）
  // ══════════════════════════════════════════════════════════════════════════
  GM_registerMenuCommand(
    (enabled ? '[✓ 已启用] ' : '[  已禁用] ') + 'SQL 语法高亮',
    function () {
      enabled = !enabled;
      GM_setValue(ENABLED_KEY, enabled);
      alert('SQL 语法高亮已' + (enabled ? '启用' : '禁用') + '，刷新页面后生效。');
    }
  );

  init();

})();
