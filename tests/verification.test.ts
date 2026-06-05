import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Hex } from "viem";
import { findMatchingUsdcTransfer, type TransferLogCandidate } from "../server/arcVerifier";
import { ARC_TESTNET } from "../src/shared/arc";
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

    const state = await fetch(`${apiBase}/state`).then((response) => response.json());
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
