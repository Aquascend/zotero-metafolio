"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePages } = require("../addon/parser.js");

function cover(imprint) {
  return [
    "Cataloguing community gardens", "by", "Rowan West",
    "A dissertation submitted to Oak University in conformity with the",
    "requirements for the degree of Doctor of Philosophy.",
    ...imprint, "© Rowan West 2021"
  ].join("\n");
}

test("records the city and full region printed between the degree and date", () => {
  for (const place of ["Green Valley, Oregon", "Lakeview, British Columbia"]) {
    const { fields, evidence } = parsePages([cover([place, "October, 2021"])]);
    assert.equal(fields.place, place);
    assert.equal(fields.date, "2021-10");
    assert.ok(evidence.place.includes(place + " / October, 2021"));
  }
});

test("omits place for an ambiguous name, advisory address, or unrelated date", () => {
  for (const imprint of [
    ["Lakeview", "October, 2021"],
    ["Lakeview, OR", "October, 2021"],
    ["Department of Physics, Oregon", "October, 2021"],
    ["Maple Street, Oregon", "October, 2021"],
    ["Advisor: Rowan West", "Lakeview, Oregon", "October, 2021"],
    ["Lakeview, Oregon", "October 2021 committee meeting"],
    ["October, 2021", "Lakeview, Oregon"]
  ]) {
    const { fields } = parsePages([cover(imprint)]);
    assert.ok(fields.title);
    assert.ok(!fields.place);
  }
});
