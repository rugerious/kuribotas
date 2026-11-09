// The style of this device: "mirc" (the classic log, [18:41] <Kota> olá) or "moderno" (initials,
// messages grouped by person, rounder bars: the A Noite and B Dia screens). Independent of the theme:
// moderno + escuro is Noite, moderno + claro is Dia. Saved per device and applied as data-look on
// <html> before anything is drawn; mirc leaves the attribute off.
import type { Line } from "./state.ts";

export type Look = "mirc" | "moderno";

export const LOOK_KEY = "kuribotas.look";

const NAMES: Record<string, Look> = {
  mirc: "mirc",
  irc: "mirc",
  classico: "mirc",
  clássico: "mirc",
  classic: "mirc",
  moderno: "moderno",
  modern: "moderno",
  novo: "moderno",
  new: "moderno",
};

// "/estilo Moderno" and "/style modern" both work; anything else is not a style.
export function lookNamed(name: string): Look | undefined {
  return NAMES[name.trim().toLowerCase()];
}

export function loadLook(): Look {
  try {
    return lookNamed(localStorage.getItem(LOOK_KEY) ?? "") ?? "mirc";
  } catch {
    return "mirc"; // storage blocked: the classic look
  }
}

export function saveLook(look: Look): void {
  try {
    if (look === "mirc") localStorage.removeItem(LOOK_KEY);
    else localStorage.setItem(LOOK_KEY, look);
  } catch {
    // storage blocked: it still applies until the app closes
  }
}

export function applyLook(look: Look, root: HTMLElement = document.documentElement): void {
  if (look === "mirc") root.removeAttribute("data-look");
  else root.setAttribute("data-look", look);
}

// Two letters for the round badge: "Mais_Velho" → "MV", "Kota" → "KO", "kamba-2" → "K2".
export function initials(nick: string): string {
  const parts = nick.split(/[_\-.\s]+/).filter(Boolean);
  const chars =
    parts.length >= 2 ? [Array.from(parts[0]!)[0]!, Array.from(parts[1]!)[0]!] : Array.from(parts[0] ?? nick).slice(0, 2);
  return chars.join("").toUpperCase();
}

const GROUP_MS = 5 * 60_000;

// In the modern style, a message from the same person right after their last one (within 5 minutes)
// joins it: no second badge or name. /me lines and *** lines always stand alone.
export function continues(prev: Line | undefined, line: Line): boolean {
  if (prev?.kind !== "message" || line.kind !== "message") return false;
  if (prev.msg.kind === "me" || line.msg.kind === "me") return false;
  if (prev.msg.nick !== line.msg.nick) return false;
  const gap = Date.parse(line.msg.at) - Date.parse(prev.msg.at);
  return gap >= 0 && gap <= GROUP_MS;
}
