import type { Channel, ChatMessage, Club, Member, ServerMessage, Status, ThrowItem } from "../../shared/protocol.ts";
import { CLUB } from "./cheer.ts";
import { burstFor, type Move } from "./burst.ts";
import { words, type Lang } from "./words.ts";

// Everything on screen comes from this state, and the state only changes through reduce().
// It is plain data and a pure function, so it is tested without a browser.

export const HOME_CHANNEL = "#mujimbo";
export const MAX_LINES = 500; // per room, so a long day doesn't slow the phone down
const HISTORY_PAGE = 50; // what the server sends on joining (HISTORY_LIMIT): fewer means that is all there is
// "is typing" stays this long after the last notice. Senders repeat it every 3 s while typing,
// so it only runs out when someone stops (or their phone loses signal).
export const TYPING_SHOWN_MS = 6000;

// Each channel has a colour (tab, topic bar, accents). Chosen per device, like a wallpaper.
export const ROOM_COLOURS = ["amber", "blue", "green", "coral", "violet"] as const;
export type RoomColour = (typeof ROOM_COLOURS)[number];

export type Line =
  | { kind: "message"; key: number; msg: ChatMessage }
  | { kind: "event"; key: number; text: string; at: string; tone: "info" | "error" };

export type Room = {
  name: string;
  topic: string;
  members: Member[];
  lines: Line[];
  unread: number;
  typing: { nick: string; until: number }[]; // who is typing here, and until when (ms)
  private: boolean; // a private channel 🔒, or a DM: nothing in it is saved on the server
  more: boolean; // older messages are still saved on the server (scroll up for them)
};

// A DM's room is named after the other person (no "#"); channels always start with "#".
export function isDm(name: string): boolean {
  return !name.startsWith("#");
}

export type Connection = "connecting" | "open" | "closed";

export type State = {
  lang: Lang; // which words.ts language the screen speaks
  connection: Connection;
  visible: boolean; // the app is on screen (a hidden app counts new messages even in the open tab)
  nick: string;
  status: Status; // mine
  note: string; // mine
  known: Channel[]; // all channels, from the welcome
  rooms: Room[]; // channels we're in, in the order we joined
  active: string; // the open tab
  colours: Record<string, RoomColour>; // colours picked on this device
  nudged: { key: number; tornado: boolean } | null; // the last time someone shook me (the app shakes, buzzes, vibrates)
  thrown: { key: number; item: ThrowItem; atMe: boolean } | null; // the last thing flying across the open channel
  burst: { key: number; emoji: string; move: Move } | null; // the last big emoji said live in the open room
  cheer: { key: number; club: Club } | null; // the last club flag raised in the open room
  snow: { key: number } | null; // the last snowfall in the open room
  seq: number; // gives every line a unique key
  quietJoins: boolean; // this device hides "chegou / saiu" lines in channels (/entradas nao)
};

export type Action =
  | { type: "connection"; status: Connection; at: string }
  | { type: "server"; msg: ServerMessage; at: string }
  | { type: "local"; text: string; tone: "info" | "error"; at: string }
  | { type: "focus"; channel: string }
  | { type: "openDm"; nick: string } // open (or go to) a private chat tab
  | { type: "closeDm"; nick: string } // close a private chat tab (its messages stay saved on the server, 3 days)
  | { type: "colour"; channel: string; colour?: RoomColour; at: string } // no colour = the next one
  | { type: "lang"; lang: Lang; at: string }
  | { type: "tick"; at: string } // every second: "is typing" runs out
  | { type: "visibility"; visible: boolean } // the app went to the background, or came back
  | { type: "quietJoins"; on: boolean; at: string }; // hide (true) or show the arrived/left lines

export const initialState: State = {
  lang: "pt",
  connection: "connecting",
  visible: true,
  nick: "",
  status: "online",
  note: "",
  known: [],
  rooms: [],
  active: HOME_CHANNEL,
  colours: {},
  nudged: null,
  thrown: null,
  burst: null,
  cheer: null,
  snow: null,
  seq: 0,
  quietJoins: false,
};

