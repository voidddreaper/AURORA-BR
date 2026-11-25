//! Log parser for the "Salvador" dashboard.
//!
//! The parser is deliberately tolerant: recompilation/emulator logs differ a lot
//! between builds, so instead of a single rigid grammar it scans every line for
//! a set of well-known patterns (FPS, frame time, GPU idle, copy-back, shader
//! compilation with a 16-hex-digit hash, WARN/ERROR levels). Files are streamed
//! line by line so multi-GB logs do not have to fit in memory.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

pub const MAX_TIMELINE_POINTS: usize = 600;
pub const MAX_LOG_LINES: usize = 500;
pub const MAX_LINE_CHARS: usize = 600;
pub const TOP_SHADERS: usize = 10;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Kpis {
    pub fps: Option<f64>,
    pub frame_time: Option<f64>,
    pub gpu_idle: Option<f64>,
    pub copy_back_mb: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePoint {
    pub t: usize,
    pub frame_time: f64,
    pub gpu_idle: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlowShader {
    pub hash: String,
    pub stage: String,
    pub time_ms: f64,
    pub status: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub line_no: usize,
    pub level: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub file_name: String,
    pub file_path: String,
    pub file_size: u64,
    pub line_count: usize,
    pub kpis: Kpis,
    pub frame_samples: usize,
    pub timeline: Vec<TimelinePoint>,
    pub slow_shaders: Vec<SlowShader>,
    /// Every distinct shader seen in the log (hash + stage), used to feed the tracker.
    pub all_shaders: Vec<SlowShader>,
    pub shaders_compiled: usize,
    pub logs: Vec<LogLine>,
    pub warn_count: usize,
    pub error_count: usize,
    pub parse_ms: u64,
    pub parsed_at: u64,
    pub is_demo: bool,
}

struct Patterns {
    fps: Regex,
    frame: Regex,
    idle: Regex,
    copy: Regex,
    hash: Regex,
    ms: Regex,
    stage_long: Regex,
    stage_short_kv: Regex,
    stage_short_br: Regex,
    level: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        fps: Regex::new(r"(?i)(?:\b(?:avg[\s_-]*)?fps\b\s*[:=]?\s*(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*fps\b)").unwrap(),
        frame: Regex::new(r"(?i)frame[\s_-]*time\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|us|µs|s)?\b").unwrap(),
        idle: Regex::new(r"(?i)gpu[\s_-]*idle(?:[\s_-]*time)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|us|µs|s)?\b").unwrap(),
        copy: Regex::new(r"(?i)cop(?:y|ying)[\s_-]*back\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(bytes|b|kib|kb|mib|mb|gib|gb)?\b").unwrap(),
        hash: Regex::new(r"\b(?:0x)?([0-9a-fA-F]{16})\b").unwrap(),
        ms: Regex::new(r"(?i)(\d+(?:\.\d+)?)\s*ms\b").unwrap(),
        stage_long: Regex::new(r"(?i)\b(mesh|pixel|fragment|compute|vertex|geometry|hull|domain|amplification|task)\b").unwrap(),
        stage_short_kv: Regex::new(r"(?i)\b(?:stage|type|kind)\s*[:=]\s*(ms|ps|cs|vs|gs|hs|ds|as)\b").unwrap(),
        stage_short_br: Regex::new(r"\[(MS|PS|CS|VS|GS|HS|DS|AS)\]").unwrap(),
        level: Regex::new(r"(?i)\b(fatal|critical|error|err|warning|warn)\b").unwrap(),
    })
}

fn to_ms(v: f64, unit: Option<&str>) -> f64 {
    match unit.map(|u| u.to_ascii_lowercase()) {
        Some(u) if u == "us" || u == "µs" => v / 1000.0,
        Some(u) if u == "s" => v * 1000.0,
        _ => v,
    }
}

fn to_mb(v: f64, unit: Option<&str>) -> f64 {
    match unit.map(|u| u.to_ascii_lowercase()).as_deref() {
        Some("b") | Some("bytes") => v / (1024.0 * 1024.0),
        Some("kb") | Some("kib") => v / 1024.0,
        Some("gb") | Some("gib") => v * 1024.0,
        _ => v,
    }
}

pub fn canonical_stage(s: &str) -> String {
    match s.to_ascii_lowercase().as_str() {
        "mesh" | "ms" => "Mesh",
        "pixel" | "fragment" | "ps" => "Pixel",
        "compute" | "cs" => "Compute",
        "vertex" | "vs" => "Vertex",
        "geometry" | "gs" => "Geometry",
        "hull" | "hs" => "Hull",
        "domain" | "ds" => "Domain",
        "amplification" | "task" | "as" => "Amplification",
        _ => "Unknown",
    }
    .to_string()
}

