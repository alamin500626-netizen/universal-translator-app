import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Settings } from "./api";

type Props = { s: Settings; update: (p: Partial<Settings>) => void; onClose: () => void };

export default function SettingsPanel({ s, update, onClose }: Props) {
  const [autostart, setAutostart] = useState(false);

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

      <h4>Free Translation Engine</h4>
      <p className="muted" style={{ color: "#00f5a0" }}>
        ✔ 100% Free Built-in Engine Active (No API Key Required)
      </p>

      <h4>Global Shortcuts (Select text anywhere & press)</h4>
      <div className="hitem" style={{ fontSize: "12.5px", lineHeight: "1.7" }}>
        <div><strong>Ctrl + Shift + B</strong> → Translate selected text to <strong>Bengali</strong></div>
        <div><strong>Ctrl + Shift + E</strong> → Translate selected text to <strong>English</strong></div>
        <div><strong>Ctrl + Shift + T</strong> → Open & translate selected text</div>
        <div><strong>Ctrl + Shift + C</strong> → Copy translated result</div>
      </div>

      <h4>Behavior</h4>
      <Toggle k="shortcutsEnabled" label="Enable global keyboard shortcuts" />
      <Toggle k="autoTranslate" label="Translate copied text automatically" />
      <Toggle k="autoCopy" label="Copy the translation to the clipboard" />
      <Toggle k="rememberLast" label="Remember last selected languages" />
      <Toggle k="saveHistory" label="Save translation history on this PC" />
      <Toggle k="alwaysOnTop" label="Keep window on top" />
      <label className="toggle">
        <input type="checkbox" checked={autostart} onChange={async (e) => {
          try { e.target.checked ? await enable() : await disable(); setAutostart(e.target.checked); } catch {}
        }} />
        Start with Windows
      </label>

      <h4>Default Languages</h4>
      <label>Default target language code (bn = Bengali, en = English)
        <input value={s.defaultTarget} onChange={(e) => update({ defaultTarget: e.target.value })} />
      </label>
      <label>Default source language code (auto = detect)
        <input value={s.defaultSource} onChange={(e) => update({ defaultSource: e.target.value })} />
      </label>
    </div>
  );
}
