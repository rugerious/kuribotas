#!/bin/bash
# (Re)starts Kuribotas on the server with the settings in SSM Parameter Store. Run as root:
#   /opt/kuribotas/deploy.sh          (through SSM: aws ssm send-command … AWS-RunShellScript)
# Everything it installs comes from GitHub at the same commit as the image, so the app, its compose
# file, the backup job and this script always match. Safe to run again at any time.
set -euo pipefail
cd /opt/kuribotas

imds() {
  local token
  token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"
}
region=$(imds placement/region)
get() { aws ssm get-parameter --region "$region" --name "$1" --with-decryption --query Parameter.Value --output text; }

tag=$(get /kuribotas/image-tag)
raw="https://raw.githubusercontent.com/rugerious/kuribotas/${tag#sha-}/deploy"
fetch() { curl -fsSL -o "$2.new" "$raw/$1" && mv "$2.new" "$2"; } # whole file or nothing

umask 077
{
  echo "KURIBOTAS_TAG=$tag"
  echo "PUBLIC_URL=$(get /kuribotas/public-url)"
  echo "TUNNEL_TOKEN=$(get /kuribotas/tunnel-token)"
} > .env.new
mv .env.new .env

fetch compose.yaml compose.yaml
fetch server/backup.sh backup.sh
fetch server/deploy.sh deploy.sh # this script, for the next deploy
chmod 700 backup.sh deploy.sh
umask 022
fetch server/kuribotas-backup.service /etc/systemd/system/kuribotas-backup.service
fetch server/kuribotas-backup.timer /etc/systemd/system/kuribotas-backup.timer
command -v sqlite3 >/dev/null || dnf install -y -q sqlite # the backup's consistent copy
systemctl daemon-reload
systemctl enable --now kuribotas-backup.timer

install -d -o 1000 -g 1000 -m 700 data # the image's "node" user owns the data
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -af # old versions go (the running ones are kept)
echo "deployed $tag"
