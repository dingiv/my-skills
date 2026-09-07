# 与其他 skill 的关系

`code-master` 是**最高层**的方法论。下层三个 skill 各管一段：

| Skill | 管什么 | 用在 code-master 哪一步 |
| --- | --- | --- |
| `code-master`（本 skill） | 项目层方法论：需求 → 接口（入口）→ 链路 → 依赖 → 空间 | 全部四步 |
| `calltree` | 链路层描述：用 calltree 表达一段代码在干什么 | 步骤 2.2 后半（为接口画实现 calltree） |
| `rust-style` | Rust 代码层风格（含 OCP / trait / 生命周期 / 错误语义） | 步骤 2.4 之后 + 编码阶段；SOLID 中 O/D 见 rust-style R1-R7 |
| `ts-style` | TypeScript 代码层风格（含 OCP / interface / 依赖倒置） | 步骤 2.4 之后 + 编码阶段；SOLID 中 O/D 见 ts-style 规则 1-9 |

使用顺序：**code-master 先定架构（含接口契约）→ calltree 把接口画成实现链路 → 语言 style 把链路落实成代码。** 三者反向使用（先写代码 → 再用 calltree 解释 → 再用 code-master 套上去）是反模式——会让代码成为既成事实，架构被反向定义。

## SOLID 原则的跨 skill 协作

SOLID（详见 [solid.md](solid.md)）的 OCP（开闭）和 D（依赖倒置）是 code-master / rust-style / ts-style 共同关注的核心：

- **code-master / solid.md**：理论基础 + 决策树（何时抽象 / 何时 IOC）
- **rust-style R1-R7**：Rust 实现（trait 契约、拆 trait、生命周期、依赖注入）
- **ts-style 规则 7-9**：TypeScript 实现（interface composition、工厂函数、显式依赖）

三 skill 协作流程：code-master 告诉你「应该用接口」，rust-style / ts-style 告诉你「在 X 语言里接口怎么写」。