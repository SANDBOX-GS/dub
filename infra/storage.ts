/**
 * Storage Infrastructure
 *
 * S3 buckets for file storage (images, exports, etc.).
 */

const isProduction = $app.stage === "production";

// Public assets bucket (images, logos, etc.)
export const publicBucket = new sst.aws.Bucket("DubPublicAssets", {
  public: true,
  cors: {
    allowHeaders: ["*"],
    allowMethods: ["GET", "HEAD"],
    allowOrigins: isProduction
      ? ["https://dub.co", "https://app.dub.co", "https://api.dub.co"]
      : ["*"],
    maxAge: "1 day",
  },
});

// Private bucket (exports, backups, etc.)
export const privateBucket = new sst.aws.Bucket("DubPrivateAssets", {
  public: false,
});

// CDN for public assets
export const assetsCdn = new sst.aws.Cdn("DubAssetsCdn", {
  origins: [
    {
      domainName: publicBucket.domain,
      originId: "s3-public-assets",
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: "s3-public-assets",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    cachedMethods: ["GET", "HEAD"],
    cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6", // CachingOptimized
    compress: true,
  },
  priceClass: isProduction ? "PriceClass_All" : "PriceClass_100",
  domain: isProduction
    ? {
        name: "assets.dub.co",
        dns: sst.aws.dns(),
      }
    : undefined,
});

// Lifecycle rules for private bucket
const privateBucketLifecycle = new aws.s3.BucketLifecycleConfigurationV2(
  "DubPrivateBucketLifecycle",
  {
    bucket: privateBucket.name,
    rules: [
      {
        id: "expire-temp-files",
        status: "Enabled",
        filter: {
          prefix: "temp/",
        },
        expiration: {
          days: 1,
        },
      },
      {
        id: "expire-exports",
        status: "Enabled",
        filter: {
          prefix: "exports/",
        },
        expiration: {
          days: 7,
        },
      },
      {
        id: "transition-old-backups",
        status: "Enabled",
        filter: {
          prefix: "backups/",
        },
        transitions: [
          {
            days: 30,
            storageClass: "GLACIER",
          },
        ],
        expiration: {
          days: 365,
        },
      },
    ],
  }
);

// Export storage configuration
export const storage = {
  publicBucket: publicBucket.name,
  privateBucket: privateBucket.name,
  cdnDomain: assetsCdn.domainName,
};
