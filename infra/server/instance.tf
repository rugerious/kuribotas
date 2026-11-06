# Amazon Linux 2023 for ARM, the latest when the instance is created. Later AMIs don't replace it
# (ignore_changes): updates come from dnf, and a new instance is a deliberate step.
data "aws_ssm_parameter" "al2023_arm" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "server" {
  ami                    = data.aws_ssm_parameter.al2023_arm.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name
  # The family's history lives on this disk (plus the S3 backups from 5.4): no accidental terminate.
  disable_api_termination = true

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 1          # containers can't reach the instance's credentials
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", { region = var.region })

  tags = { Name = "kuribotas" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
