# SOLID 原则（SOLID Principles）

> **SOLID = 5 个面向对象设计原则。** 其中 **OCP（开闭原则）** 是最需要在项目初期就确立的——一旦确立，后续扩展只加新代码、不改老代码。

## 一句话

> **SOLID：单一职责 / 开闭 / 里氏替换 / 接口隔离 / 依赖倒置。** 在项目初期确立 OCP，定下「扩展而非修改」的基调——多实现时再考虑 IOC 容器。

## 何时使用

- 任何项目初期——定基调
- 任何接口/模块设计时
- 任何重构决策时
- 决定要不要引入 IOC 容器时

## 五原则概览

| 原则 | 一句话 | 对应章节 |
| --- | --- | --- |
| **S** - 单一职责 | 一个模块只做一类事 | [workflow.md 第 2.4 步](../operations/workflow.md) + [rust-style 模块层 R2](../../../rust-style/SKILL.md) |
| **O** - 开闭 | 扩展开放，修改关闭 | **本章重点** |
| **L** - 里氏替换 | 子类型可替换父类型 | [rust-style 模块层 R1-R2](../../../rust-style/SKILL.md) |
| **I** - 接口隔离 | 多个小接口 > 一个大接口 | [rust-style 模块层 R2](../../../rust-style/SKILL.md) |
| **D** - 依赖倒置 | 依赖抽象，不依赖具体 | **本章 + [rust-style 模块层 R7](../../../rust-style/SKILL.md) / [ts-style 规则 9](../../../ts-style/SKILL.md)** |

## OCP 深入

### 定义

> **软件实体（类、模块、函数）应该对扩展开放，对修改关闭。**

- **扩展开放**：可以增加新行为
- **修改关闭**：不需要改已有代码

### 为什么重要

- **避免回归**：改老代码可能破坏已有功能
- **促进复用**：新行为不污染旧代码
- **支持并行开发**：多人各自加新实现而不冲突
- **降低耦合**：行为变化 = 加新文件，不是改老文件

### 反例 vs 正例

**❌ 没有 OCP**——每加一种存储就要改 process 函数：

```rust
fn process(config: &Config, data: Data) {
    if config.storage == "file" {
        save_to_file(data);
    } else if config.storage == "db" {
        save_to_db(data);
    } else if config.storage == "s3" {     // ← 每次加存储都要改这里
        save_to_s3(data);
    } else if config.storage == "gcs" {    // ← 又要改
        save_to_gcs(data);
    }
    // ... if-else 链越来越长
}
```

**✅ 有 OCP**——加新存储 = 加新 struct + 新 impl，process 函数永远不动：

```rust
trait Storage {
    fn save(&self, data: Data) -> Result<(), Error>;
}

fn process<S: Storage>(storage: &S, data: Data) -> Result<(), Error> {
    storage.save(data)?    // 永远不改这一行
}

struct FileStorage;
impl Storage for FileStorage {
    fn save(&self, d: Data) -> Result<(), Error> { /* 文件存储 */ }
}

struct DbStorage;
impl Storage for DbStorage {
    fn save(&self, d: Data) -> Result<(), Error> { /* 数据库 */ }
}

// 加 S3Storage = 新 struct + 新 impl，process 不动
// 加 GcsStorage = 新 struct + 新 impl，process 不动
```


### 决策树
OCP 在项目初期的应用

```
项目启动
   ↓
这个行为会有多种实现吗？
   ├─ 否（只有 1 个实现，需求明确不会变）
   │    ↓
   │  直接用 concrete type，不必抽象
   │
   └─ 是（多实现 / 多策略 / 可能切换）
        ↓
        抽到 trait/interface 后面
        ↓
        函数依赖抽象
        ↓
        同一接口有 ≥ 3 个实现 / 需要按配置切换？
        ├─ 否（实现数量 < 3）
        │    ↓
        │  直接传参即可，不需要 IOC 容器
        │
        └─ 是
             ↓
             考虑引入 IOC 容器
```

### 没有 IOC 时的做法：面向接口编程

**核心思想**：函数依赖 trait/interface，不依赖具体类型。

#### Rust

```rust
// 1. 定义 trait
trait Storage {
    fn save(&self, data: Data) -> Result<(), Error>;
}

// 2. 函数依赖 trait，不依赖具体类型
fn process<S: Storage>(storage: &S, data: Data) -> Result<(), Error> {
    storage.save(data)?;
}

// 3. 调用方传具体 impl
let storage = FileStorage::new();
process(&storage, data)?;

// 4. 测试时传 mock
let mock = MockStorage::new();
process(&mock, test_data)?;
```

#### TypeScript

```typescript
// 1. 定义 interface
interface Storage {
  save(data: Data): Promise<Result<void, Error>>;
}

// 2. 函数依赖 interface，不依赖具体类
function process(storage: Storage, data: Data): Promise<Result<void, Error>> {
  return storage.save(data);
}

// 3. 调用方传具体 impl
const storage: Storage = new FileStorage();
await process(storage, data);

// 4. 测试时传 mock
const mock: Storage = createMockStorage();
await process(mock, testData);
```

**好处**：
- 不依赖 IOC 容器也能实现 OCP
- 测试容易（mock 替换具体实现）
- 依赖清晰（看签名就知道需要什么）
- 零运行时开销（Rust 的静态分派）

**参考**：
- Rust: [rust-style 模块层 R7](../../../rust-style/SKILL.md) 函数显式声明依赖
- TypeScript: [ts-style 规则 9](../../../ts-style/SKILL.md) 顶级函数优先显式声明依赖

### 有 IOC 时的做法：依赖注入

