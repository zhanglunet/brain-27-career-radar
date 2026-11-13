/** 私有平台 Worker 入口：HTTP 请求、找机会队列消费、每日刷新定时任务。不含静态资源或公开页面。 */
import { handleRequest } from "./app.ts";
import type { Deps, FindMessage, PlatformEnv } from "./env.ts";
import { enqueueDailyRuns, executeRun } from "./find/run.ts";

/**
 * Workers 的全局 fetch 不能被当作对象方法调用（this 不对会抛 Illegal invocation），
 * 所以这里统一包一层箭头函数再交给各模块。
 */
function runtimeDeps(): Deps {
  return { now: Date.now, fetch: (input, init) => fetch(input, init) };
}

const worker = {
  fetch(request: Request, env: PlatformEnv): Promise<Response> {
    return handleRequest(request, env, {
      ...runtimeDeps(),
      fetchJwks: (url: string) => fetch(url).then((response) => response.json()),
    });
  },

  async queue(batch: MessageBatch<FindMessage>, env: PlatformEnv): Promise<void> {
    for (const message of batch.messages) {
      await executeRun(env, runtimeDeps(), message.body);
      message.ack();
    }
  },

  async scheduled(_controller: ScheduledController, env: PlatformEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(enqueueDailyRuns(env, runtimeDeps()).then(() => undefined));
  },
} satisfies ExportedHandler<PlatformEnv, FindMessage>;

export default worker;
