# Bundled HTTP source

Vendored from `gst-plugin-reqwest` 0.15.4 (MIT OR Apache-2.0).
Upstream commit: `1afff3711855238433862c0ce3bf34918e500386`, `net/reqwest`.
Crates.io archive SHA256: `f1f94618634cba8af1467e3745455a4d5252442b1ebfeb5160d3f84299f85462`.
Source: https://crates.io/crates/gst-plugin-reqwest/0.15.4

Nons changes:

- Redact media URI, request headers and response Debug from diagnostics; strip
  URLs from network errors.
- Disable automatic HTTP redirects for adapter resource handoff; the provider must
  resolve the final resource again rather than forwarding access to another URL.

- Statically register as plugin `nonsreqwest`, factory `nonshttpsrc`, GObject
  `NonsReqwestHttpSrc` to avoid collisions with runtime-installed plugins.
- Rank above the standard HTTP sources for consistent behavior across installs.
- Send `Range: bytes=0-` on the initial request. A 206 response with matching
  Content-Range and known length proves range support even when Accept-Ranges
  is missing. Servers ignoring Range retain upstream's nonseekable behavior.

- Add a bounded `retries` property (default 2, maximum 10). On a read error
  or timeout, resume a proven seekable resource at the last emitted byte offset.
  The budget survives successful partial reads and is reset only for a new
  request/seek. A changed size or ignored range is rejected; flushing cancels
  recovery. Known byte boundaries produce EOS without an extra read.
- Regression coverage includes disconnects in the speculative next source during
  playbin3 gapless playback, comparing every decoded PCM sample across the seam.

No custom transport, full-song predownload, or unbounded cache is introduced.
The upstream response validation, cancellation, TLS and range requests remain
in use. Updating upstream requires reapplying these small changes and running
`tests/http_seek.rs`, `tests/http_recovery.rs`, `tests/http_gapless.rs` and the
vendor HTTP/2 unit tests, plus the opt-in `network_probe` (which verifies actual
timeline advancement after seeking, not just acceptance of the command).
