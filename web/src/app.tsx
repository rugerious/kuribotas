import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import type { ClientMessage, Device, Member, ServerMessage, Status, ThrowItem } from "../../shared/protocol.ts";
import { parseInput } from "./commands.ts";
import {
  colourOf,
  initialState,
  isDm,
  reduce,
  totalUnread,
  ROOM_COLOURS,
  typingIn,
  type Line,
  type Room,
  type RoomColour,
} from "./state.ts";
import {
  availableSounds,
  DEFAULT_SOUND,
  playNudge,
  playThrow,
  setSound,
  type SoundKind,
  tornadoSeconds,
  unlockSound,
  vibrate,
} from "./sound.ts";
import { complete, completions } from "./complete.ts";
import { FAMILY_EMOJI } from "./emoji.ts";
import { showCode } from "./invite.ts";
import { Peeker } from "./peeker.tsx";
import { Puzzle } from "./puzzle.tsx";
import { applyTheme, saveTheme } from "./theme.ts";
import { captionFor, pickLang, words, type Lang, type Words } from "./words.ts";

const now = (): string => new Date().toISOString();
const SIGNED_OUT = 4401;
// A coloured sign in the status picker: a phone's own list (Android, iPhone) can't be coloured by CSS.
const STATUS_ICON: Record<Status, string> = { online: "🟢", away: "🟡", busy: "🔴", invisible: "👻" }; // the server's close code for a session that ended (server/src/chat.ts)
const STATUSES: readonly Status[] = ["online", "away", "busy", "invisible"];
const TYPING_REPEAT_MS = 3000; // while typing, tell the others again this often

// Channel colours are remembered in this browser only. Storage can be blocked (private mode),
// so every read and write is allowed to fail quietly.
const COLOURS_KEY = "kuribotas.colours";
const LANG_KEY = "kuribotas.lang";
const SHAKE_KEY = "kuribotas.shake"; // "off" = no nudges on this device
const JOINS_KEY = "kuribotas.joins"; // "off" = no arrived/left lines on this device
// Notifications on this device (/notificacoes). The browser keeps the subscription; we remember the
// choice so the app can tell the server again after every reconnection (nick and channels may change).
const PUSH_KEY = "kuribotas.push";

function pushWanted(): boolean {
  try {
    return localStorage.getItem(PUSH_KEY) === "on";
  } catch {
    return false;
  }
}

function savePushWanted(on: boolean): void {
  try {
    if (on) localStorage.setItem(PUSH_KEY, "on");
    else localStorage.removeItem(PUSH_KEY);
  } catch {
    // not saved: notifications still work, but the app won't re-send them after a reload
  }
}

const pushSupported = (): boolean =>
  isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The browser's subscription for this server's key (a new key, e.g. after a reinstall, means a new one).
async function pushSubscription(create: boolean): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = (await (await fetch("/push/key")).json()) as { publicKey: string };
  const key = fromBase64url(publicKey);
  const existing = await reg.pushManager.getSubscription();
  const current = existing?.options.applicationServerKey;
  const same = current != null && current.byteLength === key.length && new Uint8Array(current).every((b, i) => b === key[i]);
  if (existing !== null && same) return existing;
  if (existing !== null) await existing.unsubscribe();
  return create ? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null;
}

const subscriptionMessage = (sub: PushSubscription, lang: Lang): ClientMessage => {
  const json = sub.toJSON();
  return {
    type: "push",
    subscription: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } },
    lang,
  };
};

// This device's nudge and tornado sounds (/som, /som tornado).
const SOUND_KEYS: Record<SoundKind, string> = { nudge: "kuribotas.sound", tornado: "kuribotas.sound.tornado" };
const THROW_MS: Record<ThrowItem, number> = { chinela: 900, vassoura: 1200, colher: 1000, batuque: 2400 }; // match style.css
const THROW_EMOJI: Record<Exclude<ThrowItem, "colher">, string> = { chinela: "🩴", vassoura: "🧹", batuque: "🥁" };

