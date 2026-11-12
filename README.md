# Universal Translator

A small floating Windows translator. Workflow: **copy → shortcut → translate → copy result → paste.**
Built with Tauri 2, React, TypeScript and Rust. Windows 10/11 x64.

## Get the installer (no terminal needed)
1. Create a free GitHub account and a new repository. Upload everything in this folder (drag and drop works on github.com).
2. Open the repo's **Actions** tab, choose **Build Windows installer**, click **Run workflow**.
3. When it finishes (about 10 to 15 minutes), open the run and download the artifact **UniversalTranslator-Windows-x64**.
4. Run the `.exe` (or `.msi`). It creates a Desktop shortcut and a Start menu entry. Uninstall from Windows Settings → Apps.

## Build locally instead
Install Node 20+, Rust (rustup) and the WebView2 runtime, then:
```
npm install
npm run tauri dev      # development
npm run tauri build    # installer in src-tauri/target/release/bundle/
```

## First run
Settings (gear icon) → pick a provider → paste an API key → Save key → Test connection.
- **Google Cloud Translation**: needs your own key with billing enabled (Cloud Translation API v2). Best Bengali quality.
- **LibreTranslate**: enter your server URL (and key if it needs one).
- **Claude (Anthropic API)**: needs an Anthropic key. The only provider that applies text styles (natural, professional, formal, casual, simple).
Keys are stored in Windows Credential Manager, not in files. Without a key the app still opens and explains what is missing.

## Using it
Select text in any app (Premiere, After Effects, Illustrator, Photoshop, browser, Word), press **Ctrl+C**, then:
| Shortcut | Action |
|---|---|
| Ctrl+Shift+T | Open translator, load clipboard, translate |
| Ctrl+Shift+B | Translate clipboard to Bengali |
| Ctrl+Shift+E | Translate clipboard to English |
| Ctrl+Shift+L | Open the target-language picker |
| Ctrl+Shift+C | Copy the translated result |
All shortcuts can be changed in Settings. Switch to **Mini** or **Expand** in the bottom bar. Closing the window hides it to the tray; quit from the tray menu.

## Privacy
Clipboard is read only when you press a shortcut or Paste. Text goes to your chosen provider only when you translate. History is stored locally (SQLite) and can be turned off or cleared.

## Limits
- The app cannot read text inside other apps directly; it uses the clipboard, which works anywhere text can be copied.
- If a shortcut is already used by another program (some Adobe apps use Ctrl+Shift combos), change it in Settings.
- Listen uses the voices installed in Windows; some languages (including Bengali) may have none.
- Window position and size are remembered automatically.

## Layout
`src/` UI (App, LangSelect, HistoryPanel, SettingsPanel, api) · `src-tauri/src/providers.rs` translation providers · `history.rs` SQLite · `secrets.rs` credential storage · `lib.rs` commands, tray, startup.
