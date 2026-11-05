import { createServer, type Server } from "node:http";
import { attachChat } from "./chat.ts";
import { openStore } from "./store.ts";

export type AppOptions = {
  // Path to the SQLite file, or ":memory:" for a throwaway database (tests).
  dbPath: string;
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

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const chat = attachChat(server, store);

  return {
    server,
    close: async () => {
      await chat.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
