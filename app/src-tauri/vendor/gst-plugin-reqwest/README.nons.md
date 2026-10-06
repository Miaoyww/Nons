# Bundled HTTP source

Vendored from `gst-plugin-reqwest` 0.15.4 (MIT OR Apache-2.0).
Upstream commit: `1afff3711855238433862c0ce3bf34918e500386`, `net/reqwest`.
Crates.io archive SHA256: `f1f94618634cba8af1467e3745455a4d5252442b1ebfeb5160d3f84299f85462`.
Source: https://crates.io/crates/gst-plugin-reqwest/0.15.4

Nons changes:

- Statically register as plugin `nonsreqwest`, factory `nonshttpsrc`, GObject
  `NonsReqwestHttpSrc` to avoid collisions with runtime-installed plugins.
- Rank above the standard HTTP sources for consistent behavior across installs.
- Send `Range: bytes=0-` on the initial request. A 206 response with matching
  Content-Range and known length proves range support even when Accept-Ranges
  is missing. Servers ignoring Range retain upstream's nonseekable behavior.

No custom transport, full-song predownload, or unbounded cache is introduced.
The upstream response validation, cancellation, TLS and range requests remain
in use. Updating upstream requires reapplying these small changes and running
`tests/http_seek.rs` plus the opt-in `network_probe` (which verifies actual
timeline advancement after seeking, not just acceptance of the command).
