/**
 * Web Application Infrastructure
 *
 * Next.js application deployed with OpenNext on AWS Lambda + CloudFront.
 */

import { vpc, lambdaSecurityGroup, privateSubnets } from "./vpc";
import { databaseUrl } from "./database";
import { redisUrl } from "./cache";
import { queues } from "./queue";
import { storage } from "./storage";
import { email } from "./email";

const isProduction = $app.stage === "production";

// Secrets
const secrets = {
  nextAuthSecret: new sst.Secret("NextAuthSecret"),
  stripeSecretKey: new sst.Secret("StripeSecretKey"),
  stripeWebhookSecret: new sst.Secret("StripeWebhookSecret"),
  tinybirdApiKey: new sst.Secret("TinybirdApiKey"),
  googleClientId: new sst.Secret("GoogleClientId"),
  googleClientSecret: new sst.Secret("GoogleClientSecret"),
  githubClientId: new sst.Secret("GithubClientId"),
  githubClientSecret: new sst.Secret("GithubClientSecret"),
  anthropicApiKey: new sst.Secret("AnthropicApiKey"),
};

// Next.js application with OpenNext
export const web = new sst.aws.Nextjs("DubWeb", {
  path: "apps/web",
  buildCommand: "pnpm build",

  // Domain configuration
  domain: isProduction
    ? {
        name: "dub.co",
        aliases: ["app.dub.co", "api.dub.co"],
        dns: sst.aws.dns(),
        cert: new sst.aws.Dns("DubCert", {
          domain: "dub.co",
        }),
      }
    : {
        name: `${$app.stage}.dub.co`,
        dns: sst.aws.dns(),
      },

  // VPC configuration for database/cache access
  vpc: {
    id: vpc.id,
    securityGroups: [lambdaSecurityGroup.id],
    subnets: privateSubnets,
  },

  // Environment variables
  environment: {
    // App
    NEXT_PUBLIC_APP_NAME: "Dub",
    NEXT_PUBLIC_APP_DOMAIN: isProduction ? "dub.co" : `${$app.stage}.dub.co`,
    NEXT_PUBLIC_APP_SHORT_DOMAIN: isProduction ? "dub.sh" : `${$app.stage}.dub.sh`,
    NODE_ENV: isProduction ? "production" : "development",

    // Database
    DATABASE_URL: databaseUrl,

    // Redis
    REDIS_URL: redisUrl,

    // Storage
    STORAGE_BUCKET: storage.publicBucket,
    STORAGE_PRIVATE_BUCKET: storage.privateBucket,
    STORAGE_BASE_URL: $interpolate`https://${storage.cdnDomain}`,

    // Email
    SES_REGION: "us-east-1",
    SES_FROM_EMAIL: $interpolate`noreply@${email.domain}`,

    // Queues
    SQS_QUEUE_URL: queues.main.url,
    SQS_PRIORITY_QUEUE_URL: queues.priority.url,
    SQS_EMAIL_QUEUE_URL: queues.email.url,
    SQS_ANALYTICS_QUEUE_URL: queues.analytics.url,
    SQS_WEBHOOK_QUEUE_URL: queues.webhook.url,
    SQS_PAYOUT_QUEUE_URL: queues.payout.url,

    // Tinybird (keep external for now)
    TINYBIRD_API_URL: "https://api.tinybird.co",

    // Feature flags
    AWS_DEPLOYMENT: "true",
  },

  // Link secrets
  link: [
    secrets.nextAuthSecret,
    secrets.stripeSecretKey,
    secrets.stripeWebhookSecret,
    secrets.tinybirdApiKey,
    secrets.googleClientId,
    secrets.googleClientSecret,
    secrets.githubClientId,
    secrets.githubClientSecret,
    secrets.anthropicApiKey,
  ],

  // Permissions
  permissions: [
    // SES
    {
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"],
    },
    // SQS
    {
      actions: ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage"],
      resources: [
        queues.main.arn,
        queues.priority.arn,
        queues.email.arn,
        queues.analytics.arn,
        queues.webhook.arn,
        queues.payout.arn,
      ],
    },
    // S3
    {
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      resources: [
        $interpolate`${storage.publicBucket}/*`,
        $interpolate`${storage.privateBucket}/*`,
      ],
    },
  ],

  // OpenNext configuration
  openNextVersion: "3.1.4",

  // Warm function (keep Lambda warm)
  warm: isProduction ? 5 : 1,

  // Memory and timeout
  memory: isProduction ? "2048 MB" : "1024 MB",
  timeout: "30 seconds",

  // Image optimization
  imageOptimization: {
    memory: "512 MB",
  },

  // Invalidation
  invalidation: {
    paths: "all",
    wait: true,
  },
});

// Queue consumers (subscribe to SQS queues)
queues.email.subscribe("EmailConsumer", {
  handler: "apps/web/functions/consumers/email.handler",
  timeout: "1 minute",
  vpc: {
    id: vpc.id,
    securityGroups: [lambdaSecurityGroup.id],
    subnets: privateSubnets,
  },
  permissions: [
    {
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"],
    },
  ],
});

queues.webhook.subscribe("WebhookConsumer", {
  handler: "apps/web/functions/consumers/webhook.handler",
  timeout: "2 minutes",
  vpc: {
    id: vpc.id,
    securityGroups: [lambdaSecurityGroup.id],
    subnets: privateSubnets,
  },
});

queues.analytics.subscribe("AnalyticsConsumer", {
  handler: "apps/web/functions/consumers/analytics.handler",
  timeout: "5 minutes",
  environment: {
    TINYBIRD_API_KEY: secrets.tinybirdApiKey.value,
  },
});

// Export web URL
export { web };
