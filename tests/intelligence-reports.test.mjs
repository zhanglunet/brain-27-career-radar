import assert from "node:assert/strict";
import test from "node:test";
import { refreshIntelligenceReports } from "../lib/intelligence-reports.ts";

class FakeDatabase{
  writes=[];
  prepare(sql){return new FakeStatement(this,sql)}
}
class FakeStatement{
  values=[];
  constructor(database,sql){this.database=database;this.sql=sql.replace(/\s+/g," ").trim()}
  bind(...values){this.values=values;return this}
  async first(){if(this.sql.startsWith("SELECT"))return{new_opportunities:2,new_sources:3,new_papers:5,new_policies:2,new_projects:1,source_changes:1,source_failures:0,source_runs:4,academic_runs:4,policy_runs:2};throw new Error(`Unexpected first: ${this.sql}`)}
  async all(){if(this.sql.includes("FROM opportunities"))return{results:[{name:"机会 A"}]};if(this.sql.includes("FROM sources"))return{results:[{name:"来源 A"}]};if(this.sql.includes("FROM papers"))return{results:[{name:"论文 A"}]};if(this.sql.includes("FROM research_policies"))return{results:[{name:"政策 A"}]};if(this.sql.includes("FROM research_projects"))return{results:[{name:"项目 A"}]};throw new Error(`Unexpected all: ${this.sql}`)}
  async run(){this.database.writes.push({sql:this.sql,values:this.values});return{success:true}}
}

test("refreshes daily, Monday-based weekly and monthly reports",async()=>{
  const database=new FakeDatabase();
  const reports=await refreshIntelligenceReports(database,new Date("2026-08-01T07:30:00.000Z"));
  assert.deepEqual(reports.map((item)=>[item.id,item.periodStart,item.periodEnd]),[
    ["daily:2026-08-01","2026-08-01","2026-08-01"],
    ["weekly:2026-07-27","2026-07-27","2026-08-02"],
    ["monthly:2026-08-01","2026-08-01","2026-08-31"],
  ]);
  assert.equal(database.writes.length,3);
  assert.match(reports[0].summary,/新增机会 2 个、信息源 3 个、论文 5 篇/);
  assert.deepEqual(reports[0].highlights,{opportunities:["机会 A"],sources:["来源 A"],papers:["论文 A"],policies:["政策 A"],projects:["项目 A"]});
  assert.ok(database.writes.every((item)=>item.sql.includes("ON CONFLICT(period_type,period_start) DO UPDATE")));
});
