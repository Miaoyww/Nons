//! Opt-in read-only live probe. Never prints cookies or expiring media URLs.
#[path = "../src/model.rs"]
#[allow(dead_code)]
mod model;
#[path = "../src/netease.rs"]
#[allow(dead_code)]
mod netease;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/storage.rs"]
#[allow(dead_code)]
mod storage;
use gstreamer::{self as gst, prelude::*};

#[tokio::main]
async fn main() -> Result<(), String> {
    let api = netease::Netease::new()?;
    let tracks = api.search("纯音乐", 0).await?;
    println!("Search returned {} tracks", tracks.len());
    let mut selected = None;
    for track in tracks.into_iter().take(3) {
        if let Ok(resource) = api.resolve(track, "standard", true).await {
            selected = Some(resource);
            break;
        }
    }
    let resource = selected.ok_or("No accessible full track in the first three results")?;
    let address = url::Url::parse(&resource.uri).map_err(|e| e.to_string())?;
    println!(
        "Media transport: {} host={}",
        address.scheme(),
        address.host_str().unwrap_or_default()
    );
    let response = reqwest::Client::new()
        .get(&resource.uri)
        .header("Range", "bytes=0-1023")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|_| "Media HTTP request failed".to_string())?;
    println!("Media HTTP status: {}", response.status());
    let lyrics = api.lyrics(resource.track.netease_id().unwrap()).await?;
    println!(
        "Resolved actual quality: {:?}; Netease lyrics: {}",
        resource.quality,
        lyrics.is_some()
    );
    gst::init().map_err(|e| e.to_string())?;
    network::prefer_http_source();
    let player = gst::ElementFactory::make("playbin3")
        .build()
        .map_err(|e| e.to_string())?;
    let sink = gst::ElementFactory::make("fakesink")
        .property("sync", true)
        .build()
        .map_err(|e| e.to_string())?;
    player.set_property_from_str("flags", "audio+buffering");
    player.set_property("buffer-size", 4_194_304_i32);
    player.set_property("audio-sink", sink);
    player.set_property("uri", &resource.uri);
    player.connect("source-setup", false, |values| {
        let source = values[1].get::<gst::Element>().unwrap();
        println!("GStreamer source: {}", source.factory().unwrap().name());
        network::configure_source(&source);
        println!(
            "Manual system proxy applied: {}",
            source.find_property("proxy").is_some()
                && source.property::<Option<String>>("proxy").is_some()
        );
        None
    });
    player
        .set_state(gst::State::Playing)
        .map_err(|e| e.to_string())?;
    let bus = player.bus().unwrap();
    let started = std::time::Instant::now();
    let outcome = loop {
        if started.elapsed() > std::time::Duration::from_secs(20) {
            break Err("Online decode timed out".into());
        }
        if player
            .query_position::<gst::ClockTime>()
            .is_some_and(|p| p.mseconds() >= 500)
        {
            println!("Online resource decoded and advanced at least 500 ms");
            break Ok(());
        }
        if let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(100)) {
            match message.view() {
                gst::MessageView::Buffering(value) => println!("Buffering {}%", value.percent()),
                gst::MessageView::StateChanged(value)
                    if message.src().is_some_and(|s| s == &player) =>
                {
                    println!("Pipeline state {:?}", value.current())
                }
                _ => {}
            }
            if let gst::MessageView::Error(error) = message.view() {
                break Err(error.error().to_string());
            }
        }
    };
    let _ = player.set_state(gst::State::Null);
    outcome
}
