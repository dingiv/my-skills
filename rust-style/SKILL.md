---
name: rust-style
description: Rust 项目的分层代码风格，主张「面向数据的作用域 + 显式生命周期」。分三层：代码层（函数纯度 / 常量与命名 / 控制流数据化 / 错误语义）、模块层（trait 契约 / 显式生命周期 / 作用域与依赖）、进程层（基础设施 / IO / 监督 / 并发）。在以下场景推荐遵循——创建新模块/新类型、定义 trait 或 struct、实现带副作用的功能（连接池、文件句柄、网络连接、后台任务、订阅、缓存等）、消灭魔法数字与长分支、或重构现有模块结构。推荐做法——用 trait 表达契约、struct 不公开导出、用工厂函数隐藏构造、显式管理非内存资源的生命周期、用 Result 显式传播错误。关键词：rust、lifecycle、ownership、trait、factory、scope、resource management、error handling、分层、magic number、dispatch。
---

# 面向数据的作用域 + 生命周期编程 (Rust)

Rust 项目的**推荐**分层风格。它分三层，从微观到宏观：

- **代码层**——单个函数 / 表达式怎么写对：函数纯度、常量与命名、控制流数据化、错误语义。
- **模块层**——模块 / trait 怎么设计：契约、显式生命周期、作用域与依赖。
- **进程层**——进程级资源怎么治理：基础设施（日志 / 配置 / 持久化）、IO、监督、并发。

Rust 编译器已强制了所有权、借用、Drop、不可变默认——这些都是免费的。本 style 聚焦编译器**管不到**的部分。

> 这是一套推荐风格，不是硬性约束。默认遵循；当它与具体场景的需求明显冲突时，再以工程判断取舍。

## Rust 已免费提供的能力

| 能力 | Rust 机制 | 说明 |
| --- | --- | --- |
| 唯一所有权 | move 语义 + 借用检查 | 一个值在任意时刻只有一个 owner |
| 不可变默认 | `let` vs `let mut` | 默认不可变，显式声明可变 |
| 独占可变引用 | `&mut T` 编译期检查 | 同一时刻最多一个 `&mut` |
| 自动清理 | `Drop` trait | 离开作用域时自动释放内存 |
| 显式错误 | `Result<T, E>` | 错误路径在类型上可见 |
| 接口抽象 | `trait` | 等价于 TS 的 interface |
| 可见性控制 | `pub` / `pub(crate)` / 私有 | struct 字段和 impl 方法分开控制 |

因此，TS style 里的规则 7（避免顶层可变状态）、大部分所有权规则、AsyncResult——在 Rust 里都是编译器层面的保证。本 style 分三层补充编译器之外的东西。

---

## 分层总览

| 层 | 关注 | 规则 | 详见 |
| --- | --- | --- | --- |
| **代码层**（微观） | 函数 / 表达式 | R1 函数纯度 · R2 常量与命名 · R3 控制流数据化 · R4 错误语义 · R5 返回值即契约 | `references/code/lexicon.md` · `references/code/errors.md` |
| **模块层**（中观） | 模块 / trait | R1 trait 契约 · R2 拆 trait · R3 生命周期契约 · R4 构造纯净 · R5 局部作用域 · R6 最小作用域 · R7 显式依赖 | `references/module/patterns.md` · `references/module/scope-hoisting.md` |
| **进程层**（宏观） | 基础设施 / 资源 | R1 基础设施集中 · R2 生命周期移交 · R3 并发约束 · R4 IO 带 deadline | `references/process/infrastructure.md` · `references/process/io.md` · `references/process/supervision.md` · `references/process/concurrency.md` |
| **横切** | 贯穿三层 | 测试 · 反模式 | `references/cross/testing.md` · `references/cross/anti-patterns.md` |

> 层的读法：代码层是地基（表达式写对），模块层是骨架（trait / 生命周期 / 作用域），进程层是治理（资源 / 基础设施）。下层稳定则上层可靠；跨层引用用「层名 Rn」（如「模块层 R1」「代码层 R4」）。

---

## 一、代码层：函数与表达式

### R1 函数纯度：脏函数分类

Rust 的脏函数（产生或依赖非显式、不受控副作用的函数）也有三种形态：

