# 常见偏离与纠正 (Rust)

编译器已防住了一大类错误（use-after-free、data race、忘记 mut），但以下反模式仍然常见。

| # | 反模式 | 违反规则 |
| --- | --- | --- |
| 1 | 公开导出了实现 struct | 模块层 R1（DIP） |
| 2 | 用 `unwrap` 吞掉了可恢复的错误 | 代码层 R4 |
| 3 | `Drop` 作为唯一的清理路径 | 模块层 R3 |
| 4 | 构造/工厂函数里启动了副作用 | 模块层 R4 |
| 5 | 函数直接读 `static` / 模块级变量 | 模块层 R7 |
| 6 | `lazy_static` + `Mutex` 持有需要重置的状态 | 模块层 R5 |
| 7 | 一个巨型 trait 包含所有方法 | 模块层 R2（ISP） |
| 8 | 顶级函数未显式声明依赖 | 模块层 R7 |
| 9 | 能返回信息却返回了 `()` | 代码层 R5 |
| 10 | 该被消费的返回值未标 `#[must_use]` | 代码层 R5 |

---

## 1. 公开导出了实现 struct

```rust
// ❌ 错：调用方能接触到具体类型
pub struct AnimalImpl { name: String, age: u32 }

// ✅ 对：struct 私有，只公开 trait + 工厂
struct AnimalImpl { name: String, age: u32 }
pub fn create_animal(name: String, age: u32) -> impl Animal {
    AnimalImpl { name, age }
}
```

---

## 2. 用 unwrap 吞掉可恢复的错误

```rust
// ❌ 错：IO 错误用 unwrap 吞掉 → 失败时 panic
fn load_user(id: u64) -> User {
    let data = fetch_user(id).unwrap();  // 网络挂了 = crash
    parse_user(&data).unwrap()
}

// ✅ 对：? 传播，让调用方决定怎么处理
fn load_user(id: u64) -> Result<User, AppError> {
    let data = fetch_user(id)?;
    let user = parse_user(&data)?;
    Ok(user)
}

// ✅ 边界处可以 expect（失败 = 程序不该继续）
let config = load_config().expect("config required at startup");
```

---

## 3. Drop 作为唯一清理路径

```rust
// ❌ 错：Drop 无法返回错误，关闭时机不可控
impl Drop for ConnImpl {
    fn drop(&mut self) {
        let _ = self.socket.shutdown(); // 错误被静默吞掉
    }
}

// ✅ 对：close 进契约，消耗自身，返回 Result
pub trait Connection {
    // …其余方法…
    fn close(mut self) -> Result<(), ConnError>;
}

impl Connection for ConnImpl {
    fn close(mut self) -> Result<(), ConnError> {
        // take 把资源从 self 中取走：随后 self 走 Drop 时看到的是 None，不会二次关闭
        if let Some(socket) = self.socket.take() {
            socket.shutdown()?;      // 错误可以传播——这是 Drop 做不到的
        }
        Ok(())
    }
}

// Drop 只作兜底：忘记调 close 时也能关，但错误只能丢弃
impl Drop for ConnImpl {
    fn drop(&mut self) {
        if let Some(socket) = self.socket.take() {
            let _ = socket.shutdown();
        }
    }
}
```

（这要求 `socket` 字段是 `Option<Socket>`：`take` 之后两条路径互不重复。）

---

## 4. 构造/工厂函数里启动了副作用

```rust
// ❌ 错：create 里同时构造和连接
pub fn create_conn(url: &str) -> impl Connection {
    let mut conn = ConnImpl { url: url.to_string(), socket: None };
    conn.connect(); // 副作用混进了构造，且返回的 Result 只能丢弃
    conn
}

// ✅ 对：create 纯装配，副作用由调用方显式触发
pub fn create_conn(url: &str) -> impl Connection {
    ConnImpl { url: url.to_string(), socket: None }
}
// 使用方：
// let mut conn = create_conn(url);
// conn.connect()?;   // 副作用在此启动，错误可传播
```

