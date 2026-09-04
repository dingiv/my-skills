# vLLM EngineCore 主循环

入口：`EngineCoreProc.run_busy_loop`，位于 `vllm/v1/engine/core.py:1410`。

> 注意：vLLM 引擎主循环**不在**前端进程，而在 EngineCore 后台进程——它通过 ZMQ 与 `AsyncLLM` / `LLMEngine` 通信。这份 calltree 描述的是后台进程那一端。

```calltree
/* Entry：EngineCore 后台进程的主循环（vllm/v1/engine/core.py:1410） */
vllm/v1/engine/core.py/run_busy_loop()                  // core.py:1410, EngineCoreProc.run_busy_loop
    core.py/_handle_shutdown()                          // core.py:1492, 检查 shutdown_state
                                                          //   timeout=0 → abort 所有 in-flight reqs
                                                          //   timeout>0 → drain，等 reqs 自然完成
    core.py/_process_input_queue()                      // core.py:1437, 空闲时阻塞等输入
        loop:                                            // 把队列里所有 pending req 都消化完
            core.py/_handle_client_request()            // core.py:1540, 按 EngineCoreRequestType 分发
                if ADD:
                    core.py/EngineCore.add_request()                   // core.py:452
                        vllm/v1/core/sched/scheduler.py/Scheduler.add_request()  // 入 waiting queue
                else if ABORT:
                    core.py/EngineCore.abort_requests()                  // core.py:498
                else:
                    ...                                          // START_DP_WAVE / UTILITY / EXECUTOR_FAILED
    core.py/_maybe_publish_request_counts()              // core.py:1424, 仅 DP 负载均衡模式才上报
    core.py/_process_engine_step()                      // core.py:1468, 走一步 scheduler → executor
        core.py/step_fn()                               // = step 或 step_with_batch_queue（PP 变体）
            vllm/v1/core/sched/scheduler.py/Scheduler.schedule()       // scheduler.py:509, 拼这一轮的 batch
            vllm/v1/executor/abstract.py/Executor.execute_model()     // forward, 非阻塞 Future
            vllm/v1/core/sched/scheduler.py/Scheduler.get_grammar_bitmask()  // structured output 约束
            vllm/v1/executor/abstract.py/Executor.sample_tokens()    // logits 上采样
            vllm/v1/core/sched/scheduler.py/Scheduler.update_from_output()  // scheduler.py:1810, 落 token id
        output_queue.put_nowait(output)                 // 经 ZMQ 推到 frontend
        core.py/post_step()                              // core.py:629, async-schedule 钩子
    /* —— 回到 while 顶部 —— */
```

## 怎么读

1. **整个循环 = 「处理输入 → 走一步」**。EngineCore 没有传统意义的 `main()`——它本身就是这个 while 循环的代名词。
2. **`_process_input_queue` 是阻塞入口**：有活就干，没活就睡；输入端把 ADD / ABORT 等命令塞进 `input_queue`。注意它内部还有个二次 drain——队列非空时一次性把剩下的都吃掉。
3. **`_process_engine_step` 是核心**：scheduler 拼 batch → executor 跑 forward（**非阻塞**）→ 等 forward 完成 → sample token → scheduler 把 token 落到 running queue → 经 `output_queue` + ZMQ 推回 frontend。
4. **`_maybe_publish_request_counts` 是 DP 旁路**：单引擎看不到它生效，只有 DP 负载均衡模式才上报 scheduler 状态。
5. **`_handle_shutdown` 控制退出**：timeout=0 → 立即 abort in-flight reqs；timeout>0 → drain 模式，等所有 reqs 自然完成再退出。
6. **`.py/` 路径在同文件内的方法省略了 `vllm/v1/engine/`**——这与 `server.md` 示例中 `loop.rs/clear_resource()` 的省略规则一致。

## 故意没画的

- ZMQ socket 的创建、绑定、序列化（属于 `core_client.py` 的传输层，不是循环本身）。
- DP coordinator 的协议细节（仅在 DP>1 时生效，且只通过 `START_DP_WAVE` 间接影响主循环）。
- `step_with_batch_queue` 与 `step` 的差别（PP 流水线并行执行），只在 pipeline parallel 部署下相关。
- `post_step` 内部的具体钩子（async-schedule 专用，对主循环结构无影响）。
