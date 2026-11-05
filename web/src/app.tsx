import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import type { ClientMessage, Member, ServerMessage, Status } from "../../shared/protocol.ts";
import { parseInput } from "./commands.ts";
import {
  colourOf,
  initialState,
  isDm,
  reduce,
  ROOM_COLOURS,
  typingIn,
  type Line,
  type Room,
  type RoomColour,
} from "./state.ts";
import {
  availableNudges,
  DEFAULT_SOUND,
  playNudge,
  setNudgeSound,
  tornadoSeconds,
  unlockSound,
  vibrate,
} from "./sound.ts";
import { captionFor, pickLang, words, type Lang, type Words } from "./words.ts";

const now = (): string => new Date().toISOString();
const STATUSES: readonly Status[] = ["online", "away", "busy", "invisible"];
const TYPING_REPEAT_MS = 3000; // while typing, tell the others again this often

// Channel colours are remembered in this browser only. Storage can be blocked (private mode),
// so every read and write is allowed to fail quietly.
const COLOURS_KEY = "kuribotas.colours";
const LANG_KEY = "kuribotas.lang";
const SHAKE_KEY = "kuribotas.shake"; // "off" = no nudges on this device
const SOUND_KEY = "kuribotas.sound"; // this device's nudge sound (/som)

function loadSound(): string | null {
  try {
    return localStorage.getItem(SOUND_KEY);
  } catch {
    return null;
  }
}

function saveSound(name: string): void {
  try {
    if (name === DEFAULT_SOUND) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, name);
  } catch {
    // not saved: the choice still applies until the page is closed
  }
}

setNudgeSound(loadSound());

function loadShake(): boolean {
  try {
    return localStorage.getItem(SHAKE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveShake(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SHAKE_KEY);
    else localStorage.setItem(SHAKE_KEY, "off");
  } catch {
    // not saved: the choice still applies until the page is closed
  }
}

function loadLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // not saved: the language still applies until the page is closed
  }
}

function loadColours(): Record<string, RoomColour> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(COLOURS_KEY) ?? "{}");
    if (typeof saved !== "object" || saved === null) return {};
    const colours: Record<string, RoomColour> = {};
    for (const [channel, colour] of Object.entries(saved)) {
      const known = ROOM_COLOURS.find((c) => c === colour);
      if (known !== undefined) colours[channel] = known;
    }
    return colours;
  } catch {
    return {};
  }
}

