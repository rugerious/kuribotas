import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { attachChat } from "./chat.ts";
import { loadVapidKeys, webPushSender, type PushSend } from "./push.ts";
import { familySounds, staticFiles } from "./static.ts";
import { openStore } from "./store.ts";

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
};

export type App = {
  server: Server;
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
  });

  return {
    server,
    close: async () => {
      await chat.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
