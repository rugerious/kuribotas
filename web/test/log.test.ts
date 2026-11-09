import assert from "node:assert/strict";
import { test } from "node:test";
import { logFileName, logLine, logText, newDay } from "../src/log.ts";
import { initialState, reduce } from "../src/state.ts";
import { parseInput } from "../src/commands.ts";
import type { ChatMessage } from "../../shared/protocol.ts";

process.env.TZ = "UTC";

const m = (id: number, nick: string, text: string, kind: "say" | "me" = "say"): ChatMessage => ({
  id,
  channel: "#mujimbo",
  nick,
  kind,
  text,
  at: `2026-11-09T18:${String(40 + id).padStart(2, "0")}:00Z`,
});

test("a log reads like mIRC's: date and time, <nick> or * nick", () => {
  assert.equal(logLine(m(1, "Kota", "olá")), "[2026-11-09 18:41] <Kota> olá");
  assert.equal(logLine(m(2, "Kamba", "dança", "me")), "[2026-11-09 18:42] * Kamba dança");
  assert.equal(logText("Kuribotas · #mujimbo", [m(1, "Kota", "olá")]), "Kuribotas · #mujimbo\r\n\r\n[2026-11-09 18:41] <Kota> olá\r\n");
  assert.equal(logFileName("#mujimbo", new Date("2026-11-09T21:00:00Z")), "kuribotas-mujimbo-2026-11-09.txt");
  assert.equal(logFileName("#festa da tia", new Date("2026-11-09T21:00:00Z")), "kuribotas-festa-da-tia-2026-11-09.txt");
});

test("/log asks for the open room's log; not in a private chat", () => {
  assert.deepEqual(parseInput("/log", "#mujimbo", "pt"), { kind: "send", msg: { type: "log", channel: "#mujimbo" } });
  assert.equal(parseInput("/log", "Kota", "pt").kind, "error");
});

test("an older page goes before what is on screen, once each, and says whether more is saved", () => {
  const at = "2026-11-09T19:00:00.000Z";
  let s = reduce(initialState, { type: "server", msg: { type: "welcome", nick: "Kota", role: "member", channels: [] }, at });
  const history = Array.from({ length: 50 }, (_, i) => m(i + 51, "Kamba", `linha ${i + 51}`));
  s = reduce(s, { type: "server", msg: { type: "joined", channel: "#mujimbo", topic: "", members: [], history, private: false }, at });
  assert.equal(s.rooms[0]!.more, true);
  const page = [m(49, "Kota", "linha 49"), m(50, "Kota", "linha 50"), m(51, "Kamba", "repetida")];
  s = reduce(s, { type: "server", msg: { type: "older", channel: "#mujimbo", messages: page, more: false }, at });
  const ids = s.rooms[0]!.lines.flatMap((l) => (l.kind === "message" ? [l.msg.id] : []));
  assert.deepEqual(ids.slice(0, 3), [49, 50, 51]);
  assert.equal(ids.length, 52);
  assert.equal(s.rooms[0]!.more, false);
});

test("a day line goes where the date changes, and above the first message unless it is today", () => {
  const now = new Date("2026-11-09T21:00:00Z");
  assert.equal(newDay(undefined, "2026-11-09T08:00:00Z", now), null);
  assert.equal(newDay(undefined, "2026-11-01T08:00:00Z", now), "2026-11-01");
  assert.equal(newDay("2026-11-01T23:59:00Z", "2026-11-02T00:01:00Z", now), "2026-11-02");
  assert.equal(newDay("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", now), null);
});
