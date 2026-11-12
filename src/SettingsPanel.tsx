import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { api, Provider, Settings } from "./api";

type Props = { s: Settings; update: (p: Partial<Settings>) => void; onClose: () => void };

const NAMES: Record<Provider, string> = {
  google: "Google Cloud Translation",
  libretranslate: "LibreTranslate",
  llm: "Claude (Anthropic API, enables text styles)",
};

export default function SettingsPanel({ s, update, onClose }: Props) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [note, setNote] = useState("");
  const [autostart, setAutostart] = useState(false);

  useEffect(() => { api.hasKey(s.provider).then(setHasKey).catch(() => setHasKey(false)); }, [s.provider]);
  useEffect(() => { isEnabled().then(setAutostart).catch(() => {}); }, []);

  const Toggle = ({ k, label }: { k: keyof Settings; label: string }) => (
    <label className="toggle">
      <input type="checkbox" checked={s[k] as boolean} onChange={(e) => update({ [k]: e.target.checked } as Partial<Settings>)} />
      {label}
    </label>
  );

  return (
    <div className="settings">
      <div className="shead"><strong>Settings</strong><button onClick={onClose}>Done</button></div>

      <h4>Translation provider</h4>
      <select value={s.provider} onChange={(e) => update({ provider: e.target.value as Provider })}>
        {(Object.keys(NAMES) as Provider[]).map((p) => <option key={p} value={p}>{NAMES[p]}</option>)}
      </select>
      {s.provider === "libretranslate" && (
        <input value={s.baseUrl} placeholder="https://your-libretranslate-server" onChange={(e) => update({ baseUrl: e.target.value })} />
      )}
      <div className="hrow">
        <input type="password" value={key} placeholder={hasKey ? "Key saved. Enter a new one to replace it" : "API key"} onChange={(e) => setKey(e.target.value)} />
        <button onClick={async () => {
          if (!key.trim()) return;
          try { await api.setKey(s.provider, key.trim()); setKey(""); setHasKey(true); setNote("Key saved to Windows Credential Manager."); }
          catch (e) { setNote(String(e)); }
        }}>Save key</button>
        {hasKey && <button onClick={async () => { await api.clearKey(s.provider); setHasKey(false); setNote("Key removed."); }}>Remove</button>}
      </div>
      <button onClick={async () => {
        setNote("Testing…");
        try { const l = await api.languages(s.provider, s.baseUrl); setNote(`Connected. ${l.length || "Built-in"} languages available.`); }
        catch (e) { setNote(String(e)); }
      }}>Test connection</button>
      {note && <p className="muted">{note}</p>}
      <p className="muted">Text is sent to the selected provider only when you translate. Nothing is uploaded in the background.</p>

      <h4>Behavior</h4>
      <Toggle k="autoTranslate" label="Translate copied text automatically" />
      <Toggle k="autoCopy" label="Copy the translation to the clipboard" />
      <Toggle k="rememberLast" label="Remember last selected languages" />
      <Toggle k="saveHistory" label="Save translation history on this PC" />
      <Toggle k="alwaysOnTop" label="Keep window on top" />
      <label className="toggle">
        <input type="checkbox" checked={autostart} onChange={async (e) => {
          try { e.target.checked ? await enable() : await disable(); setAutostart(e.target.checked); } catch (err) { setNote(String(err)); }
        }} />
        Start with Windows
      </label>

      <h4>Languages and style</h4>
      <label>Default target language code
        <input value={s.defaultTarget} onChange={(e) => update({ defaultTarget: e.target.value })} />
      </label>
      <label>Default source language code (auto = detect)
        <input value={s.defaultSource} onChange={(e) => update({ defaultSource: e.target.value })} />
      </label>
      <label>Translation style
        <select value={s.style} onChange={(e) => update({ style: e.target.value })}>
          {["standard", "natural", "professional", "formal", "casual", "simple"].map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      {s.style !== "standard" && s.provider !== "llm" && (
        <p className="muted">Styles other than Standard only apply with the Claude provider.</p>
      )}

      <h4>Appearance</h4>
      <select value={s.theme} onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}>
        <option value="dark">Dark</option><option value="light">Light</option>
      </select>

      <h4>Global shortcuts</h4>
      <Toggle k="shortcutsEnabled" label="Enable global shortcuts" />
      {(["open", "bengali", "english", "lang", "copy"] as const).map((k) => (
        <label key={k}>
          {{ open: "Open translator", bengali: "Translate copied text to Bengali", english: "Translate copied text to English", lang: "Open language picker", copy: "Copy translated result" }[k]}
          <input value={s.keys[k]} onChange={(e) => update({ keys: { ...s.keys, [k]: e.target.value } })} />
        </label>
      ))}
    </div>
  );
}
