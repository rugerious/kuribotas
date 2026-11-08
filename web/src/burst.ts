// Big emoji: a message that is only one of these fills the screen of everyone in the open room for a
// moment, does its move, and goes ("o emoji vem… ri e baza"). Drawn with the emoji itself and CSS
// (style.css, "burst-*"); the message stays in the chat as a normal line.

export type Move = "laugh" | "cry" | "heart" | "fire" | "clap" | "angry" | "shock" | "flag" | "party";

const MOVES: Record<string, Move> = {
  "😂": "laugh",
  "🤣": "laugh",
  "😭": "cry",
  "❤️": "heart",
  "❤": "heart", // some keyboards send the heart without its colour selector
  "🔥": "fire",
  "👏": "clap",
  "🙌": "clap",
  "😡": "angry",
  "😱": "shock",
  "🇦🇴": "flag",
  "🎉": "party",
};

export const BURST_MS = 1800; // how long the overlay stays (style.css matches)
export const BURST_GAP_MS = 4000; // at most one every few seconds: fun, not a party of 😂😂😂

// The move for a message, if it is exactly one of the nine (spaces around it are fine; a skin tone too).
export function burstFor(text: string): { emoji: string; move: Move } | null {
  const bare = text.trim().replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
  const move = MOVES[bare];
  return move === undefined ? null : { emoji: bare === "❤" ? "❤️" : text.trim(), move };
}
