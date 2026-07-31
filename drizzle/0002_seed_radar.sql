INSERT OR IGNORE INTO sources (id, name, source_type, url) VALUES
('baai-joint-phd', '北京智源人工智能研究院 2027 联培博士', 'detail', 'https://hub.baai.ac.cn/view/54026'),
('cibr-admissions', '北京脑科学与类脑研究所招生', 'detail', 'https://cibr.ac.cn/detail/cibrPersonneladmissions/5d82d0e8ad2347c1b78bffbbb13c802f'),
('tsinghua-pcs', '清华大学心理与认知科学系招生', 'detail', 'https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm'),
('shlab-joint-phd', '上海人工智能实验室联培博士', 'detail', 'https://www.shlab.org.cn/news/5444256'),
('tju-sz-biomedical', '天津大学深圳未来技术学院招生', 'detail', 'https://sz.tju.edu.cn/zsxx/sbzs/zysz2.htm'),
('tsinghua-sigs', '清华深圳国际研究生院招生', 'detail', 'https://www.sigs.tsinghua.edu.cn/2026/0630/c7769a291927/page.htm'),
('hit-bigai', '哈工大与通研院联合培养', 'detail', 'https://yzb.hit.edu.cn/2026/0708/c19935a396468/page.htm'),
('sjtu-psych', '上海交通大学心理学院招生', 'listing', 'https://psychology.sjtu.edu.cn/zsxx.html'),
('oppo-health-ml', 'OPPO 健康机器学习岗位', 'detail', 'https://careers.oppo.com/university/oppo/campus/post/1615?recruitType=Intern'),
('oppo-health-algorithm', 'OPPO 健康算法岗位', 'detail', 'https://careers.oppo.com/university/oppo/campus/post/1611?recruitType=Graduate'),
('brainco-recruit', 'BrainCo 招聘', 'listing', 'https://www.brainco.cn/recruit'),
('neuroxess-jobs', '脑虎科技招聘', 'listing', 'https://www.neuroxess.com/join-us/'),
('bytedance-seed', '字节跳动 Seed Early Career', 'listing', 'https://seed.bytedance.com/zh/seedearlycareer'),
('shlab-jobs', '上海人工智能实验室招聘', 'listing', 'https://www.shlab.org.cn/joinus'),
('tsinghua-pengcheng', '鹏城国家实验室工程博士联培', 'detail', 'https://yzbm.tsinghua.edu.cn/publish/s03/s0302/detail/2581f75f-63ec-4d59-ba1f-8126bdd7a855?yxsdm=599');

