import type { Channel, ChatMessage, ServerMessage } from "../../shared/protocol.ts";

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
  members: string[];
  lines: Line[];
  unread: number;
};

export type Connection = "connecting" | "open" | "closed";

export type State = {
  connection: Connection;
  nick: string;
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
  | { type: "colour"; channel: string; colour?: RoomColour; at: string }; // no colour = the next one

export const initialState: State = {
  connection: "connecting",
  nick: "",
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
        ? addEvent(next, next.active, "Disconnected. Reload the page to reconnect.", action.at, "error")
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
      return addEvent(changed, action.channel, `${action.channel} is now ${next} (on this device)`, action.at, "info");
    }
  }
}

function onServer(state: State, msg: ServerMessage, at: string): State {
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
        next = addEvent(next, msg.channel, `Welcome, ${state.nick}! Channels: ${others}. Type /help for commands.`, at, "info");
      }
      next = addEvent(next, msg.channel, `You joined ${msg.channel}`, at, "info");
      return msg.topic ? addEvent(next, msg.channel, `Topic: ${msg.topic}`, at, "info") : next;
    }

    case "join": {
      const next = updateRoom(state, msg.channel, (r) => ({ ...r, members: [...r.members, msg.nick] }));
      return addEvent(next, msg.channel, `${msg.nick} joined ${msg.channel}`, at, "info");
    }

    case "part": {
      if (msg.nick === state.nick) {
        const rooms = state.rooms.filter((r) => r.name !== msg.channel);
        const active = state.active === msg.channel ? (rooms[0]?.name ?? HOME_CHANNEL) : state.active;
        return addEvent({ ...state, rooms, active }, active, `You left ${msg.channel}`, at, "info");
      }
      const next = updateRoom(state, msg.channel, (r) => ({ ...r, members: r.members.filter((n) => n !== msg.nick) }));
      return addEvent(next, msg.channel, `${msg.nick} left ${msg.channel}`, at, "info");
    }

    case "quit": {
      let next = state;
      for (const room of state.rooms.filter((r) => r.members.includes(msg.nick))) {
        next = updateRoom(next, room.name, (r) => ({ ...r, members: r.members.filter((n) => n !== msg.nick) }));
        next = addEvent(next, room.name, `${msg.nick} quit`, at, "info");
      }
      return next;
    }

    case "nick": {
      let next: State = msg.old === state.nick ? { ...state, nick: msg.nick } : state;
      for (const room of state.rooms.filter((r) => r.members.includes(msg.old))) {
        next = updateRoom(next, room.name, (r) => ({
          ...r,
          members: r.members.map((n) => (n === msg.old ? msg.nick : n)),
        }));
        next = addEvent(next, room.name, `${msg.old} is now known as ${msg.nick}`, at, "info");
      }
      return next;
    }

    case "topic": {
      const next = updateRoom(state, msg.channel, (r) => ({ ...r, topic: msg.topic }));
      const text = msg.topic ? `${msg.nick} changed the topic to: ${msg.topic}` : `${msg.nick} cleared the topic`;
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

    case "error":
      return addEvent(state, state.active, msg.reason, at, "error");
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
