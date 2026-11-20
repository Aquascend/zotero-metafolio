"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePages } = require("../addon/parser.js");

const titlePage = [
  "Mapping urban", "Gardens", "by", "Rowan L. West",
  "B.Sc., Other University, 2011",
  "A Dissertation Submitted in Partial Fulfillment of the",
  "Requirements for the Degree of", "Doctor of Philosophy",
  "© Rowan L. West, 2020", "Oak University",
].join("\n");

const repository = [
  "Mapping urban Gardens", "Citation for published version (APA):",
  "West, R. L. (2020). Mapping urban gardens. [Doctoral Thesis, Oak University].",
  "Example Press", "DOI:", "10.1234/example.42",
  "Document status and date:", "Published: 01/01/2020",
].join("\n");

test("英文 Master thesis 提交声明之前的多行题名排除本页页码、院系和地址", () => {
  const cover = [
    "iii", "Mapping urban", "gardens", "Master thesis submitted to Oak University in partial fulfilment",
    "of the requirements for the degree of", "Master of Science", "Faculty of Design", "17 Lake Road",
    "by", "R.A. van West", "To be defended in public on 08-01-2021", "Chair: Prof. A. North",
  ].join("\n");
  const { fields, evidence, warnings } = parsePages(["", "", cover]);
  assert.equal(fields.title, "Mapping urban gardens");
  assert.deepEqual(fields.authors, ["R.A. van West"]);
  assert.equal(fields.university, "Oak University");
  assert.equal(fields.thesisType, "Master’s thesis");
  assert.equal(fields.date, "2021");
  assert.match(evidence.date, /第 3 页.*08-01-2021/);
  assert.ok(warnings.some(s => s.includes("日月顺序")));
  for (const [raw, expected] of [["28-01-2021", "2021-01-28"], ["01/28/2021", "2021-01-28"],
    ["04.04.2021", "2021-04-04"], ["31-02-2021", ""], ["28-00-2021", ""]]) {
    const result = parsePages(["", "", cover.replace("08-01-2021", raw)]);
    assert.equal(result.fields.date, expected);
  }
});

test("正式题名页保留多行题名和署名，不取此前学历、导师或参考文献 DOI", () => {
  const { fields, evidence } = parsePages([titlePage,
    "Supervisory Committee\nProfessor Adrian Gray\nReferences\nDOI: 10.1234/wrong"]);
  assert.equal(fields.title, "Mapping urban Gardens");
  assert.deepEqual(fields.authors, ["Rowan L. West"]);
  assert.equal(fields.authorMode, "western");
  assert.equal(fields.date, "2020");
  assert.equal(fields.university, "Oak University");
  assert.equal(fields.thesisType, "PhD thesis");
  assert.equal(fields.DOI, "");
  assert.match(evidence.date, /第 1 页.*©/);
});

test("核对仓储作者缩写和题名，去掉封面标识，采用正式页全名与答辩日", () => {
  const page = [
    "UNIVERSITY PRESS", "P", "R", "Mapping urban", "Gardens", "by", "Rowan Lee West",
    "to obtain a doctoral degree", "at Oak University,", "to be defended in public on",
    "Tuesday", "nd", "June 2 , 2020 at 12:00 hours",
  ].join("\n");
  const { fields, evidence } = parsePages([repository, "", "Cover design by Alex White", page]);
  assert.equal(fields.title, "Mapping urban Gardens");
  assert.deepEqual(fields.authors, ["Rowan Lee West"]);
  assert.equal(fields.date, "2020-06-02");
  assert.equal(fields.DOI, "10.1234/example.42");
  assert.match(evidence.authors, /第 4 页/);
  assert.match(evidence.DOI, /第 1 页/);
});

test("题名相同、作者或年份不能相互印证时，拒绝补录 DOI", () => {
  for (const [source, reason] of [[repository.replace("West, R.", "West, A."), "作者"],
    [repository.replace("(2020)", "(2019)"), "年份"]]) {
    const result = parsePages([source, titlePage]);
    assert.equal(result.fields.DOI, "");
    assert.equal(result.fields.date, "2020");
    assert.ok(result.warnings.some(s => s.includes(reason)));
  }
});

test("中文表格中的多语题名、工作时段、答辩日期及不同页面的同题页眉", () => {
  const page = [
    "学校代码：12345", "论文题目（中文）", "城市花园的生态", "系统研究",
    "论文题目（外文）", "Urban garden ecology", "作 者 姓 名 许云", "指 导 教 师 王青 教授",
    "论文工作时段 2019 年 9 月至 2023 年 5 月", "答 辩 日 期 2023 年 6 月",
  ].join("\n");
  const header = "春城大学博士学位论文 城市花园的生态系统研究\n中文摘要";
  for (const [pages, sourceLabel] of [[[page, header], "第 2 页"], [[page + "\n" + header], "索引片段 1"]]) {
    const result = parsePages(pages, { source: pages.length === 1 ? "cache" : "pdf" });
    assert.equal(result.fields.title, "城市花园的生态系统研究");
    assert.deepEqual(result.fields.authors, ["许云"]);
    assert.equal(result.fields.authorMode, "single");
    assert.equal(result.fields.university, "春城大学");
    assert.equal(result.fields.thesisType, "博士学位论文");
    assert.equal(result.fields.date, "2023-06");
    assert.ok(result.evidence.university.startsWith(sourceLabel));
    assert.ok(result.warnings.some(s => s.includes("语种")));
  }
  assert.equal(parsePages([page, header.replace("城市花园", "夏季气候")]).fields.title, "");
});

