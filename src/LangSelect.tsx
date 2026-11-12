import { useEffect, useMemo, useRef, useState } from "react";
import { Lang, POPULAR, baseCode, nativeName } from "./languages";

type Props = {
  value: string; onChange: (code: string) => void; langs: Lang[]; allowAuto?: boolean;
  favorites: string[]; recents: string[]; onToggleFav: (code: string) => void;
  openSignal?: number; label: string;
};

export default function LangSelect(p: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (p.openSignal) setOpen(true); }, [p.openSignal]);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const items = useMemo(() => {
    const rank = (l: Lang) =>
      p.favorites.includes(l.code) ? 0 : p.recents.includes(l.code) ? 1 :
      POPULAR.includes(baseCode(l.code)) ? 2 : 3;
    const needle = q.trim().toLowerCase();
    return p.langs
      .filter((l) => !needle || l.name.toLowerCase().includes(needle) ||
        nativeName(l.code).toLowerCase().includes(needle) || l.code.toLowerCase().startsWith(needle))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [p.langs, p.favorites, p.recents, q]);

  const current = p.value === "auto" ? "Auto detect" : p.langs.find((l) => l.code === p.value)?.name ?? p.value;
  const pick = (code: string) => { p.onChange(code); setOpen(false); };

  return (
    <div className="langsel">
      <button className="langbtn" aria-label={p.label} onClick={() => setOpen(!open)}>
        {current}<span className="chev">▾</span>
      </button>
      {open && (
        <div className="pop" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <input ref={input} placeholder="Search languages" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul>
            {p.allowAuto && !q && <li onClick={() => pick("auto")}>Auto detect</li>}
            {items.map((l) => (
              <li key={l.code} onClick={() => pick(l.code)} className={l.code === p.value ? "sel" : ""}>
                <span>{l.name} <em>{nativeName(l.code)}</em></span>
                <button className="star" title="Favorite"
                  onClick={(e) => { e.stopPropagation(); p.onToggleFav(l.code); }}>
                  {p.favorites.includes(l.code) ? "★" : "☆"}
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="empty">No language matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
