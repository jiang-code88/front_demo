// JavaScript 学习清单示例代码
// 包含语言基础和函数与作用域的所有知识点

// ========== 第一阶段：语言基础 ==========

// ========== 1. 变量声明：var、let、const 的区别与作用域 ==========
console.log("=== 变量声明示例 ===");

// var 声明
var a = 10;
var a = 20; // 可以重复声明
console.log("var 重复声明后的值:", a); // 输出 20

// 函数作用域
function testVar() {
  var b = 30;
  if (true) {
    var b = 40; // 同一函数作用域内，覆盖外部的 b
    console.log("函数内 if 块中的 b:", b); // 输出 40
  }
  console.log("函数内的 b:", b); // 输出 40
}
testVar();

// let 声明
let c = 50;
// let c = 60; // 不能重复声明，会报错

// 块级作用域
if (true) {
  let d = 70;
  console.log("if 块中的 d:", d); // 输出 70
}
// console.log("if 块外的 d:", d); // 会报错，d 只在块内有效

// const 声明
const e = 80;
// e = 90; // 不能修改值，会报错

// const 声明对象
const obj = { name: "张三" };
obj.name = "李四"; // 可以修改对象属性
console.log("修改后的 obj:", obj); // 输出 { name: '李四' }


// ========== 2. 数据类型：基本类型和引用类型 ==========
console.log("\n=== 数据类型示例 ===");

// 基本类型
const str = "Hello"; // string
const num = 123; // number
const bool = true; // boolean
const n = null; // null
const undef = undefined; // undefined
const sym = Symbol("test"); // symbol
const big = 123n; // bigint

console.log("string:", str);
console.log("number:", num);
console.log("boolean:", bool);
console.log("null:", n);
console.log("undefined:", undef);
console.log("symbol:", sym);
console.log("bigint:", big);

// 引用类型
const arr = [1, 2, 3]; // array (object)
const obj2 = { age: 20 }; // object
const func = function() {}; // function (object)

console.log("array:", arr);
console.log("object:", obj2);
console.log("function:", func);


// ========== 3. 类型判断：typeof、instanceof、Object.prototype.toString ==========
console.log("\n=== 类型判断示例 ===");

console.log("typeof 'Hello':", typeof "Hello"); // string
console.log("typeof 123:", typeof 123); // number
console.log("typeof true:", typeof true); // boolean
console.log("typeof null:", typeof null); // object (历史遗留问题)
console.log("typeof undefined:", typeof undefined); // undefined
console.log("typeof Symbol():", typeof Symbol()); // symbol
console.log("typeof 123n:", typeof 123n); // bigint
console.log("typeof []:", typeof []); // object
console.log("typeof {}:", typeof {}); // object
console.log("typeof function():", typeof function() {}); // function

console.log("\ninstanceof 示例:");
console.log("[] instanceof Array:", [] instanceof Array); // true
console.log("{} instanceof Object:", {} instanceof Object); // true
console.log("function() {} instanceof Function:", function() {} instanceof Function); // true

console.log("\nObject.prototype.toString 示例:");
console.log(Object.prototype.toString.call("Hello")); // [object String]
console.log(Object.prototype.toString.call(123)); // [object Number]
console.log(Object.prototype.toString.call(true)); // [object Boolean]
console.log(Object.prototype.toString.call(null)); // [object Null]
console.log(Object.prototype.toString.call(undefined)); // [object Undefined]
console.log(Object.prototype.toString.call(Symbol())); // [object Symbol]
console.log(Object.prototype.toString.call(123n)); // [object BigInt]
console.log(Object.prototype.toString.call([])); // [object Array]
console.log(Object.prototype.toString.call({})); // [object Object]
console.log(Object.prototype.toString.call(function() {})); // [object Function]


// ========== 4. 运算符：算术、比较、逻辑、三元、短路运算 ==========
console.log("\n=== 运算符示例 ===");

