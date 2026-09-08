---
name: code-master
description: **核心方法论：约束驱动扩散**——效仿扩散模型，从「噪声 / 无序状态」出发，逐步加入约束，雕刻出最终的程序形态。**约束来源两大类**：(1) 核心方法论 + 工作流（定义约束的入口和扩散方向）；(2) 需求 → 接口（约束业务方向）。从零到 N 实现完整应用的**可执行架构操作规程**。**默认按操作层（operations/）走**：面对"做一个新项目 / 重构 / review 架构"三类请求，分别走 Bootstrap 流程 / 架构重构 / 架构审视——不解释 why，机械告诉你先干什么再干什么。**理论层（theory/）作为补充阅读**——讲 WHY（程序即状态机 / daemon 八件套 / 作用域 / 域组合 / 容器治理 / 时序约束），只在需要理解原理或解释方案时再读。主张「程序即状态机、需求即端到端链路、复杂度由状态机封装」。方法论分两大步——需求阐述（定义端到端需求）→ 架构设计（四子步：对外接口定义 / 调用链推导 / 依赖寻找驱动时序 / 空间复杂度优化）；四条时序约束（依赖前向包含 / 空间封装 / 逻辑时序 / 工程管理）是架构设计的底层规则；AI 应用视角（上下文受限、拆分能力是应用 AI 的关键）贯穿全程。在以下场景推荐使用——用户提出"做一个新项目 / 从零设计 X / 帮我搭一个 Y 系统"时启动 Bootstrap 流程；用户提出"重构现有项目 / 这块设计有问题"时启动架构重构流程；用户提出"看看这个项目的架构怎么样"时启动架构审视流程；为复杂需求设计模块拆分、定义端到端调用链路、解释「为什么这么分层」、与 calltree / rust-style / ts-style skill 协同使用（code-master 决定架构层，calltree 描述链路层，语言 style 决定代码层）。推荐做法——先定需求再定接口（入口），先定接口再设计调用链，先理依赖再优化空间；任何代码改动前先问「它属于哪条端到端链路」「它影响了什么状态」「它的生命周期是什么」；不要跳过任何流程步骤，每步必须向用户确认才能进入下一步。关键词：项目架构、架构设计、约束驱动扩散、扩散模型、约束雕刻、约束标记、docs/arch/、arch.md、code-master:title、// CMA:（Code Master Annotation）、操作规程、daemon 形态、main + 事件循环 + handler、端到端、状态机、Bootstrap、可执行、操作优先、渐进式披露、新项目引导、文件管理、统一存储根目录、文件路径硬编码、文件读写模块、持久化状态模块、环境变量管理、env module、Config 对象、单一读取入口。
---

# 从零到 N 实现完整应用

> **程序即状态机；需求即端到端链路；架构 = 把指数级的状态空间封装成线性可管理的范围；先有空间再有时间。**

本 skill 是**可执行的项目架构操作规程**——面对「做一个新项目」「重构现有项目」「review 项目架构」这三类请求，按明确步骤引导，**不会上来就开始写代码**。

## 一句话

> **架构设计 = 把指数级的状态空间，通过空间封装（模块 / 接口 / 类型 / 生命周期）压回到线性可管理的范围。**

## 核心方法论：约束驱动扩散

> code-master 的核心方法论是「**约束驱动扩散**」——效仿扩散模型，从「噪声 / 无序状态」出发，逐步加入约束，雕刻出最终的程序形态。

**扩散逻辑**：

- **起始**：噪声 / 模糊设计空间（无任何约束时的所有可能）
- **加约束**：逐步加入约束（「这里要有树」「那里要有河」「天空是蓝色」……）
- **收敛**：每加一条约束，搜索空间**收缩**
- **终态**：满足所有约束的**唯一**程序形态

**两类约束来源**：

| 来源 | 角色 | 内容 |
| --- | --- | --- |
| **核心方法论 + 工作流** | **定义约束的入口和扩散的方向** | 工作流四子步 / 推导五步 / 4 节点生命周期 / SOLID / 工程化 |
| **需求 → 接口** | **约束业务方向** | 需求文档 → 接口契约 → 调用链 → 事件源 → handler（5 步推导）|

**两层约束的叠加**：

- **方法论层**是「过程性约束」——规定"怎么工作"（先定需求再定接口、先接口后链路……）
- **业务层**是「结果性约束」——规定"做出什么"（接口要满足 N 个核心场景、calltree 要有触发点和终止……）
- 两层叠加 → **程序形态被双向约束**到唯一可行

**为什么是「驱动扩散」**：

