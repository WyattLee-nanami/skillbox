export type Skill = {
  name: string;
  dir: string;
  description: string;
  triggers: string[];
  body: string;
  usageCount: number;
  bytes: number;
  disabled: boolean;
};

export type ScanResult = {
  generatedAt: string;
  skillsDir: string;
  skills: Skill[];
};

export type DailyBucket = {
  date: string;
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
  total: number;
  messages: number;
};

export type ModelTotal = {
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
  total: number;
  messages: number;
};

export type UsageStats = {
  total_tokens: number;
  total_messages: number;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  window_days: number;
  generated_at: string;
  daily: DailyBucket[];
  by_model: ModelTotal[];
};

export type ProjectInfo = {
  id: string;
  label: string;
  session_count: number;
  last_modified: number;
};

export type SessionInfo = {
  project_id: string;
  session_id: string;
  bytes: number;
  last_modified: number;
  message_count: number;
  first_user_text: string;
};

export type HistoryMessage = {
  type: string;
  role: string;
  timestamp: string;
  model: string;
  text: string;
  tool_name: string;
  tool_input: string;
  tool_output: string;
  raw_kind: string;
};

export type SearchHit = {
  project_id: string;
  session_id: string;
  line_index: number;
  timestamp: string;
  role: string;
  snippet: string;
};

export type BackupResult = { path: string; bytes: number; items: string[] };
export type RestoreResult = { restored: string[]; conflictsRenamed: string[] };
