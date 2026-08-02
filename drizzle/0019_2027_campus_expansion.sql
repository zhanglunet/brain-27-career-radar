UPDATE sources SET
  name='百度 2027 校园招聘',
  url='https://talent.baidu.com/jobs/list?projectType=3&recruitType=GRADUATE',
  topics_json='["2027届","文心","大模型","自动驾驶","算法"]',
  description='百度官方 2027 校园招聘，明确覆盖 2026-09-01 至 2027-08-31 毕业的海内外学生。',
  priority='critical',check_interval_hours=6,updated_at=CURRENT_TIMESTAMP
WHERE id='baidu-campus';
--> statement-breakpoint
UPDATE sources SET
  topics_json='["2027届","顶尖AI人才","盘古","昇腾","校招"]',
  description='华为官方校园招聘，当前明确展示 2027 届顶尖 AI 人才招聘专项。',
  priority='critical',check_interval_hours=6,updated_at=CURRENT_TIMESTAMP
WHERE id='huawei-campus';
--> statement-breakpoint
UPDATE sources SET
  topics_json='["2027届","通义千问","AI+云","算法","校招"]',
  description='阿里巴巴官方 2027 届校园招聘，覆盖 2026-11 至 2027-10 毕业的海内外应届生。',
  priority='critical',check_interval_hours=6,updated_at=CURRENT_TIMESTAMP
WHERE id='alibaba-campus';
--> statement-breakpoint
UPDATE sources SET
  name='Kimi / 月之暗面校园招聘',url='https://careers.kimi.com/campus',coverage='campus',
  topics_json='["Kimi","基础模型","校园招聘","算法","研发"]',
  description='月之暗面官方校园招聘入口；具体毕业批次和岗位资格逐岗核对。',
  priority='critical',check_interval_hours=6,updated_at=CURRENT_TIMESTAMP
WHERE id='kimi-careers';
--> statement-breakpoint
UPDATE sources SET
  name='智谱 GLM 校园招聘',url='https://www.zhipuai.cn/zh/joinus',coverage='campus',
  topics_json='["GLM","强化学习","大模型","校园招聘","研发"]',
  description='智谱官方加入我们页面，明确提供算法、研发和运营校园招聘入口。',
  priority='critical',check_interval_hours=6,updated_at=CURRENT_TIMESTAMP
WHERE id='zhipu-careers';
--> statement-breakpoint
UPDATE sources SET
  name='MiniMax 2027 校园招聘',url='https://www.minimax.io/careers',coverage='campus',
  topics_json='["2027届","MiniMax","多模态","语音","大模型"]',
  description='MiniMax 官方 2027 Campus Recruitment，明确面向 2027 届毕业生。',
  priority='critical',check_interval_hours=6,updated_at=CURRENT_TIMESTAMP
