const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePages } = require("../addon/patent-parser.js");

const grant = [
  "(19)国家知识产权局", "(12)发明专利", "(10)授权公告号", "(45)授权公告日",
  "(21)申请号 202410000001 .1", "(22)申请日 2024 .01 .10",
  "(65)同一申请的已公布的文献号", "申请公布号 CN 100000001 A",
  "(43)申请公布日 2024.05.10", "(66)本国优先权数据", "202310000001.2 2023.02.02 CN",
  "(73)专利权人 示例研究院", "地址 100000 示例市",
  "(72)发明人 张明 王林", "(74)专利代理机构 示例事务所", "专利代理师 陈青",
  "(56)对比文件", "CN 100000002 B", "2022.03.04",
  "(54)发明名称", "一种纸张厚度", "测量装置", "(57)摘要", "本发明涉及纸张测量。",
  "权利要求书1页 说明书5页", "CN 100000001 B", "2025.01.02", "CN 100000001 B",
].join("\n");

const application = [
  "（19）国家知识产权局", "(12)发明专利申请", "(10)申请公布号 CN100000003A",
  "(43)申请公布日 2024年2月29日", "(21)申请号 202310000003.X", "(22)申请日 2023-11-01",
  "(71)申请人 示例大学", "地址 100000 示例市", "(72)发明人 陈青",
  "(54)发明名称 一种计数装置", "(57)摘要 用于计数。",
].join("\n");

test("a grant's main notice and date survive separate footer placement", () => {
  const { fields, evidence } = parsePages([grant]);
  assert.deepEqual(fields, {
    title: "一种纸张厚度测量装置", issuingAuthority: "国家知识产权局", country: "CN", language: "zh-CN",
    applicationNumber: "202410000001.1", filingDate: "2024-01-10",
    patentNumber: "CN100000001B", issueDate: "2025-01-02",
    assignee: "示例研究院", inventors: ["张明", "王林"],
  });
  for (const key of Object.keys(fields)) assert.match(evidence[key], /第 1 页/);
  assert.match(evidence.issueDate, /\(45\).*2025\.01\.02/);
  assert.match(evidence.patentNumber, /\(10\).*100000001 B/);
});

test("an application keeps publication date and applicant distinct from grant fields", () => {
  const { fields, evidence } = parsePages([application], { source: "cache" });
  assert.equal(fields.extra, "申请公布日: 2024-02-29\n申请人: 示例大学");
  assert.equal(fields.issueDate, undefined);
  assert.equal(fields.assignee, undefined);
  assert.equal(fields.patentNumber, "CN100000003A");
  assert.match(evidence.extra, /索引首段/);
  assert.match(evidence.extra, /\(43\)/);
  assert.match(evidence.extra, /\(71\)/);
});

test("utility patents use the grant number including its kind code", () => {
  const s = grant.replace("(12)发明专利", "(12)实用新型专利").replace(/100000001 B/g, "200000001 U")
    .replace("(54)发明名称", "(54)实用新型名称");
  assert.equal(parsePages([s]).fields.patentNumber, "CN200000001U");
});

test("a citation in the abstract supplies neither the grant number nor the date", () => {
  const s = grant.split("权利要求书1页")[0] + "CN 100000009 B\n2023.07.01\n以上为引证文献。";
  const { fields } = parsePages([s]);
  assert.equal(fields.patentNumber, undefined);
  assert.equal(fields.issueDate, undefined);
  assert.equal(fields.applicationNumber, "202410000001.1");
});

test("invalid calendar dates and non-disclosed names stay empty", () => {
  const s = application.replace("2024年2月29日", "2023年2月29日").replace("陈青", "请求不公布姓名");
  const { fields } = parsePages([s]);
  assert.equal(fields.extra, "申请人: 示例大学");
  assert.equal(fields.inventors, undefined);
});

test("a long inventor run without separators requires review", () => {
  const s = grant.replace("张明 王林", "张明王林刘波");
  const { fields, warnings } = parsePages([s]);
  assert.equal(fields.inventors, undefined);
  assert.ok(warnings.some(w => w.includes("姓名")));
});

test("explicit repeated assignee labels preserve each holder across addresses", () => {
  const s = grant.replace("地址 100000 示例市", "地址 100000 示例市\n专利权人 东岸大学\n地址 200000 东岸市\n(73)专利权人 海岸大学");
  const { fields, warnings } = parsePages([s]);
  assert.equal(fields.assignee, "示例研究院；东岸大学；海岸大学");
  assert.deepEqual(warnings, []);
});

test("an unlabeled line break is preserved for review instead of asserting multiple owners", () => {
  const s = grant.replace("示例研究院", "示例技术研究\n有限公司");
  const { fields, warnings } = parsePages([s]);
  assert.equal(fields.assignee, "示例技术研究 有限公司");
  assert.ok(warnings.some(w => w.includes("专利权人")));
});

test("a later cited patent, missing cover, filename or scan alone gives no match", () => {
  for (const pages of [[], [""], ["论文引用 CN100000001B", grant], ["论文正文\f" + grant],
    [grant.replace("(19)国家知识产权局", "")],
    [grant.replace("(12)发明专利", "(12)发明专利申请")]]) {
    assert.equal(parsePages(pages, { filename: "CN100000001B.pdf" }), null);
  }
});
