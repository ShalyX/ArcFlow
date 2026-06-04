import crypto from "node:crypto";
import { addLog, getState } from "./store";

type WebhookPayload = {
  type: string;
  data: Record<string, unknown>;
};

export async function deliverWebhooks(payload: WebhookPayload) {
  const secret = process.env.WEBHOOK_SIGNING_SECRET || "local-dev-secret";
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const enabledHooks = getState().webhooks.filter((webhook) => webhook.enabled && webhook.events.includes(payload.type));

  if (enabledHooks.length === 0) {
    addLog({
      level: "info",
      type: "webhook.skipped",
      message: `No enabled webhook endpoints for ${payload.type}.`
    });
    return;
  }

  await Promise.allSettled(
    enabledHooks.map(async (webhook) => {
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
    })
  );
}
