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
  rotateWebhookSecret,
  seedDemoIntent,
  updateWebhook
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
  const intent = getPaymentIntent(request.params.id);
  if (!intent) {
    response.status(404).json({ error: "Payment intent not found." });
    return;
  }
  response.json(intent);
});

app.post("/api/payment-intents", (request, response) => {
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

app.post("/api/payment-intents/:id/confirm", async (request, response) => {
  const intent = getPaymentIntent(request.params.id);
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

app.post("/api/payment-intents/:id/demo-settle", async (request, response) => {
  const intent = getPaymentIntent(request.params.id);
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

app.post("/api/webhooks", (request, response) => {
  try {
    const input = parseWebhookInput(request.body, false);
    const webhook = addWebhook(input);
    response.status(201).json(webhook);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook endpoint." });
  }
});

app.patch("/api/webhooks/:id", (request, response) => {
  try {
    const input = parseWebhookInput(request.body, true);
    const webhook = updateWebhook(request.params.id, input);
    if (!webhook) {
      response.status(404).json({ error: "Webhook endpoint not found." });
      return;
    }
    response.json(webhook);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook endpoint." });
  }
});

app.delete("/api/webhooks/:id", (request, response) => {
  const deleted = deleteWebhook(request.params.id);
  if (!deleted) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  response.status(204).send();
});

app.post("/api/webhooks/:id/rotate-secret", (request, response) => {
  const webhook = rotateWebhookSecret(request.params.id);
  if (!webhook) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  response.json(webhook);
});

app.post("/api/webhooks/:id/test", async (request, response) => {
  let webhook = getWebhook(request.params.id);
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

app.post("/api/webhook-deliveries/:id/retry", async (request, response) => {
  const delivery = getWebhookDelivery(request.params.id);
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
