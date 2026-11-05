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

// Presence, MSN style. The UI names them (in Portuguese: Na bardea, Já vorto, No biolo, A zongolar).
// "invisible" is never sent to anyone else: to the others you look like you left.
export type Status = "online" | "away" | "busy" | "invisible";

export type Member = {
  nick: string;
  status: Status;
  note: string; // the line under your name: a random caption or your own personal message
};

// Errors carry a code so each client can say them in its own language; `reason` is English, for logs.
export type ErrorCode =
  | "invalid_nick"
  | "nick_taken"
  | "invalid_channel"
  | "not_in_channel"
  | "join_first"
  | "topic_too_long"
  | "note_too_long"
  | "no_such_nick" // nobody by that name in the channel (invisible people included, so they stay hidden)
  | "nudge_too_soon" // detail = seconds to wait
  | "tornado_too_soon" // detail = seconds to wait
  | "invisible_no_nudge" // nudging would give you away
  | "internal";

// What a client may send. The web UI turns "/nick Rita", "/join #futebol", "/me waves",
// "/topic ...", "/part" and "/biolo" into these; the server never parses typed text.
export type ClientMessage =
  | { type: "nick"; nick: string }
  | { type: "join"; channel: string }
  | { type: "part"; channel: string }
  | { type: "say"; channel: string; text: string }
  | { type: "me"; channel: string; text: string }
  | { type: "topic"; channel: string; topic: string }
  | { type: "status"; status: Status; note: string }
  | { type: "typing"; channel: string; typing: boolean } // true at most every few seconds; false when the box empties
  | { type: "nudge"; channel: string; nick: string; tornado: boolean } // shake someone's screen (/abanar, /tornado)
  | { type: "nudge"; channel: string; everyone: true; tornado: boolean }; // the whole channel (/abanar todos)

// What the server sends.
export type ServerMessage =
  | { type: "welcome"; nick: string; channels: Channel[] }
  | { type: "joined"; channel: string; topic: string; members: Member[]; history: ChatMessage[] }
  | { type: "join"; channel: string; nick: string } // arrives as online with no note; a presence may follow
  | { type: "part"; channel: string; nick: string }
  | { type: "quit"; nick: string }
  | { type: "nick"; old: string; nick: string }
  | { type: "topic"; channel: string; topic: string; nick: string }
  | { type: "presence"; nick: string; status: Status; note: string }
  | { type: "typing"; channel: string; nick: string; typing: boolean } // never saved; clients hide it after a few seconds
  | { type: "nudge"; channel: string; from: string; to: string | null; tornado: boolean } // only `to` shakes; null = everyone but `from`
  | ({ type: "message" } & ChatMessage)
  | { type: "error"; code: ErrorCode; detail: string; reason: string };
