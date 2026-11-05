import { createServer, type Server } from "node:http";
import { attachChat } from "./chat.ts";

export type App = {
  server: Server;
  // Closes chat connections first, then the HTTP server.
  close: () => Promise<void>;
};

// Builds the app. Kept separate from index.ts so tests can start it
// on a random port without side effects.
export function createApp(): App {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const chat = attachChat(server);

  return {
    server,
    close: async () => {
      await chat.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