| 形态 | 脏在哪 | Rust 中的纠正 |
| --- | --- | --- |
| **隐式参数** —— 捕获外部变量 / 读 `static` | 依赖藏在函数体里 | 参数化接收（模块层 R7） |
| **修改参数** —— 通过 `&mut` 修改了入参内部数据 | 副作用沿引用泄漏 | 返回新值；或明确文档化 `&mut` 的含义 |
| **IO 函数** —— 访问进程外数据（网络、文件、DB） | 进程外依赖无生命周期 | `connect`/`close` 管住生命周期（模块层 R3） |

Rust 的一个区别：`&mut` 修改入参是**显式的**（类型上写了 `&mut`），不像 TS 那样隐蔽。因此「修改参数」在 Rust 中不是隐藏的陷阱，而是签名上可见的约定——调用方知道你在改它。

**目标图像**：除了 `main`，其他都是纯函数。`main` 负责组装、执行 IO、初始化和销毁；业务逻辑链上的函数只做纯数据变换。

### R2 常量与命名：消灭魔法数字

出现在业务逻辑里的每个数字，先问「它是什么」再命名。`const` / `static` 命名常量、newtype 编码量纲、enum 表达档位——让含义自明、改一不漏三、单位不可混。`0`/`1` 作下标或标志、纯数学常量、测试断言值之外，一律命名。详见 `references/code/lexicon.md`。

### R3 控制流数据化：长分支改查表

长 `match` / `if-else` 链，**分支体同质**（每分支只是同一类操作换了参数）时，其实是用控制流表达数据。改写成**查表 + 数据驱动**：新增分支 = 加一行常量数据，分发逻辑保持稳定。分支体异质则保留 `match`。详见 `references/code/lexicon.md`。

### R4 错误语义：传播 + 建模 + 失败路径

Rust 的 `Result<T, E>` 已强制错误类型可见。本规则补两层约定：

**传播**：不要用 `unwrap()` / `expect()` 吞掉可恢复的错误。`unwrap` 只允许在「此处失败意味着程序无法继续」的边界（如 `main`、初始化阶段）。业务逻辑中走 `?` 传播或用 `match` 处理。

```rust
// ✅ 边界处可以 expect
let config = load_config().expect("config must be present at startup");

// ✅ 业务逻辑中传播
fn process() -> Result<(), AppError> {
    let data = fetch_data()?;  // 传播
    Ok(())
}
```

**失败语义三路径**：每个错误按功能重要度选路径——**退出**（核心路径失败，边界 `expect` / `main` 返回 `Err`）、**传播**（`?` 上抛）、**降级**（`match` 捕获 + `tracing::warn!` 后继续，功能独立失效）。判据：非核心依赖「独立失效」优于拖垮主流程。

错误类型**本身**怎么设计（enum 变体 / `thiserror` / `From` 聚合 / `anyhow` 与 `thiserror` 的库应用分层）见 `references/code/errors.md`。

### R5 返回值即契约：能返回信息就别返回 ()

函数的返回值是契约的一部分——它携带信息或义务。**能返回信息就不要返回 `()`**；返回了信息，调用方就该处理它，而不是 `let _ =` 丢掉。`()` 只留给「真的没有任何信息」的纯动作（`drop`、`clear`、`flush`）。

两个推论：

1. **能返回就别吞**——操作产生了调用方可能关心的东西（状态、数量、句柄），就返回它，让调用方决定。返回 `()` 等于替调用方做了「都不重要」的决定。

```rust
// ❌ 错：吞掉调用方可能关心的处理数量
fn process(items: &[Item]) {
    for it in items { handle(it); }
}

// ✅ 对：返回结果，调用方决定怎么用
fn process(items: &[Item]) -> usize {
    items.iter().filter(|it| handle(it)).count()
}
```

2. **该被消费的返回值标 `#[must_use]`**——让「被忽略」变成编译警告而非静默。标准库对 `String` / `Result` / `Future` 都这么标，正因为静默丢弃它们 = 丢信息 / 丢义务。

```rust
#[must_use = "处理结果被丢弃，会丢失成功/失败信息"]
fn process(items: &[Item]) -> ProcessResult { /* … */ }

process(&items);          // ⚠ unused_must_use：裸语句丢弃
let r = process(&items);  // ✅ 正常消费
let _ = process(&items);  // 能过编译，但你在显式吞——要意识到这一点
```

> `#[must_use]` 对裸语句生效、对 `let _ =` 不生效（显式丢弃被视为有意）——它是「让忽略变得可见」，不是「禁止忽略」。判断「该不该忽略」仍是你。这与 `references/process/supervision.md` 的 `let _ =` 遗弃签名是同一族：编译器逼你看见，取舍仍在你。

