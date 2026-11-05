import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import type { ClientMessage, Member, ServerMessage, Status } from "../../shared/protocol.ts";
import { parseInput } from "./commands.ts";
import { colourOf, initialState, reduce, ROOM_COLOURS, type Line, type Room, type RoomColour } from "./state.ts";
import { captionFor, pickLang, words, type Lang, type Words } from "./words.ts";

const now = (): string => new Date().toISOString();
const STATUSES: readonly Status[] = ["online", "away", "busy", "invisible"];

// Channel colours are remembered in this browser only. Storage can be blocked (private mode),
// so every read and write is allowed to fail quietly.
const COLOURS_KEY = "kuribotas.colours";
const LANG_KEY = "kuribotas.lang";

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
      case "lang":
        saveLang(parsed.lang);
        return dispatch({ type: "lang", lang: parsed.lang, at: now() });
      case "nothing":
        return;
    }
  };

  const room = state.rooms.find((r) => r.name === state.active);
  const online = state.connection === "open";

  return (
    <div class={`app room-${colourOf(state, state.active)}`}>
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
            {r.name}
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
          <span class="topic-text">
            <span class="label">{w.ui.topic}</span> {room.topic || w.ui.noTopic}
          </span>
          <button
            type="button"
            class="people-toggle"
            aria-expanded={showPeople}
            onClick={() => setShowPeople(!showPeople)}
          >
            {w.ui.people(room.members.length)}
          </button>
        </div>
      )}

      <div class="body">
        <Log lines={room?.lines ?? []} />
        {room && <People room={room} me={state.nick} open={showPeople} w={w} />}
      </div>

      <InputBar onSubmit={submit} disabled={!online} channel={state.active} w={w} />
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

function People({ room, me, open, w }: { room: Room; me: string; open: boolean; w: Words }) {
  const sorted = [...room.members].sort((a, b) => a.nick.localeCompare(b.nick));
  return (
    <aside class={open ? "people open" : "people"} aria-label={w.ui.peopleIn(room.name)}>
      <h2 class="people-title">{room.name}</h2>
      <ul>
        {sorted.map((m) => (
          <PersonRow key={m.nick} member={m} isMe={m.nick === me} w={w} />
        ))}
      </ul>
    </aside>
  );
}

function PersonRow({ member, isMe, w }: { member: Member; isMe: boolean; w: Words }) {
  return (
    <li class="person">
      <span class="person-line">
        <span class={`dot st-${member.status}`} aria-hidden="true" />
        <span class={`person-nick ${nickClass(member.nick)}`}>{member.nick}</span>
        {isMe && <span class="you"> {w.ui.you}</span>}
      </span>
      <span class="person-status">
        {w.status[member.status]}
        {member.note && ` · ${member.note}`}
      </span>
    </li>
  );
}

function InputBar({
  onSubmit,
  disabled,
  channel,
  w,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
  channel: string;
  w: Words;
}) {
  const [text, setText] = useState("");
  return (
    <form
      class="input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
        setText("");
      }}
    >
      <label class="visually-hidden" for="message">
        {w.ui.messageTo(channel)}
      </label>
      <input
        id="message"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
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
