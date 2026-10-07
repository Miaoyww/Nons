use crate::model::PlaybackStatus;
use gstreamer::{self as gst, prelude::*};

pub fn update_buffering(
    playbin: &gst::Element,
    percent: i32,
) -> Result<PlaybackStatus, gst::StateChangeError> {
    let buffering = percent < 100;
    playbin.set_state(if buffering {
        gst::State::Paused
    } else {
        gst::State::Playing
    })?;
    Ok(if buffering {
        PlaybackStatus::Buffering
    } else if playbin.current_state() == gst::State::Playing {
        // A late/repeated 100% message may arrive after StateChanged(Playing).
        // Reapplying the same target does not emit another state transition.
        PlaybackStatus::Playing
    } else {
        PlaybackStatus::Loading
    })
}

pub fn start_stream(
    playbin: &gst::Element,
    uri: &str,
    volume: f64,
    target: gst::State,
) -> Result<(), gst::StateChangeError> {
    playbin.set_property("uri", uri);
    // autoaudiosink can create a new hardware volume control after NULL.
    // Reapply the global volume before any buffers reach the new output.
    playbin.set_property("volume", volume.clamp(0.0, 1.0));
    playbin.set_state(target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_completed_buffering_keeps_actual_playing_status() {
        gst::init().unwrap();
        let pipeline =
            gst::parse::launch("audiotestsrc is-live=true ! fakesink sync=true").unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        assert_eq!(
            pipeline.state(gst::ClockTime::from_seconds(2)).1,
            gst::State::Playing
        );
        // Once already Playing, setting Playing again produces no new transition.
        let first = update_buffering(&pipeline, 100).unwrap();
        let repeated = update_buffering(&pipeline, 100).unwrap();
        pipeline.set_state(gst::State::Null).unwrap();
        assert_eq!(first, PlaybackStatus::Playing);
        assert_eq!(repeated, PlaybackStatus::Playing);
    }

    #[test]
    fn incomplete_buffering_pauses_without_reporting_playing() {
        gst::init().unwrap();
        let pipeline =
            gst::parse::launch("audiotestsrc is-live=true ! fakesink sync=true").unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        assert_eq!(
            pipeline.state(gst::ClockTime::from_seconds(2)).1,
            gst::State::Playing
        );
        let status = update_buffering(&pipeline, 25).unwrap();
        let actual = pipeline.state(gst::ClockTime::from_seconds(2)).1;
        pipeline.set_state(gst::State::Null).unwrap();
        assert_eq!(status, PlaybackStatus::Buffering);
        assert_eq!(actual, gst::State::Paused);
    }
}
