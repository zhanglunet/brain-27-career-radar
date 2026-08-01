import assert from "node:assert/strict";
import test from "node:test";
import { discoverProviderPapers } from "../lib/paper-providers.ts";

const researcher = { id: "r-tim-behrens", name: "Tim Behrens" };
const now = new Date("2026-08-01T00:00:00.000Z");

test("Crossref adapter keeps only author-and-topic matched papers", async () => {
  const fetcher = async (input) => {
    const url = new URL(input.toString());
    assert.equal(url.hostname, "api.crossref.org");
    return Response.json({ message: { items: [
      { DOI: "10.1000/brain", title: ["Neural learning in the brain"], author: [{ given: "Tim", family: "Behrens" }], published: { "date-parts": [[2026, 5, 1]] }, type: "journal-article", URL: "https://doi.org/10.1000/brain" },
      { DOI: "10.1000/noise", title: ["Competition law"], author: [{ given: "Tim", family: "Behrens" }] },
    ] } });
  };
  const result = await discoverProviderPapers("crossref", researcher, fetcher, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].doi, "10.1000/brain");
  assert.equal(result[0].provider, "crossref");
});

test("Europe PMC adapter returns PMID and DOI with open-access metadata", async () => {
  const fetcher = async (input) => {
    const url = new URL(input.toString());
    assert.equal(url.hostname, "www.ebi.ac.uk");
    assert.match(url.searchParams.get("query") ?? "", /AUTH:"Tim Behrens"/);
    return Response.json({ resultList: { result: [{
      id: "42092183", pmid: "42092183", doi: "10.1038/s41593-026-02291-3",
      title: "Human hippocampal ripples coordinate neural planning sequences.",
      authorList: { author: [{ firstName: "Tim", lastName: "Behrens", fullName: "Behrens T" }] },
      journalTitle: "Nature Neuroscience", firstPublicationDate: "2026-05-06", isOpenAccess: "Y",
      fullTextUrlList: { fullTextUrl: [{ url: "https://example.test/fulltext" }] }, pubTypeList: { pubType: ["Journal Article"] },
    }] } });
  };
  const result = await discoverProviderPapers("europe_pmc", researcher, fetcher, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].pmid, "42092183");
  assert.equal(result[0].openAccessUrl, "https://example.test/fulltext");
  assert.equal(result[0].provider, "europe_pmc");
});

test("Europe PMC adapter requires affiliation evidence for ambiguous names", async () => {
  const fetcher = async () => Response.json({ resultList: { result: [{
    id: "1", pmid: "1", title: "Neural learning mechanisms in the brain.",
    authorList: { author: [{ firstName: "Bin", lastName: "He", authorAffiliationDetailsList: { authorAffiliation: [{ affiliation: "Unrelated Hospital" }] } }] },
  }] } });
  const result = await discoverProviderPapers("europe_pmc", { id: "r-bin-he", name: "Bin He" }, fetcher, now);
  assert.equal(result.length, 0);
});
