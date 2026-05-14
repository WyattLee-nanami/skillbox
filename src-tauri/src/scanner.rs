use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct Skill {
    pub name: String,
    pub dir: String,
    pub description: String,
    pub triggers: Vec<String>,
    pub body: String,
    #[serde(rename = "usageCount")]
    pub usage_count: u64,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct ScanResult {
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    #[serde(rename = "skillsDir")]
    pub skills_dir: String,
    pub skills: Vec<Skill>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn skills_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("skills"))
}

#[tauri::command]
pub fn trash_skill(dir_name: String) -> Result<(), String> {
    // Reject anything containing path separators or relative refs.
    // We only accept a single directory name component.
    if dir_name.is_empty()
        || dir_name.contains('/')
        || dir_name.contains('\\')
        || dir_name == "."
        || dir_name == ".."
        || dir_name.contains('\0')
    {
        return Err(format!("invalid skill name: {}", dir_name));
    }
    let base = skills_dir().ok_or("HOME not set")?;
    let target = base.join(&dir_name);
    if !target.exists() && !target.is_symlink() {
        return Err(format!("skill not found: {}", dir_name));
    }
    // Resolve only the BASE (not target) so symlinked skill folders are allowed.
    // Then verify target's parent (without following its own symlink) lives
    // under the canonical base. Since we built `target = base.join(name)`,
    // and `name` has no separators, this can only fail if base itself is
    // somehow not what we expect.
    let canonical_base = base.canonicalize().map_err(|e| e.to_string())?;
    let canonical_parent = target
        .parent()
        .ok_or("missing parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if canonical_parent != canonical_base {
        return Err("path escape detected".to_string());
    }
    // Pass the un-canonicalized path so the trash crate moves the symlink
    // itself (or the real folder if it's a real folder), not the symlink target.
    trash::delete(&target).map_err(|e| e.to_string())?;
    Ok(())
}

fn projects_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Parse a minimal subset of YAML frontmatter: `name:` and `description:` (with optional `|` block).
fn parse_frontmatter(text: &str) -> (HashMap<String, String>, String) {
    let mut meta = HashMap::new();
    if !text.starts_with("---") {
        return (meta, text.to_string());
    }
    let after_open = &text[3..];
    let end = match after_open.find("\n---") {
        Some(i) => i,
        None => return (meta, text.to_string()),
    };
    let fm = &after_open[..end];
    let body_start = 3 + end + 4; // skip "\n---"
    let body = text.get(body_start..).unwrap_or("").trim_start_matches('\n');

    let mut current_key: Option<String> = None;
    let mut buf: Vec<String> = Vec::new();
    for raw_line in fm.lines() {
        let starts_with_space = raw_line.starts_with(' ') || raw_line.starts_with('\t');
        if !starts_with_space {
            // potential new key
            if let Some(idx) = raw_line.find(':') {
                let key = raw_line[..idx].trim().to_string();
                let val = raw_line[idx + 1..].trim().to_string();
                if !key.is_empty()
                    && key
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                {
                    if let Some(prev) = current_key.take() {
                        meta.insert(prev, buf.join("\n").trim().to_string());
                        buf.clear();
                    }
                    current_key = Some(key);
                    if val == "|" || val == ">" || val.is_empty() {
                        // block scalar; collect from following lines
                    } else {
                        buf.push(val);
                    }
                    continue;
                }
            }
        }
        if current_key.is_some() {
            buf.push(raw_line.trim_start().to_string());
        }
    }
    if let Some(prev) = current_key.take() {
        meta.insert(prev, buf.join("\n").trim().to_string());
    }
    (meta, body.to_string())
}

fn extract_triggers(description: &str) -> Vec<String> {
    let mut triggers = Vec::new();
    let bytes = description.as_bytes();
    // Match Chinese-style quotes 「」『』 and ASCII " "
    let pairs = [("「", "」"), ("『", "』"), ("\"", "\""), ("\u{201c}", "\u{201d}")];
    for (open, close) in pairs.iter() {
        let mut start = 0;
        while let Some(o) = description[start..].find(open) {
            let after_open = start + o + open.len();
            if let Some(c) = description[after_open..].find(close) {
                let content = &description[after_open..after_open + c];
                let chars = content.chars().count();
                if (2..=12).contains(&chars) {
                    triggers.push(content.to_string());
                }
                start = after_open + c + close.len();
            } else {
                break;
            }
        }
    }
    let _ = bytes; // silence unused
    triggers
}

fn count_usage(skill_dirs: &[String]) -> HashMap<String, u64> {
    let mut counts: HashMap<String, u64> = skill_dirs.iter().map(|s| (s.clone(), 0)).collect();
    let projects = match projects_dir() {
        Some(p) if p.exists() => p,
        _ => return counts,
    };

    fn walk(dir: &Path, counts: &mut HashMap<String, u64>, names: &[String]) {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, counts, names);
            } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                if let Ok(content) = fs::read_to_string(&path) {
                    for name in names {
                        // count occurrences of "/<name>" word-boundary or `"skill":"<name>"`
                        let pat1 = format!("/{}", name);
                        let pat2 = format!("\"skill\":\"{}\"", name);
                        let pat3 = format!("\"skill\": \"{}\"", name);
                        let mut n: u64 = 0;
                        n += content.matches(&pat1).count() as u64;
                        n += content.matches(&pat2).count() as u64;
                        n += content.matches(&pat3).count() as u64;
                        if n > 0 {
                            *counts.entry(name.clone()).or_insert(0) += n;
                        }
                    }
                }
            }
        }
    }

    walk(&projects, &mut counts, skill_dirs);
    counts
}

#[tauri::command]
pub fn scan_skills() -> Result<ScanResult, String> {
    let dir = skills_dir().ok_or("HOME env not set")?;
    if !dir.exists() {
        return Ok(ScanResult {
            generated_at: chrono_now(),
            skills_dir: dir.display().to_string(),
            skills: vec![],
        });
    }

    let mut dir_names: Vec<String> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_dir() {
            if let Some(n) = entry.file_name().to_str() {
                dir_names.push(n.to_string());
            }
        }
    }

    let usage = count_usage(&dir_names);

    let mut skills: Vec<Skill> = Vec::new();
    for d in &dir_names {
        let skill_md = dir.join(d).join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        let text = match fs::read_to_string(&skill_md) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let (meta, body) = parse_frontmatter(&text);
        let name = meta.get("name").cloned().unwrap_or_else(|| d.clone());
        let description = meta
            .get("description")
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_default();
        let triggers = extract_triggers(&description);
        skills.push(Skill {
            name,
            dir: d.clone(),
            description,
            triggers,
            body,
            usage_count: usage.get(d).copied().unwrap_or(0),
            bytes: text.len() as u64,
        });
    }

    skills.sort_by(|a, b| {
        b.usage_count
            .cmp(&a.usage_count)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(ScanResult {
        generated_at: chrono_now(),
        skills_dir: dir.display().to_string(),
        skills,
    })
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // very simple ISO-ish formatting via secs since epoch -> just return seconds string;
    // good enough for "data freshness" display.
    format!("@{}", secs)
}
