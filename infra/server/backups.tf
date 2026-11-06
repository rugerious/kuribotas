# Where the nightly backups go: private, encrypted, https only, 35 days of history.
# The server may only ADD files here (no read, no delete): even someone inside the server
# couldn't wipe the backups. Restoring is done by an admin (see infra/README.md).
resource "random_id" "backups" {
  byte_length = 4
}

resource "aws_s3_bucket" "backups" {
  bucket = "kuribotas-backups-${random_id.backups.hex}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled" # an overwritten file can still be recovered
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# 35 nightly copies, then they go (the chat itself keeps 90 days of history).
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "keep-35-days"
    status = "Enabled"
    filter {
      prefix = "daily/"
    }
    expiration {
      days = 35
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "backups_tls_only" {
  statement {
    sid     = "TlsOnly"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "backups" {
  bucket     = aws_s3_bucket.backups.id
  policy     = data.aws_iam_policy_document.backups_tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.backups]
}

# The server finds the bucket here (its role can already read /kuribotas/*).
resource "aws_ssm_parameter" "backup_bucket" {
  name  = "/kuribotas/backup-bucket"
  type  = "String"
  value = aws_s3_bucket.backups.bucket
}

# Write-only: add new backups under daily/, nothing else.
data "aws_iam_policy_document" "write_backups" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/daily/*"]
  }
}

resource "aws_iam_role_policy" "write_backups" {
  name   = "write-kuribotas-backups"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.write_backups.json
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}
