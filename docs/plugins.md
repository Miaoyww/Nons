# 插件开发与使用

Nons 在现有播放器上增量提供 `Manifest + WASM Backend + React Frontend + Contributions`。网易云仍是宿主的数据源，插件不接管搜索、歌单、登录或播放核心。第一版随包分发灵动岛，默认关闭。

## 架构与文件

| 部分         | 位置与职责                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Rust Host    | `app/src-tauri/src/plugins/`：Manifest、安装、管理、Wasmtime、权限、事件、存储、剪贴板与资源协议     |
| 公共 ABI     | `plugins/wit/plugin.wit`：`nons:plugin@1.0.0`；Guest 初始化、关闭、方法调用；Host 高层 Capability    |
| React Host   | `app/src/plugins/`：动态模块、贡献 registry、PluginSlot、PluginPageHost、生命周期与 SDK              |
| 公共类型     | `packages/plugin-sdk/`：独立 `@app/plugin-sdk` 类型包，不引用宿主源码                                |
| 真实插件     | `plugins/netease-island/`：独立 Rust Component 与 React UI                                           |
| 构建         | `scripts/build-plugin.mjs`、`plugin-build-ui.mjs`、`package-plugin.py`：两端构建、React 外部化与 ZIP |
| 测试 fixture | `plugins/runtime-fixture/`：资源耗尽／错误验证，不随包安装                                           |

宿主启动、IPC 和协议注册接入原 `lib.rs`；歌曲读取继续使用 `netease.rs` 的现有 Client 和曲目解析。App 增加通用 Provider／Slot，已有工作区和导航增加插件页面分支，设置增加插件管理。Theme 共享原偏好与 CSS tokens，播放 facade 订阅原状态及进度，不创建另一套播放器。

## 构建与安装

一次性准备：项目仍要求 Rust 1.95、Node/pnpm、Python 和原 GStreamer 开发运行时。另安装：

```powershell
cargo install cargo-component --version 0.21.1 --locked
rustup target add wasm32-unknown-unknown
cd app
pnpm install --frozen-lockfile
pnpm plugins:build
```

构建脚本先执行：

```powershell
cd plugins/netease-island/backend
cargo component build --release --target wasm32-unknown-unknown --locked
```

Cargo Component 根据 WIT 生成 `src/bindings.rs`，产出真正的 Component。生成的 bindings 与 target 不提交；Cargo.lock 提交。宿主只链接 Nons WIT，不提供任意 WASI filesystem、network、clipboard 或 process imports。

React 从 `frontend/index.tsx` 构建 ESM。TypeScript 检查使用公开 SDK 类型；React、JSX runtime 和 SDK 保持 external，并重写到同一插件 URL 下的 `_host/` 合成模块。桥接引用宿主 React singleton，产物检查拒绝 React 副本。动态 chunk 放入 `assets/`；样式可使用宿主 CSS tokens、组件类名或插件自己的 style／资产，不依赖宿主源码路径。

默认产物：

```text
app/src-tauri/bundled-plugins/netease-island/
  manifest.json
  backend.wasm
  ui.mjs
app/src-tauri/bundled-plugins/netease-island.zip
```

`pnpm dev` 与 Tauri 打包前会构建插件。正常宿主首次启动枚举随包插件并安装为关闭状态；之后卸载不会自动补装。构建目录不是源码提交内容。

设置 → 插件可安装目录或 ZIP，ZIP 根必须直接包含 `manifest.json`。安装复制到 `<app_data>/plugins/<id>/`，不在用户选择的来源目录运行，不支持覆盖同 ID 插件。启用前查看权限并勾选信任说明。管理支持重新发现、加载、卸载运行实例、重新加载、停用和删除；删除同时清理独立存储。当前没有远程安装、市场或自动更新。

## Manifest

编辑器 schema：`plugins/manifest.schema.json`。Rust 是运行时权威校验器，额外验证 SemVer、API 范围、路径、Windows 保留名、扩展引用、权限和文件存在性。

```json
{
  "id": "netease-island",
  "name": "灵动岛",
  "version": "1.0.0",
  "backend": "backend.wasm",
  "frontend": "ui.mjs",
  "permissions": ["clipboard:music-links", "music:metadata", "ui"],
  "engines": { "app": "^0.1.0", "pluginApi": "^1.0.0", "uiApi": "^1.0.0" },
  "contributes": {
    "views": [{ "id": "island", "slot": "main.overlay", "export": "DynamicIsland" }],
    "pages": [],
    "navigation": []
  }
}
```

