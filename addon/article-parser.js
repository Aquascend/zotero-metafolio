/* Offline fallback for recognizable publisher title pages. Never use filenames or the parent record. */
var ArticleMetadata = (() => {
  "use strict";

  function linesOf(page) {
    return String(page || "").slice(0, 24000).normalize("NFKC").replace(/\u00ad/g, "")
      .split(/\r?\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  function compact(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  }

  const doiLine = /^(?:doi\s*:\s*(?:https?:\/\/(?:dx\.)?doi\.org\/)?|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[a-z0-9._;()/:+-]+)(?=$|\s)/i;
  const articleType = /^(?:(?:original|research|review|technical) (?:article|report|note|paper)|review|full length article)$/i;
  const excluded = /^(?:supplement(?:al|ary)(?:\s+(?:material|document|information|data))?|supporting information|references|bibliography|preprint|arxiv\b|medrxiv\b|biorxiv\b|accepted manuscript|journal pre-proof|dissertation\b|doctoral thesis\b)/i;

  function validTitle(s) {
    return s.length >= 8 && s.length <= 420 && /[\p{L}]{2}/u.test(s) &&
      !/https?:|doi\s*:|copyright|licen[cs]e|you may also like|recommended articles|to cite this article|abstract\b|corresponding author|submitted (?:to|in)|\bet al\.?\b/i.test(s);
  }

  function standaloneDOI(lines, prefix) {
    const identifiers = new Map();
    for (const line of lines) {
      if (/^(?:references|bibliography|works cited)\b/i.test(line)) break;
      const found = doiLine.exec(line);
      if (found && found[1].toLowerCase().startsWith(prefix)) {
        const doi = found[1].replace(/[.;,]$/, "");
        identifiers.set(doi.toLowerCase(), [doi, line]);
      }
    }
    return identifiers.size === 1 ? [...identifiers.values()][0] : null;
  }

  // Publisher affiliation superscripts delimit authors even when the PDF omits commas.
  // Keep a byline only when every name and the end of the byline are accounted for.
  const marker = /(?:\s*,?\s*\d+(?:\s*,\s*[\d*∗]+)*|\s+[a-z](?:\s*,\s*(?:[a-z]|\d+|[*∗⇑]+))*)(?:[*∗⇑]+)?(?=\s|,|$)/gu;
  function bylineNames(value) {
    const parts = value.replace(/[\uE000-\uF8FF]/g, "").replace(marker, "|")
      .split(/\||,\s*|\s+(?:and|&)\s+/u)
      .map(s => s.trim().replace(/^(?:and|&)\s+/i, "")).filter(Boolean);
    const person = /^(?:\p{Lu}[\p{L}\p{M}.'’‐‑–-]*\s+)(?:(?:\p{Lu}[\p{L}\p{M}.'’‐‑–-]*|de|la|der|den|del|da|di|von|van|dos)\s+){0,5}\p{Lu}[\p{L}\p{M}.'’‐‑–-]*$/u;
    if (parts.length && parts.every(s => person.test(s) && !/\b(?:University|Department|Institute|Laboratory|Physics|Committee|Hospital|Research)\b/i.test(s))) return parts;
    return null;
  }

  function englishHeading(lines, start) {
    if (start < 0) return null;
    const author = lines.findIndex((s, i) => {
      if (i <= start || i > start + 8) return false;
      // Broken accents can obscure a name, but repeated affiliation markers
      // still identify the boundary between the title and the byline.
      if (/^\p{Lu}[^,]{2,65}\s+[a-z],(?:[*a-z0-9⇑∗]+,\s*)*\s*\p{Lu}[^,]{2,65}\s+[a-z][,\s]/u.test(s)) return true;
      const first = s.match(/^(.{3,65}?)(?:\s*,?\s*\d+|\s+[a-z](?=[,\s*∗⇑]|$))(?=[,\s*∗⇑\uE000-\uF8FF]|$)/u);
      if (first && bylineNames(first[1])) return true;
      return /^(?:(?:\d+\s*)?(?:School|Department|Faculty|Institute|University|Laboratory)|Medical Physics Laboratory)\b/i.test(lines[i + 1] || "") &&
        bylineNames(s.replace(/[*⁎∗]+$/u, ""));
    });
    if (author < 0) return null;
    const title = lines.slice(start, author).join(" ");
    if (!validTitle(title)) return null;
    const end = lines.findIndex((s, i) => i > author && i <= author + 12 &&
      /^(?:[a-z]\s+\p{Lu}|\d+\s*\p{Lu}|abstract\b|correspondence\b)/u.test(s));
    const credit = end < 0 ? "" : lines.slice(author, end).join(" ");
    return { title, credit, names: credit ? bylineNames(credit) : null };
  }

  function headerFields(result, heading) {
    result.put("title", heading.title);
    if (heading.names) result.put("authors", heading.names, heading.credit);
  }

  function scienceDirect(lines, result) {
    const list = lines.findIndex(s => /^contents lists available at sciencedirect$/i.test(s));
    if (list < 0 || !/^journal homepage:/i.test(lines[list + 2] || "")) return false;
    const journal = lines[list + 1];
    const imprint = lines.map(s => s.match(/^(.+?) (\d{1,4}) \(((?:19|20)\d{2})\) (\w+(?:\s*[-–]\s*\w+)?)$/))
      .find(m => m && compact(m[1]) === compact(journal));
    if (!imprint) return false;
    const type = lines.findIndex((s, i) => i < 15 && articleType.test(s));
    let start = type >= 0 ? type + 1 : list < 8 ? list + 3 : lines.indexOf(imprint[0]) + 1;
    while (start < 12 && /^(?:available online|[0-9]{4}-[0-9X]{4}\/|CC BY|licenses?\/|https?:\/\/creativecommons|nc-nd\/)/i.test(lines[start])) start++;
    const heading = englishHeading(lines, start);
    if (!heading) return false;
    // After the masthead an unlabeled section heading can resemble the first
    // line of a title. Abstain when the two cannot be distinguished.
    if (type < 0 && list < 8 && heading.title !== lines[start] &&
        lines[start].length < 35 && /^\p{Lu}/u.test(lines[start + 1])) return false;
    headerFields(result, heading);
    result.put("publicationTitle", journal);
    result.put("volume", imprint[2], imprint[0]);
    result.put("date", imprint[3], imprint[0]);
    if (/^(?:[A-Z]?\d+(?:[-–]\d+)?|e\d+)$/.test(imprint[4])) result.put("pages", imprint[4], imprint[0]);
    const doi = standaloneDOI(lines, "10.1016/");
    if (doi) result.put("DOI", ...doi);
    return true;
  }

  function scienceDirectPrint(lines, result) {
    if (lines[0] !== "Previous Next") return false;
    const at = lines.findIndex((s, i) => i < 5 && s.startsWith("Volume "));
    const imprint = lines[at]?.match(/^Volume (\d+), Issue (\d+), (\d{1,2} [A-Za-z]+ (?:19|20)\d{2}), Pages (\d+[-–]\d+)$/);
    const end = lines.indexOf("Show more");
    if (!imprint || at < 2 || end < at + 4 || end > at + 12 || !/^[A-Z ]{5,40}$/.test(lines[at + 1])) return false;
    const doi = standaloneDOI(lines.slice(end, end + 5), "10.1016/");
    if (!doi || !lines.slice(end, end + 6).includes("Get rights and content")) return false;
    const by = lines.findIndex((s, i) => i > at + 2 && i < end && /\s(?:PhD|MD|DVM)\s*(?:,|$)/.test(s));
    if (by < 0) return false;
    const title = lines.slice(at + 2, by).join(" ");
    if (!validTitle(title)) return false;
    result.put("title", title);
    const credit = lines.slice(by, end).join(" ");
    const names = bylineNames(credit.replace(/,?\s+(?:PhD|MD|DVM)\b/g, ""));
    if (names) result.put("authors", names, credit);
    result.put("publicationTitle", lines.slice(1, at).join(" "));
    result.put("volume", imprint[1], imprint[0]);
    result.put("issue", imprint[2], imprint[0]);
    result.put("date", imprint[3], imprint[0]);
    result.put("pages", imprint[4], imprint[0]);
    result.put("DOI", ...doi);
    return true;
  }

  function zeitschrift(lines, result) {
    if (!/^(?:Originalarbeit|Übersichtsarbeit|Technische Mitteilung|Recommendations|Short Communication)$/i.test(lines[0])) return false;
    const history = lines.findIndex((s, i) => i < 20 && /^Received \d+\b/i.test(s));
    if (history < 3 || !lines.slice(history, history + 6).some(s => /^Abstract\b/i.test(s))) return false;
    const footer = lines.findIndex(s => /^Z\.? Med\.? Phys\.? \d+ \((?:19|20)\d{2}\) \d+[-–]\d+(?=\s|$)/i.test(s));
    if (footer <= history || lines.slice(0, footer).some(s => /^(references|bibliography)\b/i.test(s))) return false;
    const imprint = lines[footer].match(/^Z\.? Med\.? Phys\.? (\d+) \(((?:19|20)\d{2})\) (\d+[-–]\d+)\b\s*/i);
    const doi = standaloneDOI([lines[footer].slice(imprint[0].length), lines[footer + 1] || ""], "10.1016/j.zemedi.");
    if (!doi) return false;
    // Unpaginated indexes sometimes join the byline to its first affiliation.
    // Reinsert the boundary only at an explicit department name.
    const front = lines.slice(0, history).flatMap(s => {
      const split = s.search(/\s+(?:1\s+)?Department of\b/);
      return split < 0 ? [s] : [s.slice(0, split), s.slice(split).trim()];
    });
    let heading = englishHeading(front, 1);
    if (!heading) {
      // A single line of credit may carry just a corresponding-author sign.
      const aff = front.findIndex((s, i) => i >= 3 && /^(?:[a-z]\s+\p{Lu}|Department of\b)/u.test(s));
      if (aff < 3) return false;
      const credit = front[aff - 1], title = front.slice(1, aff - 1).join(" ");
      const names = bylineNames(credit.replace(/\s*[∗⇑*]+(?=\s*,|\s*$)/g, ""));
      if (!validTitle(title) || (!names && !/\s+a,[⇑∗*],\s+.+\s+b$/.test(credit))) return false;
      heading = { title, names, credit };
    }
    headerFields(result, heading);
    result.put("publicationTitle", "Zeitschrift für Medizinische Physik", imprint[0]);
    result.put("date", imprint[2], imprint[0]);
    result.put("volume", imprint[1], imprint[0]);
    result.put("pages", imprint[3], imprint[0]);
    result.put("DOI", ...doi);
    return true;
  }

  function physicalReview(lines, result) {
    const imprint = lines[0].match(/^(PHYSICAL REVIEW(?: [A-Z]+){0,4}) (\d+), (\d{6}) \(((?:19|20)\d{2})\)$/);
    if (!imprint) return false;
    const doi = standaloneDOI(lines.slice(1, 55), "10.1103/");
    const heading = englishHeading(lines, 1);
    if (!doi || !heading) return false;
    headerFields(result, heading);
    result.put("DOI", ...doi);
    result.put("publicationTitle", imprint[1], imprint[0]);
    result.put("volume", imprint[2], imprint[0]);
    result.put("pages", imprint[3], imprint[0]);
    result.put("date", imprint[4], imprint[0]);
    return true;
  }

  function wiley(lines, result) {
    const type = lines.findIndex((s, i) => i < 8 && articleType.test(s));
    if (type < 0 || !lines.slice(0, type).some(s => /^received\s*:/i.test(s))) return false;
    const doi = standaloneDOI(lines.slice(0, type), "10.1002/");
    if (!doi) return false;
    const citation = lines.map(s => s.match(/^(Med(?:ical)? Phys(?:ics)?)\.? ((?:19|20)\d{2});(\d+)(?:\((\d+)\))?:([\de]+(?:[-–]\d+)?)\.\s+(?:https?:\/\/)?wileyonlinelibrary\.com\/journal\/mp\b/i)).find(Boolean);
    if (!citation) return false;
    const heading = englishHeading(lines, type + 1);
    if (!heading) return false;
    headerFields(result, heading);
    result.put("publicationTitle", "Medical Physics", citation[0]);
    result.put("date", citation[2], citation[0]);
    result.put("volume", citation[3], citation[0]);
    if (citation[4]) result.put("issue", citation[4], citation[0]);
    result.put("pages", citation[5], citation[0]);
    result.put("DOI", ...doi);
    return true;
  }

  function iop(pages, lines, result) {
    const idx = lines.findIndex((s, i) => i < 14 && /^to cite this article:/i.test(s));
    if (idx < 2) return false;
    const citation = lines[idx].match(/^To cite this article:\s*(.+?) ((?:19|20)\d{2}) ([\p{L}. &-]+) (\d+) (\w+)(?:$| View the article online)/iu);
    if (!citation || !lines.slice(idx, idx + 6).some(s => /view the article online for updates/i.test(s))) return false;
    // The new wrapper sometimes wraps its journal name after an ampersand.
    const journalEnd = /&$/.test(lines[0]) ? 2 : 1;
    const journal = lines.slice(0, journalEnd).join(" ");
    const pubType = /^(?:(?:topical )?review|paper|note|letter|technical note)(?:\s*[•·]\s*open access)?$/i;
    let start = journalEnd;
    if (pubType.test(lines[start])) start++;
    if (/^you may also like$/i.test(lines[start])) start++;
    const title = lines.slice(start, idx).join(" ");
    if (idx <= start || !validTitle(title) || journal.length > 95) return false;
    // Require the publisher wrapper or its corroborating article header, not a stray citation.
    if (!lines.some(s => /this content was downloaded from IP address/i.test(s)) &&
        !lines.some(s => /^IOP Publishing$/i.test(s))) return false;
    result.put("title", title);
    result.put("publicationTitle", journal);
    result.put("volume", citation[4], citation[0]);
    result.put("date", citation[2], citation[0]);
    const short = compact(citation[3]), firstPage = citation[5];
    if (/^\d{6}$|^\d{2}[A-Z]{2}\d{2}$/.test(firstPage)) result.put("pages", firstPage, citation[0]);
    const actual = pages[1] ? linesOf(pages[1]).slice(0, 60) : lines.slice(idx + 1);
    const i = actual.findIndex((s, line) => {
      if (line === 0 && s === firstPage && compact(actual[1] || "") === compact(journal)) return true;
      const imprint = s.replace(/^(?:IOP Publishing|Institute of Physics Publishing|Institute of Physics and Engineering in Medicine)\s+/i, "");
      const m = imprint.match(/^(.+?) (\d+) \(((?:19|20)\d{2})\) ([A-Z0-9]+)(?=\s|[-–.]|$)/i);
      return m && compact(m[1]) === short && m[2] === citation[4] && m[3] === citation[2] && m[4] === firstPage;
    });
    if (i < 0) return true;
    const page = pages[1] ? 1 : 0;
    const head = actual[i], range = head.match(/\) ([A-Z]?\d+[-–][A-Z]?\d+)\b/i);
    if (range) result.put("pages", range[1], head, page);
    // The issue header must identify the same work before borrowing its DOI.
    const identifier = head.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)\s*10\.1088\/\S+/i);
    const doi = standaloneDOI([identifier?.[0] || "", actual[i + 1] || ""], "10.1088/");
    if (doi) result.put("DOI", ...doi, page);
    // Require the repeated article title, a full byline terminated by affiliations,
    // and agreement with the first author in the wrapper's recommended citation.
    const titleKey = compact(title);
    for (let pos = i + 1; pos < Math.min(i + 28, actual.length); pos++) {
      if (!titleKey.startsWith(compact(actual[pos]))) continue;
      let last = pos;
      while (last < pos + 7 && last + 1 < actual.length &&
          compact(actual.slice(pos, last + 1).join(" ")) !== titleKey) last++;
      if (compact(actual.slice(pos, last + 1).join(" ")) !== titleKey) continue;
      let startBy = last + 1;
      while (/^(?:received|revised|accepted for publication|published)$/i.test(actual[startBy]) &&
          /^\d{1,2} [A-Za-z]+ \d{4}$/.test(actual[startBy + 1] || "")) startBy += 2;
        const affiliation = /^(?:[\d†‡§‖]+\s+\p{Lu}|(?:Department|Institute|School|Faculty|Centre|Center) of\b|(?:Centre|Center) for\b)/u;
        const endBy = actual.findIndex((s, i) => i > startBy && i <= startBy + 10 && affiliation.test(s));
      if (endBy < 0) break;
      const credit = actual.slice(startBy, endBy).join(" ");
        const names = bylineNames(credit.replace(/[†‡§‖]/g, ""));
        const shortened = /\s+et\s*al\.?$/i.test(citation[1]);
        const cited = compact(citation[1].replace(/\s+et\s*al\.?$/i, ""));
        if (names && (shortened ? names.length > 1 && cited === compact(names[0])
          : cited === compact(names.join(" and ")))) {
        result.put("authors", names, credit, page);
      }
      break;
    }
    return true;
  }

  function chinese(lines, result) {
    const compactCN = s => s.replace(/\s|[\uE000-\uF8FF]/g, "");
    const cn = lines.slice(0, 22).map(compactCN);
    const volume = cn[0]?.match(/^第(\d+)卷第(\d+)期$/);
    const date = cn[1]?.match(/^((?:19|20)\d{2})年(0?[1-9]|1[0-2])月$/);
    if (!volume || !date || !/^\p{Script=Han}{3,30}$/u.test(cn[2] || "") || !cn.some(s => /^摘要:/.test(s))) return false;
    const affiliation = cn.findIndex((s,i) => i > 4 && i < 15 && /^\(.{2,80}(?:大学|学院|研究所|研究院|医院)/u.test(s));
    if (affiliation < 2) return false;
    const author = affiliation - 1, titleLine = author - 1;
    const names = cn[author].split(/[,、;]/);
    if (!names.every(s => /^\p{Script=Han}{2,4}$/u.test(s))) return false;
    if (!/^(?:[A-Za-z0-9.]+)?\p{Script=Han}/u.test(cn[titleLine]) || !validTitle(cn[titleLine])) return false;
    // Only join a fully letter-spaced OCR line. Ordinary English words keep their spaces.
    const title = /[\uE000-\uF8FF]/.test(lines[titleLine]) ? cn[titleLine] : lines[titleLine].replace(/(?<=\p{Script=Han}) +(?=\p{Script=Han})/gu, "");
    result.put("title", title, lines[titleLine]);
    result.put("publicationTitle", cn[2], lines[2]);
    result.put("volume", volume[1], lines[0]);
    result.put("issue", volume[2], lines[0]);
    result.put("date", date[1] + "-" + date[2].padStart(2,"0"), lines[1]);
    if (/[\uE000-\uF8FF]/.test(lines[author])) {
      result.warnings.push("作者行含有异常字形，文字层可能把姓名中的汉字读错，请对照原页填写。");
    } else {
      result.put("authors", names, lines[author]);
      result.fields.authorMode = "single";
    }
    const doiLines = lines.map(s => /^DOI\s*:/i.test(s) ? compactCN(s) : s);
    const doi = standaloneDOI(doiLines, "10.");
    if (doi) result.put("DOI", doi[0], lines[doiLines.indexOf(doi[1])]);
    return true;
  }

  function legacyMedicalPhysics(lines, result) {
    // The footer gives the issue date even when the copyright year differs.
    const imprint = lines.map(s => s.match(/^(\d+(?:-1)?) Med\. Phys\. (\d+)\s*[("„](\d+)(?:\)|…|\.{3})\s*,?\s*([A-Z][a-z]+) ((?:19|20)\d{2})\b/)).find(Boolean);
    if (!imprint) return false;
    const watermark = /^24734209, (\d{4}), (\d+(?:Part\d+)?), Downloaded from https:\/\/aapm\.onlinelibrary\.wiley\.com\/doi\/(10\.(?:1118|1002)\/[\w.-]+) by /i;
    const start = watermark.test(lines[0]) ? 1 : 0;
    const affiliation = /\b(?:Department of|School of|Institute of|University of|Medical Radiation Physics|Center of|Advanced Materials Group)\b/i;
    let author = -1;
    for (let i = start + 1; i < Math.min(start + 6, lines.length); i++) {
      // Distinguish a wrapped title line from the beginning of a byline.
      const s = lines[i].split(affiliation)[0].trim();
      const name = s.split(/,|\s+and\s+/)[0].replace(/[a-z][)!]$|[\u0352\u034d]/gu, "").trim();
      if (name && /^\p{Lu}[\p{L}\p{M}.’'-]+(?:\s+(?:\p{Lu}[\p{L}\p{M}.’'-]*|de|van|von)){1,4}$/u.test(name)
          && (affiliation.test(lines[i]) || affiliation.test(lines[i+1] || "") || /^Citation: Medical Physics\b/i.test(lines[i+1] || ""))) {
        author = i;
        break;
      }
    }
    if (author < 0) return false;
    const title = lines.slice(start, author).join(" ");
    if (!validTitle(title) || affiliation.test(title) ||
        /[\uFFFD]|[a-z]â(?=\s|$)|Downloaded|^\W|\b(?:point\/counterpoint|guest editorial|erratum to|Cancer Center)\b/i.test(title) ||
        lines.slice(start + 1, author).some(s => /^(?:\p{Lu}\.\s*)+\p{Lu}\p{Ll}+(?:\s|$)/u.test(s))) return false;
    result.put("title", title);
    result.put("publicationTitle", "Medical Physics", imprint[0]);
    result.put("volume", imprint[2], imprint[0]);
    result.put("issue", imprint[3], imprint[0]);
    result.put("date", imprint[5], imprint[0]);
    if (/\b[a-z][-‐‑–](?:index|factor|value)\b/i.test(title)) {
      result.warnings.push("题名含单字母指标，旧 PDF 的文字层可能把希腊字母读成拉丁字母，请核对原页。");
    }
    // A suffix -1 marks the article number used in electronic pagination.
    if (imprint[1].endsWith("-1")) result.put("pages", imprint[1].slice(0,-2), imprint[0]);
    const firstFooter = lines.findIndex(s => s.startsWith(imprint[0]));
    const marks = lines.slice(0, firstFooter + 3).map(s => s.match(watermark))
      .filter(m => m && m[1] === imprint[5] && m[2].split(/Part/i)[0] === imprint[3]);
    if (marks.length && marks.every(m => m[3] === marks[0][3])) {
      // Keep institutional download information out of the evidence excerpt.
      result.put("DOI", marks[0][3], marks[0][0].split(" by ")[0]);
      result.put("issue", marks[0][2], marks[0][0].split(", Downloaded")[0]);
    } else {
      const declared = new Set();
      for (const line of lines.slice(0, firstFooter + 1)) {
        if (/^(?:references|bibliography|articles you may be interested in)/i.test(line)) break;
        const label = line.match(/(?:\[DOI:\s*|\[https?:\/\/(?:dx\.)?doi\.org\/)(10\.(?:1118|1002)\/[\w.-]+)\]/i)
          || line.match(/^Citation:\s*Medical Physics\b.{0,80}?\bdoi:\s*(10\.(?:1118|1002)\/[\w.-]+)/i);
        if (label) declared.add(label[1]);
      }
      if (declared.size === 1) {
        const [doi] = declared;
        result.put("DOI", doi, "DOI: " + doi);
      }
    }
    return true;
  }

  function parsePages(pages, options = {}, firstPageNumber = 1) {
    const lines = linesOf(pages?.[0]);
    if (!lines.length || lines.slice(0, 8).some(s => excluded.test(s))) return null;
    const fields = {}, evidence = {}, warnings = [];
    const result = { fields, warnings, put(key, value, quote = value, page = 0) {
      fields[key] = value;
      evidence[key] = (options.source === "cache" ? "索引片段 " : "第 ") + (page + firstPageNumber) +
        (options.source === "cache" ? "" : " 页") + " · " + quote;
    }};
    if (!chinese(lines, result) && !iop(pages, lines, result) && !scienceDirect(lines, result) &&
        !scienceDirectPrint(lines, result) && !wiley(lines, result) && !physicalReview(lines, result) &&
        !zeitschrift(lines, result) && !legacyMedicalPhysics(lines, result)) return null;
    return { fields, evidence, warnings };
  }
  return { parsePages };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ArticleMetadata;
