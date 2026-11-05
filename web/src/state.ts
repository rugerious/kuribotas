import type { Channel, ChatMessage, Member, ServerMessage, Status } from "../../shared/protocol.ts";
import { words, type Lang } from "./words.ts";

// Everything on screen comes from this state, and the state only changes through reduce().
// It is plain data and a pure function, so it is tested without a browser.

export const HOME_CHANNEL = "#mujimbo";
const MAX_LINES = 500; // per room, so a long day doesn't slow the phone down

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
};

export type Connection = "connecting" | "open" | "closed";

export type State = {
  lang: Lang; // which words.ts language the screen speaks
  connection: Connection;
  nick: string;
  status: Status; // mine
  note: string; // mine
  known: Channel[]; // all channels, from the welcome
  rooms: Room[]; // channels we're in, in the order we joined
  active: string; // the open tab
  colours: Record<string, RoomColour>; // colours picked on this device
  seq: number; // gives every line a unique key
};

export type Action =
  | { type: "connection"; status: Connection; at: string }
  | { type: "server"; msg: ServerMessage; at: string }
  | { type: "local"; text: string; tone: "info" | "error"; at: string }
  | { type: "focus"; channel: string }
  | { type: "colour"; channel: string; colour?: RoomColour; at: string } // no colour = the next one
  | { type: "lang"; lang: Lang; at: string };

export const initialState: State = {
  lang: "pt",
  connection: "connecting",
  nick: "",
  status: "online",
  note: "",
  known: [],
  rooms: [],
  active: HOME_CHANNEL,
  colours: {},
  seq: 0,
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
      const next = { ...state, connection: action.status };
      return action.status === "closed"
        ? addEvent(next, next.active, words(state.lang).events.disconnected, action.at, "error")
        : next;
    }
    case "local":
      return addEvent(state, state.active, action.text, action.at, action.tone);
    case "focus":
      return {
        ...state,
        active: action.channel,
        rooms: state.rooms.map((r) => (r.name === action.channel ? { ...r, unread: 0 } : r)),
      };
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
  }
}

function onServer(state: State, msg: ServerMessage, at: string): State {
  const w = words(state.lang);
  const hasMember = (r: Room, nick: string): boolean => r.members.some((m) => m.nick === nick);
  const without = (r: Room, nick: string): Room => ({ ...r, members: r.members.filter((m) => m.nick !== nick) });
  switch (msg.type) {
    case "welcome":
      return { ...state, nick: msg.nick, known: msg.channels };

    case "joined": {
      const first = state.rooms.length === 0;
      let seq = state.seq;
      const lines: Line[] = msg.history.map((m) => ({ kind: "message", key: ++seq, msg: m }));
      const room: Room = { name: msg.channel, topic: msg.topic, members: msg.members, lines, unread: 0 };
      let next: State = {
        ...state,
        seq,
        rooms: [...state.rooms.filter((r) => r.name !== msg.channel), room],
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
      return addEvent(next, msg.channel, w.events.joined(msg.nick, msg.channel), at, "info");
    }

    case "part": {
      if (msg.nick === state.nick) {
        const rooms = state.rooms.filter((r) => r.name !== msg.channel);
        const active = state.active === msg.channel ? (rooms[0]?.name ?? HOME_CHANNEL) : state.active;
        return addEvent({ ...state, rooms, active }, active, w.events.youLeft(msg.channel), at, "info");
      }
      const next = updateRoom(state, msg.channel, (r) => without(r, msg.nick));
      return addEvent(next, msg.channel, w.events.left(msg.nick, msg.channel), at, "info");
    }

    case "quit": {
      let next = state;
      for (const room of state.rooms.filter((r) => hasMember(r, msg.nick))) {
        next = updateRoom(next, room.name, (r) => without(r, msg.nick));
        next = addEvent(next, room.name, w.events.quit(msg.nick), at, "info");
      }
      return next;
    }

    case "nick": {
      let next: State = msg.old === state.nick ? { ...state, nick: msg.nick } : state;
      for (const room of state.rooms.filter((r) => hasMember(r, msg.old))) {
        next = updateRoom(next, room.name, (r) => ({
          ...r,
          members: r.members.map((m) => (m.nick === msg.old ? { ...m, nick: msg.nick } : m)),
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
      return {
        ...updateRoom(state, chat.channel, (r) => ({
          ...r,
          lines: trim([...r.lines, { kind: "message", key: seq, msg: chat }]),
          unread: r.name === state.active ? r.unread : r.unread + 1,
        })),
        seq,
      };
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
      // Me: remember it and say it once, in the open tab.
      next = { ...next, status: msg.status, note: msg.note };
      return addEvent(next, next.active, w.events.nowStatus(w.status[msg.status], msg.note), at, "info");
    }

    case "error": {
      const say = w.errors[msg.code] as ((detail: string) => string) | undefined;
      return addEvent(state, state.active, say ? say(msg.detail) : msg.reason, at, "error");
    }
  }
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
