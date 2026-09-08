# 文件管理（File Management）

> **一个应用一个统一存储根目录，所有文件路径从根目录派生；所有文件系统 IO 收敛到一个读写模块；滞留在内存中且需持久化的数据，归一个专门的持久化状态模块所有。** 本章覆盖除数据库之外的所有文件管理——日志、配置、运行时数据、缓存、临时文件。

## 一句话

> **统一根目录（一个应用一个目录）+ 路径常量化（禁止硬编码）+ 分类型目录（config / data / logs / cache / tmp 各守其规）+ 单一读写模块（唯一的 IO 边界）+ 持久数据单一 owner。**

## 何时使用

- 立项时期——决定存储根目录及其位置（客户端 vs 服务器）
- 早期开发——建文件读写模块和分类型目录
- 任何写文件系统的代码——检查「是否走读写模块？路径是否从根目录派生？」
- Code review——硬编码路径、散落的 `fs.readFile`、多个模块各自持久化同一份数据

## 1. 统一存储根目录

**一个应用使用一个统一的文件存储目录**——应用的所有自有文件都放在这个根目录下，不往各处写。

```
<root>/
├── config/     配置文件
├── data/       运行时数据文件
├── logs/       日志文件
├── cache/      缓存（可删除）
└── tmp/        临时文件（可删除、作用域内清理）
```

**三条原则**：

- **所有路径 = 根目录 + 相对路径**——业务代码不直接拼接绝对路径
- **根目录在启动时一次性决定**（配置 > 环境变量 > 默认值），向下注入——不让各模块各自解析根目录
- **根目录可注入**——测试指向临时目录；应用可以搬家 / 重装

### 按应用类型选择根目录位置

| 应用类型 | 推荐根目录 | 理由 |
| --- | --- | --- |
| **客户端应用（CLI / GUI）** | **当前用户的家目录下**：`~/.myapp/` | 用户级数据，多用户互不干扰，无需 root 权限；Linux 上可按 XDG 规范拆分：`~/.config/myapp`（配置）+ `~/.local/share/myapp`（数据） |
| **服务器 / daemon** | 部署目录或 `/var/lib/myapp`（Linux） | 与服务共置，便于备份迁移；由配置文件显式指定 |
| **库 / 模块** | **不写文件**——由调用方传入根目录 | 库无权自选存储位置；必须写时接收调用方提供的 root |
| **开发 / 调试** | 项目根下的相对目录 `./data/`（gitignore） | 本地调试方便 |

**反模式**：

- 用当前工作目录（CWD）当根目录——CWD 随调用场景变，同一个应用在不同目录下运行会写到不同地方
- 客户端应用写系统目录（`/usr`、`/etc`）——无权限或破坏系统
- 写死 `/tmp/app/...`——多应用互踩、重启即丢

## 2. 文件路径硬编码的问题

**症状**：

```typescript
// ❌ 硬编码路径：无法搬家、无法测试、改一处要翻遍全代码
const raw = fs.readFileSync('/usr/local/app/data.json', 'utf-8');
fs.appendFileSync('/var/log/app/error.log', msg);
if (fs.existsSync('C:\\ProgramData\\app\\cache')) { /* ... */ }
```

**危害**：

- 应用无法移动 / 重装（路径写死在某台机器上）
- 测试无法隔离（写不到临时目录）
- 同一个路径散落在 N 处——改一处漏 N-1 处
- 客户端应用的「用户家目录」因用户而异，硬编码必然失效

**纠正三步**：

1. **集中到常量模块**（见 [phases/early-dev.md 常量模块](phases/early-dev.md)）——所有路径进常量，代码里不出现路径字符串字面量
2. **全部从根目录派生**——启动时拼出，各模块只引用常量
3. **根目录可用配置 / 环境变量覆盖**——`APP_ROOT` 环境变量或配置文件 `root` 字段

```rust
// ✅ constants.rs——路径从根目录派生，不写字面量
pub const CONFIG_DIR: &str = "config";
pub const DATA_DIR: &str = "data";
pub const LOG_DIR: &str = "logs";
pub const CACHE_DIR: &str = "cache";
pub const TMP_DIR: &str = "tmp";

/// 启动时决定根目录：环境变量 > 配置 > 默认值（客户端 = 家目录）
pub fn storage_root() -> PathBuf {
    std::env::var("APP_ROOT")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(".myapp"))
}

pub fn data_file(name: &str) -> PathBuf {
    storage_root().join(DATA_DIR).join(name)
}
```

```typescript
// ✅ constants.ts——客户端应用：根目录在当前用户家目录下
import os from "node:os";
import path from "node:path";

// 根目录可注入（环境变量），默认 = 当前用户家目录
export const STORAGE_ROOT =
  process.env.APP_ROOT ?? path.join(os.homedir(), ".myapp");

export const CONFIG_DIR = path.join(STORAGE_ROOT, "config");
export const DATA_DIR = path.join(STORAGE_ROOT, "data");
export const LOG_DIR = path.join(STORAGE_ROOT, "logs");
export const CACHE_DIR = path.join(STORAGE_ROOT, "cache");
export const TMP_DIR = path.join(STORAGE_ROOT, "tmp");
```

