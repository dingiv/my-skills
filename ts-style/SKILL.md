---
name: ts-style
description: JS/TS 项目的模块设计风格，主张「面向数据的作用域 + 显式生命周期」。在以下场景推荐遵循——在 JS/TS 项目中创建新模块/新类、定义 interface 或 type、实现带副作用的功能（事件订阅、定时器、WebSocket、数据库/连接句柄、Canvas、Web Worker、IndexedDB、Stream、缓存、观察者等）、或重构现有模块结构。推荐做法——用纯数据 interface 表达状态、用多个可组合的动作 interface 表达行为、对外只暴露 interface、用 createXxx() 工厂函数创建并隐藏实现、构造函数保持纯无副作用、用 destroyXxx() 显式释放资源。无 IOC 容器即可满足 SOLID。关键词：lifecycle、data-oriented、scope、factory、destroy、dispose、interface composition、dependency inversion、SOLID、module style、生命周期、依赖倒置、作用域。
---

# 面向数据的作用域 + 生命周期编程

JS/TS 项目**推荐**的模块风格。新建模块、定义类型、实现有副作用的功能时，默认按这套来；重构现有代码时也主动向这套靠拢。

> 这是一套推荐风格，不是硬性约束。默认遵循；当它与具体场景的需求明显冲突时，再以工程判断取舍——但那种例外值得在代码或注释里说明理由。

## 一句话

> 状态用纯数据 interface 表达，行为用多个小接口组合表达；对外只暴露 interface，实现类用工厂创建、用销毁函数释放。不靠 IOC 容器，照样满足 SOLID。

---

## 一、模块契约：用 interface 定义边界

**1. 状态 = 纯数据 interface。** 对外契约是一个 interface，其字段只描述数据（`name: string`、`age: number`），不包含实现细节，跨实例的内部状态不应出现在契约上。字段默认加 `readonly`，防止消费方意外修改。

**2. 行为 = 可组合的动作 interface。** 把方法按职责拆进若干小接口（`BehaviorA`、`BehaviorB`），每个只负责一类动作；主 interface `extends` 它们并叠加状态字段。接口隔离（ISP）从这里来。

**3. 对外只暴露 interface，实现类不导出。** 实现 class 留在文件内部（`class XxxImpl implements Xxx`），`export` 的只有 interface、`createXxx`、`destroyXxx`。依赖方只依赖 interface，依赖倒置（DIP）从这里来。

---

## 二、生命周期：创建 → 使用 → 销毁

**4. 创建接口的两种形态：`createXxx`（纯）或 `initXxx`/`destroyXxx`（init 可带副作用）。** 模块的「出生」按是否需要启动副作用，选其一：
- **`createXxx(...)`** —— 承诺是**纯函数**：仅 `new` 出实现类、赋字段做装配，**不**产生副作用。用于无需启动外部副作用的模块。
- **`initXxx(...)` / `destroyXxx(...)`** —— `initXxx` **可能带副作用**（开连接、启定时器、订阅、初始化全局槽位…），`destroyXxx` 对称清理。用于副作用资源 / 受控全局状态等。

两种形态下 `constructor()` 都保持纯净（只赋字段）。**共同点：初始化一个实现类，而上层不知道实现类是谁**——这是开闭原则（OCP）的落点：上层只依赖 interface / 钩子，实现可替换、可扩展，无需改动既有调用方。

**5. 销毁显式。** 提供 `destroyXxx(ins)`，在内部清理所有副作用并归还资源（取消订阅、关定时器、关连接、释放句柄、清缓存）。尽量不要依赖 GC / finalizer；内存能回收不代表副作用会停。

**6. 使用方只持有 interface 类型。** 跨模块传参、声明变量、声明依赖，类型一律写 interface，不写 `XxxImpl`。

**12. 显式错误处理：用 `AsyncResult` 替代裸 `Promise`。** TypeScript 的 `Promise<T>` 默认掩藏了错误类型（`catch` 回调参数是 `any`），导致两类高频问题：未处理的 rejection 抛出全局错误使程序崩溃；或错误被静默吞掉，拿不到结果也无法定位。

推荐使用项目中的 `AsyncResult<Ok, Err>`（即 `Promise<Result<Ok, Err>>`，见 `references/async_result.ts`）替代裸 `Promise`：**`Ret.async(promise)`** 包裹 Promise → 成功走 `Ok`/失败走 `Err`；**`Ret.try(fn)`** 包裹函数使其返回 `AsyncResult`。

