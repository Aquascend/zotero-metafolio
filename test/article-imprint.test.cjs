"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const imprint = require("../addon/article-imprint.js");
const { parsePages } = require("../addon/article-parser.js");

const info = { Title: "Counting tree rings in old oaks", Subject: "Journal of Forest Ecology, 21 (2022) 13-19. doi:10.1234/oak.8", Author: "Incomplete Byline" };
const article = "Journal of Forest Ecology\nCounting tree rings\nin old oaks\nMira West and Lee North\nAbstract\nFindings\nhttps://doi.org/10.1234/oak.8";

test("verifies an embedded publisher citation against the printed heading and DOI", () => {
  const result = imprint.parse([article], info);
  assert.deepEqual(result.fields, { title: info.Title, authors: [], publicationTitle: "Journal of Forest Ecology", volume: "21", date: "2022", pages: "13-19", DOI: "10.1234/oak.8" });
  assert.match(result.evidence.title, /第 1 页/);
  assert.match(result.evidence.date, /Subject/);
  assert.equal(imprint.parse(["Supplementary material\n" + article], info), null);
  assert.equal(imprint.parse([article.replace("old oaks", "new oaks")], info), null);
  assert.equal(imprint.parse([article.replace("https:", "References\nhttps:")], info), null);
  assert.equal(imprint.parse([article], { ...info, Subject: "Collection of Forest Specimens, doi:10.1234/oak.8" }), null);
  assert.equal(imprint.parse([article], { ...info, Subject: "Conference Proceedings, 21 (2022) 13-19. doi:10.1234/oak.8" }), null);
});

test("omits conflicting page and document identifiers", () => {
  const first = imprint.parse([article], info);
  const second = { ...first, fields: { ...first.fields, DOI: "10.1234/conflict" } };
  const result = imprint.combine(first, second);
  assert.ok(!result.fields.DOI);
  assert.ok(!result.evidence.DOI);
  assert.ok(result.warnings.some(w => w.includes("不同")));
});

test("legacy journal footers distinguish issue dates and attached article identifiers", () => {
  const footer = "4102 Med. Phys. 38 (6), June 2011";
  const watermark = "24734209, 2011, 6Part1, Downloaded from https://aapm.onlinelibrary.wiley.com/doi/10.1118/1.12345 by Example Institution";
  const title = "Estimating tree biomass from X-ray images";
  const lines = [title, "Mira Westa)", "Department of Physics", "Received 2010", footer, watermark];
  const result = parsePages([lines.join("\n")], { source: "cache" });
  assert.equal(result.fields.title, title);
  assert.equal(result.fields.issue, "6Part1");
  assert.equal(result.fields.date, "2011");
  assert.equal(result.fields.DOI, "10.1118/1.12345");
  assert.ok(!result.fields.pages);
  assert.ok(!result.evidence.DOI.includes("Example Institution"));
  const cited = parsePages([[...lines.slice(0,-1), "References", "DOI: 10.1234/not-this-study"].join("\n")]);
  assert.ok(!cited?.fields.DOI);
  assert.equal(parsePages([lines.join("\n").replace(title, "Measuring a damagedâ registration symbol")]), null);
});
