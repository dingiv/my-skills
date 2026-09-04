# 脏函数的三种形态

> 对应 SKILL.md 第 11 条。本 reference 给出每种形态的脏→干净代码示例。

## 形态 1：隐式参数

函数从外部作用域捕获变量——包括 `const` 容器（容器内容可变）。依赖被藏进闭包，签名不可见。

```ts
const cache = new Map<string, Data[]>()
let retryCount = 0

// ❌ 脏：隐式捕获 cache 和 retryCount
export function loadData(key: string): Data[] {
  const cached = cache.get(key)
  if (cached) return cached
  retryCount++
  const data = fetchFromRemote(key)
  cache.set(key, data)
  return data
}

// ✅ 干净：cache 和计数器都参数化 —— 签名即契约
export function loadData(
  key: string,
  cache: Map<string, Data[]>,
  stats: { retryCount: number },
): Data[] {
  const cached = cache.get(key)
  if (cached) return cached
  stats.retryCount++
  const data = fetchFromRemote(key)
  cache.set(key, data)
  return data
}
// 调用方负责持有 cache 和 stats 的生命周期（见第 7、10 条）
```

> 识别信号：函数体内引用了不在参数列表中的、来自外部作用域的变量。

## 形态 2：修改参数

函数通过入参修改了复杂类型变量的内部数据——副作用沿引用链"泄漏"回调用方。

```ts
interface User {
  id: string
  status: 'active' | 'inactive'
  activatedAt: number | null
}

// ❌ 脏：直接改传入对象的内部字段，调用方的 user 被"远程篡改"
function activateUser(user: User) {
  user.status = 'active'
  user.activatedAt = Date.now()
}

// ✅ 干净：返回新对象，不改入参
function activateUser(user: User): User {
  return { ...user, status: 'active', activatedAt: Date.now() }
}

// ✅ 或者：如果必须"原地更新"（如受控全局中的共享容器），走语义钩子
// 见 references/controlled-global-state.md 中的 updateRegistryItem
```

> 识别信号：函数体对入参做了 `obj.prop =` 或 `arr.push/splice` 等写操作。

## 形态 3：IO 函数

函数访问了进程外数据——网络、文件系统、数据库、`localStorage`、`sessionStorage`、`IndexedDB`、`console`（写入端）、`process.env`（写入端）等。

```ts
// ❌ 脏：IO 嵌在业务逻辑里，测试要 mock 网络层，也锁死了数据通路
function processOrder(order: Order) {
  const result = computeTotal(order)
  fetch('/api/orders', { method: 'POST', body: JSON.stringify(result) })
}

// ✅ 干净：计算与 IO 分离
function computeOrderTotal(order: Order): OrderResult {
  return computeTotal(order) // 纯计算，可单测
}
// IO 放进带生命周期的模块（见第 4、5 条及 references/patterns.md）
```

> 识别信号：函数体内有 `fetch`、`fs.*`、数据库驱动调用、`localStorage.setItem` 等"出进程"的操作。

## 三重脏函数的解构示例

一个函数同时触碰三种形态——拆解过程就是本风格的核心手法。

```ts
// ❌ 三重脏：
//   ① 隐式参数：捕获 config
//   ② 修改参数：改了 report.summary
//   ③ IO：fetch 发送请求
const config = { endpoint: '/api/report', timeout: 5000 }

async function submitReport(report: Report) {
  report.summary = report.body.slice(0, 100) // 修改参数
  await fetch(config.endpoint, {              // IO + 隐式参数
    method: 'POST',
    body: JSON.stringify(report),
  })
}

// ✅ 解构后：
//   纯计算 → 不碰任何"脏"
//   IO 模块 → 用 init/destroy 管网络生命周期
function buildSummary(report: Report): string {
  return report.body.slice(0, 100) // 纯：只读入参，返回新值
}

function createReporter(endpoint: string) {
  let ready = true
  return {
    async submit(summary: string, body: string) {
      await fetch(endpoint, { method: 'POST', body: JSON.stringify({ summary, body }) })
    },
    destroy() { ready = false },
  }
}
// 调用方：
//   const reporter = createReporter(config.endpoint)
//   const summary = buildSummary(report)
//   await reporter.submit(summary, report.body)
//   reporter.destroy()
```

> 核心思路：把三种脏形态各自拆到独立的边界里——纯计算只管数据、IO 模块管生命周期、配置经参数注入——脏仍然存在，但脏在了明处，脏在了可控的边界内。

---

## 可原谅的副作用

无法完全消灭脏函数，但可以选择原谅**不增加逻辑复杂度**的副作用，换取开发自由度。

### 1. 私有闭包

