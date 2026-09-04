# 作用域收窄与抬升

> 对应 SKILL.md 第 10 条「最小必要作用域」。两条互补的手法，把变量的生命周期控制在刚刚好的范围内。

## 原则

作用域有两种展开模式：

- **全局作用域**：一次程序运行期间只被展开一次。其中的状态经历一次创建和一次销毁，无法被重置——想重置只能重启程序。因此全局作用域中只适合放置**不变的东西**：常量、纯函数、不可变配置。可变状态放在全局 = 无法销毁 = 规则 7 禁止的行为。
- **局部作用域**：一次程序运行期间可以被反复展开多次。每次展开都是独立实例——`create`/`destroy` 可以反复执行、互不污染。可变状态就应该放在这里。

一个变量的生命周期越短越好。它不一定需要成为单例——只要生命周期足以覆盖所有依赖它的模块即可。"全局"是最后的兜底，不是默认选项。

## 用常量替代变量：init/destroy 即 set/update

常量缺少 `set`/`update` 钩子——一经创建就不可变。但可以用**多个常量在时间上接力**来达到「变更」的效果：每次需要变更时，`destroy` 旧常量，`init` 新常量。**`init → destroy → init` 就是 `set`/`update` 的常量版本。**

```ts
// 变量版本：一个值反复改
let count = 0
count = 1
count = 2

// 常量版本：三次 init/destroy，每次创建一个不可变的新实例
let state = initCounter(0)  // 常量 1
destroyCounter(state)
state = initCounter(1)      // 常量 2
destroyCounter(state)
state = initCounter(2)      // 常量 3
destroyCounter(state)
```

> 这要求作用域能**被反复展开**——全局作用域不行（它只展开一次），局部作用域可以（每次展开都是独立的常量实例）。这就是为什么规则 10 说「向下收窄」：只有收进局部作用域，常量接力才成立。

在响应式编程中，这种模式被进一步自动化：每次上游数据变化 → `destroy` 旧状态 → `init` 新状态 → 下游自动感知新常量。`set` 不是「改了旧值」，而是「销毁旧常量、创建新常量」——这就是函数式编程中「销毁旧值并创建新值」在生命周期框架下的精确表达。

## 手法 1：向下收窄

从模块顶层 → `main()` 函数 → 更内层作用域，逐级下移。

### 示例

```ts
// ❌ Before：模块顶层缓存——生命周期 = 进程级别，无处销毁
const dataCache = new Map<string, Data[]>()

export function loadData(key: string): Data[] {
  if (dataCache.has(key)) return dataCache.get(key)!
  const data = fetchData(key)
  dataCache.set(key, data)
  return data
}

// ✅ After：收进 main()——生命周期对齐 main，可销毁
function createCachedLoader() {
  const cache = new Map<string, Data[]>()
  return {
    load(key: string): Data[] {
      if (cache.has(key)) return cache.get(key)!
      const data = fetchData(key)
      cache.set(key, data)
      return data
    },
    destroy() {
      cache.clear()
    },
  }
}

function main() {
  const loader = createCachedLoader()
  // … 需要缓存的地方通过 loader 参数传入 …
  loader.destroy() // main 结束时显式清理
}
main()
```

> 缓存的生命周期从"进程级别"缩短为"main() 级别"。如果还不需要活满整个 main，继续下移到更内层的子流程函数中。

## 手法 2：向上抬升

当变量 B 和 C 都需要 A，而 A 当前在某个内层作用域中只有 C 能访问，就把 A 往上抬，直到外层作用域同时覆盖 B 和 C。

### 示例

```
Before（config 藏在 createC 内部，createB 拿不到）：
main()
 ├── createB()      ← 需要 config，拿不到
 └── createC()
      └── config    ← 在 C 里面

After（config 上提到能同时覆盖 B 和 C 的 main 层）：
main()
 ├── config = loadConfig()   ← 上提到这里
 ├── createB(config)         ← 现在能拿到了
 └── createC(config)         ← 也能拿到了
```

```ts
// ❌ Before：config 在 createC 内部生成，B 需要但够不着
function main() {
  const b = createB(/* 缺 config */)
  const c = createC() // config 藏在 createC 里面
}

// ✅ After：config 上提到 main 层——刚够覆盖 B 和 C
function main() {
  const config = loadConfig() // 抬升
  const b = createB(config)
  const c = createC(config)
  // B 和 C 都能拿到，config 也只在 main 级别，不是全局
}
```

> 抬升只抬到"刚好够"——如果只有 B 和 C 需要，就别抬到比 main 更外层（如模块顶层）。"刚刚好覆盖"是目标：不过度，不留缺口。

## 与第 7–9 条的协作

- **第 7 条**：禁止顶层可变状态。本条给你「搬去哪」的具体答案。
- **第 8 条**：受控全局作为最后手段。本条让你先问：「能不能抬升到刚好够宽的作用域，而非一步升级成全局？」
- **第 9 条**：函数通过参数拿依赖。**只有依赖参数化了，变量才能留在窄作用域里**——否则函数会闭包抓取外层变量，迫使变量留在外层。
