# 程序推导流程（Derivation）

> **从需求到代码的推导链：需求 → 对外接口 → 端到端链路 → 事件源 + 事件类型 → handler。** 每一步都由上一步决定——单向、不可逆推。

## 一句话

> **程序的形态是「需求 → 接口 → 链路 → 事件 → handler」的逐级推导结果；每一步都以上一步为输入，不能反过来。**

## 为什么需要推导流程

- **没有流程时**：想到哪写到哪 → 链路散落 → 事件源乱接 → handler 重复 → 无法维护
- **有流程时**：每一步都有明确输入输出 → 链路受接口约束 → 事件源受链路约束 → handler 受事件类型约束 → 状态机收敛

**反向推导 = 反模式**：

- 从「我想监听什么事件」反推接口 → 接口成了事件驱动的副产品，与需求脱节
- 从「我想实现什么 handler」反推事件 → handler 漫无目的，每个事件一个 handler，没有复用
- 任何一步反推 = 程序失序

## 五步推导

```
需求 (user)
   ↓
对外接口 (interface contract)
   ↓
端到端链路 (calltree)
   ↓
事件源 + 事件类型 (event source + event type)
   ↓
handler 实现 (handler code)
   ↓
daemon 形态（main + loop + cleanup）
```

### 第 1 步：需求 → 对外接口

- **输入**：需求文档（来自 [phases/initiation.md 第 2 步](phases/initiation.md)）
- **输出**：对外接口契约（来自 [phases/initiation.md 第 3 步](phases/initiation.md)）
- **关键**：每个核心场景 = 1 个（或一组）对外接口；接口是用户/上游能调到的契约，先于实现

### 第 2 步：对外接口 → 端到端链路

- **输入**：接口契约（来自 [phases/initiation.md 第 3 步](phases/initiation.md)）
- **输出**：N 条端到端 calltree（来自 [phases/initiation.md 第 4 步](phases/initiation.md)）
- **关键**：每个接口 = 1 条实现链路；接口是入口，链路是实现路径

### 第 3 步：端到端链路 → 事件源 + 事件类型

- **输入**：calltree（来自 [phases/initiation.md 第 4 步](phases/initiation.md)）
- **输出**：事件源清单 + 事件类型清单
- **关键**：链路里的入口节点 = 事件源；事件源产生的事件 = 事件类型

### 第 4 步：事件类型 → handler

- **输入**：事件类型清单
- **输出**：handler 集合（伪代码）
- **关键**：每个事件类型 = 一个 handler（或一组）；handler 的契约是 `(event, state) → state'`

### 第 5 步：handler → daemon 形态

- **输入**：handler 集合
- **输出**：完整的 daemon 程序（[anatomy.md](../theory/anatomy.md) 八件套）
- **关键**：把 handler 集合回填到 `while(true)` 循环里，加上启动三件套和 cleanup

## 第 3 步展开：端到端链路 → 事件源 + 事件类型

calltree 里的每个入口节点都对应一个事件源：

| 链路节点 | 对应的事件源 | 产生的事件类型 |
| --- | --- | --- |
| HTTP 端点 | HTTP server socket | `http_request`（GET / POST / ...） |
| CLI 命令处理 | stdin / 信号 | `command_line` |
| GUI 交互处理 | GUI 事件循环 | `click` / `keypress` / `resize` |
| 文件监听节点 | inotify / FSEvents | `file_changed` / `file_created` / ... |
| 定时器节点 | OS timer | `tick` |
| 消息队列消费者 | MQ 订阅 | `message_arrived` |
| 数据库变更处理 | 触发器 / poll | `db_changed` |

**操作**：

1. 列出 calltree 里所有入口节点
2. 每个入口节点问「用户在外部怎么到达这里」——答案是**事件源**
3. 每个事件源问「它能产生什么类型的事件」——答案是**事件类型**

## 第 4 步展开：事件类型 → handler

每个事件类型 = 一个 handler（或一组）。handler 的契约：

```typescript
type Handler = (event: EventType, state: State) => State;
```

- **输入**：事件 + 当前状态
- **输出**：新状态（state 经过修改 = 状态迁移）
- **副作用**：IO（如有）

**handler 内部结构**（按函数纯度分类）：

```
handler onClick(event, state):
    // 90% 纯函数：数据处理、状态计算
    newState = computeNewState(event, state)
    response = buildResponse(newState)
    
    // 10% 边界脏函数：只在最外层
    saveToDb(newState)          // IO 函数
    state = newState             // 改参函数（state 是必要的）
    
    return state'
```

详见 [theory/function-purity.md](../../theory/function-purity.md)。

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
- handler 全部是脏函数（无纯函数）→ 重构：先纯计算、再脏边界

## 第 5 步展开：handler → daemon 形态

把 handler 集合回填到 [anatomy.md](../theory/anatomy.md) 的 daemon 八件套：

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
| [立项流程](phases/initiation.md) | 第 1 步 + 第 2 步的详细对话流程（接口→链路） |
| [程序的形态](../theory/anatomy.md) | 第 5 步：把 handler 集合填进 daemon 八件套 |
| **本章**（derivation） | **第 3 步 + 第 4 步的桥梁：链路 → 事件 → handler** |
| [工作流：四步](workflow.md) 第 2.2 步 | 对外接口 → 链路的整体方法论 |

读 code_arch 的顺序：**initiation → 本章 → anatomy**。三篇组合起来就是「需求 → 代码」的完整推导路径。

## 自检

- [ ] 每一步都能解释上一步的输入？（不是凭空冒出来的）
- [ ] 没有反向推导（没有「我想监听 X 事件所以加了 Y 接口」）？
- [ ] 链路数量 ≤ 接口数量（每个接口至少有 1 条链路）？
- [ ] 事件源数量 ≥ 链路入口数量（每个链路入口对应 1 个事件源）？
- [ ] handler 数量 ≤ 事件类型数量（一个 handler 处理一种或相近的几种事件）？
- [ ] 所有可变状态修改都收敛在 handler 里（不在循环外散落）？

任何一项不满足，去查 [典型反模式](anti-patterns.md)。

## 一句话

> **程序的形态是「需求 → 接口 → 链路 → 事件 → handler」的单向推导；每一步都受上一步约束，不能反过来。**