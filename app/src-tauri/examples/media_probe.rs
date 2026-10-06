//! Read only: checks only NonsPlayer sessions, never sends system media keys.
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
