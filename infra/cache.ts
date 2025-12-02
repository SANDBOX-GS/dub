/**
 * Cache Infrastructure
 *
 * ElastiCache Redis cluster for caching and rate limiting.
 */

import { vpc, redisSecurityGroup, privateSubnets } from "./vpc";

const isProduction = $app.stage === "production";

// Redis subnet group
const redisSubnetGroup = new aws.elasticache.SubnetGroup("DubRedisSubnetGroup", {
  subnetIds: privateSubnets,
  description: "Subnet group for Dub Redis cluster",
});

// ElastiCache Redis Cluster (Serverless for cost optimization)
export const cache = new aws.elasticache.ServerlessCache("DubRedis", {
  engine: "redis",
  name: `dub-redis-${$app.stage}`,
  description: "Redis cache for Dub application",
  majorEngineVersion: "7",
  securityGroupIds: [redisSecurityGroup.id],
  subnetIds: privateSubnets,
  cacheUsageLimits: {
    dataStorage: {
      maximum: isProduction ? 10 : 1, // GB
      unit: "GB",
    },
    ecpuPerSecond: {
      maximum: isProduction ? 5000 : 1000,
    },
  },
  snapshotRetentionLimit: isProduction ? 7 : 1,
  dailySnapshotTime: "03:00",
});

// Export Redis connection details
export const redisEndpoint = cache.endpoint;
export const redisHost = $interpolate`${cache.endpoint[0].address}`;
export const redisPort = $interpolate`${cache.endpoint[0].port}`;

// Redis connection URL for ioredis
export const redisUrl = $interpolate`rediss://${cache.endpoint[0].address}:${cache.endpoint[0].port}`;
