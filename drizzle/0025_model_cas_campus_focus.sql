-- Make foundation-model companies and Chinese Academy of Sciences opportunities first-class campus focus lines.
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:大模型厂商","智源","AI4Life","类脑智能","联培博士","北京"]',updated_at=CURRENT_TIMESTAMP WHERE id='baai-2027-joint-phd';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:大模型厂商","DeepSeek","基础模型","强化学习","研究工程","批次待确认"]',updated_at=CURRENT_TIMESTAMP WHERE id='deepseek-campus-watch';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:大模型厂商","Kimi","基础模型","多模态","校园招聘","批次待确认"]',updated_at=CURRENT_TIMESTAMP WHERE id='kimi-campus-2027-watch';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:大模型厂商","智谱","GLM","基础模型","校园招聘","批次待确认"]',updated_at=CURRENT_TIMESTAMP WHERE id='zhipu-campus-2027-watch';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:大模型厂商","MiniMax","多模态","2027届"]',updated_at=CURRENT_TIMESTAMP WHERE id='minimax-2027-campus';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:国内研究机构","中科院","科研助理","北京","视知觉"]',updated_at=CURRENT_TIMESTAMP WHERE id='cas-psych-jiang-ra-2026';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:国内研究机构","中科院","博士","北京","认知神经科学"]',updated_at=CURRENT_TIMESTAMP WHERE id='cas-psych-2027-phd-watch';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:国内研究机构","中科院","博士","北京","脑成像"]',updated_at=CURRENT_TIMESTAMP WHERE id='cas-ibp-2027-phd-watch';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:国内研究机构","中科院","博士","北京","类脑智能"]',updated_at=CURRENT_TIMESTAMP WHERE id='casia-2027-brain-ai-phd-watch';
UPDATE opportunities SET tags_json='["2027校招专题","校招重点","赛道:国内研究机构","中科院","全国重点实验室","研究岗位","北京"]',updated_at=CURRENT_TIMESTAMP WHERE id='casia-key-lab-role-2026';
UPDATE sources SET topics_json='["校招重点","大模型厂商","DeepSeek","基础模型","强化学习","研究工程","校园招聘"]',coverage='campus',description='DeepSeek 官方人才入口；重点检查校招、实习、研究工程和基础模型岗位，具体毕业批次以职位页为准。',check_interval_hours=6 WHERE id='deepseek-careers';
UPDATE sources SET topics_json='["校招重点","大模型厂商","Kimi","基础模型","多模态","校园招聘"]',coverage='campus',description='Kimi / 月之暗面官方招聘入口；重点检查 Campus Recruiting、实习和研究工程岗位，具体毕业批次逐岗核对。',check_interval_hours=6 WHERE id='kimi-careers';
UPDATE sources SET topics_json='["校招重点","大模型厂商","智谱","GLM","基础模型","校园招聘","研究工程"]',coverage='campus',description='智谱官方人才入口；重点检查 GLM、算法、研发和校园招聘机会，不把公司官网直接视为已开放岗位。',check_interval_hours=6 WHERE id='zhipu-careers';
UPDATE sources SET topics_json='["校招重点","大模型厂商","智源","AI4Life","类脑智能","联培博士"]',coverage='campus',description='北京智源人工智能研究院官方联培与研究机会入口，重点跟踪生命大模型、类脑智能、AI4Life、世界模型和具身智能。',check_interval_hours=6 WHERE id='baai-joint-phd';
UPDATE sources SET topics_json='["校招重点","中科院","科研助理","博士","研究岗位","北京"]',description='中科院心理所官方招聘与招生入口，重点跟踪科研助理、博士、直博和认知神经科学岗位。',check_interval_hours=6 WHERE id IN ('cas-psych-recruit','cas-psych-admissions');
UPDATE sources SET topics_json='["校招重点","中科院","科研助理","博士","研究岗位","北京","脑科学"]',description='中科院生物物理所官方招聘与招生入口，重点跟踪认知神经科学、脑成像、计算建模和研究岗位。',check_interval_hours=6 WHERE id IN ('cas-ibp-recruit','cas-ibp-admissions');
UPDATE sources SET topics_json='["校招重点","中科院","人工智能","类脑智能","博士","研究岗位","北京"]',description='中科院自动化所官方招聘与招生入口，重点跟踪脑图谱、类脑智能、人工智能和研究生机会。',check_interval_hours=6 WHERE id IN ('casia-opportunities','casia-admissions');
PRAGMA optimize;
