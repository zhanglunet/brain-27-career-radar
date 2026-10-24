# PRD-150/T1：简历/求职信字段模型与本地模板

> trend issue #750。对应 PRD-150（中央仓库 zhanglunet/trend）。
> 借鉴 genspark-ai/genoffice（Apache-2.0）：复用「本地编辑器 + CLI + skill」形态思路，保留版权声明引用，自研表述。
> 下一步：确认后进 T2（#751）：本地 .docx 生成实现。

PRD-080 本地申请助手已落地 `lib/local-apply/`（matcher / drafter / ollama / sqlite-store / posting-guard / cli），但产物停留在 Markdown 草稿层——简历只有"调整建议清单"（`drafter.ts` `draftCv`），没有可投递的成品文档。PRD-150 补最后一公里：**本地生成真实 .docx 简历与求职信**。本设计只定「字段从哪来、模板长什么样、样例怎么渲染」，不写实现（T2 的事）。

## 一、统一字段模型（JobDocProfile）

### 1.1 为什么需要统一

现状是三套并行类型 + CLI 里有损适配（`cli.ts` 注释自明"统一类型是后续事项"）：

- `matcher.ts` `LocalProfile`：degree / researchInterests / skills / mentorsOfInterest / targetRegions / targetTypes / fundingNeed；
- `drafter.ts` `UserProfile`：name / education[] / experience[] / skills[] / interests[]；
- `cli.ts` `CliProfile`：MatcherProfile & { name?, experience? }。

PRD-150 引入 `JobDocProfile` 作为**超集**（docx 生成直接读它），现有三套类型零破坏——CLI 适配器反向收敛，而不是再改 matcher/drafter。原则：**新增字段全部可选**，缺什么渲染时就留占位符，不阻断生成。

### 1.2 字段表（存储为 `~/.brain27/profile.json` 的扩展形状）

**A. 基本信息 basics**（最敏感，绝不出机器）

| 字段 | 类型 | 必选 | 虚构样例 | 消费方 |
|---|---|---|---|---|
| `basics.name` | string | 可选 | `"王某某"` | 简历页眉、求职信落款 |
| `basics.email` | string | 可选 | `"wang@example.com"` | 简历基本信息行、求职信信头 |
| `basics.phone` | string | 可选 | `"138-0000-0000"` | 简历基本信息行 |
| `basics.location` | string | 可选 | `"上海"` | 简历基本信息行 |
| `basics.homepage` | string | 可选 | `"https://wang.example.dev"` | 简历基本信息行 |

**B. 教育 education[]**（至少 1 条）

| 字段 | 类型 | 必选 | 虚构样例 | 消费方 |
|---|---|---|---|---|
| `education[].degree` | string | **必选** | `"实验心理学硕士"` | 现有 matcher/CLI 已依赖此语义 |
| `education[].school` | string | 可选 | `"某大学心理与认知科学学院"` | 简历教育区块 |
| `education[].period` | string | 可选 | `"2024.09 – 2027.06（预计）"` | 简历教育区块 |
| `education[].note` | string | 可选 | `"方向：认知神经科学；GPA 3.8/4.0（示例）"` | 简历教育区块 |

**C. 经历 experience[]**（每条 = 一段可讲的研究/项目/实习经历）

| 字段 | 类型 | 必选 | 虚构样例 | 消费方 |
|---|---|---|---|---|
| `experience[].title` | string | **必选** | `"科研助理"` | 简历经历区块、求职信佐证段 |
| `experience[].org` | string | 可选 | `"某脑科学研究所"` | 同上 |
| `experience[].period` | string | 可选 | `"2025.03 – 2025.12"` | 同上 |
| `experience[].highlight` | string | **必选** | `"用 Python 处理 64 导 EEG 数据，复现××效应（示例）"` | 兼容现有 `experience: string[]`（一句话）语义 |
| `experience[].star` | `{situation, task, action, result}` | 可选 | 四段各一句话（示例略） | 备面试 STAR 映射（呼应 PRD-097 G15），T1 仅预留形状 |
| `experience[].tags` | string[] | 可选 | `["EEG", "Python"]` | 简历关键词对齐 |

