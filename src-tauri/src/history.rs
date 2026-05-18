use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn projects_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

#[derive(Serialize)]
pub struct ProjectInfo {
    pub id: String,         // dir name (encoded path)
    pub label: String,      // best-effort decoded path
    pub session_count: u64,
    pub last_modified: u64, // unix seconds
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub project_id: String,
    pub session_id: String, // jsonl filename without extension
    pub bytes: u64,
    pub last_modified: u64,
    pub message_count: u64,
    pub first_user_text: String, // first user message preview
}

#[derive(Serialize)]
pub struct HistoryMessage {
    #[serde(rename = "type")]
    pub kind: String, // user / assistant / tool_use / tool_result / system
    pub role: String,
    pub timestamp: String,
    pub model: String,
    pub text: String,
    pub tool_name: String,
    pub tool_input: String,
    pub tool_output: String,
    pub raw_kind: String, // original event type
}

#[derive(Serialize)]
pub struct SearchHit {
    pub project_id: String,
    pub session_id: String,
    pub line_index: u64,
    pub timestamp: String,
    pub role: String,
    pub snippet: String,
}

fn decode_label(dir: &str) -> String {
    // Claude encodes "/Users/foo/bar" as "-Users-foo-bar". Best-effort decode.
    if let Some(rest) = dir.strip_prefix('-') {
        format!("/{}", rest.replace('-', "/"))
    } else {
        dir.to_string()
    }
}

fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let root = projects_dir().ok_or("HOME not set")?;
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let id = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let mut count = 0u64;
        let mut latest = 0u64;
        if let Ok(items) = fs::read_dir(entry.path()) {
            for it in items.flatten() {
                if it.path().extension().and_then(|s| s.to_str()) == Some("jsonl") {
                    count += 1;
                    let m = modified_secs(&it.path());
                    if m > latest {
                        latest = m;
                    }
                }
            }
        }
        if count == 0 {
            continue;
        }
        out.push(ProjectInfo {
            label: decode_label(&id),
            id,
            session_count: count,
            last_modified: latest,
        });
    }
    out.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(out)
}

fn read_first_user_preview(path: &Path) -> (u64, String) {
    let mut count = 0u64;
    let mut first = String::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            if line.is_empty() {
                continue;
            }
            count += 1;
            if first.is_empty() {
                if let Ok(v) = serde_json::from_str::<Value>(line) {
                    if v.get("type").and_then(|s| s.as_str()) == Some("user") {
                        if let Some(text) = extract_user_text(&v) {
                            first = text.chars().take(80).collect();
                        }
                    }
                }
            }
        }
    }
    (count, first)
}

fn extract_user_text(v: &Value) -> Option<String> {
    // user message: message.content can be string or array of {type:"text", text:..}
    let msg = v.get("message")?;
    let content = msg.get("content")?;
    if let Some(s) = content.as_str() {
        return Some(s.replace('\n', " "));
    }
    if let Some(arr) = content.as_array() {
        for c in arr {
            if c.get("type").and_then(|s| s.as_str()) == Some("text") {
                if let Some(s) = c.get("text").and_then(|s| s.as_str()) {
                    return Some(s.replace('\n', " "));
                }
            }
        }
    }
    None
}

fn extract_assistant_text(v: &Value) -> (String, String, String, String) {
    // returns (text, tool_name, tool_input_json, model)
    let mut text = String::new();
    let mut tool_name = String::new();
    let mut tool_input = String::new();
    let mut model = String::new();
    if let Some(msg) = v.get("message") {
        model = msg
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
            for c in arr {
                let t = c.get("type").and_then(|s| s.as_str()).unwrap_or("");
                if t == "text" {
                    if let Some(s) = c.get("text").and_then(|s| s.as_str()) {
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(s);
                    }
                } else if t == "tool_use" {
                    if tool_name.is_empty() {
                        tool_name = c
                            .get("name")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string();
                        tool_input = c
                            .get("input")
                            .map(|x| serde_json::to_string(x).unwrap_or_default())
                            .unwrap_or_default();
                    }
                }
            }
        } else if let Some(s) = msg.get("content").and_then(|s| s.as_str()) {
            text = s.to_string();
        }
    }
    (text, tool_name, tool_input, model)
}

fn extract_tool_result(v: &Value) -> String {
    if let Some(arr) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        for c in arr {
            if c.get("type").and_then(|s| s.as_str()) == Some("tool_result") {
                if let Some(s) = c.get("content").and_then(|x| x.as_str()) {
                    return s.chars().take(4000).collect();
                }
                if let Some(arr) = c.get("content").and_then(|x| x.as_array()) {
                    let mut out = String::new();
                    for x in arr {
                        if let Some(s) = x.get("text").and_then(|s| s.as_str()) {
                            out.push_str(s);
                        }
                    }
                    return out.chars().take(4000).collect();
                }
            }
        }
    }
    String::new()
}

