# 本地求职文档 .docx 一键生成（PRD-150/T3）

> trend #752。上游：T1 字段模型与模板设计、T2 渲染引擎（`lib/local-apply/docx/`，PR #58）。
> 形态借鉴 genspark-ai/genoffice（Apache-2.0）「本地生成 + CLI + skill」思路，自研实现。

一条命令把本地档案渲染成真实 .docx 简历 / 求职信：**全程本地，数据不出本机**（渲染路径无网络请求，产物只落盘、不代发）。

## 一键生成

```bash
# 用虚构样例档案试跑（样例全虚构，T1 §3.1 纪律）
npm run docx:generate -- --template resume --profile examples/doc-profile.sample.json

# 用本机真实档案（~/.brain27/profile.json，与 PRD-080 申请助手同源；不入库）
npm run docx:generate -- --template resume

# 求职信：注入机会 JSON（公开情报）+ 匹配段草稿（materials 草稿只读消费）
npm run docx:generate -- --template cover-letter \
  --opportunity opportunity.json --letter-draft letter.md \
  --opportunity-id opp-001 --version 2
```

产物命名（T1 §4.3）：`{kind}-{opportunityId}-v{version}.docx`（resume → `cv`；cover-letter → `cover_letter`），缺省落在 `outputs/`（已在 `.gitignore`）。

## 选项

| 选项 | 说明 |
|---|---|
| `--template <resume\|cover-letter>` | 模板类型（必填）：中文简历 / 中文求职信 |
| `--profile <path>` | 档案 JSON：JobDocProfile 六区块嵌套形状，或老平铺形状（`degree`/`researchInterests`/`skills`/`experience:string[]`/`name` 自动归一）；缺省 `~/.brain27/profile.json` |
| `--out <dir>` | 输出目录（缺省 `outputs/`） |
| `--opportunity-id <id>` | 机会 ID，进文件名（缺省 `general`） |
| `--version <n>` | 版本号，进文件名（缺省 `1`） |
| `--opportunity <path>` | 机会 JSON（`title`/`org`/`type`/`region`/`deadline`/`keywords`/`mentors`；cover-letter 信头/来意段/佐证段用） |
| `--letter-draft <path>` | 求职信匹配段草稿文件（Markdown/文本；渲染层自动剥除草稿头部的 `> ⚠️` 标注块） |
| `--final` | 人工定稿版：不带 AI 草稿标注段（缺省带标注，T1 §3.3） |
| `--list-placeholders` | 只列出缺失必选字段（`[待填写：…]`），不写任何文件 |
| `-h, --help` | 用法说明 |

行为约定：缺失**必选**字段不阻断生成——占位符 `[待填写：字段路径]` 入文 + 命令行逐条 ⚠️ 警告；缺失**可选**字段按模板空槽规则跳过（如联系行自动少一段、成果区块整块省略）。退出码 `0` = 成功（含留有占位符），`1` = 用法/文件错误。

## Agent skill 用法（给本机 coding agent 的操作卡）

适用：Claude Code / ZCode 等本机会话中，用户说「帮我生成简历/求职信 docx」。

1. **检查档案**：读 `~/.brain27/profile.json`（真实档案，绝不可上传、不可入库、不得把字段值写进对话之外的文件）；
2. **预检占位符**：`npm run docx:generate -- --template resume --list-placeholders`，把缺失必选字段清单报给用户，请其补填（不要替用户编造个人信息）；
3. **生成**：补填后执行一键生成命令；把产物绝对路径与 ⚠️ 警告（若有）原样转述；
4. **终稿**：用户人工改写并确认后，加 `--final` 重新导出无 AI 标注版；投递由用户手动完成（工具无上传/发送通道，也不得用其它通道代发）。

硬规则：本 skill 只读本地文件、只写 `--out` 目录；不发起网络请求；不把真实档案内容写进仓库（样例一律用 `examples/doc-profile.sample.json` 的虚构数据）。

## 测试

