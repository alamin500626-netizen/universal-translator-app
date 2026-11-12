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

async fn send(req: RequestBuilder) -> Result<Value, String> {
    let resp = req.timeout(Duration::from_secs(30)).send().await
        .map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let raw_text = resp.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&raw_text).unwrap_or(Value::Null);
    if status.is_success() { return Ok(body); }
    let msg = body.pointer("/error/message").and_then(|v| v.as_str())
        .or_else(|| body.get("error").and_then(|v| v.as_str()))
        .unwrap_or(&raw_text);
    let short_msg: String = msg.chars().take(120).collect();
    Err(format!("API Error ({}): {}", status.as_u16(), short_msg))
}

pub async fn translate(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    match r.provider.as_str() {
        "gemini" | "auto_ai" | "llm" => smart_ai(c, r).await,
        "google" => free_google(c, r).await,
        "libretranslate" => libre(c, r).await,
        other => Err(format!("Unknown provider: {other}")),
    }
}

async fn smart_ai(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let raw_key = secrets::get("gemini")
        .or_else(|| secrets::get("llm"))
        .or_else(|| secrets::get("google"))
        .unwrap_or_default();
    let key = raw_key.trim();

    // If no API key is saved, automatically use Free Translation so it never fails!
    if key.is_empty() {
        if r.text.starts_with("AUDIO_B64:") {
            return Err("Voice recording requires a free Gemini API key in Settings.".to_string());
        }
        return free_google(c, r).await;
    }

    if key.starts_with("sk-or-") {
        return openai_compatible(c, r, key, "https://openrouter.ai", "google/gemini-2.5-flash").await;
    }
    if key.starts_with("gsk_") {
        return openai_compatible(c, r, key, "https://groq.com", "llama-3.3-70b-versatile").await;
    }
    if key.starts_with("sk-ant-") {
        return claude_api(c, r, key).await;
    }
    if key.starts_with("sk-") {
        return openai_compatible(c, r, key, "https://openai.com", "gpt-4o-mini").await;
    }

    gemini_auto(c, r, key).await
}

async fn gemini_auto(c: &Client, r: &TranslateRequest, key: &str) -> Result<TranslateResult, String> {
    let mut models: Vec<String> = Vec::new();
    let list_url = format!("https://googleapis.com{}", key);
    if let Ok(list) = send(c.get(&list_url)).await {
        if let Some(arr) = list.get("models").and_then(|m| m.as_array()) {
            for m in arr {
                let name = m["name"].as_str().unwrap_or("").trim_start_matches("models/");
                let ok = m["supportedGenerationMethods"].as_array()
                    .map(|a| a.iter().any(|x| x.as_str() == Some("generateContent"))).unwrap_or(false);
                if ok && name.contains("flash") && !name.contains("lite") {
                    models.push(name.to_string());
                }
            }
            for m in arr {
                let name = m["name"].as_str().unwrap_or("").trim_start_matches("models/");
                let ok = m["supportedGenerationMethods"].as_array()
                    .map(|a| a.iter().any(|x| x.as_str() == Some("generateContent"))).unwrap_or(false);
                if ok && name.contains("gemini") && !models.contains(&name.to_string()) {
                    models.push(name.to_string());
                }
            }
        }
    }
    for fb in ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-2.0-flash", "gemini-flash-latest"] {
        if !models.contains(&fb.to_string()) { models.push(fb.to_string()); }
    }

    let payload = if let Some(audio_b64) = r.text.strip_prefix("AUDIO_B64:") {
        let lang_hint = if r.source == "bn" || r.source == "auto" { "Bengali (Bangla)" } else { &r.source };
        json!({
            "contents": [{
                "parts": [
                    { "text": format!("Listen to this audio and transcribe exactly what is spoken in {}. Output ONLY the transcribed text, nothing else.", lang_hint) },
                    { "inline_data": { "mime_type": "audio/webm", "data": audio_b64 } }
                ]
            }]
        })
    } else {
        let target = if r.target == "bn" { "Bengali (Bangla)".to_string() } else { format!("language code '{}'", r.target) };
        let prompt = format!("Translate into {target}. Preserve formatting. Output ONLY the translated text:\n\n{}", r.text);
        json!({ "contents": [{ "parts": [{ "text": prompt }] }] })
    };

    let mut last_err = String::from("No working Gemini model found.");
    for model in models.iter().take(6) {
        let url = format!("https://googleapis.com{}:generateContent?key={}", model, key);
        match send(c.post(&url).json(&payload)).await {
            Ok(v) => {
                if let Some(text) = v.pointer("/candidates/0/content/parts/0/text").and_then(|x| x.as_str()) {
                    return Ok(TranslateResult { text: text.trim().to_string(), detected: None });
                }
            }
            Err(e) => { last_err = e; }
        }
    }
    Err(last_err)
}

