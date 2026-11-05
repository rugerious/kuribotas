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

export type Store = {
  getChannel: (name: string) => Channel | undefined;
  createChannel: (name: string, at: string) => Channel; // returns the existing one if it already exists
  listChannels: () => Channel[];
  setTopic: (name: string, topic: string) => Channel;
  addMessage: (msg: NewMessage) => StoredMessage;
  recentMessages: (channel: string, limit: number) => StoredMessage[];
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
];

// Opens (or creates) the database and brings its schema up to date.
// Use ":memory:" for a throwaway database in tests.
export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL"); // readers don't block the writer; crash-safe writes
  db.exec("PRAGMA busy_timeout = 5000"); // wait up to 5 s instead of failing if the file is busy
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
    close: () => db.close(),
  };
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
