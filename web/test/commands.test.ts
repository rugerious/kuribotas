import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInput } from "../src/commands.ts";

const here = "#mujimbo";

test("plain text is said in the open channel", () => {
  assert.deepEqual(parseInput("  hello  ", here, "en"), {
    kind: "send",
    msg: { type: "say", channel: here, text: "hello" },
  });
});

test("empty input does nothing", () => {
  assert.deepEqual(parseInput("   ", here, "en"), { kind: "nothing" });
});

test("// sends a line that starts with /", () => {
  assert.deepEqual(parseInput("//shrug", here, "en"), {
    kind: "send",
    msg: { type: "say", channel: here, text: "/shrug" },
  });
});

test("/nick takes the first word", () => {
  assert.deepEqual(parseInput("/nick ~*~Rita~*~", here, "en"), { kind: "send", msg: { type: "nick", nick: "~*~Rita~*~" } });
  assert.deepEqual(parseInput("/NICK Rita", here, "en"), { kind: "send", msg: { type: "nick", nick: "Rita" } });
});

test("/join adds the # if it was forgotten", () => {
  assert.deepEqual(parseInput("/join #futebol", here, "en"), { kind: "send", msg: { type: "join", channel: "#futebol" } });
  assert.deepEqual(parseInput("/join futebol", here, "en"), { kind: "send", msg: { type: "join", channel: "#futebol" } });
});

test("/part leaves the open channel, or the one named", () => {
  assert.deepEqual(parseInput("/part", "#futebol", "en"), { kind: "send", msg: { type: "part", channel: "#futebol" } });
  assert.deepEqual(parseInput("/part #jantar", here, "en"), { kind: "send", msg: { type: "part", channel: "#jantar" } });
});

test("/me and /topic keep the whole rest of the line", () => {
  assert.deepEqual(parseInput("/me sets the table", here, "en"), {
    kind: "send",
    msg: { type: "me", channel: here, text: "sets the table" },
  });
  assert.deepEqual(parseInput("/topic Sunday dinner: who brings dessert?", here, "en"), {
    kind: "send",
    msg: { type: "topic", channel: here, topic: "Sunday dinner: who brings dessert?" },
  });
});

test("commands missing their argument explain how to use them", () => {
  for (const input of ["/nick", "/join", "/me", "/topic"]) {
    const parsed = parseInput(input, here, "en");
    assert.equal(parsed.kind, "error", input);
    assert.match(parsed.kind === "error" ? parsed.text : "", /^usage: /, input);
  }
});

test("/help is handled locally; unknown commands are explained", () => {
  assert.deepEqual(parseInput("/help", here, "en"), { kind: "help" });
  assert.deepEqual(parseInput("/dance", here, "en"), { kind: "error", text: "unknown command /dance — try /help" });
});

test("/colour picks a colour, or the next one; bad names are explained", () => {
  assert.deepEqual(parseInput("/colour blue", here, "en"), { kind: "colour", colour: "blue" });
  assert.deepEqual(parseInput("/COLOR Violet", here, "en"), { kind: "colour", colour: "violet" });
  assert.deepEqual(parseInput("/colour", here, "en"), { kind: "colour" });
  const bad = parseInput("/colour pink", here, "en");
  assert.equal(bad.kind, "error");
});

test("Angolan aliases work whatever the screen language", () => {
  assert.deepEqual(parseInput("/bazar", "#futebol", "en"), { kind: "send", msg: { type: "part", channel: "#futebol" } });
  assert.deepEqual(parseInput("/ajuda", here, "en"), { kind: "help" });
  assert.deepEqual(parseInput("/cor azul", here, "en"), { kind: "colour", colour: "blue" });
  assert.deepEqual(parseInput("/topico jantar", here, "pt"), {
    kind: "send",
    msg: { type: "topic", channel: here, topic: "jantar" },
  });
});

test("status commands: with your own words, or a random caption later", () => {
  assert.deepEqual(parseInput("/biolo", here, "pt"), { kind: "status", status: "busy" });
  assert.deepEqual(parseInput("/vorto fui buscar pão", here, "pt"), { kind: "status", status: "away", note: "fui buscar pão" });
  assert.deepEqual(parseInput("/zongolar", here, "pt"), { kind: "status", status: "invisible" });
  assert.deepEqual(parseInput("/online", here, "en"), { kind: "status", status: "online" });
  assert.deepEqual(parseInput("/frase a ver a bola", here, "pt"), { kind: "note", note: "a ver a bola" });
});

