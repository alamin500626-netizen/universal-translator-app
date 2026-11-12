import { useCallback, useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, Entry } from "./api";

export default function HistoryPanel({ onUse, refreshKey }: { onUse: (e: Entry) => void; refreshKey: number }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState(false);

  const load = useCallback(() => api.historyList(q, favs).then(setRows).catch(() => setRows([])), [q, favs]);
  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div className="history">
      <div className="hrow">
        <input placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={favs ? "chip on" : "chip"} onClick={() => setFavs(!favs)}>★ Favorites</button>
        <button className="chip" onClick={async () => { if (confirm("Delete all history?")) { await api.historyClear(); load(); } }}>
          Clear all
        </button>
      </div>
      <div className="hlist">
        {rows.length === 0 && <p className="muted">No translations saved yet. Translate something and it appears here.</p>}
        {rows.map((r) => (
          <div className="hitem" key={r.id}>
            <div className="meta">{r.source} → {r.target} · {r.createdAt}</div>
            <div className="orig" onClick={() => onUse(r)}>{r.original}</div>
            <div className="tr">{r.translated}</div>
            <div className="acts">
              <button onClick={() => writeText(r.translated)}>Copy</button>
              <button onClick={async () => { await api.historyFavorite(r.id, !r.favorite); load(); }}>
                {r.favorite ? "★" : "☆"}
              </button>
              <button onClick={async () => { await api.historyDelete(r.id); load(); }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
