import cors from "cors";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import express from "express";
import { ARC_TESTNET, parseUsdc } from "../src/shared/arc";
import type { ConfirmPaymentInput, CreateIntentInput, CreateIntentSplitRecipient, CreateSplitInput, Split, SplitAllocation, SplitPlan, SplitReceiver } from "../src/shared/types";
import { validateIntentAddress, verifyArcExecutableSplit, verifyArcUsdcTransfer } from "./arcVerifier";
import {
  addLog,
  addWebhook,
  countActiveApiKeys,
  createApiKey,
  createPaymentIntent,
  createProject,
  createReceipt,
  createSplit,
  DEFAULT_PROJECT_ID,
  DEMO_MERCHANT_WEBHOOK_URL,
  deleteWebhook,
  ensureDemoMerchantWebhook,
  getWebhook,
  getWebhookDelivery,
  getPaymentIntent,
  getReceipt,
  getSplit,
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

app.get("/api/state", (request, response) => {
  const existingKey = authenticateRequest(request);
  if (countActiveApiKeys() > 0 && !existingKey) {
    response.status(401).json({ error: "A valid ArcFlow API key is required." });
    return;
  }
  response.json(getState(existingKey?.projectId || DEFAULT_PROJECT_ID));
});

app.get("/api/payment-intents/:id", (request, response) => {
  const intent = getPaymentIntent(routeParam(request, "id"));
  if (!intent) {
    response.status(404).json({ error: "Payment intent not found." });
    return;
  }
  response.json(intent);
});

app.get("/api/receipts/:id", (request, response) => {
  const receipt = getReceipt(routeParam(request, "id"));
  if (!receipt) {
    response.status(404).json({ error: "Receipt not found." });
    return;
  }
  response.json(receipt);
});

app.post("/api/api-keys", (request, response) => {
  const existingKey = authenticateRequest(request);
  if (countActiveApiKeys() > 0 && !existingKey) {
    response.status(401).json({ error: "A valid ArcFlow API key is required." });
    return;
  }

  const body = request.body as { name?: string };
  const apiKey = createApiKey(String(body.name || "Default key"), existingKey?.projectId || DEFAULT_PROJECT_ID);
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

app.post("/api/projects", (request, response) => {
  const existingKey = authenticateRequest(request);
  if (countActiveApiKeys() > 0 && !existingKey) {
    response.status(401).json({ error: "A valid ArcFlow API key is required." });
    return;
  }

  const body = request.body as { name?: string };
  const project = createProject(String(body.name || "Untitled project"));
  ensureDemoMerchantWebhook(project.id);
  const apiKey = createApiKey(`${project.name} console key`, project.id);
  response.status(201).json({ project, apiKey });
});

app.post("/api/payment-intents", requireApiKey, (request, response) => {
  const body = request.body as CreateIntentInput;
  const projectId = currentProjectId(request, response);

  try {
    if (!body.description?.trim()) throw new Error("Description is required.");
    const amount = parseUsdc(body.amount);
    const receiver = resolveIntentReceiver(body);
    if (!validateIntentAddress(receiver)) throw new Error("Receiver must be a valid Arc EVM address.");
    const splitPlanReceiver = body.template === "revenue_split_executable"
      ? body.settlementReceiver || body.receiver || receiver
      : receiver;
    const metadata = resolveIntentMetadata(body.metadata, projectId, splitPlanReceiver, amount, body.split);

    const intent = createPaymentIntent({
      projectId,
      amount,
      receiver,
      description: body.description.trim(),
      template: body.template || "payment-link",
      metadata
    });

    response.status(201).json(intent);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid payment intent." });
  }
});

app.post("/api/payment-intents/:id/confirm", async (request, response) => {
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
    const splitPlan = parseSplitPlan(intent.metadata);
    const executableSplit = intent.template === "revenue_split_executable";
    if (executableSplit && !splitPlan) {
      throw new Error("Executable revenue split intents require a split plan.");
    }
    const verified = executableSplit
      ? await verifyArcExecutableSplit(intent, body.txHash, splitPlan!)
      : await verifyArcUsdcTransfer(intent, body.txHash);
    const receiptMetadata = executableSplit
      ? { ...intent.metadata, splitStatus: "executed", settlementContract: verified.receiver }
      : intent.metadata;
    const receipt = createReceipt({
      paymentIntentId: intent.id,
      projectId: intent.projectId,
      amount: intent.amount,
      receiver: intent.receiver,
      payer: verified.payer,
      txHash: verified.txHash,
      metadata: receiptMetadata
    });
    markIntentPaid(intent.id, verified.txHash, receipt.id);
    recordSplitInstruction(intent.id, intent.projectId, receipt.id, splitPlan, executableSplit);
    const paidIntent = getPaymentIntent(intent.id) || intent;
    await deliverWebhooks({
      type: "payment_intent.paid",
      data: {
        paymentIntentId: intent.id,
        amount: intent.amount,
        txHash: verified.txHash,
        receiptUrl: receipt.receiptUrl,
        ...(splitPlan ? { split: splitPlan } : {}),
        ...intent.metadata,
        ...(executableSplit ? { splitStatus: "executed", settlementContract: verified.receiver } : {})
      }
    }, intent.projectId);
    response.json({ intent: paidIntent, receipt });
  } catch (error) {
    addLog({
      level: "error",
      projectId: intent.projectId,
      type: "payment_intent.verify_failed",
      message: error instanceof Error ? error.message : "Payment verification failed.",
      paymentIntentId: intent.id
    });
    response.status(400).json({ error: error instanceof Error ? error.message : "Payment verification failed." });
  }
});

app.post("/api/payment-intents/:id/demo-settle", async (request, response) => {
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
    projectId: intent.projectId,
    paymentIntentId: intent.id,
    amount: intent.amount,
    receiver: intent.receiver,
    payer: "0x1111111111111111111111111111111111111111",
    txHash: `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` as `0x${string}`,
    metadata: intent.metadata
  });
  markIntentPaid(intent.id, receipt.txHash, receipt.id);
  const splitPlan = parseSplitPlan(intent.metadata);
  recordSplitInstruction(intent.id, intent.projectId, receipt.id, splitPlan);
  const paidIntent = getPaymentIntent(intent.id) || intent;
  addLog({
    level: "success",
    projectId: intent.projectId,
    type: "payment_intent.demo_settled",
    message: "Demo settlement completed without submitting an onchain transaction.",
    paymentIntentId: intent.id,
    receiptId: receipt.id
  });
  await deliverWebhooks({
    type: "payment_intent.paid",
      data: {
        paymentIntentId: intent.id,
        projectId: intent.projectId,
        amount: intent.amount,
        txHash: receipt.txHash,
        receiptUrl: receipt.receiptUrl,
        ...(splitPlan ? { split: splitPlan } : {}),
        ...intent.metadata
      }
  }, intent.projectId);
  response.json({ intent: paidIntent, receipt });
});

