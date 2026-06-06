import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import type { ApiKey, CreateSplitInput, DashboardState, EventLog, PaymentIntent, Project, Receipt, Split, SplitReceiver, WebhookDelivery, WebhookEndpoint } from "../src/shared/types";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
const dataDir = path.resolve("data");
const dbPath = process.env.ARCFLOW_DB_PATH ? path.resolve(process.env.ARCFLOW_DB_PATH) : path.join(dataDir, "arcflow.sqlite");
export const DEMO_MERCHANT_WEBHOOK_URL = "http://127.0.0.1:9090/webhooks/arcflow";
export const DEFAULT_PROJECT_ID = "proj_default";

let db: Database;

type Row = Record<string, unknown>;

export async function initStore() {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  migrate();
  seedDefaultProject();
  backfillProjectIds();
  seedDefaultWebhook();
  ensureDemoMerchantWebhook();
  persist();
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
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

    CREATE TABLE IF NOT EXISTS splits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      settlement_receiver TEXT,
      receivers TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      project_id TEXT,
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
      project_id TEXT,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      signing_secret TEXT,
      last_rotated_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      webhook_id TEXT,
      event_type TEXT NOT NULL,
      endpoint_url TEXT,
      status TEXT NOT NULL,
      http_status INTEGER,
      attempt INTEGER NOT NULL,
      error TEXT,
      payload TEXT,
      response_body TEXT,
      signature_header TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      level TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payment_intent_id TEXT,
      receipt_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_preview TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
  addColumnIfMissing("payment_intents", "project_id", "TEXT");
  addColumnIfMissing("splits", "project_id", "TEXT");
  addColumnIfMissing("splits", "settlement_receiver", "TEXT");
  addColumnIfMissing("receipts", "project_id", "TEXT");
  addColumnIfMissing("webhooks", "project_id", "TEXT");
  addColumnIfMissing("webhook_deliveries", "project_id", "TEXT");
  addColumnIfMissing("event_logs", "project_id", "TEXT");
  addColumnIfMissing("api_keys", "project_id", "TEXT");
  addColumnIfMissing("webhook_deliveries", "payload", "TEXT");
  addColumnIfMissing("webhook_deliveries", "response_body", "TEXT");
  addColumnIfMissing("webhook_deliveries", "signature_header", "TEXT");
  addColumnIfMissing("webhooks", "signing_secret", "TEXT");
  addColumnIfMissing("webhooks", "last_rotated_at", "TEXT");
  backfillWebhookSecrets();
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.exec(`PRAGMA table_info(${table})`)[0]?.values.map((value) => String(value[1])) || [];
  if (!columns.includes(column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedDefaultProject() {
  const existing = getProject(DEFAULT_PROJECT_ID);
  if (existing) return existing;
  const project: Project = {
    id: DEFAULT_PROJECT_ID,
    name: "Demo Merchant",
    slug: "demo-merchant",
    createdAt: now()
  };
  db.run("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)", [
    project.id,
    project.name,
    project.slug,
    project.createdAt
  ]);
  return project;
}

function backfillProjectIds() {
  for (const table of ["payment_intents", "splits", "receipts", "webhooks", "webhook_deliveries", "event_logs", "api_keys"]) {
    db.run(`UPDATE ${table} SET project_id = ? WHERE project_id IS NULL OR project_id = ''`, [DEFAULT_PROJECT_ID]);
  }
  db.run("UPDATE splits SET settlement_receiver = ? WHERE settlement_receiver IS NULL OR settlement_receiver = ''", [
    "0x0000000000000000000000000000000000000001"
  ]);
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
    projectId: asText(row.project_id) || DEFAULT_PROJECT_ID,
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
    projectId: asText(row.project_id) || DEFAULT_PROJECT_ID,
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

function mapSplit(row: Row): Split {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id) || DEFAULT_PROJECT_ID,
    name: asText(row.name),
    settlementReceiver: (asText(row.settlement_receiver) || "0x0000000000000000000000000000000000000001") as `0x${string}`,
    receivers: parseJson<SplitReceiver[]>(row.receivers, []),
    createdAt: asText(row.created_at)
  };
}

function mapWebhook(row: Row): WebhookEndpoint {
  const createdAt = asText(row.created_at);
  return {
    id: asText(row.id),
    projectId: asText(row.project_id) || DEFAULT_PROJECT_ID,
    url: asText(row.url),
    events: parseJson<string[]>(row.events, []),
    enabled: Boolean(row.enabled),
    signingSecret: asText(row.signing_secret) || createWebhookSecret(),
    lastRotatedAt: asText(row.last_rotated_at) || createdAt,
    createdAt
  };
}

function mapDelivery(row: Row): WebhookDelivery {
  return {
    id: asText(row.id),
    projectId: asOptionalText(row.project_id),
    webhookId: asOptionalText(row.webhook_id),
    eventType: asText(row.event_type),
    endpointUrl: asOptionalText(row.endpoint_url),
    status: asText(row.status) as WebhookDelivery["status"],
    httpStatus: row.http_status == null ? undefined : Number(row.http_status),
    attempt: Number(row.attempt),
    error: asOptionalText(row.error),
    payload: parseJson<Record<string, unknown> | undefined>(row.payload, undefined),
    responseBody: asOptionalText(row.response_body),
    signatureHeader: asOptionalText(row.signature_header),
    createdAt: asText(row.created_at)
  };
}

function backfillWebhookSecrets() {
  const rows = all("SELECT * FROM webhooks WHERE signing_secret IS NULL OR signing_secret = ''", [], mapWebhook);
  for (const webhook of rows) {
    db.run("UPDATE webhooks SET signing_secret = ?, last_rotated_at = ? WHERE id = ?", [
      createWebhookSecret(),
      webhook.lastRotatedAt || now(),
      webhook.id
    ]);
  }
}

function mapLog(row: Row): EventLog {
  return {
    id: asText(row.id),
    projectId: asOptionalText(row.project_id),
    level: asText(row.level) as EventLog["level"],
    type: asText(row.type),
    message: asText(row.message),
    paymentIntentId: asOptionalText(row.payment_intent_id),
    receiptId: asOptionalText(row.receipt_id),
    createdAt: asText(row.created_at)
  };
}

function mapApiKey(row: Row): ApiKey {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id) || DEFAULT_PROJECT_ID,
    name: asText(row.name),
    keyPreview: asText(row.key_preview),
    enabled: Boolean(row.enabled),
    createdAt: asText(row.created_at),
    lastUsedAt: asOptionalText(row.last_used_at),
    revokedAt: asOptionalText(row.revoked_at)
  };
}

