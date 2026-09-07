# 调试：Rust

> **Rust 的编译期检查是调试的第一道防线——很多 bug 在编译时就消除了。** 运行期调试按需使用，配合编译器信息、测试框架、profiler。

## 一句话

> **Rust 调试 = 先榨干编译器 → 测试覆盖 → 日志/断点 → profiler。每一步都比上一步更接近运行时真相。**

## 何时使用

- Rust 程序编译错误 / 编译警告
- 运行时 panic（数组越界、解引用 None、算术溢出等）
- 行为不符合预期
- 性能不达预期
- 借用检查错误
- 生命周期推断失败

## 编译期（第一道防线）

### 编译错（E0xxx）

```bash
# 看完整错误（含 notes）
cargo build 2>&1

# 详细解释（rustc --explain E0xxx）
rustc --explain E0382
```

**核心原则**：

- 看错误码（E0xxx 是硬错，E04xx 是借用检查）
- **必读 notes**——编译器给的修复建议常常就是答案
- 不要被长度吓退——前几行是错误本质，后面是 details

### 编译警告（unused、dead_code）

```bash
cargo build 2>&1 | grep warning
cargo clippy --all-targets -- -D warnings   # 把警告当错误
```

**核心原则**：

- 警告不是装饰——往往是真 bug 的信号
- 实在要忽略：用 `#[allow(...)]` 标注 + 注释说明理由

### 类型不匹配

```bash
cargo check   # 只检查不编译，速度更快
```

### 借用检查错

看 [timing.md](../../theory/timing.md) 第 1 条「依赖前向包含」——借用错误常常是生命周期设计的信号。

## 运行期

### println! / eprintln!

```rust
// 基本用法
println!("debug: x = {:?}", x);
eprintln!("err:  {:?}", x);  // 走 stderr，不影响 stdout

// 结构化输出
println!("debug: {:#?}", x);   // pretty-print
```

**坑**：

- `{:?}` 需要类型实现 `Debug`——大部分类型默认实现
- `{}` 是 `Display`——更紧凑但不一定可用
- 大结构体输出很慢——可以 `&` 借用

### dbg! 宏（更快）

```rust
let result = dbg!(compute(x, y));   // 打印 + 返回
dbg!(x);  // 单独一行也能用
```

**优势**：

- 自动显示文件名 + 行号
- 自动借用，不消耗所有权
- 比 `println!` 更快

### log / tracing（生产级）

```rust
// log crate
use log::{debug, info, warn, error};

log::debug!("processing request {:?}", req);

// tracing crate（结构化更好）
use tracing::{debug, info, instrument};

#[instrument]
async fn handle(req: Request) -> Response {
    debug!("starting");
    // ...
}
```

**配置**：

```bash
RUST_LOG=debug cargo run           # 启用 debug 级别
RUST_LOG=my_crate=debug cargo run  # 只看 my_crate
RUST_LOG=trace cargo test          # 测试时 trace
```

### panic 信息

```bash
RUST_BACKTRACE=1 cargo run          # 简短回溯
RUST_BACKTRACE=full cargo run       # 完整回溯（含所有帧）
RUST_BACKTRACE=1 cargo test         # 测试时
```

**panic message 模板**：

```
thread 'main' panicked at 'index out of bounds: len 5 but index 10', src/main.rs:42:5
   1. 看 panic message（人话描述）
   2. 看文件:行号
   3. 带 RUST_BACKTRACE 看完整调用栈
```

## 调试器（gdb / lldb）

### 安装

```bash
# gdb
sudo apt install gdb

# lldb（macOS 默认）
xcode-select --install
```

### 启动

```bash
# gdb 模式
cargo build
gdb target/debug/my_app

# lldb 模式
rust-gdb target/debug/my_app    # rust 包装的 gdb（更懂 Rust）
rust-lldb target/debug/my_app   # rust 包装的 lldb
```

### 常用命令

```
(gdb) b main                  # 在 main 设断点
(gdb) b src/foo.rs:42         # 在文件:行号
(gdb) r                       # run
(gdb) n                       # next（不进入函数）
(gdb) s                       # step（进入函数）
(gdb) p variable              # print 变量
(gdb) bt                      # backtrace（栈）
(gdb) c                       # continue
(gdb) q                       # quit
```

