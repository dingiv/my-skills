# 常见偏离与纠正

这些写法偏离本推荐风格，多数情况下值得改成右侧写法；个别场景若有明确理由，按工程判断取舍。

| # | 反模式 | 违反规则 |
| --- | --- | --- |
| 1 | 导出了实现类 | 规则 3（DIP） |
| 2 | constructor 里有副作用 | 规则 4 |
| 3 | 没有 destroy，依赖 GC | 规则 5 |
| 4 | create 与 destroy 不对称 | 规则 5 |
| 5 | 跨模块依赖了 Impl 类型 | 规则 6 |
| 6 | 一个巨型 interface 啥都塞 | 规则 2（ISP） |
| 7 | 为了 destroy 暴露内部状态 | 规则 3 |
| 8 | 模块顶层就建实例 | 规则 7 |
| 9 | 模块顶层的 const 数据容器 | 规则 7 |
| 10 | 顶级函数隐式引用模块顶层变量 | 规则 9 |
| 11 | 模块顶层放了本可收窄的变量 | 规则 10 |
| 12 | 裸 Promise 无 catch | 规则 12 |

---

## 1. 导出了实现类

依赖方一旦能 `import { XxxImpl }`，依赖倒置就被打破，替换实现、写 mock 都会粘在具体类上。

```ts
// ❌ 错
export class SomeAnimalImpl implements SomeAnimal { /* … */ }
// 其它文件：
const a = new SomeAnimalImpl()

// ✅ 对
class SomeAnimalImpl implements SomeAnimal { /* … */ } // 不 export
export function createSomeAnimal(): SomeAnimal {
  return new SomeAnimalImpl()
}
```

---

## 2. constructor 里有副作用

构造函数不该开连接、启定时器、订阅事件。否则 `new` 出来的对象处于「半活」状态，单元测试无法构造纯字段实例，副作用也难以追踪。

```ts
// ❌ 错
class ConnImpl {
  constructor(url: string) {
    this.ws = new WebSocket(url) // 副作用
  }
}

// ✅ 对
class ConnImpl {
  constructor(url: string) {
    this.url = url // 纯
  }
  connect() {
    this.ws = new WebSocket(this.url)
  }
}
export function createConn(url: string): Conn {
  return new ConnImpl(url) // 纯：仅装配
}
export function initConn(ins: Conn): void {
  ;(ins as ConnImpl).connect() // 副作用归 init，不放 constructor / create
}
```

---

## 3. 没有 destroy，依赖 GC

GC 只回收内存，不关定时器、不断订阅、不释放句柄。少一个 `destroyXxx`，副作用就泄漏。

```ts
// ❌ 错：只 create，没有 destroy
export function createPoll(url: string): Poll { /* setInterval … */ return ins }
// 调用方用完直接丢弃 ins —— 定时器还在跑

// ✅ 对
export function createPoll(url: string): Poll { /* … */ }
export function destroyPoll(ins: Poll): void {
  ins.stop() // 显式停掉
}
```

---

## 4. create 与 destroy 不对称

启动了 N 个副作用，destroy 只清了 N-1 个——泄漏一个。逐项核对：每条 `addEventListener` 都有对应的 `removeEventListener`，每条 `setInterval` 都有 `clearInterval`，每条 `subscribe` 都有 `unsubscribe`。

---

## 5. 跨模块依赖了 Impl 类型

```ts
// ❌ 错
import { SomeAnimalImpl } from './some-animal'
function feed(a: SomeAnimalImpl) { /* … */ }

// ✅ 对
import type { SomeAnimal } from './some-animal'
function feed(a: SomeAnimal) { /* … */ }
```

---

## 6. 一个巨型 interface 啥都塞

违反接口隔离。把方法按职责拆成多个小动作 interface，再组合；使用方只依赖自己用得到的那个。

```ts
// ❌ 错
export interface GodAnimal {
  name: string
  age: number
  fly(): void
  swim(): void
  bark(): void
  migrate(): void
  hibernate(): void
}

// ✅ 对
export interface FlyBehavior { fly(): void }
export interface SwimBehavior { swim(): void }
export interface BarkBehavior { bark(): void }
export interface SomeAnimal extends FlyBehavior, SwimBehavior {
  readonly name: string
  readonly age: number
}
```

---

## 7. 为了 destroy 暴露内部状态

不要为了能在 destroy 里清理，就把私有字段塞进对外 interface。要么用内部 teardown 方法（经窄化调用），要么把清理做成 interface 上一个语义化的方法（如 `stop()`、`close()`），destroy 调它。

```ts
// ❌ 错：把私有 timer 暴露成 public 只为 destroy 能碰到
export interface Poll { timer: NodeJS.Timeout | null }

// ✅ 对：interface 提供 stop()，destroy 调 stop()
export interface PollControl { stop(): void }
export function destroyPoll(ins: Poll) {
  ins.stop()
}
```

---

## 8. 模块顶层就建实例、还不暴露生命周期

模块加载即 `new`、即启动副作用，使用方无法控制时机、也无法销毁。

```ts
// ❌ 错：top-level side effect
export const conn = createConn('/ws') // 一 import 就建连接，无法 destroy

// ✅ 对：把创建权交给使用方
export function createConn(url: string): Conn { /* … */ }
export function destroyConn(ins: Conn): void { /* … */ }
// 使用方在自己的生命周期里 create → use → destroy
```