backend／frontend 可独立省略，但至少有一个入口。UI 贡献必须声明 frontend 与 `ui`。未知字段或权限拒绝加载；改动已安装插件的版本或权限需要重新安装并确认。commands、menus、contextMenus、settings、shortcuts 仅保留声明字段，当前不执行。

## Host Capability 与 SDK

WIT Host 的 `call(operation, args-json)` 返回 JSON 或业务错误，身份来自 Store，Guest 不能指定另一个 pluginId。当前操作：

| 操作                     | 权限             | 行为                                                      |
| ------------------------ | ---------------- | --------------------------------------------------------- |
| `music.get-song`         | `music:metadata` | `{id}` 查询宿主网易云歌曲信息，返回 PluginSong            |
| `events.emit`            | 活跃加载实例     | `{event,payload}` 发布自己的事件                          |
| `storage.get/set/delete` | `storage`        | 操作自身的 JSON 键值空间                                  |
| `player.read`            | `player:read`    | 读取经过裁剪的播放状态，不提供本地文件路径                |
| `player.control`         | `player:control` | pause、resume、next、previous、stop，进入既有播放命令队列 |

公开 React API：

| API                        | 返回／用途                                                        |
| -------------------------- | ----------------------------------------------------------------- |
| `usePluginBackend()`       | `call<T>(method, args?)`；自动绑定身份与加载代次                  |
| `usePluginEvent<T>(event)` | 当前事件最新 payload；订阅随组件卸载清理                          |
| `usePluginStorage()`       | 异步 get／set／delete；缺失值为 null                              |
| `usePluginNavigate()`      | 在当前插件命名空间内导航，参数为 `/child` 等相对插件根路径        |
| `usePluginRoute()`         | 当前插件的 pathname 和 search                                     |
| `usePlayer()`              | 原播放状态和进度；读取需 player:read，control 还需 player:control |
| `useTheme()`               | 原主题偏好 light／dark／system；实际颜色使用宿主 CSS tokens       |
| `useCoverSource()`         | 复用宿主封面缓存和失败回退                                        |
| `Button`                   | 宿主已有 Button；不打包另一份 UI 实现                             |

SDK 不要求手写 pluginId。所有 SDK 请求经过 `nativeCall` 和 scoped IPC；禁用／reload 后即使 Promise 晚返回，SDK 也拒绝旧结果。事件内部命名为 `plugin:<id>:<event>`，共用 Tauri transport，但 SDK 只读取自身 Scope。订阅在实例卸载时删除；每实例只保留有界的最新事件，不承诺持久历史或初始化之前的事件重放。

可选模块 `activate()` 可以返回清理函数；清理会在停用、reload 和卸载时调用。组件应使用 React effect 清理自己的定时器及其他副作用。

## 灵动岛数据流

```mermaid
flowchart LR
  C[剪贴板变化] --> H[Rust 过滤分享 URL／解析官方短链]
  H --> W[WASM 识别歌曲 ID]
  W --> N[Host music.get-song／既有网易云 Client]
  N --> W
  W --> E[plugin-scoped song-detected]
  E --> U[动态 ui.mjs／公共 SDK]
  U --> S[PluginSlot main.overlay]
```

Host 仅观察新变化，不在启动时读取旧内容；没有已加载且授权的订阅者时停止监听。Windows 使用 clipboard-win 的事件 Monitor，初始化错误作为 Result 返回；文本读取与其他平台观察复用 clipboard-rs。不写剪贴板、不记录或传送原文，只处理不超过 16KiB 的文本，最多提取 4 个、各不超过 2048 字节的候选 URL。

允许精确域名 `music.163.com`、`y.music.163.com`、`m.music.163.com`、`163cn.tv`，拒绝账号密码及非默认端口。官方短链使用禁止自动跳转的独立 client，每一步校验域名，最多 3 次跳转，总期限 3 秒；支持 HTTP redirect，不执行网页脚本。Guest 仅收到歌曲候选 URL，不能访问任意 HTTP。