---

## 二、模块层：契约、生命周期与作用域

### R1 契约用 trait 表达，struct 不公开导出

对外的契约是 trait（等价于 TS 的 interface），实现 struct 保留在模块内部（`pub(crate)` 或私有）。依赖方只依赖 trait，依赖倒置（DIP）由此而来。

```rust
// ✅ 对：trait 公开，struct 不公开
pub trait Animal {
    fn name(&self) -> &str;
    fn age(&self) -> u32;
    fn fly(&mut self);
    fn sound(&self);
}

struct AnimalImpl {
    name: String,
    age: u32,
}

impl Animal for AnimalImpl {
    fn name(&self) -> &str { &self.name }
    fn age(&self) -> u32 { self.age }
    fn fly(&mut self) { /* … */ }
    fn sound(&self) { /* … */ }
}

pub fn create_animal(name: String, age: u32) -> impl Animal {
    AnimalImpl { name, age }
}
```

> **经济判据（投入换复用）**：trait 是对复用的**赌注**——前置成本是抽象本身，收益是后续可替换 / 可 mock / 可异构。只调用一次、测试里也不会换实现的，先用具体函数；有 ≥2 个实现、或预期会被替换 / mock 时，才值得抽 trait。判据是**未来的使用频率**：频率不够，抽象就是纯负担。

> **理论基础（能力检测）**：trait 是**能力检测**——依赖方不问「你是谁 / 你在哪里」（身份），而问「你能做什么」（能力）。依赖的是 `Iterator` / `Send` / `Connection` 这类能力，而非某个具体类型的身份。正因依赖能力而非身份，实现才可替换。

> 适用边界：本条针对**应用代码**。库 crate 公开具体类型是常态（调用方需要具名、装箱、derive）——此时规则降级为「对外能力用 trait 表达，让调用方能以 trait bound 替换或 mock」，不必隐藏 struct 本身。

### R2 行为按职责拆成多个 trait

把方法按职责拆分进若干细粒度 trait，再用 trait bound 或组合 trait 来表达完整契约。接口隔离（ISP）由此而来。

```rust
pub trait FlyBehavior { fn fly(&mut self); }
pub trait SoundBehavior { fn sound(&self); }

// 完整契约：组合多个 trait
pub trait Bird: FlyBehavior + SoundBehavior {
    fn name(&self) -> &str;
}
// 消费方只依赖自己需要的 trait：
fn make_it_fly(ins: &mut impl FlyBehavior) { ins.fly(); }
```

### R3 非内存资源的生命周期写进契约

Rust 的 `Drop` 自动处理内存释放，但**非内存资源**（连接、文件句柄、定时器、后台线程、缓存）需要显式生命周期管理。**`connect` / `close` 是 trait 方法。** `Drop` 可以作为兜底，但不应是唯一的清理路径。启动与关闭是调用方需要知道的契约内容，放进 trait；`close` 消耗自身（`self`），让「关闭后再使用」成为编译错误。

```rust
pub trait Connection: Send {
    fn status(&self) -> ConnState;
    fn connect(&mut self) -> Result<(), ConnError>;   // init：副作用（建立连接）在此启动
    fn send(&mut self, msg: &str) -> Result<(), ConnError>;
    fn close(mut self) -> Result<(), ConnError>;      // 消耗自身：关闭后无法再用
}

// create 纯装配：只存配置，不碰网络
pub fn create_connection(url: &str) -> impl Connection { /* ConnImpl { url, socket: None } */ }

// 使用方：
// let mut conn = create_connection(url);
// conn.connect()?;    // 副作用显式启动
// conn.send("ping")?;
// conn.close()?;      // 显式关闭；Drop 只作兜底
```

> `Drop` 可以在 `close` 未调用时兜底关闭，但**不能代替** `close`——`Drop` 无法返回错误，且调用时机不可控。
> 若以 `Box<dyn Connection>` 持有，`close` 写成 `fn close(self: Box<Self>)`；若资源被 `Arc` 共享（多线程 / async 任务各持一份克隆），无法消耗自身，改用 `&self` + 内部同步或优雅关闭标志（见 `references/module/patterns.md` 第 4 节）。

### R4 构造保持纯净

