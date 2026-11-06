import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../src/app.ts";
import type { PushSubscription } from "../src/push.ts";

// Notifications are recorded here instead of going to Google or Apple. `status` is what the fake
// push service answers (410 = the device is gone).
const sent: { endpoint: string; payload: { title: string; body: string }; urgency: string }[] = [];
let status = 201;
const app = createApp({
  dbPath: ":memory:",
  pushSend: (s: PushSubscription, payload: string, urgency: string) => {
    sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) as { title: string; body: string }, urgency });
    return Promise.resolve(status);
  },
});
const limits = { timeout: 5000 };
let base = "";

before(async () => {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => app.close());

type Msg = Record<string, unknown>;
type Client = { ws: WebSocket; next: (match: (m: Msg) => boolean) => Promise<Msg>; send: (m: Msg) => void };

function connect(nick: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws?nick=${encodeURIComponent(nick)}`);
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

const keys = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
const phone = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys });
const settle = () => new Promise((r) => setTimeout(r, 80));

// A device asks for notifications, then its person leaves (phone in the pocket).
async function subscribeAndLeave(nick: string, extra: (c: Client) => Promise<void> = async () => {}): Promise<void> {
  const c = await connect(nick);
  await c.next((m) => m.type === "joined");
  await extra(c);
  c.send({ type: "push", subscription: phone(nick), lang: "pt" });
  await settle();
  c.ws.close();
  await settle();
}

test("the server hands out its public notification key", async () => {
  const res = await fetch(`http://${base}/push/key`);
  const { publicKey } = (await res.json()) as { publicKey: string };
  assert.equal(Buffer.from(publicKey, "base64url").length, 65);
});

test("a subscription that isn't a real push service's is refused", limits, async () => {
  const c = await connect("Curioso");
  await c.next((m) => m.type === "joined");
  c.send({ type: "push", subscription: { endpoint: "https://evil.example/collect", keys }, lang: "pt" });
  assert.equal((await c.next((m) => m.type === "error")).code, "push_invalid");
  c.ws.close();
});

test("a mention of someone away reaches their phone, with the text; others' messages don't", limits, async () => {
  await subscribeAndLeave("Estraga_Lar");
  sent.length = 0;
  const kota = await connect("Kota");
  await kota.next((m) => m.type === "joined");
  kota.send({ type: "say", channel: "#mujimbo", text: "olá a todos" });
  kota.send({ type: "say", channel: "#mujimbo", text: "estraga_lar, vens jantar?" });
  await settle();
  assert.deepEqual(sent, [
    { endpoint: phone("Estraga_Lar").endpoint, payload: { title: "Kota · #mujimbo", body: "estraga_lar, vens jantar?", tag: "mention-#mujimbo" }, urgency: "normal" },
  ]);
  kota.send({ type: "say", channel: "#mujimbo", text: "Estraga_Lar!!" }); // within 20 s: no second buzz
  await settle();
  assert.equal(sent.length, 1);
  kota.ws.close();
});

test("someone who is here, or No biolo, gets no notification", limits, async () => {
  await subscribeAndLeave("Biolo", async (c) => {
    c.send({ type: "status", status: "busy", note: "" });
    await c.next((m) => m.type === "presence");
  });
  const here = await connect("Presente");
  await here.next((m) => m.type === "joined");
  here.send({ type: "push", subscription: phone("Presente"), lang: "pt" });
  sent.length = 0;
  const kota = await connect("Kota2");
  await kota.next((m) => m.type === "joined");
  kota.send({ type: "say", channel: "#mujimbo", text: "Biolo e Presente, venham!" });
  await settle();
  assert.deepEqual(sent, []);
  here.ws.close();
  kota.ws.close();
});

test("a nudge, a tornado or a chinela reaches the pocket of someone away; nobody at all is still nobody", limits, async () => {
  await subscribeAndLeave("Bolso");
  sent.length = 0;
  const kota = await connect("Kota3");
  await kota.next((m) => m.type === "joined");
  kota.send({ type: "nudge", channel: "#mujimbo", nick: "bolso", tornado: false });
  const line = await kota.next((m) => m.type === "nudge");
  assert.equal(line.to, "Bolso"); // the channel sees "Kota3 abanou Bolso!"
  kota.send({ type: "throw", channel: "#mujimbo", item: "chinela", nick: "Bolso" });
  await kota.next((m) => m.type === "throw");
  await settle();
  assert.deepEqual(
    sent.map((s) => [s.payload.title, s.payload.body, s.urgency]),
    [
      ["📳 Kota3 abanou-te!", "no #mujimbo", "high"],
      ["🩴 Chinelada de Kota3!", "no #mujimbo", "high"],
    ],
  );
  kota.send({ type: "nudge", channel: "#mujimbo", nick: "Ninguem", tornado: false });
  assert.equal((await kota.next((m) => m.type === "error")).code, "no_such_nick");
  kota.ws.close();
});

test("a device the push service says is gone is forgotten; switching off stops it too", limits, async () => {
  await subscribeAndLeave("Antigo");
  status = 410;
  const kota = await connect("Kota4");
  await kota.next((m) => m.type === "joined");
  kota.send({ type: "nudge", channel: "#mujimbo", nick: "Antigo", tornado: false });
  await kota.next((m) => m.type === "nudge");
  await settle();
  status = 201;
  kota.send({ type: "nudge", channel: "#mujimbo", nick: "Antigo", tornado: false });
  assert.equal((await kota.next((m) => m.type === "error")).code, "no_such_nick"); // forgotten
  await subscribeAndLeave("Desligado", async (c) => {
    c.send({ type: "push", subscription: phone("Desligado"), lang: "pt" });
    c.send({ type: "push", subscription: null, lang: "pt" });
    await settle();
  });
  // subscribeAndLeave subscribes again at the end, so switch off once more from a new connection
  const again = await connect("Desligado");
  await again.next((m) => m.type === "joined");
  again.send({ type: "push", subscription: phone("Desligado"), lang: "pt" });
  again.send({ type: "push", subscription: null, lang: "pt" });
  await settle();
  again.ws.close();
  await settle();
  kota.send({ type: "nudge", channel: "#mujimbo", nick: "Desligado", tornado: false });
  assert.equal((await kota.next((m) => m.type === "error")).code, "no_such_nick");
  kota.ws.close();
});
