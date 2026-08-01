CREATE TABLE `paper_provider_records` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`external_id` text NOT NULL,
	`source_url` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`metadata_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `paper_providers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_provider_records_external_unique` ON `paper_provider_records` (`provider_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `paper_provider_records_paper_unique` ON `paper_provider_records` (`provider_id`,`paper_id`);--> statement-breakpoint
CREATE INDEX `paper_provider_records_paper_idx` ON `paper_provider_records` (`paper_id`);