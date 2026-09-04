# 监督与移交：管生也要管养 (Rust)

> 本章的核心问题：**函数创建了资源，却不把它返回，怎么办？**

这个问题有两面：

- **持有者视角**：spawn 返回的 handle——`JoinHandle`、`Child`、`AbortHandle`、租约 guard——是**生命周期所有权的凭证**：这个资源的后半生归持有者管。丢弃凭证不会消灭义务，只会把义务转嫁给运气。
- **创建者视角**：函数里创建了资源（spawn 任务、打开句柄、造了 future），就必须**要么返回它**（交给调用方管），**要么移交给一个比自己活得久的 owner**（supervisor / 池 / OS）。「创建即吞」——在函数里造出资源却什么都不做——是悬空最常见的形态。

两面共用的判据只有一条：**「不管」必须是把抚养权移交给一个有明确清理契约的一方**（OS、init、runtime、池、supervisor），而不是遗弃。合法移交见文末表格。

## 三种悬空

「创建资源却不返回」看起来一样，在 Rust 里后果按资源类型分三种：

| 类型 | 典型资源 | 不返回的后果 | 失败模式 |
| --- | --- | --- | --- |
| **活着的孤儿** | 子进程 / 线程 / tokio task | 继续活着、没人管（zombie / detached / panic 被吞） | 多活失控 |
| **早死的沉默** | 文件句柄 / 缓冲 / 连接 | 作用域结束即被 Drop 静默关闭，未 flush 的工作丢失 | 早死无声 |
| **没开始的静默** | unpolled future / `async` 块 | 根本没执行——future 是懒的，drop 掉即静默 no-op | 没活就丢 |

第一类「活着没人管」，第二类「死了没人知道」，第三类「压根没活过」。三者共同点：创建时都**没有可见症状**，全部在之后才爆发。下文给五类最常见的「管生不管养」资源各配一对 ❌/✅ 示例。

---

## 1. 子进程：drop Child = 制造 zombie

```rust
use std::process::Command;

// ❌ 错：spawn 完就扔——handle 立刻被 drop
fn transcode(input: &str) -> std::io::Result<()> {
    Command::new("ffmpeg").args(["-i", input, "out.mp4"]).spawn()?;
    Ok(())
}
```

后果：

- Unix 上子进程退出后变成 **zombie**：PID 和退出状态被内核占着，等父进程 `wait()`——而凭证已经被扔了。长跑服务里 zombie 单调递增，最终 `fork` 失败。
- **退出状态永远丢失**：ffmpeg 崩了你看不见，重试/告警逻辑无从谈起。

```rust
// ✅ 对：wait 到底，拿到退出状态并传播
fn transcode(input: &str) -> Result<(), TranscodeError> {
    let mut child = Command::new("ffmpeg")
        .args(["-i", input, "out.mp4"])
        .spawn()?;
    let status = child.wait()?;               // 凭证用掉：回收 zombie
    if status.success() { Ok(()) } else { Err(TranscodeError::Exit(status.code())) }
}
```

带截止时间的版本（async）。注意：**kill 之后仍要 wait**——kill 只是杀，wait 才是收尸：

```rust
let mut child = tokio::process::Command::new("ffmpeg")
    .args(["-i", input, "out.mp4"]).spawn()?;
match tokio::time::timeout(DEADLINE, child.wait()).await {
    Ok(Ok(status)) if status.success() => Ok(()),
    Ok(status) => Err(TranscodeError::Exit(status.code())),
    Err(_elapsed) => {
        child.kill().await.ok();
        child.wait().await?;                 // kill 后不 wait，照样是 zombie
        Err(TranscodeError::Timeout)
    }
}
```

> 合法移交：`Command::new("xdg-open").arg(url).spawn()?` 这类「点火就跑」是有意交给 init 收养——写一行注释说明。较新的 clippy 有 `zombie_processes` lint 专抓 drop `Child`；tokio 的 `kill_on_drop(true)` 存在，但其文档也提醒容易误用（drop 顺序不受控）——显式 wait/kill 才是主路径。

---

## 2. 线程：drop JoinHandle = detach，退出时被腰斩

```rust
// ❌ 错：detached 线程
fn start_flusher(store: Arc<Store>) {
    let _ = thread::spawn(move || loop {
        store.flush();
        thread::sleep(FLUSH_INTERVAL);
    });
}
```

后果：

- join 没了：失去同步点，也拿不回返回值；
- panic 只打一行 stderr——`join()` 是**唯一**能把线程 panic 递回来的通道，凭证扔了它就永远沉底；
- 最狠的：**main 返回时进程直接退出，detached 线程 mid-write 被杀**，没有任何优雅可言。