工厂函数（`create_xxx`）只做装配：构造 struct、赋值字段，**不**产生副作用（不开连接、不启动后台任务）。副作用放到 trait 的 `connect` / `start` 方法，由调用方显式触发。

### R5 优先局部作用域，避免不必要的全局状态

Rust 的 `static` / `lazy_static` / `OnceCell` 是全局状态——一次程序运行期间只初始化一次，无法重置。只适合放**真正不可变**的常量、纯函数、不可变配置。可变全局状态应尽量避免；如果必需，用 `Mutex<...>`（或读多写少的 `RwLock<...>`，二选一）包装，并显式管理生命周期。

```rust
// ✅ 对：不可变常量放全局
static CONFIG: Lazy<Config> = Lazy::new(|| load_config().expect("config init"));

// ❌ 避免：可变状态的 lazy_static + Mutex 对测试不友好，无法 reset
// 优先在 main() 中创建并通过参数注入
```

### R6 最小必要作用域

变量的生命周期越短越好。能放在 `main()` 里就不要放在模块顶层。需要跨模块共享时，把变量从内层作用域向上抬升，直到刚好覆盖所有依赖方。详见 `references/module/scope-hoisting.md`。

### R7 函数显式声明依赖

函数通过参数接收依赖，而不是直接访问模块级变量或 `static`。签名即契约，测试时传 mock 也方便。

```rust
// ❌ 隐式依赖：函数直接抓 static
fn load_data(key: &str) -> Data {
    CONFIG.client.fetch(key) // 隐式依赖 CONFIG
}

// ✅ 显式依赖：client 作为参数传入
fn load_data(client: &Client, key: &str) -> Data {
    client.fetch(key)
}
```

### 可见性与选型：impl Trait vs Box<dyn Trait>

struct 的字段默认私有，`impl` 方法按需公开。工厂函数返回 `impl Trait` 或 `Box<dyn Trait>`，不让调用方接触到 struct 类型。二者选型：

| 维度 | `impl Trait` | `Box<dyn Trait>` |
| --- | --- | --- |
| 分发 | 静态（单态化） | 动态（vtable） |
| 开销 | 零 | 堆分配 + 一次间接调用 |
| 返回类型 | 锁死为单一具体类型 | 可容纳任意实现 |
| 异构集合 | 不能（`Vec<impl Trait>` 非法） | 能（`Vec<Box<dyn Trait>>`） |
| 运行时替换 | 不能 | 能 |
| 能否再当泛型参数 | 能 | 不能（只能 dyn 分发） |
| `async fn` in trait | 无影响 | `dyn Trait` 失效，需 `async-trait` |

默认 `impl Trait`（零开销）；需要异构集合 / 运行时替换 / 跨 crate 持有未知实现时用 `Box<dyn Trait>`；`async fn` 下选 `dyn` 的替代方案见 `references/process/concurrency.md` §2。更深层的判据是**使用频率**（投入换复用）：trait 与 `Box<dyn>` 都是前置投入，收益是后续复用 / 替换；频率不够则反噬成债务。

### SOLID 映射（无 IOC 容器）

这套风格不靠 IOC 容器也满足 SOLID：

- **SRP**：行为 trait 按职责拆分（R2），每个只管一类动作；`create` 管装配、`close` 管回收，各司其职。
- **OCP**：新行为 = 新 trait / 新 impl，不改既有契约。
- **LSP**：使用方只认 trait，任何满足契约的 impl 都可替换（测试 mock / 生产实现）。
- **ISP**：行为 trait 被拆细，使用方只依赖自己需要的（`impl FlyBehavior` 而非整个 `Bird`）。
- **DIP**：依赖方向是 struct（不稳定、具体）→ trait（稳定、抽象），只从外向内指——稳定依赖原则（SDP）与稳定抽象原则（SAP）在 Rust 的 trait 设计上同向落地。

---

## 三、进程层：基础设施与资源治理

进程层管的是「进程级资源」——活得比单个请求久、跨越多次调用、需要显式生老病死的对象。四条总则：

### R1 基础设施集中管理

日志、配置、本地持久化各由**单一模块**集中管理，init / destroy 挂在 main 首尾（**逆序销毁**：先启者后毁）。

- **日志**是模块层 R5/R7 的**获批例外**（ambient 依赖，全局句柄 + `OnceLock` 级别控制）；
- **配置**走分层解析（env > 文件 > 默认值）+ 校验 + 启动期加载一次；
- **持久化路径**禁止硬编码，一律逻辑名 + 解析策略参数化。

