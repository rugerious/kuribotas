import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../src/app.ts";
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
type Client = { ws: WebSocket; next: (match: (m: Msg) => boolean) => Promise<Msg>; send: (m: Msg) => void; seen: () => Msg[] };

function as(cookie: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace("http", "ws")}/ws`, { headers: { cookie, origin } });
    const seen: Msg[] = [];
    const all: Msg[] = [];
    const waiting: { match: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as Msg;
      all.push(msg);
      const i = waiting.findIndex((w) => w.match(msg));
      if (i === -1) seen.push(msg);
      else waiting.splice(i, 1)[0]?.done(msg);
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        seen: () => all,
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

const joined = (channel: string) => (m: Msg) => m.type === "joined" && m.channel === channel;
const settle = () => new Promise((r) => setTimeout(r, 120));

test("a private room keeps its members when everyone's phone drops, and reopens for them", limits, async () => {
  const kotaCookie = signIn(app.store, "Kota_R");
  const kambaCookie = signIn(app.store, "Kamba_R");
  const kota = await as(kotaCookie);
  const kamba = await as(kambaCookie);
  await kota.next(joined("#mujimbo"));
  await kamba.next(joined("#mujimbo"));
  kota.send({ type: "join", channel: "#primos", private: true });
  await kota.next(joined("#primos"));
  kota.send({ type: "invite", channel: "#primos", nick: "Kamba_R" });
  await kamba.next((m) => m.type === "invited");
  kamba.send({ type: "join", channel: "#primos" });
  await kamba.next(joined("#primos"));
  kota.ws.close();
  kamba.ws.close();
  await settle();
  // Both "phones" come back: the room is still there and opens by itself, still private.
  const kota2 = await as(kotaCookie);
  const room = await kota2.next(joined("#primos"));
  assert.equal(room.private, true);
  const kamba2 = await as(kambaCookie);
  await kamba2.next(joined("#primos"));
  // Someone else can't get in, and doesn't see it in the list.
  const stranger = await as(signIn(app.store, "Curioso_R"));
  await stranger.next(joined("#mujimbo"));
  stranger.send({ type: "join", channel: "#primos" });
  assert.equal((await stranger.next((m) => m.type === "error")).code, "invite_only");
  stranger.send({ type: "rooms" });
  const list = (await stranger.next((m) => m.type === "rooms")).rooms as { name: string }[];
  assert.equal(list.some((r) => r.name === "#primos"), false);
  // Leaving with /bazar ends it for that person; the last one out takes the room along.
  kamba2.send({ type: "part", channel: "#primos" });
  await kamba2.next((m) => m.type === "part");
  kota2.send({ type: "part", channel: "#primos" });
  await kota2.next((m) => m.type === "part" && m.nick === "Kota_R");
  await settle();
  assert.equal(app.store.room("#primos"), undefined);
  for (const c of [kota2, kamba2, stranger]) c.ws.close();
});

test("public rooms you joined reopen when you come back; /bazar stops that", limits, async () => {
  const cookie = signIn(app.store, "Viajante_R");
  const a = await as(cookie);
  await a.next(joined("#mujimbo"));
  a.send({ type: "join", channel: "#futebol" });
  await a.next(joined("#futebol"));
  a.send({ type: "join", channel: "#receitas" });
  await a.next(joined("#receitas"));
  a.send({ type: "part", channel: "#receitas" });
  await a.next((m) => m.type === "part");
  a.ws.close();
  await settle();
  const b = await as(cookie);
  await b.next(joined("#futebol"));
  await settle();
  assert.equal(b.seen().some((m) => m.type === "joined" && m.channel === "#receitas"), false);
  b.ws.close();
});

test("an @ makes #angola a home room: everyone online is put in it, and newcomers start there", limits, async () => {
  const op = await as(signIn(app.store, "Chefe_R", "admin"));
  const kota = await as(signIn(app.store, "Kota_R2"));
  await op.next(joined("#mujimbo"));
  await kota.next(joined("#mujimbo"));
  op.send({ type: "join", channel: "#angola" });
  await op.next(joined("#angola"));
  kota.send({ type: "home", channel: "#angola", on: true });
  assert.equal((await kota.next((m) => m.type === "error")).code, "not_op");
  op.send({ type: "home", channel: "#angola", on: true });
  assert.deepEqual(await kota.next((m) => m.type === "home"), { type: "home", channel: "#angola", on: true, by: "Chefe_R" });
  await kota.next(joined("#angola"));
  const newcomer = await as(signIn(app.store, "Novato_R"));
  await newcomer.next(joined("#mujimbo"));
  await newcomer.next(joined("#angola"));
  op.send({ type: "home", channel: "#mujimbo", on: false });
  assert.equal((await op.next((m) => m.type === "error")).code, "cant_delete_home");
  op.send({ type: "rooms" });
  const rooms = (await op.next((m) => m.type === "rooms")).rooms as { name: string; home: boolean; people: number }[];
  const angola = rooms.find((r) => r.name === "#angola");
  assert.equal(angola?.home, true);
  assert.equal(angola?.people, 3);
  for (const c of [op, kota, newcomer]) c.ws.close();
});

test("an @ deletes a room: empty at once, with messages only when confirmed; never a home room", limits, async () => {
  const op = await as(signIn(app.store, "Chefe_R3", "admin"));
  const kota = await as(signIn(app.store, "Kota_R3"));
  await op.next(joined("#mujimbo"));
  await kota.next(joined("#mujimbo"));
  kota.send({ type: "join", channel: "#teste" });
  await kota.next(joined("#teste"));
  kota.send({ type: "say", channel: "#teste", text: "oi" });
  await kota.next((m) => m.type === "message");
  op.send({ type: "delete_room", channel: "#teste", confirm: false });
  const err = await op.next((m) => m.type === "error");
  assert.deepEqual([err.code, err.detail], ["confirm_delete", "1"]);
  op.send({ type: "delete_room", channel: "#teste", confirm: true });
  await kota.next((m) => m.type === "part" && m.channel === "#teste");
  assert.deepEqual(await kota.next((m) => m.type === "room_deleted"), { type: "room_deleted", channel: "#teste", by: "Chefe_R3" });
  assert.equal(app.store.room("#teste"), undefined);
  op.send({ type: "delete_room", channel: "#mujimbo", confirm: true });
  assert.equal((await op.next((m) => m.type === "error")).code, "cant_delete_home");
  op.send({ type: "delete_room", channel: "#nada", confirm: true });
  assert.equal((await op.next((m) => m.type === "error")).code, "no_such_channel");
  for (const c of [op, kota]) c.ws.close();
});
