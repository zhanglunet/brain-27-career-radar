CREATE TABLE `intelligence_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `period_type` text NOT NULL,
  `period_start` text NOT NULL,
  `period_end` text NOT NULL,
  `new_opportunities` integer DEFAULT 0 NOT NULL,
  `new_sources` integer DEFAULT 0 NOT NULL,
  `new_papers` integer DEFAULT 0 NOT NULL,
  `source_changes` integer DEFAULT 0 NOT NULL,
  `source_failures` integer DEFAULT 0 NOT NULL,
  `source_runs` integer DEFAULT 0 NOT NULL,
  `academic_runs` integer DEFAULT 0 NOT NULL,
  `summary` text NOT NULL,
  `highlights_json` text DEFAULT '{"opportunities":[],"sources":[],"papers":[]}' NOT NULL,
  `generated_at` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intelligence_reports_period_unique` ON `intelligence_reports` (`period_type`,`period_start`);
--> statement-breakpoint
CREATE INDEX `intelligence_reports_history_idx` ON `intelligence_reports` (`period_type`,`period_start`);
--> statement-breakpoint
INSERT OR IGNORE INTO `intelligence_reports`
(`id`,`period_type`,`period_start`,`period_end`,`new_opportunities`,`new_sources`,`new_papers`,`source_changes`,`source_failures`,`source_runs`,`academic_runs`,`summary`,`highlights_json`,`generated_at`)
WITH `dates` AS (
  SELECT date(`created_at`) `day` FROM `opportunities`
  UNION SELECT date(`created_at`) FROM `sources`
  UNION SELECT date(`created_at`) FROM `papers`
  UNION SELECT date(`started_at`) FROM `sync_runs`
  UNION SELECT date(`started_at`) FROM `academic_sync_runs`
), `daily` AS (
  SELECT `day`,
    (SELECT COUNT(*) FROM `opportunities` WHERE `published`=1 AND date(`created_at`)=`day`) `new_opportunities`,
    (SELECT COUNT(*) FROM `sources` WHERE date(`created_at`)=`day`) `new_sources`,
    (SELECT COUNT(*) FROM `papers` WHERE date(`created_at`)=`day`) `new_papers`,
    (SELECT COUNT(*) FROM `source_check_logs` WHERE `changed`=1 AND date(`checked_at`)=`day`) `source_changes`,
    (SELECT COUNT(*) FROM `source_check_logs` WHERE `ok`=0 AND date(`checked_at`)=`day`) `source_failures`,
    (SELECT COUNT(*) FROM `sync_runs` WHERE date(`started_at`)=`day`) `source_runs`,
    (SELECT COUNT(*) FROM `academic_sync_runs` WHERE date(`started_at`)=`day`) `academic_runs`
  FROM `dates` WHERE `day` IS NOT NULL
)
SELECT 'daily:'||`day`,'daily',`day`,`day`,`new_opportunities`,`new_sources`,`new_papers`,`source_changes`,`source_failures`,`source_runs`,`academic_runs`,
  '日报：新增机会 '||`new_opportunities`||' 个、信息源 '||`new_sources`||' 个、论文 '||`new_papers`||' 篇；完成来源巡检 '||`source_runs`||' 轮、论文同步 '||`academic_runs`||' 轮，发现 '||`source_changes`||' 个来源变化，'||`source_failures`||' 次来源检查失败。',
  '{"opportunities":[],"sources":[],"papers":[]}',CURRENT_TIMESTAMP FROM `daily`;
--> statement-breakpoint
INSERT OR IGNORE INTO `intelligence_reports`
(`id`,`period_type`,`period_start`,`period_end`,`new_opportunities`,`new_sources`,`new_papers`,`source_changes`,`source_failures`,`source_runs`,`academic_runs`,`summary`,`highlights_json`,`generated_at`)
WITH `weekly` AS (
  SELECT date(`period_start`,printf('-%d days',(CAST(strftime('%w',`period_start`) AS integer)+6)%7)) `week_start`,
    SUM(`new_opportunities`) `new_opportunities`,SUM(`new_sources`) `new_sources`,SUM(`new_papers`) `new_papers`,SUM(`source_changes`) `source_changes`,SUM(`source_failures`) `source_failures`,SUM(`source_runs`) `source_runs`,SUM(`academic_runs`) `academic_runs`
  FROM `intelligence_reports` WHERE `period_type`='daily' GROUP BY `week_start`
)
SELECT 'weekly:'||`week_start`,'weekly',`week_start`,date(`week_start`,'+6 days'),`new_opportunities`,`new_sources`,`new_papers`,`source_changes`,`source_failures`,`source_runs`,`academic_runs`,
  '周报：新增机会 '||`new_opportunities`||' 个、信息源 '||`new_sources`||' 个、论文 '||`new_papers`||' 篇；完成来源巡检 '||`source_runs`||' 轮、论文同步 '||`academic_runs`||' 轮，发现 '||`source_changes`||' 个来源变化，'||`source_failures`||' 次来源检查失败。',
  '{"opportunities":[],"sources":[],"papers":[]}',CURRENT_TIMESTAMP FROM `weekly`;
--> statement-breakpoint
INSERT OR IGNORE INTO `intelligence_reports`
(`id`,`period_type`,`period_start`,`period_end`,`new_opportunities`,`new_sources`,`new_papers`,`source_changes`,`source_failures`,`source_runs`,`academic_runs`,`summary`,`highlights_json`,`generated_at`)
WITH `monthly` AS (
  SELECT substr(`period_start`,1,7)||'-01' `month_start`,SUM(`new_opportunities`) `new_opportunities`,SUM(`new_sources`) `new_sources`,SUM(`new_papers`) `new_papers`,SUM(`source_changes`) `source_changes`,SUM(`source_failures`) `source_failures`,SUM(`source_runs`) `source_runs`,SUM(`academic_runs`) `academic_runs`
  FROM `intelligence_reports` WHERE `period_type`='daily' GROUP BY `month_start`
)
SELECT 'monthly:'||`month_start`,'monthly',`month_start`,date(`month_start`,'+1 month','-1 day'),`new_opportunities`,`new_sources`,`new_papers`,`source_changes`,`source_failures`,`source_runs`,`academic_runs`,
  '月报：新增机会 '||`new_opportunities`||' 个、信息源 '||`new_sources`||' 个、论文 '||`new_papers`||' 篇；完成来源巡检 '||`source_runs`||' 轮、论文同步 '||`academic_runs`||' 轮，发现 '||`source_changes`||' 个来源变化，'||`source_failures`||' 次来源检查失败。',
  '{"opportunities":[],"sources":[],"papers":[]}',CURRENT_TIMESTAMP FROM `monthly`;
