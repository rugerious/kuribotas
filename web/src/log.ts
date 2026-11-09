// /log, like mIRC's logs: a room's saved conversation as a plain text file on this device.
import type { ChatMessage } from "../../shared/protocol.ts";

const two = (n: number): string => String(n).padStart(2, "0");

// The phone's own clock: "2026-11-09 18:41".
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function logLine(m: ChatMessage): string {
  const at = `[${stamp(new Date(m.at))}]`;
  return m.kind === "me" ? `${at} * ${m.nick} ${m.text}` : `${at} <${m.nick}> ${m.text}`;
}

export function logText(header: string, messages: readonly ChatMessage[]): string {
  return [header, "", ...messages.map(logLine), ""].join("\r\n"); // \r\n: Notepad on Windows reads it too
}

// "kuribotas-mujimbo-2026-11-09.txt"
export function logFileName(channel: string, now: Date): string {
  const name = channel.replace(/^#/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-") || "sala";
  return `kuribotas-${name}-${stamp(now).slice(0, 10)}.txt`;
}

// Where a new day starts in the log: before a message whose day (on this phone) differs from the one
// before it, and before the first one unless it is today. Returns that message's day, or null.
export function newDay(prev: string | undefined, at: string, now: Date): string | null {
  const day = stamp(new Date(at)).slice(0, 10);
  if (prev === undefined) return day === stamp(now).slice(0, 10) ? null : day;
  return day === stamp(new Date(prev)).slice(0, 10) ? null : day;
}