// #mujimbo is amber; other channels get a steady colour from their name until someone picks one.
export function colourOf(state: State, channel: string): RoomColour {
  const picked = state.colours[channel];
  if (picked !== undefined) return picked;
  if (channel === HOME_CHANNEL) return "amber";
  let hash = 0;
  for (const ch of channel) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return ROOM_COLOURS[hash % ROOM_COLOURS.length] ?? "amber";
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "connection": {
      // Said once when the line drops (not on every retry), and once when it comes back.
      const w = words(state.lang);
      const next = { ...state, connection: action.status };
      if (action.status === "closed" && state.connection === "open") {
        return addEvent(next, next.active, w.events.disconnected, action.at, "error");
      }
      if (action.status === "open" && state.connection === "closed") {
        return addEvent(next, next.active, w.events.reconnected, action.at, "info");
      }
      return next;
    }
    case "local":
      return addEvent(state, state.active, action.text, action.at, action.tone);
    case "focus":
      return {
        ...state,
        active: action.channel,
        rooms: state.rooms.map((r) => (r.name === action.channel ? { ...r, unread: 0 } : r)),
      };
    case "openDm": {
      const room = state.rooms.find((r) => r.name.toLowerCase() === action.nick.toLowerCase());
      return reduce(withDm(state, room?.name ?? action.nick), { type: "focus", channel: room?.name ?? action.nick });
    }
    case "closeDm": {
      const rooms = state.rooms.filter((r) => r.name !== action.nick);
      const active = state.active === action.nick ? (rooms[0]?.name ?? HOME_CHANNEL) : state.active;
      return { ...state, rooms, active };
    }
    case "server":
      return onServer(state, action.msg, action.at);
    case "colour": {
      const current = colourOf(state, action.channel);
      const next = action.colour ?? ROOM_COLOURS[(ROOM_COLOURS.indexOf(current) + 1) % ROOM_COLOURS.length] ?? "amber";
      const changed = { ...state, colours: { ...state.colours, [action.channel]: next } };
      const w = words(state.lang);
      return addEvent(changed, action.channel, w.events.colour(action.channel, w.colour[next]), action.at, "info");
    }
    case "lang": {
      // Lines already on screen stay as they were; everything from now on is in the new language.
      const switched = { ...state, lang: action.lang };
      return addEvent(switched, switched.active, words(action.lang).events.lang, action.at, "info");
    }
    case "quietJoins": {
      const next = { ...state, quietJoins: action.on };
      return addEvent(next, next.active, words(state.lang).events.joins(!action.on), action.at, "info");
    }
    case "visibility": {
      const next = { ...state, visible: action.visible };
      return action.visible ? reduce(next, { type: "focus", channel: state.active }) : next;
    }
    case "tick": {
      const now = Date.parse(action.at);
      if (!state.rooms.some((r) => r.typing.some((t) => t.until <= now))) return state; // same state: no re-render
      return { ...state, rooms: state.rooms.map((r) => ({ ...r, typing: r.typing.filter((t) => t.until > now) })) };
    }
  }
}

// Everything unread, for the window title and the app icon's badge.
export function totalUnread(state: State): number {
  return state.rooms.reduce((sum, r) => sum + r.unread, 0);
}

// Who is typing in a room, for the line above the input.
export function typingIn(room: Room | undefined): string[] {
  return room?.typing.map((t) => t.nick) ?? [];
}

