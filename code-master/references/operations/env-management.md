# 环境变量管理（Environment Variable Management）

> **env 模块最早初始化——比 logger、配置文件、文件存储根目录都早——一次性读取程序需要的所有环境变量，校验后形成一个类型化的 Config 对象。普通代码不许自己读 `process.env`。**

## 一句话

> **env 模块 = 唯一的环境变量读取入口；启动时最先就绪；输出类型化 + 已校验的 Config 对象；分层优先级 = 环境变量 > 配置文件 > 默认值。**

## 何时使用

- 项目初始化——把 env 模块列入 utils 第一批
- 写任何业务模块——检查「我是不是在读 `process.env`？应该读 Config 对象」
- 引入新配置项——决定它在哪一层（env var / config file / default），加入 env 模块
- Code review / CI——拦截散落的 `process.env.X` / `std::env::var(...)`

## 1. 启动时序：env 模块最先就绪

**env 模块是应用启动的第一个基础设施**——比 logger、配置文件、文件存储根目录都早：

```
进程启动
   ↓
[env 模块] init()         ← 第一个跑：读 env + 校验 + 形成 Config 对象
   ↓
[logger 模块] init()      ← 用 env.LOG_LEVEL 决定日志级别
   ↓
[config 模块] init()      ← 用 env.CONFIG_PATH 找配置文件位置
   ↓
[文件存储] init()         ← 用 env.STORAGE_ROOT 决定数据根目录
   ↓
[其他业务模块] ...
```

**为什么必须最早**：

- logger 需要 `env.LOG_LEVEL`——logger 要先知道日志级别
- 配置文件的位置通常来自 `env.CONFIG_PATH`（生产部署不可能跟开发期一个路径）
- 文件存储根目录通常来自 `env.STORAGE_ROOT`（见 [file-management.md](file-management.md) §1）
- 如果 env 模块不是第一个，依赖它的模块要么延迟到 env 就绪之后，要么读不到 env 值

**与 early-dev 4 项基础设施的关系**：env 模块是**最顶层**——logger / config / constants / 目录结构都在 env 就绪之后才能开工。env 模块本身**不依赖**这 4 项中的任何一个。

## 2. 单一读取入口：只有 env 模块读 env

**铁律**：整个程序只有 env 模块调用 `process.env` / `std::env::var(...)`。业务代码、其他 utils 都不能直接读。

```typescript
// ❌ 业务代码散落 process.env
async function fetchUser(id: string) {
  if (process.env.NODE_ENV === "production") {            // 直接读
    logger.info("fetching user in prod");
  }
  const url = process.env.API_URL ?? "http://localhost";   // 直接读
  return fetch(`${url}/users/${id}`);
}
```

```typescript
// ✅ 全部走配置对象
async function fetchUser(id: string, config: AppConfig) {
  if (config.env === "production") {                       // 通过接口读
    logger.info("fetching user in prod");
  }
  return fetch(`${config.apiUrl}/users/${id}`);
}
```

**为什么必须单点**：

| 风险 | 单点读 env 的好处 |
| --- | --- |
| 多个模块各自读 env——同一项配置不同模块可能解析出不同的值（类型 / 默认值不一致） | 一次解析、一次类型化、一次校验，全程序一致 |
| 测试要 mock 几十处 `process.env.X` | 只需要把 env 模块换成 mock Config 对象即可 |
| 改一个环境变量名要翻遍全代码 | 集中在 env 模块里改一次 |
| 业务代码可读性差——`process.env.SOME_LONG_VAR_NAME` | `config.someLongVarName` 自带类型 |

**与 [function-purity.md 隐参铁律](../theory/function-purity.md) 同构**：环境变量是「隐式参数」的一种（依赖外部作用域中的变量）——env 模块把这种隐式依赖显式化为参数（Config 对象）。

## 3. 类型化 + 校验：fail-fast，拿到的是类型化对象不是字符串

**原始 `process.env` 是个 `Record<string, string | undefined>`——全是字符串，全可能缺失。** env 模块的工作就是把它变成一个**类型完整、字段齐全、无法绕过校验**的对象：

