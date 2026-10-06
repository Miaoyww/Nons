use crate::{
    model::{AppResult, Track, TrackSource},
    storage::{Store, MAX_LYRIC_BYTES},
};
use lofty::{prelude::*, probe::Probe};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

pub const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif", "ape", "wv",
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

pub fn import(
    paths: Vec<String>,
    store: Arc<Store>,
    cover_dir: PathBuf,
    fallback: String,
) -> AppResult<ImportReport> {
    if paths.len() > 1000 {
        return Err("单次选择的路径过多".into());
    }
    let mut report = ImportReport {
        imported: 0,
        skipped: 0,
        errors: vec![],
    };
    let mut batch = Vec::with_capacity(64);
    for root in paths {
        // walkdir does not follow symlinks; max_open bounds file handles.
        for entry in walkdir::WalkDir::new(root).follow_links(false).max_open(8) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    report.skipped += 1;
                    continue;
                }
            };
            if !entry.file_type().is_file() || !is_audio(entry.path()) {
                continue;
            }
            match read_track(entry.path(), &cover_dir, &fallback, &store) {
                Ok(track) => {
                    batch.push(track);
                    report.imported += 1;
                }
                Err(error) => {
                    report.skipped += 1;
                    if report.errors.len() < 20 {
                        report
                            .errors
                            .push(format!("{}：{error}", entry.file_name().to_string_lossy()));
                    }
                }
            }
            if batch.len() == 64 {
                store.save_tracks(&batch)?;
                batch.clear();
            }
        }
    }
    store.save_tracks(&batch)?;
    Ok(report)
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| AUDIO_EXTENSIONS.contains(&s.to_ascii_lowercase().as_str()))
}

fn read_track(path: &Path, cover_dir: &Path, fallback: &str, store: &Store) -> AppResult<Track> {
    let path = path.canonicalize().map_err(|_| "文件路径不可用")?;
    let path = path
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    let key = format!("local:{:x}", Sha256::digest(path.as_bytes()));
    let tagged = Probe::open(&path)
        .map_err(|_| "无法打开文件")?
        .read()
        .map_err(|_| "无法读取音频元数据")?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let mut cover = fallback.to_string();
    if let Some(picture) = tag
        .and_then(|t| t.pictures().first())
        .filter(|p| p.data().len() <= MAX_LYRIC_BYTES)
    {
        let total: u64 = std::fs::read_dir(cover_dir)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum();
        if total + picture.data().len() as u64 <= 32 * 1024 * 1024 {
            let name = format!("{:x}.img", Sha256::digest(picture.data()));
            let dest = cover_dir.join(name);
            if !dest.exists() {
                std::fs::write(&dest, picture.data()).map_err(|e| e.to_string())?;
            }
            cover = dest.to_string_lossy().to_string();
        }
    }
    // Re-importing a file must preserve a user's explicit lyric binding.
    let netease_id = store.track(&key).ok().and_then(|t| t.netease_id());
    Ok(Track {
        key,
        title: tag
            .and_then(|t| t.title())
            .filter(|s| !s.is_empty())
            .map(|s| s.into_owned())
            .unwrap_or_else(|| {
                Path::new(&path)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            }),
        artist: tag
            .and_then(|t| t.artist())
            .filter(|s| !s.is_empty())
            .map(|s| s.into_owned())
            .unwrap_or_else(|| "未知艺术家".into()),
        album: tag
            .and_then(|t| t.album())
            .filter(|s| !s.is_empty())
            .map(|s| s.into_owned())
            .unwrap_or_else(|| "未知专辑".into()),
        duration_ms: tagged.properties().duration().as_millis() as u64,
        cover,
        source: TrackSource::Local { path, netease_id },
    })
}