**D. 技能 skills[]**

| 字段 | 类型 | 必选 | 虚构样例 | 消费方 |
|---|---|---|---|---|
| `skills[]` | string \| `{name, level?}` | **必选（≥1）** | `"EEG 信号处理"` / `{"name": "Python", "level": "熟练"}` | 兼容现有 `string[]`；对象形态可选升级 |

**E. 成果 outputs[]**（可选，简历加分区块）

| 字段 | 类型 | 必选 | 虚构样例 |
|---|---|---|---|
| `outputs[].kind` | `"paper" \| "award" \| "project"` | 可选 | `"paper"` |
| `outputs[].title` | string | 可选 | `"《××注意机制的建模研究》（示例）"` |
| `outputs[].venue` | string | 可选 | `"某学术会议 2026（示例）"` |
| `outputs[].year` | string | 可选 | `"2026"` |
| `outputs[].url` | string | 可选 | `"https://doi.example.org/10.0000/example"` |

**F. 目标岗位 target**（沿用 matcher.LocalProfile 语义，不新造词）

| 字段 | 类型 | 必选 | 虚构样例 |
|---|---|---|---|
| `target.researchInterests` | string[] | **必选** | `["脑机接口", "认知神经科学"]` |
| `target.targetTypes` | `WikiOpportunityType[]` | 可选 | `["phd", "ra"]` |
| `target.targetRegions` | `WikiRegion[]` | 可选 | `["英国"]` |
| `target.mentorsOfInterest` | string[] | 可选 | `["某教授（示例）"]` |
| `target.fundingNeed` | `"full" \| "partial" \| "any"` | 可选 | `"full"` |

### 1.3 兼容映射（T2 实现时照抄的转换表）

| JobDocProfile | → CliProfile / matcher.LocalProfile | → drafter.UserProfile |
|---|---|---|
| `education[0].degree` | `degree` | `education = education[].school + degree 拼接` |
| `target.researchInterests` | `researchInterests` | `interests` |
| `skills` | `skills`（string 形态直传） | `skills` |
| `experience[].highlight` | `experience`（string[]） | `experience`（string[]） |
| `basics.*` / `outputs` / `star` | 不映射（现有模块不需要） | `name` |

## 二、本地 .docx 模板设计

### 2.1 模板载体

模板 = **版式定义 + 字段插槽**，以声明式 slot 标记写在 `lib/local-apply/docx/templates/`（T2 建），渲染库 T2 选型（约束：纯本地生成、无网络依赖、TypeScript 可用；候选如 `docx` npm 包，T1 不锁死）。两套模板：

| 模板 | 用途 | 对应 DraftKind |
|---|---|---|
| `resume` | 中文简历（单页优先） | `cv`（现有产物是建议清单；docx 简历正文直接由 JobDocProfile 渲染，不依赖 draftCv 输出） |
| `cover-letter` | 中文求职信（一页） | 新增 `cover_letter`（见 §4.2） |

### 2.2 简历模板版式（单栏 A4）

```
┌ A4，页边距上下 2.0cm / 左右 2.2cm ────────────────┐
│ {{basics.name}}            16pt 黑体类，居左        │  ← 姓名行
│ {{basics.email}} · {{basics.phone}} · {{basics.location}} · {{basics.homepage}}   9pt  │  ← 联系行，空槽跳过分隔符
│ ────────────────────────────────               │
│ 教育背景   12pt 黑体类（区块标题，下同）              │
│   {{education[].school}}  {{education[].period}}    │
│   {{education[].degree}}；{{education[].note}}      │
│ 研究经历（= experience[] 逆序）                      │
│   {{experience[].title}} @ {{experience[].org}}  {{experience[].period}} │
│   {{experience[].highlight}}                        │
│ 技能     {{skills[]}} 顿号连接                       │
│ 成果     {{outputs[]}}（区块内无条目则整块省略）        │
│                                     页脚：页码 x/y  │
└─────────────────────────────────────────────────┘
```

