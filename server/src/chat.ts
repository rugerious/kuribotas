import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.ts";
import type { Store } from "./store.ts";

// One connected person.
type Member = { ws: WebSocket; nick: string; channels: Set<string> };

const HOME_CHANNEL = "#mujimbo"; // everyone lands here
const HISTORY_LIMIT = 50; // messages sent when joining a channel
const MAX_TEXT_LENGTH = 2000; // characters per chat message
const MAX_TOPIC_LENGTH = 200; // characters per topic
const MAX_PAYLOAD_BYTES = 16 * 1024; // larger frames are rejected by ws (close code 1009)
const CLOSE_GRACE_MS = 3000; // on shutdown, wait this long before force-closing clients

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

    const me: Member = { ws, nick: newGuestNick(), channels: new Set() };
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
      // Tell everyone who shared a channel with them, once each.
      const others = new Set<Member>();
      for (const channel of me.channels) for (const other of membersOf(channel)) others.add(other);
      for (const other of others) send(other, { type: "quit", nick: me.nick });
    });
  });

  function handle(me: Member, msg: ClientMessage): void {
    switch (msg.type) {
      case "nick": {
        const nick = msg.nick.trim();
        if (!NICK_PATTERN.test(nick)) {
          return reject(me, "invalid nick: use 1-24 letters, digits or _-~*^.|[]{} (no spaces)");
        }
        if (nick === me.nick) return;
        if (nickTaken(nick, me)) return reject(me, `nick already in use: ${nick}`);
        const old = me.nick;
        me.nick = nick;
        for (const other of members) send(other, { type: "nick", old, nick });
        return;
      }
      case "join": {
        const channel = normaliseChannel(msg.channel);
        if (!CHANNEL_PATTERN.test(channel)) {
          return reject(me, "invalid channel: use # and 1-32 letters, digits, _ or -");
        }
        if (me.channels.has(channel)) return;
        join(me, channel);
        return;
      }
      case "part": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, `you are not in ${channel}`);
        sendToChannel(channel, { type: "part", channel, nick: me.nick }); // the leaver sees it too
        me.channels.delete(channel);
        return;
      }
      case "say":
      case "me": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, `join ${channel} first`);
        const text = msg.text.trim();
        if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return; // ignored, as before
        // Saved first: if this throws, nothing is broadcast (not saved = not delivered).
        const saved = store.addMessage({
          channel,
          nick: me.nick,
          kind: msg.type,
          text,
          at: new Date().toISOString(),
        });
        sendToChannel(channel, { type: "message", ...saved });
        return;
      }
      case "topic": {
        const channel = normaliseChannel(msg.channel);
        if (!me.channels.has(channel)) return reject(me, `join ${channel} first`);
        const topic = msg.topic.trim(); // an empty topic clears it
        if (topic.length > MAX_TOPIC_LENGTH) return reject(me, `topic too long (max ${MAX_TOPIC_LENGTH})`);
        const updated = store.setTopic(channel, topic);
        sendToChannel(channel, { type: "topic", channel, topic: updated.topic, nick: me.nick });
        return;
      }
    }
  }

  // Joining creates the channel if it doesn't exist yet (anyone can create one).
  function join(me: Member, channel: string): void {
    const created = store.createChannel(channel, new Date().toISOString());
    sendToChannel(channel, { type: "join", channel, nick: me.nick }); // the others already in it
    me.channels.add(channel);
    send(me, {
      type: "joined",
      channel,
      topic: created.topic,
      members: membersOf(channel).map((m) => m.nick),
      history: store.recentMessages(channel, HISTORY_LIMIT),
    });
  }

  // A failing store must never crash the server or kill the connection.
  function run(me: Member, action: () => void): void {
    try {
      action();
    } catch (err) {
      console.error(`could not handle a request: ${err instanceof Error ? err.message : String(err)}`);
      send(me, { type: "error", reason: "something went wrong, please try again" });
    }
  }

  function newGuestNick(): string {
    let nick: string;
    do {
      guestCounter += 1;
      nick = `Guest-${guestCounter}`;
    } while (nickTaken(nick));
    return nick;
  }

  // Nicks are unique, ignoring case: "Rita" and "rita" can't both be online.
  function nickTaken(nick: string, except?: Member): boolean {
    const wanted = nick.toLowerCase();
    for (const m of members) if (m !== except && m.nick.toLowerCase() === wanted) return true;
    return false;
  }

  function membersOf(channel: string): Member[] {
    return [...members].filter((m) => m.channels.has(channel));
  }

  function sendToChannel(channel: string, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const m of membersOf(channel)) sendRaw(m, data);
  }

  function reject(me: Member, reason: string): void {
    send(me, { type: "error", reason });
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

function send(member: Member, msg: ServerMessage): void {
  sendRaw(member, JSON.stringify(msg));
}

function sendRaw(member: Member, data: string): void {
  if (member.ws.readyState === WebSocket.OPEN) member.ws.send(data);
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
    const value = v[key];
    return typeof value === "string" ? value : undefined;
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
    default:
      return undefined;
  }
}
