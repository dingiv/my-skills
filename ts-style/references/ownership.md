# 所有权与生命周期

## 所有权与生命周期的关系

两者是一体两面，交汇于 `destroy`：

- **所有权**回答「**谁负责**」——谁调 `init` 打开资源、谁调 `destroy` 释放资源、谁有权限修改它。
- **生命周期**回答「**活多久**」——资源从哪个时刻开始存在（`init`/`create`），在哪个时刻终结（`destroy`），中间的使用窗口有多长。

```
create/init ──── 使用窗口 ──── destroy
    ↑                              ↑
  所有权诞生                    所有权了结
  生命周期开始                 生命周期结束
```

两者的映射：**所有者 = 生命周期的守门人**。Owner 决定 init 的时刻（生命周期起点），也决定 destroy 的时刻（生命周期终点）。所有权转移 = 生命周期责任的交接。作用域 = 生命周期的自然容器——变量离开作用域时，其所有者（即该作用域）应清理其资源。

---

## 四条基本原则

### 原则 1：只有变量的所有者才可以修改它

修改权是所有权的一部分。一个变量被谁所有，就应该由谁来控制其内容的变更。这不是说其他模块完全不能触发修改——它们可以通过 Owner 暴露的受控接口（如 `set` 钩子）间接变更——但修改的**最终控制权和责任**在 Owner。

### 原则 2：变量归属于创建它的那个作用域

`const loader = createLoader()` —— `loader` 归当前作用域所有。作用域是 JS 中最自然的「所有权容器」：变量在作用域内诞生，作用域结束时销毁。这条原则把所有权和词法作用域绑定在一起。

### 原则 3：生命周期 ≤ 归属作用域；作用域关闭时负责清理

变量的生命周期不得长于其归属的作用域。当作用域被关闭（函数返回、块结束、模块卸载），该作用域应当负责清理变量占用的所有非内存资源。这就是 `destroyXxx` 的调用时机——不是「记得的时候调一下」，而是**作用域关闭时的必然动作**。

```ts
function main() {
  const loader = createLoader()   // loader 归属于 main 作用域
  initLoader(loader)              // 生命周期开始（≤ main 作用域）
  // … 使用 …
  destroyLoader(loader)           // 作用域关闭前，清理资源
}                                 // ← loader 的生命周期不得长于此
```

### 原则 4：所有权可以通过函数传参和函数返回来转移

```ts
// 返回转移：createXxx 将所有权交给调用方
function main() {
  const loader = createLoader()  // 所有权: createLoader → main
  destroyLoader(loader)
}

// 参数转移：接管（takeOver）将所有权从调用方转入被调方
function takeOver(loader: Loader): Loader {
  return loader  // 调用方之后不再使用 loader
}
```

> 参数传入时，默认是「借用」（不转移所有权）。接管需要显式信号——函数名以 `take`/`consume` 开头，或文档中显式说明。

### 原则 5: get/set 和其他任何钩子在调用时，必须在资源的生命周期存蓄期间调用

其他模块通过可变或者不可变引用调用 get/set 等钩子时，不得早于 Owner init 钩子执行，也不得晚于 Owner destroy 钩子执行之后；

---

## JS/TS 与 Rust 的分歧

Rust 的所有权由编译器强制：一个值在任意时刻**要么有一个可变引用，要么有多个不可变引用**。JS/TS 有 GC 管内存，所有权模型聚焦非内存资源，且允许更宽松的引用规则。

| 概念 | Rust | 本风格 (JS/TS) |
| --- | --- | --- |
| 资源释放 | 编译器插入 `drop` | `destroyXxx` 显式调用 |
| 所有者 | 变量绑定即所有 | 调 `init`/`destroy` 的 Owner |
| 可变引用 | 同一时刻最多一个 `&mut T` | **允许多个**——所有模块都可调 `set` |
| 不可变引用 | 可多个 `&T` | 所有模块都可调 `get` |
| 借用检查 | 编译期 | 纪律 + 约定 |
| 收窄可变权限 | `&mut T` 独占 | EventEmitter 模式（见下文） |

基于这组分歧，本风格在四条原则之上，补充三条 JS/TS 特有的「适配规则」：

### 适配规则 1：一个资源，一个 Owner；Owner 负责 init/destroy

每个非内存资源有且只有一个 Owner。Owner 是生命周期的守门人，负责在合适的时机 `init` 和 `destroy`。其他模块可以借用（`get`），也可以写入（`set`），但**只有 Owner 能打开和关闭生命周期**。

这与原则 2、原则 3 对齐：Owner 通常是创建该资源的作用域，且必须在该作用域关闭前完成 `destroy`。

### 适配规则 2：允许多个可变引用——所有模块都可以调用 set 钩子

这是与 Rust 最大的分歧，也是对原则 1（「只有所有者可以修改」）的**受控放宽**。

在 Rust 中，多个 `&mut T` 不被编译通过。在 JS/TS 中，**所有持有 interface 引用的模块都可以调用 `set` 钩子写入**。理由是：JS 是单线程、序贯执行，数据竞争不是问题；且强制单一可变引用会带来大量不必要的间接层。放宽后，真正的问题不是「谁可以写」，而是**「写完之后资源是否被正确回收」**——这由适配规则 1（Owner 管 destroy）兜底。

