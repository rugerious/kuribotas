// Invite links put their token after "#": "#convite=…" (a new person) or "#aparelho=…" (another device
// of someone already in). Browsers never send that part to the server, so it stays out of every log.
// Returns the token, or null for anything else.
export function inviteToken(hash: string): string | null {
  const match = /^#convite=([A-Za-z0-9_-]{20,100})$/.exec(hash) ?? /^#aparelho=([A-Za-z0-9_-]{8,100})$/.exec(hash);
  return match?.[1] ?? null;
}

// A device code as typed ("abcd efgh", "ABCD-EFGH") → "ABCDEFGH"; shown back as "ABCD-EFGH".
export const cleanCode = (typed: string): string => typed.toUpperCase().replace(/[^0-9A-Z]/g, "");
export const showCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);
