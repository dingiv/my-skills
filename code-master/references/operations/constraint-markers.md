# 约束标记显化（Constraint Marker Visibility）

> **"约束驱动扩散"在工程实践中的具体落地——把约束显式地写在代码和文档里，让约束可见、可追溯、可检视。**

没有约束标记 = 约束在脑子里 / 散落在代码里 → 没法扩散 / 没法 review / 没法演进。

## 一句话

> **4 类约束标记：全局架构文档（`docs/arch/`）→ 模块设计说明（`<module>/arch.md`）→ 文件头注释 → 行间 `// CMA:`（Code Master Annotation）。** 颗粒度从粗到细，覆盖从项目级到代码行级。

## 何时使用

- 项目创建时——初始化 `docs/arch/` 目录
- 每个新模块创建时——加 `arch.md` 和文件头注释
- 任何代码改动前——查阅对应模块的 `arch.md` 和文件头
- Code review 时——用 `// CMA:` 标记违规
- 修复违规时——用 git commit 引用约束标记（如 `fix: resolve CMA in logger.ts`）

## 4 类约束标记

### 1. 全局架构文档（`docs/arch/`）

**位置**：项目根目录的 `docs/arch/` 子目录。

**内容**：

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `REQUIREMENTS.md` | 需求文档 | [phases/initiation.md](phases/initiation.md) 第 2 步 |
| `interfaces.md` | 端到端接口列表 | [phases/initiation.md](phases/initiation.md) 第 3 步 |
| `calltrees/` | 端到端调用链图 | [phases/initiation.md](phases/initiation.md) 第 4 步 |
| `implementation.md` | 实施方案（哪些模块、什么顺序、什么边界） | 实施时持续更新 |
| `decisions/` (ADR) | 架构决策记录（"为什么这么选") | 重大决策时增加 |
| `phases.md` | 当前项目处于哪个阶段 | [modes.md](modes.md) 三种模式 |

**目录结构示例**：

```
project-root/
└── docs/
    └── arch/
        ├── REQUIREMENTS.md
        ├── interfaces.md
        ├── calltrees/
        │   ├── handle-new-user.md
        │   └── process-payment.md
        ├── implementation.md
        ├── decisions/
        │   ├── 001-why-postgres.md
        │   └── 002-why-stripe.md
        └── phases.md
```

**何时更新**：

- 立项时期——[phases/initiation.md](phases/initiation.md) 走完后，docs/arch/ 目录必须存在
- 重大架构变更——修改 docs/arch/ 对应章节
- 每完成一个里程碑——更新 implementation.md 进度
- 重大决策——新增一份 ADR

**反模式**：

- 文档只写一次然后不更新 → 跟代码脱节
- 文档放 src/ 旁边 → 跟代码混淆
- 文档没有 review 流程 → 写错无人发现

### 2. 模块设计说明（`<module>/arch.md`）

**位置**：每个模块目录下放一个 `arch.md`，记录该模块的设计。

**目录结构示例**（来自用户提供的样例）：

```
project-root/
├── package.json
├── src/
│   ├── arch.md              # src/ 整体设计
│   ├── components/
│   ├── views/
│   │   ├── arch.md          # views/ 模块设计
│   │   └── Layout.tsx
│   └── utils/
│       └── logger.ts
```

**内容**：

```markdown
# views 模块设计

## 职责
- 渲染顶层页面布局
- 接收路由 / 用户数据并展示

## 接口
- 输入：route params, user context
- 输出：React 组件树
- 不依赖：业务逻辑（业务在 components/）

## 关键约束
- 不要在 views/ 里写业务逻辑
- 任何 setState 必须有理由（受控状态）
- 路由参数变化时用 useEffect 监听

## 已知问题
- 当前 Layout.tsx 超过 300 行，需要拆分
```

**粒度**：

- 每个目录一个 `arch.md`（递归）
- 如果目录太大（10+ 文件），每个子目录也单独有
- 文件夹下只 1-2 个文件时，不必单独写（合并到上级）

**何时更新**：

- 模块创建时——初版
- 模块结构变化时——重写
- 任何"重大决策"——加 ADR 引用

**反模式**：

- `arch.md` 只列文件清单（没价值——`ls` 能看）
- 写得太详细（变成 README）——`arch.md` 是设计意图，不是实现细节
- 从不更新 → 设计意图跟实现脱节

### 3. 文件头注释（`code-master:title` 块）

**位置**：每个代码文件的头部。

**形式**：特殊多行注释块 + `code-master:title` 标记。

