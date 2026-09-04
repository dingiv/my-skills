# 显式错误处理

> 对应 SKILL.md 第 12 条。用 `AsyncResult<Ok, Err>`（`Promise<Result<Ok, Err>>`）替代裸 `Promise`，让错误类型不再被 TypeScript 掩藏。

## 为什么不用裸 Promise

TypeScript 的 `Promise<T>` 不编码错误类型：

```ts
// ❌ 裸 Promise：catch 的参数是 any，不知道会失败成什么
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`)
  return res.json()
}
// 调用方：
const user = await fetchUser('1') // 如果网络挂了？如果返回 500？
// user 的类型是 User，但实际可能是抛出的异常——类型系统在撒谎
```

`AsyncResult<Ok, Err>` 让错误成为返回值的一部分，而非隐式的异常流：

```ts
import { Ret, AsyncResult, Ok, Err } from './async_result'

// ✅ AsyncResult：错误类型显式
async function fetchUser(id: string): AsyncResult<User, NetworkError> {
  const result = await Ret.async(fetch(`/api/users/${id}`))
  if (!result.status) return result // 透传网络错误
  const data = await Ret.async(result.value.json())
  return data // Result<User, NetworkError>
}
```

## 核心 API

来自 `references/async_result.ts`：

### `Ret.async(promise, msg?)`

包裹一个 Promise → `AsyncResult<Ok, Err>`。成功走 `Ok(value)`，失败走 `Err(reason)`。

```ts
import { Ret, AsyncResult } from './async_result'

const result: AsyncResult<Response, Error> = Ret.async(
  fetch('/api/data'),
  'fetch /api/data failed',
)
// result 一定是 Result<Response, Error>，不会 throw
```

### `Ret.try(fn)`

包裹一个函数，使其返回 `AsyncResult`，自动捕获同步/异步错误。

```ts
const safeParse = Ret.try<SyntaxError, [string]>(JSON.parse)

const result = await safeParse('{"valid": true}')   // Ok({ valid: true })
const result2 = await safeParse('not json')          // Err(SyntaxError)
```

### 消费 Result

```ts
const result = await Ret.async(fetchUser('1'))

// 模式匹配
if (result.status) {
  const user = result.value // Ok<User>
  console.log(user.name)
} else {
  const err = result.value // Err<NetworkError>
  console.error('fetch failed:', err)
}

// map：只在成功时变换
const nameResult = result.map(user => user.name) // Result<string, NetworkError>

// unwrap：断言成功，失败则抛错（用于"这里不应该失败"的边界）
const user = result.unwrap() // 若 Err 则 throw

// expect：带上下文信息的 unwrap
const user = result.expect('fetchUser must succeed at init phase')
```

## 使用场景

### 场景 1：包裹第三方异步调用

```ts
// 第三方库的异步函数——不知道会不会抛，总是包裹
import { readFile } from 'fs/promises'

async function loadConfig(path: string): AsyncResult<Config, NodeJS.ErrnoException> {
  return Ret.async(readFile(path, 'utf-8'), `read config: ${path}`)
    .then(r => r.map(text => JSON.parse(text) as Config))
}
```

### 场景 2：新建异步函数

```ts
// 本项目的异步函数——返回 AsyncResult，显式声明错误类型
async function queryDB(sql: string): AsyncResult<Row[], DBError> {
  const conn = await Ret.async(pool.getConnection())
  if (!conn.status) return conn // 透传连接错误
  const rows = await Ret.async(conn.value.query(sql))
  conn.value.release()
  return rows
}
```

### 场景 3：链式组合

多个可能失败的异步操作，用 `map` 链式串联，只关心成功路径；错误自动短路。

```ts
const result = await Ret.async(fetch('/api/config'))
  .then(r => r.map(res => res.json()))       // 成功才继续
  .then(r => r.map(config => config.theme))  // 成功才继续

if (result.status) {
  applyTheme(result.value) // Ok<string>
} else {
  // 任一环节失败都到这里
  console.error('failed to load theme:', result.value)
}
```

> 对比裸 Promise 链：一处不 catch，整个链断裂为 unhandled rejection。

## 与生命周期管理的统一

忘记 catch Promise 和忘记 `destroyXxx` 本质相同：

| 遗漏 | 后果 |
| --- | --- |
| 忘了 `destroyXxx(ins)` | 定时器/连接泄露 |
| 忘了 catch Promise | unhandled rejection → crash 或静默失败 |

两者都是「没关闭的句柄」——前者关的是资源句柄，后者关的是错误传播路径。`Ret.async` 就是错误传播路径的 `destroyXxx`：强制关闭，不留隐患。
