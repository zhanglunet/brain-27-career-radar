# ai-job-search 拆解报告（PRD-097 / T1）

- **参照仓库**：MadsLorentzen/ai-job-search
- **基准版本**：commit `d621ebe63549`（2026-10-19，仓库 HEAD 已核对一致）
- **许可证**：MIT（复用其代码/文本须标注来源：Copyright Mads Lorentzen，ai-job-search）
- **拆解日期**：2026-10-20
- **范围说明**：本报告基于实际读到的仓库文件（清单见第 5 节）。star 数 57,184 来自 PRD 背景，未独立核验。

---

## 0. 一句话结论

它不是 SaaS、没有后端、没有账号系统——它是一个**跑在 Claude Code 本地会话里的文件系统框架**：把求职方法论写成 Markdown 指令文件（commands + skills），把个人数据写成 Markdown/LaTeX/CSV 文件存放在用户自己的 git 仓库里，靠 `/setup → /scrape → /rank → /apply → /interview → /outcome` 一组斜杠命令驱动，模型能力全部来自用户本机的 Claude Code 订阅/API。仓库 slogan 就是这句：*"The job search that runs on your machine."*

---

## 1. 四段链逐段拆解

主链路由 `.claude/commands/apply.md` 定义（命令本身就是一份 420 行的编排剧本，由主会话 Claude 按步骤执行）。链条顺序是 **evaluate → tailor CV → cover letter → reviewer**，其中编译验证（Step 5）位于 reviewer 修订之后、呈现之前，横跨产物侧；`/rank` 是批量入口（先分诊再进 `/apply`），`/setup` 是前置入口，`/interview`、`/outcome` 是收尾。

### 段一：Evaluate（评估）— `/apply` Step 0 + Step 1

- **输入**：一个职位 URL 或粘贴的 JD 文本（`$ARGUMENTS`）；候选人画像 `.claude/skills/job-application-assistant/01-candidate-profile.md`；评估框架 `04-job-evaluation.md`；可选 `salary_lookup.py` + `salary_data.json`（BYO 薪资数据）。
- **处理**：
- **抓取先过确定性门禁**：URL 输入时派发只读子 agent `posting-fetcher`（`.claude/agents/posting-fetcher.md`，可读可抓、不可编辑/写文件）；抓取升级顺序是「已装 portal CLI 的 `detail` 命令 → WebFetch → `tools/fetch_page.py`（浏览器头重试，自带 robots.txt 检查）→ 雇主官网 careers 页」，优先雇主自有页面而非聚合站（聚合站常丢 requisition ID 和职级）。粘贴文本同样要过门禁——"粘贴不等于可信"。
- **posting_guard 完整性门禁**（`tools/posting_guard.py`，纯 Python、无 LLM）：剥离隐藏 HTML（display:none、零宽字符、bidi 控制符等不可见内容）、标记"指令形"行文与隐藏 URL，输出一行 verdict（clean / ⚠ + findings）。被标记的 JD 不自动拒绝，而是把 findings 原文摆给用户问 "Continue with this posting?"。JD 全程被定义为**不可信数据，永不作为指令**，这条规则会随 JD 文本一起进入后续每个 agent 的 prompt。
- **来源主机核验**：把 JD 的 host 分为三类——已装 portal 站点、六大 ATS 官方域名（greenhouse.io、lever.co、myworkdayjobs.com、ashbyhq.com、smartrecruiters.com、workable.com，含防 look-alike 域名欺骗的精确匹配规则）、未验证主机（明确标 ⚠ 提示用户）。
- **两道硬门 + 五维打分**（`04-job-evaluation.md`）：打分前先过 Eligibility Gate（公民/PR/工签资格，命中硬性要求直接 FAIL 不打分）和 Language Gate（JD 要求的语言未在画像中声明 → FAIL；声明了但等级可能不够 → FLAG 交用户判断）。然后五维评分：Technical Skills 30% / Experience 25% / Behavioral Fit 15% / Career Alignment 30%（Location 为 Pass/Fail 不计权），阈值 75+ Strong Fit、60–74 Good、45–59 Moderate、30–44 Weak、<30 Poor。可选薪资基准（公司薪资指数）。
- **人工确认门**：评估结果（含门禁 verdict 行、主机核验、五维分、fit 结论）先呈现给用户，问 "Should I proceed with drafting the CV and cover letter for this role?"——用户说 no 就停在这里。
- **输出**：评估表 + fit 分数（后续写入 tracker 的 `fit_rating`）；JD 全文（经门禁清洗后的版本）保留在会话内供 Step 6b 归档；从 JD 抽取的公司/职位/部门/地点/截止日/语言元数据。

