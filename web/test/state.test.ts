import { test } from "node:test";
import assert from "node:assert/strict";
import type { Member, ServerMessage } from "../../shared/protocol.ts";
import {
  colourOf,
  initialState,
  isDm,
  isGuestNick,
  reduce,
  ROOM_COLOURS,
  TYPING_SHOWN_MS,
  typingIn,
  type Line,
  type State,
} from "../src/state.ts";

const at = "2026-12-24T20:00:00.000Z";

const online = (nick: string): Member => ({ nick, status: "online", note: "" });
const nicks = (s: State, i = 0): string[] => (s.rooms[i]?.members ?? []).map((m) => m.nick);
const english: State = { ...initialState, lang: "en" };

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
    english,
    { type: "welcome", nick: "Guest-1", channels: [{ name: "#mujimbo", topic: "dinner" }] },
    {
      type: "joined", private: false,
      channel: "#mujimbo",
      topic: "dinner",
      members: [online("Pai"), online("Guest-1")],
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
  let s = apply(arrived(), { type: "joined", private: false, channel: "#futebol", topic: "", members: [online("Guest-1")], history: [] });
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
  assert.deepEqual(nicks(s), ["Pai", "Rita"]);
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** Guest-1 is now known as Rita");
});

test("join, part and quit keep the people list right", () => {
  let s = apply(arrived(), { type: "join", channel: "#mujimbo", nick: "Mãe" });
  assert.deepEqual(nicks(s), ["Pai", "Guest-1", "Mãe"]);
  s = apply(s, { type: "part", channel: "#mujimbo", nick: "Pai" });
  assert.deepEqual(nicks(s), ["Guest-1", "Mãe"]);
  s = apply(s, { type: "quit", nick: "Mãe" });
  assert.deepEqual(nicks(s), ["Guest-1"]);
  assert.deepEqual(texts(s.rooms[0]?.lines ?? []).slice(-3), [
    "*** Mãe joined #mujimbo",
    "*** Pai left #mujimbo",
    "*** Mãe quit",
  ]);
});

