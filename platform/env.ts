/** 私有平台 Worker 的绑定与可注入依赖。 */

export interface PlatformEnv {
  /** 私有 D1：账号与全部用户数据。 */
  PRIVATE_DB: D1Database;
  /** 公开 D1：只允许经 platform/data/public-readonly.ts 读取。 */
  PUBLIC_DB: D1Database;
  /** 唯一允许的主机名，例如 platform.example.test。 */
  PLATFORM_HOST: string;
  /** 首个管理员初始化口令；建好管理员后应删除该 secret。 */
  ADMIN_BOOTSTRAP_TOKEN?: string;
  /** Cloudflare Access 团队域名，例如 team.cloudflareaccess.com。 */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access 应用 AUD；设置后 /admin 额外校验 Access JWT。 */
  ACCESS_AUD?: string;
}

export interface Deps {
  now(): number;
  fetchJwks?(url: string): Promise<unknown>;
}