#[tauri::command]
pub fn read_session(project_id: String, session_id: String) -> Result<Vec<HistoryMessage>, String> {
    if project_id.contains('/') || project_id.contains("..") {
        return Err("invalid project_id".into());
    }
    if session_id.contains('/') || session_id.contains("..") {
        return Err("invalid session_id".into());
    }
    let root = projects_dir().ok_or("HOME not set")?;
    let path = root.join(&project_id).join(format!("{}.jsonl", session_id));
    if !path.exists() {
        return Err(format!("not found: {}", path.display()));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let kind_raw = v.get("type").and_then(|s| s.as_str()).unwrap_or("").to_string();
        let ts = v
            .get("timestamp")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        let role = v
            .get("message")
            .and_then(|m| m.get("role"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();

        match kind_raw.as_str() {
            "user" => {
                let mut text = extract_user_text(&v).unwrap_or_default();
                let mut tool_output = String::new();
                if text.is_empty() {
                    // could be tool_result
                    tool_output = extract_tool_result(&v);
                }
                let kind = if !tool_output.is_empty() {
                    "tool_result".to_string()
                } else {
                    "user".to_string()
                };
                if text.len() > 8000 {
                    text = text.chars().take(8000).collect();
                }
                out.push(HistoryMessage {
                    kind,
                    role,
                    timestamp: ts,
                    model: String::new(),
                    text,
                    tool_name: String::new(),
                    tool_input: String::new(),
                    tool_output,
                    raw_kind: kind_raw,
                });
            }
            "assistant" => {
                let (mut text, tool_name, tool_input, model) = extract_assistant_text(&v);
                let kind = if !tool_name.is_empty() {
                    "tool_use".to_string()
                } else {
                    "assistant".to_string()
                };
                if text.len() > 8000 {
                    text = text.chars().take(8000).collect();
                }
                out.push(HistoryMessage {
                    kind,
                    role,
                    timestamp: ts,
                    model,
                    text,
                    tool_name,
                    tool_input,
                    tool_output: String::new(),
                    raw_kind: kind_raw,
                });
            }
            _ => {
                // skip system / permission-mode / etc
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_sessions(project_id: String) -> Result<Vec<SessionInfo>, String> {
    if project_id.contains('/') || project_id.contains("..") {
        return Err("invalid project_id".into());
    }
    let root = projects_dir().ok_or("HOME not set")?;
    let dir = root.join(&project_id);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if stem.is_empty() {
            continue;
        }
        let bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let modified = modified_secs(&path);
        let (count, preview) = read_first_user_preview(&path);
        out.push(SessionInfo {
            project_id: project_id.clone(),
            session_id: stem,
            bytes,
            last_modified: modified,
            message_count: count,
            first_user_text: preview,
        });
    }
    out.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(out)
}

#[tauri::command]
pub fn search_history(query: String, max_hits: u32) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let q_lower = q.to_lowercase();
    let cap = if max_hits == 0 { 200 } else { max_hits as usize };

    let root = projects_dir().ok_or("HOME not set")?;
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut hits = Vec::new();

    'outer: for proj_entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let proj_entry = match proj_entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let proj_path = proj_entry.path();
        if !proj_path.is_dir() {
            continue;
        }
        let project_id = proj_entry.file_name().to_string_lossy().to_string();
        for sess_entry in fs::read_dir(&proj_path).map_err(|e| e.to_string())? {
            let sess_entry = match sess_entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let sess_path = sess_entry.path();
            if sess_path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let session_id = sess_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            // quick reject: if file as-bytes lowercased doesn't contain q, skip
            let content = match fs::read_to_string(&sess_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if !content.to_lowercase().contains(&q_lower) {
                continue;
            }
            for (i, line) in content.lines().enumerate() {
                if line.is_empty() {
                    continue;
                }
                if !line.to_lowercase().contains(&q_lower) {
                    continue;
                }
                let v: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let kind_raw = v.get("type").and_then(|s| s.as_str()).unwrap_or("");
                if kind_raw != "user" && kind_raw != "assistant" {
                    continue;
                }
                let ts = v.get("timestamp").and_then(|s| s.as_str()).unwrap_or("").to_string();
                let role = v
                    .get("message")
                    .and_then(|m| m.get("role"))
                    .and_then(|s| s.as_str())
                    .unwrap_or(kind_raw)
                    .to_string();
                let text = if kind_raw == "user" {
                    extract_user_text(&v).unwrap_or_default()
                } else {
                    extract_assistant_text(&v).0
                };
                if text.is_empty() {
                    continue;
                }
                let lower = text.to_lowercase();
                let pos = lower.find(&q_lower).unwrap_or(0);
                let start = pos.saturating_sub(40);
                let end = (pos + q.len() + 80).min(text.len());
                // align to char boundary
                let mut s = start;
                while s > 0 && !text.is_char_boundary(s) {
                    s -= 1;
                }
                let mut e = end;
                while e < text.len() && !text.is_char_boundary(e) {
                    e += 1;
                }
                let snippet = text[s..e].replace('\n', " ");
                hits.push(SearchHit {
                    project_id: project_id.clone(),
                    session_id: session_id.clone(),
                    line_index: i as u64,
                    timestamp: ts,
                    role,
                    snippet,
                });
                if hits.len() >= cap {
                    break 'outer;
                }
            }
        }
    }
    Ok(hits)
}
