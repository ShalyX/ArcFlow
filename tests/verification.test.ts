import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Hex } from "viem";
import { findMatchingUsdcTransfer, type TransferLogCandidate } from "../server/arcVerifier";
import { ARC_TESTNET } from "../src/shared/arc";
import { ArcFlow } from "../packages/sdk/src/index";
import { signArcFlowWebhook, verifyArcFlowWebhook } from "../packages/sdk/src/webhooks";

const receiver = "0x0000000000000000000000000000000000000001";
const payer = "0x1111111111111111111111111111111111111111";
const wrongReceiver = "0x0000000000000000000000000000000000000002";
const wrongToken = "0x2222222222222222222222222222222222222222";
const expectedAmount = "10000000";

function transferLog({
  token = ARC_TESTNET.usdcAddress,
  to = receiver,
  value = expectedAmount
}: {
  token?: `0x${string}`;
  to?: `0x${string}`;
  value?: string;
} = {}): TransferLogCandidate {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: {
      from: payer,
      to
    }
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [BigInt(value)]);

  return {
    address: token,
    topics,
    data
  };
}

describe("USDC transfer matching", () => {
  it("matches the exact Arc USDC Transfer event", () => {
    const match = findMatchingUsdcTransfer({
      logs: [transferLog()],
      expectedReceiver: receiver,
      expectedAmount,
      usdcAddress: ARC_TESTNET.usdcAddress
    });

    assert.equal(match?.payer, payer);
    assert.equal(match?.receiver, receiver);
    assert.equal(match?.amount, expectedAmount);
    assert.equal(match?.tokenAddress, ARC_TESTNET.usdcAddress);
  });

  it("rejects wrong receiver", () => {
    const match = findMatchingUsdcTransfer({
      logs: [transferLog({ to: wrongReceiver })],
      expectedReceiver: receiver,
      expectedAmount,
      usdcAddress: ARC_TESTNET.usdcAddress
    });

    assert.equal(match, null);
  });

  it("rejects wrong token", () => {
    const match = findMatchingUsdcTransfer({
      logs: [transferLog({ token: wrongToken })],
      expectedReceiver: receiver,
      expectedAmount,
      usdcAddress: ARC_TESTNET.usdcAddress
    });

    assert.equal(match, null);
  });

  it("rejects underpayment", () => {
    const match = findMatchingUsdcTransfer({
      logs: [transferLog({ value: "9999999" })],
      expectedReceiver: receiver,
      expectedAmount,
      usdcAddress: ARC_TESTNET.usdcAddress
    });

    assert.equal(match, null);
  });
});

describe("webhook signatures", () => {
  it("verifies signed webhook payloads", () => {
    const payload = JSON.stringify({ type: "payment_intent.paid", data: { paymentIntentId: "pi_test" } });
    const signature = signArcFlowWebhook(payload, "secret");
    const event = verifyArcFlowWebhook({ payload, signature, secret: "secret" });

    assert.equal(event.type, "payment_intent.paid");
  });

  it("rejects invalid webhook signatures", () => {
    const payload = JSON.stringify({ type: "payment_intent.paid", data: {} });

    assert.throws(
      () => verifyArcFlowWebhook({ payload, signature: "00", secret: "secret" }),
      /Invalid ArcFlow webhook signature/
    );
  });
});

