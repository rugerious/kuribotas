import { test } from "node:test";
import assert from "node:assert/strict";
import { soundChoices, soundSource } from "../src/sound.ts";

const files = ["nudge", "nudge-1", "nudge-3", "tornado", "tornado-amapiano"];

test("the choices are the default, each extra file of that kind, and the one made in code", () => {
  assert.deepEqual(soundChoices("nudge", files), ["padrao", "1", "3", "panelas"]);
  assert.deepEqual(soundChoices("tornado", files), ["padrao", "amapiano", "batucada"]);
  assert.deepEqual(soundChoices("nudge", []), ["padrao", "panelas"]);
});

test("a device plays what it picked; anything missing falls back", () => {
  assert.equal(soundSource("nudge", null, files), "nudge"); // nothing picked: the family default
  assert.equal(soundSource("nudge", "3", files), "nudge-3");
  assert.equal(soundSource("nudge", "panelas", files), "panelas");
  assert.equal(soundSource("nudge", "2", files), "nudge"); // file removed since: default
  assert.equal(soundSource("nudge", null, ["nudge-1"]), "panelas"); // no default file: the pots
  assert.equal(soundSource("tornado", "amapiano", files), "tornado-amapiano");
  assert.equal(soundSource("tornado", "batucada", files), "batucada");
  assert.equal(soundSource("tornado", null, []), "batucada");
});
