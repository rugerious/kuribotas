import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ErrorCode, Member as MemberInfo, ServerMessage, Status } from "../../shared/protocol.ts";
import type { Store } from "./store.ts";

// One connected person. Nicks and statuses live in memory, IRC style (accounts come with invites, phase 4).
// `typingIn`: channel -> when we last passed on "is typing" (to rate-limit it, and to know a stop is due).
type Member = {
  ws: WebSocket;
  nick: string;
  status: Status;
  note: string;
  channels: Set<string>;
  typingIn: Map<string, number>;
  nudgedAt: number[]; // when this person's recent quick nudges were sent
  tornadoAt: number | undefined; // when this person last sent a tornado
  groupNudgeAt: number | undefined; // ...a nudge to the whole channel
  groupTornadoAt: number | undefined; // ...a tornado to the whole channel
};

const HOME_CHANNEL = "#mujimbo"; // everyone lands here
const GUEST_PREFIX = "Kamba-"; // newcomers are friends: Kamba-1, Kamba-2...
const HISTORY_LIMIT = 50; // messages sent when joining a channel
const MAX_TEXT_LENGTH = 2000; // characters per chat message
const MAX_TOPIC_LENGTH = 200; // characters per topic
const MAX_NOTE_LENGTH = 80; // characters in the line under your name
const MAX_PAYLOAD_BYTES = 16 * 1024; // larger frames are rejected by ws (close code 1009)
const CLOSE_GRACE_MS = 3000; // on shutdown, wait this long before force-closing clients
const TYPING_MIN_INTERVAL_MS = 2000; // "is typing" passed on at most this often per person and channel
const NUDGE_BURST = 3; // quick nudges allowed...
const NUDGE_WINDOW_MS = 10_000; // ...in this window
const TORNADO_EVERY_MS = 60_000; // one tornado a minute: an event, not spam
const GROUP_NUDGE_EVERY_MS = 60_000; // the whole channel: once a minute
const GROUP_TORNADO_EVERY_MS = 300_000; // a tornado for everyone: once every 5 minutes
const STATUSES: readonly Status[] = ["online", "away", "busy", "invisible"];

// Nicks: 1-24 letters (any language), digits or _-~*^.|[]{} — so "~*~Rita~*~" works, spaces don't.
const NICK_PATTERN = /^[\p{L}\p{N}_\-~*^.|[\]{}]{1,24}$/u;
// Channels: "#" + 1-32 letters, digits, _ or -. Stored in lower case: #Futebol and #futebol are one channel.
const CHANNEL_PATTERN = /^#[\p{L}\p{N}_-]{1,32}$/u;

export type Chat = { close: () => Promise<void> };

