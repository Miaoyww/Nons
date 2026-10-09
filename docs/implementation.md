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

依赖脚本从官方 PyPI 获取固定版本 1.28.7 的 GStreamer wheel，校验 SHA256 后只解压到忽略目录 `.local/gstreamer`，用现有 MSVC 工具生成 Rust 链接所需 import libraries。不会运行安装程序，也不会永久更改系统环境。此完整开发运行时（包含插件依赖包）约 303.1 MiB，包含开发工具及额外插件，不能当作最终安装包体积。

`native.ps1 -Task check|test|clippy` 为当前进程设置原生依赖路径。Windows x64 发布打包已接入私有音频运行时，`-Task build` 与 `pnpm tauri build` 共用打包入口。Cargo.lock 暂将 kstring 固定到 2.0.2；更新依赖时遵守 manifest 的 Rust 1.95 最低版本。

`pnpm tauri dev` 自动为子进程配置项目内 GStreamer 链接库、DLL 和插件路径，并启动 Vite。`pnpm dev` 只启动 WebUI 预览，无需与桌面命令同时运行。也可以在仓库根目录使用 `native.ps1 -Task dev`。

## 托盘与关闭主面板

Windows／macOS 托盘右键使用按需创建的 WebView 弹层，复用 `TrackIdentity` 歌曲信息和 `PlaybackTransport` 控制按钮，左键恢复主面板。弹层失焦或按 Escape 后销毁，只观察 `player-state`，不订阅进度、不启动私人 FM 续播、不安装插件桥接。屏幕定位按托盘所在显示器的工作区域和缩放因子限制，避免越过屏幕边缘。以上为设计上的成本控制，未测量弹层首次打开延迟或内存占用。

常规设置中的“关闭主面板时”通过现有 SQLite 设置保存，默认“关闭”并执行完整应用退出；“最小化”隐藏主窗口，保留播放和托盘入口。托盘“退出”始终执行应用退出，沿用播放器与插件的停止流程。设置读取走 `nativeCall`，不加入查询缓存；保存成功后更新选中值，失败保留原值并显示错误。

Tauri 在 Linux 不提供托盘指针事件，因此 Linux 使用原生“打开／设置／退出”菜单兜底。歌曲卡片弹层和完整桌面交互仍需在对应平台进行实机验收。

## 格式化与验收

在仓库根目录执行 `pnpm --dir app verify`，按顺序完成格式化、前端测试、生产构建和最终格式检查。Rust 或其他功能仍需补充对应验收；这条命令不替代原生编译与播放验证。单独执行 `pnpm --dir app format` 可格式化代码，`pnpm --dir app format:check` 只检查格式。

Prettier 使用仓库根目录的配置，覆盖应用、插件、共享包、脚本及文档中支持的格式；Rust 使用 rustfmt，覆盖应用与两个插件后端。生成物、锁文件、第三方源码和 Git 忽略的文件由忽略规则排除。

## Windows 发布打包

在 `app` 目录执行 `pnpm tauri build`。首次构建先运行 `python scripts/bootstrap-gstreamer.py`，已引导的旧工作区也需重跑以补齐 `gstreamer_plugins_libs`。构建脚本使用已有 MSVC `dumpbin` 递归收集 DLL 依赖，生成 `.local/gstreamer-bundle/root`；Windows 专用 Tauri 配置将核心 DLL 放在安装目录的 EXE 旁，音频插件与扫描器位于 `runtime/`。同一布局也复制到 Cargo 输出目录，因此 `target/release/Nons.exe` 可直接启动；分发便携版时必须携带整个运行时，不能只复制 EXE。

当前选择 24 个播放、解析、音频解码与 Windows 输出插件；其间接依赖仍包含 FFmpeg 的共用库。遗漏核心文件或非系统间接 DLL 时构建立即失败，不生成缺件安装包。应用在 GStreamer 初始化前选择私有插件目录与扫描器，覆盖继承的 SDK 路径；扫描器使用 EXE 旁的 DLL，插件注册缓存独立位于应用缓存目录。这是原生插件元数据缓存，非歌曲或歌词资源缓存；更换运行时后由 GStreamer 按插件路径与文件时间重新扫描。

验收命令：

```powershell
python -m unittest discover -s scripts/tests
python scripts/smoke-audio-runtime.py app/src-tauri/target/release
```

Windows x64、GStreamer 1.28.7：裁剪内容实测约 34.0 MiB（文件字节总和，非安装包或内存占用），59 个原生文件；清空 SDK 路径后验证 14 个音频工厂、WAV/FLAC/MP3/AAC/Vorbis/Opus 解码与静音输出。Release NSIS 构建通过，安装包约 17.60 MiB，安装脚本已核对包含全部运行时文件；尚未在无 SDK 的另一台机器上安装验收。macOS/Linux 沿用平台 GStreamer SDK，本次未验证其发布打包。

## 模块

