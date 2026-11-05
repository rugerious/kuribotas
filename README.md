# Kuribotas

[![server](https://github.com/rugerious/kuribotas/actions/workflows/server.yml/badge.svg)](https://github.com/rugerious/kuribotas/actions/workflows/server.yml)

**A real-time chat for family and friends — the child of 2000s IRC and instant messengers, rebuilt for the phone.**

*Kuribota* is Angolan slang for the person who always knows everyone's business. Our main channel is `#mujimbo` — the rumour that travels from mouth to mouth.

> Status: ✅ Phase 0 done · 🚧 **Phase 1 — Basic chat.** Target: in use by the family for Christmas 2026.

## What it is

From IRC: channels with topics, slash commands (`/me`, `/nick`, `/topic`, `/msg`, `/invite`), a nick list with `@` and `+`, coloured nicks, timestamps and `*** Mum joined #mujimbo`.

From instant messengers: a contact list with statuses (**No mambo**, **Já bazo**, **Na bumba**, **A zongolar** — invisible), a personal message, "is typing…", private chats and the nudge that shakes the screen.

New: it is a **PWA** — open an invite link, add it to the home screen, get push notifications. No app store, no passwords.

## Status

| # | Phase | Hours (est.) | Status |
|---|---|---|---|
| 0 | Foundations: repo, TypeScript monorepo, CI → GHCR, Dependabot | 3–4 | ✅ |
| 1 | Basic chat: WebSocket server, channels, SQLite history, slash commands, retro UI | 7–10 | 🚧 |
| 2 | Messenger side: statuses, private chats, nudge, typing indicator | 6–9 | ⏳ |
| 3 | Phone without effort: PWA, Web Push, reconnection, unread counts | 5–7 | ⏳ |
| 4 | Invites and security: invite links, sessions, roles, rate limits | 3–5 | ⏳ |
| 5 | Deploy: always-on server, Cloudflare Tunnel, backups, load test | 4–7 | ⏳ |
| 6 | Write-up | 2–3 | ⏳ |

MVP: 28–42 h.

## What is built so far

- **TypeScript monorepo** with npm workspaces: `server/` and `web/` (placeholder until the frontend is chosen).
- **No build step:** Node 26 runs `.ts` files directly by stripping types; `tsc` runs as a type checker only (`erasableSyntaxOnly`, `strict`).
- **One command for quality:** `npm run check` = type check + ESLint + tests (Node's built-in test runner).
- **Server:** one port for HTTP and WebSocket. `GET /healthz` → `200 {"status":"ok"}`, other paths `404`; WebSocket upgrades only on `/ws`. Graceful shutdown on `SIGTERM`: chat clients get close code 1001, stragglers are force-closed after 3 s.
- **Real-time chat (first slice):** `ws` (zero dependencies) broadcasts every valid message to all connected clients; input is validated on the server; tested with Node's built-in WebSocket client, the same API browsers use.
- **History (SQLite):** Node's built-in `node:sqlite` (no native module). Schema `spaces` → `channels` → `messages`, upgraded by numbered migrations tracked in `PRAGMA user_version`, each in a transaction. WAL mode; prepared statements only (no SQL injection). A message is saved before it is broadcast; newcomers get the last 50. Data lives in `DATA_DIR` (default `./data`, `/data` in the image, mounted as a volume).
- **Container image:** `ghcr.io/rugerious/kuribotas/server` (tags `sha-<commit>` and `latest`). Base `node:26-slim` pinned by digest, runs as the unprivileged `node` user, Docker `HEALTHCHECK` on `/healthz`, stops gracefully in under a second.
- **CI (GitHub Actions):** every PR runs `npm ci`, `npm run check`, a production `npm audit` and an image build; merges to `main` push the image to GHCR. Every action is pinned to a full commit SHA, and runners to `ubuntu-24.04`. Dependabot proposes npm, Actions and Docker updates weekly.
- **Safety from day one:** pre-commit hook for project-specific values, `.gitignore` for secrets and the chat database, GitHub secret scanning + push protection, Dependabot security updates.
- **Dependency audit:** production tree clean (`npm audit --omit=dev`). One moderate, dev-only advisory (`minimatch` via ESLint) is accepted until upstream ships a fix: the patterns it parses are our own, and the suggested fix would downgrade ESLint a major version.

### Repo layout

~~~
server/            Node.js + TypeScript backend
  src/app.ts       builds the HTTP server
  src/index.ts     starts it (HOST, PORT)
  src/chat.ts      WebSocket chat on /ws
  src/store.ts     SQLite: schema, migrations, messages
  test/            node:test tests
web/               web client (from phase 1)
.githooks/         pre-commit hook
tsconfig.json      shared type-check settings
eslint.config.js   lint rules
Dockerfile         server image
.github/           CI workflow, Dependabot, PR template
~~~

### Chat protocol (so far)

WebSocket at `/ws`, JSON text frames with a `type` field. Every new feature becomes a new `type`.

| Direction | Message | Meaning |
|---|---|---|
| server → client | `{"type":"welcome","channel":"#mujimbo","history":[…]}` | sent once on connect: the channel and its last 50 messages |
| client → server | `{"type":"say","text":"…"}` | a chat message (1–2000 characters after trimming) |
| server → everyone | `{"type":"message","id":1,"channel":"#mujimbo","text":"…","at":"<ISO time>"}` | a valid `say`, saved first, then broadcast |

Anything else is ignored. Frames over 16 KiB close that client with code 1009; on shutdown, clients get 1001 ("going away").

## Planned architecture

~~~
Phone (PWA) ──HTTPS/WSS──▶ Cloudflare Tunnel ──▶ small always-on server
                                                  ├─ Node.js + TypeScript (HTTP + WebSocket)
                                                  ├─ SQLite (messages, channels, users)
                                                  └─ Web Push (VAPID) ──▶ phone notifications
~~~

## Rules this project follows

- **Zero inbound ports.** The server is reached only through an outbound Cloudflare Tunnel.
- **Family data never leaves the server.** No messages, names or screenshots of real chats in Git, issues, logs or this README. The database and its backups are git-ignored.
- **No secrets in Git.** Runtime secrets live in a `0600` `.env` on the server; `.env.example` documents them.
- **Inspired, not copied.** Features are ideas anyone can use; no names, logos, sounds, emoticons or icons from IRC clients or messengers. All art and sounds are original.
- **Pinned versions, automated updates** (Dependabot), and every change through a pull request.

## Development setup

Requirements: Linux or WSL2, [nvm](https://github.com/nvm-sh/nvm), Node.js 26 LTS (pinned in `.nvmrc`).

~~~
nvm use                                # use the Node version from .nvmrc
git config core.hooksPath .githooks    # enable the pre-commit hook (once per clone)
npm ci                                 # install exactly what package-lock.json says
npm run check                          # type check + lint + tests
npm run dev --workspace server         # run the server, restart on save
curl http://127.0.0.1:3000/healthz     # {"status":"ok"}
docker build -t kuribotas/server:dev .                          # build the image
docker run --rm -p 127.0.0.1:3000:3000 -v kuribotas-data:/data kuribotas/server:dev   # run it, data in a volume
~~~

**Pre-commit hook.** `.githooks/pre-commit` blocks a commit when the added lines contain a forbidden value: AWS account ID, email, domain or real family names, matched case-insensitively. The values live outside the repo in `~/.config/kuribotas/forbidden-patterns`, so the hook itself reveals nothing. GitHub secret scanning catches known secret *formats*; the hook catches this project's own *values*.

## Licence

[MIT](LICENSE)
