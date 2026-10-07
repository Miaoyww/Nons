# 歌词搜索与评分来源

- `app/src-tauri/src/qq_lyrics.rs` 的 QQ 搜索协议与 LRC 取词参数改写自 Lyricify-Lyrics-Helper 的 `Searchers/QQMusicSearcher.cs`、`Providers/Web/QQMusic/Api.cs`，原许可 Apache-2.0，见 [许可](Lyricify-Lyrics-Helper-LICENSE.txt)。此次将 C# 网络逻辑改写为 Rust，增加响应大小与查询时间上限，仅接入 LRC 接口。
- 元数据评分、查询变体改写自 AF-Media-Bar 的 `LyricsMetadataScore.cs`、`LyricsSearchQueryPolicy.cs`、`LyricsArtistPolicy.cs`，Copyright (c) 2026 AmorFate，MIT，见 [许可](AF-Media-Bar-LICENSE.txt)。保留评分权重、时长衰减与偶数舍入；歌手采用 Nons 已有的结构化分隔符。
- `similarity` 函数移植 F23.StringSimilarity 的 `JaroWinkler.cs`，Copyright 2016 feature[23]，MIT，见 [许可](F23-StringSimilarity-LICENSE.txt)。保留 UTF-16、前缀加分及运算精度语义，以与原评分一致。

参考本地源项目：`C:/Projects/AFMediaBar/AF-Media-Bar` 和 `C:/Projects/AFMediaBar/Lyricify-Lyrics-Helper`。