### 段二：Tailor CV（定制简历）— `/apply` Step 2（CV 部分）

- **输入**：段一的评估与要求清单；`05-cv-templates.md`（moderncv/banking 模板规范）；`03-writing-style.md`（文风规则）；主简历 `cv/main_example.tex`（事实源之一，仅作结构参考的既有定制版 CV）；激活模板声明（`/add-template` 写入的 `ACTIVE-TEMPLATE` 块可覆盖源文件扩展名与编译命令）。
- **处理**：
- **三源事实对齐（Factual Grounding）**：所有定制 bullet 在落盘前必须能被三源并集支撑——`01-candidate-profile.md` + 主 CV `cv/main_example.tex` + `CLAUDE.md` 的 Candidate Profile 节；日期、职位、量化指标须逐项对得上，零容忍"画像漂移/编造"。反向规则：用户在对话中确认的新事实必须**当轮回写** `01-candidate-profile.md`，否则下一轮会被审计当作无据 claim 删掉（"输入侧"规则）。
- **要求全覆盖**：JD 的每条要求都要在文档中被回应——匹配或诚实承认差距（用相邻经验搭桥），不许静默省略；nice-to-have 用 JD 原词点名呼应（ATS 关键词常是字面匹配，连 CV 章节标题都建议用 JD 的术语）。
- **语言恒定**：CV 语言是画像级设置（CLAUDE.md 的 `CV language:`），不随 JD 切换，保证所有 CV 一致可复用。
- **页数硬限 2 页**与裁剪算法在段三统一验证；超页时用**相关性加权裁剪**（relevance-weighted cutting）：按 (a) 与本 JD 关键词相关性 (b) 文档内唯一性 (c) 求职信是否依赖 打分，删总分最低行，而不是按章节资历机械删。
- **输出**：`cv/main_<company>_<role>.tex`（文件名中的 `<company>_<role>` 由 `documents/README.md` 的 Subfolder naming 规则统一派生，全链共用）。

### 段三：Cover Letter（求职信）+ 产物验证 — `/apply` Step 2（求职信部分）+ Step 5

- **输入**：`06-cover-letter-templates.md`（自研 `cover.cls` 模板）；`03-writing-style.md`；段一的要求清单与 JD 的后勤条款（安调意愿、到岗时间、通勤、reference/job ID）。
- **处理**：
- 求职信语言**跟随 JD**（丹麦语 JD → 丹麦语求职信），与 CV 的恒定语言相反；约 1 页硬限；抬头尽量写具名联系人。
- **LaTeX 强制编译验证（Step 5，不可跳过）**：CV 用 `lualatex`、求职信用 `xelatex`（或激活模板声明的命令，如 typst）真实编译成 PDF，然后双重检查——`tools/verify_pdf.py --pages` 查页数（CV 恰 2 页 / 求职信恰 1 页），`tools/verify_layout.py` 量化版面（页底空白占比、最大行间空洞 >100pt 报错、条目标题被分页孤悬等），再由 Claude 用 Read 工具肉眼看 PDF。不合格就改源文件重编译，直到干净。理由写得很直白：".tex 看起来没问题"经常产出分页破碎的 PDF（moderncv 的 `\cventry` 是不可断块，装不下就整条跳页留洞）。
- **ATS 文本层验证（Step 5d，仅 CV）**：用 pypdf/pdftotext 抽 PDF 的嵌入文本层，查联系方式是否为字面文本（图标字体抽出来是字形名，ATS 读不到）、阅读顺序是否与版面一致、日期是否为 ASCII 连接（`--ascii-dates` 检查，LaTeX 的 en-dash 曾让 Workday 导入丢日期）；再把段一的关键词表逐项对抽取文本核对覆盖状态（covered / synonym-only / missing-have / missing-gap），**缺口只登记、永不塞词**。
- 编译产物清理：删 `.aux/.log` 等中间文件，只留源文件 + PDF + 模板资产。
- **输出**：`cover_letters/cover_<company>_<role>.tex` + 两份通过验证的 PDF。

