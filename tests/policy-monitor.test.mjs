import assert from "node:assert/strict";
import test from "node:test";
import { extractPolicyCandidates } from "../lib/policy-monitor.ts";

test("policy monitor discovers official calls and ignores navigation noise",()=>{
  const items=extractPolicyCandidates(`
    <a href="/funding/call-2027?utm_source=news">2027 Neuroscience Funding Call</a>
    <a href="/strategy/ai-science">AI in Science Strategy and Work Programme</a>
    <a href="/funding/call-2027">2027 Neuroscience Funding Call duplicate</a>
    <a href="/news">News</a>
    <a href="https://linkedin.com/posts/test">Funding on LinkedIn</a>
    <a href="/about">About us</a>
  `,"https://funding.example.gov/programmes");
  assert.equal(items.length,2);
  assert.equal(items[0].candidateUrl,"https://funding.example.gov/funding/call-2027");
  assert.equal(items[0].policyType,"funding");
  assert.equal(items[1].policyType,"strategy");
  assert.ok(items.every(item=>item.confidence>=78));
});

test("policy monitor recognizes Chinese funding and talent calls",()=>{
  const items=extractPolicyCandidates(`<a href="/notice/1">2027年度青年人才基金项目申报指南</a><a href="/">首页</a>`,"https://science.example.cn/notices");
  assert.equal(items.length,1);
  assert.equal(items[0].policyType,"funding");
});
