/**
 * VPC Infrastructure
 *
 * Creates a VPC with public and private subnets for the Dub application.
 * - Public subnets: NAT Gateway, Load Balancer
 * - Private subnets: Lambda, RDS, ElastiCache
 */

const isProduction = $app.stage === "production";

// VPC Configuration
export const vpc = new sst.aws.Vpc("DubVpc", {
  baseCidr: "10.0.0.0/16",
  nat: isProduction ? "managed" : "ec2", // Use managed NAT in production
  az: 2, // Use 2 availability zones
});

// Security Group for Lambda functions
export const lambdaSecurityGroup = new aws.ec2.SecurityGroup("LambdaSg", {
  vpcId: vpc.id,
  description: "Security group for Lambda functions",
  ingress: [],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Security Group for RDS
export const rdsSecurityGroup = new aws.ec2.SecurityGroup("RdsSg", {
  vpcId: vpc.id,
  description: "Security group for RDS Aurora MySQL",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 3306,
      toPort: 3306,
      securityGroups: [lambdaSecurityGroup.id],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Security Group for ElastiCache Redis
export const redisSecurityGroup = new aws.ec2.SecurityGroup("RedisSg", {
  vpcId: vpc.id,
  description: "Security group for ElastiCache Redis",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 6379,
      toPort: 6379,
      securityGroups: [lambdaSecurityGroup.id],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Export subnet IDs for other components
export const privateSubnets = vpc.privateSubnets;
export const publicSubnets = vpc.publicSubnets;