使用要点：
1. **第三方异步函数**：总是用 `Ret.async` 包裹——你不 catch 就没人替你 catch。
2. **本项目新建异步函数**：返回 `AsyncResult<Ok, Err>` 而非裸 `Promise<T>`，在类型上显式声明错误。
3. **裸 `await` 是资源泄漏的隐患**：`await` 一个裸 Promise 会在此处崩溃，如果后续还有资源回收代码，崩溃意味着这些资源不会被清理。`await` 前必须确保 Promise 已被 catch（try-catch 包裹或用 `AsyncResult`）。`AsyncResult` 类型永远不会 throw，可以放心 `await`。
4. **错误处理是生命周期管理的一部分**：忘记 catch Promise 跟忘记 `destroyXxx` 是同一种 bug——`destroyXxx` 关资源句柄，catch 关错误传播路径。两者都是「没关闭的句柄」。

用法与示例见 `references/error-handling.md`。

### 生命周期阶段

调用方的标准流程：

- **纯装配模块**：`createXxx(...)`（纯，只装配）→ use →（可选）`destroyXxx(ins)`。
- **副作用模块**：`createXxx(...)`（纯装配）→ `initXxx(ins)`（启动副作用）→ use → `destroyXxx(ins)`（清理）。

无论哪种，use 阶段都只通过 interface 上的方法/字段访问，不碰实现细节。`init` 与 `destroy` 一一对应；在它们之间副作用是「活的」。所有钩子（`get`/`set`/`onChange` 等）的调用必须落在 `init` 之后、`destroy` 之前的时间窗口内——不得早于 Owner 执行 `init`，也不得晚于 Owner 执行 `destroy`。

### 流式与长生命周期资源

长连接（WebSocket、SSE）、持续同步的状态、文件监听——这类资源「活得久」且「持续产出数据」，与一次性 IO（请求-响应）本质不同。它们的共同模型是 **State + Events + Lifecycle 三合一**：

- **State**（规则 1）：当前连接状态、最新数据等，`readonly` 字段。
- **Events**（规则 2）：订阅/取消订阅事件流。每个 `subscribe` 返回 `unsubscribe` 函数——**订阅本身就是一种生命周期**（subscribe → 接收事件 → unsubscribe，与 create → use → destroy 同构）。
- **Lifecycle**（规则 4/5）：`init` 打开资源，`destroy` 关闭资源并级联取消所有订阅。

决策谱系：**一次性 IO → `AsyncResult`；进程外状态缓存 → `init/get/set/destroy`（4 钩子）；需要持续同步 → 4 钩子 + EventEmitter；天生就是数据流 → State + Events + Lifecycle。** 详见 `references/live-resources.md`。

---

## 三、依赖与作用域：变量放在哪

**7. 避免模块顶层可变状态——包括 `const` 容器。** 模块顶层的 `const registry = new Map()`、`const list: Item[] = []` 之类，绑定虽不可变，容器**内容**却可变——隐式的全局状态：加载即存活、无法 reset、测试间串味、无 destroy 入口。把这类容器收进 Impl 的实例字段，由 `createXxx` 创建、`destroyXxx` 清空。真正不可变的常量（基本值、`Object.freeze({...})` 的字面量）不受此限。若确实需要跨大量模块共享、显式传参会爆炸，则按下一条「受控全局」处理。

> 理论基础：全局作用域在一次程序运行期间只展开一次，其中的状态无法被重置；只有常量和纯函数适合放在全局。可变状态需要「反复创建/销毁」的能力，这只有局部作用域能提供。

**8. 受控的全局状态：必须共享时用 4 钩子 + Owner 模型。** 当一个变量/容器被几乎每个模块频繁访问，可把它放模块顶层、经 `import/export` 共享——这是第 7 条的**受控例外**。该全局模块必须导出 `initXxx` / `getXxx` / `setXxx` / `destroyXxx`；上层模块中**有且只有一个 Owner** 负责调 `init`/`destroy`，全局状态生命周期对齐 Owner：Owner 先于其它模块初始化，在任何 `get/set` 之前调 `init` 一次且仅一次；其它模块全部卸载后，再调 `destroy`。非 Owner 模块只能 `get/set`，禁止 `init/destroy`。详见 `references/controlled-global-state.md`。

**9. 顶级函数优先显式声明依赖，而非引用模块顶级变量。** 模块内的顶级函数，尽量把依赖的全部变量/数据通过**参数**声明传入，不在函数体里闭包引用模块顶层变量——签名即契约，便于测试注入、便于换数据源。

**10. 最小必要作用域：优先缩小变量生命周期，按需抬升。** 变量的生命周期越短越好。一个对象不一定需要单例——只要它的生命周期足以覆盖所有依赖它的模块即可。
- **向下收窄**：模块顶层 → `main()` → 更内层。每下移一层，生命周期就缩短一层。
- **向上抬升**：需要跨模块共享时，把变量从当前作用域逐层向外抬，直到刚好覆盖所有依赖方——刚刚好，不过度。

