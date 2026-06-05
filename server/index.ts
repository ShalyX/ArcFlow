import cors from "cors";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import express from "express";
import { parseUsdc } from "../src/shared/arc";
import type { ConfirmPaymentInput, CreateIntentInput } from "../src/shared/types";
import { validateIntentAddress, verifyArcUsdcTransfer } from "./arcVerifier";
import {
  addLog,
  addWebhook,
  countActiveApiKeys,
  createApiKey,
  createPaymentIntent,
  createReceipt,
  DEMO_MERCHANT_WEBHOOK_URL,
  deleteWebhook,
  ensureDemoMerchantWebhook,
  getWebhook,
  getWebhookDelivery,
  getPaymentIntent,
  getIntentByTxHash,
  getReceiptByTxHash,
  getState,
  initStore,
  markIntentPaid,
  resetDemoData,
  revokeApiKey,
  rotateWebhookSecret,
  seedDemoIntent,
  updateWebhook,
  verifyApiKey
} from "./store";
import { deliverWebhooks } from "./webhooks";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, product: "ArcFlow", network: "Arc Testnet" });
});

app.get("/api/state", (_request, response) => {
  response.json(getState());
});

app.get("/api/payment-intents/:id", (request, response) => {
  const intent = getPaymentIntent(routeParam(request, "id"));
  if (!intent) {
    response.status(404).json({ error: "Payment intent not found." });
    return;
  }
  response.json(intent);
});

app.post("/api/api-keys", (request, response) => {
  if (countActiveApiKeys() > 0 && !authenticateRequest(request)) {
    response.status(401).json({ error: "A valid ArcFlow API key is required." });
    return;
  }

  const body = request.body as { name?: string };
  const apiKey = createApiKey(String(body.name || "Default key"));
  response.status(201).json(apiKey);
});

app.delete("/api/api-keys/:id", requireApiKey, (request, response) => {
  const revoked = revokeApiKey(routeParam(request, "id"));
  if (!revoked) {
    response.status(404).json({ error: "API key not found." });
    return;
  }
  response.json(revoked);
});

app.post("/api/payment-intents", requireApiKey, (request, response) => {
  const body = request.body as CreateIntentInput;

  try {
    if (!body.description?.trim()) throw new Error("Description is required.");
    if (!validateIntentAddress(body.receiver)) throw new Error("Receiver must be a valid Arc EVM address.");

    const intent = createPaymentIntent({
      amount: parseUsdc(body.amount),
      receiver: body.receiver,
      description: body.description.trim(),
      template: body.template || "payment-link",
      metadata: body.metadata || {}
    });

    response.status(201).json(intent);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid payment intent." });
  }
});

app.post("/api/payment-intents/:id/confirm", requireApiKey, async (request, response) => {
  const intent = getPaymentIntent(routeParam(request, "id"));
  if (!intent) {
    response.status(404).json({ error: "Payment intent not found." });
    return;
  }
  if (intent.status === "paid") {
    response.status(409).json({ error: "Payment intent is already paid." });
    return;
  }

  const body = request.body as ConfirmPaymentInput;
  if (!body.txHash?.startsWith("0x")) {
    response.status(400).json({ error: "A transaction hash is required." });
    return;
  }
  if (getReceiptByTxHash(body.txHash) || getIntentByTxHash(body.txHash)) {
    response.status(409).json({ error: "Transaction hash has already been used for an ArcFlow payment." });
    return;
  }

  try {
    const verified = await verifyArcUsdcTransfer(intent, body.txHash);
    const receipt = createReceipt({
      paymentIntentId: intent.id,
      amount: intent.amount,
      receiver: intent.receiver,
      payer: verified.payer,
      txHash: verified.txHash,
      metadata: intent.metadata
    });
    markIntentPaid(intent.id, verified.txHash, receipt.id);
    const paidIntent = getPaymentIntent(intent.id) || intent;
    await deliverWebhooks({
      type: "payment_intent.paid",
      data: {
        paymentIntentId: intent.id,
        amount: intent.amount,
        txHash: verified.txHash,
        receiptUrl: receipt.receiptUrl,
        ...intent.metadata
      }
    });
    response.json({ intent: paidIntent, receipt });
  } catch (error) {
    addLog({
      level: "error",
      type: "payment_intent.verify_failed",
      message: error instanceof Error ? error.message : "Payment verification failed.",
      paymentIntentId: intent.id
    });
    response.status(400).json({ error: error instanceof Error ? error.message : "Payment verification failed." });
  }
});

app.post("/api/payment-intents/:id/demo-settle", requireApiKey, async (request, response) => {
  const intent = getPaymentIntent(routeParam(request, "id"));
  if (!intent) {
    response.status(404).json({ error: "Payment intent not found." });
    return;
  }
  if (intent.status === "paid") {
    response.status(409).json({ error: "Payment intent is already paid." });
    return;
  }

  const receipt = createReceipt({
    paymentIntentId: intent.id,
    amount: intent.amount,
    receiver: intent.receiver,
    payer: "0x1111111111111111111111111111111111111111",
    txHash: `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` as `0x${string}`,
    metadata: intent.metadata
  });
  markIntentPaid(intent.id, receipt.txHash, receipt.id);
  const paidIntent = getPaymentIntent(intent.id) || intent;
  addLog({
    level: "success",
    type: "payment_intent.demo_settled",
    message: "Demo settlement completed without submitting an onchain transaction.",
    paymentIntentId: intent.id,
    receiptId: receipt.id
  });
  await deliverWebhooks({
    type: "payment_intent.paid",
      data: {
        paymentIntentId: intent.id,
        amount: intent.amount,
        txHash: receipt.txHash,
        receiptUrl: receipt.receiptUrl,
        ...intent.metadata
      }
  });
  response.json({ intent: paidIntent, receipt });
});