```typescript
import { z } from "zod";
import "dotenv/config";                                  // 本地开发从 .env 加载

// 1. 用 schema 声明「这个程序需要哪些环境变量、什么类型、可选还是必填」
const schema = z.object({
  // 必填
  APP_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(16),
  PORT: z.coerce.number().int().positive(),

  // 可选（有默认值）
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STORAGE_ROOT: z.string().default(""),                   // 默认由常量模块按 OS 决定
  FEATURE_X: z.coerce.boolean().default(false),
});

// 2. 校验 + 类型推导——缺失必填项立刻 crash，不会跑到运行时才崩
export const config = schema.parse(process.env);

//    ↑ 推导出的类型：config.PORT 是 number，不是 string；config.APP_ENV 是字面量联合类型
```

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub app_env: AppEnv,                 // 强类型枚举，不是 String
    pub database_url: String,
    pub api_key: String,
    pub port: u16,
    pub log_level: LogLevel,             // 强类型枚举
    #[serde(default = "default_storage_root")]
    pub storage_root: String,
    pub feature_x: bool,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        envy::from_env::<Self>().map_err(ConfigError::from)
        // envy / figment / dotenvy 等库：读 env + 反序列化 + 校验
        // 缺失必填项 → 返回 Err，启动失败
    }
}
```

**要点**：

- **schema / derive 是契约**——环境变量的名字、类型、可选性都在一处声明
- **fail-fast**——启动时校验失败，立刻 crash + 清晰错误信息（不要等到运行时遇到 `undefined.x` 才崩）
- **类型自动推导**——TS 用 `z.infer`、Rust 用 `serde` derive，业务代码拿到的是 `number` / `boolean` / 字面量联合，不是字符串
- **可选变量显式 default**——默认值写进 schema，不在业务代码里 `??` 兜底

## 4. 分层优先级：环境变量 > 配置文件 > 默认值

一个配置项的值有三个来源——优先级从高到低：

```
环境变量（部署时覆盖）  ──>  最高优先级
   │
   │  没有 env var？
   ↓
配置文件（功能开关、结构化配置）  ──>  中优先级
   │
   │  配置里也没写？
   ↓
默认值（写在 schema 里，代码默认值）  ──>  兜底
```

**分工**：

| 层 | 适合放什么 | 为什么 |
| --- | --- | --- |
| **环境变量** | 部署相关的值（`APP_ENV`、`DATABASE_URL`、`API_KEY`、`PORT`、`STORAGE_ROOT`）、密钥 | 不同环境（dev / staging / prod）不同；密钥不进 git |
| **配置文件**（TOML / YAML / JSON） | 功能开关、结构化配置（数据库连接池大小、超时阈值、日志格式） | 跨环境共享 / 经常调整 / 多字段组合 |
| **默认值**（schema 内置） | 兜底——绝大多数情况取默认就好 | 启动阻力最小；显式列在 schema 里 |

**典型组合**：

```typescript
// APP_ENV 只在 env（不同部署肯定不同）
// DATABASE_URL 只在 env（密钥 + 部署相关）
// LOG_LEVEL 在 env 或 config 都行（运维通常偏好 env）
// POOL_SIZE / TIMEOUT_MS 在 config（结构化、需要文档化）
```

**反模式**：

- 同一项配置同时支持 env + config——优先级错乱，调试噩梦
- 配置项只在 config 里、但生产部署想覆盖——必须重启改文件 → 改成支持 env 覆盖
- 默认值散落在业务代码里 `?? "..."`——默认值应集中在 schema

## 5. 普通代码的纪律：禁止散落 process.env

**业务模块、其他 utils、handler 都不允许调用 `process.env` / `std::env::var`。** 一律通过 Config 对象访问。

**如何落实**：

1. **初始化时一次性把 Config 注入**——main 读 env、形成 config、向下传给各模块的 init
2. **模块签名显式声明 config 依赖**——参考 [function-purity.md 显式依赖纪律](../theory/function-purity.md)
3. **Lint / CI 检查**——加一条 ESLint rule / clippy 检查，禁止业务代码 import `process` 后只读 `process.env`（或在 env 模块外的文件禁用 `env::var`）

```rust
// ❌ 业务模块自己读 env
fn handle_user(id: UserId) {
    if std::env::var("FEATURE_X").unwrap_or_default() == "true" {  // 散落读 env
        send_special_notification();
    }
}

// ✅ Config 通过参数注入
fn handle_user(id: UserId, config: &AppConfig) {
    if config.feature_x {
        send_special_notification();
    }
}
```

**与 4 节点的关系**（见 [scope.md](../theory/scope.md)）：Config 对象由 env 模块拥有，生命周期 = 多例域 4 节点（init 时从 env 加载、get 时按接口出借、set 不可变——env 变量在进程内不修改、drop 时随进程消亡）。Config 是单例域（启动一次、进程内常驻），但**它持有的不是可变状态**，而是不可变的启动快照。

## 6. 密钥与 .env 文件

**密钥（API_KEY、数据库密码）只能放在环境变量里，不能放在配置文件里。**

- 配置文件会进 git（即使加了 `.gitignore` 也可能漏）——密钥一旦入库就泄露
- 部署系统（K8s / Docker / CI）原生支持 env var——不需要改代码就能注入

**.env 文件的使用纪律**：

| 纪律 | 理由 |
| --- | --- |
| `.env` 必须加 `.gitignore` | 本地开发便利，但绝不入库 |
| `.env.example` 可以入库 | 只有 key、没有 value——给新成员参考 |
| 应用启动时**自动**从 `.env` 加载（`dotenv` / `dotenvy`） | 但生产部署**不依赖 `.env`**——只依赖真实 env var |
| 不同环境用不同文件（`.env.dev` / `.env.prod`） | 用 `APP_ENV` 决定加载哪一个 |

```typescript
import "dotenv/config";            // 自动加载 .env
import { z } from "zod";