// 算术运算符
console.log("算术运算符:");
console.log("1 + 2:", 1 + 2); // 3
console.log("5 - 3:", 5 - 3); // 2
console.log("2 * 4:", 2 * 4); // 8
console.log("10 / 2:", 10 / 2); // 5
console.log("10 % 3:", 10 % 3); // 1
console.log("++1:", ++1); // 2
console.log("1++:", 1++); // 1 (先使用后自增)

// 比较运算符
console.log("\n比较运算符:");
console.log("1 == '1':", 1 == '1'); // true (类型转换)
console.log("1 === '1':", 1 === '1'); // false (严格比较)
console.log("5 > 3:", 5 > 3); // true
console.log("5 < 3:", 5 < 3); // false
console.log("5 >= 5:", 5 >= 5); // true
console.log("5 <= 3:", 5 <= 3); // false
console.log("NaN == NaN:", NaN == NaN); // false (特殊情况)

// 逻辑运算符
console.log("\n逻辑运算符:");
console.log("true && false:", true && false); // false
console.log("true || false:", true || false); // true
console.log("!true:", !true); // false

// 三元运算符
console.log("\n三元运算符:");
const age = 18;
const status = age >= 18 ? "成年人" : "未成年人";
console.log("年龄状态:", status); // 成年人

// 短路运算
console.log("\n短路运算:");
const a1 = 0 || "默认值"; // 0 为假值，返回 "默认值"
const b1 = "有值" || "默认值"; // "有值" 为真值，返回 "有值"
const c1 = 1 && "后面的值"; // 1 为真值，返回 "后面的值"
const d1 = 0 && "后面的值"; // 0 为假值，返回 0
console.log("a1:", a1);
console.log("b1:", b1);
console.log("c1:", c1);
console.log("d1:", d1);


// ========== 5. 显式与隐式类型转换 ==========
console.log("\n=== 类型转换示例 ===");

// 显式类型转换
console.log("显式类型转换:");
console.log("Number('123'):", Number('123')); // 123
console.log("String(123):", String(123)); // "123"
console.log("Boolean(0):", Boolean(0)); // false
console.log("Boolean(''):", Boolean('')); // false
console.log("Boolean(null):", Boolean(null)); // false
console.log("Boolean(undefined):", Boolean(undefined)); // false
console.log("Boolean(NaN):", Boolean(NaN)); // false
console.log("Boolean(1):", Boolean(1)); // true
console.log("Boolean('Hello'):", Boolean('Hello')); // true

// 隐式类型转换
console.log("\n隐式类型转换:");
console.log("'1' + 2:", '1' + 2); // "12" (字符串拼接)
console.log("1 + '2':", 1 + '2'); // "12" (字符串拼接)
console.log("1 - '2':", 1 - '2'); // -1 (减法会转换为数字)
console.log("'123' * 2:", '123' * 2); // 246 (乘法会转换为数字)
console.log("+'123':", +'123'); // 123 (一元加号转换为数字)
console.log("!'Hello':", !'Hello'); // false (非运算转换为布尔值)
console.log("!!'Hello':", !!'Hello'); // true (双重非运算转换为布尔值)


// ========== 6. 流程控制：if...else、switch、循环 ==========
console.log("\n=== 流程控制示例 ===");

// if...else
console.log("if...else 示例:");
const score = 85;
if (score >= 90) {
  console.log("优秀");
} else if (score >= 80) {
  console.log("良好");
} else if (score >= 60) {
  console.log("及格");
} else {
  console.log("不及格");
}

// switch
console.log("\nswitch 示例:");
const day = 3;
switch (day) {
  case 1:
    console.log("星期一");
    break;
  case 2:
    console.log("星期二");
    break;
  case 3:
    console.log("星期三");
    break;
  default:
    console.log("其他天");
}

// for 循环
console.log("\nfor 循环示例:");
for (let i = 0; i < 5; i++) {
  console.log("for 循环 i:", i);
}

// while 循环
console.log("\nwhile 循环示例:");
let j = 0;
while (j < 3) {
  console.log("while 循环 j:", j);
  j++;
}

// do...while 循环
console.log("\ndo...while 循环示例:");
let k = 0;
do {
  console.log("do...while 循环 k:", k);
  k++;
} while (k < 3);