#### TypeScript 示例

```typescript
/**
 * code-master:title
 * ============================================
 * 用户列表组件
 *
 * 设计要点：
 * - 接收 `users` prop（不可变数组）
 * - 点击触发 `onUserClick(userId)` 回调
 * - 不持有内部状态（完全受控）
 *
 * 约束（违反需标 // CMA:）：
 * - 不能在 useEffect 里 setState（无状态组件）
 * - 必须配合 UserContext 使用获取当前用户
 * - 列表项 key 必须用 user.id，禁止用 index
 *
 * 相关：docs/arch/interfaces.md § 2.3
 * ============================================
 */

interface UserListProps {
  readonly users: ReadonlyArray<User>;
  readonly onUserClick: (userId: string) => void;
}

export function UserList({ users, onUserClick }: UserListProps) {
  // ...
}
```

#### Rust 示例

```rust
// code-master:title
// ============================================
// 用户仓储
//
// 设计要点：
// - 通过 DbConnection 访问数据库（依赖注入）
// - 所有方法返回 Result<T, RepoError>
// - 不在内部启动事务（事务由调用方管理）
//
// 约束（违反需标 // CMA:）：
// - 不能直接打开连接（必须通过 DbConnection::query）
// - 不能 panic（任何错误用 ? 传播）
// - 不持有可变状态
//
// 相关：docs/arch/interfaces.md § 3.1
// ============================================

pub struct UserRepo<'a> {
    db: &'a DbConnection,
}

impl<'a> UserRepo<'a> {
    pub async fn find_by_id(&self, id: UserId) -> Result<Option<User>, RepoError> { /* ... */ }
}
```

**结构**（推荐 5 段）：

1. **设计要点**——这个文件做什么、核心思路
2. **约束**——违反需要标 `// CMA:` 的规则
3. **接口/类型**——文件导出的主要内容（可省略——TS 有类型签名）
4. **相关**——指向 docs/arch/ 或其他 arch.md 的引用
5. **变更历史**（可选）——大改动时记一行

**何时使用**：

- 新建文件时——加头
- 重大重构时——更新头
- 文件职责改变时——重写头

**反模式**：

- 头注释 100+ 行 → 太多信息，分散到 arch.md
- 头注释跟代码脱节（不更新）→ 误导读者
- 头注释解释明显代码（`i++; // 加 1`）→ 删

### 4. 行间标记（`// CMA:` / `# CMA:`）

> **CMA** = **C**ode **M**aster **A**nnotation——code-master 架构标记。原来 `TODO: [code-master]` / `FIXME: [code-master]` / `HACK: [code-master]` 三种全部统一为 `// CMA:` 前缀（Python 用 `# CMA:`）。

**位置**：代码任意位置（行尾或行首）。

**形式**：

```typescript
// TypeScript / JavaScript
// CMA: 这里改参函数违反 clean-code，应该返回新值
// CMA: 状态机里缺少 idle 状态
// CMA: 临时方案，需要重构（issue #123）
```

```rust
// Rust
// CMA: 这里改参函数违反 clean-code，应该返回新值
// CMA: 状态机里缺少 idle 状态
// CMA: 临时方案，需要重构（issue #123）
```

```python
# Python
# CMA: 这里改参函数违反 clean-code，应该返回新值
# CMA: 状态机里缺少 idle 状态
```

**触发**：

- **Reviewer** 在 review 时发现违反 code-master 约束（clean code、SOLID、4 节点等）
- **开发者**自我发现但暂时无法修（依赖外部改动、deadline 等）
- **静态分析**（如 linter）自动生成（可选——高级用法）

**处理流程**：

```
发现违规
  → // CMA: 标记
  → 创建 issue（可选）
  → 开发者认领
  → 修改代码
  → 移除 // CMA:
  → commit message: fix: resolve CMA in <file>
```

**语法**：所有行间标记统一为 `// CMA:` 前缀（Python 用 `# CMA:`），原来 `TODO/FIXME/HACK: [code-master]` 都合并——严重度由所在层（arch.md / docs/arch/）描述，不再靠注释前缀区分。

| 写法 | 说明 |
| --- | --- |
| `// CMA: foo` | TypeScript / JavaScript / Rust（C 行注释） |
| `# CMA: foo` | Python（井号注释） |

**反模式**：

- 大量 `// CMA:` 标记长期遗留 → 成了"标记但不管"
- 普通 TODO 没改用 `// CMA:` 前缀 → 跟架构标记混了
- 标记后不关联 issue → 永远修不掉

