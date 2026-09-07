# 函数纯度（Function Purity）

> **Handler 由函数组成，函数分两类：纯函数 vs 脏函数。** 脏函数有 3 个子类型——改参、IO、隐参。本章给出函数级别的纪律：哪些应该纯，哪些可以脏，怎么"可原谅地"脏。

## 一句话

> **理想状态：除 main 外全是纯函数。** 脏函数尽量少、尽量边界、尽量可原谅。函数纯度直接决定代码的可测性 / 可并行性 / 可缓存性。

## 何时使用

- 在 [derivation.md 第 4 步](../operations/derivation.md)（事件类型 → handler）设计 handler 时
- 写任何业务函数时——问自己："这是纯函数还是脏函数？"
- Code review 时——检查 handler 内的函数分类
- 设计接口契约时——区分纯函数调用 vs 脏函数调用

## 基础概念

### 生命周期（6 个 hook）

```
常量：  创建 → 读取*n → 销毁
变量：  创建 → 读取*n → 更新*n → 销毁
```

- 常量只读——适合放在全局作用域（确定性）
- 变量会更新——生命周期应尽量短、作用域尽量小

### 作用域

- **全局作用域**：一次程序运行只展开一次；只放常量 / 纯函数 / 单例基础设施
- **局部作用域**：可以展开多次；适合放变量 / 临时状态

### 所有权

- 状态的所有权归声明它的最近一级作用域
- 作用域关闭时，必须关闭其所有状态资源
- 所有权可转移（move 语义）

### 副作用

- 函数运行时与外界发生交互并造成影响 = 副作用
- 脏函数的本质 = 有副作用

## 两大类函数

### 纯函数（Pure Function）

**定义**：输出**仅依赖输入参数**，**不受外部状态影响**。相同输入永远产生相同输出。

```typescript
// ✅ 纯函数
function add(a: number, b: number): number {
  return a + b;
}

function formatName(user: User): string {
  return `${user.firstName} ${user.lastName}`;
}
```

**优势**：

| 优势 | 含义 |
| --- | --- |
| **可确定性** | 行为可预测；输入输出明确 |
| **可测试性** | 不需要初始化 / 清理环境 |
| **可移植性** | 不依赖外界环境，跨平台容易 |
| **可复用性** | 依赖少，可被多处复用 |
| **可重入性** | 同一函数可被多个调用方同时进入 |
| **可并行性** | 不修改外部状态，可任意并行 |
| **可缓存性** | 相同输入 → 相同输出 → 缓存结果 |

**适合放在全局作用域**（确定性、广泛可见性、长生命周期）。

### 脏函数（Dirty Function）

**定义**：与外界发生交互并造成影响 = 副作用。**纯函数之外的函数都是脏函数**。

## 脏函数的三个子类型

### 1. 改参函数（Parameter-Mutating）

**特征**：通过传入的**参数指针**修改了指针指向的数据。

```typescript
// ❌ 改参函数：修改了 arr 的内容
function appendItem(arr: number[], item: number): void {
  arr.push(item);   // 修改了外部数据
}

// ❌ 改参函数：out 参数
function parseInt(s: string, out: { value: number }): void {
  out.value = Number(s);
}
```

**纠正**：
- **不可变更新**——返回新值，不修改入参
- **纯函数优先**——同样的逻辑用 return 表达

```typescript
// ✅ 不可变更新
function appendItem(arr: number[], item: number): number[] {
  return [...arr, item];
}

// ✅ 返回新值
function parseInt(s: string): number {
  return Number(s);
}
```

### 2. IO 函数（IO Function）

**特征**：执行进程外的数据读写（文件、网络、DB、时钟、随机数等）。**IO 函数是外部状态的提取**——进程外数据通过 IO 进入到进程内变量。

```typescript
// ❌ IO 函数
function readConfig(): Config {
  return JSON.parse(fs.readFileSync('config.json', 'utf-8'));
}

function getCurrentTime(): number {
  return Date.now();   // 隐式依赖系统时钟
}
```