test("leaving a channel myself closes its tab and opens another", () => {
  let s = apply(arrived(), { type: "joined", private: false, channel: "#futebol", topic: "", members: [online("Guest-1")], history: [] });
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
  let s = reduce(arrived(), { type: "connection", status: "open", at });
  s = apply(s, { type: "error", code: "nick_taken", detail: "Pai", reason: "nick already in use: Pai" });
  s = reduce(s, { type: "connection", status: "closed", at });
  const last = s.rooms[0]?.lines.slice(-2) ?? [];
  assert.deepEqual(
    last.map((l) => (l.kind === "event" ? [l.tone, l.text] : [])),
    [
      ["error", "nick already in use: Pai"],
      ["error", "Connection lost. Reconnecting…"],
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

test("someone else's status quietly updates the people list", () => {
  const before = arrived();
  const s = apply(before, { type: "presence", nick: "Pai", status: "busy", note: "pretending to work" });
  assert.deepEqual(s.rooms[0]?.members.find((m) => m.nick === "Pai"), {
    nick: "Pai",
    status: "busy",
    note: "pretending to work",
  });
  assert.equal(s.rooms[0]?.lines.length, before.rooms[0]?.lines.length); // no line in the chat
});

test("my own status is remembered and said once, in Portuguese on a Portuguese screen", () => {
  const pt = apply(
    initialState,
    { type: "welcome", nick: "Kamba-1", channels: [{ name: "#mujimbo", topic: "" }] },
    { type: "joined", private: false, channel: "#mujimbo", topic: "", members: [online("Kamba-1")], history: [] },
    { type: "presence", nick: "Kamba-1", status: "busy", note: "a fingir que trabalho" },
  );
  assert.equal(pt.status, "busy");
  assert.equal(texts(pt.rooms[0]?.lines ?? []).at(-1), "*** Agora estás No biolo · a fingir que trabalho");
  assert.deepEqual(pt.rooms[0]?.members[0], { nick: "Kamba-1", status: "busy", note: "a fingir que trabalho" });
});

test("server errors are translated from their code", () => {
  const pt = apply(
    initialState,
    { type: "welcome", nick: "Kamba-1", channels: [] },
    { type: "joined", private: false, channel: "#mujimbo", topic: "", members: [online("Kamba-1")], history: [] },
    { type: "error", code: "join_first", detail: "#futebol", reason: "join #futebol first" },
  );
  assert.equal(texts(pt.rooms[0]?.lines ?? []).at(-1), "*** Entra primeiro no #futebol (/join #futebol)");
});

test("someone joining shows up as Na bardea with no note until their status arrives", () => {
  const s = apply(arrived(), { type: "join", channel: "#mujimbo", nick: "Kota" });
  assert.deepEqual(s.rooms[0]?.members.at(-1), { nick: "Kota", status: "online", note: "" });
});

test("switching language says so in the new language; earlier lines stay as they were", () => {
  const before = arrived(); // English
  const s = reduce(before, { type: "lang", lang: "pt", at });
  assert.equal(s.lang, "pt");
  const lines = texts(s.rooms[0]?.lines ?? []);
  assert.equal(lines.at(-1), "*** Agora falamos português de Angola (neste aparelho).");
  assert.deepEqual(lines.slice(0, -1), texts(before.rooms[0]?.lines ?? []));
});

const typing = (nick: string, on = true, channel = "#mujimbo"): ServerMessage => ({ type: "typing", channel, nick, typing: on });
const later = (ms: number): string => new Date(Date.parse(at) + ms).toISOString();

test("someone typing shows until it runs out; nothing is written in the chat", () => {
  const before = arrived();
  const s = apply(before, typing("Pai"));
  assert.deepEqual(typingIn(s.rooms[0]), ["Pai"]);
  assert.equal(s.rooms[0]?.lines.length, before.rooms[0]?.lines.length);
  assert.equal(reduce(s, { type: "tick", at: later(TYPING_SHOWN_MS - 1000) }), s); // still typing: same state
  assert.deepEqual(typingIn(reduce(s, { type: "tick", at: later(TYPING_SHOWN_MS) }).rooms[0]), []);
});

test("typing again keeps one entry; a stop, the message, leaving or quitting clears it", () => {
  const s = apply(arrived(), typing("Pai"), typing("Pai"), typing("Mãe"));
  assert.deepEqual(typingIn(s.rooms[0]), ["Pai", "Mãe"]);
  assert.deepEqual(typingIn(apply(s, typing("Pai", false)).rooms[0]), ["Mãe"]);
  assert.deepEqual(typingIn(apply(s, msg("#mujimbo", "Pai", "cheguei", 2)).rooms[0]), ["Mãe"]);
  assert.deepEqual(typingIn(apply(s, { type: "part", channel: "#mujimbo", nick: "Pai" }).rooms[0]), ["Mãe"]);
  assert.deepEqual(typingIn(apply(s, { type: "quit", nick: "Pai" }).rooms[0]), ["Mãe"]);
});

test("a nick change follows the typer; my own typing is never shown", () => {
  const s = apply(arrived(), typing("Pai"), { type: "nick", old: "Pai", nick: "Kota" }, typing("Guest-1"));
  assert.deepEqual(typingIn(s.rooms[0]), ["Kota"]);
});

const nudge = (from: string, to: string, tornado = false): ServerMessage => ({
  type: "nudge",
  channel: "#mujimbo",
  from,
  to,
  tornado,
});

test("a nudge for me is remembered so the app shakes; others only see the line", () => {
  const s = apply(arrived(), nudge("Pai", "Guest-1"));
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** Pai nudged Guest-1! 📳");
  assert.deepEqual(s.nudged, { key: s.seq, tornado: false });
  const t = apply(s, nudge("Pai", "Mãe", true));
  assert.equal(texts(t.rooms[0]?.lines ?? []).at(-1), "*** Pai sent a TORNADO to Mãe! 🌪️");
  assert.equal(t.nudged, s.nudged); // not me: nothing new to shake
});

test("every nudge for me is a new one, even the same kind twice", () => {
  const s = apply(arrived(), nudge("Pai", "Guest-1"));
  const again = apply(s, nudge("Pai", "Guest-1"));
  assert.notEqual(again.nudged?.key, s.nudged?.key);
});

test("nudge errors are translated", () => {
  const pt = apply(
    initialState,
    { type: "welcome", nick: "Kamba-1", channels: [] },
    { type: "joined", private: false, channel: "#mujimbo", topic: "", members: [online("Kamba-1")], history: [] },
    { type: "error", code: "nudge_too_soon", detail: "7", reason: "too many nudges" },
  );
  assert.equal(texts(pt.rooms[0]?.lines ?? []).at(-1), "*** Calma aí! Espera 7 s para abanar outra vez");
});

test("a nudge for everyone shakes everyone but the sender", () => {
  const all: ServerMessage = { type: "nudge", channel: "#mujimbo", from: "Pai", to: null, tornado: true };
  const s = apply(arrived(), all);
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** Pai sent a TORNADO to everyone in #mujimbo! 🌪️🌪️");
  assert.deepEqual(s.nudged, { key: s.seq, tornado: true });
  const mine = apply(arrived(), { ...all, from: "Guest-1" });
  assert.equal(mine.nudged, null); // I sent it: no shake for me
});

const dm = (from: string, to: string, text: string): ServerMessage => ({ type: "dm", from, to, kind: "say", text, at });

test("a DM opens a tab named after the other person; mine opens it and focuses it", () => {
  const s = apply(arrived(), dm("Pai", "Guest-1", "vem jantar"));
  assert.deepEqual(
    s.rooms.map((r) => r.name),
    ["#mujimbo", "Pai"],
  );
  assert.equal(s.active, "#mujimbo"); // someone else's DM doesn't steal the screen
  assert.equal(s.rooms[1]?.unread, 1);
  assert.equal(isDm("Pai"), true);
  assert.deepEqual(texts(s.rooms[1]?.lines ?? []), ["<Pai> vem jantar"]);
  const mine = apply(s, dm("Guest-1", "Pai", "já vou"));
  assert.equal(mine.active, "Pai");
  assert.deepEqual(texts(mine.rooms[1]?.lines ?? []), ["<Pai> vem jantar", "<Guest-1> já vou"]);
});

test("opening and closing a private chat; it follows a nick change and says when they leave", () => {
  let s = reduce(arrived(), { type: "openDm", nick: "Pai" });
  assert.equal(s.active, "Pai");
  s = apply(s, { type: "nick", old: "Pai", nick: "Kota" });
  assert.equal(s.active, "Kota");
  s = apply(s, { type: "quit", nick: "Kota" });
  assert.equal(texts(s.rooms.find((r) => r.name === "Kota")?.lines ?? []).at(-1), "*** Kota quit");
  s = reduce(s, { type: "closeDm", nick: "Kota" });
  assert.deepEqual(
    s.rooms.map((r) => r.name),
    ["#mujimbo"],
  );
  assert.equal(s.active, "#mujimbo");
});

test("a private channel is marked, and invites are shown to both sides", () => {
  let s = apply(arrived(), {
    type: "joined",
    private: true,
    channel: "#primos",
    topic: "",
    members: [online("Guest-1")],
    history: [],
  });
  assert.equal(s.rooms.find((r) => r.name === "#primos")?.private, true);
  s = apply(s, { type: "invited", channel: "#primos", from: "Guest-1", to: "Mãe" });
  assert.equal(texts(s.rooms.find((r) => r.name === "#primos")?.lines ?? []).at(-1), "*** You invited Mãe to #primos");
  s = apply(s, { type: "invited", channel: "#bula", from: "Pai", to: "Guest-1" });
  assert.equal(
    texts(s.rooms.find((r) => r.name === "#primos")?.lines ?? []).at(-1),
    "*** Pai invited you to #bula 🔒 Type /join #bula to go in",
  );
});

test("guest nicks are never remembered as a device's nick", () => {
  assert.equal(isGuestNick("Kamba-12"), true);
  assert.equal(isGuestNick("Estraga_Lar"), false);
  assert.equal(isGuestNick("Kamba-Rita"), false);
});

test("a chinela flies across the open channel; only its target is hit; a batuque hits everyone", () => {
  const s = apply(arrived(), { type: "throw", channel: "#mujimbo", from: "Pai", to: "Guest-1", item: "chinela" });
  assert.equal(texts(s.rooms[0]?.lines ?? []).at(-1), "*** Pai threw a slipper at Guest-1! 🩴💨");
  assert.deepEqual(s.thrown, { key: s.seq, item: "chinela", atMe: true });
  const other = apply(arrived(), { type: "throw", channel: "#mujimbo", from: "Pai", to: "Mãe", item: "colher" });
  assert.equal(other.thrown?.atMe, false); // I see it fly, Mãe gets the TOC
  const drums = apply(arrived(), { type: "throw", channel: "#mujimbo", from: "Pai", to: null, item: "batuque" });
  assert.equal(texts(drums.rooms[0]?.lines ?? []).at(-1), "*** Pai started a drum session in #mujimbo! 🥁🥁🥁");
  assert.equal(drums.thrown?.atMe, true);
  const elsewhere = apply(arrived(), { type: "throw", channel: "#futebol", from: "Pai", to: "Guest-1", item: "chinela" });
  assert.equal(elsewhere.thrown, null); // not the open channel: just the line there
});

test("in a private chat, a nudge lands in its tab and typing shows there", () => {
  let s = apply(arrived(), { type: "nudge", dm: true, from: "Pai", to: "Guest-1", tornado: false });
  assert.equal(texts(s.rooms.find((r) => r.name === "Pai")?.lines ?? []).at(-1), "*** Pai nudged Guest-1! 📳");
  assert.deepEqual(s.nudged, { key: s.seq, tornado: false });
  s = apply(s, { type: "typing", dm: true, nick: "Pai", typing: true });
  assert.deepEqual(typingIn(s.rooms.find((r) => r.name === "Pai")), ["Pai"]);
  const mine = apply(arrived(), { type: "nudge", dm: true, from: "Guest-1", to: "Mãe", tornado: true });
  assert.equal(mine.nudged, null); // I sent it
  assert.equal(texts(mine.rooms.find((r) => r.name === "Mãe")?.lines ?? []).at(-1), "*** Guest-1 sent a TORNADO to Mãe! 🌪️");
});

test("in a private chat, the message clears the typing line, like in a channel", () => {
  let s = apply(arrived(), dm("Pai", "Guest-1", "olá"), { type: "typing", dm: true, nick: "Pai", typing: true });
  assert.deepEqual(typingIn(s.rooms.find((r) => r.name === "Pai")), ["Pai"]);
  s = apply(s, dm("Pai", "Guest-1", "estás em casa?"));
  assert.deepEqual(typingIn(s.rooms.find((r) => r.name === "Pai")), []);
});

test("a dropped connection is said once; coming back is said once", () => {
  let s = reduce(arrived(), { type: "connection", status: "open", at });
  s = reduce(s, { type: "connection", status: "closed", at });
  s = reduce(s, { type: "connection", status: "connecting", at });
  s = reduce(s, { type: "connection", status: "closed", at }); // a failed retry: no new line
  s = reduce(s, { type: "connection", status: "open", at });
  assert.deepEqual(texts(s.rooms[0]?.lines ?? []).slice(-2), ["*** Connection lost. Reconnecting…", "*** Back online! 🔌"]);
});

test("rejoining keeps the screen and adds only the messages missed meanwhile", () => {
  const before = arrived(); // has message id 1 from Pai
  const back = apply(before, { type: "welcome", nick: "Guest-1", channels: [{ name: "#mujimbo", topic: "dinner" }] }, {
    type: "joined",
    private: false,
    channel: "#mujimbo",
    topic: "dinner",
    members: [online("Pai"), online("Guest-1"), online("Mãe")],
    history: [
      { id: 1, channel: "#mujimbo", nick: "Pai", kind: "say", text: "olá", at },
      { id: 2, channel: "#mujimbo", nick: "Mãe", kind: "say", text: "cheguei", at },
    ],
  });
  assert.deepEqual(texts(back.rooms[0]?.lines ?? []), [...texts(before.rooms[0]?.lines ?? []), "<Mãe> cheguei"]);
  assert.deepEqual(nicks(back), ["Pai", "Guest-1", "Mãe"]);
  assert.equal(back.rooms.length, 1);
});

test("after a reconnection, private channel tabs close with a note; private chats stay", () => {
  let s = apply(arrived(), { type: "joined", private: true, channel: "#primos", topic: "", members: [online("Guest-1")], history: [] });
  s = reduce(s, { type: "openDm", nick: "Pai" });
  s = apply(s, { type: "welcome", nick: "Guest-1", channels: [{ name: "#mujimbo", topic: "dinner" }] });
  assert.deepEqual(
    s.rooms.map((r) => r.name),
    ["#mujimbo", "Pai"],
  );
  assert.equal(texts(s.rooms.find((r) => r.name === s.active)?.lines ?? []).at(-1), "*** You left #primos when the connection dropped 🔒 ask for a new invite");
});
