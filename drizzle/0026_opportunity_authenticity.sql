-- PRD-176/T2（trend #881）：机会真实性三态列（T1 §2.1 三列 + 索引）。
-- unverified 单列第五态：存量机会无复核记录，并入 pending 会把"未复核"
-- 冒充成"复核中"（T1 §2.1 拍板 #1：单列）。三态结论值域 trusted/pending/suspicious
-- 存 authenticity_state，结构化结论存 authenticity_json（自包含，冗余主列）。
--> statement-breakpoint
ALTER TABLE opportunities ADD COLUMN authenticity_state TEXT NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
ALTER TABLE opportunities ADD COLUMN authenticity_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE opportunities ADD COLUMN authenticity_checked_at TEXT;
--> statement-breakpoint
CREATE INDEX opportunities_authenticity_idx ON opportunities (published, authenticity_state);
