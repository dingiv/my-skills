# 工程化（Engineering Practices）

> **项目能跑起来 vs 项目能跑得久——区别在工程化。** 工具 + 流程 + 规范，让多人协作、长期维护、持续演进成为可能。

## 一句话

> **工程化 = 工具（让机器帮忙） + 流程（让团队对齐） + 规范（让代码统一）。** 三者缺一不可。

## 何时使用

- 任何**团队项目**（不只是个人项目）
- 任何**长期维护**的项目（不只是写一次）
- 在 [phases/early-dev.md](phases/early-dev.md) 之后、贯穿整个项目生命周期

## 三大层面

```
工程化
├─ 工具 (Tools)        ← 让机器帮忙
│  ├─ 语言工具链
│  ├─ 包管理 + lockfile
│  ├─ 测试框架
│  └─ 编辑器配置
├─ 流程 (Process)      ← 让团队对齐
│  ├─ Git workflow
│  ├─ CI/CD
│  ├─ Code Review
│  └─ 发布管理
└─ 规范 (Standards)    ← 让代码统一
   ├─ 命名约定
   ├─ Commit message
   ├─ SemVer
   └─ Changelog
```

---

## 一、工具（Tools）

### 1.1 语言工具链

#### Rust 工具链

```bash
# 安装
rustup component add clippy rustfmt rust-analyzer

# 使用
cargo build              # 编译
cargo test               # 测试
cargo clippy             # lint
cargo fmt                # 格式化
cargo miri test          # 未定义行为检测
```

**关键工具**：

| 工具 | 用途 | 触发时机 |
| --- | --- | --- |
| `cargo build` / `cargo check` | 编译 / 类型检查 | 保存时（rust-analyzer 自动） |
| `cargo clippy` | lint（性能 / 风格 / 常见错误） | 提交前 + CI |
| `cargo fmt` | 格式化 | 提交前（git hook） |
| `cargo miri` | 未定义行为检测 | 改 unsafe 代码后 |
| `cargo bench`（criterion） | 基准测试 | 性能敏感代码 |

#### TypeScript 工具链

```bash
# 安装
npm i -D typescript eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin

# 使用
npx tsc --noEmit         # 类型检查（不产出）
npx tsc --watch          # 监视模式
npx eslint .             # lint
npx eslint . --fix       # 自动修
npx prettier --write .   # 格式化
```

**关键工具**：

| 工具 | 用途 | 触发时机 |
| --- | --- | --- |
| `tsc --noEmit` | 类型检查 | 保存时（编辑器） + CI |
| `eslint` | lint | 提交前 + CI |
| `prettier` | 格式化 | 提交前（git hook） |
| `vitest` / `jest` | 测试 | 保存时 + CI |
| `tsc --build` | 构建 | 发布前 |

### 1.2 包管理 + lockfile

**lockfile 必须提交**——保证团队和生产环境用相同版本。

| 语言 | 包管理器 | Lockfile |
| --- | --- | --- |
| Rust | cargo | `Cargo.lock`（**必须提交**） |
| TypeScript | npm | `package-lock.json` |
| TypeScript | pnpm | `pnpm-lock.yaml` |
| TypeScript | yarn | `yarn.lock` |

**反模式**：

- 提交 lockfile 后再 .gitignore → 团队版本分裂
- 手动改 lockfile → 用包管理器命令改
- 长期不更新 lockfile → 安全漏洞累积

### 1.3 测试框架

**测试金字塔**：

```
       ╱╲         E2E / 集成测试（少量，端到端验证）
      ╱  ╲
     ╱────╲       单元测试（大量，快速反馈）
    ╱      ╲
```

**Rust 测试**：

```rust
// 单元测试
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_basic() {
        assert_eq!(add(2, 3), 5);
    }
}

// 集成测试（tests/ 目录）
// tests/integration_test.rs
use my_crate::Client;

#[test]
fn test_real_call() {
    let client = Client::new();
    let result = client.do_thing();
    assert!(result.is_ok());
}

// 基准测试
use criterion::{criterion_group, criterion_main, Criterion};
```

**TypeScript 测试**：

```typescript
// vitest
import { describe, it, expect } from "vitest";
import { add } from "./math";

describe("add", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});

// 集成测试
import { server } from "./server";
import request from "supertest";

describe("POST /api/users", () => {
  it("creates a user", async () => {
    const res = await request(server).post("/api/users").send({ name: "x" });
    expect(res.status).toBe(201);
  });
});
```

### 1.4 编辑器配置

#### Rust：rust-analyzer

```json
// .vscode/settings.json
{
  "rust-analyzer.check.command": "clippy",
  "editor.formatOnSave": true,
  "[rust]": { "editor.defaultFormatter": "rust-lang.rust-analyzer" }
}
```

#### TypeScript：TypeScript Language Server

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "eslint.validate": ["typescript", "typescriptreact"]
}
```

#### 团队统一配置

**`.editorconfig`**（编辑器无关的统一格式基础）：

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.rs]
indent_size = 4
```

