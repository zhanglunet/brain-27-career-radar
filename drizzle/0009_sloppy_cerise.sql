CREATE TABLE `academic_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`researcher_id` text,
	`paper_id` text,
	`event_type` text NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `academic_sync_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`researcher_id`) REFERENCES `researchers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `academic_events_created_idx` ON `academic_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `academic_events_researcher_idx` ON `academic_events` (`researcher_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `academic_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`researchers_checked` integer DEFAULT 0 NOT NULL,
	`candidates_found` integer DEFAULT 0 NOT NULL,
	`papers_inserted` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `academic_sync_runs_started_idx` ON `academic_sync_runs` (`started_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `sources`
(`id`,`name`,`source_type`,`coverage`,`organization_type`,`regions_json`,`topics_json`,`description`,`priority`,`url`,`enabled`,`check_interval_hours`) VALUES
('mentor-tim-behrens','Tim Behrens｜Oxford 官方主页','detail','mixed','university','["UK"]','["计算神经科学","神经表征","决策"]','导师官方履历、研究方向与论文入口。','critical','https://www.win.ox.ac.uk/people/timothy-behrens',1,6),
('mentor-matthew-rushworth','Matthew Rushworth｜Oxford 官方主页','detail','mixed','university','["UK"]','["决策神经科学","社会认知","灵长类"]','导师官方履历、实验室与论文入口。','critical','https://www.psy.ox.ac.uk/people/matthew-rushworth',1,6),
('mentor-zoe-kourtzi','Zoe Kourtzi｜Cambridge 官方主页','detail','mixed','university','["UK"]','["认知神经科学","学习","脑影像"]','导师官方履历和研究方向入口。','critical','https://www.bio.cam.ac.uk/staff/zoe-kourtzi',1,6),
('mentor-maneesh-sahani','Maneesh Sahani｜UCL Gatsby 官方主页','detail','mixed','university','["UK"]','["计算神经科学","机器学习","神经编码"]','UCL Gatsby 官方导师目录与研究入口。','critical','https://www.ucl.ac.uk/life-sciences/gatsby/people',1,6),
('mentor-neil-burgess','Neil Burgess｜UCL 官方主页','detail','mixed','university','["UK"]','["空间记忆","海马","认知地图"]','导师官方履历、研究组与论文入口。','critical','https://www.ucl.ac.uk/brain-sciences/icn/research/research-groups/space-memory/neil-burgess',1,6),
('mentor-muming-poo','蒲慕明｜中国科学院官方主页','detail','mixed','research','["CN"]','["神经可塑性","神经环路","脑科学政策"]','中国科学院脑科学与智能技术卓越创新中心官方履历。','critical','https://www.ion.ac.cn/yjz/pmm_/ry/',1,6),
('mentor-jianfeng-feng','冯建峰｜复旦大学官方主页','detail','mixed','university','["CN"]','["计算神经科学","脑疾病","AI"]','复旦大学类脑智能科学与技术研究院官方主页。','critical','https://cnbi.fudan.edu.cn/info/1032/1138.htm',1,6),
('mentor-luping-shi','施路平｜清华大学官方主页','detail','mixed','university','["CN"]','["类脑计算","神经形态芯片","脑机接口"]','清华大学精密仪器系官方教师主页。','critical','https://faculty.dpi.tsinghua.edu.cn/shiluping/zh_CN/index.htm',1,6),
('mentor-nancy-ip','叶玉如｜HKUST 实验室主页','detail','mixed','university','["HK"]','["神经退行性疾病","突触","转化神经科学"]','香港科技大学实验室官方主页。','critical','https://iplab.hkust.edu.hk/',1,6),
('mentor-ila-fiete','Ila Fiete｜MIT 官方主页','detail','mixed','university','["US"]','["神经动力学","记忆","计算神经科学"]','MIT McGovern Institute 官方导师主页。','high','https://mcgovern.mit.edu/profile/ila-fiete/',1,12),
('mentor-josh-tenenbaum','Josh Tenenbaum｜MIT 官方主页','detail','mixed','university','["US"]','["计算认知科学","生成模型","人类智能"]','MIT Brain and Cognitive Sciences 官方导师主页。','high','https://bcs.mit.edu/directory/joshua-b-tenenbaum',1,12),
('mentor-surya-ganguli','Surya Ganguli｜Stanford 官方主页','detail','mixed','university','["US"]','["理论神经科学","深度学习","群体动力学"]','Stanford Neurosciences 官方导师主页。','high','https://neuroscience.stanford.edu/people/surya-ganguli',1,12),
('mentor-konrad-kording','Konrad Kording｜UPenn 官方主页','detail','mixed','university','["US"]','["计算神经科学","因果推断","神经工程"]','宾夕法尼亚大学官方导师主页。','high','https://psychology.sas.upenn.edu/people/konrad-kording',1,12),
('mentor-edward-chang','Edward Chang｜UCSF 官方主页','detail','mixed','university','["US"]','["语音脑机接口","神经外科","神经解码"]','UCSF 官方学术主页与研究项目入口。','high','https://profiles.ucsf.edu/edward.chang',1,12),
('mentor-bin-he','Bin He｜CMU 官方主页','detail','mixed','university','["US"]','["脑机接口","神经成像","神经工程"]','Carnegie Mellon Biomedical Engineering 官方主页。','high','https://www.cmu.edu/bme/People/Faculty/profile/bhe.html',1,12),
('mentor-leigh-hochberg','Leigh Hochberg｜Brown 官方主页','detail','mixed','university','["US"]','["植入式脑机接口","神经康复","临床转化"]','Brown Engineering 官方导师主页。','high','https://engineering.brown.edu/people/leigh-hochberg',1,12);
--> statement-breakpoint
INSERT OR IGNORE INTO `researchers`
(`id`,`slug`,`name`,`name_zh`,`institution`,`department`,`role`,`region`,`city`,`profile_url`,`topics_json`,`methods_json`,`summary`,`application_value`,`recruitment_status`,`priority`) VALUES
('r-tim-behrens','tim-behrens','Tim Behrens',NULL,'University of Oxford','Integrative Neuroimaging','Professor','UK','Oxford','https://www.win.ox.ac.uk/people/timothy-behrens','["计算神经科学","神经表征","决策"]','["fMRI","计算建模"]','研究大脑如何构建知识、关系与决策表征。','适合计算认知、神经影像和 NeuroAI 交叉申请。','watch','critical'),
('r-matthew-rushworth','matthew-rushworth','Matthew Rushworth',NULL,'University of Oxford','Experimental Psychology','Professor','UK','Oxford','https://www.psy.ox.ac.uk/people/matthew-rushworth','["决策神经科学","社会认知","灵长类"]','["fMRI","电生理","因果干预"]','研究额叶决策、社会学习及灵长类认知机制。','适合实验心理学向决策与系统神经科学迁移。','watch','critical'),
('r-zoe-kourtzi','zoe-kourtzi','Zoe Kourtzi',NULL,'University of Cambridge','Psychology','Professor','UK','Cambridge','https://www.bio.cam.ac.uk/staff/zoe-kourtzi','["认知神经科学","学习","脑影像"]','["fMRI","EEG","机器学习"]','研究知觉学习、认知灵活性及健康老龄化。','与实验心理、脑影像和机器学习背景高度衔接。','watch','critical'),
('r-maneesh-sahani','maneesh-sahani','Maneesh Sahani',NULL,'University College London','Gatsby Unit','Professor','UK','London','https://www.ucl.ac.uk/life-sciences/gatsby/people','["计算神经科学","机器学习","神经编码"]','["概率模型","机器学习"]','研究神经计算原理及其与机器学习的连接。','适合数学和代码能力较强的 NeuroAI 博士申请。','watch','critical'),
('r-neil-burgess','neil-burgess','Neil Burgess',NULL,'University College London','Cognitive Neuroscience','Professor','UK','London','https://www.ucl.ac.uk/brain-sciences/icn/research/research-groups/space-memory/neil-burgess','["空间记忆","海马","认知地图"]','["行为实验","fMRI","计算建模"]','研究空间导航、情景记忆和海马认知地图。','适合实验心理学、记忆研究与计算建模方向。','watch','critical'),
('r-muming-poo','muming-poo','Mu-ming Poo','蒲慕明','Chinese Academy of Sciences','CEBSIT','Director','CN','Shanghai','https://www.ion.ac.cn/yjz/pmm_/ry/','["神经可塑性","神经环路","脑科学政策"]','["电生理","系统神经科学"]','研究突触可塑性并推动中国脑科学战略与平台建设。','适合跟踪上海脑科学项目、科研政策与国际合作。','watch','critical'),
('r-jianfeng-feng','jianfeng-feng','Jianfeng Feng','冯建峰','Fudan University','Brain-inspired Intelligence','Professor','CN','Shanghai','https://cnbi.fudan.edu.cn/info/1032/1138.htm','["计算神经科学","脑疾病","AI"]','["大规模脑数据","数学建模"]','研究脑网络、精神疾病计算模型与类脑智能。','上海重点，适合脑影像、统计和 AI 交叉路径。','watch','critical'),
('r-luping-shi','luping-shi','Luping Shi','施路平','Tsinghua University','Precision Instrument','Professor','CN','Beijing','https://faculty.dpi.tsinghua.edu.cn/shiluping/zh_CN/index.htm','["类脑计算","神经形态芯片","脑机接口"]','["神经形态计算","芯片系统"]','研究类脑计算系统与神经形态芯片。','清华高优先级，适合工程能力较强的类脑计算申请。','watch','critical'),
('r-nancy-ip','nancy-ip','Nancy Ip','叶玉如','Hong Kong University of Science and Technology','Life Science','Professor','HK','Hong Kong','https://iplab.hkust.edu.hk/','["神经退行性疾病","突触","转化神经科学"]','["分子神经科学","组学"]','研究突触功能、阿尔茨海默病与转化神经科学。','香港高优先级，适合生命科学和疾病机制方向。','watch','critical'),
('r-ila-fiete','ila-fiete','Ila Fiete',NULL,'Massachusetts Institute of Technology','McGovern Institute','Professor','US','Cambridge','https://mcgovern.mit.edu/profile/ila-fiete/','["神经动力学","记忆","计算神经科学"]','["理论建模","群体神经数据"]','研究记忆、认知地图和神经群体计算原理。','适合理论计算神经科学与 NeuroAI 方向。','watch','high'),
('r-josh-tenenbaum','josh-tenenbaum','Josh Tenenbaum',NULL,'Massachusetts Institute of Technology','Brain and Cognitive Sciences','Professor','US','Cambridge','https://bcs.mit.edu/directory/joshua-b-tenenbaum','["计算认知科学","生成模型","人类智能"]','["贝叶斯建模","行为实验","AI"]','研究人类学习、常识推理和机器智能。','适合认知科学与生成式 AI 交叉申请。','watch','high'),
('r-surya-ganguli','surya-ganguli','Surya Ganguli',NULL,'Stanford University','Applied Physics','Professor','US','Stanford','https://neuroscience.stanford.edu/people/surya-ganguli','["理论神经科学","深度学习","群体动力学"]','["理论建模","高维数据"]','研究神经系统与深度网络中的高维计算。','适合数学、物理和机器学习基础强的申请者。','watch','high'),
('r-konrad-kording','konrad-kording','Konrad Kording',NULL,'University of Pennsylvania','Psychology','Professor','US','Philadelphia','https://psychology.sas.upenn.edu/people/konrad-kording','["计算神经科学","因果推断","神经工程"]','["机器学习","统计推断"]','研究学习、运动控制和可信神经数据科学。','适合计算方法、开放科学及 BCI 数据方向。','watch','high'),
('r-edward-chang','edward-chang','Edward Chang',NULL,'University of California, San Francisco','Neurological Surgery','Professor','US','San Francisco','https://profiles.ucsf.edu/edward.chang','["语音脑机接口","神经外科","神经解码"]','["皮层电图","深度学习"]','研究人类语音神经机制和恢复交流能力的脑机接口。','适合语音解码、临床 BCI 和神经工程方向。','watch','high'),
('r-bin-he','bin-he','Bin He','何斌','Carnegie Mellon University','Biomedical Engineering','Professor','US','Pittsburgh','https://www.cmu.edu/bme/People/Faculty/profile/bhe.html','["脑机接口","神经成像","神经工程"]','["EEG","源定位"]','研究动态脑成像与非侵入式脑机接口。','与 EEG、信号处理和生物医学工程背景高度匹配。','watch','high'),
('r-leigh-hochberg','leigh-hochberg','Leigh Hochberg',NULL,'Brown University','Engineering','Professor','US','Providence','https://engineering.brown.edu/people/leigh-hochberg','["植入式脑机接口","神经康复","临床转化"]','["植入式电极","临床试验"]','领导 BrainGate 临床研究，推进植入式神经接口转化。','适合临床 BCI、神经康复和转化工程方向。','watch','high');
--> statement-breakpoint
INSERT OR IGNORE INTO `researcher_identities` (`id`,`researcher_id`,`provider`,`external_id`,`verified`)
SELECT 'id-' || `id`,`id`,'crossref',`name`,0 FROM `researchers`;
--> statement-breakpoint
INSERT OR IGNORE INTO `researcher_sources` (`researcher_id`,`source_id`,`relation`)
SELECT `id`,'mentor-' || `slug`,'official_profile' FROM `researchers`;
