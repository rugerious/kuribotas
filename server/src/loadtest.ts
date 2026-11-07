// Load test: fake people chatting in #mujimbo, to see how much the server can take.
//   node server/src/loadtest.ts 50x10x60 150x5x60
// Each phase is PEOPLExEVERYxSECONDS: that many people online, each saying something every EVERY seconds
// (with a little randomness), for SECONDS. People are created straight in the database (no invite links,
// so the redeem rate limit doesn't apply) and then connect like a browser: cookie + Origin.
// It runs against a THROWAWAY copy of the app with its own empty database (deploy/server/loadtest.sh does
// that on the server) and refuses a database that already has people, so it can't touch the family's.
// Uses DATA_DIR and PORT like the server. Prints, per phase: messages sent, deliveries, delivery time
// (from send to arriving at every other person: p50/p95/p99/max) and anything that went wrong.
import { join } from "node:path";
import WebSocket from "ws";
import { hashToken, makeInvite, newToken } from "./auth.ts";
import { openStore } from "./store.ts";

const dataDir = process.env.DATA_DIR ?? "data";
const port = Number(process.env.PORT ?? 3000);
const origin = `http://127.0.0.1:${port}`;
const CHANNEL = "#mujimbo";

type Phase = { people: number; every: number; seconds: number };
const phases: Phase[] = process.argv.slice(2).map((arg) => {
  const [people, every, seconds] = arg.split("x").map(Number);
  if (!people || !every || !seconds) throw new Error(`a phase looks like 50x10x60, not ${arg}`);
  return { people, every, seconds };
});
if (phases.length === 0) throw new Error("say at least one phase, e.g. 50x10x60");

// Everyone needed, created up front in the throwaway database.
const store = openStore(join(dataDir, "kuribotas.db"));
if (store.countPeople() > 0) {
  store.close();
  throw new Error("this database already has people: the load test only runs on an empty, throwaway one");
}
const most = Math.max(...phases.map((p) => p.people));
const sessions: string[] = [];
for (let i = 0; i < most; i++) {
  const { token } = makeInvite(store, "person", { personId: null, role: "member", createdBy: null });
  const session = newToken();
  const result = store.redeem(hashToken(token), `Carga_${i}`, hashToken(session), "load test", new Date().toISOString());
  if (!result.ok) throw new Error(`could not create person ${i}: ${result.error}`);
  sessions.push(session);
}
store.close();

type Person = { ws: WebSocket; id: number; timer?: NodeJS.Timeout };
const online: Person[] = [];
let delays: number[] = [];
let sent = 0;
let problems: string[] = [];

function connect(id: number): Promise<Person> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { cookie: `kb_session=${sessions[id]}`, origin },
    });
    const person: Person = { ws, id };
    const failed = setTimeout(() => reject(new Error(`person ${id} never got into ${CHANNEL}`)), 15_000);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as { type: string; channel?: string; text?: string; code?: string };
      if (msg.type === "joined" && msg.channel === CHANNEL) {
        clearTimeout(failed);
        resolve(person);
      } else if (msg.type === "message" && msg.text?.startsWith("load ")) {
        const [, from, at] = msg.text.split(" ");
        if (Number(from) !== id) delays.push(Date.now() - Number(at));
      } else if (msg.type === "error") {
        problems.push(`error ${msg.code ?? "?"}`);
      }
    });
    ws.on("error", (err) => problems.push(`socket: ${err.message}`));
    ws.on("close", (code) => {
      if (code !== 1000) problems.push(`closed ${code}`);
    });
  });
}

function talk(person: Person, every: number): void {
  const next = (): void => {
    // Spread out like real people: anywhere between half and one and a half times "every".
    person.timer = setTimeout(() => {
      if (person.ws.readyState === WebSocket.OPEN) {
        person.ws.send(JSON.stringify({ type: "say", channel: CHANNEL, text: `load ${person.id} ${Date.now()}` }));
        sent++;
      }
      next();
    }, every * 1000 * (0.5 + Math.random()));
  };
  next();
}

function percentile(sorted: number[], p: number): number {
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0);
}

for (const phase of phases) {
  const started = Date.now();
  while (online.length < phase.people) online.push(await connect(online.length));
  const connectMs = Date.now() - started;
  delays = [];
  sent = 0;
  problems = [];
  for (const person of online) talk(person, phase.every);
  await new Promise((r) => setTimeout(r, phase.seconds * 1000));
  for (const person of online) clearTimeout(person.timer);
  await new Promise((r) => setTimeout(r, 2000)); // let the last messages arrive
  const sorted = [...delays].sort((a, b) => a - b);
  console.log(
    `phase ${phase.people} people, one message each every ~${phase.every}s, ${phase.seconds}s: ` +
      `connect ${connectMs} ms · sent ${sent} (${(sent / phase.seconds).toFixed(1)}/s) · delivered ${delays.length} · ` +
      `delivery ms p50 ${percentile(sorted, 50)} p95 ${percentile(sorted, 95)} p99 ${percentile(sorted, 99)} max ${sorted.at(-1) ?? 0} · ` +
      `problems ${problems.length}${problems.length ? ` (${[...new Set(problems)].slice(0, 5).join(", ")})` : ""}`,
  );
}
for (const person of online) person.ws.close(1000);