前端业务位于 `app/src/features/`，按工作区、账号、发现、音乐库、本地音乐、搜索、队列、播放、歌词和设置归组，专用控件、hook 与服务随功能存放。跨功能音乐控件位于 `components/music/`，通用 UI 保持在 `components/ui/`；`lib/` 与 `hooks/` 保留共享基础能力，插件宿主保持在 `plugins/`。

Rust 后端位于 `app/src-tauri/src/`，`lib.rs` 声明模块并导出启动入口，`application/` 负责 Tauri 组装与 IPC；播放、本地曲库、歌词、网易云、发现、平台服务、基础设施、共享模型和插件各有独立目录。以下路径均相对该后端目录。

- `model/mod.rs` 定义歌曲、本地/网易云资源和播放状态；当前没有多来源插件框架。
- `playback/player.rs` 单线程拥有 GStreamer playbin3、设备监视和 SMTC；有界命令队列、可取消资源解析、仅一首下一曲预加载。流线程回调只消费已准备 URI。
- `netease/mod.rs` 直接嵌入固定提交的 ncm-api-rs，不运行额外 API 服务。Cookie 留在 Rust 与系统钥匙串，IPC 只返回二维码和登录结果。
- `infrastructure/storage.rs` 使用 SQLite，列表分页；`local/library.rs` 使用 Lofty 读取元数据，批量入库。
- `lyrics/mod.rs` 管理歌词来源、超时与缓存；AMLL 负责前端解析和显示。
- `playback/media.rs` 从同一播放状态同步 Windows SMTC；StartTime/MinSeekTime 为 0，EndTime/MaxSeekTime 为曲目时长，Position 限定在有效范围。
- `playback/network.rs` 静态注册随应用固定的 Rust reqwest HTTP 插件（0.15.4，`vendor/gst-plugin-reqwest`），使用独立的 `nonshttpsrc` 名称避免运行时插件冲突。首次请求发送开放 Range，以实际 206/Content-Range 确认定位能力，兼容网易云 CDN 缺少 Accept-Ranges 的响应；忽略 Range 的服务器仍不可定位。不新增整曲下载或缓存，播放缓冲仍为 4 MiB / 10 秒上限。当前完整运行时的 `curlhttpsrc` 在线准备阶段超时，不能作为已验证路径。Windows 原生来源读取手动系统代理与 bypass（不修改系统设置），明确环境变量优先；PAC 动态解析尚未接通。HTTP 请求超时 12 秒，有重试能力的来源限制为 2 次。Windows 开发脚本同时生成并链接 gstbase 的 import library。
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

## 上一首切歌修复（2026-10-08）

- 原播放命令在进度超过 3 秒时执行 `seek(0)`，因此临近曲尾点击上一首会重播当前歌曲；切到下一首后进度归零，又可立即回到上一首。该决策无需运行 GStreamer 即可稳定复现，不以 gapless 为触发条件。
- 手动上一首现在始终选择前一队列项，经普通加载流程取消资源请求、推进播放代次、清除 prepared/armed 并重置管线；首曲在循环模式下回到队尾，顺序模式无前曲时保持当前播放。预加载、自然无缝续播与缓冲上限沿用既有实现。
- Windows x64、Rust 1.95、GStreamer 1.28.7：新增 3 项回归测试，修复前临近曲尾测试失败，修复后通过；覆盖 3 秒边界、曲尾、播放/暂停/缓冲/加载、循环与空队列。67 项 Rust 库测试通过、2 项按既有设置跳过；本地 WAV 与 HTTP 断流恢复的两项无缝测试通过，PCM 逐字节一致。运行中开发版占用可执行文件导致组合 Cargo 测试无法链接主程序，集成测试直接运行本次生成的测试程序；Clippy 库检查临时禁用资源复制后通过，Rust 格式检查通过。未进行桌面按钮实机复验或 macOS/Linux 验证。

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

## 通用插件平台（2026-10-08）

