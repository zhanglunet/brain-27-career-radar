/** 私有平台 Worker 的绑定与可注入依赖。 */
import type { LlmProvider } from "./llm/types.ts";

export interface PlatformEnv {
  /** 私有 D1：账号与全部用户数据。 */
  PRIVATE_DB: D1Database;
  /** 公开 D1：只允许经 platform/data/public-readonly.ts 读取。 */
  PUBLIC_DB: D1Database;
  /** 私有 R2：简历文件，键以 `${userId}/` 开头，禁止公共访问。 */
  RESUMES: R2Bucket;
  /** Workers AI：只用于把简历转成文本，转换在 Cloudflare 内完成。 */
  AI: ResumeConverter;
  /** 找机会运行队列。 */
  FIND_QUEUE: Queue<FindMessage>;
  /** 博查 Web Search API key（Workers Secret）。 */
  BOCHA_API_KEY?: string;
  /** DeepSeek API key（Workers Secret）。 */
  DEEPSEEK_API_KEY?: string;
  /** 唯一允许的主机名，例如 platform.example.test。 */
  PLATFORM_HOST: string;
  /** 首个管理员初始化口令；建好管理员后应删除该 secret。 */
  ADMIN_BOOTSTRAP_TOKEN?: string;
  /** Cloudflare Access 团队域名，例如 team.cloudflareaccess.com。 */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access 应用 AUD；设置后 /admin 额外校验 Access JWT。 */
  ACCESS_AUD?: string;
}

export type FindMessage = { runId: string; userId: string };

export interface ResumeConverter {
  toMarkdown(file: { name: string; blob: Blob }): Promise<{ format: "markdown"; data: string } | { format: "error"; error: string }>;
}

export interface Deps {
  now(): number;
  /** 出站请求；测试可注入替身。 */
  fetch?: typeof fetch;
  /** 直接指定大模型实现（测试或切换供应商时使用），优先于 DeepSeek。 */
  llm?: LlmProvider;
  fetchJwks?(url: string): Promise<unknown>;
}