test("mistakes are explained in the screen's language", () => {
  assert.deepEqual(parseInput("/nick", here, "pt"), { kind: "error", text: "Usa assim: /nick <nome>" });
  assert.deepEqual(parseInput("/dança", here, "pt"), { kind: "error", text: "Não conheço o comando /dança. Tenta /ajuda" });
});

test("/lingua switches this device's language; anything else explains itself", () => {
  assert.deepEqual(parseInput("/lingua en", here, "pt"), { kind: "lang", lang: "en" });
  assert.deepEqual(parseInput("/lang PT", here, "en"), { kind: "lang", lang: "pt" });
  assert.deepEqual(parseInput("/lingua", here, "pt"), { kind: "error", text: "Usa assim: /lingua pt | en" });
});

test("/abanar and /tornado nudge someone in the open channel; /abanoes switches nudges on this device", () => {
  assert.deepEqual(parseInput("/abanar Kota", here, "pt"), {
    kind: "send",
    msg: { type: "nudge", channel: here, nick: "Kota", tornado: false },
  });
  assert.deepEqual(parseInput("/tornado Kota", here, "pt"), {
    kind: "send",
    msg: { type: "nudge", channel: here, nick: "Kota", tornado: true },
  });
  assert.equal(parseInput("/nudge Kota", here, "en").kind, "send");
  assert.deepEqual(parseInput("/tornado", here, "pt"), { kind: "error", text: "Usa assim: /tornado <nick> | todos" });
  assert.deepEqual(parseInput("/abanoes não", here, "pt"), { kind: "shake", on: false });
  assert.deepEqual(parseInput("/shake ON", here, "en"), { kind: "shake", on: true });
  assert.equal(parseInput("/abanoes talvez", here, "pt").kind, "error");
});

test("/som lists or picks this device's nudge sound", () => {
  assert.deepEqual(parseInput("/som", here, "pt"), { kind: "sound", tornado: false });
  assert.deepEqual(parseInput("/som 3", here, "pt"), { kind: "sound", tornado: false, name: "3" });
  assert.deepEqual(parseInput("/som tornado", here, "pt"), { kind: "sound", tornado: true });
  assert.deepEqual(parseInput("/som Tornado Amapiano", here, "pt"), { kind: "sound", tornado: true, name: "amapiano" });
  assert.deepEqual(parseInput("/sound Panelas", here, "en"), { kind: "sound", tornado: false, name: "panelas" });
  assert.deepEqual(parseInput("/som padrão", here, "pt"), { kind: "sound", tornado: false, name: "padrao" });
});

test("/abanar todos and /tornado all go to the whole channel", () => {
  assert.deepEqual(parseInput("/abanar todos", here, "pt"), {
    kind: "send",
    msg: { type: "nudge", channel: here, everyone: true, tornado: false },
  });
  assert.deepEqual(parseInput("/tornado ALL", here, "en"), {
    kind: "send",
    msg: { type: "nudge", channel: here, everyone: true, tornado: true },
  });
});

test("/msg sends a DM, or just opens the tab; in a DM tab, text and /me go to that person", () => {
  assert.deepEqual(parseInput("/msg Kota vem jantar", here, "pt"), {
    kind: "send",
    msg: { type: "msg", to: "Kota", kind: "say", text: "vem jantar" },
  });
  assert.deepEqual(parseInput("/msg Kota", here, "pt"), { kind: "openDm", nick: "Kota" });
  assert.deepEqual(parseInput("olá", "Kota", "pt"), { kind: "send", msg: { type: "msg", to: "Kota", kind: "say", text: "olá" } });
  assert.deepEqual(parseInput("/me acena", "Kota", "pt"), {
    kind: "send",
    msg: { type: "msg", to: "Kota", kind: "me", text: "acena" },
  });
  assert.deepEqual(parseInput("/bazar", "Kota", "pt"), { kind: "closeDm", nick: "Kota" });
  assert.deepEqual(parseInput("/abanar", "Kota", "pt"), { kind: "send", msg: { type: "nudge", to: "Kota", tornado: false } });
  assert.deepEqual(parseInput("/tornado", "Kota", "pt"), { kind: "send", msg: { type: "nudge", to: "Kota", tornado: true } });
  assert.deepEqual(parseInput("/topico olá", "Kota", "pt"), { kind: "error", text: "Isso é só nos canais (aqui é conversa privada)" });
});

