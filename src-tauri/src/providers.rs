use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

fn encode_uri(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// প্রথমে Google-এর ফ্রি এন্ডপয়েন্ট, ব্যর্থ হলে MyMemory। কোনো API key লাগে না।
pub async fn translate(c: &Client, r: &TranslateRequest) -> Result<TranslateResult, String> {
    let text = r.text.trim();
    if text.is_empty() {
        return Ok(TranslateResult { text: String::new(), detected: None });
    }

    let sl = if r.source.trim().is_empty() { "auto" } else { r.source.trim() };
    let tl = if r.target.trim().is_empty() { "bn" } else { r.target.trim() };

    // ১. প্রাইমারি: Google ফ্রি এন্ডপয়েন্ট
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        encode_uri(sl), encode_uri(tl), encode_uri(text)
    );

    if let Ok(resp) = c.get(&url).timeout(Duration::from_secs(20)).send().await {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                let mut out = String::new();
                if let Some(arr) = v.get(0).and_then(|x| x.as_array()) {
                    for item in arr {
                        if let Some(part) = item.get(0).and_then(|x| x.as_str()) {
                            out.push_str(part);
                        }
                    }
                }
                if !out.is_empty() {
                    let det = v.get(2).and_then(|x| x.as_str()).map(String::from);
                    return Ok(TranslateResult { text: out, detected: det });
                }
            }
        }
    }

    // ২. ব্যাকআপ: MyMemory ফ্রি API
    let pair_src = if sl == "auto" { "Autodetect" } else { sl };
    let mm_url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}|{}",
        encode_uri(text), encode_uri(pair_src), encode_uri(tl)
    );
    let resp = c.get(&mm_url).timeout(Duration::from_secs(20)).send().await
        .map_err(|e| format!("Network error: {}. Check internet connection.", e.without_url()))?;
    let v: Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;

    let translated = v.pointer("/responseData/translatedText")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    if translated.is_empty() || translated.contains("MYMEMORY WARNING") {
        let why = v.get("responseDetails").and_then(|x| x.as_str()).unwrap_or("Please try again.");
        return Err(format!("Could not translate text. {}", why));
    }
    Ok(TranslateResult { text: translated, detected: None })
}

pub async fn languages(_c: &Client, _provider: &str, _base_url: Option<&str>) -> Result<Vec<Lang>, String> {
    Ok(vec![])
}