WHERE id='minimax-official';
--> statement-breakpoint
INSERT OR IGNORE INTO sources
(id,name,source_type,coverage,organization_type,regions_json,topics_json,description,priority,url,trust_level,enabled,check_interval_hours) VALUES
('alibaba-cloud-2027-campus','阿里云 2027 实习生招聘','listing','campus','company','["CN","HK"]','["2027届","阿里云","大模型","云计算","实习"]','阿里云官方 Class of 2027 Internships 入口。','critical','https://careers.aliyun.com/campus/home?lang=zh',100,1,6),
('shlab-2027-campus','上海人工智能实验室校园招聘','listing','campus','research','["CN"]','["2027届","大模型","具身智能","AI for Science","实习"]','上海人工智能实验室官方校园招聘入口，用于跟踪 2027 届实习和后续校招。','critical','https://www.shlab.org.cn/joinus/campus',100,1,6),
('arm-uk-early-careers','Arm 英国 Graduate 与 Intern','listing','campus','company','["UK"]','["2027届","Graduate","AI/ML","芯片","Cambridge"]','Arm 英国官方 Early Careers 页面；下一轮 Graduate 和 Intern 岗位于 2026 年 9—10 月起开放。','critical','https://careers.arm.com/arm-united-kingdom',100,1,6),
('apple-students-uk-cn','Apple 英国与中国学生岗位','listing','campus','company','["UK","CN"]','["机器学习","生成式AI","芯片","实习","学生岗位"]','Apple 官方学生岗位搜索，覆盖伦敦、剑桥、北京、上海和深圳等地点。','high','https://jobs.apple.com/en-gb/search?team=internships-STDNT-INTRN',100,1,12),
('nvidia-early-careers-uk-cn','NVIDIA 实习与 New College Graduate','listing','campus','company','["UK","CN"]','["生成式AI","加速计算","机器人","实习","应届生"]','NVIDIA 官方职位入口，用于跟踪英国与中国的实习和 New College Graduate 岗位。','high','https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',100,1,12),
('msra-careers','微软亚洲研究院人才机会','listing','mixed','research','["CN"]','["Microsoft Research Asia","大模型","机器学习","研究实习"]','微软亚洲研究院官方人才页面，跟踪北京、上海的研究实习与早期职业机会。','critical','https://www.microsoft.com/en-us/research/lab/microsoft-research-asia/careers/',100,1,6),
('alan-turing-opportunities','Alan Turing Institute Opportunities','listing','mixed','research','["UK"]','["数据科学","人工智能","研究岗位","博士机会"]','英国国家数据科学与人工智能研究所官方机会目录。','high','https://www.turing.ac.uk/opportunities-turing',100,1,12);
--> statement-breakpoint
UPDATE sources SET
  url='https://careers.microsoft.com/v2/global/en/students',regions_json='["UK","IE","CN"]',
  topics_json='["Early in Profession","AI","软件工程","英国校招"]',
  description='Microsoft Early in Profession 官方入口，跟踪英国、爱尔兰及中国的学生和应届岗位。',
  priority='high',check_interval_hours=12,updated_at=CURRENT_TIMESTAMP
WHERE id='microsoft-early-careers-uk-ie';
--> statement-breakpoint
UPDATE sources SET
  url='https://www.amazon.jobs/content/en/career-programs/university',
  topics_json='["Applied Scientist","生成式AI","机器学习","University Talent"]',
  description='Amazon University Talent 官方入口，跟踪英国 Applied Scientist、机器学习和工程岗位。',
  priority='high',check_interval_hours=12,updated_at=CURRENT_TIMESTAMP