```rust
// ✅ 对：凭证存进 supervisor；stop 消耗自身（与 close 同一形状）
struct Flusher { handle: JoinHandle<()>, stop: Arc<AtomicBool> }

impl Flusher {
    fn start(store: Arc<Store>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let sig = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            while !sig.load(Ordering::Relaxed) {
                store.flush();
                thread::sleep(FLUSH_INTERVAL);
            }
            store.flush_final();             // 退出前收尾——detach 的线程没有这个机会
        });
        Flusher { handle, stop }
    }

    fn stop(self) -> Result<(), FlushError> {
        self.stop.store(true, Ordering::Relaxed);              // 通知
        self.handle.join().map_err(|_| FlushError::Panicked)?; // join：同步 + 拿回 panic
        Ok(())
    }
}
```

借用数据不需要 `Arc + 'static` 时，用 scope——块结束**自动 join 全部**，编译器保证不漏：

```rust
thread::scope(|s| {
    for chunk in data.chunks(1024) {
        s.spawn(move || process(chunk));     // 借用 data，无需 'static
    }
});  // ← 离开作用域前全部 join
```

---

## 3. tokio task：JoinError 没人读，关闭时被粗暴 abort

```rust
// ❌ 错：JoinHandle 被丢弃
let _ = tokio::spawn(write_behind_loop(cache.clone()));
```

后果：

- panic 被 runtime 吞掉——`JoinError` 挂在被扔掉的 handle 上，永远无人读；
- runtime 关闭时（`#[tokio::main]` 结束即 drop runtime）所有 task 被粗暴 abort：flush 到一半的缓冲、发到一半的请求全部截断；
- 任务没有任何参与优雅关闭的通道——它甚至不知道进程要退了。

```rust
// ✅ 对：TaskTracker + CancellationToken（tokio-util），退出前收尾
use tokio_util::{sync::CancellationToken, task::TaskTracker};

struct Workers { tracker: TaskTracker, stop: CancellationToken }

let workers = Workers { tracker: TaskTracker::new(), stop: CancellationToken::new() };

let token = workers.stop.clone();
workers.tracker.spawn(async move {
    let mut writer = WriteBuffer::new();
    loop {
        tokio::select! {
            _ = token.cancelled() => break,     // 响应关闭信号
            _ = writer.write_one() => {}
        }
    }
    writer.flush().await.ok();                  // 收尾：被遗弃的任务没有这个机会
});

// SIGTERM 处理里调：
impl Workers {
    async fn shutdown(self, deadline: Duration) -> Result<(), ShutdownError> {
        self.stop.cancel();                     // 通知全部任务
        self.tracker.close();
        tokio::time::timeout(deadline, self.tracker.wait()).await
            .map_err(|_| ShutdownError::Timeout)?   // 超时者由调用方决定 abort 策略
    }
}
```

### 3.1 unpolled future：没 spawn 没 await = 一行没执行

`async` 块与 future 是**懒的**——创建 future 不执行任何代码。造了它却既不 `spawn` 也不 `await`，那它**一行都没跑**：不是 zombie，不是 close，是静默的 no-op。

```rust
// ❌ 错：future 从未被轮询——write_behind_loop 根本没执行
fn flush_once() {
    let _ = async {                    // 创建 async 块 ≠ 执行
        write_behind_loop().await;
    };
}

// ✅ 对：spawn（接 handle，放进 TaskTracker）
let h = tokio::spawn(write_behind_loop());   // h 交给 tracker

// ✅ 对：或在 async 上下文里直接 await
async fn flush() -> Result<(), E> {
    write_behind_loop().await;
    Ok(())
}
```

> 这是 TS 里 floating promise 的 Rust 对应物：工作不是被静默丢弃——是**从未存在过**。编译器对裸语句 `async {…};` 会给 `unused_must_use` 警告（future 是 `#[must_use]`），但 `let _ =` 恰好压掉这个警告——和本章经典的遗弃签名一样，别用 `let _ =` 接住本该被管的资源。`#[must_use]` 的通用化（能返回信息就别返回 `()`、该被消费的返回值标 must_use）见代码层 R5。

---

## 4. IO 连接：没人管 = 只剩对端超时来收尸

```rust
// ❌ 错：连一次放进全局，从此再没人管它（还违反模块层 R5/8）
static CONN: Lazy<Mutex<Conn>> = Lazy::new(|| Mutex::new(Conn::connect(URL)));

fn query(sql: &str) -> Result<Rows, ConnError> {
    CONN.lock().unwrap().query(sql)   // 隐式依赖 + 裸 unwrap
}
```

