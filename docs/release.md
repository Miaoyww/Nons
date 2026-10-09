# GitHub Release CI

发布流程由 [.github/workflows/publish.yml](../.github/workflows/publish.yml) 定义：推送 `v<主版本>.<次版本>.<补丁版本>` 标签后构建 Windows x64，上传 Actions Artifact，再统一发布到 GitHub Release。当前不配置其他存储或自动更新服务。

## 发布前准备

1. 同步 `app/package.json`、`app/src-tauri/tauri.conf.json`、`app/src-tauri/Cargo.toml` 与 `Cargo.lock` 中的应用版本。
2. 将用户可见变化整理到 CHANGELOG 对应的 `## [版本]` 条目，保留 Unreleased 供下次开发使用。日期可写为 `## [版本] - YYYY-MM-DD`。
3. 随包插件的 `engines.app` 兼容当前主版本；插件自身版本和 SDK/API 版本独立维护，不必与应用同步。
4. 完成安装、账号、实际音频设备与依赖许可等发布前验收。CI 的静音解码验证不替代实机安装和听音验证。
5. 提交并推送以上改动，再创建和推送版本标签。例如在版本为 1.0.0 的提交上执行：

```powershell
git tag -a v1.0.0 -m "Nons 1.0.0"
git push origin v1.0.0
```

不删除或移动已发布标签。失败后可在 GitHub Actions 中重新运行该标签的 workflow。

## CI 执行内容

- 固定 Windows runner、Rust 1.95.0、Node 24、pnpm 10、Python 3.12 与 cargo-component 0.21.1；前端安装和 Rust 构建使用锁文件。
- 校验标签与四处应用版本一致，必须存在非空的对应发布说明；不使用 Unreleased 代替。
- 检查格式，运行前端测试、脚本测试与原生库／集成测试；构建灵动岛与测试 Component。
- 从现有引导脚本准备 GStreamer，并通过应用已有打包入口生成包含私有音频运行时的 MSI 和 NSIS EXE。
- 清除 SDK 路径后验证运行时文件、插件工厂与 WAV/FLAC/MP3/AAC/Vorbis/Opus 解码。CI 使用 `--skip-audio-output`，不要求 runner 存在音频设备；手动默认模式仍验证静音设备输出。
- 仅收集当前版本的 MSI、EXE 和匹配源码 Manifest 的灵动岛 ZIP，生成 `SHA256SUMS.txt`；Artifact 保留 14 天，发布任务下载后再次校验哈希。
- 新 Release 先创建为草稿，上传所有附件后公开；重跑时更新说明并覆盖同名附件，已有公开 Release 保持公开。

## 权限与配置

仓库需要启用 GitHub Actions，允许 workflow 使用 `GITHUB_TOKEN` 写入 Release。构建 job 仅有 `contents: read`，发布 job 才有 `contents: write`。不需要手动配置第三方密钥。

当前安装包没有配置代码签名。macOS/Linux 的运行时分发尚未适配，因此未加入发布构建。

## 本地检查发布元数据

```powershell
python scripts/release.py notes v1.0.0 .local/release-notes.md
python -m unittest discover -s scripts/tests
# 完成 pnpm --dir app build:release 后：
python scripts/release.py files v1.0.0 .local/release-files
```

收集目录必须为空，防止把上次版本的文件一起上传。整个 CI 在 GitHub runner 上执行成功后，才能确认托管环境的构建与发布通过。
