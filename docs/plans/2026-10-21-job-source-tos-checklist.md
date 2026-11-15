# PRD-117/T1：聚合职位搜索的来源与服务条款清单

> 对应 trend issue `zhanglunet/trend#584`。PRD 在中央仓库 `adopted/` 的 PRD-117。
> 借鉴：`strelov1/freehire`（MIT）。GitHub License API 实测 SPDX 为 `MIT`，许可证文件 blob `e7fd05a368cfba2adcc3eb34ea276e3f77a7aec9`，核对提交 `233874a1dce87b21ac51ca0bc06bd9b9ddaff7d7`（2026-10-21）。版权声明：Copyright (c) 2026 freehire contributors。
> 本文件是设计，不是抓取器。T1 不新增适配器、不改 Cron、不改 D1。
> 状态：**T1 待研究，未完成验收；当前真实来源准入数为 0。**
> 中央基准：`zhanglunet/trend` main `4dca217` 的 `adopted/PRD-117-brain27-aggregated-search.md`（文件 blob `154e957576c8522f00ba0460489c2c2ab009de9e`），T1 #584 要求“每个来源注明接入方式与条款结论”；T3 另要求至少 3 个合规来源。中央文档的占位要求针对真实内部主机/IP/账号/密钥，并非禁止引用公开的官方条款证据。

已读中央 PRD；原稿“中央仓库不可读”的范围假设已撤回。下文保留判定框架和**合成示例**，但没有已识别的真实来源、可核验条款文档或逐源结论。因此它不能充当 T1 完成证据，不能解锁 T2/T3 的来源接入，也不能据此请求真实服务。

### T1 逐源研究缺口

| 对象 | 当前证据 | 访问/条款结论 | 下一步与验收边界 |
|---|---|---|---|
| 具体 ATS 平台、聚合器和雇主来源 | 尚未选定或核验任何真实来源 | 待研究；没有来源获准接入 | 先确定真实来源标识，再逐源收集官方机器接口、访问身份、条款及限流证据；每源独立结论 |
| 参照项目 `strelov1/freehire` 的目录服务 | 原稿记录软件 MIT 许可证；未核验目录服务条款 | 软件许可不能证明目录数据可读、可存或可展示；`research_only` | 需独立核验服务和数据许可；未取得证据前不接入 |
| 第六节十个占位行 | 仅合成判定样例 | 全部不是实际来源结论；真实准入数 0 | 只说明判定算法，不能作为接入配置或验收计数 |

每个真实来源的研究记录至少需有：公开来源名称与标识、官方接口/供稿文档引用、条款引用与查阅日期、访问身份、允许保存/展示/回链的证据及限制、限流与反自动化要求、最终结论与依据、待确认项。可引用公开文档，但不得写内部地址或凭据。证据缺失时保持 `research_only`，不能把“公开可见”或软件 MIT 当作许可。本轮未访问真实招聘站或服务商，也未作法律授权判断。

## 一、定位

freehire 证明「多来源收成一份目录，再按同一形状去重」这条路走得通。brain-27 要的是同一形态里**与脑科学 / 认知神经 / 脑机接口 / 校招相关的那一层**，而且只能走发布方自己公开的机器接口。

现有链路已经在做另一件事：登记官方页面，按 `sources` 表巡检（ADR-016：没有稳定官方 API、明确的机器访问边界和可实现限流，就不能开自动发现）。PRD-117 的聚合搜索是这条纪律的扩展，不是把巡检换成「把招聘站页面扒下来」。

**非目标**（本设计遵守）：

- 不实现抓取、解析、去重入库或搜索 API。那些是后续任务。
- 不修改 `lib/source-monitor.ts`、种子数据和已有 `sources` 行。
- 不把参照仓库的适配器源码抄进本仓库。MIT 允许在保留版权声明的前提下复用代码；本 T1 选择不复用任何代码。
- 不把参照项目的职位数据、公司名单或平台清单当作可再发布的数据集。MIT 给的是软件许可，不是抓取许可，也不是数据许可。
- 不记录真实内部主机名、IP、账号、令牌、cookie 或密钥。运行时接入地址只出现为环境变量名，公开官方条款与接口文档可作为证据引用。

