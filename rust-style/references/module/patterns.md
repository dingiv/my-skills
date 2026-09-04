# 场景模板 (Rust)

每个例子贯穿同一条主线：**create 纯装配；副作用由 trait 的 `connect` / `start` 显式启动；`close` / `stop` / `shutdown` 显式清理并返回 `Result`。trait 公开，struct 不公开。**

---

## 1. 连接池

```rust
use std::sync::Arc;

pub trait Pool: Send + Sync {
    fn connect(&mut self) -> Result<(), PoolError>;   // init：建立底层连接
    fn acquire(&self) -> Result<ConnGuard<'_>, PoolError>;
    fn available(&self) -> usize;
    fn shutdown(mut self) -> Result<(), PoolError>;   // 显式关闭
}

struct PoolImpl {
    url: String,
    max_size: u32,
    // Option：create 阶段为 None，connect 之前池不存在
    inner: Option<Arc<r2d2::Pool<ConnectionManager>>>,
}

impl Pool for PoolImpl {
    fn connect(&mut self) -> Result<(), PoolError> {
        let manager = ConnectionManager::new(&self.url);
        let pool = r2d2::Pool::builder()
            .max_size(self.max_size)
            .build(manager)      // 网络 IO，会失败 → 只能放 connect，不能放 create
            .map_err(|e| PoolError::Build(e.to_string()))?;
        self.inner = Some(Arc::new(pool));
        Ok(())
    }

    fn acquire(&self) -> Result<ConnGuard<'_>, PoolError> { /* 从 inner 借出 */ }
    fn available(&self) -> usize { /* … */ }

    fn shutdown(mut self) -> Result<(), PoolError> {
        self.inner = None;   // Arc 归零时底层连接关闭；有失败则在此收集并返回 Err
        Ok(())
    }
}

// create：纯装配——只记配置，不碰网络
pub fn create_pool(url: &str, max_size: u32) -> impl Pool {
    PoolImpl { url: url.to_string(), max_size, inner: None }
}

// 使用方：
// let mut pool = create_pool("postgres://…", 8);
// pool.connect()?;      // 副作用在此启动
// let conn = pool.acquire()?;
// pool.shutdown()?;     // 显式关闭，错误可传播
```

> 要点：两段式（字段 `Option<…>`，create 时 `None`）是「纯构造」在 Rust 里最常见的落法——副作用无法在构造期完成，就推迟到显式的 `connect`。不要在 `create_pool` 里调 `r2d2` 的 `build`：它默认会阻塞并预建全部连接，本身就是网络 IO。

---

## 2. 文件句柄

```rust
pub trait FileStore: Send {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, IoError>;
    fn write(&mut self, path: &str, data: &[u8]) -> Result<(), IoError>;
    fn close(mut self) -> Result<(), Vec<IoError>>;   // 收集所有句柄的错误
}

struct FileStoreImpl {
    base: PathBuf,
    open_handles: HashMap<String, File>,
}

impl FileStore for FileStoreImpl {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, IoError> { /* … */ }
    fn write(&mut self, path: &str, data: &[u8]) -> Result<(), IoError> { /* … */ }

    fn close(mut self) -> Result<(), Vec<IoError>> {
        let mut errors = Vec::new();
        for (_, mut file) in self.open_handles.drain() {
            if let Err(e) = file.sync_all() { errors.push(e); }   // 不静默吞错
        }
        if errors.is_empty() { Ok(()) } else { Err(errors) }
    }
}

pub fn create_file_store(base: PathBuf) -> impl FileStore {
    FileStoreImpl { base, open_handles: HashMap::new() }   // 纯装配
}
```

> 要点：`Drop` 可以兜底关文件，但每个错误只能丢弃；`close` 让你**收集错误**——这是 `Drop` 做不到的（`drop` 无返回值）。

---

## 3. 后台任务

