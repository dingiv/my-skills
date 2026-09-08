# 早期开发 / 项目骨架（Early Dev / Project Skeleton）

> **正式写业务代码之前，先把基础设施搭好**——logger、config、constants、目录结构、utils 模块。这些是项目的「骨骼」，**先于业务逻辑就绪**（参见 [timing.md](../../theory/timing.md) 第 1 条「依赖前向包含」）。

**进入条件**：[initiation.md](initiation.md) 第 4 步（调用链罗列）已完成，接口契约与调用链都已确定。

**离开条件**：logger / config / constants 可用 + 项目目录结构定型 + utils 模块可独立调用。

## 一句话

> **4 个最佳实践先于业务代码：统一 logger、统一配置、常量模块、目录结构 + utils。**

## 与工程化的关系

本章是 [engineering.md](../engineering.md) 在 init 阶段的子集。engineering.md 涵盖工程化全集（工具 + 流程 + 规范），本章聚焦**写业务代码前必须就绪的 4 项基础设施**。完整工程化实践（Git workflow / CI/CD / code review / 命名规范 / SemVer）见 engineering.md。

## SOLID / OCP 早期介入

在搭建项目骨架时，**SOLID 原则中的 OCP（开闭原则）就要开始确立**。具体做法：

1. **识别会变的行为**——哪些模块会有多种实现 / 可能切换？
2. **抽到 trait/interface 后面**——能加新实现不动老代码
3. **函数依赖抽象**——`fn process<S: Storage>(s: &S, ...)` 不写 `fn process(s: &FileStorage)`
4. **判断要不要 IOC**——≥ 3 个实现 / 按配置切换 / 依赖图复杂 → 考虑；否则不必

**为什么是项目初期**？后期重构 if-else 链 → 抽 trait → 改所有调用方，代价极大。初期就抽好，后续只是加 impl。

详细理论 + Rust/TS 双向代码示例 + 何时引入 IOC 容器的判断标准，见 [SOLID 原则](../../theory/solid.md)。

## 何时使用

- 在 [initiation.md](initiation.md) 第 4 步（调用链罗列）完成后
- 进入正式编码前
- 重构现有项目时（如果原本缺失这些基础设施）

## 4 个最佳实践

### 1. 统一 Logger（必备）

**目标**：所有日志经过统一的 logger，而不是散落的 `println!` / `console.log`。

**基本要求**：

- **多级别**：debug / info / warn / error
- **多输出**：console（开发时）+ file（生产时）
- **结构化字段**：timestamp / level / module / message
- **可配置**：通过配置控制级别和输出位置
- **异步安全**：在多线程 / async 上下文能用
- **日志轮转**（长进程需要）：按大小或时间切分文件，避免单文件过大

**反模式**：

- 散落 `println!` / `console.log` → 改用 logger
- 字符串拼接复杂日志 → 用结构化字段
- 日志级别混乱（info 里塞 debug 信息）→ 严格分级
- log 失败时 panic → log 必须永不 fail

**Rust 推荐**：`tracing` crate（结构化、span、async 友好）

```rust
use tracing::{info, warn, error, debug, instrument};

#[instrument]
async fn handle_request(req: Request) -> Response {
    debug!("processing request");
    info!(user_id = %req.user_id, "user logged in");
    // ...
}
```

**TypeScript 推荐**：`pino`（快，结构化）

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "production"
    ? { target: "pino/file", options: { destination: "./logs/app.log" } }
    : { target: "pino/pretty" },  // 开发时漂亮打印
});

logger.info({ userId }, "user logged in");
```

### 2. 统一配置管理（必备）

**目标**：所有配置（DB 连接、端口、密钥、特性开关）从一个地方读取，不散落在代码里。

**基本要求**：

- **单文件配置**：`config.toml` / `config.json` / `config.yaml`
- **分层解析**：环境变量 > 配置文件 > 默认值
- **启动校验**：缺失必填项立刻 fail，不等到运行时
- **类型安全**：访问配置时类型明确（避免 stringly-typed）
- **集中目录**：所有数据读写都走 `data/` 或专门的配置目录

**反模式**：

- 配置散落在多个文件 → 统一到 1 个入口
- 直接读环境变量（env 变量太多无法管理） → 用 config 库统一
- 配置缺失才报错（运行时崩） → 启动时 fail-fast
- 把密钥提交到 git → 用 .env + .gitignore + secret 管理

**Rust 推荐**：`config` crate + `serde` 序列化

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
}

let config: Config = config::Config::builder()
    .add_source(config::File::with_name("config"))
    .add_source(config::Environment::with_prefix("APP"))
    .build()?
    .try_deserialize()?;
```

