import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, openStore, type NewMessage } from "../src/store.ts";

const at = (minute: number): string => `2026-12-24T20:${String(minute).padStart(2, "0")}:00.000Z`;

function say(channel: string, text: string, minute = 0, nick = "alice"): NewMessage {
  return { channel, nick, kind: "say", text, at: at(minute) };
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "kuribotas-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a fresh database has #mujimbo, no topic and no messages", () => {
  const store = openStore(":memory:");
  assert.deepEqual(store.listChannels(), [{ name: "#mujimbo", topic: "" }]);
  assert.deepEqual(store.recentMessages("#mujimbo", 10), []);
  store.close();
});

test("messages come back oldest first, limited, with nick and kind", () => {
  const store = openStore(":memory:");
  store.addMessage(say("#mujimbo", "one", 0));
  store.addMessage(say("#mujimbo", "two", 1, "bob"));
  const three = store.addMessage({ channel: "#mujimbo", nick: "carol", kind: "me", text: "waves", at: at(2) });
  assert.equal(typeof three.id, "number");
  const recent = store.recentMessages("#mujimbo", 2);
  assert.deepEqual(
    recent.map((m) => [m.nick, m.kind, m.text]),
    [
      ["bob", "say", "two"],
      ["carol", "me", "waves"],
    ],
  );
  assert.deepEqual(recent[1], three);
  store.close();
});

test("a message for an unknown channel is rejected", () => {
  const store = openStore(":memory:");
  assert.throws(() => store.addMessage(say("#nope", "hi")), /unknown channel/);
  store.close();
});

test("SQL in a message is stored as plain text (no injection)", () => {
  const store = openStore(":memory:");
  const evil = "'; DROP TABLE messages; --";
  store.addMessage(say("#mujimbo", evil, 0));
  store.addMessage(say("#mujimbo", "still here", 1));
  assert.deepEqual(
    store.recentMessages("#mujimbo", 10).map((m) => m.text),
    [evil, "still here"],
  );
  store.close();
});

test("channels are created once, listed by name, and keep separate histories", () => {
  const store = openStore(":memory:");
  const first = store.createChannel("#futebol", at(0));
  const again = store.createChannel("#futebol", at(5)); // a second /join must not duplicate it
  assert.deepEqual(first, again);
  assert.deepEqual(
    store.listChannels().map((c) => c.name),
    ["#futebol", "#mujimbo"],
  );
  store.addMessage(say("#futebol", "goal!"));
  assert.deepEqual(store.recentMessages("#mujimbo", 10), []);
  assert.deepEqual(
    store.recentMessages("#futebol", 10).map((m) => m.text),
    ["goal!"],
  );
  store.close();
});

test("a topic can be set, and only on a channel that exists", () => {
  const store = openStore(":memory:");
  assert.deepEqual(store.setTopic("#mujimbo", "Sunday dinner: who brings dessert?"), {
    name: "#mujimbo",
    topic: "Sunday dinner: who brings dessert?",
  });
  assert.equal(store.getChannel("#mujimbo")?.topic, "Sunday dinner: who brings dessert?");
  assert.throws(() => store.setTopic("#nope", "x"), /unknown channel/);
  store.close();
});

test("messages survive a restart, and migrations run only once", () => {
  withTempDir((dir) => {
    const file = join(dir, "kuribotas.db");
    const first = openStore(file);
    first.addMessage(say("#mujimbo", "before restart"));
    first.close();
    // Reopening would fail on CREATE TABLE / ADD COLUMN if a migration ran a second time.
    const second = openStore(file);
    assert.deepEqual(
      second.recentMessages("#mujimbo", 10).map((m) => m.text),
      ["before restart"],
    );
    second.close();
  });
});

test("a version-1 database is upgraded and keeps its messages", () => {
  withTempDir((dir) => {
    const file = join(dir, "kuribotas.db");
    // Build a database exactly as the released v1 code left it.
    const old = new DatabaseSync(file);
    old.exec(MIGRATIONS[0] ?? "");
    old.exec("PRAGMA user_version = 1");
    old.exec(
      "INSERT INTO messages (channel_id, text, created_at) " +
        "SELECT id, 'from v1', '2026-11-01T00:00:00.000Z' FROM channels WHERE name = '#mujimbo'",
    );
    old.close();

    const store = openStore(file); // runs migration 2 only
    assert.deepEqual(
      store.recentMessages("#mujimbo", 10).map((m) => [m.nick, m.kind, m.text]),
      [["", "say", "from v1"]],
    );
    store.close();
  });
});
