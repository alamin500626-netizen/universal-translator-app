import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { api, loadSettings, saveSettings, Settings, Mode, Entry } from "./api";
import { FALLBACK, Lang } from "./languages";
import LangSelect from "./LangSelect";
import SettingsPanel from "./SettingsPanel";
import HistoryPanel from "./HistoryPanel";

const SIZES: Record<Mode, [number, number]> = {
  mini: Array.of(380, 300) as [number, number],
  compact: Array.of(480, 580) as [number, number],
  expanded: Array.of(940, 660) as [number, number],
};

export default function App() {
  const win = getCurrentWindow();
  const [s, setS] = useState<Settings>(loadSettings);
  const [langs, setLangs] = useState<Lang[]>(FALLBACK);
  const [src, setSrc] = useState(s.rememberLast ? s.lastSource : s.defaultSource);
  const [tgt, setTgt] = useState(s.rememberLast ? s.lastTarget : s.defaultTarget);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [detected, setDetected] = useState("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [panel, setPanel] = useState<"none" | "settings" | "history">("none");
  const [pick, setPick] = useState(0);
  const [histKey, setHistKey] = useState(0);

  const update = (p: Partial<Settings>) => setS((old) => { const n = { ...old, ...p }; saveSettings(n); return n; });

  useEffect(() => {
    api.languages(s.provider, s.baseUrl).then((l) => l.length && setLangs(l)).catch(() => setLangs(FALLBACK));
  }, [s.provider, s.baseUrl]);

  useEffect(() => { document.documentElement.dataset.theme = s.theme; }, [s.theme]);
  useEffect(() => { win.setAlwaysOnTop(s.alwaysOnTop).catch(() => {}); }, [s.alwaysOnTop]);
  useEffect(() => { const [w, h] = SIZES[s.mode]; win.setSize(new LogicalSize(w, h)).catch(() => {}); }, [s.mode]);
  useEffect(() => { if (s.rememberLast) update({ lastSource: src, lastTarget: tgt }); }, [src, tgt]);

  const run = useCallback(async (text: string, source: string, target: string) => {
    if (!text.trim()) return;
    setBusy(true); setError(""); setStatus("Translating…");
    try {
      const r = await api.translate({ text, source, target, style: s.style, provider: s.provider, baseUrl: s.baseUrl });
      setOutput(r.text);
      setDetected(r.detected ?? "");
      setStatus(r.detected ? `Detected: ${r.detected}` : "Done");
      if (s.autoCopy) await writeText(r.text);
      if (s.saveHistory) { await api.historyAdd({ original: text, translated: r.text, source: r.detected ?? source, target }); setHistKey((k) => k + 1); }
      update({ recents: [target, ...s.recents.filter((c) => c !== target)].slice(0, 6) });
    } catch (e) {
      setError(String(e)); setStatus("Error");
    } finally { setBusy(false); }
  }, [s]);

  // Voice-to-Text (Speech Recognition)
  const recRef = useRef<any>(null);
  const toggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this WebView.");
      return;
    }
    if (listening && recRef.current) {
      recRef.current.stop();
      setListening(false);
      setStatus("Ready");
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = src === "bn" ? "bn-BD" : src === "auto" ? "bn-BD" : src;
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => { setListening(true); setError(""); setStatus("Listening… Speak now"); };
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((res: any) => res[0].transcript).join("");
      setInput(transcript);
    };
    rec.onerror = (e: any) => { setError(`Voice error: ${e.error}`); setListening(false); setStatus("Ready"); };
    rec.onend = () => { setListening(false); setStatus("Voice captured"); };

    recRef.current = rec;
    rec.start();
  };

  const clip = async () => { try { return (await readText()) ?? ""; } catch { return ""; } };
  const showWindow = async () => { await win.show(); await win.unminimize(); await win.setFocus(); };

  const actions = useRef({} as Record<string, () => void>);
  actions.current = {
    open: async () => {
      await showWindow();
      const t = await clip();
      if (t.trim()) { setInput(t); if (s.autoTranslate) run(t, src, tgt); }
    },
    to: async () => {},
    bengali: async () => { await showWindow(); const t = await clip(); setInput(t); setSrc("auto"); setTgt("bn"); run(t, "auto", "bn"); },
    english: async () => { await showWindow(); const t = await clip(); setInput(t); setSrc("auto"); setTgt("en"); run(t, "auto", "en"); },
    lang: async () => { await showWindow(); setPick((n) => n + 1); },
    copy: async () => { if (output) { await writeText(output); setStatus("Copied"); } },
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      await unregisterAll().catch(() => {});
      if (!s.shortcutsEnabled || dead) return;
      for (const name of ["open", "bengali", "english", "lang", "copy"] as const) {
        try { await register(s.keys[name], (e) => { if (e.state === "Pressed") actions.current[name](); }); }
        catch (err) { setError(`Shortcut ${s.keys[name]} could not be registered: ${err}`); }
      }
    })();
    return () => { dead = true; unregisterAll().catch(() => {}); };
  }, [s.shortcutsEnabled, s.keys]);

  const swap = () => {
    const newSrc = src === "auto" ? (detected || "en") : src;
    setSrc(tgt); setTgt(newSrc); setInput(output); setOutput(input);
  };
  const toggleFav = (c: string) => update({ favorites: s.favorites.includes(c) ? s.favorites.filter((x) => x !== c) : [...s.favorites, c] });
  const sel = { langs, favorites: s.favorites, recents: s.recents, onToggleFav: toggleFav };
  const useEntry = (e: Entry) => { setInput(e.original); setOutput(e.translated); };
  const mini = s.mode === "mini";

  return (
    <div className="neon-shell">
      <div className={`app ${s.mode}`}>
        <header data-tauri-drag-region>
          <span className="logo" data-tauri-drag-region>文A</span>
          {!mini && <span className="title" data-tauri-drag-region>Universal Translator</span>}
          <span className="spacer" data-tauri-drag-region />
          <button title={s.alwaysOnTop ? "Always on top: on" : "Always on top: off"} className={s.alwaysOnTop ? "pin on" : "pin"} onClick={() => update({ alwaysOnTop: !s.alwaysOnTop })}>📌</button>
          {!mini && <button title="Settings" onClick={() => setPanel(panel === "settings" ? "none" : "settings")}>⚙</button>}
          <button title="Minimize" onClick={() => win.minimize()}>–</button>
          <button title="Hide to tray" onClick={() => win.hide()}>✕</button>
        </header>

        <div className="langbar">
          <LangSelect {...sel} label="Source language" value={src} onChange={setSrc} allowAuto />
          <button className="swap" title="Swap languages" onClick={swap}>⇄</button>
          <LangSelect {...sel} label="Target language" value={tgt} onChange={setTgt} openSignal={pick} />
        </div>

        <main>
          <div className="body">
            <section className="box">
              <textarea placeholder="Type, paste, or click 🎤 Voice to speak..." value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") run(input, src, tgt); }} />
              <div className="tools">
                <button className={listening ? "mic-btn listening" : "mic-btn"} onClick={toggleVoice}>
                  {listening ? "⏹ Stop" : "🎤 Voice"}
                </button>
                <button onClick={async () => { const t = await clip(); if (t) setInput(t); }}>Paste</button>
                <button onClick={() => { setInput(""); setOutput(""); setError(""); }}>Clear</button>
                {!mini && <span className="count">{input.length} chars</span>}
              </div>
            </section>

            <button className="go" disabled={busy || !input.trim()} onClick={() => run(input, src, tgt)}>
              {busy ? "Translating…" : "Translate"} {!mini && <small>Ctrl+Enter</small>}
            </button>

            <section className="box out">
              {busy && <div className="bar" />}
              <textarea readOnly placeholder="Translation appears here" value={output} />
              {error && <div className="err">{error}</div>}
              <div className="tools">
                <button onClick={async () => { await writeText(output); setStatus("Copied"); }} disabled={!output}>Copy</button>
                {!mini && <button disabled={!output} onClick={() => { const u = new SpeechSynthesisUtterance(output); u.lang = tgt; speechSynthesis.speak(u); }}>Listen</button>}
                {!mini && <button disabled={!input.trim()} onClick={() => run(input, src, tgt)}>Re-translate</button>}
                {!mini && <button onClick={() => setOutput("")}>Clear</button>}
              </div>
            </section>
          </div>
          {s.mode === "expanded" && <aside><HistoryPanel onUse={useEntry} refreshKey={histKey} /></aside>}
        </main>

        {panel === "settings" && <div className="overlay"><SettingsPanel s={s} update={update} onClose={() => setPanel("none")} /></div>}
        {panel === "history" && s.mode !== "expanded" && (
          <div className="overlay">
            <div className="shead"><strong>History</strong><button onClick={() => setPanel("none")}>Done</button></div>
            <HistoryPanel onUse={(e) => { useEntry(e); setPanel("none"); }} refreshKey={histKey} />
          </div>
        )}

        <footer>
          <span className={status === "Error" ? "st bad" : "st"}>{status}</span>
