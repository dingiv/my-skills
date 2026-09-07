# 程序的形态（Anatomy）

> **架构一个程序的前提：知道程序应该长什么样。** 本节给出 daemon 程序的标准形态——这是状态机的"骨架"在代码层的具象。

## 一句话

> **daemon 程序 = main + 启动阶段（args / config / 事件源 / state）+ 事件循环 + handler 分发 + 清理（共八件）。**

每一个 daemon——服务端、桌面客户端、嵌入式服务、CLI 工具只要在持续运行——都是这个形态。

## 标准结构（C 风格伪代码）

```c
int main(int argc, char *argv[]) {
  // ── 启动阶段（args / config）──
  Args   *args   = parseArgs(argc, argv);   // 1. 命令行参数
  Config *config = readConfig();            // 2. 配置文件

  // ── 准备阶段（在循环之外，可被所有 handler 访问）──
  initEventSources(args, config);           // 3. 事件源（IO / 计时器 / 信号 / 队列）
  State  *state  = createState(args, config); // 4. 可变状态

  // ── 主循环（时间维度）───────────────────────────
  while (true) {
    Event *event = block_on_sources();      // 5. 阻塞监听所有事件源
    if (event == NULL) break;               //    全部清理完才退出

    Handler *h = matchHandler(event, state); // 6. 根据事件 + 当前状态选 handler
    h(event, state);                        // 7. 调用 handler：
                                            //    - 读 state
                                            //    - 修改 state (= 状态迁移)
                                            //    - 副作用：IO / 产出结果
    if (h.needsResponse) respond(h.result); // 8. 必要时响应
  }

  // ── 清理（逆序销毁）────────────────────────────
  destroyState(state);
  destroyEventSources();
  free(config);
  return 0;
}
```

## 八件套对照表

| # | 件 | 是什么 | 状态机对应 |
| --- | --- | --- | --- |
| 1 | `main(argc, argv)` | 进程入口 | 启动点（终态入口） |
| 2 | `parseArgs` | 命令行参数 | 初始状态的一部分 |
| 3 | `readConfig` | 配置文件 | 初始状态的一部分 |
| 4 | event sources | IO / 计时器 / 信号 / 消息队列 | 输入字母表 |
| 5 | mutable state | 状态变量（loop 之外） | 状态变量 S |
| 6 | event loop（含 block & wake）| `while(true)`：阻塞等待事件 / 被事件唤醒 | 转移函数迭代器 + 读输入 |
| 7 | handler + mutation | handler 调用 + 修改 state | 转移函数 δ(s, e) → s' |
| 8 | cleanup | 逆序销毁 | 回到终态 |

**关键约束**：

- **state 必须在循环之外持有**——否则 handler 之间无法传递信息，每次循环就成了一次性计算。
- **handler 必须读 state、写 state**——它的全部副作用就是状态迁移。
- **事件循环是唯一的时间维度**——除循环之外没有第二条时间线，否则时序错位。

## 程序 = 状态机的形式化

| 状态机术语 | 程序里的位置 |
| --- | --- |
| 状态集合 S | `state` + `config` |
| 输入字母表 Σ | event sources 集合 |
| 初始状态 s₀ | main + parseArgs + readConfig 之后 |
| 转移函数 δ: S × Σ → S | handler `(event, state)` |
| 状态迁移 | handler 内对 state 的写入 |
| 终态 | cleanup 之后 / return |
| **时间维度** | event loop 的每一次迭代 |
| **空间维度** | 三层结构（View / Service / Model） |

## 纵向 vs 横向

程序结构可以从两个轴看：

**纵向（时间轴）** —— 程序在时间上如何展开：

```
main
 └─ 启动阶段（args / config）
     └─ 准备事件源 + state
         └─ event loop
             ├─ 阻塞 → 唤醒
             ├─ 匹配 handler
             └─ 调用 handler（修改 state）
         └─ 循环 / 退出
     └─ cleanup（逆序）
```

每一层都是上一层的时间延伸，不能跨级。

**横向（空间轴）** —— 程序内部如何在空间上分层：

```
┌──────────────────────────────────┐
│  View 层（视图层）                 │
│  - 接收事件源                     │
│  - 解析 / 翻译外部请求            │
│  - 把请求分发给 Service          │
├──────────────────────────────────┤
│  Service 层（业务层）              │
│  - 业务逻辑                       │
│  - handler 都在这一层             │
│  - 调用 Model 完成 IO            │
├──────────────────────────────────┤
│  Model 层（持久层）                │
│  - 数据管理                       │
│  - 进程外 IO                     │
│  - 数据持久化                     │
└──────────────────────────────────┘
        ↑
   单向依赖（View → Service → Model）
```

**关键约束**：

- 三层之间必须保持**单向依赖**：View → Service → Model。
- 这不是风格选择，是**时序约束**：Model 的初始化必须先于 Service 的使用、Service 的初始化必须先于 View 的使用——单向依赖是这个前向包含关系的空间表达。
- 任何反向依赖 = 循环依赖 = 时序崩溃。

## 演化：MVC → MVP → MVVM → ECS

daemon 形态不变（main + loop + handlers 一个都没少），变化的是**状态从 Model 迁移到 View 的路径**：

| 架构 | View 怎么收到 Model 的变化 | 依赖方向 |
| --- | --- | --- |
| **MVC** | Controller 同步调用 View | View ↔ Controller → Model（易循环） |
| **MVP** | Presenter 同步调用 View | View → Presenter → Model（单向） |
| **MVVM** | Model 抛事件 → 消息队列 → ViewModel 自动同步 | View ↔ ViewModel → Model（响应式） |
| **ECS** | System 批量处理 → 渲染 tick 统一更新 View | View ← Service → Model（批量） |

**共同点**：八件套一个都没少，变的只是 Service 层内部状态迁移的路径。

**适用差异**：

- MVC / MVP：Web / 桌面，需要低延迟响应
- MVVM：响应式前端，View 高频变动
- ECS：游戏 / 渲染，需要批处理高吞吐

## 跟 code-master 其他章节的对应

| 本章 | 对应 |
| --- | --- |
| [核心论断](core.md) | 状态机的抽象模型 |
| **本章**（anatomy） | 状态机的代码形态 |
| [工作流：架构设计四子步](../operations/workflow.md) | 怎么搭一台状态机 |
| [三种应用模式](../operations/modes.md) | 三种典型搭建场景 |
| [Bootstrap 流程](../operations/phases/initiation.md) | 0 → 1 的对话引导 |

读 code-master 的顺序：**核心论断 → 本章 → 工作流**。先知道状态机是什么、再知道状态机长什么样、再知道怎么搭一台。

## 自检：你的程序是这个形态吗？

- [ ] 有 main 函数和明确的启动阶段（args / config / 事件源 / state）？
- [ ] 有清晰的事件源列表（不是"边走边看"）？
- [ ] mutable state 在循环**之外**持有？
- [ ] 事件循环是唯一的"时间维度"驱动？
- [ ] 每个 handler 都明确：读什么 state、写什么 state、有什么副作用？
- [ ] cleanup 是逆序的？
- [ ] 三层结构是单向依赖（View → Service → Model）？

任何一项不满足，程序就有架构问题——具体是哪类问题，去查 [典型反模式](../operations/anti-patterns.md) 和 [自查清单](../operations/self-check.md)。

## 一句话

> **daemon 程序 = 状态机的标准形态 = main + 启动阶段（args / config / 事件源 / state）+ 事件循环 + handler 分发 + 清理；三层结构是状态机的空间拆分；MVC / MVP / MVVM / ECS 都是同一个 daemon 形态在不同时代的不同侧重。**