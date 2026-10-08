use super::{checked, library::collection, CollectionPage, Netease};
use crate::model::AppResult;
use serde_json::Value;

fn validate_keyword(keyword: &str) -> AppResult<&str> {
    let keyword = keyword.trim();
    if keyword.is_empty() || keyword.len() > 256 {
        return Err("请输入不超过 256 字节的搜索词".into());
    }
    Ok(keyword)
}

fn suggestions(body: &Value) -> Vec<String> {
    let mut values = Vec::new();
    for item in body
        .pointer("/result/allMatch")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(keyword) = item
            .get("keyword")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            if !values.iter().any(|v| v == keyword) {
                values.push(keyword.to_owned());
            }
            if values.len() == 5 {
                break;
            }
        }
    }
    values
}

impl Netease {
    pub async fn search_suggestions(&self, keyword: &str) -> AppResult<Vec<String>> {
        let query = self
            .query()?
            .param("keywords", validate_keyword(keyword)?)
            .param("type", "mobile");
        Ok(suggestions(
            &checked(self.client.search_suggest(&query)).await?,
        ))
    }

    pub async fn search_collections(
        &self,
        keyword: &str,
        kind: &str,
        offset: u32,
    ) -> AppResult<CollectionPage> {
        let (search_type, field, count) = match kind {
            "playlist" => ("1000", "playlists", "playlistCount"),
            "artist" => ("100", "artists", "artistCount"),
            "album" => ("10", "albums", "albumCount"),
            _ => return Err("不支持的搜索类型".into()),
        };
        let query = self
            .query()?
            .param("keywords", validate_keyword(keyword)?)
            .param("type", search_type)
            .param("limit", "30")
            .param("offset", &offset.to_string());
        let body = checked(self.client.cloudsearch(&query)).await?;
        let result = body.get("result").ok_or("搜索响应缺少结果")?;
        let raw = result.get(field).and_then(Value::as_array);
        let size = raw.map_or(0, Vec::len);
        let items = raw
            .into_iter()
            .flatten()
            .filter_map(|value| collection(value, kind))
            .collect();
        let more = size > 0
            && result
                .get(count)
                .and_then(Value::as_u64)
                .map_or(size == 30, |total| {
                    u64::from(offset) + (size as u64) < total
                });
        Ok(CollectionPage { items, more })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn suggestions_keep_order_deduplicate_and_limit() {
        let body = json!({"result":{"allMatch":[{"keyword":" a "},{"keyword":"a"},{"keyword":""},{"keyword":"b"},{"keyword":"c"},{"keyword":"d"},{"keyword":"e"},{"keyword":"f"}]}});
        assert_eq!(suggestions(&body), ["a", "b", "c", "d", "e"]);
        assert!(suggestions(&json!({"result":{}})).is_empty());
    }
    #[test]
    fn keywords_are_trimmed_and_bounded() {
        assert_eq!(validate_keyword(" hello ").unwrap(), "hello");
        assert!(validate_keyword(" ").is_err());
        assert!(validate_keyword(&"中".repeat(86)).is_err());
    }
}