INSERT OR IGNORE INTO opportunities
(id, source_id, name, org, kind, status, fit, location, deadline, why, action, tags_json, url) VALUES
('baai-2027-joint-phd', 'baai-joint-phd', '2027 级联合培养博士', '北京智源人工智能研究院', '联培博士', '立即行动', '高度匹配', '北京', '已启动｜滚动初筛', '方向覆盖生命大模型、类脑智能、AI4Life、世界模型与具身智能。硕士生可走申请—考核制，与北大、人大、中科院自动化所等单位联培。', '发送学术简历，突出实验范式、脑数据分析和 AI 交叉潜力；同步确认对应联培高校与导师。', '["类脑智能","AI4Life","申请考核","双导师"]', 'https://hub.baai.ac.cn/view/54026'),
('cibr-2027-phd', 'cibr-admissions', '2027 普通招考博士', '北京脑科学与类脑研究所', '博士', '等待开放', '高度匹配', '北京', '预计 2026.10—11 发布', '与北大、北师大、北理工、协和、首医联招；硕士起点可申请。覆盖心理学、神经生物学、生物医学工程与脑机接口，入学后轮转定导。', '8—9 月筛选实验室；10 月起盯招生公告。心理学通道优先关注北师大联培项目。', '["实验心理学","认知神经","脑机接口","轮转定导"]', 'https://cibr.ac.cn/detail/cibrPersonneladmissions/5d82d0e8ad2347c1b78bffbbb13c802f'),
('tsinghua-pcs-2027-phd', 'tsinghua-pcs', '2027 博士研究生', '清华大学心理与认知科学系', '博士', '等待开放', '高度匹配', '北京', '第二批或于 2026.11.01—11.30 开放', '最贴近实验心理学、脑影像、认知与智能。第一批已结束；只有第一批未招满时才开放第二批。', '现在完成 5000 字研究计划、1500 字研究兴趣陈述，并提前落实两封专家推荐信。', '["心理学","脑影像","认知与智能","申请考核"]', 'https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm'),
('shlab-2027-joint-phd', 'shlab-joint-phd', '2027 级联合培养博士', '上海人工智能实验室', '联培博士', '立即行动', '匹配', '上海', '已启动｜以联培高校为准', '与清华、北大、复旦、上交、浙大等十余所高校联培；AI for Science 明确包括神经科学，另有认知推理与世界模型方向。', '从神经科学 × AI 切入，优先匹配 AI for Science 或可信认知方向，提交招生系统并邮件咨询。', '["神经科学","AI for Science","世界模型","联培"]', 'https://www.shlab.org.cn/news/5444256'),
('tju-sz-biomedical-phd', 'tju-sz-biomedical', '生物医学工程博士', '天津大学—香港理工大学深圳未来技术学院', '博士', '等待开放', '高度匹配', '深圳', '2027 招生细则待发布', '直接覆盖脑信号获取与解码、神经调控、脑—机—体交互和医学人工智能，采用双校联合指导。', '尽快咨询导师与招生批次；用 EEG/行为实验项目证明跨入工程研究的能力。', '["脑机接口","神经调控","医学AI","双校培养"]', 'https://sz.tju.edu.cn/zsxx/sbzs/zysz2.htm'),
('tsinghua-sigs-bci-phd', 'tsinghua-sigs', '脑机接口 / 类脑计算博士方向', '清华大学深圳国际研究生院', '博士', '等待开放', '匹配', '深圳', '第一批已结束；第二批视名额开放', '2027 目录包含忆阻器存算一体、脑机接口和类脑计算，工程与算法色彩较强。', '若已有信号处理或深度学习成果，准备第二批；否则将它作为冲刺项。', '["类脑计算","脑机接口","深度学习","工程"]', 'https://www.sigs.tsinghua.edu.cn/2026/0630/c7769a291927/page.htm'),
('hit-bigai-2027-joint-phd', 'hit-bigai', '2027 联培博士『通计划』', '北京通用人工智能研究院 × 哈尔滨工业大学', '联培博士', '持续关注', '转型匹配', '哈尔滨 / 北京', '后续按学院通知', '聚焦多智能体、通用视觉、机器人、语言交互、认知与推理、混合智能；目前公布专业为机械工程、数学，拟招 2 人。', '仅在数学、建模和编程基础较强时投入；申请前需同时联系校内与研究院导师。', '["认知推理","通用智能","双导师","强工程"]', 'https://yzb.hit.edu.cn/2026/0708/c19935a396468/page.htm'),
('sjtu-psych-phd', 'sjtu-psych', '心理学申请—考核博士', '上海交通大学心理学院', '博士', '持续关注', '高度匹配', '上海', '2027 普博简章待发布', '学院以心理学 + AI 为特色，布局脑与认知科学、临床健康心理及跨学科研究。', '持续查看招生页；提前按往年申请—考核结构准备论文、研究计划和英语材料。', '["心理学+AI","脑与认知","临床心理","申请考核"]', 'https://psychology.sjtu.edu.cn/zsxx.html'),
('oppo-health-ml-intern', 'oppo-health-ml', '机器学习研究员（健康方向）', 'OPPO', '实习', '立即行动', '高度匹配', '深圳', '2027 届寻梦实习｜在招', '参与电生理信号建模与实验设计，岗位明确提到 EEG、ECG、PPG、IMU、时序表征学习与可解释性。', '优先投递；简历第一屏展示 EEG/生理时序数据、Python/PyTorch 和实验设计。', '["EEG","生理信号","机器学习","实验设计"]', 'https://careers.oppo.com/university/oppo/campus/post/1615?recruitType=Intern'),
('oppo-health-algorithm', 'oppo-health-algorithm', '健康算法工程师', 'OPPO', '实习', '立即行动', '高度匹配', '深圳', '2027 届寻梦实习｜在招', '面向睡眠、心率、健康检测，要求数字信号处理、Python/MATLAB、机器学习与算法落地。', '用可复现项目证明从实验数据到算法指标的完整链路。', '["睡眠","PPG","信号处理","健康AI"]', 'https://careers.oppo.com/university/oppo/campus/post/1611?recruitType=Graduate'),
('brainco-2027-campus', 'brainco-recruit', '2027 届秋季校园招聘', 'BrainCo 强脑科技', '校招', '立即行动', '高度匹配', '杭州 / 待确认', '第三方页面标注 2026.09.12', '业务直接聚焦非侵入式脑机接口，招聘方向涉及算法、软件、硬件与产品。具体岗位及截止时间需在官方渠道二次确认。', '先在官方招聘页查询职位，再用校招页校验批次；不要只依赖第三方截止时间。', '["非侵入式BCI","算法","产品","校招"]', 'https://www.brainco.cn/recruit'),
('neuroxess-bci-role', 'neuroxess-jobs', '脑机接口信号处理与解码岗位', 'NeuroXess 脑虎科技', '研究岗位', '持续关注', '匹配', '上海', '社会招聘｜未标注校招批次', '官方岗位涉及植入式脑机接口信号处理、解码、分析与算法优化，但对应届硕士的开放程度需直接确认。', '以应届生自荐方式联系；突出神经信号分析，不把它当作标准校招流程。', '["植入式BCI","神经解码","算法","自荐"]', 'https://www.neuroxess.com/join-us/'),
('bytedance-seed-2027', 'bytedance-seed', 'Seed 大模型人才校招', '字节跳动 Seed', '校招', '立即行动', '转型匹配', '北京 / 上海 / 深圳等', '2027 届｜在招', '覆盖世界模型、多模态、AI for Science 与具身智能。实验心理学背景可转向人机认知与评测，但需强机器学习和代码能力。', '只有在具备 PyTorch、建模和论文复现能力时优先投入。', '["世界模型","多模态","AI4S","高代码门槛"]', 'https://seed.bytedance.com/zh/seedearlycareer'),
('shlab-2027-intern', 'shlab-jobs', '2027 留用实习 / 联培博士', '上海人工智能实验室', '实习', '立即行动', '匹配', '上海', '留用实习覆盖 2026.10—2027.09 毕业', 'AI for Science 招聘明确涵盖神经科学，实验室同时开放日常实习与 2027 联培博士。', '用同一份研究型材料双投实习和联培，优先选神经科学、认知推理或科学智能方向。', '["神经科学","科学智能","留用实习","联培"]', 'https://www.shlab.org.cn/joinus');

