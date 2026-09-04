# 流式与长生命周期资源

长连接（WebSocket、SSE）、持续同步的状态、文件监听——这类资源的共同特征是「活得久」且「持续产出数据」。与一次性 IO（fetch、读文件）不同，**不是请求-响应，而是打开-流式产出-关闭**。

## 模型：State + Events + Lifecycle

在本风格中，长生命周期资源建模为三合一：

| 维度 | 对应 | 说明 |
| --- | --- | --- |
| **State** | 规则 1 的纯数据 interface | 当前连接状态、最新数据等，字段 `readonly` |
| **Events** | 规则 2 的动作 interface | 订阅事件流。每个 `subscribe` 返回 `unsubscribe` 函数 |
| **Lifecycle** | 规则 4/5 的 init/destroy | `init` 打开资源，`destroy` 关闭资源 + 级联取消所有订阅 |

核心原则：**订阅本身就是一种生命周期**——subscribe → 接收事件 → unsubscribe，与 create → init → use → destroy 完全同构。

## 示例 1：WebSocket 长连接

```ts
// ===== 状态 interface =====
export interface WsState {
  readonly status: 'connecting' | 'open' | 'closed'
  readonly url: string
}

// ===== 事件 interface =====
export interface WsEvents {
  onMessage(fn: (data: string) => void): () => void  // 返回 unsubscribe
  onStatus(fn: (s: WsState['status']) => void): () => void
}

// ===== 组合契约 =====
export interface LiveSocket extends WsState, WsEvents {
  send(data: string): void
}

// ===== 实现 =====
class LiveSocketImpl implements LiveSocket {
  readonly url: string
  private ws: WebSocket | null = null
  private _status: WsState['status'] = 'closed'

  // 订阅者集合——每个元素是一个 unsubscribe 回调
  private readonly msgListeners = new Set<(data: string) => void>()
  private readonly statusListeners = new Set<(s: WsState['status']) => void>()

  constructor(url: string) {
    this.url = url // 纯：只赋字段
  }

  get status() { return this._status }

  // 连接由 init 调用
  connect() {
    const ws = new WebSocket(this.url)
    ws.onopen = () => this.setStatus('open')
    ws.onclose = () => this.setStatus('closed')
    ws.onmessage = e => {
      for (const fn of this.msgListeners) fn(String(e.data))
    }
    this.ws = ws
    this.setStatus('connecting')
  }

  send(data: string) { this.ws?.send(data) }

  onMessage(fn: (data: string) => void): () => void {
    this.msgListeners.add(fn)
    return () => { this.msgListeners.delete(fn) } // unsubscribe
  }

  onStatus(fn: (s: WsState['status']) => void): () => void {
    this.statusListeners.add(fn)
    return () => { this.statusListeners.delete(fn) }
  }

  // destroy 时级联清理：关连接 + 清所有订阅
  destroy() {
    this.ws?.close()
    this.ws = null
    this.msgListeners.clear()   // 所有 onMessage 订阅一笔勾销
    this.statusListeners.clear()
    this.setStatus('closed')
  }

  private setStatus(s: WsState['status']) {
    this._status = s
    for (const fn of this.statusListeners) fn(s)
  }
}

export function createSocket(url: string): LiveSocket {
  return new LiveSocketImpl(url)
}
export function initSocket(ins: LiveSocket): void {
  ;(ins as LiveSocketImpl).connect() // 副作用：打开连接
}
export function destroySocket(ins: LiveSocket): void {
  ;(ins as LiveSocketImpl).destroy()
}

// ===== 使用方 =====
function main() {
  const ws = createSocket('wss://example.com')
  initSocket(ws)

  const unsub = ws.onMessage(data => console.log('received:', data))
  // 不需要时：unsub() 取消单个订阅

  destroySocket(ws) // 关闭连接 + 所有订阅全部清空
}
```

> 要点：`onMessage`/`onStatus` 返回 `unsubscribe` 函数，调用方可以精确取消**单个**订阅而不影响其他。`destroy` 作为一种「全清」兜底。

## 示例 2：SSE / EventSource

