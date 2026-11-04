import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";

const server = createApp();
let base = "";

before(async () => {
  // Port 0 = the OS picks a free port, so tests never clash with a running server.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test("GET /healthz returns 200 and status ok", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("unknown path returns 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});
