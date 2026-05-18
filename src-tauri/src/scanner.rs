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
    pub disabled: bool,
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

fn disabled_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("skills.disabled"))
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
        || name.contains('\0')
    {
        return Err(format!("invalid skill name: {}", name));
    }
    Ok(())
}

#[tauri::command]
pub fn disable_skill(dir_name: String) -> Result<(), String> {
    validate_name(&dir_name)?;
    let src = skills_dir().ok_or("HOME not set")?.join(&dir_name);
    if !src.exists() && !src.is_symlink() {
        return Err(format!("skill not found: {}", dir_name));
    }
    let disabled = disabled_dir().ok_or("HOME not set")?;
    fs::create_dir_all(&disabled).map_err(|e| e.to_string())?;
    let mut dst = disabled.join(&dir_name);
    if dst.exists() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        dst = disabled.join(format!("{} {}", dir_name, stamp));
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn enable_skill(dir_name: String) -> Result<(), String> {
    validate_name(&dir_name)?;
    let src = disabled_dir().ok_or("HOME not set")?.join(&dir_name);
    if !src.exists() && !src.is_symlink() {
        return Err(format!("disabled skill not found: {}", dir_name));
    }
    let active = skills_dir().ok_or("HOME not set")?;
    fs::create_dir_all(&active).map_err(|e| e.to_string())?;
    let dst = active.join(&dir_name);
    if dst.exists() || dst.is_symlink() {
        return Err(format!(
            "an active skill named '{}' already exists; rename or remove it first",
            dir_name
        ));
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(())
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
    // Move the entry into ~/.Trash/ ourselves. Avoids the trash crate's
    // AppleScript path which stalls on large folders (Finder AppleEvent
    // -1712). On collision, append a timestamp.
    let trash_dir = home_dir().ok_or("HOME not set")?.join(".Trash");
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    let mut dest = trash_dir.join(&dir_name);
    if dest.exists() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        dest = trash_dir.join(format!("{} {}", dir_name, stamp));
    }
    fs::rename(&target, &dest).map_err(|e| e.to_string())?;
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

fn list_dirs(parent: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(n) = entry.file_name().to_str() {
                    names.push(n.to_string());
                }
            }
        }
    }
    names
}

fn build_skill(parent: &Path, dir_name: &str, usage: u64, disabled: bool) -> Option<Skill> {
    let skill_md = parent.join(dir_name).join("SKILL.md");
    if !skill_md.exists() {
        return None;
    }
    let text = fs::read_to_string(&skill_md).ok()?;
    let (meta, body) = parse_frontmatter(&text);
    let name = meta.get("name").cloned().unwrap_or_else(|| dir_name.to_string());
    let description = meta
        .get("description")
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    let triggers = extract_triggers(&description);
    Some(Skill {
        name,
        dir: dir_name.to_string(),
        description,
        triggers,
        body,
        usage_count: usage,
        bytes: text.len() as u64,
        disabled,
    })
}

#[tauri::command]
pub fn scan_skills() -> Result<ScanResult, String> {
    let active_dir = skills_dir().ok_or("HOME env not set")?;
    let dis_dir = disabled_dir().ok_or("HOME env not set")?;

    let active_names = list_dirs(&active_dir);
    let disabled_names = list_dirs(&dis_dir);

    // Count usage for both active + disabled (so disabling doesn't lose stats).
    let mut all_names: Vec<String> = active_names.iter().chain(disabled_names.iter()).cloned().collect();
    all_names.sort();
    all_names.dedup();
    let usage = count_usage(&all_names);

    let mut skills: Vec<Skill> = Vec::new();
    for d in &active_names {
        if let Some(s) = build_skill(&active_dir, d, usage.get(d).copied().unwrap_or(0), false) {
            skills.push(s);
        }
    }
    for d in &disabled_names {
        if let Some(s) = build_skill(&dis_dir, d, usage.get(d).copied().unwrap_or(0), true) {
            skills.push(s);
        }
    }

    skills.sort_by(|a, b| {
        a.disabled
            .cmp(&b.disabled) // active first
            .then_with(|| b.usage_count.cmp(&a.usage_count))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(ScanResult {
        generated_at: chrono_now(),
        skills_dir: active_dir.display().to_string(),
        skills,
    })
}

// ---------- backup / restore ----------

#[derive(Serialize)]
pub struct BackupResult {
    pub path: String,
    pub bytes: u64,
    pub items: Vec<String>,
}

const BACKUP_ITEMS: &[&str] = &[
    "skills",
    "skills.disabled",
    "commands",
    "settings.json",
    "settings.local.json",
    "CLAUDE.md",
];

fn run_tar(args: &[&str]) -> Result<(), String> {
    use std::process::Command;
    let out = Command::new("tar")
        .args(args)
        .output()
        .map_err(|e| format!("tar spawn failed: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "tar exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn backup_config() -> Result<BackupResult, String> {
    let home = home_dir().ok_or("HOME not set")?;
    let claude = home.join(".claude");
    if !claude.exists() {
        return Err("~/.claude not found".to_string());
    }
    let docs = home.join("Documents");
    fs::create_dir_all(&docs).map_err(|e| e.to_string())?;

    use std::time::{SystemTime, UNIX_EPOCH};
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let archive = docs.join(format!("Weft-backup-{}.tar.gz", stamp));

    let mut items = Vec::new();
    let mut tar_args: Vec<String> = vec![
        "czf".to_string(),
        archive.to_string_lossy().to_string(),
        "-C".to_string(),
        claude.to_string_lossy().to_string(),
    ];
    for item in BACKUP_ITEMS {
        if claude.join(item).exists() {
            tar_args.push(item.to_string());
            items.push(item.to_string());
        }
    }
    if items.is_empty() {
        return Err("nothing to back up".to_string());
    }
    run_tar(&tar_args.iter().map(|s| s.as_str()).collect::<Vec<_>>())?;
    let meta = fs::metadata(&archive).map_err(|e| e.to_string())?;
    Ok(BackupResult {
        path: archive.to_string_lossy().to_string(),
        bytes: meta.len(),
        items,
    })
}

#[derive(Serialize)]
pub struct RestoreResult {
    pub restored: Vec<String>,
    pub conflicts_renamed: Vec<String>,
}

#[tauri::command]
pub fn restore_config(archive_path: String) -> Result<RestoreResult, String> {
    let archive = PathBuf::from(&archive_path);
    if !archive.exists() {
        return Err(format!("archive not found: {}", archive_path));
    }
    let home = home_dir().ok_or("HOME not set")?;
    let claude = home.join(".claude");
    fs::create_dir_all(&claude).map_err(|e| e.to_string())?;

    use std::time::{SystemTime, UNIX_EPOCH};
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut conflicts_renamed = Vec::new();
    for item in BACKUP_ITEMS {
        let cur = claude.join(item);
        if cur.exists() {
            let backup_name = format!("{}.before-restore.{}", item, stamp);
            let backup_path = claude.join(&backup_name);
            fs::rename(&cur, &backup_path).map_err(|e| e.to_string())?;
            conflicts_renamed.push(backup_name);
        }
    }

    run_tar(&[
        "xzf",
        archive.to_string_lossy().as_ref(),
        "-C",
        claude.to_string_lossy().as_ref(),
    ])?;

    let mut restored = Vec::new();
    for item in BACKUP_ITEMS {
        if claude.join(item).exists() {
            restored.push(item.to_string());
        }
    }
    Ok(RestoreResult {
        restored,
        conflicts_renamed,
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