---

## 5. 函数直接读 static

```rust
// ⚠ 不推荐：隐式依赖全局可变配置
static CONFIG: Lazy<Config> = Lazy::new(|| load_config());
fn fetch_data(key: &str) -> Data {
    CONFIG.client.get(key) // 签名看不出依赖
}

// ✅ 推荐：client 通过参数传入
fn fetch_data(client: &Client, key: &str) -> Data {
    client.get(key)
}
```

---

## 6. lazy_static + Mutex 持有需要重置的状态

```rust
// ❌ 错：测试间状态串味，无法 reset
lazy_static! {
    static ref CACHE: Mutex<HashMap<String, Data>> = Mutex::new(HashMap::new());
}

// ✅ 对：在 main 中创建，通过参数注入到需要的地方
fn main() {
    let cache = Arc::new(Mutex::new(HashMap::new()));
    let loader = create_loader(cache.clone());
    let reporter = create_reporter(cache.clone());
    // 测试时每个用例创建自己的 cache
}
```

---

## 7. 一个巨型 trait

```rust
// ❌ 错：所有方法堆在一个 trait 里
pub trait GodService {
    fn create_user(&mut self, name: &str) -> Result<User, Error>;
    fn delete_user(&mut self, id: u64) -> Result<(), Error>;
    fn send_email(&self, to: &str, body: &str) -> Result<(), Error>;
    fn log_audit(&self, event: &str);
    fn export_report(&self, format: &str) -> Result<Vec<u8>, Error>;
}

// ✅ 对：按职责拆细，消费方只依赖需要的
pub trait UserRepo { fn create(&mut self, name: &str) -> Result<User, Error>; }
pub trait EmailSender { fn send(&self, to: &str, body: &str) -> Result<(), Error>; }
pub trait Auditor { fn log(&self, event: &str); }

fn register_user(repo: &mut impl UserRepo, email: &impl EmailSender, name: &str) -> Result<User, Error> {
    let user = repo.create(name)?;
    email.send(name, "Welcome!")?;
    Ok(user)
}
```

---

## 8. 顶级函数未显式声明依赖

```rust
// ❌ 错：函数内部构造依赖，无法替换
fn load_and_cache(key: &str) -> Data {
    let client = HttpClient::new("hardcoded-url"); // 硬编码，测试换不了
    let data = client.get(key);
    // …
}

// ✅ 对：依赖通过参数接收
fn load_and_cache(client: &HttpClient, cache: &mut HashMap<String, Data>, key: &str) -> Data {
    let data = client.get(key);
    // …
}
```

---

## 9. 能返回信息却返回了 `()`

```rust
// ❌ 错：吞掉调用方可能关心的处理数量 / 状态
fn process(items: &[Item]) {
    for it in items { handle(it); }   // 处理了几个？调用方无从得知
}

// ✅ 对：返回结果，把取舍交给调用方
fn process(items: &[Item]) -> usize {
    items.iter().filter(|it| handle(it)).count()
}
```

> `()` 只留给「真的没有任何信息」的纯动作（`drop`、`clear`、`flush`）。返回 `()` 等于替调用方做了「都不重要」的决定。

---

## 10. 该被消费的返回值未标 `#[must_use]`

```rust
// ❌ 错：调用方裸语句丢弃，无警告、静默丢信息
fn build() -> Builder { Builder::default() }
build();   // 没人消费，编译器不吭声

// ✅ 对：标 must_use，裸语句丢弃即警告
#[must_use = "Builder 未被使用，构建结果丢失"]
fn build() -> Builder { Builder::default() }
// build();          // ⚠ unused_must_use
// let b = build();  // ✅ 正常消费
```

> `#[must_use]` 让「忽略」可见，但不禁止 `let _ =` 显式丢弃。标准库对 `String` / `Result` / `Future` 都这么标。详见代码层 R5 与 `../process/supervision.md` 的 `let _ =` 遗弃签名。
