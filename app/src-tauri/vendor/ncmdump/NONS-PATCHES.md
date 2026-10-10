Upstream: ncmdump 0.8.0, https://github.com/iqiziqi/ncmdump.rs (MIT, declared in upstream Cargo.toml).
Only NCM decoder and errors included. Fixes: retain audio offset after cover padding; bound allocations; reject truncated containers, short decrypted fields and seek underflow; decrypt only bytes read.
Nons uses Read/Seek, never get_data (can ignore read errors). Regression tests: src/local/encoded_audio.rs.
Format reference: https://github.com/taurusxin/ncmdump (MIT), cloned separately. No C++ code copied.
