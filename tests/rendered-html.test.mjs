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
  assert.match(html, /全局搜索/);
  assert.match(html, /全部机会/);
});

test("server-renders global search and the complete opportunity list", async () => {
  const search = await render("/search?q=脑机接口");
  assert.equal(search.status, 200);
  const searchHtml = await search.text();
  assert.match(searchHtml, /一处搜索/);
  assert.match(searchHtml, /整个机会雷达/);

  const opportunities = await render("/opportunities");
  assert.equal(opportunities.status, 200);
  const opportunitiesHtml = await opportunities.text();
  assert.match(opportunitiesHtml, /所有机会/);
  assert.match(opportunitiesHtml, /公开 ≠ 候选/);
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

  const providers = await render("/paper-sources");
  assert.equal(providers.status, 200);
  assert.match(await providers.text(), /论文数据库/);

  const graph = await render("/knowledge-graph");
  assert.equal(graph.status, 200);
  assert.match(await graph.text(), /知识图谱/);

  const beijing = await render("/beijing");
  assert.equal(beijing.status, 200);
  assert.match(await beijing.text(), /北京机会/);

  const calendar = await render("/calendar");
  assert.equal(calendar.status, 200);
  const calendarHtml = await calendar.text();
  assert.match(calendarHtml, /统一时间表/);
  assert.match(calendarHtml, /确认 ≠ 估算/);

  const graphPrd = await render("/prd/knowledge-graph");
  assert.equal(graphPrd.status, 200);
  assert.match(await graphPrd.text(), /截止日期治理/);

  const map = await render("/map");
  assert.equal(map.status, 200);
  const mapHtml = await map.text();
  assert.match(mapHtml, /全球分布一眼看清/);
  assert.match(mapHtml, /区域 → 城市/);

  const companies = await render("/ai-companies");
  assert.equal(companies.status, 200);
  const companiesHtml = await companies.text();
  assert.match(companiesHtml, /大模型公司机会/);
  assert.match(companiesHtml, /字节跳动 Seed \/ 豆包/);

  const reports = await render("/reports");
  assert.equal(reports.status, 200);
  const reportsHtml = await reports.text();
  assert.match(reportsHtml, /每天发生了什么/);
  assert.match(reportsHtml, /日报、周报和月报/);

  const campus = await render("/campus-2027");
  assert.equal(campus.status, 200);
  const campusHtml = await campus.text();
  assert.match(campusHtml, /2027 校招/);
  assert.match(campusHtml, /官方入口优先/);

  const discovery = await render("/discovery");
  assert.equal(discovery.status, 200);
  const discoveryHtml = await discovery.text();
  assert.match(discoveryHtml, /发现新的/);
  assert.match(discoveryHtml, /核验后才公开发布/);

  for (const [path, label] of [["/shanghai", "上海高校与科研机构"], ["/shenzhen", "深圳高校与科研机构"], ["/uk", "英国高校与科研机构"], ["/ireland", "爱尔兰高校与科研机构"], ["/hong-kong", "中国香港高校与科研机构"]]) {
    const region = await render(path);
    assert.equal(region.status, 200);
    assert.match(await region.text(), new RegExp(label));
  }
});
