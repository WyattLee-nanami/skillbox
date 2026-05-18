use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Default, Clone)]
pub struct DailyBucket {
    pub date: String, // YYYY-MM-DD local
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_create: u64,
    pub total: u64,
    pub messages: u64,
}

#[derive(Serialize, Default)]
pub struct ModelTotal {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_create: u64,
    pub total: u64,
    pub messages: u64,
}

#[derive(Serialize, Default)]
pub struct UsageStats {
    // overall
    pub total_tokens: u64,
    pub total_messages: u64,
    pub session_count: u64,
    // breakdown
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_create_tokens: u64,
    // window meta
    pub window_days: u32,
    pub generated_at: String,
    // series
    pub daily: Vec<DailyBucket>,
    pub by_model: Vec<ModelTotal>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn projects_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Convert ISO8601 timestamp like "2026-05-07T07:06:09.727Z" into a local YYYY-MM-DD string.
/// Uses simple offset from system tz via libc. We avoid pulling chrono in to keep deps light.
fn iso_to_local_date(ts: &str) -> Option<String> {
    // Parse a Z-terminated ISO 8601 by hand: YYYY-MM-DDTHH:MM:SS(.fff)Z
    if ts.len() < 19 {
        return None;
    }
    let bytes = ts.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let y: i32 = ts[0..4].parse().ok()?;
    let mo: u32 = ts[5..7].parse().ok()?;
    let d: u32 = ts[8..10].parse().ok()?;
    let h: u32 = ts[11..13].parse().ok()?;
    let mi: u32 = ts[14..16].parse().ok()?;
    let s: u32 = ts[17..19].parse().ok()?;

    // Convert to UTC unix time without external lib (works for 1970..2099).
    let utc_secs = ymd_hms_to_unix(y, mo, d, h, mi, s)?;
    // Apply local timezone offset using libc tzset/localtime_r.
    let local_secs = apply_local_offset(utc_secs);
    let (yy, mm, dd) = unix_to_ymd(local_secs);
    Some(format!("{:04}-{:02}-{:02}", yy, mm, dd))
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i32, m: u32) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn ymd_hms_to_unix(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> Option<i64> {
    if !(1970..=2099).contains(&y) || !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let mut days: i64 = 0;
    for yy in 1970..y {
        days += if is_leap(yy) { 366 } else { 365 };
    }
    for mm in 1..mo {
        days += days_in_month(y, mm);
    }
    days += (d - 1) as i64;
    Some(days * 86400 + (h as i64) * 3600 + (mi as i64) * 60 + s as i64)
}

fn apply_local_offset(utc_secs: i64) -> i64 {
    // Use libc::localtime_r to get tm_gmtoff
    unsafe {
        let t = utc_secs as libc::time_t;
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&t, &mut tm).is_null() {
            return utc_secs;
        }
        utc_secs + tm.tm_gmtoff as i64
    }
}

fn unix_to_ymd(secs: i64) -> (i32, u32, u32) {
    let mut days = secs.div_euclid(86400);
    let mut y: i32 = 1970;
    loop {
        let dy = if is_leap(y) { 366 } else { 365 };
        if days < dy {
            break;
        }
        days -= dy;
        y += 1;
    }
    let mut m: u32 = 1;
    while m <= 12 {
        let dm = days_in_month(y, m);
        if days < dm {
            break;
        }
        days -= dm;
        m += 1;
    }
    (y, m, (days + 1) as u32)
}

fn today_local_date() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let local = apply_local_offset(secs);
    let (y, m, d) = unix_to_ymd(local);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn date_n_days_before(today: &str, n: u32) -> Option<String> {
    let y: i32 = today[0..4].parse().ok()?;
    let mo: u32 = today[5..7].parse().ok()?;
    let d: u32 = today[8..10].parse().ok()?;
    let secs = ymd_hms_to_unix(y, mo, d, 0, 0, 0)?;
    let prev = secs - (n as i64) * 86400;
    let (yy, mm, dd) = unix_to_ymd(prev);
    Some(format!("{:04}-{:02}-{:02}", yy, mm, dd))
}

fn walk_jsonl(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_jsonl(&path, files);
        } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

#[tauri::command]
pub fn scan_usage(window_days: u32) -> Result<UsageStats, String> {
    let days = if window_days == 0 { 14 } else { window_days };
    let projects = projects_dir().ok_or("HOME not set")?;
    let today = today_local_date();
    let cutoff = date_n_days_before(&today, days.saturating_sub(1)).unwrap_or_default();

    // Build empty buckets for every day in window so the chart has zeros.
    let mut by_day: HashMap<String, DailyBucket> = HashMap::new();
    for i in 0..days {
        if let Some(d) = date_n_days_before(&today, days - 1 - i) {
            by_day.insert(d.clone(), DailyBucket { date: d, ..Default::default() });
        }
    }

    let mut by_model: HashMap<String, ModelTotal> = HashMap::new();
    let mut session_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut total = UsageStats {
        window_days: days,
        ..Default::default()
    };

    let mut files = Vec::new();
    walk_jsonl(&projects, &mut files);

    for path in &files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for line in content.lines() {
            if line.is_empty() {
                continue;
            }
            let v: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            // Only count assistant message rows (those carry usage + timestamp)
            if v.get("type").and_then(|s| s.as_str()) != Some("assistant") {
                continue;
            }
            let msg = match v.get("message").and_then(|m| m.as_object()) {
                Some(m) => m,
                None => continue,
            };
            let usage = match msg.get("usage").and_then(|u| u.as_object()) {
                Some(u) => u,
                None => continue,
            };
            let ts = match v.get("timestamp").and_then(|s| s.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let date = match iso_to_local_date(ts) {
                Some(d) => d,
                None => continue,
            };
            if date.as_str() < cutoff.as_str() {
                continue;
            }

            let inp = usage.get("input_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
            let out = usage.get("output_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
            let cr = usage
                .get("cache_read_input_tokens")
                .and_then(|n| n.as_u64())
                .unwrap_or(0);
            let cc = usage
                .get("cache_creation_input_tokens")
                .and_then(|n| n.as_u64())
                .unwrap_or(0);
            let sum = inp + out + cr + cc;
            let model = msg
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
                .to_string();

            // total
            total.input_tokens += inp;
            total.output_tokens += out;
            total.cache_read_tokens += cr;
            total.cache_create_tokens += cc;
            total.total_tokens += sum;
            total.total_messages += 1;
            if let Some(sid) = v.get("sessionId").and_then(|s| s.as_str()) {
                session_ids.insert(sid.to_string());
            }

            // daily
            let bucket = by_day.entry(date.clone()).or_insert_with(|| DailyBucket {
                date: date.clone(),
                ..Default::default()
            });
            bucket.input += inp;
            bucket.output += out;
            bucket.cache_read += cr;
            bucket.cache_create += cc;
            bucket.total += sum;
            bucket.messages += 1;

            // by model
            let mt = by_model
                .entry(model.clone())
                .or_insert_with(|| ModelTotal { model: model.clone(), ..Default::default() });
            mt.input += inp;
            mt.output += out;
            mt.cache_read += cr;
            mt.cache_create += cc;
            mt.total += sum;
            mt.messages += 1;
        }
    }

    let mut daily: Vec<DailyBucket> = by_day.into_values().collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    total.daily = daily;

    let mut models: Vec<ModelTotal> = by_model.into_values().collect();
    models.sort_by(|a, b| b.total.cmp(&a.total));
    total.by_model = models;

    total.session_count = session_ids.len() as u64;
    total.generated_at = today;
    Ok(total)
}
