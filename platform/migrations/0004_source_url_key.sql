-- 目标来源按原始网址保存与抓取；规范化结果另存为 url_key，只用于去重。
ALTER TABLE goal_sources ADD COLUMN url_key TEXT;
UPDATE goal_sources SET url_key = url WHERE url_key IS NULL;
CREATE UNIQUE INDEX goal_sources_user_goal_url_key ON goal_sources (user_id, goal_id, url_key);
