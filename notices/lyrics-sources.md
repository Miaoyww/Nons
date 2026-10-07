# 歌词搜索与评分来源

- `app/src-tauri/src/qq_lyrics.rs` 的 QQ 搜索协议与 QRC/LRC 取词参数改写自 Lyricify-Lyrics-Helper 的 `Searchers/QQMusicSearcher.cs`、`Providers/Web/QQMusic/Api.cs`，原许可 Apache-2.0，见 [许可](Lyricify-Lyrics-Helper-LICENSE.txt)。此次将 C# 网络逻辑改写为 Rust，增加响应大小与查询时间上限，并解析加密 XML 中的正文、翻译和发音。
- `app/src-tauri/src/qrc_decrypt.rs` 的 QRC 分组密码源码来自 [lyrics-crypto 0.5.0](https://crates.io/crates/lyrics-crypto/0.5.0)，上游提交 `0049d047def738c5710a0555d85ed2fcfe7eef50`，作者 ChouChiu，Apache-2.0，见 [许可](lyrics-crypto-LICENSE.txt)。只保留 QRC 所需算法；输入严格检查十六进制和 8 字节块对齐，解压改为最多 2MiB 的流式读取，并检查 UTF-8。前端 QRC 解析复用项目已安装的 AMLL lyric 包。
- 元数据评分、查询变体改写自 AF-Media-Bar 的 `LyricsMetadataScore.cs`、`LyricsSearchQueryPolicy.cs`、`LyricsArtistPolicy.cs`，Copyright (c) 2026 AmorFate，MIT，见 [许可](AF-Media-Bar-LICENSE.txt)。保留评分权重、时长衰减与偶数舍入；歌手采用 Nons 已有的结构化分隔符。
- `similarity` 函数移植 F23.StringSimilarity 的 `JaroWinkler.cs`，Copyright 2016 feature[23]，MIT，见 [许可](F23-StringSimilarity-LICENSE.txt)。保留 UTF-16、前缀加分及运算精度语义，以与原评分一致。

参考本地源项目：`C:/Projects/AFMediaBar/AF-Media-Bar` 和 `C:/Projects/AFMediaBar/Lyricify-Lyrics-Helper`。
