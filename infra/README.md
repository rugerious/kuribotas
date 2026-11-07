# Infrastructure (AWS, Terraform)

Two small Terraform roots, both in `eu-west-2` (London), everything tagged `Project=kuribotas`:

| Folder | What | State |
|---|---|---|
| `bootstrap/` | the S3 bucket that keeps the server's Terraform state (versioned, encrypted, private, TLS only) | local, once (`terraform.tfstate` stays on your machine, git-ignored) |
| `server/` | network, the EC2 instance, its role, the budget alert | in that bucket, locked with S3's own lock file |

No names that identify the account or the family are in this folder: the state bucket's name (it carries a
random suffix) goes in `server/backend.hcl`, and the alert email in `server/terraform.tfvars`, both git-ignored.
The app's settings live in SSM Parameter Store, never in Terraform:

| Parameter | Type | Example |
|---|---|---|
| `/kuribotas/image-tag` | String | `sha-<full commit hash of main>` |
| `/kuribotas/public-url` | String | `https://chat.example.com` |
| `/kuribotas/tunnel-token` | SecureString | the Cloudflare Tunnel token |
| `/kuribotas/backup-bucket` | String | made by Terraform (`backups.tf`) |

The instance has **no inbound rule**: the Cloudflare Tunnel connects out, and admin access is SSM Session
Manager (`aws ssm start-session --target <instance id>`). On boot it installs Docker and Compose and runs
`/opt/kuribotas/deploy.sh` (from `deploy/server/`), which reads the parameters into a `0600` `.env`, fetches
`deploy/` from GitHub **at the same commit as the image** (compose file, backup job, itself: they always
match), installs the nightly backup timer and starts the app and the tunnel. To deploy a new version: change
`/kuribotas/image-tag` and run `deploy.sh` again (through SSM `send-command` or a session).

## Deploying a new version

```
TAG="sha-$(git rev-parse origin/main)"   # after main's CI has pushed the image
aws ssm put-parameter --region eu-west-2 --name /kuribotas/image-tag --type String --value "$TAG" --overwrite
aws ssm send-command --region eu-west-2 --instance-ids <id> --document-name AWS-RunShellScript \
  --parameters 'commands=["/opt/kuribotas/deploy.sh"]'
curl -sI https://<domain>/main.js | grep -i cache-control   # must say no-cache (a CDN can override it)
```

The tunnel keeps running; the app restarts in a few seconds and every client reconnects on its own.

## Load test

`deploy.sh` installs `/opt/kuribotas/loadtest.sh`. It starts a **throwaway copy** of the running image
(same 300 MB limit, its own empty database in a temporary folder, no tunnel), fills it with fake people
from `server/src/loadtest.ts` and removes everything afterwards: the family's app and data are not touched
(the test refuses any database that already has people).

```bash
CID=$(aws ssm send-command --instance-ids <instance id> --document-name AWS-RunShellScript \
  --parameters 'commands=["/opt/kuribotas/loadtest.sh"]' --query Command.CommandId --output text)
sleep 150 && aws ssm get-command-invocation --command-id "$CID" --instance-id <instance id> \
  --query StandardOutputContent --output text
```

Default phases: 50 people each saying something every ~10 s for a minute (a busy family evening), then
150 people every ~5 s (three times the family, six times the pace). Other phases:
`/opt/kuribotas/loadtest.sh 100x2x60` (PEOPLExEVERYxSECONDS).

## Backups

Every night at about 03:30 UTC (`kuribotas-backup.timer`) the server makes a consistent copy of the
database with SQLite's own backup, checks it (`PRAGMA integrity_check`), and uploads it with `vapid.json`
and the family's sounds to `s3://<backup bucket>/daily/kuribotas-<date>.tgz`. The bucket is private,
encrypted, https only and versioned; copies are kept 35 days. The server's role can only **add** files
there: it can't read, list or delete them, so a compromised server can't destroy the backups.

Run one now and see the result: `aws ssm send-command … 'commands=["/opt/kuribotas/backup.sh"]'`, or
`systemctl status kuribotas-backup` in a session.

**Restore** (an admin, from a workstation):

1. `aws s3 ls s3://<backup bucket>/daily/` and `aws s3 cp` the one you want; `tar xzf` it locally and check
   it: `sqlite3 data/kuribotas.db "PRAGMA integrity_check; SELECT count(*) FROM messages;"`.
2. On the server: `docker compose stop app`, move `data/` aside, put the restored `data/` in its place
   (owned by `1000:1000`), `docker compose start app`. To move the file there without SSH, upload it to
   S3 and give the server a presigned URL (`aws s3 presign … --expires-in 300`) to `curl` through SSM.
