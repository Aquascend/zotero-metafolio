"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePages } = require("../addon/article-parser.js");

const cover = [
  "Journal of Lake Science", "PAPER • OPEN ACCESS", "Garden lakes in winter",
  "To cite this article: Mira West et al 2024 J. Lake Sci. 7 015005",
  "View the article online for updates and enhancements.", "You may also like",
  "The unrelatedness of other lakes", "https://doi.org/10.1088/recommendation",
  "This content was downloaded from IP address 192.0.2.0",
].join("\n");
const article = [
  "J. Lake Sci. 7 (2024) 015005", "https://doi.org/10.1088/lakes.5", "PAPER",
  "Garden lakes in winter", "Mira West1,2, Rowan South1 and Maya East1",
  "1 Department of Lakes", "Abstract", "References", "DOI: 10.1088/refs",
].join("\n");

test("IOP citation wrapper and matching article header are separate sources", () => {
  for (const [pages, source] of [[[cover, article], "pdf"], [[cover + "\n" + article], "cache"]]) {
    const { fields, evidence } = parsePages(pages, { source });
    assert.equal(fields.title, "Garden lakes in winter");
    assert.equal(fields.publicationTitle, "Journal of Lake Science");
    assert.equal(fields.date, "2024");
    assert.equal(fields.pages, "015005");
    assert.equal(fields.DOI, "10.1088/lakes.5");
    assert.deepEqual(fields.authors, ["Mira West", "Rowan South", "Maya East"]);
    assert.ok(evidence.DOI.startsWith(source === "pdf" ? "第 2 页" : "索引片段 1"));
  }
  const wrapper = parsePages([cover]).fields;
  assert.equal(wrapper.DOI, undefined);
  assert.equal(wrapper.authors, undefined);
  const conflict = parsePages([cover, article.replace("015005", "015002")]).fields;
  assert.equal(conflict.DOI, undefined);
  assert.equal(conflict.authors, undefined);
});

test("a ScienceDirect masthead identifies the journal, year, pages and byline", () => {
  const page = ["Journal of Lake Science 34 (2024) 112–119", "Available online 6 April 2023",
    "New methods to quantify", "the age of lake ice", "Mira L. West a,*, Rowan de Vries b,",
    "Maya East a", "a Department of Lakes", "Abstract", "Contents lists available at ScienceDirect",
    "Journal of Lake Science", "journal homepage: www.example.org/lakes",
    "https://doi.org/10.1016/lakes.42", "References", "https://doi.org/10.1016/other",
  ].join("\n");
  const { fields } = parsePages([page]);
  assert.equal(fields.title, "New methods to quantify the age of lake ice");
  assert.deepEqual(fields.authors, ["Mira L. West", "Rowan de Vries", "Maya East"]);
  assert.equal(fields.volume, "34");
  assert.equal(fields.date, "2024");
  assert.equal(fields.pages, "112–119");
  assert.equal(fields.DOI, "10.1016/lakes.42");
  assert.ok(!parsePages([page.replace("112–119", "112e119")])?.fields.pages);
  assert.equal(parsePages([page.replace("34 (2024)", "  (2024)")]), null);
});

test("Wiley issue footer supplies publication year independently of received date", () => {
  const page = ["Received: 20 December 2023", "DOI: 10.1002/mp.1234", "RESEARCH ARTICLE",
    "Measuring the density of", "a solid phantom", "Mira West1,2 Rowan South2",
    "1 Department of Physics", "Med Phys. 2024;52:123–128. wileyonlinelibrary.com/journal/mp"].join("\n");
  const { fields } = parsePages([page]);
  assert.equal(fields.publicationTitle, "Medical Physics");
  assert.equal(fields.title, "Measuring the density of a solid phantom");
  assert.equal(fields.date, "2024");
  assert.equal(fields.pages, "123–128");
  assert.deepEqual(fields.authors, ["Mira West", "Rowan South"]);
  assert.equal(parsePages([page.replace("Med Phys.", "J. Other.")]), null);
});