## 3. 分类型文件管理规范

| 类型 | 目录 | 生命周期 | 读写方式 | git | 删除语义 |
| --- | --- | --- | --- | --- | --- |
| **配置文件** | `config/` | 启动时读取，之后只读 | 启动读取 + 校验（fail-fast）；运行中不改 | 默认模板入库（`config/config.toml`），运行副本不入库 | 应用不删；用户管理 |
| **日志文件** | `logs/` | 运行期持续追加 | **append-only，应用永不回读** | gitignore | 轮转（按大小 / 时间），旧的可删 |
| **运行时数据文件** | `data/` | 首次使用时创建，退出时关闭 | 读写；格式由应用拥有 | gitignore | 只有应用自己可删；格式变更需迁移 |
| **缓存文件** | `cache/` | 可丢弃 | 读写 | gitignore | **随时可删**——应用必须能重建 |
| **临时文件** | `tmp/` | 作用域内创建 → 作用域结束删除 | 创建 / 使用 / 删除 | gitignore | 不得泄漏；下次启动时先清理 |

**关键纪律**：

- **日志只进不出**——日志是输出不是输入；应用不解析自己的日志当数据源（确有需要 → 升级为数据文件）
- **缓存可丢弃**——「删掉 `cache/` 后应用必须能正常工作」是缓存的验收标准
- **临时文件不泄漏**——每次创建必须配对一次清理（[scope.md](../theory/scope.md) 的 4 节点）；启动时先清扫遗留的 `tmp/`
- **数据文件格式归应用所有**——格式变更写迁移逻辑，记 ADR（见 [constraint-markers.md](constraint-markers.md)）

## 4. 文件读写模块：唯一的 IO 边界

> **业务代码不直接碰文件系统。** 所有 `read / write / list / delete / mkdir` 收敛到一个读写模块——文件系统只是一种外部状态，纪律与 [function-purity.md 的 IO 四条铁律](../theory/function-purity.md)（Connection 封装 / failable / 内部状态 / 单一 owner）完全同构。

**六条要求**：

1. **单一边界**——业务代码不直接调 `fs.*` / `std::fs` / `File::open`，一律走读写模块
2. **路径封装**——业务传「相对路径 / key」（`data/users.json`），根目录只在模块内部知道
3. **failable**——所有操作返回 `Result` / `AsyncResult`，失败被显式表达（IO 失败是必然的）
4. **原子写**——数据文件走「写临时文件 + 原子 rename」，崩溃不会留下半截文件
5. **目录自举**——模块在 `init` 时确保各类型目录存在（幂等 `mkdir -p`）
6. **单一 owner**——读写模块是持有文件系统句柄的唯一组件，防止句柄满天飞

**参考接口（伪代码）**：

```typescript
interface FileStore {
  init(): Result<void, FsError>                                  // 确保各目录存在
  read(rel: string): Result<Uint8Array, FsError>                // 读（相对路径）
  write(rel: string, bytes: Uint8Array): Result<void, FsError>  // 原子写（temp + rename）
  list(dir: string): Result<string[], FsError>
  delete(rel: string): Result<void, FsError>
  exists(rel: string): Result<boolean, FsError>
  destroy(): Result<void, FsError>                              // 清理临时文件
}
```

```rust
// Rust：模块只暴露语义方法，不暴露裸 File 句柄
impl FileStore {
    fn init(&self) -> Result<(), FsError>;          // 确保各目录存在
    fn read(&self, rel: &str) -> Result<Vec<u8>, FsError>;
    fn write(&self, rel: &str, bytes: &[u8]) -> Result<(), FsError>; // temp + rename
    fn list(&self, dir: &str) -> Result<Vec<String>, FsError>;
    fn remove(&self, rel: &str) -> Result<(), FsError>;
}
```

**反模式**：

- 业务代码直接调 `fs.readFile` → IO 散落、失败语义不统一、测试无法 mock
- 各模块自己开文件 → 多个组件持有同一文件 → 竞态 + 状态不一致
- 数据文件非原子写 → 进程在写一半时崩溃 → 半截文件 → 下次启动数据损坏
- 用依赖 CWD 的相对路径 → 同一调用在不同工作目录下行为不同

## 5. 内存滞留数据的归属：持久化状态模块

> **数据滞留在内存中且需要持久化时，它的所有权归一个专门的持久化状态管理模块**——统一加载、对外出借、显式持久化。

**场景**：应用有驻留内存的状态（会话表、计数器、索引、队列快照……）需要落盘，且多个模块要读它。

**错误做法**——谁用谁缓存、谁改谁存盘：

```
模块 A：启动读 users.json → 内存缓存 → 自己改了就自己存
模块 B：启动读 users.json → 内存缓存 → 自己改了就自己存
   → 多 owner：A、B 内存副本不一致，互相覆盖，数据丢失
```

