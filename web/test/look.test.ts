import assert from "node:assert/strict";
import { test } from "node:test";
import { continues, initials, lookNamed } from "../src/look.ts";
import type { Line } from "../src/state.ts";
import { parseInput } from "../src/commands.ts";

test("styles have Angolan and English names, any case", () => {
  assert.equal(lookNamed("moderno"), "moderno");
  assert.equal(lookNamed("Modern"), "moderno");
  assert.equal(lookNamed(" mIRC "), "mirc");
  assert.equal(lookNamed("clássico"), "mirc");
  assert.equal(lookNamed("roxo"), undefined);
});

test("/estilo and /style pick a style; anything else shows how", () => {
  assert.deepEqual(parseInput("/estilo moderno", "#mujimbo", "pt"), { kind: "look", look: "moderno" });
  assert.deepEqual(parseInput("/style mirc", "#mujimbo", "en"), { kind: "look", look: "mirc" });
  assert.equal(parseInput("/estilo", "#mujimbo", "pt").kind, "error");
});

test("initials: two letters, from two words when the nick has them", () => {
  assert.equal(initials("Mais_Velho"), "MV");
  assert.equal(initials("Kota"), "KO");
  assert.equal(initials("kamba-2"), "K2");
  assert.equal(initials("Estraga_Lar"), "EL");
  assert.equal(initials("Ñ"), "Ñ");
});

const say = (key: number, nick: string, at: string, kind: "say" | "me" = "say"): Line => ({
  kind: "message",
  key,
  msg: { id: key, channel: "#mujimbo", nick, kind, text: "olá", at },
});

test("the same person within 5 minutes joins their last message; others, /me and *** lines don't", () => {
  const a = say(1, "Kota", "2026-11-09T18:40:00Z");
  assert.equal(continues(undefined, a), false);
  assert.equal(continues(a, say(2, "Kota", "2026-11-09T18:44:00Z")), true);
  assert.equal(continues(a, say(3, "Kota", "2026-11-09T18:46:00Z")), false);
  assert.equal(continues(a, say(4, "Kamba", "2026-11-09T18:41:00Z")), false);
  assert.equal(continues(a, say(5, "Kota", "2026-11-09T18:41:00Z", "me")), false);
  const event: Line = { kind: "event", key: 6, text: "Kamba entrou", at: "2026-11-09T18:41:00Z", tone: "info" };
  assert.equal(continues(event, say(7, "Kota", "2026-11-09T18:41:00Z")), false);
});
