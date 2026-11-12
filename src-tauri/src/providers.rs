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

const NO_KEY: &str = "No API key found. Click Settings (gear icon) and paste any API key (Gemini, ChatGPT, Groq, OpenRouter).";

async fn send(req: RequestBuilder) -> Result<Value, String> {
    let resp = req.timeout(Duration::from_secs(30)).send().await
        .map_err(|e| format!("Connection failed: {}. Check internet or firewall.", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status.is_success() { return Ok(body); }
    let msg = body.pointer("/error/message").and_then(|v| v.as_str())
        .or_else(|| body.get("error").and_then(|v| v.as_str())).unwrap_or("request failed");
    Err(format!("API Error ({}): {msg}", status.as_u16()))
}

pub async fn translate(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    match r.provider.as_str() {
        "gemini" | "auto_ai" => smart_ai(c, r).await,
        "google" => google(c, r).await,
        "libretranslate" => libre(c, r).await,
        "llm" => smart_ai(c, r).await,
        other => Err(format!("Unknown provider: {other}")),
    }
}

// Universal Smart AI: Auto-detects Gemini, ChatGPT (OpenAI), Groq, OpenRouter, or Claude keys & finds working models automatically!
async fn smart_ai(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let raw_key = secrets::get("gemini")
        .or_else(|| secrets::get("llm"))
        .or_else(|| secrets::get("google"))
        .ok_or(NO_KEY)?;
    let key = raw_key.trim();
    if key.is_empty() { return Err(NO_KEY.to_string()); }

    // 1. OpenRouter Key (sk-or-...)
    if key.starts_with("sk-or-") {
        return openai_compatible(c, r, key, "https://openrouter.ai", "google/gemini-2.0-flash-exp:free").await;
    }
    // 2. Groq Free Key (gsk_...)
    if key.starts_with("gsk_") {
        return openai_compatible(c, r, key, "https://groq.com", "llama-3.3-70b-versatile").await;
    }
    // 3. Anthropic Claude Key (sk-ant-...)
    if key.starts_with("sk-ant-") {
        return claude_api(c, r, key).await;
    }
    // 4. OpenAI / ChatGPT Key (sk-...)
    if key.starts_with("sk-") {
        return openai_compatible(c, r, key, "https://openai.com", "gpt-4o-mini").await;
    }

    // 5. Default: Google Gemini API Key (AIza...) - Auto-discovers available models so 404 NEVER happens!
    gemini_auto(c, r, key).await
}

async fn gemini_auto(c: &Client, r: &TranslateRequest, key: &str) -> Result<TranslateResult, String> {
    // Dynamically fetch available models for this exact API key
    let mut models_to_try: Vec<String> = Vec::new();
    if let Ok(list) = send(c.get("https://googleapis.com").header("x-goog-api-key", key)).await {
        if let Some(arr) = list.get("models").and_then(|m| m.as_array()) {
            for m in arr {
                let name = m["name"].as_str().unwrap_or("").trim_start_matches("models/");
                let methods = m["supportedGenerationMethods"].as_array();
                let supports_gen = methods.map(|arr| arr.iter().any(|x| x.as_str() == Some("generateContent"))).unwrap_or(false);
                if supports_gen && name.contains("flash") && !name.contains("8b") && !name.contains("lite") {
                    models_to_try.push(name.to_string());
                }
            }
            for m in arr {
                let name = m["name"].as_str().unwrap_or("").trim_start_matches("models/");
                let supports_gen = m["supportedGenerationMethods"].as_array()
                    .map(|arr| arr.iter().any(|x| x.as_str() == Some("generateContent"))).unwrap_or(false);
                if supports_gen && name.contains("gemini") && !models_to_try.contains(&name.to_string()) {
                    models_to_try.push(name.to_string());
                }
            }
        }
    }
    // Fallback list if model listing was blocked
    for fallback in ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"] {
        if !models_to_try.contains(&fallback.to_string()) {
            models_to_try.push(fallback.to_string());
        }
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
        let style = match r.style.as_str() {
            "natural" => "Use natural, idiomatic phrasing.",
            "professional" => "Use a professional business tone.",
            "formal" => "Use a formal register.",
            "casual" => "Use a casual, conversational register.",
            "simple" => "Use simple, plain wording.",
            _ => "Translate faithfully and accurately.",
        };
        let target = if r.target == "bn" { "Bengali (Bangla)".to_string() } else { format!("language code '{}'", r.target) };
        let prompt = format!(
            "Translate the following text into {target}. {style} Preserve paragraph breaks, numbers and formatting. Output ONLY the translated text, nothing else:\n\n{}",
            r.text
        );
        json!({ "contents": [{ "parts": [{ "text": prompt }] }] })
    };

    let mut last_err = String::from("No working Gemini model found for this API key.");
    for model in models_to_try.iter().take(5) {
        let url = format!("https://googleapis.com/{}:generateContent", model);
        match send(c.post(&url).header("x-goog-api-key", key).json(&payload)).await {
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

async fn openai_compatible(c: &Client, r: &TranslateRequest, key: &str, url: &str, model: &str) -> Result<TranslateResult, String> {
    if r.text.starts_with("AUDIO_B64:") {
        return Err("Voice recording requires a Google Gemini API key.".to_string());
    }
    let target = if r.target == "bn" { "Bengali (Bangla)".to_string() } else { format!("language code '{}'", r.target) };
    let sys = format!("You are a professional translator. Translate into {target}. Output ONLY the translated text.");
    let v = send(c.post(url).bearer_auth(key).json(&json!({
        "model": model,
        "messages": [
            { "role": "system", "content": sys },
            { "role": "user", "content": r.text }
        ]
    }))).await?;
    let text = v.pointer("/choices/0/message/content").and_then(|x| x.as_str())
        .ok_or("Unexpected response from AI provider")?;
    Ok(TranslateResult { text: text.trim().to_string(), detected: None })
}

async fn claude_api(c: &Client, r: &TranslateRequest, key: &str) -> Result<TranslateResult, String> {
    if r.text.starts_with("AUDIO_B64:") {
        return Err("Voice recording requires a Google Gemini API key.".to_string());
    }
    let target = if r.target == "bn" { "Bengali (bn)".to_string() } else { format!("language code '{}'", r.target) };
    let system = format!("Translate into {target}. Output only the translation.");
    let v = send(c.post("https://anthropic.com")
        .header("x-api-key", key).header("anthropic-version", "2023-06-01")
        .json(&json!({"model": "claude-sonnet-4-20250514", "max_tokens": 4096, "system": system,
                      "messages": [{"role": "user", "content": r.text}]}))).await?;
    let text = v.pointer("/content/0/text").and_then(|x| x.as_str()).ok_or("Unexpected response")?;
    Ok(TranslateResult { text: text.trim().to_string(), detected: None })
}

async fn google(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let key = secrets::get("google").ok_or(NO_KEY)?;
    let mut body = json!({"q": r.text, "target": r.target, "format": "text"});
    if r.source != "auto" { body["source"] = json!(r.source); }
    let v = send(c.post("https://googleapis.com")
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
