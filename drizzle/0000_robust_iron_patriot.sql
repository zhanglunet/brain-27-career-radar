CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`name` text NOT NULL,
	`org` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`fit` text NOT NULL,
	`location` text NOT NULL,
	`deadline` text NOT NULL,
	`why` text NOT NULL,
	`action` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`url` text NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`source_verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `opportunities_published_idx` ON `opportunities` (`published`);--> statement-breakpoint
CREATE INDEX `opportunities_source_idx` ON `opportunities` (`source_id`);--> statement-breakpoint
CREATE TABLE `review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`run_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_queue_status_idx` ON `review_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`run_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`final_url` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_source_idx` ON `source_snapshots` (`source_id`,`captured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_source_hash_unique` ON `source_snapshots` (`source_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`url` text NOT NULL,
	`trust_level` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`check_interval_hours` integer DEFAULT 24 NOT NULL,
	`etag` text,
	`last_modified` text,
	`content_hash` text,
	`final_url` text,
	`last_status_code` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_checked_at` text,
	`last_success_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_url_unique` ON `sources` (`url`);--> statement-breakpoint
CREATE INDEX `sources_enabled_idx` ON `sources` (`enabled`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`checked_count` integer DEFAULT 0 NOT NULL,
	`changed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
