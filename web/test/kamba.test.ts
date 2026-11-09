import { test } from "node:test";
import assert from "node:assert/strict";
import { normalCode, openEnvelope, type Opened, type Sealed } from "../src/kamba.ts";
import { KAMBA_2026 } from "../src/kamba-envelopes.ts";
import { parseInput } from "../src/commands.ts";
import { words } from "../src/words.ts";

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// Seals envelopes the same way the draw did (made-up names, few iterations so the test is quick).
async function seal(items: [string, Opened][], iter = 1000): Promise<Sealed> {
  const subtle = globalThis.crypto.subtle;
  const e = [];
  for (const [code, payload] of items) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await subtle.importKey("raw", new TextEncoder().encode(normalCode(code)), "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const c = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
    e.push({ s: b64(salt), i: b64(iv), c: b64(c) });
  }
  return { iter, e };
}

const kota: Opened = { nome: "Kota", oferece: "Mais_Velho", criancas: [{ nome: "Kambinha", oferece: "Miúda" }] };
const kamba: Opened = { nome: "Kamba", oferece: "Kota", criancas: [] };

test("a code opens its own envelope, however it is typed", async () => {
  const sealed = await seal([["ABCD-2345", kota], ["WXYZ-6789", kamba]]);
  assert.deepEqual(await openEnvelope("ABCD-2345", sealed), kota);
  assert.deepEqual(await openEnvelope("abcd 2345", sealed), kota);
  assert.deepEqual(await openEnvelope("wxyz6789", sealed), kamba);
});

test("a wrong or empty code opens nothing", async () => {
  const sealed = await seal([["ABCD-2345", kota]]);
  assert.equal(await openEnvelope("ABCD-2346", sealed), null);
  assert.equal(await openEnvelope("  - ", sealed), null);
});

test("the 2026 draw: seven sealed envelopes with a slow key", () => {
  assert.equal(KAMBA_2026.e.length, 7);
  assert.ok(KAMBA_2026.iter >= 100_000);
});

test("/kamba stays on this device: it is never a message to send", () => {
  assert.deepEqual(parseInput("/kamba abcd-2345", "#kamba-oculto", "pt"), { kind: "kamba", code: "abcd-2345" });
  assert.deepEqual(parseInput("/amigooculto ABCD 2345", "#kamba-oculto", "pt"), { kind: "kamba", code: "ABCD 2345" });
  assert.equal(parseInput("/kamba", "#kamba-oculto", "pt").kind, "error");
});

test("the answer names your pair and your children's, in one line", () => {
  assert.equal(
    words("pt").kamba.opened("Kota", "Mais_Velho", kota.criancas),
    "🎅 Olá, Kota! Tu ofereces a Mais_Velho · Kambinha oferece a Miúda",
  );
  assert.equal(words("en").kamba.opened("Kamba", "Kota", []), "🎅 Hi, Kamba! You give to Kota");
});
