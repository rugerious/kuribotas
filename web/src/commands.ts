import type { ClientMessage } from "../../shared/protocol.ts";
import { ROOM_COLOURS, type RoomColour } from "./state.ts";

// What the input box means: a protocol message to send, the help text, a mistake to show, or nothing.
export type Parsed =
  | { kind: "send"; msg: ClientMessage }
  | { kind: "help" }
  | { kind: "colour"; colour?: RoomColour } // handled on this device; no colour = the next one
  | { kind: "error"; text: string }
  | { kind: "nothing" };

export const HELP: readonly string[] = [
  "/nick <name> — change your nick",
  "/join #channel — join a channel (creates it if it doesn't exist)",
  "/part — leave this channel (or /part #channel)",
  "/me <action> — * you do something",
  "/topic <text> — set this channel's topic",
  `/colour [${ROOM_COLOURS.join(" | ")}] — change this channel's colour (on this device)`,
  "//text — send a line that starts with /",
];

// Turns what was typed into a protocol message, IRC style. `channel` is the open tab.
export function parseInput(input: string, channel: string): Parsed {
  const line = input.trim();
  if (line === "") return { kind: "nothing" };

  // Plain text, or "//" to send a line that starts with "/".
  if (!line.startsWith("/") || line.startsWith("//")) {
    const text = line.startsWith("//") ? line.slice(1) : line;
    return send({ type: "say", channel, text });
  }

  const space = line.indexOf(" ");
  const command = (space === -1 ? line : line.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : line.slice(space + 1).trim();
  const firstWord = rest.split(/\s+/)[0] ?? "";

  switch (command) {
    case "/help":
      return { kind: "help" };
    case "/nick":
      return firstWord ? send({ type: "nick", nick: firstWord }) : usage("/nick <name>");
    case "/join":
      return firstWord ? send({ type: "join", channel: withHash(firstWord) }) : usage("/join #channel");
    case "/part":
      return send({ type: "part", channel: firstWord ? withHash(firstWord) : channel });
    case "/me":
      return rest ? send({ type: "me", channel, text: rest }) : usage("/me <action>");
    case "/topic":
      return rest ? send({ type: "topic", channel, topic: rest }) : usage("/topic <text>");
    case "/colour":
    case "/color": {
      if (!firstWord) return { kind: "colour" };
      const colour = ROOM_COLOURS.find((c) => c === firstWord.toLowerCase());
      return colour ? { kind: "colour", colour } : usage(`/colour ${ROOM_COLOURS.join(" | ")}`);
    }
    default:
      return { kind: "error", text: `unknown command ${command} — try /help` };
  }
}

function send(msg: ClientMessage): Parsed {
  return { kind: "send", msg };
}

function usage(text: string): Parsed {
  return { kind: "error", text: `usage: ${text}` };
}

// Being friendly: "/join futebol" means "#futebol".
function withHash(name: string): string {
  return name.startsWith("#") ? name : `#${name}`;
}
