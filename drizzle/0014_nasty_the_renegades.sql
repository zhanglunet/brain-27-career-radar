ALTER TABLE `institutions` ADD `name_en` text;--> statement-breakpoint
ALTER TABLE `institutions` ADD `institution_type` text DEFAULT 'research_institute' NOT NULL;--> statement-breakpoint
ALTER TABLE `institutions` ADD `city` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `institutions` ADD `topics_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `institutions` ADD `opportunity_url` text;--> statement-breakpoint
ALTER TABLE `institutions` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX `institutions_city_type_idx` ON `institutions` (`city`,`institution_type`,`priority`);--> statement-breakpoint
ALTER TABLE `papers` ADD `title_zh` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `abstract_zh` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `translation_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `translated_at` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `translation_error` text;--> statement-breakpoint
INSERT OR IGNORE INTO `sources`
(`id`,`name`,`source_type`,`coverage`,`organization_type`,`regions_json`,`topics_json`,`description`,`priority`,`url`,`enabled`,`check_interval_hours`) VALUES
('pku-mcgovern-recruit','北京大学 IDG 麦戈文脑科学研究所人才招聘','listing','phd','university','["CN"]','["脑机接口","认知神经科学","科研助理"]','北大麦戈文官方人才招聘目录，覆盖专职研究岗、博士后、研究助理和技术岗位。','critical','https://mgv.pku.edu.cn/rczp/index.htm',1,6),
('tsinghua-cbicr-recruit','清华大学类脑计算研究中心招生招聘','listing','mixed','university','["CN"]','["类脑计算","神经形态芯片","脑机接口"]','清华类脑计算研究中心官方招生招聘目录，覆盖博士、博士后和科研实习。','critical','https://www.cbicr.tsinghua.edu.cn/?cat=3',1,6),
('bnu-brain-recruit','北京师范大学认知神经科学与学习实验室人才招聘','listing','phd','university','["CN"]','["认知神经科学","学习","心理学"]','北师大认知神经科学与学习国家重点实验室官方人才招聘目录。','critical','https://brain.bnu.edu.cn/rczp/index.htm',1,6),
('cas-psych-recruit','中国科学院心理研究所人才招聘','listing','mixed','research','["CN"]','["认知科学","心理健康","脑机接口"]','中科院心理所官方招聘目录，覆盖全国重点实验室、科研助理、博士后和科研岗位。','critical','https://www.psych.cas.cn/team/rczp/index.html',1,6),
('cas-psych-admissions','中国科学院心理研究所招生信息','listing','phd','research','["CN"]','["认知神经科学","心理学","直博"]','中科院心理所官方研究生招生目录。','critical','https://www.psych.cas.cn/edu/zsxx/',1,6),
('cas-ibp-recruit','中国科学院生物物理研究所人才招聘','listing','mixed','research','["CN"]','["认知神经科学","神经环路","脑成像"]','中科院生物物理所官方人才招聘目录。','critical','https://ibp.cas.cn/bgyctk/rczp/',1,6),
('cas-ibp-admissions','中国科学院生物物理研究所招生信息','listing','phd','research','["CN"]','["认知神经科学","脑功能成像","计算建模"]','中科院生物物理所官方研究生招生入口。','critical','https://ibp.cas.cn/2020jyc/zsxx/',1,6),
('casia-opportunities','中国科学院自动化研究所招聘与通知','listing','mixed','research','["CN"]','["脑图谱","类脑智能","人工智能"]','中科院自动化所官方通知与招聘入口，覆盖国家级重点实验室和研究岗位。','critical','https://www.ia.cas.cn/qtgn/tzgg/',1,6),
('casia-admissions','中国科学院自动化研究所招生信息','listing','phd','research','["CN"]','["脑图谱","类脑认知计算","脑机接口"]','中科院自动化所官方研究生招生目录。','critical','https://www.ia.cas.cn/yjsjy/zs/',1,6),
('bit-bci-center','北京理工大学脑机接口与类脑智能研究中心','detail','mixed','university','["CN"]','["脑机接口","类脑智能","认知解码"]','北理工脑机接口与类脑智能研究中心官方介绍，明确长期招收硕博、博士后和实习生。','critical','https://cs.bit.edu.cn/jgsz/jsjxy1/njjkylnznyjzx/index.htm',1,6),
('ccmu-recruit','首都医科大学招聘目录','listing','mixed','university','["CN"]','["脑重大疾病","神经科学","科研助理"]','首都医科大学官方招聘目录，持续发布科研助理、博士后和科研岗位。','high','https://www.ccmu.edu.cn/gg_12897/zp_12907/index.htm',1,12),
('mentor-fang-fang','方方｜北京大学官方主页','detail','mixed','university','["CN"]','["视觉认知","脑可塑性","脑机接口"]','北京大学 IDG 麦戈文脑科学研究所官方导师主页。','critical','https://mgv.pku.edu.cn/yjdw/aszyxck/PrincipalInvestigator/50mgv372340.htm',1,6),
('mentor-huan-luo','罗欢｜北京大学官方主页','detail','mixed','university','["CN"]','["注意","学习记忆","认知神经科学"]','北京大学心理与认知科学学院官方导师主页。','critical','https://www.psy.pku.edu.cn/szdw/qzjy/jsyjy/lh/index.htm',1,6),
('mentor-yi-jiang','蒋毅｜中国科学院心理研究所官方主页','detail','mixed','research','["CN"]','["视知觉","注意","意识"]','中国科学院心理研究所官方导师主页。','critical','https://psych.cas.cn/sourcedb/cn/expert/202312/t20231225_6926570.html',1,6),
('mentor-huiguang-he','何晖光｜中国科学院自动化研究所官方主页','detail','mixed','research','["CN"]','["脑图谱","医学影像","脑机接口"]','中国科学院自动化研究所官方导师主页。','critical','https://ia.cas.cn/rcdw/yjy/202404/t20240422_7130925.html',1,6),
('mentor-xiaorong-gao','高小榕｜清华大学脑与智能实验室官方主页','detail','mixed','university','["CN"]','["脑机接口","神经信号处理"]','清华大学脑与智能实验室官方导师主页。','critical','https://brain.tsinghua.edu.cn/info/1010/1006.htm',1,6);--> statement-breakpoint

