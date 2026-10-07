# 初始框架实现与验证

## 开发运行

Windows x64：需要 Rust 1.95、MSVC 工具链、Node/pnpm、Python，以及 Tauri 的 WebView2 环境。

```powershell
cd app
pnpm install --frozen-lockfile
cd ..
python scripts/bootstrap-gstreamer.py
cd app
pnpm tauri dev
```

依赖脚本从官方 PyPI 获取固定版本 1.28.7 的 GStreamer wheel，校验 SHA256 后只解压到忽略目录 `.local/gstreamer`，用现有 MSVC 工具生成 Rust 链接所需 import libraries。不会运行安装程序，也不会永久更改系统环境。此完整开发运行时约 252.3 MiB，包含开发工具及额外插件，不能当作最终安装包体积。

`native.ps1 -Task check|test|clippy` 为当前进程设置原生依赖路径。发布打包尚未接通，`-Task build` 会明确拒绝执行，避免生成遗漏 DLL 的安装包。Cargo.lock 暂将 kstring 固定到 2.0.2；更新依赖时遵守 manifest 的 Rust 1.95 最低版本。

`pnpm tauri dev` 自动为子进程配置项目内 GStreamer 链接库、DLL 和插件路径，并启动 Vite。`pnpm dev` 只启动 WebUI 预览，无需与桌面命令同时运行。也可以在仓库根目录使用 `native.ps1 -Task dev`。

## 模块

- `model.rs` 定义歌曲、本地/网易云资源和播放状态；当前没有多来源插件框架。
- `player.rs` 单线程拥有 GStreamer playbin3、设备监视和 SMTC；有界命令队列、可取消资源解析、仅一首下一曲预加载。流线程回调只消费已准备 URI。
- `netease.rs` 直接嵌入固定提交的 ncm-api-rs，不运行额外 API 服务。Cookie 留在 Rust 与系统钥匙串，IPC 只返回二维码和登录结果。
- `storage.rs` 使用 SQLite，列表分页；`library.rs` 使用 Lofty 读取元数据，批量入库。
- `lyrics.rs` 管理歌词来源、超时与缓存；AMLL 负责前端解析和显示。
- `media.rs` 从同一播放状态同步 Windows SMTC；StartTime/MinSeekTime 为 0，EndTime/MaxSeekTime 为曲目时长，Position 限定在有效范围。
- `network.rs` 静态注册随应用固定的 Rust reqwest HTTP 插件（0.15.4，`vendor/gst-plugin-reqwest`），使用独立的 `nonshttpsrc` 名称避免运行时插件冲突。首次请求发送开放 Range，以实际 206/Content-Range 确认定位能力，兼容网易云 CDN 缺少 Accept-Ranges 的响应；忽略 Range 的服务器仍不可定位。不新增整曲下载或缓存，播放缓冲仍为 4 MiB / 10 秒上限。当前完整运行时的 `curlhttpsrc` 在线准备阶段超时，不能作为已验证路径。Windows 原生来源读取手动系统代理与 bypass（不修改系统设置），明确环境变量优先；PAC 动态解析尚未接通。HTTP 请求超时 12 秒，有重试能力的来源限制为 2 次。Windows 开发脚本同时生成并链接 gstbase 的 import library。
- WebUI 的队列/元数据状态与 4 Hz 播放进度分开订阅；AMLL 单独按需加载，歌词页卸载后停止动画。

## 当前资源约束

网络缓冲目标为 4 MiB/10 秒；这不是全进程内存上限。队列最多 1000 首，本地页 100 首、网络搜索页 50 首；导入每批 64 首、最多 8 个遍历句柄。歌词单文件/序列化缓存项最多 2 MiB，缓存有效载荷最多 64 MiB/2000 项；SQLite 自身页、WAL 与索引另占空间。封面目录最多约 32 MiB，单封面最多 2 MiB。尚未实现音频磁盘播放缓存。

## 验证记录

2026-10-06，当前 Windows x64 开发机，Rust 1.95、GStreamer 1.28.7：

