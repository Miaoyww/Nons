//! Checks only NonsPlayer sessions. --next explicitly requests a track change.
#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use windows::{
        Media::Control::GlobalSystemMediaTransportControlsSessionManager,
        Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    };
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
    let mut found = false;
    for session in manager.GetSessions()? {
        if !session
            .SourceAppUserModelId()?
            .to_string()
            .to_lowercase()
            .contains("nons")
        {
            continue;
        }
        found = true;
        if std::env::args().any(|arg| arg == "--next") {
            let old_title = session.TryGetMediaPropertiesAsync()?.join()?.Title()?;
            let started = std::time::Instant::now();
            assert!(
                session.TrySkipNextAsync()?.join()?,
                "NonsPlayer must accept Next"
            );
            loop {
                let new_title = session.TryGetMediaPropertiesAsync()?.join()?.Title()?;
                if new_title != old_title {
                    println!("NewTitleAfterMs={}", started.elapsed().as_millis());
                    break;
                }
                assert!(
                    started.elapsed() < std::time::Duration::from_secs(10),
                    "SMTC title did not change within 10 seconds"
                );
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            while session.GetPlaybackInfo()?.PlaybackStatus()?
                != windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                && started.elapsed() < std::time::Duration::from_secs(10)
            {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            println!("PlayingAfterMs={}", started.elapsed().as_millis());
        }
        let playback_status = session.GetPlaybackInfo()?.PlaybackStatus()?;
        println!("PlaybackStatus={playback_status:?}");
        if std::env::args().any(|arg| arg == "--expect-playing") {
            assert_eq!(playback_status, windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing, "SMTC must report Playing while audio is playing after a track change");
        }
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let timeline = session.GetTimelineProperties()?;
        let cover = props.Thumbnail()?.OpenReadAsync()?.join()?.Size()?;
        println!(
            "Title={} Artist={} Album={} CoverBytes={}",
            props.Title()?,
            props.Artist()?,
            props.AlbumTitle()?,
            cover
        );
        println!(
            "Position={} StartTime={} EndTime={} MinSeekTime={} MaxSeekTime={} (100 ns units)",
            timeline.Position()?.Duration,
            timeline.StartTime()?.Duration,
            timeline.EndTime()?.Duration,
            timeline.MinSeekTime()?.Duration,
            timeline.MaxSeekTime()?.Duration
        );
        assert!(!props.Title()?.is_empty());
        assert!(!props.Artist()?.is_empty());
        assert!(!props.AlbumTitle()?.is_empty());
        assert!(cover > 0);
        assert_eq!(timeline.StartTime()?.Duration, 0);
        assert!(timeline.EndTime()?.Duration > 0);
        assert!((0..=timeline.EndTime()?.Duration).contains(&timeline.Position()?.Duration));
    }
    assert!(
        found,
        "Start NonsPlayer and select a track before probing SMTC"
    );
    Ok(())
}
#[cfg(not(windows))]
fn main() {
    eprintln!("SMTC is a Windows API");
}
