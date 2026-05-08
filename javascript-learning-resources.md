遇到 JavaScript API（如 `arr.filter()`）时，推荐以下几个**权威、可靠的学习资源**，帮助你快速掌握用法和语法：


### 一、**官方/权威文档**（首选）
#### 1. **MDN Web Docs**  
   - **地址**：[MDN JavaScript 参考](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference)  
   - **特点**：  
     - **最权威**：由 Mozilla 维护，是 JavaScript 官方标准的权威解读。  
     - **详细全面**：每个 API 都有语法、参数说明、示例代码、浏览器兼容性。  
     - **中文友好**：支持中英文切换，对中文用户非常友好。  
   - **搜索技巧**：直接搜索 `Array.prototype.filter` 或 `filter MDN`。  
   - **示例**：搜索 `Array.prototype.filter` 后，会看到完整的用法说明和示例：  
     ```javascript
     const words = ['spray', 'limit', 'elite', 'exuberant'];
     const result = words.filter(word => word.length > 6);
     console.log(result); // ["exuberant"]
     ```

#### 2. **ECMAScript 规范**  
   - **地址**：[ECMA-262 规范](https://tc39.es/ecma262/)  
   - **特点**：  
     - **最底层**：JavaScript 的官方语言规范，定义了所有 API 的行为标准。  
     - **适合深入**：适合想了解底层原理的开发者（初学者可能觉得晦涩）。  


### 二、**交互式学习平台**（适合实践）
#### 1. **freeCodeCamp**  
   - **地址**：[freeCodeCamp JavaScript 课程](https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/)  
   - **特点**：  
     - **实战导向**：通过编程挑战学习 API，边学边练。  
     - **免费完整**：从基础到高级的完整课程体系。  

#### 2. **JavaScript.info**  
   - **地址**：[JavaScript.info](https://zh.javascript.info/)  
   - **特点**：  
     - **结构化清晰**：从基础到进阶的系统性教程。  
     - **示例丰富**：每个知识点都配有可运行的代码示例。  


### 三、**书籍推荐**（适合系统学习）
#### 1. 《JavaScript 高级程序设计》（第 4 版）  
   - **作者**：Nicholas C. Zakas  
   - **特点**：  
     - **经典权威**：涵盖 JavaScript 核心概念和 API，适合深入理解。  
     - **内容全面**：从基础语法到高级特性（如 Promise、async/await）。  

#### 2. 《你不知道的 JavaScript》（上中下卷）  
   - **作者**：Kyle Simpson  
   - **特点**：  
     - **深入原理**：解释 JavaScript 底层机制，帮助理解 API 设计意图。  
     - **进阶必读**：适合想突破瓶颈的开发者。  


### 四、**视频教程**（适合可视化学习）
#### 1. **YouTube 优质频道**  
   - **推荐频道**：  
     - [The Net Ninja](https://www.youtube.com/c/TheNetNinja)：清晰易懂的 JavaScript 教程。  
     - [Traversy Media](https://www.youtube.com/c/TraversyMedia)：实用的实战项目教程。  
   - **搜索关键词**：`JavaScript filter method tutorial`。  

#### 2. **B站中文教程**  
   - **推荐 UP 主**：  
     - 技术胖、尚硅谷等，搜索“JavaScript 数组方法”即可找到系统教程。  


### 五、**社区与问答**（解决具体问题）
#### 1. **Stack Overflow**  
   - **地址**：[Stack Overflow](https://stackoverflow.com/)  
   - **用法**：搜索具体问题，如 `javascript array filter example`。  
   - **技巧**：问题描述要清晰，附上代码示例，更容易获得高质量回答。  

#### 2. **SegmentFault / 掘金**（中文社区）  
   - **地址**：[SegmentFault](https://segmentfault.com/)、[掘金](https://juejin.cn/)  
   - **特点**：中文技术社区，适合搜索国内开发者的经验分享和实战案例。  


### 六、**快速查询技巧**
#### 1. **搜索引擎直接搜索**  
   - **关键词格式**：`JavaScript filter 用法`、`arr.filter() 语法`。  
   - **优先选择**：MDN、掘金、CSDN 等权威网站的结果。  

#### 2. **IDE 内置文档**  
   - **VS Code**：将鼠标悬停在 API 上，会显示快速提示（需要安装 JavaScript 插件）。  
   - **示例**：悬停在 `filter` 上，会显示参数、返回值和简短示例。  


### 总结：学习路径建议
1. **遇到 API 先查 MDN**：获取最权威的用法说明。  
2. **看示例代码**：通过具体例子理解如何使用。  
3. **动手实践**：在控制台或项目中尝试调用 API，观察结果。  
4. **深入原理**：如果需要深入理解，参考 ECMAScript 规范或进阶书籍。  

**推荐优先级**：  
`MDN Web Docs` > `JavaScript.info` > `freeCodeCamp` > `书籍` > `视频教程`  

下次遇到新 API 时，先去 MDN 搜索，通常能快速找到答案！