use crate::secrets;
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub text: String, pub source: String, pub target: String,
    pub style: String, pub provider: String, pub base_url: Option<String>,
}
#[derive(Serialize, Clone)]
pub struct TranslateResult { pub text: String, pub detected: Option<String> }
#[derive(Serialize)]
pub struct Lang { pub code: String, pub name: String }

const NO_KEY: &str = "No API key is configured for this provider. Open Settings (gear icon) and add one.";

async fn send(req: RequestBuilder) -> Result<Value, String> {
    let resp = req.timeout(Duration::from_secs(20)).send().await
        .map_err(|e| format!("Network error: {} Check your internet connection.", e.without_url()))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status.is_success() { return Ok(body); }
    let msg = body.pointer("/error/message").and_then(|v| v.as_str())
        .or_else(|| body.get("error").and_then(|v| v.as_str())).unwrap_or("request failed");
    let kind = if status.is_server_error() || status.as_u16() == 429 { "Server" } else { "Request" };
    Err(format!("{kind} error ({}): {msg}", status.as_u16()))
}

// Retries transient failures (network, 5xx, 429) with a short backoff. Auth/config errors fail fast.
async fn retry<F, Fut, T>(mut f: F) -> Result<T, String>
where F: FnMut() -> Fut, Fut: std::future::Future<Output = Result<T, String>> {
    let mut last = String::new();
    for i in 0..3u64 {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let transient = e.starts_with("Network") || e.starts_with("Server");
                last = e;
                if !transient { break; }
                tokio::time::sleep(Duration::from_millis(500 * (i + 1))).await;
            }
        }
    }
    Err(last)
}

pub async fn translate(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    match r.provider.as_str() {
        "google" => retry(|| google(c, r)).await,
        "libretranslate" => retry(|| libre(c, r)).await,
        "llm" => retry(|| llm(c, r)).await,
        other => Err(format!("Unknown provider: {other}")),
    }
}

async fn google(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let key = secrets::get("google").ok_or(NO_KEY)?;
    let mut body = json!({"q": r.text, "target": r.target, "format": "text"});
    if r.source != "auto" { body["source"] = json!(r.source); }
    let v = send(c.post("https://translation.googleapis.com/language/translate/v2")
        .header("x-goog-api-key", key).json(&body)).await?;
    let t = v.pointer("/data/translations/0").ok_or("Unexpected response from Google")?;
    Ok(TranslateResult {
        text: t["translatedText"].as_str().unwrap_or("").to_string(),
        detected: t["detectedSourceLanguage"].as_str().map(String::from),
    })
}

fn libre_base(r: Option<&str>) -> String {
    r.filter(|s| !s.trim().is_empty()).unwrap_or("https://libretranslate.com").trim_end_matches('/').to_string()
}

async fn libre(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let mut body = json!({"q": r.text, "source": r.source, "target": r.target, "format": "text"});
    if let Some(k) = secrets::get("libretranslate") { body["api_key"] = json!(k); }
    let v = send(c.post(format!("{}/translate", libre_base(r.base_url.as_deref())))
        .json(&body)).await?;
    Ok(TranslateResult {
        text: v["translatedText"].as_str().ok_or("Unexpected response from LibreTranslate")?.to_string(),
        detected: v.pointer("/detectedLanguage/language").and_then(|x| x.as_str()).map(String::from),
    })
}

// Optional AI provider: the only one that can honor translation styles.
async fn llm(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let key = secrets::get("llm").ok_or(NO_KEY)?;
    let style = match r.style.as_str() {
        "natural" => "Use natural, idiomatic phrasing.",
        "professional" => "Use a professional business tone.",
        "formal" => "Use a formal register.",
        "casual" => "Use a casual, conversational register.",
        "simple" => "Use simple, plain wording.",
        _ => "Translate faithfully and literally where sensible.",
    };
    let target = if r.target == "bn" { "Bengali (bn)".to_string() } else { format!("the language with code '{}'", r.target) };
    let system = format!(
        "You are a translation engine. Translate the user's text into {target}. {style} \
         Preserve paragraph breaks, numbers and formatting. Output only the translation, nothing else.");
    let v = send(c.post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key).header("anthropic-version", "2023-06-01")
        .json(&json!({"model": "claude-sonnet-5-5", "max_tokens": 4096, "system": system,
                      "messages": [{"role": "user", "content": r.text}]}))).await?;
    let text = v.pointer("/content/0/text").and_then(|x| x.as_str()).ok_or("Unexpected response")?;
    Ok(TranslateResult { text: text.trim().to_string(), detected: None })
}

pub async fn languages(c: &Client, provider: &str, base_url: Option<&str>) -> Result<Vec<Lang>, String> {
    match provider {
        "google" => {
            let key = secrets::get("google").ok_or(NO_KEY)?;
            let v = send(c.get("https://translation.googleapis.com/language/translate/v2/languages?target=en")
                .header("x-goog-api-key", key)).await?;
            Ok(v.pointer("/data/languages").and_then(|x| x.as_array()).map(|a| a.iter().map(|l| Lang {
                code: l["language"].as_str().unwrap_or("").into(),
                name: l["name"].as_str().unwrap_or("").into() }).collect()).unwrap_or_default())
        }
        "libretranslate" => {
            let v = send(c.get(format!("{}/languages", libre_base(base_url)))).await?;
            Ok(v.as_array().map(|a| a.iter().map(|l| Lang {
                code: l["code"].as_str().unwrap_or("").into(),
                name: l["name"].as_str().unwrap_or("").into() }).collect()).unwrap_or_default())
        }
        // The AI provider has no language endpoint; the UI uses its built-in list.
        _ => Ok(vec![]),
    }
}
