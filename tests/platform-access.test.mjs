import assert from "node:assert/strict";
import test from "node:test";
import { verifyAccessJwt } from "../platform/access.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";

const TEAM = "team.example.test";
const AUD = "aud-123";
const NOW = 1_700_000_000_000;

const b64url = (input) => Buffer.from(input).toString("base64url");

async function keyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function sign(privateKey, header, payload) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString("base64url")}`;
}

async function fixture() {
  const pair = await keyPair();
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwks = { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] };
  const calls = [];
  const fetchJwks = async (url) => { calls.push(url); return jwks; };
  const payload = { aud: [AUD], iss: `https://${TEAM}`, exp: Math.floor(NOW / 1000) + 600, email: "admin@example.test" };
  const good = await sign(pair.privateKey, { alg: "RS256", kid: "k1" }, payload);
  return { pair, fetchJwks, calls, payload, good };
}

const opts = (fetchJwks, now = NOW) => ({ teamDomain: TEAM, aud: AUD, now, fetchJwks });

test("合法 Access JWT 通过，并从团队域名取 JWKS", async () => {
  const { fetchJwks, calls, good } = await fixture();
  assert.equal(await verifyAccessJwt(good, opts(fetchJwks)), true);
  assert.deepEqual(calls, [`https://${TEAM}/cdn-cgi/access/certs`]);
});

test("aud 不符、iss 不符、过期、签名错、alg=none、kid 不存在、格式错均拒绝", async () => {
  const { pair, fetchJwks, payload, good } = await fixture();
  const other = await keyPair();
  const cases = {
    aud: await sign(pair.privateKey, { alg: "RS256", kid: "k1" }, { ...payload, aud: ["other"] }),
    iss: await sign(pair.privateKey, { alg: "RS256", kid: "k1" }, { ...payload, iss: "https://evil.example.test" }),
    expired: await sign(pair.privateKey, { alg: "RS256", kid: "k1" }, { ...payload, exp: Math.floor(NOW / 1000) - 1 }),
    wrongKey: await sign(other.privateKey, { alg: "RS256", kid: "k1" }, payload),
    none: `${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64url(JSON.stringify(payload))}.`,
    kid: await sign(pair.privateKey, { alg: "RS256", kid: "missing" }, payload),
    tampered: good.replace(/\.[^.]+\./, `.${b64url(JSON.stringify({ ...payload, email: "x@example.test" }))}.`),
    garbage: "not-a-jwt",
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal(await verifyAccessJwt(token, opts(fetchJwks)), false, name);
  }
});

test("字符串形式的 aud 也可通过", async () => {
  const { pair, fetchJwks, payload } = await fixture();
  const token = await sign(pair.privateKey, { alg: "RS256", kid: "k1" }, { ...payload, aud: AUD });
  assert.equal(await verifyAccessJwt(token, opts(fetchJwks)), true);
});

test("JWKS 获取失败时拒绝", async () => {
  const { good } = await fixture();
  assert.equal(await verifyAccessJwt(good, opts(async () => { throw new Error("network"); })), false);
});

test("配置 ACCESS_AUD 后 /admin 无头 403，合法头 + 管理员会话 200", async () => {
  const { fetchJwks, good } = await fixture();
  const { env, deps, clock } = await makeEnv({ ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM });
  deps.fetchJwks = fetchJwks;
  clock.set(NOW);
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  assert.equal((await admin.get("/admin")).status, 403);
  assert.equal((await admin.get("/admin", { "cf-access-jwt-assertion": "bogus" })).status, 403);
  assert.equal((await admin.get("/admin", { "cf-access-jwt-assertion": good })).status, 200);
});

test("未配置 ACCESS_AUD 时 /admin 只看管理员会话", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  assert.equal((await admin.get("/admin")).status, 200);
});