```ts
export interface EventStream {
  readonly ready: boolean
  onEvent(fn: (e: { type: string; data: string }) => void): () => void
  onError(fn: (e: Event) => void): () => void
}

class EventStreamImpl implements EventStream {
  private src: EventSource | null = null
  private readonly eventFns = new Set<(e: { type: string; data: string }) => void>()
  private readonly errorFns = new Set<(e: Event) => void>()

  constructor(private readonly url: string) {}

  get ready() { return this.src?.readyState === EventSource.OPEN }

  open() {
    const src = new EventSource(this.url)
    src.onmessage = e => { for (const fn of this.eventFns) fn({ type: 'message', data: e.data }) }
    src.addEventListener('update', e => {
      for (const fn of this.eventFns) fn({ type: 'update', data: (e as MessageEvent).data })
    })
    src.onerror = e => {
      for (const fn of this.errorFns) fn(e)
    }
    this.src = src
  }

  onEvent(fn: (e: { type: string; data: string }) => void) {
    this.eventFns.add(fn)
    return () => { this.eventFns.delete(fn) }
  }

  onError(fn: (e: Event) => void) {
    this.errorFns.add(fn)
    return () => { this.errorFns.delete(fn) }
  }

  destroy() {
    this.src?.close()
    this.src = null
    this.eventFns.clear()
    this.errorFns.clear()
  }
}

export function createEventStream(url: string): EventStream { return new EventStreamImpl(url) }
export function initEventStream(ins: EventStream): void { ;(ins as EventStreamImpl).open() }
export function destroyEventStream(ins: EventStream): void { ;(ins as EventStreamImpl).destroy() }
```

## 示例 3：持续同步的状态（轮询 → 内部保持最新）

对于「需要在后台持续拉取最新值」的场景——轮询是手段，真正的目标是「状态始终对外保持最新」。接口只暴露状态和变更事件，轮询是实现细节。

```ts
export interface SyncedValue<T> {
  readonly current: T | null
  readonly version: number
  onChange(fn: (val: T) => void): () => void
}

class PollingSync<T> implements SyncedValue<T> {
  private _current: T | null = null
  private _version = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<(val: T) => void>()

  constructor(
    private readonly fetcher: () => Promise<T>,
    private readonly intervalMs: number,
  ) {}

  get current() { return this._current }
  get version() { return this._version }

  start() {
    this.timer = setInterval(async () => {
      const result = await Ret.async(this.fetcher()) // 规则 12
      if (result.status) {
        this._current = result.value
        this._version++
        for (const fn of this.listeners) fn(result.value)
      }
      // 错误静默：下次重试；也可触发 onError 事件
    }, this.intervalMs)
  }

  onChange(fn: (val: T) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
  }
}

export function createSyncedValue<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
): SyncedValue<T> {
  return new PollingSync(fetcher, intervalMs)
}
export function initSyncedValue<T>(ins: SyncedValue<T>): void { ;(ins as PollingSync<T>).start() }
export function destroySyncedValue<T>(ins: SyncedValue<T>): void { ;(ins as PollingSync<T>).destroy() }
```

> `PollingSync` 是**实现细节**——对外只暴露 `SyncedValue<T>`。哪天换成 WebSocket 推送，调用方无感知（OCP）。

## 订阅管理的三条纪律

1. **subscribe 必须返回 unsubscribe** —— `onMessage(fn)` 返回 `() => void`，调用方可以精确取消单个订阅。
2. **destroy 必须全清** —— `destroy()` 中 `clear()` 所有订阅者集合，确保销毁后不再有任何回调触发。
3. **回调不在 constructor / create 里注册** —— constructor 纯装配，订阅由调用方在 use 阶段主动 `onMessage(...)`。

## 流中的错误处理

一次性的 IO 用 `AsyncResult`（成功或失败，二选一）。流式资源的错误是**持续的**——可能反复发生（断连、重连、单条消息损坏）。

```ts
// 流式资源的错误作为事件暴露，而非返回值
export interface WsEvents {
  onMessage(fn: (data: string) => void): () => void
  onError(fn: (err: Error) => void): () => void     // 流中的错误 = 事件
  onStatus(fn: (s: WsState['status']) => void): () => void
}
// 调用方自己决定策略：忽略、重试、告警
```

> 不要对流式资源使用 `AsyncResult` 作为事件载体——它是一次性的。流需要 `onError` 事件。

## 重连模式

重连是**实现细节**，不暴露在 interface 上。对外只看到 `status` 从 `open` → `closed` → 可能又 `open`。

```ts
class ReconnectingSocketImpl {
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private onClose() {
    this.setStatus('closed')
    // 自动重连
    this.reconnectTimer = setTimeout(() => {
      this.connect() // 重新打开
    }, 3000)
  }

  destroy() {
    // destroy 时取消重连 + 关连接
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.ws?.close()
    // ...
  }
}
```