async fn free_google(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let sl = if r.source.is_empty() { "auto" } else { &r.source };
    let v = send(c.get("https://googleapis.com")
        .query(&[("client", "gtx"), ("sl", sl), ("tl", &r.target), ("dt", "t"), ("q", &r.text)])).await?;
    let mut out = String::new();
    if let Some(arr) = v.get(0).and_then(|x| x.as_array()) {
        for item in arr {
            if let Some(part) = item.get(0).and_then(|x| x.as_str()) {
                out.push_str(part);
            }
        }
    }
    if out.is_empty() { return Err("Translation failed.".to_string()); }
    let det = v.get(2).and_then(|x| x.as_str()).map(String::from);
    Ok(TranslateResult { text: out, detected: det })
}

async fn openai_compatible(c: &Client, r: &TranslateRequest, key: &str, url: &str, model: &str) -> Result<TranslateResult, String> {
    let target = if r.target == "bn" { "Bengali (Bangla)".to_string() } else { format!("language code '{}'", r.target) };
    let sys = format!("Translate into {target}. Output ONLY the translated text.");
    let v = send(c.post(url).bearer_auth(key).json(&json!({
        "model": model,
        "messages": [{ "role": "system", "content": sys }, { "role": "user", "content": r.text }]
    }))).await?;
    let text = v.pointer("/choices/0/message/content").and_then(|x| x.as_str()).ok_or("Unexpected response")?;
    Ok(TranslateResult { text: text.trim().to_string(), detected: None })
}

async fn claude_api(c: &Client, r: &TranslateRequest, key: &str) -> Result<TranslateResult, String> {
    let target = if r.target == "bn" { "Bengali (bn)".to_string() } else { format!("language code '{}'", r.target) };
    let system = format!("Translate into {target}. Output only the translation.");
    let v = send(c.post("https://anthropic.com")
        .header("x-api-key", key).header("anthropic-version", "2023-06-01")
        .json(&json!({"model": "claude-sonnet-4-6", "max_tokens": 4096, "system": system,
                      "messages": [{"role": "user", "content": r.text}]}))).await?;
    let text = v.pointer("/content/0/text").and_then(|x| x.as_str()).ok_or("Unexpected response")?;
    Ok(TranslateResult { text: text.trim().to_string(), detected: None })
}

fn libre_base(r: Option<&str>) -> String {
    r.filter(|s| !s.trim().is_empty()).unwrap_or("https://libretranslate.com").trim_end_matches('/').to_string()
}

async fn libre(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let mut body = json!({"q": r.text, "source": r.source, "target": r.target, "format": "text"});
    if let Some(k) = secrets::get("libretranslate") { body["api_key"] = json!(k); }
    let v = send(c.post(format!("{}/translate", libre_base(r.base_url.as_deref()))).json(&body)).await?;
    Ok(TranslateResult {
        text: v["translatedText"].as_str().ok_or("Unexpected response")?.to_string(),
        detected: v.pointer("/detectedLanguage/language").and_then(|x| x.as_str()).map(String::from),
    })
}

pub async fn languages(c: &Client, provider: &str, base_url: Option<&str>) -> Result<Vec<Lang>, String> {
    match provider {
        "libretranslate" => {
            let v = send(c.get(format!("{}/languages", libre_base(base_url)))).await?;
            Ok(v.as_array().map(|a| a.iter().map(|l| Lang {
                code: l["code"].as_str().unwrap_or("").into(),
                name: l["name"].as_str().unwrap_or("").into(),
            }).collect()).unwrap_or_default())
        }
        _ => Ok(vec![]),
    }
}
