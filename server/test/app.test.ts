import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; next: () => Promise<Msg>; closed: Promise<number> };

const app = createApp({ dbPath: ":memory:" });
const limits = { timeout: 5000 }; // a test waiting for a message that never comes fails instead of hanging
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

// Skips messages until one matches (other tests' joins and quits may arrive in between).
async function until(c: Client, match: (m: Msg) => boolean): Promise<Msg> {
  for (;;) {
    const m = await c.next();
    if (match(m)) return m;
  }
}

const ofType = (type: string) => (m: Msg) => m.type === type;

// Connects, waits for the welcome and for landing in #mujimbo; returns the client and its nick.
async function arrive(): Promise<{ c: Client; nick: string; joined: Msg }> {
  const c = await connect(wsUrl);
  const welcome = await until(c, ofType("welcome"));
  const joined = await until(c, (m) => m.type === "joined" && m.channel === "#mujimbo");
  return { c, nick: String(welcome.nick), joined };
}

const send = (c: Client, msg: Msg): void => c.ws.send(JSON.stringify(msg));

test("GET /healthz returns 200 and status ok", async () => {
  const res = await fetch(`${httpUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("unknown path returns 404", async () => {
  const res = await fetch(`${httpUrl}/nope`);
  assert.equal(res.status, 404);
});

test("a newcomer gets a guest nick, the channel list, and lands in #mujimbo", limits, async () => {
  const c = await connect(wsUrl);
  const welcome = await until(c, ofType("welcome"));
  assert.match(String(welcome.nick), /^Guest-\d+$/);
  assert.ok((welcome.channels as Msg[]).some((ch) => ch.name === "#mujimbo"));
  const joined = await until(c, ofType("joined"));
  assert.equal(joined.channel, "#mujimbo");
  assert.ok((joined.members as string[]).includes(String(welcome.nick)));
  assert.ok(Array.isArray(joined.history));
  c.ws.close();
});

test("a message is saved and broadcast with the sender's nick", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "say", channel: "#mujimbo", text: "hello #mujimbo" });
  for (const c of [a.c, b.c]) {
    const m = await until(c, ofType("message"));
    assert.equal(m.channel, "#mujimbo");
    assert.equal(m.nick, a.nick);
    assert.equal(m.kind, "say");
    assert.equal(m.text, "hello #mujimbo");
    assert.equal(typeof m.id, "number");
    assert.equal(typeof m.at, "string");
  }
  a.c.ws.close();
  b.c.ws.close();
});

test("/me is broadcast as an action", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "me", channel: "#mujimbo", text: "sets the table" });
  const m = await until(a.c, ofType("message"));
  assert.equal(m.kind, "me");
  assert.equal(m.text, "sets the table");
  a.c.ws.close();
});

test("/nick changes the nick for everyone and is used on later messages", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "nick", nick: "~*~Tester~*~" });
  const change = await until(b.c, ofType("nick"));
  assert.deepEqual(change, { type: "nick", old: a.nick, nick: "~*~Tester~*~" });
  send(a.c, { type: "say", channel: "#mujimbo", text: "new name" });
  const m = await until(b.c, ofType("message"));
  assert.equal(m.nick, "~*~Tester~*~");
  a.c.ws.close();
  b.c.ws.close();
});

test("a nick that is taken (any case) or has bad characters is refused", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "nick", nick: "Uniquename" });
  await until(a.c, ofType("nick"));
  send(b.c, { type: "nick", nick: "uniquename" });
  assert.match(String((await until(b.c, ofType("error"))).reason), /already in use/);
  send(b.c, { type: "nick", nick: "two words" });
  assert.match(String((await until(b.c, ofType("error"))).reason), /invalid nick/);
  a.c.ws.close();
  b.c.ws.close();
});

test("joining creates a channel, and only its members see its messages", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "join", channel: "#Futebol" }); // stored in lower case
  const joined = await until(a.c, ofType("joined"));
  assert.equal(joined.channel, "#futebol");
  assert.deepEqual(joined.members, [a.nick]);

  send(a.c, { type: "say", channel: "#futebol", text: "goal!" });
  await until(a.c, (m) => m.type === "message" && m.text === "goal!");
  send(b.c, { type: "say", channel: "#futebol", text: "me too" });
  assert.match(String((await until(b.c, ofType("error"))).reason), /join #futebol first/);

  // b is not in #futebol, so the first message b receives is this one, not "goal!".
  send(a.c, { type: "say", channel: "#mujimbo", text: "back home" });
  assert.equal((await until(b.c, ofType("message"))).text, "back home");

  const c = await connect(wsUrl);
  const welcome = await until(c, ofType("welcome"));
  assert.ok((welcome.channels as Msg[]).some((ch) => ch.name === "#futebol"));
  a.c.ws.close();
  b.c.ws.close();
  c.ws.close();
});

test("a joiner is announced to the channel's members", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "join", channel: "#jantar" });
  await until(a.c, (m) => m.type === "joined" && m.channel === "#jantar");
  const b = await arrive();
  send(b.c, { type: "join", channel: "#jantar" });
  const announced = await until(a.c, (m) => m.type === "join" && m.channel === "#jantar");
  assert.equal(announced.nick, b.nick);
  const joined = await until(b.c, (m) => m.type === "joined" && m.channel === "#jantar");
  assert.deepEqual([...(joined.members as string[])].sort(), [a.nick, b.nick].sort());
  a.c.ws.close();
  b.c.ws.close();
});

test("invalid channel names are refused", limits, async () => {
  const a = await arrive();
  for (const channel of ["futebol", "#two words", "#" + "x".repeat(33)]) {
    send(a.c, { type: "join", channel });
    assert.match(String((await until(a.c, ofType("error"))).reason), /invalid channel/);
  }
  a.c.ws.close();
});

test("/topic is shown to the channel and kept for newcomers", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "topic", channel: "#mujimbo", topic: "Sunday dinner: who brings dessert?" });
  const t = await until(b.c, ofType("topic"));
  assert.deepEqual(t, {
    type: "topic",
    channel: "#mujimbo",
    topic: "Sunday dinner: who brings dessert?",
    nick: a.nick,
  });
  const c = await arrive();
  assert.equal(c.joined.topic, "Sunday dinner: who brings dessert?");
  a.c.ws.close();
  b.c.ws.close();
  c.c.ws.close();
});

test("/part leaves a channel", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "join", channel: "#leaving" });
  await until(a.c, (m) => m.type === "joined" && m.channel === "#leaving");
  send(a.c, { type: "part", channel: "#leaving" });
  const part = await until(a.c, ofType("part"));
  assert.deepEqual(part, { type: "part", channel: "#leaving", nick: a.nick });
  send(a.c, { type: "say", channel: "#leaving", text: "anyone?" });
  assert.match(String((await until(a.c, ofType("error"))).reason), /join #leaving first/);
  a.c.ws.close();
});

test("leaving the chat tells the others (quit)", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  a.c.ws.close();
  const quit = await until(b.c, (m) => m.type === "quit" && m.nick === a.nick);
  assert.equal(quit.nick, a.nick);
  b.c.ws.close();
});

test("a newcomer sees recent messages in the history", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "say", channel: "#mujimbo", text: "did you see this?" });
  await until(a.c, (m) => m.type === "message" && m.text === "did you see this?"); // saved by now
  const b = await arrive();
  const history = b.joined.history as Msg[];
  assert.equal(history.at(-1)?.text, "did you see this?");
  assert.equal(history.at(-1)?.nick, a.nick);
  a.c.ws.close();
  b.c.ws.close();
});

test("messages the server doesn't understand are ignored", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "shout", text: "hi" });
  a.c.ws.send("not json");
  send(a.c, { type: "say", channel: "#mujimbo", text: "   " });
  send(a.c, { type: "say", channel: "#mujimbo", text: "x".repeat(2001) });
  send(a.c, { type: "say", channel: "#mujimbo" }); // no text
  send(a.c, { type: "say", channel: "#mujimbo", text: "valid" });
  const m = await until(a.c, ofType("message")); // the first message broadcast must be the valid one
  assert.equal(m.text, "valid");
  a.c.ws.close();
});

test("an oversized frame closes only that client; the server keeps running", limits, async () => {
  const a = await arrive();
  a.c.ws.send("x".repeat(20 * 1024));
  assert.equal(await a.c.closed, 1009); // 1009 = message too big
  const b = await arrive();
  assert.match(b.nick, /^Guest-\d+$/);
  b.c.ws.close();
});

test("WebSocket upgrades on other paths are refused", limits, async () => {
  await assert.rejects(connect(wsUrl.replace("/ws", "/nope")));
});