```bash
node --experimental-strip-types --test tests/local-apply-docx-cli.test.mjs  # T3 端到端（入口命令 → 真实 .docx 产物断言）
node --experimental-strip-types --test tests/local-apply-docx.test.mjs      # T2 渲染引擎回归
```

（`npm test` 全量跑；Node ≥ 22.18 起类型剥离默认开启，可省略 `--experimental-strip-types`。）


## 申请助手流程对接（T4，#753）

PRD-080 申请助手的产物三件套直接喂本入口即可生成求职信（样例见 `examples/apply-draft-sample/`，全虚构）：

```bash
node scripts/docx-apply-demo.mjs [--out <dir>]   # 一键演示：三件套 → cover_letter-*.docx
```

三件套与参数的对应：机会 JSON（`OpportunityInput` 形状）→ `--opportunity`；用户档案 → `--profile`；求职信匹配段草稿（带 AI 草稿标记）→ `--letter-draft`。渲染纯本地计算，无网络请求。

## T5 验收记录（trend #754）

验收标准（PRD-150 T5 行）逐条结论，机器断言见 `tests/local-apply-docx-acceptance.test.mjs`（6 例）：

| 验收标准 | 结论 | 证据 |
|---|---|---|
| 数据不出本机验证 | ✅ | 双重：①静态——渲染路径闭包（`scripts/docx-generate.mjs`、`scripts/docx-apply-demo.mjs`、`lib/local-apply/docx/**`、`lib/local-apply/drafter.ts`）逐文件 AST 扫描（typescript 编译器 API）：import 白名单（相对路径 / 非网络类 `node:` 内建 / 唯一渲染库 `docx`）、零 `fetch`/`WebSocket`/`XMLHttpRequest` 调用、零网络类内建 import、动态 `import()` 同白名单；注释里的字样不误伤（对 T3-6 行过滤口径的升级）。②运行——`tests/helpers/net-block.mjs` 预加载把 `net`/`tls`/`dns`/`fetch` 全部封死（连接即抛错）后：`docx-generate` 两模板、`docx-apply-demo`（`npm`→`node` 子进程链经 `NODE_OPTIONS` 一并封死）全部照常产出可重开的 `.docx`，退出码 0 |
| 样例文档合格 | ✅ | 两模板样例 `.docx` 重开断言（最小 ZIP 读取器，与 T2/T3 同一实现）：resume——段落/文本段数量下限、姓名/教育/技能（等级标注）内容、空 `phone` 槽与空 `outputs` 区块按模板空槽规则跳过不留痕、AI 标注段默认携带且用独立样式 `ai-draft-marker`；cover-letter——机会公开情报注入信头、匹配段草稿正文消费且头部 `> ⚠️` 标注块剥除、缺失必选字段（样例故意缺 `target.researchInterests`）占位符 `[待填写：…]` 入文、`--final` 终稿消除 AI 标注段但保留待填占位符（诚实呈现） |
| 无真实隐私样例入库 | ✅ | `examples/` 与 `docs/` 全量文本文件隐私扫描：非 `example.*` 域邮箱、大陆手机号（`1[3-9]\d{9}`）、18 位身份证号三类模式零命中；占位符与 `example.com`/`example.dev` 域放行；历史运维记录中的仓库主自有账户名显式豁免（非样例数据，T5 前已存在，登记于测试常量） |

测试命令与结果（原样）：

```bash
node --experimental-strip-types --test tests/local-apply-docx-acceptance.test.mjs   # 6 pass
node --experimental-strip-types --test tests/local-apply-docx.test.mjs \
     tests/local-apply-docx-cli.test.mjs tests/local-apply-docx-apply.test.mjs \
     tests/local-apply-docx-acceptance.test.mjs                                    # 20 pass（T2–T5 零回归）
```

AST 扫描有效性自证（会话内探针，非仓库文件）：构造含 `import net from "node:net"` 与真实 `fetch()` 调用的临时文件，同一扫描逻辑命中 `["import node:net","fetch()"]`；注释里的 `fetch(` 字样不命中。

