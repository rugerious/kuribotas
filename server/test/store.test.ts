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

test("devices asking for notifications are kept by endpoint, found by nick (any case) and by channel", () => {
  const store = openStore(":memory:");
  const row = {
    endpoint: "https://fcm.googleapis.com/fcm/send/a",
    p256dh: "key",
    auth: "secret",
    nick: "Kota",
    channels: ["#mujimbo", "#futebol"],
    quiet: false,
    lang: "pt" as const,
    at: "2026-12-24T20:00:00.000Z",
    session: "s-phone",
  };
  store.savePush(row);
  store.savePush({ ...row, endpoint: "https://fcm.googleapis.com/fcm/send/b", nick: "Mãe", channels: ["#jantar"] });
  assert.deepEqual(store.pushFor("kota"), [row]);
  assert.deepEqual(store.pushInChannel("#futebol").map((r) => r.nick), ["Kota"]);
  store.savePush({ ...row, nick: "Estraga_Lar", quiet: true }); // the same device, now under another nick
  assert.deepEqual(store.pushFor("Kota"), []);
  assert.equal(store.pushFor("Estraga_Lar")[0]?.quiet, true);
  store.deletePush(row.endpoint);
  assert.deepEqual(store.pushInChannel("#mujimbo"), []);
  store.close();
});

const later = "2026-12-31T00:00:00.000Z";

test("an invite brings in one person, once, with the nick they pick", () => {
  const store = openStore(":memory:");
  assert.equal(store.countPeople(), 0);
  store.createInvite("hash-1", { kind: "person", personId: null, role: "admin", createdBy: null, expiresAt: later }, at(0));
  assert.deepEqual(store.redeem("hash-1", "bad nick", "s-0", "", at(1)), { ok: false, error: "invalid_nick" });
  const first = store.redeem("hash-1", " Mais_Velho ", "s-1", "Android · Chrome", at(1));
  assert.deepEqual(first, { ok: true, person: { id: 1, nick: "Mais_Velho", role: "admin" } });
  assert.deepEqual(store.redeem("hash-1", "Kota", "s-2", "", at(2)), { ok: false, error: "invite_used" });
  assert.deepEqual(store.sessionPerson("s-1", at(3)), { id: 1, nick: "Mais_Velho", role: "admin" });
  assert.equal(store.sessionPerson("s-2", at(3)), undefined);
  assert.equal(store.redeem("nope", "Kota", "s-3", "", at(2)).ok, false);
  store.close();
});

test("nicks belong to one person (any case); a failed redeem leaves the invite unused", () => {
  const store = openStore(":memory:");
  const invite = (hash: string, expiresAt = later) =>
    store.createInvite(hash, { kind: "person", personId: null, role: "member", createdBy: null, expiresAt }, at(0));
  invite("a");
  invite("b");
  invite("old", at(5));
  assert.equal(store.redeem("a", "Kota", "s-a", "", at(1)).ok, true);
  assert.deepEqual(store.redeem("b", "KOTA", "s-b", "", at(1)), { ok: false, error: "nick_taken" });
  assert.equal(store.invite("b")?.usedAt, null); // still usable with another nick
  assert.equal(store.redeem("b", "Kamba", "s-b", "", at(2)).ok, true);
  assert.deepEqual(store.redeem("old", "Primo", "s-c", "", at(6)), { ok: false, error: "invite_expired" });
  assert.equal(store.personByNick("kota")?.nick, "Kota");
  assert.equal(store.renamePerson(1, "kamba"), false); // someone else's, in another case
  assert.equal(store.renamePerson(1, "KOTA"), true); // your own nick in another case is fine
  assert.equal(store.personByNick("kota")?.nick, "KOTA");
  store.close();
});

test("a device link adds a session to someone who is already in; a session can be removed", () => {
  const store = openStore(":memory:");
  store.createInvite("p", { kind: "person", personId: null, role: "member", createdBy: null, expiresAt: later }, at(0));
  store.redeem("p", "Estraga_Lar", "phone", "", at(1));
  store.createInvite("d", { kind: "device", personId: 1, role: "member", createdBy: 1, expiresAt: later }, at(2));
  assert.deepEqual(store.redeem("d", "ignored", "laptop", "", at(3)), { ok: true, person: { id: 1, nick: "Estraga_Lar", role: "member" } });
  assert.equal(store.countPeople(), 1);
  store.deleteSession("phone");
  assert.equal(store.sessionPerson("phone", at(4)), undefined);
  assert.equal(store.sessionPerson("laptop", at(4))?.nick, "Estraga_Lar");
  store.close();
});

test("devices are listed per person; forgetting one ends its session and its notifications", () => {
  const store = openStore(":memory:");
  store.createInvite("p", { kind: "person", personId: null, role: "member", createdBy: null, expiresAt: later }, at(0));
  store.redeem("p", "Kota", "phone", "Android · Chrome", at(1));
  store.createInvite("d", { kind: "device", personId: 1, role: "member", createdBy: 1, expiresAt: later }, at(2));
  store.redeem("d", "", "laptop", "Windows · Edge", at(3));
  const push = { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "k", auth: "a", nick: "Kota", channels: [], quiet: false, lang: "pt" as const, at: at(4) };
  store.savePush({ ...push, session: "phone" });
  const devices = store.sessionsOf(1);
  assert.deepEqual(devices.map((d) => [d.device, d.hash]), [["Android · Chrome", "phone"], ["Windows · Edge", "laptop"]]);
  assert.equal(store.deleteSessionById(2, devices[0]?.id ?? 0), undefined); // not someone else's
  assert.equal(store.deleteSessionById(1, devices[0]?.id ?? 0), "phone");
  assert.deepEqual(store.pushFor("Kota"), []); // the lost phone stays quiet
  assert.equal(store.sessionPerson("phone", at(5)), undefined);
  store.close();
});

test("an @ can be made, and removing a person takes their sessions, invites and notifications", () => {
  const store = openStore(":memory:");
  store.createInvite("p", { kind: "person", personId: null, role: "member", createdBy: null, expiresAt: later }, at(0));
  store.redeem("p", "Primo", "s", "", at(1));
  store.setRole(1, "admin");
  assert.equal(store.personById(1)?.role, "admin");
  store.createInvite("q", { kind: "person", personId: null, role: "member", createdBy: 1, expiresAt: later }, at(2));
  store.savePush({ endpoint: "https://fcm.googleapis.com/fcm/send/y", p256dh: "k", auth: "a", nick: "Primo", channels: [], quiet: false, lang: "pt", at: at(3), session: "s" });
  store.deletePerson(1);
  assert.equal(store.personByNick("Primo"), undefined);
  assert.equal(store.sessionPerson("s", at(4)), undefined);
  assert.equal(store.invite("q"), undefined); // invites they made go too
  assert.deepEqual(store.pushFor("Primo"), []);
  store.close();
});

test("messages older than a date can be deleted; newer ones stay", () => {
  const store = openStore(":memory:");
  store.addMessage(say("#mujimbo", "old gossip", 1));
  store.addMessage(say("#mujimbo", "fresh gossip", 30));
  assert.equal(store.deleteMessagesBefore(at(10)), 1);
  assert.deepEqual(store.recentMessages("#mujimbo", 10).map((m) => m.text), ["fresh gossip"]);
  assert.equal(store.deleteMessagesBefore(at(10)), 0);
  store.close();
});
