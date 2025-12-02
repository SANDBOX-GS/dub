/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "dub",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
        },
      },
    };
  },
  async run() {
    // Import infrastructure components
    const { vpc } = await import("./infra/vpc");
    const { database } = await import("./infra/database");
    const { cache } = await import("./infra/cache");
    const { queue } = await import("./infra/queue");
    const { email } = await import("./infra/email");
    const { storage } = await import("./infra/storage");
    const { web } = await import("./infra/web");
    const { cron } = await import("./infra/cron");
    const { monitoring } = await import("./infra/monitoring");

    return {
      vpc: vpc.id,
      database: database.clusterEndpoint,
      cache: cache.endpoint,
      queue: queue.url,
      web: web.url,
    };
  },
});
