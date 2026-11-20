/* Pure, offline front-matter parser. All returned values retain their source excerpt. */
var ThesisMetadata = (() => {
  "use strict";

  const han = /\p{Script=Han}/u;
  const cnDegree = /[博碩硕]士(?:研究生|专业)?(?:学位|學位)?(?:论文|論文)/u;
  const cnSchool = "([\\p{Script=Han}·]{2,32}?(?:大学|大學|学院|學院|研究院))";
  const schoolHeader = new RegExp("^" + cnSchool + "\\s*(" + cnDegree.source + ")", "u");
  const months = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const monthPat = months.join("|");
  const yearPat = "(?:18|19|20)\\d{2}";
  const dayPat = "(?:0?[1-9]|[12]\\d|3[01])";
  const monthFirst = new RegExp("\\b(" + monthPat + ")\\s*,?\\s+(?:(" + dayPat +
    ")\\s*(?:st|nd|rd|th)?\\s*,?\\s*)?(" + yearPat + ")\\b", "i");
  const dayFirst = new RegExp("\\b(" + dayPat + ")\\s+(" + monthPat + ")\\s+(" + yearPat + ")\\b", "i");

  function clean(s) {
    return s.normalize("NFKC").replace(/\u00ad/g, "").replace(/[\u200b\ufeff]/g, "")
      .replace(/\s+/g, " ").trim().replace(/(?<=\p{Script=Han}) +(?=\p{Script=Han})/gu, "");
  }

  function validTitle(s) {
    return s.length >= 3 && s.length <= 500 && /\p{L}/u.test(s);
  }

  function put(record, key, value, quote) {
    if (!value || record.fields[key]) return;
    record.fields[key] = value;
    record.evidence[key] = record.location + " · " + clean(quote).slice(0, 220);
  }

  function westernName(s) {
    if (!s || s.length > 90 || /\b(?:supervisor|advisor|professor|committee|university|faculty|copyright|thesis|dissertation|department|submitted|degree|dr)\b/i.test(s)) return false;
    return /^[\p{L}\p{M}.’'-]+(?: +(?:[\p{L}\p{M}.’'-]+|\([\p{L}\p{M}.’'-]+\))){1,8}$/u.test(s);
  }

  function englishSchool(s) {
    const submittedTo = s.match(/\b(?:thesis|dissertation) (?:submitted|presented) to (.+?)(?:\s+in (?:conformity|partial|fulfil[l]?ment)\b|$)/i);
    const name = (submittedTo ? submittedTo[1] : s).replace(/^(?:(?:submitted|presented)\s+to|at|to)\s+/i, "")
      .replace(/^the\s+/i, "").replace(/[,.]$/, "");
    if (name.length > 110 || /[,;:\d()[\]]|\b(?:department|faculty|supervisor|degree|professor|member|chair|press|submitted|requirements|college of [a-z]+ at)\b/i.test(name)) return "";
    if (/^(?:B\.?\s?Sc|M\.?\s?Sc|B\.?\s?A|M\.?\s?A)\.?\s/i.test(name)) return "";
    if (/^(?:University (?:of|College) .+|.+ University(?: of .+)?|.+ Institute of Technology|University College .+)$/i.test(name)) return name;
    return "";
  }

  function englishDegree(s) {
    if (/(?:^|\bdegree of )doctor of philosophy\b|^ph\.?\s?d\.?(?:\s+(?:thesis|dissertation))?$/i.test(s)) return "PhD thesis";
    if (/\b(?:doctoral (?:thesis|dissertation|degree)|doctorate degree)\b/i.test(s)) return "Doctoral thesis";
    if (/^(?:degree of )?master of (?:science|arts|engineering|philosophy)\b|\bmaster[’']?s (?:thesis|degree)\b|^(?:a )?master thesis(?:$| (?:submitted|presented)\b)/i.test(s)) return "Master’s thesis";
    return "";
  }

  function formatDate(year, month, day) {
    if (!month) return year;
    const m = Number(month);
    const d = Number(day);
    if (m < 1 || m > 12 || (day && (d < 1 || d > new Date(Date.UTC(Number(year), m, 0)).getUTCDate()))) return "";
    return year + "-" + String(m).padStart(2, "0") + (day ? "-" + String(d).padStart(2, "0") : "");
  }

  function englishDate(s) {
    const match = s.match(monthFirst) || s.match(dayFirst);
    if (!match) return "";
    const startsWithMonth = /^[A-Z]/i.test(match[1]);
    const month = (startsWithMonth ? match[1] : match[2]).toLowerCase();
    const day = startsWithMonth ? match[2] : match[1];
    return formatDate(match[3], months.findIndex(m => m.toLowerCase() === month) + 1, day);
  }

  function getDOI(r, lines) {
    for (let i = 0; i < lines.length; i++) {
      const label = lines[i].match(/^DOI\s*:\s*(.*)$/i);
      if (!label) continue;
      const value = label[1] || lines[i + 1] || "";
      const match = value.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s<>"\]]+)$/i);
      if (match) put(r, "DOI", match[1].replace(/[.,;]$/, ""), "DOI: " + value);
    }
  }

  function parseRepository(r, lines) {
    const heading = lines.findIndex(s => /^citation for published version\b/i.test(s));
    if (heading < 1 || heading > 8) return false;
    const citation = lines.slice(heading + 1, heading + 7).join(" ");
    const match = citation.match(/^(.+?)\s*\(((?:18|19|20)\d{2})\)\.\s+(.+?)\.\s*\[(Doctoral (?:Thesis|Dissertation)|Master[’']?s Thesis),\s*([^\]]+)\]/i);
    if (!match) return false;
    const title = lines.slice(0, heading).join(" ");
    if (titleKey(title) !== titleKey(match[3]) || !validTitle(title)) return false;
    put(r, "title", title, title);
    const author = match[1].match(/^([\p{L}\p{M} .’'-]+),\s*([\p{L}\p{M} .’'-]+)$/u);
    if (author) put(r, "authors", [author[2].trim() + " " + author[1].trim()], match[1]);
    put(r, "university", match[5].trim(), match[4] + ", " + match[5]);
    put(r, "date", match[2], match[1] + " (" + match[2] + ")");
    put(r, "thesisType", englishDegree(match[4]), match[4]);
    getDOI(r, lines.slice(heading + 1, heading + 15));
    return true;
  }

  function parseEnglish(r, lines, pageNumber) {
    const by = lines.findIndex(s => /^(?:submitted |presented |written )?by(?:\s*:|\s*$|\s+[\p{Lu}])/iu.test(s));
    const submission = lines.findIndex(s => /^(?:(?:a|this) )?(?:doctoral |master(?:[’']?s)? )?(?:thesis|dissertation)\s+(?:submitted|presented)\b/i.test(s));
    const degreeLine = lines.find(s => englishDegree(s));
    if ((!degreeLine && submission < 0) || by < 0) return;
    const prefix = lines.slice(0, by);
    // Title ends before the formal submission statement if the byline follows it.
    if (submission >= 0 && submission < by) prefix.splice(submission);
    // A printed folio can be the first text object on a title page.
    const romanFolios = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"];
    if (pageNumber && prefix.length > 1 && (prefix[0] === romanFolios[pageNumber - 1] || prefix[0] === String(pageNumber))) prefix.shift();
    while (prefix.length > 1 && (englishSchool(prefix[0]) || /^(?:(?:faculty|department|school) of\b|(?:doctoral |master[’']?s )?(?:thesis|dissertation)$)/i.test(prefix[0]))) prefix.shift();
    const title = prefix.join(" ");
    if (!prefix.length || prefix.length > 10 || !validTitle(title)) return;
    r.titleLines = prefix;
    put(r, "title", title, title);
    const names = (lines[by].replace(/^(?:(?:submitted|presented|written) )?by\b\s*:?\s*/i, "") || lines[by + 1] || "").split(/\s+(?:and|&)\s+/i);
    if (names.every(westernName)) put(r, "authors", names, "by " + names.join(" and "));
    if (degreeLine) put(r, "thesisType", englishDegree(degreeLine), degreeLine);
    else put(r, "thesisType", /dissertation/i.test(lines[submission]) ? "Dissertation" : "Thesis", lines[submission]);
    for (const line of [...lines.slice(by + 1), ...lines.slice(0, by)]) {
      const school = englishSchool(line);
      if (school) put(r, "university", school, line);
    }

    const defended = lines.findIndex(s => /\b(?:to be defended|defended (?:in|on)|date of (?:defen[cs]e|submission))\b/i.test(s));
    if (defended !== -1) {
      // Isolate neighboring date lines to avoid reusing an earlier degree or download date.
      const context = lines.slice(defended, defended + 6).join(" ");
      // Only use a numeric date attached to the defense/submission label.
      const label = lines[defended];
      const numeric = (label + " " + (lines[defended + 1] || "")).match(
        /(?:\bon\b|date of (?:defen[cs]e|submission))\s*:?\s*(\d{1,2})([-/.])(\d{1,2})\2((?:18|19|20)\d{2})\b/i);
      if (numeric) {
        const first = Number(numeric[1]), second = Number(numeric[3]);
        const year = numeric[4];
        if (first && second) {
          if (first > 12) put(r, "date", formatDate(year, second, first), numeric[0]);
          else if (second > 12 || first === second) put(r, "date", formatDate(year, first, second), numeric[0]);
          else {
            put(r, "date", year, numeric[0]);
            r.ambiguousNumericDate = true;
          }
        }
      } else {
        put(r, "date", englishDate(context), context);
      }
    }
    for (const line of lines.slice(by + 1)) {
      if (new RegExp("^(?:" + monthPat + ")\\b", "i").test(line) || dayFirst.test(line)) {
        if (line.length < 60) put(r, "date", englishDate(line), line);
      }
    }
    // Never take a year from a CV-style prior qualification next to the author.
    for (const line of lines.slice(by + 1)) {
      const year = line.match(/^(?:©|copyright\b).{0,100}?\b((?:18|19|20)\d{2})\b/i) || line.match(/^((?:18|19|20)\d{2})$/);
      if (year) put(r, "date", year[1], line);
    }
    put(r, "language", "en", lines[submission >= 0 ? submission : by] + (degreeLine ? " / " + degreeLine : ""));
    getDOI(r, lines);
  }

  function parseGerman(r, lines) {
    // German degree-approval sheets place title and author directly before the approval formula.
    const approval = lines.findIndex(s => /^Vollständiger Abdruck der\b/i.test(s));
    if (approval < 3 || !/genehmigten Dissertation/i.test(lines.slice(approval, approval + 6).join(" "))) return;
    const author = lines[approval - 1];
    if (!westernName(author)) return;
    const headings = /universität|university|^dissertation$|\b(?:school|faculty|department|fakultät)\b/i;
    let start = approval - 2;
    while (start >= 0 && !headings.test(lines[start])) start--;
    const titleLines = lines.slice(start + 1, approval - 1);
    const title = titleLines.join(" ");
    if (start < 0 || titleLines.length > 7 || !validTitle(title)) return;
    put(r, "title", title, title);
    put(r, "authors", [author], author);
    put(r, "thesisType", "Doctoral thesis", "genehmigten Dissertation");
    for (const line of lines.slice(0, start + 1).reverse()) {
      const school = line.match(/\b((?:Technische )?Universität [\p{L}.’-]+(?: [\p{L}.’-]+)*?)(?=\s+(?:[A-Z]{2,}|School|Fakultät)\b|$)/iu);
      if (school) put(r, "university", school[1], line);
    }
    const approvalText = lines.slice(approval, approval + 22).join(" ");
    const accepted = approvalText.match(/\bam (\d{1,2})\.(\d{1,2})\.((?:18|19|20)\d{2}) angenommen\b/i);
    if (accepted) put(r, "date", formatDate(accepted[3], accepted[2], accepted[1]), accepted[0]);
  }

  const cnTitleLabel = /^(?:(?:学位)?论文(?:题目|题名|标题)|中文(?:题目|题名|标题)|题目)(?:\s*\(中文\)|\s*\(汉语\))?\s*[:：]?\s*/u;
  const cnAuthorLabel = /^(?:论文作者(?:姓名)?|作者(?:姓名)?|研究生(?:姓名)?|申请人(?:姓名)?|学位申请人(?:姓名)?)\s*[:：]?\s*/u;
  const cnDateLabel = /^(?:答辩日期|论文答辩(?:时间|日期)|论文提交(?:日期|时间)|学位授予日期|提交日期)\s*[:：]?\s*/u;
  const cnHeading = /^(?:学校代码|分类号|作者|研究生|中[英文]摘要|英文摘要|学号|学科|研究方向|指导|导师|摘要|英文题|外文题|论文题|专业|申请|学院|姓名|院系|目录|提交|答辩)/u;

  function parseChinese(r, lines) {
    const titleIndex = lines.findIndex(s => cnTitleLabel.test(s) && !/\((?:外文|英文|英语)\)/u.test(s));
    const authorIndex = lines.findIndex(s => cnAuthorLabel.test(s));
    let degreeIndex = lines.findIndex(s => s.length < 160 && cnDegree.test(s) && (schoolHeader.test(s) || s.match(cnDegree)[0] === s));
    if ((titleIndex < 0 && degreeIndex < 0) || authorIndex < 0) return;
    const source = [];
    if (titleIndex >= 0) {
      const sameLine = lines[titleIndex].replace(cnTitleLabel, "");
      if (sameLine) source.push(sameLine);
      for (const line of lines.slice(titleIndex + 1, titleIndex + 5)) {
        if (cnHeading.test(line) || cnAuthorLabel.test(line) || !han.test(line)) break;
        source.push(line);
      }
    } else if (degreeIndex < authorIndex && authorIndex - degreeIndex <= 5) {
      const between = lines.slice(degreeIndex + 1, authorIndex);
      if (between.length && between.every(s => han.test(s) && !cnHeading.test(s))) source.push(...between);
    }
    const title = clean(source.join(" "));
    if (!validTitle(title)) return;
    if (degreeIndex >= 0) {
      const line = lines[degreeIndex];
      const header = line.match(schoolHeader);
      const headerTitle = header && titleKey(line.slice(header[0].length));
      if (headerTitle && headerTitle !== titleKey(title)) degreeIndex = -1;
    }
    r.needsDegreeEvidence = degreeIndex < 0 && !lines.some(s => /^(?:学位授予单位|(?:[博硕]士)?学位申请人|[博硕]士研究生)/u.test(s));
    put(r, "title", title, title);
    const name = lines[authorIndex].replace(cnAuthorLabel, "") || lines[authorIndex + 1] || "";
    if (/^[\p{Script=Han}·]{2,12}$/u.test(name) && !cnHeading.test(name)) {
      put(r, "authors", [name], lines[authorIndex] + (lines[authorIndex].endsWith(name) ? "" : " " + name));
    }
    if (degreeIndex >= 0) {
      const line = lines[degreeIndex];
      put(r, "thesisType", line.match(cnDegree)[0], line);
      const header = line.match(schoolHeader);
      if (header) put(r, "university", header[1], line);
    }
    const standaloneSchool = new RegExp("^(?:(?:学位授予单位|学校名称)\\s*:\\s*)?" + cnSchool + "$", "u");
    for (const line of lines) {
      const match = line.match(standaloneSchool);
      if (match) put(r, "university", match[1], line);
    }
    const dateIndex = lines.findIndex(s => cnDateLabel.test(s));
    for (const index of [dateIndex, ...lines.map((s, i) => /^\d{4}\s*年/.test(s) ? i : -1)]) {
      if (index < 0) continue;
      const value = lines[index].replace(cnDateLabel, "") || lines[index + 1] || "";
      const m = value.match(/^((?:18|19|20)\d{2})\s*年(?:\s*(\d{1,2})\s*月)?(?:\s*(\d{1,2})\s*日)?$/);
      if (m) put(r, "date", formatDate(m[1], m[2], m[3]), index === dateIndex ? lines[index] + (lines[index].endsWith(value) ? "" : " " + value) : value);
    }
    put(r, "language", "zh-CN", lines[titleIndex >= 0 ? titleIndex : authorIndex]);
  }

  function titleKey(s) {
    return (s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  }

  function authorsAgree(first, second) {
    if (!first || !second || first.length !== second.length) return false;
    const words = s => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}]+/gu) || [];
    return first.every((name, i) => {
      const a = words(name), b = words(second[i]);
      if (a.pop() !== b.pop()) return false;
      return a.slice(0, b.length).every((word, j) => word === b[j] || ((word.length === 1 || b[j].length === 1) && word[0] === b[j][0]));
    });
  }

  function parsePages(pages, options = {}) {
    const warnings = [];
    const records = [];
    const allLines = [];
    for (const [index, raw] of pages.slice(0, 8).entries()) {
      const lines = String(raw || "").slice(0, 18000).split(/\r\n?|\n|\f/).map(clean).filter(Boolean);
      allLines.push(lines);
      if (!lines.length) continue;
      const location = (options.source === "cache" ? "索引片段 " : "第 ") + (index + 1) + (options.source === "cache" ? "" : " 页");
      const r = { fields: {}, evidence: {}, location };
      r.repository = parseRepository(r, lines);
      if (!r.repository) {
        // In an unpaginated index the running header before the abstract is still front matter.
        const boundary = lines.findIndex(s => /^(?:(?:中文|英文)?摘要|abstract|references|bibliography|contents|table of contents|supervisory committee)\s*$/i.test(s));
        const front = boundary < 0 ? lines : lines.slice(0, boundary);
        parseChinese(r, front);
        if (!r.fields.title) parseEnglish(r, front, options.source === "cache" ? null : index + 1);
        if (!r.fields.title) parseGerman(r, front);
      }
      if (r.fields.title) records.push(r);
    }

    // The PDF worker can emit logo glyphs ahead of the title. A matching repository
    // citation confirms exactly which trailing title lines belong to the publication.
    const repositories = records.filter(r => r.repository);
    for (const r of records.filter(r => r.titleLines && repositories.length)) {
      for (let i = 1; i < r.titleLines.length; i++) {
        const suffix = r.titleLines.slice(i).join(" ");
        if (repositories.some(repo => titleKey(repo.fields.title) === titleKey(suffix))) {
          r.fields.title = suffix;
          r.evidence.title = r.location + " · " + suffix;
          break;
        }
      }
    }
    const verified = records.filter(r => !r.needsDegreeEvidence || allLines.some(lines => lines.slice(0, 3).some(line => {
      const header = line.match(schoolHeader);
      return header && titleKey(line.slice(header[0].length)) === titleKey(r.fields.title);
    })));
    const selected = verified.find(r => !r.repository) || verified[0];
    const fields = { title: "", authors: [], authorMode: "western", university: "", date: "", thesisType: "", language: "", DOI: "" };
    const evidence = {};
    if (selected) {
      const sameTitle = verified.filter(r => {
        if (r === selected || titleKey(r.fields.title) !== titleKey(selected.fields.title)) return false;
        if (!authorsAgree(r.fields.authors, selected.fields.authors)) {
          warnings.push("同题的前置页作者未能相互印证，已忽略该页的补充字段。");
          return false;
        }
        if (r.fields.date && selected.fields.date && r.fields.date.slice(0, 4) !== selected.fields.date.slice(0, 4)) {
          warnings.push("同题的前置页年份不同，已忽略该页的补充字段。");
          return false;
        }
        return true;
      });
      for (const r of [selected, ...sameTitle]) {
        for (const key of Object.keys(r.fields)) {
          if (!evidence[key]) {
            fields[key] = r.fields[key];
            evidence[key] = r.evidence[key];
            if (key === "date" && r.ambiguousNumericDate) warnings.push("日期的数字日月顺序不明确，已保留年份，请核对原文。");
          }
        }
      }
      // Some Chinese title forms leave the institution and degree to running headers.
      if (fields.language === "zh-CN" && (!fields.university || !fields.thesisType)) {
        for (const [i, lines] of allLines.entries()) {
          for (const line of lines.slice(0, 3)) {
            const head = line.match(schoolHeader);
            if (!head || titleKey(line.slice(head[0].length)) !== titleKey(fields.title)) continue;
            const where = options.source === "cache" ? "索引片段 " + (i + 1) : "第 " + (i + 1) + " 页";
            for (const [k, v] of [["university", head[1]], ["thesisType", head[2]]]) {
              if (!fields[k]) { fields[k] = v; evidence[k] = where + " · " + line; }
            }
          }
        }
      }
      if (fields.authors.length && fields.authors.every(s => han.test(s))) fields.authorMode = "single";
      if (fields.language) warnings.push("语种按题名页文字推断，请核对正文。");
    }
    if (!allLines.some(lines => lines.length)) warnings.push("没有可读取的文字，请先对扫描件做 OCR，或手工填写。");
    else if (!selected) warnings.push("未找到能够确认题名的学位论文题名页，请核对原文。");
    if (selected) {
      const labels = { authors: "作者", university: "授予单位", date: "日期", thesisType: "学位类型" };
      const missing = Object.keys(labels).filter(key => !fields[key].length);
      if (missing.length) warnings.push("缺少可核实的" + missing.map(key => labels[key]).join("、") + "。");
    }
    return { fields, evidence, warnings };
  }

  return { parsePages };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ThesisMetadata;
