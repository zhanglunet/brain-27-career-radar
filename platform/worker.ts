/** 私有平台 Worker 入口。不含 cron、静态资源或公开页面。 */
import { handleRequest } from "./app.ts";
import type { PlatformEnv } from "./env.ts";

const worker = {
  fetch(request: Request, env: PlatformEnv): Promise<Response> {
    return handleRequest(request, env, {
      now: Date.now,
      fetchJwks: (url: string) => fetch(url).then((response) => response.json()),
    });
  },
} satisfies ExportedHandler<PlatformEnv>;

export default worker;
