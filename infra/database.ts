/**
 * Database Infrastructure
 *
 * Aurora MySQL Serverless v2 with RDS Proxy for Lambda connection pooling.
 */

import { vpc, rdsSecurityGroup, privateSubnets } from "./vpc";

const isProduction = $app.stage === "production";

// Database subnet group
const dbSubnetGroup = new aws.rds.SubnetGroup("DubDbSubnetGroup", {
  subnetIds: privateSubnets,
  description: "Subnet group for Dub Aurora cluster",
});

// Aurora MySQL Serverless v2 Cluster
export const database = new aws.rds.Cluster("DubDatabase", {
  engine: "aurora-mysql",
  engineMode: "provisioned",
  engineVersion: "8.0.mysql_aurora.3.05.2",
  databaseName: "dub",
  masterUsername: "admin",
  masterPassword: new sst.Secret("DatabasePassword").value,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [rdsSecurityGroup.id],
  storageEncrypted: true,
  skipFinalSnapshot: !isProduction,
  finalSnapshotIdentifier: isProduction ? `dub-final-${Date.now()}` : undefined,
  backupRetentionPeriod: isProduction ? 7 : 1,
  preferredBackupWindow: "03:00-04:00",
  preferredMaintenanceWindow: "Mon:04:00-Mon:05:00",
  serverlessv2ScalingConfiguration: {
    minCapacity: isProduction ? 0.5 : 0.5,
    maxCapacity: isProduction ? 16 : 4,
  },
  enableHttpEndpoint: true, // Enable Data API
});

// Aurora Serverless v2 Instance
const dbInstance = new aws.rds.ClusterInstance("DubDbInstance", {
  clusterIdentifier: database.id,
  instanceClass: "db.serverless",
  engine: "aurora-mysql",
  engineVersion: database.engineVersion,
  publiclyAccessible: false,
});

// RDS Proxy for Lambda connection pooling
export const dbProxy = new aws.rds.Proxy("DubDbProxy", {
  name: `dub-proxy-${$app.stage}`,
  engineFamily: "MYSQL",
  roleArn: new aws.iam.Role("RdsProxyRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "rds.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    }),
    inlinePolicies: [
      {
        name: "SecretsAccess",
        policy: $interpolate`{
          "Version": "2012-10-17",
          "Statement": [{
            "Effect": "Allow",
            "Action": [
              "secretsmanager:GetSecretValue"
            ],
            "Resource": "${dbSecret.arn}"
          }]
        }`,
      },
    ],
  }).arn,
  auths: [
    {
      authScheme: "SECRETS",
      iamAuth: "DISABLED",
      secretArn: dbSecret.arn,
    },
  ],
  vpcSecurityGroupIds: [rdsSecurityGroup.id],
  vpcSubnetIds: privateSubnets,
  requireTls: true,
  idleClientTimeout: 1800,
});

// Secrets Manager for database credentials
const dbSecret = new aws.secretsmanager.Secret("DubDbSecret", {
  name: `dub/${$app.stage}/database`,
  description: "Database credentials for Dub",
});

const dbSecretVersion = new aws.secretsmanager.SecretVersion("DubDbSecretVersion", {
  secretId: dbSecret.id,
  secretString: $interpolate`{
    "username": "${database.masterUsername}",
    "password": "${database.masterPassword}",
    "host": "${database.endpoint}",
    "port": 3306,
    "dbname": "dub"
  }`,
});

// RDS Proxy Target Group
const proxyDefaultTargetGroup = new aws.rds.ProxyDefaultTargetGroup("DubProxyTarget", {
  dbProxyName: dbProxy.name,
  connectionPoolConfig: {
    maxConnectionsPercent: 100,
    maxIdleConnectionsPercent: 50,
    connectionBorrowTimeout: 120,
  },
});

const proxyTarget = new aws.rds.ProxyTarget("DubProxyTargetCluster", {
  dbProxyName: dbProxy.name,
  targetGroupName: proxyDefaultTargetGroup.name,
  dbClusterIdentifier: database.id,
});

// Export connection strings
export const databaseUrl = $interpolate`mysql://${database.masterUsername}:${database.masterPassword}@${dbProxy.endpoint}:3306/dub`;
export const databaseHost = dbProxy.endpoint;
