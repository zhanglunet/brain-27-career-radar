/** 请求上下文与路由类型。 */
import type { Deps, PlatformEnv } from "./env.ts";

export type Ctx = { request: Request; env: PlatformEnv; deps: Deps; url: URL };

export type Route = {
  method: "GET" | "POST";
  pattern: RegExp;
  handler(ctx: Ctx, params: string[]): Promise<Response>;
};