> 调用方不关心重连逻辑——它只需知道 `status` 的变化和 `onStatus` 事件。

## 进程外状态：从一次性读入到持续同步

实践中最常见的场景比 WebSocket 更朴素：把进程外的状态**一次性读入内存**，之后始终用内存中的拷贝，避免重复读取。同时提供写入接口，允许上层反向更新。基本模型就是 `init/get/set/destroy`（见 `references/controlled-global-state.md` 的 4 钩子）。

当需要**持续同步**时——外部可能被其他进程修改，或者本地 `set` 后需要自动推送回外部——在同一个 Impl 上叠一层 EventEmitter，让上层能反向获得数据流。

这不是两套独立的模式，而是一个光谱：

```
init/get/set/destroy（一次性读入 + 内存缓存 + 写入出口）
       ↓ 需要持续同步时，加一层
init/get/set/destroy + EventEmitter（双向数据流）
```

### 纯缓存模型

进程外数据（数据库字段、远程配置）读入后，始终用内存值；`destroy` 时写回。

```ts
// 来自数据库的计数器：init 读入，之后只操作内存值，destroy 写回
export interface CounterStore {
  get(): number
  set(val: number): void
}

class CounterStoreImpl implements CounterStore {
  private value = 0

  constructor(private readonly key: string) {}

  async load() {
    this.value = parseInt(await readFromDB(this.key) ?? '0')
  }
  get() { return this.value }
  set(val: number) { this.value = val }
  async save() { await writeToDB(this.key, String(this.value)) }
}

export function createCounterStore(key: string): CounterStore {
  return new CounterStoreImpl(key)
}
export async function initCounterStore(ins: CounterStore): Promise<void> {
  await (ins as CounterStoreImpl).load() // 副作用：读入进程外数据
}
export async function destroyCounterStore(ins: CounterStore): Promise<void> {
  await (ins as CounterStoreImpl).save() // 清理：写回并回收
}
// 上层：init → get/set → destroy
```

> 数据库在一次 `load` 后不再访问——内存就是权威拷贝。这样做不仅快，也让上层与持久化机制解耦。

### 需要同步时：叠加 EventEmitter

当该状态可能被**其他进程或用户并发修改**，或需要在本地 `set` 后自动通知下游时，给 Impl 叠一层 EventEmitter 能力：

```ts
class SyncedCounterImpl implements CounterStore {
  private value = 0
  private readonly listeners = new Set<(val: number) => void>()

  // ... get/load/save 同上 ...

  onChange(fn: (val: number) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  set(val: number) {
    this.value = val
    this.scheduleSync() // 反向同步：自动写入外部
    for (const fn of this.listeners) fn(val) // 通知订阅者
  }

  // 外部推送（如 WebSocket 消息 / 其他进程写入）→ 更新内存 + 通知
  applyExternal(val: number) {
    this.value = val
    for (const fn of this.listeners) fn(val)
  }
}
```

> 对外 interface 不变（`CounterStore`），EventEmitter 是 Impl 的能力增强。上层从「读一次」升级到「持续同步」，只需多调一个 `onChange`——不换模型，只加一层。

## 决策指南

| 特征 | 模型 | 对应规则 |
| --- | --- | --- |
| 一次请求-响应（fetch、读文件） | `AsyncResult<Ok, Err>` + `Ret.async` | 规则 12 |
| 进程外状态一次性读入 + 内存缓存 | `init`/`get`/`set`/`destroy`（4 钩子） | 规则 8 |
| 进程外状态 + 持续同步（双向） | 4 钩子 + EventEmitter | 规则 8 + 规则 2 |
| 打开-持续-关闭（WebSocket、SSE） | State + Events + Lifecycle | 规则 1/2/4/5 |
| 周期拉取最新值（轮询） | `SyncedValue<T>`（轮询是实现细节） | 规则 2/4/5 |
| 文件/目录变更监听 | State + Events + Lifecycle | 规则 1/2/4/5 |
| 事件总线 / pub-sub | Events interface + unsubscribe | 规则 2 |

原则：**一次性 = AsyncResult；外部缓存 = 4 钩子；持续性流 = Events + Lifecycle**。由此构成一个从简单到复杂的连续光谱：一次读取 → 内存缓存 → 带同步的缓存 → 持续流。