- 传统开发是「想到哪写到哪」 → 程序形状随机
- 约束驱动扩散是「先定约束 → 逐层雕刻」 → 程序形状**唯一**
- 即使多人独立工作，遵守同一套约束也会收敛到相近形态

详见：

- 扩散模型类比：[composition.md 扩散模型](references/theory/composition.md)
- 五步推导：[derivation.md 五步推导](references/operations/derivation.md#五步推导)
- 入口流程：下面的「如何启动」表

## 如何启动（默认从这里开始）

**操作优先**：面对不同请求，按以下入口启动对应流程：

| 请求类型 | 启动流程 |
| --- | --- |
| 「做一个新项目 / 从零设计 X / 帮我搭一个 Y 系统」 | **[Bootstrap 流程](references/operations/phases/initiation.md)**：4 步对话（需求阐述→需求文档→接口契约→调用链罗列）把模糊需求逼成接口契约 |
| 「重构现有项目 / 这块设计有问题 / 改一处崩三处」 | **[模式二·架构重构](references/operations/modes.md#模式二架构重构已有项目--目标架构)**：现状→目标→迁移 |
| 「看看这个项目的架构怎么样 / 给我做架构 review」 | **[模式三·架构审视](references/operations/modes.md#模式三架构审视in-progress-项目)**：现状→评估→行动项 |

> **核心约束**——不要跳过任何流程步骤。每步完成后必须向用户确认才能进入下一步。如果用户主动跳步，礼貌地把当前步骤补完再继续。

## 何时使用

- 面对"做一个新项目"类请求 → 启动 Bootstrap 流程（4 步走完）
- 面对"重构 / 改造现有项目"类请求 → 启动架构重构（先画现状再定目标）
- 面对"review 架构"类请求 → 启动架构审视（只评估不动手）
- 为复杂需求设计模块拆分
- 定义端到端调用链路
- 与 `calltree` / `rust-style` / `ts-style` skill 协同使用

## 内容索引

按需打开。

### 操作层（what）— `operations/` ← 默认入口

按项目时期 + 跨阶段交叉两个维度组织：

**按项目时期** — `operations/phases/`

| 阶段 | 入口 | 何时读 |
| --- | --- | --- |
| **立项时期** | **[phases/initiation.md](references/operations/phases/initiation.md)** | **新项目入口——这是最常用的路径** |
| **早期开发** | **[phases/early-dev.md](references/operations/phases/early-dev.md)** | **写业务代码前——搭基础设施（logger / config / constants / utils）** |
| 调试时期 | [phases/debug.md](references/operations/phases/debug.md) | 代码出了问题——三阶段循环（重现/定位/修复） |
| 调试时期 | [phases/debug-rust.md](references/operations/phases/debug-rust.md) | **Rust 专用**：编译/运行/panic/调试器/性能/测试/编辑器 |
| 调试时期 | [phases/debug-typescript.md](references/operations/phases/debug-typescript.md) | **TS 专用**：类型/调试器/异步/性能/测试/编辑器 |

**跨阶段** — `operations/` 根目录

| 章节 | 内容 | 何时读 |
| --- | --- | --- |
| [工作流：架构设计四子步](references/operations/workflow.md) | 接口（入口）→链路→依赖→空间 | 动手做架构设计时——这是操作步骤 |
| [接口契约表达法](references/operations/interface-contract.md) | **四要素（输入/输出/失败/生命周期）+ 两属性（异步性/状态交互）；CLI / Daemon / GUI 三种形式** | **写接口契约时必读——这是「接口长什么样」的具体形式** |
| [工程化](references/operations/engineering.md) | **工具（语言工具链/lint/test/编辑器）+ 流程（Git/CI/code review/发布）+ 规范（命名/Commit/SemVer）** | **贯穿项目生命周期——让代码可维护、可协作、可演进** |
| [文件管理](references/operations/file-management.md) | **统一存储根目录（客户端进用户家目录）+ 路径常量化（禁硬编码）+ 分类型目录（config/data/logs/cache/tmp）+ 单一文件读写模块 + 内存滞留数据归持久化状态模块** | **写任何涉及文件系统的代码时（日志 / 配置 / 数据 / 缓存）——除数据库外的文件管理纪律** |
| [环境变量管理](references/operations/env-management.md) | **启动时第一个就绪；唯一的环境变量读取入口；输出类型化 + 已校验的 Config 对象；业务代码不许自己读 env；密钥只放 env** | **写任何业务代码、检查「我是不是在读 process.env」时——env 管理纪律** |
| [约束标记显化](references/operations/constraint-markers.md) | **4 类标记：docs/arch/ 全局 + <module>/arch.md + 文件头 code-master:title + 行间 // CMA:（Code Master Annotation）** | **让「约束驱动扩散」可看见、可检视——约束不写下来就只在脑子里** |
| [程序推导流程](references/operations/derivation.md) | **五步推导：需求→接口→链路→事件→handler；接口决定事件源和事件类型** | **从接口契约推导 daemon 实现——连接 initiation 和 anatomy 的桥梁** |
| [三种应用模式](references/operations/modes.md) | 模式一：新项目 / 模式二：重构 / 模式三：审视 | **判断「今天做哪种架构动作」时先读** |
| [AI 应用视角](references/operations/ai-view.md) | 上下文窗口、拆分能力、AI 工作内存 | 用 AI 辅助架构设计时 |
| [自查清单](references/operations/self-check.md) | 按四子步拆分的 checkbox | 完成每个里程碑时 |
| [典型反模式](references/operations/anti-patterns.md) | 8 条「反模式 ↔ 纠正」对照 | 怀疑方案走偏时 |

### 理论层（why）— `theory/` ← 补充阅读

> **默认情况下不用读**。仅当需要理解原理 / 解释方案 / 说服别人 / 追根溯源反模式时再读。

| 章节 | 内容 | 何时读 |
| --- | --- | --- |
| [核心论断](references/theory/core.md) | 程序即状态机；复杂度封装效应；空间×时序复杂度 | 想理解"为什么程序是状态机" |
| [程序的形态](references/theory/anatomy.md) | daemon 八件套：main + 启动阶段（args / config / 事件源 / state）+ 事件循环 + handler + 清理 | 想理解"程序长什么样" |
| [作用域（Scope）](references/theory/scope.md) | **域就是空间；单例域 vs 多例域；域中状态的所有者就是域本身；4 节点（init/set/get/drop）；全局可变与 FP 矛盾** | **拆解复杂需求时——状态空间切分的根本依据** |
| [域的组合](references/theory/composition.md) | 域里有域（递归/自相似）+ 子状态机组合 + 扩散模型：约束雕刻 | 想理解"为什么能架构" |
| [容器（Container）](references/theory/container.md) | 切分后如何治理：资源隔离 / 依赖管理 / 通信 / 生命周期 | 想理解"容器为什么是治理边界" |
| [SOLID 原则](references/theory/solid.md) | **OCP（开闭原则）深入：无 IOC 时的接口编程 + 何时引入 IOC；五原则全景** | **项目初期——定下"扩展而非修改"的基调** |
| [函数纯度](references/theory/function-purity.md) | **纯函数 vs 脏函数 + 3 子类型（改参/IO/隐参）；handler 内 90% 纯 + 10% 脏边界** | **写 handler 内函数时——是纯函数还是脏函数？** |
| [时序约束：四条](references/theory/timing.md) | 依赖前向包含 / 空间封装 / 逻辑时序 / 工程管理 | 想理解"为什么有这些时序约束" |
| [复杂度封装效应](references/theory/encapsulation.md) | 复杂度→封装边界对照表 | 想理解"封装如何降低复杂度" |
| [与其他 skill 的关系](references/theory/relations.md) | code-master / calltree / rust-style / ts-style 的层级 | 想理解"这套 skill 怎么协作" |

## 选择应用模式（最常问的问题）

不确定该用哪个模式？读 [三种应用模式](references/operations/modes.md) 第一节。判断的快捷问句：

> **「今天我要做的是创造、改造还是评价？」**
> - 创造 → Bootstrap 流程（4 步对话到接口）或 [模式一](references/operations/modes.md#模式一架构新项目0--1)
> - 改造 → [模式二·架构重构](references/operations/modes.md#模式二架构重构已有项目--目标架构)
> - 评价 → [模式三·架构审视](references/operations/modes.md#模式三架构审视in-progress-项目)

> **Bootstrap 流程 vs 模式一**——Bootstrap 流程面向"用户带着模糊需求来"的场景，强制 4 步对话引导；模式一面向"已经有清晰需求文档、动手做架构"的场景。两者衔接：完成 Bootstrap 后进入模式一继续走完第 2.3 / 2.4 步（依赖时序 + 空间优化）。

> **模式选择比方法论本身更重要**——选错了，再好的流程也产出错误结果。详细对照见 [三种应用模式](references/operations/modes.md) 末尾的对照表。

## 一句话回顾

> **程序即状态机；需求即端到端链路；架构 = 把指数级的状态空间封装成线性可管理的范围；先有空间再有时间；架构写下来，AI 才能在每一层都落准。**