function mapProject(row: Row): Project {
  return {
    id: asText(row.id),
    name: asText(row.name),
    slug: asText(row.slug),
    createdAt: asText(row.created_at)
  };
}

export function getState(projectId = DEFAULT_PROJECT_ID): DashboardState {
  return {
    currentProjectId: projectId,
    projects: listProjects(),
    splits: all("SELECT * FROM splits WHERE project_id = ? ORDER BY created_at DESC", [projectId], mapSplit),
    paymentIntents: all("SELECT * FROM payment_intents WHERE project_id = ? ORDER BY created_at DESC", [projectId], mapIntent),
    receipts: all("SELECT * FROM receipts WHERE project_id = ? ORDER BY issued_at DESC", [projectId], mapReceipt),
    webhooks: all("SELECT * FROM webhooks WHERE project_id = ? ORDER BY created_at DESC", [projectId], mapWebhook),
    webhookDeliveries: all("SELECT * FROM webhook_deliveries WHERE project_id = ? ORDER BY created_at DESC", [projectId], mapDelivery),
    apiKeys: listApiKeys(projectId),
    logs: all("SELECT * FROM event_logs WHERE project_id = ? ORDER BY created_at DESC", [projectId], mapLog)
  };
}

export function listProjects() {
  return all("SELECT * FROM projects ORDER BY created_at DESC", [], mapProject);
}

export function getProject(projectId: string) {
  return getOne("SELECT * FROM projects WHERE id = ?", [projectId], mapProject);
}

export function listApiKeys(projectId = DEFAULT_PROJECT_ID) {
  return all("SELECT * FROM api_keys WHERE project_id = ? ORDER BY created_at DESC", [projectId], mapApiKey);
}

export function countActiveApiKeys() {
  return Number(db.exec("SELECT COUNT(*) AS count FROM api_keys WHERE enabled = 1 AND revoked_at IS NULL")[0]?.values[0]?.[0] || 0);
}