Guest 查询歌曲失败时不产生预览，保留实例以等待后续复制。成功时发出 Song DTO；React 插件自行绘制封面、标题、歌手和关闭操作。新歌曲替换旧预览；同歌曲 30 秒内去重；8 秒后收起，鼠标悬停或键盘聚焦暂停倒计时，Escape／关闭按钮可收起。没有播放或队列写操作，也不申请 player:control。

## 新 view／page 插件

新的项目沿用 `plugins/<id>/manifest.json`、可选 backend 与 `frontend/index.tsx` 结构，更新各 Cargo package 名和 SDK tsconfig 路径，再运行：

```powershell
node scripts/build-plugin.mjs <id>
```

view 导出命名 React Component，并在 views 中关联导出与 `main.overlay`。页面通过 pages 与 navigation 声明，例如：

```json
{
  "pages": [{ "id": "inspector", "path": "/", "export": "InspectorPage" }],
  "navigation": [{ "id": "inspector-entry", "label": "检查器", "page": "inspector" }]
}
```

页面入口统一为 `/plugins/<id>/*`，使用现有应用内历史而非新建全局 router。按最长页面路径前缀选择 contribution；同一页面的子路径变化保留组件状态，离开该页面后卸载。组件从 SDK 获取子路径，并用 `usePluginNavigate()` 导航；不得跳出自身命名空间。没有额外交付网易云示例页面，桌面探测中的临时页面仅用于验证。

## 边界与资源预算

- WASM：64MiB 线性内存、1000 万 fuel／调用、5 秒执行期限；Host 网络查询 3 秒；异步等待可取消，epoch 与 fuel 防止 guest 独占线程。最多同时加载 4 个 WASM 插件，单实例最多 16 个待处理请求。
- IPC／事件／存储单值最多 64KiB；事件最多 32 次／秒；存储每插件 1MiB；安装最多 1024 文件、64MiB 解压总量，WASM 入口 16MiB，UI／资源单文件 8MiB。
- SDK、元数据和资源都校验加载代次。trap／超时／资源耗尽撤销该实例，普通 Guest 业务错误保留实例。原播放队列及音频线程不承担插件执行。
- `plugin://` 服务只允许活跃插件的前端入口、assets 和合成 Host 模块；规范化路径、拒绝链接／junction、限制类型与大小、设置 MIME、no-store 和有限 CORS。不开放通用 filesystem scope。
- React 前端是受信任代码，与主 UI 共享 WebView。SDK 身份、存储、事件和路径约束不等于防恶意 JS 沙箱；它仍可能直接操作 DOM、调用其他可见宿主接口或自行创建副作用。已经执行的 JS／浏览器 ESM 缓存无法强制回收，主线程循环也不能由 WASM fuel 终止。只安装可信前端。
- Store 上限仅覆盖 guest 线性内存等资源，不代表 Wasmtime JIT、Host、WebView 或全进程内存上限。当前没有独立 WASM worker 进程、签名或权限撤销后的 JS 强制终止；频繁 reload 的 ESM 模块记录可能留在 WebView，必要时重启应用。
- Windows 已验收；macOS/Linux 原生构建、播放与剪贴板观察尚需对应环境验证，Linux 当前为 X11 后端。Release 的 GStreamer 裁剪和打包仍沿用既有未完成状态。

## 验证

准备测试 Component，再运行既有检查：

```powershell
cd app
pnpm plugins:build
pnpm plugins:fixtures
pnpm test
pnpm build
cd ..
./scripts/native.ps1 -Task check
./scripts/native.ps1 -Task test -ExtraArgs @('--','--test-threads=1')
./scripts/native.ps1 -Task clippy -ExtraArgs @('--all-targets','--all-features','--','-D','warnings')
```

显式的实际桌面探测：

```powershell
./scripts/probe-plugins.ps1
```

该脚本在独立的 `target/plugin-probe` 目录构建，隐藏窗口，使用独立临时插件数据库和空队列，读取现有网易云服务，自动验证 ESM 协议、React singleton、灵动岛、权限、停用及临时页面／导航。输入为合成剪贴板文本，不覆盖用户剪贴板；操作系统真实复制通知仍需手动验收。结束时清理本次探测的临时数据。该 feature 专供探测，正常构建不启用它。

本机 Windows x64、Rust 1.95、GStreamer 1.28.7 的检查结果记录在 `docs/implementation.md`。开发构建体积和单次端到端时间不能代表 Release 内存／响应预算；没有据此宣称插件平台“极轻”或“极快”。
