# 测试：这套风格的直接收益

> 规则 1–12 不是为了让代码"好看"——每条规则都直接降低测试成本。本 reference 展示各规则在测试中的具体收益。

## interface 即 mock 接口

规则 1–3（状态 + 行为 interface，Impl 不导出）意味着：**写 mock 不需要 mocking library**。实现一个 interface 就是 mock。

```ts
import type { Loader } from './data-loader'

// 规则 3 的直接收益：针对 interface 手写 mock，不依赖 jest.mock / sinon
function createMockLoader(items: Item[]): Loader {
  return {
    cache: new Map(), // 规则 1：纯数据 interface 字段随便造
    async load(_key: string) {
      return Ok(items) // 规则 12：AsyncResult 让 mock 返回同样类型
    },
  }
}
// 不需要 jest.mock('./data-loader') —— interface 就是契约
```

## 纯 create → 测试不需要 setup 全局状态

规则 4（`createXxx` 纯装配）和规则 7（无顶层可变状态）意味着：**测试之间零串味**。每次 `createXxx()` 都是全新的独立实例。

```ts
describe('Loader', () => {
  let loader: Loader

  beforeEach(() => {
    loader = createLoader() // 规则 4：纯装配，不需要 teardown 全局状态
  })

  afterEach(() => {
    destroyLoader(loader) // 规则 5：显式清理，下一个用例从零开始
  })

  it('returns cached data on second load', async () => {
    // 每个用例独立的 loader，互不干扰
  })
})
```

> 对比传统的"模块顶层单例"：测试间 cache 残留，用例顺序敏感，调试成本极高。

## AsyncResult → 测试不需要 try-catch

规则 12（`AsyncResult` 替代裸 Promise）意味着：**断言失败路径和断言成功路径一样简单**。

```ts
// 规则 12 的收益：不需要 try-catch，直接读 result.status
it('returns error when network fails', async () => {
  const result = await loader.load('nonexistent')
  expect(result.status).toBe(false)
  expect(result.value).toBeInstanceOf(Error)
})

it('returns data on success', async () => {
  const result = await loader.load('foo')
  expect(result.status).toBe(true)
  expect(result.value).toHaveLength(3)
})
```

对比裸 Promise：
```ts
// ❌ 裸 Promise 的测试：需要 try-catch 才能断言错误
it('promise test', async () => {
  try {
    await fetchUser('bad-id')
    fail('should have thrown') // 啰嗦
  } catch (e) {
    expect(e).toBeInstanceOf(Error) // e 是 any，类型不安全
  }
})
```

## 显式生命周期 → 测试天然隔离

规则 5（显式 `destroyXxx`）和规则 10（最小作用域）意味着：**每个用例是一个完整的 create→use→destroy 周期**，定时器被清、连接被关、缓存被清空。

```ts
describe('PollSource', () => {
  let poll: PollSource
  beforeEach(() => {
    poll = createPollSource('/api', 100)
    initPollSource(poll)   // 启动轮询
  })
  afterEach(() => {
    destroyPollSource(poll) // 停定时器。下一个用例从干净的计时器状态开始
  })

  it('fetches on start', () => { /* … */ })
  it('stops on demand', () => { /* … */ })
})
```

## 脏函数分类 → 知道哪些要 mock、哪些不用

规则 11 的三种脏形态直接映射测试策略：

| 形态 | 测试策略 |
| --- | --- |
| 隐式参数 | 参数化后，测试直接传入替身，不用 mock 模块顶层变量 |
| 修改参数 | 不可变更新后，测试比较输入/输出即可，无需验证副作用 |
| IO 函数 | `init`/`destroy` 管住的 IO，测试换一个不连网的 Impl |
| 私有闭包（可原谅） | `memoize`/`throttle` 等，测试其输入输出行为即可 |
| 局部变量（可原谅） | 不泄漏引用的 builder 函数，测试返回结果即可 |
| 独立 IO（可原谅） | logger/metrics，测试时不验证其调用，或换 noop 实现 |

## 完整测试文件示例

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createLoader, initLoader, destroyLoader, Loader } from './data-loader'
import { Ok } from './async_result'

describe('DataLoader', () => {
  let loader: Loader

  beforeEach(() => {
    loader = createLoader()     // 规则 4：纯装配
    initLoader(loader)          // 规则 4：副作用启动
  })

  afterEach(() => {
    destroyLoader(loader)       // 规则 5：清理
  })

  it('returns cached data on second call', async () => {
    // 第一次加载走网络（需 mock fetch）
    const r1 = await loader.load('k1')
    expect(r1.status).toBe(true)

    // 第二次直接从缓存拿
    const r2 = await loader.load('k1')
    expect(r2.status).toBe(true)
    expect(r2.value).toBe(r1.value)
  })

  it('returns error for invalid key', async () => {
    const result = await loader.load('')
    expect(result.status).toBe(false)
  })

  it('isolates state between tests', async () => {
    // 这里 loader 是全新的，上一用例的缓存不残留
    expect(loader.cache.size).toBe(0)
  })
})
```

注意这个测试文件本身也遵循了风格：
- `loader` 变量在 `describe` 作用域（不是模块顶层）—— 规则 10 向下收窄
- `beforeEach`/`afterEach` 配对 —— 规则 5 的 create/destroy 一一对应
- 没有模块顶层可变状态 —— 规则 7
