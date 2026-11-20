/* Bibliographic citations embedded in publisher PDFs. Require the title in the
 * visible article heading and independent evidence for the journal citation. */
var ArticleImprint = (() => {
  "use strict";

  function key(value) {
    return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  }

  function citation(subject) {
    // Keep the citation anchored to the whole Subject. Abstracts and prose can
    // mention other papers, years and identifiers.
    let match = subject.match(/^(.+?),\s*(\d{1,4})\s*\(((?:19|20)\d{2})\)\s*([\w–-]+)\.\s*doi:\s*(10\.\d{4,9}\/\S+)$/i);
    if (match) {
      const [, publicationTitle, volume, date, pages, DOI] = match;
      return { publicationTitle, date, volume, pages, DOI };
    }
    match = subject.match(/^(.+?)\s+((?:19|20)\d{2})\.(\d{1,4}):([a-z]?\d+(?:[-–]\d+)?)$/i);
    if (match) {
      const [, publicationTitle, date, volume, pages] = match;
      return { publicationTitle, date, volume, pages };
    }
    match = subject.match(/^(IEEE [^;]+);((?:19|20)\d{2});(\d+);(\d+);(10\.\d{4,9}\/\S+)$/i);
    if (match) {
      const [, publicationTitle, date, volume, issue, DOI] = match;
      return { publicationTitle, date, volume, issue, DOI };
    }
    match = subject.match(/^([^,;]+),\s*(?:((?:19|20)\d{2}),\s*)?(?:doi:\s*|https?:\/\/doi\.org\/)(10\.\d{4,9}\/\S+)$/i);
    if (match) {
      const [, publicationTitle, date, DOI] = match;
      return { publicationTitle, date, DOI };
    }
    return null;
  }

  function parse(pages, info, firstPageNumber = 1) {
    if (typeof info?.Title !== "string" || typeof info.Subject !== "string") return null;
    const title = info.Title.normalize("NFKC").replace(/\s+/g, " ").trim();
    const subject = info.Subject.trim();
    if (title.length < 8 || title.length > 600 || /[\x00-\x1f\ufffd<>]/.test(title) || subject.length > 400) return null;
    const imprint = citation(subject);
    if (!imprint || imprint.publicationTitle.length > 130 || /[<>/]|\b(?:conference|proceedings|thesis|workshop|dissertation|preprints?|repository|dataset|report|supplementary material)\b/i.test(imprint.publicationTitle)) return null;
    const page = String(pages[0] || "").slice(0, 22000).normalize("NFKC");
    const lines = page.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const heading = lines.slice(0, 35);
    if (heading.slice(0, 12).some(s => /^(?:(?:electronic|online)\s+)?(?:supplementa(?:l|ry)(?:\s+(?:material|information|document|data|file))?|supporting information|preprint|accepted manuscript)\b/i.test(s))) return null;

    let titleQuote;
    const titleKey = key(title);
    for (let i = 0; i < heading.length && !titleQuote; i++) {
      if (/^(?:abstract|references|bibliography|recommended reading|you may also like)\b/i.test(heading[i])) break;
      for (let j = i + 1; j <= Math.min(heading.length, i + 8); j++) {
        const words = heading.slice(i, j).join(" ");
        const normalized = key(words);
        if (normalized === titleKey) { titleQuote = words; break; }
        if (!titleKey.startsWith(normalized)) break;
      }
    }
    if (!titleQuote) return null;
    const referenceStart = lines.findIndex(s => /^(?:references|bibliography|literature cited)\s*$/i.test(s));
    const front = referenceStart < 0 ? lines : lines.slice(0, referenceStart);
    const doiValue = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/ig;
    const doiLines = front.filter(s => /^(?:doi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/|digital object identifier\s+)10\./i.test(s));
    const doiLine = doiLines[0];
    if (imprint.DOI) {
      const id = imprint.DOI.toLowerCase();
      const found = front.some(s => (s.match(doiValue) || []).some(v => v.replace(/[.,;]+$/, "").toLowerCase() === id));
      if (!found) return null;
    }
    else {
      // Older journals sometimes print only an abbreviated footer. Independently
      // verify the year and first page/e-locator before using a DOI-less subject.
      const firstPage = imprint.pages.split(/[-–]/)[0];
      if (!front.some(s => s.includes(imprint.date) && new RegExp("\\b" + firstPage + "\\b", "i").test(s))) return null;
      const ids = new Set(doiLines.flatMap(s => s.match(doiValue) || []).map(v => v.replace(/[.,;]+$/, "").toLowerCase()));
      if (ids.size === 1) [imprint.DOI] = ids;
    }
    // Some publishers abbreviate or garble the journal name in the Info
    // dictionary. Verify it in the masthead, imprint or footer before use.
    const printedJournal = front.some(s => key(s).includes(key(imprint.publicationTitle)));
    if (!imprint.volume && !(printedJournal && front.some(s =>
      /^(?:research|article|original article|r\s*e\s*s\s*e\s*a\s*r\s*c\s*h)\b/i.test(s) ||
      /\|\s*\((?:19|20)\d{2}\)\s*\d+:\d+/.test(s)))) return null;
    const fields = { title, authors: [] };
    const evidence = { title: `PDF 属性 Title 与第 ${firstPageNumber} 页 · ` + titleQuote };
    for (const [field, value] of Object.entries(imprint)) {
      if (!value) continue;
      if (field === "publicationTitle" && !printedJournal &&
          !(key(value) === "medicalphysics" && front.some(s => /\bMed\.? Phys\./i.test(s)))) continue;
      fields[field] = value;
      evidence[field] = field === "DOI" && !subject.toLowerCase().includes(value.toLowerCase())
        ? `第 ${firstPageNumber} 页 · ` + doiLine : "PDF 属性 Subject · " + subject;
    }
    return { fields, evidence, warnings: ["请按 PDF 首页核对作者；PDF 属性有时只列第一作者。"] };
  }

  function combine(article, imprint) {
    if (!article || !imprint) return article || imprint;
    if (key(article.fields.title) !== key(imprint.fields.title)) {
      // The embedded title was found as complete printed heading lines. A
      // matching self DOI corroborates it even if the text parser added a
      // section heading or the start of the byline.
      if (!article.fields.DOI || article.fields.DOI.toLowerCase() !== imprint.fields.DOI?.toLowerCase()) return article;
      return { ...imprint, warnings: [...imprint.warnings, "两种读取方式的题名范围不同，请按首页核对。"] };
    }
    const fields = { ...article.fields };
    const evidence = { ...article.evidence };
    const warnings = [...article.warnings];
    if (fields.DOI && imprint.fields.DOI && fields.DOI.toLowerCase() !== imprint.fields.DOI.toLowerCase()) {
      delete fields.DOI;
      delete evidence.DOI;
      warnings.push("正文与文档属性所列 DOI 不同，请核对。");
    }
    else {
      for (const [k, v] of Object.entries(imprint.fields)) {
        if (v && !fields[k] && imprint.evidence[k]) {
          fields[k] = v;
          evidence[k] = imprint.evidence[k];
        }
      }
    }
    return { fields, evidence, warnings };
  }
  return { parse, combine };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ArticleImprint;
