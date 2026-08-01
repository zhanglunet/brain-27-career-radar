ALTER TABLE `opportunities` ADD `funding_type` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `funding_details` text DEFAULT '资助情况待官方确认' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `funding_verified_at` text;
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'mixed',
    `funding_details` = '最多 4 个 studentship，含三年生活津贴与英国本土学费；国际生须确认海外学费差额。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'oxford-ocemr-2027-dphil';
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'mixed',
    `funding_details` = '符合早期截止的申请会进入 Clarendon、学院及研究委员会等多种全奖/部分奖评选，具体覆盖因奖项而异。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'oxford-experimental-psych-2027';
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'full',
    `funding_details` = 'Gatsby studentship 覆盖本土及国际生 UCL 学费、年度免税生活津贴和会议/研讨会差旅预算。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'ucl-gatsby-2027-phd';
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'full',
    `funding_details` = '约 50 个四年全额资助名额，含学费、生活津贴及研究训练支持；海外生名额最多约 30%。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'ucl-uela-2027-studentship';
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'mixed',
    `funding_details` = '项目提供有限数量全额 studentship，并非所有录取者自动获得；具体名额和国际生覆盖待 2027/28 通知。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'ucl-ecological-brain-2027';
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'unknown',
    `funding_details` = '2027/28 资助轮次和覆盖范围尚未在当前课程页公布，需同步查看 studentships 页面和导师项目。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'cambridge-mrc-cbu-2027-phd';
--> statement-breakpoint
UPDATE `opportunities`
SET `funding_type` = 'unknown',
    `funding_details` = '页面给出争取资助的申请截止，但不代表录取即获奖；具体奖项及覆盖范围需随申请确认。',
    `funding_verified_at` = '2026-08-01T00:00:00.000Z'
WHERE `id` = 'ucl-cehp-2027-phd';