---

## 二、流程（Process）

### 2.1 Git Workflow

#### 分支策略

**Trunk-based（推荐中小团队）**：

```
main ─────●────────●────────●────── (受保护)
           ╲      ╱ ╲      ╱
            ╲    ╱   ╲    ╱
        feat/A    feat/B   (短命分支，PR 后合并)
```

- `main` 始终可发布
- 短命 feature 分支（< 几天）
- PR 合并后删除分支

**Gitflow（大型 / 多版本）**：

```
main      ─────●─────●─────────●───── (生产)
              ╱     ╱           ╱
release/v1.0  ╱     ╱           ╱
            ╱     ╱           ╱
develop  ──●───●───●───●───●── (开发集成)
            ╱   ╱       ╲   ╲
       feat/A feat/B    hotfix/X
```

- `main` 是生产
- `develop` 是开发集成
- 长期 release / hotfix 分支

#### Commit 约定（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

| Type | 含义 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat(auth): add OAuth2 login` |
| `fix` | 修 bug | `fix(api): handle empty request body` |
| `refactor` | 重构（不修 bug 不加功能）| `refactor: extract user service` |
| `docs` | 文档 | `docs: update README` |
| `test` | 测试 | `test: add user service tests` |
| `chore` | 杂项 | `chore: update dependencies` |
| `perf` | 性能 | `perf: cache user lookup` |
| `ci` | CI/CD | `ci: add cache to GitHub Actions` |

#### 分支保护

- `main` / `develop` 必须 PR 合并
- 必须 N 个 reviewer 通过（典型 1-2 人）
- 必须 CI 通过
- 禁止 force push

### 2.2 CI/CD

#### GitHub Actions 示例

**`.github/workflows/ci.yml`**：

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test

  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

**关键原则**：

- **每个 PR 都跑全套**——lint + typecheck + test
- **失败快速反馈**——5-10 分钟内出结果
- **缓存依赖**——cargo cache / npm cache
- **main 触发部署**——main 通过 → 自动部署

#### Git Hooks（pre-commit）

**用 `lefthook` 或 `pre-commit`** 在提交前自动跑检查：

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    fmt:
      glob: "*.{rs,ts,tsx,js,jsx}"
      run: cargo fmt -- {staged_files} # or prettier
    lint:
      glob: "*.{ts,tsx,js,jsx}"
      run: npx eslint {staged_files}
    test-rust:
      run: cargo test
```

**反模式**：

- CI 跑 30 分钟 → 拆并行 / 拆缓存
- main 失败不阻止 merge → 必须配置分支保护
- 本地跑过但 CI 失败 → CI 必须能复现本地

### 2.3 Code Review

#### 必备检查项

| 维度 | 检查内容 |
| --- | --- |
| **正确性** | 逻辑对吗？边界条件？错误处理？ |
| **可读性** | 命名清楚？结构清晰？注释到位？ |
| **可测试** | 有测试吗？测试覆盖关键路径？ |
| **可维护** | 改动是否最小？没有顺手"优化"？ |
| **性能** | 有没有明显的 N+1 / O(n²) / 内存泄漏？ |
| **安全** | SQL 注入？XSS？密钥硬编码？权限？ |
| **规范** | 通过 lint / format？命名一致？ |

#### Review 礼仪

- **及时 review**——24 小时内响应
- **建设性**——指出问题 + 建议方案
- **小批量**——单 PR < 400 行代码
- **明确批准**——批准 / 拒绝 / 评论，三选一
- **不阻塞非关键问题**——typo 等可以 PR 后续修

### 2.4 发布管理

#### SemVer（语义化版本）

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └─ 修 bug（不破坏兼容）
  │     └────── 加功能（不破坏兼容）
  └──────────── 不兼容改动
```

**示例**：

- `1.0.0` → `1.0.1`：修 bug
- `1.0.1` → `1.1.0`：加新功能
- `1.1.0` → `2.0.0`：breaking change

#### Changelog

**`CHANGELOG.md` 模板**：

```markdown
# Changelog

## [Unreleased]

## [1.2.0] - 2024-01-15

### Added
- OAuth2 login support
- Dark mode toggle

### Changed
- Improved error messages
- Updated dependencies

### Fixed
- Race condition in cache
- Memory leak in WebSocket handler

