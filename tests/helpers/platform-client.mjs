/** 私有平台测试工具：内存私有库 + 只读公开库 + 可控时钟 + 带 cookie 的请求客户端。 */
import { applyPlatformMigrations, createSqliteD1, tempDbPath } from "./sqlite-d1.mjs";
import { handleRequest } from "../../platform/app.ts";
import { createInvite, createUser, findUserByEmail, setUserStatus } from "../../platform/data/accounts.ts";
import { hashPassword } from "../../platform/crypto.ts";
import { createFakeR2 } from "./fake-r2.mjs";

/** 测试用 Workers AI 替身：把文件字节按 UTF-8 解码当作转换结果。 */
export function fakeAi(handler) {
  return {
    calls: [],
    async toMarkdown(file) {
      this.calls.push(file);
      if (handler) return handler(file);
      return { format: "markdown", data: new TextDecoder().decode(await file.blob.arrayBuffer()) };
    },
  };
}

export const HOST = "platform.test";
export const ORIGIN = `https://${HOST}`;

export async function makeEnv(overrides = {}) {
  const privateDb = createSqliteD1();
  await applyPlatformMigrations(privateDb);
  const publicPath = tempDbPath();
  const writablePublic = createSqliteD1({ path: publicPath });
  await writablePublic.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, name TEXT, org TEXT, kind TEXT, location TEXT, deadline TEXT, url TEXT, published INTEGER);");
  const env = {
    PRIVATE_DB: privateDb,
    PUBLIC_DB: createSqliteD1({ readonly: true, path: publicPath }),
    PLATFORM_HOST: HOST,
    ADMIN_BOOTSTRAP_TOKEN: "test-bootstrap",
    RESUMES: createFakeR2(),
    AI: fakeAi(),
    DEEPSEEK_API_KEY: "test-key",
    ...overrides,
  };
  let current = 1_000_000;
  const clock = {
    set(ms) { current = ms; },
    advance(ms) { current += ms; },
    get now() { return current; },
  };
  const deps = { now: () => current };
  return { env, deps, clock };
}

export function client(env, deps, { fetchHandler = handleRequest } = {}) {
  const jar = {};
  async function send(path, init = {}) {
    const headers = new Headers(init.headers ?? {});
    if (jar.session) headers.set("cookie", `__Host-session=${jar.session}`);
    const response = await fetchHandler(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, deps);
    const setCookie = response.headers.get("set-cookie");
    if (setCookie?.startsWith("__Host-session=")) {
      const value = setCookie.slice("__Host-session=".length).split(";")[0];
      if (value) jar.session = value;
      else delete jar.session;
    }
    return response;
  }
  return {
    jar,
    get: (path, headers = {}) => send(path, { headers }),
    post: (path, form = {}, headers = {}) => send(path, {
      method: "POST",
      body: new URLSearchParams(form).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, ...headers },
    }),
  };
}

/** 直接在库里建一个已激活账号并登录，返回客户端。 */
export async function activeUser(env, deps, email, { role = "user", password = "password-123" } = {}) {
  await createUser(env.PRIVATE_DB, { email, passwordHash: await hashPassword(password), role, status: "active" }, deps.now());
  const c = client(env, deps);
  const response = await c.post("/login", { email, password });
  if (response.status !== 303) throw new Error(`login failed for ${email}: ${response.status}`);
  const user = await findUserByEmail(env.PRIVATE_DB, email);
  return Object.assign(c, { user });
}

export async function inviteCode(env, deps) {
  return createInvite(env.PRIVATE_DB, "seed-admin", deps.now());
}

export async function approve(env, deps, email) {
  const user = await findUserByEmail(env.PRIVATE_DB, email);
  await setUserStatus(env.PRIVATE_DB, user.id, "active", deps.now());
}
