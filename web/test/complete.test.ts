import assert from "node:assert/strict";
import { test } from "node:test";
import { complete, completions } from "../src/complete.ts";

const nicks = ["Kota", "Kamba", "Mais_Velho", "Koti"];

test("two letters offer the nicks that start that way, any case, in order", () => {
  assert.deepEqual(completions("ko", 2, nicks), { start: 0, end: 2, matches: ["Kota", "Koti"] });
  assert.deepEqual(completions("olá ma", 6, nicks), { start: 4, end: 6, matches: ["Mais_Velho"] });
  assert.equal(completions("k", 1, nicks), null); // one letter is too little
  assert.equal(completions("xy", 2, nicks), null);
  assert.equal(completions("Kota", 4, nicks), null); // already whole
});

test("after @ one letter is enough; command names are left alone, their arguments complete", () => {
  assert.deepEqual(completions("oi @k", 5, nicks)?.matches, ["Kamba", "Kota", "Koti"]);
  assert.equal(completions("/ab", 3, nicks), null);
  assert.deepEqual(completions("/abanar Ka", 10, nicks)?.matches, ["Kamba"]);
});

test("completing: 'Kota: ' at the start, 'Kota ' or '@Kota ' elsewhere, the cursor after it", () => {
  const start = completions("ko", 2, nicks);
  assert.ok(start);
  assert.deepEqual(complete("ko", start, "Kota"), { text: "Kota: ", cursor: 6 });
  const middle = completions("olá ma tudo bem", 6, nicks);
  assert.ok(middle);
  assert.deepEqual(complete("olá ma tudo bem", middle, "Mais_Velho"), { text: "olá Mais_Velho tudo bem", cursor: 15 });
  const at = completions("oi @k", 5, nicks);
  assert.ok(at);
  assert.deepEqual(complete("oi @k", at, "Kota"), { text: "oi @Kota ", cursor: 9 });
});
