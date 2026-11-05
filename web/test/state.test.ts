import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerMessage } from "../../shared/protocol.ts";
import { colourOf, initialState, reduce, ROOM_COLOURS, type Line, type State } from "../src/state.ts";

const at = "2026-12-24T20:00:00.000Z";

function apply(state: State, ...msgs: ServerMessage[]): State {
  return msgs.reduce((s, msg) => reduce(s, { type: "server", msg, at }), state);
}

const texts = (lines: Line[]): string[] => lines.map((l) => (l.kind === "event" ? `*** ${l.text}` : `<${l.msg.nick}> ${l.msg.text}`));

const msg = (channel: string, nick: string, text: string, id = 1): ServerMessage => ({
  type: "message",
  id,
  channel,
  nick,
  kind: "say",
  text,
  at,
});

// Arrived as Guest-1 in #mujimbo (topic set, one old message), with Pai already there.
function arrived(): State {
  return apply(
    initialState,
    { type: "welcome", nick: "Guest-1", channels: [{ name: "#mujimbo", topic: "dinner" }] },
    {
      type: "joined",
      channel: "#mujimbo",
      topic: "dinner",
      members: ["Pai", "Guest-1"],
      history: [{ id: 1, channel: "#mujimbo", nick: "Pai", kind: "say", text: "olá", at }],
    },
  );
}

test("arriving shows the history, a welcome, the join and the topic", () => {
  const s = arrived();
  assert.equal(s.nick, "Guest-1");
  assert.equal(s.active, "#mujimbo");
  assert.deepEqual(texts(s.rooms[0]?.lines ?? []), [
    "<Pai> olá",
    "*** Welcome, Guest-1! Channels: #mujimbo. Type /help for commands.",
    "*** You joined #mujimbo",
    "*** Topic: dinner",
  ]);
});

test("a message in another tab counts as unread until that tab is opened", () => {
  let s = apply(arrived(), { type: "joined", channel: "#futebol", topic: "", members: ["Guest-1"], history: [] });
  assert.equal(s.active, "#futebol"); // joining opens the new tab
  s = apply(s, msg("#mujimbo", "Pai", "jantar!", 2));
  assert.equal(s.rooms.find((r) => r.name === "#mujimbo")?.unread, 1);
  s = reduce(s, { type: "focus", channel: "#mujimbo" });
  assert.equal(s.rooms.find((r) => r.name === "#mujimbo")?.unread, 0);
});

test("a message in the open tab is never unread", () => {
  const s = apply(arrived(), msg("#mujimbo", "Pai", "hello", 2));
  assert.equal(s.rooms[0]?.unread, 0);
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "<Pai> hello");
});

test("changing my own nick updates me and the people list", () => {
  const s = apply(arrived(), { type: "nick", old: "Guest-1", nick: "Rita" });
  assert.equal(s.nick, "Rita");
  assert.deepEqual(s.rooms[0]?.members, ["Pai", "Rita"]);
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** Guest-1 is now known as Rita");
});

test("join, part and quit keep the people list right", () => {
  let s = apply(arrived(), { type: "join", channel: "#mujimbo", nick: "Mãe" });
  assert.deepEqual(s.rooms[0]?.members, ["Pai", "Guest-1", "Mãe"]);
  s = apply(s, { type: "part", channel: "#mujimbo", nick: "Pai" });
  assert.deepEqual(s.rooms[0]?.members, ["Guest-1", "Mãe"]);
  s = apply(s, { type: "quit", nick: "Mãe" });
  assert.deepEqual(s.rooms[0]?.members, ["Guest-1"]);
  assert.deepEqual(texts(s.rooms[0]?.lines ?? []).slice(-3), [
    "*** Mãe joined #mujimbo",
    "*** Pai left #mujimbo",
    "*** Mãe quit",
  ]);
});

test("leaving a channel myself closes its tab and opens another", () => {
  let s = apply(arrived(), { type: "joined", channel: "#futebol", topic: "", members: ["Guest-1"], history: [] });
  s = apply(s, { type: "part", channel: "#futebol", nick: "Guest-1" });
  assert.deepEqual(
    s.rooms.map((r) => r.name),
    ["#mujimbo"],
  );
  assert.equal(s.active, "#mujimbo");
});

test("a topic change is shown and remembered", () => {
  const s = apply(arrived(), { type: "topic", channel: "#mujimbo", topic: "who brings dessert?", nick: "Pai" });
  assert.equal(s.rooms[0]?.topic, "who brings dessert?");
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** Pai changed the topic to: who brings dessert?");
});

test("errors and a lost connection appear in the open tab, marked as errors", () => {
  let s = apply(arrived(), { type: "error", reason: "nick already in use: Pai" });
  s = reduce(s, { type: "connection", status: "closed", at });
  const last = s.rooms[0]?.lines.slice(-2) ?? [];
  assert.deepEqual(
    last.map((l) => (l.kind === "event" ? [l.tone, l.text] : [])),
    [
      ["error", "nick already in use: Pai"],
      ["error", "Disconnected. Reload the page to reconnect."],
    ],
  );
  assert.equal(s.connection, "closed");
});

test("every line gets a unique key", () => {
  const s = apply(arrived(), msg("#mujimbo", "Pai", "a", 2), msg("#mujimbo", "Pai", "b", 3));
  const keys = s.rooms[0]?.lines.map((l) => l.key) ?? [];
  assert.equal(new Set(keys).size, keys.length);
});

test("#mujimbo starts amber; other channels get a steady colour", () => {
  const s = arrived();
  assert.equal(colourOf(s, "#mujimbo"), "amber");
  assert.equal(colourOf(s, "#futebol"), colourOf(s, "#futebol")); // the same every time
  assert.ok(ROOM_COLOURS.includes(colourOf(s, "#futebol")));
});

test("a channel's colour can be picked or cycled, and the change is shown", () => {
  let s = reduce(arrived(), { type: "colour", channel: "#mujimbo", colour: "blue", at });
  assert.equal(colourOf(s, "#mujimbo"), "blue");
  s = reduce(s, { type: "colour", channel: "#mujimbo", at }); // no colour = the next one
  assert.equal(colourOf(s, "#mujimbo"), "green");
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** #mujimbo is now green (on this device)");
});
