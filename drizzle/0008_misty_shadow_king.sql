CREATE TABLE `paper_authors` (
	`paper_id` text NOT NULL,
	`researcher_id` text,
	`author_name` text NOT NULL,
	`author_order` integer DEFAULT 0 NOT NULL,
	`corresponding` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`researcher_id`) REFERENCES `researchers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_authors_order_unique` ON `paper_authors` (`paper_id`,`author_order`);--> statement-breakpoint
CREATE INDEX `paper_authors_researcher_idx` ON `paper_authors` (`researcher_id`,`paper_id`);--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`doi` text,
	`pmid` text,
	`arxiv_id` text,
	`title` text NOT NULL,
	`abstract` text DEFAULT '' NOT NULL,
	`venue` text DEFAULT '' NOT NULL,
	`publication_date` text,
	`paper_type` text DEFAULT 'other' NOT NULL,
	`version_status` text DEFAULT 'published' NOT NULL,
	`open_access_url` text,
	`source_url` text NOT NULL,
	`source_provider` text DEFAULT 'official' NOT NULL,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`takeaway` text DEFAULT '' NOT NULL,
	`relevance_score` integer DEFAULT 0 NOT NULL,
	`review_status` text DEFAULT 'candidate' NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`source_verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `papers_doi_unique` ON `papers` (`doi`);--> statement-breakpoint
CREATE UNIQUE INDEX `papers_pmid_unique` ON `papers` (`pmid`);--> statement-breakpoint
CREATE UNIQUE INDEX `papers_arxiv_unique` ON `papers` (`arxiv_id`);--> statement-breakpoint
CREATE INDEX `papers_published_date_idx` ON `papers` (`published`,`publication_date`);--> statement-breakpoint
CREATE INDEX `papers_review_idx` ON `papers` (`review_status`,`created_at`);--> statement-breakpoint
CREATE TABLE `researcher_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`researcher_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`profile_url` text,
	`verified` integer DEFAULT false NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`researcher_id`) REFERENCES `researchers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `researcher_identities_provider_unique` ON `researcher_identities` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `researcher_identities_researcher_idx` ON `researcher_identities` (`researcher_id`);--> statement-breakpoint
CREATE TABLE `researcher_sources` (
	`researcher_id` text NOT NULL,
	`source_id` text NOT NULL,
	`relation` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`researcher_id`) REFERENCES `researchers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `researcher_sources_relation_unique` ON `researcher_sources` (`researcher_id`,`source_id`,`relation`);--> statement-breakpoint
CREATE INDEX `researcher_sources_source_idx` ON `researcher_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `researchers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_zh` text,
	`institution` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`region` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`profile_url` text NOT NULL,
	`lab_url` text,
	`cv_url` text,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`methods_json` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`application_value` text DEFAULT '' NOT NULL,
	`recruitment_status` text DEFAULT 'unknown' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`source_verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `researchers_slug_unique` ON `researchers` (`slug`);--> statement-breakpoint
CREATE INDEX `researchers_region_idx` ON `researchers` (`region`,`priority`);--> statement-breakpoint
CREATE INDEX `researchers_published_idx` ON `researchers` (`published`,`priority`);