**纠正**：
- **init/destroy 管住生命周期**——connect / close 配对
- **IO 与状态机分离**——把 IO 结果变成状态更新
- **声明式 IO**——把 IO 描述为数据 / 配置

```typescript
// ✅ 边界化的 IO
async function readConfig(): Promise<Config> {
  return JSON.parse(await fs.readFile('config.json', 'utf-8'));
}

// ✅ 声明式 IO（描述而非执行）
interface ReadAction {
  kind: 'read';
  path: string;
}

function executeAction(action: ReadAction): Promise<string> {
  return fs.readFile(action.path, 'utf-8');
}
```

#### IO 函数的使用纪律

> **IO 资源的生命周期无法保证——必须用 Connection/Store + failable 函数来表达。**

**四条铁律**：

**1. 通过 Connection 对象或 Store 来管理**

IO 资源（DB 连接 / 文件句柄 / HTTP client）**不应该在业务代码里直接访问**——必须封装在 Connection / Store 对象里。

```typescript
// ❌ 业务代码直接调 fs
async function handleRequest(req: Request): Promise<Response> {
  const data = JSON.parse(await fs.readFile('config.json', 'utf-8'));  // IO 裸露
  return new Response(data);
}

// ✅ 通过 ConfigStore 封装
class ConfigStore {
  constructor(private path: string) {}

  async load(): Promise<Config> {                           // 业务调这个
    const raw = await fs.readFile(this.path, 'utf-8');
    return JSON.parse(raw);
  }
}

async function handleRequest(req: Request, store: ConfigStore): Promise<Response> {
  const data = await store.load();                          // 业务不直接接触 fs
  return new Response(data);
}
```

**2. 必须使用可失败的函数（failable）**

**IO 资源的生命周期无法保证**——网络会断、文件会删、DB 会宕。**所有 IO 操作都必须能表达失败**。

```typescript
// ❌ 不可失败：throws 可能被忽略
function loadConfig(): Config {
  return JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  // 文件不存在？throw JSON.parse error——但调用方未必处理
}

// ✅ 可失败：返回值表达 Result
function loadConfig(): Result<Config, IoError> {
  try {
    const raw = fs.readFileSync('config.json', 'utf-8');
    return Ok(JSON.parse(raw));
  } catch (e) {
    return Err(new IoError('config load failed', e));
  }
}

// Rust 天然用 Result
fn load_config() -> Result<Config, IoError> {
    let raw = fs::read_to_string("config.json")?;  // ? 传播错误
    let config: Config = serde_json::from_str(&raw)?;
    Ok(config)
}
```

**3. 管理 IO 资源的对象本身具有状态**

Connection / Store 内部维护**自己的状态机**（connecting / connected / error / disconnected / closed）：

```typescript
class DbConnection {
  private state: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  async connect(): Promise<Result<void, DbError>> {
    this.state = 'connecting';
    try {
      await this.establishConnection();
      this.state = 'connected';
      return Ok(undefined);
    } catch (e) {
      this.state = 'error';
      return Err(new DbError('connect failed', e));
    }
  }

  async query(sql: string): Promise<Result<Rows, DbError>> {
    if (this.state !== 'connected') {       // 状态检查
      return Err(new DbError('not connected'));
    }
    // ... 实际查询
  }

  async close(): Promise<void> {
    if (this.state === 'connected') {
      await this.releaseConnection();
    }
    this.state = 'disconnected';
  }
}
```

**4. 只有 IO Connection 的所有者才能调用它**

Connection 应该被**一个组件独占**——防止多 owner 导致竞态、状态不一致。

```typescript
// ❌ Connection 满天飞，谁都能调
class UserService {
  constructor(private db: DbConnection) {}
  // ... A 组件
}
class OrderService {
  constructor(private db: DbConnection) {}  // 同一个 db，B 组件也拿了一份
  // ... 多 owner 风险
}

// ✅ Connection 集中在一个地方（repository / store 层）
class DbPool {
  // 集中管理连接，分发给受信任的 store
  getStore(name: string): Store { ... }
}
class UserStore {
  constructor(private db: DbPool) {}  // 通过 pool 获取
  // ...
}
class OrderStore {
  constructor(private db: DbPool) {}
  // ...
}
```

