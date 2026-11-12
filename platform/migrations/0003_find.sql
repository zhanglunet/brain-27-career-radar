-- 私有平台阶段 1b-2：多来源找机会。时间列为 Unix 毫秒整数。
-- goal_sources / find_runs / user_opportunities 按用户隔离；
-- page_cache / robots_cache / platform_sources / source_nominations 是平台级表，只存公开内容，不含用户身份。

CREATE TABLE goal_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  goal_id TEXT NOT NULL REFERENCES goals (id),
  url TEXT NOT NULL,
  org TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('L2', 'L3', 'L4')),
  origin TEXT NOT NULL CHECK (origin IN ('search', 'user')),
  nominated_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, goal_id, url)
);

CREATE TABLE find_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  goal_id TEXT NOT NULL REFERENCES goals (id),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'daily')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  stats_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX find_runs_user_goal_created ON find_runs (user_id, goal_id, created_at);

CREATE TABLE user_opportunities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  goal_id TEXT NOT NULL REFERENCES goals (id),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  org TEXT,
  url TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('L1', 'L2', 'L3', 'L4')),
  sources_json TEXT NOT NULL DEFAULT '[]',
  location TEXT,
  kind TEXT,
  deadline_status TEXT NOT NULL CHECK (deadline_status IN ('date', 'rolling', 'unknown', 'closed')),
  deadline_date TEXT,
  requirements_json TEXT NOT NULL DEFAULT '[]',
  assessment_json TEXT,
  score INTEGER,
  mark TEXT NOT NULL DEFAULT 'new' CHECK (mark IN ('new', 'interested', 'dismissed', 'done')),
  risk TEXT,
  first_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, goal_id, key)
);

CREATE TABLE page_cache (
  url TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  final_url TEXT,
  title TEXT,
  text TEXT,
  links_json TEXT NOT NULL DEFAULT '[]',
  flagged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE robots_cache (
  host TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  rules_json TEXT NOT NULL
);

CREATE TABLE platform_sources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  org TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE source_nominations (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  org TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

ALTER TABLE llm_usage ADD COLUMN searches INTEGER NOT NULL DEFAULT 0;