判据：**ambient 基础设施可全局；领域依赖必须进签名。** 详见 `references/process/infrastructure.md`。

### R2 资源生命周期移交有契约的一方

`spawn` 返回的 handle（`JoinHandle` / `Child` / `AbortHandle` / 租约 guard）是**生命周期所有权的凭证**：资源的后半生归持有者管。「不管」必须是把抚养权移交给一个有明确清理契约的一方（OS / init / runtime / 池 / supervisor），而不是遗弃。每个 `spawn` 的 handle 要么进某个结构、要么显式注释移交。详见 `references/process/supervision.md`。

### R3 并发约束：Send/Sync 与 async object-safety

- **共享要 `Send + Sync`**：跨线程共享 / `Arc<T>` / 被多线程调用的 trait 标上 `Send + Sync`。
- **`async fn` in trait 会让 `Box<dyn Trait>` 失效**：需 `async-trait` / `trait_variant`，或改泛型 `impl Trait`。

详见 `references/process/concurrency.md`。

### R4 IO 全程带 deadline

**IO 的本质是变量赋值**——读文件、收包、查库都是把外部状态搬进进程内的变量；连接是对这条赋值通道的**受控租约**。连接会**静默死亡**（半开）、**被共享**（池与租约）、**被复用**（毒化）、**被强杀**（有序关闭）。对策：每个环节（connect / read / write / heartbeat / drain）一个 deadline；池做 max_lifetime 与 checkout 校验；中途中断的连接毒化丢弃，不归还复用；shutdown 是带 deadline 的有序排空。详见 `references/process/io.md`。

---

## 标准模板

```rust
// —— 行为 trait：按职责拆分（模块层 R2）——
pub trait FlyBehavior { fn fly(&mut self); }
pub trait SoundBehavior { fn sound(&self); }

// —— 完整契约：组合状态 + 行为 ——
pub trait Animal: FlyBehavior + SoundBehavior {
    fn name(&self) -> &str;
    fn age(&self) -> u32;
}

// —— 实现 struct：不公开（模块层 R1）——
struct AnimalImpl {
    name: String,
    age: u32,
}

impl Animal for AnimalImpl {
    fn name(&self) -> &str { &self.name }
    fn age(&self) -> u32 { self.age }
}

impl FlyBehavior for AnimalImpl {
    fn fly(&mut self) { /* … */ }
}

impl SoundBehavior for AnimalImpl {
    fn sound(&self) { /* … */ }
}

// —— 工厂函数（纯：只装配，模块层 R4）——
pub fn create_animal(name: String, age: u32) -> impl Animal {
    AnimalImpl { name, age }
}

// —— 使用方（main）——
fn main() {
    let mut a = create_animal("fox".into(), 3);
    a.fly();
    a.sound();
    // a 离开作用域时自动 drop（内存回收）
}
```

---

## 把规则串起来：端到端示例

一个带缓存的数据加载器：

```rust
use std::collections::HashMap;

// 模块层 R1+R2：trait 契约
pub trait Loader {
    fn load(&mut self, key: &str) -> Result<Vec<Item>, LoadError>;
    fn cache_size(&self) -> usize;
}

// 模块层 R1：struct 不公开
struct LoaderImpl {
    cache: HashMap<String, Vec<Item>>,
    client: HttpClient,       // 模块层 R7：通过参数注入
}

impl Loader for LoaderImpl {
    fn load(&mut self, key: &str) -> Result<Vec<Item>, LoadError> {
        if let Some(items) = self.cache.get(key) {
            return Ok(items.clone());
        }
        let items = self.client.fetch(key)?;  // 代码层 R4：? 传播错误
        self.cache.insert(key.to_string(), items.clone());
        Ok(items)
    }

    fn cache_size(&self) -> usize { self.cache.len() }
}

impl LoaderImpl {
    fn clear(&mut self) { self.cache.clear(); }
}

// 模块层 R4：create 纯装配（无副作用）
pub fn create_loader(client: HttpClient) -> impl Loader {
    LoaderImpl { cache: HashMap::new(), client }
}

// ========== main ==========
fn main() -> Result<(), LoadError> {
    let client = HttpClient::new("https://api.example.com");
    let mut loader = create_loader(client);  // 模块层 R5：局部作用域

    let items = loader.load("foo")?;
    println!("loaded {} items", items.len());

    // 缓存是纯内存资源：离开作用域由 Drop 自动清理。
    // 模块层 R3 的显式 close 只针对非内存资源（连接、线程、句柄），见 references/module/patterns.md。
    Ok(())
}
```

