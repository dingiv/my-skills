# 场景模板

把副作用资源套进「interface + create/init/destroy」的标准做法。每个例子都体现同一条主线：**`createXxx` 是纯函数（仅装配实例），副作用在 `initXxx` 启动、在 `destroyXxx` 清理，对外只暴露 interface。** 调用顺序：`create` → `init` → use → `destroy`。

---

## 1. 定时器轮询

```ts
export interface PollState {
  readonly url: string
  readonly intervalMs: number
  readonly running: boolean
}
export interface PollControl {
  start(): void
  stop(): void
}
export interface PollSource extends PollState, PollControl {}

class PollSourceImpl implements PollSource {
  readonly url: string
  readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(url: string, intervalMs: number) {
    // 纯：只赋值，不启动定时器
    this.url = url
    this.intervalMs = intervalMs
  }

  get running() {
    return this.timer !== null
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async tick() {
    await fetch(this.url) // …
  }
}

export function createPollSource(url: string, intervalMs: number): PollSource {
  return new PollSourceImpl(url, intervalMs) // 纯：仅装配
}

export function initPollSource(ins: PollSource): void {
  ins.start() // 副作用：启动轮询
}

export function destroyPollSource(ins: PollSource): void {
  ins.stop() // 清理：停掉定时器
}

// 调用方：create → init → use → destroy
```

---

## 2. 事件订阅 / 观察者

把「订阅」这个副作用关进 create/destroy，使用方拿到的是「可读状态 + 可发动作」，看不到回调注册细节。

```ts
export interface CounterState {
  readonly value: number
}
export interface CounterActions {
  inc(): void
  on(fn: (v: number) => void): void
}
export interface Counter extends CounterState, CounterActions {}

class CounterImpl implements Counter {
  private _value = 0
  private readonly listeners = new Set<(v: number) => void>()

  get value() {
    return this._value
  }

  inc() {
    this._value += 1
    for (const fn of this.listeners) fn(this._value)
  }

  on(fn: (v: number) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) } // unsubscribe
  }
}

export function createCounter(): Counter {
  return new CounterImpl() // 纯：仅装配
}

export function destroyCounter(ins: Counter): void {
  // 清掉所有回调引用，避免持有外部闭包造成泄漏
  ;(ins as CounterImpl)['listeners'].clear()
}
```

> 当 Impl 需要在 destroy 里触碰私有集合时，倾向于把「清理入口」做成一个内部方法（如 `private teardown()`），destroy 通过窄化转换或一个受控的内部接口调用——不要为了 destroy 把私有状态暴露到对外 interface 上。

---

## 3. WebSocket 连接

连接是典型的「创建即副作用」，但按本风格要拆开：`createXxx` 只 `new` + 赋字段（纯装配），真正 `connect` 放进 `initXxx`。

```ts
export interface ConnState {
  readonly url: string
  readonly status: 'idle' | 'open' | 'closed'
}
export interface ConnMessaging {
  send(msg: string): void
  onMessage(fn: (data: string) => void): void
}
export interface Conn extends ConnState, ConnMessaging {}

class ConnImpl implements Conn {
  readonly url: string
  private ws: WebSocket | null = null
  private readonly receivers = new Set<(data: string) => void>()

  constructor(url: string) {
    this.url = url // 纯
  }

  get status(): ConnState['status'] {
    if (!this.ws) return 'idle'
    return this.ws.readyState === WebSocket.OPEN ? 'open' : 'closed'
  }

  send(msg: string) {
    this.ws?.send(msg)
  }

  onMessage(fn: (data: string) => void) {
    this.receivers.add(fn)
  }

  /** 由 create 调用，不属于对外 interface */
  connect() {
    const ws = new WebSocket(this.url)
    ws.onmessage = e => {
      for (const fn of this.receivers) fn(String(e.data))
    }
    this.ws = ws
  }

  close() {
    this.ws?.close()
    this.ws = null
    this.receivers.clear()
  }
}

export function createConn(url: string): Conn {
  return new ConnImpl(url) // 纯：仅装配
}

export function initConn(ins: Conn): void {
  ;(ins as ConnImpl).connect() // 副作用：打开连接
}

export function destroyConn(ins: Conn): void {
  ;(ins as ConnImpl).close() // 清理：关连接、清回调
}

// 调用方：create → init → use → destroy
```

---

## 4. IndexedDB object store

异步资源同样适用——`createXxx` 是同步纯装配，异步初始化放进 `initXxx`。

```ts
export interface KVStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  close(): void
}

class KVStoreImpl implements KVStore {
  private db: IDBDatabase | null = null

  constructor(private readonly name: string) {}

  /** 由 create 异步调用 */
  async open() {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.name, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async get(key: string) {
    /* 用 this.db 读取 */
    return undefined
  }

  async set(key: string, value: string) {
    /* 用 this.db 写入 */
  }

  close() {
    this.db?.close()
    this.db = null
  }
}

export function createKVStore(name: string): KVStore {
  return new KVStoreImpl(name) // 纯：仅装配（同步）
}

export async function initKVStore(ins: KVStore): Promise<void> {
  await (ins as KVStoreImpl).open() // 副作用：打开数据库（异步）
}

export function destroyKVStore(ins: KVStore): void {
  ;(ins as KVStoreImpl).close() // 清理：关库
}

// 调用方：create → await init → use → destroy
```

---

## 5. 通用记法

- `createXxx` 保持**纯装配**（同步、无副作用），返回 interface 类型，**不**返回 Impl；副作用模块额外提供 `initXxx`/`destroyXxx`，调用顺序 `create → init → use → destroy`。
- 异步初始化放进 `initXxx`（返回 `Promise`）；`createXxx` 仍是同步纯装配。
- 一个模块通常会导出三样东西：`interface Xxx`、`createXxx`、`destroyXxx`；带副作用的再加 `initXxx`。
- 多个相关资源属于同一生命周期时，可以让一个「拥有者」模块的 `destroyXxx` 级联调用它持有的子模块的 `destroy`，把所有权链显式化。