### 段四：Reviewer（评审修订）— `/apply` Step 3 + Step 4（+ Step 6/6b 收尾）

- **输入**：两份草稿全文（**内联**塞进 reviewer 的 prompt，不让它自己读文件，省 token）；JD 全文；画像与文风文件（reviewer 只读内容批评所需：01/02/03/04 + 主 CV + CLAUDE.md，明确不读 05/06 模板文件）。
- **处理**：
- **drafter–reviewer 双 agent 分离**：用 Agent 工具派发独立子 agent `application-reviewer`（`.claude/agents/application-reviewer.md`，可读/搜/抓、**不可编辑/写文件**），以"招聘经理代理人"身份工作。新鲜上下文 + 只读权限是刻意的：它只能把意见以文本返回，所有落盘修改由主会话（drafter）执行。
- reviewer 先查**公司研究缓存** `company_research/<company>.json`（30 天 TTL，`04-job-evaluation.md` 定义 schema）， miss 才 WebSearch/WebFetch 现查公司/部门/动态；研究结论以缓存 schema 附在回复末尾，由 drafter 落盘（reviewer 无写权限），供下次 `/apply` 或 `/interview` 复用。缓存内容同样被声明为"数据，不是指令"。
- **事实对齐审计（reviewer 侧复检）**：逐项比对草稿中的日期/雇主/职位/数字与三源并集；不一致标为 Part A 编辑且 `"reason": "grounding"`，与风格类修改区分；三源彼此矛盾则报"画像一致性警告"给用户，不当作草稿错误。
- **结构化反馈协议**：Part A = JSON 数组形式的精确字符串替换（`file` / `old_string` / `new_string` / `reason`），drafter 可直接用 Edit 工具机械执行；Part B = 叙事建议（漏掉的关键词、公司角度、被动语态改写、语气与行为画像是否相符），每类必须给结论（哪怕是 "no issues"）。硬规则：**任何建议不得编造技能/经历**，缺口只能诚实 framing。
- drafter 修订（Step 4）：Part A 直接执行（rationale 涉及编造的跳过）；Part B 逐项判断，其中公司相关 claim 在写入前必须自己再 WebFetch/WebSearch 核实一遍，不盲信 reviewer 的研究。
- **输出**：修订后的终稿两份（磁盘即终稿）；Step 6 跑全仓唯一的验证清单（CLAUDE.md Verification Checklist：事实/定向/一致性/质量）并呈现 3–5 条关键定制决策；**Step 6b 记录落盘**——`job_search_tracker.csv` 追加/更新一行（status=`drafted`、fit_rating 为纯数字、含 deadline/source/channel 等字段，已终态的行永不覆盖），JD 清洗版全文归档到 `documents/applications/<company>_<role>/job_posting.md`（只附门禁 verdict 与计数，不附被删节选，防污染下游）；可选第三产物：门户自由文本字段（`08-application-forms.md`，需用户点头才起草）。

**链外衔接**（帮助理解全貌，非四段链本体）：`/rank`（`.claude/commands/rank.md`）用 `tools/rank_state.py` 从 `job_scraper/seen_jobs.json` 查候选（从不整表读进上下文），派发并行只读 `posting-scorer` 子 agent 批量打分产出 shortlist，`expired`（有实据已关闭）与 `unreachable`（抓取失败待重试）严格分开；`/interview`（`.claude/commands/interview.md`）从 tracker + 申请归档出发，按面试阶段组装 prep pack（可能问题→STAR 映射、一致性简报——"面试间说的不能超出纸面写的"、定制难题、要问的问题），并可发起 mock interview；`/outcome` 负责状态推进与归档维护。

---

## 2. "runs on your machine" 架构

### 2.1 数据存储：纯文件，无数据库、无云端