INSERT OR IGNORE INTO `institutions`
(`id`,`source_id`,`name`,`name_en`,`institution_type`,`city`,`topics_json`,`mark`,`summary`,`note`,`url`,`opportunity_url`,`priority`,`sort_order`) VALUES
('pku-mcgovern','pku-mcgovern-recruit','北京大学 IDG 麦戈文脑科学研究所','IDG/McGovern Institute for Brain Research at PKU','university','北京','["认知神经科学","脑机接口","生物与机器智能"]','北京核心','连接心理学、脑科学、人工智能与脑机接口，官方招聘目录持续发布研究助理和研究岗位。','重点关注方方、罗欢等团队及生物与机器智能教育部重点实验室。','https://mgv.pku.edu.cn/','https://mgv.pku.edu.cn/rczp/index.htm','critical',11),
('tsinghua-thbi','mentor-xiaorong-gao','清华大学脑与智能实验室','Tsinghua Laboratory of Brain and Intelligence','university','北京','["脑科学","人工智能","脑机接口"]','北京核心','清华脑科学与人工智能交叉平台，覆盖认知、神经工程和非人灵长类研究。','与清华医学院、自动化、精密仪器等学科形成交叉机会。','https://brain.tsinghua.edu.cn/','https://brain.tsinghua.edu.cn/','critical',12),
('tsinghua-cbicr','tsinghua-cbicr-recruit','清华大学类脑计算研究中心','Center for Brain-Inspired Computing Research, Tsinghua University','university','北京','["类脑计算","神经形态芯片","类脑视觉"]','北京核心','聚焦类脑计算模型、算法、芯片和系统，官方页面长期发布博士、博士后和实习机会。','工程与算法要求较强，适合脑机接口和 NeuroAI 转型。','https://www.cbicr.tsinghua.edu.cn/','https://www.cbicr.tsinghua.edu.cn/?cat=3','critical',13),
('bnu-brain-lab','bnu-brain-recruit','北京师范大学认知神经科学与学习国家重点实验室','State Key Laboratory of Cognitive Neuroscience and Learning','national_lab','北京','["认知神经科学","学习与发展","心理学"]','国家重点实验室','以认知神经科学、学习和发展为核心，具有人才招聘与招生官方入口。','与实验心理学硕士背景高度匹配，重点关注科研助理、博士和博士后。','https://brain.bnu.edu.cn/','https://brain.bnu.edu.cn/rczp/index.htm','critical',14),
('bit-bci-neuroai','bit-bci-center','北京理工大学脑机接口与类脑智能研究中心','BIT Center for Brain-Computer Interface and Brain-Inspired Intelligence','university','北京','["脑机接口","认知解码","类脑智能"]','北京重点','围绕人工智能与脑科学开展认知功能解码、脑机接口和类脑智能研究。','官方页面明确长期招收硕博、博士后和校内外实习生。','https://cs.bit.edu.cn/jgsz/jsjxy1/njjkylnznyjzx/index.htm','https://cs.bit.edu.cn/jgsz/jsjxy1/njjkylnznyjzx/index.htm','critical',15),
('ccmu-brain-center','ccmu-recruit','首都医科大学脑重大疾病研究中心','Capital Medical University Center for Brain Disorders Research','university','北京','["脑重大疾病","临床神经科学","医学转化"]','北京重点','依托首都医科大学及附属医院开展脑重大疾病和临床转化研究。','官方招聘目录持续发布科研助理、博士后与事业编岗位。','https://www.ccmu.edu.cn/','https://www.ccmu.edu.cn/gg_12897/zp_12907/index.htm','high',16),
('cas-psych','cas-psych-recruit','中国科学院心理研究所','Institute of Psychology, Chinese Academy of Sciences','cas_institute','北京','["认知科学","心理健康","认知神经科学"]','中科院核心','中科院心理学与认知科学核心研究所，覆盖科研助理、直博、博士后和科研岗位。','官方招聘与招生信息均纳入每 6 小时重点监控。','https://www.psych.cas.cn/','https://www.psych.cas.cn/team/rczp/index.html','critical',17),
('cas-cognitive-health-lab','cas-psych-recruit','认知科学与心理健康全国重点实验室','National Key Laboratory of Cognitive Science and Mental Health','national_lab','北京','["意识","心理健康","脑机接口","类脑智能"]','全国重点实验室','依托中科院心理所和生物物理所，聚焦意识机制、心理健康评估和精准调适。','官方招聘明确覆盖脑机接口、类脑智能和青年人才岗位。','https://www.psych.cas.cn/','https://www.psych.cas.cn/team/rczp/index.html','critical',18),
('cas-ibp','cas-ibp-recruit','中国科学院生物物理研究所','Institute of Biophysics, Chinese Academy of Sciences','cas_institute','北京','["认知神经科学","神经环路","脑功能成像"]','中科院核心','覆盖认知神经、脑成像、神经环路和脑疾病机制，并参与建设认知科学与心理健康全国重点实验室。','博士招生包含认知神经科学与计算建模方向。','https://ibp.cas.cn/','https://ibp.cas.cn/bgyctk/rczp/','critical',19),
('casia','casia-opportunities','中国科学院自动化研究所','Institute of Automation, Chinese Academy of Sciences','cas_institute','北京','["脑图谱","类脑智能","医学影像","人工智能"]','中科院核心','人工智能国家战略科研机构，脑图谱与类脑智能、模式识别和医学影像方向突出。','研究生招生和国家级重点实验室岗位均进入重点监控。','https://www.ia.cas.cn/','https://www.ia.cas.cn/qtgn/tzgg/','critical',20),
('casia-complex-systems-lab','casia-opportunities','复杂系统认知与决策国家级重点实验室','National Key Laboratory of Complex Systems Cognition and Decision','national_lab','北京','["复杂系统","认知决策","博弈智能"]','国家级重点实验室','依托中科院自动化所开展复杂系统认知、决策和智能研究。','当前官方招聘以博士及高级科研岗位为主。','https://www.ia.cas.cn/','https://www.ia.cas.cn/qtgn/tzgg/','high',21);--> statement-breakpoint

