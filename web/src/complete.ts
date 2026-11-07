// Nick completion, mIRC style: type the start of a name ("Ko", or "@ko") and the app offers "Kota".
// Pure functions, so the rules are tested without a browser.

export type Completion = { start: number; end: number; matches: string[] };

// The word being typed at the cursor, and the nicks it could be. Two letters are enough (one after "@").
// Commands' own names ("/abanar") are left alone, but their arguments complete ("/abanar Ko").
export function completions(text: string, cursor: number, nicks: string[], max = 4): Completion | null {
  const before = text.slice(0, cursor);
  const word = /(^|\s)(@?)([^\s@]*)$/u.exec(before);
  if (word === null) return null;
  const at = word[2] ?? "";
  const typed = word[3] ?? "";
  if (typed.length < (at ? 1 : 2) || typed.startsWith("/")) return null;
  const start = cursor - at.length - typed.length;
  let end = cursor;
  while (end < text.length && !/\s/u.test(text[end] ?? "")) end++;
  const lower = typed.toLowerCase();
  const matches = nicks
    .filter((n) => n.toLowerCase().startsWith(lower) && n.toLowerCase() !== lower)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, max);
  return matches.length === 0 ? null : { start, end, matches };
}

// Puts the nick in place of the typed start. At the very beginning of a message it becomes
// "Kota: " (talking to Kota, IRC style); anywhere else "Kota " ("@Kota " keeps the @).
export function complete(text: string, c: Completion, nick: string): { text: string; cursor: number } {
  const keepAt = text[c.start] === "@" ? "@" : "";
  const first = c.start === 0 && keepAt === "";
  const insert = `${keepAt}${nick}${first ? ": " : " "}`;
  const rest = text.slice(c.end).replace(/^\s+/u, "");
  return { text: text.slice(0, c.start) + insert + rest, cursor: c.start + insert.length };
}
