#!/bin/bash
# Daily backup of Kuribotas to the private backups bucket: a consistent copy of the database (SQLite's
# own backup, safe while the app is running), checked before it leaves, plus the notification keys
# (vapid.json) and the family's sounds. Run by kuribotas-backup.timer; by hand: /opt/kuribotas/backup.sh
set -euo pipefail
cd /opt/kuribotas

imds() {
  local token
  token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"
}
region=$(imds placement/region)
bucket=$(aws ssm get-parameter --region "$region" --name /kuribotas/backup-bucket --query Parameter.Value --output text)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/data"
sqlite3 data/kuribotas.db ".backup '$work/data/kuribotas.db'"
[ "$(sqlite3 "$work/data/kuribotas.db" 'PRAGMA integrity_check')" = "ok" ] || { echo "backup: copy failed its integrity check" >&2; exit 1; }
[ -f data/vapid.json ] && cp -p data/vapid.json "$work/data/"
[ -d data/sounds ] && cp -rp data/sounds "$work/data/"

stamp=$(date -u +%Y-%m-%dT%H%MZ)
file="kuribotas-$stamp.tgz"
tar czf "$work/$file" -C "$work" data
aws s3 cp "$work/$file" "s3://$bucket/daily/$file" --region "$region" --only-show-errors
echo "backup ok: daily/$file ($(du -h "$work/$file" | cut -f1))" # sizes and names only: never the content
