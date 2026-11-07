import { useEffect, useState } from "preact/hooks";
import type { ApiError, InviteInfo, Me } from "../../shared/protocol.ts";
import { App, startLang } from "./app.tsx";
import { cleanCode, inviteToken } from "./invite.ts";
import { Peeker } from "./peeker.tsx";
import { words, type Words } from "./words.ts";

// Before the chat: who is this device? An invite link (#convite=… for a new person, #aparelho=… for
// another device of someone already in) shows the welcome; a signed-in device goes straight in;
// anyone else finds the door. The token sits after "#", so it never reaches the server's logs.

type GateError = keyof Words["gate"]["errors"];
type Phase =
  | { kind: "checking" }
  | { kind: "door"; error?: GateError }
  | { kind: "invite"; token: string; info: InviteInfo; error?: GateError; busy: boolean }
  | { kind: "in" };

const errorOf = (body: unknown): GateError => {
  const code = (body as Partial<ApiError> | null)?.error;
  switch (code) {
    case "invite_unknown":
    case "invite_used":
    case "invite_expired":
    case "invalid_nick":
    case "nick_taken":
    case "too_many_tries":
      return code;
    default:
      return "other";
  }
};

// Leaves the address without the token (a reload or a screenshot won't show it).
const forgetToken = (): void => history.replaceState(null, "", location.pathname + location.search);

export function Gate() {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [nick, setNick] = useState("");
  const [code, setCode] = useState("");
  const w = words(startLang());

  useEffect(() => {
    document.documentElement.lang = startLang();
    const token = inviteToken(location.hash);
    if (token !== null) {
      fetch(`/api/invite/${token}`, { cache: "no-store" })
        .then(async (res) => {
          const body: unknown = await res.json();
          if (res.ok) setPhase({ kind: "invite", token, info: body as InviteInfo, busy: false });
          else {
            forgetToken();
            setPhase({ kind: "door", error: errorOf(body) });
          }
        })
        .catch(() => setPhase({ kind: "door", error: "offline" }));
      return;
    }
    fetch("/api/me", { cache: "no-store" })
      .then((res) => setPhase(res.ok ? { kind: "in" } : { kind: "door" }))
      .catch(() => setPhase({ kind: "in" })); // offline: the app opens and keeps trying (the shell is cached)
  }, []);

  if (phase.kind === "in") return <App onSignedOut={() => setPhase({ kind: "door" })} />;

  // A code from /aparelho on another device: looked up like a link, then confirmed like one.
  const tryCode = (e: Event): void => {
    e.preventDefault();
    const token = cleanCode(code);
    if (token.length !== 8) return setPhase({ kind: "door", error: "invite_unknown" });
    fetch(`/api/invite/${token}`, { cache: "no-store" })
      .then(async (res) => {
        const body: unknown = await res.json();
        setPhase(res.ok ? { kind: "invite", token, info: body as InviteInfo, busy: false } : { kind: "door", error: errorOf(body) });
      })
      .catch(() => setPhase({ kind: "door", error: "offline" }));
  };

  const redeem = (e: Event): void => {
    e.preventDefault();
    if (phase.kind !== "invite" || phase.busy) return;
    setPhase({ ...phase, busy: true, error: undefined });
    fetch("/api/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: phase.token, nick: nick.trim() }),
    })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (res.ok && typeof (body as Partial<Me>).nick === "string") {
          forgetToken();
          setPhase({ kind: "in" });
        } else setPhase({ ...phase, busy: false, error: errorOf(body) });
      })
      .catch(() => setPhase({ ...phase, busy: false, error: "offline" }));
  };

  return (
    <main class="gate">
      <div class="gate-card">
        <div class="gate-peeker">
          <Peeker />
        </div>
        <h1 class="visually-hidden">Kuribotas</h1>
        {phase.kind === "checking" && <p class="gate-text">{w.gate.checking}</p>}
        {phase.kind === "door" && (
          <>
            <h2>{w.gate.doorTitle}</h2>
            {phase.error !== undefined && (
              <p class="gate-error" role="alert">
                {w.gate.errors[phase.error]}
              </p>
            )}
            <p class="gate-text">{w.gate.doorText}</p>
            <form class="gate-code" onSubmit={tryCode}>
              <label class="gate-text" for="gate-code">
                {w.gate.codeLabel}
              </label>
              <input
                id="gate-code"
                value={code}
                onInput={(e) => setCode(e.currentTarget.value)}
                placeholder="ABCD-EFGH"
                maxLength={9}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellcheck={false}
                required
              />
              <button type="submit">{w.gate.codeButton}</button>
            </form>
          </>
        )}
        {phase.kind === "invite" && (
          <form onSubmit={redeem}>
            {phase.info.kind === "person" ? (
              <>
                <h2>{w.gate.welcomeTitle}</h2>
                <label class="gate-text" for="gate-nick">
                  {w.gate.pickNick}
                </label>
                <input
                  id="gate-nick"
                  value={nick}
                  onInput={(e) => setNick(e.currentTarget.value)}
                  placeholder={w.gate.nickPlaceholder}
                  maxLength={24}
                  autoComplete="nickname"
                  autoCapitalize="off"
                  spellcheck={false}
                  required
                />
              </>
            ) : (
              <>
                <h2>{w.gate.deviceTitle(phase.info.nick)}</h2>
                <p class="gate-text">{w.gate.deviceText}</p>
              </>
            )}
            {phase.error !== undefined && (
              <p class="gate-error" role="alert">
                {w.gate.errors[phase.error]}
              </p>
            )}
            <button type="submit" disabled={phase.busy}>
              {w.gate.enter}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
