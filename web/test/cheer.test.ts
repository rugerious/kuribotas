import assert from "node:assert/strict";
import { test } from "node:test";
import { clubNamed } from "../src/cheer.ts";
import { parseInput } from "../src/commands.ts";

test("clubs by name or initials, any case or accent; anything else is not a club", () => {
  assert.equal(clubNamed("Benfica"), "benfica");
  assert.equal(clubNamed("SLB"), "benfica");
  assert.equal(clubNamed("fcp"), "porto");
  assert.equal(clubNamed("Sporting"), "sporting");
  assert.equal(clubNamed("Real Madrid"), "madrid");
  assert.equal(clubNamed("Barça"), "barca");
  assert.equal(clubNamed("Petro"), undefined);
  assert.equal(clubNamed(""), undefined);
});

test("/bandeira raises a flag in the open channel; without a club it shows how", () => {
  assert.deepEqual(parseInput("/bandeira slb", "#mujimbo", "pt"), { kind: "send", msg: { type: "cheer", channel: "#mujimbo", club: "benfica" } });
  assert.deepEqual(parseInput("/flag barça", "#mujimbo", "en"), { kind: "send", msg: { type: "cheer", channel: "#mujimbo", club: "barca" } });
  assert.equal(parseInput("/bandeira", "#mujimbo", "pt").kind, "error");
  assert.equal(parseInput("/bandeira benfica", "Kota", "pt").kind, "error"); // not in a private chat
});
