# vLLM 一次请求的处理链路

入口：`AsyncLLM.generate`，位于 `vllm/v1/engine/async_llm.py:618`。

> 本节包含**三个视角**：
> - **调用方视角**：`generate()` 自身在前台等 token、推回调用方。
> - **后台 pump**：`output_handler` 把 EngineCore 输出搬进 per-request 队列（与 generate() 并发）。
> - **EngineCore 视角**：本请求在 EngineCore 内部的 KV cache 生命周期——跨多个主循环迭代，frontend 不可见，但决定了请求何时被调度、能不能 decode、什么时候释放显存。

## 调用方视角：`generate()` 自身

```calltree
vllm/v1/engine/async_llm.py/AsyncLLM.generate()        // async_llm.py:618, API 入口，返回 AsyncGenerator
    async_llm.py/AsyncLLM.add_request()                  // async_llm.py:341
        async_llm.py/AsyncLLM.check_admission()          // async_llm.py:282, 限流 max_num_queued_reqs/tokens
        vllm/v1/engine/input_processor.py/InputProcessor.process_inputs()  // input_processor.py:281
            ...                                              // 校验参数、tokenize、建 EngineCoreRequest
        vllm/v1/engine/output_processor.py/OutputProcessor.add_request()  // output_processor.py:557
            ...                                              // 建 RequestState + 每 req 一个 RequestOutputCollector 队列 q
        vllm/v1/engine/core_client.py/AsyncMPClient.add_request_async()  // core_client.py:1149, 经 ZMQ 推给 EngineCore
    /* —— 此刻请求已在 EngineCore 的 waiting queue，generate() 进入消费循环 —— */
    loop:                                                 // async_llm.py:672, 一个 token 一个 token 推回
        out = q.get_nowait() or await q.get()             // async_llm.py:675, 优先非阻塞
        yield out                                          // RequestOutput 推回调用方
        if out.finished:
            return
```

## 后台 pump：把 EngineCore 输出搬进 `q`（与 `generate()` 并发）

```calltree
vllm/v1/engine/async_llm.py/_run_output_handler()       // async_llm.py:733, 启动 output_handler task
    loop:                                                 // async_llm.py:756, 每 AsyncLLM 实例一个后台 task
        vllm/v1/engine/core_client.py/AsyncMPClient.get_output_async()  // 从 ZMQ 拿 EngineCoreOutputs
        vllm/v1/engine/output_processor.py/OutputProcessor.process_outputs()  // output_processor.py:621
            for each EngineCoreOutput:
                vllm/v1/engine/detokenizer.py/IncrementalDetokenizer.update()  // 增量 detokenize + 停词检查
                ...                                              // logprobs / structured output 处理
                vllm/v1/engine/output_processor.py/RequestState.make_request_output()  // output_processor.py:283
                q.put(request_output)                     // 推给 generate() 在等的那个队列
                if finished:
                    q.put(STREAM_FINISHED)
```

## EngineCore 视角：本请求的 KV cache 生命周期

**这是跨多个 EngineCore 主循环迭代的故事**，时间线：`add_request` 入队 → 等若干轮直到被 schedule 选中 → running 后每轮续 block → 结束时 free。frontend 看不到这些，但 KV 决定了请求何时被调度、能不能继续 decode、什么时候释放显存。

