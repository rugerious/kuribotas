import assert from "node:assert/strict";
import { test } from "node:test";
import { themeAttr, themeNamed } from "../src/theme.ts";

test("themes have Angolan and English names, any case", () => {
  assert.equal(themeNamed("escuro"), "escuro");
  assert.equal(themeNamed("Dark"), "escuro");
  assert.equal(themeNamed("CLARO"), "claro");
  assert.equal(themeNamed("light"), "claro");
  assert.equal(themeNamed(" auto "), "auto");
  assert.equal(themeNamed("roxo"), undefined);
  assert.equal(themeNamed(""), undefined);
});

test("auto leaves data-theme off so the phone decides", () => {
  assert.equal(themeAttr("escuro"), "dark");
  assert.equal(themeAttr("claro"), "light");
  assert.equal(themeAttr("auto"), null);
});
