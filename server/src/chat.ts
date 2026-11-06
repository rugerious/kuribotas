import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ErrorCode, Member as MemberInfo, ServerMessage, Status, ThrowItem } from "../../shared/protocol.ts";
import { makeInvite } from "./auth.ts";
import { isValidSubscription, type PushSend } from "./push.ts";
import { NICK_PATTERN, type Person, type PushRow, type Role, type Store } from "./store.ts";

// Someone with an account, as the chat sees them: one nick, one status, one set of limits, however many
// devices they have open. Kept after they leave, so a reload doesn't reset the tornado limit.
type Someone = {
  id: number;
  nick: string;
  role: Role;
  status: Status;
  note: string;
  nudgedAt: number[]; // when their recent quick nudges were sent
  tornadoAt: number | undefined; // when they last sent a tornado
  groupNudgeAt: number | undefined; // ...a nudge to the whole channel
  groupTornadoAt: number | undefined; // ...a tornado to the whole channel
  thrownAt: number[]; // recent chinelas, vassouras and colheres
  batuqueAt: number | undefined; // the last batuque
};

// One open connection: a phone, a computer. Each device has its own tabs (channels); nick and status
// belong to the person. `typingIn`: channel -> when we last passed on "is typing".
class Member {
  ws: WebSocket;
  who: Someone;
  session: string; // the session's hash: signing that device out closes this connection
  alive = true; // answered the last heartbeat ping
  channels = new Set<string>();
  typingIn = new Map<string, number>();
  push: Pick<PushRow, "endpoint" | "p256dh" | "auth" | "lang"> | undefined = undefined; // this device's notifications

  constructor(ws: WebSocket, who: Someone, session: string) {
    this.ws = ws;
    this.who = who;
    this.session = session;
  }

  get nick(): string {
    return this.who.nick;
  }
  set nick(nick: string) {
    this.who.nick = nick;
  }
  get status(): Status {
    return this.who.status;
  }
  set status(status: Status) {
    this.who.status = status;
  }
  get note(): string {
    return this.who.note;
  }
  set note(note: string) {
    this.who.note = note;
  }
}

const HOME_CHANNEL = "#mujimbo"; // everyone lands here
const HISTORY_LIMIT = 50; // messages sent when joining a channel
const MAX_TEXT_LENGTH = 2000; // characters per chat message
const MAX_TOPIC_LENGTH = 200; // characters per topic
const MAX_NOTE_LENGTH = 80; // characters in the line under your name
const MAX_PAYLOAD_BYTES = 16 * 1024; // larger frames are rejected by ws (close code 1009)
const CLOSE_GRACE_MS = 3000; // on shutdown, wait this long before force-closing clients
// A phone that locks or loses signal can leave a connection that looks open but is dead, holding its
// nick. Every heartbeat each connection is pinged; one that didn't answer the previous ping is dropped.
const HEARTBEAT_MS = 25_000;
const TYPING_MIN_INTERVAL_MS = 2000; // "is typing" passed on at most this often per person and channel
const NUDGE_BURST = 3; // quick nudges allowed...
const NUDGE_WINDOW_MS = 10_000; // ...in this window
const TORNADO_EVERY_MS = 60_000; // one tornado a minute: an event, not spam
const GROUP_NUDGE_EVERY_MS = 60_000; // the whole channel: once a minute
const GROUP_TORNADO_EVERY_MS = 300_000; // a tornado for everyone: once every 5 minutes
const THROW_BURST = 3; // chinelas, vassouras and colheres together...
const THROW_WINDOW_MS = 10_000; // ...in this window
const BATUQUE_EVERY_MS = 60_000; // a batuque for the whole channel: once a minute
const MENTION_PUSH_EVERY_MS = 20_000; // at most one mention notification per device in this time
const MAX_PUSH_TEXT = 140; // characters of a message shown in a notification
const STATUSES: readonly Status[] = ["online", "away", "busy", "invisible"];
const THROW_ITEMS: readonly ThrowItem[] = ["chinela", "vassoura", "colher", "batuque"];

