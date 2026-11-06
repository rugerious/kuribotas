# The instance's role: SSM (Session Manager and Run Command, so no SSH) and reading its own settings.
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server" {
  name               = "kuribotas-server"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_caller_identity" "me" {}

# Only /kuribotas/* parameters. SecureStrings use the AWS-managed aws/ssm key, which lets SSM decrypt
# for anyone allowed to read the parameter: no KMS statement needed.
data "aws_iam_policy_document" "settings" {
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter/kuribotas/*"]
  }
}

resource "aws_iam_role_policy" "settings" {
  name   = "read-kuribotas-settings"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.settings.json
}

resource "aws_iam_instance_profile" "server" {
  name = "kuribotas-server"
  role = aws_iam_role.server.name
}
