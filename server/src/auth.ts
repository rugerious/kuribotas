import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiError, InviteInfo, Me } from "../../shared/protocol.ts";
import type { InviteKind, Person, Role, Store } from "./store.ts";

// Accounts without passwords: an invite link lets one person in, and each device they use keeps a
// session in a cookie the page's scripts can't read (HttpOnly). Only hashes of tokens are stored.

export const SESSION_COOKIE = "kb_session";
const SESSION_MAX_AGE_S = 365 * 24 * 3600; // refreshed every time the app opens, so it only ends if unused for a year
export const INVITE_VALID_MS: Record<InviteKind, number> = {
  person: 7 * 24 * 3600 * 1000, // time to get the link to someone and for them to open it
  device: 10 * 60 * 1000, // your own second device: right now, or ask for another
};
const REDEEM_TRIES = 20; // attempts to use an invite...
const REDEEM_WINDOW_MS = 10 * 60 * 1000; // ...per address in this time
const MAX_BODY_BYTES = 4096;

export const newToken = (): string => randomBytes(32).toString("base64url"); // 256 bits: can't be guessed
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

// Makes an invite and returns the token for the link (the database keeps only its hash).
export function makeInvite(
  store: Store,
  kind: InviteKind,
  who: { personId: number | null; role: Role; createdBy: number | null },
  now = Date.now(),
): string {
  const token = newToken();
  const expiresAt = new Date(now + INVITE_VALID_MS[kind]).toISOString();
  store.createInvite(hashToken(token), { kind, ...who, expiresAt }, new Date(now).toISOString());
  return token;
}

// The token goes after "#": browsers never send that part to a server, so it stays out of every log.
export function inviteLink(base: string, kind: InviteKind, token: string): string {
  return `${base.replace(/\/+$/, "")}/#${kind === "person" ? "convite" : "aparelho"}=${token}`;
}

export function sessionToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || undefined;
  }
  return undefined;
}

// Who is asking, if anyone: the person behind this request's session cookie.
export function sessionPerson(store: Store, req: IncomingMessage): { person: Person; sessionHash: string } | undefined {
  const token = sessionToken(req);
  if (token === undefined) return undefined;
  const sessionHash = hashToken(token);
  const person = store.sessionPerson(sessionHash, new Date().toISOString());
  return person === undefined ? undefined : { person, sessionHash };
}

// Requests that change something (and the WebSocket) must come from our own page: another site can't
// use a visitor's cookie to act for them. Browsers always send Origin on these.
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || req.headers.host === undefined) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// "Android · Chrome", for the list of your devices. Only a rough label: never used to decide anything.
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return [system, browser].filter((s) => s !== "").join(" · ");
}

export type AuthOptions = {
  secureCookies: boolean; // true when served over https (phase 5); localhost works without it
  onSignOut?: (sessionHash: string) => void; // close that device's chat connection
};

// The /api routes. Returns false for anything that isn't one of them.
export function authRoutes(store: Store, options: AuthOptions) {
  const tries = new Map<string, number[]>(); // address -> recent redeem attempts

  const cookie = (token: string, maxAge: number): string =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookies ? "; Secure" : ""}`;

  const reply = (res: ServerResponse, status: number, body: Me | InviteInfo | ApiError | object, setCookie?: string): void => {
    const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
    if (setCookie !== undefined) headers["set-cookie"] = setCookie;
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, error: ApiError["error"]): void => reply(res, status, { error });

  // Behind the Cloudflare tunnel (phase 5) every request comes from the tunnel, so its header names the visitor.
  const address = (req: IncomingMessage): string => {
    const forwarded = req.headers["cf-connecting-ip"];
    return typeof forwarded === "string" ? forwarded : (req.socket.remoteAddress ?? "");
  };

  const tooMany = (req: IncomingMessage): boolean => {
    const now = Date.now();
    const key = address(req);
    const recent = (tries.get(key) ?? []).filter((at) => now - at < REDEEM_WINDOW_MS);
    recent.push(now);
    tries.set(key, recent);
    if (tries.size > 10_000) tries.clear(); // never grows without bound
    return recent.length > REDEEM_TRIES;
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!path.startsWith("/api/")) return false;

    if (req.method === "GET" && path === "/api/me") {
      const found = sessionPerson(store, req);
      if (found === undefined) {
        fail(res, 401, "no_session");
        return true;
      }
      const token = sessionToken(req) ?? "";
      reply(res, 200, { nick: found.person.nick, role: found.person.role } satisfies Me, cookie(token, SESSION_MAX_AGE_S));
      return true;
    }

    // What an invite link is, so the page can greet the newcomer (or say the link is no good).
    const asked = /^\/api\/invite\/([A-Za-z0-9_-]{20,100})$/.exec(path);
    if (req.method === "GET" && asked !== null) {
      const invite = store.invite(hashToken(asked[1] ?? ""));
      if (invite === undefined) fail(res, 404, "invite_unknown");
      else if (invite.usedAt !== null) fail(res, 410, "invite_used");
      else if (invite.expiresAt <= new Date().toISOString()) fail(res, 410, "invite_expired");
      else if (invite.kind === "device") {
        const nick = invite.personId === null ? undefined : store.personById(invite.personId)?.nick;
        if (nick === undefined) fail(res, 404, "invite_unknown");
        else reply(res, 200, { kind: "device", nick } satisfies InviteInfo);
      } else reply(res, 200, { kind: "person" } satisfies InviteInfo);
      return true;
    }

    if (req.method === "POST" && (path === "/api/redeem" || path === "/api/logout")) {
      if (!sameOrigin(req)) {
        fail(res, 403, "forbidden");
        return true;
      }
      if (path === "/api/logout") {
        const found = sessionPerson(store, req);
        if (found !== undefined) {
          store.deleteSession(found.sessionHash);
          options.onSignOut?.(found.sessionHash);
        }
        reply(res, 200, {}, cookie("", 0));
        return true;
      }
      if (tooMany(req)) {
        fail(res, 429, "too_many_tries");
        return true;
      }
      const body = await readJson(req);
      const token = typeof body?.token === "string" ? body.token : "";
      const nick = typeof body?.nick === "string" ? body.nick : "";
      if (token === "") {
        fail(res, 400, "bad_request");
        return true;
      }
      const session = newToken();
      const result = store.redeem(hashToken(token), nick, hashToken(session), deviceName(req.headers["user-agent"]), new Date().toISOString());
      if (!result.ok) {
        const status = result.error === "invite_unknown" ? 404 : result.error.startsWith("invite_") ? 410 : 400;
        fail(res, status, result.error);
        return true;
      }
      reply(res, 200, { nick: result.person.nick, role: result.person.role } satisfies Me, cookie(session, SESSION_MAX_AGE_S));
      return true;
    }

    fail(res, 404, "not_found");
    return true;
  };
}

// A small JSON body, or undefined (wrong type, too big, not JSON).
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