export function createProject(name: string) {
  const projectName = name.trim() || "Untitled project";
  const createdAt = now();
  const project: Project = {
    id: id("proj"),
    name: projectName,
    slug: createProjectSlug(projectName),
    createdAt
  };
  db.run("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)", [
    project.id,
    project.name,
    project.slug,
    project.createdAt
  ]);
  addLog(
    {
      projectId: project.id,
      level: "success",
      type: "project.created",
      message: `Created project ${project.name}.`
    },
    false
  );
  persist();
  return project;
}

export function createSplit(input: CreateSplitInput & { projectId?: string }) {
  const projectId = input.projectId || DEFAULT_PROJECT_ID;
  const settlementReceiver = validateSplitAddress(input.settlementReceiver, "Settlement receiver");
  const receivers = validateSplitReceivers(input.receivers);
  const split: Split = {
    id: id("split"),
    projectId,
    name: input.name.trim() || "Untitled split",
    settlementReceiver,
    receivers,
    createdAt: now()
  };
  db.run("INSERT INTO splits (id, project_id, name, settlement_receiver, receivers, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    split.id,
    split.projectId,
    split.name,
    split.settlementReceiver,
    JSON.stringify(split.receivers),
    split.createdAt
  ]);
  addLog(
    {
      projectId,
      level: "success",
      type: "split.created",
      message: `Created split ${split.name}.`
    },
    false
  );
  persist();
  return split;
}

export function getSplit(splitId: string) {
  return getOne("SELECT * FROM splits WHERE id = ?", [splitId], mapSplit);
}

export function createApiKey(name: string, projectId = DEFAULT_PROJECT_ID) {
  const createdAt = now();
  const key = createApiKeySecret();
  const apiKey: ApiKey = {
    id: id("ak"),
    projectId,
    name: name.trim() || "Default key",
    keyPreview: previewApiKey(key),
    enabled: true,
    createdAt
  };
  db.run(
    "INSERT INTO api_keys (id, project_id, name, key_hash, key_preview, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [apiKey.id, apiKey.projectId, apiKey.name, hashApiKey(key), apiKey.keyPreview, 1, apiKey.createdAt]
  );
  addLog(
    {
      projectId,
      level: "success",
      type: "api_key.created",
      message: `Created API key ${apiKey.name}.`
    },
    false
  );
  persist();
  return { ...apiKey, key };
}

export function verifyApiKey(secret?: string) {
  const key = String(secret || "").trim();
  if (!key) return undefined;
  const apiKey = getOne(
    "SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1 AND revoked_at IS NULL",
    [hashApiKey(key)],
    mapApiKey
  );
  if (!apiKey) return undefined;
  const lastUsedAt = now();
  db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [lastUsedAt, apiKey.id]);
  persist();
  return { ...apiKey, lastUsedAt };
}

