

```calltree
src/daemon/loop.rs/start_server()
    src/utils/logger.rs/init_logger()
    src/config/load_config()
        load_from_file(char* file)
        src/config/env.rs/load_from_env()
    if arg_quick==0:
        flavor = quick_flavor()   // 使用快处理 flavor
    else:
        flavor = defalut
    /* 初始化数据库连接池子 */
    ...
    loop:
        select!:
            server_fd // server
            worker_fd // worker channel
    loop.rs/clear_resource()
        utils/logger.rs/flush_logs()
```