import { DatabaseSync } from "node:sqlite";

export type Channel = { name: string; topic: string };
export type MessageKind = "say" | "me"; // "me" is an action: * Rita waves
export type StoredMessage = {
  id: number;
  channel: string;
  nick: string;
  kind: MessageKind;
  text: string;
  at: string;
};
export type NewMessage = Omit<StoredMessage, "id">;

// A device that asked for notifications (Web Push). Until accounts (phase 4) it belongs to a nick,
// and only for public things: mentions in public channels and nudges. `quiet` = No biolo.
export type PushRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  nick: string;
  channels: string[]; // public channels the device was in, for mentions and nudges there
  quiet: boolean;
  lang: "pt" | "en";
  at: string;
  session: string; // the device's session hash: signing it out forgets its notifications too
};

// Someone with an account (phase 4): a nick that belongs to them, on as many devices as they like.
// "admin" is the @ of IRC: can invite new people.
export type Role = "admin" | "member";
export type Person = { id: number; nick: string; role: Role };

// An invite link: "person" brings someone new (they pick their nick), "device" adds a phone or computer
// to someone who is already in. Only a hash of the token is stored: the link itself is never in the database.
export type InviteKind = "person" | "device";
export type Invite = {
  kind: InviteKind;
  personId: number | null; // device links: whose device; person invites: null
  role: Role; // the role a new person gets
  createdBy: number | null; // null = made on the server's console (the very first @)
  expiresAt: string;
  usedAt: string | null;
};

export type SessionRow = { id: number; hash: string; device: string; createdAt: string; seenAt: string };

export type RedeemResult =
  | { ok: true; person: Person }
  | { ok: false; error: "invite_unknown" | "invite_used" | "invite_expired" | "invalid_nick" | "nick_taken" };

export type Store = {
  getChannel: (name: string) => Channel | undefined;
  createChannel: (name: string, at: string) => Channel; // returns the existing one if it already exists
  listChannels: () => Channel[];
  setTopic: (name: string, topic: string) => Channel;
  addMessage: (msg: NewMessage) => StoredMessage;
  recentMessages: (channel: string, limit: number) => StoredMessage[];
  deleteMessagesBefore: (at: string) => number; // how many went
  savePush: (row: PushRow) => void; // insert or replace, by endpoint
  deletePush: (endpoint: string) => void;
  pushFor: (nick: string) => PushRow[]; // any case
  pushInChannel: (channel: string) => PushRow[];
  renamePush: (oldNick: string, nick: string) => void; // a person's other devices follow a nick change
  countPeople: () => number;
  personByNick: (nick: string) => Person | undefined; // any case
  personById: (id: number) => Person | undefined;
  renamePerson: (id: number, nick: string) => boolean; // false if someone else has that nick
  createInvite: (tokenHash: string, invite: Omit<Invite, "usedAt">, at: string) => void;
  invite: (tokenHash: string) => Invite | undefined;
  // Uses the invite (once, ever) and opens a session, all or nothing. `nick` only for person invites.
  redeem: (tokenHash: string, nick: string, sessionHash: string, device: string, now: string) => RedeemResult;
  sessionPerson: (sessionHash: string, now: string) => Person | undefined; // also marks it as seen
  deleteSession: (sessionHash: string) => void; // and that device's notifications
  sessionsOf: (personId: number) => SessionRow[];
  deleteSessionById: (personId: number, id: number) => string | undefined; // the hash, if it was theirs
  setRole: (personId: number, role: Role) => void;
  deletePerson: (personId: number) => void; // with their sessions, invites and notifications
  close: () => void;
};

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
// Never edit a released migration: add a new one at the end.
export const MIGRATIONS: readonly string[] = [
  `
  -- v1: spaces, channels, messages; the home space and #mujimbo.
  CREATE TABLE spaces (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE channels (
    id         INTEGER PRIMARY KEY,
    space_id   INTEGER NOT NULL REFERENCES spaces (id),
    name       TEXT NOT NULL,
    topic      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (space_id, name)
  );
  CREATE TABLE messages (
    id         INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels (id),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_by_channel ON messages (channel_id, id);
  INSERT INTO spaces (name, created_at)
    VALUES ('home', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO channels (space_id, name, created_at)
    SELECT id, '#mujimbo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM spaces WHERE name = 'home';
  `,
  `
  -- v2: who said it, and whether it was a normal line or a /me action.
  ALTER TABLE messages ADD COLUMN nick TEXT NOT NULL DEFAULT '';
  ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'say' CHECK (kind IN ('say', 'me'));
  `,
  `
  -- v3: devices that asked for notifications (Web Push). channels is a JSON array of public channels.
  CREATE TABLE push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    nick       TEXT NOT NULL,
    channels   TEXT NOT NULL DEFAULT '[]',
    quiet      INTEGER NOT NULL DEFAULT 0,
    lang       TEXT NOT NULL DEFAULT 'pt',
    updated_at TEXT NOT NULL
  );
  CREATE INDEX push_by_nick ON push_subscriptions (lower(nick));
  `,
  `
  -- v4: accounts. A person owns a nick; each device they use has a session; invites bring people in.
  -- Tokens are stored as SHA-256 hashes, so a copy of the database can't be used to sign in.
  CREATE TABLE people (
    id         INTEGER PRIMARY KEY,
    nick       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    invited_by INTEGER REFERENCES people (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX people_by_nick ON people (lower(nick));
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    person_id  INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    device     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    seen_at    TEXT NOT NULL
  );
  CREATE INDEX sessions_by_person ON sessions (person_id);
  CREATE TABLE invites (
    token_hash TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('person', 'device')),
    person_id  INTEGER REFERENCES people (id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_by INTEGER REFERENCES people (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  `,
  `
  -- v5: which device (session) asked for notifications, so signing a lost phone out silences it too.
  ALTER TABLE push_subscriptions ADD COLUMN session_hash TEXT NOT NULL DEFAULT '';
  `,
];

