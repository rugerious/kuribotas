import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.ts";
import { HELP, parseInput } from "./commands.ts";
import { colourOf, initialState, reduce, ROOM_COLOURS, type Line, type Room, type RoomColour } from "./state.ts";

const now = (): string => new Date().toISOString();

// Channel colours are remembered in this browser only. Storage can be blocked (private mode),
// so every read and write is allowed to fail quietly.
const COLOURS_KEY = "kuribotas.colours";

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

const STATUS_LABEL = { connecting: "connecting…", open: "online", closed: "offline" } as const;

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState, (s) => ({ ...s, colours: loadColours() }));
  const [showPeople, setShowPeople] = useState(false);
  const socket = useRef<WebSocket | null>(null);

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

  const submit = (input: string): void => {
    const parsed = parseInput(input, state.active);
    if (parsed.kind === "send") send(parsed.msg);
    else if (parsed.kind === "help") for (const text of HELP) dispatch({ type: "local", text, tone: "info", at: now() });
    else if (parsed.kind === "error") dispatch({ type: "local", text: parsed.text, tone: "error", at: now() });
    else if (parsed.kind === "colour") dispatch({ type: "colour", channel: state.active, colour: parsed.colour, at: now() });
  };

  const room = state.rooms.find((r) => r.name === state.active);

  return (
    <div class={`app room-${colourOf(state, state.active)}`}>
      <header class="bar">
        <h1 class="brand">
          KURI<span>BOTAS</span>
        </h1>
        <span class={`status status-${state.connection}`}>{STATUS_LABEL[state.connection]}</span>
        {state.nick && <span class="me">{state.nick}</span>}
      </header>

      <nav class="tabs" aria-label="Channels">
        {state.rooms.map((r) => (
          <button
            key={r.name}
            type="button"
            class={`tab room-${colourOf(state, r.name)}${r.name === state.active ? " active" : ""}`}
            aria-current={r.name === state.active ? "page" : undefined}
            onClick={() => dispatch({ type: "focus", channel: r.name })}
          >
            {r.name}
            {r.unread > 0 && <span class="badge" aria-label={`${r.unread} unread`}>{r.unread}</span>}
          </button>
        ))}
      </nav>

      {room && (
        <div class="topic">
          <button
            type="button"
            class="colour-dot"
            aria-label={`Change the colour of ${room.name} (now ${colourOf(state, room.name)})`}
            title="Change this channel's colour"
            onClick={() => dispatch({ type: "colour", channel: room.name, at: now() })}
          />
          <span class="topic-text">
            <span class="label">Topic</span> {room.topic || "(no topic yet: /topic to set one)"}
          </span>
          <button
            type="button"
            class="people-toggle"
            aria-expanded={showPeople}
            onClick={() => setShowPeople(!showPeople)}
          >
            People ({room.members.length})
          </button>
        </div>
      )}

      <div class="body">
        <Log lines={room?.lines ?? []} />
        {room && <People room={room} me={state.nick} open={showPeople} />}
      </div>

      <InputBar onSubmit={submit} disabled={state.connection !== "open"} channel={state.active} />
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
    <section class="log" aria-live="polite" aria-label="Messages">
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
  const nick = (
    <span class={`nick ${nickClass(msg.nick)}`}>{msg.nick}</span>
  );
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

function People({ room, me, open }: { room: Room; me: string; open: boolean }) {
  const sorted = [...room.members].sort((a, b) => a.localeCompare(b));
  return (
    <aside class={open ? "people open" : "people"} aria-label={`People in ${room.name}`}>
      <h2 class="people-title">{room.name}</h2>
      <ul>
        {sorted.map((nick) => (
          <li key={nick} class={nickClass(nick)}>
            {nick}
            {nick === me && <span class="you"> (you)</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function InputBar({ onSubmit, disabled, channel }: { onSubmit: (text: string) => void; disabled: boolean; channel: string }) {
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
        Message to {channel}
      </label>
      <input
        id="message"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder={`Message ${channel}, or /help`}
        maxLength={2000}
        autoComplete="off"
        enterKeyHint="send"
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || text.trim() === ""}>
        Send
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
