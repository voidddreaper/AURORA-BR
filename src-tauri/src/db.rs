//! SQLite persistence for the Shader Tracker ("Mapa da Mineração").

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_EXPECTED_TOTAL: i64 = 26_500;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shader {
    pub hash: String,
    pub stage: String,
    pub status: String,
    pub reason: String,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShaderQuery {
    pub stage: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShaderPage {
    pub rows: Vec<Shader>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
    pub page_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShaderStats {
    pub total: i64,
    pub translated: i64,
    pub failed: i64,
    pub pending: i64,
    pub untested: i64,
    pub expected_total: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub inserted: usize,
    pub updated: usize,
    pub skipped: usize,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn mock_shaders() -> Vec<Shader> {
    let mk = |h: &str, st: &str, s: &str, r: &str| Shader {
        hash: h.into(),
        stage: st.into(),
        status: s.into(),
        reason: r.into(),
        updated_at: 0,
    };
    vec![
        mk("7f99b1cc7ccb0f1b", "Vertex", "Failed", "Wave64 Lane Mask"),
        mk("baa527de08d002bf", "Compute", "Failed", "64-bit Image Atomics"),
        mk("ee78da6862364ddd", "Pixel", "Translated", "None"),
        mk("50946a822ac6272b", "Mesh", "Translated", "None"),
        mk("87274f3b3e819604", "Mesh", "Pending", "Not Attempted"),
    ]
}

/// Normalise a status string to one of Translated / Failed / Pending / Untested.
pub fn normalize_status(s: &str) -> String {
    let l = s.trim().to_ascii_lowercase();
    match l.as_str() {
        "translated" | "ok" | "done" | "success" | "pass" | "passed" | "traduzido" => "Translated",
        "failed" | "fail" | "error" | "erro" | "falhou" | "falha" => "Failed",
        "pending" | "pendente" | "todo" | "queued" => "Pending",
        _ => "Untested",
    }
    .to_string()
}

pub fn normalize_stage(s: &str) -> String {
    let c = crate::parser::canonical_stage(s.trim());
    if c == "Unknown" {
        let t = s.trim();
        if t.is_empty() {
            "Unknown".into()
        } else {
            let mut ch = t.chars();
            let first = ch.next().unwrap().to_uppercase().collect::<String>();
            let s = first + &ch.as_str().to_lowercase();
            s.chars().take(32).collect()
        }
    } else {
        c
    }
}

/// Validate and normalise a shader hash. Accepts hex (optionally 0x-prefixed) of 4..64 digits.
pub fn normalize_hash(s: &str) -> Option<String> {
    let t = s.trim();
    let t = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t);
    if (4..=64).contains(&t.len()) && t.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(t.to_ascii_lowercase())
    } else {
        None
    }
}

pub struct Db {
    pub conn: Connection,
}

impl Db {
    /// Open (or create) the database. A corrupt file is moved aside and recreated so the app always starts.
    pub fn open(path: &Path) -> Result<Self, String> {
        match Self::try_open(path) {
            Ok(db) => Ok(db),
            Err(first) => {
                if path.exists() {
                    let backup = path.with_extension(format!("corrupt-{}.db", now_ms()));
                    let _ = std::fs::rename(path, &backup);
                    Self::try_open(path).map_err(|e| format!("{first}; recreating the database failed: {e}"))
                } else {
                    Err(first)
                }
            }
        }
    }

    fn try_open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Db { conn };
        db.init()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        let db = Db { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA synchronous=NORMAL;
                 PRAGMA busy_timeout=5000;
                 CREATE TABLE IF NOT EXISTS shaders (
                    hash TEXT PRIMARY KEY NOT NULL,
                    stage TEXT NOT NULL DEFAULT 'Unknown',
                    status TEXT NOT NULL DEFAULT 'Untested',
                    reason TEXT NOT NULL DEFAULT '',
                    updated_at INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE INDEX IF NOT EXISTS idx_shaders_status ON shaders(status);
                 CREATE INDEX IF NOT EXISTS idx_shaders_stage ON shaders(stage);
                 CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
            )
            .map_err(|e| e.to_string())?;
        // integrity check (cheap for this size); fails on a corrupt file → caller recreates
        let ok: String = self
            .conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if ok != "ok" {
            return Err(format!("Database is corrupted: {ok}"));
        }
        if self.get_meta("seeded")?.is_none() {
            self.seed_mock()?;
            self.set_meta("seeded", "1")?;
        }
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn seed_mock(&self) -> Result<(), String> {
        let now = now_ms();
        for s in mock_shaders() {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO shaders(hash,stage,status,reason,updated_at) VALUES(?1,?2,?3,?4,?5)",
                    params![s.hash, s.stage, s.status, s.reason, now],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn reset_demo(&mut self) -> Result<(), String> {
        self.conn.execute("DELETE FROM shaders", []).map_err(|e| e.to_string())?;
        self.seed_mock()
    }

    pub fn clear_all(&mut self) -> Result<(), String> {
        self.conn.execute("DELETE FROM shaders", []).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn expected_total(&self) -> i64 {
        self.get_meta("expected_total")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_EXPECTED_TOTAL)
    }

    pub fn stats(&self) -> Result<ShaderStats, String> {
        let mut st = ShaderStats { expected_total: self.expected_total(), ..Default::default() };
        let mut stmt = self
            .conn
            .prepare("SELECT status, COUNT(*) FROM shaders GROUP BY status")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (s, n) = row.map_err(|e| e.to_string())?;
            st.total += n;
            match s.as_str() {
                "Translated" => st.translated += n,
                "Failed" => st.failed += n,
                "Pending" => st.pending += n,
                _ => st.untested += n,
            }
        }
        Ok(st)
    }

    pub fn query(&self, q: &ShaderQuery) -> Result<ShaderPage, String> {
        let page_size = q.page_size.unwrap_or(25).clamp(5, 500);
        let mut where_parts: Vec<&str> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(s) = q.stage.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "All") {
            where_parts.push("stage = ?");
            args.push(s.to_string());
        }
        if let Some(s) = q.status.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "All") {
            where_parts.push("status = ?");
            args.push(s.to_string());
        }
        if let Some(s) = q.search.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let s = s.trim_start_matches("0x").to_ascii_lowercase();
            // escape LIKE wildcards
            let esc = s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            where_parts.push("(hash LIKE ? ESCAPE '\\' OR lower(reason) LIKE ? ESCAPE '\\')");
            args.push(format!("%{esc}%"));
            args.push(format!("%{esc}%"));
        }
        let where_sql = if where_parts.is_empty() { String::new() } else { format!(" WHERE {}", where_parts.join(" AND ")) };

        let total: i64 = self
            .conn
            .query_row(&format!("SELECT COUNT(*) FROM shaders{where_sql}"), params_from_iter(args.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let page_count = ((total as f64) / page_size as f64).ceil().max(1.0) as u32;
        let page = q.page.unwrap_or(1).clamp(1, page_count);
        let offset = (page - 1) as i64 * page_size as i64;

        let sql = format!(
            "SELECT hash, stage, status, reason, updated_at FROM shaders{where_sql}
             ORDER BY CASE status WHEN 'Failed' THEN 0 WHEN 'Pending' THEN 1 WHEN 'Untested' THEN 2 ELSE 3 END, hash
             LIMIT {page_size} OFFSET {offset}"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(args.iter()), |r| {
                Ok(Shader {
                    hash: r.get(0)?,
                    stage: r.get(1)?,
                    status: r.get(2)?,
                    reason: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(ShaderPage { rows, total, page, page_size, page_count })
    }

    pub fn update(&self, hash: &str, status: &str, reason: Option<&str>) -> Result<Shader, String> {
        let status = normalize_status(status);
        let n = match reason {
            Some(r) => self.conn.execute(
                "UPDATE shaders SET status=?1, reason=?2, updated_at=?3 WHERE hash=?4",
                params![status, r.trim().chars().take(300).collect::<String>(), now_ms(), hash],
            ),
            None => self
                .conn
                .execute("UPDATE shaders SET status=?1, updated_at=?2 WHERE hash=?3", params![status, now_ms(), hash]),
        }
        .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("Shader {hash} not found"));
        }
        self.get(hash)?.ok_or_else(|| "Shader not found".into())
    }

    pub fn get(&self, hash: &str) -> Result<Option<Shader>, String> {
        self.conn
            .query_row("SELECT hash, stage, status, reason, updated_at FROM shaders WHERE hash=?1", [hash], |r| {
                Ok(Shader { hash: r.get(0)?, stage: r.get(1)?, status: r.get(2)?, reason: r.get(3)?, updated_at: r.get(4)? })
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn delete(&self, hash: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM shaders WHERE hash=?1", [hash]).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Insert or update many shaders in one transaction.
    /// `overwrite=false` only inserts new hashes (used when syncing from a log).
    pub fn upsert_many(&mut self, items: &[Shader], overwrite: bool) -> Result<ImportResult, String> {
        let now = now_ms();
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let mut res = ImportResult::default();
        {
            let mut exists = tx.prepare("SELECT 1 FROM shaders WHERE hash=?1").map_err(|e| e.to_string())?;
            let mut ins = tx
                .prepare("INSERT INTO shaders(hash,stage,status,reason,updated_at) VALUES(?1,?2,?3,?4,?5)")
                .map_err(|e| e.to_string())?;
            let mut upd = tx
                .prepare("UPDATE shaders SET stage=?2, status=?3, reason=?4, updated_at=?5 WHERE hash=?1")
                .map_err(|e| e.to_string())?;
            for it in items {
                let Some(hash) = normalize_hash(&it.hash) else {
                    res.skipped += 1;
                    continue;
                };
                let stage = normalize_stage(&it.stage);
                let status = normalize_status(&it.status);
                let reason: String = it.reason.trim().chars().take(300).collect();
                let present = exists.exists([&hash]).map_err(|e| e.to_string())?;
                if present {
                    if overwrite {
                        upd.execute(params![hash, stage, status, reason, now]).map_err(|e| e.to_string())?;
                        res.updated += 1;
                    } else {
                        res.skipped += 1;
                    }
                } else {
                    ins.execute(params![hash, stage, status, reason, now]).map_err(|e| e.to_string())?;
                    res.inserted += 1;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(res)
    }

    pub fn all(&self) -> Result<Vec<Shader>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT hash, stage, status, reason, updated_at FROM shaders ORDER BY hash")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Shader { hash: r.get(0)?, stage: r.get(1)?, status: r.get(2)?, reason: r.get(3)?, updated_at: r.get(4)? })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }
}

// ---------------------------------------------------------------------------
// Import parsing (CSV / JSON)
// ---------------------------------------------------------------------------

fn split_csv_line(line: &str, delim: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_q {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_q = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_q = true;
        } else if c == delim {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.push(c);
        }
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).collect()
}

pub fn parse_csv(text: &str) -> Vec<Shader> {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let Some(header) = lines.next() else { return vec![] };
    let delim = if header.matches(';').count() > header.matches(',').count() {
        ';'
    } else if header.contains('\t') && !header.contains(',') {
        '\t'
    } else {
        ','
    };
    let cols: Vec<String> = split_csv_line(header, delim).into_iter().map(|c| c.to_ascii_lowercase()).collect();
    let find = |names: &[&str]| cols.iter().position(|c| names.contains(&c.as_str()));
    let hi = find(&["hash", "shader", "shader hash", "shader_hash", "id"]);
    let si = find(&["stage", "type", "tipo", "estagio", "estágio"]);
    let ti = find(&["status", "estado"]);
    let ri = find(&["reason", "error", "error reason", "error_reason", "motivo", "erro"]);

    let mut out = Vec::new();
    // No recognisable header: treat the first line as data with positional columns.
    let (hi, si, ti, ri, header_is_data) = match hi {
        Some(h) => (h, si, ti, ri, false),
        None => (0, Some(1), Some(2), Some(3), true),
    };
    let mut push = |line: &str| {
        let f = split_csv_line(line, delim);
        let get = |i: Option<usize>| i.and_then(|i| f.get(i)).cloned().unwrap_or_default();
        out.push(Shader {
            hash: get(Some(hi)),
            stage: get(si),
            status: get(ti),
            reason: get(ri),
            updated_at: 0,
        });
    };
    if header_is_data {
        push(header);
    }
    for l in lines {
        push(l);
    }
    out
}

pub fn parse_json(text: &str) -> Result<Vec<Shader>, String> {
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("Invalid JSON: {e}"))?;
    let arr = if let Some(a) = v.as_array() {
        a.clone()
    } else if let Some(a) = v.get("shaderDatabase").and_then(|x| x.as_array()) {
        a.clone()
    } else if let Some(a) = v.get("shaders").and_then(|x| x.as_array()) {
        a.clone()
    } else {
        return Err("JSON must be a list of shaders or contain \"shaderDatabase\"/\"shaders\".".into());
    };
    let s = |o: &serde_json::Value, keys: &[&str]| -> String {
        for k in keys {
            if let Some(x) = o.get(*k) {
                if let Some(s) = x.as_str() {
                    return s.to_string();
                }
                if !x.is_null() {
                    return x.to_string();
                }
            }
        }
        String::new()
    };
    Ok(arr
        .iter()
        .map(|o| Shader {
            hash: s(o, &["hash", "shader", "id"]),
            stage: s(o, &["stage", "type"]),
            status: s(o, &["status"]),
            reason: s(o, &["reason", "error", "errorReason"]),
            updated_at: 0,
        })
        .collect())
}

pub fn to_csv(rows: &[Shader]) -> String {
    let esc = |s: &str| {
        if s.contains(',') || s.contains('"') || s.contains('\n') {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    };
    let mut out = String::from("hash,stage,status,reason\n");
    for r in rows {
        out.push_str(&format!("{},{},{},{}\n", esc(&r.hash), esc(&r.stage), esc(&r.status), esc(&r.reason)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_mock_once() {
        let mut db = Db::open_in_memory().unwrap();
        let st = db.stats().unwrap();
        assert_eq!(st.total, 5);
        assert_eq!(st.translated, 2);
        assert_eq!(st.failed, 2);
        assert_eq!(st.pending, 1);
        assert_eq!(st.expected_total, 26_500);
        db.clear_all().unwrap();
        // seeded flag prevents reseeding an intentionally empty table
        db.init().unwrap();
        assert_eq!(db.stats().unwrap().total, 0);
        db.reset_demo().unwrap();
        assert_eq!(db.stats().unwrap().total, 5);
    }

    #[test]
    fn persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db");
        {
            let db = Db::open(&p).unwrap();
            db.update("87274f3b3e819604", "Translated", Some("None")).unwrap();
        }
        let db = Db::open(&p).unwrap();
        assert_eq!(db.get("87274f3b3e819604").unwrap().unwrap().status, "Translated");
        assert_eq!(db.stats().unwrap().translated, 3);
    }

    #[test]
    fn recovers_from_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bad.db");
        std::fs::write(&p, b"this is definitely not a sqlite database file at all, padding padding padding padding").unwrap();
        let db = Db::open(&p).unwrap();
        assert_eq!(db.stats().unwrap().total, 5);
    }

    #[test]
    fn filters_search_and_pagination() {
        let mut db = Db::open_in_memory().unwrap();
        let q = |stage: Option<&str>, status: Option<&str>, search: Option<&str>| ShaderQuery {
            stage: stage.map(Into::into),
            status: status.map(Into::into),
            search: search.map(Into::into),
            page: Some(1),
            page_size: Some(25),
        };
        assert_eq!(db.query(&q(Some("Mesh"), None, None)).unwrap().total, 2);
        assert_eq!(db.query(&q(None, Some("Failed"), None)).unwrap().total, 2);
        assert_eq!(db.query(&q(Some("Mesh"), Some("Pending"), None)).unwrap().total, 1);
        assert_eq!(db.query(&q(None, None, Some("7F99"))).unwrap().total, 1);
        assert_eq!(db.query(&q(None, None, Some("atomics"))).unwrap().total, 1);
        assert_eq!(db.query(&q(None, None, Some("%"))).unwrap().total, 0);
        assert_eq!(db.query(&q(Some("All"), Some("All"), Some(""))).unwrap().total, 5);
        // failed first
        assert_eq!(db.query(&q(None, None, None)).unwrap().rows[0].status, "Failed");

        let many: Vec<Shader> = (0..120)
            .map(|i| Shader { hash: format!("{:016x}", i + 1000), stage: "ps".into(), status: "ok".into(), reason: "".into(), updated_at: 0 })
            .collect();
        let r = db.upsert_many(&many, true).unwrap();
        assert_eq!(r.inserted, 120);
        let p = db.query(&ShaderQuery { page: Some(99), page_size: Some(25), ..Default::default() }).unwrap();
        assert_eq!(p.total, 125);
        assert_eq!(p.page_count, 5);
        assert_eq!(p.page, 5); // clamped
        assert_eq!(p.rows.len(), 25);
        assert_eq!(db.stats().unwrap().translated, 122);
        assert_eq!(db.get(&format!("{:016x}", 1000)).unwrap().unwrap().stage, "Pixel");
    }

    #[test]
    fn upsert_respects_overwrite_flag_and_validates() {
        let mut db = Db::open_in_memory().unwrap();
        let items = vec![
            Shader { hash: "0x7F99B1CC7CCB0F1B".into(), stage: "Vertex".into(), status: "Translated".into(), reason: "".into(), updated_at: 0 },
            Shader { hash: "not-a-hash!".into(), stage: "".into(), status: "".into(), reason: "".into(), updated_at: 0 },
            Shader { hash: "aaaaaaaaaaaaaaaa".into(), stage: "".into(), status: "".into(), reason: "".into(), updated_at: 0 },
        ];
        let r = db.upsert_many(&items, false).unwrap();
        assert_eq!(r, ImportResult { inserted: 1, updated: 0, skipped: 2 });
        assert_eq!(db.get("7f99b1cc7ccb0f1b").unwrap().unwrap().status, "Failed");
        let r = db.upsert_many(&items, true).unwrap();
        assert_eq!(r, ImportResult { inserted: 0, updated: 2, skipped: 1 });
        assert_eq!(db.get("7f99b1cc7ccb0f1b").unwrap().unwrap().status, "Translated");
        assert_eq!(db.get("aaaaaaaaaaaaaaaa").unwrap().unwrap().status, "Untested");
        assert!(db.update("ffffffffffffffff", "Failed", None).is_err());
    }

    #[test]
    fn csv_and_json_import_parsing() {
        let csv = "\u{feff}Hash;Stage;Status;Reason\n7f99b1cc7ccb0f1b;Vertex;Failed;\"Wave64; Lane Mask\"\n\nee78da6862364ddd;Pixel;Translated;None\n";
        let rows = parse_csv(csv);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].reason, "Wave64; Lane Mask");
        let headerless = parse_csv("ee78da6862364ddd,Pixel,Translated,None\n");
        assert_eq!(headerless.len(), 1);
        assert_eq!(headerless[0].stage, "Pixel");

        let j = r#"{"shaderDatabase":[{"hash":"7f99b1cc7ccb0f1b","stage":"Vertex","status":"Failed","reason":"Wave64 Lane Mask"}]}"#;
        assert_eq!(parse_json(j).unwrap().len(), 1);
        assert_eq!(parse_json(r#"[{"hash":"ab12ab12ab12ab12"}]"#).unwrap()[0].hash, "ab12ab12ab12ab12");
        assert!(parse_json("{oops").is_err());
        assert!(parse_json(r#"{"x":1}"#).is_err());

        let out = to_csv(&parse_csv(csv));
        assert!(out.contains("\"Wave64; Lane Mask\"") || out.contains("Wave64; Lane Mask"));
        assert_eq!(parse_csv(&out).len(), 2);
    }
}
