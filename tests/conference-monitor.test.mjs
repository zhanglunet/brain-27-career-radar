import assert from "node:assert/strict";
import test from "node:test";
import { conferenceContentExcerpt } from "../lib/conference-monitor.ts";

test("conference monitor keeps official date content and strips executable noise",()=>{
  const excerpt=conferenceContentExcerpt(`<style>.x{display:none}</style><script>window.secret='x'</script><main><h1>EACL 2027</h1><p>Submission deadline: August 3, 2026, 23:59 AoE.</p></main>`);
  assert.equal(excerpt,"EACL 2027 Submission deadline: August 3, 2026, 23:59 AoE.");
  assert.doesNotMatch(excerpt,/window\.secret|display:none/);
});

test("conference monitor bounds stored evidence",()=>{
  assert.equal(conferenceContentExcerpt(`<p>${"a".repeat(9000)}</p>`).length,8000);
});