**TypeScript 推荐**：`zod` schema 验证 + 单例导出

```typescript
import { z } from "zod";
import "dotenv/config";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const config = schema.parse(process.env);
// 类型自动推导：config.PORT 是 number，不是 string
```

### 3. 常量模块（必备）

**目标**：消灭魔法数字和硬编码路径，所有「写死」的值集中到一处。

**基本要求**：

- **集中位置**：通常一个 `constants.ts` / `constants.rs` / `constants.py`
- **命名规范**：`SCREAMING_SNAKE_CASE`（Rust/TS 常量）/ 驼峰（特殊常量）
- **路径常量**：所有文件路径都用常量，不要字符串字面量
- **分类**：按用途或按模块分组（业务常量 / 系统常量 / 路径常量）
- **量纲编码**：用 newtype / branded type 编码单位（防秒/分钟/字节混用）

**反模式**：

- 散落的魔法数字（如 `if retry > 3`）→ 提取为常量并命名
- 硬编码路径（`/usr/local/app/data.json`）→ 用 `Path::new(DATA_DIR).join(...)`
- 单位混淆（`time: 3600`，不知道是秒还是分钟）→ 用 newtype 编码
- 常量散落各处（每个文件都有自己的局部常量）→ 集中到 constants 模块

**示例（Rust）**：

```rust
// constants.rs

// 路径
pub const DATA_DIR: &str = "data";
pub const CONFIG_FILE: &str = "config.toml";
pub const LOG_DIR: &str = "logs";

// 业务阈值
pub const MAX_RETRY: u32 = 3;
pub const DEFAULT_PORT: u16 = 8080;
pub const REQUEST_TIMEOUT_SECS: u64 = 30;

// 量纲编码（防混淆）
pub struct Seconds(pub u64);
pub struct Bytes(pub u64);
pub struct Millis(pub u64);
```

**示例（TypeScript）**：

```typescript
// constants.ts

// 路径
export const DATA_DIR = "data";
export const CONFIG_FILE = "config.toml";
export const LOG_DIR = "logs";

// 业务阈值
export const MAX_RETRY = 3;
export const DEFAULT_PORT = 8080;
export const REQUEST_TIMEOUT_SECS = 30;

// 量纲编码（branded type）
export type Seconds = number & { readonly __brand: "Seconds" };
export type Bytes = number & { readonly __brand: "Bytes" };

export const seconds = (n: number): Seconds => n as Seconds;
export const bytes = (n: number): Bytes => n as Bytes;
```

### 4. 项目目录结构 + utils 模块

**目标**：目录结构清晰、utils 模块可复用、所有路径一致。

**标准结构**：

```
project-root/
├── src/                  ← 业务代码
│   ├── main.*            ← 入口（main 启动 + 事件循环）
│   ├── routes/           ← 路由 / 端点（按接口契约分文件）
│   ├── services/         ← 业务逻辑
│   ├── models/           ← 数据结构
│   └── utils/            ← 工具模块（基础设施，独立可测）
│       ├── logger.*      ← 统一 logger
│       ├── config.*      ← 统一配置
│       ├── constants.*   ← 常量
│       └── ...           ← 其他通用工具
├── tests/                ← 集成测试 / E2E
├── docs/                 ← 文档（接口契约 / 调用链 / 需求文档）
├── config/               ← 配置文件
│   └── config.toml
├── data/                 ← 运行时数据（gitignore）
├── bin/                  ← 可执行脚本
├── examples/             ← 示例
├── README.md
├── LICENSE
└── .gitignore
```

**utils 模块规则**：

- **无业务逻辑**：utils 只放通用的、横切的功能（logger / config / constants）
- **无副作用**：utils 函数应该是纯函数或 init/destroy 对（生命周期清晰）
- **可单独测试**：每个 utils 模块都有对应测试
- **可单独替换**：依赖注入到业务代码，方便换实现（如换 log 后端）

**反模式**：

