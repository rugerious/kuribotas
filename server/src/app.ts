import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { authRoutes, sameOrigin, sessionPerson } from "./auth.ts";
import { attachChat } from "./chat.ts";
import { loadVapidKeys, webPushSender, type PushSend } from "./push.ts";
import { familySounds, staticFiles } from "./static.ts";
import { openStore, type Store } from "./store.ts";

export type AppOptions = {
  // Path to the SQLite file, or ":memory:" for a throwaway database (tests).
  dbPath: string;
  // Folder with the built web client (web/dist). Omit it to serve no files.
  webDir?: string;
  // Folder with the family's own sounds (nudge.mp3, tornado.mp3). Private: never in Git or the image.
  soundsDir?: string;
  // How often to check that each connection is still alive (ms). Tests use a short one.
  heartbeatMs?: number;
  // Where the server's notification keys (VAPID) are kept; omit for throwaway keys in memory (tests).
  vapidPath?: string;
  // How notifications are sent; tests pass a fake that records them instead of calling Google or Apple.
  pushSend?: PushSend;
  // Session cookies get the Secure flag (https only). Off for http://localhost while developing.
  secureCookies?: boolean;
  // Channel messages older than this are deleted (on start, then once a day). 0 = keep everything.
  historyDays?: number;
};

const HISTORY_DAYS = 90; // the family's choice: the gossip doesn't stay around for long
const DAY_MS = 24 * 60 * 60 * 1000;

export type App = {
  server: Server;
  store: Store; // for the console's invite command and for tests
  // Closes chat connections, then the HTTP server, then the database.
  close: () => Promise<void>;
};

// Builds the app. Kept separate from index.ts so tests can start it
// on a random port with an in-memory database, without side effects.
export function createApp(options: AppOptions): App {
  const store = openStore(options.dbPath);
  const serveStatic = options.webDir === undefined ? undefined : staticFiles(options.webDir);
  const serveSounds = options.soundsDir === undefined ? undefined : familySounds(options.soundsDir);
  const vapid = loadVapidKeys(options.vapidPath);
  let signOut: (sessionHash: string) => void = () => {}; // set once the chat exists
  const serveApi = authRoutes(store, { secureCookies: options.secureCookies ?? false, onSignOut: (hash) => signOut(hash) });

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    // The public half of the server's notification key: browsers need it to subscribe.
    if (req.method === "GET" && req.url === "/push/key") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
      res.end(JSON.stringify({ publicKey: vapid.publicKey }));
      return;
    }
    if (await serveApi(req, res)) return;
    if (serveSounds !== undefined && (await serveSounds(req, res))) return;
    if (serveStatic !== undefined && (await serveStatic(req, res))) return;
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  };

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      console.error(`request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
  });

  const chat = attachChat(server, store, {
    heartbeatMs: options.heartbeatMs,
    pushSend: options.pushSend ?? webPushSender(vapid),
    // Only our own page may open the chat, and only for someone signed in.
    admit: (req) => (sameOrigin(req) ? (sessionPerson(store, req) ?? "signed_out") : "forbidden"),
  });
  signOut = chat.signOut;

  // Old gossip goes: once now (a server that was off for a while catches up), then every day.
  const historyDays = options.historyDays ?? HISTORY_DAYS;
  const forgetOld = (): void => {
    if (historyDays <= 0) return;
    try {
      const gone = store.deleteMessagesBefore(new Date(Date.now() - historyDays * DAY_MS).toISOString());
      if (gone > 0) console.log(`history: deleted ${gone} messages older than ${historyDays} days`);
    } catch (err) {
      console.error(`history: could not delete old messages: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  forgetOld();
  const daily = setInterval(forgetOld, DAY_MS);
  daily.unref();

  return {
    server,
    store,
    close: async () => {
      clearInterval(daily);
      await chat.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
