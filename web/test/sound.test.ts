import { test } from "node:test";
import assert from "node:assert/strict";
import { nudgeChoices, nudgeSource } from "../src/sound.ts";

const files = ["nudge", "nudge-1", "nudge-3", "tornado"];

test("the choices are the default, each extra nudge file, and the pots", () => {
  assert.deepEqual(nudgeChoices(files), ["padrao", "1", "3", "panelas"]);
  assert.deepEqual(nudgeChoices([]), ["padrao", "panelas"]);
});

test("a device plays what it picked; anything missing falls back", () => {
  assert.equal(nudgeSource(null, files), "nudge"); // nothing picked: the family default
  assert.equal(nudgeSource("3", files), "nudge-3");
  assert.equal(nudgeSource("panelas", files), "panelas");
  assert.equal(nudgeSource("2", files), "nudge"); // file removed since: default
  assert.equal(nudgeSource(null, ["nudge-1"]), "panelas"); // no default file: the pots
  assert.equal(nudgeSource("padrao", []), "panelas");
});
