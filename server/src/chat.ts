import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

// What a client may send.
type ClientMessage = { type: "say"; text: string };

// What the server sends.
type ServerMessage =
  | { type: "welcome" }
  | { type: "message"; text: string; at: string };

const MAX_TEXT_LENGTH = 2000; // characters per chat message
const MAX_PAYLOAD_BYTES = 16 * 1024; // larger frames are rejected by ws (close code 1009)
const CLOSE_GRACE_MS = 3000; // on shutdown, wait this long before force-closing clients

export type Chat = { close: () => Promise<void> };

export function attachChat(server: Server): Chat {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  // Only /ws may upgrade to a WebSocket; anything else is refused.
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    // Without an error listener, one bad client (e.g. an oversized frame) would crash the process.
    ws.on("error", (err) => {
      console.warn(`websocket error: ${err.message}`);
    });

    send(ws, { type: "welcome" });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = parseClientMessage(data.toString());
      if (msg === undefined) return; // ignore anything we don't understand
      broadcast(wss, { type: "message", text: msg.text, at: new Date().toISOString() });
    });
  });

  return {
    // Say goodbye to every client (1001 = going away), force-close stragglers, then stop.
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.close(1001, "server shutting down");
        const force = setTimeout(() => {
          for (const client of wss.clients) client.terminate();
        }, CLOSE_GRACE_MS);
        force.unref();
        wss.close(() => {
          clearTimeout(force);
          resolve();
        });
      }),
  };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function broadcast(wss: WebSocketServer, msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

// Never trust the client: anything malformed becomes undefined and is ignored.
function parseClientMessage(raw: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.type !== "say" || typeof v.text !== "string") return undefined;
  const text = v.text.trim();
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return undefined;
  return { type: "say", text };
}
