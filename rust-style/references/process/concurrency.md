# trait 的并发与异步约束 (Rust)

> 模块层 R1–2 给了 trait 契约的形状，本章补两条在**跨线程、跨 async 任务**下才显现的铁律：共享要 `Send + Sync`（第 1 节），`async fn` in trait 会让 `Box<dyn Trait>` 失效（第 2 节）。单线程纯逻辑的 trait 不涉及本章。

## 1. Send 与 Sync：共享的准入条件

两个 auto-trait 决定一个类型能否安全地跨线程：

| trait | 含义 | 等价表述 |
| --- | --- | --- |
| `Send` | 类型可以**跨线程转移所有权** | `T: Send` |
| `Sync` | 类型可以被**多线程共享引用** | `&T: Send` |

`T: Sync` 与 `&T: Send` 互为充要。编译器自动推导，除非你塞了 `Rc` / `RefCell` / 裸 `&T` / 裸指针——这些不是 `Send`/`Sync`，需要换成 `Arc` / `Mutex` / `RwLock`。

**何时给 trait 加 bound**：当契约要**被多线程共享**（放进 `Arc`、跨线程 `spawn`、或 `&self` 方法被多个线程并发调用）时，trait 标上 `Send + Sync`：

```rust
// ❌ 错：impl 存了 RefCell，不是 Sync，Arc 共享会编译不过
pub trait Pool {
    fn acquire(&self) -> Result<Conn, PoolError>;
}
struct PoolImpl { conns: RefCell<Vec<Conn>> }   // RefCell: !Sync

// ✅ 对：trait 声明 Send + Sync，impl 用 RwLock 满足
pub trait Pool: Send + Sync {
    fn acquire(&self) -> Result<Conn, PoolError>;   // &self 被多线程调用 → 内部必须 Sync
}
struct PoolImpl { conns: RwLock<Vec<Conn>> }
```

bound 放哪：

- **trait 上**（`trait Pool: Send + Sync`）——「这个契约天生线程安全」，最常用。
- **方法上**（`fn acquire(&self) -> … where Self: Send`）——只约束具体方法，少见。

异步场景：`tokio::spawn` 要求 future `Send`（跨线程调度），所以 async 函数体里被 `spawn` 捕获的资源通常都要 `Send`；单线程 `spawn_local` 才放宽。`Send` 要求往往一路传导回 trait bound。

---

## 2. async fn in trait 与 object-safety

模块层 R1 说「需要异构集合 / 运行时替换时用 `Box<dyn Trait>`」。但 **`async fn` in trait 会让 trait 失去 object-safety**——每个 `async fn` 返回一个编译器私有的 future 类型，无法塞进 `dyn` 的 vtable：

```rust
// ❌ 不 object-safe：Box<dyn AsyncConnection> 编译不过
pub trait AsyncConnection {
    async fn send(&self, msg: &str) -> Result<(), ConnError>;
}
```

三种应对，按「要不要动态分发」选：

| 方案 | 适用 | 代价 |
| --- | --- | --- |
| 泛型 `impl Trait` | 调用点类型固定，无需运行时替换 | 零；但放弃异构集合 |
| `async-trait` 宏 | 需要 `Box<dyn Trait>` 动态分发 | 每次调用堆分配一个 future |
| `trait_variant::make`（nightly） | 需要 dyn 且在意分配 | vtable 分发，无堆分配 |

```rust
// ✅ 方案 A：async-trait 恢复 dyn 兼容
#[async_trait]
pub trait AsyncConnection: Send + Sync {
    async fn send(&self, msg: &str) -> Result<(), ConnError>;
}
let conn: Box<dyn AsyncConnection> = Box::new(TcpConn::new());
conn.send("ping").await?;

// ✅ 方案 B：能单态化就别 dyn——最干净
fn make_it_speak(client: &impl AsyncConnection) { /* … */ }
```

两个易踩的坑：

- **lifetime**：`&self` 的 async 方法，其 future 借用 self，写成 `dyn` 时是 `Box<dyn Future<Output=…> + Send + '_>`——那个 `'_` 是 self 的借用，`async-trait` 已替你处理。
- **`Send` 传导**：要 `+ Send` 时，`&self` 借用的字段必须 `Send`——又回到第 1 节。

---

## 自查（并发层）

- 跨线程共享的类型 / `Arc<T>` 的 `T` 都是 `Send + Sync` 吗？有没有混进 `Rc` / `RefCell` / 裸引用？
- 要被多线程调用的 trait 标了 `Send + Sync` 吗？
- 有 `async fn` in trait 却又想要 `Box<dyn Trait>` 吗？选了 `async-trait` / `trait_variant` 还是改成泛型？
- `tokio::spawn` 的 future 都 `Send` 吗？
