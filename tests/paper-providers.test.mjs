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

test("arXiv adapter parses Atom metadata and keeps recent relevant preprints", async () => {
  const fetcher = async (input) => {
    const url = new URL(input.toString());
    assert.equal(url.hostname, "export.arxiv.org");
    return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>https://arxiv.org/abs/2607.12345v2</id><published>2026-07-20T00:00:00Z</published><title>Neural learning dynamics in the human brain</title><summary>A relevant preprint.</summary><author><name>Tim Behrens</name></author><arxiv:doi>10.1000/arxiv-paper</arxiv:doi></entry></feed>`, { headers: { "content-type": "application/atom+xml" } });
  };
  const result = await discoverProviderPapers("arxiv", researcher, fetcher, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].arxivId, "2607.12345");
  assert.equal(result[0].versionStatus, "preprint");
  assert.equal(result[0].doi, "10.1000/arxiv-paper");
});

test("PubMed adapter searches then fetches PMID, PMCID and DOI", async () => {
  let calls = 0;
  const fetcher = async (input) => {
    calls += 1;
    const url = new URL(input.toString());
    assert.equal(url.hostname, "eutils.ncbi.nlm.nih.gov");
    if (url.pathname.endsWith("esearch.fcgi")) return Response.json({ esearchresult: { idlist: ["42092183"] } });
    return new Response(`<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>42092183</PMID><Article><Journal><Title>Nature Neuroscience</Title><JournalIssue><PubDate><Year>2026</Year><Month>May</Month></PubDate></JournalIssue></Journal><ArticleTitle>Human hippocampal ripples coordinate neural learning.</ArticleTitle><Abstract><AbstractText>Brain planning.</AbstractText></Abstract><AuthorList><Author><LastName>Behrens</LastName><ForeName>Tim</ForeName></Author></AuthorList><PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">42092183</ArticleId><ArticleId IdType="pmc">PMC12345</ArticleId><ArticleId IdType="doi">10.1000/pubmed-paper</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`, { headers: { "content-type": "application/xml" } });
  };
  const result = await discoverProviderPapers("pubmed", researcher, fetcher, now);
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].pmid, "42092183");
  assert.equal(result[0].pmcid, "PMC12345");
  assert.equal(result[0].doi, "10.1000/pubmed-paper");
});

test("PMC adapter returns an open full-text candidate with PMCID", async () => {
  const fetcher = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("esearch.fcgi")) return Response.json({ esearchresult: { idlist: ["12345"] } });
    return new Response(`<pmc-articleset><article><front><journal-meta><journal-title>Neural Systems</journal-title></journal-meta><article-meta><article-id pub-id-type="pmcid">PMC12345</article-id><article-id pub-id-type="pmid">42092183</article-id><article-id pub-id-type="doi">10.1000/pmc-paper</article-id><title-group><article-title>Neural learning mechanisms in the brain</article-title></title-group><contrib-group><contrib contrib-type="author"><name><surname>Behrens</surname><given-names>Tim</given-names></name></contrib></contrib-group><pub-date><year>2026</year><month>06</month><day>01</day></pub-date><abstract><p>Open full text abstract.</p></abstract></article-meta></front></article></pmc-articleset>`, { headers: { "content-type": "application/xml" } });
  };
  const result = await discoverProviderPapers("pmc", researcher, fetcher, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].pmcid, "PMC12345");
  assert.match(result[0].openAccessUrl ?? "", /PMC12345/);
});

test("DOAJ adapter reads v4 article metadata and OA link", async () => {
  const fetcher = async (input) => {
    const url = new URL(input.toString());
    assert.equal(url.pathname.startsWith("/api/v4/search/articles/"), true);
    return Response.json({ results: [{ id: "doaj-1", bibjson: { title: "Neural learning signals across the brain", abstract: "Open article", year: "2026", month: "July", author: [{ name: "Tim Behrens" }], identifier: [{ type: "doi", id: "10.1000/doaj-paper" }], journal: { title: "Open Neuroscience" }, link: [{ type: "fulltext", url: "https://example.test/doaj-fulltext" }] } }] });
  };
  const result = await discoverProviderPapers("doaj", researcher, fetcher, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].provider, "doaj");
  assert.equal(result[0].openAccessUrl, "https://example.test/doaj-fulltext");
});
