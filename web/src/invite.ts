// Invite links put their token after "#": "#convite=…" (a new person) or "#aparelho=…" (another device
// of someone already in). Browsers never send that part to the server, so it stays out of every log.
// Returns the token, or null for anything else.
export function inviteToken(hash: string): string | null {
  const match = /^#(?:convite|aparelho)=([A-Za-z0-9_-]{20,100})$/.exec(hash);
  return match?.[1] ?? null;
}