test("Chinese volume and issue masthead can recover an explicitly labeled DOI from a spaced text layer", () => {
  const page = ["第 1 2 卷 第 2 期", "2 0 2 4 年 3 月", "城 市 科 学",
    "Urban Science", "Vol. 12 No. 2", "城市绿地微气候测量研究", "李明，周南",
    "（春城大学，春城）", "摘 要：园林地表温度观测。", "DOI ： 10 . 1234 ／ sample . 42"].join("\n");
  const { fields } = parsePages([page]);
  assert.equal(fields.title, "城市绿地微气候测量研究");
  assert.equal(fields.publicationTitle, "城市科学");
  assert.equal(fields.volume, "12");
  assert.equal(fields.date, "2024-03");
  assert.equal(fields.issue, "2");
  assert.equal(fields.DOI, "10.1234/sample.42");
  assert.deepEqual(fields.authors, ["李明", "周南"]);
  const ocr = parsePages([page.replace("李明，周南", "李 明 ， 周 南\uE000")]);
  assert.equal(ocr.fields.authors, undefined);
  assert.ok(ocr.warnings.some(s => /字形/.test(s)));
});

test("a ScienceDirect printout can carry the issue and full byline", () => {
  const page = ["Previous Next", "Journal of Lake Science", "Volume 15, Issue 2, 8 May 2024, Pages 31-40",
    "RESEARCH ARTICLE", "A survey of deep lakes", "Mira West PhD , Maya East MD, PhD",
    "Show more", "Outline", "https://doi.org/10.1016/lakes.10", "Get rights and content"].join("\n");
  const { fields } = parsePages([page]);
  assert.equal(fields.title, "A survey of deep lakes");
  assert.deepEqual(fields.authors, ["Mira West", "Maya East"]);
  assert.equal(fields.issue, "2");
  assert.equal(fields.pages, "31-40");
});

test("Zeitschrift requires its section, issue imprint and DOI to agree", () => {
  const page = ["ÜBERSICHTSARBEIT", "Sampling a layered phantom",
    "Rowan North ∗, Mira East Department of Imaging, Example University", "Received 20 May 2020; accepted 7 June 2020",
    "Abstract", "Ein geschichtetes Phantom", "Z. Med. Phys. 32 (2022) 15–25 https://doi.org/10.1016/j.zemedi.2020.01.001"].join("\n");
  const { fields } = parsePages([page], { source: "cache" });
  assert.equal(fields.title, "Sampling a layered phantom");
  assert.equal(fields.publicationTitle, "Zeitschrift für Medizinische Physik");
  assert.equal(fields.date, "2022");
  assert.equal(fields.pages, "15–25");
  assert.deepEqual(fields.authors, ["Rowan North", "Mira East"]);
  for (const altered of [page.replace("j.zemedi.", "j.other."), page.replace("Z. Med. Phys.", "J. Other Sci."),
    page.replace("Ein geschichtetes Phantom", "References")]) assert.equal(parsePages([altered]), null);
});

test("APS uses the article-number masthead and labeled DOI", () => {
  const page = ["PHYSICAL REVIEW APPLIED 15, 041234 (2024)", "Two ways to count the",
    "rings of Saturn", "Mira West1 and Rowan South2", "1 Department of Physics",
    "DOI: 10.1103/example.123"].join("\n");
  const { fields } = parsePages([page]);
  assert.equal(fields.title, "Two ways to count the rings of Saturn");
  assert.equal(fields.pages, "041234");
  assert.equal(fields.DOI, "10.1103/example.123");
  assert.equal(parsePages([page.replace("10.1103/", "10.1234/")]), null);
});

test("a recognizable citation in a supplement, thesis, preprint or reference list is insufficient", () => {
  for (const heading of ["Supplemental Document", "Doctoral Thesis", "Preprint", "References",
    "Supporting information", "Journal Pre-proof"]) {
    assert.equal(parsePages([heading + "\n" + cover, article]), null);
  }
  assert.equal(parsePages(["Journal of Example\nSomeone else's DOI: 10.1234/fake"]), null);
  assert.equal(parsePages(["", cover]), null);
});