// for...of 循环 (遍历可迭代对象)
console.log("\nfor...of 循环示例:");
const arr2 = [1, 2, 3];
for (const item of arr2) {
  console.log("for...of 循环 item:", item);
}

// for...in 循环 (遍历对象属性)
console.log("\nfor...in 循环示例:");
const obj3 = { name: "张三", age: 20 };
for (const key in obj3) {
  console.log("for...in 循环 key:", key, "value:", obj3[key]);
}


// ========== 7. 基础调试：console 对象、debugger 语句 ==========
console.log("\n=== 基础调试示例 ===");

// console 对象
console.log("console.log: 普通日志");
console.warn("console.warn: 警告日志");
console.error("console.error: 错误日志");
console.info("console.info: 信息日志");

// console.table
const users = [
  { name: "张三", age: 20 },
  { name: "李四", age: 25 }
];
console.table(users);

// console.group
console.group("分组开始");
console.log("分组内的日志 1");
console.log("分组内的日志 2");
console.groupEnd();

// debugger 语句 (执行到这里会暂停)
// debugger;


// ========== 第二阶段：函数与作用域 ==========

// ========== 1. 函数声明、函数表达式、箭头函数的区别 ==========
console.log("\n=== 函数类型示例 ===");

// 函数声明
function add(a, b) {
  return a + b;
}
console.log("函数声明 add(1, 2):", add(1, 2)); // 3

// 函数表达式
const subtract = function(a, b) {
  return a - b;
};
console.log("函数表达式 subtract(5, 2):", subtract(5, 2)); // 3

// 箭头函数
const multiply = (a, b) => a * b;
console.log("箭头函数 multiply(3, 4):", multiply(3, 4)); // 12

// 箭头函数与 this 指向
console.log("\n箭头函数 this 指向示例:");
const obj4 = {
  name: "张三",
  sayName1: function() {
    console.log("函数声明 this.name:", this.name); // 张三
  },
  sayName2: () => {
    console.log("箭头函数 this.name:", this.name); // undefined (指向全局对象)
  }
};
obj4.sayName1();
obj4.sayName2();


// ========== 2. 参数：默认值、剩余参数、arguments 对象 ==========
console.log("\n=== 函数参数示例 ===");

// 默认参数
function greet(name = "陌生人") {
  console.log("默认参数 greet():", `Hello, ${name}!`);
}
greet(); // Hello, 陌生人!
greet("张三"); // Hello, 张三!

// 剩余参数
function sum(...numbers) {
  return numbers.reduce((total, num) => total + num, 0);
}
console.log("剩余参数 sum(1, 2, 3, 4):", sum(1, 2, 3, 4)); // 10

// arguments 对象 (仅在函数声明和函数表达式中可用)
function showArgs() {
  console.log("arguments 对象:", arguments);
  console.log("arguments[0]:", arguments[0]);
}
showArgs(1, "hello", true);


// ========== 3. 作用域与作用域链 ==========
console.log("\n=== 作用域示例 ===");

// 全局作用域
const globalVar = "全局变量";

function outer() {
  // 函数作用域
  const outerVar = "外部函数变量";
  
  function inner() {
    // 函数作用域
    const innerVar = "内部函数变量";
    console.log("内部函数访问:", globalVar, outerVar, innerVar);
  }
  
  inner();
  // console.log(innerVar); // 会报错，innerVar 只在 inner 函数内有效
}

outer();
// console.log(outerVar); // 会报错，outerVar 只在 outer 函数内有效

// 块级作用域
if (true) {
  const blockVar = "块级变量";
  console.log("块内访问 blockVar:", blockVar);
}
// console.log(blockVar); // 会报错，blockVar 只在块内有效


// ========== 4. 变量提升与暂时性死区 ==========
console.log("\n=== 变量提升示例 ===");

// var 变量提升
console.log("var 变量提升:", varVar); // undefined (变量提升，但未赋值)
var varVar = "var 变量";
console.log("var 变量赋值后:", varVar); // var 变量

// let 和 const 不会变量提升，存在暂时性死区
// console.log("let 变量提升:", letVar); // 会报错，暂时性死区
let letVar = "let 变量";
console.log("let 变量赋值后:", letVar); // let 变量