UPDATE `institutions` SET `institution_type`='research_institute',`city`='北京',`topics_json`='["脑科学","类脑智能","脑机接口"]',`opportunity_url`='https://cibr.ac.cn/detail/cibrPersonneladmissions/5d82d0e8ad2347c1b78bffbbb13c802f',`priority`='critical' WHERE `id`='cibr';--> statement-breakpoint
UPDATE `institutions` SET `institution_type`='research_institute',`city`='北京',`topics_json`='["类脑智能","AI4Life","人工智能"]',`priority`='high' WHERE `id`='baai';--> statement-breakpoint
UPDATE `institutions` SET `institution_type`='university',`city`='北京',`topics_json`='["心理学","认知神经科学","脑机接口"]',`priority`='critical' WHERE `id`='pku-psych';--> statement-breakpoint
UPDATE `institutions` SET `institution_type`='university',`city`='北京',`topics_json`='["心理学","脑影像","认知与智能"]',`priority`='critical' WHERE `id`='tsinghua-pcs-institution';--> statement-breakpoint

INSERT OR IGNORE INTO `opportunities`
(`id`,`source_id`,`name`,`org`,`kind`,`status`,`fit`,`location`,`deadline`,`masters_eligible`,`eligibility_details`,`phd_bridge_details`,`why`,`action`,`tags_json`,`url`) VALUES
('pku-fang-bci-ra-2026','pku-mcgovern-recruit','方方团队脑机接口研究助理','北京大学 IDG 麦戈文脑科学研究所','科研助理','立即行动','高度匹配','北京','官方未标注截止日期｜招满为止',1,'心理学、认知神经科学、生物医学工程、计算机等相关背景；具体学历和技能按岗位核对。','可积累颅内电生理、脑成像、神经数据分析和脑机接口项目经历，为博士申请形成研究证据。','官方团队同时招聘专职研究岗、博士后与研究助理，覆盖视觉重建、语音康复、意识解码和心理健康。','立即查看官方岗位并用研究型简历突出实验范式、神经数据分析、编程和跨学科协作。','["北京","北大","科研助理","脑机接口"]','https://mgv.pku.edu.cn/rczp/bf9b7af48e13459197f453214f002571.htm'),
('tsinghua-cbicr-2027-phd','tsinghua-cbicr-recruit','清华类脑计算 2027 直博与普博','清华大学类脑计算研究中心','博士','立即行动','匹配','北京','2027 招生批次｜以官方通知为准',1,'硕士可申请普博；电子、计算机、自动化、神经科学、数学和相关背景均可关注。','适合具备编程、机器学习、神经信号或芯片系统能力的 NeuroAI / 类脑计算申请者。','中心公开招收 2027 年推免直博生及普通博士生。','查看招生招聘目录并直接联系团队，准备研究计划、代码项目和论文复现证据。','["北京","清华","博士","类脑计算"]','https://www.cbicr.tsinghua.edu.cn/?cat=3'),
('tsinghua-cbicr-intern-watch','tsinghua-cbicr-recruit','清华类脑机器人视觉科研实习','清华大学类脑计算研究中心','实习','持续关注','转型匹配','北京','长期关注｜以团队确认名额为准',1,'硕士、高年级本科及博士生均可；要求每周至少 3 天、连续 3 个月以上。','能够补充类脑视觉、机器人、深度学习和科研论文经历，但不承诺后续录取。','官方公告覆盖类脑视觉算法、机器人和数据集开发。','投递前确认岗位仍开放，并附代码仓库、项目经历和可投入时间。','["北京","清华","实习","类脑视觉"]','https://www.cbicr.tsinghua.edu.cn/?p=944'),
('bnu-brain-opportunities-watch','bnu-brain-recruit','北师大认知神经科学与学习实验室机会','北京师范大学认知神经科学与学习国家重点实验室','科研助理','持续关注','高度匹配','北京','官方目录滚动更新',1,'科研助理岗位通常接受心理学、认知神经、教育、数据科学等相关硕士背景；逐岗核对。','与实验心理学背景高度贴合，可积累行为、脑成像、EEG/MEG 和学习研究经验。','官方人才招聘目录持续发布科研助理、博士后和人才项目。','订阅招聘目录，重点关注硕士可申请、实验与数据分析并重的岗位。','["北京","北师大","科研助理","认知神经"]','https://brain.bnu.edu.cn/rczp/index.htm'),
('cas-psych-jiang-ra-2026','cas-psych-recruit','蒋毅研究组博士后或科研助理','中国科学院心理研究所','科研助理','立即行动','高度匹配','北京','官方未标注截止日期｜招满为止',1,'科研助理面向心理学、认知神经科学及相关背景；博士后岗位要求博士学位，需区分岗位职级。','可参与视知觉、注意、意识的心理物理、脑成像和神经调控研究。','官方招聘明确开放博士后或科研助理 1 名。','联系研究组前准备研究经历、方法技能和未来博士方向说明。','["北京","中科院","科研助理","视知觉"]','https://www.psych.cas.cn/team/rczp/202601/t20260105_8095749.html'),
('cas-psych-2027-phd-watch','cas-psych-admissions','中科院心理所 2027 硕博与直博','中国科学院心理研究所','博士','等待开放','高度匹配','北京','2027 招生通知待发布',1,'硕士可申请普通博士；推免生可关注直博，具体导师与方向以 2027 简章为准。','认知神经科学、学习记忆、心理健康与工程心理方向覆盖广。','2026 招生已出现认知神经科学直博名额，2027 批次需等待官方更新。','提前筛选导师并准备研究计划、论文/项目证据和推荐信。','["北京","中科院","博士","认知神经科学"]','https://www.psych.cas.cn/edu/zsxx/'),
('cas-ibp-2027-phd-watch','cas-ibp-admissions','中科院生物物理所认知神经科学博士','中国科学院生物物理研究所','博士','等待开放','高度匹配','北京','2027 招生目录待发布',1,'硕士可申请部分认知神经科学方向；个别导师仅招硕转博，必须逐项核对备注。','覆盖视知觉、意识、脑成像、社会认知、计算建模和运动学习。','官方招生目录包含认知神经科学博士方向。','等待 2027 目录并提前联系导师，避免误投仅限硕转博的方向。','["北京","中科院","博士","脑成像"]','https://ibp.cas.cn/2020jyc/zsxx/'),
('casia-2027-brain-ai-phd-watch','casia-admissions','中科院自动化所脑图谱与类脑智能博士','中国科学院自动化研究所','博士','等待开放','匹配','北京','2027 招生目录待发布',1,'硕士可申请普通博士；更偏人工智能、模式识别、医学影像和计算方法。','适合有 Python、机器学习、脑影像或神经信号分析能力的转型申请者。','自动化所具备脑图谱、类脑认知计算和智能生物医学影像方向。','提前联系脑图谱与类脑智能实验室导师并准备代码与研究成果。','["北京","中科院","博士","类脑智能"]','https://www.ia.cas.cn/yjsjy/zs/'),
('bit-bci-intern-phd-watch','bit-bci-center','北理工脑机接口与类脑智能长期机会','北京理工大学脑机接口与类脑智能研究中心','实习','立即行动','匹配','北京','长期招收｜联系团队确认名额',1,'长期招收校内外实习生、硕士和博士；硕士申请者可从科研实习或博士申请路径进入。','可形成脑数据分析、认知解码和类脑智能项目经验。','官方中心页明确长期招收硕博、博士后和实习生。','根据自身阶段投递，突出深度学习、脑科学基础、竞赛或科研成果。','["北京","北理工","实习","脑机接口"]','https://cs.bit.edu.cn/jgsz/jsjxy1/njjkylnznyjzx/index.htm'),
('ccmu-brain-ra-watch','ccmu-recruit','首都医科大学脑科学科研助理滚动岗位','首都医科大学','科研助理','持续关注','匹配','北京','官方招聘目录滚动更新',1,'硕士可申请其中明确标注科研助理或非事业编科研岗位；临床岗位资格需单独核对。','适合希望积累临床神经科学、脑疾病数据或医学转化经验的申请者。','官方招聘目录持续出现科研助理、博士后和脑重大疾病相关岗位。','重点检索脑科学、神经、人工智能、科研助理，并核对医院/校本部要求。','["北京","首医","科研助理","脑疾病"]','https://www.ccmu.edu.cn/gg_12897/zp_12907/index.htm'),
('casia-key-lab-role-2026','casia-opportunities','复杂系统认知与决策国家级重点实验室科研岗位','中国科学院自动化研究所','研究岗位','立即行动','转型匹配','北京','以官方公告为准',0,'当前公告以具有博士学位及相应科研经历的高级科技岗位为主。',NULL,'聚焦复杂系统认知、博弈智能和决策，是北京国家级重点实验室相关机会。','博士及以上申请者按官方岗位要求准备；硕士阶段以其招生目录为主。','["北京","全国重点实验室","认知决策","研究岗位"]','https://www.ia.cas.cn/qtgn/tzgg/202604/t20260408_8182639.html');--> statement-breakpoint

