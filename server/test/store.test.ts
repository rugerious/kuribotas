import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";

test("a fresh database has #mujimbo and no messages", () => {
  const store = openStore(":memory:");
  assert.deepEqual(store.recentMessages("#mujimbo", 10), []);
  store.close();
});

test("messages come back oldest first, limited to the most recent", () => {
  const store = openStore(":memory:");
  store.addMessage("#mujimbo", "one", "2026-12-24T20:00:00.000Z");
  store.addMessage("#mujimbo", "two", "2026-12-24T20:01:00.000Z");
  const three = store.addMessage("#mujimbo", "three", "2026-12-24T20:02:00.000Z");
  assert.equal(typeof three.id, "number");
  const recent = store.recentMessages("#mujimbo", 2);
  assert.deepEqual(
    recent.map((m) => m.text),
    ["two", "three"],
  );
  assert.deepEqual(recent[1], three);
  store.close();
});

test("a message for an unknown channel is rejected", () => {
  const store = openStore(":memory:");
  assert.throws(() => store.addMessage("#nope", "hi", "2026-12-24T20:00:00.000Z"), /unknown channel/);
  store.close();
});

test("SQL in a message is stored as plain text (no injection)", () => {
  const store = openStore(":memory:");
  const evil = "'; DROP TABLE messages; --";
  store.addMessage("#mujimbo", evil, "2026-12-24T20:00:00.000Z");
  store.addMessage("#mujimbo", "still here", "2026-12-24T20:01:00.000Z");
  assert.deepEqual(
    store.recentMessages("#mujimbo", 10).map((m) => m.text),
    [evil, "still here"],
  );
  store.close();
});

test("messages survive a restart, and migrations run only once", () => {
  const dir = mkdtempSync(join(tmpdir(), "kuribotas-test-"));
  try {
    const file = join(dir, "kuribotas.db");
    const first = openStore(file);
    first.addMessage("#mujimbo", "before restart", "2026-12-24T20:00:00.000Z");
    first.close();
    // Reopening would fail on CREATE TABLE if the migration ran a second time.
    const second = openStore(file);
    assert.deepEqual(
      second.recentMessages("#mujimbo", 10).map((m) => m.text),
      ["before restart"],
    );
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