> 单例如果确实需要，仍然要包成「延迟创建 + 可销毁」的对象，并显式管理它的生命周期，而不是把副作用焊死在模块顶层。

---

## 9. 模块顶层的 `const` 数据容器

`const` 只锁绑定，不锁内容。顶层的 `Map` / `Set` / `Array` / 普通对象是隐式的全局可变状态：模块一加载就存活、跨调用共享、无法重置、测试间串味，也没有 destroy 入口。

```ts
// ❌ 错：顶层可变容器 = 隐式全局状态
const cache = new Map<string, Item>()
export function putItem(k: string, v: Item) {
  cache.set(k, v)
}
// 测试跑完 cache 仍残留；多调用方共享同一份；无处销毁

// ✅ 对：收进实例字段，走 create/destroy
interface ItemStore {
  put(k: string, v: Item): void
  get(k: string): Item | undefined
}
class ItemStoreImpl implements ItemStore {
  private readonly cache = new Map<string, Item>()
  put(k: string, v: Item) {
    this.cache.set(k, v)
  }
  get(k: string) {
    return this.cache.get(k)
  }
  clear() {
    this.cache.clear()
  }
}
export function createItemStore(): ItemStore {
  return new ItemStoreImpl()
}
export function destroyItemStore(ins: ItemStore): void {
  ;(ins as ItemStoreImpl).clear()
}
```

> 真正的常量（基本值，或 `Object.freeze({...})` 这种内容不可变的字面量）放顶层没问题——它们没有「可变内容」。

---

## 10. 顶级函数隐式引用模块顶层变量

函数体直接抓模块顶层变量，依赖就被藏起来：签名看不出它需要什么，测试得先 setup 全局状态，换数据源还得改函数体。对应 SKILL.md 第 9 条。

```ts
const config = { endpoint: '/api', timeout: 5000 }

// ❌ 错：隐式引用顶层 config，依赖被藏进函数体
export function fetchUser(id: string) {
  return http.get(`${config.endpoint}/users/${id}`, { timeout: config.timeout })
}

// ✅ 对：把依赖声明为参数，签名即契约
export function fetchUser(
  id: string,
  config: { endpoint: string; timeout: number },
) {
  return http.get(`${config.endpoint}/users/${id}`, { timeout: config.timeout })
}
// 调用方负责传入 config（可来自第 8 条受控全局的 getXxx()）
```

> 纯无状态工具引用不可变常量、或装配函数（`createXxx`）引用配置做装配，可放宽——重点是别让业务函数隐式抓取可变 / 受控全局。受控全局的正确姿势是：用钩子（`getXxx()`）**显式获取**后，把结果作为参数传给下游纯函数，而不是让下游函数自己去抓。

---

## 11. 模块顶层放了本可收窄的变量

一个变量明明可以放进 `main()` 或更内层的作用域，却被焊死在模块顶层——生命周期被撑到进程级别，得不偿失。对应 SKILL.md 第 10 条。

```ts
// ❌ 错：cache 只需在 main 期间存活，却被放在模块顶层
const cache = new Map<string, Data[]>()
export function loadData(key: string) { /* 用 cache */ }

// ✅ 对：收进 main()——生命周期刚好够用，用完后自动随作用域销毁
function createLoader() {
  const cache = new Map<string, Data[]>()
  return {
    load(key: string) { /* 用 cache */ },
    destroy() { cache.clear() },
  }
}
function main() {
  const loader = createLoader()
  // … 使用 …
  loader.destroy() // main 收尾时清理
}
```

> 放顶层前先问：能不能放在 `main()` 里？能不能放在更内层？如果必须跨模块共享，能不能在调用链中向上抬升一两层，而不是直接抬进模块顶层？"全局"是最后的选项，不是默认反应。

---

## 12. 裸 Promise 无 catch / 未用 AsyncResult

TypeScript 的 `Promise<T>` 不编码错误类型，`catch` 参数是 `any`。不处理 rejection 会导致崩溃或静默失败——和忘记 `destroyXxx` 是同一种「没关闭句柄」的 bug。对应 SKILL.md 第 12 条。

```ts
// ❌ 错：裸 Promise，不 catch。网络挂了 = unhandled rejection → crash
async function loadUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`)
  return res.json()
}

// ❌ 错：catch 了但类型是 any，调用方不知道可能失败成什么
async function loadUser(id: string): Promise<User> {
  try {
    const res = await fetch(`/api/users/${id}`)
    return res.json()
  } catch (e) {
    // e 是 any，什么信息都没有
    return defaultUser
  }
}

// ✅ 对：用 AsyncResult，错误类型显式，调用方被迫处理两种结果
import { Ret, AsyncResult } from './async_result'

async function loadUser(id: string): AsyncResult<User, Error> {
  return Ret.async(
    fetch(`/api/users/${id}`).then(res => res.json()),
    `loadUser failed for id=${id}`,
  )
}
// 调用方：
const result = await loadUser('1')
if (result.status) {
  renderUser(result.value) // Ok<User>
} else {
  showError(result.value)  // Err<Error>，类型明确
}
```

> `Ret.async` 是错误传播路径的"关闭句柄"——正如 `destroyXxx` 关资源句柄。裸 Promise 不 catch = 资源没 destroy，都是没回收。
