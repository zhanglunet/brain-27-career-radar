# 开发日志

## 2026-08-01

### 基线调查

- 确认 14 个机会和 5 个机构均硬编码于 `app/page.tsx`。
- 确认 `db/schema.ts` 为空，生成的 Worker 配置没有 D1、Cron、Queue 或 Workflow。
- 现有构建与渲染测试通过：1 test passed。
- 实时连通性检查发现：BrainCo 来源发生域名重定向；北京脑所响应较慢；字节 Seed 在 15 秒窗口内无响应。

### 开发范围

- 开始实施 P0：D1 schema、来源巡检、Cron、结构化日志、动态只读 API、前端安全降级和测试。
- P1 通用列表发现与 P2 模型审核后台保留为后续里程碑。

### 实施记录

- 建立 6 张 D1 业务表及 14 条机会、5 个机构、15 个来源的种子迁移。
- 首次本地迁移失败：生成配置位于 `dist/server`，相对路径 `drizzle` 被错误解析为 `dist/server/drizzle`。
- 修正：迁移目录改为相对生成配置的 `../../drizzle`，随后重新构建并验证。
- Worker 启动先后拒绝 `2026-08-01`（UTC 仍为未来）和 `2026-07-31`（Wrangler 4.92.0 内置运行时最多支持 `2026-05-22`）；最终固定为当前工具链实际支持的最新日期 `2026-05-22`。
- 动态 API 首次返回 503：未设置 D1 preview ID 时，迁移命令与开发服务器映射到不同本地实例。增加固定本地 UUID，生产 ID 继续由环境变量注入。
- 新增 API 后原 Node 渲染测试无法加载 `cloudflare:` 协议模块；将绑定读取改为 API 调用时延迟加载，保持首页故障降级可在普通 Node 环境验证。
- 最终回归发现默认本地 D1 状态落在 `dist/server/.wrangler`，会被下一次构建删除；迁移命令改为显式 `--persist-to .wrangler/state`，将状态移出构建产物目录。
- Wrangler 4.92.0 无法在 vinext `no_bundle` 产物上本地触发 Cron，升级至 4.118.0 后重新验证；Compatibility Date 随之推进到 `2026-07-31`。
- 新 Wrangler 拒绝旧 Vite 插件生成的 `legacy_env`；Cloudflare Vite 插件升级至 1.50.0。新版插件会自动把源配置中的 `drizzle` 重写为生成配置的 `../../drizzle`，因此移除旧版所需的手工相对路径。
- 依赖审计发现 Next 16.2.6 链路的生产高危项，升级至当前补丁版 16.2.12。`npm audit --omit=dev` 仍报告 PostCSS/Sharp 3 个高危传递项，当前审计建议会错误降级 Next 到 9.3.3，未执行；需跟踪上游修复。

### 运行验证

- 本地迁移成功：15 个来源、14 个机会、5 个重点机构。
- 动态 `/api/radar` 返回 HTTP 200、`dataOrigin=database`、14 个机会和 5 个机构。
- Wrangler 4.118.0 本地 scheduled endpoint 返回 HTTP 200。
- 首次真实巡检：检查 15 个来源，13 个成功、2 个超时、0 个内容变化，运行状态 `partial`；生成 13 个基线快照。
- 超时来源为上海人工智能实验室的联培博士和招聘页面；失败计数均为 1，旧内容继续保留。
- BrainCo 最终 URL 自动记录为 `https://www.brainco.tech/recruit`。
- 巡检后 API 返回 12 个带最新验证时间的机会；其余 2 个继续展示静态可信内容。
- 页面会把本次 `partial` 运行明确显示为“部分验证 / PARTIAL”，避免把局部成功呈现为全量实时。
- 最终验证：TypeScript、ESLint、构建和 5 个测试全部通过。完整依赖审计仍为 13 项（含开发依赖），生产依赖为上文记录的 3 项高危传递风险。
