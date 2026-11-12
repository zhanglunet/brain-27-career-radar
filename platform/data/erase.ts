/**
 * 彻底删除一个用户：先删 R2 中该用户前缀下的全部对象，再删数据库行。
 * R2 删除失败时直接抛错、不动数据库，下次重试仍能找到这些对象。
 */
import type { PlatformEnv } from "../env.ts";
import { forUser } from "./scoped.ts";

const MAX_ROUNDS = 1000;

export async function eraseUser(env: Pick<PlatformEnv, "PRIVATE_DB" | "RESUMES">, userId: string): Promise<void> {
  const prefix = `${userId}/`;
  // 每轮都从头列出再删除，直到列空：边删边用 cursor 翻页可能漏掉对象。
  for (let round = 0; ; round += 1) {
    if (round >= MAX_ROUNDS) throw new Error("R2 对象删除未能收敛");
    const page = await env.RESUMES.list({ prefix });
    const keys = page.objects.map((object) => object.key);
    if (!keys.length) break;
    await env.RESUMES.delete(keys);
  }
  await forUser(env.PRIVATE_DB, userId).deleteAll();
}
