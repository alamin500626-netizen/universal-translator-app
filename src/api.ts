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
  provider: "gemini", baseUrl: "https://libretranslate.com",
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

const KEY = "ut.settings.v2";
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

export const api = {
  translate: (req: { text: string; source: string; target: string; style: string; provider: Provider; baseUrl: string }) =>
    invoke<TranslateResult>("translate", { req }),
  languages: (provider: Provider, baseUrl: string) =>
    invoke<Lang[]>("languages", { provider, baseUrl }),
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
