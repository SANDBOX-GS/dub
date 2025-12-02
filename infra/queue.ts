/**
 * Queue Infrastructure
 *
 * SQS queues for background job processing (replacing Upstash QStash).
 */

const isProduction = $app.stage === "production";

// Main background jobs queue
export const queue = new sst.aws.Queue("DubQueue", {
  fifo: false,
  visibilityTimeout: "5 minutes",
  dlq: {
    retry: 3,
  },
});

// High priority queue for time-sensitive tasks
export const priorityQueue = new sst.aws.Queue("DubPriorityQueue", {
  fifo: false,
  visibilityTimeout: "2 minutes",
  dlq: {
    retry: 5,
  },
});

// Email queue
export const emailQueue = new sst.aws.Queue("DubEmailQueue", {
  fifo: false,
  visibilityTimeout: "1 minute",
  dlq: {
    retry: 3,
  },
});

// Analytics events queue
export const analyticsQueue = new sst.aws.Queue("DubAnalyticsQueue", {
  fifo: false,
  visibilityTimeout: "5 minutes",
  dlq: {
    retry: 3,
  },
});

// Webhook delivery queue
export const webhookQueue = new sst.aws.Queue("DubWebhookQueue", {
  fifo: false,
  visibilityTimeout: "2 minutes",
  dlq: {
    retry: 5,
  },
});

// Payout processing queue
export const payoutQueue = new sst.aws.Queue("DubPayoutQueue", {
  fifo: true, // FIFO for ordered processing
  visibilityTimeout: "10 minutes",
  dlq: {
    retry: 3,
  },
});

// Export all queues
export const queues = {
  main: queue,
  priority: priorityQueue,
  email: emailQueue,
  analytics: analyticsQueue,
  webhook: webhookQueue,
  payout: payoutQueue,
};
