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

const NO_KEY: &str = "No API key found. Click the Settings (gear) icon and save your Gemini API key.";

async fn send(req: RequestBuilder) -> Result<Value, String> {
    let resp = req.timeout(Duration::from_secs(25)).send().await
        .map_err(|e| format!("Connection failed: {}. Please check internet or firewall.", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status.is_success() { return Ok(body); }
    let msg = body.pointer("/error/message").and_then(|v| v.as_str())
        .or_else(|| body.get("error").and_then(|v| v.as_str())).unwrap_or("request failed");
    Err(format!("API Error ({}): {msg}", status.as_u16()))
}

pub async fn translate(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    match r.provider.as_str() {
        "gemini" => gemini(c, r).await,
        "google" => google(c, r).await,
        "libretranslate" => libre(c, r).await,
        "llm" => llm(c, r).await,
        other => Err(format!("Unknown provider: {other}")),
    }
}

async fn gemini(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let key = secrets::get("gemini").ok_or(NO_KEY)?;
    let clean_key = key.trim();
    
    // If audio base64 is sent (for Voice-to-Text)
    if let Some(audio_b64) = r.text.strip_prefix("AUDIO_B64:") {
        let lang_hint = if r.source == "bn" || r.source == "auto" { "Bengali (Bangla)" } else { &r.source };
        let url = format!("https://googleapis.com{}", clean_key);
        let v = send(c.post(&url).json(&json!({
            "contents": [{
                "parts": [
                    { "text": format!("Listen to this audio and transcribe exactly what is spoken in {}. Output ONLY the transcribed text, nothing else.", lang_hint) },
                    { "inline_data": { "mime_type": "audio/webm", "data": audio_b64 } }
                ]
            }]
        }))).await?;
        let text = v.pointer("/candidates/0/content/parts/0/text")
            .and_then(|x| x.as_str())
            .ok_or("Could not transcribe audio")?;
        return Ok(TranslateResult { text: text.trim().to_string(), detected: None });
    }

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
    let url = format!("https://googleapis.com{}", clean_key);
    let v = send(c.post(&url).json(&json!({
        "contents": [{ "parts": [{ "text": prompt }] }]
    }))).await?;
    let text = v.pointer("/candidates/0/content/parts/0/text")
        .and_then(|x| x.as_str())
        .ok_or("Unexpected response from Gemini API")?;
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
        text: v["translatedText"].as_str().ok_or("Unexpected response from LibreTranslate")?.to_string(),
        detected: v.pointer("/detectedLanguage/language").and_then(|x| x.as_str()).map(String::from),
    })
}

async fn llm(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let key = secrets::get("llm").ok_or(NO_KEY)?;
    let target = if r.target == "bn" { "Bengali (bn)".to_string() } else { format!("language code '{}'", r.target) };
    let system = format!("Translate into {target}. Output only the translation.");
    let v = send(c.post("https://anthropic.com")
        .header("x-api-key", key).header("anthropic-version", "2023-06-01")
        .json(&json!({"model": "claude-sonnet-4-20250514", "max_tokens": 4096, "system": system,
                      "messages": [{"role": "user", "content": r.text}]}))).await?;
    let text = v.pointer("/content/0/text").and_then(|x| x.as_str()).ok_or("Unexpected response")?;
    Ok(TranslateResult { text: text.trim().to_string(), detected: None })
}

pub async fn languages(c: &Client, provider: &str, base_url: Option<&str>) -> Result<Vec<Lang>, String> {
    match provider {
        "libretranslate" => {
            let v = send(c.get(format!("{}/languages", libre_base(base_url)))).await?;
            Ok(v.as_array().map(|a| a.iter().map(|l| Lang {
                code: l["code"].as_str().unwrap_or("").into(),
                name: l["name"].as_str().unwrap_or("").into() }).collect()).unwrap_or_default())
        }
        _ => Ok(vec![]),
    }
}