// Channels: "#" + 1-32 letters, digits, _ or -. Stored in lower case: #Futebol and #futebol are one channel.
const CHANNEL_PATTERN = /^#[\p{L}\p{N}_-]{1,32}$/u;

export type Chat = {
  close: () => Promise<void>;
  signOut: (sessionHash: string) => void; // close the connections of a device that signed out
};

// Who may open the chat: the signed-in person, or why not (no session; another site's page).
export type Admit = (req: IncomingMessage) => { person: Person; sessionHash: string } | "signed_out" | "forbidden";

// Close code for a device whose session ended: the app goes back to the door instead of reconnecting.
export const SIGNED_OUT = 4401;

// A private channel lives in memory until its last member leaves: no row in the database, no saved
// messages, hidden from the channel list. Only invited people may join; leaving means asking again.
type PrivateChannel = { topic: string; invited: Set<number> };

export function attachChat(
  server: Server,
  store: Store,
  options: { heartbeatMs?: number; pushSend?: PushSend; admit?: Admit } = {},
): Chat {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const members = new Set<Member>();
  const people = new Map<number, Someone>();
  const privates = new Map<string, PrivateChannel>();
  const lastMentionPush = new Map<string, number>(); // endpoint -> when

  // Only /ws may upgrade to a WebSocket, only from our own page, and only for someone signed in.
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const admitted = url.pathname === "/ws" && options.admit !== undefined ? options.admit(req) : "forbidden";
    if (typeof admitted === "string") {
      socket.end(admitted === "signed_out" ? "HTTP/1.1 401 Unauthorized\r\n\r\n" : "HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, admitted);
    });
  });

  const heartbeat = setInterval(() => {
    for (const m of members) {
      if (!m.alive) {
        m.ws.terminate(); // its "close" handler tells the others it left
        continue;
      }
      m.alive = false;
      m.ws.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();

  wss.on("connection", (ws, admitted: { person: Person; sessionHash: string }) => {
    // Without an error listener, one bad client (e.g. an oversized frame) would crash the process.
    ws.on("error", (err) => {
      console.warn(`websocket error: ${err.message}`);
    });

    const { person } = admitted;
    const who = people.get(person.id) ?? {
      id: person.id,
      nick: person.nick,
      role: person.role,
      status: "online",
      note: "",
      nudgedAt: [],
      tornadoAt: undefined,
      groupNudgeAt: undefined,
      groupTornadoAt: undefined,
      thrownAt: [],
      batuqueAt: undefined,
    };
    people.set(person.id, who);
    who.nick = person.nick; // the database is the truth (a nick changed on another device)
    who.role = person.role;
    if (devicesOf(who).length === 0) {
      who.status = "online"; // a fresh arrival; the app puts its status back if it had one
      who.note = "";
    }
    const me = new Member(ws, who, admitted.sessionHash);
    ws.on("pong", () => {
      me.alive = true;
    });
    members.add(me);
    send(me, { type: "welcome", nick: me.nick, role: who.role, channels: store.listChannels() });
    run(me, () => join(me, HOME_CHANNEL));

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = parseClientMessage(data.toString());
      if (msg === undefined) return; // ignore anything we don't understand
      run(me, () => handle(me, msg));
    });

    ws.on("close", () => {
      members.delete(me);
      const left = [...me.channels].filter((channel) => !personIn(who, channel)); // no other device of theirs there
      for (const channel of left) forgetPrivate(channel, who);
      const gone = devicesOf(who).length === 0;
      if (gone) for (const p of privates.values()) p.invited.delete(who.id);
      if (!visible(me)) return; // they already looked gone
      if (!gone) {
        // Still here on another device: only the channels this one alone was in see them leave.
        for (const channel of left) sendToChannel(channel, { type: "part", channel, nick: me.nick });
        return;
      }
      const peers = new Set<Member>();
      for (const channel of me.channels) for (const m of membersOf(channel)) peers.add(m);
      for (const other of peers) send(other, { type: "quit", nick: me.nick });
    });
  });

  function handle(me: Member, msg: ClientMessage): void {
    const who = me.who;
    switch (msg.type) {
      case "nick": {
        const nick = msg.nick.trim();
        if (!NICK_PATTERN.test(nick)) {
          return reject(me, "invalid_nick", nick, "invalid nick: use 1-24 letters, digits or _-~*^.|[]{} (no spaces)");
        }
        if (nick === me.nick) return;
        // A nick belongs to one person, online or not: it's saved with their account.
        if (!store.renamePerson(who.id, nick)) return reject(me, "nick_taken", nick, `nick already in use: ${nick}`);
        const old = me.nick;
        me.nick = nick;
        store.renamePush(old, nick); // notifications follow, on every device
        const change: ServerMessage = { type: "nick", old, nick };
        if (visible(me)) for (const other of members) send(other, change);
        else sendPerson(who, change); // invisible people change nick in private
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
          privates.set(channel, { topic: "", invited: new Set([who.id]) });
        } else if (secret !== undefined && !secret.invited.has(who.id)) {
          return reject(me, "invite_only", channel, `${channel} is private: ask a member to /invite you`);
        }
        join(me, channel);
        syncPush(me);
        return;
      }
      case "throw": {
        // Not saved, like a nudge. Everyone in the channel sees it fly; the target gets hit.
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        if (!visible(me)) return reject(me, "invisible_no_nudge", "", "you can't throw things while invisible");
        const now = Date.now();
        if (msg.item === "batuque") {
          const wait = me.who.batuqueAt === undefined ? 0 : me.who.batuqueAt + BATUQUE_EVERY_MS - now;
          if (wait > 0) return reject(me, "batuque_too_soon", seconds(wait), "one batuque a minute");
          me.who.batuqueAt = now;
          sendToChannel(channel, { type: "throw", channel, from: me.nick, to: null, item: "batuque" });
          return;
        }
        const wanted = (msg.nick ?? "").trim().toLowerCase();
        const target = membersOf(channel).find((m) => m.nick.toLowerCase() === wanted && (m.who === who || visible(m)));
        const away = target === undefined ? awayDevices(msg.nick ?? "", channel) : [];
        if (target === undefined && away.length === 0) {
          return reject(me, "no_such_nick", (msg.nick ?? "").trim(), `no ${msg.nick ?? ""} in ${channel}`);
        }
        me.who.thrownAt = me.who.thrownAt.filter((at) => now - at < THROW_WINDOW_MS);
        const oldest = me.who.thrownAt[0];
        if (me.who.thrownAt.length >= THROW_BURST && oldest !== undefined) {
          return reject(me, "throw_too_soon", seconds(oldest + THROW_WINDOW_MS - now), "too many throws");
        }
        me.who.thrownAt.push(now);
        const to = target?.nick ?? away[0]?.nick ?? wanted;
        sendToChannel(channel, { type: "throw", channel, from: me.nick, to, item: msg.item });
        for (const row of away) notify(row, msg.item, me.nick, channel, "", "high");
        return;
      }
      case "invite": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        const target = findVisible(msg.nick, me);
        if (target === undefined) return reject(me, "no_such_nick", msg.nick.trim(), `nobody called ${msg.nick.trim()}`);
        if (personIn(target.who, channel)) {
          return reject(me, "already_in_channel", target.nick, `${target.nick} is already in ${channel}`);
        }
        privates.get(channel)?.invited.add(target.who.id); // a public channel needs no ticket: the invite is just a nudge to come
        const invited: ServerMessage = { type: "invited", channel, from: me.nick, to: target.nick };
        sendPerson(target.who, invited);
        if (target.who !== who) sendPerson(who, invited);
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
        sendPerson(target.who, dm); // every device of theirs, and of mine
        if (target.who !== who) sendPerson(who, dm);
        return;
      }
      case "part": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "not_in_channel", channel, `you are not in ${channel}`);
        const part: ServerMessage = { type: "part", channel, nick: me.nick };
        const elsewhere = devicesOf(who).some((d) => d !== me && d.channels.has(channel)); // still there on another device
        if (visible(me) && !elsewhere) sendToChannel(channel, part); // the leaver sees it too
        else send(me, part);
        me.channels.delete(channel);
        me.typingIn.delete(channel);
        if (!elsewhere) forgetPrivate(channel, who);
        syncPush(me);
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
        if (!privates.has(channel)) notifyMentions(me, channel, text);
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
        me.status = msg.status; // for every device of theirs: status is the person's
        me.note = note;
        if (!visible(me)) for (const d of devicesOf(who)) d.typingIn.clear(); // the others saw a quit, which clears it
        const peers = peersOf(who);
        // Going invisible looks exactly like leaving; coming back looks like arriving (MSN did the same).
        if (wasVisible && !visible(me)) for (const other of peers) send(other, { type: "quit", nick: me.nick });
        if (!wasVisible && visible(me)) {
          for (const channel of channelsOf(who)) sendToChannel(channel, { type: "join", channel, nick: me.nick }, who);
        }
        const presence: ServerMessage = { type: "presence", nick: me.nick, status: me.status, note: me.note };
        sendPerson(who, presence);
        if (visible(me)) for (const other of peers) send(other, presence);
        for (const d of devicesOf(who)) syncPush(d); // No biolo = quiet
        return;
      }
      case "push": {
        if (msg.subscription === null) {
          if (me.push !== undefined) store.deletePush(me.push.endpoint);
          me.push = undefined;
          return;
        }
        if (!isValidSubscription(msg.subscription)) return reject(me, "push_invalid", "", "not a push service subscription");
        const { endpoint, keys } = msg.subscription;
        me.push = { endpoint, p256dh: keys.p256dh, auth: keys.auth, lang: msg.lang };
        syncPush(me);
        return;
      }
      case "make_invite": {
        // A link for one new person (7 days, once). Only to the @ who asked: they decide who gets it.
        if (who.role !== "admin") return reject(me, "not_op", "", "only an @ can invite");
        const { token, expiresAt } = makeInvite(store, "person", { personId: null, role: "member", createdBy: who.id });
        send(me, { type: "link", kind: "person", token, expiresAt });
        return;
      }
      case "make_device_link": {
        // Your phone makes a code for your computer (10 minutes, once). Anyone can, for themselves.
        const { token, expiresAt } = makeInvite(store, "device", { personId: who.id, role: who.role, createdBy: who.id });
        send(me, { type: "link", kind: "device", token, expiresAt });
        return;
      }
      case "devices": {
        sendDevices(me);
        return;
      }
      case "forget_device": {
        // A lost phone, an old computer: its session ends, its chat closes, its notifications stop.
        const hash = store.deleteSessionById(who.id, msg.id);
        if (hash === undefined) return reject(me, "no_such_device", String(msg.id), `no device ${msg.id}`);
        if (hash !== me.session) sendDevices(me);
        endSession(hash);
        return;
      }
      case "role": {
        if (who.role !== "admin") return reject(me, "not_op", "", "only an @ can give or take @");
        const target = store.personByNick(msg.nick.trim());
        if (target === undefined) return reject(me, "no_such_person", msg.nick.trim(), `nobody called ${msg.nick.trim()}`);
        if (target.id === who.id && msg.role === "member") {
          return reject(me, "cant_deop_self", "", "another @ has to take your @"); // so there's always an @
        }
        if (target.role === msg.role) return;
        store.setRole(target.id, msg.role);
        const online = people.get(target.id);
        if (online !== undefined) online.role = msg.role;
        const changed: ServerMessage = { type: "role", nick: target.nick, role: msg.role, by: me.nick };
        for (const m of members) send(m, changed);
        return;
      }
      case "remove": {
        // Out of Kuribotas: account, devices, invites and notifications. Their messages stay in the history.
        if (who.role !== "admin") return reject(me, "not_op", "", "only an @ can remove someone");
        const target = store.personByNick(msg.nick.trim());
        if (target === undefined) return reject(me, "no_such_person", msg.nick.trim(), `nobody called ${msg.nick.trim()}`);
        if (target.role === "admin") return reject(me, "cant_remove_op", target.nick, `take ${target.nick}'s @ first`);
        const removed: ServerMessage = { type: "removed", nick: target.nick, by: me.nick };
        for (const m of members) send(m, removed);
        store.deletePerson(target.id);
        for (const m of members) if (m.who.id === target.id) m.ws.close(SIGNED_OUT, "removed");
        people.delete(target.id);
        return;
      }
      case "typing": {
        // Not saved, not logged, and never an error: it is only a hint, so anything odd is dropped.
        if ("to" in msg) {
          // In a private chat: keyed "@nick" so it shares the rate limit machinery with channels.
          if (!visible(me)) return;
          const target = findVisible(msg.to, me);
          if (target === undefined || target.who === who) return;
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
          sendPerson(target.who, { type: "typing", dm: true, nick: me.nick, typing: msg.typing });
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
        sendToChannel(channel, { type: "typing", channel, nick: me.nick, typing: msg.typing }, who);
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
          sendPerson(target.who, dm);
          if (target.who !== who) sendPerson(who, dm);
          return;
        }
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, "join_first", channel, `join ${channel} first`);
        if (!visible(me)) return reject(me, "invisible_no_nudge", "", "you can't nudge while invisible");
        const now = Date.now();
        if ("everyone" in msg) {
          // Everyone in the channel shakes except the sender (invisible people too: they only receive).
          const last = msg.tornado ? me.who.groupTornadoAt : me.who.groupNudgeAt;
          const every = msg.tornado ? GROUP_TORNADO_EVERY_MS : GROUP_NUDGE_EVERY_MS;
          const wait = last === undefined ? 0 : last + every - now;
          if (wait > 0) {
            return reject(me, msg.tornado ? "tornado_too_soon" : "nudge_too_soon", seconds(wait), "one group nudge at a time");
          }
          if (msg.tornado) me.who.groupTornadoAt = now;
          else me.who.groupNudgeAt = now;
          sendToChannel(channel, { type: "nudge", channel, from: me.nick, to: null, tornado: msg.tornado });
          return;
        }
        const wanted = msg.nick.trim().toLowerCase();
        // Invisible people get the same answer as nobody at all, so a nudge can't find them.
        const target = membersOf(channel).find((m) => m.nick.toLowerCase() === wanted && (m.who === who || visible(m)));
        // Not here, but their phone asked for notifications from this channel: the nudge reaches the pocket.
        const away = target === undefined ? awayDevices(msg.nick, channel) : [];
        if (target === undefined && away.length === 0) {
          return reject(me, "no_such_nick", msg.nick.trim(), `no ${msg.nick.trim()} in ${channel}`);
        }
        const wait = nudgeWait(me, msg.tornado, now);
        if (wait !== null) return reject(me, wait.code, wait.seconds, "too many nudges");
        const to = target?.nick ?? away[0]?.nick ?? msg.nick.trim();
        sendToChannel(channel, { type: "nudge", channel, from: me.nick, to, tornado: msg.tornado });
        for (const row of away) notify(row, msg.tornado ? "tornado" : "nudge", me.nick, channel, "", "high");
        return;
      }
    }
  }

  // Joining creates the channel if it doesn't exist yet (anyone can create one).
  // Private channels were checked and created by the caller; they have no row and no history.
  function join(me: Member, channel: string): void {
    const secret = privates.get(channel);
    const topic = secret?.topic ?? store.createChannel(channel, new Date().toISOString()).topic;
    // The others already in it see them arrive, unless they're already there on another device.
    if (visible(me) && !personIn(me.who, channel)) sendToChannel(channel, { type: "join", channel, nick: me.nick });
    me.channels.add(channel);
    const listed = new Map<Someone, Member>(); // one line per person, however many devices
    for (const m of membersOf(channel)) if (m.who === me.who || visible(m)) listed.set(m.who, m);
    send(me, {
      type: "joined",
      channel,
      topic,
      members: [...listed.values()].map(info),
      history: secret === undefined ? store.recentMessages(channel, HISTORY_LIMIT) : [],
      private: secret !== undefined,
    });
  }

  // --- notifications -------------------------------------------------------------------------
  // A device's subscription follows its person: nick, public channels, and No biolo (= quiet).
  function syncPush(me: Member): void {
    if (me.push === undefined) return;
    const channels = [...me.channels].filter((c) => !privates.has(c));
    store.savePush({
      ...me.push,
      nick: me.nick,
      channels,
      quiet: me.status === "busy",
      at: new Date().toISOString(),
      session: me.session,
    });
  }

  const connected = (nick: string): boolean => [...members].some((m) => m.nick.toLowerCase() === nick.toLowerCase());

  // Devices of someone who isn't connected, asked for notifications from this channel, and isn't No biolo.
  function awayDevices(nick: string, channel: string): PushRow[] {
    if (nick.trim() === "" || connected(nick.trim())) return [];
    return store.pushFor(nick.trim()).filter((r) => r.channels.includes(channel) && !r.quiet);
  }

  // "Estraga_Lar, vens jantar?" notifies Estraga_Lar's phone if they're away. Public channels only.
  function notifyMentions(me: Member, channel: string, text: string): void {
    const now = Date.now();
    for (const row of store.pushInChannel(channel)) {
      if (row.quiet || row.nick.toLowerCase() === me.nick.toLowerCase() || connected(row.nick)) continue;
      if (!mentions(text, row.nick)) continue;
      if (now - (lastMentionPush.get(row.endpoint) ?? 0) < MENTION_PUSH_EVERY_MS) continue;
      lastMentionPush.set(row.endpoint, now);
      notify(row, "mention", me.nick, channel, text, "normal");
    }
  }

  // Fire and forget: a failure is logged (never the message), a device that is gone is forgotten.
  function notify(row: PushRow, kind: PushKind, from: string, channel: string, text: string, urgency: "normal" | "high"): void {
    const pushSend = options.pushSend;
    if (pushSend === undefined) return;
    const payload = JSON.stringify({ ...pushText(row.lang, kind, from, channel, text), tag: `${kind}-${channel}` });
    pushSend({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, urgency)
      .then((status) => {
        if (status === 404 || status === 410) store.deletePush(row.endpoint);
        else if (status >= 400) console.warn(`push refused: ${status}`);
      })
      .catch((err: unknown) => console.warn(`push failed: ${err instanceof Error ? err.name : "error"}`));
  }

  // Personal nudges (channel or private chat): 3 quick ones per 10 s, one tornado a minute.
  // Returns what to refuse with, or null after counting this one.
  function nudgeWait(me: Member, tornado: boolean, now: number): { code: ErrorCode; seconds: string } | null {
    if (tornado) {
      const wait = me.who.tornadoAt === undefined ? 0 : me.who.tornadoAt + TORNADO_EVERY_MS - now;
      if (wait > 0) return { code: "tornado_too_soon", seconds: seconds(wait) };
      me.who.tornadoAt = now;
      return null;
    }
    me.who.nudgedAt = me.who.nudgedAt.filter((at) => now - at < NUDGE_WINDOW_MS);
    const oldest = me.who.nudgedAt[0];
    if (me.who.nudgedAt.length >= NUDGE_BURST && oldest !== undefined) {
      return { code: "nudge_too_soon", seconds: seconds(oldest + NUDGE_WINDOW_MS - now) };
    }
    me.who.nudgedAt.push(now);
    return null;
  }

  // Called once a person is no longer in a private channel on any device. The last one out takes it along.
  function forgetPrivate(channel: string, leaving: Someone): void {
    const secret = privates.get(channel);
    if (secret === undefined) return;
    secret.invited.delete(leaving.id); // leaving means asking again to come back
    if (membersOf(channel).every((m) => m.who === leaving)) privates.delete(channel);
  }

  // Someone online by nick (any case). Invisible people are not found, except by themselves.
  function findVisible(nick: string, asking: Member): Member | undefined {
    const wanted = nick.trim().toLowerCase();
    return [...members].find((m) => m.nick.toLowerCase() === wanted && (m.who === asking.who || visible(m)));
  }

  function devicesOf(who: Someone): Member[] {
    return [...members].filter((m) => m.who === who);
  }

  const personIn = (who: Someone, channel: string): boolean => devicesOf(who).some((d) => d.channels.has(channel));

  function channelsOf(who: Someone): Set<string> {
    const channels = new Set<string>();
    for (const d of devicesOf(who)) for (const c of d.channels) channels.add(c);
    return channels;
  }

  function sendDevices(me: Member): void {
    const devices = store.sessionsOf(me.who.id).map((s) => ({
      id: s.id,
      name: s.device,
      since: s.createdAt,
      seen: s.seenAt,
      current: s.hash === me.session,
    }));
    send(me, { type: "devices", devices });
  }

  // Close the connections of a device whose session ended: the app goes back to the door.
  function endSession(sessionHash: string): void {
    for (const m of members) if (m.session === sessionHash) m.ws.close(SIGNED_OUT, "signed out");
  }

  function sendPerson(who: Someone, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const d of devicesOf(who)) sendRaw(d, data);
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

  function membersOf(channel: string): Member[] {
    return [...members].filter((m) => m.channels.has(channel));
  }

  // Every device of everyone who shares at least one channel with this person (not their own), once each.
  function peersOf(who: Someone): Set<Member> {
    const peers = new Set<Member>();
    for (const channel of channelsOf(who)) for (const m of membersOf(channel)) if (m.who !== who) peers.add(m);
    return peers;
  }

  function sendToChannel(channel: string, msg: ServerMessage, except?: Someone): void {
    const data = JSON.stringify(msg);
    for (const m of membersOf(channel)) if (m.who !== except) sendRaw(m, data);
  }

  function reject(me: Member, code: ErrorCode, detail: string, reason: string): void {
    send(me, { type: "error", code, detail, reason });
  }

  return {
    signOut: endSession,
    // Say goodbye to every client (1001 = going away), force-close stragglers, then stop.
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
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
  return { nick: m.nick, status: m.status, note: m.note, role: m.who.role };
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

type PushKind = "mention" | "nudge" | "tornado" | Exclude<ThrowItem, "batuque">;

// What a notification says, in the device's language (the server doesn't see words.ts).
function pushText(lang: "pt" | "en", kind: PushKind, from: string, channel: string, text: string): { title: string; body: string } {
  const where = lang === "pt" ? `no ${channel}` : `in ${channel}`;
  const short = text.length > MAX_PUSH_TEXT ? `${text.slice(0, MAX_PUSH_TEXT - 1)}…` : text;
  const titles: Record<PushKind, [string, string]> = {
    mention: [`${from} · ${channel}`, `${from} · ${channel}`],
    nudge: [`📳 ${from} abanou-te!`, `📳 ${from} nudged you!`],
    tornado: [`🌪️ TORNADO de ${from}!`, `🌪️ TORNADO from ${from}!`],
    chinela: [`🩴 Chinelada de ${from}!`, `🩴 ${from} threw a slipper at you!`],
    vassoura: [`🧹 Vassourada de ${from}!`, `🧹 ${from} chased you with a broom!`],
    colher: [`🥄 Maria das Dores de ${from}!`, `🥄 ${from} got you with Maria das Dores!`],
  };
  return { title: titles[kind][lang === "pt" ? 0 : 1], body: kind === "mention" ? short : where };
}

// A nick written as a whole word, any case: "Kota," and "@kota" count; "Kotas" doesn't.
function mentions(text: string, nick: string): boolean {
  const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu").test(text);
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
    case "make_invite":
    case "make_device_link":
    case "devices":
      return { type: v.type };
    case "forget_device":
      return typeof v.id === "number" && Number.isInteger(v.id) ? { type: "forget_device", id: v.id } : undefined;
    case "role": {
      const nick = str("nick");
      const role = v.role === "admin" || v.role === "member" ? v.role : undefined;
      return nick === undefined || role === undefined ? undefined : { type: "role", nick, role };
    }
    case "remove": {
      const nick = str("nick");
      return nick === undefined ? undefined : { type: "remove", nick };
    }
    case "push": {
      const lang = v.lang === "en" ? "en" : "pt";
      if (v.subscription === null) return { type: "push", subscription: null, lang };
      // The shape is checked here loosely; the handler checks it is a real push service's.
      const s = v.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
      if (typeof s?.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys.auth !== "string") {
        return undefined;
      }
      return { type: "push", subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, lang };
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