后果：

- 没人探活：半开连接毫无感知（`io.md` §2）；
- 没人重连：断了之后的每次请求都失败，直到进程重启；
- 没人关闭：收尸方只剩**对端的 session 超时**——服务端看着一堆脏断开，fd 和会话槽只升不降。

```rust
// ✅ 对：生命周期移交池——探活、重连、换血（max_lifetime）都是「管养」
let mut pool = create_pool(URL, 8);
pool.connect().await?;

let conn = pool.acquire().await?;   // 租约：drop 自动归还（io.md §3）
conn.query("…").await?;
// drop(conn) → 归还或毒化丢弃——既不是关 socket，也不是不管
```

> 连接层完整的「养」法——半开检测、池与租约、毒化、有序关闭——见 `io.md`。

---

## 5. 文件句柄 / 缓冲：不返回 = 提前关闭 + 错误静默

与「活着的孤儿」相反：文件句柄与缓冲**不会继续活着**，它们随作用域结束被 Drop **立刻关闭**。「不返回」在这里有两个后果。

**提前关闭**——调用方预期资源还活着，创建它的函数却先结束了作用域：

```rust
// ❌ 错：句柄只在函数内活到返回——调用方拿不到，返回时已关
fn open_session() {
    let f = File::create("session.tmp")?;
    // …调用方无从使用 f…
}   // f 在此 drop：文件已关，调用方若再写就是 ENOSPC/EBADF

// ✅ 对：返回句柄，后半生归调用方（或移交给 storage 模块）
fn open_session() -> io::Result<File> {
    Ok(File::create("session.tmp")?)
}
```

**错误静默**——收尾动作（flush / fsync）若只发生在 `Drop` 里，错误就丢了：该失败的写看起来成功了。对应模块层 R3：`Drop` 兜底但不替代，`drop` 无法返回错误：

```rust
// ❌ 错：依赖返回时 Drop 自动 flush——flush 失败无人知晓
fn save(b: &BufWriter<File>) {
    // 不 flush；函数结束 b 被 drop，flush 的 Err 被吞
}

    // ✅ 对：显式 flush + fsync，错误可传播（FileStore 的 close 见 ../module/patterns.md §2）
fn save(b: &mut BufWriter<File>) -> io::Result<()> {
    b.flush()?;
    b.get_ref().sync_all()?;
    Ok(())
}
```

> 判据与「活着的孤儿」同一条：创建方要么把句柄**交出去**（返回值 / 移交 storage 模块），要么显式**关好**（flush + close 并传播错误）；不许「创建即丢给 Drop」。

---

## 合法移交：把抚养权交给有契约的一方

| 移交给谁 | 清理契约 | 典型例子 |
| --- | --- | --- |
| OS | 进程退出回收 fd / 内存 | 进程级只读缓存、全局连接池（退出时不显式关也安全） |
| init | 收养 + reaping | double-fork 守护进程；`xdg-open` 点火就跑 |
| runtime | drop 时回收自身资源 | tokio runtime 管理的 I/O 驱动 |
| 池 | 池负责连接生老病死 | 调用方只拿租约（`io.md` §3） |
| supervisor | join / kill + deadline | 本文的 Flusher / Workers；`TaskTracker` |

> 非法的「不管」：owner 是「运气」。dev 环境进程活五秒什么也看不出来；上生产长跑，zombie、fd 泄漏、shutdown 腰斩全在负载最高时爆发。

---

## 自查（监督层）

- 每个 `spawn` 的 handle 都落在某个结构里了吗？grep 一遍 `let _ = .*spawn`——每一处要么是注释过的显式移交，要么是 bug。
- 子进程都 `wait` 了吗？退出状态检查、传播了吗？
- join 返回的 `Err` / `JoinError` 有人读吗？
- 每个 `async` 块 / future 都被 `spawn` 或 `await` 了吗？有没有 `let _ = async {…}`（unpolled = 一行没执行）？
- 创建函数里打开的句柄 / 缓冲，要么返回了、要么显式关好了吗？flush / fsync 的错误被显式接住，而不是丢给 `Drop` 吗？
- litmus test：SIGTERM 后 10 秒内退出，每个子进程 / 线程 / 任务 / 连接各自会发生什么？答不上来的那一个，就是被遗弃的那一个。
- 有没有 shutdown 测试：走一遍优雅关闭，断言不 hang、没有半成品？
