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

const pick = (err: Msg): unknown[] => [err.code, err.detail];

const nicksOf = (joined: Msg): string[] => (joined.members as Msg[]).map((m) => String(m.nick));

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
  assert.match(String(welcome.nick), /^Kamba-\d+$/);
  assert.ok((welcome.channels as Msg[]).some((ch) => ch.name === "#mujimbo"));
  const joined = await until(c, ofType("joined"));
  assert.equal(joined.channel, "#mujimbo");
  assert.ok(nicksOf(joined).includes(String(welcome.nick)));
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
  assert.deepEqual(joined.members, [{ nick: a.nick, status: "online", note: "" }]);

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
  assert.deepEqual(nicksOf(joined).sort(), [a.nick, b.nick].sort());
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
  assert.match(b.nick, /^Kamba-\d+$/);
  b.c.ws.close();
});

test("WebSocket upgrades on other paths are refused", limits, async () => {
  await assert.rejects(connect(wsUrl.replace("/ws", "/nope")));
});

test("errors carry a code and a detail for the client to translate", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "say", channel: "#nowhere", text: "hi" });
  const err = await until(a.c, ofType("error"));
  assert.equal(err.code, "join_first");
  assert.equal(err.detail, "#nowhere");
  a.c.ws.close();
});

test("a status and its note reach everyone who shares a channel, and newcomers see them", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "status", status: "busy", note: "a fingir que trabalho" });
  const seen = await until(b.c, (m) => m.type === "presence" && m.nick === a.nick);
  assert.deepEqual(seen, { type: "presence", nick: a.nick, status: "busy", note: "a fingir que trabalho" });
  const mine = await until(a.c, (m) => m.type === "presence" && m.nick === a.nick);
  assert.equal(mine.status, "busy");
  const c = await arrive();
  const entry = (c.joined.members as Msg[]).find((m) => m.nick === a.nick);
  assert.deepEqual(entry, { nick: a.nick, status: "busy", note: "a fingir que trabalho" });
  a.c.ws.close();
  b.c.ws.close();
  c.c.ws.close();
});

test("a note longer than 80 characters is refused; unknown statuses are ignored", limits, async () => {
  const a = await arrive();
  send(a.c, { type: "status", status: "away", note: "x".repeat(81) });
  assert.equal((await until(a.c, ofType("error"))).code, "note_too_long");
  send(a.c, { type: "status", status: "dancing", note: "" });
  send(a.c, { type: "status", status: "away", note: "já vorto" });
  const p = await until(a.c, ofType("presence")); // the first presence must be the valid one
  assert.deepEqual([p.status, p.note], ["away", "já vorto"]);
  a.c.ws.close();
});

test("going invisible looks like leaving; coming back looks like arriving", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "status", status: "invisible", note: "" });
  await until(b.c, (m) => m.type === "quit" && m.nick === a.nick);
  // A newcomer doesn't see the invisible person in the list...
  const c = await arrive();
  assert.ok(!nicksOf(c.joined).includes(a.nick));
  // ...but the invisible person sees themselves, and can still read and speak.
  send(a.c, { type: "join", channel: "#zongola" });
  const own = await until(a.c, (m) => m.type === "joined" && m.channel === "#zongola");
  assert.deepEqual(nicksOf(own), [a.nick]);
  send(b.c, { type: "say", channel: "#mujimbo", text: "is anyone there?" });
  await until(a.c, (m) => m.type === "message" && m.text === "is anyone there?");
  // Back to online: the others see a join, then the presence.
  send(a.c, { type: "status", status: "online", note: "na bardea" });
  const back = await until(b.c, (m) => m.type === "join" && m.nick === a.nick);
  assert.equal(back.channel, "#mujimbo");
  const p = await until(b.c, (m) => m.type === "presence" && m.nick === a.nick);
  assert.deepEqual([p.status, p.note], ["online", "na bardea"]);
  a.c.ws.close();
  b.c.ws.close();
  c.c.ws.close();
});

test("leaving while invisible tells nobody", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "status", status: "invisible", note: "" });
  await until(b.c, (m) => m.type === "quit" && m.nick === a.nick);
  a.c.ws.close();
  await a.c.closed;
  // b's next message must be this one, not a second quit for a.
  send(b.c, { type: "say", channel: "#mujimbo", text: "after" });
  const next = await until(b.c, (m) => m.type !== "join" && !(m.type === "quit" && m.nick !== a.nick));
  assert.deepEqual([next.type, next.text], ["message", "after"]);
  b.c.ws.close();
});

// For "nothing else arrived" checks: skips other tests' joins and quits, returns the next real message.
const nextReal = (c: Client): Promise<Msg> => until(c, (m) => m.type !== "join" && m.type !== "quit");

