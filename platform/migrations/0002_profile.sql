-- 私有平台阶段 1b-1：简历、档案、草稿与大模型额度。时间列为 Unix 毫秒整数。

CREATE TABLE resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  text_chars INTEGER,
  uploaded_at INTEGER NOT NULL
);
CREATE INDEX resumes_user_id ON resumes (user_id);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  data_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  confirmed_at INTEGER NOT NULL
);

CREATE TABLE profile_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  version INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL
);
CREATE INDEX profile_versions_user_version ON profile_versions (user_id, version);

CREATE TABLE profile_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  goal_id TEXT,
  profile_json TEXT NOT NULL,
  target_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('resume', 'intent', 'both')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'discarded')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX profile_drafts_user_id ON profile_drafts (user_id);

CREATE TABLE llm_usage (
  user_id TEXT NOT NULL REFERENCES users (id),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE goals ADD COLUMN target_json TEXT;
