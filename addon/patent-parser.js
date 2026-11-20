/* Chinese patent front pages use numbered bibliographic fields (INID codes).
 * Work only from the first page, including when the full-text index is used. */
var PatentMetadata = (() => {
  "use strict";

  function normalize(line) {
    return line.normalize("NFKC").replace(/[\u00ad\u200b\ufeff]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  function dateISO(text) {
    const match = text.match(/^((?:19|20)\d{2})\s*[.年/-]\s*(\d{1,2})\s*[.月/-]\s*(\d{1,2})\s*日?$/);
    if (!match) return "";
    const [, year, month, day] = match;
    if (+month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()) return "";
    return [year, month.padStart(2, "0"), day.padStart(2, "0")].join("-");
  }

  function publicationNumber(text, granted) {
    const number = text.replace(/\s/g, "").toUpperCase();
    const pattern = granted ? /^CN\d{7,9}[BCUYS]\d?$/ : /^CN\d{7,9}A\d?$/;
    return pattern.test(number) ? number : "";
  }

  function readOrganizations(blocks, code, label) {
    const entries = [];
    const newLabel = new RegExp("[;、\\s]+(?=" + label + ")");
    for (const block of blocks.filter(b => b.code === code)) {
      let current;
      for (const line of block.lines.flatMap(s => s.split(newLabel))) {
        let value = line;
        if (value.startsWith(label)) {
          current = [];
          entries.push(current);
          value = value.slice(label.length).replace(/^\s*:?\s*/, "");
        }
        if (!current) continue;
        const address = value.search(/(?:^|\s+)(?:地\s*址|邮\s*编|邮政编码)\s*:?/);
        const name = (address === -1 ? value : value.slice(0, address)).trim();
        if (name) current.push(name);
        if (address !== -1) current = null;
      }
    }
    const names = [...new Set(entries.map(parts => parts.join(" ")).filter(Boolean))];
    const ambiguous = entries.some(parts => parts.length > 1 || parts.some(s => /\p{Script=Han}\s+\p{Script=Han}/u.test(s)));
    return { value: names.join("；"), quote: names.map(s => "(" + code + ")" + label + " " + s).join(" · "), ambiguous };
  }

  function parsePages(pages, options = {}) {
    const page = (pages?.[0] || "").split("\f")[0];
    // Some text layers put two labelled fields on the same physical line.
    const lines = page.normalize("NFKC").replace(/[ \t]+(?=\(\d{2}\)\s*\p{Script=Han})/gu, "\n")
      .split(/\r?\n/).map(normalize).filter(Boolean);
    const blocks = [];
    for (const line of lines) {
      const match = line.match(/^\((\d{2})\)\s*(.*)$/);
      if (match) blocks.push({ code: match[1], lines: [match[2]], heading: line });
      else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
    }
    function read(code, label) {
      const block = blocks.find(b => b.code === code && label.test(b.lines[0]));
      if (!block) return null;
      const values = [block.lines[0].replace(label, "").replace(/^\s*:\s*/, "").trim(), ...block.lines.slice(1)].filter(Boolean);
      return { heading: block.heading, values };
    }
    const office = read("19", /^(?:中华人民共和国)?(?:国家知识产权局|专利局)/);
    const kind = read("12", /^(?:发明专利申请|发明专利|实用新型专利|外观设计专利)/);
    const numberField = read("10", /^(?:授权公告号|申请公布号|申请公开号)/);
    const name = read("54", /^(?:发明名称|实用新型名称|使用外观设计的产品名称|外观设计名称|产品名称)/);
    if (!office || !kind || !numberField || !name) return null;

    const granted = numberField.heading.includes("授权公告号");
    const isApplication = kind.heading.includes("专利申请");
    if (isApplication !== numberField.heading.includes("申请")) return null;
    const title = name.values.join(" ").replace(/(?<=\p{Script=Han}) +(?=\p{Script=Han})/gu, "").trim();
    if (!title || title.length > 250 || !/\p{Script=Han}/u.test(title)) return null;
    const fields = {}, evidence = {}, warnings = [];
    const where = options.source === "cache" ? "索引首段" : "第 1 页";
    function put(key, value, quote) {
      if (!value || (Array.isArray(value) && !value.length)) return;
      fields[key] = value;
      evidence[key] = where + " · " + quote;
    }
    put("title", title, name.heading + " " + name.values.join(" "));
    const authority = office.heading.replace(/^\(19\)\s*/, "");
    put("issuingAuthority", authority, office.heading);
    put("country", "CN", office.heading);
    put("language", "zh-CN", name.heading + " " + title);

    const application = read("21", /^专利申请号|^申请号/);
    const applicationText = application?.values[0] || "";
    const applicationID = applicationText.replace(/\s/g, "").toUpperCase();
    if (/^(?:CN)?(?:\d{12}|\d{8})\.[0-9X]$/.test(applicationID)) {
      put("applicationNumber", applicationID, application.heading + " · " + applicationText);
    }
    const filing = read("22", /^申请日/);
    if (filing) put("filingDate", dateISO(filing.values[0] || ""), filing.heading + " " + (filing.values[0] || ""));

    // The PDF worker sometimes returns the main number/date after the abstract,
    // separate from their labels. INID (65) and (56) may also cite other patents.
    // Only use a detached pair after the abstract when the stage and number agree.
    const dateField = granted ? read("45", /^授权公告日/) : read("43", /^(?:申请公布日|申请公开日)/);
    let number = publicationNumber(numberField.values[0] || "", granted);
    let published = dateISO(dateField?.values[0] || "");
    let numberQuote = numberField.heading + " " + (numberField.values[0] || "");
    let dateQuote = dateField ? dateField.heading + " " + (dateField.values[0] || "") : "";
    const abstract = blocks.find(b => b.code === "57" && /^摘要/.test(b.lines[0]));
    const detached = new Map();
    for (let i = 1; abstract && i < abstract.lines.length - 1; i++) {
      const id = publicationNumber(abstract.lines[i], granted);
      const date = dateISO(abstract.lines[i + 1]);
      const matchesHeader = number && id === number;
      const repeatedNumber = id && id === publicationNumber(abstract.lines[i + 2] || "", granted);
      const afterPageCounts = /^权利要求书\s*\d+\s*页/.test(abstract.lines[i - 1]);
      if (id && date && (matchesHeader || repeatedNumber || afterPageCounts)) {
        detached.set(id + "/" + date, { id, date, quote: abstract.lines[i] + " " + abstract.lines[i + 1] });
      }
    }
    if (detached.size === 1) {
      const [pair] = detached.values();
      if ((!number || pair.id === number) && (!published || pair.date === published)) {
        if (!number) { number = pair.id; numberQuote = numberField.heading + " · " + pair.quote; }
        if (!published && dateField) { published = pair.date; dateQuote = dateField.heading + " · " + pair.quote; }
      }
    }
    if (!number && !fields.applicationNumber) return null;
    put("patentNumber", number, numberQuote);
    if (granted) put("issueDate", published, dateQuote);

    const ownerLabel = granted ? "专利权人" : "申请人";
    const owners = readOrganizations(blocks, granted ? "73" : "71", ownerLabel);
    if (owners.ambiguous) warnings.push(ownerLabel + "栏内有未标明含义的空格或换行，已保留间隔，请核对名称与数量。");
    if (granted) put("assignee", owners.value, owners.quote);
    else {
      const extra = [], quotes = [];
      if (published) { extra.push("申请公布日: " + published); quotes.push(dateQuote); }
      if (owners.value) { extra.push("申请人: " + owners.value); quotes.push(owners.quote); }
      put("extra", extra.join("\n"), quotes.join(" · "));
    }
    const people = read("72", /^(?:发明人|设计人)/);
    if (people) {
      const names = people.values.join(" ").split(/[\s、,;]+/).filter(Boolean);
      const namePattern = /^(?:\p{Script=Han}{2,4}|\p{Script=Han}{1,12}(?:·\p{Script=Han}{1,12})+)$/u;
      if (names.length && names.every(s => namePattern.test(s) && !/(?:不公告|不公布|不公开|请求|代理人)/.test(s))) {
        put("inventors", names, people.heading + " · " + people.values.join(" "));
      }
    }
    if (!number) warnings.push("未核实本件公告或公布号，请核对扉页。");
    if (!fields.inventors) warnings.push("未能可靠区分发明人或设计人姓名，请核对扉页。");
    return { fields, evidence, warnings };
  }

  return { parsePages };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PatentMetadata;
