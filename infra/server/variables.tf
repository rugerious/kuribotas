variable "region" {
  description = "AWS region for the server."
  type        = string
  default     = "eu-west-2"
}

variable "instance_type" {
  description = "Graviton (ARM). t4g.nano = 2 vCPU, 0.5 GB: the load test (phase 5) decides if it stays."
  type        = string
  default     = "t4g.nano"
}

variable "alert_email" {
  description = "Who gets the budget and backup alerts. In terraform.tfvars (git-ignored)."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly budget for everything tagged Project=kuribotas (expected: about 8 USD)."
  type        = number
  default     = 10
}
