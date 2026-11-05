import { test } from "node:test";
import assert from "node:assert/strict";
import { captionFor, pickLang, words } from "../src/words.ts";

test("Portuguese for everyone by default; this device's choice next; ?lang= wins", () => {
  assert.equal(pickLang(null, null), "pt");
  assert.equal(pickLang(null, "en"), "en");
  assert.equal(pickLang("pt", "en"), "pt");
  assert.equal(pickLang("klingon", "nonsense"), "pt");
});

test("the four statuses have their family names", () => {
  assert.deepEqual(words("pt").status, {
    online: "Na bardea",
    away: "Já vorto",
    busy: "No biolo",
    invisible: "A zongolar",
  });
});

test("a caption is picked from the status's own list", () => {
  assert.equal(captionFor("pt", "busy", () => 0), "a fingir que trabalho");
  assert.equal(captionFor("pt", "busy", () => 0.99), words("pt").captions.busy.at(-1));
  for (let i = 0; i < 20; i++) assert.ok(words("pt").captions.away.includes(captionFor("pt", "away")));
});

test("every caption fits the 80-character limit the server enforces", () => {
  for (const lang of ["pt", "en"] as const) {
    for (const list of Object.values(words(lang).captions)) {
      assert.ok(list.length > 0);
      for (const caption of list) assert.ok(caption.length <= 80, caption);
    }
  }
});

test("who is typing reads naturally for one, two and many", () => {
  const pt = words("pt").ui.typing;
  assert.equal(pt([]), "");
  assert.equal(pt(["Kota"]), "Kota está a escrever…");
  assert.equal(pt(["Kota", "Kamba-2"]), "Kota e Kamba-2 estão a escrever…");
  assert.equal(pt(["Kota", "Kamba-2", "Mais_Velho", "Kamba-3"]), "Kota, Kamba-2 e mais 2 estão a escrever…");
  assert.equal(words("en").ui.typing(["Kota", "Kamba-2"]), "Kota and Kamba-2 are typing…");
});

test("the message box says where the message goes", () => {
  assert.equal(words("pt").ui.placeholder("#mujimbo"), "Mete dica para #mujimbo");
});
