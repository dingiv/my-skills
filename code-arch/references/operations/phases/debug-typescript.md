# 调试：TypeScript

> **TypeScript 的类型系统是调试第一道防线——但运行期问题（异步、闭包、副作用）靠运行时工具。** 主要工具链：tsc + Node 调试器 + Chrome DevTools。

## 一句话

> **TS 调试 = 类型先榨干（tsc + eslint）→ 测试覆盖 → console/断点 → 异步栈 → Chrome DevTools。**

## 何时使用

- TypeScript 编译错误
- 运行时错误（Uncaught Error、Promise rejection）
- 行为不符合预期
- 异步问题（callback hell、Promise 链断裂）
- 类型推导失败
- 性能问题（首屏、运行时）
- 测试用例失败

## 编译期（第一道防线）

### tsc 编译错

```bash
# 看完整错误
npx tsc --noEmit

# 详细解释
npx tsc --explainFiles
npx tsc --listFiles

# 监视模式（开发时）
npx tsc --watch
```

**核心原则**：

- TS 错误常常是类型不匹配——看 expected vs actual
- 看相关行号（TS 错误经常跨多行）
- `unknown` 是新代码的默认起点（不要直接 `any`）

### 类型推导失败

```typescript
// 显式标注让 TS 帮你
function process(x: string | number): string {
  if (typeof x === "string") return x;
  return String(x);
}
```

### ESLint

```bash
npx eslint src/
npx eslint src/ --fix   # 自动修
```

## 运行期

### console.log 系列

```typescript
console.log("debug:", x);
console.error("err:", x);       // stderr
console.warn("warn:", x);
console.trace();                // 当前栈
console.table(arr);             // 数组 / 对象表格
console.group("loop");          // 分组
  console.log(i);
console.groupEnd();
console.time("label");          // 计时
doWork();
console.timeEnd("label");
```

**坑**：

- `console.log(obj)` 默认浅打印——深层对象看不到
- 大对象 / 循环里打印会卡——必要时用 `JSON.stringify`
- 生产环境必须**移除**或用 logger（pino / winston）

### debugger 关键字

```typescript
function foo() {
  debugger;  // 浏览器 / Node 看到调试器就暂停
}
```

**优势**：不需要启动 IDE 调试器，浏览器 DevTools 直接接住

### Node 调试

```bash
# 内置（Node 8+）
node --inspect-brk dist/main.js
# 输出: chrome://inspect 接 chrome DevTools

# 监视 + 重启
node --watch dist/main.js

# 监视模式 + 调试
node --watch --inspect-brk dist/main.js
```

### 日志库（生产级）

```typescript
// pino（高性能）
import pino from "pino";
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
logger.debug({ userId }, "processing");

// winston（功能多）
import winston from "winston";
const logger = winston.createLogger({ level: "debug" });
```

## 调试器（VS Code / Chrome DevTools）

### VS Code 调试（推荐）

`.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug main",
      "program": "${workspaceFolder}/dist/main.js",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "sourceMaps": true
    }
  ]
}
```

**核心能力**：

- 断点（条件断点 / 日志断点 / 函数断点）
- 单步（step over / step into / step out）
- 监视变量
- 调用栈
- 调试控制台（直接 eval）

### Chrome DevTools

```bash
# Node 接 Chrome
node --inspect-brk dist/main.js
# 打开 chrome://inspect，点 "inspect"
```

**适用**：前端代码、Node 服务、worker

## 异步调试

### Promise 链断裂

```typescript
// 反模式：catch 吃错
promise.catch(() => {});

// 正解：catch 至少 log
promise.catch((err) => console.error("err:", err));
```

### async/await 调试

```typescript
async function foo() {
  try {
    const result = await someAsync();  // 断点设这里
    return result;
  } catch (err) {
    console.error("foo failed:", err);  // 错误也要 log
  }
}
```

### 异步栈跟踪

```bash
# Node 默认有异步栈（Node 16+）
node --async-stack-traces dist/main.js

# 或在代码里
Error.stackTraceLimit = 50;
```

### 死锁 / 永不 resolve

- 检查所有 `Promise.race` / `Promise.all` 的输入
- 用 `setTimeout` 包一层看是否真的 hang：
  ```typescript
  await Promise.race([
    doWork(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
  ]);
  ```

## 性能

### Chrome DevTools Performance

1. F12 → Performance 标签
2. 点录制
3. 操作你的应用
4. 停止，看火焰图
5. 看主线程任务 + 长任务 + 帧渲染

### Lighthouse（前端）

```bash
npx lighthouse https://example.com --view
```

### Node 性能

```bash
# CPU 火焰图（0x）
npm i -g 0x
0x dist/main.js

# 内置 profiler
node --prof dist/main.js
node --prof-process isolate-*.log > processed.txt
```

### 基准测试

```typescript
// tinybench
import { Bench } from "tinybench";
const bench = new Bench();
bench.add("case 1", () => myFn());
await bench.run();
```

## 测试

### Jest

```typescript
test("add", () => {
  expect(add(2, 3)).toBe(5);
});

test("async", async () => {
  await expect(fetchData()).resolves.toMatchObject({ id: 1 });
});
```

### Vitest（更快，原生 ESM）

```typescript
import { expect, test } from "vitest";

test("add", () => {
  expect(add(2, 3)).toBe(5);
});
```

### 运行

```bash
npx jest
npx jest test/foo.test.ts          # 单文件
npx jest --watch                   # 监视
npx jest --coverage                 # 覆盖率
```

## 静态分析

### ESLint

```bash
npx eslint .
npx eslint . --fix
```

**常用规则**：

- `@typescript-eslint/no-unused-vars`
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-floating-promises`（**关键**——catch 未处理的 Promise）

### tsc 严格模式

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## 编辑器集成

### TypeScript Language Server

VS Code、Neovim、IntelliJ 都内置或可装。

**核心能力**：

- 实时类型检查
- 跳转到定义 / 实现
- 重命名（跨文件）
- inline hint（变量类型）
- 自动 import

### 常用快捷键

- `F12` 跳转到定义
- `Shift+F12` 查找引用
- `F2` 重命名
- `Ctrl+.` 快速修复（quick fix）

## 环境配置

### 开发环境

```bash
# 安装 Node（用 nvm / fnm）
nvm install 20
nvm use 20

# 全局工具
npm i -g typescript ts-node nodemon
```

### tsconfig.json 模板

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### package.json scripts

```json
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "start": "node dist/main.js",
    "dev": "ts-node src/main.ts",
    "test": "vitest",
    "test:watch": "vitest --watch",
    "lint": "eslint ."
  }
}
```

## 常见 bug 速查

| 现象 | 排查方向 |
| --- | --- |
| `Cannot find module` | 路径错 / 没装 / tsconfig paths |
| `Type X is not assignable to Y` | 类型不匹配——看 expected vs actual |
| `Cannot read property of undefined` | null check——`?.` / `if (x)` |
| `Promise rejection unhandled` | 没 catch——`no-floating-promises` 规则 |
| `CORS error` | 服务端 header / 代理配置 |
| `TS2304: Cannot find name 'X'` | import 漏 / 命名空间 |
| `Hook 死循环` | useEffect 依赖错 / setState 在 render 里 |
| `this is undefined` | 箭头函数 / bind / class fields |
| 异步循环中部分完成 | 串行 await vs Promise.all 选错 |

## 一句话

> **TS 调试 = 类型先榨干（tsc strict + eslint）→ 测试覆盖 → console/debugger → 异步栈 → Chrome DevTools。**