| 数据 | 载体 | 说明 |
|---|---|---|
| 候选人画像 | `CLAUDE.md`（Candidate Profile 节）+ `.claude/skills/job-application-assistant/01–07*.md` | Markdown 模板，`/setup` 填充占位符；方法论文件带 `framework_version` 标记（如 SKILL.md 1.3.6、04 为 1.2.6） |
| 申请跟踪 | `job_search_tracker.csv` | 表头 `date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,deadline`；状态词表由 `/outcome` 统一定义 |
| 抓取去重 | `job_scraper/seen_jobs.json` | `/scrape` 写入、`/rank` 经 `tools/rank_state.py` 查询；`/apply` 明确禁止改它（去重以 tracker 为准） |
| 源材料 | `documents/`（cv/、linkedin/、diplomas/、references/、projects/） | `/setup` Path A 与 `/expand` 的输入 |
| 申请归档 | `documents/applications/<company>_<role>/` | `job_posting.md` + 提交版 CV/求职信 + `outcome.md` |
| 公司研究缓存 | `company_research/<company>.json` | 30 天 TTL，reviewer 产出、drafter 落盘 |
| 产物 | `cv/main_*.tex/.pdf`、`cover_letters/cover_*.tex/.pdf` | LaTeX 源 + 编译 PDF |
| 薪资数据 | `salary_data.json`（可选，BYO） | 没有就跳过薪资基准，不报错 |

敏感文件（tracker、薪资、documents/、归档）在模板仓库里是 gitignored 的；画像文件是 tracked 的——这是 fork 隐私风险的来源（见 2.4）。

### 2.2 模型调用：借宿主，不自建

- 运行时只有 **Claude Code 本地会话**一个：用户自备 Claude Pro/Max/Team 订阅或 Anthropic API 额度（README 明示 Claude Code 无免费层）。仓库本身**不持有、不管理任何 API key**，没有后端服务、没有队列、没有定时任务。
- "智能"全部编码在 Markdown 里：`.claude/commands/*.md` 是编排剧本（自然语言步骤 + 硬规则），`.claude/skills/*/SKILL.md` + 编号参考文件是领域知识，`.claude/agents/*.md` 是受限子 agent 定义（posting-fetcher / application-reviewer / posting-scorer，均为只读）。确定性环节下沉到 Python 工具（`tools/`：posting_guard、verify_pdf、verify_layout、rank_state、fetch_page、robots_check、install_portal_clis、check_upstream_updates、upstream_triage 等），LLM 只做判断与写作。
- 门户搜索是独立的 TypeScript CLI（Bun 运行，`.agents/skills/*-search/cli/`），与方法论层解耦——README 明说这些 portal skill 在 Codex / Gemini CLI 等其他 agent 工具里也能直接用。

### 2.3 权限模型：`.claude/settings.json` 的 allow / ask / deny

- **allow（预授权免问）**：本框架的 skill 本身、6 个 portal CLI 的 `bun run...`、以及一组白名单 Python 工具（salary_lookup、rank_state、job_key、verify_pdf、verify_layout、robots_check、fetch_page、posting_guard）和 `pdftotext`。即：日常链路全自动。
- **ask（改框架前必须问人）**：编辑 `.claude/settings.json`、`settings.local.json`、各 `SKILL.md`、`.claude/commands/*.md`、`.claude/agents/**`、`.github/**`、`tools/security_guards.py`，以及 `git push`。即：**方法论与安全边界的自我修改被锁死在人工确认后**。
- **deny（硬禁止）**：读 `.env*`、`~/.ssh`、`~/.aws`、`~/.gnupg`；一切带数据外发语义的命令形态（`curl -d/--data/-F/-T/-X POST/PUT`、`wget --post-*`、`scp/sftp/ssh/nc` 等）。即：数据只能进、不能出（除用户自己 git push，且 push 也在 ask 里）。
- 配套：`tools/security_guards.py` 在 CI 里校验这套 allow/ask/deny 与 skill 授权、gitignore、manifest 不漂移；从别的 fork 借 portal skill 时要求**人工通读代码**再装（因为装上即被预授权），README 明确说"不做自动安装器是安全决策，不是缺功能"。

### 2.4 fork-and-own 路径