核心技巧：用**多个常量接力替代一个变量**——每次需要「变更」时，`destroy` 旧常量、`init` 新常量。`init → destroy → init` 就是 `set`/`update` 的常量版本。这依赖局部作用域的可重复展开性。详见 `references/scope-hoisting.md`。

这四条形成闭环：第 7 条禁止顶层可变状态 → 第 10 条给出收窄手法和常量接力技巧 → 第 8 条是全局的最后兜底 → 第 9 条让依赖参数化，为缩小作用域创造条件。

---

## 四、理解不纯：脏函数分类

**11. 脏函数的三种形态。** "脏函数"指产生或依赖了**非显式、不受控副作用**的函数。目标不是消灭它们（IO 不可避免），而是隔离进生命周期受控的边界，让不纯在明处。

| 形态 | 脏在哪 | 纠正 |
| --- | --- | --- |
| **隐式参数** —— 捕获外部变量（含 `const` 容器） | 依赖在闭包里，签名不可见 | 参数化（9）；作用域收窄（7, 10） |
| **修改参数** —— 通过入参修改复杂类型的内部数据 | 副作用沿引用链泄漏 | 不可变更新 / 语义钩子（1） |
| **IO 函数** —— 访问进程外数据（网络、文件、存储） | 进程外依赖无生命周期 | `init`/`destroy` 管住（4, 5, 8） |

一个函数可能同时触碰多种形态——识别它们是为了有意识地决定「哪些不纯可接受，哪些必须放进生命周期边界」。三类可原谅的副作用（私有闭包、局部变量、独立 IO）和声明式 IO 模式（将 IO 抽象为纯数据结构），见 `references/dirty-functions.md`。

**目标图像**：程序的理想状态是——**除了 `main`，其他都是纯函数**。`main` 负责组装（`create`/`init`）、执行 IO（`AsyncResult` / 声明式 IO）、销毁（`destroy`）；业务逻辑链上的函数只做纯数据变换。实践中很难完全做到，但方向是明确的：每当你把一段 IO 从业务函数中抽出来、放进 `main` 或解释器，就在向这个方向靠近。

---

## 五、补充约定

**`readonly` 字段。** interface 上的字段默认加 `readonly`。消费方不应通过 interface 引用修改内部数据——需要修改走语义钩子或返回新对象。

**资源所有权。** 谁 `create` 谁负责 `destroy`。所有权转移时显式交接（函数返回 → 调用方接棒；参数传入需约定是「借用」还是「接管」）。避免「共享所有权」——一段资源的 destroy 责任只能落在一个角色身上。`get`/`set` 等钩子必须在 `init` 之后、`destroy` 之前的窗口内调用。详见 `references/ownership.md`。

**级联销毁。** 父模块在 `destroyXxx` 中按创建逆序销毁它持有的所有子模块。父作用域依赖于子作用域——父的正确性建立在子之上——因此销毁时先断末端依赖链（后创建的先销毁），最后销毁父自身。依赖树 = 所有权树 = 销毁树。

---

## 标准模板

每个模块按这个骨架写，把变量名替换掉即可：

```ts
// —— 行为接口：每个只管一类动作 ——
export interface BehaviorA {
  fly(): void
  sound(): void
}
export interface BehaviorB {
  eat(): void
  drink(): void
}

// —— 契约：状态（纯数据）+ 组合的行为 ——
export interface SomeAnimal extends BehaviorA, BehaviorB {
  readonly name: string
  readonly age: number
}

// —— 实现：不导出 ——
class SomeAnimalImpl implements SomeAnimal {
  readonly name: string
  readonly age: number

  constructor(name: string, age: number) {
    // 纯：只赋值字段。不开定时器、不订阅、不连外部资源。
    this.name = name
    this.age = age
  }

  fly() { /* … */ }
  sound() { /* … */ }
  eat() { /* … */ }
  drink() { /* … */ }
}

// —— 唯一创建入口（纯：仅装配，不启动副作用）——
export function createSomeAnimal(name: string, age: number): SomeAnimal {
  return new SomeAnimalImpl(name, age)
}
// 注：需要启动副作用的模块改用 initXxx/destroyXxx 形态

// —— 显式销毁 ——
export function destroySomeAnimal(ins: SomeAnimal): void {
  // 清副作用、回收资源：取消订阅、关定时器、关连接……
}

// —— 使用方（其它模块）——
const a = createSomeAnimal('fox', 3)
a.fly()
a.eat()
destroySomeAnimal(a)
```

---

## 把规则串起来：端到端示例

一个带缓存的数据加载器，贯穿了几乎所有规则：

