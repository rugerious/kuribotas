import type { ClientMessage, Status, ThrowItem } from "../../shared/protocol.ts";
import { isDm, ROOM_COLOURS, type RoomColour } from "./state.ts";
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
  | { kind: "shake"; on: boolean } // handled on this device
  | { kind: "sound"; tornado: boolean; name?: string } // handled on this device; no name = list the options
  | { kind: "openDm"; nick: string } // open a private chat tab without sending anything
  | { kind: "closeDm"; nick: string } // close a private chat tab
  | { kind: "notify"; on: boolean } // notifications on this device
  | { kind: "logout" } // sign this device out (/xau)
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
  "/abanar": "/nudge",
  "/abanoes": "/shake",
  "/abanões": "/shake",
  "/som": "/sound",
  "/m": "/msg",
  "/query": "/msg",
  "/convidar": "/invite",
  "/privado": "/private",
  "/slipper": "/chinela",
  "/broom": "/vassoura",
  "/colherdepau": "/colher",
  "/mariadasdores": "/colher",
  "/maria": "/colher",
  "/spoon": "/colher",
  "/drums": "/batuque",
  "/invitelink": "/convite",
  "/device": "/aparelho",
  "/devices": "/aparelhos",
  "/logout": "/xau",
  "/kick": "/expulsar",
  "/rooms": "/salas",
  "/list": "/salas",
  "/home": "/principal",
  "/delete": "/apagar",
  "/remove": "/expulsar",
  "/notificacoes": "/notifications",
  "/notificações": "/notifications",
};

// In a private chat these make no sense (they belong to channels).
const CHANNEL_ONLY = ["/topic", "/invite", "/chinela", "/vassoura", "/colher", "/batuque"];

// The family's arsenal, in both languages.
const THROWS: Record<string, ThrowItem> = {
  "/chinela": "chinela",
  "/vassoura": "vassoura",
  "/colher": "colher",
  "/batuque": "batuque",
};

// "/abanar todos" nudges the whole channel (so a person can't be called "todos" and get nudged alone).
const EVERYONE = ["todos", "all", "@todos", "@all", "*"];

const YES = ["sim", "on", "yes"];
const NO = ["nao", "não", "off", "no"];

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

  // Plain text, or "//" to send a line that starts with "/". In a private chat it goes to that person.
  if (!line.startsWith("/") || line.startsWith("//")) {
    const text = line.startsWith("//") ? line.slice(1) : line;
    return isDm(channel) ? send({ type: "msg", to: channel, kind: "say", text }) : send({ type: "say", channel, text });
  }

  const space = line.indexOf(" ");
  const typed = (space === -1 ? line : line.slice(0, space)).toLowerCase();
  const command = ALIASES[typed] ?? typed;
  const rest = space === -1 ? "" : line.slice(space + 1).trim();
  const firstWord = rest.split(/\s+/)[0] ?? "";
  const usage = (example: string): Parsed => ({ kind: "error", text: w.usage(example) });

  if (isDm(channel)) {
    if (command === "/me") return rest ? send({ type: "msg", to: channel, kind: "me", text: rest }) : usage(w.examples.me);
    if (command === "/part" && !firstWord) return { kind: "closeDm", nick: channel };
    // MSN's nudge lived in the conversation window: here it always goes to the other person.
    if (command === "/nudge" || command === "/tornado") return send({ type: "nudge", to: channel, tornado: command === "/tornado" });
    if (CHANNEL_ONLY.includes(command) && !(command === "/invite" && rest.split(/\s+/)[1])) {
      return { kind: "error", text: w.channelsOnly };
    }
  }

  const item = THROWS[command];
  if (item === "batuque") return send({ type: "throw", channel, item });
  if (item !== undefined) return firstWord ? send({ type: "throw", channel, item, nick: firstWord }) : usage(w.examples.throw);

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
    case "/nudge":
    case "/tornado":
      if (!firstWord) return usage(command === "/tornado" ? w.examples.tornado : w.examples.nudge);
      return EVERYONE.includes(firstWord.toLowerCase())
        ? send({ type: "nudge", channel, everyone: true, tornado: command === "/tornado" })
        : send({ type: "nudge", channel, nick: firstWord, tornado: command === "/tornado" });
    case "/convite":
      return send({ type: "make_invite" });
    case "/aparelho":
      return send({ type: "make_device_link" });
    case "/aparelhos":
      return send({ type: "devices" });
    case "/xau": {
      if (!firstWord) return { kind: "logout" };
      const id = Number(firstWord.replace(/^\[|\]$/g, ""));
      return Number.isInteger(id) && id > 0 ? send({ type: "forget_device", id }) : usage(w.examples.logout);
    }
    case "/op":
    case "/deop":
      return firstWord
        ? send({ type: "role", nick: firstWord, role: command === "/op" ? "admin" : "member" })
        : usage(command === "/op" ? w.examples.op : w.examples.deop);
    case "/expulsar":
      return firstWord ? send({ type: "remove", nick: firstWord }) : usage(w.examples.remove);
    case "/salas":
      return send({ type: "rooms" });
    case "/principal": {
      // "/principal #angola" adds a home room, "/principal -#angola" takes it off.
      if (!firstWord || firstWord === "-") return usage(w.examples.home);
      const off = firstWord.startsWith("-");
      return send({ type: "home", channel: withHash(off ? firstWord.slice(1) : firstWord), on: !off });
    }
    case "/apagar": {
      const sure = (rest.split(/\s+/)[1] ?? "").toLowerCase();
      return firstWord ? send({ type: "delete_room", channel: withHash(firstWord), confirm: YES.includes(sure) }) : usage(w.examples.delete);
    }
    case "/notifications": {
      const answer = firstWord.toLowerCase();
      if (YES.includes(answer)) return { kind: "notify", on: true };
      if (NO.includes(answer)) return { kind: "notify", on: false };
      return usage(w.examples.notify);
    }
    case "/shake": {
      const answer = firstWord.toLowerCase();
      if (YES.includes(answer)) return { kind: "shake", on: true };
      if (NO.includes(answer)) return { kind: "shake", on: false };
      return usage(w.examples.shake);
    }
    case "/msg": {
      if (!firstWord) return usage(w.examples.msg);
      const text = rest.slice(firstWord.length).trim();
      return text ? send({ type: "msg", to: firstWord, kind: "say", text }) : { kind: "openDm", nick: firstWord };
    }
    case "/invite": {
      const where = rest.split(/\s+/)[1];
      return firstWord ? send({ type: "invite", channel: where ? withHash(where) : channel, nick: firstWord }) : usage(w.examples.invite);
    }
    case "/private":
      return firstWord ? send({ type: "join", channel: withHash(firstWord), private: true }) : usage(w.examples.private);
    case "/sound": {
      // Accents dropped, so /som padrão and /som padrao are the same. "/som tornado …" picks the tornado's.
      const words = rest.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/\s+/).filter(Boolean);
      const tornado = words[0] === "tornado";
      const name = tornado ? words[1] : words[0];
      return name === undefined ? { kind: "sound", tornado } : { kind: "sound", tornado, name };
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