app.post("/api/webhooks", requireApiKey, (request, response) => {
  try {
    const input = parseWebhookInput(request.body, false);
    const webhook = addWebhook(input);
    response.status(201).json(webhook);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook endpoint." });
  }
});

app.patch("/api/webhooks/:id", requireApiKey, (request, response) => {
  try {
    const input = parseWebhookInput(request.body, true);
    const webhook = updateWebhook(routeParam(request, "id"), input);
    if (!webhook) {
      response.status(404).json({ error: "Webhook endpoint not found." });
      return;
    }
    response.json(webhook);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook endpoint." });
  }
});

app.delete("/api/webhooks/:id", requireApiKey, (request, response) => {
  const deleted = deleteWebhook(routeParam(request, "id"));
  if (!deleted) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  response.status(204).send();
});

app.post("/api/webhooks/:id/rotate-secret", requireApiKey, (request, response) => {
  const webhook = rotateWebhookSecret(routeParam(request, "id"));
  if (!webhook) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  response.json(webhook);
});

app.post("/api/webhooks/:id/test", requireApiKey, async (request, response) => {
  let webhook = getWebhook(routeParam(request, "id"));
  if (!webhook) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  if (webhook.url === DEMO_MERCHANT_WEBHOOK_URL) {
    webhook = ensureDemoMerchantWebhook();
  }

  await deliverWebhooks(
    {
      type: "payment_intent.paid",
      data: {
        paymentIntentId: "pi_test",
        amount: "10000000",
        txHash: `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
        receiptUrl: "/receipts/rcpt_test",
        customerId: "cus_demo",
        productId: "api_basic",
        test: true
      }
    },
    [{ ...webhook, enabled: true, events: ["payment_intent.paid"] }]
  );
  response.json(getState());
});

app.post("/api/webhook-deliveries/:id/retry", requireApiKey, async (request, response) => {
  const delivery = getWebhookDelivery(routeParam(request, "id"));
  if (!delivery) {
    response.status(404).json({ error: "Webhook delivery not found." });
    return;
  }
  if (!delivery.webhookId) {
    response.status(400).json({ error: "Skipped delivery has no endpoint to retry." });
    return;
  }

  let webhook = getWebhook(delivery.webhookId);
  if (!webhook) {
    response.status(404).json({ error: "Original webhook endpoint no longer exists." });
    return;
  }
  if (delivery.endpointUrl === DEMO_MERCHANT_WEBHOOK_URL) {
    webhook = ensureDemoMerchantWebhook();
  }

  await deliverWebhooks(
    {
      type: delivery.eventType,
      data: (delivery.payload?.data as Record<string, unknown> | undefined) || { retry: true }
    },
    [{ ...webhook, enabled: true, events: [delivery.eventType] }],
    delivery.attempt + 1
  );
  response.json(getState());
});

app.post("/api/demo/seed", (request, response) => {
  const intent = seedDemoIntent();
  response.status(201).json(intent);
});

app.post("/api/demo/reset", (request, response) => {
  resetDemoData();
  response.json(getState());
});

initStore().then(() => {
  app.listen(port, "127.0.0.1", () => {
    console.log(`ArcFlow API listening on http://127.0.0.1:${port}`);
  });
});

function parseWebhookInput(body: unknown, partial: false): { url: string; events: string[]; enabled: boolean };
function parseWebhookInput(body: unknown, partial: true): { url?: string; events?: string[]; enabled?: boolean };
function parseWebhookInput(body: unknown, partial: boolean) {
  const input = body as { url?: unknown; events?: unknown; enabled?: unknown };
  const result: { url?: string; events?: string[]; enabled?: boolean } = {};

  if (!partial || input.url !== undefined) {
    const url = String(input.url || "").trim();
    if (!url) throw new Error("Webhook URL is required.");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Webhook URL must be a valid URL.");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Webhook URL must start with http:// or https://.");
    }
    result.url = url;
  }

  if (!partial || input.events !== undefined) {
    const events = Array.isArray(input.events) ? input.events.map(String) : ["payment_intent.paid"];
    const allowedEvents = new Set(["payment_intent.paid", "receipt.issued"]);
    const cleanEvents = events.filter((event) => allowedEvents.has(event));
    if (cleanEvents.length === 0) throw new Error("Choose at least one supported webhook event.");
    result.events = cleanEvents;
  }

  if (!partial || input.enabled !== undefined) {
    result.enabled = Boolean(input.enabled);
  }

  return result;
}

function requireApiKey(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (authenticateRequest(request)) {
    next();
    return;
  }
  response.status(401).json({ error: "A valid ArcFlow API key is required." });
}

function authenticateRequest(request: express.Request) {
  const header = request.headers["x-arcflow-api-key"];
  const key = Array.isArray(header) ? header[0] : header;
  return verifyApiKey(key);
}

function routeParam(request: express.Request, key: string) {
  const value = request.params[key];
  return Array.isArray(value) ? value[0] : value;
}