## 二、软件许可和数据权利分开

| 问题 | 结论 |
|---|---|
| 能否阅读参照实现来理解「一个来源一个适配器、统一职位形状、稳定外部 ID」 | 可以。形态可借鉴，文本和代码本 T1 不复制 |
| 能否在后续任务复制某个适配器文件 | 只有该行已经是 `admit`，且复制的是「调用发布方文档化接口」的部分，并在文件头保留 Copyright (c) 2026 freehire contributors 与 MIT 许可声明 |
| 能否复制浏览器仿真、验证码处理、指纹轮换或会话农场 | 不能。即便 MIT 覆盖那些文件，本产品禁止这类行为 |
| 能否把参照目录里的职位转存进 D1 | 不能。那是对方的数据，不在 MIT 授权里。若将来使用对方公开的 HTTP 目录，必须单独核对该服务的接口条款，见清单行 `src-reference-catalogue-api` |
| 本清单里的占位行是否构成对任何厂商的接入承诺 | 不构成。占位行只固定判定结果的形状，方便后续任务照着实现 |

## 三、硬闸门

一行要变成 `admit`，下面八条必须同时成立。任何一条失败，判定落到 `research_only` 或 `reject`，不允许「先抓再补条款」。

1. **访问方式**是 `official_http_api` 或 `official_feed`。发布方文档写明这是给程序读的接口或供稿，而不是给人看的网页。
2. **条款状态**是 `allowed`：允许服务器端自动读取，并且允许在 brain-27 保存字段、对用户展示、保留来源链接。只允许「自己看、不许再发布」的，不算 `allowed`。
3. **反自动化**是 `none_required`。接口在文档给出的身份下直接返回数据。不需要伪装浏览器、改客户端指纹、解验证码、打码、轮换代理、养号或在 403 之后换一套请求头重试。
4. **身份**是 `none` 或 `env_key`。`env_key` 只记录环境变量名，值不进 git、不进日志、不进清单。需要登录态、cookie 或用户账号的，直接 `reject`。
5. **限流**已写明：正整数配额，或发布方文档里的默认配额。`undocumented` 不能 `admit`。
6. **robots** 为 `allow` 或 `not_applicable`。API 条款已经覆盖机器访问时记 `not_applicable`。`disallow` 或 `unknown` 不能 `admit`。
7. **地址**只存在于环境变量。清单里写变量名，例如 `JOB_SOURCE_BASE_URL`。不写字面主机、IP、端口上的真实服务或路径里的真实租户。
8. **失败即停**。配额用尽、条款读不到、接口改成登录墙，处理方式是停用该行并保持已入库记录不变。不降级到 HTML，不换入口。

`research_only` 的含义：材料不够，先不接。`reject` 的含义：按现在的证据就不该接，除非发布方改了条款或接口，否则不再重开。

## 四、字段

后续任务若把清单落成配置，字段按下表，不要另起一套词。T1 不创建该文件。

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | `^[a-z0-9-]{3,64}$`，全局唯一 |
| `kind` | enum | `ats_platform` / `aggregator` / `employer_career` / `reference_catalogue` |
| `access_mode` | enum | `official_http_api` / `official_feed` / `public_document` / `unknown` |
| `tos_status` | enum | `allowed` / `restricted` / `forbidden` / `unchecked` |
| `tos_ref` | string | 真实研究记录须提供公开官方条款引用与查阅日期；合成示例才使用占位名。未读到条款时为空字符串 |
| `robots` | enum | `allow` / `disallow` / `not_applicable` / `unknown` |
| `auth` | enum | `none` / `env_key` / `session_required` |
| `credential_env` | string | 仅 `auth=env_key` 时填写变量名；其他情况为空字符串。禁止填值 |
| `base_url_env` | string | 运行时基址的变量名。禁止填 URL |
| `rate_limit` | object 或 `undocumented` | `{ requests, per_seconds, source }`，`requests` 与 `per_seconds` 为正整数，`source` 为 `publisher-doc` 或 `unset` |
| `anti_bot` | enum | `none_required` / `requires_circumvention` |
| `stores_posting` | bool | 条款是否允许保存职位字段。`false` 不能 `admit` |
| `attribution` | enum | `link_back` / `not_required` / `forbidden` / `unknown` |
| `decision` | enum | `admit` / `research_only` / `reject` |
| `reason` | string | 一句话，说明判定依据 |