**Rust 特有**：

```
(gdb) ptype variable          # 看类型
(gdb) info args               # 看函数参数
```

## 性能

### 基准测试

```toml
# Cargo.toml
[dev-dependencies]
criterion = "0.5"
```

```rust
use criterion::{criterion_group, criterion_main, Criterion};

fn bench(c: &mut Criterion) {
    c.bench_function("my_fn", |b| b.iter(|| my_fn(black_box(42))));
}

criterion_group!(benches, bench);
criterion_main!(benches);
```

```bash
cargo bench
```

### flamegraph

```bash
cargo install flamegraph
cargo flamegraph             # 生成 flamegraph.svg
```

### perf（Linux）

```bash
sudo perf record -g target/release/my_app
sudo perf report
```

## 测试

### 基本测试

```rust
#[test]
fn test_basic() {
    assert_eq!(add(2, 3), 5);
}

#[test]
#[should_panic]
fn test_panic() {
    panic!();
}
```

### 断言宏

```rust
assert!(cond);                 // bool
assert_eq!(a, b);              // 等于（用 Debug）
assert_ne!(a, b);              // 不等于
```

### 运行测试

```bash
cargo test                     # 所有
cargo test test_basic          # 名字过滤
cargo test --doc               # 文档测试
cargo test -- --nocapture      # 允许 println! 输出
```

### 属性测试（proptest）

```toml
[dev-dependencies]
proptest = "1"
```

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_add(a in 0..1000i32, b in 0..1000i32) {
        assert_eq!(add(a, b), a + b);
    }
}
```

## 静态分析

### clippy

```bash
cargo clippy                   # 默认检查
cargo clippy -- -W clippy::pedantic  # 更严
cargo clippy --fix             # 自动修一些
```

### miri（未定义行为检测）

```bash
rustup +nightly component add miri
cargo +nightly miri test
```

**适用**：

- unsafe 代码
- 并发代码
- 整数溢出怀疑

## 编辑器集成

### rust-analyzer

```bash
rustup component add rust-analyzer
```

**编辑器**：

- VS Code：装 `rust-analyzer` 扩展
- Neovim：装 `nvim-lspconfig` + rust-analyzer
- IntelliJ：装 Rust 插件

**核心能力**：

- 实时类型检查
- 跳转到定义
- 重命名（跨 crate）
- inline hint（变量类型、参数名）
- 代码补全

## 环境配置

### 开发环境

```bash
# 安装 rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装组件
rustup component add clippy rustfmt rust-analyzer

# nightly（miri / 最新特性）
rustup install nightly
```

### .cargo/config.toml

```toml
[build]
rustflags = ["-D", "warnings"]   # 把警告当错误

[target.x86_64-unknown-linux-gnu]
runner = "echo"                   # cargo run 时只 echo
```

### 项目 .vscode/launch.json（VS Code 调试）

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "lldb",
      "request": "launch",
      "name": "Debug my_app",
      "cargo": {
        "args": ["build"],
        "filter": { "name": "my_app", "kind": "bin" }
      },
      "args": [],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

## 常见 bug 速查

| 现象 | 排查方向 |
| --- | --- |
| `cannot move out of` | 所有权问题——用 `clone()` 或 `&` 借用 |
| `borrowed value does not live long enough` | 生命周期——让借用的活得更久 |
| `expected ... found ...` | 类型不匹配——看 expected 是期望类型 |
| `index out of bounds` | 边界检查——`get(i)` 返回 Option |
| `unwrap on None` | 处理 Option——`match` / `?` / `unwrap_or` |
| 异步任务挂起 | 死锁 / 等待未来——用 `tokio-console` |
| tokio panic | task panic 默认不传染——查 `RUST_LOG=tokio=trace` |

## 一句话

> **Rust 调试 = 编译器先榨干（cargo check + clippy）→ 测试覆盖 → println!/dbg!/tracing → 调试器 → profiler。每步都比上一步更接近真相。**