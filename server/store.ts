import { randomUUID } from "node:crypto";
import type { DashboardState, EventLog, PaymentIntent, Receipt, WebhookEndpoint } from "../src/shared/types";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;

const state: DashboardState = {
  paymentIntents: [],
  receipts: [],
  webhooks: [
    {
      id: id("wh"),
      url: "https://example.com/arcflow/webhook",
      events: ["payment_intent.paid", "receipt.issued"],
      enabled: false,
      createdAt: now()
    }
  ],
  logs: []
};

export function getState() {
  return state;
}

export function createPaymentIntent(input: Omit<PaymentIntent, "id" | "status" | "checkoutUrl" | "createdAt" | "updatedAt">) {
  const createdAt = now();
  const paymentIntent: PaymentIntent = {
    ...input,
    id: id("pi"),
    status: "pending",
    checkoutUrl: "",
    createdAt,
    updatedAt: createdAt
  };
  paymentIntent.checkoutUrl = `/pay/${paymentIntent.id}`;
  state.paymentIntents.unshift(paymentIntent);
  addLog({
    level: "info",
    type: "payment_intent.created",
    message: `Created ${paymentIntent.description} for ${paymentIntent.amount} raw USDC.`,
    paymentIntentId: paymentIntent.id
  });
  return paymentIntent;
}

export function getPaymentIntent(paymentIntentId: string) {
  return state.paymentIntents.find((intent) => intent.id === paymentIntentId);
}

export function markIntentPaid(paymentIntentId: string, txHash: `0x${string}`, receiptId: string) {
  const intent = getPaymentIntent(paymentIntentId);
  if (!intent) return;
  intent.status = "paid";
  intent.txHash = txHash;
  intent.receiptId = receiptId;
  intent.updatedAt = now();
}

export function createReceipt(input: Omit<Receipt, "id" | "status" | "receiptUrl" | "issuedAt">) {
  const receipt: Receipt = {
    ...input,
    id: id("rcpt"),
    status: "issued",
    receiptUrl: "",
    issuedAt: now()
  };
  receipt.receiptUrl = `/receipts/${receipt.id}`;
  state.receipts.unshift(receipt);
  addLog({
    level: "success",
    type: "receipt.issued",
    message: `Issued receipt for payment intent ${receipt.paymentIntentId}.`,
    paymentIntentId: receipt.paymentIntentId,
    receiptId: receipt.id
  });
  return receipt;
}

export function addWebhook(input: Pick<WebhookEndpoint, "url" | "events" | "enabled">) {
  const webhook: WebhookEndpoint = {
    ...input,
    id: id("wh"),
    createdAt: now()
  };
  state.webhooks.unshift(webhook);
  addLog({
    level: "info",
    type: "webhook.created",
    message: `Registered webhook endpoint ${webhook.url}.`
  });
  return webhook;
}

export function addLog(input: Omit<EventLog, "id" | "createdAt">) {
  const log: EventLog = {
    ...input,
    id: id("log"),
    createdAt: now()
  };
  state.logs.unshift(log);
  return log;
}