test("普通中文表格、英文期刊、参考文献和无文本的扫描件都不据文件名编造条目", () => {
  for (const page of ["题目：城市绿地项目\n作者：许云\n项目说明",
    "References\nMapping urban gardens\nby Rowan West\nDoctor of Philosophy",
    "Urban gardens\nby Rowan West\nJournal of City Ecology\nDOI: 10.1234/article", ""]) {
    const result = parsePages([page], { filename: "West_PhD_2018.pdf" });
    assert.equal(result.fields.title, "");
    assert.deepEqual(result.fields.authors, []);
    assert.equal(result.fields.DOI, "");
    assert.ok(result.warnings.length > 0);
  }
});

test("学位声明可直接包含授予单位，署名可包含括号内的名字", () => {
  const result = parsePages([[
    "Patterns in Garden Design", "by", "Avery (Robin) South",
    "A dissertation submitted to The Stone University in conformity with the",
    "requirements for the degree of Doctor of Philosophy.", "October, 2017",
  ].join("\n")]);
  assert.deepEqual(result.fields.authors, ["Avery (Robin) South"]);
  assert.equal(result.fields.university, "Stone University");
  assert.equal(result.fields.date, "2017-10");
  assert.equal(result.fields.thesisType, "PhD thesis");
});

test("德国学位审批页保留学位原文，批准日和提交日都不自动用作书目日期", () => {
  const page = [
    "Technische Universität Beispielstadt", "A survey of urban gardens", "Mira Sommer",
    "Vollständiger Abdruck der von der Fakultät zur Erlangung des akademischen Grades einer",
    "Doktorin der Naturwissenschaften genehmigten Dissertation.", "Vorsitz: Prof. Dr. Muster",
    "Die Dissertation wurde am 18.10.2023 eingereicht und am 22.04.2024 angenommen.",
  ].join("\n");
  const result = parsePages([page]);
  assert.equal(result.fields.title, "A survey of urban gardens");
  assert.deepEqual(result.fields.authors, ["Mira Sommer"]);
  assert.equal(result.fields.university, "Technische Universität Beispielstadt");
  assert.equal(result.fields.date, "");
  assert.ok(result.warnings.some(s => s.includes("第 1 页") && s.includes("22.04.2024 angenommen")));
  assert.equal(result.fields.thesisType, "Doctoral thesis");
  assert.equal(result.fields.language, "");
  for (const form of ["Doktors", "Doktorin"]) {
    const qualified = page.replace("Doktorin der Naturwissenschaften", form + " der Naturwissenschaften\n(Dr. rer. nat.)");
    const cached = parsePages([qualified], { source: "cache" });
    assert.equal(cached.fields.thesisType, "Doctoral thesis (Dr. rer. nat.)");
    assert.ok(cached.evidence.thesisType.includes(form + " der Naturwissenschaften (Dr. rer. nat.)"));
    assert.ok(cached.warnings.some(s => s.includes("索引片段 1") && s.includes("22.04.2024")));
  }
  const supervisor = page.replace("Prof. Dr. Muster", "Dr. rer. nat. Mira Muster");
  assert.equal(parsePages([supervisor]).fields.thesisType, "Doctoral thesis");
  const engineering = page.replace("Doktorin der Naturwissenschaften", "Doktors der Ingenieurwissenschaften (Dr.-Ing.)")
    .replace("22.04.2024", "22. 04. 2024");
  const engineer = parsePages([engineering]);
  assert.equal(engineer.fields.thesisType, "Doctoral thesis (Dr.-Ing.)");
  assert.equal(engineer.fields.date, "");
  assert.ok(engineer.warnings.some(s => s.includes("22. 04. 2024 angenommen")));
});

test("无年份或学校时留空，导师身份不作为作者", () => {
  const page = ["Urban gardens", "by", "Dr. Adrian Gray, Supervisor", "A Dissertation Submitted",
    "Doctor of Philosophy", "MSc, Other University, 2019"].join("\n");
  const result = parsePages([page]);
  assert.deepEqual(result.fields.authors, []);
  assert.equal(result.fields.date, "");
  assert.equal(result.fields.university, "");
});

test("ISBN comes from the thesis title page or the author's adjacent copyright page", () => {
  const imprint = "© Copyright R West, Oak 2020\nProduction: Example Press\nISBN 978 0 306 40615 7";
  const { fields, evidence } = parsePages([imprint, titlePage]);
  assert.equal(fields.ISBN, "9780306406157");
  assert.match(evidence.ISBN, /第 1 页.*ISBN 978 0 306 40615 7/);
  const legacy = parsePages([titlePage + "\nISBN-10:\n0-8044-2957-X"], { source: "cache" });
  assert.equal(legacy.fields.ISBN, "080442957X");
  assert.match(legacy.evidence.ISBN, /索引片段 1.*ISBN-10/);
  for (const pages of [
    [imprint.replace("R West", "E West"), titlePage],
    [imprint.replace("2020", "2010"), titlePage],
    [imprint, "", titlePage],
    [titlePage, "References\nISBN 9780306406157"],
    [titlePage + "\nBibliography\nISBN 9780306406157"],
    [titlePage + "\nISBN-10: 9780306406157"],
    [titlePage + "\nISBN 9780306406158"],
    [titlePage + "\nISBN 9790060115615"], // ISMN prefix for sheet music
    [titlePage + "\nISBN 080442957X", imprint],
    [imprint],
  ]) assert.equal(parsePages(pages).fields.ISBN, "");
});
