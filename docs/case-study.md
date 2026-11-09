# Kuribotas: case study

*Paulo Martinho · [github.com/rugerious](https://github.com/rugerious) · November 2026*

Kuribotas is a real-time chat for my family and friends, live since 6 November 2026 and used every day. I designed, built and run it on AWS: one person, about 31 hours over six days, 55 pull requests, 195 automated tests, and no inbound port open on the server.

## Why I built it

There was no problem to solve, and there didn't need to be: dreams bring ideas too. I was bored, and I missed the past. Maybe it's *saudade* for the mIRC nights I never lived enough. Maybe I'm a dinosaur building a time capsule. Mostly, I wanted to be proud of building something real and seeing my family use it every day.

Then my daughter sent me: *"uhooooo, this is so cool"*. Nothing in this project made me prouder.

So I built our own place with the playfulness of the 2000s chat rooms: channels with topics and slash commands like IRC, statuses and the screen-shaking nudge like the old messengers, working on any phone without an app store, and cheap and safe enough to run for years.

## What I built

- **A phone-first chat (PWA).** Channels, private chats and private rooms, statuses, "is typing", nudges, a people list, history with an mIRC-style `/log` download, push notifications, and two visual styles with light and dark themes.
- **Accounts without passwords.** People join through single-use invite links (7 days); a second device joins with a 10-minute code; an @ can recover a lost session from inside the app.
- **Family fun with server-side fairness.** Dice and a magic ball are thrown by the server, so nobody picks their own luck; flood limits on everything that reaches other screens.

## Architecture

~~~
Phone (PWA) ──HTTPS/WSS──▶ Cloudflare ◀──outbound tunnel── EC2 t4g.nano, eu-west-2 (no inbound ports)
                                                             ├─ cloudflared (container)
                                                             ├─ Node.js + TypeScript: HTTP + WebSocket (container)
                                                             ├─ SQLite (WAL) on an encrypted EBS volume
                                                             └─ Web Push (VAPID) ──▶ phone notifications
Nightly: SQLite backup ──▶ S3 (encrypted, write-only for the server) ──▶ CloudWatch metric ──▶ alarm ──▶ SNS email
Admin:   SSM Session Manager and Run Command only (no SSH, no keys)
Config:  SSM Parameter Store ──▶ 0600 .env at deploy time
~~~

| Layer | Choice | Why |
|---|---|---|
| Compute | EC2 t4g.nano (Graviton, Amazon Linux 2023) | The load test showed it is far more than enough (below); the cheapest instance that does the job |
| Network | Cloudflare Tunnel, security group with no inbound rule | Nothing on the internet can reach the server directly; TLS and DDoS protection at the edge |
| Access | SSM only, IMDSv2, least-privilege IAM role (SSM + `/kuribotas/*` parameters) | No SSH keys to lose; every admin action goes through AWS and is logged |
| Infrastructure | Terraform, remote state in a versioned, encrypted S3 bucket | The whole server is reproducible from code |
| Delivery | GitHub Actions → arm64 image on GHCR → deploy by image tag through SSM | Every change is reviewed, tested and traceable to a commit |
| Data | SQLite (`node:sqlite`, no native module), numbered migrations | One small file for a family-sized load; migrations tested against a real old database |
| Backups | Nightly consistent copy to S3, 35 days, server can only add | A compromised server cannot delete its own backups |
| Monitoring | CloudWatch dead man's switch (26 h without a backup sign) + budget alert | I hear about a silent failure the next morning, not weeks later |

## Decisions backed by evidence

| Question | What I did | Result |
|---|---|---|
| Is a t4g.nano enough? | Load test on the real instance against a throwaway copy of the app | 150 simulated people at 29 messages/s: every message delivered, p50 3 ms, p99 7 ms, 37 MiB memory, 26% CPU. Kept the nano |
| How long to keep messages? | Asked the users | Channels 90 days, private chats and rooms 3 days, enforced by an hourly clean-up |
| How to keep secrets out of Git? | Runtime secrets only in SSM; a pre-commit hook blocks the project's own sensitive values (account ID, domain, email) kept outside the repo | Nothing sensitive in the repository or its history |
| How to stop a silent backup failure? | The backup script reports a metric; the alarm fires on its absence | Alarm and email subscription live and confirmed |

## How I worked

- **Every change through a pull request**: branch → CI (type check, lint, 195 tests, dependency audit, image build) → squash merge → deploy by image tag. `main` is protected by a pre-commit hook as well.
- **Small, verifiable steps**: every step had an expected output, and file packages were checked with SHA-256 before being applied.
- **Strict browser security**: a Content Security Policy with no inline styles or third-party scripts, fonts shipped with the app, text always rendered as text (never as HTML).
- **Pinned dependencies** at least two weeks old, updated through Dependabot.
- **An AI pair programmer** (Claude) wrote much of the code with me; I made the decisions, ran every command, and reviewed and merged every pull request.

## Problems I hit and fixed

| Problem | Cause | Fix and lesson |
|---|---|---|
| Phones kept the old app after a deploy | Cloudflare rewrote `no-cache` into a 4-hour browser cache | Cache rule to bypass and respect the origin; I now check the served headers after a first deploy |
| A new file in the deploy script arrived one deploy late | The instance runs the old copy of `deploy.sh`, which then fetches the new one | Documented; changes to the deploy script ship in two steps |
| Old images filled the disk | `docker image prune -f` skips tagged images | `prune -af` in the deploy script |

## Results

- Live since 6 November 2026, used daily by the family.
- About 31 hours of work across six days, in 55 pull requests.
- 195 automated tests (97 server, 98 client) run on every pull request.
- No inbound ports, no SSH, no secrets in Git, encrypted data at rest, nightly backups with an alarm.

## What I would do next

- Passkeys, so people sign back in with a fingerprint instead of a code.
- An access step at the door: knock, answer family questions, an @ lets you in.
- Container image signing and a staging copy for risky changes.