```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub trait BackgroundTask: Send {
    fn start(&mut self) -> Result<(), TaskError>;   // init：线程在此启动
    fn running(&self) -> bool;
    fn stop(mut self) -> Result<(), TaskError>;     // 通知退出并 join
}

struct TaskImpl<F: Fn() + Send + 'static> {
    work: Option<F>,
    interval: Duration,
    stop_flag: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,   // start 之前为 None：没有线程
}

impl<F: Fn() + Send + 'static> BackgroundTask for TaskImpl<F> {
    fn start(&mut self) -> Result<(), TaskError> {
        let work = self.work.take().ok_or(TaskError::AlreadyStarted)?;
        let interval = self.interval;
        let stop = Arc::clone(&self.stop_flag);
        self.handle = Some(thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                work();
                thread::sleep(interval);
            }
        }));
        Ok(())
    }

    fn running(&self) -> bool {
        self.handle.is_some() && !self.stop_flag.load(Ordering::Relaxed)
    }

    fn stop(mut self) -> Result<(), TaskError> {
        self.stop_flag.store(true, Ordering::Relaxed);   // 通知工作循环退出
        if let Some(h) = self.handle.take() {
            h.join().map_err(|_| TaskError::JoinFailed)?;
        }
        Ok(())
    }
}

// create：纯装配——保存工作函数与参数，不 spawn 线程
pub fn create_task<F>(work: F, interval: Duration) -> impl BackgroundTask
where F: Fn() + Send + 'static
{
    TaskImpl {
        work: Some(work),
        interval,
        stop_flag: Arc::new(AtomicBool::new(false)),
        handle: None,
    }
}

// 使用方：
// let mut task = create_task(|| save_metrics(), Duration::from_secs(5));
// task.start()?;   // 线程在此启动（不是在 create_task 里）
// task.stop()?;    // 通知退出、join、传播错误
```

---

## 4. 异步与共享所有权

`close(self)` 消耗自身的前提是**独占持有**。两种常见情形要调整：

- **`Box<dyn Trait>` 持有**：`close` 写成 `fn close(self: Box<Self>) -> Result<(), E>`。
- **`Arc` 共享**（多线程 / tokio 任务各持一份克隆）：无法消耗自身。改为 `fn shutdown(&self) -> Result<(), E>` + 内部同步（如 `RwLock<Option<Inner>>`），或「优雅关闭」标志 + 等待引用计数归零。

```rust
// 异步契约（Rust 1.75+ 原生支持 async fn in trait）
pub trait AsyncConnection: Send + Sync {
    async fn send(&self, msg: &str) -> Result<(), ConnError>;
    async fn shutdown(&self) -> Result<(), ConnError>;
}

// Arc 共享的异步资源：无法消耗自身，用内部状态表达生命周期
struct SharedConn {
    inner: tokio::sync::RwLock<Option<Inner>>,   // None = 已关闭
}

impl AsyncConnection for SharedConn {
    async fn send(&self, msg: &str) -> Result<(), ConnError> {
        let guard = self.inner.read().await;
        guard.as_ref().ok_or(ConnError::Closed)?.send(msg).await
    }

    async fn shutdown(&self) -> Result<(), ConnError> {
        let inner = self.inner.write().await.take();   // 此后的 send 看到 Closed
        if let Some(i) = inner { i.close().await?; }
        Ok(())
    }
}
```

> async 没有 `async Drop`——挂起的清理（flush、优雅断开）只能走显式的 `async fn shutdown`。模块层 R3 在异步里不是更宽松，而是**更重要**。tokio 生态中，后台任务的退出信号用 `CancellationToken`（替代 `AtomicBool`），任务本身用 `JoinHandle::abort` 或 `select!` 响应关闭。`async fn` in trait 对 `dyn Trait` object-safety 的影响、`Send`/`Sync` 何时加，见 `../process/concurrency.md`。

---

## 5. 通用记法

- `create_xxx` 纯装配（无副作用），返回 `impl Trait`。
- 启动与清理是契约的一部分，作为 **trait 方法**提供：`connect` / `start` / `close` / `stop` / `shutdown`。不引入模块级 `init_xxx` / `destroy_xxx` 自由函数——自由函数只能通过 trait 触发行为，那不如直接把方法放上 trait。
- `close` 优先消耗自身（`self`），把「关闭后再用」变成编译错误；不能消耗时（`Arc` 共享 / `Box<dyn>`）见第 4 节。
- `close` 里用 `Option::take` 取走资源，让随后的 `Drop` 看到 `None`，避免二次关闭。
- 一个模块导出两样：`trait` + `create_xxx`。
- 多个相关资源属于同一生命周期时，父模块的 `close` 按创建逆序调用子模块的 `close` / `stop`，并收集错误。
- `Drop` 兜底但不替代（无法返回错误）。
- 连接会**静默死亡**：半开检测、池与租约、毒化、max_lifetime、有序关闭——深入见 `../process/io.md`。