- 入口（SETUP.md 第 2 节 + `/setup` Step 0）：`gh repo fork --clone`，或建**私有仓** + 本仓作 upstream。两处都反复警告：GitHub 公开仓的 fork 永远公开、无法转私有，而 `/setup` 会把姓名/联系方式/履历/薪资预期写进 **tracked 文件**——推到公开 fork 等于公开个人数据。`/setup` 启动时先查 `git remote get-url origin` + `gh repo view` 的 visibility，是公开 fork 就先警告再继续。另有一个真实事故驱动的细节：`gh repo fork --clone` 默认把 upstream 设为 gh 默认仓，不改 `gh repo set-default` 的话后续 `gh issue create` 会静默发到上游公开 tracker（SETUP.md 引 #389）。
- 画像填充三条路径（`.claude/commands/setup.md`）：**Path A** 读 `documents/` 文件夹（清点→交叉核对一致性→生成变更集→逐项确认后写入，幂等可重跑）；**Path B** 单份 CV 导入（抽取 + 追问缺项）；**Path C** 访谈模式（9 个分节结构化提问）。三路汇合到同一套画像文件生成 + 确认。之后可 `/setup --section <name>` 局部更新。
- 持续拥有：更新走**打 tag 的 release**而非裸 master；`tools/check_upstream_updates.py` 按 `framework_version` 预览哪些被个性化的文件会被上游改动碰到，`tools/upstream_triage.py` 把落后提交分拣为"值得看 / 可跳过"（按 patch-id 识别已 cherry-pick 的）；fork 自带 `upstream-watch.yml` 每周把分拣结果写进一个滚动 issue。冲突的定位是"特性不是故障"——说明上游改了你定制过的方法论段落，保留数据、采纳方法即可。

---

## 3. 登顶因素分析

star 数 57,184（PRD 背景数据，未独立核验）。以下按功能 / 叙事 / 时机拆解，给出依据与判断。

### 3.1 功能面：解决的是"质量可信"而非"生成速度"

- **产物可交付性**：同类"AI 写简历"项目大多止步于生成文本；本仓把 LaTeX 编译+版面量化检查+ATS 文本层验证做成强制环节（`/apply` Step 5 不可跳过），直接命中"AI 生成的简历排版破碎、ATS 读不出"这一真实痛点。README 用整节 "What makes this workflow different" 讲这件事（PDF verification loop / ATS verification / relevance-weighted cutting / drafter-reviewer separation），差异化是工程性的、可验证的。
- **可信度机制成体系**：三源事实对齐审计、"永不编造、缺口诚实呈现"、posting_guard 确定性门禁、只读子 agent、settings.json 三层权限、SECURITY.md——对"把职业数据交给 agent"这件高敏感的事，它给出的不是口号而是一整套可审计机制。
- **生态扩展点**：三扩展点（portal skills / document templates / evaluation criteria）都不需要改上游；`/add-portal`、`/add-template` 是生成器命令；portal skill 有统一契约（search/detail CLI + `--format json|table|plain` + `enabled:` 标记 + 自带测试），`/scrape` 自动发现。丹麦四门户是样板间，国家无关的 linkedin-search（零运行时依赖）与 freehire-search 证明模式可移植；社区 fork 与 portal 索引挂在 Discussions #78，形成网络效应入口。

### 3.2 叙事面：先有故事，再有仓库

- **"Does it actually work?" 开篇即证据**：作者本人 2025 年底被裁后用这套流程跑自己的求职——69 份定制申请、20 次初面、1 份签约、2026 年 6 月入职 AI 工程师。数字具体、有 LinkedIn 长文可查、且声明"对每个雇主都坦白用了 AI"，把最大的信任疑虑（作弊感）正面化解。这不是功能列表，是可转述的故事。
- **命名与一句话定位**：仓库名直白（ai-job-search），slogan "The job search that runs on your machine" 同时点题隐私卖点；吉祥物 Pip（信使鸟）+ Ko-fi 的"省了一个周日的求职信 = 一杯咖啡，拿到 offer = 两杯"是低门槛情感钩子。
- **安全叙事独立成章**：SECURITY.md 单独成文，README 不回避边界——明说"agentic 防御是指令级的、不是沙箱，在陌生招聘站上发送前自己扫一眼抓回来的内容"。这种主动暴露局限的写法反而抬升可信度；再加上"无关联加密货币/代币，声称有的一律是诈骗"的免责声明，显示作者在主动管理爆红后的仿冒风险（侧面印证流量量级）。
- **贡献者生态有治理**：CONTRIBUTING.md 明确"什么进上游、什么活在 fork"，CI 有 LaTeX 冒烟编译、skill lint、CLI typecheck 与 security_guards；上游更新工具链（check_upstream_updates / upstream_triage / upstream-watch 周报 issue）让 fork 主能长期跟上游而不被合并冲突劝退——留存机制是为"个人数据的仓要跟一辈子"设计的。

