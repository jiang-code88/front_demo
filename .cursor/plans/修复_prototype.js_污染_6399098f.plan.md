---
name: 修复 Prototype.js 污染
overview: 改为直接传对象给 GM_setValue / GM_getValue，完全绕过页面 JS 上下文的 JSON.stringify，从根本上规避 Prototype.js 对 Array.prototype.toJSON 的污染。
todos:
  - id: fix-storage
    content: 改写 getData / saveData：GM_setValue 直接存对象，GM_getValue 直接取对象，兼容旧字符串格式做一次自动迁移
    status: completed
  - id: remove-logs
    content: 移除 getData 和 addItem 中所有调试埋点（#region agent log 块）
    status: completed
isProject: false
---

# 修复 Prototype.js Array.prototype.toJSON 污染（GM 原生方案）

## 根因

```
页面加载 Prototype.js
  → Array.prototype.toJSON 被注入（返回拼接字符串）
  → saveData 调用 JSON.stringify(data)
  → stringify 发现数组有 toJSON，调用之，得到字符串
  → 外层 stringify 将字符串二次转义
  → GM 存储写入错误格式
```

## 为什么 GM 原生方案能根治

Tampermonkey 的 `GM_setValue` / `GM_getValue` 在扩展的 **background page** 内部完成序列化，完全独立于页面的 JS 上下文。无论页面如何污染 `Array.prototype`，TM 后台看到的都是干净的原生对象，不会触发 `toJSON`。

## 修改方案（仅改 getData / saveData）

文件：`[tampermonkey-autofill.user.js](tampermonkey-autofill.user.js)`

### saveData（第 121-124 行）

去掉 `JSON.stringify`，直接传对象：

```js
function saveData(data) {
  GM_setValue(STORAGE_KEY, data);
}
```

### getData（第 100-115 行）

直接取对象；保留对旧字符串格式的兼容（存量数据自动一次性迁移）

```js
：function getData() {
  var raw = GM_getValue(STORAGE_KEY, null);
  if (!raw) return {};
  if (typeof raw === 'string') {
    // 兼容旧版 JSON 字符串格式，读取后下次 saveData 会自动迁移为对象
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  return (typeof raw === 'object') ? raw : {};
}
```

### 迁移路径

```
旧数据（GM 存储的是 JSON 字符串）
  → getData 识别 typeof raw === 'string'，用 JSON.parse 读取
  → 业务逻辑照常运行
  → 下一次 saveData 调用，以对象形式写回
  → 迁移完成，之后 getData 走 typeof raw === 'object' 分支
```

## 移除调试埋点

移除 `getData` 和 `addItem` 中所有 `// #region agent log ... // #endregion` 代码块（共 5 处 fetch 调用）。