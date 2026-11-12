import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from "../platform/crypto.ts";

test("哈希格式与校验", async () => {
  const stored = await hashPassword("correct horse");
  assert.match(stored, /^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword("correct horse", stored), true);
  assert.equal(await verifyPassword("wrong horse", stored), false);
});

test("同一密码两次哈希不同（加盐）", async () => {
  assert.notEqual(await hashPassword("x".repeat(8)), await hashPassword("x".repeat(8)));
});

test("损坏的存储值返回 false 而不抛错", async () => {
  assert.equal(await verifyPassword("a", "garbage"), false);
  assert.equal(await verifyPassword("a", "pbkdf2$abc$$"), false);
  assert.equal(await verifyPassword("a", "pbkdf2$100000$AAAA$"), false);
});

test("randomToken 默认 32 字节 base64url 且唯一", () => {
  const token = randomToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(randomToken(), randomToken());
});

test("sha256Hex", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("timingSafeEqual", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});