describe("payment intent API guards", () => {
  const port = 8877;
  const apiBase = `http://127.0.0.1:${port}/api`;
  const testDb = join(process.cwd(), "data", "arcflow-test.sqlite");
  let api: ChildProcess;
  let apiKey: string;

  before(async () => {
    rmSync(testDb, { force: true });
    api = spawn("node", ["--import", "tsx", "server/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ARCFLOW_DB_PATH: testDb,
        WEBHOOK_SIGNING_SECRET: "local-dev-secret"
      },
      stdio: "ignore"
    });

    await waitForHealth(`${apiBase}/health`);
    const createdKey = await post(`${apiBase}/api-keys`, { name: "Regression key" });
    apiKey = createdKey.key;
  });

  after(() => {
    api.kill();
    rmSync(testDb, { force: true });
  });

  it("lets a pending intent demo-settle, rejects paid intent replay, and rejects tx hash reuse", async () => {
    await post(`${apiBase}/demo/reset`);
    const intent = await post(`${apiBase}/demo/seed`);
    const settled = await post(`${apiBase}/payment-intents/${intent.id}/demo-settle`, undefined, apiKey);

    assert.equal(settled.intent.status, "paid");
    assert.ok(settled.receipt.txHash.startsWith("0x"));

    const replay = await postRaw(`${apiBase}/payment-intents/${intent.id}/demo-settle`, undefined, apiKey);
    assert.equal(replay.status, 409);

    const second = await post(`${apiBase}/demo/seed`);
    const reuse = await postRaw(`${apiBase}/payment-intents/${second.id}/confirm`, { txHash: settled.receipt.txHash }, apiKey);
    assert.equal(reuse.status, 409);
  });

  it("manages webhook endpoints and records test delivery attempts", async () => {
    const webhook = await post(`${apiBase}/webhooks`, {
      url: "http://127.0.0.1:1/webhooks/arcflow",
      events: ["payment_intent.paid"],
      enabled: true
    }, apiKey);

    assert.equal(webhook.enabled, true);
    assert.equal(webhook.events[0], "payment_intent.paid");
    assert.match(webhook.signingSecret, /^whsec_/);
    assert.ok(webhook.lastRotatedAt);

    const duplicate = await postRaw(`${apiBase}/webhooks`, {
      url: "http://127.0.0.1:1/webhooks/arcflow",
      events: ["payment_intent.paid"],
      enabled: true
    }, apiKey);
    assert.equal(duplicate.status, 400);

    const badProtocol = await postRaw(`${apiBase}/webhooks`, {
      url: "ftp://example.com/webhooks/arcflow",
      events: ["payment_intent.paid"],
      enabled: true
    }, apiKey);
    assert.equal(badProtocol.status, 400);

    const noEvents = await postRaw(`${apiBase}/webhooks`, {
      url: "http://127.0.0.1:2/webhooks/arcflow",
      events: [],
      enabled: true
    }, apiKey);
    assert.equal(noEvents.status, 400);

    const updated = await patch(`${apiBase}/webhooks/${webhook.id}`, { enabled: false }, apiKey);
    assert.equal(updated.enabled, false);

    const rotated = await post(`${apiBase}/webhooks/${webhook.id}/rotate-secret`, undefined, apiKey);
    assert.notEqual(rotated.signingSecret, webhook.signingSecret);
    assert.match(rotated.signingSecret, /^whsec_/);

    const state = await get(`${apiBase}/state`, apiKey);
    const demoWebhook = state.webhooks.find((item: { url: string }) => item.url === "http://127.0.0.1:9090/webhooks/arcflow");
    assert.ok(demoWebhook);
    const syncedDemo = await post(`${apiBase}/webhooks/${demoWebhook.id}/rotate-secret`, undefined, apiKey);
    assert.equal(syncedDemo.signingSecret, "local-dev-secret");

    const tested = await post(`${apiBase}/webhooks/${webhook.id}/test`, undefined, apiKey);
    assert.ok(tested.webhookDeliveries.length > 0);
    assert.equal(tested.webhookDeliveries[0].status, "failed");
    assert.equal(tested.webhookDeliveries[0].attempt, 1);
    assert.ok(tested.webhookDeliveries[0].signatureHeader);
    assert.ok(tested.webhookDeliveries[0].payload);

    const retried = await post(`${apiBase}/webhook-deliveries/${tested.webhookDeliveries[0].id}/retry`, undefined, apiKey);
    assert.equal(retried.webhookDeliveries[0].attempt, 2);

    const deleted = await fetch(`${apiBase}/webhooks/${webhook.id}`, { method: "DELETE", headers: authHeaders(apiKey) });
    assert.equal(deleted.status, 204);
  });

  it("requires valid API keys for protected mutations", async () => {
    const unauthorized = await postRaw(`${apiBase}/payment-intents`, {
      amount: "10.00",
      receiver,
      description: "No key",
      template: "payment-link"
    });
    assert.equal(unauthorized.status, 401);

    const intent = await post(`${apiBase}/payment-intents`, {
      amount: "10.00",
      receiver,
      description: "Authorized key",
      template: "payment-link"
    }, apiKey);
    assert.equal(intent.status, "pending");

    const temporary = await post(`${apiBase}/api-keys`, { name: "Temporary key" }, apiKey);
    const revoked = await fetch(`${apiBase}/api-keys/${temporary.id}`, { method: "DELETE", headers: authHeaders(apiKey) });
    assert.equal(revoked.status, 200);

    const rejected = await postRaw(`${apiBase}/payment-intents`, {
      amount: "10.00",
      receiver,
      description: "Revoked key",
      template: "payment-link"
    }, temporary.key);
    assert.equal(rejected.status, 401);
  });

  it("scopes payment trails to the API key project", async () => {
    const createdProject = await post(`${apiBase}/projects`, { name: "Second Merchant" }, apiKey);
    assert.equal(createdProject.project.name, "Second Merchant");
    assert.equal(createdProject.apiKey.projectId, createdProject.project.id);

    const projectIntent = await post(`${apiBase}/payment-intents`, {
      amount: "5.00",
      receiver,
      description: "Project scoped checkout",
      template: "payment-link"
    }, createdProject.apiKey.key);
    assert.equal(projectIntent.projectId, createdProject.project.id);

    const secondProjectState = await get(`${apiBase}/state`, createdProject.apiKey.key);
    assert.equal(secondProjectState.currentProjectId, createdProject.project.id);
    assert.ok(secondProjectState.paymentIntents.some((intent: { id: string }) => intent.id === projectIntent.id));
    assert.ok(secondProjectState.webhooks.every((webhook: { projectId: string }) => webhook.projectId === createdProject.project.id));

    const defaultState = await get(`${apiBase}/state`, apiKey);
    assert.equal(defaultState.currentProjectId, "proj_default");
    assert.ok(!defaultState.paymentIntents.some((intent: { id: string }) => intent.id === projectIntent.id));

    const checkoutSettle = await post(`${apiBase}/payment-intents/${projectIntent.id}/demo-settle`, undefined, apiKey);
    assert.equal(checkoutSettle.intent.status, "paid");
    assert.equal(checkoutSettle.intent.projectId, createdProject.project.id);

    const directReceipt = await get(`${apiBase}/receipts/${checkoutSettle.receipt.id}`, apiKey);
    assert.equal(directReceipt.id, checkoutSettle.receipt.id);
    assert.equal(directReceipt.projectId, createdProject.project.id);

    const publicIntent = await get(`${apiBase}/payment-intents/${projectIntent.id}`);
    assert.equal(publicIntent.id, projectIntent.id);
    assert.equal(publicIntent.projectId, createdProject.project.id);

    const publicReceipt = await get(`${apiBase}/receipts/${checkoutSettle.receipt.id}`);
    assert.equal(publicReceipt.id, checkoutSettle.receipt.id);

    const publicState = await getRaw(`${apiBase}/state`);
    assert.equal(publicState.status, 401);

    const publicWebhookCreate = await postRaw(`${apiBase}/webhooks`, {
      url: "http://127.0.0.1:4/webhooks/arcflow",
      events: ["payment_intent.paid"],
      enabled: true
    });
    assert.equal(publicWebhookCreate.status, 401);

    const publicApiKeyCreate = await postRaw(`${apiBase}/api-keys`, { name: "Public key attempt" });
    assert.equal(publicApiKeyCreate.status, 401);

    const publicProjectCreate = await postRaw(`${apiBase}/projects`, { name: "Public project attempt" });
    assert.equal(publicProjectCreate.status, 401);
  });

  it("supports authenticated SDK helpers", async () => {
    const arcflow = new ArcFlow({ baseUrl: apiBase, apiKey });
    const created = await arcflow.projects.create("SDK Merchant");
    assert.equal(created.project.name, "SDK Merchant");
    assert.equal(created.apiKey.projectId, created.project.id);

    const projectClient = new ArcFlow({ baseUrl: apiBase, apiKey: created.apiKey.key });
    const intent = await projectClient.paymentIntents.create({
      amount: "3.00",
      receiver,
      description: "SDK checkout",
      template: "payment-link"
    });
    assert.equal(intent.projectId, created.project.id);

    const webhook = await projectClient.webhooks.create({
      url: "http://127.0.0.1:3/webhooks/arcflow",
      events: ["payment_intent.paid"],
      enabled: true
    });
    assert.equal(webhook.projectId, created.project.id);

    const state = await projectClient.state.get();
    assert.equal(state.currentProjectId, created.project.id);
    assert.ok(state.paymentIntents.some((item) => item.id === intent.id));
    assert.ok(state.webhooks.some((item) => item.id === webhook.id));

    await projectClient.webhooks.delete(webhook.id);
  });

  it("records split payment instructions without payout automation", async () => {
    const split = await post(`${apiBase}/splits`, {
      name: "Revenue split",
      receivers: [
        { label: "Primary", address: receiver, shareBps: 7000 },
        { label: "Partner", address: wrongReceiver, shareBps: 3000 }
      ]
    }, apiKey);
    assert.equal(split.name, "Revenue split");
    assert.equal(split.receivers.length, 2);

    const badSplit = await postRaw(`${apiBase}/splits`, {
      name: "Broken split",
      receivers: [
        { label: "Primary", address: receiver, shareBps: 5000 }
      ]
    }, apiKey);
    assert.equal(badSplit.status, 400);

    const intent = await post(`${apiBase}/payment-intents`, {
      amount: "10.00",
      receiver,
      description: "Split checkout",
      template: "split-payment",
      metadata: {
        splitId: split.id,
        primaryReceiver: receiver,
        shares: "record-only"
      }
    }, apiKey);
    assert.equal(intent.template, "split-payment");
    assert.equal(intent.metadata.splitId, split.id);

    const settled = await post(`${apiBase}/payment-intents/${intent.id}/demo-settle`);
    assert.equal(settled.intent.status, "paid");
    assert.equal(settled.receipt.metadata.splitId, split.id);

    const state = await get(`${apiBase}/state`, apiKey);
    assert.ok(state.splits.some((item: { id: string }) => item.id === split.id));
    assert.ok(state.logs.some((log: { type: string; paymentIntentId?: string }) => log.type === "split.recorded" && log.paymentIntentId === intent.id));

    const projectClient = new ArcFlow({ baseUrl: apiBase, apiKey });
    const sdkSplit = await projectClient.splits.create({
      name: "SDK split",
      receivers: [
        { label: "Primary", address: receiver, shareBps: 6000 },
        { label: "Partner", address: wrongReceiver, shareBps: 4000 }
      ]
    });
    assert.equal(sdkSplit.name, "SDK split");
  });
});

async function post(url: string, body?: unknown, apiKey?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(apiKey) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function postRaw(url: string, body?: unknown, apiKey?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(apiKey) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function patch(url: string, body?: unknown, apiKey?: string) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(apiKey) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `PATCH ${url} failed`);
  return payload;
}

async function get(url: string, apiKey?: string) {
  const response = await fetch(url, {
    headers: authHeaders(apiKey)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `GET ${url} failed`);
  return payload;
}

async function getRaw(url: string, apiKey?: string) {
  const response = await fetch(url, {
    headers: authHeaders(apiKey)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

function authHeaders(apiKey?: string) {
  return apiKey ? { "x-arcflow-api-key": apiKey } : {};
}

async function waitForHealth(url: string) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for ${url}`);
}