#### 为什么这四条铁律重要

- **Connection 封装**：业务代码不接触 IO 细节 → 易测、易换实现
- **failable 函数**：IO 失败的必然性必须被显式表达 → 不可能忽略
- **内部状态**：Connection 自己的状态机保证了一致性（不会"半连接"状态被使用）
- **单一 owner**：避免竞态和资源泄漏——这跟 [composition.md](composition.md) 的「父依赖子」是同一族约束

### 3. 隐参函数（Implicit-Parameter Function）

**特征**：直接依赖或引用了**外部作用域中的变量**——形成"隐式参数"。

```typescript
// ❌ 隐参函数：依赖外部 logger
function processUser(user: User): void {
  logger.info(`processing ${user.name}`);  // logger 从哪里来？
  // ...
}

// ❌ 隐参函数：依赖全局配置
let GLOBAL_CONFIG: Config = ...;
function handle(req: Request): Response {
  if (GLOBAL_CONFIG.debug) {  // 依赖外部变量
    console.log(req);
  }
  // ...
}
```

**纠正**：
- **参数化接收**（dependency injection）——把依赖当参数
- **签名即契约**——看签名就知道需要什么

```typescript
// ✅ 显式依赖
function processUser(user: User, logger: Logger): void {
  logger.info(`processing ${user.name}`);
}

function handle(req: Request, config: Config): Response {
  if (config.debug) {
    console.log(req);
  }
}
```

### 三个子类型对照

| 类型 | 脏在哪 | 纠正 |
| --- | --- | --- |
| **改参** | 通过指针修改入参 | 不可变更新 / 返回新值 |
| **IO** | 进程外数据读写 | init/destroy 管住 / 声明式 IO |
| **隐参** | 引用外部作用域变量 | 参数化接收（DI）|

## 脏函数的"传染性"

> 纯函数调用纯函数 = 纯函数。**脏函数调用任何函数 = 脏函数**（整个调用链都变脏）。

```typescript
// 这两个函数都变脏了
function dirtyProcessUser(user: User): void {
  const name = formatName(user);     // formatName 本来是纯的
  logger.info(name);                  // 因为调用者脏了，formatName 也"传染"为脏
  saveToDb(user);                     // 整个调用链脏
}
```

**含义**：
- 纯函数必须**严格保持纯净**——不能调用任何脏函数
- 脏函数如果调用纯函数，等于把"纯度"传染给整个调用链
- handler 内的"主流程"如果脏了，所有被调用的纯函数都失效

## JS / TS 中的隐性副作用

容易忽略的脏来源：

| 来源 | 隐性原因 |
| --- | --- |
| `async/await` / Promise | 异步本质就是"延后的 IO" |
| `setTimeout` / `setInterval` | 调度 + IO |
| `Math.random()` / `Date.now()` | 依赖外部状态（随机源 / 时钟）|
| `console.log` | 输出 IO |
| Web API（fetch / DOM） | 全部是 IO |
| React 状态更新 | 触发 UI 副作用 |

写纯函数时，这些都要规避。

## 脏函数的"可原谅性"

> **可原谅的脏函数**：影响范围有限、容易理解、不会随项目增长而恶化的脏。

**详见前两节**：

