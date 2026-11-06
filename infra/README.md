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

The instance has **no inbound rule**: the Cloudflare Tunnel connects out, and admin access is SSM Session
Manager (`aws ssm start-session --target <instance id>`). On boot it installs Docker and Compose and runs
`/opt/kuribotas/deploy.sh`, which reads the parameters into a `0600` `.env`, fetches `deploy/compose.yaml` from
GitHub **at the same commit as the image** (so they always match) and starts the app and the tunnel. To deploy a new version: change
`/kuribotas/image-tag` and run `deploy.sh` again (through SSM `send-command` or a session).