// 函数声明会变量提升
console.log("函数声明提升:", hoistedFunc()); // 函数被提升
function hoistedFunc() {
  return "函数被提升";
}

// 函数表达式不会变量提升
// console.log("函数表达式提升:", nonHoistedFunc()); // 会报错，nonHoistedFunc 是 undefined
const nonHoistedFunc = function() {
  return "函数表达式";
};
console.log("函数表达式赋值后:", nonHoistedFunc()); // 函数表达式


// ========== 5. 闭包的概念、原理及实际应用 ==========
console.log("\n=== 闭包示例 ===");

// 闭包基本示例
function createCounter() {
  let count = 0; // 私有变量
  
  return {
    increment: function() {
      count++;
      return count;
    },
    decrement: function() {
      count--;
      return count;
    },
    getCount: function() {
      return count;
    }
  };
}

const counter = createCounter();
console.log("闭包 - 初始 count:", counter.getCount()); // 0
console.log("闭包 - 增加后:", counter.increment()); // 1
console.log("闭包 - 增加后:", counter.increment()); // 2
console.log("闭包 - 减少后:", counter.decrement()); // 1

// 函数工厂
function createMultiplier(factor) {
  return function(number) {
    return number * factor;
  };
}

const double = createMultiplier(2);
const triple = createMultiplier(3);
console.log("闭包 - 函数工厂 double(5):", double(5)); // 10
console.log("闭包 - 函数工厂 triple(5):", triple(5)); // 15


// ========== 6. 立即调用函数表达式（IIFE） ==========
console.log("\n=== IIFE 示例 ===");

// 基本 IIFE
(function() {
  const privateVar = "私有变量";
  console.log("IIFE 内部:", privateVar);
})();
// console.log(privateVar); // 会报错，privateVar 是 IIFE 内部的私有变量

// IIFE 带参数
(function(name) {
  console.log("IIFE 带参数:", `Hello, ${name}!`);
})("张三");

// IIFE 返回值
const result = (function(a, b) {
  return a + b;
})(10, 20);
console.log("IIFE 返回值:", result); // 30


// ========== 7. 回调函数与高阶函数 ==========
console.log("\n=== 回调函数与高阶函数示例 ===");

// 回调函数
function fetchData(callback) {
  setTimeout(() => {
    const data = "获取的数据";
    callback(data);
  }, 1000);
}

console.log("开始获取数据...");
fetchData(function(data) {
  console.log("回调函数接收到数据:", data);
});

// 高阶函数
function higherOrderFunction(func) {
  return function() {
    console.log("高阶函数执行前");
    const result = func.apply(this, arguments);
    console.log("高阶函数执行后");
    return result;
  };
}

const enhancedAdd = higherOrderFunction(add);
console.log("高阶函数增强的 add(3, 4):", enhancedAdd(3, 4));


// ========== 8. this 指向规则以及 call、apply、bind ==========
console.log("\n=== this 指向示例 ===");

// this 指向规则
const obj5 = {
  name: "张三",
  sayName: function() {
    console.log("方法中的 this.name:", this.name);
  }
};
obj5.sayName(); // 张三 (this 指向 obj5)

// 独立函数调用
const sayName = obj5.sayName;
sayName(); // undefined (this 指向全局对象)

// call 方法
console.log("\ncall 方法示例:");
const obj6 = { name: "李四" };
obj5.sayName.call(obj6); // 李四 (this 指向 obj6)

// apply 方法
console.log("\napply 方法示例:");
obj5.sayName.apply(obj6); // 李四 (this 指向 obj6)

// bind 方法
console.log("\nbind 方法示例:");
const boundSayName = obj5.sayName.bind(obj6);
boundSayName(); // 李四 (this 指向 obj6)

// call 和 apply 传递参数
function introduce(name, age) {
  console.log(`我是 ${name}，今年 ${age} 岁`);
}
introduce.call(null, "张三", 20); // 我是 张三，今年 20 岁
introduce.apply(null, ["李四", 25]); // 我是 李四，今年 25 岁