规范化职位形状沿用现有 `CandidateDraft`（`lib/p1/types.ts`）能放下的字段：`title`、`org`、`kind`、`location`、`deadline`、`url`，另加来源侧的 `external_id` 与 `source_id`。结构化字段只在接口自己给出时填写。不从正文猜职级、薪资或远程标记。

## 五、判定顺序

对每一行按这个顺序写 `decision`，中途命中就停。

1. `anti_bot = requires_circumvention` → `reject`。
2. `auth = session_required` → `reject`。
3. `tos_status = forbidden`，或 `attribution = forbidden` → `reject`。`stores_posting = false` 且条款已经读过（`tos_status` 为 `allowed` 或 `forbidden`）时同样 `reject`。条款还没读（`unchecked`）时，`stores_posting: false` 只表示还不能假定可以保存，不在这一步判死。
4. `robots = disallow` → `reject`（自动访问）。人工打开页面核对可以继续，那是现有来源目录的事，不进聚合。
5. `tos_status = unchecked`，或 `access_mode = unknown`，或 `robots = unknown`，或 `rate_limit = undocumented` → `research_only`。
6. `tos_status = restricted` → `research_only`，除非限制条件被写进 `reason` 并且仍然满足第三节全部八条；本清单的占位行不使用这条例外。
7. `access_mode = public_document` → `research_only`。网页不是本聚合的准入形态。已登记的官方页面继续走现有巡检，不在这里升格。
8. 其余（官方 API 或官方供稿，条款允许保存与展示，无限速缺口，不需要绕过反自动化）→ `admit`。

优先级，供以后挑选接入顺序，不改变判定：

1. 雇主或公共机构自己的官方 HTTP API。
2. 雇主自己发布的官方供稿（RSS、Atom 或 JSON feed），文档写明可供程序读取。
3. 多租户招聘系统**文档化的公开读接口**，且租户标识来自对方公开目录，不来自猜测。
4. 参照项目的公开目录 API。软件是 MIT，接口能不能用要单独核条款，核完之前保持 `research_only`。

## 六、合成判定示例（不构成真实来源清单）

下列名称、变量和条款引用都是合成占位符。`example_decision` 只是在假设条件成立时的算法输出，故意不使用可被接入代码读取的 `decision` 字段；不得转为实际准入。`tos_ref` 不是链接。`base_url_env` 的值由部署环境注入，不写进仓库。

