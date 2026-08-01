ALTER TABLE `opportunities` ADD `deadline_at` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `opens_at` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `deadline_timezone` text DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `deadline_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `next_action_at` text;--> statement-breakpoint
UPDATE `opportunities` SET `deadline_at`='2026-08-09T23:59:00',`deadline_timezone`='Asia/Hong_Kong',`deadline_status`='confirmed' WHERE `id`='hku-psych-ra-536755-opportunity';--> statement-breakpoint
UPDATE `opportunities` SET `deadline_at`='2026-08-31T23:59:00',`deadline_timezone`='Asia/Hong_Kong',`deadline_status`='confirmed' WHERE `id`='hku-psycho-oncology-ra-536719-opportunity';--> statement-breakpoint
UPDATE `opportunities` SET `deadline_at`='2026-09-15T23:59:00',`deadline_timezone`='Asia/Shanghai',`deadline_status`='confirmed' WHERE `id`='fudan-brain-technology-ra';--> statement-breakpoint
UPDATE `opportunities` SET `deadline_at`='2026-09-14T12:00:00',`deadline_timezone`='Europe/London',`deadline_status`='confirmed' WHERE `id`='oxford-ocemr-2027-dphil';--> statement-breakpoint
UPDATE `opportunities` SET `opens_at`='2026-09-15T09:00:00',`deadline_at`='2026-11-09T17:00:00',`deadline_timezone`='Europe/London',`deadline_status`='confirmed' WHERE `id`='ucl-gatsby-2027-phd';--> statement-breakpoint
UPDATE `opportunities` SET `deadline_at`='2026-09-12T23:59:00',`deadline_timezone`='Asia/Shanghai',`deadline_status`='estimated' WHERE `id`='brainco-2027-campus';--> statement-breakpoint
UPDATE `opportunities` SET `opens_at`='2026-11-01T00:00:00',`deadline_at`='2026-11-30T23:59:00',`deadline_timezone`='Asia/Shanghai',`deadline_status`='estimated' WHERE `id`='tsinghua-pcs-2027-phd';--> statement-breakpoint
UPDATE `opportunities` SET `deadline_at`='2027-01-05T16:00:00',`deadline_timezone`='Europe/London',`deadline_status`='confirmed' WHERE `id`='ucl-cehp-2027-phd';--> statement-breakpoint
UPDATE `opportunities` SET `opens_at`='2026-10-01T09:00:00',`deadline_status`='estimated' WHERE `id` IN ('cibr-2027-phd','ucl-uela-2027-studentship','ucl-ecological-brain-2027');--> statement-breakpoint
UPDATE `opportunities` SET `deadline_status`='rolling' WHERE `id` IN (
  'oxford-research-assistant-watch','cambridge-research-assistant-watch','ucl-research-assistant-watch',
  'tsinghua-yao-neuro-ra','pku-aaib-brain-ra','siat-brain-cognition-ra','baai-2027-joint-phd',
  'pku-fang-bci-ra-2026','tsinghua-cbicr-intern-watch','bnu-brain-opportunities-watch',
  'cas-psych-jiang-ra-2026','bit-bci-intern-phd-watch','ccmu-brain-ra-watch'
);--> statement-breakpoint
UPDATE `opportunities` SET `deadline_status`='unknown' WHERE `deadline_at` IS NULL AND `deadline_status` NOT IN ('rolling','estimated');
