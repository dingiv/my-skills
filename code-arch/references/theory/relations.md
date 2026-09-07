# 与其他 skill 的关系

`code_arch` 是**最高层**的方法论。下层三个 skill 各管一段：

| Skill | 管什么 | 用在 code_arch 哪一步 |
| --- | --- | --- |
| `code_arch`（本 skill） | 项目层方法论：需求 → 入口 → 接口 → 依赖 → 空间 | 全部四步 |
| `calltree` | 链路层描述：用 calltree 表达一段代码在干什么 | 步骤 1（需求画 calltree）、步骤 2.1（入口画 calltree）、步骤 2.2（接口画 calltree） |
| `rust-style` | Rust 代码层风格 | 步骤 2.4 之后 + 编码阶段 |
| `ts-style` | TypeScript 代码层风格 | 步骤 2.4 之后 + 编码阶段 |

使用顺序：**code_arch 先定架构 → calltree 把架构画成链路 → 语言 style 把链路落实成代码。** 三者反向使用（先写代码 → 再用 calltree 解释 → 再用 code_arch 套上去）是反模式——会让代码成为既成事实，架构被反向定义。