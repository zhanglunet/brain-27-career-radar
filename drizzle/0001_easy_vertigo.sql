CREATE TABLE `institutions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`name` text NOT NULL,
	`mark` text NOT NULL,
	`summary` text NOT NULL,
	`note` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`source_verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `institutions_published_idx` ON `institutions` (`published`,`sort_order`);--> statement-breakpoint
CREATE INDEX `institutions_source_idx` ON `institutions` (`source_id`);