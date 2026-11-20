"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePages } = require("../addon/article-parser.js");

const title = "River temperatures over four seasons";
const wrapper = [
  "River Science", "PAPER", title,
  "To cite this article: A Bell et al 2007 River Sci. 8 101",
  "View the article online for updates and enhancements.", "IOP Publishing",
].join("\n");

test("older IOP affiliations terminate a byline independently of the author citation", () => {
  for (const header of ["IOP PUBLISHING River Sci. 8 (2007) 101–105", "101\nRiver Science"]) {
    const page = [header, title, "A Bell† and B Shore‡", "† Department of Science", "‡ Faculty of Engineering"].join("\n");
    const { fields, evidence } = parsePages([wrapper, page]);
    assert.deepEqual(fields.authors, ["A Bell", "B Shore"]);
    assert.ok(evidence.authors.includes("第 2 页") && evidence.authors.includes("A Bell†"));
    for (const bad of [
      page.replace(title, "A different river study"),
      page.replace("A Bell†", "A Be†"),
      page.replace("A Bell† and B Shore‡", "A Bell et al."),
    ]) assert.equal(parsePages([wrapper, bad]).fields.authors, undefined);
  }
});

test("a wrapper naming both authors must agree with their full printed list", () => {
  const both = wrapper.replace("A Bell et al", "A Bell and B Shore");
  const page = ["River Sci. 8 (2007) 101–105", title, "A Bell and B Shore", "Centre for River Studies"].join("\n");
  assert.deepEqual(parsePages([both, page]).fields.authors, ["A Bell", "B Shore"]);
  assert.equal(parsePages([both, page.replace("B Shore", "C Glen")]).fields.authors, undefined);
});
