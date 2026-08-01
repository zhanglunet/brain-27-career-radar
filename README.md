# 2027 脑科学与人工智能机会雷达

面向 2027 年毕业的实验心理学硕士，汇总脑科学、脑机接口、脑与人工智能方向的企业校招和博士招生机会。

项目基于 [vinext](https://github.com/cloudflare/vinext)，部署到 Cloudflare Workers。

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run db:migrate:local
npm run dev
```

`vinext build` 会在 `dist/server/wrangler.json` 生成 Worker 部署配置。

## Included Shape

- edit site code under `app/`
- `vite.config.ts` 定义 Cloudflare Worker 入口与本地开发配置
- `db/schema.ts` defines the auditable P0/P1 D1 data model
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run deploy`: build and deploy to Cloudflare Workers
- `npm test`: build and verify SSR plus source-monitor success/change/failure behavior
- `npm run verify`: run type checking, lint, build, and all tests
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run db:migrate:local`: apply all radar migrations and seed data to local D1
- `npm run cf:typegen`: regenerate binding and runtime types from the built Worker config

## Automatic updates

The radar stores sources, opportunities, institutions, source snapshots, review items, sync runs, extraction candidates, field evidence, and change sets in D1. A Cloudflare Cron trigger runs every day at `01:00 UTC`. Source checks use bounded response reads, request timeouts, conditional requests, and structured logs. Five P1 pilot sources additionally run deterministic adapters and risk routing; automatic merge is disabled by default. A failed source check or extraction preserves the last trusted opportunity content.

Local D1 uses a fixed preview UUID and persists under `.wrangler/state`, so builds, Wrangler commands, and the dev server share the same database. Production requires a real D1 database ID:

```bash
npx wrangler d1 create brain-27-career-radar
export BRAIN_RADAR_D1_ID='<database-id>'
npm run build
npx wrangler d1 migrations apply brain-27-career-radar --remote --config dist/server/wrangler.json
npm run deploy
```

Do not commit `.env` files or credentials. See `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/DEVELOPMENT_LOG.md`, and `docs/DEPLOYMENT_LOG.md` for requirements, decisions, operations, and verified implementation history.

Production documentation pages:

- `/system`: live aggregate health, update flow, automation boundary, and operator actions
- `/prd`: product goals, phased scope, functional requirements, rules, and acceptance criteria
- Primary domain: `https://radar.openagent.hk`

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
