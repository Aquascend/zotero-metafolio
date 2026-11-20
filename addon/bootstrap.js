/* global Zotero, Services, Components, IOUtils, ThesisMetadata, PatentMetadata, APP_SHUTDOWN */
"use strict";

let menuID;
let chromeHandle;
let running = false;
let active = false;

const itemFields = {
    thesis: {
        title: "论文题名", authors: "作者", university: "授予单位", thesisType: "学位类型",
        date: "日期", language: "语言", place: "地点", DOI: "DOI"
    },
    patent: {
        title: "专利名称", inventors: "发明人", patentNumber: "专利文献号", applicationNumber: "申请号",
        filingDate: "申请日", issueDate: "授权公告日", assignee: "专利权人", country: "国家／地区",
        issuingAuthority: "公布机构", language: "语言", extra: "其他著录事项"
    }
};

function isPDF(item) {
    return item && !item.deleted && item.isPDFAttachment();
}

function canCreate(item) {
    return isPDF(item) && item.isTopLevelItem() && item.isEditable();
}

function recognize(pages, options) {
    const patent = PatentMetadata.parsePages(pages, options);
    if (patent) return { ...patent, itemType: "patent" };
    const thesis = ThesisMetadata.parsePages(pages, options);
    if (thesis.fields.title) return { ...thesis, itemType: "thesis" };
    return { itemType: null, fields: {}, evidence: {},
        warnings: ["未能从这些页面确认学位论文或中国专利。可展开原文检查文字是否完整。"] };
}

function pagesFromRecognizer(data) {
    // In Zotero 10 each page contains blocks of lines. Each word carries its
    // text and its own space-after flag, including for mixed CJK/Latin text.
    return (data?.pages || []).map(page => {
        const lines = page[2]?.[0]?.[0]?.[0]?.[4] || [];
        return lines.map(line => line[0].map(word =>
            word[13] + (word[5] ? " " : "")
        ).join("").trim()).join("\n");
    });
}

async function readFrontMatter(item) {
    let filePresent = false;
    try {
        const path = await item.getFilePathAsync();
        filePresent = !!path && await IOUtils.exists(path);
        if (filePresent) {
            const raw = await Zotero.PDFWorker.getRecognizerData(item.id, true);
            const pages = pagesFromRecognizer(raw);
            if (pages.some(page => page.trim())) {
                return { pages, source: "pdf", notice: `来源为原 PDF 的前 ${pages.length} 页。` };
            }
        }
    }
    catch (error) {
        Zotero.debug(`MetaFolio: PDF extraction for ${item.key}: ${error}`);
    }

    const cache = Zotero.FullText.getItemCacheFile(item).path;
    if (await IOUtils.exists(cache)) {
        const text = await Zotero.File.getContentsAsync(cache, "utf-8", 48000);
        const pages = text.slice(0, 16000).split("\f").slice(0, 5);
        if (pages.some(page => page.trim())) {
            const reason = filePresent ? "原 PDF 未能提取出封面文字" : "本机找不到原 PDF";
            return { pages, source: "cache", notice: `${reason}。以下为本机全文索引的开头，片段编号仅用于核对缓存。` };
        }
    }
    throw new Error(filePresent ? "PDF 和全文索引均没有可读的封面文字。扫描件可以先做文字识别（OCR）。" :
        "本机找不到原 PDF，也没有可读的全文索引。请先在 Zotero 中定位或下载原文件。");
}

function asCreators(type, fields) {
    const isPatent = type === "patent";
    const creatorType = isPatent ? "inventor" : "author";
    return ((isPatent ? fields.inventors : fields.authors) || []).map(name => {
        if (fields.authorMode === "single" || !/[\s,]/u.test(name)) {
            return { creatorType, name };
        }
        const initials = name.match(/^((?:\p{Lu}\.\s*)+)\s+([^,]+)$/u);
        if (initials) {
            return { creatorType, firstName: initials[1].trim(), lastName: initials[2] };
        }
        return Zotero.Utilities.cleanAuthor(name, creatorType, name.includes(","));
    });
}