- `pnpm build` 通过。主 JS 约 496 kB（gzip 160 kB），按需歌词 JS 约 466 kB（gzip 140 kB）。这是传输/构建体积，不是运行内存。
- Cargo 检查及所有目标 Clippy（warnings 视为错误）通过。
- 4 项单元测试通过：队列末尾边界、非法/截断 XML、真实缺失与过期缓存区别、过大歌词拒绝写入。
- 二维码解析新增 3 项回归测试通过：SDK 根层 key、嵌套 key、无效返回；真实 `qr_probe` 请求确认登录 key 和可解码 SVG 图片生成成功，不输出 key、登录地址或图片内容，也不自动扫码。
- GStreamer 集成测试通过：两段 48 kHz、双声道、16-bit WAV，playbin3 `about-to-finish` 预置下一曲，fakesink 捕获的输出 PCM 与原始连续样本逐字节相同。此测试验证引擎的解码衔接，不覆盖物理设备输出、网络供给或有损编码延迟处理。
- 桌面窗口实际启动：用合成 15 秒 WAV 导入两首曲目，验证曲库列表与重启后保留、原生播放进度、自动切到第二曲、本地 LRC 显示、暂停和暂停时定位后的歌词高亮。AMLL 默认使用白色和 plus-lighter 混合，已按应用主题覆写颜色并使用 normal 混合，实际浅色显示通过。
- 暂无可据此宣称“极快极轻”的 Release 性能数据。
- 音量回归（Windows x64、GStreamer 1.28.7）：静音 WAV 经默认 autoaudiosink 重建输出时，修复前 WASAPI 实际音量由 0.45 变为 1.0，启动新音源前重新应用全局音量后保持 0.45。`native.ps1 -Task test -ExtraArgs @('--test','volume','--','--ignored','--nocapture')` 显式运行依赖输出设备的静音测试；普通测试另以 fakesink 检查两次加载的 PCM 峰值均为原始幅度的约 45%，含首个输出缓冲。
- 单次开发模式占用快照：2026-10-06 21:24:27，AMLL 页面可见、合成 WAV 暂停，NonsPlayer 与其 WebView 子进程共 7 个，工作集之和 563.65 MiB。此口径可能重复计入共享页，且包含开发模式，不能作为 Release 预算或私有内存数值。`scripts/measure-memory.ps1` 可重复获取相同口径；后续需补充 Release 多次采样与私有内存/共享页口径。
- 实际联网探测通过：2026-10-06，Windows x64 开发模式、GStreamer 1.28.7，网易云搜索返回 50 首，解析 standard 全曲资源，歌词接口返回有效内容；`nonshttpsrc` 在线解码后跳到 30 秒，实际进度继续推进到 30.201 秒（fakesink，不发出真实音乐声音）。源响应为 206 且无 Accept-Ranges，修复前定位查询为 false、seek 失败，修复后为 true。此为单个匿名可用资源探测，不等于完整账号、格式或网络矩阵验收。
- 两项离线 HTTP 集成回归：无 Accept-Ranges 的 Range 音源向前/向后及暂停定位后实际进度正确；忽略 Range 的服务器仍拒绝定位并继续原播放。临时恢复旧判断时第一项测试在 seek 处失败，确认测试覆盖本次根因。
- 通过 Windows 官方 SMTC 读取 API 验证 NonsPlayer 会话：测试曲目标题、艺术家/专辑占位信息均非空，封面可读取（5584 bytes），Start/MinSeek=0、End/MaxSeek=15 秒。播放中 Position 实际推进至 6.93 秒。系统按钮与定位回调还需交互验收。
- SMTC 状态回归（2026-10-07，Windows x64 开发模式、GStreamer 1.28.7）：真实管线已 Playing 时迟到/重复的缓冲 100% 消息，修复前状态回退 Loading，修复后保留实际 Playing；缓冲不足仍暂停管线并显示 Buffering。29 项 Rust 库测试通过。通过系统会话连续切换 5 首网易云歌曲，全部恢复 Playing；以发送 Next 前为起点、50 ms 轮询，歌名更新耗时范围 51–55 ms，Playing 更新范围 304–406 ms（含音源加载）。仅为本机这 5 次样本，不代表完整网络或格式矩阵。

可重复的手动探测（不纳入离线单元测试，也不自动扫码）：

```powershell
./scripts/native.ps1 -Task probe -Example network_probe
./scripts/native.ps1 -Task probe -Example qr_probe
# 先在运行中的 NonsPlayer 选中一首歌
./scripts/native.ps1 -Task probe -Example media_probe
# 编译探测器后保持应用播放，再直接运行，避免开发监听因编译重启应用。
# --next 会切到下一首，需队列中相邻曲目歌名不同；默认不发送控制命令。
./app/src-tauri/target/debug/examples/media_probe.exe --next --expect-playing
python scripts/create-audio-fixtures.py
./scripts/measure-memory.ps1
```

## 尚待完成

真实账号扫码及过期恢复、在线歌曲与 AMLL DB 命中/错误矩阵验收；MP3/AAC/Opus 等格式、有损延迟与在线无缝验证；输出设备切换/拔除验收；macOS/Linux 构建及基本播放；Windows 最低版本确认；发布 DLL/插件裁剪、依赖许可证清单和安装包验证；包含所属 WebView 进程的冷启动/首声/后台/歌词场景性能测量。

音乐库已移植 YesPlayMusic 的主要布局，接入喜欢音乐预览、歌单/专辑/艺人收藏、听歌记录、新建歌单和收藏详情播放。歌单编辑/收藏写操作、喜欢歌曲写操作及有界音频播放缓存仍待完成。

