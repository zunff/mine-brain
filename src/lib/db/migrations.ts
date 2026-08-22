/**
 * 全部表结构的唯一事实来源。只追加新迁移，绝不修改已应用的迁移。
 *
 * 设计要点（见 .claude/rules/conventions.md 记忆数据铁律）：
 * - entries 是不可变原始摄取；memories 是结构化记忆，必须能溯源到 entry。
 * - 信念变更永不 UPDATE 覆盖语义：旧行置 superseded + valid_to，新行经
 *   memory_links(rel='supersedes'/'contradicts') 关联。
 * - 删除一律软删（deleted_at）。
 */
export interface Migration {
  id: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '新对话',
  summary TEXT,
  consolidated_upto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  reasoning TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chat','journal','voice','import','onboarding')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('profile','value','claim','decision','question','insight','pattern')),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','rejected','archived')),
  importance REAL NOT NULL DEFAULT 0.5,
  theme TEXT,
  sentiment REAL,
  valid_from TEXT,
  valid_to TEXT,
  source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memories_type_status ON memories(type, status);
CREATE INDEX IF NOT EXISTS idx_memories_theme ON memories(theme);

CREATE TABLE IF NOT EXISTS memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  rel TEXT NOT NULL CHECK(rel IN ('supports','contradicts','supersedes','causes','instance_of','related_to','during')),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(from_id, to_id, rel)
);
CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON memory_links(to_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, tag_id)
);
`,
  },
  {
    id: 2,
    sql: `
ALTER TABLE messages ADD COLUMN images TEXT;
`,
  },
];
