import assert from "node:assert/strict";
import test from "node:test";
import { extractOrganizationCandidates } from "../lib/organization-discovery.ts";

test("trusted catalogs discover external institutions and reject noise", () => {
  const candidates = extractOrganizationCandidates(`
    <a href="https://new-neuro.example.org/">Centre for Neuro AI</a>
    <a href="https://known.example.org/about">Known Research Institute</a>
    <a href="/internal/list">Internal list</a>
    <a href="https://linkedin.com/company/test">LinkedIn</a>
    <a href="https://new-neuro.example.org/report.pdf">Annual report</a>
    <a href="https://another.example.ac.uk/">Cognitive Systems Laboratory</a>
  `, "https://catalog.example.gov/list", "research", new Set(["known.example.org"]));

  assert.deepEqual(candidates.map((item) => item.name), [
    "Centre for Neuro AI",
    "Cognitive Systems Laboratory",
  ]);
  assert.equal(candidates[0].candidateType, "research");
  assert.ok(candidates[0].confidence >= 80);
});

test("organization discovery canonicalizes and deduplicates links", () => {
  const candidates = extractOrganizationCandidates(`
    <a href="http://www.example.org/?utm_source=a">Example University</a>
    <a href="https://example.org/">Example University duplicate</a>
  `, "https://directory.test/list", "mixed");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateUrl, "https://example.org/");
  assert.equal(candidates[0].canonicalHost, "example.org");
});