```yaml
schema_version: 1
reference:
  project: strelov1/freehire
  license: MIT
  copyright: Copyright (c) 2026 freehire contributors
  commit: 233874a1dce87b21ac51ca0bc06bd9b9ddaff7d7
synthetic_examples:
  - id: src-gov-open-jobs
    kind: employer_career
    access_mode: official_http_api
    tos_status: allowed
    tos_ref: PLACEHOLDER_TERMS_GOV_OPEN_JOBS
    robots: not_applicable
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_GOV_OPEN_JOBS_BASE_URL
    rate_limit: { requests: 1, per_seconds: 1, source: publisher-doc }
    anti_bot: none_required
    stores_posting: true
    attribution: link_back
    example_decision: admit
    reason: 公共机构文档化的职位 API，允许保存字段并回链，有明确配额。

  - id: src-employer-json-feed
    kind: employer_career
    access_mode: official_feed
    tos_status: allowed
    tos_ref: PLACEHOLDER_TERMS_EMPLOYER_FEED
    robots: allow
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_EMPLOYER_FEED_BASE_URL
    rate_limit: { requests: 1, per_seconds: 5, source: publisher-doc }
    anti_bot: none_required
    stores_posting: true
    attribution: link_back
    example_decision: admit
    reason: 雇主为自己的职位发布的 JSON 供稿，robots 允许，条款允许展示并回链。

  - id: src-ats-public-board
    kind: ats_platform
    access_mode: official_http_api
    tos_status: allowed
    tos_ref: PLACEHOLDER_TERMS_ATS_PUBLIC_BOARD
    robots: not_applicable
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_ATS_PUBLIC_BOARD_BASE_URL
    rate_limit: { requests: 1, per_seconds: 2, source: publisher-doc }
    anti_bot: none_required
    stores_posting: true
    attribution: link_back
    example_decision: admit
    reason: 多租户系统文档中的公开读接口，租户标识取自对方公开目录，不猜测。

  - id: src-keyed-official-api
    kind: aggregator
    access_mode: official_http_api
    tos_status: allowed
    tos_ref: PLACEHOLDER_TERMS_KEYED_API
    robots: not_applicable
    auth: env_key
    credential_env: JOB_SOURCE_KEYED_API_KEY
    base_url_env: JOB_SOURCE_KEYED_API_BASE_URL
    rate_limit: { requests: 30, per_seconds: 60, source: publisher-doc }
    anti_bot: none_required
    stores_posting: true
    attribution: link_back
    example_decision: admit
    reason: 官方 API 使用密钥，密钥只存在于环境变量名所指的运行时配置。

  - id: src-reference-catalogue-api
    kind: reference_catalogue
    access_mode: official_http_api
    tos_status: unchecked
    tos_ref: ""
    robots: unknown
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_REFERENCE_CATALOGUE_BASE_URL
    rate_limit: undocumented
    anti_bot: none_required
    stores_posting: false
    attribution: unknown
    example_decision: research_only
    reason: 参照实现的软件是 MIT，其目录数据与接口条款尚未核对，不能当作可再发布来源。

  - id: src-aggregator-html
    kind: aggregator
    access_mode: public_document
    tos_status: unchecked
    tos_ref: ""
    robots: unknown
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_AGGREGATOR_HTML_BASE_URL
    rate_limit: undocumented
    anti_bot: none_required
    stores_posting: false
    attribution: unknown
    example_decision: research_only
    reason: 只有给人看的 HTML，没有文档化的机器接口，按 ADR-016 不进入自动聚合。

  - id: src-robots-disallow
    kind: employer_career
    access_mode: official_feed
    tos_status: allowed
    tos_ref: PLACEHOLDER_TERMS_ROBOTS_DISALLOW
    robots: disallow
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_ROBOTS_DISALLOW_BASE_URL
    rate_limit: { requests: 1, per_seconds: 5, source: publisher-doc }
    anti_bot: none_required
    stores_posting: true
    attribution: link_back
    example_decision: reject
    reason: 供稿存在，但 robots 拒绝自动读取。不换入口、不改身份重试。

  - id: src-tos-no-republication
    kind: aggregator
    access_mode: official_http_api
    tos_status: forbidden
    tos_ref: PLACEHOLDER_TERMS_NO_REPUBLICATION
    robots: not_applicable
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_NO_REPUBLICATION_BASE_URL
    rate_limit: { requests: 1, per_seconds: 1, source: publisher-doc }
    anti_bot: none_required
    stores_posting: false
    attribution: forbidden
    example_decision: reject
    reason: 接口公开，但条款禁止保存或再发布职位内容。

  - id: src-login-wall
    kind: ats_platform
    access_mode: official_http_api
    tos_status: restricted
    tos_ref: PLACEHOLDER_TERMS_LOGIN_WALL
    robots: not_applicable
    auth: session_required
    credential_env: ""
    base_url_env: JOB_SOURCE_LOGIN_WALL_BASE_URL
    rate_limit: undocumented
    anti_bot: none_required
    stores_posting: false
    attribution: unknown
    example_decision: reject
    reason: 需要账号会话。不注册账号、不保存 cookie、不借用人工登录态。

  - id: src-challenge-page
    kind: employer_career
    access_mode: public_document
    tos_status: unchecked
    tos_ref: ""
    robots: unknown
    auth: none
    credential_env: ""
    base_url_env: JOB_SOURCE_CHALLENGE_PAGE_BASE_URL
    rate_limit: undocumented
    anti_bot: requires_circumvention
    stores_posting: false
    attribution: unknown
    example_decision: reject
    reason: 只有在伪装客户端或通过人机验证之后才能读到内容。禁止绕过。
```

