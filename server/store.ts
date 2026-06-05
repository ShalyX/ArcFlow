import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import type { DashboardState, EventLog, PaymentIntent, Receipt, WebhookDelivery, WebhookEndpoint } from "../src/shared/types";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
const dataDir = path.resolve("data");
const dbPath = process.env.ARCFLOW_DB_PATH ? path.resolve(process.env.ARCFLOW_DB_PATH) : path.join(dataDir, "arcflow.sqlite");

let db: Database;

type Row = Record<string, unknown>;

export async function initStore() {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  migrate();
  seedDefaultWebhook();
  persist();
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      amount TEXT NOT NULL,
      receiver TEXT NOT NULL,
      status TEXT NOT NULL,
      checkout_url TEXT NOT NULL,
      description TEXT NOT NULL,
      template TEXT NOT NULL,
      metadata TEXT NOT NULL,
      tx_hash TEXT,
      receipt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      payment_intent_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      receiver TEXT NOT NULL,
      payer TEXT,
      tx_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      receipt_url TEXT NOT NULL,
      metadata TEXT NOT NULL,
      issued_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_tx_hash ON receipts (tx_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_tx_hash ON payment_intents (tx_hash) WHERE tx_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT,
      event_type TEXT NOT NULL,
      endpoint_url TEXT,
      status TEXT NOT NULL,
      http_status INTEGER,
      attempt INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payment_intent_id TEXT,
      receipt_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function seedDefaultWebhook() {
  const count = db.exec("SELECT COUNT(*) AS count FROM webhooks")[0]?.values[0]?.[0] as number | undefined;
  if (count && count > 0) return;
  addWebhook(
    {
      url: "https://example.com/arcflow/webhook",
      events: ["payment_intent.paid", "receipt.issued"],
      enabled: false
    },
    false
  );
}

function persist() {
  writeFileSync(dbPath, Buffer.from(db.export()));
}

function all<T>(sql: string, params: SqlValue[] = [], map: (row: Row) => T): T[] {
  const statement = db.prepare(sql, params);
  const rows: T[] = [];
  while (statement.step()) rows.push(map(statement.getAsObject()));
  statement.free();
  return rows;
}

function getOne<T>(sql: string, params: SqlValue[] = [], map: (row: Row) => T): T | undefined {
  return all(sql, params, map)[0];
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const asText = (value: unknown) => String(value ?? "");
const asOptionalText = (value: unknown) => (value ? String(value) : undefined);

function mapIntent(row: Row): PaymentIntent {
  return {
    id: asText(row.id),
    amount: asText(row.amount),
    receiver: asText(row.receiver) as `0x${string}`,
    status: asText(row.status) as PaymentIntent["status"],
    checkoutUrl: asText(row.checkout_url),
    description: asText(row.description),
    template: asText(row.template) as PaymentIntent["template"],
    metadata: parseJson<Record<string, string>>(row.metadata, {}),
    txHash: asOptionalText(row.tx_hash) as `0x${string}` | undefined,
    receiptId: asOptionalText(row.receipt_id),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at)
  };
}

function mapReceipt(row: Row): Receipt {
  return {
    id: asText(row.id),
    paymentIntentId: asText(row.payment_intent_id),
    amount: asText(row.amount),
    receiver: asText(row.receiver) as `0x${string}`,
    payer: asOptionalText(row.payer) as `0x${string}` | undefined,
    txHash: asText(row.tx_hash) as `0x${string}`,
    status: "issued",
    receiptUrl: asText(row.receipt_url),
    metadata: parseJson<Record<string, string>>(row.metadata, {}),
    issuedAt: asText(row.issued_at)
  };
}

function mapWebhook(row: Row): WebhookEndpoint {
  return {
    id: asText(row.id),
    url: asText(row.url),
    events: parseJson<string[]>(row.events, []),
    enabled: Boolean(row.enabled),
    createdAt: asText(row.created_at)
  };
}

function mapDelivery(row: Row): WebhookDelivery {
  return {
    id: asText(row.id),
    webhookId: asOptionalText(row.webhook_id),
    eventType: asText(row.event_type),
    endpointUrl: asOptionalText(row.endpoint_url),
    status: asText(row.status) as WebhookDelivery["status"],
    httpStatus: row.http_status == null ? undefined : Number(row.http_status),
    attempt: Number(row.attempt),
    error: asOptionalText(row.error),
    createdAt: asText(row.created_at)
  };
}

function mapLog(row: Row): EventLog {
  return {
    id: asText(row.id),
    level: asText(row.level) as EventLog["level"],
    type: asText(row.type),
    message: asText(row.message),
    paymentIntentId: asOptionalText(row.payment_intent_id),
    receiptId: asOptionalText(row.receipt_id),
    createdAt: asText(row.created_at)
  };
}

export function getState(): DashboardState {
  return {
    paymentIntents: all("SELECT * FROM payment_intents ORDER BY created_at DESC", [], mapIntent),
    receipts: all("SELECT * FROM receipts ORDER BY issued_at DESC", [], mapReceipt),
    webhooks: all("SELECT * FROM webhooks ORDER BY created_at DESC", [], mapWebhook),
    webhookDeliveries: all("SELECT * FROM webhook_deliveries ORDER BY created_at DESC", [], mapDelivery),
    logs: all("SELECT * FROM event_logs ORDER BY created_at DESC", [], mapLog)
  };
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
  db.run(
    `INSERT INTO payment_intents
      (id, amount, receiver, status, checkout_url, description, template, metadata, tx_hash, receipt_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentIntent.id,
      paymentIntent.amount,
      paymentIntent.receiver,
      paymentIntent.status,
      paymentIntent.checkoutUrl,
      paymentIntent.description,
      paymentIntent.template,
      JSON.stringify(paymentIntent.metadata),
      paymentIntent.txHash || null,
      paymentIntent.receiptId || null,
      paymentIntent.createdAt,
      paymentIntent.updatedAt
    ]
  );
  addLog(
    {
      level: "info",
      type: "payment_intent.created",
      message: `Created ${paymentIntent.description} for ${paymentIntent.amount} raw USDC.`,
      paymentIntentId: paymentIntent.id
    },
    false
  );
  persist();
  return paymentIntent;
}

export function getPaymentIntent(paymentIntentId: string) {
  return getOne("SELECT * FROM payment_intents WHERE id = ?", [paymentIntentId], mapIntent);
}

export function getIntentByTxHash(txHash: `0x${string}`) {
  return getOne("SELECT * FROM payment_intents WHERE lower(tx_hash) = lower(?)", [txHash], mapIntent);
}

export function getReceiptByTxHash(txHash: `0x${string}`) {
  return getOne("SELECT * FROM receipts WHERE lower(tx_hash) = lower(?)", [txHash], mapReceipt);
}

export function markIntentPaid(paymentIntentId: string, txHash: `0x${string}`, receiptId: string) {
  db.run("UPDATE payment_intents SET status = ?, tx_hash = ?, receipt_id = ?, updated_at = ? WHERE id = ?", [
    "paid",
    txHash,
    receiptId,
    now(),
    paymentIntentId
  ]);
  persist();
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
  db.run(
    `INSERT INTO receipts
      (id, payment_intent_id, amount, receiver, payer, tx_hash, status, receipt_url, metadata, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      receipt.id,
      receipt.paymentIntentId,
      receipt.amount,
      receipt.receiver,
      receipt.payer || null,
      receipt.txHash,
      receipt.status,
      receipt.receiptUrl,
      JSON.stringify(receipt.metadata),
      receipt.issuedAt
    ]
  );
  addLog(
    {
      level: "success",
      type: "receipt.issued",
      message: `Issued receipt for payment intent ${receipt.paymentIntentId}.`,
      paymentIntentId: receipt.paymentIntentId,
      receiptId: receipt.id
    },
    false
  );
  persist();
  return receipt;
}

export function addWebhook(input: Pick<WebhookEndpoint, "url" | "events" | "enabled">, shouldPersist = true) {
  const webhook: WebhookEndpoint = {
    ...input,
    id: id("wh"),
    createdAt: now()
  };
  db.run("INSERT INTO webhooks (id, url, events, enabled, created_at) VALUES (?, ?, ?, ?, ?)", [
    webhook.id,
    webhook.url,
    JSON.stringify(webhook.events),
    webhook.enabled ? 1 : 0,
    webhook.createdAt
  ]);
  addLog(
    {
      level: "info",
      type: "webhook.created",
      message: `Registered webhook endpoint ${webhook.url}.`
    },
    false
  );
  if (shouldPersist) persist();
  return webhook;
}

export function addWebhookDelivery(input: Omit<WebhookDelivery, "id" | "createdAt">) {
  const delivery: WebhookDelivery = {
    ...input,
    id: id("wd"),
    createdAt: now()
  };
  db.run(
    `INSERT INTO webhook_deliveries
      (id, webhook_id, event_type, endpoint_url, status, http_status, attempt, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      delivery.id,
      delivery.webhookId || null,
      delivery.eventType,
      delivery.endpointUrl || null,
      delivery.status,
      delivery.httpStatus || null,
      delivery.attempt,
      delivery.error || null,
      delivery.createdAt
    ]
  );
  persist();
  return delivery;
}

export function addLog(input: Omit<EventLog, "id" | "createdAt">, shouldPersist = true) {
  const log: EventLog = {
    ...input,
    id: id("log"),
    createdAt: now()
  };
  db.run(
    "INSERT INTO event_logs (id, level, type, message, payment_intent_id, receipt_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [log.id, log.level, log.type, log.message, log.paymentIntentId || null, log.receiptId || null, log.createdAt]
  );
  if (shouldPersist) persist();
  return log;
}

export function resetDemoData() {
  db.run("DELETE FROM payment_intents; DELETE FROM receipts; DELETE FROM webhook_deliveries; DELETE FROM event_logs;");
  addLog(
    {
      level: "warning",
      type: "demo.reset",
      message: "Demo data was reset. Webhook endpoint configuration was preserved."
    },
    false
  );
  persist();
}

export function seedDemoIntent() {
  ensureDemoMerchantWebhook();
  return createPaymentIntent({
    amount: "10000000",
    receiver: "0x0000000000000000000000000000000000000001",
    description: "Demo API access unlock",
    template: "access-unlock",
    metadata: {
      customerId: "cus_demo",
      productId: "api_basic",
      flow: "access-unlock"
    }
  });
}

export function ensureDemoMerchantWebhook() {
  const existing = getOne("SELECT * FROM webhooks WHERE url = ?", ["http://127.0.0.1:9090/webhooks/arcflow"], mapWebhook);
  if (existing) {
    db.run("UPDATE webhooks SET enabled = ?, events = ? WHERE id = ?", [
      1,
      JSON.stringify(["payment_intent.paid", "receipt.issued"]),
      existing.id
    ]);
    persist();
    return { ...existing, enabled: true, events: ["payment_intent.paid", "receipt.issued"] };
  }

  return addWebhook({
    url: "http://127.0.0.1:9090/webhooks/arcflow",
    events: ["payment_intent.paid", "receipt.issued"],
    enabled: true
  });
}