- utils 里塞业务逻辑 → 应该放到 service / 模块
- 业务代码直接 `import logger` 而不是注入 → 测试困难
- 没有 utils 模块散落各处 → 不一致、难维护
- 运行时数据写在 src/ 旁边 → 应该是 data/（gitignore）
- 文件散落在各处（/tmp、CWD、系统目录）→ 统一存储根目录（见 [file-management.md](../file-management.md)）
- 单文件超过 1000 行 → 按职责拆文件

**utils 模块依赖图**：

```
constants  ← 不依赖任何东西
   ↑
logger     ← 可能读 config
config     ← 不依赖 logger / constants
   ↓
business code
```

**依赖规则**：

- `constants` 是叶子，不依赖任何其他 utils
- `config` 不依赖 logger / constants（避免循环）
- `logger` 可以读 config（用配置控制日志行为）
- 业务代码依赖所有 utils

## 跟其他章节的关系

| 本章 | 对应 |
| --- | --- |
| [file-management.md](../file-management.md) | **文件管理的运行期纪律（统一根目录 / 分类型目录 / 读写模块 / 持久化归属）——本章的目录结构是它的「建设期」** |
| [initiation.md](initiation.md) 第 3 步 | 接口契约（决定 utils 模块需要支持什么） |
| [interface-contract.md](../interface-contract.md) | 接口契约决定了 logger 输出什么 / config 读什么 |
| [workflow.md 第 2.4 步](../workflow.md) | 空间复杂度优化（utils 是典型的跨切面空间）|
| [timing.md 第 1 条](../../theory/timing.md) | 依赖前向包含（logger / config / constants 必须在业务代码前就绪）|
| [composition.md](../../theory/composition.md) | 域的递归（utils 是横切子域，跨业务模块）|
| rust-style 进程层 R1 / ts-style 规则 7 | 基础设施集中（同样的理念在不同语言的具体实现）|

## 跟语言 style 的关系

- **Rust 实现**：[rust-style 进程层 R1](../../../../rust-style/SKILL.md) 基础设施集中 + R2 生命周期移交
- **TypeScript 实现**：[ts-style 规则 7](../../../../ts-style/SKILL.md) 避免模块顶层可变状态 + 规则 8 受控的全局状态

utils 模块的具体实现交给语言 style 决定；本章节只规定"要建什么"和"为什么建"。

## 自检

### 1. Logger

- [ ] 全部代码用统一的 logger，不用 println / console.log？
- [ ] 至少支持 debug / info / warn / error 四级？
- [ ] 输出到 console 和 file 两个目标？
- [ ] 日志包含 timestamp + level + module + message？
- [ ] 多线程 / async 上下文能用？
- [ ] 长进程有日志轮转？

### 2. Config

- [ ] 单一配置文件入口（`config.toml` / `config.json`）？
- [ ] 启动时校验必填项，缺失立刻 fail？
- [ ] 配置访问类型安全（不是 stringly-typed）？
- [ ] 全部数据读写走统一的 `data/` 目录？
- [ ] 密钥不进 git（.env + .gitignore）？

### 3. Constants

- [ ] 业务代码里没有魔法数字？
- [ ] 文件路径都走常量，不用字符串字面量？
- [ ] 单位用 newtype / branded type 编码（防秒/分钟/字节混用）？
- [ ] 常量集中在一个文件（或按模块分组）？
- [ ] 常量按用途分类（业务 / 系统 / 路径）？

### 4. 目录结构

- [ ] `src/` 与 `tests/` 与 `docs/` 与 `config/` 分离？
- [ ] `utils/` 目录存在，含 logger / config / constants？
- [ ] runtime data 放 `data/`，在 `.gitignore`？
- [ ] utils 模块无业务逻辑？
- [ ] utils 可单独测试 + 单独替换？
- [ ] 依赖方向正确（constants ← logger ← business）？

任何一项不满足，去查 [典型反模式](../anti-patterns.md) 或对应语言 style。

## 跟编码阶段的关系

完成本章 4 项后，进入正式编码阶段：

- **Rust 实现** → 进入 [rust-style 进程层](../../../../rust-style/SKILL.md)
- **TypeScript 实现** → 进入 [ts-style 规则 7-8](../../../../ts-style/SKILL.md)
- **业务代码** → 按 [interface-contract.md](../interface-contract.md) 的接口契约实现

## 一句话

> **正式写代码前，先建基础设施：logger / config / constants / 目录结构 + utils。这 4 项是项目的「骨骼」，缺一不可。**