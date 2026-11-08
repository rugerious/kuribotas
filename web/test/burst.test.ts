import assert from "node:assert/strict";
import { test } from "node:test";
import { burstFor } from "../src/burst.ts";

test("only a message that is just one of the nine emojis bursts", () => {
  assert.deepEqual(burstFor("😂"), { emoji: "😂", move: "laugh" });
  assert.deepEqual(burstFor("  🤣 "), { emoji: "🤣", move: "laugh" });
  assert.deepEqual(burstFor("🇦🇴"), { emoji: "🇦🇴", move: "flag" });
  assert.deepEqual(burstFor("❤"), { emoji: "❤️", move: "heart" });
  assert.deepEqual(burstFor("👏🏾"), { emoji: "👏🏾", move: "clap" }); // a skin tone still claps, in its own tone
  assert.equal(burstFor("😂😂"), null);
  assert.equal(burstFor("ahah 😂"), null);
  assert.equal(burstFor("🥲"), null);
  assert.equal(burstFor(""), null);
});
