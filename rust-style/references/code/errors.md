# 错误类型建模 (Rust)

> 代码层 R4 讲了错误的**传播**（走 `?`、别 `unwrap`）。本章讲错误的**类型本身**怎么设计：用 enum 组织变体、`thiserror` 派生、`From` 聚合多源错误、`anyhow` 与 `thiserror` 的库/应用分层。

## 1. 错误类型 = 带语义的 enum

一个模块的可失败操作，失败种类是**可数的**——就用 enum 表达每种失败，让调用方能 `match` 区分处理：

```rust
pub enum LoadError {
    Http(HttpError),    // 网络层失败
    Decode(String),     // 数据格式错
    NotFound(String),   // 业务：不存在
    Timeout,           // 超时
}
```

不要把所有失败糊成 `String`——调用方就无法区分「网络挂了（可重试）」与「数据格式错（不可重试）」，也就做不了 `../process/io.md` §2 里「先分类、再处理」的判断。

---

## 2. 库层：thiserror

库 crate 公开具体错误类型（模块层 R1 对库的降级），用 `thiserror` 派生 `Display` / `Error`：

```rust
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("http: {0}")]
    Http(#[from] HttpError),        // #[from]：自动生成 impl From<HttpError>
    #[error("decode failed: {0}")]
    Decode(String),
    #[error("not found: {0}")]
    NotFound(String),
}
```

- `#[from]`：自动 `impl From<HttpError> for LoadError`，于是 `?` 能把 `HttpError` 自动转成 `LoadError`，无需手写转换。
- `#[error("…")]`：格式串，支持 `{0}` / `{name}`。
- `#[source]`：标记错误链的源头（`source()` 返回它）。

---

## 3. 多源错误聚合：From 链

一个函数可能从多个可失败操作得到错误，用 `#[from]` 把每个来源都接进模块自己的 error，`?` 就能一路传播：

```rust
fn load(url: &str) -> Result<Item, LoadError> {
    let bytes = http_get(url)?;     // HttpError  → LoadError（#[from]）
    let item  = decode(&bytes)?;    // DecodeError → LoadError（#[from]）
    Ok(item)
}
```

调用方只需面对模块自己的 `LoadError`，不必知道内部用了几个依赖。

---

## 4. 应用层：anyhow

应用 crate（`main` 所在）不对外公开错误类型，用 `anyhow::Error` 自由传播，用 `.context(...)` 补上下文：

```rust
fn main() -> anyhow::Result<()> {
    let cfg = load_config().context("loading config")?;   // LoadError → anyhow::Error（自动）
    run(&cfg)?;
    Ok(())
}
```

| 层 | 用什么 | 为什么 |
| --- | --- | --- |
| 库 crate | `thiserror` enum | 调用方要能 `match` 具体错误类型 |
| 应用 crate | `anyhow::Error` + `Context` | 不对外，自由聚合多源 + 补上下文 |

库里**不要**返回 `anyhow::Error`——调用方无法 `match` 出具体类型，错误语义被抹平。

---

## 5. 失败语义三路径

不是每个错误都意味着「进程退出」。每个错误有三类语义，按功能的重要度选路径：

| 语义 | 何时用 | 处理 |
| --- | --- | --- |
| **退出** | 核心路径失败、无法继续 | 边界 `expect` / `main` 返回 `Err` |
| **传播** | 当前模块无法决定，应由调用方决定 | `?` 向上传播 |
| **降级** | 某功能失败但核心路径可继续 | `match` 捕获 + `tracing::warn!` 记录后继续（或禁用该功能） |

```rust
// ✅ 降级：指标上报失败不应拖垮主流程
fn report_metrics(&self) {
    if let Err(e) = self.client.send(&self.snapshot()) {
        tracing::warn!("metrics report failed, skip: {e}");   // 记录后继续，不传播
    }
}
```

判据：**功能模块可独立失效、核心路径最小化、启动成功优先于完美状态**。沿依赖方向判断——非核心依赖（指标、缓存、预热）「独立失效」优于「拖着一起死」；核心依赖（配置、主存储）降级 = 掩盖故障，必须传播。

> 与 `../process/io.md` §2 的错误分类（可重试 / 不可重试）正交：后者回答「这个错能否重试」，本节回答「这个错要不要停掉进程」。判定不可重试后，仍可按功能是否核心选择传播或降级。

---

## 6. 与生命周期的关系

- 错误是**数据**：`Err(e)` 离开作用域自动释放，和值一样，无需额外清理。
- `close` / `shutdown` 返回 `Result`（模块层 R3），错误能 `?` 传播；`Drop` 不能返回错误，兜底路径里错误只能丢弃。
- 批量清理要收集多个错误时，返回 `Result<(), Vec<E>>`（见 `../module/patterns.md` §2 的 `close`）。

---

## 自查（错误层）

- 可失败操作的失败种类可数吗？用了 enum 而非 `String` 吗？
- 库 crate 的错误类型是 `thiserror` 派生的吗？每个来源都有 `#[from]` 吗？
- 应用层用 `anyhow` + `Context` 了吗？有没有在库里误用 `anyhow`？
- 调用方能否 `match` 错误类型做分类（重试 / 立即上抛）？
- 每个错误选对了失败语义路径（退出 / 传播 / 降级）吗？非核心依赖是否「独立失效」而非拖垮主流程？