fn detect_stage(line: &str) -> String {
    let p = patterns();
    if let Some(c) = p.stage_long.captures(line) {
        return canonical_stage(&c[1]);
    }
    if let Some(c) = p.stage_short_kv.captures(line) {
        return canonical_stage(&c[1]);
    }
    if let Some(c) = p.stage_short_br.captures(line) {
        return canonical_stage(&c[1]);
    }
    "Unknown".to_string()
}

fn mean(v: &[f64]) -> Option<f64> {
    if v.is_empty() {
        None
    } else {
        Some(v.iter().sum::<f64>() / v.len() as f64)
    }
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// Decide the dashboard status label of a compiled shader.
pub fn shader_status(time_ms: f64, failed: bool, slow_threshold_ms: f64) -> String {
    if failed {
        "Failed".into()
    } else if time_ms >= slow_threshold_ms {
        "Slow JIT".into()
    } else {
        "Compiled".into()
    }
}

/// Bucket-average a timeline down to at most `max` points.
pub fn downsample(points: Vec<TimelinePoint>, max: usize) -> Vec<TimelinePoint> {
    if points.len() <= max || max == 0 {
        return points;
    }
    let bucket = (points.len() as f64 / max as f64).ceil() as usize;
    points
        .chunks(bucket)
        .map(|c| {
            let ft = c.iter().map(|p| p.frame_time).sum::<f64>() / c.len() as f64;
            let idles: Vec<f64> = c.iter().filter_map(|p| p.gpu_idle).collect();
            TimelinePoint {
                t: c[0].t,
                frame_time: round1(ft),
                gpu_idle: mean(&idles).map(round1),
            }
        })
        .collect()
}

/// Incremental parser state. Feed lines with [`LogParser::push_line`], then call [`LogParser::finish`].
pub struct LogParser {
    slow_threshold_ms: f64,
    line_no: usize,
    fps: Vec<f64>,
    frames: Vec<TimelinePoint>,
    idles: Vec<f64>,
    copies: Vec<f64>,
    pending_idle: Option<f64>,
    shaders: HashMap<String, (String, f64, bool)>,
    order: Vec<String>,
    compile_events: usize,
    logs: std::collections::VecDeque<LogLine>,
    warn_count: usize,
    error_count: usize,
}

impl LogParser {
    pub fn new(slow_threshold_ms: f64) -> Self {
        let thr = if slow_threshold_ms.is_finite() && slow_threshold_ms > 0.0 { slow_threshold_ms } else { 300.0 };
        Self {
            slow_threshold_ms: thr,
            line_no: 0,
            fps: Vec::new(),
            frames: Vec::new(),
            idles: Vec::new(),
            copies: Vec::new(),
            pending_idle: None,
            shaders: HashMap::new(),
            order: Vec::new(),
            compile_events: 0,
            logs: std::collections::VecDeque::with_capacity(MAX_LOG_LINES),
            warn_count: 0,
            error_count: 0,
        }
    }

    pub fn push_line(&mut self, raw: &str) {
        self.line_no += 1;
        let line = raw.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            return;
        }
        let p = patterns();
        let lower = line.to_ascii_lowercase();

        // ---- Level (WARN / ERROR) ----
        let mut level: Option<&'static str> = None;
        if lower.contains("err") || lower.contains("warn") || lower.contains("fatal") || lower.contains("critical") {
            if let Some(c) = p.level.captures(line) {
                let l = c[1].to_ascii_lowercase();
                level = Some(if l.starts_with("warn") { "WARN" } else { "ERROR" });
            }
        }
        if let Some(lv) = level {
            if lv == "WARN" {
                self.warn_count += 1;
            } else {
                self.error_count += 1;
            }
            if self.logs.len() == MAX_LOG_LINES {
                self.logs.pop_front();
            }
            self.logs.push_back(LogLine {
                line_no: self.line_no,
                level: lv.to_string(),
                text: truncate_chars(line.trim(), MAX_LINE_CHARS),
            });
        }

        // ---- Performance metrics ----
        let mut is_perf = false;
        if lower.contains("fps") {
            if let Some(c) = p.fps.captures(line) {
                if let Some(v) = c.get(1).or_else(|| c.get(2)).and_then(|m| m.as_str().parse::<f64>().ok()) {
                    if v.is_finite() && v >= 0.0 && v < 100_000.0 {
                        self.fps.push(v);
                        is_perf = true;
                    }
                }
            }
        }
        let mut line_idle: Option<f64> = None;
        if lower.contains("idle") {
            if let Some(c) = p.idle.captures(line) {
                if let Ok(v) = c[1].parse::<f64>() {
                    let v = to_ms(v, c.get(2).map(|m| m.as_str()));
                    if v.is_finite() && v >= 0.0 {
                        line_idle = Some(v);
                        self.idles.push(v);
                        is_perf = true;
                    }
                }
            }
        }
        let mut had_frame = false;
        if lower.contains("frame") {
            if let Some(c) = p.frame.captures(line) {
                if let Ok(v) = c[1].parse::<f64>() {
                    let v = to_ms(v, c.get(2).map(|m| m.as_str()));
                    if v.is_finite() && v >= 0.0 {
                        let idle = line_idle.or_else(|| self.pending_idle.take());
                        self.frames.push(TimelinePoint { t: self.frames.len(), frame_time: v, gpu_idle: idle });
                        had_frame = true;
                        is_perf = true;
                    }
                }
            }
        }
        if let (Some(v), false) = (line_idle, had_frame) {
            match self.frames.last_mut() {
                Some(last) if last.gpu_idle.is_none() => last.gpu_idle = Some(v),
                _ => self.pending_idle = Some(v),
            }
        }
        if lower.contains("back") && lower.contains("cop") {
            if let Some(c) = p.copy.captures(line) {
                if let Ok(v) = c[1].parse::<f64>() {
                    let v = to_mb(v, c.get(2).map(|m| m.as_str()));
                    if v.is_finite() && v >= 0.0 {
                        self.copies.push(v);
                        is_perf = true;
                    }
                }
            }
        }

        // ---- Shader compilation ----
        if !is_perf
            && (lower.contains("shader") || lower.contains("compil") || lower.contains("pipeline") || lower.contains("jit"))
        {
            if let Some(h) = p.hash.captures(line) {
                if let Some(ms) = p.ms.captures(line).and_then(|c| c[1].parse::<f64>().ok()) {
                    if ms.is_finite() && ms >= 0.0 {
                        let hash = h[1].to_ascii_lowercase();
                        let stage = detect_stage(line);
                        let failed = level == Some("ERROR") || lower.contains("fail");
                        self.compile_events += 1;
                        match self.shaders.get_mut(&hash) {
                            Some(entry) => {
                                if ms > entry.1 {
                                    entry.1 = ms;
                                }
                                if entry.0 == "Unknown" {
                                    entry.0 = stage;
                                }
                                entry.2 |= failed;
                            }
                            None => {
                                self.order.push(hash.clone());
                                self.shaders.insert(hash, (stage, ms, failed));
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn finish(self) -> Analysis {
        let frame_times: Vec<f64> = self.frames.iter().map(|f| f.frame_time).collect();
        let avg_frame = mean(&frame_times);
        let fps = mean(&self.fps).or_else(|| avg_frame.filter(|f| *f > 0.0).map(|f| 1000.0 / f));

        let thr = self.slow_threshold_ms;
        let mut all: Vec<SlowShader> = self
            .order
            .iter()
            .map(|h| {
                let (stage, ms, failed) = &self.shaders[h];
                SlowShader { hash: h.clone(), stage: stage.clone(), time_ms: round1(*ms), status: shader_status(*ms, *failed, thr) }
            })
            .collect();
        all.sort_by(|a, b| b.time_ms.partial_cmp(&a.time_ms).unwrap_or(std::cmp::Ordering::Equal));
        let slow: Vec<SlowShader> = all.iter().take(TOP_SHADERS).cloned().collect();

        Analysis {
            line_count: self.line_no,
            kpis: Kpis {
                fps: fps.map(round1),
                frame_time: avg_frame.map(round1),
                gpu_idle: mean(&self.idles).map(round1),
                copy_back_mb: mean(&self.copies).map(round1),
            },
            frame_samples: self.frames.len(),
            timeline: downsample(self.frames, MAX_TIMELINE_POINTS),
            slow_shaders: slow,
            all_shaders: all,
            shaders_compiled: self.compile_events,
            logs: self.logs.into_iter().collect(),
            warn_count: self.warn_count,
            error_count: self.error_count,
            ..Default::default()
        }
    }
}

/// Parse a string (used by tests and by the UTF-16 path).
pub fn parse_str(text: &str, slow_threshold_ms: f64) -> Analysis {
    let mut p = LogParser::new(slow_threshold_ms);
    for line in text.lines() {
        p.push_line(line);
    }
    p.finish()
}

fn decode_utf16(bytes: &[u8], big_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| if big_endian { u16::from_be_bytes([c[0], c[1]]) } else { u16::from_le_bytes([c[0], c[1]]) })
        .collect();
    String::from_utf16_lossy(&units)
}

/// Parse a log file from disk. Handles UTF-8 (with/without BOM), UTF-16 LE/BE (with BOM)
/// and invalid byte sequences (replaced, never a hard error).
pub fn parse_file(path: &Path, slow_threshold_ms: f64) -> Result<Analysis, String> {
    let started = Instant::now();
    let meta = std::fs::metadata(path).map_err(|e| format!("Could not read file: {e}"))?;
    if meta.is_dir() {
        return Err("The dropped item is a folder, not a log file.".into());
    }
    let mut file = File::open(path).map_err(|e| format!("Could not open file: {e}"))?;

    let mut head = [0u8; 2];
    let n = file.read(&mut head).map_err(|e| e.to_string())?;
    let mut analysis = if n == 2 && (head == [0xFF, 0xFE] || head == [0xFE, 0xFF]) {
        let mut rest = Vec::new();
        file.read_to_end(&mut rest).map_err(|e| e.to_string())?;
        let text = decode_utf16(&rest, head == [0xFE, 0xFF]);
        parse_str(&text, slow_threshold_ms)
    } else {
        // Re-open and stream line by line.
        let file = File::open(path).map_err(|e| e.to_string())?;
        let mut reader = BufReader::with_capacity(1 << 20, file);
        let mut parser = LogParser::new(slow_threshold_ms);
        let mut buf: Vec<u8> = Vec::with_capacity(4096);
        let mut first = true;
        loop {
            buf.clear();
            let read = reader.read_until(b'\n', &mut buf).map_err(|e| format!("Read error: {e}"))?;
            if read == 0 {
                break;
            }
            let mut slice: &[u8] = &buf;
            if first {
                if slice.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    slice = &slice[3..];
                }
                first = false;
            }
            let line = String::from_utf8_lossy(slice);
            parser.push_line(&line);
        }
        parser.finish()
    };

    analysis.file_name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    analysis.file_path = path.to_string_lossy().to_string();
    analysis.file_size = meta.len();
    analysis.parse_ms = started.elapsed().as_millis() as u64;
    analysis.parsed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(analysis)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SAMPLE: &str = "\
[00:00:01.000] [INFO] VIctory boot v0.9.3
[00:00:01.200] [INFO] Shader compiled hash=4e35b816f2f91d68 stage=Mesh time=405 ms
[00:00:01.300] [INFO] Shader compiled hash=b3ba0ef9ee352720 stage=Pixel time=312.4 ms
[00:00:01.350] [INFO] Shader compiled hash=0750cb2d975c7563 stage=Mesh time=280 ms
[00:00:01.360] [INFO] Pipeline compile 0x00000000deadbeef [CS] took 12ms
[00:00:02.000] [PERF] FPS: 2.0 | Frame time: 500.0 ms | GPU idle: 190.0 ms | Copying back: 48.0 MB
[00:00:02.500] [PERF] FPS: 2.2 | Frame time: 452.4 ms | GPU idle: 176.8 ms | Copying back: 45.6 MB
[00:00:03.000] [WARN] Wave64 lane mask emulated for shader 7f99b1cc7ccb0f1b
[00:00:03.100] [ERROR] Failed to translate shader baa527de08d002bf: missing 64-bit image atomics (compile 51 ms)
[00:00:03.200] [INFO] errors=0 warnings handled
";

    #[test]
    fn kpis_are_averaged() {
        let a = parse_str(SAMPLE, 300.0);
        assert_eq!(a.kpis.fps, Some(2.1));
        assert_eq!(a.kpis.frame_time, Some(476.2));
        assert_eq!(a.kpis.gpu_idle, Some(183.4));
        assert_eq!(a.kpis.copy_back_mb, Some(46.8));
        assert_eq!(a.frame_samples, 2);
        assert_eq!(a.timeline.len(), 2);
        assert_eq!(a.timeline[0].gpu_idle, Some(190.0));
    }

    #[test]
    fn shaders_are_ranked_and_classified() {
        let a = parse_str(SAMPLE, 300.0);
        assert_eq!(a.slow_shaders[0].hash, "4e35b816f2f91d68");
        assert_eq!(a.slow_shaders[0].stage, "Mesh");
        assert_eq!(a.slow_shaders[0].status, "Slow JIT");
        assert_eq!(a.slow_shaders[1].stage, "Pixel");
        assert_eq!(a.slow_shaders[2].status, "Compiled");
        let cs = a.all_shaders.iter().find(|s| s.hash == "00000000deadbeef").unwrap();
        assert_eq!(cs.stage, "Compute");
        let failed = a.all_shaders.iter().find(|s| s.hash == "baa527de08d002bf").unwrap();
        assert_eq!(failed.status, "Failed");
        // the WARN line has a hash but no ms value → not a compile event
        assert!(a.all_shaders.iter().all(|s| s.hash != "7f99b1cc7ccb0f1b"));
    }

    #[test]
    fn warn_and_error_lines_collected() {
        let a = parse_str(SAMPLE, 300.0);
        assert_eq!(a.warn_count, 1);
        assert_eq!(a.error_count, 1);
        assert_eq!(a.logs.len(), 2);
        assert_eq!(a.logs[0].level, "WARN");
        assert_eq!(a.logs[0].line_no, 8);
        assert_eq!(a.logs[1].level, "ERROR");
    }

    #[test]
    fn empty_and_garbage_input_do_not_panic() {
        let a = parse_str("", 300.0);
        assert_eq!(a.kpis, Kpis::default());
        assert!(a.timeline.is_empty());
        let junk = "\u{0}\u{1}ÿÿ fps: abc frame time: ms gpu idle: \n\n\t\r\nshader 1234 ms";
        let b = parse_str(junk, 0.0);
        assert!(b.kpis.fps.is_none());
    }

    #[test]
    fn fps_derived_from_frame_time_when_missing() {
        let a = parse_str("frame_time=20ms\nframe_time=20ms\n", 300.0);
        assert_eq!(a.kpis.fps, Some(50.0));
        assert!(a.kpis.gpu_idle.is_none());
    }

    #[test]
    fn units_are_normalised() {
        let a = parse_str("frame time: 0.5 s\ngpu idle: 2000 us\ncopy back: 2048 KB\n", 300.0);
        assert_eq!(a.kpis.frame_time, Some(500.0));
        assert_eq!(a.kpis.gpu_idle, Some(2.0));
        assert_eq!(a.kpis.copy_back_mb, Some(2.0));
    }

    #[test]
    fn downsample_caps_points() {
        let mut text = String::new();
        for i in 0..5000 {
            text.push_str(&format!("Frame time: {} ms GPU idle: {} ms\n", 16 + i % 5, i % 3));
        }
        let a = parse_str(&text, 300.0);
        assert!(a.timeline.len() <= MAX_TIMELINE_POINTS);
        assert_eq!(a.frame_samples, 5000);
    }

    #[test]
    fn log_buffer_is_bounded() {
        let mut text = String::new();
        for i in 0..2000 {
            text.push_str(&format!("[ERROR] boom {i}\n"));
        }
        let a = parse_str(&text, 300.0);
        assert_eq!(a.error_count, 2000);
        assert_eq!(a.logs.len(), MAX_LOG_LINES);
        assert!(a.logs.last().unwrap().text.ends_with("1999"));
    }

    #[test]
    fn files_utf8_bom_utf16_and_invalid_bytes() {
        let dir = tempfile::tempdir().unwrap();
        // UTF-8 with BOM + invalid byte
        let p1 = dir.path().join("a.log");
        let mut f = File::create(&p1).unwrap();
        f.write_all(&[0xEF, 0xBB, 0xBF]).unwrap();
        f.write_all(b"FPS: 30\n\xFF\xFE broken\n[WARN] x\n").unwrap();
        drop(f);
        let a = parse_file(&p1, 300.0).unwrap();
        assert_eq!(a.kpis.fps, Some(30.0));
        assert_eq!(a.warn_count, 1);
        assert_eq!(a.file_name, "a.log");

        // UTF-16 LE with BOM
        let p2 = dir.path().join("b.txt");
        let mut bytes = vec![0xFF, 0xFE];
        for u in "FPS: 60\r\n[ERROR] y\r\n".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(&p2, bytes).unwrap();
        let b = parse_file(&p2, 300.0).unwrap();
        assert_eq!(b.kpis.fps, Some(60.0));
        assert_eq!(b.error_count, 1);

        // directory and missing file → errors, not panics
        assert!(parse_file(dir.path(), 300.0).is_err());
        assert!(parse_file(&dir.path().join("nope.log"), 300.0).is_err());
    }
}
