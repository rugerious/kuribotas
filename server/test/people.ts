// Test helper (not a test file): signs someone in without the invite page, through the same store
// calls the real invite uses. A nick that already has an account gets another device (session).
import { hashToken, newToken } from "../src/auth.ts";
import type { Role, Store } from "../src/store.ts";

const FAR = "2099-01-01T00:00:00.000Z";

// Returns the Cookie header for the new session.
export function signIn(store: Store, nick: string, role: Role = "member"): string {
  const existing = store.personByNick(nick);
  const invite = newToken();
  const session = newToken();
  const now = new Date().toISOString();
  store.createInvite(
    hashToken(invite),
    existing === undefined
      ? { kind: "person", personId: null, role, createdBy: null, expiresAt: FAR }
      : { kind: "device", personId: existing.id, role, createdBy: null, expiresAt: FAR },
    now,
  );
  const result = store.redeem(hashToken(invite), nick, hashToken(session), "test", now);
  if (!result.ok) throw new Error(`could not sign in ${nick}: ${result.error}`);
  return `kb_session=${session}`;
}
