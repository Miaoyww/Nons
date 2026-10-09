use crate::model::AppResult;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Duration};

pub struct Http(pub(super) reqwest::Client);

pub fn valid_host(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        && matches!(url::Host::parse(host), Ok(url::Host::Domain(domain)) if domain == host)
}

pub(super) fn checked_url(hosts: &[String], input: &str) -> AppResult<url::Url> {
    if input.len() > 2048 {
        return Err("HTTP URL 超过 2048 字节".into());
    }
    let url = url::Url::parse(input).map_err(|_| "HTTP URL 无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url.host_str().is_some_and(|host| {
            hosts
                .iter()
                .any(|allowed| allowed == host || (allowed == "*" && valid_host(host)))
        })
    {
        return Err("HTTP 地址不在插件授权范围内".into());
    }
    Ok(url)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    response_type: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

impl Http {
    pub fn new() -> AppResult<Self> {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .pool_max_idle_per_host(1)
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .map(Self)
            .map_err(|e| e.to_string())
    }
    pub async fn request(
        &self,
        hosts: &[String],
        args: &Value,
        active: &std::sync::atomic::AtomicBool,
    ) -> AppResult<Value> {
        let request: Request =
            serde_json::from_value(args.clone()).map_err(|_| "HTTP 请求参数无效")?;
        let url = checked_url(hosts, &request.url)?;
        let method = match request.method.as_deref().unwrap_or("GET") {
            "GET" => reqwest::Method::GET,
            "HEAD" => reqwest::Method::HEAD,
            "POST" => reqwest::Method::POST,
            _ => return Err("HTTP 当前支持 GET、HEAD 和 POST".into()),
        };
        let read_body = match request.response_type.as_deref().unwrap_or("text") {
            "text" => true,
            "none" => false,
            _ => return Err("HTTP 响应类型无效".into()),
        };
        let timeout = request.timeout_ms.unwrap_or(3000);
        if !(1..=3000).contains(&timeout) {
            return Err("HTTP 超时必须为 1 至 3000 毫秒".into());
        }
        let mut builder = self.0.request(method.clone(), url);
        if request.body.as_ref().is_some_and(|body| body.len() > 32768)
            || (request.body.is_some() && method != reqwest::Method::POST)
        {
            return Err("HTTP 正文仅限 POST，最多 32KiB".into());
        }
        let mut header_size = 0;
        for (name, value) in &request.headers {
            header_size += name.len() + value.len();
            if !matches!(
                name.to_ascii_lowercase().as_str(),
                "content-type" | "accept" | "user-agent" | "referer" | "cookie" | "authorization"
            ) || header_size > 16384
            {
                return Err("HTTP 请求头无效或超过 16KiB".into());
            }
            let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| "HTTP 请求头无效")?;
            let value =
                reqwest::header::HeaderValue::from_str(value).map_err(|_| "HTTP 请求头无效")?;
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let operation = tokio::time::timeout(Duration::from_millis(timeout), async {
            let mut response = builder.send().await.map_err(|_| "HTTP 请求失败")?;
            let status = response.status().as_u16();
            let cookies: Vec<String> = response
                .headers()
                .get_all("set-cookie")
                .iter()
                .filter_map(|value| value.to_str().ok().map(str::to_string))
                .collect();
            let mut headers = BTreeMap::new();
            let mut header_bytes = 0;
            for (name, value) in response.headers() {
                let value = value.to_str().map_err(|_| "HTTP 响应头不是文本")?;
                header_bytes += name.as_str().len() + value.len();
                if header_bytes
                    > if method == reqwest::Method::POST {
                        16384
                    } else {
                        4096
                    }
                {
                    return Err("HTTP 响应头超过 4KiB".into());
                }
                headers.insert(name.as_str().to_string(), value.to_string());
            }
            let mut bytes = Vec::new();
            if read_body {
                while let Some(chunk) = response.chunk().await.map_err(|_| "HTTP 响应读取失败")?
                {
                    if bytes.len() + chunk.len() > 8192 {
                        return Err("HTTP 文本响应超过 8KiB".into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
            }
            let body = String::from_utf8(bytes).map_err(|_| "HTTP 响应不是 UTF-8 文本")?;
            Ok(json!({"status":status,"headers":headers,"body":body,"cookies":cookies}))
        });
        tokio::select! {
            result = operation => result.map_err(|_| "HTTP 请求超时")?,
            _ = async {
                while active.load(std::sync::atomic::Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            } => Err("插件已卸载或禁用".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    fn fixture(response: String, delay: Duration) -> (Http, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request);
            std::thread::sleep(delay);
            let _ = socket.write_all(response.as_bytes());
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .resolve("example.org", address)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        (Http(client), server)
    }
    fn run(future: impl std::future::Future<Output = ()>) {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future);
    }
    #[test]
    fn returns_redirect_without_following_and_bounds_text_body() {
        run(async {
            let hosts = vec!["example.org".into()];
            let active = AtomicBool::new(true);
            let (http, server) = fixture("HTTP/1.1 302 Found\r\nLocation: https://unauthorized.test/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), Duration::ZERO);
            let result = http
                .request(
                    &hosts,
                    &json!({"url":"http://example.org/","responseType":"none"}),
                    &active,
                )
                .await
                .unwrap();
            assert_eq!(result["status"], 302);
            assert_eq!(
                result["headers"]["location"],
                "https://unauthorized.test/private"
            );
            server.join().unwrap();
            let (http, server) = fixture(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: 8193\r\nConnection: close\r\n\r\n{}",
                    "a".repeat(8193)
                ),
                Duration::ZERO,
            );
            assert!(http
                .request(&hosts, &json!({"url":"http://example.org/"}), &active)
                .await
                .unwrap_err()
                .contains("8KiB"));
            server.join().unwrap();
        });
    }
    #[test]
    fn requests_timeout_or_cancel_when_the_instance_is_disabled() {
        run(async {
            let hosts = vec!["example.org".into()];
            let response = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let (http, server) = fixture(response.into(), Duration::from_millis(100));
            let active = AtomicBool::new(true);
            assert!(http
                .request(
                    &hosts,
                    &json!({"url":"http://example.org/","timeoutMs":25}),
                    &active
                )
                .await
                .unwrap_err()
                .contains("超时"));
            server.join().unwrap();
            let (http, server) = fixture(response.into(), Duration::from_millis(150));
            let active = Arc::new(AtomicBool::new(true));
            let cancelled = active.clone();
            let toggle = std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(40));
                cancelled.store(false, Ordering::SeqCst);
            });
            assert!(http
                .request(&hosts, &json!({"url":"http://example.org/"}), &active)
                .await
                .unwrap_err()
                .contains("禁用"));
            toggle.join().unwrap();
            server.join().unwrap();
        });
    }
    #[test]
    fn wildcard_host_grants_match_domains_and_keep_url_restrictions() {
        let hosts = vec!["*".into()];
        for input in ["https://example.org/a", "http://sub.other.test/b"] {
            assert!(checked_url(&hosts, input).is_ok(), "{input}");
        }
        for input in [
            "https://user:secret@example.org/",
            "https://example.org:444/",
            "file:///example.org",
            "https://127.0.0.1/",
            "http://[::1]/",
            "http://localhost/",
        ] {
            assert!(checked_url(&hosts, input).is_err(), "{input}");
        }
    }
    #[test]
    fn exact_host_grants_reject_credentials_ports_and_lookalikes() {
        let hosts = vec!["example.org".into()];
        assert!(checked_url(&hosts, "https://example.org/a").is_ok());
        for input in [
            "https://example.org.evil.test/",
            "https://sub.example.org/",
            "https://user:secret@example.org/",
            "https://example.org:444/",
            "file:///example.org",
            "https://127.0.0.1/",
        ] {
            assert!(checked_url(&hosts, input).is_err(), "{input}");
        }
        for host in [
            "*.example.org",
            "Example.org",
            "127.0.0.1",
            "example.org/",
            "example.org:443",
            "localhost",
            "-a.org",
            "a..org",
        ] {
            assert!(!valid_host(host), "{host}");
        }
        assert!(valid_host("api.example.org"));
    }
}
