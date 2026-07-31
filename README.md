# 2027 脑科学与人工智能机会雷达

面向 2027 年毕业的实验心理学硕士，汇总脑科学、脑机接口、脑与人工智能方向的企业校招和博士招生机会。

项目基于 [vinext](https://github.com/cloudflare/vinext)，部署到 Cloudflare Workers。

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
npm run deploy
```

`vinext build` 会在 `dist/server/wrangler.json` 生成 Worker 部署配置。

## Included Shape

- edit site code under `app/`
- `vite.config.ts` 定义 Cloudflare Worker 入口与本地开发配置
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run deploy`: build and deploy to Cloudflare Workers
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
