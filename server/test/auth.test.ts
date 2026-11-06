import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { deviceName, inviteLink, makeInvite } from "../src/auth.ts";
import { signIn } from "./people.ts";

const app = createApp({ dbPath: ":memory:" });
const limits = { timeout: 5000 };
let origin = "";

before(async () => {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => app.close());

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; next: (match: (m: Msg) => boolean) => Promise<Msg>; send: (m: Msg) => void; closed: Promise<number> };

// Opens the chat with these headers; rejects with the HTTP status if the server refuses the upgrade.
function open(headers: Record<string, string>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace("http", "ws")}/ws`, { headers });
    const seen: Msg[] = [];
    const waiting: { match: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as Msg;
      const i = waiting.findIndex((w) => w.match(msg));
      if (i === -1) seen.push(msg);
      else waiting.splice(i, 1)[0]?.done(msg);
    });
    ws.on("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
    ws.on("error", (err) => reject(err));
    ws.on("open", () =>
      resolve({
        ws,
        closed,
        send: (m) => ws.send(JSON.stringify(m)),
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

const as = (cookie: string) => open({ cookie, origin });
const settle = () => new Promise((r) => setTimeout(r, 80));

const post = (path: string, body: unknown, headers: Record<string, string> = { origin }) =>
  fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("without a session: /api/me says so and the chat is closed", limits, async () => {
  const me = await fetch(`${origin}/api/me`);
  assert.equal(me.status, 401);
  assert.deepEqual(await me.json(), { error: "no_session" });
  await assert.rejects(open({ origin }), /401/);
  await assert.rejects(open({ origin, cookie: "kb_session=made-up" }), /401/);
});

test("another site's page can't open the chat, even with a real cookie", limits, async () => {
  const cookie = signIn(app.store, "Alvo");
  await assert.rejects(open({ cookie, origin: "https://evil.example" }), /403/);
  await assert.rejects(open({ cookie }), /403/); // no Origin at all
  const ok = await as(cookie);
  ok.ws.close();
});

test("an invite link: greet, pick a nick, get a session cookie; the link then stops working", limits, async () => {
  const { token } = makeInvite(app.store, "person", { personId: null, role: "member", createdBy: null });
  assert.equal(inviteLink("https://kuribotas.example/", "person", token), `https://kuribotas.example/#convite=${token}`);
  assert.deepEqual(await (await fetch(`${origin}/api/invite/${token}`)).json(), { kind: "person" });

  assert.equal((await post("/api/redeem", { token, nick: "Primo" }, {})).status, 403); // not from our page
  const bad = await post("/api/redeem", { token, nick: "com espaço" });
  assert.deepEqual([bad.status, await bad.json()], [400, { error: "invalid_nick" }]);
  const taken = await post("/api/redeem", { token, nick: "alvo" }); // Alvo has an account (any case)
  assert.deepEqual([taken.status, await taken.json()], [400, { error: "nick_taken" }]);

  const res = await post("/api/redeem", { token, nick: "Primo" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { nick: "Primo", role: "member" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^kb_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  const cookie = setCookie.split(";")[0] ?? "";

  const me = await fetch(`${origin}/api/me`, { headers: { cookie } });
  assert.deepEqual(await me.json(), { nick: "Primo", role: "member" });
  const c = await as(cookie);
  assert.deepEqual((await c.next((m) => m.type === "welcome")).role, "member");
  c.ws.close();

  const again = await fetch(`${origin}/api/invite/${token}`);
  assert.deepEqual([again.status, await again.json()], [410, { error: "invite_used" }]);
  assert.equal((await post("/api/redeem", { token, nick: "Outro" })).status, 410);
  assert.equal((await fetch(`${origin}/api/invite/${"x".repeat(43)}`)).status, 404);
});

test("a device link says whose it is and signs that person in on another device", limits, async () => {
  signIn(app.store, "Mais_Velho", "admin");
  const id = app.store.personByNick("Mais_Velho")?.id ?? 0;
  const { token } = makeInvite(app.store, "device", { personId: id, role: "member", createdBy: id });
  assert.match(token, /^[2-9A-HJ-NP-Z]{8}$/); // short enough to type on a phone
  const typed = `${token.slice(0, 4).toLowerCase()}-${token.slice(4)}`; // as someone might type it
  assert.deepEqual(await (await fetch(`${origin}/api/invite/${typed}`)).json(), { kind: "device", nick: "Mais_Velho" });
  const res = await post("/api/redeem", { token: typed }, { origin, "user-agent": "Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile" });
  assert.deepEqual(await res.json(), { nick: "Mais_Velho", role: "admin" });
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
});

test("one person on two devices is one person to everyone else", limits, async () => {
  const watcher = await as(signIn(app.store, "Vizinha"));
  await watcher.next((m) => m.type === "joined");
  const phone = await as(signIn(app.store, "Dois_Aparelhos"));
  await watcher.next((m) => m.type === "join" && m.nick === "Dois_Aparelhos");
  const laptop = await as(signIn(app.store, "Dois_Aparelhos"));
  const joined = await laptop.next((m) => m.type === "joined");
  const nicks = (joined.members as Msg[]).map((m) => m.nick);
  assert.equal(nicks.filter((n) => n === "Dois_Aparelhos").length, 1); // listed once

  // A DM and a status change reach both devices.
  watcher.send({ type: "msg", to: "Dois_Aparelhos", kind: "say", text: "oi" });
  for (const d of [phone, laptop]) assert.equal((await d.next((m) => m.type === "dm")).text, "oi");
  phone.send({ type: "status", status: "busy", note: "" });
  assert.equal((await laptop.next((m) => m.type === "presence")).status, "busy");

  // Closing one device: nobody sees a quit. Closing the last one: a quit.
  phone.ws.close();
  await settle();
  watcher.send({ type: "say", channel: "#mujimbo", text: "ainda aí?" });
  const first = await watcher.next((m) => m.type === "quit" || m.type === "message");
  assert.equal(first.type, "message");
  laptop.ws.close();
  assert.equal((await watcher.next((m) => m.type === "quit")).nick, "Dois_Aparelhos");
  watcher.ws.close();
});

test("a nick belongs to its person even while they're away", limits, async () => {
  signIn(app.store, "Ausente"); // has an account, not connected
  const c = await as(signIn(app.store, "Curiosa"));
  await c.next((m) => m.type === "joined");
  c.send({ type: "nick", nick: "AUSENTE" });
  const err = await c.next((m) => m.type === "error");
  assert.deepEqual([err.code, err.detail], ["nick_taken", "AUSENTE"]);
  c.send({ type: "nick", nick: "Curiosa_2" });
  assert.equal((await c.next((m) => m.type === "nick")).nick, "Curiosa_2");
  assert.equal(app.store.personByNick("curiosa_2")?.nick, "Curiosa_2"); // saved
  c.ws.close();
});

test("the tornado limit is the person's: a reload doesn't reset it", limits, async () => {
  const cookie = signIn(app.store, "Tornadeiro");
  const target = await as(signIn(app.store, "Alvo_Tornado"));
  await target.next((m) => m.type === "joined");
  const a = await as(cookie);
  await a.next((m) => m.type === "joined");
  a.send({ type: "nudge", channel: "#mujimbo", nick: "Alvo_Tornado", tornado: true });
  await a.next((m) => m.type === "nudge");
  a.ws.close();
  await settle();
  const b = await as(cookie);
  await b.next((m) => m.type === "joined");
  b.send({ type: "nudge", channel: "#mujimbo", nick: "Alvo_Tornado", tornado: true });
  assert.equal((await b.next((m) => m.type === "error")).code, "tornado_too_soon");
  b.ws.close();
  target.ws.close();
});

test("signing out ends that device's session and closes its chat; the other device stays", limits, async () => {
  const phoneCookie = signIn(app.store, "Saidor");
  const laptopCookie = signIn(app.store, "Saidor");
  const phone = await as(phoneCookie);
  const laptop = await as(laptopCookie);
  await phone.next((m) => m.type === "joined");
  await laptop.next((m) => m.type === "joined");
  assert.equal((await post("/api/logout", {}, { origin, cookie: phoneCookie })).headers.get("set-cookie")?.includes("Max-Age=0"), true);
  assert.equal(await phone.closed, 4401);
  assert.equal((await fetch(`${origin}/api/me`, { headers: { cookie: phoneCookie } })).status, 401);
  assert.equal((await fetch(`${origin}/api/me`, { headers: { cookie: laptopCookie } })).status, 200);
  laptop.ws.close();
});

test("too many invite attempts from one address are refused for a while", limits, async () => {
  const other = createApp({ dbPath: ":memory:" });
  await new Promise<void>((resolve) => other.server.listen(0, "127.0.0.1", resolve));
  const at = `http://127.0.0.1:${(other.server.address() as AddressInfo).port}`;
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) {
    const res = await fetch(`${at}/api/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: at },
      body: JSON.stringify({ token: `guess-${i}`, nick: "X" }),
    });
    statuses.push(res.status);
  }
  assert.equal(statuses.slice(0, 20).every((s) => s === 404), true);
  assert.equal(statuses[20], 429);
  await other.close();
});

test("only an @ makes invite links; anyone makes a code for their own other device", limits, async () => {
  const op = await as(signIn(app.store, "Chefe", "admin"));
  const member = await as(signIn(app.store, "Membro"));
  await op.next((m) => m.type === "joined");
  await member.next((m) => m.type === "joined");
  member.send({ type: "make_invite" });
  assert.equal((await member.next((m) => m.type === "error")).code, "not_op");
  op.send({ type: "make_invite" });
  const link = await op.next((m) => m.type === "link");
  assert.equal(link.kind, "person");
  assert.deepEqual(await (await fetch(`${origin}/api/invite/${String(link.token)}`)).json(), { kind: "person" });
  member.send({ type: "make_device_link" });
  const code = await member.next((m) => m.type === "link");
  assert.equal(code.kind, "device");
  assert.deepEqual(await (await fetch(`${origin}/api/invite/${String(code.token)}`)).json(), { kind: "device", nick: "Membro" });
  op.ws.close();
  member.ws.close();
});

test("your devices: listed, this one marked, another one signed out from here", limits, async () => {
  const phoneCookie = signIn(app.store, "Viajante");
  const laptop = await as(signIn(app.store, "Viajante"));
  const phone = await as(phoneCookie);
  await phone.next((m) => m.type === "joined");
  await laptop.next((m) => m.type === "joined");
  laptop.send({ type: "devices" });
  const list = (await laptop.next((m) => m.type === "devices")).devices as { id: number; current: boolean }[];
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((d) => d.current), [false, true]); // oldest first: the phone, then this laptop
  laptop.send({ type: "forget_device", id: list[0]?.id ?? 0 }); // the "lost" phone
  assert.equal(await phone.closed, 4401);
  assert.equal(((await laptop.next((m) => m.type === "devices")).devices as unknown[]).length, 1);
  assert.equal((await fetch(`${origin}/api/me`, { headers: { cookie: phoneCookie } })).status, 401);
  laptop.send({ type: "forget_device", id: 99999 });
  assert.deepEqual((await laptop.next((m) => m.type === "error")).code, "no_such_device");
  laptop.ws.close();
});

test("an @ gives @ (shown in the people list), can't drop their own, and removes a member", limits, async () => {
  const op = await as(signIn(app.store, "Mais_Velho_2", "admin"));
  const kota = await as(signIn(app.store, "Kota_2"));
  const kamba = await as(signIn(app.store, "Kamba_2"));
  for (const c of [op, kota, kamba]) await c.next((m) => m.type === "joined");
  op.send({ type: "role", nick: "kota_2", role: "admin" });
  assert.deepEqual(await kamba.next((m) => m.type === "role"), { type: "role", nick: "Kota_2", role: "admin", by: "Mais_Velho_2" });
  kota.send({ type: "make_invite" }); // now an @, straight away
  assert.equal((await kota.next((m) => m.type === "link")).kind, "person");
  op.send({ type: "role", nick: "Mais_Velho_2", role: "member" });
  assert.equal((await op.next((m) => m.type === "error")).code, "cant_deop_self");
  op.send({ type: "remove", nick: "Kota_2" });
  assert.deepEqual([(await op.next((m) => m.type === "error")).code], ["cant_remove_op"]);
  kamba.send({ type: "remove", nick: "Kota_2" });
  assert.equal((await kamba.next((m) => m.type === "error")).code, "not_op");
  op.send({ type: "remove", nick: "Kamba_2" });
  assert.deepEqual(await kota.next((m) => m.type === "removed"), { type: "removed", nick: "Kamba_2", by: "Mais_Velho_2" });
  assert.equal(await kamba.closed, 4401);
  assert.equal(app.store.personByNick("Kamba_2"), undefined);
  const late = await as(signIn(app.store, "Recém_Chegado"));
  const joined = await late.next((m) => m.type === "joined");
  const roles = Object.fromEntries((joined.members as { nick: string; role: string }[]).map((m) => [m.nick, m.role]));
  assert.equal(roles.Kota_2, "admin");
  for (const c of [op, kota, late]) c.ws.close();
});

test("more than 20 messages in 10 s is a flood: refused, and the sender is told how long to wait", limits, async () => {
  const c = await as(signIn(app.store, "Teclado_Preso"));
  await c.next((m) => m.type === "joined");
  for (let i = 0; i < 21; i++) c.send({ type: "say", channel: "#mujimbo", text: `spam ${i}` });
  const err = await c.next((m) => m.type === "error");
  assert.equal(err.code, "too_fast");
  assert.ok(Number(err.detail) >= 1 && Number(err.detail) <= 10);
  c.ws.close();
});

test("on start, channel messages older than 90 days are deleted", limits, async () => {
  const dir = mkdtempSync(join(tmpdir(), "kuribotas-history-"));
  try {
    const dbPath = join(dir, "kuribotas.db");
    const first = createApp({ dbPath });
    const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
    first.store.addMessage({ channel: "#mujimbo", nick: "Kota", kind: "say", text: "from last summer", at: daysAgo(91) });
    first.store.addMessage({ channel: "#mujimbo", nick: "Kota", kind: "say", text: "from last month", at: daysAgo(30) });
    await first.close();
    const again = createApp({ dbPath });
    assert.deepEqual(again.store.recentMessages("#mujimbo", 10).map((m) => m.text), ["from last month"]);
    await again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
