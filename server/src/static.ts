import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// Sent with every file. The CSP only allows our own scripts, styles and WebSocket:
// no inline scripts, no third-party code, no framing. Family chats never load anything from elsewhere.
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export type StaticHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

// Serves files from one folder. Returns false when it didn't handle the request
// (not GET/HEAD, not found, or outside the folder), so the caller can answer 404.
export function staticFiles(root: string): StaticHandler {
  const base = resolve(root);

  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      return false; // malformed %-encoding
    }
    if (path.includes("\0")) return false;
    if (path.endsWith("/")) path += "index.html";

    // Never serve anything outside the folder, whatever "..", "%2e%2e" or "%2f" tricks are tried.
    const file = resolve(base, `.${path}`);
    if (!file.startsWith(base + sep)) return false;

    const info = await stat(file).catch(() => undefined);
    if (info === undefined || !info.isFile()) return false;

    res.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-cache", // always revalidate: a new deploy shows up on the next load
      ...SECURITY_HEADERS,
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
    return true;
  };
}
