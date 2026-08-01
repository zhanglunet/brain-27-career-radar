CREATE TABLE `candidate_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text,
	`canonical_url` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`org` text NOT NULL,
	`kind` text,
	`location` text,
	`deadline` text,
	`opportunity_status` text,
	`extracted_json` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'observed' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_records_dedupe_unique` ON `candidate_records` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `candidate_records_source_idx` ON `candidate_records` (`source_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `candidate_records_state_idx` ON `candidate_records` (`state`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `change_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`opportunity_id` text,
	`run_id` text,
	`risk_level` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`patch_json` text NOT NULL,
	`patch_hash` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_sets_patch_unique` ON `change_sets` (`candidate_id`,`patch_hash`);--> statement-breakpoint
CREATE INDEX `change_sets_status_idx` ON `change_sets` (`status`,`risk_level`,`created_at`);--> statement-breakpoint
CREATE TABLE `field_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`snapshot_id` text,
	`field_name` text NOT NULL,
	`field_value` text NOT NULL,
	`excerpt` text NOT NULL,
	`extractor` text NOT NULL,
	`confidence` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `source_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_evidence_value_unique` ON `field_evidence` (`candidate_id`,`snapshot_id`,`field_name`,`field_value`);--> statement-breakpoint
CREATE INDEX `field_evidence_candidate_idx` ON `field_evidence` (`candidate_id`,`field_name`);--> statement-breakpoint
ALTER TABLE `sources` ADD `adapter_key` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `discovery_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `auto_merge_low_risk` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `sources`
SET `adapter_key` = 'oppo-job-detail',
    `discovery_enabled` = 1
WHERE `id` IN ('oppo-health-ml', 'oppo-health-algorithm');
--> statement-breakpoint
UPDATE `sources`
SET `adapter_key` = 'academic-detail',
    `discovery_enabled` = 1
WHERE `id` = 'tsinghua-pcs';
--> statement-breakpoint
UPDATE `sources`
SET `adapter_key` = 'career-listing',
    `discovery_enabled` = 1
WHERE `id` IN ('shlab-jobs', 'brainco-recruit');
