# 技能评估报告（首份，2026-11-17）

- PRD：PRD-484（brain-27-career-radar）
- 设计依据：docs/plans/2026-11-17-prd-484-brain-skill-evaluation-design.md
- 评估清单版本：v1，技能 3 个
- 阈值：`{"min_sample_tasks":30,"max_error_rate":0.1,"max_error_vs_control_ratio":0.5,"min_behavior_change_rate":0.1,"min_adoption_rate":0.8,"fail_adoption_rate":0.5,"overlap_similarity":0.8,"error_label":"假信号率"}`（设计稿草稿阈值，待评审定稿、实测后复核）

## 一、质量门

| 技能 | 结论 | 原因 |
|---|---|---|
| capture:job-capture | 证据不足 | 样本量 0 < 30，不判通过 |
| draft:job-skill-draft | 证据不足 | 样本量 0 < 30，不判通过 |
| review:authenticity-reviewer | 证据不足 | 样本量 0 < 30，不判通过 |

## 二、重叠检测

全量两两比对 3 对；疑似重叠（相似度 ≥ 阈值）0 对。
相似度为词元集合 Jaccard（设计稿嵌入余弦的最小可用代理，T2 不引入外部 embedding 服务）。

| 技能 A | 技能 B | 相似度 | 疑似重叠 |
|---|---|---|---|
| capture:job-capture | draft:job-skill-draft | 0.107 | 否 |
| capture:job-capture | review:authenticity-reviewer | 0.049 | 否 |
| draft:job-skill-draft | review:authenticity-reviewer | 0.037 | 否 |

## 三、待核查清单（疑似重叠）

无。

## 四、整改清单候选（质量门未过关）

无。质量门结论为“证据不足”的技能不在此列——证据不足不是失效，待对照跑分补测。

## 五、方法与诚实声明

- 本报告由评估脚本按评估清单自动生成；清单里的技能文本取自仓库 main 上的真实技能文件（路径见清单）。
- 质量门样本量为 0 的技能判“证据不足”：T2 只跑门逻辑与重叠检测，真实对照跑分（A/B）在后续实测试运行；不编造跑分数据。
- 评估结论只进整改清单/待核查清单；技能下线另走审批，绝不因评估未过关直接删技能。