AMLL 当前依赖标注 AGPL-3.0-only，项目现有许可证为 GPL-3.0；发布前必须落实相应组合分发许可、源码和 notices。GStreamer 开发运行时含 GPL/restricted 插件，最终随包插件清单需按实际需要和许可核对。


## 音乐库移植与验证（2026-10-07）

- 参考本地 YesPlayMusic `src/views/library.vue`、`CoverRow.vue` 和 `TrackList.vue`，将 Vue 布局适配到 React，并复用现有 AnimateUI 按钮/对话框及 shadcn Select。MV、云盘和自动签到不纳入产品范围。MIT 原始许可证见 `notices/YesPlayMusic-LICENSE.txt`，应用关于页面同时包含署名与完整许可。
- 每次只渲染一页收藏（30 项）或歌曲（100 首）；喜欢预览为 12 首，收藏整体播放队列上限 1000 首，超过上限时显示提示。歌曲详情按歌单 ID 顺序恢复；缺失/不可用详情跳过，分页终点按完整 ID 列表判断，避免 SDK 的越界切片问题。
- 歌词卡片调用既有歌词服务，优先 AMLL；加载失败显示装饰心形，不阻塞收藏和播放。没有逐帧歌词渲染。
- Windows x64：真实会话只读探测成功读取 12 首喜欢音乐预览、14 个普通歌单、1 张收藏专辑、2 位收藏艺人；抽样详情返回 44/29/50 首歌曲。此为单一会话的接口验证，不代表完整账号、权限与异常网络矩阵验收。未对真实账号新建歌单或改动收藏。
- 独立模拟环境验证喜欢歌曲播放与底栏同步、专辑详情及顶部后退；真实歌曲音频播放沿用原播放核心，新增新建歌单操作需在真实账号中交互验收。
- 可重复只读检查：`./scripts/native.ps1 -Task probe -Example library_probe`。只输出数量和成功状态，不输出账号标识、会话或播放 URL。

## 悬浮播放栏（2026-10-07）

- 参考本地 folia 的胶囊外观与交互，用 Nons 现有组件独立实现悬停/聚焦展开、相邻歌名预览与歌名全屏入口；未复制 folia 组件代码。复用 AnimateUI 按钮、shadcn/Base UI Select，未增加依赖。音质菜单打开期间保持展开，实际音质以播放核心状态为准，悬停音质选择可查看偏好与实际值。
- 独立音量按钮位于胶囊右侧，悬停或键盘聚焦显示卡片；点击静音，再次点击恢复静音前非零音量，滑块即时提交原生音量，失败回退并显示错误。Escape 可关闭卡片。
- 循环状态由原生核心发布并随播放快照保存；自动续播和预加载支持列表循环/单曲循环，手动下一首在单曲循环时仍切换歌曲。旧快照缺少循环字段时默认顺序播放。
- 标题栏和播放胶囊共用小面积背景模糊；曲库内容可滚动到标题栏和播放栏背后，底部保留滚动留白。没有增加逐帧渲染任务；未测量本次模糊效果的 GPU/内存成本。
- Windows x64：前端构建、11 项前端测试、17 项原生单元测试和 WAV 无缝衔接通过。HTTP 定位集成测试存在间歇失败：首次两项读取资源失败，单独串行复跑两项通过，再运行完整串行测试时其中一项 seek 失败；本次未修改网络源或该测试。
- 模拟曲库浏览器验证：键盘聚焦展开、音质菜单保持展开、音量卡片、静音/恢复到 80% 与歌名打开全屏入口通过。模拟检查不等于实际音频、账号音质权限或跨平台验收。


## 在线无缝预读的读取恢复（2026-10-07）

- 双曲离线 HTTP 回归：第一首完整，第二首预读响应在声明长度的 75% 处断开。修复前 `playbin3` 在第一首尚未结束时报告 `Could not read from resource.`，错误来源为第二个 `nonshttpsrc`；修复后两首完整播放，逐字节比较 PCM 与预期一致。
- 已有 `configure_source` 设置 `retries=2`，但原始 reqwest 源没有该属性。现在有界恢复读取中断/超时，从最后已输出的字节重新发起 Range 请求；成功读取不重置预算。非 seekable 资源、错误范围、大小改变及持续失败不会被当作正常 EOS。
- Windows x64、GStreamer 1.28.7：双曲回归约 8.2 秒（两个 4 秒 WAV、fakesink）；读取恢复测试覆盖一次尾段断开、超时、预算耗尽、关闭重试及服务器不支持 Range。此为可靠性验证，未测量延迟或内存收益。
- 真实网易云探测：匿名/现有会话读取《Elements》整首及其到《Mystical Magical》的 gapless 切换成功（fakesink）；没有在该次联网探测中复现用户现场错误，离线测试验证的是下一首网络读取失败导致当前播放被终止这一错误路径。