```ts
// ========== data-loader.ts ==========
import { Ret, AsyncResult } from './async_result'

// 规则 1+2：状态 interface + 行为 interface
export interface LoaderState {
  readonly cache: ReadonlyMap<string, Item[]>
}
export interface LoaderActions {
  load(key: string): AsyncResult<Item[], Error>  // 规则 12：AsyncResult
}
export interface Loader extends LoaderState, LoaderActions {}

// 规则 3：Impl 不导出
class LoaderImpl implements Loader {
  private readonly _cache = new Map<string, Item[]>() // 规则 7：容器在实例字段

  constructor() {} // 规则 4：constructor 纯

  get cache(): ReadonlyMap<string, Item[]> {
    return this._cache
  }

  async load(key: string): AsyncResult<Item[], Error> {
    if (this._cache.has(key)) {
      return Ret.async(Promise.resolve(this._cache.get(key)!))
    }
    // 规则 12：Ret.async 包裹第三方 fetch
    const result = await Ret.async(
      fetch(`/api/items/${key}`).then(r => r.json()),
      `load failed for key=${key}`,
    )
    if (result.status) {
      this._cache.set(key, result.value) // 修改的是自己的私有字段，不是入参
    }
    return result
  }

  destroy() {
    this._cache.clear() // 规则 5：显式清理
  }
}

// 规则 4：create 纯装配
export function createLoader(): Loader {
  return new LoaderImpl()
}

// 规则 4：init 启动副作用
export function initLoader(ins: Loader): void {}

// 规则 5：显式销毁
export function destroyLoader(ins: Loader): void {
  ;(ins as LoaderImpl).destroy()
}

// ========== main.ts（使用方）==========
// 规则 6：变量声明用 interface 类型
// 规则 10：loader 放在 main() 作用域而非模块顶层
async function main() {
  const loader: Loader = createLoader() // 规则 9：显式声明依赖
  initLoader(loader)

  const result = await loader.load('foo')
  if (result.status) {
    console.log('loaded:', result.value.length, 'items')
  } else {
    console.error('load failed:', result.value) // 规则 12：错误显式处理
  }

  destroyLoader(loader) // 规则 5：用完销毁
}
main()
```

---

## SOLID 映射（无 IOC 容器）

- **SRP**：每个动作 interface 只管一类职责；`create` 管构造、`destroy` 管回收，各司其职。
- **OCP**：加新行为 = 新增动作 interface / 新实现，不改既有契约。
- **LSP**：使用方只认 interface，任何符合契约的 Impl 都可替换（测试 mock / 生产实现）。
- **ISP**：动作接口被拆细，使用方只 import 自己用得到的。
- **DIP**：跨模块依赖的是 interface，不是 `XxxImpl`。

---

## 自查

写 `class`、`interface`、`export function` 或带副作用的逻辑时，按四层逐项过一遍：

**契约层**（规则 1–3）：
- 对外契约是「纯数据 + 组合行为」的 interface 吗？字段加了 `readonly` 吗？
- 实现 class 没有 `export` 吗？

**生命周期层**（规则 4–6, 12）：
- 创建形态选对了吗？`createXxx` 纯装配（无副作用）？需副作用的模块是否用了 `initXxx`/`destroyXxx`？`constructor` 无副作用吗？
- `destroyXxx` 是否与副作用一一对应？是否级联销毁了持有的子模块？
- 异步函数返回的是 `AsyncResult<Ok, Err>` 吗？第三方调用是否用 `Ret.async` 包裹？有没有遗漏 catch 的 Promise？

**作用域层**（规则 7–10）：
- 模块顶层是否只留了不可变常量？可变容器是否都收进了实例字段？
- 若确需全局共享：是否导齐 4 个钩子且只有唯一 Owner？
- 变量能否从顶层搬到 `main()` / 更内层？跨模块共享时是否只抬升到刚好覆盖？
- 顶级函数是否把依赖显式声明为参数？

**纯度层**（规则 11）：
- 函数触碰了哪种脏形态？隐式参数能否参数化？修改参数能否改不可变更新？IO 是否被 `init`/`destroy` 管住了？

---

## 进一步

| 主题 | 文件 |
| --- | --- |
| 场景模板（定时器 / 事件 / WebSocket / IndexedDB） | `references/patterns.md` |
| 常见偏离与纠正（12 条反模式） | `references/anti-patterns.md` |
| 受控全局状态（4 钩子 + Owner 模型） | `references/controlled-global-state.md` |
| 作用域收窄、抬升与常量接力 | `references/scope-hoisting.md` |
| 脏函数三种形态 + 可原谅副作用 + 声明式 IO | `references/dirty-functions.md` |
| `AsyncResult` 用法与错误处理 | `references/error-handling.md` |
| 流式与长生命周期资源（WebSocket / SSE / 持续同步） | `references/live-resources.md` |
| 所有权模型（原则 + JS/TS 适配 + 借用 + 级联） | `references/ownership.md` |
| 测试中的直接收益 | `references/testing.md` |
| `Result` / `AsyncResult` 工具库 | `references/async_result.ts` |
