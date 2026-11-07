import type { ErrorCode, Status, ThrowItem } from "../../shared/protocol.ts";
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
    dm: (nick: string) => string; // the 💬 button's label
    privateChat: (nick: string) => string; // the bar above a private chat
    privateChannel: string; // after the topic of a private channel
    tornado: (nick: string) => string; // the 🌪️ button's label
    actions: { dm: string; nudge: string; tornado: string }; // short words beside the icons
    editNote: string; // the ✏️ button
    emoji: string; // the 😀 button
    hit: Record<ThrowItem, string>; // the big word when it lands
    notePlaceholder: string;
    noteSave: string;
    connection: Record<"connecting" | "open" | "closed", string>;
  };
  // The door (no session) and the welcome page (an invite link).
  gate: {
    doorTitle: string;
    doorText: string;
    welcomeTitle: string;
    pickNick: string;
    nickPlaceholder: string;
    enter: string;
    deviceTitle: (nick: string) => string;
    deviceText: string;
    checking: string;
    codeLabel: string;
    codeButton: string;
    errors: Record<
      "invite_unknown" | "invite_used" | "invite_expired" | "invalid_nick" | "nick_taken" | "too_many_tries" | "other" | "offline",
      string
    >;
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
    nudgeAll: (from: string, channel: string) => string;
    thrown: (item: Exclude<ThrowItem, "batuque">, from: string, to: string) => string;
    batuque: (from: string, channel: string) => string;
    tornadoAll: (from: string, channel: string) => string;
    shake: (on: boolean) => string;
    theme: (theme: "escuro" | "claro" | "auto") => string;
    sound: (name: string, tornado: boolean) => string;
    notify: (on: boolean) => string;
    notifyUnsupported: string;
    notifyDenied: string;
    invitedYou: (from: string, channel: string) => string;
    youInvited: (to: string, channel: string) => string;
    sounds: (current: string, options: readonly string[], tornado: boolean) => string;
    disconnected: string;
    reconnected: string;
    roomsTitle: string;
    room: (name: string, people: number, topic: string, home: boolean, isPrivate: boolean) => string;
    roomsHelp: string;
    home: (by: string, channel: string, on: boolean) => string;
    roomDeleted: (channel: string, by: string) => string;
    inviteLink: (link: string, copied: boolean) => string;
    deviceLink: (link: string, code: string, copied: boolean) => string;
    devicesTitle: string;
    device: (id: number, name: string, since: string, seen: string, current: boolean) => string;
    devicesHelp: string;
    role: (by: string, nick: string, op: boolean) => string;
    removed: (nick: string, by: string) => string;
  };
  errors: Record<ErrorCode, (detail: string) => string>;
  usage: (example: string) => string;
  examples: Record<"nick" | "join" | "me" | "topic" | "colour" | "lang" | "nudge" | "tornado" | "shake" | "sound" | "msg" | "invite" | "private" | "throw" | "notify" | "op" | "deop" | "remove" | "logout" | "home" | "delete" | "theme", string>;
  unknownSound: (name: string, options: readonly string[]) => string;
  channelsOnly: string; // a command that makes no sense in a private chat
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
    // The spelling is on purpose: writing it wrong is half the joke.
    online: ["mo petu ta bom", "vaum me xentir", "pronto pra lançar venenu", "pronto pra kurobotice"],
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
    dm: (nick) => `Conversa privada com ${nick}`,
    privateChat: (nick) => `💬 Conversa privada com ${nick} · não fica guardada`,
    privateChannel: "🔒 privado · não fica guardado",
    tornado: (nick) => `Mandar um tornado a ${nick}`,
    actions: { dm: "privado", nudge: "abanar", tornado: "tornado" },
    editNote: "Mudar a tua frase",
    emoji: "Emoji da família",
    hit: { chinela: "PÁ!", vassoura: "XÔ!", colher: "TOC!", batuque: "TUM TUM TÁ!" },
    notePlaceholder: "A tua frase (vazio = nenhuma)",
    noteSave: "OK",
    typing: (n) =>
      n.length === 0
        ? ""
        : n.length === 1
          ? `${n[0]} está a escrever…`
          : n.length === 2
            ? `${n[0]} e ${n[1]} estão a escrever…`
            : `${n[0]}, ${n[1]} e mais ${n.length - 2} estão a escrever…`,
    connection: { connecting: "a ligar…", open: "ligado", closed: "sem ligação · a voltar…" },
  },
  gate: {
    doorTitle: "Só com convite 🚪",
    doorText: "O Kuribotas é da família. Pede um link de convite a um @ e abre-o neste aparelho.",
    welcomeTitle: "Bem-vindo ao Kuribotas! 👋",
    pickNick: "Escolhe o teu nick. Fica teu: mais ninguém o pode usar (podes mudá-lo depois com /nick).",
    nickPlaceholder: "ex.: Estraga_Lar",
    enter: "Entrar",
    deviceTitle: (nick) => `Entrar como ${nick} neste aparelho?`,
    deviceText: "Este link junta este aparelho à tua conta. Se não foste tu que o pediste, fecha esta página.",
    checking: "a ver o convite…",
    codeLabel: "Já entraste noutro aparelho? Escreve lá /aparelho e mete aqui o código:",
    codeButton: "Usar código",
    errors: {
      invite_unknown: "Este link de convite não existe. Será que ficou cortado ao copiar?",
      invite_used: "Este convite já foi usado. Pede outro 🙏",
      invite_expired: "Este convite já expirou. Pede outro 🙏",
      invalid_nick: "Nick inválido: 1 a 24 letras, números ou _-~*^.|[]{} (sem espaços).",
      nick_taken: "Esse nick já tem dono. Escolhe outro.",
      too_many_tries: "Tentativas a mais. Espera uns minutos e tenta outra vez.",
      other: "Deu maka. Tenta outra vez.",
      offline: "Sem ligação ao servidor. Tenta outra vez daqui a pouco.",
    },
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
    nudgeAll: (from, ch) => `${from} abanou o ${ch} inteiro! 📳`,
    thrown: (item, from, to) =>
      ({
        chinela: `Chinelada de ${from} para ${to}! 🩴💨`,
        vassoura: `Vassourada de ${from} para ${to}! 🧹`,
        colher: `Maria das Dores de ${from} na cabeça de ${to}! TOC!`,
      })[item],
    batuque: (from, ch) => `${from} meteu batuque no ${ch}! 🥁🥁🥁`,
    tornadoAll: (from, ch) => `${from} mandou um TORNADO para o ${ch} inteiro! 🌪️🌪️`,
    shake: (on) =>
      on ? "Abanões ligados neste aparelho 📳" : "Abanões desligados neste aparelho: vês a linha, sem tremer nem som",
    theme: (t) =>
      ({
        escuro: "Tema escuro neste aparelho 🌙",
        claro: "Tema claro neste aparelho ☀️",
        auto: "Tema automático: segue o telemóvel (escuro à noite se o telemóvel estiver assim) 🌗",
      })[t],
    sound: (name, t) => `Som ${t ? "do tornado" : "do abanão"} neste aparelho: ${name} 🔊`,
    notify: (on) =>
      on
        ? "Notificações ligadas neste aparelho 🔔 Vais saber quando te chamam pelo nick ou te abanam, mesmo com a app fechada (No biolo = silêncio)"
        : "Notificações desligadas neste aparelho 🔕",
    notifyUnsupported:
      "Este aparelho não deixa receber notificações aqui. Precisam de https (nos telemóveis da família, a partir da fase 5); no iPhone, instala a app primeiro (Partilhar → Adicionar ao ecrã principal)",
    notifyDenied: "O browser está a bloquear as notificações deste site: muda isso nas definições do site e tenta outra vez",
    invitedYou: (from, ch) => `${from} convidou-te para ${ch} 🔒 Escreve /join ${ch} para entrar`,
    youInvited: (to, ch) => `Convidaste ${to} para ${ch}`,
    sounds: (current, options, t) =>
      t
        ? `Sons do tornado: ${options.join(" · ")} (agora: ${current}). Escolhe com /som tornado <nome>`
        : `Sons do abanão: ${options.join(" · ")} (agora: ${current}). Escolhe com /som <nome> · tornados: /som tornado`,
    disconnected: "Ligação perdida. A voltar a ligar…",
    reconnected: "De volta! 🔌",
    roomsTitle: "Salas:",
    room: (name, people, topic, home, priv) =>
      `${priv ? "🔒 " : home ? "🏠 " : ""}${name} · ${people === 0 ? "ninguém" : people === 1 ? "1 pessoa" : `${people} pessoas`}${topic ? ` · ${topic}` : ""}`,
    roomsHelp: "Para entrar: /join #sala · 🏠 = sala principal (todos estão lá)",
    home: (by, ch, on) => (on ? `${by} fez de ${ch} uma sala principal 🏠 (todos entram)` : `${by} tirou ${ch} das salas principais`),
    roomDeleted: (ch, by) => `${ch} foi apagada por ${by}`,
    inviteLink: (link, copied) =>
      `Convite para uma pessoa nova 🎟️ Vale uma vez, durante 7 dias: manda-o só a quem queres cá${copied ? " (copiado ✓)" : ""}: ${link}`,
    deviceLink: (link, code, copied) =>
      `Para o teu outro aparelho (10 minutos): abre ${link}${copied ? " (copiado ✓)" : ""} ou mete o código ${code} na porta 🚪`,
    devicesTitle: "Os teus aparelhos:",
    device: (id, name, since, seen, current) =>
      `[${id}] ${name || "aparelho"} · entrou ${since} · visto ${seen}${current ? " ← este" : ""}`,
    devicesHelp: "Para tirar um (telemóvel perdido?): /xau <número>",
    role: (by, nick, op) => (op ? `${by} deu @ a ${nick}` : `${by} tirou o @ a ${nick}`),
    removed: (nick, by) => `${nick} foi expulso do Kuribotas por ${by}`,
  },
  errors: {
    invalid_nick: () => "Nick inválido: 1 a 24 letras, números ou _-~*^.|[]{} (sem espaços)",
    nick_taken: (d) => `O nick ${d} já está a ser usado`,
    invalid_channel: () => "Canal inválido: # e 1 a 32 letras, números, _ ou -",
    not_in_channel: (d) => `Não estás no ${d}`,
    join_first: (d) => `Entra primeiro no ${d} (/join ${d})`,
    topic_too_long: (d) => `Tópico muito comprido (máximo ${d})`,
    note_too_long: (d) => `Frase muito comprida (máximo ${d})`,
    no_such_nick: (d) => `Não encontro ninguém chamado ${d} por aqui`,
    invite_only: (d) => `${d} é privado 🔒 Pede a alguém lá dentro: /invite <o teu nick>`,
    channel_exists: (d) => `${d} já existe e é público. Escolhe outro nome`,
    already_in_channel: (d) => `${d} já está cá dentro`,
    nudge_too_soon: (d) => `Calma aí! Espera ${d} s para abanar outra vez`,
    tornado_too_soon: (d) => `Um tornado de cada vez 🌪️ Espera ${d} s`,
    invisible_no_nudge: () => "A zongolar não dá para fazer isso (ias-te denunciar 👀)",
    throw_too_soon: (d) => `Calma com a chinela! Espera ${d} s`,
    batuque_too_soon: (d) => `O batuque ainda está a ecoar 🥁 Espera ${d} s`,
    internal: () => "Deu maka. Tenta outra vez.",
    push_invalid: () => "Este aparelho mandou um endereço de notificações que não reconheço. Tenta /notificacoes sim outra vez",
    not_op: () => "Só um @ pode fazer isso",
    no_such_person: (d) => `Ninguém no Kuribotas se chama ${d}`,
    cant_remove_op: (d) => `${d} é @: tira-lhe o @ primeiro (/deop ${d})`,
    cant_deop_self: () => "Não podes tirar o teu próprio @: pede a outro @",
    no_such_device: (d) => `Não tens o aparelho ${d} (vê /aparelhos)`,
    too_fast: (d) => `Calma, kamba! Mensagens a mais seguidas: espera ${d} s`,
    no_such_channel: (d) => `Não há nenhuma sala ${d} (vê /salas)`,
    cant_delete_home: (d) => `${d} é uma sala principal 🏠: tira-a primeiro com /principal -${d} (o #mujimbo fica sempre)`,
    confirm_delete: (d) => `Essa sala tem ${d === "1" ? "1 mensagem" : `${d} mensagens`}, que se perde${d === "1" ? "" : "m"}. Para apagar mesmo: /apagar #sala sim`,
  },
  usage: (u) => `Usa assim: ${u}`,
  examples: { nick: "/nick <nome>", join: "/join #canal", me: "/me <acção>", topic: "/topico <texto>", colour: "/cor âmbar | azul | verde | coral | violeta", lang: "/lingua pt | en", nudge: "/abanar <nick> | todos", tornado: "/tornado <nick> | todos", shake: "/abanoes sim | nao", sound: "/som <nome>", msg: "/msg <nick> <mensagem>", invite: "/invite <nick> [#canal]", private: "/privado #canal", throw: "/chinela | /vassoura | /mariadasdores <nick>", notify: "/notificacoes sim | nao", op: "/op <nick>", deop: "/deop <nick>", remove: "/expulsar <nick>", logout: "/xau [número]", home: "/principal #sala | -#sala", delete: "/apagar #sala [sim]", theme: "/tema escuro | claro | auto" },
  unknownSound: (name, options) => `Não há o som ${name}. Tens: ${options.join(" · ")}`,
  channelsOnly: "Isso é só nos canais (aqui é conversa privada)",
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
    "/abanar todos — o canal inteiro (1 por minuto) · /tornado todos — 1 em cada 5 minutos",
    "/abanoes nao — sem abanões neste aparelho (/abanoes sim para voltar)",
    "/som — o som do abanão neste aparelho (/som 3, /som panelas) · /som tornado — o do tornado",
    "/chinela · /vassoura · /mariadasdores <nick> — atirar 🩴🧹 e a colher de pau (3 em 10 s) · /batuque — 🥁 para todos (1 por minuto)",
    "/notificacoes sim — avisos com a app fechada quando te chamam ou te abanam 🔔 (/notificacoes nao para parar)",
    "/msg <nick> [mensagem] — conversa privada 💬 (não fica guardada)",
    "/aparelho — juntar outro aparelho teu (link ou código, 10 minutos) · /aparelhos — os teus aparelhos · /xau — sair deste aparelho (/xau 2 tira outro)",
    "/salas — todas as salas, quem lá está e o tópico",
    "/convite — (@) um link para trazer uma pessoa nova 🎟️ · /op · /deop <nick> — dar ou tirar @ · /expulsar <nick> — tirar alguém do Kuribotas",
    "/principal #sala — (@) sala onde todos entram 🏠 (/principal -#sala para tirar) · /apagar #sala — (@) apagar uma sala",
    "/privado #canal — criar um canal privado 🔒 · /invite <nick> — deixar alguém entrar",
    "/tema escuro | claro | auto — o aspecto deste aparelho (auto segue o telemóvel)",
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
    dm: (nick) => `Private chat with ${nick}`,
    privateChat: (nick) => `💬 Private chat with ${nick} · not saved`,
    privateChannel: "🔒 private · not saved",
    tornado: (nick) => `Send ${nick} a tornado`,
    actions: { dm: "private", nudge: "nudge", tornado: "tornado" },
    editNote: "Change your note",
    emoji: "Family emoji",
    hit: { chinela: "SMACK!", vassoura: "SHOO!", colher: "BONK!", batuque: "BOOM BOOM TAK!" },
    notePlaceholder: "Your note (empty = none)",
    noteSave: "OK",
    typing: (n) =>
      n.length === 0
        ? ""
        : n.length === 1
          ? `${n[0]} is typing…`
          : n.length === 2
            ? `${n[0]} and ${n[1]} are typing…`
            : `${n[0]}, ${n[1]} and ${n.length - 2} more are typing…`,
    connection: { connecting: "connecting…", open: "online", closed: "offline · reconnecting…" },
  },
  gate: {
    doorTitle: "Invite only 🚪",
    doorText: "Kuribotas is for the family. Ask an @ for an invite link and open it on this device.",
    welcomeTitle: "Welcome to Kuribotas! 👋",
    pickNick: "Pick your nick. It's yours: nobody else can use it (you can change it later with /nick).",
    nickPlaceholder: "e.g. Estraga_Lar",
    enter: "Enter",
    deviceTitle: (nick) => `Sign in as ${nick} on this device?`,
    deviceText: "This link adds this device to your account. If you didn't ask for it, close this page.",
    checking: "checking the invite…",
    codeLabel: "Already in on another device? Type /device there and enter the code here:",
    codeButton: "Use code",
    errors: {
      invite_unknown: "This invite link doesn't exist. Maybe it got cut off when copied?",
      invite_used: "This invite has already been used. Ask for another 🙏",
      invite_expired: "This invite has expired. Ask for another 🙏",
      invalid_nick: "Invalid nick: 1 to 24 letters, digits or _-~*^.|[]{} (no spaces).",
      nick_taken: "That nick already belongs to someone. Pick another.",
      too_many_tries: "Too many tries. Wait a few minutes and try again.",
      other: "Something went wrong. Try again.",
      offline: "Can't reach the server. Try again in a moment.",
    },
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
    nudgeAll: (from, ch) => `${from} nudged everyone in ${ch}! 📳`,
    thrown: (item, from, to) =>
      ({
        chinela: `${from} threw a slipper at ${to}! 🩴💨`,
        vassoura: `${from} chased ${to} out with a broom! 🧹`,
        colher: `${from} bonked ${to} with Maria das Dores, the wooden spoon! BONK!`,
      })[item],
    batuque: (from, ch) => `${from} started a drum session in ${ch}! 🥁🥁🥁`,
    tornadoAll: (from, ch) => `${from} sent a TORNADO to everyone in ${ch}! 🌪️🌪️`,
    shake: (on) => (on ? "Nudges on for this device 📳" : "Nudges off for this device: you'll see the line, no shaking or sound"),
    theme: (t) =>
      ({
        escuro: "Dark theme on this device 🌙",
        claro: "Light theme on this device ☀️",
        auto: "Automatic theme: follows your phone's light or dark setting 🌗",
      })[t],
    sound: (name, t) => `${t ? "Tornado" : "Nudge"} sound on this device: ${name} 🔊`,
    notify: (on) =>
      on
        ? "Notifications on for this device 🔔 You'll know when someone calls your nick or nudges you, even with the app closed (Busy = quiet)"
        : "Notifications off for this device 🔕",
    notifyUnsupported:
      "This device can't get notifications here. They need https (on the family's phones, from phase 5); on an iPhone, install the app first (Share → Add to Home Screen)",
    notifyDenied: "The browser is blocking notifications from this site: change it in the site settings and try again",
    invitedYou: (from, ch) => `${from} invited you to ${ch} 🔒 Type /join ${ch} to go in`,
    youInvited: (to, ch) => `You invited ${to} to ${ch}`,
    sounds: (current, options, t) =>
      t
        ? `Tornado sounds: ${options.join(" · ")} (now: ${current}). Pick one with /sound tornado <name>`
        : `Nudge sounds: ${options.join(" · ")} (now: ${current}). Pick one with /sound <name> · tornadoes: /sound tornado`,
    disconnected: "Connection lost. Reconnecting…",
    reconnected: "Back online! 🔌",
    roomsTitle: "Rooms:",
    room: (name, people, topic, home, priv) =>
      `${priv ? "🔒 " : home ? "🏠 " : ""}${name} · ${people === 0 ? "nobody" : people === 1 ? "1 person" : `${people} people`}${topic ? ` · ${topic}` : ""}`,
    roomsHelp: "To join: /join #room · 🏠 = home room (everyone's in it)",
    home: (by, ch, on) => (on ? `${by} made ${ch} a home room 🏠 (everyone joins)` : `${by} took ${ch} off the home rooms`),
    roomDeleted: (ch, by) => `${ch} was deleted by ${by}`,
    inviteLink: (link, copied) =>
      `Invite for one new person 🎟️ It works once, for 7 days: send it only to who you want here${copied ? " (copied ✓)" : ""}: ${link}`,
    deviceLink: (link, code, copied) =>
      `For your other device (10 minutes): open ${link}${copied ? " (copied ✓)" : ""} or enter the code ${code} at the door 🚪`,
    devicesTitle: "Your devices:",
    device: (id, name, since, seen, current) =>
      `[${id}] ${name || "device"} · since ${since} · seen ${seen}${current ? " ← this one" : ""}`,
    devicesHelp: "To remove one (lost phone?): /logout <number>",
    role: (by, nick, op) => (op ? `${by} gave @ to ${nick}` : `${by} took @ from ${nick}`),
    removed: (nick, by) => `${nick} was removed from Kuribotas by ${by}`,
  },
  errors: {
    invalid_nick: () => "invalid nick: use 1-24 letters, digits or _-~*^.|[]{} (no spaces)",
    nick_taken: (d) => `nick already in use: ${d}`,
    invalid_channel: () => "invalid channel: use # and 1-32 letters, digits, _ or -",
    not_in_channel: (d) => `you are not in ${d}`,
    join_first: (d) => `join ${d} first`,
    topic_too_long: (d) => `topic too long (max ${d})`,
    note_too_long: (d) => `note too long (max ${d})`,
    no_such_nick: (d) => `nobody called ${d} around here`,
    invite_only: (d) => `${d} is private 🔒 ask someone inside: /invite <your nick>`,
    channel_exists: (d) => `${d} already exists and is public: pick another name`,
    already_in_channel: (d) => `${d} is already in`,
    nudge_too_soon: (d) => `easy! wait ${d} s before nudging again`,
    tornado_too_soon: (d) => `one tornado at a time 🌪️ wait ${d} s`,
    invisible_no_nudge: () => "you can't do that while invisible (it would give you away 👀)",
    throw_too_soon: (d) => `easy with the slipper! wait ${d} s`,
    batuque_too_soon: (d) => `the drums are still echoing 🥁 wait ${d} s`,
    internal: () => "something went wrong, please try again",
    push_invalid: () => "this device sent a notification address I don't recognise. Try /notifications on again",
    not_op: () => "only an @ can do that",
    no_such_person: (d) => `nobody in Kuribotas is called ${d}`,
    cant_remove_op: (d) => `${d} is an @: take their @ first (/deop ${d})`,
    cant_deop_self: () => "you can't drop your own @: ask another @",
    no_such_device: (d) => `you have no device ${d} (see /devices)`,
    too_fast: (d) => `easy there! Too many messages in a row: wait ${d} s`,
    no_such_channel: (d) => `there's no room ${d} (see /rooms)`,
    cant_delete_home: (d) => `${d} is a home room 🏠: take it off first with /home -${d} (#mujimbo always stays)`,
    confirm_delete: (d) => `that room has ${d === "1" ? "1 message" : `${d} messages`}, which will be lost. To delete it anyway: /delete #room yes`,
  },
  usage: (u) => `usage: ${u}`,
  examples: { nick: "/nick <name>", join: "/join #channel", me: "/me <action>", topic: "/topic <text>", colour: "/colour amber | blue | green | coral | violet", lang: "/lang pt | en", nudge: "/nudge <nick> | all", tornado: "/tornado <nick> | all", shake: "/shake on | off", sound: "/sound <name>", msg: "/msg <nick> <message>", invite: "/invite <nick> [#channel]", private: "/private #channel", throw: "/slipper | /broom | /spoon <nick>", notify: "/notifications on | off", op: "/op <nick>", deop: "/deop <nick>", remove: "/kick <nick>", logout: "/logout [number]", home: "/home #room | -#room", delete: "/delete #room [yes]", theme: "/theme dark | light | auto" },
  unknownSound: (name, options) => `no sound called ${name}. You have: ${options.join(" · ")}`,
  channelsOnly: "that only works in channels (this is a private chat)",
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
    "/nudge all — the whole channel (once a minute) · /tornado all — once every 5 minutes",
    "/shake off — no nudges on this device (/shake on to undo)",
    "/sound — this device's nudge sound (/sound 3, /sound panelas) · /sound tornado — the tornado's",
    "/slipper · /broom · /spoon <nick> — throw 🩴🧹🥄 (3 per 10 s) · /drums — 🥁 for everyone (once a minute)",
    "/notifications on — get told with the app closed when someone calls you or nudges you 🔔 (off to stop)",
    "/msg <nick> [message] — private chat 💬 (not saved)",
    "/device — add another device of yours (link or code, 10 minutes) · /devices — your devices · /logout — sign this device out (/logout 2 removes another)",
    "/rooms — every room, who's in it and its topic",
    "/invitelink — (@) a link to bring in a new person 🎟️ · /op · /deop <nick> — give or take @ · /kick <nick> — remove someone from Kuribotas",
    "/home #room — (@) a room everyone joins 🏠 (/home -#room to take it off) · /delete #room — (@) delete a room",
    "/private #channel — make a private channel 🔒 · /invite <nick> — let someone in",
    "/theme dark | light | auto — this device's look (auto follows the phone)",
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