app.post("/api/webhooks", requireApiKey, (request, response) => {
  try {
    const input = parseWebhookInput(request.body, false);
    const webhook = addWebhook({ ...input, projectId: currentProjectId(request, response) });
    response.status(201).json(webhook);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook endpoint." });
  }
});

app.post("/api/splits", requireApiKey, (request, response) => {
  try {
    const body = request.body as CreateSplitInput;
    if (!body.name?.trim()) throw new Error("Split name is required.");
    if (!validateIntentAddress(body.settlementReceiver)) throw new Error("Collection wallet must be a valid EVM address.");
    if (!Array.isArray(body.receivers) || body.receivers.length === 0) throw new Error("Add at least one split receiver.");
    for (const receiver of body.receivers) {
      if (!validateIntentAddress(receiver.address)) throw new Error("Each split receiver must be a valid EVM address.");
      if (!Number.isFinite(receiver.shareBps) || receiver.shareBps <= 0) throw new Error("Each split receiver share must be positive.");
    }
    const split = createSplit({
      ...body,
      projectId: currentProjectId(request, response)
    });
    response.status(201).json(split);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid split." });
  }
});

app.patch("/api/webhooks/:id", requireApiKey, (request, response) => {
  try {
    const existing = getWebhook(routeParam(request, "id"));
    if (!existing || existing.projectId !== currentProjectId(request, response)) {
      response.status(404).json({ error: "Webhook endpoint not found." });
      return;
    }
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
  const existing = getWebhook(routeParam(request, "id"));
  if (!existing || existing.projectId !== currentProjectId(request, response)) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  const deleted = deleteWebhook(routeParam(request, "id"));
  if (!deleted) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  response.status(204).send();
});

app.post("/api/webhooks/:id/rotate-secret", requireApiKey, (request, response) => {
  const existing = getWebhook(routeParam(request, "id"));
  if (!existing || existing.projectId !== currentProjectId(request, response)) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  const webhook = rotateWebhookSecret(routeParam(request, "id"));
  response.json(webhook);
});

app.post("/api/webhooks/:id/test", requireApiKey, async (request, response) => {
  let webhook = getWebhook(routeParam(request, "id"));
  if (!webhook || webhook.projectId !== currentProjectId(request, response)) {
    response.status(404).json({ error: "Webhook endpoint not found." });
    return;
  }
  if (webhook.url === DEMO_MERCHANT_WEBHOOK_URL) {
    webhook = ensureDemoMerchantWebhook(webhook.projectId);
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
    webhook.projectId,
    [{ ...webhook, enabled: true, events: ["payment_intent.paid"] }]
  );
  response.json(getState(webhook.projectId));
});

app.post("/api/webhook-deliveries/:id/retry", requireApiKey, async (request, response) => {
  const delivery = getWebhookDelivery(routeParam(request, "id"));
  if (!delivery || delivery.projectId !== currentProjectId(request, response)) {
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
    webhook = ensureDemoMerchantWebhook(webhook.projectId);
  }

  await deliverWebhooks(
    {
      type: delivery.eventType,
      data: (delivery.payload?.data as Record<string, unknown> | undefined) || { retry: true }
    },
    webhook.projectId,
    [{ ...webhook, enabled: true, events: [delivery.eventType] }],
    delivery.attempt + 1
  );
  response.json(getState(webhook.projectId));
});

app.post("/api/demo/seed", (request, response) => {
  const intent = seedDemoIntent(currentProjectId(request, response));
  response.status(201).json(intent);
});

app.post("/api/demo/reset", (request, response) => {
  const projectId = currentProjectId(request, response);
  resetDemoData(projectId);
  response.json(getState(projectId));
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

function resolveIntentReceiver(body: CreateIntentInput) {
  if (body.template === "revenue_split_executable") {
    const splitterAddress = configuredSplitterAddress();
    if (!validateIntentAddress(splitterAddress)) {
      throw new Error("Configure ARCFLOW_SPLITTER_ADDRESS before creating executable revenue split intents.");
    }
    return splitterAddress;
  }

  const receiver = body.receiver || body.settlementReceiver;
  if (!receiver) throw new Error("Receiver is required.");
  return receiver;
}

function configuredSplitterAddress() {
  return (process.env.ARCFLOW_SPLITTER_ADDRESS || ARC_TESTNET.splitterAddress) as `0x${string}`;
}

function resolveIntentMetadata(
  metadata: Record<string, string> | undefined,
  projectId: string,
  receiver: `0x${string}`,
  amount: string,
  inlineSplit?: CreateIntentSplitRecipient[]
) {
  const baseMetadata = metadata || {};
  const splitPlan = inlineSplit !== undefined
    ? buildInlineSplitPlan(baseMetadata, inlineSplit, receiver, amount)
    : resolveSplitPlan(baseMetadata, projectId, receiver, amount);
  if (!splitPlan) return baseMetadata;
  return {
    ...baseMetadata,
    splitId: splitPlan.splitId,
    settlementReceiver: splitPlan.settlementReceiver,
    splitPlan: JSON.stringify(splitPlan)
  };
}

function buildInlineSplitPlan(
  metadata: Record<string, string>,
  recipients: CreateIntentSplitRecipient[],
  settlementReceiver: `0x${string}`,
  amount: string
) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("Add at least one split recipient.");
  }
  if (!validateIntentAddress(settlementReceiver)) {
    throw new Error("Settlement receiver must be a valid EVM address.");
  }

  const receivers = recipients.map((recipient): SplitReceiver => {
    if (!validateIntentAddress(recipient.recipient)) {
      throw new Error("Each split recipient must be a valid EVM address.");
    }
    if (!Number.isFinite(recipient.percentage) || recipient.percentage <= 0) {
      throw new Error("Each split percentage must be positive.");
    }
    const rawShareBps = recipient.percentage * 100;
    const shareBps = Math.round(rawShareBps);
    if (Math.abs(rawShareBps - shareBps) > 1e-9) {
      throw new Error("Split percentages support up to two decimal places.");
    }
    return {
      label: recipient.label?.trim() || undefined,
      address: recipient.recipient,
      shareBps
    };
  });

  const totalBps = receivers.reduce((sum, recipient) => sum + recipient.shareBps, 0);
  if (totalBps !== 10000) {
    throw new Error("Split percentages must equal 100%.");
  }

  return buildSplitPlan({
    id: metadata.splitId || "inline_revenue_split",
    projectId: "",
    name: metadata.splitName || "Revenue Split Plan",
    settlementReceiver,
    receivers,
    createdAt: new Date().toISOString()
  }, amount);
}

function resolveSplitPlan(metadata: Record<string, string>, projectId: string, receiver: `0x${string}`, amount: string) {
  const splitId = metadata?.splitId;
  if (!splitId) return undefined;
  const split = getSplit(splitId);
  if (!split || split.projectId !== projectId) {
    throw new Error("Split not found for this project.");
  }
  if (metadata?.settlementReceiver && metadata.settlementReceiver.toLowerCase() !== split.settlementReceiver.toLowerCase()) {
    throw new Error("Split settlement receiver does not match the split configuration.");
  }
  if (receiver.toLowerCase() !== split.settlementReceiver.toLowerCase()) {
    throw new Error("Split payment receiver must be the split settlement receiver.");
  }
  return buildSplitPlan(split, amount);
}

function buildSplitPlan(split: Split, totalAmount: string): SplitPlan {
  const total = BigInt(totalAmount);
  let allocated = 0n;
  const allocations: SplitAllocation[] = split.receivers.map((receiver, index) => {
    const isLast = index === split.receivers.length - 1;
    const amount = isLast ? total - allocated : (total * BigInt(receiver.shareBps)) / 10000n;
    allocated += amount;
    return { ...receiver, amount: amount.toString() };
  });

  return {
    splitId: split.id,
    name: split.name,
    settlementReceiver: split.settlementReceiver,
    totalAmount,
    allocations
  };
}

function parseSplitPlan(metadata: Record<string, string>) {
  if (!metadata.splitPlan) return undefined;
  try {
    return JSON.parse(metadata.splitPlan) as SplitPlan;
  } catch {
    return undefined;
  }
}

function recordSplitInstruction(paymentIntentId: string, projectId: string, receiptId: string, splitPlan: SplitPlan | undefined, executed = false) {
  if (!splitPlan) return;
  const breakdown = splitPlan.allocations
    .map((allocation) => `${allocation.shareBps / 100}% to ${allocation.label || allocation.address}`)
    .join(", ");
  addLog({
    projectId,
    level: executed ? "success" : "info",
    type: executed ? "split.executed" : "split.recorded",
    message: `${executed ? "Executed onchain split" : "Recorded split plan"} for ${splitPlan.name}: ${breakdown}.`,
    paymentIntentId,
    receiptId
  });
}

function requireApiKey(request: express.Request, response: express.Response, next: express.NextFunction) {
  const apiKey = authenticateRequest(request);
  if (apiKey) {
    response.locals.apiKey = apiKey;
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

function currentProjectId(request: express.Request, response: express.Response) {
  const localKey = response.locals.apiKey as ReturnType<typeof verifyApiKey> | undefined;
  return localKey?.projectId || authenticateRequest(request)?.projectId || DEFAULT_PROJECT_ID;
}

function routeParam(request: express.Request, key: string) {
  const value = request.params[key];
  return Array.isArray(value) ? value[0] : value;
}
