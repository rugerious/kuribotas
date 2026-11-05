import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInput } from "../src/commands.ts";

const here = "#mujimbo";

test("plain text is said in the open channel", () => {
  assert.deepEqual(parseInput("  hello  ", here), {
    kind: "send",
    msg: { type: "say", channel: here, text: "hello" },
  });
});

test("empty input does nothing", () => {
  assert.deepEqual(parseInput("   ", here), { kind: "nothing" });
});

test("// sends a line that starts with /", () => {
  assert.deepEqual(parseInput("//shrug", here), {
    kind: "send",
    msg: { type: "say", channel: here, text: "/shrug" },
  });
});

test("/nick takes the first word", () => {
  assert.deepEqual(parseInput("/nick ~*~Rita~*~", here), { kind: "send", msg: { type: "nick", nick: "~*~Rita~*~" } });
  assert.deepEqual(parseInput("/NICK Rita", here), { kind: "send", msg: { type: "nick", nick: "Rita" } });
});

test("/join adds the # if it was forgotten", () => {
  assert.deepEqual(parseInput("/join #futebol", here), { kind: "send", msg: { type: "join", channel: "#futebol" } });
  assert.deepEqual(parseInput("/join futebol", here), { kind: "send", msg: { type: "join", channel: "#futebol" } });
});

test("/part leaves the open channel, or the one named", () => {
  assert.deepEqual(parseInput("/part", "#futebol"), { kind: "send", msg: { type: "part", channel: "#futebol" } });
  assert.deepEqual(parseInput("/part #jantar", here), { kind: "send", msg: { type: "part", channel: "#jantar" } });
});

test("/me and /topic keep the whole rest of the line", () => {
  assert.deepEqual(parseInput("/me sets the table", here), {
    kind: "send",
    msg: { type: "me", channel: here, text: "sets the table" },
  });
  assert.deepEqual(parseInput("/topic Sunday dinner: who brings dessert?", here), {
    kind: "send",
    msg: { type: "topic", channel: here, topic: "Sunday dinner: who brings dessert?" },
  });
});

test("commands missing their argument explain how to use them", () => {
  for (const input of ["/nick", "/join", "/me", "/topic"]) {
    const parsed = parseInput(input, here);
    assert.equal(parsed.kind, "error", input);
    assert.match(parsed.kind === "error" ? parsed.text : "", /^usage: /, input);
  }
});

test("/help is handled locally; unknown commands are explained", () => {
  assert.deepEqual(parseInput("/help", here), { kind: "help" });
  assert.deepEqual(parseInput("/dance", here), { kind: "error", text: "unknown command /dance — try /help" });
});

test("/colour picks a colour, or the next one; bad names are explained", () => {
  assert.deepEqual(parseInput("/colour blue", here), { kind: "colour", colour: "blue" });
  assert.deepEqual(parseInput("/COLOR Violet", here), { kind: "colour", colour: "violet" });
  assert.deepEqual(parseInput("/colour", here), { kind: "colour" });
  const bad = parseInput("/colour pink", here);
  assert.equal(bad.kind, "error");
});
