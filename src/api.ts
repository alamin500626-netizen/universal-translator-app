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

async function directFreeTranslate(text: string, source: string, target: string): Promise<TranslateResult> {
  const sl = source === "auto" || !source ? "auto" : source;
  const tl = target || "bn";
  const q = encodeURIComponent(text);

  // 1. Primary: Free Google Translate API
  try {
    const gUrl = "https://googleapis.com" + encodeURIComponent(sl) + "&tl=" + encodeURIComponent(tl) + "&dt=t&q=" + q;
    const res = await fetch(gUrl);
    if (res.ok) {
      const data = await res.json();
      let translated = "";
      const chunks = Array.isArray(data) ? data.at(0) : null;
      if (Array.isArray(chunks)) {
        for (const item of chunks) {
          if (Array.isArray(item) && typeof item.at(0) === "string") {
            translated += item.at(0);
          }
        }
      }
      if (translated.trim()) {
        const det = typeof data?.at?.(2) === "string" ? data.at(2) : null;
        return { text: translated.trim(), detected: det };
      }
    }
  } catch {}

  // 2. Backup: Free MyMemory Translation API
  const pairSrc = sl === "auto" ? "en" : sl;
  const mmUrl = "https://translated.net" + q + "&langpair=" + encodeURIComponent(pairSrc) + "|" + encodeURIComponent(tl);
  const mmRes = await fetch(mmUrl);
  if (!mmRes.ok) throw new Error("Internet connection failed. Please check your Wi-Fi or data.");
  const mmData = await mmRes.json();
  const out = mmData?.responseData?.translatedText;
  if (!out) throw new Error("Could not translate this text.");
  return { text: out.trim(), detected: null };
}

export const api = {
  translate: (req: { text: string; source: string; target: string; style: string; provider: Provider; baseUrl: string }) =>
    directFreeTranslate(req.text, req.source, req.target),
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
