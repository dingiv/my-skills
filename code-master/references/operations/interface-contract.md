# 接口契约表达法（Interface Contract）

> **接口先于链路——这是设计哲学。** 但接口长什么样？三类主要程序（CLI / Daemon / GUI）的接口表达方式不同，但有**共同骨架**。

## 一句话

> **任何接口都遵循「输入 / 输出 / 失败 / 生命周期」四要素；具体形式按程序类型扩展。**

## 何时使用

- 在 [phases/initiation.md 第 3 步](phases/initiation.md)（设计对外接口契约）时
- 在 review 现有项目的接口契约时
- 在设计新接口但不确定怎么写时

## 共同骨架

任何接口契约都包含**四要素**：

```typescript
interface SomeInterface {
  // 1. 输入 (inputs)
  // 2. 输出 (outputs)
  // 3. 失败语义 (errors)
  // 4. 生命周期 (lifecycle)
}
```

外加**两个属性**：

| 属性 | 取值 | 含义 |
| --- | --- | --- |
| **异步性** | `sync` / `async` / `callback` | 调用后多久返回 / 怎么通知完成 |
| **状态交互** | `stateless` / `read-only` / `read-write` | 是否修改程序状态 / 影响幂等性 / 缓存 |

**为什么这两个属性重要**：

- 异步性错了 → 调用方不知道何时拿结果（轮询 / 回调 / await 写法全错）
- 状态交互错了 → 缓存设计错、安全审计错、可重入性错

## 类型特定扩展

### CLI 应用

**触达方式**：命令行参数 + stdin
**典型工具**：`git` / `cargo` / `npm` / `kubectl`

```typescript
interface CliCommand {
  // 1. 命令定义
  command: string              // "git status" / "cargo build --release"
  args: Argument[]

  // 2. 标准流
  stdin: "ignored" | "consumed" | "piped"

  // 3. 输出
  stdout: TextFormat
  stderr: TextFormat
  exitCode: 0 | 1 | 2          // 0 成功 / 1 通用错 / 2 用法错

  // 4. 异步性 & 状态
  async: "sync"                // CLI 通常同步
  state: "stateless"           // 每次调用独立

  // 5. 生命周期
  init(): void                  // 读配置 / 检查环境
  destroy(): void               // 清理临时文件
}
```

**Argument 规范**：

```typescript
interface Argument {
  name: string                 // 形参名
  flag: string                 // "-v" | "--verbose" | "-v, --verbose"
  type: "bool" | "string" | "number" | "path"
  required: boolean
  default?: any
  description: string          // 帮助文档
}
```

**exit code 约定**：

| Code | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 通用错误 |
| 2 | 用法错误（参数错） |
| 64–113 | 用户定义的错误（避免冲突 0–63） |
| 130 | 用户 Ctrl-C 中断（SIGINT） |

**反模式**：

- 单命令承担多任务（"npm install" 里塞了 10 种语义） → 应该拆子命令
- 输出非结构化（"看屏幕"才能判断结果） → 应该结构化（JSON / 错误码）
- 静默吞错（exit 0 但 stderr 有报错） → 让 exit code 反映真实结果

### Daemon 应用

**触达方式**：网络请求 / IPC / 消息
**典型协议**：HTTP / gRPC / WebSocket / TCP 自定义

```typescript
interface DaemonEndpoint {
  // 1. 端点定义
  protocol: "HTTP" | "gRPC" | "WebSocket" | "TCP"
  method: "GET" | "POST" | "PUT" | "DELETE" | ...    // HTTP 特有
  path: "/api/users/:id"

  // 2. 请求
  request: {
    path?: Record<string, string>    // 路径参数：/users/:id → { id }
    query?: Record<string, any>       // 查询参数：?limit=10
    headers?: Record<string, string>
    body?: Schema
  }

  // 3. 响应
  response: {
    200: User                        // 状态码 → 响应体
    201: User                        // 创建成功
    400: ErrorBody                   // 参数错
    401: ErrorBody                   // 未鉴权
    404: ErrorBody                   // 资源不存在
    500: ErrorBody                   // 服务端错
  }

  // 4. 鉴权
  auth?: "None" | "Bearer" | "APIKey" | "OAuth2" | "mTLS"

  // 5. 异步性 & 状态
  async: "sync" | "async" | "streaming"   // HTTP 通常 sync，WebSocket 是 streaming
  state: "stateless" | "read-only" | "read-write"  // 影响幂等性

  // 6. 生命周期
  init(): void                  // 启动监听 / 准备连接池
  destroy(): void               // 优雅关闭 / 排空 in-flight 请求
}
```

**HTTP 状态码约定**（最小集）：

| 范围 | 类别 |
| --- | --- |
| 2xx | 成功（200 OK / 201 Created / 204 No Content） |
| 3xx | 重定向（301 / 304） |
| 4xx | 客户端错误（400 / 401 / 403 / 404 / 409 / 429） |
| 5xx | 服务端错误（500 / 502 / 503 / 504） |