这十个合成样例的算法输出分布为 4/2/4，仅用于说明规则。它们没有实际 `decision`，不是后续任务的准入集合；当前真实来源 `admit` 数为 0。

## 七、和现有巡检的边界

- 已有 `sources` 表继续服务官方页面巡检、学术发现和人工核对。本清单不往那张表插行。
- ADR-016 对论文库的那句话，原样适用于职位聚合：开放网站不等于可自动抓取的 API。
- `lib/source-monitor.ts` 今天会带一组浏览器形态的请求头。那是既有官方页面巡检的行为，本 T1 不改它，也不把它解释成新聚合可以使用的手段。新链路不得复用那组请求头，不得在被拒绝后更换客户端指纹再试。
- 同一雇主若已经有官方页面来源，又在本清单里有 `admit` 行，后续去重以规范化后的职位 URL 加 `external_id` 为准。T1 不写去重实现。
- 发现范围仍限脑科学、认知神经、脑机接口、脑启发智能，以及这些方向上的博士、科研助理、校招、实习和研究岗位。通用 IT 目录整库搬入不是目标。

## 八、交给后续任务的契约

T1 逐源研究验收完成之后，后续任务才可开始写接入代码；本文件当前不解锁该步骤。届时：

- 只读 `decision: admit` 的行。`research_only` 与 `reject` 没有代码路径。
- 基址从 `base_url_env` 读取。变量缺失、为空，或看起来像占位符未被替换，则该行跳过并记一条失败，不影响其他行。
- `auth: env_key` 时，只从 `credential_env` 读密钥。请求日志记录来源 `id` 与状态码，不记录密钥、cookie 或完整查询串。
- 请求身份使用固定的、可识别的产品名与联系方式占位（具体字符串到实现任务再定），不使用浏览器指纹。
- 遵守该行 `rate_limit`。收到配额类响应就停止这一轮，不缩短间隔重试。
- 响应进现有证据链：原始摘录、字段、抽取器名、置信度。不自动把聚合结果标成已发布机会。发布仍走现有人工确认。
- 不新增 HTML 解析兜底。接口失败就失败。

建议的落点（本 PR 不创建）：`lib/job-sources/checklist.ts` 放类型与判定函数，纯规则测试可用第六节合成样例断言算法输出 4/2/4；这不计入真实来源覆盖率，也不代表 T1/T3 通过。

## 九、验收

**当前以下真实来源验收尚未满足，T1 仍未完成。** 不需要通过实际抓取来证明许可：

- 逐一列出真实候选来源，而非来源类别或合成行。
- 每个来源附官方访问方式和可核验证据引用，条款查阅日期、限制与结论；没有证据的明确待研究。
- 真实来源准入集合独立于合成示例；当前为空。

下面仅是原稿设计框架的静态自检，不是中央 PRD 的完成标准：

- 合成示例覆盖四类来源：`ats_platform`、`aggregator`、`employer_career`、`reference_catalogue`。
- 每个合成样例有 `example_decision`，可由第五节的顺序推出，但不可作为接入配置。
- 没有任何 `admit` 行的 `anti_bot` 为 `requires_circumvention`，`auth` 为 `session_required`，`tos_status` 不是 `allowed`，或 `access_mode` 落在 `public_document` / `unknown`。
- 文档不含真实内部主机名、IP、账号、邮箱或密钥值；公开官方证据可引用，运行时基址与密钥值不入文档。
- MIT 声明写明项目、SPDX、版权句和核对过的提交。
- 本 PR 的 diff 只有这份设计文档。

## 十、待确认

1. 参照目录的公开 API 在条款核对之后，是作为一条 `admit` 来源，还是永久保持 `research_only`、只借鉴形态。默认是后者，直到有人把 `tos_ref` 补成读过的条款。
2. `src-keyed-official-api` 这类密钥来源是否进入第一期。默认设计允许，前提是密钥不进仓库。
3. 现有浏览器形态请求头要不要在别的任务里收紧。那不是 #584 的 T1，本文件只要求新聚合不沿用。
