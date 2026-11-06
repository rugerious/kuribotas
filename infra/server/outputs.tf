output "instance_id" {
  value = aws_instance.server.id
}

output "session" {
  description = "A shell on the server, without SSH (needs the Session Manager plugin)."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.server.id}"
}
