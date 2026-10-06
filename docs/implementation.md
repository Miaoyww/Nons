# 初始框架实现与验证

## 开发运行

Windows x64：需要 Rust 1.95、MSVC 工具链、Node/pnpm、Python，以及 Tauri 的 WebView2 环境。

```powershell
cd app
pnpm install --frozen-lockfile
cd ..
python scripts/bootstrap-gstreamer.py
./scripts/native.ps1 -Task dev
```

依赖脚本从官方 PyPI 获取固定版本 1.28.7 的 GStreamer wheel，校验 SHA256 后只解压到忽略目录 `.local/gstreamer`，用现有 MSVC 工具生成 Rust 链接所需 import libraries。不会运行安装程序，也不会永久更改系统环境。此完整开发运行时约 252.3 MiB，包含开发工具及额外插件，不能当作最终安装包体积。

`native.ps1 -Task check|test|clippy` 为当前进程设置原生依赖路径。发布打包尚未接通，`-Task build` 会明确拒绝执行，避免生成遗漏 DLL 的安装包。Cargo.lock 暂将 kstring 固定到 2.0.2；更新依赖时遵守 manifest 的 Rust 1.95 最低版本。

## 模块

- `model.rs` 定义歌曲、本地/网易云资源和播放状态；当前没有多来源插件框架。
- `player.rs` 单线程拥有 GStreamer playbin3、设备监视和 SMTC；有界命令队列、可取消资源解析、仅一首下一曲预加载。流线程回调只消费已准备 URI。
- `netease.rs` 直接嵌入固定提交的 ncm-api-rs，不运行额外 API 服务。Cookie 留在 Rust 与系统钥匙串，IPC 只返回二维码和登录结果。
- `storage.rs` 使用 SQLite，列表分页；`library.rs` 使用 Lofty 读取元数据，批量入库。
- `lyrics.rs` 管理歌词来源、超时与缓存；AMLL 负责前端解析和显示。
- `media.rs` 从同一播放状态同步 Windows SMTC；StartTime/MinSeekTime 为 0，EndTime/MaxSeekTime 为曲目时长，Position 限定在有效范围。
- `network.rs` 优先选择现成的 Rust `reqwesthttpsrc` 插件。当前完整运行时的 `curlhttpsrc` 在线准备阶段超时，不能作为已验证路径。Windows 原生来源读取手动系统代理与 bypass（不修改系统设置），明确环境变量优先；PAC 动态解析尚未接通。HTTP 请求超时 12 秒，有重试能力的来源限制为 2 次。
- WebUI 的队列/元数据状态与 4 Hz 播放进度分开订阅；AMLL 单独按需加载，歌词页卸载后停止动画。

## 当前资源约束

网络缓冲目标为 4 MiB/10 秒；这不是全进程内存上限。队列最多 1000 首，本地页 100 首、网络搜索页 50 首；导入每批 64 首、最多 8 个遍历句柄。歌词单文件/序列化缓存项最多 2 MiB，缓存有效载荷最多 64 MiB/2000 项；SQLite 自身页、WAL 与索引另占空间。封面目录最多约 32 MiB，单封面最多 2 MiB。尚未实现音频磁盘播放缓存。

## 验证记录

2026-10-06，当前 Windows x64 开发机，Rust 1.95、GStreamer 1.28.7：

- `pnpm build` 通过。主 JS 约 496 kB（gzip 160 kB），按需歌词 JS 约 466 kB（gzip 140 kB）。这是传输/构建体积，不是运行内存。
- Cargo 检查及所有目标 Clippy（warnings 视为错误）通过。
- 4 项单元测试通过：队列末尾边界、非法/截断 XML、真实缺失与过期缓存区别、过大歌词拒绝写入。
- GStreamer 集成测试通过：两段 48 kHz、双声道、16-bit WAV，playbin3 `about-to-finish` 预置下一曲，fakesink 捕获的输出 PCM 与原始连续样本逐字节相同。此测试验证引擎的解码衔接，不覆盖物理设备输出、网络供给或有损编码延迟处理。
- 桌面窗口实际启动：用合成 15 秒 WAV 导入两首曲目，验证曲库列表与重启后保留、原生播放进度、自动切到第二曲、本地 LRC 显示、暂停和暂停时定位后的歌词高亮。AMLL 默认使用白色和 plus-lighter 混合，已按应用主题覆写颜色并使用 normal 混合，实际浅色显示通过。
- 暂无可据此宣称“极快极轻”的 Release 性能数据。
- 单次开发模式占用快照：2026-10-06 21:24:27，AMLL 页面可见、合成 WAV 暂停，NonsPlayer 与其 WebView 子进程共 7 个，工作集之和 563.65 MiB。此口径可能重复计入共享页，且包含开发模式，不能作为 Release 预算或私有内存数值。`scripts/measure-memory.ps1` 可重复获取相同口径；后续需补充 Release 多次采样与私有内存/共享页口径。
- 实际联网探测通过：网易云搜索返回 50 首，解析 standard 全曲资源，歌词接口返回有效内容；GStreamer `reqwesthttpsrc` 在线解码并推进至少 500 ms（fakesink，不发出真实音乐声音）。此为单个匿名可用资源探测，不等于完整账号、格式或网络矩阵验收。
- 通过 Windows 官方 SMTC 读取 API 验证 NonsPlayer 会话：测试曲目标题、艺术家/专辑占位信息均非空，封面可读取（5584 bytes），Start/MinSeek=0、End/MaxSeek=15 秒。播放中 Position 实际推进至 6.93 秒。系统按钮与定位回调还需交互验收。

可重复的手动探测（不纳入离线单元测试，也不自动扫码）：

```powershell
./scripts/native.ps1 -Task probe -Example network_probe
# 先在运行中的 NonsPlayer 选中一首歌
./scripts/native.ps1 -Task probe -Example media_probe
python scripts/create-audio-fixtures.py
./scripts/measure-memory.ps1
```

## 尚待完成

真实账号扫码及过期恢复、在线歌曲与 AMLL DB 命中/错误矩阵验收；MP3/AAC/Opus 等格式、有损延迟与在线无缝验证；输出设备切换/拔除验收；macOS/Linux 构建及基本播放；Windows 最低版本确认；发布 DLL/插件裁剪、依赖许可证清单和安装包验证；包含所属 WebView 进程的冷启动/首声/后台/歌词场景性能测量。

首阶段产品范围还包含歌单读取与写操作、喜欢歌曲及有界音频播放缓存，这些没有在当前框架中完成。后续沿既有模块实现。

AMLL 当前依赖标注 AGPL-3.0-only，项目现有许可证为 GPL-3.0；发布前必须落实相应组合分发许可、源码和 notices。GStreamer 开发运行时含 GPL/restricted 插件，最终随包插件清单需按实际需要和许可核对。