function saveColours(colours: Record<string, RoomColour>): void {
  try {
    localStorage.setItem(COLOURS_KEY, JSON.stringify(colours));
  } catch {
    // not saved: the colours still work until the page is closed
  }
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState, (s) => ({
    ...s,
    lang: pickLang(new URLSearchParams(location.search).get("lang"), loadLang()),
    colours: loadColours(),
  }));
  const [showPeople, setShowPeople] = useState(false);
  const [shakeOn, setShakeOn] = useState(loadShake);
  const [shaking, setShaking] = useState<"" | "nudge" | "tornado">("");
  const socket = useRef<WebSocket | null>(null);
  const w = words(state.lang);

  useEffect(() => {
    document.documentElement.lang = state.lang === "pt" ? "pt" : "en";
  }, [state.lang]);

  // One WebSocket for the life of the page. Automatic reconnection comes in phase 3.
  useEffect(() => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    socket.current = ws;
    ws.addEventListener("open", () => dispatch({ type: "connection", status: "open", at: now() }));
    ws.addEventListener("close", () => dispatch({ type: "connection", status: "closed", at: now() }));
    ws.addEventListener("message", (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      dispatch({ type: "server", msg, at: now() });
    });
    return () => ws.close();
  }, []);

  useEffect(() => saveColours(state.colours), [state.colours]);

  // Sound needs one touch first (a browser rule); any tap or key press will do.
  useEffect(() => {
    addEventListener("pointerdown", unlockSound);
    addEventListener("keydown", unlockSound);
    return () => {
      removeEventListener("pointerdown", unlockSound);
      removeEventListener("keydown", unlockSound);
    };
  }, []);

  // Someone nudged me: shake, and (unless I'm No biolo) buzz and vibrate.
  useEffect(() => {
    const nudge = state.nudged;
    if (nudge === null || !shakeOn) return;
    if (state.status !== "busy") {
      playNudge(nudge.tornado);
      vibrate(nudge.tornado);
    }
    // The tornado shakes for exactly as long as its sound plays. A CSS variable set from script is
    // allowed by the strict CSP (only inline style attributes and <style> tags are blocked).
    const seconds = nudge.tornado ? tornadoSeconds() : 0.8;
    if (nudge.tornado) document.documentElement.style.setProperty("--tornado-s", `${seconds}s`);
    setShaking(""); // restart the animation if one is already running
    const start = setTimeout(() => setShaking(nudge.tornado ? "tornado" : "nudge"), 20);
    const stop = setTimeout(() => setShaking(""), seconds * 1000 + 100);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [state.nudged?.key]);

  // "is typing" runs out on its own; the reducer returns the same state when nothing changed.
  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: "tick", at: now() }), 1000);
    return () => clearInterval(timer);
  }, []);

  const send = (msg: ClientMessage): void => {
    const ws = socket.current;
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // A status without your own words gets a random caption from words.ts.
  const setStatus = (status: Status, note?: string): void =>
    send({ type: "status", status, note: note ?? captionFor(state.lang, status) });

  const submit = (input: string): void => {
    const parsed = parseInput(input, state.active, state.lang);
    switch (parsed.kind) {
      case "send":
        return send(parsed.msg);
      case "status":
        return setStatus(parsed.status, parsed.note);
      case "note":
        return send({ type: "status", status: state.status, note: parsed.note });
      case "help":
        for (const text of w.help) dispatch({ type: "local", text, tone: "info", at: now() });
        return;
      case "error":
        return dispatch({ type: "local", text: parsed.text, tone: "error", at: now() });
      case "colour":
        return dispatch({ type: "colour", channel: state.active, colour: parsed.colour, at: now() });
      case "shake":
        saveShake(parsed.on);
        setShakeOn(parsed.on);
        return dispatch({ type: "local", text: w.events.shake(parsed.on), tone: "info", at: now() });
      case "openDm":
        return dispatch({ type: "openDm", nick: parsed.nick });
      case "closeDm":
        return dispatch({ type: "closeDm", nick: parsed.nick });
      case "sound": {
        const options = availableNudges();
        const say = (text: string, tone: "info" | "error" = "info") => dispatch({ type: "local", text, tone, at: now() });
        if (parsed.name === undefined) return say(w.events.sounds(loadSound() ?? DEFAULT_SOUND, options));
        if (!options.includes(parsed.name)) return say(w.unknownSound(parsed.name, options), "error");
        saveSound(parsed.name);
        setNudgeSound(parsed.name);
        playNudge(false); // hear it straight away
        return say(w.events.sound(parsed.name));
      }
      case "lang":
        saveLang(parsed.lang);
        return dispatch({ type: "lang", lang: parsed.lang, at: now() });
      case "nothing":
        return;
    }
  };

  // Invisible people don't say they're typing (the server would drop it anyway).
  // "is typing" is only for channels for now (private chats: later).
  const typing = (channel: string, active: boolean): void => {
    if (isDm(channel)) return;
    if (state.status !== "invisible" || !active) send({ type: "typing", channel, typing: active });
  };

  const room = state.rooms.find((r) => r.name === state.active);
  const online = state.connection === "open";
  const typers = typingIn(room);

  return (
    <div class={`app room-${colourOf(state, state.active)}${shaking ? ` shake-${shaking}` : ""}`}>
      <header class="bar">
        <h1 class="brand">
          KURI<span>BOTAS</span>
        </h1>
        {!online && <span class={`conn conn-${state.connection}`}>{w.ui.connection[state.connection]}</span>}
        {state.nick && (
          <div class="me">
            <span class="me-nick">{state.nick}</span>
            <label class="visually-hidden" for="status">
              {w.ui.yourStatus}
            </label>
            <span class={`dot st-${state.status}`} aria-hidden="true" />
            <select
              id="status"
              class="status-pick"
              value={state.status}
              disabled={!online}
              onChange={(e) => setStatus(e.currentTarget.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {w.status[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <nav class="tabs" aria-label="Canais / Channels">
        {state.rooms.map((r) => (
          <button
            key={r.name}
            type="button"
            class={`tab room-${colourOf(state, r.name)}${r.name === state.active ? " active" : ""}`}
            aria-current={r.name === state.active ? "page" : undefined}
            onClick={() => dispatch({ type: "focus", channel: r.name })}
          >
            {isDm(r.name) ? `💬 ${r.name}` : r.private ? `🔒 ${r.name}` : r.name}
            {r.unread > 0 && <span class="badge">{r.unread}</span>}
          </button>
        ))}
      </nav>

      {room && (
        <div class="topic">
          <button
            type="button"
            class="colour-dot"
            aria-label={w.ui.changeColour(room.name, w.colour[colourOf(state, room.name)])}
            title={w.ui.changeColour(room.name, w.colour[colourOf(state, room.name)])}
            onClick={() => dispatch({ type: "colour", channel: room.name, at: now() })}
          />
          {isDm(room.name) ? (
            <span class="topic-text">{w.ui.privateChat(room.name)}</span>
          ) : (
            <>
              <span class="topic-text">
                <span class="label">{w.ui.topic}</span> {room.topic || w.ui.noTopic}
                {room.private && <span class="private-note"> · {w.ui.privateChannel}</span>}
              </span>
              <button
                type="button"
                class="people-toggle"
                aria-expanded={showPeople}
                onClick={() => setShowPeople(!showPeople)}
              >
                {w.ui.people(room.members.length)}
              </button>
            </>
          )}
        </div>
      )}

      <div class="body">
        <Log lines={room?.lines ?? []} />
        {room && !isDm(room.name) && (
          <People
            room={room}
            me={state.nick}
            open={showPeople}
            canNudge={online}
            onNudge={(nick) => send({ type: "nudge", channel: room.name, nick, tornado: false })}
            onDm={(nick) => dispatch({ type: "openDm", nick })}
            w={w}
          />
        )}
      </div>

      <div class="typing">{w.ui.typing(typers)}</div>
      <InputBar onSubmit={submit} onTyping={typing} disabled={!online} channel={state.active} w={w} />
    </div>
  );
}

function Log({ lines }: { lines: Line[] }) {
  const end = useRef<HTMLDivElement>(null);
  // Keep the newest line in view, like a terminal.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, lines[lines.length - 1]?.key]);

  return (
    <section class="log" aria-live="polite">
      {lines.map((line) => (
        <LineView key={line.key} line={line} />
      ))}
      <div ref={end} />
    </section>
  );
}

function LineView({ line }: { line: Line }) {
  if (line.kind === "event") {
    return (
      <div class={`line event ${line.tone}`}>
        <time class="time">[{clock(line.at)}]</time> *** {line.text}
      </div>
    );
  }
  const { msg } = line;
  const nick = <span class={`nick ${nickClass(msg.nick)}`}>{msg.nick}</span>;
  // Text is always rendered as text (never as HTML), so a message can't inject markup or scripts.
  return msg.kind === "me" ? (
    <div class="line action">
      <time class="time">[{clock(msg.at)}]</time> * {nick} {msg.text}
    </div>
  ) : (
    <div class="line">
      <time class="time">[{clock(msg.at)}]</time> &lt;{nick}&gt; {msg.text}
    </div>
  );
}

function People({
  room,
  me,
  open,
  canNudge,
  onNudge,
  onDm,
  w,
}: {
  room: Room;
  me: string;
  open: boolean;
  canNudge: boolean;
  onNudge: (nick: string) => void;
  onDm: (nick: string) => void;
  w: Words;
}) {
  const sorted = [...room.members].sort((a, b) => a.nick.localeCompare(b.nick));
  return (
    <aside class={open ? "people open" : "people"} aria-label={w.ui.peopleIn(room.name)}>
      <h2 class="people-title">{room.name}</h2>
      <ul>
        {sorted.map((m) => (
          <PersonRow
            key={m.nick}
            member={m}
            isMe={m.nick === me}
            canNudge={canNudge}
            onNudge={onNudge}
            onDm={onDm}
            w={w}
          />
        ))}
      </ul>
    </aside>
  );
}

function PersonRow({
  member,
  isMe,
  canNudge,
  onNudge,
  onDm,
  w,
}: {
  member: Member;
  isMe: boolean;
  canNudge: boolean;
  onNudge: (nick: string) => void;
  onDm: (nick: string) => void;
  w: Words;
}) {
  return (
    <li class="person">
      <span class="person-line">
        <span class={`dot st-${member.status}`} aria-hidden="true" />
        <span class={`person-nick ${nickClass(member.nick)}`}>{member.nick}</span>
        {isMe && <span class="you"> {w.ui.you}</span>}
        {!isMe && (
          <button
            type="button"
            class="nudge dm"
            aria-label={w.ui.dm(member.nick)}
            title={w.ui.dm(member.nick)}
            onClick={() => onDm(member.nick)}
          >
            💬
          </button>
        )}
        {!isMe && (
          <button
            type="button"
            class="nudge"
            aria-label={w.ui.nudge(member.nick)}
            title={w.ui.nudge(member.nick)}
            disabled={!canNudge}
            onClick={() => onNudge(member.nick)}
          >
            📳
          </button>
        )}
      </span>
      <span class="person-status">
        {w.status[member.status]}
        {member.note && ` · ${member.note}`}
      </span>
    </li>
  );
}

// A line counts as a message being typed unless it is a command (but "//text" is a message).
function isMessage(text: string): boolean {
  const t = text.trimStart();
  return t !== "" && (!t.startsWith("/") || t.startsWith("//"));
}

function InputBar({
  onSubmit,
  onTyping,
  disabled,
  channel,
  w,
}: {
  onSubmit: (text: string) => void;
  onTyping: (channel: string, typing: boolean) => void;
  disabled: boolean;
  channel: string;
  w: Words;
}) {
  const [text, setText] = useState("");
  // Where we last said "is typing", and when: repeated every few seconds, stopped once.
  const told = useRef<{ channel: string; at: number } | null>(null);

  const stopTyping = (): void => {
    if (told.current !== null) onTyping(told.current.channel, false);
    told.current = null;
  };

  // Switching tab mid-sentence: the old channel shouldn't think we're still typing there.
  useEffect(() => {
    if (told.current !== null && told.current.channel !== channel) stopTyping();
  }, [channel]);

  const changed = (value: string): void => {
    setText(value);
    if (!isMessage(value)) return stopTyping();
    const last = told.current;
    if (last === null || Date.now() - last.at >= TYPING_REPEAT_MS) {
      onTyping(channel, true);
      told.current = { channel, at: Date.now() };
    }
  };

  return (
    <form
      class="input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
        setText("");
        // A message clears "is typing" for everyone; a command needs an explicit stop.
        if (isMessage(text)) told.current = null;
        else stopTyping();
      }}
    >
      <label class="visually-hidden" for="message">
        {w.ui.messageTo(channel)}
      </label>
      <input
        id="message"
        value={text}
        onInput={(e) => changed(e.currentTarget.value)}
        placeholder={w.ui.placeholder(channel)}
        maxLength={2000}
        autoComplete="off"
        enterKeyHint="send"
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || text.trim() === ""}>
        {w.ui.send}
      </button>
    </form>
  );
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); // [14:05], IRC style
}

// Each nick always gets the same colour class (c0-c7 in style.css): no inline styles, so the CSP stays strict.
function nickClass(nick: string): string {
  let hash = 0;
  for (const ch of nick) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `c${hash % 8}`;
}
