ALTER TABLE `review_queue` ADD `review_mode` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_queue` ADD `resolution_code` text;--> statement-breakpoint
ALTER TABLE `review_queue` ADD `resolution_note` text;--> statement-breakpoint
ALTER TABLE `review_queue` ADD `resolved_by` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX `sources_priority_idx` ON `sources` (`priority`,`enabled`);
--> statement-breakpoint
UPDATE `review_queue`
SET `status` = 'observing',
    `review_mode` = 'automatic',
    `resolution_note` = '等待下一次相同内容哈希确认稳定；稳定后由 automatic-policy-v1 自动结案。'
WHERE `reason` = 'content_changed' AND `status` = 'pending';
--> statement-breakpoint
UPDATE `sources`
SET `priority` = 'critical', `check_interval_hours` = 6
WHERE `id` IN ('oxford-experimental-psych-dphil','cambridge-mrc-cbu','ucl-gatsby-phd','ucl-icn-phd','tsinghua-pcs','tsinghua-sigs','tsinghua-pengcheng');
--> statement-breakpoint
INSERT OR IGNORE INTO `sources`
(`id`,`name`,`source_type`,`coverage`,`organization_type`,`regions_json`,`topics_json`,`description`,`priority`,`url`,`enabled`,`check_interval_hours`) VALUES
('oxford-experimental-psych-funding','牛津大学实验心理学博士资助机会','listing','phd','university','["UK"]','["实验心理学","认知神经科学","博士奖学金"]','牛津实验心理学系博士资助官方页，含 2027 入学项目与新增 studentship。','critical','https://www.psy.ox.ac.uk/study/Graduate-training/Graduates-funding-opportunities',1,6),
('cambridge-mrc-cbu-phd-course','剑桥 MRC 认知与脑科学博士课程','detail','phd','university','["UK"]','["认知科学","神经科学","博士"]','剑桥大学 MRC Cognition and Brain Sciences Unit 博士课程与申请官方页。','critical','https://www.postgraduate.study.cam.ac.uk/courses/directory/cvbspdbsc/apply',1,6),
('ucl-uela-2027','UCL EPSRC UELA 2027 博士奖学金','detail','phd','university','["UK"]','["人工智能","工程","博士奖学金"]','UCL 2027/28 EPSRC Doctoral Landscape Award 官方页，约 50 个全额资助名额。','high','https://www.ucl.ac.uk/epsrc-doctoral-training/prospective-students/ucl-epsrc-landscape-award-uela-studentships',1,6),
('ucl-cehp-phd-2027','UCL 临床教育与健康心理学博士','detail','phd','university','["UK"]','["心理学","心理健康","博士"]','UCL CEHP 2027/28 博士申请与资助截止日期官方页。','high','https://www.ucl.ac.uk/brain-sciences/pals/research/clinical-educational-and-health-psychology/study-and-courses/cehp-phd-programme-how-apply',1,6),
('ucl-imaging-neuroscience-vacancies','UCL 影像神经科学机会','listing','phd','research','["UK"]','["神经影像","MEG","fMRI"]','UCL Department of Imaging Neuroscience 博士和研究岗位官方机会页。','high','https://www.in.fil.ion.ucl.ac.uk/vacancies',1,6),
('ucl-ecological-brain-dtp','UCL Ecological Brain DTP','detail','phd','university','["UK"]','["心理学","神经科学","跨学科"]','UCL 真实世界人类行为、心理学与神经科学交叉博士培养项目官方页。','high','https://www.ucl.ac.uk/brain-sciences/pals/research/ecological-brain-dtp',1,6),
('pku-psych-notices','北京大学心理与认知科学学院通知','listing','phd','university','["CN"]','["心理学","认知科学","博士"]','北京大学心理与认知科学学院官方通知页，用于发现 2027 博士招生说明。','critical','https://psy.pku.edu.cn/xwzx/tzgg/',1,6),
('pku-doctoral-admissions','北京大学博士招生信息','listing','phd','university','["CN"]','["博士招生","心理学","交叉学科"]','北京大学研究生招生网博士招生官方入口，用于交叉核对院系简章与报名批次。','critical','https://admission.pku.edu.cn/zsxx/bszs/index2.htm',1,6);
--> statement-breakpoint
INSERT OR IGNORE INTO `opportunities`
(`id`,`source_id`,`name`,`org`,`kind`,`status`,`fit`,`location`,`deadline`,`why`,`action`,`tags_json`,`url`) VALUES
('oxford-ocemr-2027-dphil','oxford-experimental-psych-funding','Oxford OCEMR 2027 全额资助 DPhil','牛津大学实验心理学系','博士','立即行动','高度匹配','Oxford','意向申请截止：2026.09.14 12:00（英国时间）','面向儿童、青少年、神经多样性与心理健康研究，2027 年 10 月入学，最多 4 个资助名额；资助覆盖英国本土学费标准和三年生活津贴。','立即阅读项目方向并联系潜在导师；国际申请者需单独确认海外学费差额。','["实验心理学","心理健康","神经多样性","全额资助"]','https://www.psy.ox.ac.uk/study/Graduate-training/Graduates-funding-opportunities'),
('oxford-experimental-psych-2027','oxford-experimental-psych-dphil','Oxford 2027 Experimental Psychology DPhil','牛津大学','博士','等待开放','高度匹配','Oxford','2027/28 申请即将开放；资助通常要求 12 月早期截止前提交','覆盖行为神经科学、认知、发展、心理与脑健康及知觉，官方课程页已提供 2027/28 开放提醒。','现在筛选导师并准备研究计划、写作样本和推荐信；注册官方开放提醒。','["实验心理学","行为神经科学","认知","博士"]','https://www.ox.ac.uk/admissions/graduate/courses/dphil-experimental-psychology'),
('cambridge-mrc-cbu-2027-phd','cambridge-mrc-cbu-phd-course','Cambridge MRC CBU 2027 PhD','剑桥大学 MRC 认知与脑科学研究所','博士','等待开放','高度匹配','Cambridge','2027/28 日期待更新；资助轮通常早于课程最终截止','直接聚焦认知、脑与行为研究；官方要求先查看 studentship/导师方向并建议申请前联系潜在导师。','建立导师清单并提前邮件讨论 2027 项目和资助资格。','["认知科学","神经科学","MRC","博士"]','https://www.postgraduate.study.cam.ac.uk/courses/directory/cvbspdbsc/apply'),
('ucl-gatsby-2027-phd','ucl-gatsby-phd','UCL Gatsby 2027 PhD Programme','UCL Gatsby Computational Neuroscience Unit','博士','等待开放','高度匹配','London','2026.09 中旬开放；2026.11.09 17:00 GMT 截止','四年制机器学习与计算/理论神经科学博士，国际生学费、生活津贴和学术差旅均由 studentship 覆盖。','提前准备数理、编程和研究能力证据；开放后尽早提交 Gatsby Recruitment Portal。','["计算神经科学","机器学习","全额资助","国际生"]','https://www.ucl.ac.uk/life-sciences/gatsby/study-and-work/gatsby-unit-phd-programme'),
('ucl-uela-2027-studentship','ucl-uela-2027','UCL UELA 2027/28 全额资助博士','UCL EPSRC Doctoral Training','博士','等待开放','匹配','London','预计 2026.10 末开放；预计 2027.01 初截止','约 50 个四年全额资助 studentship，覆盖学费、生活津贴和研究训练费用；海外生名额上限约 30%。','10 月前准备项目匹配清单、研究陈述和国际生竞争材料。','["EPSRC","全额资助","AI","工程"]','https://www.ucl.ac.uk/epsrc-doctoral-training/prospective-students/ucl-epsrc-landscape-award-uela-studentships'),
('ucl-cehp-2027-phd','ucl-cehp-phd-2027','UCL CEHP 2027/28 PhD','UCL Clinical, Educational and Health Psychology','博士','等待开放','高度匹配','London','资助申请截止：2027.01.05 16:00；自费截止：2027.06.30 16:00','与实验心理学、教育和健康心理学背景高度衔接，官方已公布 2027/28 两档截止日期。','优先按资助截止倒排，提前联系导师并确保推荐信在 1 月 5 日前完成。','["心理学","心理健康","教育心理","博士"]','https://www.ucl.ac.uk/brain-sciences/pals/research/clinical-educational-and-health-psychology/study-and-courses/cehp-phd-programme-how-apply'),
('ucl-ecological-brain-2027','ucl-ecological-brain-dtp','UCL Ecological Brain DTP 2027/28','UCL Faculty of Brain Sciences','博士','等待开放','高度匹配','London','预计 2026.10—11 开放','跨心理学、神经科学、计算机、工程和真实世界行为研究，提供有限数量全额资助名额。','围绕实验心理学如何迁移到真实世界行为和计算建模准备研究问题。','["真实世界行为","心理学","神经科学","跨学科"]','https://www.ucl.ac.uk/brain-sciences/pals/research/ecological-brain-dtp'),
('pku-psych-2027-phd','pku-psych-notices','北京大学心理与认知科学学院 2027 博士','北京大学心理与认知科学学院','博士','等待开放','高度匹配','北京','2027 招生说明待发布；往年通常在秋季发布','北大心理与认知科学学院覆盖基础心理学、应用心理学、认知与脑科学，是实验心理学硕士的核心目标。','提前筛选导师与研究方向；系统每 6 小时检查学院通知和北大博士招生网。','["心理学","认知科学","脑科学","申请考核"]','https://psy.pku.edu.cn/xwzx/tzgg/');
--> statement-breakpoint
INSERT OR IGNORE INTO `institutions`
(`id`,`source_id`,`name`,`mark`,`summary`,`note`,`url`,`sort_order`) VALUES
('oxford-experimental-psych','oxford-experimental-psych-funding','牛津大学实验心理学系','英国重点','2027 DPhil 与 OCEMR 资助机会已进入专项监控，覆盖实验心理学、行为神经科学、认知与心理健康。','OCEMR 意向申请截止较早；国际生需核对 studentship 的海外学费差额。','https://www.psy.ox.ac.uk/study/Graduate-training/Graduates-funding-opportunities',6),
('cambridge-mrc-cbu-institution','cambridge-mrc-cbu-phd-course','剑桥 MRC 认知与脑科学研究所','英国重点','直接聚焦认知、脑与行为，博士申请强调先匹配研究方向并联系潜在导师。','2027/28 日期尚未更新，系统每 6 小时检查官方课程与研究所入口。','https://www.mrc-cbu.cam.ac.uk/',7),
('ucl-brain-sciences','ucl-gatsby-phd','UCL 脑科学与 Gatsby','英国重点','覆盖计算神经科学、机器学习、认知神经科学、心理健康和神经影像，多项 2027 机会已公布时间窗口。','Gatsby、CEHP、UELA 与 Ecological Brain 使用独立官方来源监控。','https://www.ucl.ac.uk/brain-sciences/',8),
('pku-psych','pku-psych-notices','北京大学心理与认知科学学院','国内重点','基础与应用心理学、认知科学和脑科学的重要博士目标，2027 简章尚待官方发布。','学院通知与北大研究生招生网均设为每 6 小时检查。','https://psy.pku.edu.cn/',9),
('tsinghua-pcs-institution','tsinghua-pcs','清华大学心理与认知科学系','国内重点','2027 申请考核简章已发布，覆盖心理学、认知、脑影像与情感脑机接口。','第一批已结束；如名额未满，第二批为 2026.11.01—11.30。','https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm',10);