export function attachChat(server: Server, store: Store): Chat {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const members = new Set<Member>();
  let guestCounter = 0;

  // Only /ws may upgrade to a WebSocket; anything else is refused.
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    // Without an error listener, one bad client (e.g. an oversized frame) would crash the process.
    ws.on("error", (err) => {
      console.warn(`websocket error: ${err.message}`);
    });

    const me: Member = {
      ws,
      nick: newGuestNick(),
      status: "online",
      note: "",
      channels: new Set(),
      typingIn: new Map(),
      nudgedAt: [],
      tornadoAt: undefined,
      groupNudgeAt: undefined,
      groupTornadoAt: undefined,
    };
    members.add(me);
    send(me, { type: "welcome", nick: me.nick, channels: store.listChannels() });
    run(me, () => join(me, HOME_CHANNEL));

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = parseClientMessage(data.toString());
      if (msg === undefined) return; // ignore anything we don't understand
      run(me, () => handle(me, msg));
    });

    ws.on("close", () => {
      members.delete(me);
      if (!visible(me)) return; // they already looked gone
      for (const other of peersOf(me)) send(other, { type: "quit", nick: me.nick });
    });
  });

  function handle(me: Member, msg: ClientMessage): void {
    switch (msg.type) {
      case "nick": {
        const nick = msg.nick.trim();
        if (!NICK_PATTERN.test(nick)) {
          return reject(me, "invalid_nick", nick, "invalid nick: use 1-24 letters, digits or _-~*^.|[]{} (no spaces)");
        }
        if (nick === me.nick) return;
        if (nickTaken(nick, me)) return reject(me, "nick_taken", nick, `nick already in use: ${nick}`);
        const old = me.nick;
        me.nick = nick;
        const change: ServerMessage = { type: "nick", old, nick };
        if (visible(me)) for (const other of members) send(other, change);
        else send(me, change); // invisible people change nick in private
        return;
      }
      case "join": {
        const channel = normaliseChannel(msg.channel);
        if (!CHANNEL_PATTERN.test(channel)) {
          return reject(me, "invalid_channel", channel, "invalid channel: use # and 1-32 letters, digits, _ or -");
        }
        if (me.channels.has(channel)) return;
        join(me, channel);
        return;
      }
      case "part": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "not_in_channel", channel, `you are not in ${channel}`);
        const part: ServerMessage = { type: "part", channel, nick: me.nick };
        if (visible(me)) sendToChannel(channel, part); // the leaver sees it too
        else send(me, part);
        me.channels.delete(channel);
        me.typingIn.delete(channel);
        return;
      }
      case "say":
      case "me": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        const text = msg.text.trim();
        if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return; // ignored, as before
        // Saved first: if this throws, nothing is broadcast (not saved = not delivered).
        // Speaking while invisible is allowed: the message shows, the person stays out of the list.
        const saved = store.addMessage({
          channel,
          nick: me.nick,
          kind: msg.type,
          text,
          at: new Date().toISOString(),
        });
        me.typingIn.delete(channel); // the others clear "is typing" when the message arrives
        sendToChannel(channel, { type: "message", ...saved });
        return;
      }
      case "topic": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        const topic = msg.topic.trim(); // an empty topic clears it
        if (topic.length > MAX_TOPIC_LENGTH) {
          return reject(me, "topic_too_long", String(MAX_TOPIC_LENGTH), `topic too long (max ${MAX_TOPIC_LENGTH})`);
        }
        const updated = store.setTopic(channel, topic);
        sendToChannel(channel, { type: "topic", channel, topic: updated.topic, nick: me.nick });
        return;
      }
      case "status": {
        const note = msg.note.trim();
        if (note.length > MAX_NOTE_LENGTH) {
          return reject(me, "note_too_long", String(MAX_NOTE_LENGTH), `note too long (max ${MAX_NOTE_LENGTH})`);
        }
        const wasVisible = visible(me);
        me.status = msg.status;
        me.note = note;
        if (!visible(me)) me.typingIn.clear(); // the others saw a quit, which clears it on their side
        const peers = peersOf(me);
        // Going invisible looks exactly like leaving; coming back looks like arriving (MSN did the same).
        if (wasVisible && !visible(me)) for (const other of peers) send(other, { type: "quit", nick: me.nick });
        if (!wasVisible && visible(me)) {
          for (const channel of me.channels) sendToChannel(channel, { type: "join", channel, nick: me.nick }, me);
        }
        const presence: ServerMessage = { type: "presence", nick: me.nick, status: me.status, note: me.note };
        send(me, presence);
        if (visible(me)) for (const other of peers) send(other, presence);
        return;
      }
      case "typing": {
        // Not saved, not logged, and never an error: it is only a hint, so anything odd is dropped.
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel) || !visible(me)) return; // invisible people never give themselves away
        const last = me.typingIn.get(channel);
        if (msg.typing) {
          const now = Date.now();
          if (last !== undefined && now - last < TYPING_MIN_INTERVAL_MS) return;
          me.typingIn.set(channel, now);
        } else {
          if (last === undefined) return; // nothing to stop
          me.typingIn.delete(channel);
        }
        sendToChannel(channel, { type: "typing", channel, nick: me.nick, typing: msg.typing }, me);
        return;
      }
      case "nudge": {
        // Not saved: a nudge is a moment, not history.
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        if (!visible(me)) return reject(me, "invisible_no_nudge", "", "you can't nudge while invisible");
        const now = Date.now();
        if ("everyone" in msg) {
          // Everyone in the channel shakes except the sender (invisible people too: they only receive).
          const last = msg.tornado ? me.groupTornadoAt : me.groupNudgeAt;
          const every = msg.tornado ? GROUP_TORNADO_EVERY_MS : GROUP_NUDGE_EVERY_MS;
          const wait = last === undefined ? 0 : last + every - now;
          if (wait > 0) {
            return reject(me, msg.tornado ? "tornado_too_soon" : "nudge_too_soon", seconds(wait), "one group nudge at a time");
          }
          if (msg.tornado) me.groupTornadoAt = now;
          else me.groupNudgeAt = now;
          sendToChannel(channel, { type: "nudge", channel, from: me.nick, to: null, tornado: msg.tornado });
          return;
        }
        const wanted = msg.nick.trim().toLowerCase();
        // Invisible people get the same answer as nobody at all, so a nudge can't find them.
        const target = membersOf(channel).find((m) => m.nick.toLowerCase() === wanted && (m === me || visible(m)));
        if (target === undefined) return reject(me, "no_such_nick", msg.nick.trim(), `no ${msg.nick.trim()} in ${channel}`);
        if (msg.tornado) {
          const wait = me.tornadoAt === undefined ? 0 : me.tornadoAt + TORNADO_EVERY_MS - now;
          if (wait > 0) return reject(me, "tornado_too_soon", seconds(wait), "one tornado a minute");
          me.tornadoAt = now;
        } else {
          me.nudgedAt = me.nudgedAt.filter((at) => now - at < NUDGE_WINDOW_MS);
          const oldest = me.nudgedAt[0];
          if (me.nudgedAt.length >= NUDGE_BURST && oldest !== undefined) {
            return reject(me, "nudge_too_soon", seconds(oldest + NUDGE_WINDOW_MS - now), "too many nudges");
          }
          me.nudgedAt.push(now);
        }
        sendToChannel(channel, { type: "nudge", channel, from: me.nick, to: target.nick, tornado: msg.tornado });
        return;
      }
    }
  }

  // Joining creates the channel if it doesn't exist yet (anyone can create one).
  function join(me: Member, channel: string): void {
    const created = store.createChannel(channel, new Date().toISOString());
    if (visible(me)) sendToChannel(channel, { type: "join", channel, nick: me.nick }); // the others already in it
    me.channels.add(channel);
    send(me, {
      type: "joined",
      channel,
      topic: created.topic,
      members: membersOf(channel)
        .filter((m) => m === me || visible(m))
        .map(info),
      history: store.recentMessages(channel, HISTORY_LIMIT),
    });
  }

  // A failing store must never crash the server or kill the connection.
  function run(me: Member, action: () => void): void {
    try {
      action();
    } catch (err) {
      console.error(`could not handle a request: ${err instanceof Error ? err.message : String(err)}`);
      reject(me, "internal", "", "something went wrong, please try again");
    }
  }

  function newGuestNick(): string {
    let nick: string;
    do {
      guestCounter += 1;
      nick = `${GUEST_PREFIX}${guestCounter}`;
    } while (nickTaken(nick));
    return nick;
  }

  // Nicks are unique, ignoring case: "Rita" and "rita" can't both be online (invisible people count too).
  function nickTaken(nick: string, except?: Member): boolean {
    const wanted = nick.toLowerCase();
    for (const m of members) if (m !== except && m.nick.toLowerCase() === wanted) return true;
    return false;
  }

  function membersOf(channel: string): Member[] {
    return [...members].filter((m) => m.channels.has(channel));
  }

  // Everyone who shares at least one channel with this person, once each.
  function peersOf(me: Member): Set<Member> {
    const peers = new Set<Member>();
    for (const channel of me.channels) for (const m of membersOf(channel)) if (m !== me) peers.add(m);
    return peers;
  }

  function sendToChannel(channel: string, msg: ServerMessage, except?: Member): void {
    const data = JSON.stringify(msg);
    for (const m of membersOf(channel)) if (m !== except) sendRaw(m, data);
  }

  function reject(me: Member, code: ErrorCode, detail: string, reason: string): void {
    send(me, { type: "error", code, detail, reason });
  }

  return {
    // Say goodbye to every client (1001 = going away), force-close stragglers, then stop.
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.close(1001, "server shutting down");
        const force = setTimeout(() => {
          for (const client of wss.clients) client.terminate();
        }, CLOSE_GRACE_MS);
        force.unref();
        wss.close(() => {
          clearTimeout(force);
          resolve();
        });
      }),
  };
}

