import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { api, Provider, Settings } from "./api";

type Props = { s: Settings; update: (p: Partial<Settings>) => void; onClose: () => void };

const NAMES: Record<Provider, string> = {
  gemini: "Universal AI (Gemini / ChatGPT / Groq / OpenRouter)",
  google: "Google Cloud Translation",
  libretranslate: "LibreTranslate",
  llm: "Claude (Anthropic API)",
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
      <div className="shead"><strong>Settings</strong><button className="neon-btn" onClick={onClose}>Done</button></div>

      <h4>AI & Translation Provider</h4>
      <select value={s.provider} onChange={(e) => update({ provider: e.target.value as Provider })}>
        {(Object.keys(NAMES) as Provider[]).map((p) => <option key={p} value={p}>{NAMES[p]}</option>)}
      </select>

      {s.provider === "gemini" && (
        <a
          href="https://google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="get-key-btn"
        >
          🔑 Get Free Gemini API Key (Works with ALL models) ↗
        </a>
      )}

      {s.provider === "libretranslate" && (
        <input value={s.baseUrl} placeholder="https://your-libretranslate-server" onChange={(e) => update({ baseUrl: e.target.value })} />
      )}
      <div className="hrow">
        <input type="password" value={key} placeholder={hasKey ? "Key saved! Paste new key to replace" : "Paste Gemini / ChatGPT / Groq / OpenRouter key"} onChange={(e) => setKey(e.target.value)} />
        <button className="neon-btn" onClick={async () => {
          if (!key.trim()) return;
          try { await api.setKey(s.provider, key.trim()); setKey(""); setHasKey(true); setNote("API Key saved safely!"); }
          catch (e) { setNote(String(e)); }
        }}>Save key</button>
        {hasKey && <button onClick={async () => { await api.clearKey(s.provider); setHasKey(false); setNote("Key removed."); }}>Remove</button>}
      </div>
      <button onClick={async () => {
        setNote("Auto-detecting model & testing…");
        try {
          if (s.provider === "gemini" || s.provider === "llm") {
            const res = await api.translate({ text: "Hello", source: "en", target: "bn", style: "natural", provider: s.provider, baseUrl: "" });
            setNote(`Connected! Test translation: ${res.text}`);
          } else {
            const l = await api.languages(s.provider, s.baseUrl);
            setNote(`Connected. ${l.length || "Built-in"} languages available.`);
          }
        } catch (e) { setNote(String(e)); }
      }}>Test connection</button>
      {note && <p className="muted" style={{ color: note.startsWith("Connected") ? "#00f5a0" : "#ff6b6b" }}>{note}</p>}

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
          <option value="standard">Standard</option>
          <option value="natural">Natural</option>
          <option value="professional">Professional</option>
          <option value="formal">Formal</option>
          <option value="casual">Casual</option>
          <option value="simple">Simple</option>
        </select>
      </label>
    </div>
  );
}