INSERT OR IGNORE INTO `researchers`
(`id`,`slug`,`name`,`name_zh`,`institution`,`department`,`role`,`region`,`city`,`profile_url`,`topics_json`,`methods_json`,`summary`,`application_value`,`recruitment_status`,`priority`) VALUES
('r-fang-fang','fang-fang','Fang Fang','方方','Peking University','IDG/McGovern Institute for Brain Research','Professor','CN','Beijing','https://mgv.pku.edu.cn/yjdw/aszyxck/PrincipalInvestigator/50mgv372340.htm','["视觉认知","脑可塑性","脑机接口"]','["多模态脑成像","颅内电生理","心理物理","计算建模"]','研究视觉认知、脑可塑性以及侵入式和非侵入式脑机接口。','北大核心导师，当前官方团队招聘研究助理与研究岗位。','open','critical'),
('r-huan-luo','huan-luo','Huan Luo','罗欢','Peking University','School of Psychological and Cognitive Sciences','Professor','CN','Beijing','https://www.psy.pku.edu.cn/szdw/qzjy/jsyjy/lh/index.htm','["注意","学习记忆","认知结构"]','["心理学实验","EEG","MEG","计算建模"]','研究注意、记忆、学习和决策的人脑认知神经机制。','实验心理学背景高度匹配，官方主页明确欢迎博士申请。','open','critical'),
('r-yi-jiang','yi-jiang','Yi Jiang','蒋毅','Chinese Academy of Sciences','Institute of Psychology','Professor','CN','Beijing','https://psych.cas.cn/sourcedb/cn/expert/202312/t20231225_6926570.html','["视知觉","注意","意识"]','["心理物理","fMRI","EEG","MEG","神经调控"]','研究视知觉、注意、意识及其认知神经机制。','中科院心理所核心导师，当前研究组有科研助理或博士后机会。','open','critical'),
('r-huiguang-he','huiguang-he','Huiguang He','何晖光','Chinese Academy of Sciences','Institute of Automation','Professor','CN','Beijing','https://ia.cas.cn/rcdw/yjy/202404/t20240422_7130925.html','["脑图谱","医学影像","脑机接口"]','["机器学习","医学影像分析","脑电"]','研究人工智能、医学影像分析与脑机接口。','适合计算能力较强、希望从心理学转向脑影像和 NeuroAI 的申请者。','watch','critical'),
('r-xiaorong-gao','xiaorong-gao','Xiaorong Gao','高小榕','Tsinghua University','Tsinghua Laboratory of Brain and Intelligence','Professor','CN','Beijing','https://brain.tsinghua.edu.cn/info/1010/1006.htm','["脑机接口","神经信号处理"]','["EEG","信号处理","非侵入式脑机接口"]','研究脑机接口及神经信号检测与处理。','清华核心脑机接口导师，适合具备信号处理与实验能力的申请者。','watch','critical');--> statement-breakpoint

INSERT OR IGNORE INTO `researcher_sources` (`researcher_id`,`source_id`,`relation`) VALUES
('r-fang-fang','mentor-fang-fang','official_profile'),
('r-huan-luo','mentor-huan-luo','official_profile'),
('r-yi-jiang','mentor-yi-jiang','official_profile'),
('r-huiguang-he','mentor-huiguang-he','official_profile'),
('r-xiaorong-gao','mentor-xiaorong-gao','official_profile');
