# 进程级基础设施：日志、配置与持久化 (Rust)

> 日志与本地文件持久化的共同形状：**单一模块集中管理；main 开头 init、main 结尾 destroy（逆序）**。它们的分歧同样值得写明：日志是模块层 R5/8 的**获批例外**——全局句柄；持久化相反——路径与句柄**一律参数注入**。本章先给判据，再分别展开。

## 0. 判据：什么能全局，什么必须参数化

| 依赖 | 形态 | 为什么 |
| --- | --- | --- |
| 日志 | 全局句柄（获批例外） | ambient：到处都要用，穿参数会污染所有签名；函数**行为**不依赖它，纯度无损 |
| 不可变配置 | `OnceLock` 只读，或参数注入 | 启动后不变 |
| 存储路径 / 文件句柄 | 参数注入的值 | 只有少数模块用；是领域依赖，出现在签名里反而是信息 |
| 连接池 | main 创建 + 注入 | 见 `io.md` §3 |

一句话：**ambient 的基础设施可以全局；领域依赖必须进签名。** 进程级基础设施是单实例、无 mock 替换需求的装配件——不需要 trait 契约，模块边界就是契约，自由函数 `init` / `shutdown` 即可。

---

## 1. 集中化日志

### 1.1 唯一的 subscriber 模块

整个 crate 里，只有 `logging.rs` 允许触碰 subscriber / `EnvFilter` / writer。其余模块——尤其是库 crate——只用 `tracing` 宏发事件。tracing 的设计哲学本来就是「库发事件，应用装 subscriber」。

```rust
// src/logging.rs —— 唯一允许配置日志的模块
use tracing_appender::non_blocking::{self, WorkerGuard};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

pub struct LogGuard { _worker: WorkerGuard }   // 凭证：drop 时 flush + join 后台写线程

pub fn init(cfg: &LoggingConfig) -> Result<LogGuard, LogError> {
    let file = std::fs::OpenOptions::new()
        .create(true).append(true).open(&cfg.path)?;
    let (writer, worker) = non_blocking(file); // 后台写线程在此「生」
    let filter = EnvFilter::try_from_default_env()       // RUST_LOG 优先
        .unwrap_or_else(|_| EnvFilter::new(&cfg.level));
    tracing_subscriber::registry()
        .with(fmt().with_writer(writer).json())
        .with(filter)
        .init();
    Ok(LogGuard { _worker: worker })
}

pub fn shutdown(_guard: LogGuard) {}   // 显式销毁锚点；真正的 flush+join 在 drop 里
```

### 1.2 guard 是凭证，最常见的遗弃事故就在这里

```rust
// ❌ 错：guard 当场 drop，后台写线程当场被关——缓冲里的日志永远写不出来
fn main() {
    logging::init(&cfg);            // 返回值被丢弃 = guard 立刻析构
    // …
}

// ❌ 同样错：let _ = 立刻 drop（这是 supervision.md 的经典遗弃签名）
let _ = logging::init(&cfg);
```

```rust
// ✅ 对：绑定到变量，活到 main 结束。下划线前缀只消「未使用」警告，不改变生命周期
fn main() -> Result<(), AppError> {
    let log = logging::init(&config.logging)?;
    // … 整个进程的日志都有效 …
    logging::shutdown(log);         // 显式 destroy：flush + join 写线程
    Ok(())
}
```

> `let _log = …`（绑定，活到作用域尾）与 `let _ = …`（立刻 drop）是两个世界——这里写错一个字符，丢的是崩溃前最后几行日志。与 `supervision.md` 的 handle 凭证完全同构；区别只是这回 Drop 本身做对了（flush + join），前提是你让它活到结束。也**不要**为此把 guard 藏进模块内 static——那是把「main 拥有生命周期」重新变成全局可变状态（模块层 R5）。

### 1.3 全局级别控制：set-once 句柄，只经模块 API 改

「全局变量」获批的形态是 `OnceLock` 里的**只读句柄**——init 时写入一次，之后所有调整走模块函数，不许散落直接操纵：

