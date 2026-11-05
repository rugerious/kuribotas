import type { ErrorCode, Status } from "../../shared/protocol.ts";
import type { RoomColour } from "./state.ts";

// Everything Kuribotas says, in one place. The family's language lives here, not in the code:
// to add a joke, change a line in this file. Angolan Portuguese is the default for everyone
// (many of the family have English phones but talk Portuguese); /lingua en switches a device to English.

export type Lang = "pt" | "en";

export type Words = {
  status: Record<Status, string>; // the four status names
  captions: Record<Status, readonly string[]>; // one is picked at random when you choose a status
  colour: Record<RoomColour, string>;
  ui: {
    send: string;
    people: (count: number) => string;
    peopleIn: (channel: string) => string;
    topic: string;
    noTopic: string;
    placeholder: (channel: string) => string;
    messageTo: (channel: string) => string;
    yourStatus: string;
    changeColour: (channel: string, colour: string) => string;
    you: string;
    typing: (nicks: readonly string[]) => string; // "" when nobody is typing
    nudge: (nick: string) => string; // the 📳 button's label
    connection: Record<"connecting" | "open" | "closed", string>;
  };
  events: {
    welcome: (nick: string, channels: string) => string;
    youJoined: (channel: string) => string;
    topicIs: (topic: string) => string;
    joined: (nick: string, channel: string) => string;
    left: (nick: string, channel: string) => string;
    youLeft: (channel: string) => string;
    quit: (nick: string) => string;
    nickChange: (old: string, nick: string) => string;
    topicChanged: (nick: string, topic: string) => string;
    topicCleared: (nick: string) => string;
    colour: (channel: string, colour: string) => string;
    nowStatus: (status: string, note: string) => string;
    lang: string; // said in the new language, right after switching
    nudge: (from: string, to: string) => string;
    tornado: (from: string, to: string) => string;
    shake: (on: boolean) => string;
    sound: (name: string) => string;
    sounds: (current: string, options: readonly string[]) => string;
    disconnected: string;
  };
  errors: Record<ErrorCode, (detail: string) => string>;
  usage: (example: string) => string;
  examples: Record<"nick" | "join" | "me" | "topic" | "colour" | "lang" | "nudge" | "tornado" | "shake" | "sound", string>;
  unknownSound: (name: string, options: readonly string[]) => string;
  unknownCommand: (command: string) => string;
  help: readonly string[];
};

