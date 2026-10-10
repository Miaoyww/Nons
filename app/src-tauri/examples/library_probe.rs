//! Read-only opt-in library probe; never prints account identifiers or cookies.
#[path = "../src/local/encoded_audio.rs"]
#[allow(dead_code)]
mod encoded_audio;
#[path = "../src/model/mod.rs"]
#[allow(dead_code)]
mod model;
#[path = "../src/music/mod.rs"]
#[allow(dead_code)]
mod music;
#[path = "../src/netease/mod.rs"]
#[allow(dead_code)]
mod netease;
#[path = "../src/local/playback_resource.rs"]
#[allow(dead_code)]
mod playback_resource;
#[path = "../src/infrastructure/wasm_runtime.rs"]
#[allow(dead_code)]
mod wasm_runtime;

#[tokio::main]
async fn main() -> Result<(), String> {
    let api = netease::Netease::new()?;
    let summary = api.library_summary().await?;
    println!(
        "Account loaded; liked playlist found: {}; preview tracks: {}",
        summary.liked_playlist.is_some(),
        summary.liked_tracks.len()
    );
    if let Some(error) = summary.liked_error {
        return Err(error);
    }
    for kind in ["playlist", "album", "artist"] {
        let page = api.library_collections(kind, 0, "all").await?;
        println!(
            "{kind}: {} collections on first page; more={}",
            page.items.len(),
            page.more
        );
        if let Some(item) = page.items.first() {
            let tracks = api.library_tracks(kind, item.id, 0, 100).await?;
            println!(
                "{kind}: {} detail tracks; total={}",
                tracks.tracks.len(),
                tracks.total
            );
        }
    }
    Ok(())
}
