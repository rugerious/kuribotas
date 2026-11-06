import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ErrorCode, Member as MemberInfo, ServerMessage, Status, ThrowItem } from "../../shared/protocol.ts";
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
  thrownAt: number[]; // recent chinelas, vassouras and colheres
  batuqueAt: number | undefined; // the last batuque
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
const THROW_BURST = 3; // chinelas, vassouras and colheres together...
const THROW_WINDOW_MS = 10_000; // ...in this window
const BATUQUE_EVERY_MS = 60_000; // a batuque for the whole channel: once a minute
const STATUSES: readonly Status[] = ["online", "away", "busy", "invisible"];
const THROW_ITEMS: readonly ThrowItem[] = ["chinela", "vassoura", "colher", "batuque"];

// Nicks: 1-24 letters (any language), digits or _-~*^.|[]{} — so "~*~Rita~*~" works, spaces don't.
const NICK_PATTERN = /^[\p{L}\p{N}_\-~*^.|[\]{}]{1,24}$/u;
// Channels: "#" + 1-32 letters, digits, _ or -. Stored in lower case: #Futebol and #futebol are one channel.
const CHANNEL_PATTERN = /^#[\p{L}\p{N}_-]{1,32}$/u;

export type Chat = { close: () => Promise<void> };

// A private channel lives in memory until its last member leaves: no row in the database, no saved
// messages, hidden from the channel list. Only invited connections may join (accounts come in phase 4).
type PrivateChannel = { topic: string; invited: Set<Member> };

