# 插件采用 Component Model 后端与受信任 React 前端

用户明确启动通用插件平台开发；这不改变网易云优先或独立播放核心的边界，也不引入多流媒体来源框架。

后端采用 Wasmtime 46.0.1 与版本化 WIT，保持项目 Rust 1.95。Guest 不链接通用 WASI，通过带身份、权限及加载代次的高层 Host Capability 复用网易云 Client 和播放命令队列。线性内存、fuel、epoch、墙钟期限、请求数量与有效载荷分别有界；错误实例撤销贡献，普通业务错误保留实例。

React ui.mjs 通过受控资源协议动态导入，公开 SDK 及 React 使用宿主 singleton。现有导航历史承载 `/plugins/<id>/*`，无需替换播放器导航。页面与覆盖层由 Manifest registry 驱动，不内置灵动岛组件或网易云示例页。

同一 WebView 中的前端是受信任代码，SDK 约束不能作为对恶意 JS 的安全沙箱；已执行代码和 ESM 缓存不可强制撤销。若未来支持不可信前端，应另行决定隔离 WebView／iframe 与跨进程协议，而不是扩大当前权限声明的承诺。详细接口、限额、构建与限制见 [插件开发与使用](../plugins.md)。
