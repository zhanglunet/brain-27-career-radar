CREATE TABLE `policy_feeds` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `authority` text NOT NULL, `region` text NOT NULL,
  `url` text NOT NULL, `enabled` integer DEFAULT 1 NOT NULL, `check_interval_hours` integer DEFAULT 24 NOT NULL,
  `last_checked_at` text, `last_success_at` text, `last_status_code` integer, `consecutive_failures` integer DEFAULT 0 NOT NULL,
  `last_error` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_feeds_url_unique` ON `policy_feeds` (`url`);
--> statement-breakpoint
CREATE INDEX `policy_feeds_enabled_idx` ON `policy_feeds` (`enabled`,`last_checked_at`);
--> statement-breakpoint
CREATE TABLE `research_policies` (
  `id` text PRIMARY KEY NOT NULL, `feed_id` text, `title` text NOT NULL, `title_en` text, `authority` text NOT NULL,
  `region` text NOT NULL, `policy_type` text NOT NULL, `status` text DEFAULT 'watch' NOT NULL, `published_at` text,
  `effective_at` text, `deadline_at` text, `deadline_timezone` text DEFAULT 'UTC' NOT NULL, `summary` text NOT NULL,
  `impact` text DEFAULT '' NOT NULL, `audience_json` text DEFAULT '[]' NOT NULL, `topics_json` text DEFAULT '[]' NOT NULL,
  `source_url` text NOT NULL, `content_hash` text, `review_status` text DEFAULT 'candidate' NOT NULL,
  `published` integer DEFAULT 0 NOT NULL, `source_verified_at` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`feed_id`) REFERENCES `policy_feeds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_policies_url_unique` ON `research_policies` (`source_url`);
--> statement-breakpoint
CREATE INDEX `research_policies_public_idx` ON `research_policies` (`published`,`region`,`status`);
--> statement-breakpoint
CREATE INDEX `research_policies_deadline_idx` ON `research_policies` (`deadline_at`);
--> statement-breakpoint
CREATE TABLE `policy_versions` (
  `id` text PRIMARY KEY NOT NULL, `policy_id` text NOT NULL, `content_hash` text NOT NULL, `excerpt` text DEFAULT '' NOT NULL,
  `captured_at` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`policy_id`) REFERENCES `research_policies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_versions_hash_unique` ON `policy_versions` (`policy_id`,`content_hash`);
--> statement-breakpoint
CREATE INDEX `policy_versions_policy_idx` ON `policy_versions` (`policy_id`,`captured_at`);
--> statement-breakpoint
CREATE TABLE `policy_candidates` (
  `id` text PRIMARY KEY NOT NULL, `feed_id` text NOT NULL, `title` text NOT NULL, `candidate_url` text NOT NULL,
  `region` text NOT NULL, `policy_type` text DEFAULT 'programme' NOT NULL, `status` text DEFAULT 'candidate' NOT NULL,
  `confidence` integer DEFAULT 60 NOT NULL, `evidence_excerpt` text DEFAULT '' NOT NULL, `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`feed_id`) REFERENCES `policy_feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_candidates_url_unique` ON `policy_candidates` (`candidate_url`);