// The Maria das Dores: Angola's wooden spoon, drawn here because the 🥄 emoji is metal.
// Plain SVG shapes (fill attributes, no inline styles), so the strict CSP is happy.
function WoodenSpoon() {
  return (
    <svg class="spoon" viewBox="0 0 40 120" width="40" height="120" aria-hidden="true">
      <rect x="16" y="40" width="8" height="78" rx="4" fill="#8a5a2b" />
      <rect x="18" y="46" width="2" height="66" rx="1" fill="#a8743f" />
      <ellipse cx="20" cy="22" rx="16" ry="21" fill="#9c6633" />
      <ellipse cx="20" cy="23" rx="11" ry="15" fill="#7a4a20" />
      <path d="M13 14 q4 -6 10 -4" stroke="#b9854d" stroke-width="2" fill="none" stroke-linecap="round" />
      <path d="M21 60 q2 10 0 20 M19 88 q-2 8 0 16" stroke="#6e431c" stroke-width="1.2" fill="none" />
    </svg>
  );
}

function loadSound(kind: SoundKind): string | null {
  try {
    return localStorage.getItem(SOUND_KEYS[kind]);
  } catch {
    return null;
  }
}

function saveSound(kind: SoundKind, name: string): void {
  try {
    if (name === DEFAULT_SOUND) localStorage.removeItem(SOUND_KEYS[kind]);
    else localStorage.setItem(SOUND_KEYS[kind], name);
  } catch {
    // not saved: the choice still applies until the page is closed
  }
}

setSound("nudge", loadSound("nudge"));
setSound("tornado", loadSound("tornado"));

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

// This device's language: ?lang= (screenshots), then the device's choice, then Portuguese.
export const startLang = (): Lang => pickLang(new URLSearchParams(location.search).get("lang"), loadLang());

function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // not saved: the language still applies until the page is closed
  }
}

function loadQuietJoins(): boolean {
  try {
    return localStorage.getItem(JOINS_KEY) === "off";
  } catch {
    return false;
  }
}

