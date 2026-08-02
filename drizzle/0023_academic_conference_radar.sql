CREATE TABLE `academic_conferences` (
  `id` text PRIMARY KEY NOT NULL, `series` text NOT NULL, `name` text NOT NULL, `name_zh` text NOT NULL,
  `field` text NOT NULL, `conference_type` text NOT NULL, `year` integer NOT NULL, `city` text DEFAULT '' NOT NULL,
  `country` text DEFAULT '' NOT NULL, `venue` text DEFAULT '' NOT NULL, `status` text DEFAULT 'watch' NOT NULL,
  `starts_at` text, `ends_at` text, `date_status` text DEFAULT 'tba' NOT NULL, `summary` text NOT NULL,
  `relevance` text DEFAULT '' NOT NULL, `topics_json` text DEFAULT '[]' NOT NULL, `official_url` text NOT NULL,
  `cfp_url` text, `proceedings_url` text, `content_hash` text, `check_interval_hours` integer DEFAULT 24 NOT NULL,
  `source_verified_at` text, `published` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_conferences_url_unique` ON `academic_conferences` (`official_url`);
--> statement-breakpoint
CREATE INDEX `academic_conferences_public_idx` ON `academic_conferences` (`published`,`field`,`year`,`status`);
--> statement-breakpoint
CREATE INDEX `academic_conferences_date_idx` ON `academic_conferences` (`starts_at`);
--> statement-breakpoint
CREATE TABLE `conference_dates` (
  `id` text PRIMARY KEY NOT NULL, `conference_id` text NOT NULL, `event_type` text NOT NULL, `label` text NOT NULL,
  `occurs_at` text, `ends_at` text, `timezone` text DEFAULT 'UTC' NOT NULL, `date_status` text DEFAULT 'tba' NOT NULL,
  `action_required` integer DEFAULT 0 NOT NULL, `official_url` text NOT NULL, `notes` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`conference_id`) REFERENCES `academic_conferences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conference_dates_conference_idx` ON `conference_dates` (`conference_id`,`occurs_at`);
--> statement-breakpoint
CREATE INDEX `conference_dates_calendar_idx` ON `conference_dates` (`occurs_at`,`event_type`);
--> statement-breakpoint
CREATE TABLE `conference_versions` (
  `id` text PRIMARY KEY NOT NULL, `conference_id` text NOT NULL, `content_hash` text NOT NULL,
  `excerpt` text DEFAULT '' NOT NULL, `captured_at` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`conference_id`) REFERENCES `academic_conferences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conference_versions_hash_unique` ON `conference_versions` (`conference_id`,`content_hash`);
--> statement-breakpoint
CREATE INDEX `conference_versions_conference_idx` ON `conference_versions` (`conference_id`,`captured_at`);
--> statement-breakpoint
CREATE TABLE `conference_sync_runs` (
  `id` text PRIMARY KEY NOT NULL, `trigger` text NOT NULL, `status` text NOT NULL, `started_at` text NOT NULL,
  `finished_at` text, `conferences_checked` integer DEFAULT 0 NOT NULL, `versions_added` integer DEFAULT 0 NOT NULL,
  `failed_count` integer DEFAULT 0 NOT NULL, `error_summary` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conference_sync_runs_started_idx` ON `conference_sync_runs` (`started_at`);
--> statement-breakpoint
INSERT INTO academic_conferences
(id,series,name,name_zh,field,conference_type,year,city,country,venue,status,starts_at,ends_at,date_status,summary,relevance,topics_json,official_url,cfp_url,proceedings_url,source_verified_at,published) VALUES
('neurips-2026','NeurIPS','NeurIPS 2026','NeurIPS 2026 神经信息处理系统大会','ai','peer_reviewed',2026,'Sydney / Atlanta / Paris','Australia / USA / France','multi-site','upcoming','2026-12-06','2026-12-13','confirmed','机器学习与人工智能旗舰会议，论文、数据集与基准、研讨会构成主要学术产出。','重点关注机器学习、生成式 AI、强化学习、可信 AI 与 AI for Science。','["机器学习","生成式AI","AI4Science"]','https://neurips.cc/?ID=1492','https://neurips.cc/Conferences/2026','https://proceedings.neurips.cc/','2026-08-02T00:00:00.000Z',1),
('aaai-2027','AAAI','AAAI-27','AAAI-27 人工智能大会','ai','peer_reviewed',2027,'Montreal','Canada','','open','2027-02-16','2027-02-23','confirmed','覆盖人工智能理论、方法、系统与应用的综合性国际会议。','投稿周期正在进行，适合跟踪通用 AI、认知推理、智能体与 AI 应用论文。','["人工智能","智能体","认知推理"]','https://aaai.org/conference/aaai/aaai-27/','https://aaai.org/conference/aaai/aaai-27/','https://ojs.aaai.org/index.php/AAAI','2026-08-02T00:00:00.000Z',1),
('eacl-2027','EACL','EACL 2027','EACL 2027 欧洲计算语言学大会','ai','peer_reviewed',2027,'Athens','Greece','','open','2027-03-09','2027-03-14','confirmed','ACL 体系的自然语言处理旗舰区域会议，通过 ARR 完成评审与投稿承诺。','当前最紧迫节点是 2026-08-03 ARR 投稿截止。','["自然语言处理","大语言模型","计算认知"]','https://2027.eacl.org/','https://2027.eacl.org/calls/papers/','https://aclanthology.org/venues/eacl/','2026-08-02T00:00:00.000Z',1),
('acl-2027','ACL','ACL 2027','ACL 2027 计算语言学大会','ai','peer_reviewed',2027,'Kyoto','Japan','','upcoming','2027-08-17','2027-08-22','confirmed','计算语言学与自然语言处理旗舰会议，主会投稿节点尚待官方公布。','持续跟踪语言模型、智能体、推理、评测和人机交互论文。','["自然语言处理","大语言模型","智能体"]','https://2027.aclweb.org/',NULL,'https://aclanthology.org/venues/acl/','2026-08-02T00:00:00.000Z',1),
('iclr-2027','ICLR','ICLR 2027','ICLR 2027 学习表征国际会议','ai','peer_reviewed',2027,'','North America','','watch',NULL,NULL,'tba','深度学习与表征学习旗舰会议；官方仅确认将在北美西海岸举行，具体日期待公布。','对基础模型、表征学习、优化与脑启发 AI 高度相关。','["深度学习","表征学习","脑启发AI"]','https://iclr.cc/Conferences/FutureMeetings',NULL,'https://openreview.net/group?id=ICLR.cc','2026-08-02T00:00:00.000Z',1),
('apa-2026','APA','APA 2026 Convention','APA 2026 美国心理学会年会','psychology','abstract_meeting',2026,'Washington, DC','USA','Walter E. Washington Convention Center','upcoming','2026-08-06','2026-08-08','confirmed','美国心理学会综合年会，包含心理学研究、临床实践、教育与政策报告。','适合跟踪心理健康、实验心理学、临床与科研政策议题。','["心理学","心理健康","科研政策"]','https://convention.apa.org/',NULL,NULL,'2026-08-02T00:00:00.000Z',1),
('psychonomic-2026','Psychonomic Society','Psychonomic Society 2026 Annual Meeting','2026 心理学科学会年会','psychology','abstract_meeting',2026,'San Diego','USA','Hilton San Diego Bayfront','upcoming','2026-11-19','2026-11-22','confirmed','实验心理学与认知科学重要年会，集中发布认知、注意、记忆和决策研究。','适合发现实验范式、认知建模和早期研究成果。','["实验心理学","认知科学","记忆"]','https://www.psychonomic.org/page/2026press',NULL,NULL,'2026-08-02T00:00:00.000Z',1),
('aps-2027','APS','2027 APS Annual Convention','2027 APS 心理科学年会','psychology','abstract_meeting',2027,'Seattle','USA','','upcoming','2027-05-27','2027-05-30','confirmed','心理科学协会年度大会，覆盖基础、应用和跨学科心理科学。','适合跟踪心理学前沿议题、方法与青年学者成果。','["心理科学","研究方法","行为科学"]','https://www.psychologicalscience.org/conventions/2027-aps-annual-convention',NULL,NULL,'2026-08-02T00:00:00.000Z',1),
('cogsci-2026','CogSci','CogSci 2026','CogSci 2026 认知科学大会','interdisciplinary','peer_reviewed',2026,'Rio de Janeiro','Brazil','','completed','2026-07-22','2026-07-25','confirmed','认知科学学会年度大会，连接心理学、神经科学、语言、哲学与人工智能。','会议论文集适合回溯认知建模、人类学习和 AI 交叉研究。','["认知科学","认知建模","人类学习"]','https://cognitivesciencesociety.org/cogsci-2026/',NULL,'https://escholarship.org/uc/cognitivesciencesociety','2026-08-02T00:00:00.000Z',1),
('cns-2027','CNS','CNS 2027 Annual Meeting','CNS 2027 认知神经科学学会年会','neuroscience','abstract_meeting',2027,'Boston','USA','','upcoming','2027-03-20','2027-03-23','confirmed','认知神经科学学会年度会议，聚焦脑与认知关系及多模态神经影像。','与实验心理学、脑成像和计算认知直接相关。','["认知神经科学","脑成像","计算认知"]','https://www.cogneurosociety.org/annual-meeting/',NULL,NULL,'2026-08-02T00:00:00.000Z',1),
('sfn-2026','SfN','Neuroscience 2026','SfN Neuroscience 2026 神经科学大会','neuroscience','abstract_meeting',2026,'Washington, DC','USA','','open','2026-11-14','2026-11-18','confirmed','全球规模最大的综合神经科学年会之一，以摘要、海报、专题报告和职业活动为主要成果载体。','晚期突破摘要窗口仍可行动，适合跟踪脑科学全领域最新成果。','["神经科学","脑科学","神经技术"]','https://www.sfn.org/meetings/neuroscience-2026','https://www.sfn.org/meetings/neuroscience-2026/general-information/dates-and-deadlines',NULL,'2026-08-02T00:00:00.000Z',1),
('cosyne-2027','COSYNE','COSYNE 2027','COSYNE 2027 计算与系统神经科学大会','neuroscience','abstract_meeting',2027,'Montreal','Canada','','upcoming','2027-03-11','2027-03-16','confirmed','计算与系统神经科学重点会议，连接理论、实验、机器学习和神经数据分析。','适合跟踪计算神经、神经编码、脑机接口和神经 AI。','["计算神经科学","系统神经科学","神经AI"]','https://www.cosyne.org/cosyne-home',NULL,NULL,'2026-08-02T00:00:00.000Z',1),
('ohbm-2027','OHBM','OHBM 2027 Annual Meeting','OHBM 2027 人脑成像组织年会','neuroscience','abstract_meeting',2027,'Toronto','Canada','','upcoming','2027-06-26','2027-06-30','confirmed','人脑成像组织年度会议，覆盖 fMRI、EEG/MEG、连接组、开放科学和计算方法。','摘要系统预计 2026 年 11 月开放，具体截止日以官网更新为准。','["人脑成像","连接组","开放科学"]','https://humanbrainmapping.org/ohbm-2027/',NULL,NULL,'2026-08-02T00:00:00.000Z',1);
--> statement-breakpoint
INSERT INTO conference_dates
(id,conference_id,event_type,label,occurs_at,ends_at,timezone,date_status,action_required,official_url,notes) VALUES
('aaai27-abstract','aaai-2027','abstract_deadline','摘要注册截止','2026-07-21T23:59:00',NULL,'AoE','confirmed',1,'https://aaai.org/conference/aaai/aaai-27/','已结束'),
('aaai27-paper','aaai-2027','paper_deadline','全文投稿截止','2026-07-28T23:59:00',NULL,'AoE','confirmed',1,'https://aaai.org/conference/aaai/aaai-27/','已结束'),
('aaai27-supplement','aaai-2027','supplementary_deadline','补充材料截止','2026-07-31T23:59:00',NULL,'AoE','confirmed',1,'https://aaai.org/conference/aaai/aaai-27/','已结束'),
('aaai27-phase1','aaai-2027','notification','第一阶段拒稿通知','2026-09-24',NULL,'AoE','confirmed',0,'https://aaai.org/conference/aaai/aaai-27/',''),
('aaai27-feedback-open','aaai-2027','response','作者反馈期开始','2026-10-19','2026-10-25','AoE','confirmed',1,'https://aaai.org/conference/aaai/aaai-27/','10 月 19—25 日'),
('aaai27-notification','aaai-2027','notification','最终录用通知','2026-11-30',NULL,'AoE','confirmed',0,'https://aaai.org/conference/aaai/aaai-27/',''),
('aaai27-camera','aaai-2027','camera_ready','终稿提交截止','2026-12-14T23:59:00',NULL,'AoE','confirmed',1,'https://aaai.org/conference/aaai/aaai-27/',''),
('eacl27-arr','eacl-2027','paper_deadline','ARR 论文投稿截止','2026-08-03T23:59:00',NULL,'AoE','confirmed',1,'https://2027.eacl.org/calls/papers/','紧急节点'),
('eacl27-reviewer','eacl-2027','registration','审稿人注册截止','2026-08-05T23:59:00',NULL,'AoE','confirmed',1,'https://2027.eacl.org/calls/papers/',''),
('eacl27-response','eacl-2027','response','作者回复期开始','2026-09-14','2026-09-19','AoE','confirmed',1,'https://2027.eacl.org/calls/papers/','9 月 14—19 日'),
('eacl27-discussion','eacl-2027','response','作者—审稿人讨论期开始','2026-09-20','2026-09-24','AoE','confirmed',1,'https://2027.eacl.org/calls/papers/','9 月 20—24 日'),
('eacl27-meta','eacl-2027','notification','Meta-review 发布','2026-10-08',NULL,'AoE','confirmed',0,'https://2027.eacl.org/calls/papers/',''),
('eacl27-commit','eacl-2027','commitment','EACL 投稿承诺截止','2026-10-11T23:59:00',NULL,'AoE','confirmed',1,'https://2027.eacl.org/calls/papers/',''),
('acl27-workshop','acl-2027','workshop_proposal','ACL 2027 联合 Workshop 提案截止','2026-09-04T23:59:00',NULL,'AoE','confirmed',1,'https://www.aclweb.org/portal/content/joint-call-workshops-proposals-2027',''),
('acl27-workshop-notify','acl-2027','notification','ACL 2027 Workshop 提案通知','2026-10-02',NULL,'AoE','confirmed',0,'https://www.aclweb.org/portal/content/joint-call-workshops-proposals-2027',''),
('sfn26-late-open','sfn-2026','other','晚期突破摘要开放','2026-09-08',NULL,'America/New_York','confirmed',0,'https://www.sfn.org/meetings/neuroscience-2026/general-information/dates-and-deadlines',''),
('sfn26-late-close','sfn-2026','late_breaking','晚期突破摘要截止','2026-09-15',NULL,'America/New_York','confirmed',1,'https://www.sfn.org/meetings/neuroscience-2026/general-information/dates-and-deadlines',''),
('sfn26-registration','sfn-2026','registration','注册截止','2026-10-05',NULL,'America/New_York','confirmed',1,'https://www.sfn.org/meetings/neuroscience-2026/general-information/dates-and-deadlines',''),
('ohbm27-submission-open','ohbm-2027','other','摘要系统开放（月份已确认）',NULL,NULL,'UTC','month_confirmed',0,'https://humanbrainmapping.org/ohbm-2027/','2026 年 11 月，具体日期待公布'),
('ohbm27-content-deadline','ohbm-2027','abstract_deadline','内容提交截止（月份已确认）',NULL,NULL,'UTC','month_confirmed',1,'https://humanbrainmapping.org/ohbm-2027/','2026 年 12 月，具体日期待公布');
