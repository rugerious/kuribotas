# A dead man's switch for the backups: backup.sh sends one data point (Kuribotas / BackupOk = 1) after
# every backup that reached S3. If 26 hours go by without one (the backup failed, or the server was off),
# the alarm emails var.alert_email, and emails again when backups are back. About 0.40 USD a month
# (one alarm + one custom metric; the emails are within SNS's free tier).
resource "aws_sns_topic" "alerts" {
  name = "kuribotas-alerts"
}

# AWS sends a confirmation email first: the alerts only arrive after "Confirm subscription" is clicked.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "backup_missing" {
  alarm_name          = "kuribotas-backup-missing"
  alarm_description   = "No successful Kuribotas backup for 26 hours (failed, or the server was off). Check: journalctl -u kuribotas-backup on the server."
  namespace           = "Kuribotas"
  metric_name         = "BackupOk"
  statistic           = "Sum"
  period              = 3600 # hourly buckets; an hour without a backup counts as missing…
  evaluation_periods  = 26
  datapoints_to_alarm = 26 # …and 26 of them in a row raise the alarm
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# The server may write that one metric (only in the Kuribotas namespace) and nothing else in CloudWatch.
data "aws_iam_policy_document" "backup_metric" {
  statement {
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"] # PutMetricData has no resource-level permissions; the namespace condition limits it
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["Kuribotas"]
    }
  }
}

resource "aws_iam_role_policy" "backup_metric" {
  name   = "report-kuribotas-backups"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.backup_metric.json
}