function saveQuietJoins(quiet: boolean): void {
  try {
    if (quiet) localStorage.setItem(JOINS_KEY, "off");
    else localStorage.removeItem(JOINS_KEY);
  } catch {
    // storage blocked: it still applies until the app closes
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

// The chat, for someone signed in. `onSignedOut`: this device's session ended (signed out elsewhere,
// or removed by an @): back to the door.
export function App({ onSignedOut }: { onSignedOut: () => void }) {
  const [state, dispatch] = useReducer(reduce, initialState, (s) => ({
    ...s,
    lang: startLang(),
    colours: loadColours(),
    quietJoins: loadQuietJoins(),
  }));
  const [showPeople, setShowPeople] = useState(false);
  const [shakeOn, setShakeOn] = useState(loadShake);
  const [shaking, setShaking] = useState<"" | "nudge" | "tornado">("");
  const [editingNote, setEditingNote] = useState(false);
  const [showTips, setShowTips] = useState(false); // the Dicas tab is open (it's not a channel)
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const [flying, setFlying] = useState<{ item: ThrowItem; atMe: boolean } | null>(null);
  const askedDm = useRef(new Set<string>()); // private chats whose saved messages were asked for
  const stateRef = useRef(state); // the latest state, for the socket's event handlers
  stateRef.current = state;
  const socket = useRef<WebSocket | null>(null);
  const w = words(state.lang);

  useEffect(() => {
    document.documentElement.lang = state.lang === "pt" ? "pt" : "en";
  }, [state.lang]);

  // One WebSocket at a time, reconnected for as long as the page is open: after 1 s, 2, 4, 8… up to 30 s,
  // and straight away when the phone gets its network back or the app comes back to the screen.
  // The session cookie goes along by itself; the nick comes from the account.
  useEffect(() => {
    let closedByUs = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
      clearTimeout(retry);
      const current = socket.current;
      if (current !== null && current.readyState <= WebSocket.OPEN) return; // connecting or open already
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      socket.current = ws;
      ws.addEventListener("open", () => {
        attempt = 0;
        dispatch({ type: "connection", status: "open", at: now() });
      });
      ws.addEventListener("close", (e) => {
        if (socket.current !== ws) return;
        dispatch({ type: "connection", status: "closed", at: now() });
        if (closedByUs) return;
        if (e.code === SIGNED_OUT) return onSignedOut();
        const delay = Math.min(30, 2 ** attempt) * 1000;
        attempt += 1;
        retry = setTimeout(checkThenConnect, delay);
      });
      ws.addEventListener("message", (e) => onMessage(ws, e));
    };

    // A refused connection looks the same as no network, so ask the server who we are first:
    // a session that ended means the door; anything else (offline, server restarting) means try again.
    const checkThenConnect = (): void => {
      fetch("/api/me", { cache: "no-store" })
        .then((res) => (res.status === 401 ? onSignedOut() : connect()))
        .catch(() => connect());
    };

    const now_ = (): void => {
      if (document.visibilityState === "visible") connect();
    };
    addEventListener("online", connect);
    document.addEventListener("visibilitychange", now_);
    connect();
    return () => {
      closedByUs = true;
      clearTimeout(retry);
      removeEventListener("online", connect);
      document.removeEventListener("visibilitychange", now_);
      socket.current?.close();
    };
  }, []);

  // Back after a reconnection: join the channels again and put the status back as it was.
  const rejoin = (ws: WebSocket): void => {
    const s = stateRef.current;
    const say = (msg: ClientMessage): void => ws.send(JSON.stringify(msg));
    for (const r of s.rooms) if (!isDm(r.name) && !r.private) say({ type: "join", channel: r.name });
    if (s.status !== "online" || s.note !== "") say({ type: "status", status: s.status, note: s.note });
  };

  const onMessage = (ws: WebSocket, e: MessageEvent): void => {
    // Messages from the server; the socket's handlers only see refs, so this never reads stale state.
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(e.data)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "link") return showLink(msg.kind, msg.token, msg.for);
    if (msg.type === "devices") return showDevices(msg.devices);
    if (msg.type === "rooms") {
      const t = words(stateRef.current.lang).events;
      const lines = [t.roomsTitle, ...msg.rooms.map((r) => t.room(r.name, r.people, r.topic, r.home, r.private)), t.roomsHelp];
      for (const text of lines) dispatch({ type: "local", text, tone: "info", at: now() });
      return;
    }
    if (msg.type === "welcome") askedDm.current.clear(); // a new connection: ask again for every private chat
    const reconnecting = msg.type === "welcome" && stateRef.current.rooms.length > 0;
    dispatch({ type: "server", msg, at: now() });
    if (reconnecting) rejoin(ws);
    // Tell the server again which device to notify (only if this device turned notifications on).
    if (msg.type === "welcome" && pushWanted() && pushSupported() && Notification.permission === "granted") {
      pushSubscription(false)
        .then((sub) => {
          if (sub !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(subscriptionMessage(sub, stateRef.current.lang)));
        })
        .catch(() => {});
    }
  };

  // An invite or device link: shown only on this screen (never sent to the channel), and copied so it
  // can go straight into WhatsApp. The token sits after "#", so it never reaches any server log.
  const showLink = (kind: "person" | "device", token: string, forNick?: string): void => {
    const link = `${location.origin}/#${kind === "person" ? "convite" : "aparelho"}=${token}`;
    const say = (copied: boolean): void => {
      const t = words(stateRef.current.lang).events;
      const text =
        kind === "person"
          ? t.inviteLink(link, copied)
          : forNick !== undefined
            ? t.deviceLinkFor(forNick, link, showCode(token), copied)
            : t.deviceLink(link, showCode(token), copied);
      dispatch({ type: "local", text, tone: "info", at: now() });
    };
    if (navigator.clipboard === undefined) return say(false);
    navigator.clipboard.writeText(link).then(
      () => say(true),
      () => say(false),
    );
  };

  const showDevices = (devices: Device[]): void => {
    const lang = stateRef.current.lang;
    const t = words(lang).events;
    const when = (iso: string): string =>
      new Date(iso).toLocaleString(lang === "pt" ? "pt-PT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const lines = [t.devicesTitle, ...devices.map((d) => t.device(d.id, d.name, when(d.since), when(d.seen), d.current)), t.devicesHelp];
    for (const text of lines) dispatch({ type: "local", text, tone: "info", at: now() });
  };

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

  // A chinela (or vassoura, colher, batuque) in the open channel: everyone sees it fly, the target gets
  // hit (a jolt, the sound, a buzz). "/abanoes nao" turns all of it off; No biolo keeps it silent.
  useEffect(() => {
    const thrown = state.thrown;
    if (thrown === null || !shakeOn) return;
    if (thrown.atMe && state.status !== "busy") {
      playThrow(thrown.item);
      vibrate(false);
    }
    setFlying(null);
    const start = setTimeout(() => setFlying({ item: thrown.item, atMe: thrown.atMe }), 20);
    const stop = setTimeout(() => setFlying(null), THROW_MS[thrown.item] + 100);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [state.thrown?.key]);

  // Unread messages in the window title, "(3) Kuribotas", and on the app's icon when it's installed
  // (Android, desktop and iPhone 16.4+; elsewhere the badge call simply doesn't exist).
  const unread = totalUnread(state);
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Kuribotas` : "Kuribotas";
    if (unread > 0) navigator.setAppBadge?.(unread).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  }, [unread]);

  useEffect(() => {
    const changed = (): void => dispatch({ type: "visibility", visible: document.visibilityState === "visible" });
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  // "is typing" runs out on its own; the reducer returns the same state when nothing changed.
  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: "tick", at: now() }), 1000);
    return () => clearInterval(timer);
  }, []);

  const send = (msg: ClientMessage): void => {
    const ws = socket.current;
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Every private chat tab gets its saved messages (3 days) once per connection: one opened with 💬
  // or /msg, one that a message opened, and the ones reopened on arrival.
  const dmTabs = state.rooms.filter((r) => isDm(r.name)).map((r) => r.name);
  useEffect(() => {
    if (state.connection !== "open") return;
    for (const nick of dmTabs) {
      if (askedDm.current.has(nick.toLowerCase())) continue;
      askedDm.current.add(nick.toLowerCase());
      send({ type: "dm_history", with: nick });
    }
  }, [dmTabs.join("\n"), state.connection]);

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
      case "logout": {
        // This device only. Its notifications stop too (the server forgets them with the session).
        savePushWanted(false);
        if (pushSupported()) {
          pushSubscription(false)
            .then((sub) => sub?.unsubscribe())
            .catch(() => {});
        }
        fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          .then(() => onSignedOut())
          .catch(() => dispatch({ type: "local", text: w.errors.internal(""), tone: "error", at: now() }));
        return;
      }
      case "notify": {
        const say = (text: string, tone: "info" | "error" = "info") => dispatch({ type: "local", text, tone, at: now() });
        if (!pushSupported()) return say(w.events.notifyUnsupported, "error");
        if (!parsed.on) {
          savePushWanted(false);
          send({ type: "push", subscription: null, lang: state.lang });
          pushSubscription(false)
            .then((sub) => sub?.unsubscribe())
            .catch(() => {});
          return say(w.events.notify(false));
        }
        // Asked straight from the command (a key press), as browsers require for this question.
        Notification.requestPermission()
          .then(async (permission) => {
            if (permission !== "granted") return say(w.events.notifyDenied, "error");
            const sub = await pushSubscription(true);
            if (sub === null) return say(w.events.notifyUnsupported, "error");
            savePushWanted(true);
            send(subscriptionMessage(sub, state.lang));
            say(w.events.notify(true));
          })
          .catch(() => say(w.events.notifyUnsupported, "error"));
        return;
      }
      case "openDm":
        return dispatch({ type: "openDm", nick: parsed.nick });
      case "closeDm":
        return dispatch({ type: "closeDm", nick: parsed.nick });
      case "sound": {
        const kind: SoundKind = parsed.tornado ? "tornado" : "nudge";
        const options = availableSounds(kind);
        const say = (text: string, tone: "info" | "error" = "info") => dispatch({ type: "local", text, tone, at: now() });
        if (parsed.name === undefined) return say(w.events.sounds(loadSound(kind) ?? DEFAULT_SOUND, options, parsed.tornado));
        if (!options.includes(parsed.name)) return say(w.unknownSound(parsed.name, options), "error");
        saveSound(kind, parsed.name);
        setSound(kind, parsed.name);
        playNudge(parsed.tornado); // hear it straight away
        return say(w.events.sound(parsed.name, parsed.tornado));
      }
      case "joins":
        saveQuietJoins(!parsed.on);
        return dispatch({ type: "quietJoins", on: !parsed.on, at: now() });
      case "theme":
        saveTheme(parsed.theme);
        applyTheme(parsed.theme);
        return dispatch({ type: "local", text: w.events.theme(parsed.theme), tone: "info", at: now() });
      case "lang":
        saveLang(parsed.lang);
        return dispatch({ type: "lang", lang: parsed.lang, at: now() });
      case "nothing":
        return;
    }
  };

  // Invisible people don't say they're typing (the server would drop it anyway).
  // "is typing", in a channel or a private chat (invisible people don't say it; the server would drop it).
  const typing = (channel: string, active: boolean): void => {
    if (state.status === "invisible" && active) return;
    send(isDm(channel) ? { type: "typing", to: channel, typing: active } : { type: "typing", channel, typing: active });
  };

  const room = state.rooms.find((r) => r.name === state.active);
  const online = state.connection === "open";
  const typers = typingIn(room);

  return (
    <div
      class={`app room-${colourOf(state, state.active)}${shaking ? ` shake-${shaking}` : ""}${flying?.atMe ? ` hit-${flying.item}` : ""}`}
    >
      {flying && (
        <div class={`throw throw-${flying.item}`} aria-hidden="true">
          <span class="thing">{flying.item === "colher" ? <WoodenSpoon /> : THROW_EMOJI[flying.item]}</span>
          {flying.atMe && <span class="hit">{w.ui.hit[flying.item]}</span>}
        </div>
      )}
      <header class="bar">
        {/* The corner symbol: the puzzle on a computer, the peeker on a phone (style.css picks by width). */}
        <h1 class="brand">
          <Puzzle class="brand-wide" />
          <span class="brand-phone">
            <Peeker label="Kuribotas" />
          </span>
        </h1>
        {!online && (
          <span class={`conn conn-${state.connection}`}>
            <Peeker />
            <span class="conn-text">{w.ui.connection[state.connection]}</span>
          </span>
        )}
        {state.nick && (
          <div class="me">
            <span class="me-nick">{state.nick}</span>
            <label class="visually-hidden" for="status">
              {w.ui.yourStatus}
            </label>
            {state.status === "invisible" ? <Peeker /> : <span class={`dot st-${state.status}`} aria-hidden="true" />}
            <button
              type="button"
              class="note-edit-toggle"
              aria-label={w.ui.editNote}
              title={w.ui.editNote}
              aria-expanded={editingNote}
              disabled={!online}
              onClick={() => setEditingNote(!editingNote)}
            >
              ✏️
            </button>
            <select
              id="status"
              class={`status-pick pick-${state.status}`}
              value={state.status}
              disabled={!online}
              onChange={(e) => setStatus(e.currentTarget.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_ICON[s]} {w.status[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {editingNote && online && (
        <NoteEditor
          note={state.note}
          w={w}
          onSave={(note) => {
            send({ type: "status", status: state.status, note });
            setEditingNote(false);
          }}
          onCancel={() => setEditingNote(false)}
        />
      )}

      <nav class="tabs" aria-label="Canais / Channels">
        <button
          type="button"
          class={`tab tab-tips${showTips ? " active" : ""}`}
          aria-current={showTips ? "page" : undefined}
          onClick={() => setShowTips(true)}
        >
          {w.ui.tipsTab}
        </button>
        {state.rooms.map((r) => (
          <button
            key={r.name}
            type="button"
            class={`tab room-${colourOf(state, r.name)}${r.name === state.active && !showTips ? " active" : ""}`}
            aria-current={r.name === state.active && !showTips ? "page" : undefined}
            onClick={() => {
              setShowTips(false);
              dispatch({ type: "focus", channel: r.name });
            }}
          >
            {isDm(r.name) ? `💬 ${r.name}` : r.private ? `🔒 ${r.name}` : r.name}
            {r.unread > 0 && <span class="badge">{r.unread}</span>}
          </button>
        ))}
      </nav>

      {showTips && (
        <Tips
          w={w}
          onTry={(cmd) => {
            setShowTips(false);
            setPrefill({ text: cmd, key: Date.now() });
          }}
        />
      )}

      {room && !showTips && (
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

      <div class={showTips ? "body hidden" : "body"}>
        <Log lines={room?.lines ?? []} />
        {room && !isDm(room.name) && (
          <People
            room={room}
            me={state.nick}
            open={showPeople}
            canNudge={online}
            onNudge={(nick, tornado) => send({ type: "nudge", channel: room.name, nick, tornado })}
            onDm={(nick) => dispatch({ type: "openDm", nick })}
            w={w}
          />
        )}
      </div>

      <div class="typing">{w.ui.typing(typers)}</div>
      <InputBar
        onSubmit={(text) => {
          setShowTips(false);
          submit(text);
        }}
        onTyping={typing}
        disabled={!online}
        channel={state.active}
        nicks={room === undefined ? [] : isDm(room.name) ? [room.name] : room.members.map((m) => m.nick).filter((n) => n !== state.nick)}
        prefill={prefill}
        w={w}
      />
    </div>
  );
}

// The Dicas tab: the help, in sections, always there (never a channel, never expires). Tapping a tip
// that has a command closes the tab and puts the command in the box, ready to try.
function Tips({ w, onTry }: { w: Words; onTry: (cmd: string) => void }) {
  return (
    <section class="tips" aria-label={w.ui.tipsTab}>
      <p class="tips-intro">{w.ui.tipsIntro}</p>
      {w.tips.map((section) => (
        <div key={section.title} class="tips-section">
          <h2>{section.title}</h2>
          <ul>
            {section.items.map((tip) =>
              tip.cmd === undefined ? (
                <li key={tip.text} class="tip">
                  {tip.text}
                </li>
              ) : (
                <li key={tip.text}>
                  <button type="button" class="tip tip-try" onClick={() => onTry(tip.cmd ?? "")}>
                    <span>{tip.text}</span>
                    <code>{tip.cmd.trim()}</code>
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </section>
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
  onNudge: (nick: string, tornado: boolean) => void;
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
  onNudge: (nick: string, tornado: boolean) => void;
  onDm: (nick: string) => void;
  w: Words;
}) {
  // Tap a name to see what you can do with that person: the list stays calm instead of showing
  // three buttons under everyone (and a tornado isn't one stray tap away).
  const [open, setOpen] = useState(false);
  const who = (
    <>
      <span class="person-line">
        {member.status === "invisible" ? <Peeker /> : <span class={`dot st-${member.status}`} aria-hidden="true" />}
        <span class={`person-nick ${nickClass(member.nick)}`} title={member.nick}>
          {member.role === "admin" && <span class="op">@</span>}
          {member.nick}
        </span>
        {isMe && <span class="you"> {w.ui.you}</span>}
      </span>
      <span class="person-status">
        <span class={`status-word word-${member.status}`}>{w.status[member.status]}</span>
        {member.note && ` · ${member.note}`}
      </span>
    </>
  );
  return (
    <li class={`person${open ? " open" : ""}`}>
      {isMe ? (
        <div class="person-who">{who}</div>
      ) : (
        <button type="button" class="person-who" aria-expanded={open} onClick={() => setOpen(!open)}>
          {who}
        </button>
      )}
      {/* On their own line, so a long nick never pushes them out of the panel. */}
      {!isMe && open && (
        <span class="person-actions">
          <button
            type="button"
            class="nudge"
            aria-label={w.ui.dm(member.nick)}
            title={w.ui.dm(member.nick)}
            onClick={() => onDm(member.nick)}
          >
            <span aria-hidden="true">💬</span> {w.ui.actions.dm}
          </button>
          <button
            type="button"
            class="nudge"
            aria-label={w.ui.nudge(member.nick)}
            title={w.ui.nudge(member.nick)}
            disabled={!canNudge}
            onClick={() => onNudge(member.nick, false)}
          >
            <span aria-hidden="true">📳</span> {w.ui.actions.nudge}
          </button>
          <button
            type="button"
            class="nudge"
            aria-label={w.ui.tornado(member.nick)}
            title={w.ui.tornado(member.nick)}
            disabled={!canNudge}
            onClick={() => onNudge(member.nick, true)}
          >
            <span aria-hidden="true">🌪️</span> {w.ui.actions.tornado}
          </button>
        </span>
      )}
    </li>
  );
}

// The ✏️ box under the bar: the line under your name, for people who don't know /frase.
function NoteEditor({
  note,
  w,
  onSave,
  onCancel,
}: {
  note: string;
  w: Words;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(note);
  return (
    <form
      class="note-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text.trim());
      }}
    >
      <label class="visually-hidden" for="note">
        {w.ui.editNote}
      </label>
      <input
        id="note"
        value={text}
        maxLength={80}
        autoComplete="off"
        enterKeyHint="done"
        placeholder={w.ui.notePlaceholder}
        ref={(el) => el?.focus()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="submit">{w.ui.noteSave}</button>
    </form>
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
  nicks,
  prefill,
  w,
}: {
  onSubmit: (text: string) => void;
  onTyping: (channel: string, typing: boolean) => void;
  disabled: boolean;
  channel: string;
  nicks: string[]; // who can be completed here (not me)
  prefill: { text: string; key: number } | null; // a command tapped in Dicas, put in the box to try
  w: Words;
}) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  // Where we last said "is typing", and when: repeated every few seconds, stopped once.
  const told = useRef<{ channel: string; at: number } | null>(null);

  const stopTyping = (): void => {
    if (told.current !== null) onTyping(told.current.channel, false);
    told.current = null;
  };

  // A tip tapped in Dicas: into the box, cursor at the end, ready to finish or send.
  useEffect(() => {
    if (prefill === null) return;
    setText(prefill.text);
    setCursor(prefill.text.length);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(prefill.text.length, prefill.text.length);
    });
  }, [prefill?.key]);

  // Typing the start of a name offers it (tap it, or Tab on a keyboard).
  const offer = disabled ? null : completions(text, cursor, nicks);
  const pick = (nick: string): void => {
    if (offer === null) return;
    const done = complete(text, offer, nick);
    changed(done.text);
    setCursor(done.cursor);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(done.cursor, done.cursor);
    });
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

  // An emoji goes where the cursor is, and the box keeps the focus (so the phone keyboard stays up).
  const addEmoji = (emoji: string): void => {
    const input = box.current;
    const at = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? at;
    changed(text.slice(0, at) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(at + emoji.length, at + emoji.length);
    });
  };

  return (
    <>
      {offer !== null && (
        <div class="complete-bar" role="group" aria-label={w.ui.complete}>
          {offer.matches.map((nick) => (
            <button key={nick} type="button" class={`complete ${nickClass(nick)}`} onClick={() => pick(nick)}>
              {nick}
            </button>
          ))}
        </div>
      )}
      {showEmoji && (
        <div class="emoji-bar" role="group" aria-label={w.ui.emoji}>
          {FAMILY_EMOJI.map((emoji) => (
            <button key={emoji} type="button" disabled={disabled} onClick={() => addEmoji(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    <form
      class="input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
        setText("");
        setCursor(0);
        setShowEmoji(false);
        // A message clears "is typing" for everyone; a command needs an explicit stop.
        if (isMessage(text)) told.current = null;
        else stopTyping();
      }}
    >
      <button
        type="button"
        class="emoji-toggle"
        aria-label={w.ui.emoji}
        title={w.ui.emoji}
        aria-expanded={showEmoji}
        disabled={disabled}
        onClick={() => setShowEmoji(!showEmoji)}
      >
        😀
      </button>
      <label class="visually-hidden" for="message">
        {w.ui.messageTo(channel)}
      </label>
      <input
        id="message"
        ref={box}
        value={text}
        onInput={(e) => {
          changed(e.currentTarget.value);
          setCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
        }}
        onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (e.key === "Tab" && offer !== null && offer.matches[0] !== undefined) {
            e.preventDefault();
            pick(offer.matches[0]);
          }
        }}
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
    </>
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
