import type { ClientMessage, Status } from "../../shared/protocol.ts";
import { ROOM_COLOURS, type RoomColour } from "./state.ts";
import { isLang, words, type Lang } from "./words.ts";

// What the input box means: a protocol message to send, something handled on this device,
// a mistake to show, or nothing.
export type Parsed =
  | { kind: "send"; msg: ClientMessage }
  | { kind: "status"; status: Status; note?: string } // no note = pick a random caption
  | { kind: "note"; note: string } // keep the status, change the line under the name
  | { kind: "help" }
  | { kind: "colour"; colour?: RoomColour } // handled on this device; no colour = the next one
  | { kind: "lang"; lang: Lang } // handled on this device
  | { kind: "error"; text: string }
  | { kind: "nothing" };

// Every command works in both languages, whatever the screen speaks: the family types Angolan,
// the IRC veterans type IRC.
const ALIASES: Record<string, string> = {
  "/ajuda": "/help",
  "/entrar": "/join",
  "/bazar": "/part",
  "/sair": "/part",
  "/topico": "/topic",
  "/tópico": "/topic",
  "/cor": "/colour",
  "/color": "/colour",
  "/frase": "/note",
  "/lingua": "/lang",
  "/língua": "/lang",
};

const STATUS_COMMANDS: Record<string, Status> = {
  "/bardea": "online",
  "/online": "online",
  "/vorto": "away",
  "/away": "away",
  "/biolo": "busy",
  "/busy": "busy",
  "/zongolar": "invisible",
  "/invisible": "invisible",
};

// Turns what was typed into a protocol message, IRC style. `channel` is the open tab.
export function parseInput(input: string, channel: string, lang: Lang): Parsed {
  const w = words(lang);
  const line = input.trim();
  if (line === "") return { kind: "nothing" };

  // Plain text, or "//" to send a line that starts with "/".
  if (!line.startsWith("/") || line.startsWith("//")) {
    const text = line.startsWith("//") ? line.slice(1) : line;
    return send({ type: "say", channel, text });
  }

  const space = line.indexOf(" ");
  const typed = (space === -1 ? line : line.slice(0, space)).toLowerCase();
  const command = ALIASES[typed] ?? typed;
  const rest = space === -1 ? "" : line.slice(space + 1).trim();
  const firstWord = rest.split(/\s+/)[0] ?? "";
  const usage = (example: string): Parsed => ({ kind: "error", text: w.usage(example) });

  const status = STATUS_COMMANDS[command];
  if (status !== undefined) return rest ? { kind: "status", status, note: rest } : { kind: "status", status };

  switch (command) {
    case "/help":
      return { kind: "help" };
    case "/nick":
      return firstWord ? send({ type: "nick", nick: firstWord }) : usage(w.examples.nick);
    case "/join":
      return firstWord ? send({ type: "join", channel: withHash(firstWord) }) : usage(w.examples.join);
    case "/part":
      return send({ type: "part", channel: firstWord ? withHash(firstWord) : channel });
    case "/me":
      return rest ? send({ type: "me", channel, text: rest }) : usage(w.examples.me);
    case "/topic":
      return rest ? send({ type: "topic", channel, topic: rest }) : usage(w.examples.topic);
    case "/note":
      return { kind: "note", note: rest }; // empty clears it
    case "/colour": {
      if (!firstWord) return { kind: "colour" };
      const wanted = firstWord.toLowerCase();
      // Accept the colour's name in either language: /cor azul, /colour blue.
      const colour = ROOM_COLOURS.find(
        (c) => c === wanted || words("pt").colour[c] === wanted || words("en").colour[c] === wanted,
      );
      return colour ? { kind: "colour", colour } : usage(w.examples.colour);
    }
    case "/lang": {
      const wanted = firstWord.toLowerCase();
      return isLang(wanted) ? { kind: "lang", lang: wanted } : usage(w.examples.lang);
    }
    default:
      return { kind: "error", text: w.unknownCommand(typed) };
  }
}

function send(msg: ClientMessage): Parsed {
  return { kind: "send", msg };
}

// Being friendly: "/join futebol" means "#futebol".
function withHash(name: string): string {
  return name.startsWith("#") ? name : `#${name}`;
}