// .env 在 dev 加载；prod 部署通过 K8s / Docker 注入真实 env，dotenv 在没有 .env 时是 no-op
const config = z.object({
  DATABASE_URL: z.string().url(),
  // ...
}).parse(process.env);
```

## 反模式

| 反模式 | 表现 | 纠正 |
| --- | --- | --- |
| **env 散落读** | 多个模块各自 `process.env.X` | 全部走 env 模块的 Config 对象 |
| **env 不是第一个就绪** | logger / config / file init 时 env 还没好 | 把 env 模块提到第一个 init |
| **全是字符串** | 业务代码拿到 `process.env.PORT` 是 `"8080"`，忘了 `parseInt` | schema 类型化（zod / serde），数字 / 布尔 / 枚举不要让业务代码再解析 |
| **缺失必填项不报错** | 运行时遇到 `undefined.x` 才崩 | schema fail-fast，启动时校验 |
| **密钥进 config 文件** | `database_password = "xxx"` 写在 toml 里 | 密钥只在 env |
| **默认值在业务代码** | `config.timeout ?? 5000` 散落各处 | 默认值集中写在 schema |
| **同一项同时支持 env + config** | 优先级错乱 | 一项一层；三层按 env > config > default 串行覆盖 |
| **本地开发 / 生产共享同一 .env** | 误用生产配置开发 | `.env` 不入库；`.env.example` 入库 |
| **配置变更需要改代码** | 改端口要改源码 → 重启 | 走 env，部署时调整 |

## 自检

### 启动时序

- [ ] env 模块在 logger / config / 文件存储之前初始化？
- [ ] env 模块不依赖 logger / config / constants 中的任何一个？

### 单一读取入口

- [ ] 全程序只有 env 模块调用 `process.env` / `std::env::var`？
- [ ] 业务模块、其他 utils 通过 Config 对象访问配置？

### 类型化与校验

- [ ] 每个配置项都有 schema（类型 / 必填 / 默认值）？
- [ ] 启动时校验失败立刻 crash（fail-fast）？
- [ ] 业务代码拿到的是类型化对象（number / boolean / enum），不是字符串？

### 分层优先级

- [ ] 环境变量 / 配置文件 / 默认值三层分工明确？
- [ ] 密钥只放在 env（不进 config）？
- [ ] 同一项不会同时支持 env + config？

### 注入与纪律

- [ ] Config 由 main 注入，不让模块自己拿？
- [ ] 模块签名显式声明 config 依赖？
- [ ] CI / Lint 能拦住「env 模块外调用 process.env」？

任何一项不满足，去查 [典型反模式](anti-patterns.md) 或对应语言 style。

## 跟其他章节的关系

| 章节 | 关系 |
| --- | --- |
| [phases/early-dev.md](phases/early-dev.md) §2 统一配置 | env 模块是「配置」的一部分，但**更早于** logger / config / constants；env 模块就绪后才轮到那 4 项 |
| [file-management.md](file-management.md) §1 统一存储根目录 | 存储根目录通常由 `env.STORAGE_ROOT` 决定；env 模块在 file-storage init 之前就绪 |
| [function-purity.md](../theory/function-purity.md) | 单一读取入口 = 隐参铁律的纠偏（环境变量是「隐式参数」，env 模块把它显式化为参数） |
| [scope.md](../theory/scope.md) | Config 对象由 env 模块拥有；生命周期 = 单例域（不可变快照）；持有者即域本身 |
| [interface-contract.md](interface-contract.md) | env 模块本身就是一个**接口契约**——输入 = 进程环境，输出 = 类型化 AppConfig，调用方只看到后者 |
| [engineering.md](engineering.md) | `.env` / `.env.example` / `.gitignore` 是工程化在 env 管理上的延伸 |

## 一句话

> **env 模块是启动时第一个就绪的模块；它是唯一的环境变量读取入口；输出是类型化 + 已校验的 Config 对象；业务代码一律通过 Config 访问；密钥只放 env；环境变量 > 配置文件 > 默认值。**