**ErrorBody 推荐格式**：

```typescript
interface ErrorBody {
  code: string                  // 机器可读的错误码，如 "USER_NOT_FOUND"
  message: string               // 人类可读的描述
  details?: Record<string, any> // 附加上下文
  request_id?: string           // 关联到日志 / 追踪
}
```

**反模式**：

- 端点承担多任务（一个 POST 做 5 种事） → 应该拆 endpoint
- 状态码乱用（200 但响应里塞错误） → 用 4xx / 5xx 真实反映
- 没有错误体结构（响应是字符串） → 用结构化 ErrorBody
- 鉴权写在每个端点里（不统一） → 用中间件 / 网关层
- 长操作不返回（用户不知道何时完成） → 返回 job_id 让客户端轮询 / 用 WebSocket

### GUI 应用

**触达方式**：用户事件
**典型框架**：React / Vue / Flutter / Qt / SwiftUI

```typescript
interface GuiComponent {
  // 1. 组件定义
  component: string              // "UserListPanel"

  // 2. 事件处理（输入）
  events: {
    onUserClick(userId: string): void
    onRefresh(): void
    onKeyPress(key: string): void
  }

  // 3. 状态（输入 + 输出）
  state: {
    users: User[]                // 组件内状态
    selectedId?: string          // 受控状态
    // 全局状态从外部注入，参考 props
  }

  // 4. 渲染（输出）
  render: () => ComponentTree    // 或 JSX / SwiftUI View 等

  // 5. 异步性 & 状态
  async: "callback"              // GUI 事件都是 async
  state: "read-write"            // 通常修改内部状态

  // 6. 生命周期
  init(): void                  // 挂载时（componentDidMount）
  destroy(): void               // 卸载时（componentWillUnmount）
}
```

**状态管理的常见模式**：

| 模式 | 适用 |
| --- | --- |
| **本地 state**（useState）| 组件独享、不跨组件共享 |
| **提升 state**（props + callback）| 父子组件共享 |
| **全局 state**（Redux / Vuex / Zustand）| 多组件共享、复杂状态机 |
| **服务端 state**（React Query / SWR）| 异步数据，缓存 + 重新拉取 |

**反模式**：

- 巨型组件（一个文件 1000+ 行） → 按职责拆组件
- 状态散落（10 个 useState 互相耦合） → 用 reducer / 状态机
- 事件 handler 里直接写业务逻辑 → 提取到 service / store
- 不区分受控 vs 非受控 → 状态来源混乱
- 异步操作没取消（unmounted 后还在 setState） → 用 AbortController / cleanup

## 选择哪种形式？

按程序类型选：

| 程序类型 | 接口形式 | 实际工具 |
| --- | --- | --- |
| **CLI** | `command` + `args[]` + `stdio` + `exitCode` | clap / argparse / commander |
| **Daemon** | `endpoint` + `request` + `response{状态码:响应体}` | OpenAPI / gRPC proto |
| **GUI** | `component` + `events{}` + `state` + `render` | React props / SwiftUI |
| **库 / 模块** | `function()` + `input types` + `return types` | TypeScript interface / Rust trait |

## 接口与链路的关系

每个接口 = 1 条调用链的实现路径：

```
接口 = 契约
   ↓
链路（calltree）= 接口的实现路径
   ↓
触发点 = 接口被调用
终止 = 接口返回 / 通知
```

**接口先于链路**：先定接口契约，再为每个接口设计实现链路。
**链路不暴露于接口**：链路的内部细节（state、handler、event source）由调用方通过接口看到。

## 跟 derivation 的衔接

在 [derivation.md](derivation.md) 中：

- **第 1 步：需求 → 对外接口** — 用本文档的格式表达每个接口契约
- **第 2 步：对外接口 → 端到端链路** — 为每个接口设计 calltree，触发点 = 接口被调用

## 自检

- [ ] 每个接口都有完整的 4 要素（输入 / 输出 / 失败 / 生命周期）？
- [ ] 异步性明确（sync / async / callback / streaming）？
- [ ] 状态交互明确（stateless / read-only / read-write）？
- [ ] CLI 接口有完整的 args 规范和 exit code ？
- [ ] Daemon 接口有完整的状态码 + 结构化 ErrorBody？
- [ ] GUI 接口有完整的事件 + state + render + 生命周期？
- [ ] 接口之间互相独立（不引用未定义的东西）？
- [ ] 没有实现细节泄漏到接口（数据结构 / 内部状态名）？

任何一项不满足，去查 [典型反模式](anti-patterns.md)。

## 一句话

> **接口契约 = 四要素（输入/输出/失败/生命周期）+ 两属性（异步性/状态交互）；形式按程序类型扩展，但骨架共通。**