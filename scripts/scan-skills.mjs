#!/usr/bin/env node
// Scan ~/.claude/skills/*/SKILL.md and emit src/skills.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SKILLS_DIR = process.env.SKILLS_DIR || join(homedir(), '.claude', 'skills');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const OUT = join(import.meta.dirname, '..', 'src', 'skills.json');

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: text };
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).trim();
  const meta = {};
  let key = null;
  let buf = [];
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (m && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (key) meta[key] = buf.join('\n').trim();
      key = m[1];
      buf = m[2] === '|' || m[2] === '>' ? [] : [m[2]];
    } else if (key) {
      buf.push(line.replace(/^\s+/, ''));
    }
  }
  if (key) meta[key] = buf.join('\n').trim();
  return { meta, body };
}

function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((d) => {
      const p = join(SKILLS_DIR, d);
      try { return statSync(p).isDirectory(); } catch { return false; }
    });
}

function countUsage(skillNames) {
  const counts = Object.fromEntries(skillNames.map((n) => [n, 0]));
  if (!existsSync(PROJECTS_DIR)) return counts;
  const walk = (dir) => {
    for (const ent of readdirSync(dir)) {
      const p = join(dir, ent);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (ent.endsWith('.jsonl')) {
        let txt;
        try { txt = readFileSync(p, 'utf-8'); } catch { continue; }
        for (const name of skillNames) {
          const re = new RegExp(`/${name}\\b|"skill"\\s*:\\s*"${name}"`, 'g');
          const m = txt.match(re);
          if (m) counts[name] += m.length;
        }
      }
    }
  };
  try { walk(PROJECTS_DIR); } catch {}
  return counts;
}

function main() {
  const dirs = listSkills();
  const usage = countUsage(dirs);
  const skills = [];
  for (const dir of dirs) {
    const skillFile = join(SKILLS_DIR, dir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    let text;
    try { text = readFileSync(skillFile, 'utf-8'); } catch { continue; }
    const { meta, body } = parseFrontmatter(text);
    const name = meta.name || dir;
    const description = (meta.description || '').replace(/\s+/g, ' ').trim();
    const triggers = (description.match(/[「『"]([^」』"]{2,12})[」』"]/g) || [])
      .map((s) => s.slice(1, -1));
    skills.push({
      name,
      dir,
      description,
      triggers,
      body,
      usageCount: usage[dir] || 0,
      hasReadme: existsSync(join(SKILLS_DIR, dir, 'README.md')),
      bytes: text.length,
    });
  }
  skills.sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
  mkdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), skills }, null, 2));
  console.log(`scanned ${skills.length} skills → ${OUT}`);
  console.log(`top 5 by usage: ${skills.slice(0, 5).map((s) => `${s.name}(${s.usageCount})`).join(', ')}`);
}

main();
