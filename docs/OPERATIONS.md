# 运行手册

## 本地初始化

```bash
npm install
npm run db:migrate:local
npm run dev
```

`db:migrate:local` 会先构建应用，再把迁移应用到 `.wrangler/state`。本地固定 preview UUID 仅用于让各命令连接同一实例。

## 完整验证

```bash
npm run cf:typegen
npm run verify
```

`verify` 包括 TypeScript、ESLint、构建、SSR 和来源巡检测试。

## 本地触发 Cron

先启动构建后的 Worker：

```bash
npx wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/state
```

按 Wrangler 启动提示请求本地 scheduled endpoint；Wrangler 4.118.0 当前使用：

```bash
curl http://localhost:8787/cdn-cgi/local/scheduled
```

如需由本地 Worker 受控连接远程 D1 验证，必须同时显式设置真实数据库 ID 和远程开关；不要在日常开发中默认连接生产数据：

```bash
export BRAIN_RADAR_D1_ID='<database-id>'
export BRAIN_RADAR_REMOTE_D1=true
npm run build
npx wrangler dev --test-scheduled --config dist/server/wrangler.json
```

查询最近运行：

```bash
npx wrangler d1 execute brain-27-career-radar --local \
  --persist-to .wrangler/state \
  --config dist/server/wrangler.json \
  --command "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 5"
```

## 生产发布

1. 使用 `wrangler d1 create brain-27-career-radar` 创建真实数据库。
2. 把返回的 ID 设置为部署环境变量 `BRAIN_RADAR_D1_ID`。
3. 构建后执行远程迁移。
4. 运行 `npm run deploy`；预检会拒绝缺少生产 D1 ID 的部署。
5. 验证 `/api/radar` 返回 `dataOrigin=database`。
6. 在 Workers Logs 中检查 `radar.sync.*` 和 `radar.source.*` 结构化事件。
7. 打开 `/system`，确认 D1 正常并在首个计划时刻后出现最近一次巡检记录。

## 生产域名

- 主入口：`https://radar.openagent.hk`
- 备用入口：`https://brain-27-career-radar.zhanglu-net.workers.dev`
- `www.openagent.hk` 已有现存站点，不由本 Worker 接管。
- Custom Domain 由生产构建中的 `routes[].custom_domain=true` 管理，发布时由 Cloudflare 创建 DNS 与证书。

## 故障处理

- 单来源失败：检查 `sources.consecutive_failures`，系统会保留最后可信内容。
- 连续三次失败：系统创建 `repeated_failure` 审核项。
- 内容变化：系统保存新快照并创建 `content_changed` 审核项，不自动覆盖高风险语义字段。
- D1/API 不可用：浏览器保留静态种子，并显示 `STATIC/静态快照`。
- 紧急停更：在 Worker 配置中移除或暂时禁用 Cron，再重新部署；不要删除 D1。

## 日志与数据边界

- Worker 日志只记录运行 ID、来源 ID、状态、计数、最终 URL和有限错误信息。
- 不把完整网页正文写入日志；数据库快照只保存有限长度纯文本摘要。
- `.wrangler/`、`.env*` 和构建产物均不提交。