--> statement-breakpoint
CREATE INDEX `policy_candidates_status_idx` ON `policy_candidates` (`status`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE `policy_sync_runs` (
  `id` text PRIMARY KEY NOT NULL, `trigger` text NOT NULL, `status` text NOT NULL, `started_at` text NOT NULL,
  `finished_at` text, `feeds_checked` integer DEFAULT 0 NOT NULL, `policies_checked` integer DEFAULT 0 NOT NULL,
  `candidates_found` integer DEFAULT 0 NOT NULL, `versions_added` integer DEFAULT 0 NOT NULL, `failed_count` integer DEFAULT 0 NOT NULL,
  `error_summary` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `policy_sync_runs_started_idx` ON `policy_sync_runs` (`started_at`);
--> statement-breakpoint
CREATE TABLE `research_projects` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `name_en` text, `lead_organization` text NOT NULL, `region` text NOT NULL,
  `status` text DEFAULT 'watch' NOT NULL, `start_at` text, `end_at` text, `funding` text DEFAULT '' NOT NULL,
  `summary` text NOT NULL, `opportunity_value` text DEFAULT '' NOT NULL, `topics_json` text DEFAULT '[]' NOT NULL,
  `url` text NOT NULL, `published` integer DEFAULT 1 NOT NULL, `source_verified_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_projects_url_unique` ON `research_projects` (`url`);
--> statement-breakpoint
CREATE INDEX `research_projects_public_idx` ON `research_projects` (`published`,`region`,`status`);
--> statement-breakpoint
CREATE TABLE `research_topics` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `name_en` text, `category` text NOT NULL, `momentum` text DEFAULT 'watch' NOT NULL,
  `summary` text NOT NULL, `evidence` text NOT NULL, `policy_count` integer DEFAULT 0 NOT NULL, `project_count` integer DEFAULT 0 NOT NULL,
  `paper_count` integer DEFAULT 0 NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_topics_name_unique` ON `research_topics` (`name`);
--> statement-breakpoint
ALTER TABLE `intelligence_reports` ADD `new_policies` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `intelligence_reports` ADD `new_projects` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `intelligence_reports` ADD `policy_runs` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO policy_feeds (id,name,authority,region,url,enabled,check_interval_hours) VALUES
('ukri-strategy','UKRI 2026 strategy and budget','UK Research and Innovation','UK','https://www.ukri.org/who-we-are/our-vision-and-strategy/updates-on-our-2026-strategy-and-budget/',1,24),
('ukri-neuroscience','UKRI neurosciences and mental health','Medical Research Council / UKRI','UK','https://www.ukri.org/what-we-do/browse-our-areas-of-investment-and-support/neurosciences-and-mental-health/',1,24),
('eu-horizon-work-programmes','Horizon Europe work programmes','European Commission','EU','https://research-and-innovation.ec.europa.eu/funding/funding-opportunities/funding-programmes-and-open-calls/horizon-europe/horizon-europe-work-programmes_en',1,24),
('eu-eic-2026','EIC 2026 work programme','European Innovation Council','EU','https://eic.ec.europa.eu/eic-funding-opportunities/eic-2026-work-programme_en',1,24),
('nsfc-2026-guide','国家自然科学基金 2026 项目指南','国家自然科学基金委员会','CN','https://www.nsfc.gov.cn/p1/2931/4077/2026nxmzn.html',1,12),
('nsfc-apply','国家自然科学基金申请资助','国家自然科学基金委员会','CN','https://www.nsfc.gov.cn/p1/4201/sqzz.html',1,24),
('rgc-home','香港研究资助局最新资助消息','Research Grants Council','HK','https://www.ugc.edu.hk/eng/rgc/',1,12),
('rgc-funding','香港研究资助局资助机会','Research Grants Council','HK','https://www.ugc.edu.hk/eng/rgc/funding_opport/',1,24);
--> statement-breakpoint
INSERT INTO research_policies
(id,feed_id,title,title_en,authority,region,policy_type,status,published_at,effective_at,deadline_at,deadline_timezone,summary,impact,audience_json,topics_json,source_url,review_status,published,source_verified_at) VALUES
('policy-ukri-2026-strategy','ukri-strategy','UKRI 2026—2030 战略与预算实施','Implementing our 2026 strategy and budget','UK Research and Innovation','UK','strategy','active','2026-06-01','2026-06-01',NULL,'Europe/London','UKRI 新五年战略聚焦推进知识、改善生活与驱动增长，并集中发布 2026 年后预算配置、机会暂停和重新开放信息。','英国科研经费方向和部分资助窗口可能随预算优先级调整；申请者需同时核对各研究委员会的机会状态。','["英国高校研究人员","博士后","研究机构"]','["科研预算","人才资助","研究战略"]','https://www.ukri.org/who-we-are/our-vision-and-strategy/updates-on-our-2026-strategy-and-budget/','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-ukri-neuroscience','ukri-neuroscience','UKRI 神经科学与心理健康持续资助范围','Neurosciences and mental health','Medical Research Council / UKRI','UK','funding','active','2026-04-09','2026-04-09',NULL,'Europe/London','MRC 持续支持认知、系统与行为神经科学、神经技术、精神健康和神经退行性疾病等方向，并提供研究项目和 fellowship 申请路径。','与实验心理学、认知神经、脑机接口高度相关；具体资格和截止日期仍以 Funding Service 的单项机会为准。','["研究人员","博士后","独立研究者"]','["认知神经","神经技术","心理健康","脑健康"]','https://www.ukri.org/what-we-do/browse-our-areas-of-investment-and-support/neurosciences-and-mental-health/','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-eu-horizon-2026-27','eu-horizon-work-programmes','Horizon Europe 2026—2027 工作计划','Horizon Europe Work Programme 2026-2027','European Commission','EU','programme','active','2025-12-11','2026-01-01',NULL,'Europe/Brussels','欧盟 Horizon Europe 2026—2027 工作计划包含 AI in Science 等横向活动，并通过各专题工作计划发布具体 calls。','关注英国或欧盟合作团队时，应核对具体 call 的参与国、联合体和机构资格；工作计划不是单一申请截止日期。','["欧盟及关联国研究机构","国际联合团队"]','["AI in Science","健康研究","国际合作"]','https://research-and-innovation.ec.europa.eu/funding/funding-opportunities/funding-programmes-and-open-calls/horizon-europe/horizon-europe-work-programmes_en','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-eic-2026','eu-eic-2026','EIC 2026 工作计划及修订','EIC Work Programme 2026','European Innovation Council','EU','funding','active','2026-06-17','2026-01-01',NULL,'Europe/Brussels','EIC 2026 工作计划列出 Pathfinder、Transition、Accelerator 等创新资助路径，并在 2026 年 6 月发布当前修订版。','更偏向高风险前沿技术和成果转化；研究团队需根据具体 call 判断是否适合神经技术、AI 或脑机接口项目。','["研究团队","初创企业","技术转化团队"]','["前沿技术","AI","神经技术","成果转化"]','https://eic.ec.europa.eu/eic-funding-opportunities/eic-2026-work-programme_en','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-nsfc-2026-applications','nsfc-apply','2026 年国家自然科学基金申请与结题安排','2026 NSFC application and completion arrangements','国家自然科学基金委员会','CN','funding','closed','2026-01-14','2026-01-15','2026-03-20T16:00:00','Asia/Shanghai','2026 年集中接收覆盖面上、青年、重点、外国学者等项目类型，集中申请于 3 月 20 日 16 时截止，其他专项另行发布指南。','集中期已经结束，但专项、联合基金和国际合作指南仍会继续发布；系统需持续检查后续项目指南。','["中国依托单位科研人员","外国学者"]','["基础研究","青年人才","国际合作"]','https://www.nsfc.gov.cn/p1/3381/2824/99667.html','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-nsfc-original-2026','nsfc-2026-guide','2026 年国家自然科学基金原创探索计划','2026 NSFC Original Exploration Program','国家自然科学基金委员会','CN','funding','active','2026-02-12','2026-02-24',NULL,'Asia/Shanghai','原创探索计划支持非共识、颠覆性和高风险基础研究，设置专家推荐与指南引导两类申请。','适合具有明确原创假设的新理论、新方法和新研究方向；申请资格及窗口应按具体指南逐项核对。','["中国依托单位科研人员"]','["原创研究","高风险研究","基础研究"]','https://www.nsfc.gov.cn/p1/3381/2824/101332.html','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-nsfc-next-ai-2026','nsfc-2026-guide','2026 年“可解释、可通用的下一代人工智能方法”重大研究计划','Explainable and Generalizable Next-generation AI Methods','国家自然科学基金委员会','CN','programme','active','2026-01-28','2026-01-28',NULL,'Asia/Shanghai','国家自然科学基金 2026 项目指南包含“可解释、可通用的下一代人工智能方法”重大研究计划。','与认知推理、可解释 AI 和脑启发智能相关；具体研究方向、申请代码和截止日期以项目指南详情为准。','["中国依托单位科研人员"]','["可解释AI","通用人工智能","脑启发智能"]','https://www.nsfc.gov.cn/p1/2931/4077/2026nxmzn.html','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-rgc-2026-27','rgc-funding','香港研究资助局 2026/27 资助机会','RGC Funding Opportunities 2026/27','Research Grants Council','HK','funding','active','2025-07-18','2025-07-18',NULL,'Asia/Hong_Kong','RGC 持续发布 GRF、ECS、CRF、TRS、AoE、RIF、博士奖学金和多项国际联合研究计划。','香港高校申请通常由校内统一提交；个人需先核对所属大学内部截止时间，往往早于 RGC 官方截止。','["香港高校研究人员","博士申请者","国际合作团队"]','["研究资助","博士奖学金","国际合作"]','https://www.ugc.edu.hk/eng/rgc/funding_opport/','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-rgc-budget-2026-27','rgc-funding','香港研究资助局 2026/27 指示性预算','RGC Indicative Budget 2026/27','Research Grants Council','HK','strategy','active','2026-06-26','2026-07-01',NULL,'Asia/Hong_Kong','RGC 公布 2026/27 各资助计划指示性预算，覆盖 GRF、ECS、协作研究、主题研究、博士奖学金及联合研究计划。','预算反映资助规模但不等于个人申请资格或成功率；应结合具体计划 call 和校内安排判断。','["香港高校研究人员","研究管理人员"]','["科研预算","研究资助","香港"]','https://www.ugc.edu.hk/eng/rgc/stat/indicative_budget.html','verified',1,'2026-08-02T00:00:00.000Z'),
('policy-rgc-nsfc-jrs-2026','rgc-home','NSFC/RGC 联合研究计划 2026/27','NSFC/RGC Joint Research Scheme 2026/27','Research Grants Council / NSFC','HK','collaboration','closed','2025-11-21','2025-11-21','2026-01-30T17:00:00','Asia/Hong_Kong','计划支持中国内地与香港研究团队联合申请，重点领域包含信息技术、生命科学和医学等。','本轮官方截止已过，可用于提前准备下一轮合作团队、研究议题和校内审批。','["香港高校研究人员","中国内地合作团队"]','["内地香港合作","生命科学","信息技术"]','https://www.ugc.edu.hk/eng/rgc/funding_opport/nsfc/call_letter.html','verified',1,'2026-08-02T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO research_projects
(id,name,name_en,lead_organization,region,status,start_at,end_at,funding,summary,opportunity_value,topics_json,url,published,source_verified_at) VALUES
('project-ukri-neuroscience','UKRI 神经科学与心理健康资助组合','UKRI Neurosciences and Mental Health Portfolio','Medical Research Council / UKRI','UK','active',NULL,NULL,'持续性申请人主导与战略投资','覆盖认知、系统与行为神经科学、神经技术、精神健康、神经退行性疾病及能力建设。','可沿标准研究项目、转化机制和 fellowship 查找团队及职位机会。','["认知神经","神经技术","心理健康"]','https://www.ukri.org/what-we-do/browse-our-areas-of-investment-and-support/neurosciences-and-mental-health/',1,'2026-08-02T00:00:00.000Z'),
('project-eu-ai-science','Horizon Europe：AI in Science','Horizon Europe AI in Science','European Commission','EU','active','2026-01-01','2027-12-31','以具体 Horizon calls 为准','2026—2027 工作计划设置 AI in Science 横向活动，推动 AI 方法进入科学研究。','适合关注 AI4Science、认知建模、生命科学和神经科学交叉联合项目。','["AI in Science","AI4Science","国际合作"]','https://research-and-innovation.ec.europa.eu/funding/funding-opportunities/funding-programmes-and-open-calls/horizon-europe/horizon-europe-work-programmes_en',1,'2026-08-02T00:00:00.000Z'),
('project-eic-pathfinder','EIC Pathfinder 2026','EIC Pathfinder 2026','European Innovation Council','EU','active','2026-01-01','2026-12-31','以 2026 工作计划各 call 为准','面向高风险、高收益的前沿技术研究与早期验证。','脑机接口、神经技术与新型 AI 方法可按具体 challenge 或 Open call 判断适配度。','["神经技术","脑机接口","前沿AI"]','https://eic.ec.europa.eu/eic-funding-opportunities/eic-2026-work-programme_en',1,'2026-08-02T00:00:00.000Z'),
('project-nsfc-next-ai','可解释、可通用的下一代人工智能方法重大研究计划','Next-generation AI Methods Major Research Plan','国家自然科学基金委员会','CN','active','2026-01-28',NULL,'以 2026 项目指南为准','围绕下一代人工智能的可解释性和通用性开展重大研究计划。','关注认知推理、可解释模型和脑启发智能方向的课题与团队。','["可解释AI","通用人工智能","认知推理"]','https://www.nsfc.gov.cn/p1/2931/4077/2026nxmzn.html',1,'2026-08-02T00:00:00.000Z'),
('project-nsfc-original','国家自然科学基金原创探索计划 2026','NSFC Original Exploration Program 2026','国家自然科学基金委员会','CN','active','2026-02-24',NULL,'以项目指南为准','支持非共识、颠覆性和高风险原创基础研究。','适合跟踪新理论、新范式和新方法相关团队，但不等同于学生可直接申请的岗位。','["原创研究","高风险研究","新范式"]','https://www.nsfc.gov.cn/p1/3381/2824/101332.html',1,'2026-08-02T00:00:00.000Z'),
('project-rgc-trs','RGC 主题研究计划 2026/27','RGC Theme-based Research Scheme 2026/27','Research Grants Council','HK','active','2025-07-18','2027-06-30','2026/27 指示性预算 HK$320m','支持对香港长期发展具战略意义的主题研究与跨机构合作。','可用于识别香港高校大型研究团队、博士后和研究助理的后续机会。','["主题研究","跨机构合作","香港"]','https://www.ugc.edu.hk/eng/rgc/funding_opport/trs/call_letter.html',1,'2026-08-02T00:00:00.000Z'),
('project-rgc-aoe','RGC 卓越学科领域计划 2026/27','RGC Areas of Excellence Scheme 2026/27','Research Grants Council','HK','active','2025-07-18','2027-06-30','2026/27 指示性预算 HK$280m','支持香港高校建设长期、聚焦且具有协作性的卓越研究领域。','适合发现香港跨校大型研究项目及其衍生博士、博士后与科研岗位。','["卓越学科","跨校合作","研究平台"]','https://www.ugc.edu.hk/eng/rgc/funding_opport/aoe/how_to_apply.html',1,'2026-08-02T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO research_topics (id,name,name_en,category,momentum,summary,evidence,policy_count,project_count,paper_count) VALUES
('topic-neurotechnology','神经技术','Neurotechnology','脑科学 × 工程','rising','脑信号获取、解码、神经调控与临床转化持续进入英国和欧盟资助范围。','UKRI 神经科学资助范围与 EIC 前沿技术路径。',2,2,0),
('topic-cognitive-neuroscience','认知与行为神经科学','Cognitive and Behavioural Neuroscience','认知神经','stable','认知、系统与行为神经科学仍是 MRC 持续支持范围，也是导师和论文雷达的核心方向。','UKRI/MRC Neurosciences and Mental Health。',1,1,0),
('topic-ai-science','AI in Science','AI in Science','AI × 科学','rising','欧盟工作计划将 AI in Science 设置为跨领域活动，中国也持续发布下一代 AI 重大研究计划。','Horizon Europe 2026—2027 与 NSFC 2026 指南。',2,2,0),
('topic-explainable-ai','可解释与通用人工智能','Explainable and Generalizable AI','人工智能','rising','可解释性、通用性和认知推理成为中国重大研究计划关注方向。','NSFC 可解释、可通用的下一代人工智能方法重大研究计划。',1,1,0),
('topic-brain-health','脑健康与心理健康','Brain and Mental Health','脑健康','stable','脑健康、精神健康、神经退行性疾病与全生命周期研究保持长期资助。','UKRI/MRC 持续资助范围。',1,1,0),
('topic-original-research','原创与高风险研究','Original and High-risk Research','基础研究政策','rising','中国原创探索计划和欧洲 Pathfinder 均为高风险前沿研究保留专门路径。','NSFC 原创探索计划与 EIC Pathfinder。',2,2,0),
('topic-talent','青年科研人才','Early-career Research Talent','人才政策','stable','NSFC 青年项目、RGC ECS/JRF/HKPF 和 UKRI fellowship 构成多阶段人才支持。','四地官方资助体系与 2026/27 计划。',4,1,0),
('topic-collaboration','跨境科研合作','International Research Collaboration','国际合作','rising','内地—香港、欧盟—香港和 Horizon 联合体机制持续提供跨境合作路径。','RGC 联合研究计划与 Horizon Europe。',3,2,0),
('topic-research-budget','科研预算与优先级','Research Budgets and Priorities','科研治理','watch','英国预算重排和香港指示性预算会影响资助机会规模与开放节奏。','UKRI 2026 战略预算与 RGC 2026/27 指示性预算。',2,0,0);
--> statement-breakpoint
-- Corrections confirmed against the current official pages on 2026-08-02.
UPDATE research_policies SET published_at=NULL,effective_at=NULL WHERE id='policy-ukri-2026-strategy';
UPDATE research_policies SET deadline_at='2026-01-02T16:00:00' WHERE id='policy-rgc-nsfc-jrs-2026';
UPDATE research_projects SET end_at=NULL WHERE id IN ('project-rgc-trs','project-rgc-aoe');

PRAGMA optimize;
