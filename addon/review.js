"use strict";

window.addEventListener("DOMContentLoaded", () => {
    const review = window.arguments[0];
    const byID = id => document.getElementById(id);
    const { labels, editable } = review;
    const { itemType, fields, evidence, warnings } = review.result;
    const creatorKey = itemType === "patent" ? "inventors" : "authors";
    byID("filename").textContent = review.filename;
    const kind = { patent: "专利", thesis: "学位论文", journalArticle: "期刊文章" }[itemType];
    const mode = editable ? "" : "只读预览。";
    byID("source").textContent = (kind ? kind + " · " : "") + mode + review.input.notice;
    byID("save").hidden = !editable;
    if (!editable) byID("stop").textContent = "关闭";
    byID("position").textContent = review.total > 1 ? `第 ${review.position} 篇，共 ${review.total} 篇` : "";
    if (review.total > 1) {
        byID("skip").hidden = false;
        byID("stop").textContent = "结束本批";
    }
    if (warnings.length) {
        byID("warnings").textContent = warnings.join("\n");
        byID("warnings").hidden = false;
    }
    for (const [key, label] of Object.entries(labels)) {
        const caption = document.createElement("label");
        caption.htmlFor = key;
        caption.textContent = label;
        const multiline = ["title", creatorKey, "extra"].includes(key);
        const control = document.createElement(multiline ? "textarea" : "input");
        control.id = key;
        control.readOnly = !editable;
        control.required = key === "title";
        if (multiline) control.rows = 2;
        const wrapper = document.createElement("div");
        wrapper.append(control);
        byID("fields").append(caption, wrapper);
        if (key === creatorKey) {
            control.value = review.creators.map(creator =>
                creator.name || [creator.lastName, creator.firstName].filter(Boolean).join(", ")
            ).join("\n");
            if (editable) {
                const hint = document.createElement("small");
                hint.id = "names-help";
                hint.textContent = "每行一人。西文按「姓, 名」填写，中文可直接填写姓名。";
                control.setAttribute("aria-describedby", hint.id);
                wrapper.append(hint);
            }
        }
        else {
            control.value = fields[key] || "";
        }
        if (evidence[key]) {
            const term = document.createElement("dt");
            term.textContent = label;
            const quote = document.createElement("dd");
            quote.textContent = evidence[key];
            byID("evidence").append(term, quote);
        }
    }
    byID("evidence-section").hidden = !byID("evidence").childElementCount;
    review.input.pages.forEach((page, index) => {
        const heading = document.createElement("h2");
        heading.textContent = review.input.source === "cache" ? `索引片段 ${index + 1}` : `PDF 第 ${index + 1} 页`;
        const text = document.createElement("pre");
        text.textContent = page || "（本页没有可提取的文字）";
        byID("pages").append(heading, text);
    });
    byID("fields").addEventListener("submit", event => {
        event.preventDefault();
        if (!editable) return;
        if (!byID("title").value.trim()) {
            byID("title").focus();
            return;
        }
        review.fields = Object.fromEntries(Object.keys(labels).filter(key => key !== creatorKey)
            .map(key => [key, byID(key).value.trim()]));
        const creatorType = itemType === "patent" ? "inventor" : "author";
        review.fields.creators = byID(creatorKey).value.split(/\r?\n/u)
            .map(name => name.trim()).filter(Boolean).map(name => {
                const comma = name.search(/[,，]/u);
                if (comma < 0) return { creatorType, name };
                const lastName = name.slice(0, comma).trim();
                const firstName = name.slice(comma + 1).trim();
                return { creatorType, firstName, lastName };
            });
        review.action = "save";
        window.close();
    });
    byID("skip").addEventListener("click", () => {
        review.action = "skip";
        window.close();
    });
    byID("stop").addEventListener("click", () => window.close());
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") window.close();
    });
});