function onServer(state: State, msg: ServerMessage, at: string): State {
  const w = words(state.lang);
  const hasMember = (r: Room, nick: string): boolean => r.members.some((m) => m.nick === nick);
  const notTyping = (r: Room, nick: string): Room => ({ ...r, typing: r.typing.filter((t) => t.nick !== nick) });
  const without = (r: Room, nick: string): Room => ({
    ...notTyping(r, nick),
    members: r.members.filter((m) => m.nick !== nick),
  });
  switch (msg.type) {
    case "welcome": {
      // Private chats with recent messages come back as tabs (the app asks for their messages).
      let next: State = { ...state, nick: msg.nick, known: msg.channels };
      for (const nick of msg.dms ?? []) if (!next.rooms.some((r) => r.name.toLowerCase() === nick.toLowerCase())) next = withDm(next, nick);
      if (state.rooms.length === 0) return next;
      // Back after a dropped connection: the server reopens this person's rooms (private ones too),
      // so every tab stays where it was.
      const rooms = next.rooms.map((r) => ({ ...r, typing: [] }));
      const active = rooms.some((r) => r.name === state.active) ? state.active : (rooms[0]?.name ?? HOME_CHANNEL);
      return { ...next, rooms, active };
    }

    case "joined": {
      const existing = state.rooms.find((r) => r.name === msg.channel);
      if (existing !== undefined) {
        // Rejoined after a reconnection: keep what is on screen, add only the messages missed meanwhile.
        const seen = Math.max(0, ...existing.lines.map((l) => (l.kind === "message" ? l.msg.id : 0)));
        let seq = state.seq;
        const missed: Line[] = msg.history.filter((m) => m.id > seen).map((m) => ({ kind: "message", key: ++seq, msg: m }));
        const next = updateRoom({ ...state, seq }, msg.channel, (r) => ({
          ...r,
          topic: msg.topic,
          members: msg.members,
          lines: trim([...r.lines, ...missed]),
          unread: r.name === state.active ? r.unread : r.unread + missed.length,
        }));
        return msg.topic !== existing.topic && msg.topic ? addEvent(next, msg.channel, w.events.topicIs(msg.topic), at, "info") : next;
      }
      const first = state.rooms.length === 0;
      let seq = state.seq;
      const lines: Line[] = msg.history.map((m) => ({ kind: "message", key: ++seq, msg: m }));
      const room: Room = {
        name: msg.channel,
        topic: msg.topic,
        members: msg.members,
        lines,
        unread: 0,
        typing: [],
        private: msg.private,
        more: msg.history.length >= HISTORY_PAGE,
      };
      let next: State = {
        ...state,
        seq,
        // Channels before private chats, so the tabs read #mujimbo #angola … then 💬 Kota.
        rooms: [...state.rooms.filter((r) => r.name !== msg.channel && !isDm(r.name)), room, ...state.rooms.filter((r) => isDm(r.name))],
        active: msg.channel,
      };
      if (first) {
        const others = state.known.map((c) => c.name).join(" ");
        next = addEvent(next, msg.channel, w.events.welcome(state.nick, others), at, "info");
      }
      next = addEvent(next, msg.channel, w.events.youJoined(msg.channel), at, "info");
      return msg.topic ? addEvent(next, msg.channel, w.events.topicIs(msg.topic), at, "info") : next;
    }

    case "join": {
      const arrived: Member = { nick: msg.nick, status: "online", note: "" };
      const next = updateRoom(state, msg.channel, (r) => ({ ...r, members: [...without(r, msg.nick).members, arrived] }));
      // A phone locking and unlocking comes and goes all day: on a quiet device only the list changes.
      return state.quietJoins ? next : addEvent(next, msg.channel, w.events.joined(msg.nick, msg.channel), at, "info");
    }

    case "part": {
      if (msg.nick === state.nick) {
        const rooms = state.rooms.filter((r) => r.name !== msg.channel);
        const active = state.active === msg.channel ? (rooms[0]?.name ?? HOME_CHANNEL) : state.active;
        return addEvent({ ...state, rooms, active }, active, w.events.youLeft(msg.channel), at, "info");
      }
      const next = updateRoom(state, msg.channel, (r) => without(r, msg.nick));
      return state.quietJoins ? next : addEvent(next, msg.channel, w.events.left(msg.nick, msg.channel), at, "info");
    }

    case "quit": {
      let next = state;
      if (state.rooms.some((r) => r.name === msg.nick)) next = addEvent(next, msg.nick, w.events.quit(msg.nick), at, "info");
      for (const room of state.rooms.filter((r) => hasMember(r, msg.nick))) {
        next = updateRoom(next, room.name, (r) => without(r, msg.nick));
        if (!state.quietJoins) next = addEvent(next, room.name, w.events.quit(msg.nick), at, "info");
      }
      return next;
    }

    case "nick": {
      let next: State = msg.old === state.nick ? { ...state, nick: msg.nick } : state;
      // A private chat with them follows the new name.
      if (state.rooms.some((r) => r.name === msg.old)) {
        next = {
          ...updateRoom(next, msg.old, (r) => ({ ...r, name: msg.nick })),
          active: next.active === msg.old ? msg.nick : next.active,
        };
        next = addEvent(next, msg.nick, w.events.nickChange(msg.old, msg.nick), at, "info");
      }
      for (const room of state.rooms.filter((r) => hasMember(r, msg.old))) {
        next = updateRoom(next, room.name, (r) => ({
          ...r,
          members: r.members.map((m) => (m.nick === msg.old ? { ...m, nick: msg.nick } : m)),
          typing: r.typing.map((t) => (t.nick === msg.old ? { ...t, nick: msg.nick } : t)),
        }));
        next = addEvent(next, room.name, w.events.nickChange(msg.old, msg.nick), at, "info");
      }
      return next;
    }

    case "topic": {
      const next = updateRoom(state, msg.channel, (r) => ({ ...r, topic: msg.topic }));
      const text = msg.topic ? w.events.topicChanged(msg.nick, msg.topic) : w.events.topicCleared(msg.nick);
      return addEvent(next, msg.channel, text, at, "info");
    }

    case "message": {
      const chat: ChatMessage = {
        id: msg.id,
        channel: msg.channel,
        nick: msg.nick,
        kind: msg.kind,
        text: msg.text,
        at: msg.at,
      };
      const seq = state.seq + 1;
      const big = chat.channel === state.active ? burstFor(chat.text) : null; // only live, only in the open room
      return {
        ...updateRoom(state, chat.channel, (r) => ({
          ...notTyping(r, chat.nick), // the message they were typing has arrived
          lines: trim([...r.lines, { kind: "message", key: seq, msg: chat }]),
          unread: r.name === state.active && state.visible ? r.unread : r.unread + 1,
        })),
        seq,
        burst: big === null ? state.burst : { key: seq, ...big },
      };
    }

    case "dm": {
      // The room is named after the other person; my own DMs come back to me and open the tab.
      const other = msg.from === state.nick ? msg.to : msg.from;
      const chat: ChatMessage = { id: msg.id, channel: other, nick: msg.from, kind: msg.kind, text: msg.text, at: msg.at };
      const opened = withDm(state, other);
      const seq = opened.seq + 1;
      const next: State = {
        ...updateRoom(opened, other, (r) => ({
          ...r,
          typing: r.typing.filter((x) => x.nick !== msg.from), // the message they were typing has arrived
          lines: trim([...r.lines, { kind: "message", key: seq, msg: chat }]),
          unread: (r.name === state.active && state.visible) || msg.from === state.nick ? r.unread : r.unread + 1,
        })),
        seq,
      };
      const open = msg.from === state.nick ? { ...next, active: other } : next;
      const big = open.active === other ? burstFor(msg.text) : null;
      return big === null ? open : { ...open, burst: { key: seq, ...big } };
    }

    case "dm_history": {
      // The saved private messages with someone: they go first, and what is already on screen stays
      // after them (a message that is in both is shown once). A tab typed in another case takes their nick.
      const other = msg.with;
      const typed = state.rooms.find((r) => r.name !== other && r.name.toLowerCase() === other.toLowerCase());
      let next: State = typed
        ? { ...updateRoom(state, typed.name, (r) => ({ ...r, name: other })), active: state.active === typed.name ? other : state.active }
        : state;
      next = withDm(next, other);
      let seq = next.seq;
      const saved: Line[] = msg.messages.map((m) => ({
        kind: "message",
        key: ++seq,
        msg: { id: m.id, channel: other, nick: m.from, kind: m.kind, text: m.text, at: m.at },
      }));
      const last = Math.max(0, ...msg.messages.map((m) => m.id));
      return updateRoom({ ...next, seq }, other, (r) => ({
        ...r,
        lines: trim([...saved, ...r.lines.filter((l) => l.kind === "event" || l.msg.id > last)]),
      }));
    }

    case "invited": {
      const text = msg.to === state.nick ? w.events.invitedYou(msg.from, msg.channel) : w.events.youInvited(msg.to, msg.channel);
      return addEvent(state, state.active, text, at, "info");
    }

    case "presence": {
      // Others: quietly update the people lists (MSN didn't log every status change).
      let next: State = { ...state };
      for (const room of state.rooms.filter((r) => hasMember(r, msg.nick))) {
        next = updateRoom(next, room.name, (r) => ({
          ...r,
          members: r.members.map((m) => (m.nick === msg.nick ? { ...m, status: msg.status, note: msg.note } : m)),
        }));
      }
      if (msg.nick !== state.nick) return next;
      // Me: remember it and say it once, in the open tab (not again when a reconnection puts it back).
      if (msg.status === state.status && msg.note === state.note) return next;
      next = { ...next, status: msg.status, note: msg.note };
      return addEvent(next, next.active, w.events.nowStatus(w.status[msg.status], msg.note), at, "info");
    }

    case "nudge": {
      if ("dm" in msg) {
        // A private chat's nudge lands in that chat's tab (opened if needed), like MSN's window.
        const other = msg.from === state.nick ? msg.to : msg.from;
        const text = (msg.tornado ? w.events.tornado : w.events.nudge)(msg.from, msg.to);
        const next = addEvent(withDm(state, other), other, text, at, "info");
        return msg.to === state.nick ? { ...next, nudged: { key: next.seq, tornado: msg.tornado } } : next;
      }
      const everyone = msg.to === null;
      const text = everyone
        ? (msg.tornado ? w.events.tornadoAll : w.events.nudgeAll)(msg.from, msg.channel)
        : (msg.tornado ? w.events.tornado : w.events.nudge)(msg.from, msg.to ?? "");
      const next = addEvent(state, msg.channel, text, at, "info");
      const forMe = everyone ? msg.from !== state.nick : msg.to === state.nick;
      return forMe ? { ...next, nudged: { key: next.seq, tornado: msg.tornado } } : next;
    }

    case "throw": {
      const text =
        msg.item === "batuque" || msg.to === null
          ? w.events.batuque(msg.from, msg.channel)
          : w.events.thrown(msg.item, msg.from, msg.to);
      const next = addEvent(state, msg.channel, text, at, "info");
      // Only the open channel animates; a batuque "hits" everyone, a chinela only its target.
      if (msg.channel !== state.active) return next;
      const atMe = msg.to === null || msg.to === state.nick;
      return { ...next, thrown: { key: next.seq, item: msg.item, atMe } };
    }

    case "roll":
      return addEvent(state, msg.channel, w.events.roll(msg.from, msg.sides, msg.result), at, "info");

    case "8ball":
      return addEvent(state, msg.channel, w.events.eightBall(msg.from, msg.question, w.eightBall[msg.answer] ?? "…"), at, "info");

    case "snow": {
      const next = addEvent(state, msg.channel, w.events.snow(msg.from, msg.channel), at, "info");
      return msg.channel === state.active ? { ...next, snow: { key: next.seq } } : next;
    }

    case "cheer": {
      const next = addEvent(state, msg.channel, w.events.cheer(msg.from, CLUB[msg.club].name), at, "info");
      return msg.channel === state.active ? { ...next, cheer: { key: next.seq, club: msg.club } } : next;
    }

    case "typing": {
      if (msg.nick === state.nick) return state;
      const until = Date.parse(at) + TYPING_SHOWN_MS;
      const room = "dm" in msg ? msg.nick : msg.channel; // a private chat's room is named after the person
      return updateRoom(state, room, (r) => ({
        ...r,
        typing: msg.typing ? [...notTyping(r, msg.nick).typing, { nick: msg.nick, until }] : notTyping(r, msg.nick).typing,
      }));
    }

    case "role": {
      // IRC's "*** X gives @ to Y", in every tab where Y is (else the open one).
      const rooms = state.rooms.filter((r) => hasMember(r, msg.nick));
      let next = state;
      for (const room of rooms) {
        next = updateRoom(next, room.name, (r) => ({
          ...r,
          members: r.members.map((m) => (m.nick === msg.nick ? { ...m, role: msg.role } : m)),
        }));
        next = addEvent(next, room.name, w.events.role(msg.by, msg.nick, msg.role === "admin"), at, "info");
      }
      return rooms.length > 0 ? next : addEvent(next, state.active, w.events.role(msg.by, msg.nick, msg.role === "admin"), at, "info");
    }

    case "removed": {
      const rooms = state.rooms.filter((r) => hasMember(r, msg.nick) || r.name === msg.nick);
      let next = state;
      for (const room of rooms) {
        next = updateRoom(next, room.name, (r) => without(r, msg.nick));
        next = addEvent(next, room.name, w.events.removed(msg.nick, msg.by), at, "info");
      }
      return rooms.length > 0 ? next : addEvent(next, state.active, w.events.removed(msg.nick, msg.by), at, "info");
    }

    case "home": {
      const line = w.events.home(msg.by, msg.channel, msg.on);
      const where = state.rooms.some((r) => r.name === msg.channel) ? msg.channel : state.active;
      return addEvent(state, where, line, at, "info");
    }

    case "room_deleted": {
      // Its tab closes (the server already took everyone out); the note goes to the open tab.
      const rooms = state.rooms.filter((r) => r.name !== msg.channel);
      const active = state.active === msg.channel ? (rooms[0]?.name ?? HOME_CHANNEL) : state.active;
      const known = state.known.filter((c) => c.name !== msg.channel);
      return addEvent({ ...state, rooms, active, known }, active, w.events.roomDeleted(msg.channel, msg.by), at, "info");
    }

    case "older": {
      // An older page, from scrolling to the top: it goes before what is on screen (once each).
      const room = state.rooms.find((r) => r.name === msg.channel);
      if (room === undefined) return state;
      const have = new Set(room.lines.map((l) => (l.kind === "message" ? l.msg.id : -1)));
      let seq = state.seq;
      const older: Line[] = msg.messages.filter((m) => !have.has(m.id)).map((m) => ({ kind: "message", key: ++seq, msg: m }));
      return updateRoom({ ...state, seq }, msg.channel, (r) => ({ ...r, lines: [...older, ...r.lines], more: msg.more }));
    }
    case "log":
    case "link":
    case "links":
    case "devices":
    case "rooms":
      return state; // shown by the app, which knows this page's address and the date format

    case "error": {
      const say = w.errors[msg.code] as ((detail: string) => string) | undefined;
      return addEvent(state, state.active, say ? say(msg.detail) : msg.reason, at, "error");
    }
  }
}

// Makes sure there is a tab for a private chat with this person.
function withDm(state: State, nick: string): State {
  if (state.rooms.some((r) => r.name === nick)) return state;
  const room: Room = { name: nick, topic: "", members: [], lines: [], unread: 0, typing: [], private: true, more: false };
  return { ...state, rooms: [...state.rooms, room] };
}

function updateRoom(state: State, name: string, change: (r: Room) => Room): State {
  return { ...state, rooms: state.rooms.map((r) => (r.name === name ? change(r) : r)) };
}

function addEvent(state: State, channel: string, text: string, at: string, tone: "info" | "error"): State {
  const seq = state.seq + 1;
  const line: Line = { kind: "event", key: seq, text, at, tone };
  return { ...updateRoom(state, channel, (r) => ({ ...r, lines: trim([...r.lines, line]) })), seq };
}

function trim(lines: Line[]): Line[] {
  return lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
}
