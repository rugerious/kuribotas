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

// Things the family throws at each other (and the batuque, which is for everyone). Shown, never saved.
export type ThrowItem = "chinela" | "vassoura" | "colher" | "batuque";

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
  | "invisible_no_nudge" // nudging (or throwing a chinela) would give you away
  | "throw_too_soon" // detail = seconds to wait
  | "batuque_too_soon" // detail = seconds to wait
  | "invite_only" // a private channel: ask a member for /invite
  | "channel_exists" // /privado on a name that is already a public channel
  | "already_in_channel" // /invite for someone who is already there
  | "internal";

// What a client may send. The web UI turns "/nick Rita", "/join #futebol", "/me waves",
// "/topic ...", "/part" and "/biolo" into these; the server never parses typed text.
export type ClientMessage =
  | { type: "nick"; nick: string }
  | { type: "join"; channel: string; private?: boolean } // private: create it invite-only (/privado #primos)
  | { type: "part"; channel: string }
  | { type: "say"; channel: string; text: string }
  | { type: "me"; channel: string; text: string }
  | { type: "topic"; channel: string; topic: string }
  | { type: "status"; status: Status; note: string }
  | { type: "typing"; channel: string; typing: boolean } // true at most every few seconds; false when the box empties
  | { type: "typing"; to: string; typing: boolean } // the same, in a private chat
  | { type: "nudge"; channel: string; nick: string; tornado: boolean } // shake someone's screen (/abanar, /tornado)
  | { type: "nudge"; channel: string; everyone: true; tornado: boolean } // the whole channel (/abanar todos)
  | { type: "nudge"; to: string; tornado: boolean } // in a private chat, MSN style
  | { type: "msg"; to: string; kind: MessageKind; text: string } // a private message (/msg Kota olá)
  | { type: "invite"; channel: string; nick: string } // let someone into a private channel (/invite Kota)
  | { type: "throw"; channel: string; item: ThrowItem; nick?: string }; // /chinela Kota; /batuque has no nick

// What the server sends.
export type ServerMessage =
  | { type: "welcome"; nick: string; channels: Channel[] }
  | { type: "joined"; channel: string; topic: string; members: Member[]; history: ChatMessage[]; private: boolean }
  | { type: "join"; channel: string; nick: string } // arrives as online with no note; a presence may follow
  | { type: "part"; channel: string; nick: string }
  | { type: "quit"; nick: string }
  | { type: "nick"; old: string; nick: string }
  | { type: "topic"; channel: string; topic: string; nick: string }
  | { type: "presence"; nick: string; status: Status; note: string }
  | { type: "typing"; channel: string; nick: string; typing: boolean } // never saved; clients hide it after a few seconds
  | { type: "typing"; dm: true; nick: string; typing: boolean } // `nick` is typing to you in a private chat
  | { type: "nudge"; channel: string; from: string; to: string | null; tornado: boolean } // only `to` shakes; null = everyone but `from`
  | { type: "nudge"; dm: true; from: string; to: string; tornado: boolean } // in a private chat, to both sides
  | ({ type: "message" } & ChatMessage) // in a private channel: not saved, id 0
  // Until accounts (phase 4) anyone can take a free nick, so nothing private is saved: DMs and
  // private channels live in memory only, and reach only people online right now.
  | { type: "dm"; from: string; to: string; kind: MessageKind; text: string; at: string } // to both sides
  | { type: "invited"; channel: string; from: string; to: string } // to the invited person and the inviter
  | { type: "throw"; channel: string; from: string; to: string | null; item: ThrowItem } // everyone sees it fly; `to` gets hit
  | { type: "error"; code: ErrorCode; detail: string; reason: string };
