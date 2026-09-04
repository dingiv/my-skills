# 测试：这套风格的直接收益 (Rust)

## trait 即 mock 接口

模块层 R1（trait 公开，struct 不公开）意味着：**写 mock 不需要 mocking library，实现 trait 即可**。

```rust
// 为测试实现一个 mock
struct MockLoader { data: Vec<Item> }

impl Loader for MockLoader {
    fn load(&mut self, _key: &str) -> Result<Vec<Item>, LoadError> {
        Ok(self.data.clone())
    }
    fn cache_size(&self) -> usize { 0 }
}

#[test]
fn test_with_mock() {
    let mut loader = MockLoader { data: vec![Item::default()] };
    let result = loader.load("any").unwrap();
    assert_eq!(result.len(), 1);
}
```

> 不需要 `mockall` 或 `mock!` 宏——为 trait 手写一个测试用的 struct 就是 mock。

## 纯 create → 零串味

模块层 R4（create 纯装配）和模块层 R5（局部作用域）意味着：每个测试用例创建独立实例，互不污染。

```rust
#[test]
fn test_isolated() {
    let mut loader = create_loader(/* … */);  // 全新实例
    // 上一个用例的状态不残留
}
```

> 对比 `lazy_static! { static ref CACHE: Mutex<...> }`：测试间共享全局状态，用例顺序敏感，难以调试。

## Result → 断言失败路径和成功路径一样简单

```rust
#[test]
fn handles_error() {
    let result = fallible_operation("bad");
    assert!(result.is_err());
    // 不需要 #[should_panic]，也不需要 catch_unwind
}

#[test]
fn handles_success() {
    let result = fallible_operation("good");
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 3);
}
```

## 显式生命周期 → 测试天然隔离

```rust
#[test]
fn lifecycle_isolation() {
    let mut pool = create_pool(":memory:", 2);
    pool.connect().unwrap();

    // … 使用 …

    pool.shutdown().unwrap();
    // 连接被关闭，下一个用例从零开始
}
```

## 脏函数分类 → 测试策略

| 形态 | Rust 测试策略 |
| --- | --- |
| 隐式参数（读 static） | 参数化后传替身 |
| 修改参数（`&mut`） | 检查返回值差异（如果返回新值则不需要验证 &mut 的副作用） |
| IO 函数 | 换一个不用真实 IO 的 trait 实现 |

## 完整测试示例

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_data_on_second_call() {
        let client = MockClient::new(vec![Item::new("a"), Item::new("b")]);
        let mut loader = create_loader(client);

        let r1 = loader.load("k1").unwrap();
        let r2 = loader.load("k1").unwrap();
        assert_eq!(r1, r2);
        assert_eq!(loader.cache_size(), 1); // 只缓存了一次
    }

    #[test]
    fn returns_error_for_invalid_key() {
        let client = MockClient::failing();
        let mut loader = create_loader(client);
        let result = loader.load("");
        assert!(result.is_err());
    }

    #[test]
    fn isolates_state_between_tests() {
        let mut loader = create_loader(MockClient::empty());
        assert_eq!(loader.cache_size(), 0); // 全新的 loader
    }
}
```
