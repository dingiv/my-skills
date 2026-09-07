# 程序推导流程（Derivation）

> **从需求到代码的推导链：需求 → 端到端链路 → 对外接口 → 事件源 + 事件类型 → handler。** 每一步都由上一步决定——单向、不可逆推。

## 一句话

> **程序的形态是「需求 → 链路 → 接口 → 事件 → handler」的逐级推导结果；每一步都以上一步为输入，不能反过来。**

## 为什么需要推导流程

- **没有流程时**：想到哪写到哪 → 接口散落 → 事件源乱接 → handler 重复 → 无法维护
- **有流程时**：每一步都有明确输入输出 → 接口受链路约束 → 事件源受接口约束 → handler 受事件类型约束 → 状态机收敛

**反向推导 = 反模式**：

- 从「我想监听什么事件」反推接口 → 接口成了事件驱动的副产品，与需求脱节
- 从「我想实现什么 handler」反推事件 → handler 漫无目的，每个事件一个 handler，没有复用
- 任何一步反推 = 程序失序

## 五步推导

```
需求 (user)
   ↓
端到端链路 (calltree)
   ↓
对外接口 (interface contract)
   ↓
事件源 + 事件类型 (event source + event type)
   ↓
handler 实现 (handler code)
   ↓
daemon 形态（main + loop + cleanup）
```

### 第 1 步：需求 → 端到端链路

- **输入**：需求文档（来自 [bootstrap.md 第 2 步](bootstrap.md)）
- **输出**：N 条端到端 calltree（来自 [bootstrap.md 第 3 步](bootstrap.md)）
- **关键**：每条核心场景 = 1 条链路；触发点 + 终止条件标清楚

### 第 2 步：链路 → 对外接口

- **输入**：calltree（来自 [bootstrap.md 第 4 步](bootstrap.md)）
- **输出**：接口契约（伪代码）
- **关键**：从每条链路识别**输入接口**、**关键产出接口**、**终止接口**——而不是从「想实现什么功能」出发

### 第 3 步：接口 → 事件源 + 事件类型

- **输入**：接口契约
- **输出**：事件源清单 + 事件类型清单
- **关键**：每个接口都隐含一个或多个事件源；每个事件源产生一种或多种事件类型

### 第 4 步：事件类型 → handler

- **输入**：事件类型清单
- **输出**：handler 集合（伪代码）
- **关键**：每个事件类型 = 一个 handler（或一组）；handler 的契约是 `(event, state) → state'`

### 第 5 步：handler → daemon 形态

- **输入**：handler 集合
- **输出**：完整的 daemon 程序（[anatomy.md](anatomy.md) 八件套）
- **关键**：把 handler 集合回填到 `while(true)` 循环里，加上启动三件套和 cleanup

## 第 3 步展开：接口 → 事件源 + 事件类型

每种接口都隐含一个或多个事件源：

| 接口类型 | 隐含的事件源 | 产生的事件类型 |
| --- | --- | --- |
| HTTP API | HTTP server socket | `http_request`（GET / POST / ...） |
| CLI 命令 | stdin / 信号 | `command_line` |
| GUI 操作 | GUI 事件循环 | `click` / `keypress` / `resize` |
| 文件监听 | inotify / FSEvents | `file_changed` / `file_created` / ... |
| 计时器 | OS timer | `tick` |
| 消息队列 | MQ 订阅 | `message_arrived` |
| 数据库变更 | 触发器 / poll | `db_changed` |

**操作**：

1. 列出所有接口
2. 每个接口问「用户怎么到达这个接口」——答案是**事件源**
3. 每个事件源问「它能产生什么类型的事件」——答案是**事件类型**

## 第 4 步展开：事件类型 → handler

每个事件类型 = 一个 handler（或一组）。handler 的契约：

```typescript
type Handler = (event: EventType, state: State) => State;
```

- **输入**：事件 + 当前状态
- **输出**：新状态（state 经过修改 = 状态迁移）
- **副作用**：IO（如有）

**handler 命名约定**：以事件类型命名，让「事件类型 ↔ handler」一一对应：

```
onClick(event, state)      → state'
onHttpGet(event, state)    → state'
onTick(event, state)       → state'
onMessage(event, state)    → state'
```

**反模式**：

- 一个 handler 处理多种不相关的事件 → 把 handler 拆细（按事件类型）
- 多个 handler 处理同一种事件 → 合并，或通过路由表分发
- handler 不修改 state（纯副作用）→ 要么合并进 IO 层，要么在 state 里留个"最后操作"字段

## 第 5 步展开：handler → daemon 形态

把 handler 集合回填到 [anatomy.md](anatomy.md) 的 daemon 八件套：

```
main(argc, argv)
  parseArgs / readConfig
  prepare event sources         ← 第 3 步输出
  prepare mutable state
  while (true):
    block on sources            ← 阻塞监听所有事件源
    event = wake()              ← 苏醒 + 拿到具体事件
    handler = match(event)      ← 第 4 步输出：事件 → handler
    handler(event, state)       ← 调用 handler，修改 state
  cleanup
```

**关键点**：

- **事件源在循环外准备**（`initEventSources`）——一次性建立监听，循环里只 block & wake
- **state 在循环外持有**——handler 之间通过 state 传递信息
- **handler 是循环里唯一的可变动作**——所有 IO / 状态修改都收敛在 handler 里

## 跟 code_arch 其他章节的对应

| 本章 | 对应 |
| --- | --- |
| [Bootstrap 流程](bootstrap.md) | 第 1 步 + 第 2 步的详细对话流程 |
| [程序的形态](anatomy.md) | 第 5 步：把 handler 集合填进 daemon 八件套 |
| **本章**（derivation） | **第 3 步 + 第 4 步的桥梁：接口 → 事件 → handler** |
| [工作流：四步](workflow.md) 第 2.2 步 | 链路 → 接口的整体方法论 |

读 code_arch 的顺序：**bootstrap → 本章 → anatomy**。三篇组合起来就是「需求 → 代码」的完整推导路径。

## 自检

- [ ] 每一步都能解释上一步的输入？（不是凭空冒出来的）
- [ ] 没有反向推导（没有「我想监听 X 事件所以加了 Y 接口」）？
- [ ] 接口数量 ≤ 链路数量（每条链路至少 1 个接口）？
- [ ] 事件源数量 ≥ 接口数量（每个接口至少有 1 个事件源）？
- [ ] handler 数量 ≤ 事件类型数量（一个 handler 处理一种或相近的几种事件）？
- [ ] 所有可变状态修改都收敛在 handler 里（不在循环外散落）？

任何一项不满足，去查 [典型反模式](anti-patterns.md)。

## 一句话

> **程序的形态是「需求 → 链路 → 接口 → 事件 → handler」的单向推导；每一步都受上一步约束，不能反过来。**