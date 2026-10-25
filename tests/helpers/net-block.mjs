/**
 * PRD-150/T5 · 零网络运行断言的预加载（--import）helper（trend #754）。
 *
 * 用法：node --experimental-strip-types --import tests/helpers/net-block.mjs <入口…>
 * 或放进 NODE_OPTIONS 让子进程链（npm → node）一并继承。
 *
 * 在任何用户代码执行前把 Node 的全部出网通道封死（连接即抛错，fail-close）：
 * - node:net 的 Socket.prototype.connect / createConnection；
 * - node:tls 的 connect（tls 底层走 net，独立再封一层）；
 * - node:dns 的 lookup / resolve* / reverse / Resolver 原型方法；
 * - globalThis.fetch。
 *
 * 本 helper 只用于测试：被测入口若尝试任何出网连接会立刻以未捕获异常失败；
 * 「socket 封死后仍照常产出 .docx」即「数据不出本机」的运行时证据。
 */
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import process from "node:process";

const BLOCKED = () => {
  throw new Error("[T5-net-block] 网络已封死：渲染路径不应发起任何网络连接");
};

net.Socket.prototype.connect = function blockedConnect() {
  BLOCKED();
  return this;
};
net.createConnection = function blockedCreateConnection() {
  BLOCKED();
};
tls.connect = function blockedTlsConnect() {
  BLOCKED();
};

for (const name of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "reverse", "lookupService"]) {
  if (typeof dns[name] === "function") dns[name] = function blockedDns() { BLOCKED(); };
}
if (dns.promises?.lookup) dns.promises.lookup = function blockedDnsPromise() { BLOCKED(); };

globalThis.fetch = function blockedFetch() {
  BLOCKED();
};

process.on("exit", (code) => {
  if (code === 0) {
    process.stderr.write("[T5-net-block] 全程零出网连接，退出码 0\n");
  }
});