const pt: Words = {
  status: {
    online: "Na bardea",
    away: "Já vorto",
    busy: "No biolo",
    invisible: "A zongolar",
  },
  captions: {
    online: ["tô na bardea", "pronto pra kuribotice", "a ver o mujimbo"],
    away: [
      "to vir já",
      "vou vorta já",
      "fui controla um mambo",
      "fui buscar o papucho",
      "a mamoite chamou",
      "o papoite chamou",
    ],
    busy: ["a fingir que trabalho", "a simular comportamento", "a bumbar", "a bumbar bué"],
    invisible: ["ninguém te vê… só a zongolar 👀"],
  },
  colour: { amber: "âmbar", blue: "azul", green: "verde", coral: "coral", violet: "violeta" },
  ui: {
    send: "Mandar",
    people: (n) => `Kambas (${n})`,
    peopleIn: (ch) => `Kambas em ${ch}`,
    topic: "Tópico",
    noTopic: "(sem tópico: /topico para pôr um)",
    placeholder: (ch) => `Mete dica para ${ch}`,
    messageTo: (ch) => `Mensagem para ${ch}`,
    yourStatus: "O teu estado",
    changeColour: (ch, c) => `Mudar a cor de ${ch} (agora ${c})`,
    you: "(tu)",
    nudge: (nick) => `Abanar ${nick}`,
    typing: (n) =>
      n.length === 0
        ? ""
        : n.length === 1
          ? `${n[0]} está a escrever…`
          : n.length === 2
            ? `${n[0]} e ${n[1]} estão a escrever…`
            : `${n[0]}, ${n[1]} e mais ${n.length - 2} estão a escrever…`,
    connection: { connecting: "a ligar…", open: "ligado", closed: "desligado" },
  },
  events: {
    welcome: (nick, chs) => `Bem-vindo, ${nick}! Canais: ${chs}. Escreve /ajuda para veres os comandos.`,
    youJoined: (ch) => `Entraste no ${ch}`,
    topicIs: (t) => `Tópico: ${t}`,
    joined: (nick, ch) => `${nick} chegou no ${ch}`,
    left: (nick, ch) => `${nick} bazou do ${ch}`,
    youLeft: (ch) => `Bazaste do ${ch}`,
    quit: (nick) => `${nick} bazou`,
    nickChange: (old, nick) => `${old} agora é ${nick}`,
    topicChanged: (nick, t) => `${nick} mudou o tópico: ${t}`,
    topicCleared: (nick) => `${nick} limpou o tópico`,
    colour: (ch, c) => `${ch} agora é ${c} (neste aparelho)`,
    nowStatus: (s, note) => `Agora estás ${s}${note ? ` · ${note}` : ""}`,
    lang: "Agora falamos português de Angola (neste aparelho).",
    nudge: (from, to) => (from === to ? `${from} abanou-se a si mesmo 🤪` : `${from} abanou ${to}! 📳`),
    tornado: (from, to) => `${from} mandou um TORNADO para ${to}! 🌪️`,
    shake: (on) =>
      on ? "Abanões ligados neste aparelho 📳" : "Abanões desligados neste aparelho: vês a linha, sem tremer nem som",
    sound: (name) => `Som do abanão neste aparelho: ${name} 🔊`,
    sounds: (current, options) => `Sons do abanão: ${options.join(" · ")} (agora: ${current}). Escolhe com /som <nome>`,
    disconnected: "Ligação perdida. Recarrega a página para voltares.",
  },
  errors: {
    invalid_nick: () => "Nick inválido: 1 a 24 letras, números ou _-~*^.|[]{} (sem espaços)",
    nick_taken: (d) => `O nick ${d} já está a ser usado`,
    invalid_channel: () => "Canal inválido: # e 1 a 32 letras, números, _ ou -",
    not_in_channel: (d) => `Não estás no ${d}`,
    join_first: (d) => `Entra primeiro no ${d} (/join ${d})`,
    topic_too_long: (d) => `Tópico muito comprido (máximo ${d})`,
    note_too_long: (d) => `Frase muito comprida (máximo ${d})`,
    no_such_nick: (d) => `Não há nenhum ${d} neste canal`,
    nudge_too_soon: (d) => `Calma aí! Espera ${d} s para abanar outra vez`,
    tornado_too_soon: (d) => `Um tornado de cada vez 🌪️ Espera ${d} s`,
    invisible_no_nudge: () => "A zongolar não dá para abanar ninguém (ias-te denunciar 👀)",
    internal: () => "Deu maka. Tenta outra vez.",
  },
  usage: (u) => `Usa assim: ${u}`,
  examples: { nick: "/nick <nome>", join: "/join #canal", me: "/me <acção>", topic: "/topico <texto>", colour: "/cor âmbar | azul | verde | coral | violeta", lang: "/lingua pt | en", nudge: "/abanar <nick>", tornado: "/tornado <nick>", shake: "/abanoes sim | nao", sound: "/som <nome>" },
  unknownSound: (name, options) => `Não há o som ${name}. Tens: ${options.join(" · ")}`,
  unknownCommand: (c) => `Não conheço o comando ${c}. Tenta /ajuda`,
  help: [
    "/nick <nome> — mudar o teu nick",
    "/join #canal — entrar num canal (se não existir, nasce)",
    "/bazar — sair deste canal (ou /bazar #canal)",
    "/me <acção> — * tu a fazer alguma coisa",
    "/topico <texto> — mudar o tópico deste canal",
    "/bardea · /vorto · /biolo · /zongolar [frase] — mudar o teu estado",
    "/frase <texto> — a frase debaixo do teu nome",
    "/cor [âmbar|azul|verde|coral|violeta] — a cor deste canal (neste aparelho)",
    "/abanar <nick> — abanar o ecrã de alguém 📳 (até 3 seguidos)",
    "/tornado <nick> — 🌪️ um por minuto",
    "/abanoes nao — sem abanões neste aparelho (/abanoes sim para voltar)",
    "/som — ver e escolher o som do abanão neste aparelho (/som 3, /som panelas)",
    "/lingua en — English (neste aparelho)",
    "//texto — mandar uma linha que começa com /",
  ],
};