**IOC 容器自动管理依赖**：

#### Rust（手工 IOC，无框架）

```rust
// 容器：保存所有 impl 的注册表
struct Container {
    storage: Box<dyn Storage>,
    logger: Box<dyn Logger>,
}

impl Container {
    fn new() -> Self {
        Container {
            storage: Box::new(FileStorage::new()),
            logger: Box::new(ConsoleLogger::new()),
        }
    }
}

// 业务代码从容器取依赖
fn handle_user(container: &Container, user: User) -> Result<(), Error> {
    container.logger.info("handling user");
    container.storage.save(user.data)?;
    Ok(())
}
```

#### TypeScript（框架 IOC：NestJS / Angular）

```typescript
// 注册实现
@Injectable()
class FileStorage implements Storage { ... }

@Module({
    providers: [
        { provide: Storage, useClass: FileStorage },
    ],
})
class AppModule {}

// 业务代码自动注入
@Controller('/api/users')
class UserController {
    constructor(
        private storage: Storage,    // 自动注入 FileStorage
        private logger: Logger,       // 自动注入 Logger
    ) {}

    @Post()
    async create(@Body() user: User) {
        this.logger.info('creating user');
        await this.storage.save(user.data);
    }
}
```

**好处**：
- 注册一次，到处使用
- 切换实现 = 改配置 / 改注册，不改业务代码
- 框架支持（Spring / NestJS / Angular）下零成本
- 复杂依赖图自动管理

**代价**：
- 增加学习成本（理解 IOC 概念）
- 调试栈更深
- 某些语言/框架的 IOC 反射有性能开销

## 何时引入 IOC 容器

**判断标准（满足任意一条就值得引入）**：

- ✅ 同一接口有 **≥ 3 个实现**
- ✅ 实现需要按**配置切换**（dev / prod / 不同租户 / 不同客户）
- ✅ 依赖图复杂（一个组件依赖 5+ 个其他组件）
- ✅ 框架已经支持 IOC（Spring / NestJS / Angular / Dagger）→ 直接用

**反模式**：

- ❌ 只有 1-2 个实现，不需要 IOC → 徒增复杂度
- ❌ 业务很简单，依赖清晰 → 直接传参
- ❌ 想用 IOC 但只有 1 个实现 → 等真的有第二个再加
- ❌ 没用框架支持 IOC 的语言，强行自己造 → 通常不划算

## OCP 与 code-master 其他章节

| 章节 | 与 OCP 的关系 |
| --- | --- |
| [encapsulation.md](encapsulation.md) | 封装 = 用作用域隔离复杂度；OCP = 用接口隔离变化 |
| [composition.md](composition.md) | 域的组合 = 多个子域按接口协作；OCP 让子域可替换 |
| [container.md](container.md) | 容器 = 治理边界；OCP 让容器内行为可扩展 |
| [phases/early-dev.md](../operations/phases/early-dev.md) | 工程化在 init 阶段就要确立 OCP |
| [rust-style 模块层 R1-R7](../../../rust-style/SKILL.md) | Rust 实现 OCP 的具体规则 |
| [ts-style 规则 1-4](../../../ts-style/SKILL.md) | TypeScript 实现 OCP 的具体规则 |

## SOLID 在 code-master / language style 中的落地

| 原则 | code-master 章节 | 语言 style 落地 |
| --- | --- | --- |
| S 单一职责 | [workflow.md 2.4 步](../operations/workflow.md) | rust-style 模块层 R2 / ts-style 规则 1-2 |
| O 开闭 | **本章** | rust-style 模块层 R1-R2 / ts-style 规则 1-4 |
| L 里氏替换 | [composition.md](composition.md) | rust-style 模块层 R1-R2（trait bound 即 L）|
| I 接口隔离 | [interface-contract.md](../operations/interface-contract.md) | rust-style 模块层 R2（拆 trait）|
| D 依赖倒置 | **本章** | rust-style 模块层 R7 / ts-style 规则 9 |

## 反模式

| 反模式 | 表现 | 纠正 |
| --- | --- | --- |
| **if-else 链代替 trait** | 加新分支要改老函数 | 抽 trait，加新 impl |
| **concrete type 传参** | 函数签名写 `FileStorage` | 改成 `Storage`（trait / interface）|
| **过度抽象** | 只有 1 个实现却抽了 trait | 等真有第二个再加 |
| **早 IOC** | 1 个实现就用 IOC 容器 | 等实现数量 ≥ 3 再考虑 |
| **晚 OCP** | 老代码到处 if-else，重构代价大 | 项目初期就确立 |
| **泛型 trait 没 bound** | 函数能接受任何类型，没限制 | 加 `where T: Storage` |

## 自检

### 项目级

- [ ] 项目初期就确立了"扩展而非修改"的基调？
- [ ] 团队对 OCP 有共识（不出现"加 if-else 链"的情况）？

### 代码级

- [ ] "会变的行为"都抽到 trait/interface 后面了？
- [ ] 函数依赖 trait/interface，不依赖具体类型？
- [ ] 加新实现时不需要改老代码？
- [ ] 单一实现时没过度抽象？
- [ ] 多实现时已考虑 IOC 容器（如果满足判断标准）？

### 测试级

- [ ] 业务函数能用 mock 替换具体实现来测？
- [ ] 签名能看出依赖（不需要读实现）？

任何一项不满足，去查 [典型反模式](../operations/anti-patterns.md) 或对应语言 style。

## 一句话

> **OCP = 对扩展开放、对修改关闭。** 在项目初期确立「扩展而非修改」的基调：用接口/抽象隔离变化；多实现时再考虑 IOC 容器。具体实现交给语言 style。