---

## 横切：测试与反模式

**测试是这套风格的直接收益**（`references/cross/testing.md`）：

- **trait 即 mock**：实现 trait 即可 mock，无需 mocking library（R1 的回报）。
- **纯 create → 零串味**：每用例独立实例，互不污染（R4 + R5 的回报）。
- **Result → 失败路径与成功路径同样好断言**（代码层 R4 的回报）。

**常见反模式**（`references/cross/anti-patterns.md`）：公开导出实现 struct（R1）、`unwrap` 吞可恢复错误（代码层 R4）、Drop 作唯一清理（R3）、构造里启动副作用（R4）、函数直接读 `static`（R7）、`lazy_static`+`Mutex` 持可重置状态（R5）、巨型 trait（R2）、顶级函数未声明依赖（R7）。

---

## 自查

写 `struct`、`trait`、`impl` 或带副作用的逻辑时，按层逐项过：

**代码层**（R1–R5）：
- 函数触碰了哪种脏形态？隐式参数能否参数化（R7）？IO 是否被 `connect`/`close` 管住？
- 函数能返回信息却返回了 `()` 吗？该被消费的返回值标了 `#[must_use]` 吗？
- 业务逻辑里的每个数字都命名了吗？量纲 / 档位用类型编码了吗？
- 长 `match`/`if-else` 分支体同质吗？同质的改查表了吗？
- 每个错误选对了失败语义（退出 / 传播 / 降级）吗？错误类型是带语义的 enum 吗？库用 `thiserror`、应用用 `anyhow`，多源有 `#[from]` 聚合吗？（`references/code/errors.md`）

**模块层**（R1–R7）：
- 对外契约是 trait 吗？实现 struct 没有 `pub` 导出吗？这个 trait 有真实复用需求，还是过早抽象？
- 行为 trait 是否按职责拆细了？
- `create_xxx` 纯装配吗？副作用放进 `connect`/`start` 由调用方触发吗？
- 非内存资源的 `close`/`shutdown` 进了 trait 契约、消耗自身了吗（不能消耗时说明了替代方案吗）？
- 变量能否放在 `main()` 而非模块顶层？跨模块共享时只抬升到刚好覆盖？
- 函数通过参数接收依赖，而非直接抓模块级变量 / `static`？
- 跨线程共享 / `Arc<T>` 的 trait 标了 `Send + Sync` 吗？`async fn` in trait 又用 `Box<dyn Trait>` 时处理 object-safety 了吗？（`references/process/concurrency.md`）

**进程层**（R1–R4）：
- 日志 / 配置 / 持久化各由单一模块管理吗？main 销毁顺序是逆序吗（日志最后）？
- 每个 `spawn` 的 handle 落在某个结构里，还是注释过的显式移交？子进程 `wait` 了吗？
- 所有 connect/read/write 都有 deadline 吗？池有 max_lifetime 吗？中途中断的连接毒化丢弃了吗？

---

## 进一步

| 层 | 主题 | 文件 |
| --- | --- | --- |
| 代码层 | 常量与命名 + 控制流数据化（魔法数字 / 查表） | `references/code/lexicon.md` |
| 代码层 | 错误类型建模（enum / `thiserror` / `From` 聚合 / `anyhow` 分层 / 三路径） | `references/code/errors.md` |
| 模块层 | 场景模板（连接池 / 文件句柄 / 后台任务） | `references/module/patterns.md` |
| 模块层 | 作用域收窄与抬升 | `references/module/scope-hoisting.md` |
| 进程层 | IO 连接的深度管理（半开连接 / 池与租约 / 毒化 / 有序关闭） | `references/process/io.md` |
| 进程层 | 监督与移交（子进程 / 线程 / tokio task / 连接的善后） | `references/process/supervision.md` |
| 进程层 | 进程级基础设施（集中化日志 / 配置 / 持久化与路径管理） | `references/process/infrastructure.md` |
| 进程层 | trait 的并发与异步约束（`Send`/`Sync` / `async fn` 的 object-safety） | `references/process/concurrency.md` |
| 横切 | 常见偏离与纠正（8 条反模式） | `references/cross/anti-patterns.md` |
| 横切 | 测试中的直接收益 | `references/cross/testing.md` |