```ts
// module-a.ts —— 写入者 1
setRegistryItem('foo', { status: 'active' })

// module-b.ts —— 写入者 2
setRegistryItem('foo', { name: 'bar' })

// Owner（main）—— 唯一负责 init 和 destroy
```

### 适配规则 3：需要收窄 set 权限时，用 EventEmitter 模式

如果需要严格回到「只有 Owner 可以 set」——例如 `set` 内部有复杂校验或副作用链——不要靠约定来限制，而是靠 API 设计：**`set` 不出现在对外 interface 上**。Owner 独占 `set`，其他模块通过 emit 事件表达写入意图，Owner 监听并代为执行。

```ts
// 对外 interface：只有 get + onChange，没有 set
export interface ReadonlyStore {
  get(): number
  onChange(fn: (val: number) => void): () => void
}

// Owner 私有 set（不出现在 interface 上）
class StoreImpl {
  set(val: number) { /* 只有 Owner 能调 */ }
}

// 其他模块想"写"
// → 不能调 set（interface 上没有）
// → 只能 emit 意图，由 Owner 代为执行
```

这就是 JS/TS 版的「可变引用收窄」——Rust 靠编译器独占 `&mut`，JS/TS 靠**结构**（interface 不暴露 `set`）。从「约定收窄」升级为「结构收窄」。

---

## 借用

借用是临时使用 interface 引用、不承担销毁责任的行为。

```ts
function render(store: CounterStore) {
  const val = store.get()  // 只读
  // 不调 destroyCounterStore(store) —— 借用
}
```

### 借用转偷（最常见所有权 bug）

把借来的引用存进长生命周期变量，绕过了所有权边界：

```ts
let cached: CounterStore | null = null

function setup(store: CounterStore) {
  cached = store  // ❌ 借用转偷：store 的 Owner 随时可能 destroy 它
}
```

> 法则：如果你没有在这个作用域里 `create` 它，也没有从前一个所有者那里**显式接管**它，就不要把它存在比当前调用更长的生命周期里。这对应原则 3——被借用变量的生命周期由它的 Owner 控制，借用方不应假设它比自己活得更久。

---

## 级联所有权

这里有一个反直觉的关系：**父作用域依赖于子作用域**。父模块的功能正确性建立在子模块正确运行的基础上——子出错，父也出错。因此父必须保证子在其需要时存活，在不需要时被正确清理。

父作用域通过工厂创建子模块，形成所有权树。依赖关系就是所有权关系——依赖树就是所有权树。销毁按**创建逆序**：

```ts
function createApp() {
  const loader = createLoader()     // app 作用域拥有 loader
  const reporter = createReporter() // app 作用域拥有 reporter

  return {
    destroy() {
      destroyReporter(reporter)  // 后创建的先销毁（reporter 可能依赖 loader）
      destroyLoader(loader)      // 先创建的后销毁
    },
  }
}
```

> 对应原则 2（归属创建作用域）和原则 3（作用域关闭时清理）：子模块归属于父作用域，父作用域关闭时级联清理所有子模块。销毁顺序 = 装配逆序。

---

## 常见反模式

| 反模式 | 违反的原则 | 纠正 |
| --- | --- | --- |
| **共享所有权**（两个模块都认为自己是 Owner） | 适配规则 1 | 指定唯一 Owner |
| **孤儿资源**（创建了但没人 destroy） | 原则 3 | `create` 后必有对应的 `destroy` |
| **所有权泄漏**（函数内 create 了资源，只返回结果） | 原则 2/3 | 要么返回资源，要么在函数内 destroy |
| **借用转偷** | 原则 3 | 不存参数引用；需长期持有 → 接管 |
| **悬空引用**（`destroy` 后仍使用） | 原则 3 | destroy 后置 `null` |
| **顶层变量** | 原则 2（无归属作用域） | 规则 7——收进 `main()` 或实例字段 |

---

## 与所有规则的映射

| 所有权 / 生命周期概念 | 对应规则 |
| --- | --- |
| 归属创建作用域（原则 2） | 规则 4（`createXxx`）、规则 10（作用域层级） |
| 生命周期 ≤ 作用域（原则 3） | 规则 5（显式销毁）、规则 7（禁止顶层无归属状态） |
| 所有者在作用域关闭前清理（原则 3） | 规则 5、补充约定"级联销毁" |
| 所有权转移（原则 4） | 规则 4（`createXxx` 返回转移所有权） |
| 一个 Owner，管 init/destroy（适配规则 1） | 规则 8（唯一 Owner）、规则 4/5 |
| 多可变引用（适配规则 2） | 规则 8 的 `set` 钩子对非 Owner 开放 |
| 收窄 set 为仅 Owner（适配规则 3） | EventEmitter 模式、规则 2（行为接口只暴露 emit） |
| 借用不转移所有权 | 规则 6（持 interface 类型）、规则 9（参数化） |

所有权和生命周期是这个风格的一体两面：**所有权定义责任链（谁管），生命周期定义时间窗（多久）。** 原则 1-4 给出了这个关系的基本定律，三条适配规则是它在 JS/TS 土壤上的落地——保留了核心纪律（一个 Owner、显式清理、作用域边界），又做了务实的妥协（允许多方可写、用 EventEmitter 收窄）。