空槽规则：联系行内字段缺失则连同前面的 `·` 分隔符一起消失；`outputs` 整块为空则省略区块标题；单字段缺失留 `[待填写：字段路径]`。

### 2.3 求职信模板版式（单页 A4）

```
│ {{basics.name}}                                   │  ← 信头（联系行同简历）
│ {{today}}（渲染日，YYYY 年 M 月 D 日）                │
│ 收件：{{opportunity.mentor || "尊敬的老师"}}          │
│       {{opportunity.org}}                          │
│ 尊敬的{{opportunity.mentor || "老师"}}：              │
│   〔来意段〕申请 {{opportunity.title}}……              │
│   〔匹配段〕〔研究计划/PS 草稿插槽，源自 materials〕      │
│   〔佐证段〕experience[] 中与机会关键词命中最高的 1–2 条   │
│   〔结尾段〕附件清单 + 期待回复                         │
│ 此致 敬礼                                          │
│ {{basics.name}}                                    │
```

### 2.4 中文排版约定

| 项 | 约定 | 理由 |
|---|---|---|
| 字体 | 声明回退栈：标题 `{ "East Asia": "黑体", "Latin": "Arial" }`，正文 `{ "East Asia": "宋体", "Latin": "Times New Roman" }`；不内嵌字体文件 | 避免字体版权问题，打开方本机回退 |
| 字号 | 姓名 16pt / 区块标题 12pt / 正文 12pt（小四）/ 联系行与页脚 9pt | 中文简历通行规格 |
| 行距 | 正文 1.3 倍；区块间段前 6pt | 单页容纳一页经历 |
| 对齐 | 正文两端对齐；经历条目行悬挂缩进 | 中文长句两端对齐避免犬牙差 |
| 标点 | 全角中文标点；字段值内的西文与数字保持半角 | 混排惯例 |
| 页码 | 页脚 `x / y`，求职信单页也保留 | 打投递包时不错页 |

## 三、模板渲染占位样例的约定

### 3.1 虚构样例数据集（验收「模板可渲染占位样例」的载体）

T2 落地 `examples/doc-profile.sample.json`：**全虚构人物**（姓名用"王某某"、机构用"某大学/某研究所"、邮箱用 `example.com` 域），字段覆盖 §1.2 全部区块，但**故意留 2 个可选字段为空**（如 `phone`、`outputs`），用来验证空槽跳过与整块省略。样例纪律（PRD 风险条款）：入库的模板、样例、测试数据一律虚构，真实档案只存在于用户本机 `~/.brain27/`（已在 .gitignore 语义内，不入库）。

### 3.2 占位符规则

- 语法沿用 `drafter.ts` 现行约定：`[待填写：<字段路径>]`（`PLACEHOLDER(slot)`），如 `[待填写：basics.email]`；
- 缺失**必选**字段：渲染不中断，占位符入文 + 命令行醒目警告（呼应 PRD-097 G11 的"占位符残留检查"——T2 的 `docx check` 子命令扫描 `[待填写` 残留数）；
- 缺失**可选**字段：按 §2.2 空槽规则跳过，不留痕。

### 3.3 AI 草稿标注与样例渲染（文字版）

- 现行 `AI_DRAFT_MARKER`（"AI 草稿，需人工改写"）在 Markdown 里是 `> ⚠️` 引用行，docx 里无法复用语法——约定：**渲染为文档首行独立标注段**（斜体、9pt、灰色，样式名 `ai-draft-marker`），人工改写定稿后由 `docx export --final` 生成无标注版（非 final 导出强制带标注）；
- 占位样例渲染结果（节选，全部虚构）：

```
王某某
wang@example.com · 138-0000-0000 · 上海
────────────────────────────
教育背景
  某大学心理与认知科学学院  2024.09 – 2027.06（预计）
  实验心理学硕士；方向：认知神经科学
研究经历
  科研助理 @ 某脑科学研究所  2025.03 – 2025.12
  用 Python 处理 64 导 EEG 数据，复现××效应（示例）
技能
  EEG 信号处理、Python、Matlab
成果
  《××注意机制的建模研究》（示例）· 某学术会议 2026（示例）
```

