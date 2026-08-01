CREATE TABLE `source_check_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`run_id` text NOT NULL,
	`checked_at` text NOT NULL,
	`outcome` text NOT NULL,
	`ok` integer NOT NULL,
	`changed` integer DEFAULT false NOT NULL,
	`status_code` integer,
	`final_url` text,
	`error_summary` text,
	`candidates_count` integer DEFAULT 0 NOT NULL,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`change_sets_count` integer DEFAULT 0 NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_check_logs_run_source_unique` ON `source_check_logs` (`run_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `source_check_logs_checked_idx` ON `source_check_logs` (`checked_at`);--> statement-breakpoint
CREATE INDEX `source_check_logs_source_idx` ON `source_check_logs` (`source_id`,`checked_at`);--> statement-breakpoint
CREATE INDEX `source_check_logs_outcome_idx` ON `source_check_logs` (`outcome`,`checked_at`);--> statement-breakpoint
ALTER TABLE `sources` ADD `coverage` text DEFAULT 'mixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `organization_type` text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `regions_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `topics_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `description` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `sources`
SET `regions_json` = '["CN"]',
    `topics_json` = '["脑科学","人工智能"]',
    `coverage` = CASE
      WHEN `id` IN ('oppo-health-ml','oppo-health-algorithm','brainco-recruit','neuroxess-jobs','bytedance-seed','shlab-jobs') THEN 'campus'
      ELSE 'phd'
    END,
    `organization_type` = CASE
      WHEN `id` IN ('oppo-health-ml','oppo-health-algorithm','brainco-recruit','neuroxess-jobs','bytedance-seed') THEN 'company'
      WHEN `id` IN ('tsinghua-pcs','tju-sz-biomedical','tsinghua-sigs','hit-bigai','sjtu-psych','tsinghua-pengcheng') THEN 'university'
      ELSE 'research'
    END,
    `description` = CASE
      WHEN `id` IN ('oppo-health-ml','oppo-health-algorithm','brainco-recruit','neuroxess-jobs','bytedance-seed','shlab-jobs') THEN '中国大陆企业校招、实习或研究岗位官方入口。'
      ELSE '中国大陆博士、联合培养或科研机构官方入口。'
    END;
--> statement-breakpoint
INSERT OR IGNORE INTO `sources`
(`id`,`name`,`source_type`,`coverage`,`organization_type`,`regions_json`,`topics_json`,`description`,`url`,`enabled`,`check_interval_hours`) VALUES
('ucl-gatsby-phd','UCL Gatsby 理论神经科学与机器学习博士','detail','phd','university','["UK"]','["计算神经科学","机器学习"]','英国 UCL Gatsby Unit 博士项目官方页，2027 入学申请信息源。','https://www.ucl.ac.uk/life-sciences/gatsby/study-and-work/gatsby-unit-phd-programme',1,24),
('ucl-icn-phd','UCL 认知神经科学博士','detail','phd','university','["UK"]','["认知神经科学","心理学"]','英国 UCL Institute of Cognitive Neuroscience 博士研究官方入口。','https://www.ucl.ac.uk/brain-sciences/icn/study/postgraduate-research-phd',1,24),
('oxford-experimental-psych-dphil','牛津大学实验心理学 DPhil','detail','phd','university','["UK"]','["实验心理学","行为神经科学"]','牛津大学实验心理学 DPhil 官方课程页；官网对自动访问返回 403，保留为人工核对来源。','https://www.ox.ac.uk/admissions/graduate/courses/dphil-experimental-psychology',0,24),
('imperial-brain-sciences-phd','帝国理工脑科学博士机会','listing','phd','university','["UK"]','["神经科学","脑科学"]','Imperial Department of Brain Sciences 博士机会入口；官网对自动访问返回 403，保留为人工核对来源。','https://www.imperial.ac.uk/brain-sciences/study/',0,24),
('kcl-neuroscience-phd','伦敦国王学院神经科学博士','listing','phd','university','["UK"]','["神经科学","心理与精神健康"]','King''s College London 神经科学博士与研究项目官方入口。','https://www.kcl.ac.uk/neuroscience/phd',1,24),
('edinburgh-computational-neuro-phd','爱丁堡大学机器学习与计算神经科学博士','detail','phd','university','["UK"]','["计算神经科学","机器学习"]','爱丁堡大学 Informatics 机器学习、计算神经科学与计算生物学博士官方页。','https://study.ed.ac.uk/programmes/postgraduate-research/489-informatics-iml-machine-learning-computational-neuroscience',1,24),
('cambridge-mrc-cbu','剑桥 MRC 认知与脑科学研究所','listing','phd','research','["UK"]','["认知科学","神经科学"]','剑桥大学 MRC Cognition and Brain Sciences Unit 官方入口，用于跟踪研究与培养机会。','https://www.mrc-cbu.cam.ac.uk/',1,24),
('crick-phd-programme','Francis Crick Institute 博士项目','listing','phd','research','["UK"]','["生物医学","神经科学"]','英国 Francis Crick Institute 博士项目入口；官网对自动访问返回 403，保留为人工核对来源。','https://www.crick.ac.uk/careers-study/students/phd-students',0,24),
('hk-rgc-phd-fellowship','香港博士研究生奖学金计划 HKPFS','detail','phd','platform','["HK"]','["博士奖学金","跨学科"]','香港研究资助局 HKPFS 官方入口，覆盖香港八所研究型大学。','https://cerg1.ugc.edu.hk/hkpfs/index.html',1,24),
('cityu-neuroscience-phd','香港城市大学神经科学 MPhil/PhD','detail','phd','university','["HK"]','["神经科学","计算神经科学"]','香港城市大学神经科学研究学位官方入口。','https://www.cityu.edu.hk/neuro/edu/rpg.htm',1,24),
('cuhk-hkpfs','香港中文大学博士与 HKPFS','listing','phd','university','["HK"]','["博士奖学金","心理学","人工智能"]','香港中文大学研究生院 HKPFS 与博士项目官方入口。','https://www.gs.cuhk.edu.hk/hkpfs',1,24),
('hkust-hkpfs','香港科技大学博士与 HKPFS','listing','phd','university','["HK"]','["博士奖学金","人工智能","生命科学"]','香港科技大学研究生院 HKPFS 与博士项目官方入口；官网对 Worker 自动访问返回 403，保留为人工核对来源。','https://fytgs.hkust.edu.hk/hkpfs',0,24),
('hku-hkpfs','香港大学博士与 HKPFS','listing','phd','university','["HK"]','["博士奖学金","心理学","神经科学"]','香港大学研究生院 HKPFS 与博士项目官方入口；官网对 Worker 自动访问异常，保留为人工核对来源。','https://gradsch.hku.hk/hkpfs',0,24),
('deepmind-student-researcher','Google DeepMind Student Researcher','listing','campus','company','["UK"]','["人工智能","机器学习","研究实习"]','Google DeepMind 面向本科、硕士和博士的研究实习官方入口。','https://deepmind.google/student-researcher-program/',1,24),
('microsoft-early-careers-uk-ie','Microsoft 英国与爱尔兰学生招聘','listing','campus','company','["UK","IE"]','["人工智能","软件工程","校招"]','Microsoft Early in Profession 英国及爱尔兰学生和毕业生官方入口。','https://careers.microsoft.com/v2/global/en/students?qcountry=Ireland',1,24),
('amazon-student-science-emea','Amazon EMEA 应用科学学生招聘','detail','campus','company','["UK","IE"]','["机器学习","应用科学","实习"]','Amazon EMEA 面向硕博的 Applied Scientist 学生招聘官方入口，覆盖英国和爱尔兰。','https://www.amazon.jobs/en/jobs/3126764/2026-applied-scientist-intern-amazon-university-talent-acquisition',1,24),
('astrazeneca-early-talent','AstraZeneca 英国早期人才项目','listing','campus','company','["UK"]','["数据科学","人工智能","生物医学"]','AstraZeneca 英国早期人才、数据科学与 AI 毕业生项目官方入口；官网对 Worker 自动访问异常，保留为人工核对来源。','https://careers.astrazeneca.com/early-talent',0,24),
('huawei-campus','华为校园招聘','listing','campus','company','["CN","HK"]','["人工智能","算法","校招"]','华为面向中国大陆、港澳台及海外学生的校园招聘官方入口。','https://career.huawei.com/cn/campus-recruitment',1,24),
('tencent-campus','腾讯校园招聘','listing','campus','company','["CN","HK"]','["人工智能","算法","校招"]','腾讯中国区及港澳台、海外校园招聘官方入口。','https://careers.tencent.com/campusrecruit.html',1,24),
('alibaba-campus','阿里巴巴校园招聘','listing','campus','company','["CN","HK"]','["人工智能","算法","校招"]','阿里巴巴面向海内外应届生的校园招聘官方入口。','https://campus-talent.alibaba.com/',1,24),
('baidu-campus','百度校园招聘','listing','campus','company','["CN"]','["人工智能","算法","校招"]','百度面向全球 2027 届毕业生的校园招聘官方入口。','https://talent.baidu.com/jobs/list?projectType=1',1,24),
('hsbc-graduate-programmes','HSBC 英国、中国与香港学生项目','listing','campus','company','["UK","CN","HK"]','["工程","数据","校招"]','HSBC 学生、实习与毕业生项目官方入口，覆盖英国、中国大陆和中国香港。','https://www.hsbc.com/careers/students-and-graduates/find-a-programme',1,24),
('hkstp-global-internship','香港科技园全球实习计划','detail','campus','platform','["HK"]','["人工智能","生命健康科技","实习"]','香港科技园 Global Internship Programme 官方入口，覆盖 AI 与生命健康科技岗位。','https://www.hkstp.org/en/talent/global-talents/global-internship-programme',1,24),
('cathay-digital-graduate','国泰航空数字与 IT 管培项目','detail','campus','company','["HK"]','["数字化","数据","校招"]','国泰航空香港与大湾区 Digital & IT Graduate Trainee 官方入口。','https://careers.cathaypacific.com/en/careers/our-teams/early-careers-students-and-graduates/graduate-trainee',1,24);