const en: Words = {
  status: {
    online: "Online",
    away: "Be right back",
    busy: "Busy",
    invisible: "Invisible",
  },
  captions: {
    online: ["around", "here for the gossip", "reading the room"],
    away: ["back soon", "be right back", "went to get food"],
    busy: ["pretending to work", "simulating good behaviour", "working hard"],
    invisible: ["nobody can see you… just lurking 👀"],
  },
  colour: { amber: "amber", blue: "blue", green: "green", coral: "coral", violet: "violet" },
  ui: {
    send: "Send",
    people: (n) => `People (${n})`,
    peopleIn: (ch) => `People in ${ch}`,
    topic: "Topic",
    noTopic: "(no topic yet: /topic to set one)",
    placeholder: (ch) => `Message ${ch}, or /help`,
    messageTo: (ch) => `Message to ${ch}`,
    yourStatus: "Your status",
    changeColour: (ch, c) => `Change the colour of ${ch} (now ${c})`,
    you: "(you)",
    nudge: (nick) => `Nudge ${nick}`,
    typing: (n) =>
      n.length === 0
        ? ""
        : n.length === 1
          ? `${n[0]} is typing…`
          : n.length === 2
            ? `${n[0]} and ${n[1]} are typing…`
            : `${n[0]}, ${n[1]} and ${n.length - 2} more are typing…`,
    connection: { connecting: "connecting…", open: "online", closed: "offline" },
  },
  events: {
    welcome: (nick, chs) => `Welcome, ${nick}! Channels: ${chs}. Type /help for commands.`,
    youJoined: (ch) => `You joined ${ch}`,
    topicIs: (t) => `Topic: ${t}`,
    joined: (nick, ch) => `${nick} joined ${ch}`,
    left: (nick, ch) => `${nick} left ${ch}`,
    youLeft: (ch) => `You left ${ch}`,
    quit: (nick) => `${nick} quit`,
    nickChange: (old, nick) => `${old} is now known as ${nick}`,
    topicChanged: (nick, t) => `${nick} changed the topic to: ${t}`,
    topicCleared: (nick) => `${nick} cleared the topic`,
    colour: (ch, c) => `${ch} is now ${c} (on this device)`,
    nowStatus: (s, note) => `You are now ${s}${note ? ` · ${note}` : ""}`,
    lang: "Now speaking English (on this device).",
    nudge: (from, to) => (from === to ? `${from} nudged themselves 🤪` : `${from} nudged ${to}! 📳`),
    tornado: (from, to) => `${from} sent a TORNADO to ${to}! 🌪️`,
    shake: (on) => (on ? "Nudges on for this device 📳" : "Nudges off for this device: you'll see the line, no shaking or sound"),
    sound: (name) => `Nudge sound on this device: ${name} 🔊`,
    sounds: (current, options) => `Nudge sounds: ${options.join(" · ")} (now: ${current}). Pick one with /sound <name>`,
    disconnected: "Disconnected. Reload the page to reconnect.",
  },
  errors: {
    invalid_nick: () => "invalid nick: use 1-24 letters, digits or _-~*^.|[]{} (no spaces)",
    nick_taken: (d) => `nick already in use: ${d}`,
    invalid_channel: () => "invalid channel: use # and 1-32 letters, digits, _ or -",
    not_in_channel: (d) => `you are not in ${d}`,
    join_first: (d) => `join ${d} first`,
    topic_too_long: (d) => `topic too long (max ${d})`,
    note_too_long: (d) => `note too long (max ${d})`,
    no_such_nick: (d) => `nobody called ${d} in this channel`,
    nudge_too_soon: (d) => `easy! wait ${d} s before nudging again`,
    tornado_too_soon: (d) => `one tornado at a time 🌪️ wait ${d} s`,
    invisible_no_nudge: () => "you can't nudge while invisible (it would give you away 👀)",
    internal: () => "something went wrong, please try again",
  },
  usage: (u) => `usage: ${u}`,
  examples: { nick: "/nick <name>", join: "/join #channel", me: "/me <action>", topic: "/topic <text>", colour: "/colour amber | blue | green | coral | violet", lang: "/lang pt | en", nudge: "/nudge <nick>", tornado: "/tornado <nick>", shake: "/shake on | off", sound: "/sound <name>" },
  unknownSound: (name, options) => `no sound called ${name}. You have: ${options.join(" · ")}`,
  unknownCommand: (c) => `unknown command ${c} — try /help`,
  help: [
    "/nick <name> — change your nick",
    "/join #channel — join a channel (creates it if it doesn't exist)",
    "/part — leave this channel (or /part #channel)",
    "/me <action> — * you do something",
    "/topic <text> — set this channel's topic",
    "/online · /away · /busy · /invisible [note] — change your status",
    "/note <text> — the line under your name",
    "/colour [amber|blue|green|coral|violet] — change this channel's colour (on this device)",
    "/nudge <nick> — shake someone's screen 📳 (up to 3 in a row)",
    "/tornado <nick> — 🌪️ one a minute",
    "/shake off — no nudges on this device (/shake on to undo)",
    "/sound — see and pick this device's nudge sound (/sound 3, /sound panelas)",
    "/lang pt — Angolan Portuguese (on this device)",
    "//text — send a line that starts with /",
  ],
};

const WORDS: Record<Lang, Words> = { pt, en };

export function words(lang: Lang): Words {
  return WORDS[lang];
}

export function isLang(value: unknown): value is Lang {
  return value === "pt" || value === "en";
}

// ?lang= in the address wins (handy for screenshots), then this device's /lingua choice, then Portuguese.
export function pickLang(override: string | null, saved: string | null): Lang {
  if (isLang(override)) return override;
  if (isLang(saved)) return saved;
  return "pt";
}

// A random caption for a status. `random` is injectable so tests are predictable.
export function captionFor(lang: Lang, status: Status, random: () => number = Math.random): string {
  const list = words(lang).captions[status];
  return list[Math.floor(random() * list.length)] ?? "";
}