- **改参函数**的可原谅条件 → 见 [### 1. 改参函数 - 改参函数的可原谅条件](#1-改参函数parameter-mutating)（状态所有者调用 + 4 条判据）
- **IO 函数**的使用纪律 → 见 [### 2. IO 函数 - IO 函数的使用纪律](#2-io-函数io-function)（4 条铁律：Connection 封装 / failable / 内部状态 / 单一 owner）

三种可原谅的脏（从上面两条细化出来）：

| 类型 | 例子 | 为什么可原谅 |
| --- | --- | --- |
| **私有闭包** | 随机数生成器 / 节流 / 单例 / 函数缓存 | 外部变量独享，无并发问题 |
| **局部变量** | 函数内 `let x = ...; x = ...;` | 在函数 create/destroy 之间自洽 |
| **独立 IO** | 日志 / 调试信息 | 与主体逻辑解耦，不抛错 |

不可原谅的脏（要避免）：

- 跨模块的全局状态修改
- 隐式依赖远距离的外部状态
- 调用方不知道、不控制的 IO
- 改别人传进来的入参（不是 owner）
- IO 不走 Connection 包裹、且不返回 failable

## 跟 handler 的关系

在 [derivation.md 第 4 步](../operations/derivation.md)（事件类型 → handler）中，每个 handler 由多个函数组成。**handler 内的函数应该按纯/脏分类**：

```
handler onClick(event, state):
    // 纯函数优先（处理数据）
    newState = computeNewState(event, state)    // 纯
    
    // 脏函数（边界：IO + 改 state）
    saveToDb(newState)                          // IO
    state = newState                             // 改参（但 state 是必要的）
    
    return state'
```

**好的 handler 模式**：

- **90% 纯函数**：数据处理、状态计算
- **10% 脏函数**：只在外围（IO + 改 state）

**差的 handler 模式**：

- 30% 纯函数 + 30% 隐参 + 20% 改参 + 20% IO = 全是脏

## 跟其他章节的关系

| 章节 | 关系 |
| --- | --- |
| [composition.md](composition.md) | 域的组合 = 多个函数（含纯/脏）按调用图协作 |
| [anatomy.md](anatomy.md) | daemon 八件套中的 handler = 纯函数 + 脏函数的封装 |
| [derivation.md 第 4 步](../operations/derivation.md) | 事件 → handler 时，handler 内的函数按本章分类 |
| [phases/early-dev.md](../operations/phases/early-dev.md) | 工具模块（logger / config）= 典型脏函数封装 |
| [rust-style 进程层 R1](../../../../rust-style/SKILL.md) | Rust 语言的脏函数分类（与本章同构）|
| [ts-style 规则 11](../../../../ts-style/SKILL.md) | TypeScript 语言的脏函数分类（与本章同构）|

## 反模式

| 反模式 | 表现 | 纠正 |
| --- | --- | --- |
| **改参假装是纯函数** | `arr.push(item)` 不声明 | 改用 `[...arr, item]` 返回新数组 |
| **隐参** | 函数体里读 `globalConfig` | 改成参数 `function(config)` |
| **IO 散落** | 业务代码里 `fs.readFile` 满天飞 | 抽到 IO 边界（repository / adapter）|
| **日志写参** | `log.info("x=", x, "y=", y)` 难解析 | 用结构化字段 `log.info({ x, y })` |
| **纯函数调用脏** | 纯计算里夹 IO | 拆开：先纯计算、再 IO |
| **脏传染** | 一个 IO 拖垮整条调用链 | IO 隔离在 handler 外层 |

## 自检

### 函数级

- [ ] 写函数时主动判断：这是纯函数还是脏函数？
- [ ] 改参函数都被不可变更新替换了？
- [ ] 隐参函数都被参数化接收了？
- [ ] IO 函数都被 init/destroy 管住了？

### handler 级

- [ ] handler 内纯函数占多数（> 70%）？
- [ ] 脏函数都在 handler 外层（IO + 改 state）？
- [ ] 调用链上没有"脏传染"——纯函数没调用脏函数？

### 项目级

- [ ] 团队对"什么是纯函数"有共识？
- [ ] 工具模块（logger / config）都是封装良好的脏函数？
- [ ] Code review 会检查函数纯度？

任何一项不满足，去查 [典型反模式](../operations/anti-patterns.md) 或对应语言 style。

## 一句话

> **理想状态：除 main 外全是纯函数。** 脏函数尽量少、尽量边界、尽量可原谅——handler 内 90% 纯函数 + 10% 边界脏函数。具体实现交给 rust-style / ts-style。