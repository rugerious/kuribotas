terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.70.0"
    }
  }
  # The bucket's name comes from backend.hcl (git-ignored):  terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "kuribotas/server.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true # S3's own lock file: no DynamoDB table
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "kuribotas" }
  }
}