```calltree
/* —— 入队：仅入队，KV 延迟分配 —— */
vllm/v1/core/sched/scheduler.py/Scheduler.add_request(req)        // scheduler.py:2397
    /* 仅入 waiting queue；KV 延迟到 schedule() 时分配 */

/* —— 调度：本请求被 schedule() 选中（从 waiting 转入 running） —— */
vllm/v1/core/sched/scheduler.py/Scheduler.schedule()             // scheduler.py:509
    scheduler.py/_get_local_prefix_cache_hit(req)                // scheduler.py:853
        vllm/v1/core/kv_cache_manager.py/KVCacheManager.get_computed_blocks()
        /* 查最长前缀缓存命中；命中的 block ref-count+1，不重新分配 */
    scheduler.py/allocate_slots(req, new_computed_blocks=...)    // scheduler.py:1085
        vllm/v1/core/kv_cache_manager.py/KVCacheManager.allocate_slots()
        if None:
            scheduler.py/_preempt_request(req)                   // scheduler.py:1413
            /* block 耗尽：抢别人的 block 让位；本 req 被踢回 waiting，block 立即归还 pool */

/* —— running 期间：每轮 schedule() 都给本请求续 block —— */
    scheduler.py/allocate_slots(req, ...)                        // scheduler.py:666
        /* decode 阶段每轮 +1 token；prefill 阶段一次申请全部 */

/* —— forward pass：worker 读自己持有的 self.kv_caches —— */
vllm/v1/worker/gpu_model_runner.py/GPUModelRunner.execute_model(scheduler_output)
    /* K、V tensor 住在 self.kv_caches 里（每个 worker 进程 / GPU 一份） */
    /* block_id 经 SchedulerOutput 流到这里，按 block_id 索引 K、V 段 */

/* —— 结束：自然完成 / abort / 抢占都触发 free —— */
vllm/v1/core/sched/scheduler.py/Scheduler.finish_requests(reqs, status)  // scheduler.py:2425
    scheduler.py/_free_request(req)                                  // scheduler.py:2488
        vllm/v1/core/kv_cache_manager.py/KVCacheManager.free(req)
        /* 归还 block 到 pool */
        /*   prefix cache 命中的 block 保留 ref，不真释放 —— 留给后续复用 */
```

## 怎么读

1. **三视角拼起来才完整**：调用方（前台 yield）+ 后台 pump（搬运输出）+ EngineCore KV（资源生命周期）——三块缺一不可。少了 EngineCore 视角看不懂请求在 EngineCore 里经历了什么；少了后台 pump 看不懂 token 怎么回到 caller。
2. **两条链并发**：调用方视角里 `generate()` 在前台等 `q.get()`，后台 pump 视角里 `output_handler` 在后台往 `q` 写。两者通过 per-request `RequestOutputCollector` 队列会合。
3. **真正的「调度 → forward → sample」在 EngineCore 的主循环里完成**（见 `engine_loop.md`）；前两个视角只画 frontend 看到的两端。前端不直接调用 scheduler 或 executor。
4. **一个 token 的完整旅程**：`EngineCore.step` 产出 → ZMQ → `output_handler.process_outputs` → detokenize → 写 `q` → `generate()` 读到 → `yield` 给调用方。
5. **KV 分配是延迟的**：`Scheduler.add_request` 只入队，请求在 `waiting` 期间**不占 KV**——这是 vLLM v1 的关键设计，让 `waiting` 队列容量可以远大于 KV 容量。
6. **Prefix cache 优先于分配**：调度的第一步是 `_get_local_prefix_cache_hit`——若 prompt 前缀命中已缓存 block，直接复用、`ref-count+1`，不重新分配。
7. **分配失败 → 抢占**：`allocate_slots` 返回 `None` 时触发 `_preempt_request`——把一个 running req 踢回 waiting queue，**它的 KV block 立即归还 pool**，让本请求拿。
8. **KV 物理位置在 worker**：`self.kv_caches` 是每个 worker 进程 / GPU 持有的 K、V tensor 列表（GPU 显存）；`SchedulerOutput` 只携带 `block_id`，模型执行时按 `block_id` 索引对应 tensor 段。
9. **结束路径三合一**：自然完成 / abort / 抢占都走 `finish_requests → _free_request → kv_cache_manager.free` 同一路径。区别仅在 `RequestStatus` 与 `defer_block_free` 时机。
10. **`q.get_nowait() or await q.get()` 是性能细节**：优先非阻塞拿，避免 asyncio task 切换带来的开销；拿不到再 `await` 阻塞。

## 故意没画的

- ZMQ socket 创建、消息序列化、`EngineCoreRequest` 的 schema——属于 `core_client.py` 传输层。
- Tokenize / detokenize 的具体算法——只是调用接口，不影响链路结构。
- `logprobs` / `structured_output` / `parallel_sampling` 的具体分支——它们都在 `...` 里。
- DP 模式下 `add_request_async` 的 load-balancing 路由（`DPLBAsyncMPClient`）——只影响请求落到哪个 engine，不影响链路结构。
- 错误路径（OOM、worker 崩溃、abort 传播）——主链之外。
- DP 模式下跨 engine 的 KV 传输（`_take_kv_cache_block_copies`、remote prefix hit 的 sub-block 尾部）。
- block_pool 的具体数据结构（`FreeKVCacheBlockQueue`、hash 表）。
- `update_from_output` 里 `remove_skipped_blocks` 的滑动窗口裁剪。
- `evict_blocks` 的手动驱逐路径。
