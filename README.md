# Kuribotas

**A real-time chat for family and friends — the child of 2000s IRC and instant messengers, rebuilt for the phone.**

*Kuribota* is Angolan slang for the person who always knows everyone's business. Our main channel is `#mujimbo` — the rumour that travels from mouth to mouth.

> Status: 🚧 **Phase 0 — Foundations.** Target: in use by the family for Christmas 2026.

## What it is

From IRC: channels with topics, slash commands (`/me`, `/nick`, `/topic`, `/msg`, `/invite`), a nick list with `@` and `+`, coloured nicks, timestamps and `*** Mum joined #mujimbo`.

From instant messengers: a contact list with statuses (**No mambo**, **Já bazo**, **Na bumba**, **A zongolar** — invisible), a personal message, "is typing…", private chats and the nudge that shakes the screen.

New: it is a **PWA** — open an invite link, add it to the home screen, get push notifications. No app store, no passwords.

## Status

| # | Phase | Hours (est.) | Status |
|---|---|---|---|
| 0 | Foundations: repo, TypeScript monorepo, CI → GHCR, Dependabot | 3–4 | 🚧 |
| 1 | Basic chat: WebSocket server, channels, SQLite history, slash commands, retro UI | 7–10 | ⏳ |
| 2 | Messenger side: statuses, private chats, nudge, typing indicator | 6–9 | ⏳ |
| 3 | Phone without effort: PWA, Web Push, reconnection, unread counts | 5–7 | ⏳ |
| 4 | Invites and security: invite links, sessions, roles, rate limits | 3–5 | ⏳ |
| 5 | Deploy: always-on server, Cloudflare Tunnel, backups, load test | 4–7 | ⏳ |
| 6 | Write-up | 2–3 | ⏳ |

MVP: 28–42 h.

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
~~~

**Pre-commit hook.** `.githooks/pre-commit` blocks a commit when the added lines contain a forbidden value: AWS account ID, email, domain or real family names, matched case-insensitively. The values live outside the repo in `~/.config/kuribotas/forbidden-patterns`, so the hook itself reveals nothing. GitHub secret scanning catches known secret *formats*; the hook catches this project's own *values*.

## Licence

[MIT](LICENSE)
