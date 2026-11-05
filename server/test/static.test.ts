import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";

// A fake web/dist inside a temp folder, with a secret file *next to* it that must never be served.
const root = mkdtempSync(join(tmpdir(), "kuribotas-static-"));
const webDir = join(root, "dist");
mkdirSync(webDir);
writeFileSync(join(webDir, "index.html"), "<!doctype html><title>kuribotas test page</title>");
writeFileSync(join(webDir, "main.js"), "console.log('hi');");
writeFileSync(join(root, "secret.txt"), "family secrets");

const app = createApp({ dbPath: ":memory:", webDir });
let port = 0;

before(async () => {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  port = (app.server.address() as AddressInfo).port;
});

after(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

// fetch() cleans up "../" before sending, so raw requests are needed to test path tricks.
function raw(path: string, method = "GET"): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("/ serves index.html with security headers", async () => {
  const res = await raw("/");
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"]), /^text\/html/);
  assert.match(res.body, /kuribotas test page/);
  assert.match(String(res.headers["content-security-policy"]), /default-src 'self'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("files get the right content type", async () => {
  const res = await raw("/main.js");
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"]), /^text\/javascript/);
});

test("HEAD returns headers without a body", async () => {
  const res = await raw("/main.js", "HEAD");
  assert.equal(res.status, 200);
  assert.equal(res.body, "");
});

test("missing files and other methods are 404", async () => {
  assert.equal((await raw("/nope.js")).status, 404);
  assert.equal((await raw("/main.js", "DELETE")).status, 404);
});

test("nothing outside the web folder can be read", async () => {
  for (const path of [
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/main.js/../../secret.txt",
    "/%00",
    "/%E0%A4%A",
  ]) {
    const res = await raw(path);
    assert.equal(res.status, 404, `${path} must be 404`);
    assert.doesNotMatch(res.body, /family secrets/, `${path} leaked the file`);
  }
});

test("/healthz still answers when files are served", async () => {
  const res = await raw("/healthz");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { status: "ok" });
});