```rust
// 动态调级（可选）：reload::Layer 让级别运行时可换
static LEVEL: OnceLock<LevelHandle> = OnceLock::new();
// LevelHandle = tracing_subscriber::reload::Handle<EnvFilter, …>——模块内部别名，不外泄

pub fn set_level(level: &str) -> Result<(), LogError> {
    LEVEL.get().ok_or(LogError::NotInited)?
        .reload(EnvFilter::new(level))?;      // 例：SIGHUP 时重读配置调用
    Ok(())
}
```

编译期裁剪配合 `STATIC_MAX_LEVEL`：release 关掉 `trace!`/`debug!` 是零成本的。

### 1.4 纪律

- **库永远不 `init`**：装 subscriber 是应用的决定（格式、输出、级别都是部署属性）。
- **事件不做控制流**：函数行为不依赖 logger 状态——这是「日志不破坏纯度」的前提。
- **库代码禁 `println!` / `eprintln!`**：它们绕过 subscriber，格式、级别、去向全部失控。用 `tracing` 宏。
- 每个模块一份输出文件、自己 init 自己——日志被切成碎片，聚合分析无从做起，通常还会双 `init` 冲突。

---

## 2. 集中化配置

配置是进程级基础设施之一：**单一模块（`config.rs`）集中解析，main 启动期加载一次，之后只读**。它是核心依赖——缺失或非法就 fail-fast 退出（代码层 R4 的「退出」语义），不降级。

### 2.1 分层解析：env > 文件 > 默认值

同一配置项的来源按优先级合并，让部署可覆盖而不用改代码：

| 来源 | 优先级 | 用途 |
| --- | --- | --- |
| 环境变量 | 最高 | 部署期覆盖、secrets |
| 配置文件 | 中 | 显式设置、可版本化 |
| 代码默认值 | 最低 | 开箱即用 |

```rust
impl AppConfig {
    fn load() -> Result<Self, ConfigError> {
        let file = FileConfig::read_optional(&Self::config_path())?;  // 文件：可缺省
        let env  = EnvConfig::from_env();                             // env：覆盖文件
        let cfg = AppConfig {
            listen:    env.listen.or(file.listen).unwrap_or_else(|| "127.0.0.1:8080".into()),
            data_dir:  env.data_dir.or(file.data_dir).unwrap_or_else(default_data_dir),
            log_level: env.log_level.or(file.log_level).unwrap_or_else(|| "info".into()),
        };
        cfg.validate()?;        // 校验：启动期一次，失败即退出
        Ok(cfg)
    }
}
```

### 2.2 校验 fail-fast：配置是核心依赖

启动期把所有配置一次校验完——类型、范围、必填项、相互约束（如 `max_size > min_size`）。任一非法就 `Err`，main 返回退出。配置错了带病运行，错误会延迟到运行时某条路径才爆，远不如启动即死。与代码层 R4 一致：配置是核心路径，失败 → 退出，不降级。

### 2.3 secrets 不进配置文件

密钥、token、含密码的连接串，从**环境变量或 secret manager** 取，不写进配置文件明文（文件常被提交进版本库、备份进磁盘）。配置文件只放非敏感部署参数；敏感项一律 env 注入。

### 2.4 加载一次，之后只读

配置在 main 加载一次，作为值（或 `OnceLock`）传给需要的模块，加载后**不可变**。要运行时改某个值（如日志级别）走专门的 set-once 句柄（§1.3），而非让配置本身可变——配置可变就回到全局可变状态（模块层 R5）。

---

## 3. 集中化持久化

### 3.1 唯一知道「文件在哪」的模块

```rust
// ❌ 错：路径硬编码散落在各处——依赖被藏进函数体（模块层 R7 的空间版），
// 部署假设冻结进代码，测试无法重定向
fn save_session(s: &Session) -> io::Result<()> {
    let path = PathBuf::from("/var/lib/myapp/sessions.db");   // 硬编码
    // …
}

// ❌ 同样错：相对路径更糟——依赖 cwd，systemd（cwd=/）、cron、双击启动各不相同
let path = PathBuf::from("data/app.db");
```

