import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";

// A private sounds folder with only a nudge, and a file that must never be served.
const root = mkdtempSync(join(tmpdir(), "kuribotas-sounds-"));
const soundsDir = join(root, "sounds");
mkdirSync(soundsDir);
writeFileSync(join(soundsDir, "nudge.mp3"), "ID3 fake mp3");
writeFileSync(join(soundsDir, "nudge-3.mp3"), "ID3 piece three");
writeFileSync(join(soundsDir, "tornado-amapiano.mp3"), "ID3 dancing tornado");
writeFileSync(join(soundsDir, "Nudge-X.mp3"), "wrong case: ignored");
writeFileSync(join(soundsDir, "secret.mp3"), "not for you");
writeFileSync(join(root, "kuribotas.db"), "the database");

const app = createApp({ dbPath: ":memory:", soundsDir });
const bare = createApp({ dbPath: ":memory:" });
let url = "";
let bareUrl = "";

before(async () => {
  for (const a of [app, bare]) await new Promise<void>((resolve) => a.server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  bareUrl = `http://127.0.0.1:${(bare.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  await bare.close();
  rmSync(root, { recursive: true, force: true });
});

test("a family sound is served as audio; /sounds/available says which exist", async () => {
  const res = await fetch(`${url}/sounds/nudge.mp3`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.equal(await res.text(), "ID3 fake mp3");
  assert.equal(await (await fetch(`${url}/sounds/nudge-3.mp3`)).text(), "ID3 piece three");
  const available = await fetch(`${url}/sounds/available`);
  assert.deepEqual(await available.json(), { files: ["nudge", "nudge-3", "tornado-amapiano"] });
  assert.equal(await (await fetch(`${url}/sounds/tornado-amapiano.mp3`)).text(), "ID3 dancing tornado");
});

test("only the known names are served: no other files, no escaping the folder", async () => {
  for (const path of ["/sounds/tornado.mp3", "/sounds/secret.mp3", "/sounds/Nudge-X.mp3", "/sounds/nudge-../x.mp3", "/sounds/../kuribotas.db", "/sounds/%2e%2e/kuribotas.db"]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404, path);
  }
});

test("without a sounds folder, nothing is available and the app plays its own sounds", async () => {
  assert.equal((await fetch(`${bareUrl}/sounds/available`)).status, 404);
  assert.equal((await fetch(`${bareUrl}/sounds/nudge.mp3`)).status, 404);
});
