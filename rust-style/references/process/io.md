# IO 连接的深度管理 (Rust)

> 模块层 R3/4 与 `../module/patterns.md` 给出的是**单连接层**的骨架：create 纯装配、connect 启动、close 显式清理。真实世界的连接还会**静默死亡**（半开连接）、**被共享**（池与租约）、**被复用**（毒化）、**被强杀**（有序关闭）。本章讲骨架之上的这四层。子进程、线程、tokio task 的同类善后，见 `supervision.md`。

核心认知：**IO 的本质是变量赋值**——读文件、收网络包、查数据库，剥去外壳都是把外部状态搬进进程内的某个变量。连接就是对这条赋值通道的**受控租约**：状态分布在两端——fd 在内核、TCP 状态在对端、会话在服务器。所有权与 Drop 只管理进程内的一半；另一半要靠协议、超时与重试去「协商」。

---

## 1. 三个不对称：IO 管理难在哪

| 不对称 | 含义 | 推论 |
| --- | --- | --- |
| 释放 ≠ 善终 | Drop 只保证「不再占用」，不保证 fsync / 优雅 FIN / TLS close_notify | 清理本身需要 IO → 只能显式 close（模块层 R3） |
| open ≠ close | open 立刻报错；close 是**可能失败且带意图**的操作 | commit / rollback 是业务决策，塞不进析构函数 |
| 看似开着 ≠ 真的活着 | 半开连接：本端 ESTABLISHED，对端早已不在 | 必须主动探活，见下节 |

---

## 2. 半开连接：你以为开着，对面已经死了

**成因**：对端 crash / 重启；中间的 LB / NAT / 防火墙静默掐掉空闲连接（AWS NLB 的 350s idle timeout 是经典案例）；网段切换。

**为什么 TCP 自己发现不了**：

- `write` 常常**先成功**——数据只是进了本地发送缓冲。有 RST 回来时，也要下一次往返才报错，「第一次写成功、第二次写失败」是常态；纯静默丢包时更糟，要等 TCP 重传超时（默认可达十几分钟）才报错。
- 对端已死且无数据可发时，`read` 可以**无限期挂住**。
- TCP keepalive 默认 **2 小时**后才探测，等于没有。

**对策按层**：

| 层 | 手段 | 说明 |
| --- | --- | --- |
| 应用层 | 心跳 / 协议 ping | 最可靠：只有「往返成功」才能证明活着 |
| TCP 层 | `SO_KEEPALIVE` + 显式调短 | Linux 默认 7200s；用 socket2 设 30s、间隔 10s |
| 调用层 | connect/read/write 各自 deadline | 无超时的 IO = 把进度交给对端 |
| 池层 | checkout 校验（如 `SELECT 1`） | 代价是每次借出多一个往返，与心跳二选一 |

```rust
// 心跳循环：探不到就换，不恋战
loop {
    sleep(HEARTBEAT_INTERVAL).await;
    match timeout(HB_TIMEOUT, conn.ping()).await {
        Ok(Ok(())) => {}               // 往返成功 → 活着
        _ => { conn.poison(); break; } // 探不到 → 毒化、丢弃、换新连接
    }
}
```

**发现断了之后——先分类，再处理**：

| 类别 | 例子 | 处理 |
| --- | --- | --- |
| 可重试 | timeout、connection reset、池空超时 | 退避 + 抖动重试；**前提是操作幂等** |
| 不可重试 | 认证失败、协议错误、参数错 | 立刻上抛；重试只是把一个错误变成一百个 |

> 超时的**写**请求处于「可能已送达、可能没送达」的叠加态：非幂等操作不可盲目重试——要么带幂等键，要么放弃重试改对账。

---

## 3. 池：两层生命周期

连接池把生命周期拆成两个尺度：**池**（长，进程级）持有物理连接，调用方拿到的是短命的**租约**。

```rust
// 调用方视角：RAII——拿就用，用完自动还
let mut conn = pool.acquire().await?;   // 租约开始
conn.query("…").await?;
// drop(conn) → 归还（或毒化丢弃），而不是关 socket
```

```rust
// 租约的 Drop 语义 = 归还：无条件、不会失败
// ——这是 Drop 语义可以合法重载的少数场景
pub struct Lease<'p> { pool: &'p PoolInner, conn: Option<Conn> }

impl Drop for Lease<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            if conn.poisoned { /* 关闭丢弃 */ } else { self.pool.put_back(conn); }
        }
    }
}
```

池替调用方处理单连接层管不了的事：

- **max_lifetime**：连接定期换血。长连接撞上中间设备的 idle 超时是静默的——与其等它死，不如自己先换。
- **空闲驱逐 + 后台健康检查**：把「发现半开」从请求路径挪到后台。
- **有界容量 = 准入控制**：池满了排队还是 fail-fast，是容量设计决策，不是实现细节。

---

## 4. 毒化：宁浪费，不污染

async 中一个 future 在 send 中途被 drop（外层超时、`select!` 分支切换），连接状态**未知**——可能只写了半条消息。复用它，等于让后面每一个请求继承一个坏连接：

```rust
async fn call(&mut self, req: Req) -> Result<Rep, ConnError> {
    match timeout(OP_TIMEOUT, self.exchange(req)).await {
        Ok(r) => r,
        Err(_elapsed) => {
            self.poisoned = true;   // 半条消息可能已发出：不可复用
            Err(ConnError::Timeout)
        }
    }
}
```

- 同步世界的对应物：事务中途 panic → 必须 rollback 而不是 commit。
- 判断标准：**任何「中途中断」都毒化**；只有完整走完协议回合的连接才可归还。
- 这是 IO 管理与内存管理心态上最大的差异：内存坏了进程崩；连接坏了会**静默腐蚀**后续每一个请求。

---

## 5. 时间维度：每个环节一个 deadline

| 超时 | 管什么 | 建议 |
| --- | --- | --- |
| connect | 对端不可达 | 秒级，通常 1–5s |
| read/write | 单次操作 | 依协议 RTT 定，但必须有 |
| heartbeat | 探活 | 间隔 < 中间设备 idle 超时的一半 |
| drain | 优雅关闭的排空 | 进程级（如 30s），必须可配置 |
| op | 业务整体预算 | 外层总预算，内层超时才有意义 |

> 内层超时 + 外层无限等待 = 没有超时。deadline 要从入口一路传下去。

---

## 6. 有序关闭：关闭是过程，不是调用

进程级 shutdown 是启动的**逆序**（级联销毁）：

1. 停止接入（关 listener，但不关已建连接）；
2. **带截止时间**排空在途请求；
3. 关闭空闲连接；
4. 截止时间到，强制收尾（丢弃 / 回滚未完成事务）；
5. flush 日志与指标，最后退出。

每一步都可能被卡死的 peer 挂住，所以每一步都要有超时。K8s 的 preStop + SIGTERM + terminationGracePeriodSeconds，本质就是给这个过程一个外部的 deadline 保证。

---

## 自查（IO 层）

- 所有 connect/read/write 都有 deadline 吗？有没有「无限期等待」的调用？
- 有应用层心跳或调短的 TCP keepalive 吗？心跳间隔是否小于中间设备 idle 超时的一半？
- 池里的连接有 max_lifetime 吗？checkout 校验或后台健康检查，二者居其一了吗？
- 超时 / 中断后的连接是毒化丢弃，还是被归还复用了？
- 重试前判断过幂等和错误类别吗？
- shutdown 是带 deadline 的有序排空，还是一刀切退出？