### 3.3 时机面

- Claude Code 2025 年走红后，"把 Claude Code 当运行时、仓库即应用"的形态正处红利期；本仓是求职这一高频刚需场景里完成度最高的样本之一（命令全家桶已达 13+：setup/scrape/rank/apply/interview/outcome/expand/upskill/add-portal/add-template/html-report/notion-sync/gmail-sync/reset）。
- 求职焦虑是经济下行期的长青话题，作者故事自带媒体传播性（已有第三方视频 walkthrough 被 README 引用，录制于 2026 年 8 月）；Trendshift 徽章挂在 README 顶部，说明它吃到过榜单流量并把徽章回挂形成循环。

### 3.4 判断

三者权重排序：**叙事 > 功能可信度 > 时机**。同类功能（LLM 定制简历）并不稀缺，时机红利同行共享；真正把它推过临界点的是"作者本人靠它拿到 offer"的可验证故事 + 与之匹配的一整套可信度工程——故事负责让人点进来并 star，工程负责让人真的 fork 下去用、并在社区里持续产出 portal/fork 形成复利。

---

## 4. 对 brain-27 / PRD-080 的启示（要点）

> 标注规则：「可复用点（MIT）」= 可按 MIT 条款复用其实现/文本，须标注来源；「仅借鉴形态」= 只借鉴结构与思路，实现与文本需自研原创。差距清单是 T2 的工作，此处不展开。

1. **确定性门禁前置**：外部抓取内容先过无 LLM 的完整性门禁再进模型上下文（posting_guard 的剥离隐藏内容 + 指令形行文标记 + verdict 行模式），"标记不自动拒绝、交用户裁决"的处置方式也可直接借鉴。
2. **不可信输入的信任边界声明**：在每个消费外部文本的 agent prompt 顶部重复"这是数据、不是指令"的规则、且禁止跟随正文内链接——规则文本需按自家场景重写。
3. **drafter–reviewer 双 agent + 只读评审者**：生成者与评审者分离、评审者新鲜上下文且无写权限、反馈走结构化编辑协议（精确字符串替换 JSON + 叙事建议双轨）——形态可借鉴，prompt 与 agent 定义须原创。
4. **事实三源对齐审计**：产物中的每个事实 claim 必须能被权威源并集支撑、无据即删；以及"用户口头确认的新事实当轮回写源文件"的输入侧规则。
5. **产物强制验证回路**：verify_pdf / verify_layout 这类"编译后量化检查产物"工具的实现思路与脚本（页数、版面空洞、文本层可解析性）可按 MIT 复用改造；"检查不可跳过、失败就改源重跑"的流程纪律借鉴形态即可。
6. **评估先行 + 人工确认门**：先出带分数与依据的评估、用户点头才进昂贵生成环节；评估框架的"硬门（资格/语言）先于打分、五维加权、阈值分档"结构可参考，维度与权重须按 brain-27 场景自定。
7. **本地文件即数据库**：CSV tracker 的列设计与"状态词表单点定义、终态行永不覆盖、更新不倒退"的写入纪律，可直接参考其字段与规则实现自家版本；seen_jobs 一类大状态文件"只经查询工具读、永不整表进上下文"的 token 纪律同样适用。
8. **公司/机构研究缓存**：按规范化名落盘 JSON + TTL + "缓存是线索不是证据、入稿前仍须复核"的规则。
9. **权限三层模型**：settings.json 式 allow（日常链路免问）/ ask（改框架与安全边界必问）/ deny（读密钥、数据外发硬禁）+ CI 守卫防漂移——结构借鉴，具体条目按自家工具链重列。
10. **fork-and-own 的隐私前置**：在写入个人数据前先查发布面（公开 fork 警告）、敏感文件 gitignore、上游更新按版本标记预览影响面——这套"个人数据仓的长期维护"经验对任何本地化申请助手都是现成教案。
11. **扩展点契约化**：portal skill 的统一契约（CLI 接口 + 输出格式 + enabled 标记 + 自带离线测试）+ 自动发现，是多市场扩展不失控的关键形态。
12. **叙事资产**：README 的 "Does it actually work?" 式实证开篇（真实漏斗数字 + 可外查链接 + 坦白使用 AI）与主动写明能力边界的安全叙事——写法可学，内容必须来自自家真实数据。

