// The chat protocol: the one contract between the server and every client
// (web UI now; phones, bots and the load-test script later).
// Types only: they are erased at runtime, so the server image never needs this folder.

export type Channel = { name: string; topic: string };

export type MessageKind = "say" | "me"; // "me" is an action: * Rita waves

export type ChatMessage = {
  id: number;
  channel: string;
  nick: string;
  kind: MessageKind;
  text: string;
  at: string; // ISO 8601, UTC
};

// What a client may send. The web UI turns "/nick Rita", "/join #futebol", "/me waves",
// "/topic ..." and "/part" into these; the server never parses typed text.
export type ClientMessage =
  | { type: "nick"; nick: string }
  | { type: "join"; channel: string }
  | { type: "part"; channel: string }
  | { type: "say"; channel: string; text: string }
  | { type: "me"; channel: string; text: string }
  | { type: "topic"; channel: string; topic: string };

// What the server sends.
export type ServerMessage =
  | { type: "welcome"; nick: string; channels: Channel[] }
  | { type: "joined"; channel: string; topic: string; members: string[]; history: ChatMessage[] }
  | { type: "join"; channel: string; nick: string }
  | { type: "part"; channel: string; nick: string }
  | { type: "quit"; nick: string }
  | { type: "nick"; old: string; nick: string }
  | { type: "topic"; channel: string; topic: string; nick: string }
  | ({ type: "message" } & ChatMessage)
  | { type: "error"; reason: string };