一个闭包函数**独占**了一个外部变量——除该函数外，没有任何其他代码能访问它。此时这个外部变量可以视为函数的「私有状态」，副作用被封闭在函数边界内。

```ts
// ✅ 可原谅：memoize 的内部 cache 被返回的函数独享
function memoize<T>(fn: (key: string) => T): (key: string) => T {
  const cache = new Map<string, T>() // 私有闭包状态
  return (key: string) => {
    if (!cache.has(key)) cache.set(key, fn(key))
    return cache.get(key)!
  }
}

// ✅ 可原谅：throttle 的 timer 被返回的函数独享
function throttle(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) return
    timer = setTimeout(() => { fn(); timer = null }, ms)
  }
}
```

> 判据：这个外部变量还能被其他函数访问到吗？不能 → 私有闭包，可原谅。JS 单线程下无需考虑并发。

### 2. 局部变量

函数内部创建了一个变量，在初始化阶段对其实施了多次修改——这是函数内部的**创建过程**，不影响外界。只要变量引用不泄漏到函数外部，就不算脏。

```ts
// ✅ 可原谅：builder 在函数内部创建、修改、最终返回结果
function buildReport(items: Item[]): Report {
  const report: Report = { summary: '', items: [] } // 局部创建
  for (const item of items) {
    report.items.push(item) // 局部修改——初始化阶段的正常操作
  }
  report.summary = report.items.map(i => i.name).join(', ')
  return report // 只返回结果，不返回 report 引用（返回的是值拷贝或新对象）
}
```

> 判据：函数是否泄漏了内部创建的可变对象的引用给外界？没有 → 局部变量，可原谅。

### 3. 独立 IO

日志打印、调试输出、埋点上报——这些操作不影响程序的主体逻辑，失败了也不该让主流程崩溃。把它们视为"可原谅的旁路"。

```ts
// ✅ 可原谅：logger 独立于业务逻辑，失败了不影响主流程
function processOrder(order: Order): OrderResult {
  const result = computeTotal(order)
  logger.info('order processed', { id: order.id, total: result.total }) // 独立 IO
  return result
}
```

> 判据：去掉这行 IO，程序的正确性不受影响吗？是 → 独立 IO，可原谅。注意：`console.log` 在 Node 中是同步 IO，高频调用仍会影响性能——原谅归原谅，别滥用。

---

## 声明式 IO：把副作用变成纯数据

一种比 `AsyncResult` 更强的隔离手段：**将 IO 动作描述为一个纯数据结构，交给独立的解释器执行**。描述「要做什么」的代码是纯的，真正「执行」的代码被推到最外层。

```ts
// Step 1: 把 IO 定义为纯数据结构（action descriptor）
interface ReadAction {
  type: 'read'
  path: string
  encoding: string
}
interface WriteAction {
  type: 'write'
  path: string
  data: string
}
type FileAction = ReadAction | WriteAction

// Step 2: 业务函数返回 action，不执行 IO（纯函数）
function prepareConfig(): FileAction {
  return { type: 'read', path: '/etc/config.json', encoding: 'utf-8' }
}

// Step 3: 解释器在边界执行 IO（唯一的脏函数）
async function executeAction(action: FileAction): Promise<string | void> {
  switch (action.type) {
    case 'read':
      return fs.readFileSync(action.path, action.encoding)
    case 'write':
      return fs.writeFileSync(action.path, action.data)
  }
}

// Step 4: main 是唯一的脏函数——组装 action 并交给解释器
async function main() {
  const action = prepareConfig()          // 纯：只产出数据
  const content = await executeAction(action) // 脏：在边界执行
  // … 后续纯逻辑处理 content …
}
```

> 这一步比 `Ret.async(fetch(...))` 更进一步——不只是 catch 错误，而是把「是否要执行 IO / 何时执行 / 以什么顺序执行」的决策从业务逻辑中剥离出去。`prepareConfig` 是纯函数，可单测、可缓存、可组合；`executeAction` 是唯一的脏函数，放在边界。

## 目标图像：除了 main，其他都是纯函数

一个程序的理想状态：

```
main()  ← 唯一的脏函数（组装、执行 IO、初始化/销毁生命周期）
  ├── 纯函数 A → 纯函数 B → 纯函数 C  （业务逻辑链：纯数据变换）
  ├── executeAction(...)                （脏：IO 被推到边界执行）
  └── initXxx / destroyXxx              （脏：生命周期管理也在边界）
```

实际工程中很难完全做到，但这个方向是明确的：**尽量把脏推到 main，尽量让业务逻辑保持纯**。每当你把一段 IO 从业务函数中抽出来、放进 `main` 或 `executeAction`，你就在向这个方向靠近一步。
