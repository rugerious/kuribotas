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

// A private message between two people (kept 3 days, like the private rooms' messages).
export type DirectMessage = { id: number; from: string; to: string; kind: MessageKind; text: string; at: string };

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

// A room as the server sees it. Private rooms (🔒) are saved too, but hidden from the list and
// with no saved messages; home rooms are the ones everyone is in.
export type Room = { name: string; topic: string; private: boolean; home: boolean };

export type Store = {
  getChannel: (name: string) => Channel | undefined;
  createChannel: (name: string, at: string) => Channel; // returns the existing one if it already exists
  listChannels: () => Channel[]; // public ones (private rooms are hidden)
  room: (name: string) => Room | undefined; // any room, with its kind
  createRoom: (name: string, at: string, isPrivate: boolean) => Room;
  homeRooms: () => string[]; // everyone is in these
  setHome: (name: string, home: boolean) => void;
  addMember: (personId: number, room: string, at: string) => void;
  removeMember: (personId: number, room: string) => void;
  isMember: (personId: number, room: string) => boolean;
  roomsOf: (personId: number) => string[]; // the rooms this person reopens on every connection
  memberCount: (room: string) => number;
  messageCount: (room: string) => number;
  deleteRoom: (name: string) => void; // with its messages and memberships
  setTopic: (name: string, topic: string) => Channel;
  addMessage: (msg: NewMessage) => StoredMessage;
  recentMessages: (channel: string, limit: number) => StoredMessage[];
  deleteMessagesBefore: (at: string) => number; // how many went
  deletePrivateBefore: (at: string) => number; // private rooms' messages and direct messages older than `at`
  addDirect: (fromId: number, toId: number, kind: MessageKind, text: string, at: string) => DirectMessage;
  directBetween: (aId: number, bId: number, limit: number) => DirectMessage[]; // oldest first
  directPartners: (personId: number, since: string, limit: number) => string[]; // nicks, most recent first
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
  `
  -- v6: rooms that stay. Private rooms are saved (hidden, no messages); home rooms are joined by
  -- everyone; memberships say which rooms a person reopens on every connection (and, for a private
  -- room, who may come in).
  ALTER TABLE channels ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE channels ADD COLUMN home INTEGER NOT NULL DEFAULT 0;
  UPDATE channels SET home = 1 WHERE name = '#mujimbo';
  CREATE TABLE memberships (
    person_id  INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    joined_at  TEXT NOT NULL,
    PRIMARY KEY (person_id, channel_id)
  );
  `,
  `
  -- v7: private messages are kept (3 days): the private rooms' messages go in messages like any
  -- channel's, and messages between two people go here, by person (so a new nick keeps the thread).
  CREATE TABLE direct_messages (
    id         INTEGER PRIMARY KEY,
    from_id    INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    to_id      INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('say', 'me')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX direct_by_pair ON direct_messages (min(from_id, to_id), max(from_id, to_id), id);
  CREATE INDEX direct_by_time ON direct_messages (created_at);
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
  const selectChannels = db.prepare("SELECT name, topic FROM channels WHERE private = 0 ORDER BY name");
  const insertChannel = db.prepare(`
    INSERT INTO channels (space_id, name, created_at, private)
    SELECT id, :name, :at, :private FROM spaces WHERE name = 'home'
    ON CONFLICT (space_id, name) DO NOTHING
  `);
  const selectRoom = db.prepare("SELECT name, topic, private, home FROM channels WHERE name = :name");
  const selectHomes = db.prepare("SELECT name FROM channels WHERE home = 1 ORDER BY id");
  const updateHome = db.prepare("UPDATE channels SET home = :home WHERE name = :name AND private = 0");
  const insertMember = db.prepare(`
    INSERT INTO memberships (person_id, channel_id, joined_at)
    SELECT :personId, id, :at FROM channels WHERE name = :room
    ON CONFLICT (person_id, channel_id) DO NOTHING
  `);
  const removeMembership = db.prepare(
    "DELETE FROM memberships WHERE person_id = :personId AND channel_id = (SELECT id FROM channels WHERE name = :room)",
  );
  const selectMember = db.prepare(`
    SELECT 1 AS yes FROM memberships m JOIN channels c ON c.id = m.channel_id
    WHERE m.person_id = :personId AND c.name = :room
  `);
  const selectRoomsOf = db.prepare(`
    SELECT c.name AS name FROM memberships m JOIN channels c ON c.id = m.channel_id
    WHERE m.person_id = :personId ORDER BY m.joined_at
  `);
  const countMembers = db.prepare(
    "SELECT count(*) AS n FROM memberships WHERE channel_id = (SELECT id FROM channels WHERE name = :room)",
  );
  const countMessages = db.prepare(
    "SELECT count(*) AS n FROM messages WHERE channel_id = (SELECT id FROM channels WHERE name = :room)",
  );
  const removeRoomMessages = db.prepare(
    "DELETE FROM messages WHERE channel_id = (SELECT id FROM channels WHERE name = :room)",
  );
  const removeRoom = db.prepare("DELETE FROM channels WHERE name = :room");
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
  const removeOldPrivate = db.prepare(
    "DELETE FROM messages WHERE created_at < :at AND channel_id IN (SELECT id FROM channels WHERE private = 1)",
  );
  const removeOldDirect = db.prepare("DELETE FROM direct_messages WHERE created_at < :at");
  const insertDirect = db.prepare(`
    INSERT INTO direct_messages (from_id, to_id, kind, text, created_at) VALUES (:from, :to, :kind, :text, :at)
    RETURNING id
  `);
  const selectDirect = db.prepare(`
    SELECT d.id, f.nick AS sender, t.nick AS receiver, d.kind, d.text, d.created_at
    FROM direct_messages d JOIN people f ON f.id = d.from_id JOIN people t ON t.id = d.to_id
    WHERE min(d.from_id, d.to_id) = min(:a, :b) AND max(d.from_id, d.to_id) = max(:a, :b)
    ORDER BY d.id DESC LIMIT :limit
  `);
  const selectPartners = db.prepare(`
    SELECT p.nick, max(d.id) AS last
    FROM direct_messages d JOIN people p ON p.id = CASE WHEN d.from_id = :me THEN d.to_id ELSE d.from_id END
    WHERE (d.from_id = :me OR d.to_id = :me) AND d.created_at >= :since AND d.from_id <> d.to_id
    GROUP BY p.id ORDER BY last DESC LIMIT :limit
  `);

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
      insertChannel.run({ name, at, private: 0 }); // does nothing if it already exists (safe if two people race)
      const channel = getChannel(name);
      if (channel === undefined) throw new Error(`could not create channel: ${name}`);
      return channel;
    },
    listChannels: () => selectChannels.all().map((row) => toChannel(row)),
    room: (name) => {
      const row = selectRoom.get({ name });
      return row === undefined ? undefined : toRoom(row);
    },
    createRoom: (name, at, isPrivate) => {
      insertChannel.run({ name, at, private: isPrivate ? 1 : 0 });
      const row = selectRoom.get({ name });
      if (row === undefined) throw new Error(`could not create room: ${name}`);
      return toRoom(row);
    },
    homeRooms: () => selectHomes.all().map((row) => String(row.name)),
    setHome: (name, home) => {
      updateHome.run({ name, home: home ? 1 : 0 });
    },
    addMember: (personId, room, at) => {
      insertMember.run({ personId, room, at });
    },
    removeMember: (personId, room) => {
      removeMembership.run({ personId, room });
    },
    isMember: (personId, room) => selectMember.get({ personId, room }) !== undefined,
    roomsOf: (personId) => selectRoomsOf.all({ personId }).map((row) => String(row.name)),
    memberCount: (room) => Number(countMembers.get({ room })?.n ?? 0),
    messageCount: (room) => Number(countMessages.get({ room })?.n ?? 0),
    deleteRoom: (room) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        removeRoomMessages.run({ room });
        removeRoom.run({ room }); // memberships go with it (foreign key)
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
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
    deletePrivateBefore: (at) => Number(removeOldPrivate.run({ at }).changes) + Number(removeOldDirect.run({ at }).changes),
    addDirect: (fromId, toId, kind, text, at) => {
      const row = insertDirect.get({ from: fromId, to: toId, kind, text, at });
      const from = selectPersonById.get({ id: fromId });
      const to = selectPersonById.get({ id: toId });
      if (row === undefined || from === undefined || to === undefined) throw new Error("unknown person");
      return { id: Number(row.id), from: String(from.nick), to: String(to.nick), kind, text, at };
    },
    directBetween: (a, b, limit) =>
      selectDirect
        .all({ a, b, limit })
        .map((r) => ({
          id: Number(r.id),
          from: String(r.sender),
          to: String(r.receiver),
          kind: r.kind === "me" ? ("me" as const) : ("say" as const),
          text: String(r.text),
          at: String(r.created_at),
        }))
        .reverse(),
    directPartners: (me, since, limit) => selectPartners.all({ me, since, limit }).map((r) => String(r.nick)),
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

function toRoom(row: Record<string, unknown>): Room {
  return { name: String(row.name), topic: String(row.topic), private: Number(row.private) === 1, home: Number(row.home) === 1 };
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