### Breaking
- Removed deprecated `client.connect()` method, use `client.init()` instead
```

---

## 三、规范（Standards）

### 3.1 命名约定

#### Rust

| 类别 | 规范 | 示例 |
| --- | --- | --- |
| Crate | snake_case | `my-crate` / `my_crate` |
| 模块 | snake_case | `mod user_service` |
| 类型 | UpperCamelCase | `struct UserService` |
| 函数 / 方法 | snake_case | `fn get_user` |
| 变量 | snake_case | `let user_name` |
| 常量 | SCREAMING_SNAKE | `const MAX_RETRY: u32` |
| 生命周期 | short lowercase | `'a`, `'static` |

#### TypeScript

| 类别 | 规范 | 示例 |
| --- | --- | --- |
| 文件 | kebab-case 或 camelCase | `user-service.ts` |
| 类 | UpperCamelCase | `class UserService` |
| 接口 / 类型 | UpperCamelCase | `interface UserData` |
| 函数 / 方法 | camelCase | `function getUser()` |
| 变量 | camelCase | `let userName` |
| 常量 | SCREAMING_SNAKE | `const MAX_RETRY = 3` |
| React 组件 | UpperCamelCase | `function UserList()` |

### 3.2 提交原子性

**一个 commit = 一个事**。

**反模式**：

- 一个 commit 改 10 个文件但只写"fix bug" → 拆分
- 混 feature + refactor → 拆成两个 commit
- WIP commit（"fix xxx", "wip", "tmp"） → 合并 / rebase 掉

**好的 commit 历史**：

```
feat(auth): add OAuth2 login
feat(api): add user CRUD endpoints
refactor: extract user service
test: add user service tests
fix(api): handle empty request body
docs: update API documentation
chore: update dependencies
```

每个 commit 都能独立 review / revert。

### 3.3 注释约定

**好的注释解释"为什么"，不解释"是什么"**。

```rust
// ❌ 不好：解释"是什么"（看代码就知道）
// 把 x 加 1
x += 1;

// ✅ 好：解释"为什么"
x += 1;  // 跳过索引 0，因为 0 是哨兵值
```

**反模式**：

- 注释掉的代码 → 删了（git 有历史）
- 解释明显代码 → 删
- TODO 没跟踪 → 提 issue / 注释 `@todo(#123)`

---

## 跟其他章节的关系

| 本章 | 对应 |
| --- | --- |
| [phases/early-dev.md](phases/early-dev.md) | 4 项基础设施（logger / config / constants / 目录结构）是工程化在 init 阶段的子集 |
| [phases/debug.md](phases/debug.md) | 调试工具（lldb / DevTools）是工具层面的延伸 |
| [rust-style 进程层](../../../rust-style/SKILL.md) | Rust 工程化具体实现 |
| [ts-style 规则 7-8](../../../ts-style/SKILL.md) | TypeScript 工程化具体实现 |
| [workflow.md 第 2.4 步](workflow.md) | 空间复杂度优化（工程化把工具集中到 utils / scripts） |

## 跟语言 style 的关系

工程化规定**"要建什么 / 为什么"**；具体怎么建交给语言 style：

- **Rust 实现** → [rust-style 进程层 R1-R4](../../../rust-style/SKILL.md)（基础设施集中 / 生命周期移交 / 并发约束 / IO deadline）
- **TypeScript 实现** → [ts-style 规则 7-8](../../../ts-style/SKILL.md)（避免模块顶层可变状态 / 受控全局状态）

## 反模式

| 反模式 | 表现 | 纠正 |
| --- | --- | --- |
| **工具堆砌** | 装了 20 个 lint 规则但都不熟 | 选 1-2 个用透 |
| **没有 Git workflow** | 大家直接 push main | 配置分支保护 + PR review |
| **没有 code review** | 代码合并不经 review | 强制 1-2 reviewer |
| **没有 CI** | 集成问题累积到发布 | PR 时自动跑全套检查 |
| **不更新 lockfile** | 安全漏洞 / 版本漂移 | 定期 `cargo update` / `npm update` |
| **巨型 PR** | 一次改 1000+ 行 | 拆成 < 400 行的 PR |
| **WIP commit** | 提交一堆"wip""tmp" | 合并 / rebase / squash |
| **commit message 模糊** | "fix", "update" | 用 Conventional Commits |

## 自检

### 工具
- [ ] Rust 项目装了 clippy + rustfmt + rust-analyzer？/ TS 项目装了 eslint + prettier + TypeScript？
- [ ] Lockfile 已提交？
- [ ] 测试框架能用？覆盖率报告可生成？
- [ ] 团队编辑器配置统一（.editorconfig）？

### 流程
- [ ] main 分支受保护？
- [ ] PR 强制 review（≥1 人）？
- [ ] CI 在 PR 时自动跑（lint + typecheck + test）？
- [ ] 失败能 5-10 分钟反馈？
- [ ] 部署自动化（main 通过 → 自动部署）？

### 规范
- [ ] 用 Conventional Commits？
- [ ] 一个 commit 一个事（不混 feature + refactor）？
- [ ] 命名规范文档化（README 或 wiki）？
- [ ] SemVer 用于发布？
- [ ] Changelog 维护？

任何一项不满足，去查 [典型反模式](anti-patterns.md) 或对应语言 style。

## 一句话

> **工程化 = 工具（让机器帮忙） + 流程（让团队对齐） + 规范（让代码统一）。三者缺一不可；具体实现交给语言 style。**