```rust
// ✅ 对：src/storage.rs——唯一构造路径的模块；其余代码只说领域语言
pub struct StoragePaths { base: PathBuf }

impl StoragePaths {
    pub fn from_config(cfg: &StorageConfig) -> Self {
        StoragePaths { base: cfg.data_dir.clone() }
    }
    pub fn sessions(&self) -> PathBuf { self.base.join("sessions.db") }
    pub fn snapshots(&self) -> PathBuf { self.base.join("snapshots") }
}
```

base 的解析顺序由配置层负责：环境变量（`APP_DATA_DIR`）→ 平台惯例（`directories` crate：Linux XDG、macOS `~/Library`、Windows `%APPDATA%`）→ **绝不允许 cwd 相对路径**。

**核心是解耦身份与定位。** 一个路径字符串同时承担了三种角色——**身份**（是哪个文件）、**位置**（在哪里）、**加载策略**（怎么找到）——把三者压缩进一个字符串是上面所有脆弱性的根源：身份与位置耦合，部署位置一变代码就得改。正解是用**逻辑名**（`sessions.db`）表达身份，把「怎么找到」交给解析策略——这里的 `base` 就是那条策略。PATH、LD_LIBRARY_PATH、DNS、pkg-config 都是这套模式在系统级的验证过的先例：身份是稳定的逻辑名，位置由策略解析，两者互不牵制。

### 3.2 生命周期与 FileStore 同构

打开句柄、校验、flush、fsync 走 `../module/patterns.md` §2 的 FileStore 形状——`storage::init(&paths)` 集中完成 open/create/校验，`close(self)` 收集错误返回。**收益直通测试**：base 指向 `tempfile::tempdir()`，每个用例一个独立世界，零污染。

### 3.3 用户输入拼路径：防穿越

```rust
use std::path::Component;

fn resolve(&self, name: &str) -> Result<PathBuf, StorageError> {
    let rel = Path::new(name);
    if rel.is_absolute()
        || rel.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(StorageError::Escape);      // 拒绝绝对路径与 ..
    }
    Ok(self.base.join(rel))
}
```

> 词法检查挡不住符号链接指向外部——需要强保证时对结果 `canonicalize()` 后再验前缀。`base.join("/etc/passwd")` 会整个替换 base，这类替换同样被上面的绝对路径检查拦下。

### 3.4 原子写：崩溃时要么旧文件要么新文件

```rust
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), IoError> {
    let tmp = path.with_extension("tmp");   // 必须同目录：跨文件系统 rename 不原子
    let mut f = fs::File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;                          // 先落盘
    fs::rename(&tmp, path)?;                // 再替换
    Ok(())
}
```

### 3.5 格式版本也归本模块

文件里带版本号，load 时校验：不认识的版本要么迁移、要么明确报错——**静默误读比崩溃更糟**。schema 演进（迁移逻辑）与路径知识住在同一个模块，文件的全部事实一处可查。

---

## 4. main：三者的组装样例

```rust
fn main() -> Result<(), AppError> {
    let config = config::load()?;   // 核心依赖：加载 + 校验，失败即退出;

    let log = logging::init(&config.logging)?;        // 生：日志最先（后续步骤的失败也要有日志）
    let mut storage = storage::init(&config.storage)?; // 生

    run(&mut storage, &config)?;                       // 用

    storage.close()?;                                  // 养：逆序——
    logging::shutdown(log);                            // 日志最后销毁（close 的错误还要写日志）
    Ok(())
}
```

> 销毁逆序（级联销毁）：先启者后毁。日志 init 第一、shutdown 最后——存储关闭时的错误本身就需要日志在场。

---

## 自查（基础设施层）

- `grep -rn 'set_global_default\|EnvFilter\|with_writer' src`——命中只在 `logging.rs`？
- 库 crate 里有 `init` / `println!` 吗？
- `init` 返回的 guard 被 `let _ =` 或裸语句吃掉了吗？
- `grep -rnE 'PathBuf::from\("[~/]' src`——命中只在配置加载与 `storage.rs`？
- 配置走 env > 文件 > 默认值的分层解析吗？启动期一次校验、失败即退出吗？secrets 走 env 而非配置文件明文吗？
- 有依赖 cwd 的相对路径吗？
- 用户输入参与拼路径的地方，防穿越了吗？
- 落盘走 tmp + fsync + rename 吗？带版本号吗？
- main 的销毁顺序是逆序吗（日志最后）？
