import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; next: () => Promise<Msg>; closed: Promise<number> };

const app = createApp({ dbPath: ":memory:" });
let httpUrl = "";
let wsUrl = "";

before(async () => {
  // Port 0 = the OS picks a free port, so tests never clash with a running server.
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  httpUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  await app.close();
});

// Opens a WebSocket with Node's built-in client (the same API browsers have)
// and queues incoming JSON messages so tests can await them in order.
function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: Msg[] = [];
    const waiting: ((m: Msg) => void)[] = [];
    const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as Msg;
      const waiter = waiting.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    });
    ws.addEventListener("open", () =>
      resolve({
        ws,
        closed,
        next: () => {
          const m = queue.shift();
          return m ? Promise.resolve(m) : new Promise<Msg>((r) => waiting.push(r));
        },
      }),
    );
    ws.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)));
  });
}

test("GET /healthz returns 200 and status ok", async () => {
  const res = await fetch(`${httpUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("unknown path returns 404", async () => {
  const res = await fetch(`${httpUrl}/nope`);
  assert.equal(res.status, 404);
});

test("a new client gets a welcome with the channel and its history", async () => {
  const a = await connect(wsUrl);
  const w = await a.next();
  assert.equal(w.type, "welcome");
  assert.equal(w.channel, "#mujimbo");
  assert.ok(Array.isArray(w.history));
  a.ws.close();
});

test("a message is saved and broadcast to every connected client", async () => {
  const a = await connect(wsUrl);
  const b = await connect(wsUrl);
  await a.next(); // welcome
  await b.next(); // welcome
  a.ws.send(JSON.stringify({ type: "say", text: "hello #mujimbo" }));
  for (const c of [a, b]) {
    const m = await c.next();
    assert.equal(m.type, "message");
    assert.equal(m.channel, "#mujimbo");
    assert.equal(m.text, "hello #mujimbo");
    assert.equal(typeof m.id, "number");
    assert.equal(typeof m.at, "string");
  }
  a.ws.close();
  b.ws.close();
});

test("a newcomer sees recent messages in the welcome history", async () => {
  const a = await connect(wsUrl);
  await a.next(); // welcome
  a.ws.send(JSON.stringify({ type: "say", text: "did you see this?" }));
  await a.next(); // the broadcast: by now the message is saved
  const b = await connect(wsUrl);
  const w = await b.next();
  const history = w.history as Msg[];
  assert.equal(history.at(-1)?.text, "did you see this?");
  a.ws.close();
  b.ws.close();
});

test("messages the server doesn't understand are ignored", async () => {
  const a = await connect(wsUrl);
  await a.next(); // welcome
  a.ws.send("not json");
  a.ws.send(JSON.stringify({ type: "say", text: "   " }));
  a.ws.send(JSON.stringify({ type: "shout", text: "hi" }));
  a.ws.send(JSON.stringify({ type: "say", text: "x".repeat(2001) }));
  a.ws.send(JSON.stringify({ type: "say", text: "valid" }));
  const m = await a.next(); // the first thing broadcast must be the valid one
  assert.equal(m.text, "valid");
  a.ws.close();
});

test("an oversized frame closes only that client; the server keeps running", async () => {
  const a = await connect(wsUrl);
  await a.next(); // welcome
  a.ws.send("x".repeat(20 * 1024));
  assert.equal(await a.closed, 1009); // 1009 = message too big
  const b = await connect(wsUrl);
  assert.equal((await b.next()).type, "welcome");
  b.ws.close();
});

test("WebSocket upgrades on other paths are refused", async () => {
  await assert.rejects(connect(wsUrl.replace("/ws", "/nope")));
});
