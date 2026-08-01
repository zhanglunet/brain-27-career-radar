import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the opportunity radar", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>BRAIN \/ 27｜脑科学与 AI 机会雷达<\/title>/i);
  assert.match(html, /机会雷达/);
  assert.match(html, /北京智源人工智能研究院/);
  assert.match(html, /2027 级联合培养博士/);
  assert.match(html, /实验心理学/);
  assert.match(html, /科研助理/);
  assert.match(html, /支持先在高校积累研究成果，再申请博士/);
});

test("server-renders the source directory and collection log pages", async () => {
  const sources = await render("/sources");
  assert.equal(sources.status, 200);
  assert.match(await sources.text(), /信息源清单/);

  const logs = await render("/logs");
  assert.equal(logs.status, 200);
  assert.match(await logs.text(), /采集与发布日志/);
});

test("server-renders the academic intelligence pages", async () => {
  const researchers = await render("/researchers");
  assert.equal(researchers.status, 200);
  assert.match(await researchers.text(), /导师雷达/);

  const papers = await render("/papers");
  assert.equal(papers.status, 200);
  assert.match(await papers.text(), /最新论文/);

  const prd = await render("/prd/academic");
  assert.equal(prd.status, 200);
  assert.match(await prd.text(), /学术情报雷达/);
});
