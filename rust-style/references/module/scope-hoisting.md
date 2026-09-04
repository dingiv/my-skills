# 作用域收窄与抬升 (Rust)

> 对应 `../../SKILL.md` 模块层 R6。与 TS 版本核心逻辑一致，加入 Rust 特有的 `static` / `lazy_static` / `OnceCell` 考虑。

## 原则

- **`static` / 模块级常量**：一次程序运行期间只初始化一次，无法重置。只适合放**真正不可变**的数据：纯函数、不可变配置、常量字符串。
- **局部作用域（函数 / 块）**：可被反复创建和销毁。可变状态就应该放在这里——每次调用都是独立实例，测试间互不污染。

Rust 的 `static` 编译期要求 `Sync`，但这不意味着放 `Mutex<HashMap<...>>` 就是好设计——它只是**能做**，但重置和测试隔离仍然困难。

## 手法 1：向下收窄

```rust
// ❌ 错：模块级 static，无法 reset
static CACHE: Lazy<Mutex<HashMap<String, Data>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// ✅ 对：收进 main()——生命周期对齐 main，测试可独立创建
fn main() {
    let cache = Arc::new(Mutex::new(HashMap::new()));
    let loader = create_loader(cache.clone());
    // … 使用 …
    // main 结束时 cache 的 Arc 计数归零，自动释放
}
```

## 手法 2：向上抬升

```rust
// Before：config 在 create_c 内部构造，create_b 需要但够不着
fn main() {
    let b = create_b(/* 缺 config */);
    let c = create_c(); // config 藏在里面
}

// After：config 上提到 main 层——刚好覆盖 B 和 C
fn main() {
    let config = load_config();  // 抬升
    let b = create_b(&config);
    let c = create_c(&config);
}
```

## Rust 特有的全局模式

当确实需要全局唯一且不可变的值时，Rust 提供了安全途径：

| 场景 | 工具 |
| --- | --- |
| 编译期常量 | `const` |
| 需要运行时初始化的不可变配置 | `OnceLock` / `OnceCell`（一次写入，之后不可变） |
| 需要「创建一次、反复读取」的值 | `Lazy<T>`（惰性初始化，不可变） |
| 全局可变状态 | 尽量避免；必须时 `Arc<Mutex<T>>` 在 `main` 中创建并注入 |

> `OnceLock` 比 `lazy_static` + `Mutex` 更适合「初始化后不变」的场景——它不可变，不牺牲重置能力。测试时换一个数据集不需要 reset `OnceLock`，只需在测试中创建自己的实例并通过参数注入。

> 获批的全局例外是**基础设施句柄**（日志 subscriber、级别控制）——init 后只读、进程级生命周期、不承载任何测试状态。判据与写法见 `../process/infrastructure.md`。

## 与规则的协作

- **模块层 R5**：禁止不必要的全局可变状态。本条给你「搬去 `main()`」的具体手法。
- **模块层 R7**：函数通过参数拿依赖。只有依赖参数化了，变量才能留在窄作用域里。
