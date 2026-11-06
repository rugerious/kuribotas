# A small VPC of its own: one public subnet (outbound only: the instance has a public IPv4 to reach
# Cloudflare, GHCR and AWS, but the security group lets nothing in).
data "aws_availability_zones" "here" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "kuribotas" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "kuribotas" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.42.0.0/26"
  availability_zone       = data.aws_availability_zones.here.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "kuribotas-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "kuribotas-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# The default security group of the VPC is emptied, so nothing can use it by accident.
resource "aws_default_security_group" "locked" {
  vpc_id = aws_vpc.main.id
}

# No ingress at all: the family comes in through the Cloudflare Tunnel (an outbound connection) and
# admins through SSM Session Manager (also outbound). Out: anywhere (Cloudflare, GHCR, AWS APIs, push services).
resource "aws_security_group" "server" {
  name        = "kuribotas-server"
  description = "Kuribotas server: no inbound, outbound only"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "kuribotas-server" }
}

resource "aws_vpc_security_group_egress_rule" "all_ipv4" {
  security_group_id = aws_security_group.server.id
  description       = "Outbound: Cloudflare Tunnel, image pulls, AWS APIs, Web Push"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
