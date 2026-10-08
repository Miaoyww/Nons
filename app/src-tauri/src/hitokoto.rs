use crate::model::AppResult;
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct Quote {
    hitokoto: String,
}

fn quote_text(bytes: &[u8]) -> AppResult<String> {
    let quote: Quote = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let text = quote.hitokoto.trim();
    if text.is_empty() || text.chars().count() > 160 {
        return Err("一言内容无效".into());
    }
    Ok(text.into())
}

pub async fn fetch(client: &reqwest::Client) -> AppResult<String> {
    let mut response = client
        .get("https://v1.hitokoto.cn/?encode=json")
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    const LIMIT: usize = 16 * 1024;
    if response
        .content_length()
        .is_some_and(|size| size > LIMIT as u64)
    {
        return Err("一言响应过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("一言响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    quote_text(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_quote_and_rejects_missing_empty_or_invalid_content() {
        assert_eq!(quote_text(br#"{"hitokoto":"  hello  "}"#).unwrap(), "hello");
        for bytes in [
            br#"{}"#.as_slice(),
            br#"{"hitokoto":" "}"#,
            br#"{"hitokoto":null}"#,
            b"<html>error</html>",
        ] {
            assert!(quote_text(bytes).is_err());
        }
        let oversized = serde_json::json!({"hitokoto":"a".repeat(161)});
        assert!(quote_text(&serde_json::to_vec(&oversized).unwrap()).is_err());
    }
}
