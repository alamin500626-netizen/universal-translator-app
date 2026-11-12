use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64, pub original: String, pub translated: String,
    pub source: String, pub target: String, pub created_at: String, pub favorite: bool,
}
#[derive(Deserialize)]
pub struct NewEntry { pub original: String, pub translated: String, pub source: String, pub target: String }

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original TEXT NOT NULL, translated TEXT NOT NULL,
            source TEXT NOT NULL, target TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            favorite INTEGER NOT NULL DEFAULT 0);",
    )?;
    Ok(c)
}
pub fn add(c: &Connection, e: &NewEntry) -> rusqlite::Result<()> {
    c.execute("INSERT INTO history(original,translated,source,target) VALUES (?1,?2,?3,?4)",
        params![e.original, e.translated, e.source, e.target])?;
    Ok(())
}
pub fn list(c: &Connection, query: &str, favs: bool) -> rusqlite::Result<Vec<Entry>> {
    let like = format!("%{}%", query);
    let mut st = c.prepare(
        "SELECT id,original,translated,source,target,created_at,favorite FROM history
         WHERE (original LIKE ?1 OR translated LIKE ?1) AND (?2 = 0 OR favorite = 1)
         ORDER BY id DESC LIMIT 500")?;
    let rows = st.query_map(params![like, favs as i64], |r| Ok(Entry {
        id: r.get(0)?, original: r.get(1)?, translated: r.get(2)?, source: r.get(3)?,
        target: r.get(4)?, created_at: r.get(5)?, favorite: r.get::<_, i64>(6)? != 0,
    }))?;
    rows.collect()
}
pub fn favorite(c: &Connection, id: i64, fav: bool) -> rusqlite::Result<()> {
    c.execute("UPDATE history SET favorite=?1 WHERE id=?2", params![fav as i64, id])?; Ok(())
}
pub fn delete(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM history WHERE id=?1", params![id])?; Ok(())
}
pub fn clear(c: &Connection) -> rusqlite::Result<()> {
    c.execute("DELETE FROM history", [])?; Ok(())
}