test("/privado makes a private channel; /invite lets someone in (here, or a channel named)", () => {
  assert.deepEqual(parseInput("/privado primos", here, "pt"), {
    kind: "send",
    msg: { type: "join", channel: "#primos", private: true },
  });
  assert.deepEqual(parseInput("/invite Kota", "#primos", "pt"), {
    kind: "send",
    msg: { type: "invite", channel: "#primos", nick: "Kota" },
  });
  assert.deepEqual(parseInput("/convidar Kota #primos", "Mãe", "pt"), {
    kind: "send",
    msg: { type: "invite", channel: "#primos", nick: "Kota" },
  });
  assert.equal(parseInput("/invite Kota", "Mãe", "pt").kind, "error"); // in a DM, say which channel
});

test("/chinela, /vassoura and /colher aim at someone; /batuque is for everyone; not in a private chat", () => {
  assert.deepEqual(parseInput("/chinela Kota", here, "pt"), {
    kind: "send",
    msg: { type: "throw", channel: here, item: "chinela", nick: "Kota" },
  });
  assert.deepEqual(parseInput("/spoon Kota", here, "en"), {
    kind: "send",
    msg: { type: "throw", channel: here, item: "colher", nick: "Kota" },
  });
  assert.deepEqual(parseInput("/batuque", here, "pt"), { kind: "send", msg: { type: "throw", channel: here, item: "batuque" } });
  assert.deepEqual(parseInput("/mariadasdores Kota", here, "pt"), {
    kind: "send",
    msg: { type: "throw", channel: here, item: "colher", nick: "Kota" },
  });
  assert.deepEqual(parseInput("/vassoura", here, "pt"), { kind: "error", text: "Usa assim: /chinela | /vassoura | /mariadasdores <nick>" });
  assert.equal(parseInput("/chinela Kota", "Kota", "pt").kind, "error");
});

test("/notificacoes switches notifications on this device", () => {
  assert.deepEqual(parseInput("/notificacoes sim", here, "pt"), { kind: "notify", on: true });
  assert.deepEqual(parseInput("/notificações não", here, "pt"), { kind: "notify", on: false });
  assert.deepEqual(parseInput("/notifications on", here, "en"), { kind: "notify", on: true });
  assert.deepEqual(parseInput("/notificacoes", here, "pt"), { kind: "error", text: "Usa assim: /notificacoes sim | nao" });
});

test("accounts: invites, devices, signing out, @", () => {
  assert.deepEqual(parseInput("/convite", here, "pt"), { kind: "send", msg: { type: "make_invite" } });
  assert.deepEqual(parseInput("/device", here, "en"), { kind: "send", msg: { type: "make_device_link" } });
  assert.deepEqual(parseInput("/aparelhos", here, "pt"), { kind: "send", msg: { type: "devices" } });
  assert.deepEqual(parseInput("/xau", here, "pt"), { kind: "logout" });
  assert.deepEqual(parseInput("/xau [3]", here, "pt"), { kind: "send", msg: { type: "forget_device", id: 3 } });
  assert.deepEqual(parseInput("/logout x", here, "en"), { kind: "error", text: "usage: /logout [number]" });
  assert.deepEqual(parseInput("/op Kota", here, "pt"), { kind: "send", msg: { type: "role", nick: "Kota", role: "admin" } });
  assert.deepEqual(parseInput("/deop Kota", here, "pt"), { kind: "send", msg: { type: "role", nick: "Kota", role: "member" } });
  assert.deepEqual(parseInput("/kick Kota", here, "en"), { kind: "send", msg: { type: "remove", nick: "Kota" } });
  assert.deepEqual(parseInput("/expulsar", here, "pt"), { kind: "error", text: "Usa assim: /expulsar <nick>" });
});