export function attachChat(server: Server, store: Store): Chat {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const members = new Set<Member>();
  const privates = new Map<string, PrivateChannel>();
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
      thrownAt: [],
      batuqueAt: undefined,
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
      const peers = peersOf(me);
      members.delete(me);
      for (const channel of me.channels) forgetPrivate(channel, me);
      for (const p of privates.values()) p.invited.delete(me);
      if (!visible(me)) return; // they already looked gone
      for (const other of peers) send(other, { type: "quit", nick: me.nick });
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
        const secret = privates.get(channel);
        if (msg.private === true && secret === undefined) {
          if (store.listChannels().some((c) => c.name === channel)) {
            return reject(me, "channel_exists", channel, `${channel} is already a public channel`);
          }
          privates.set(channel, { topic: "", invited: new Set([me]) });
        } else if (secret !== undefined && !secret.invited.has(me)) {
          return reject(me, "invite_only", channel, `${channel} is private: ask a member to /invite you`);
        }
        join(me, channel);
        return;
      }
      case "throw": {
        // Not saved, like a nudge. Everyone in the channel sees it fly; the target gets hit.
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        if (!visible(me)) return reject(me, "invisible_no_nudge", "", "you can't throw things while invisible");
        const now = Date.now();
        if (msg.item === "batuque") {
          const wait = me.batuqueAt === undefined ? 0 : me.batuqueAt + BATUQUE_EVERY_MS - now;
          if (wait > 0) return reject(me, "batuque_too_soon", seconds(wait), "one batuque a minute");
          me.batuqueAt = now;
          sendToChannel(channel, { type: "throw", channel, from: me.nick, to: null, item: "batuque" });
          return;
        }
        const wanted = (msg.nick ?? "").trim().toLowerCase();
        const target = membersOf(channel).find((m) => m.nick.toLowerCase() === wanted && (m === me || visible(m)));
        if (target === undefined) {
          return reject(me, "no_such_nick", (msg.nick ?? "").trim(), `no ${msg.nick ?? ""} in ${channel}`);
        }
        me.thrownAt = me.thrownAt.filter((at) => now - at < THROW_WINDOW_MS);
        const oldest = me.thrownAt[0];
        if (me.thrownAt.length >= THROW_BURST && oldest !== undefined) {
          return reject(me, "throw_too_soon", seconds(oldest + THROW_WINDOW_MS - now), "too many throws");
        }
        me.thrownAt.push(now);
        sendToChannel(channel, { type: "throw", channel, from: me.nick, to: target.nick, item: msg.item });
        return;
      }
      case "invite": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        const target = findVisible(msg.nick, me);
        if (target === undefined) return reject(me, "no_such_nick", msg.nick.trim(), `nobody called ${msg.nick.trim()}`);
        if (target.channels.has(channel)) {
          return reject(me, "already_in_channel", target.nick, `${target.nick} is already in ${channel}`);
        }
        privates.get(channel)?.invited.add(target); // a public channel needs no ticket: the invite is just a nudge to come
        const invited: ServerMessage = { type: "invited", channel, from: me.nick, to: target.nick };
        send(target, invited);
        if (target !== me) send(me, invited);
        return;
      }
      case "msg": {
        // Not saved, not logged: it goes to the other person (and back to the sender) and nowhere else.
        // Invisible people can't be found, but may write to someone (that is their choice to show up).
        const text = msg.text.trim();
        if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return;
        const target = findVisible(msg.to, me);
        if (target === undefined) return reject(me, "no_such_nick", msg.to.trim(), `nobody called ${msg.to.trim()}`);
        const dm: ServerMessage = { type: "dm", from: me.nick, to: target.nick, kind: msg.kind, text, at: new Date().toISOString() };
        send(target, dm);
        if (target !== me) send(me, dm);
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
        forgetPrivate(channel, me);
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
        // Private channels are never saved (until accounts): their messages get id 0.
        const said = { channel, nick: me.nick, kind: msg.type, text, at: new Date().toISOString() };
        const saved = privates.has(channel) ? { id: 0, ...said } : store.addMessage(said);
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
        const secret = privates.get(channel);
        if (secret !== undefined) secret.topic = topic;
        const updated = secret === undefined ? store.setTopic(channel, topic).topic : topic;
        sendToChannel(channel, { type: "topic", channel, topic: updated, nick: me.nick });
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
        if ("to" in msg) {
          // In a private chat: keyed "@nick" so it shares the rate limit machinery with channels.
          if (!visible(me)) return;
          const target = findVisible(msg.to, me);
          if (target === undefined || target === me) return;
          const key = `@${target.nick.toLowerCase()}`;
          const last = me.typingIn.get(key);
          if (msg.typing) {
            const now = Date.now();
            if (last !== undefined && now - last < TYPING_MIN_INTERVAL_MS) return;
            me.typingIn.set(key, now);
          } else {
            if (last === undefined) return;
            me.typingIn.delete(key);
          }
          send(target, { type: "typing", dm: true, nick: me.nick, typing: msg.typing });
          return;
        }
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
        if ("to" in msg) {
          // In a private chat (MSN's home): same limits as a nudge in a channel.
          if (!visible(me)) return reject(me, "invisible_no_nudge", "", "you can't nudge while invisible");
          const target = findVisible(msg.to, me);
          if (target === undefined) return reject(me, "no_such_nick", msg.to.trim(), `nobody called ${msg.to.trim()}`);
          const wait = nudgeWait(me, msg.tornado, Date.now());
          if (wait !== null) return reject(me, wait.code, wait.seconds, "too many nudges");
          const dm: ServerMessage = { type: "nudge", dm: true, from: me.nick, to: target.nick, tornado: msg.tornado };
          send(target, dm);
          if (target !== me) send(me, dm);
          return;
        }
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
        const wait = nudgeWait(me, msg.tornado, now);
        if (wait !== null) return reject(me, wait.code, wait.seconds, "too many nudges");
        sendToChannel(channel, { type: "nudge", channel, from: me.nick, to: target.nick, tornado: msg.tornado });
        return;
      }
    }
  }

  // Joining creates the channel if it doesn't exist yet (anyone can create one).
  // Private channels were checked and created by the caller; they have no row and no history.
  function join(me: Member, channel: string): void {
    const secret = privates.get(channel);
    const topic = secret?.topic ?? store.createChannel(channel, new Date().toISOString()).topic;
    if (visible(me)) sendToChannel(channel, { type: "join", channel, nick: me.nick }); // the others already in it
    me.channels.add(channel);
    send(me, {
      type: "joined",
      channel,
      topic,
      members: membersOf(channel)
        .filter((m) => m === me || visible(m))
        .map(info),
      history: secret === undefined ? store.recentMessages(channel, HISTORY_LIMIT) : [],
      private: secret !== undefined,
    });
  }

  // Personal nudges (channel or private chat): 3 quick ones per 10 s, one tornado a minute.
  // Returns what to refuse with, or null after counting this one.
  function nudgeWait(me: Member, tornado: boolean, now: number): { code: ErrorCode; seconds: string } | null {
    if (tornado) {
      const wait = me.tornadoAt === undefined ? 0 : me.tornadoAt + TORNADO_EVERY_MS - now;
      if (wait > 0) return { code: "tornado_too_soon", seconds: seconds(wait) };
      me.tornadoAt = now;
      return null;
    }
    me.nudgedAt = me.nudgedAt.filter((at) => now - at < NUDGE_WINDOW_MS);
    const oldest = me.nudgedAt[0];
    if (me.nudgedAt.length >= NUDGE_BURST && oldest !== undefined) {
      return { code: "nudge_too_soon", seconds: seconds(oldest + NUDGE_WINDOW_MS - now) };
    }
    me.nudgedAt.push(now);
    return null;
  }

  // When the last member leaves a private channel, it is gone: name, topic and invites.
  function forgetPrivate(channel: string, leaving: Member): void {
    const secret = privates.get(channel);
    if (secret === undefined) return;
    secret.invited.delete(leaving); // leaving means asking again to come back
    if (membersOf(channel).every((m) => m === leaving)) privates.delete(channel);
  }

  // Someone online by nick (any case). Invisible people are not found, except by themselves.
  function findVisible(nick: string, asking: Member): Member | undefined {
    const wanted = nick.trim().toLowerCase();
    return [...members].find((m) => m.nick.toLowerCase() === wanted && (m === asking || visible(m)));
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
    case "join": {
      const channel = str("channel");
      return channel === undefined ? undefined : { type: "join", channel, private: v.private === true };
    }
    case "part": {
      const channel = str("channel");
      return channel === undefined ? undefined : { type: "part", channel };
    }
    case "invite": {
      const channel = str("channel");
      const nick = str("nick");
      return channel === undefined || nick === undefined ? undefined : { type: "invite", channel, nick };
    }
    case "throw": {
      const channel = str("channel");
      const item = THROW_ITEMS.find((i) => i === v.item);
      const nick = str("nick");
      if (channel === undefined || item === undefined) return undefined;
      if (item === "batuque") return { type: "throw", channel, item };
      return nick === undefined ? undefined : { type: "throw", channel, item, nick };
    }
    case "msg": {
      const to = str("to");
      const text = str("text");
      const kind = v.kind === "me" ? "me" : "say";
      return to === undefined || text === undefined ? undefined : { type: "msg", to, kind, text };
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
      const to = str("to");
      if (typeof v.typing !== "boolean") return undefined;
      if (to !== undefined) return { type: "typing", to, typing: v.typing };
      return channel === undefined ? undefined : { type: "typing", channel, typing: v.typing };
    }
    case "nudge": {
      const to = str("to");
      if (to !== undefined) return { type: "nudge", to, tornado: v.tornado === true };
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
