/**
 * Email Infrastructure
 *
 * Amazon SES for transactional email (replacing Resend).
 */

const isProduction = $app.stage === "production";

// SES Email Identity (domain verification)
export const emailIdentity = new aws.ses.DomainIdentity("DubEmailDomain", {
  domain: isProduction ? "dub.co" : `${$app.stage}.dub.co`,
});

// DKIM for email authentication
export const emailDkim = new aws.ses.DomainDkim("DubEmailDkim", {
  domain: emailIdentity.domain,
});

// Mail From domain (optional, for custom MAIL FROM)
export const mailFrom = new aws.ses.MailFrom("DubMailFrom", {
  domain: emailIdentity.domain,
  mailFromDomain: $interpolate`mail.${emailIdentity.domain}`,
});

// SES Configuration Set for tracking
export const configSet = new aws.ses.ConfigurationSet("DubEmailConfigSet", {
  name: `dub-${$app.stage}`,
  reputationMetricsEnabled: true,
  sendingEnabled: true,
  deliveryOptions: {
    tlsPolicy: "REQUIRE",
  },
  trackingOptions: {
    customRedirectDomain: isProduction ? "track.dub.co" : undefined,
  },
});

// Event destination for email tracking (SNS)
const emailEventsTopic = new sst.aws.SnsTopic("DubEmailEvents", {});

export const eventDestination = new aws.ses.EventDestination("DubEmailEventDestination", {
  configurationSetName: configSet.name,
  name: "email-events",
  enabled: true,
  matchingTypes: [
    "send",
    "reject",
    "bounce",
    "complaint",
    "delivery",
    "open",
    "click",
  ],
  snsDestination: {
    topicArn: emailEventsTopic.arn,
  },
});

// IAM policy for sending emails
export const sesSendPolicy = new aws.iam.Policy("SesSendPolicy", {
  name: `dub-ses-send-${$app.stage}`,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        Resource: "*",
        Condition: {
          StringEquals: {
            "ses:FromAddress": [
              `noreply@${emailIdentity.domain}`,
              `support@${emailIdentity.domain}`,
              `system@${emailIdentity.domain}`,
            ],
          },
        },
      },
    ],
  }),
});

// Email templates
export const welcomeTemplate = new aws.ses.Template("WelcomeEmail", {
  name: `dub-welcome-${$app.stage}`,
  subject: "Welcome to Dub!",
  html: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body>
      <h1>Welcome to Dub, {{name}}!</h1>
      <p>Your account has been created successfully.</p>
      <p>Get started by creating your first short link.</p>
    </body>
    </html>
  `,
  text: "Welcome to Dub, {{name}}! Your account has been created successfully.",
});

// Export configuration
export const email = {
  domain: emailIdentity.domain,
  configSetName: configSet.name,
  dkimTokens: emailDkim.dkimTokens,
};
