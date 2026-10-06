use gstreamer::{self as gst, prelude::*};

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
