CREATE TABLE `organization_discovery_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`region` text NOT NULL,
	`candidate_type` text DEFAULT 'mixed' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`check_interval_hours` integer DEFAULT 24 NOT NULL,
	`last_checked_at` text,
	`last_success_at` text,
	`last_status_code` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_discovery_feeds_url_unique` ON `organization_discovery_feeds` (`url`);
--> statement-breakpoint
CREATE INDEX `organization_discovery_feeds_enabled_idx` ON `organization_discovery_feeds` (`enabled`,`last_checked_at`);
--> statement-breakpoint
CREATE TABLE `organization_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`name` text NOT NULL,
	`candidate_url` text NOT NULL,
	`canonical_host` text NOT NULL,
	`candidate_type` text DEFAULT 'mixed' NOT NULL,
	`region` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`confidence` integer DEFAULT 60 NOT NULL,
	`evidence_excerpt` text DEFAULT '' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `organization_discovery_feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_candidates_url_unique` ON `organization_candidates` (`candidate_url`);
--> statement-breakpoint
CREATE INDEX `organization_candidates_status_idx` ON `organization_candidates` (`status`,`last_seen_at`);
--> statement-breakpoint
CREATE INDEX `organization_candidates_feed_idx` ON `organization_candidates` (`feed_id`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE `organization_discovery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`feeds_checked` integer DEFAULT 0 NOT NULL,
	`candidates_found` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_discovery_runs_started_idx` ON `organization_discovery_runs` (`started_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO organization_discovery_feeds
(id,name,url,region,candidate_type,enabled,check_interval_hours) VALUES
('ukri-centres','UKRI Centres, Institutes, Catapults and Units','https://www.ukri.org/publications/centres-institutes-catapults-and-units/','英国','research',1,24),
('ukri-mrc-centres','UKRI MRC Institutes, Units and Centres','https://www.ukri.org/who-we-are/mrc/institutes-units-and-centres/list/','英国','research',1,24),
('ukri-eligible-organisations','UKRI Eligible Research Organisations','https://www.ukri.org/publications/organisation-eligibility/research-organisations-eligible-for-ukri-funding/','英国','research',1,72),
('cas-organisations','中国科学院院属机构','https://www.cas.cn/zz/','中国','research',1,24),
('cas-institutes-en','Chinese Academy of Sciences Institutes','https://english.cas.cn/research/institutes/','中国','research',1,72);
--> statement-breakpoint
UPDATE sources
SET adapter_key='career-listing', discovery_enabled=1, auto_merge_low_risk=0, updated_at=CURRENT_TIMESTAMP
WHERE enabled=1 AND source_type='listing' AND coverage IN ('campus','mixed')
  AND organization_type IN ('company','research','university');
--> statement-breakpoint
PRAGMA optimize;