function visible(m: Member): boolean {
  return m.status !== "invisible";
}

function info(m: Member): MemberInfo {
  return { nick: m.nick, status: m.status, note: m.note };
}

function send(member: Member, msg: ServerMessage): void {
  sendRaw(member, JSON.stringify(msg));
}

function sendRaw(member: Member, data: string): void {
  if (member.ws.readyState === WebSocket.OPEN) member.ws.send(data);
}

function seconds(ms: number): string {
  return String(Math.max(1, Math.ceil(ms / 1000)));
}

function normaliseChannel(name: string): string {
  return name.trim().toLowerCase();
}

// Never trust the client: check the shape here; the handlers check the meaning.
function parseClientMessage(raw: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const field = v[key];
    return typeof field === "string" ? field : undefined;
  };

  switch (v.type) {
    case "nick": {
      const nick = str("nick");
      return nick === undefined ? undefined : { type: "nick", nick };
    }
    case "join":
    case "part": {
      const channel = str("channel");
      return channel === undefined ? undefined : { type: v.type, channel };
    }
    case "say":
    case "me": {
      const channel = str("channel");
      const text = str("text");
      return channel === undefined || text === undefined ? undefined : { type: v.type, channel, text };
    }
    case "topic": {
      const channel = str("channel");
      const topic = str("topic");
      return channel === undefined || topic === undefined ? undefined : { type: "topic", channel, topic };
    }
    case "status": {
      const status = STATUSES.find((s) => s === v.status);
      const note = str("note") ?? "";
      return status === undefined ? undefined : { type: "status", status, note };
    }
    case "typing": {
      const channel = str("channel");
      return channel === undefined || typeof v.typing !== "boolean" ? undefined : { type: "typing", channel, typing: v.typing };
    }
    case "nudge": {
      const channel = str("channel");
      const nick = str("nick");
      const tornado = v.tornado === true;
      if (channel === undefined) return undefined;
      if (v.everyone === true) return { type: "nudge", channel, everyone: true, tornado };
      return nick === undefined ? undefined : { type: "nudge", channel, nick, tornado };
    }
    default:
      return undefined;
  }
}