INSERT OR IGNORE INTO institutions
(id, source_id, name, mark, summary, note, url, sort_order) VALUES
('baai', 'baai-joint-phd', '北京智源人工智能研究院', '新增重点', '更偏 AI 研究平台，而非传统心理学机构；与你最接近的是生命大模型、类脑智能和 AI4Life。2027 联培博士已经启动，硕士生可申请。', '优势是双导师、算力与产业连接；短板是对算法、编程和 AI 研究潜力要求高。', 'https://hub.baai.ac.cn/view/54026', 1),
('cibr', 'cibr-admissions', '北京脑科学与类脑研究所', '方向最贴合', '脑科学主场，联招路径覆盖心理学、神经生物学和生物医学工程；硕士起点普博一般在 10—11 月发布。', '轮转定导适合尚未完全锁定实验室的人，但每人只能选择一个联培项目。', 'https://cibr.ac.cn/detail/cibrPersonneladmissions/5d82d0e8ad2347c1b78bffbbb13c802f', 2),
('shlab', 'shlab-joint-phd', '上海人工智能实验室', 'AI × 神经科学', '2027 联培博士已启动，合作高校覆盖清北复交浙等；AI for Science 明确包含神经科学。', '适合把脑数据研究转译成科学智能、世界模型或认知推理问题。', 'https://www.shlab.org.cn/news/5444256', 3),
('bigai', 'hit-bigai', '北京通用人工智能研究院', '认知启发 AI', '研究布局含认知与推理、混合智能和机器人。2027 与哈工大联培项目已公布，但当前专业仅机械工程和数学、名额少。', '适合数学与工程能力很强的转型申请者，不是实验心理学的自然延伸。', 'https://yzb.hit.edu.cn/2026/0708/c19935a396468/page.htm', 4),
('pengcheng', 'tsinghua-pengcheng', '鹏城国家实验室', '工程博士', '与清华深圳国际研究生院开展 2027 工程博士联培，面向通信、网络和智能信息，第二批视首轮名额决定。', '更适合信号处理、计算机或工程背景；可作为脑机接口算法方向的交叉备选。', 'https://yzbm.tsinghua.edu.cn/publish/s03/s0302/detail/2581f75f-63ec-4d59-ba1f-8126bdd7a855?yxsdm=599', 5);
