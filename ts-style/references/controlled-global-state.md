# 受控全局状态模式

> 本模式是 SKILL.md 第 7 条（避免模块顶层可变状态）的**受控例外**：当全局共享真的不可避免时，用它把「创建—访问—销毁」变成显式、可控、可观测的。

## 何时用

某个变量/容器几乎被项目里**每个模块**频繁访问，若逐层显式传参会导致参数爆炸。此时可把它放模块顶层、经 `import/export` 共享——代价是引入全局状态，所以必须用 4 个生命周期钩子 + 唯一 Owner 来约束它。

> 先问能不能用第 1–7 条（局部实例字段 + create/destroy）解决；再问能不能用第 10 条（抬升到刚好够宽的作用域）解决；答案都是真不行时，才升级成本模式。全局状态是最后手段。需要持续同步时，在本模式的 4 钩子上叠一层 EventEmitter（见 `references/live-resources.md`「进程外状态」节）。

## 变量模块的契约：4 个钩子

变量模块内部用一个**模块级私有槽位**持有状态（对外不可见），导出 4 个钩子：

| 钩子 | 职责 |
| --- | --- |
| `initXxx(...)` | 创建并初始化该全局状态（含任何副作用）。建议幂等。 |
| `getXxx(...)` | 只读访问。未 `init` / 已 `destroy` 时的行为要明确（抛错最稳）。 |
| `setXxx(...)` | 写入/变更。同样需在已 `init` 生命周期内调用。 |
| `destroyXxx()` | 清理状态、回收资源、重置回未 `init`。建议幂等。 |

对外只暴露这 4 个函数（及必要的类型），不暴露内部槽位本身。

### 自定义编辑钩子函数

对于 get 和 set 钩子，其功能过于简单，也可以考虑添加更多高级的钩子，从而对外提供更加便捷的 API，例如 `updateXxx` 钩子；这么做的目的是为了防止外部的模块直接通过 `getXxx` 对复杂变量和数据容器内部进行侵入式修改。

```ts
// ❌ 侵入式：拿到引用后直接改内部，注册表不知情，也无法校验 / 通知
const item = getRegistryItem('foo')
if (item) item.status = 'active'

// ✅ 受控：走 update 钩子，注册表掌控合并，可夹校验 / 通知 / 版本号，还能收窄可改字段（如排除主键 id）
updateRegistryItem('foo', { status: 'active' })
```

## Owner 模型（对使用方的硬性要求）

1. **唯一 Owner**：所有依赖该全局模块的上层模块里，**有且只有一个**调用 `init` 和 `destroy`，称为 Owner。全局状态的生命周期**对齐 Owner**——Owner 起则起、Owner 止则止。
2. **时序契约**：
   - Owner **先于其它模块**初始化（在整个启动/装配链里最早）。
   - Owner 在**任何其它模块调用 `get/set` 之前**调用 `init` 一次且仅一次。
   - Owner 在其它模块**全部卸载、不再使用该状态之后**，才调用 `destroy`。

**非 Owner 模块只能 `get/set`，禁止 `init/destroy`。**

## 完整示例

### 变量模块

```ts
// global-registry.ts
export interface RegistryItem {
  id: string
  name: string
  status: 'active' | 'inactive'
}

// 模块级私有槽位：对外不可见
let state: Map<string, RegistryItem> | null = null

function assertReady() {
  if (!state) throw new Error('registry not initialized (init not called yet)')
}

export function initRegistry(): void {
  if (state) return // 幂等：契约上只调一次，重复调用也安全
  state = new Map()
}

export function getRegistryItem(key: string): RegistryItem | undefined {
  assertReady()
  return state!.get(key)
}

export function setRegistryItem(key: string, value: RegistryItem): void {
  assertReady()
  state!.set(key, value)
}

/**
 * 受控局部更新：合并 patch，由注册表掌控「如何合并」。
 * 外部只描述想改什么，不直接拿到并改写内部对象。
 */
export function updateRegistryItem(
  key: string,
  patch: Partial<Pick<RegistryItem, 'name' | 'status'>>, // 收窄可改字段，排除主键 id
): RegistryItem | undefined {
  assertReady()
  const prev = state!.get(key)
  if (!prev) return undefined
  const next = { ...prev, ...patch } // 不可变更新；可在此夹校验 / 通知 / 版本号
  state!.set(key, next)
  return next
}

export function destroyRegistry(): void {
  if (!state) return // 幂等
  // 回收资源：例如逐个释放 item 持有的句柄
  state.clear()
  state = null
}

// 额外钩子
export function deleteItem(key: string) {
  assertReady()
  state!.delete(key)
}
```

### Owner 模块

```ts
// app.ts —— 唯一的 Owner
import { initRegistry, destroyRegistry } from './global-registry'
import { createFeatureA, destroyFeatureA } from './feature-a'
import { createFeatureB, destroyFeatureB } from './feature-b'

export function createApp() {
  initRegistry() // ① 最先：在任何 get/set 之前，一次
  const a = createFeatureA() // ② 之后其它模块才 create，内部会 get/set
  const b = createFeatureB()

  return {
    run() {
      a.do()
      b.do()
    },
    shutdown() {
      destroyFeatureA(a) // ③ 先把其它模块卸完
      destroyFeatureB(b)
      destroyRegistry() // ④ 最后才 destroy 全局状态
    },
  }
}
```

### 普通依赖模块（非 Owner）

```ts
// feature-a.ts —— 只 get/set，绝不 init/destroy
import { getRegistryItem, setRegistryItem } from './global-registry'

export function createFeatureA() {
  return {
    do() {
      const prev = getRegistryItem('foo')
      setRegistryItem('foo', { /* … */ })
    },
  }
}

export function destroyFeatureA(ins: ReturnType<typeof createFeatureA>) {
  /* 收尾 */
}
```

## 生命周期时序（对齐 Owner）

```
Owner 启动 ─────────────────────────────────────── Owner 卸载
   │                                                  │
   init()──┐                              ┌──destroy()
           │  registry 活跃区间           │
           ▼  （可安全 get/set）           │
   其它模块 create …… get/set …… destroy 其它模块
                                              │
                                       (Owner 最后 destroy)
```

`init` 与 `destroy` 之间是状态「活的」窗口；窗口两端都由 Owner 控制，其它模块的整个生命周期必须落在窗口内。

## 注意事项

- **幂等的 `init`/`destroy`**：多次调用安全，防热重载/重复装配时崩溃；但契约上仍是「应只调一次」。
- **未初始化访问**：`get/set` 在 `init` 前、`destroy` 后的行为要统一并文档化——**抛错最稳**，能在第一时间暴露「谁在 Owner 之外提前/延后访问」。
- **Owner 要显式标注**：在模块/文档里写明谁是 Owner，避免后人误在第二个模块里 `init`。
- **测试**：每个用例走 `init → … → destroy`（如 `beforeEach/afterEach`），避免用例间串味。
- **别滥用**：能用局部实例字段（第 1–7 条）解决，就不要升级成全局。