test("typing reaches the others in that channel only, never the typer", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  const c = await arrive(); // only in #mujimbo
  for (const x of [a, b]) {
    send(x.c, { type: "join", channel: "#bula" });
    await until(x.c, (m) => m.type === "joined" && m.channel === "#bula");
  }
  send(a.c, { type: "typing", channel: "#bula", typing: true });
  const seen = await until(b.c, ofType("typing"));
  assert.deepEqual(seen, { type: "typing", channel: "#bula", nick: a.nick, typing: true });
  // a and c get nothing: the next real message each sees is the marker.
  send(b.c, { type: "say", channel: "#mujimbo", text: "marker-1" });
  assert.deepEqual([(await nextReal(a.c)).text, (await nextReal(c.c)).text], ["marker-1", "marker-1"]);
  a.c.ws.close();
  b.c.ws.close();
  c.c.ws.close();
});

test("typing is passed on at most every 2 seconds; a stop always follows a start", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "typing", channel: "#mujimbo", typing: true });
  send(a.c, { type: "typing", channel: "#mujimbo", typing: true }); // too soon: dropped
  send(a.c, { type: "typing", channel: "#mujimbo", typing: false });
  send(a.c, { type: "typing", channel: "#mujimbo", typing: false }); // nothing left to stop: dropped
  send(a.c, { type: "say", channel: "#mujimbo", text: "marker-2" });
  const got: unknown[] = [];
  for (;;) {
    const m = await nextReal(b.c);
    if (m.type === "message") break;
    if (m.nick === a.nick) got.push(m.typing);
  }
  assert.deepEqual(got, [true, false]);
  // After a message, the next keystroke is passed on straight away.
  send(a.c, { type: "typing", channel: "#mujimbo", typing: true });
  assert.equal((await until(b.c, (m) => m.type === "typing" && m.nick === a.nick)).typing, true);
  a.c.ws.close();
  b.c.ws.close();
});

test("typing is dropped while invisible, outside your channels, or malformed", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "typing", channel: "#nowhere", typing: true }); // not in it: no error either
  send(a.c, { type: "typing", channel: "#mujimbo", typing: "yes" });
  send(a.c, { type: "status", status: "invisible", note: "" });
  await until(b.c, (m) => m.type === "quit" && m.nick === a.nick);
  send(a.c, { type: "typing", channel: "#mujimbo", typing: true });
  send(a.c, { type: "say", channel: "#mujimbo", text: "marker-3" }); // invisible people can still speak
  assert.equal((await nextReal(b.c)).text, "marker-3");
  assert.equal((await until(a.c, (m) => m.type !== "presence" && m.type !== "join" && m.type !== "quit")).text, "marker-3");
  a.c.ws.close();
  b.c.ws.close();
});

test("a nudge is seen by the channel; only the target shakes (the client decides that)", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "nudge", channel: "#mujimbo", nick: b.nick.toLowerCase(), tornado: false });
  const seen = await until(b.c, ofType("nudge"));
  assert.deepEqual(seen, { type: "nudge", channel: "#mujimbo", from: a.nick, to: b.nick, tornado: false });
  assert.equal((await until(a.c, ofType("nudge"))).to, b.nick); // the sender sees it too
  a.c.ws.close();
  b.c.ws.close();
});

test("nudging nobody, an invisible person, or while invisible is refused", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  send(a.c, { type: "nudge", channel: "#mujimbo", nick: "Ninguém", tornado: false });
  assert.deepEqual(pick(await until(a.c, ofType("error"))), ["no_such_nick", "Ninguém"]);
  send(b.c, { type: "status", status: "invisible", note: "" });
  await until(a.c, (m) => m.type === "quit" && m.nick === b.nick);
  send(a.c, { type: "nudge", channel: "#mujimbo", nick: b.nick, tornado: false });
  assert.deepEqual(pick(await until(a.c, ofType("error"))), ["no_such_nick", b.nick]); // same as nobody
  send(b.c, { type: "nudge", channel: "#mujimbo", nick: a.nick, tornado: true });
  assert.equal((await until(b.c, ofType("error"))).code, "invisible_no_nudge");
  send(a.c, { type: "nudge", channel: "#elsewhere", nick: a.nick, tornado: false });
  assert.equal((await until(a.c, ofType("error"))).code, "join_first");
  a.c.ws.close();
  b.c.ws.close();
});

test("three quick nudges, then a pause; one tornado a minute, counted apart", limits, async () => {
  const a = await arrive();
  const b = await arrive();
  const nudge = (tornado: boolean) => send(a.c, { type: "nudge", channel: "#mujimbo", nick: b.nick, tornado });
  for (let i = 0; i < 4; i++) nudge(false);
  nudge(true);
  nudge(true);
  const got: string[] = [];
  while (got.length < 6) {
    const m = await until(a.c, (x) => x.type === "nudge" || x.type === "error");
    got.push(m.type === "error" ? String(m.code) : m.tornado === true ? "tornado" : "nudge");
  }
  assert.deepEqual(got, ["nudge", "nudge", "nudge", "nudge_too_soon", "tornado", "tornado_too_soon"]);
  a.c.ws.close();
  b.c.ws.close();
});
