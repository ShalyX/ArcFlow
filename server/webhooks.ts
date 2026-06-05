import crypto from "node:crypto";
import type { WebhookEndpoint } from "../src/shared/types";
import { addLog, addWebhookDelivery, getState } from "./store";

type WebhookPayload = {
  type: string;
  data: Record<string, unknown>;
};

export async function deliverWebhooks(payload: WebhookPayload, targetHooks?: WebhookEndpoint[]) {
  const secret = process.env.WEBHOOK_SIGNING_SECRET || "local-dev-secret";
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const enabledHooks = targetHooks || getState().webhooks.filter((webhook) => webhook.enabled && webhook.events.includes(payload.type));

  if (enabledHooks.length === 0) {
    addWebhookDelivery({
      eventType: payload.type,
      status: "skipped",
      attempt: 1,
      error: "No enabled webhook endpoints matched this event.",
      payload
    });
    addLog({
      level: "info",
      type: "webhook.skipped",
      message: `No enabled webhook endpoints for ${payload.type}.`
    });
    return;
  }

  await Promise.allSettled(
    enabledHooks.map(async (webhook) => {
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-arcflow-signature": signature
          },
          body
        });

        addLog({
          level: response.ok ? "success" : "warning",
          type: response.ok ? "webhook.delivered" : "webhook.failed",
          message: `${payload.type} delivered to ${webhook.url} with HTTP ${response.status}.`
        });
        addWebhookDelivery({
          webhookId: webhook.id,
          eventType: payload.type,
          endpointUrl: webhook.url,
          status: response.ok ? "delivered" : "failed",
          httpStatus: response.status,
          attempt: 1,
          payload
        });
      } catch (error) {
        addWebhookDelivery({
          webhookId: webhook.id,
          eventType: payload.type,
          endpointUrl: webhook.url,
          status: "failed",
          attempt: 1,
          error: error instanceof Error ? error.message : "Webhook delivery failed.",
          payload
        });
        addLog({
          level: "error",
          type: "webhook.failed",
          message: `${payload.type} failed for ${webhook.url}.`
        });
      }
    })
  );
}