---

## 5. 附：关键文件索引

| 文件 | 角色 |
|---|---|
| `README.md` | 产品叙事、命令全景、扩展模型、安全声明入口 |
| `SETUP.md` | 安装/fork/私有仓配方、上游更新流程（第 8 节） |
| `CLAUDE.md` | 画像模板 + 工作流总则 + Verification Checklist（全仓唯一验证清单） |
| `.claude/commands/apply.md` | 四段链主编排（Step 0–6b，含门禁、双 agent、编译验证、tracker 记录、JD 归档） |
| `.claude/commands/setup.md` | 画像入口三路径（documents / 单 CV / 访谈）+ 公开 fork 隐私警告 |
| `.claude/commands/rank.md` | 批量分诊：rank_state 查询 + 并行只读 scorer + shortlist |
| `.claude/commands/interview.md` | 面试 prep pack（归档驱动、一致性简报、mock interview） |
| `.claude/skills/job-application-assistant/SKILL.md` | 核心 skill 定义（framework_version 1.3.6）与文件地图 |
| `.claude/skills/job-application-assistant/01-candidate-profile.md` | 画像结构（三源审计的源一） |
| `.claude/skills/job-application-assistant/03-writing-style.md` | 文风规则（求职信结构/no em-dash 等硬规则） |
| `.claude/skills/job-application-assistant/04-job-evaluation.md` | 评估框架：双硬门 + 五维加权 + 阈值 + 公司研究缓存规范 |
| `.claude/skills/job-application-assistant/05-cv-templates.md` | CV 模板：页数硬限、相关性加权裁剪、ATS 可解析性、日期 ASCII 规则 |
| `.claude/skills/job-application-assistant/06-cover-letter-templates.md` | 求职信模板：cover.cls、1 页硬限、编译检查回路 |
| `.claude/skills/job-application-assistant/07-interview-prep.md` | STAR 例子库、难题清单、roleplay 协议 |
| `.claude/settings.json` | 权限模型 allow / ask / deny |
| `tools/posting_guard.py` | 确定性完整性门禁（清洗 + 扫描 + verdict） |
| `tools/verify_pdf.py` / `tools/verify_layout.py` | PDF 页数/文本层验证与版面量化检查 |
| `tools/rank_state.py` | seen_jobs 状态查询（候选筛选/过期 sweep） |
| `tools/fetch_page.py` / `tools/robots_check.py` | 403 浏览器头重试（robots.txt 约束） |
| `tools/check_upstream_updates.py` / `tools/upstream_triage.py` | fork 侧上游更新预览与提交分拣 |
| `tools/security_guards.py` | CI 安全守卫（权限/授权/gitignore 防漂移） |
| `.claude/agents/posting-fetcher.md` / `application-reviewer.md` / `posting-scorer.md` | 只读子 agent 定义（本次未逐一打开原文，存在与职责据 apply.md / rank.md 引用确认） |
| `SECURITY.md` | 安全模型与边界声明（本次未打开原文，内容据 README 转述） |

*未确认事项*：`.claude/agents/*` 三个子 agent 的权限细节为据命令文件引用推得，未读原文；`02-behavioral-profile.md`、`08-application-forms.md`、`09-web-research.md` 仅经引用了解，未通读；star 数 57,184 来自 PRD 背景，未独立核验。