（phone 留空 → 联系行自动少一段；本样例 outputs 有值故区块保留。）

## 四、与 PRD-080 申请助手流程的对接点

| # | 对接点 | 现有模块 | PRD-150 动作 |
|---|---|---|---|
| 4.1 | 档案同源 | `~/.brain27/profile.json`（`cli.ts` 读） | JobDocProfile 是其超集；`brain27 docx` 读同一文件，老 profile 缺新字段走占位符，不强制迁移 |
| 4.2 | 求职信正文来源 | `drafter.ts`（DraftKind = `cv \| ps \| email`） | **新增 DraftKind `cover_letter`**：`materials` 表 kind 列为 TEXT，直接扩值，SQLite schema 零迁移；求职信「匹配段」插槽取该机会最新版 `ps` 或 `cover_letter` 草稿 |
| 4.3 | 版本与存档 | `sqlite-store.ts`（materials：id/kind/opportunity_id/version/created_at/marker/content；接线修复见 PR #54） | docx 文件名带版本：`{kind}-{opportunity_id}-v{version}.docx`；渲染是**只读消费** materials，不回写草稿内容 |
| 4.4 | 机会字段注入 | `opportunity_cache`（`brain27 pull` 产物） | 求职信信头/来意段插槽读机会的 `title / org / type / deadline`（全部公开情报，允许渲染进文档；个人数据仍然零外发） |
| 4.5 | 润色与标注 | `ollama.ts`（loopback-only 断言、`ensureMarker` 强制补标注） | 求职信正文可走现有 `polish`；docx 渲染在**润色之后**，标注段由渲染层强制写入（双保险） |
| 4.6 | 外部文本门禁 | `posting-guard.ts`（机会正文是不可信外部数据；guard 呈现修复见 PR #54） | 机会正文进求职信 prompt 前沿用现有 guard 路径；docx 模块自身不引入任何新的外部输入通道 |

## 五、数据不出本机的设计约束

1. **默认无网络写**：`.docx` 渲染全程本地（模板 + JobDocProfile + 本地草稿 → 文件落盘），渲染路径无 fetch；延续 PRD-080/T1 数据边界表——网络只允许两个只读云端端点（MCP / 摘要 API），本地 → 云端方向**永远为空**。T2 起把 PRD-097 G23 的 CI 断言扩展到新目录：`lib/local-apply/docx/` 不得出现任何 fetch/http import。
2. **BYOK（自带模型/密钥）**：模型能力用户自备——默认 Ollama 本地模型（loopback-only 断言延续），云端 LLM 默认关闭（PRD-080/T1 §3.2 的三道锁：逐次授权、一键关闭、最小发送）。任何 API key 只放用户本地环境变量，不入仓库、不入文档、不入日志。
3. **产物不代发**：无 upload / send / submit 命令；`.docx` 生成后由用户手动投递（PRD-080 非目标"不自动投递"延续）。
4. **样例零隐私**：入库模板、样例、测试 fixture 全部虚构（§3.1 纪律）；T5（#754）验收含"无真实隐私样例入库"专项检查。

## 六、下一步

- 确认后进 **T2（#751）：本地 .docx 生成实现**——渲染库选型落地、`resume` / `cover-letter` 两模板实现、`examples/doc-profile.sample.json` 渲染为真实可打开的 .docx、`node --test` 测试（空槽跳过 / 占位符警告 / 标注段强制 / 文件名版本号）。
- 需随 T1 确认一并拍板的三个小决策：
  1. 求职信是否新增 DraftKind `cover_letter`（本设计推荐：是，理由见 §4.2）；
  2. docx 渲染库候选（本设计倾向纯本地、零网络的 TS 库，T2 定）；
  3. 简历/求职信是否需要英文模板变体（申博场景常需双语，建议 T2 先中文、英文列 backlog）。