- 实现 Manifest discovery、目录／ZIP 安装、显式授权、PluginManager 生命周期、Wasmtime Component Model、版本化 WIT、高层 Host Capability、隔离存储与事件总线、动态 ESM、公开 React SDK、覆盖层和通用页面／导航贡献。灵动岛的业务与 UI 全部位于独立插件目录，复用原网易云 Client、封面缓存、主题和播放核心。接口、文件、Manifest、构建、安装及新插件开发见 [插件开发与使用](plugins.md)，取舍见 [ADR 0003](adr/0003-runtime-plugins.md)。
- Windows x64、Rust 1.95、GStreamer 1.28.7：TypeScript／Vite 构建和普通 Tauri Debug `--no-bundle` 构建通过；40 项前端测试通过；完整串行 Rust 回归 63 项通过、3 项依赖字体／实时 QQ 服务／音频设备的测试跳过；Clippy `--all-targets --all-features -D warnings` 及 Rust 格式检查通过。测试实际执行 Component，覆盖 fuel 耗尽、内存上限、trap、无效响应、异步 Host 超时及其他实例继续工作。
- `scripts/probe-plugins.ps1` 的实际隐藏 WebView 探测通过：合成剪贴板分享文本 → Host 过滤 → WASM → 既有网易云 Client → 插件事件 → 动态 `ui.mjs` → React singleton → PluginSlot DOM；同时验证无授权播放／存储操作被拒、停用后代次和资源失效、界面清理、目录安装、隔离存储、导航／页面、子路径保留组件状态及删除后移除存储与贡献。原播放队列保持为空，不改动用户播放或剪贴板。
- 一次 Windows Debug 样本中，从合成候选 URL 交付到探测确认歌曲 DOM 为 101ms，包含真实歌曲元数据请求，50ms 轮询确认；不是操作系统剪贴板通知延迟、统计分位数或 Release 性能承诺。没有实测整个应用所属 WebView 的内存增量。WASM Store、并发、事件、安装大小和缓存容量设有明确上限，不能据此推导全进程占用。
- 修复真实 ESM namespace 不能直接冻结导致的启动错误，公共桥接改为冻结普通对象副本；实际 ESM 回归覆盖重复初始化。独立测试还执行懒加载产物，验证 `assets/` 中的 chunk 正确引用公共 Host 模块。
- macOS/Linux 编译及基本播放、OS 真实复制通知、官方短链在线跳转矩阵、真实账号异常网络矩阵与无 SDK 机器的安装验收仍需对应环境验证。前端共享主 WebView，必须信任代码；WASM Capability 限制不能作为前端恶意代码沙箱。

## 插件配置与目录授权（2026-10-09）

- 配置定义、SQLite 修订事务、JSON Schema 校验、默认值回退、变更通知与加载基线独立于编辑页面。统一页自动保存并处理失败草稿；自定义页使用插件注册页面与设置内局部导航。灵动岛接入预览时长、悬停保持与分享识别。接口见 [插件配置开发](plugin-configuration.md)，决策见 [ADR 0004](adr/0004-plugin-configuration.md)。
- 文件能力使用 cap-std、32KiB 分块、实例句柄上限和分页目录；支持专属数据目录与原生选择器授予的外部只读/读写目录。权限撤销、加载代次、卸载默认清理和选择保留分别处理，不清理外部内容。
- Windows x64、Rust 1.95、GStreamer 1.28.7 的实际隐藏 WebView 验证通过：停用插件的统一页自动保存/重置、自定义页子路由不改变主页面、SDK 二进制读写、卸载保留后同 ID 重装恢复、默认卸载清理和外部授权撤销。单元测试另覆盖修订冲突、校验失败原子回滚、无效旧值保留、分页、只读句柄与 Windows junction 越界拒绝。探测只使用临时插件和数据库。
- 未在本轮验证 macOS/Linux 编译与运行、原生目录选择器的手动交互或 Release 吞吐/内存。前端仍遵循受信任代码边界。

## 插件职责边界改造（2026-10-09）

- 按 [ADR 0005](adr/0005-plugin-capability-boundary.md) 分离通用系统能力与明确来源的播放器领域能力。宿主提供有界剪贴板文本和授权域名内的 HTTP 请求；网易云链接提取、域名判断、短链跳转及歌曲 ID 解析归入灵动岛。网易云歌曲服务与原有账号代次缓存独立放入 `plugins/netease.rs`，公开 `netease.*` 与 `useNetease()`，旧查询与播放调用名保留兼容别名。
- 剪贴板变化绑定发生时的插件加载代次，停用或重载不会收到排队中的旧文本；请求结束后拒绝失效结果，HTTP 等待可在停用时取消。授权记录绑定插件版本、权限和精确域名，历史启用状态不自动授予新增文本或网络能力；灵动岛升级到 1.3.0，需要重新安装与确认。
- Windows x64、Rust 1.95、GStreamer 1.28.7：前端 145 项测试、85 项 Rust 单元测试和 2 项插件解析单元测试通过；原有 2 项依赖在线服务或系统字体的单元测试保持忽略。WAV／HTTP 无缝、断供恢复、定位及音量集成测试通过，Windows 输出设备测试按原条件忽略。全量执行中 HTTP seek 先出现已记录的间歇失败，单独串行复跑通过；本次未修改播放引擎或网络音频源。
- 隐藏 WebView 探测通过原文交付、插件识别、网易云歌曲查询、动态 ESM 与覆盖层显示，并验证未授权剪贴板／HTTP 和域名越界拒绝、停用清理、插件页面、配置保存、二进制文件、保留数据重装及默认卸载清理。探测脚本等待 React 输入状态更新与权威配置保存后再导航，避免合成输入后立即失焦保存旧值。使用临时插件数据库和合成文本，未改动用户剪贴板或播放队列。
- 全目标 Clippy 受既有 `examples` 引用 `netease/mod.rs` 的未使用 `PlaylistCategory` 导入阻塞；应用与测试目标、插件自身单独检查。本轮未验证 OS 真实复制通知、官方短链在线矩阵、macOS/Linux 原生构建或 Release 性能。
