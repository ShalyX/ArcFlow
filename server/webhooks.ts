import crypto from "node:crypto";
import type { WebhookEndpoint } from "../src/shared/types";
import { addLog, addWebhookDelivery, getState } from "./store";

type WebhookPayload = {
  type: string;
  data: Record<string, unknown>;
};

export async function deliverWebhooks(payload: WebhookPayload, targetHooks?: WebhookEndpoint[], attempt = 1) {
  const body = JSON.stringify(payload);
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
      const signature = crypto.createHmac("sha256", webhook.signingSecret).update(body).digest("hex");
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-arcflow-signature": signature
          },
          body,
          signal: AbortSignal.timeout(8000)
        });
        const responseBody = await response.text();

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
          attempt,
          payload,
          responseBody: responseBody.slice(0, 4000),
          signatureHeader: signature
        });
      } catch (error) {
        addWebhookDelivery({
          webhookId: webhook.id,
          eventType: payload.type,
          endpointUrl: webhook.url,
          status: "failed",
          attempt,
          error: describeWebhookError(error, webhook.url),
          payload,
          signatureHeader: signature
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

function describeWebhookError(error: unknown, endpointUrl: string) {
  const message = error instanceof Error ? error.message : "Webhook delivery failed.";
  const isLocalhost = endpointUrl.includes("127.0.0.1") || endpointUrl.includes("localhost");

  if (message === "fetch failed") {
    return isLocalhost
      ? "Could not reach local webhook endpoint. Start the merchant demo with npm run dev:all or npm run example:merchant, then retry."
      : "Could not reach webhook endpoint. Check that the URL is reachable from ArcFlow, then retry.";
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return "Webhook endpoint timed out after 8 seconds.";
  }

  return message;
}