WHERE id='amazon-student-science-emea';
--> statement-breakpoint
INSERT OR IGNORE INTO institutions
(id,source_id,name,name_en,institution_type,city,topics_json,mark,summary,note,url,opportunity_url,priority,sort_order,published,source_verified_at) VALUES
('company-arm-uk','arm-uk-early-careers','Arm 英国','Arm UK','company','Cambridge / London','["AI/ML","芯片","边缘计算"]','国外大厂','英国领先芯片与计算平台公司，在剑桥、曼彻斯特、谢菲尔德和布里斯托设有团队。','Graduate 与 Intern 通常在每年 9—10 月起开放。','https://www.arm.com/','https://careers.arm.com/arm-united-kingdom','critical',210,1,'2026-08-02T00:00:00.000Z'),
('company-apple-uk-cn','apple-students-uk-cn','Apple 英国与中国','Apple UK & China','company','London / Cambridge / 北京 / 上海 / 深圳','["机器学习","生成式AI","芯片"]','国外大厂','英国和中国均有机器学习、硬件与软件学生岗位。','逐岗核对毕业时间、返校要求与工作许可。','https://www.apple.com/careers/','https://jobs.apple.com/en-gb/search?team=internships-STDNT-INTRN','high',220,1,'2026-08-02T00:00:00.000Z'),
('company-nvidia-uk-cn','nvidia-early-careers-uk-cn','NVIDIA 英国与中国','NVIDIA UK & China','company','UK / 北京 / 上海 / 深圳','["生成式AI","加速计算","机器人"]','国外大厂','持续跟踪实习与 New College Graduate 的 AI、系统和研究岗位。','地点和毕业批次以岗位页为准。','https://www.nvidia.com/','https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite','high',230,1,'2026-08-02T00:00:00.000Z'),
('research-msra','msra-careers','微软亚洲研究院','Microsoft Research Asia','research_institute','北京 / 上海','["大模型","机器学习","人机交互","研究实习"]','国外研究机构在中国','国际工业研究院在中国的重要入口。','重点筛选 Research Intern、Researcher 和工程研究岗位。','https://www.microsoft.com/en-us/research/lab/microsoft-research-asia/','https://www.microsoft.com/en-us/research/lab/microsoft-research-asia/careers/','critical',235,1,'2026-08-02T00:00:00.000Z'),
('research-alan-turing','alan-turing-opportunities','艾伦·图灵研究所','The Alan Turing Institute','research_institute','London','["数据科学","人工智能","公共政策"]','英国国家研究机构','英国国家数据科学与人工智能研究所。','职位、博士机会和项目批次在统一官方目录持续更新。','https://www.turing.ac.uk/','https://www.turing.ac.uk/opportunities-turing','high',240,1,'2026-08-02T00:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO opportunities
(id,source_id,name,org,kind,status,fit,location,deadline,deadline_status,opens_at,masters_eligible,eligibility_details,phd_bridge_details,why,action,tags_json,url,published,source_verified_at) VALUES
('baidu-2027-global-campus','baidu-campus','百度 2027 届全球校园招聘','百度 / 文心','校招','立即行动','匹配','北京 / 上海 / 深圳 / 全国','2027 届批次｜滚动投递','rolling',NULL,1,'面向 2026-09-01 至 2027-08-31 毕业的海内外学生，具体专业和学历以岗位为准。',NULL,'官方目录包含大模型 Agent、VLM/VLA、自动驾驶和算法岗位。','优先筛选大模型、机器学习、认知智能、数据科学和研究工程岗位。','["2027校招专题","赛道:国内大厂","赛道:大模型厂商","百度","文心","2027届"]','https://talent.baidu.com/jobs/list?projectType=3&recruitType=GRADUATE',1,'2026-08-02T00:00:00.000Z'),
('huawei-2027-top-ai-campus','huawei-campus','华为 2027 届顶尖 AI 人才招聘专项','华为 / 盘古 / 诺亚方舟实验室','校招','立即行动','匹配','北京 / 上海 / 深圳 / London / 全国','2027 届专项｜滚动投递','rolling',NULL,1,'面向 2027 届优秀 AI 人才；学历、专业和工作地点按具体岗位核对。',NULL,'覆盖 AI、数智化、超级计算、盘古与昇腾等前沿方向。','进入官方校园招聘筛选 AI、算法、研究和目标城市岗位。','["2027校招专题","赛道:国内大厂","赛道:大模型厂商","华为","盘古","2027届"]','https://career.huawei.com/cn/campus-recruitment',1,'2026-08-02T00:00:00.000Z'),
('alibaba-2027-campus','alibaba-campus','阿里巴巴 2027 届校园招聘','阿里巴巴 / 通义千问','校招','立即行动','匹配','杭州 / 北京 / 上海 / 深圳 / 海外','面向 2026.11—2027.10 毕业生','rolling',NULL,1,'面向 2026 年 11 月至 2027 年 10 月毕业的海内外应届生。',NULL,'集团以 AI 驱动为战略，岗位覆盖大模型、算法、云计算与 AI 应用。','筛选通义千问、达摩院、AI+云、算法和研究工程方向。','["2027校招专题","赛道:国内大厂","赛道:大模型厂商","阿里巴巴","通义千问","2027届"]','https://campus-talent.alibaba.com/',1,'2026-08-02T00:00:00.000Z'),
('alibaba-cloud-2027-intern','alibaba-cloud-2027-campus','阿里云 2027 届实习生招聘','阿里云','实习','立即行动','匹配','杭州 / 北京 / 上海 / 深圳','2027 届实习｜滚动投递','rolling',NULL,1,'官方 Class of 2027 Internships；具体毕业窗口和转正规则按岗位核对。','实习可积累大模型训练、云计算和工程项目证据，但转正取决于岗位考核。','阿里云提供大模型训练、微调、推理与云平台研发场景。','优先投递大模型、机器学习平台、数据智能和云基础设施岗位。','["2027校招专题","赛道:国内大厂","赛道:大模型厂商","阿里云","实习","2027届"]','https://careers.aliyun.com/campus/home?lang=zh',1,'2026-08-02T00:00:00.000Z'),
('minimax-2027-campus','minimax-official','MiniMax 2027 Campus Recruitment','MiniMax','校招','立即行动','匹配','上海 / 北京 / 海外','官方 2027 Campus Recruitment｜滚动','rolling',NULL,1,'官方明确面向 2027 届毕业生且不限定具体毕业日期；具体岗位要求单独核对。',NULL,'覆盖多模态、语音、视频、基础模型、智能体和工程平台。','在官方 Careers 选择 Graduate Recruitment 2027 并按研究/工程方向投递。','["2027校招专题","赛道:大模型厂商","MiniMax","多模态","2027届"]','https://www.minimax.io/careers',1,'2026-08-02T00:00:00.000Z'),
('shlab-2027-intern','shlab-2027-campus','上海人工智能实验室 2027 届实习生招聘','上海人工智能实验室','实习','立即行动','匹配','上海','2027 届实习｜岗位滚动更新','rolling',NULL,1,'面向 2027 届学生的实习岗位，具体学历、专业和时长以岗位说明为准。','可积累大模型、具身智能、AI for Science 与科研工程经历。','研究方向覆盖大模型、具身智能、安全可信 AI、AI for Science 和基础平台。','查看官方校园招聘目录，优先筛选研究、算法、工程与科学智能岗位。','["2027校招专题","赛道:国内研究机构","上海AI实验室","实习","2027届"]','https://www.shlab.org.cn/joinus/campus',1,'2026-08-02T00:00:00.000Z'),
('arm-uk-2027-graduate-watch','arm-uk-early-careers','Arm UK 2027 Graduate / Intern','Arm','校招','等待开放','转型匹配','Cambridge / Manchester / Sheffield / Bristol','预计 2026 年 9—10 月起开放','estimated','2026-09-01T00:00:00',1,'Graduate 和 Intern 的专业、毕业年份及工作许可要求以开放后的岗位页为准。',NULL,'方向覆盖 AI/ML、芯片、编译器、系统和边缘计算，适合强化编程与工程证据后转型。','8 月完成英文 CV、代码项目和英国工作许可判断；9 月起每周检查。','["2027校招专题","赛道:国外大厂","Arm","英国","Graduate"]','https://careers.arm.com/arm-united-kingdom',1,'2026-08-02T00:00:00.000Z'),
('kimi-campus-2027-watch','kimi-careers','Kimi / 月之暗面校园招聘','Kimi / 月之暗面','校招','持续关注','匹配','北京 / 上海 / 深圳','校园招聘持续开放｜毕业批次逐岗核对','unknown',NULL,1,'官方有独立 Campus Recruiting 页面，但没有统一公布 2027 毕业窗口。',NULL,'覆盖基础模型、训练系统、推理、多模态和产品工程。','进入 Campus Recruiting 按岗位核对毕业时间，不把通用入口当成已确认 2027 批次。','["2027校招专题","赛道:大模型厂商","Kimi","校园招聘","批次待确认"]','https://careers.kimi.com/campus',1,'2026-08-02T00:00:00.000Z'),
('zhipu-campus-2027-watch','zhipu-careers','智谱 GLM 校园招聘','智谱 AI / GLM','校招','持续关注','匹配','北京 / 上海 / 深圳 / 杭州 / 成都','校园招聘持续开放｜毕业批次逐岗核对','unknown',NULL,1,'官方页面提供算法、研发和运营校招，但 2027 统一毕业窗口待岗位页确认。',NULL,'算法岗位涉及训练框架和策略，研发岗位涉及强化学习训练框架。','优先核对算法、研发和大模型方向的学历、毕业时间与地点。','["2027校招专题","赛道:大模型厂商","智谱","GLM","批次待确认"]','https://www.zhipuai.cn/zh/joinus',1,'2026-08-02T00:00:00.000Z'),
('tencent-2027-campus-watch','tencent-campus','腾讯 2027 届校园招聘观察','腾讯 / 混元 / AI Lab','校招','等待开放','匹配','深圳 / 北京 / 上海 / 香港','当前官网仍为 2026 批次｜等待 2027 更新','unknown',NULL,1,'2027 届统一批次尚未在当前官方页确认；在校生可核对实习岗位。',NULL,'混元、腾讯 AI Lab、算法与数据岗位值得重点跟踪。','先准备项目与算法面试；系统监测官方页面由 2026 切换到 2027。','["2027校招专题","赛道:国内大厂","赛道:大模型厂商","腾讯","混元","等待开放"]','https://careers.tencent.com/campusrecruit.html',1,'2026-08-02T00:00:00.000Z'),
('deepseek-campus-watch','deepseek-careers','DeepSeek 校园与早期职业机会观察','DeepSeek 深度求索','研究岗位','持续关注','匹配','杭州 / 北京','官方岗位滚动更新｜校招批次待确认','unknown',NULL,1,'官方人才站持续发布岗位；是否接受 2027 届必须以具体职位要求为准。',NULL,'基础模型、推理、代码和强化学习与研究型申请高度相关。','只投明确接受应届生或实习生的岗位，并保存岗位页证据。','["2027校招专题","赛道:大模型厂商","DeepSeek","强化学习","批次待确认"]','https://talent.deepseek.com/',1,'2026-08-02T00:00:00.000Z'),
('microsoft-uk-early-career-watch','microsoft-early-careers-uk-ie','Microsoft UK Early in Profession','Microsoft','校招','持续关注','转型匹配','London / Cambridge / Reading / Dublin','按官方 Early in Profession 批次开放','unknown',NULL,1,'面向学生和近期毕业生；每个岗位的学位、毕业时间和工作许可要求不同。',NULL,'覆盖 AI、软件工程、数据、云平台和研究生态。','筛选 United Kingdom、AI、Software Engineering 与 Research；单独核对签证。','["2027校招专题","赛道:国外大厂","Microsoft","英国","Early Career"]','https://careers.microsoft.com/v2/global/en/students',1,'2026-08-02T00:00:00.000Z'),
('amazon-uk-university-watch','amazon-student-science-emea','Amazon UK University Talent / Applied Scientist','Amazon / Amazon Science','实习','持续关注','转型匹配','London / Cambridge / UK','下一年度批次待开放','unknown',NULL,1,'University Talent 岗位逐项标注本科、硕士或博士要求；Applied Scientist 常偏硕博。','研究实习可积累机器学习、生成式 AI 和应用科学证据。','英国长期出现机器学习、生成式 AI、语音、机器人和 Applied Scientist 机会。','订阅 University Talent，按 UK、Applied Scientist、Machine Learning 过滤。','["2027校招专题","赛道:国外大厂","Amazon","英国","Applied Scientist"]','https://www.amazon.jobs/content/en/career-programs/university',1,'2026-08-02T00:00:00.000Z'),
('apple-uk-ml-student-watch','apple-students-uk-cn','Apple UK Machine Learning Student Roles','Apple','实习','持续关注','转型匹配','London / Cambridge','学生岗位滚动更新','rolling',NULL,1,'部分实习要求结束后返校，部分允许作为毕业最后要求；具体以岗位页为准。','可积累生成式 AI、机器学习、GPU、芯片和软件工程经历。','Apple 英国学生岗位持续出现机器学习、生成式 AI、GPU 与计算机视觉方向。','筛选 UK、Students、Machine Learning；逐岗记录截止日期和返校条件。','["2027校招专题","赛道:国外大厂","Apple","英国","机器学习"]','https://jobs.apple.com/en-gb/search?location=united-kingdom-GBR&team=internships-STDNT-INTRN',1,'2026-08-02T00:00:00.000Z'),
('apple-china-student-watch','apple-students-uk-cn','Apple 中国学生与机器学习相关实习','Apple','实习','持续关注','转型匹配','北京 / 上海 / 深圳','学生岗位滚动更新','rolling',NULL,1,'岗位可能要求在读和返校，毕业时间与专业逐岗核对。','适合作为进入国际大厂中国研发团队的过渡路径。','官方学生职位会出现 AI 工具、软件、硬件和机器学习相关机会。','筛选 Beijing、Shanghai、Shenzhen 与 Students，并核对是否适合 2027 届。','["2027校招专题","赛道:国外大厂","Apple","中国","实习"]','https://jobs.apple.com/zh-cn/search?team=internships-STDNT-INTRN',1,'2026-08-02T00:00:00.000Z'),
('nvidia-uk-cn-new-grad-watch','nvidia-early-careers-uk-cn','NVIDIA UK / China Intern & New College Graduate','NVIDIA','校招','持续关注','转型匹配','UK / 北京 / 上海 / 深圳','岗位滚动更新｜毕业批次逐岗核对','rolling',NULL,1,'实习和 New College Graduate 对学位、毕业时间及地点要求不同。',NULL,'覆盖生成式 AI、加速计算、机器人、自动驾驶和研究工程。','在官方职位站筛选 Intern、New College Graduate、UK 或 China。','["2027校招专题","赛道:国外大厂","NVIDIA","英国","中国"]','https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',1,'2026-08-02T00:00:00.000Z'),
('msra-early-career-watch','msra-careers','微软亚洲研究院研究实习与早期职业机会','微软亚洲研究院','实习','持续关注','匹配','北京 / 上海','岗位滚动更新｜资格逐岗核对','rolling',NULL,1,'研究实习通常要求在读，正式研究岗位可能要求博士；具体以岗位为准。','研究实习可积累论文、研究工程与国际工业研究院合作经验。','覆盖大模型、机器学习、人机交互、计算机视觉和系统研究。','重点筛选 Research Intern 和适合硕士的工程研究岗位，避免误投博士门槛岗位。','["2027校招专题","赛道:国外研究机构在中国","Microsoft Research Asia","研究实习"]','https://www.microsoft.com/en-us/research/lab/microsoft-research-asia/careers/',1,'2026-08-02T00:00:00.000Z'),
('alan-turing-2027-research-watch','alan-turing-opportunities','Alan Turing Institute 研究与早期职业机会','The Alan Turing Institute','研究岗位','持续关注','转型匹配','London','职位和项目按批次更新','rolling',NULL,1,'研究、技术、博士和项目机会资格不同；部分岗位可能要求英国工作权。',NULL,'英国国家数据科学与 AI 研究所，适合关注 Research Assistant、Research Engineer 与项目岗位。','订阅官方 Opportunities；仅投学历和工作许可满足的具体岗位。','["2027校招专题","赛道:英国研究机构","Alan Turing Institute","AI","研究岗位"]','https://www.turing.ac.uk/opportunities-turing',1,'2026-08-02T00:00:00.000Z'),
('crick-2027-research-jobs-watch','crick-phd-programme','Francis Crick Institute 研究岗位观察','The Francis Crick Institute','研究岗位','持续关注','匹配','London','研究岗位滚动更新','rolling',NULL,1,'Research Assistant、技术和项目岗位的学历及专业要求逐岗核对。','可积累生物医学、神经科学、数据分析和实验研究经验。','国际化生物医学研究机构，适合寻找硕士可申请的实验或数据研究岗位。','使用 Careers & Study 官方入口筛选 Research 与 Technical 岗位。','["2027校招专题","赛道:英国研究机构","Francis Crick Institute","神经科学","研究岗位"]','https://www.crick.ac.uk/careers-study',1,'2026-08-02T00:00:00.000Z');
--> statement-breakpoint
UPDATE opportunities SET tags_json='["2027校招专题","赛道:大模型厂商","赛道:国内大厂","字节跳动","豆包","Seed","2027届"]',updated_at=CURRENT_TIMESTAMP
WHERE id='bytedance-frontier-talent-2027';
--> statement-breakpoint
UPDATE opportunities SET tags_json='["2027校招专题","赛道:国内研究机构","上海AI实验室","实习","联培博士","2027届"]',updated_at=CURRENT_TIMESTAMP
WHERE id='shlab-2027-intern';
--> statement-breakpoint
UPDATE opportunities SET tags_json='["2027校招专题","赛道:国外大厂","Google DeepMind","Student Researcher","英国"]',updated_at=CURRENT_TIMESTAMP
WHERE id='google-deepmind-student-researcher-watch';
--> statement-breakpoint
UPDATE opportunities SET tags_json='["2027校招专题","赛道:国外大厂","OpenAI","Emerging Talent","Residency"]',updated_at=CURRENT_TIMESTAMP
WHERE id='openai-emerging-talent-watch';
--> statement-breakpoint
PRAGMA optimize;
