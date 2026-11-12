// API keys live in Windows Credential Manager, never in files, logs or frontend code.
use keyring::Entry;

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new("UniversalTranslator", provider).map_err(|e| e.to_string())
}
pub fn set(provider: &str, key: &str) -> Result<(), String> {
    entry(provider)?.set_password(key).map_err(|e| e.to_string())
}
pub fn get(provider: &str) -> Option<String> {
    entry(provider).ok()?.get_password().ok()
}
pub fn clear(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