## 4 类标记的协作

```
docs/arch/                        ← 项目级
   ├── 整体设计
   ├── 接口契约
   └── ADR

src/                              ← 目录级
└── arch.md                       ← 整个 src/ 的设计

src/components/                   ← 模块级
└── arch.md                       ← components/ 模块的设计

src/views/Layout.tsx              ← 文件级
   code-master:title 块           ← 这个文件的设计

src/utils/logger.ts:42            ← 代码行级
   // CMA:           ← 这一行/段的约束违规
```

**自上而下**：

- `docs/arch/` 描述"整个项目"的设计意图
- `<module>/arch.md` 描述"该模块"的设计意图
- 文件头注释描述"该文件"的设计意图
- 行间标记描述"该行/段"违反的约束

**自下而上**：

- 行间 `// CMA:` 累积到一定数量 → 提升到 `arch.md`（"已知问题"）
- `arch.md` 跟实际不符 → 提升到 `docs/arch/decisions/`
- `docs/arch/` 改动 → 触发各层 `arch.md` 同步更新

## 跟其他章节的关系

| 章节 | 关系 |
| --- | --- |
| [SKILL.md 核心方法论](../../SKILL.md#核心方法论约束驱动扩散) | "约束驱动扩散" = 显化后才能扩散；标记是显化的载体 |
| [phases/initiation.md](phases/initiation.md) | 第 2-4 步的产物 = `docs/arch/REQUIREMENTS.md` / `interfaces.md` / `calltrees/` |
| [phases/early-dev.md](phases/early-dev.md) | 项目骨架建好时建 `docs/arch/` 目录；建第一个模块的 `arch.md` |
| [interface-contract.md](interface-contract.md) | 接口契约的具体形式（与 `docs/arch/interfaces.md` 配合使用） |
| [engineering.md](engineering.md) | 工程化（CI / Git）可以 grep `// CMA:` 标记生成 review 检查项 |
| [function-purity.md](../theory/function-purity.md) | 行间标记常用于标记"违反纯函数 / 脏函数纪律"的代码 |
| [solid.md](../theory/solid.md) | 行间标记常用于标记"违反 SOLID / OCP"的代码 |

## 反模式

| 反模式 | 表现 | 纠正 |
| --- | --- | --- |
| **文档与代码脱节** | arch.md 描述跟实现不符 | CI 加检查：arch.md 必须跟模块结构匹配 |
| **arch.md 写太多** | arch.md 100+ 行变 README | arch.md 只写设计意图，细节放代码注释 |
| **arch.md 从不更新** | 立项时写一次后没人改 | 任何架构改动 = 改代码 + 改 arch.md（一次 PR）|
| **文件头注释过时** | 改代码没改头 | 改代码时同步检查头注释 |
| **TODO 不带 CMA 前缀** | 跟普通 TODO 混在一起 | 所有架构相关的 TODO 必须带 `// CMA:` |
| **CMA 长期遗留** | `// CMA:` 标记后没人修 | CMA 必须有 issue + deadline |
| **arch.md 只列文件清单** | `arch.md` 就是 `ls` 的结果 | arch.md 是设计意图，不是文件清单 |

## 自检

### 全局文档

- [ ] 项目根目录有 `docs/arch/` 目录？
- [ ] `docs/arch/REQUIREMENTS.md`、`interfaces.md`、`calltrees/` 都存在？
- [ ] 立项时期走完后，`docs/arch/` 内容是新的（不是立项模板残留）？

### 模块文档

- [ ] 每个有意义的目录（5+ 文件）都有 `arch.md`？
- [ ] `arch.md` 写的是"为什么这么设计"，不是"做了什么"？
- [ ] 重大改动时 `arch.md` 同步更新？

### 文件头注释

- [ ] 每个代码文件头部都有 `code-master:title` 块？
- [ ] 头注释包含"设计要点"和"约束"两段？
- [ ] 头注释跟代码同步更新（改代码 = 检查头）？

### 行间标记

- [ ] 发现的违规都用 `// CMA:` 标记？
- [ ] 每个 `// CMA:` 都关联了 issue？
- [ ] 长期遗留的标记数 ≤ N（具体阈值团队定）？

## 一句话

> **约束标记显化 = 让约束可见、可追溯、可检视。** 4 类标记（`docs/arch/` / `<module>/arch.md` / 文件头 `code-master:title` / 行间 `// CMA:`）覆盖从项目级到代码行级——没有标记，约束就只在脑子里，没法扩散。