**正确做法**——单一持久化状态模块拥有数据（4 节点）：

```
持久化状态模块（内存中数据的唯一 owner）
  init:   从磁盘读入 → 加载进内存（唯一的加载点）
  get:    其他模块通过接口读取（借用，不复制所有权）
  set:    其他模块通过接口请求修改 → 模块更新内存
          → 显式持久化（原子写盘）
  drop:   程序退出前 save + 卸载
```

**五条纪律**：

1. **只加载一次**——数据只在持久化模块的 `init` 时从磁盘加载；其他模块不自己读文件
2. **所有权唯一**——内存副本归持久化模块所有；其他模块拿的是借用（引用 / 只读视图）
3. **显式持久化**——变更时显式写盘（或按批次），不做「随时落盘」
4. **其他内存副本是派生缓存**——其他模块若有内存副本，必须是可丢弃的：丢了能从持久化模块重新拿到，不是数据源
5. **与 [function-purity.md 的单一 owner 铁律](../theory/function-purity.md) 一致**——同一份外部状态只有一个 owner

**与 [scope.md 4 节点](../theory/scope.md) 的关系**：持久化状态模块的生命周期就是多例域的 4 节点（init / get / set / drop）——状态住在模块中，owner 就是模块本身。

## 反模式

| 反模式 | 表现 | 纠正 |
| --- | --- | --- |
| **文件写到各处** | 应用往 `/tmp`、CWD、`/usr/...` 到处写 | 统一存储根目录 + 分类型子目录 |
| **路径硬编码** | 代码里字符串字面量（`"/usr/local/app/x.json"`） | 常量模块 + 从根目录派生 |
| **根目录 = CWD** | 每次运行数据写到不同地方 | 显式指定根目录（客户端 = 用户家目录） |
| **直接 fs 调用** | 业务代码里 `fs.readFile` 满天飞 | 收敛到文件读写模块 |
| **多持久化 owner** | 多个模块各自 load / save 同一文件 | 单一持久化状态模块 |
| **非原子写** | 数据文件写一半 | 临时文件 + rename |
| **缓存当数据** | 删掉 `cache/` 应用就坏 | 缓存必须可丢弃——可重建 |
| **临时文件泄漏** | `tmp/` 越积越大 | 创建配对删除 + 启动时清理 |
| **日志当数据源** | 应用解析自己的日志 | 升级为数据文件，或不要 |

## 自检

### 根目录与路径

- [ ] 应用有唯一的存储根目录（客户端：当前用户家目录；服务器：部署 / 配置指定）？
- [ ] 根目录在启动时决定、向下注入，且可被配置 / 环境变量覆盖（测试指向临时目录）？
- [ ] 代码里没有硬编码的绝对路径？所有路径从根目录派生？
- [ ] 没有使用 CWD 当根目录？

### 分类型目录

- [ ] config / data / logs / cache / tmp 各自有独立子目录？
- [ ] 日志 append-only、应用不回读？
- [ ] 缓存可丢弃（删掉后应用照常工作）？
- [ ] 临时文件作用域内清理 + 启动时清扫？
- [ ] gitignore 覆盖运行时文件（data / logs / cache / tmp）？

### 读写模块

- [ ] 所有文件系统 IO 都经过单一读写模块？
- [ ] 模块只接收相对路径（根目录被封装）？
- [ ] 所有操作 failable（Result / AsyncResult）？
- [ ] 数据文件写入是原子的（temp + rename）？

### 持久化归属

- [ ] 内存滞留且需持久化的数据，有唯一的持久化状态模块做 owner？
- [ ] 只在 `init` 时加载一次，其他模块只借用？
- [ ] 持久化是显式的（set → persist），不是随时落盘？
- [ ] 其他内存副本都是可丢弃的派生缓存？

任何一项不满足，去查 [典型反模式](anti-patterns.md) 或对应语言 style。

## 跟其他章节的关系

| 章节 | 关系 |
| --- | --- |
| [phases/early-dev.md](phases/early-dev.md) | early-dev 的 4 项基础设施（logger / config / constants / 目录结构）是本章的「建设期」；本章是「运行期纪律」 |
| [function-purity.md](../theory/function-purity.md) | 文件读写模块 = IO 四条铁律在文件系统上的落地（Connection 封装 / failable / 内部状态 / 单一 owner） |
| [scope.md](../theory/scope.md) | 持久化状态模块 = 多例域 4 节点（init / get / set / drop）的实例；owner = 模块本身 |
| [constraint-markers.md](constraint-markers.md) | 数据文件格式变更 = 重大决策 → 记 ADR |
| [engineering.md](engineering.md) | gitignore / 日志轮转 / 备份策略是本章的工程化延伸 |

## 一句话

> **一个根目录（统一存储、客户端进用户家目录），不硬编码（路径进常量、全部从根派生），分类型目录（config / data / logs / cache / tmp 各守其规），一个读写模块（唯一 IO 边界、failable、原子写），一个持久化 owner（内存滞留数据归单一模块、加载一次、显式持久化）。**
