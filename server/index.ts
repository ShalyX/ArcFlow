import cors from "cors";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import express from "express";
import { parseUsdc } from "../src/shared/arc";
import type { ConfirmPaymentInput, CreateIntentInput } from "../src/shared/types";
import { validateIntentAddress, verifyArcUsdcTransfer } from "./arcVerifier";
import { addLog, addWebhook, createPaymentIntent, createReceipt, getPaymentIntent, getState, markIntentPaid } from "./store";
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
    await deliverWebhooks({
      type: "payment_intent.paid",
      data: {
        paymentIntentId: intent.id,
        amount: intent.amount,
        txHash: verified.txHash,
        receiptUrl: receipt.receiptUrl
      }
    });
    response.json({ intent, receipt });
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
      receiptUrl: receipt.receiptUrl
    }
  });
  response.json({ intent, receipt });
});

app.post("/api/webhooks", (request, response) => {
  const webhook = addWebhook({
    url: String(request.body.url || ""),
    events: Array.isArray(request.body.events) ? request.body.events : ["payment_intent.paid"],
    enabled: Boolean(request.body.enabled)
  });
  response.status(201).json(webhook);
});

app.listen(port, "127.0.0.1", () => {
  console.log(`ArcFlow API listening on http://127.0.0.1:${port}`);
});
