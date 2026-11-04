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
cat >> .gitignore <<'EOF'

# --- Kuribotas additions ---
# Secrets: never commit; .env.example is the documented template
.env
.env.*
!.env.example
# Real family data: the chat database and its backups never go in Git
*.sqlite
*.sqlite3
*.db
*.db-journal
*.db-wal
*.db-shm
data/
backups/
# Web Push (VAPID) private keys
vapid*.json
