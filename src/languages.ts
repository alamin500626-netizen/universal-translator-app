export type Lang = { code: string; name: string };

// Used only until the provider's language list loads (or when it is unreachable).
export const FALLBACK: Lang[] = [
  ["bn","Bengali"],["en","English"],["ar","Arabic"],["zh","Chinese"],["ja","Japanese"],["ko","Korean"],
  ["hi","Hindi"],["ur","Urdu"],["fr","French"],["de","German"],["es","Spanish"],["pt","Portuguese"],
  ["ru","Russian"],["it","Italian"],["tr","Turkish"],["th","Thai"],["vi","Vietnamese"],["id","Indonesian"],
  ["ms","Malay"],["nl","Dutch"],["pl","Polish"],["uk","Ukrainian"],["fa","Persian"],["he","Hebrew"],
  ["el","Greek"],["sv","Swedish"],["da","Danish"],["fi","Finnish"],["no","Norwegian"],["ta","Tamil"],
  ["te","Telugu"],["ne","Nepali"],["si","Sinhala"],["my","Burmese"],
].map(([code, name]) => ({ code, name }));

export const POPULAR = ["bn","en","ar","zh","ja","ko","hi","ur","fr","de","es","pt","ru","it","tr"];

export const baseCode = (c: string) => c.toLowerCase().split("-")[0];

export function nativeName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? "";
  } catch {
    return "";
  }
}
