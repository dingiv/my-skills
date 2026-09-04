# 常量与控制流数据化 (Rust)

> 对应代码层 **R2**（常量与命名）与 **R3**（控制流数据化）。代码层关注函数 / 表达式级的微观决策，是模块层（trait / 生命周期 / 作用域）的地基——变量放哪、依赖怎么传（模块层）之前，先得把单个表达式写对。

## R2 常量与命名：消灭魔法数字

**魔法数字** = 直接出现在逻辑里的裸字面量，其含义只能靠上下文猜。三个代价：语义不可见（读者要回看注释）、改一处漏多处（同一个值散落多处，改一漏三）、无法表达量纲（`1000` 是毫秒还是秒？）。

**原则：出现在业务逻辑里的每个数字，先问「它是什么」，再给它命名。**

- **命名常量**：编译期定值用 `const`，需运行期初始化（但只读）用 `static` + `Lazy` / `OnceLock`。
- **量纲 / 单位**：用 newtype 编码，让「米」和「秒」在类型上不可混。
- **档位 / 枚举值**：用 `enum` 而非裸数字，让「不合法的值」在类型上不存在。

```rust
// ❌ 错：裸数字散落，含义靠猜
if elapsed > 3600 {
    retry(3, 100);
}
let buf = vec![0u8; 4096];

// ✅ 对：命名常量，语义自明
const MAX_SESSION_SECS: u64 = 3600;
const MAX_RETRIES: u32 = 3;
const RETRY_BACKOFF_MS: u64 = 100;
const BUF_SIZE: usize = 4096;

if elapsed > MAX_SESSION_SECS {
    retry(MAX_RETRIES, RETRY_BACKOFF_MS);
}
let buf = vec![0u8; BUF_SIZE];
```

进阶——量纲用类型编码，让单位错误在编译期暴露：

```rust
struct Millis(u64);
impl Millis {
    fn as_secs(self) -> u64 { self.0 / 1000 }
}
const TIMEOUT: Millis = Millis(3000);   // 而不是裸 3000
```

**何时允许裸数字**（其余一律命名）：

- `0` / `1` 且语义就是下标或标志（`i + 1`、`vec[0]`、`retry_count > 0`）。
- 纯数学常量（`2 * x`、`x / 2`）。
- 测试断言里与被测值显然对应的字面量。

> 命名常量的归属遵循模块层 **R5/R6**（作用域）：只在单函数内用的常量放函数顶部；跨函数共享的放模块顶部 `const`；进程级配置放 `main` 注入，不进 `static`。

---

## R3 控制流数据化：长分支改查表

长 `match` / `if-else` 链，当**分支体同质**（每分支只是同一类操作换了参数 / 动作）时，其实是用控制流表达了数据。改写成**查表 + 数据驱动**后，新增分支 = 新增一行数据，而非改动函数体——分发逻辑保持稳定。

判断标准：**分支体是否同质？**

- 同质（都是「调某个动作」/「查某个表」/「设某个字段」）→ 改查表。
- 异质（各分支逻辑实质不同、长度不一）→ 保留 `match`，强行查表只是把 `match` 换成函数指针数组，可读性未必提升。

```rust
// ❌ 错：按命令分发，每加一个命令都要改这个 match
fn exec(cmd: &str, state: &mut State) -> Result<(), Error> {
    match cmd {
        "move" => state.move_(),
        "jump" => state.jump(),
        "save" => state.save(),
        "load" => state.load(),
        "quit" => state.quit(),
        _ => return Err(Error::Unknown),
    }
}
```

```rust
// ✅ 对：查表——新增命令 = 加一行，exec 不动
// 查表数据是常量，归位到模块顶部，不散在函数体
static DISPATCH: &[(&str, Action)] = &[
    ("move", Action::Move),
    ("jump", Action::Jump),
    ("save", Action::Save),
    ("load", Action::Load),
    ("quit", Action::Quit),
];

fn exec(cmd: &str, state: &mut State) -> Result<(), Error> {
    let action = DISPATCH
        .iter()
        .find(|(name, _)| *name == cmd)
        .map(|(_, a)| *a)
        .ok_or(Error::Unknown)?;
    action.run(state)
}
```

要点：

- 查表数据本身是常量（`&[&str, Action]`），归位到模块顶部或独立模块——别散在函数体（呼应 R2 的常量归属）。
- 这是「面向数据」在控制流上的体现：把「该做什么」从控制流挪到数据，让数据可枚举、可扩展、可单测（直接断言 `DISPATCH` 的内容）。

---

## 自查（代码层 R2 / R3）

- 业务逻辑里的每个数字都命名了吗？量纲 / 档位用类型编码了吗？
- 命名常量放对作用域了吗（函数内 / 模块级 / main 注入）？
- 长 `match` / `if-else` 的分支体是否同质？同质的改查表了吗？查表数据是常量吗？
