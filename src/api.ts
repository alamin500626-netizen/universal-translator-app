import { invoke } from "@tauri-apps/api/core";
import type { Lang } from "./languages";

export type Provider = "gemini" | "google" | "libretranslate" | "llm";
export type Mode = "mini" | "compact" | "expanded";

export type Settings = {
  provider: Provider; baseUrl: string;
  defaultSource: string; defaultTarget: string;
  autoTranslate: boolean; autoCopy: boolean; rememberLast: boolean;
  lastSource: string; lastTarget: string;
  saveHistory: boolean; alwaysOnTop: boolean; shortcutsEnabled: boolean;
  theme: "dark" | "light"; style: string; mode: Mode;
  favorites: string[]; recents: string[];
  keys: { open: string; bengali: string; english: string; lang: string; copy: string };
};

export const defaultSettings: Settings = {
  provider: "google", baseUrl: "",
  defaultSource: "auto", defaultTarget: "bn",
  autoTranslate: true, autoCopy: false, rememberLast: true,
  lastSource: "auto", lastTarget: "bn",
  saveHistory: true, alwaysOnTop: true, shortcutsEnabled: true,
  theme: "dark", style: "natural", mode: "compact",
  favorites: [], recents: [],
  keys: {
    open: "Ctrl+Shift+T", bengali: "Ctrl+Shift+B", english: "Ctrl+Shift+E",
    lang: "Ctrl+Shift+L", copy: "Ctrl+Shift+C",
  },
};

const KEY = "ut.settings.v3";
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...defaultSettings, ...raw, keys: { ...defaultSettings.keys, ...(raw.keys ?? {}) } };
  } catch {
    return defaultSettings;
  }
}
export const saveSettings = (s: Settings) => localStorage.setItem(KEY, JSON.stringify(s));

export type TranslateResult = { text: string; detected?: string | null };
export type Entry = {
  id: number; original: string; translated: string; source: string; target: string;
  createdAt: string; favorite: boolean;
};

// ---------------------------------------------------------------------------
// Translation (free, no API key)
//  1) Rust backend (src-tauri/src/providers.rs): Google free endpoint, MyMemory backup.
//     It runs outside the webview, so there are no browser/CORS limits.
//  2) If the backend call fails, a browser fetch fallback with correctly built URLs.
// ---------------------------------------------------------------------------

const MAX_CHUNK = 350; // keeps every request URL short and under MyMemory's 500-char limit

// Split text into small pieces along line and sentence boundaries (keeps paragraph breaks).
function splitText(text: string, max = MAX_CHUNK): string[] {
  const parts: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= max) { parts.push(line); continue; }
    let buf = "";
    for (const sentence of line.split(/(?<=[\u0964.!?])\s+/)) {
      if (sentence.length > max) {
        if (buf) { parts.push(buf); buf = ""; }
        for (let i = 0; i < sentence.length; i += max) parts.push(sentence.slice(i, i + max));
      } else if (buf && (buf + " " + sentence).length > max) {
        parts.push(buf); buf = sentence;
      } else {
        buf = buf ? buf + " " + sentence : sentence;
      }
    }
    if (buf) parts.push(buf);
  }
  return parts;
}

// Browser-side fallback. URLs are built with URLSearchParams, never by string pasting.
async function browserTranslate(q: string, sl: string, tl: string): Promise<TranslateResult> {
  // Google free endpoint
  try {
    const url = "https://translate.googleapis.com/translate_a/single?" +
      new URLSearchParams({ client: "gtx", sl, tl, dt: "t", q }).toString();
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      let out = "";
      if (Array.isArray(data) && Array.isArray(data[0])) {
        for (const seg of data[0]) if (Array.isArray(seg) && typeof seg[0] === "string") out += seg[0];
      }
      if (out.trim()) return { text: out, detected: typeof data[2] === "string" ? data[2] : null };
    }
  } catch { /* try the backup */ }

  // MyMemory backup
  const pair = (sl === "auto" ? "Autodetect" : sl) + "|" + tl;
  const res = await fetch("https://api.mymemory.translated.net/get?" +
    new URLSearchParams({ q, langpair: pair }).toString());
  if (!res.ok) throw new Error("Internet connection failed. Please check your Wi-Fi or data.");
  const data = await res.json();
  const out: string | undefined = data?.responseData?.translatedText;
  if (!out || String(out).includes("MYMEMORY WARNING")) {
    throw new Error(String(data?.responseDetails || "Could not translate this text."));
  }
  return { text: out, detected: null };
}

async function translateOne(req: TranslateReq): Promise<TranslateResult> {
  try {
    return await invoke<TranslateResult>("translate", { req });
  } catch (backendErr) {
    try {
      return await browserTranslate(req.text, req.source, req.target);
    } catch (fallbackErr) {
      throw new Error(`${String(fallbackErr instanceof Error ? fallbackErr.message : fallbackErr)} (${String(backendErr)})`);
    }
  }
}

type TranslateReq = {
  text: string; source: string; target: string; style: string; provider: Provider; baseUrl: string;
};

async function freeTranslate(req: TranslateReq): Promise<TranslateResult> {
  // Voice-to-text is not set up (it needs a Gemini key). Show a clear message instead of
  // sending recorded audio as if it were text.
  if (req.text.startsWith("AUDIO_B64:")) {
    throw new Error("Voice input is not available yet: it needs a Gemini API key.");
  }

  const text = req.text.replace(/\r\n/g, "\n").trim();
  if (!text) return { text: "", detected: null };

  const source = !req.source ? "auto" : req.source;
  const target = req.target || "bn";

  const out: string[] = [];
  let detected: string | null = null;
  for (const chunk of splitText(text)) {
    if (!chunk.trim()) { out.push(chunk); continue; } // keep blank lines
    const r = await translateOne({ ...req, text: chunk, source, target });
    out.push(r.text);
    if (!detected && r.detected) detected = r.detected;
  }
  return { text: out.join("\n"), detected };
}

export const api = {
  translate: (req: TranslateReq) => freeTranslate(req),
  languages: async (_provider: Provider, _baseUrl: string) => [] as Lang[],
  setKey: (provider: Provider, key: string) => invoke<void>("set_api_key", { provider, key }),
  clearKey: (provider: Provider) => invoke<void>("clear_api_key", { provider }),
  hasKey: (provider: Provider) => invoke<boolean>("has_api_key", { provider }),
  historyAdd: (entry: { original: string; translated: string; source: string; target: string }) =>
    invoke<void>("history_add", { entry }),
  historyList: (query: string, favoritesOnly: boolean) =>
    invoke<Entry[]>("history_list", { query, favoritesOnly }),
  historyFavorite: (id: number, favorite: boolean) => invoke<void>("history_favorite", { id, favorite }),
  historyDelete: (id: number) => invoke<void>("history_delete", { id }),
  historyClear: () => invoke<void>("history_clear"),
};
