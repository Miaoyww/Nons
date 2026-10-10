# 网易云音乐适配器

`nons-adapter-netease` 是默认随包提供的受信任原生 Rust 适配器库。宿主通过 `MusicAdapter` 调用搜索、内容浏览、账号、曲库、收藏、歌单编辑、推荐、私人 FM、单曲与播放解析；平台 SDK、协议与响应转换均在本包。

依赖共享后端契约 `packages/music-adapter-sdk` 和本包的 `vendor/ncm-api-rs`，不依赖宿主 crate、Tauri、AccountManager、SQLite 或系统凭据库。账号数据通过宿主绑定的 `ProviderAccounts` 读取；凭据完成结果交回宿主，不独立保存凭据。固定上游及有界 HTTP 补丁见 [PATCHES](vendor/ncm-api-rs/PATCHES.md)。

独立验收：

```powershell
cargo test --manifest-path adapters/netease/Cargo.toml --locked
```

这是原生库源码包，随宿主编译和链接；升级版本需要重新构建应用。它不是阶段四的 WASM Component，不可通过功能插件 ZIP 安装，不具有 WASM 隔离或运行时卸载原生代码的能力。设置停用与重载撤销管理器代次和凭据访问，保留原生代码及共享连接池。详细修改记录、缓存与验收范围见 [适配器文档](../../docs/music-adapters.md)。