export function revokeApiKey(apiKeyId: string) {
  const existing = getOne("SELECT * FROM api_keys WHERE id = ?", [apiKeyId], mapApiKey);
  if (!existing) return undefined;
  const revokedAt = now();
  db.run("UPDATE api_keys SET enabled = 0, revoked_at = ? WHERE id = ?", [revokedAt, apiKeyId]);
  addLog(
    {
      projectId: existing.projectId,
      level: "warning",
      type: "api_key.revoked",
      message: `Revoked API key ${existing.name}.`
    },
    false
  );
  persist();
  return { ...existing, enabled: false, revokedAt };
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
      (id, project_id, amount, receiver, status, checkout_url, description, template, metadata, tx_hash, receipt_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentIntent.id,
      paymentIntent.projectId,
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
      projectId: paymentIntent.projectId,
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

export function getReceipt(receiptId: string) {
  return getOne("SELECT * FROM receipts WHERE id = ?", [receiptId], mapReceipt);
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
      (id, project_id, payment_intent_id, amount, receiver, payer, tx_hash, status, receipt_url, metadata, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      receipt.id,
      receipt.projectId,
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
      projectId: receipt.projectId,
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

export function addWebhook(input: Pick<WebhookEndpoint, "url" | "events" | "enabled"> & { projectId?: string }, shouldPersist = true) {
  const projectId = input.projectId || DEFAULT_PROJECT_ID;
  if (findWebhookByUrl(input.url, projectId)) {
    throw new Error("A webhook endpoint with this URL already exists.");
  }
  const createdAt = now();
  const webhook: WebhookEndpoint = {
    ...input,
    id: id("wh"),
    projectId,
    signingSecret: createWebhookSecret(),
    lastRotatedAt: createdAt,
    createdAt
  };
  db.run("INSERT INTO webhooks (id, project_id, url, events, enabled, signing_secret, last_rotated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    webhook.id,
    webhook.projectId,
    webhook.url,
    JSON.stringify(webhook.events),
    webhook.enabled ? 1 : 0,
    webhook.signingSecret,
    webhook.lastRotatedAt,
    webhook.createdAt
  ]);
  addLog(
    {
      level: "info",
      projectId: webhook.projectId,
      type: "webhook.created",
      message: `Registered webhook endpoint ${webhook.url}.`
    },
    false
  );
  if (shouldPersist) persist();
  return webhook;
}

export function updateWebhook(
  webhookId: string,
  input: Partial<Pick<WebhookEndpoint, "url" | "events" | "enabled">>
) {
  const existing = getWebhook(webhookId);
  if (!existing) return undefined;

  const updated: WebhookEndpoint = {
    ...existing,
    url: input.url ?? existing.url,
    events: input.events ?? existing.events,
    enabled: input.enabled ?? existing.enabled
  };

  const duplicate = findWebhookByUrl(updated.url, updated.projectId);
  if (duplicate && duplicate.id !== webhookId) {
    throw new Error("A webhook endpoint with this URL already exists.");
  }

  db.run("UPDATE webhooks SET url = ?, events = ?, enabled = ? WHERE id = ?", [
    updated.url,
    JSON.stringify(updated.events),
    updated.enabled ? 1 : 0,
    webhookId
  ]);
  addLog(
    {
      level: "info",
      projectId: updated.projectId,
      type: "webhook.updated",
      message: `Updated webhook endpoint ${updated.url}.`
    },
    false
  );
  persist();
  return updated;
}

export function rotateWebhookSecret(webhookId: string) {
  const existing = getWebhook(webhookId);
  if (!existing) return undefined;

  const isDemoEndpoint = isDemoMerchantWebhookUrl(existing.url);
  const signingSecret = isDemoEndpoint ? demoMerchantWebhookSecret() : createWebhookSecret();
  const lastRotatedAt = now();
  db.run("UPDATE webhooks SET signing_secret = ?, last_rotated_at = ? WHERE id = ?", [
    signingSecret,
    lastRotatedAt,
    webhookId
  ]);
  addLog(
    {
      level: "warning",
      projectId: existing.projectId,
      type: "webhook.secret_rotated",
      message: isDemoEndpoint
        ? `Synced local demo webhook secret for endpoint ${existing.url}.`
        : `Rotated signing secret for webhook endpoint ${existing.url}.`
    },
    false
  );
  persist();
  return { ...existing, signingSecret, lastRotatedAt };
}

export function deleteWebhook(webhookId: string) {
  const existing = getWebhook(webhookId);
  if (!existing) return false;

  db.run("DELETE FROM webhooks WHERE id = ?", [webhookId]);
  addLog(
    {
      level: "warning",
      projectId: existing.projectId,
      type: "webhook.deleted",
      message: `Deleted webhook endpoint ${existing.url}.`
    },
    false
  );
  persist();
  return true;
}

export function getWebhook(webhookId: string) {
  return getOne("SELECT * FROM webhooks WHERE id = ?", [webhookId], mapWebhook);
}

export function findWebhookByUrl(url: string, projectId = DEFAULT_PROJECT_ID) {
  return getOne("SELECT * FROM webhooks WHERE lower(url) = lower(?) AND project_id = ?", [url, projectId], mapWebhook);
}

export function getWebhookDelivery(deliveryId: string) {
  return getOne("SELECT * FROM webhook_deliveries WHERE id = ?", [deliveryId], mapDelivery);
}

export function addWebhookDelivery(input: Omit<WebhookDelivery, "id" | "createdAt">) {
  const delivery: WebhookDelivery = {
    ...input,
    id: id("wd"),
    createdAt: now()
  };
  db.run(
    `INSERT INTO webhook_deliveries
      (id, project_id, webhook_id, event_type, endpoint_url, status, http_status, attempt, error, payload, response_body, signature_header, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      delivery.id,
      delivery.projectId || null,
      delivery.webhookId || null,
      delivery.eventType,
      delivery.endpointUrl || null,
      delivery.status,
      delivery.httpStatus || null,
      delivery.attempt,
      delivery.error || null,
      delivery.payload ? JSON.stringify(delivery.payload) : null,
      delivery.responseBody || null,
      delivery.signatureHeader || null,
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
    "INSERT INTO event_logs (id, project_id, level, type, message, payment_intent_id, receipt_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [log.id, log.projectId || null, log.level, log.type, log.message, log.paymentIntentId || null, log.receiptId || null, log.createdAt]
  );
  if (shouldPersist) persist();
  return log;
}

export function resetDemoData(projectId = DEFAULT_PROJECT_ID) {
  db.run("DELETE FROM payment_intents WHERE project_id = ?", [projectId]);
  db.run("DELETE FROM receipts WHERE project_id = ?", [projectId]);
  db.run("DELETE FROM webhook_deliveries WHERE project_id = ?", [projectId]);
  db.run("DELETE FROM event_logs WHERE project_id = ?", [projectId]);
  addLog(
    {
      projectId,
      level: "warning",
      type: "demo.reset",
      message: "Demo data was reset. Webhook endpoint configuration was preserved."
    },
    false
  );
  persist();
}

export function seedDemoIntent(projectId = DEFAULT_PROJECT_ID) {
  ensureDemoMerchantWebhook(projectId);
  return createPaymentIntent({
    projectId,
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

export function ensureDemoMerchantWebhook(projectId = DEFAULT_PROJECT_ID) {
  const signingSecret = demoMerchantWebhookSecret();
  const existing = getOne("SELECT * FROM webhooks WHERE url = ? AND project_id = ?", [DEMO_MERCHANT_WEBHOOK_URL, projectId], mapWebhook);
  if (existing) {
    db.run("UPDATE webhooks SET enabled = ?, events = ?, signing_secret = ?, last_rotated_at = ? WHERE id = ?", [
      1,
      JSON.stringify(["payment_intent.paid", "receipt.issued"]),
      signingSecret,
      existing.lastRotatedAt || now(),
      existing.id
    ]);
    persist();
    return {
      ...existing,
      enabled: true,
      events: ["payment_intent.paid", "receipt.issued"],
      signingSecret
    };
  }

  const webhook = addWebhook({
    projectId,
    url: DEMO_MERCHANT_WEBHOOK_URL,
    events: ["payment_intent.paid", "receipt.issued"],
    enabled: true
  });
  db.run("UPDATE webhooks SET signing_secret = ? WHERE id = ?", [
    signingSecret,
    webhook.id
  ]);
  persist();
  return { ...webhook, signingSecret };
}

export function isDemoMerchantWebhookUrl(url?: string) {
  return url === DEMO_MERCHANT_WEBHOOK_URL;
}

function demoMerchantWebhookSecret() {
  return process.env.WEBHOOK_SIGNING_SECRET || "local-dev-secret";
}

function createApiKeySecret() {
  return `ak_test_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
}

function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function previewApiKey(key: string) {
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

function createProjectSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 36) || "project";
  return `${base}-${randomUUID().replaceAll("-", "").slice(0, 6)}`;
}

function validateSplitReceivers(receivers: SplitReceiver[]) {
  if (!Array.isArray(receivers) || receivers.length === 0) {
    throw new Error("Add at least one split receiver.");
  }

  const cleaned = receivers.map((receiver) => ({
    address: receiver.address,
    shareBps: Number(receiver.shareBps),
    label: receiver.label?.trim() || undefined
  }));

  for (const receiver of cleaned) {
    validateSplitAddress(receiver.address, "Each split receiver");
    if (!Number.isInteger(receiver.shareBps) || receiver.shareBps <= 0) {
      throw new Error("Each split receiver share must be positive basis points.");
    }
  }

  const totalBps = cleaned.reduce((sum, receiver) => sum + receiver.shareBps, 0);
  if (totalBps !== 10_000) {
    throw new Error("Split shares must total 100%.");
  }

  return cleaned;
}

function validateSplitAddress(address: string, label: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`${label} must be a valid EVM address.`);
  }
  return address as `0x${string}`;
}

function createWebhookSecret() {
  return `whsec_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}