async function createParent(attachmentID, type, fields) {
    if (!Object.hasOwn(itemFields, type)) throw new Error("请选择支持的文献类型。");
    if (!fields.title?.trim()) throw new Error("题名为空，请先核对。");
    return Zotero.DB.executeTransaction(async () => {
        // A sync, another recognizer or another window may have touched the
        // item since the review window opened. Check inside the transaction.
        const item = await Zotero.Items.getAsync(attachmentID);
        if (!canCreate(item)) throw new Error("附件已移动、已归入父条目，或当前文库不可编辑。");

        const parent = new Zotero.Item(type);
        parent.libraryID = item.libraryID;
        for (const name of Object.keys(itemFields[type])) {
            if (["authors", "inventors", "DOI"].includes(name)) continue;
            if (fields[name]?.trim()) parent.setField(name, fields[name].trim());
        }
        if (type === "thesis" && fields.DOI?.trim()) {
            const doi = fields.DOI.trim();
            const doiID = Zotero.ItemFields.getID("DOI");
            if (doiID && Zotero.ItemFields.isValidForType(doiID, parent.itemTypeID)) {
                parent.setField("DOI", doi);
            }
            else {
                parent.setField("extra", `DOI: ${doi}`);
            }
        }
        parent.setCreators(fields.creators);
        parent.setCollections(item.getCollections());
        await parent.save();
        item.parentID = parent.id;
        await item.save();
        return parent;
    });
}

async function reviewAttachments(win, items) {
    if (running || !active) return;
    running = true;
    const selected = items.filter(isPDF);
    try {
        for (const [index, item] of selected.entries()) {
            if (!active || win.closed) break;
            const filename = item.attachmentFilename || item.getField("title") || item.key;
            try {
                const input = await readFrontMatter(item);
                if (!active || win.closed) break;
                const result = recognize(input.pages, { filename, source: input.source });
                const editable = !!result.itemType && canCreate(item);
                const review = {
                    filename, input, result, editable, labels: itemFields[result.itemType] || {},
                    creators: asCreators(result.itemType, result.fields),
                    position: index + 1, total: selected.length, action: "stop"
                };
                win.openDialog("chrome://metafolio/content/review.xhtml", "",
                    "chrome,dialog,centerscreen,modal,resizable,width=810,height=660", review);
                if (review.action === "stop" || !active || win.closed) break;
                if (editable && review.action === "save") {
                    const parent = await createParent(item.id, result.itemType, review.fields);
                    if (selected.length === 1) await win.ZoteroPane.selectItem(parent.id);
                }
            }
            catch (error) {
                Zotero.logError(error);
                if (active && !win.closed) {
                    Services.prompt.alert(win, "书目拾页", filename + "\n\n" + error.message);
                }
            }
        }
    }
    finally {
        running = false;
    }
}

function startup({ id, rootURI }) {
    const aom = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
        .getService(Components.interfaces.amIAddonManagerStartup);
    chromeHandle = aom.registerChrome(Services.io.newURI(rootURI + "manifest.json"),
        [["content", "metafolio", "./"]]);
    Services.scriptloader.loadSubScript(rootURI + "parser.js", this);
    Services.scriptloader.loadSubScript(rootURI + "patent-parser.js", this);
    active = true;
    menuID = Zotero.MenuManager.registerMenu({
        menuID: "metafolio-review", pluginID: id, target: "main/library/item",
        menus: [{
            menuType: "menuitem",
            onShowing(_event, context) {
                context.menuElem.setAttribute("label", "用书目拾页识别 PDF 题录…");
                context.setVisible(context.items.some(isPDF));
                context.setEnabled(!running);
            },
            onCommand(event, context) {
                const win = event.target.ownerGlobal;
                reviewAttachments(win, context.items).catch(error => Zotero.logError(error));
            }
        }]
    });
}

function shutdown(_data, reason) {
    active = false;
    if (reason === APP_SHUTDOWN) return;
    if (menuID) Zotero.MenuManager.unregisterMenu(menuID);
    if (chromeHandle) chromeHandle.destruct();
    chromeHandle = null;
}

function install() {}
function uninstall() {}
function onMainWindowLoad() {}
function onMainWindowUnload() {}
