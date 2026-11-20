"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const cover = [
    "(19)国家知识产权局", "(12)实用新型专利", "(10)授权公告号 CN200000001U",
    "(45)授权公告日 2025.01.10", "(21)申请号 202420000001.1", "(22)申请日 2024.07.01",
    "(73)专利权人 示例大学", "(72)发明人 张明 李华", "(54)实用新型名称 一种纸张测量装置",
    "(57)摘要 示例文字。"
].join("\n");

function setup({ parentID = null, pages = [cover] } = {}) {
    const saved = [];
    const attachment = {
        id: 1, libraryID: 3, parentID, attachmentFilename: "sample.pdf",
        isPDFAttachment: () => true, isTopLevelItem() { return !this.parentID; },
        isEditable: () => true, getCollections: () => [18], getFilePathAsync: async () => "sample.pdf",
        async save() {}
    };
    class Item {
        constructor(type) { this.itemType = type; this.id = 2; this.fields = {}; }
        setField(key, value) { this.fields[key] = value; }
        setCreators(rows) { this.creators = rows; }
        setCollections(ids) { this.collections = ids; }
        async save() { saved.push(this); }
    }
    const ctx = vm.createContext({
        Zotero: {
            Item, Items: { getAsync: async () => attachment }, DB: { executeTransaction: fn => fn() },
            PDFWorker: { getRecognizerData: async () => ({ pages: pages.map(page => {
                const lines = page.split("\n").map(text => {
                    const word = Array(14).fill(0);
                    word[13] = text;
                    return [[word]];
                });
                return [600, 800, [[[[0, 0, 0, 0, lines]]]]];
            }) }) }, logError(error) { throw error; }
        },
        IOUtils: { exists: async () => true }
    });
    for (const file of ["parser.js", "patent-parser.js", "bootstrap.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "../addon", file), "utf8"), ctx);
    }
    vm.runInContext("active = true", ctx);
    function review(onOpen) {
        const win = { openDialog(_url, _name, _flags, state) { onOpen(state); },
            ZoteroPane: { async selectItem() {} } };
        return ctx.reviewAttachments(win, [attachment]);
    }
    return { ctx, review, attachment, saved };
}

function accept(state) {
    state.fields = { ...state.result.fields, creators: state.creators };
    state.action = "save";
}

test("confirmation files a patent in the original collection with inventor roles", async () => {
    const { review, saved, attachment } = setup();
    await review(state => {
        assert.equal(state.result.itemType, "patent");
        assert.equal(state.editable, true);
        accept(state);
    });
    assert.equal(saved.length, 1);
    const [item] = saved;
    assert.equal(item.itemType, "patent");
    assert.equal(item.fields.assignee, "示例大学");
    assert.equal(item.fields.patentNumber, "CN200000001U");
    assert.equal(item.fields.issueDate, "2025-01-10");
    assert.equal(JSON.stringify(item.creators), JSON.stringify([
        { creatorType: "inventor", name: "张明" }, { creatorType: "inventor", name: "李华" }
    ]));
    assert.deepEqual(item.collections, [18]);
    assert.equal(item.libraryID, attachment.libraryID);
    assert.equal(attachment.parentID, item.id);
});

test("an existing parent or an unrecognized document can only be previewed", async () => {
    for (const options of [{ parentID: 42 }, { pages: ["示例期刊\n论文参考文献\nCN200000001U"] }]) {
        const { review, saved } = setup(options);
        await review(state => {
            assert.equal(state.editable, false);
            accept(state);
        });
        assert.equal(saved.length, 0);
    }
});

test("a cancelled review and a concurrent reparent both avoid creating another item", async () => {
    const { review, ctx, saved, attachment } = setup();
    await review(state => { state.action = "stop"; });
    attachment.parentID = 42;
    await assert.rejects(ctx.createParent(attachment.id, "patent", { title: "示例" }), /已归入父条目/);
    assert.equal(saved.length, 0);
});

test("initials preserve a multipart family name in the review and creator data", () => {
    const { ctx } = setup();
    const [creator] = ctx.asCreators("thesis", { authors: ["A.B. Van der Meer"] });
    assert.equal(creator.firstName, "A.B.");
    assert.equal(creator.lastName, "Van der Meer");
    assert.equal(creator.creatorType, "author");
});