// Nicks: 1-24 letters (any language), digits or _-~*^.|[]{} — so "~*~Rita~*~" works, spaces don't.
export const NICK_PATTERN = /^[\p{L}\p{N}_\-~*^.|[\]{}]{1,24}$/u;

// Opens (or creates) the database and brings its schema up to date.
// Use ":memory:" for a throwaway database in tests.
export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL"); // readers don't block the writer; crash-safe writes
  db.exec("PRAGMA busy_timeout = 5000"); // wait up to 5 s instead of failing if the file is busy
  db.exec("PRAGMA foreign_keys = ON"); // a removed person takes their sessions and invites along
  migrate(db);

  // Prepared once, reused for every call. Values are bound, never glued into SQL (no injection).
  // One space ("home") for now, so channels are looked up by name.
  const selectChannel = db.prepare("SELECT name, topic FROM channels WHERE name = :name");
  const selectChannels = db.prepare("SELECT name, topic FROM channels ORDER BY name");
  const insertChannel = db.prepare(`
    INSERT INTO channels (space_id, name, created_at)
    SELECT id, :name, :at FROM spaces WHERE name = 'home'
    ON CONFLICT (space_id, name) DO NOTHING
  `);
  const updateTopic = db.prepare(
    "UPDATE channels SET topic = :topic WHERE name = :name RETURNING name, topic",
  );
  const insertMessage = db.prepare(`
    INSERT INTO messages (channel_id, nick, kind, text, created_at)
    SELECT id, :nick, :kind, :text, :at FROM channels WHERE name = :channel
    RETURNING id
  `);
  const selectRecent = db.prepare(`
    SELECT m.id AS id, c.name AS channel, m.nick AS nick, m.kind AS kind, m.text AS text, m.created_at AS at
    FROM messages m JOIN channels c ON c.id = m.channel_id
    WHERE c.name = :channel
    ORDER BY m.id DESC
    LIMIT :limit
  `);

  const removeOldMessages = db.prepare("DELETE FROM messages WHERE created_at < :at");

  const upsertPush = db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, nick, channels, quiet, lang, updated_at, session_hash)
    VALUES (:endpoint, :p256dh, :auth, :nick, :channels, :quiet, :lang, :at, :session)
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = :p256dh, auth = :auth, nick = :nick,
      channels = :channels, quiet = :quiet, lang = :lang, updated_at = :at, session_hash = :session
  `);
  const removePush = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = :endpoint");
  const pushColumns = "endpoint, p256dh, auth, nick, channels, quiet, lang, updated_at AS at, session_hash AS session";
  const selectPushByNick = db.prepare(`SELECT ${pushColumns} FROM push_subscriptions WHERE lower(nick) = lower(:nick)`);
  const selectPushByChannel = db.prepare(`
    SELECT ${pushColumns} FROM push_subscriptions
    WHERE EXISTS (SELECT 1 FROM json_each(channels) WHERE value = :channel)
  `);

  const updatePushNick = db.prepare("UPDATE push_subscriptions SET nick = :nick WHERE lower(nick) = lower(:oldNick)");

  const selectPeopleCount = db.prepare("SELECT count(*) AS n FROM people");
  const selectPersonByNick = db.prepare("SELECT id, nick, role FROM people WHERE lower(nick) = lower(:nick)");
  const updatePersonNick = db.prepare("UPDATE people SET nick = :nick WHERE id = :id");
  const insertPerson = db.prepare(
    "INSERT INTO people (nick, role, invited_by, created_at) VALUES (:nick, :role, :invitedBy, :at) RETURNING id",
  );
  const insertInvite = db.prepare(`
    INSERT INTO invites (token_hash, kind, person_id, role, created_by, created_at, expires_at)
    VALUES (:tokenHash, :kind, :personId, :role, :createdBy, :at, :expiresAt)
  `);
  const selectInvite = db.prepare(
    "SELECT kind, person_id, role, created_by, expires_at, used_at FROM invites WHERE token_hash = :tokenHash",
  );
  const markInviteUsed = db.prepare("UPDATE invites SET used_at = :at WHERE token_hash = :tokenHash AND used_at IS NULL");
  const insertSession = db.prepare(`
    INSERT INTO sessions (token_hash, person_id, device, created_at, seen_at)
    VALUES (:sessionHash, :personId, :device, :at, :at)
  `);
  const selectSessionPerson = db.prepare(`
    SELECT p.id AS id, p.nick AS nick, p.role AS role
    FROM sessions s JOIN people p ON p.id = s.person_id
    WHERE s.token_hash = :sessionHash
  `);
  const touchSession = db.prepare("UPDATE sessions SET seen_at = :at WHERE token_hash = :sessionHash");
  const removeSession = db.prepare("DELETE FROM sessions WHERE token_hash = :sessionHash");
  const removeSessionPush = db.prepare("DELETE FROM push_subscriptions WHERE session_hash = :sessionHash");
  const removeNickPush = db.prepare("DELETE FROM push_subscriptions WHERE lower(nick) = lower(:nick)");
  const selectSessions = db.prepare(
    "SELECT rowid AS id, token_hash, device, created_at, seen_at FROM sessions WHERE person_id = :personId ORDER BY created_at",
  );
  const updateRole = db.prepare("UPDATE people SET role = :role WHERE id = :personId");
  const removePerson = db.prepare("DELETE FROM people WHERE id = :personId");
  const selectPersonById = db.prepare("SELECT id, nick, role FROM people WHERE id = :id");

  const readInvite = (tokenHash: string): Invite | undefined => {
    const row = selectInvite.get({ tokenHash });
    if (row === undefined) return undefined;
    return {
      kind: row.kind === "device" ? "device" : "person",
      personId: row.person_id === null ? null : Number(row.person_id),
      role: row.role === "admin" ? "admin" : "member",
      createdBy: row.created_by === null ? null : Number(row.created_by),
      expiresAt: String(row.expires_at),
      usedAt: row.used_at === null ? null : String(row.used_at),
    };
  };

  const getChannel = (name: string): Channel | undefined => {
    const row = selectChannel.get({ name });
    return row === undefined ? undefined : toChannel(row);
  };

  return {
    getChannel,
    createChannel: (name, at) => {
      insertChannel.run({ name, at }); // does nothing if it already exists (safe if two people race)
      const channel = getChannel(name);
      if (channel === undefined) throw new Error(`could not create channel: ${name}`);
      return channel;
    },
    listChannels: () => selectChannels.all().map((row) => toChannel(row)),
    setTopic: (name, topic) => {
      const row = updateTopic.get({ name, topic });
      if (row === undefined) throw new Error(`unknown channel: ${name}`);
      return toChannel(row);
    },
    addMessage: (msg) => {
      const row = insertMessage.get({ ...msg });
      if (row === undefined) throw new Error(`unknown channel: ${msg.channel}`);
      return { id: Number(row.id), ...msg };
    },
    recentMessages: (channel, limit) =>
      selectRecent
        .all({ channel, limit })
        .map((row) => toMessage(row))
        .reverse(), // oldest first, ready to display
    deleteMessagesBefore: (at) => Number(removeOldMessages.run({ at }).changes),
    savePush: (row) => {
      upsertPush.run({ ...row, channels: JSON.stringify(row.channels), quiet: row.quiet ? 1 : 0 });
    },
    deletePush: (endpoint) => {
      removePush.run({ endpoint });
    },
    pushFor: (nick) => selectPushByNick.all({ nick }).map((row) => toPush(row)),
    pushInChannel: (channel) => selectPushByChannel.all({ channel }).map((row) => toPush(row)),
    renamePush: (oldNick, nick) => {
      updatePushNick.run({ oldNick, nick });
    },
    countPeople: () => Number(selectPeopleCount.get()?.n ?? 0),
    personByNick: (nick) => {
      const row = selectPersonByNick.get({ nick });
      return row === undefined ? undefined : toPerson(row);
    },
    personById: (id) => {
      const row = selectPersonById.get({ id });
      return row === undefined ? undefined : toPerson(row);
    },
    renamePerson: (id, nick) => {
      const other = selectPersonByNick.get({ nick });
      if (other !== undefined && Number(other.id) !== id) return false;
      updatePersonNick.run({ id, nick });
      return true;
    },
    createInvite: (tokenHash, invite, at) => {
      insertInvite.run({ tokenHash, ...invite, at });
    },
    invite: readInvite,
    redeem: (tokenHash, nick, sessionHash, device, now) => {
      // One transaction: two people opening the same link at once can't both get in, and a failure
      // half way (say, the nick was taken a moment ago) leaves the invite unused.
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = redeemInside(tokenHash, nick.trim(), sessionHash, device, now);
        db.exec(result.ok ? "COMMIT" : "ROLLBACK");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    sessionPerson: (sessionHash, now) => {
      const row = selectSessionPerson.get({ sessionHash });
      if (row === undefined) return undefined;
      touchSession.run({ sessionHash, at: now });
      return toPerson(row);
    },
    deleteSession: (sessionHash) => {
      removeSession.run({ sessionHash });
      removeSessionPush.run({ sessionHash });
    },
    sessionsOf: (personId) =>
      selectSessions.all({ personId }).map((row) => ({
        id: Number(row.id),
        hash: String(row.token_hash),
        device: String(row.device),
        createdAt: String(row.created_at),
        seenAt: String(row.seen_at),
      })),
    deleteSessionById: (personId, id) => {
      const row = selectSessions.all({ personId }).find((r) => Number(r.id) === id);
      if (row === undefined) return undefined;
      const sessionHash = String(row.token_hash);
      removeSession.run({ sessionHash });
      removeSessionPush.run({ sessionHash });
      return sessionHash;
    },
    setRole: (personId, role) => {
      updateRole.run({ personId, role });
    },
    deletePerson: (personId) => {
      const row = selectPersonById.get({ id: personId });
      if (row === undefined) return;
      removeNickPush.run({ nick: String(row.nick) });
      removePerson.run({ personId }); // sessions and invites go with them (foreign keys)
    },
    close: () => db.close(),
  };

  function redeemInside(tokenHash: string, nick: string, sessionHash: string, device: string, now: string): RedeemResult {
    const invite = readInvite(tokenHash);
    if (invite === undefined) return { ok: false, error: "invite_unknown" };
    if (invite.usedAt !== null) return { ok: false, error: "invite_used" };
    if (invite.expiresAt <= now) return { ok: false, error: "invite_expired" };
    let person: Person | undefined;
    if (invite.kind === "device") {
      const row = invite.personId === null ? undefined : selectPersonById.get({ id: invite.personId });
      person = row === undefined ? undefined : toPerson(row);
      if (person === undefined) return { ok: false, error: "invite_unknown" };
    } else {
      if (!NICK_PATTERN.test(nick)) return { ok: false, error: "invalid_nick" };
      if (selectPersonByNick.get({ nick }) !== undefined) return { ok: false, error: "nick_taken" };
      const row = insertPerson.get({ nick, role: invite.role, invitedBy: invite.createdBy, at: now });
      person = { id: Number(row?.id), nick, role: invite.role };
    }
    if (Number(markInviteUsed.run({ tokenHash, at: now }).changes) !== 1) return { ok: false, error: "invite_used" };
    insertSession.run({ sessionHash, personId: person.id, device, at: now });
    return { ok: true, person };
  }
}

function migrate(db: DatabaseSync): void {
  const current = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) break;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK"); // a failed upgrade leaves the database exactly as it was
      throw err;
    }
  }
}

// Rows from node:sqlite are null-prototype objects: turn them into plain, typed objects.
function toChannel(row: Record<string, unknown>): Channel {
  return { name: String(row.name), topic: String(row.topic) };
}

function toMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: Number(row.id),
    channel: String(row.channel),
    nick: String(row.nick),
    kind: row.kind === "me" ? "me" : "say",
    text: String(row.text),
    at: String(row.at),
  };
}

function toPerson(row: Record<string, unknown>): Person {
  return { id: Number(row.id), nick: String(row.nick), role: row.role === "admin" ? "admin" : "member" };
}

function toPush(row: Record<string, unknown>): PushRow {
  return {
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    nick: String(row.nick),
    channels: JSON.parse(String(row.channels)) as string[],
    quiet: Number(row.quiet) === 1,
    lang: row.lang === "en" ? "en" : "pt",
    at: String(row.at),
    session: String(row.session),
  };
}
