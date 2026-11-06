import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../src/app.ts";

// A fast heartbeat (100 ms) so a dead connection is noticed within a test.
const app = createApp({ dbPath: ":memory:", heartbeatMs: 100 });
const limits = { timeout: 5000 };
let wsUrl = "";

before(async () => {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  wsUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
});

after(() => app.close());

type Msg = Record<string, unknown>;

// A client built on "ws" so a test can switch off its automatic answer to pings (a "dead" phone).
function connect(url: string, autoPong = true): Promise<{ ws: WebSocket; next: (match: (m: Msg) => boolean) => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { autoPong });
    const seen: Msg[] = [];
    const waiting: { match: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as Msg;
      const i = waiting.findIndex((w) => w.match(msg));
      if (i === -1) seen.push(msg);
      else waiting.splice(i, 1)[0]?.done(msg);
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        next: (match) =>
          new Promise((done) => {
            const i = seen.findIndex(match);
            if (i !== -1) done(seen.splice(i, 1)[0] as Msg);
            else waiting.push({ match, done });
          }),
      }),
    );
  });
}

test("a device arrives with its saved nick, and the others see that nick arrive", limits, async () => {
  const a = await connect(wsUrl);
  await a.next((m) => m.type === "joined");
  const b = await connect(`${wsUrl}?nick=${encodeURIComponent("Estraga_Lar")}`);
  assert.equal((await b.next((m) => m.type === "welcome")).nick, "Estraga_Lar");
  assert.equal((await a.next((m) => m.type === "join")).nick, "Estraga_Lar");
  a.ws.close();
  b.ws.close();
});

test("a taken or invalid nick in the address means arriving as a guest", limits, async () => {
  const a = await connect(`${wsUrl}?nick=Kota`);
  assert.equal((await a.next((m) => m.type === "welcome")).nick, "Kota");
  const b = await connect(`${wsUrl}?nick=kota`); // taken, any case
  assert.match(String((await b.next((m) => m.type === "welcome")).nick), /^Kamba-\d+$/);
  const c = await connect(`${wsUrl}?nick=${encodeURIComponent("com espaços")}`);
  assert.match(String((await c.next((m) => m.type === "welcome")).nick), /^Kamba-\d+$/);
  for (const x of [a, b, c]) x.ws.close();
});

test("a dead connection is dropped by the heartbeat, its nick freed, and the others told", limits, async () => {
  const watcher = await connect(wsUrl);
  await watcher.next((m) => m.type === "joined");
  const ghost = await connect(`${wsUrl}?nick=Fantasma`, false); // never answers pings
  await ghost.next((m) => m.type === "joined");
  assert.deepEqual(await watcher.next((m) => m.type === "quit" && m.nick === "Fantasma"), { type: "quit", nick: "Fantasma" });
  const again = await connect(`${wsUrl}?nick=Fantasma`); // the nick is free again
  assert.equal((await again.next((m) => m.type === "welcome")).nick, "Fantasma");
  watcher.ws.close();
  again.ws.close();
});
