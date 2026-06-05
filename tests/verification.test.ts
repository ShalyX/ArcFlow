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
  });

  after(() => {
    api.kill();
    rmSync(testDb, { force: true });
  });

  it("lets a pending intent demo-settle, rejects paid intent replay, and rejects tx hash reuse", async () => {
    await post(`${apiBase}/demo/reset`);
    const intent = await post(`${apiBase}/demo/seed`);
    const settled = await post(`${apiBase}/payment-intents/${intent.id}/demo-settle`);

    assert.equal(settled.intent.status, "paid");
    assert.ok(settled.receipt.txHash.startsWith("0x"));

    const replay = await postRaw(`${apiBase}/payment-intents/${intent.id}/demo-settle`);
    assert.equal(replay.status, 409);

    const second = await post(`${apiBase}/demo/seed`);
    const reuse = await postRaw(`${apiBase}/payment-intents/${second.id}/confirm`, { txHash: settled.receipt.txHash });
    assert.equal(reuse.status, 409);
  });

  it("manages webhook endpoints and records test delivery attempts", async () => {
    const webhook = await post(`${apiBase}/webhooks`, {
      url: "http://127.0.0.1:1/webhooks/arcflow",
      events: ["payment_intent.paid"],
      enabled: true
    });

    assert.equal(webhook.enabled, true);
    assert.equal(webhook.events[0], "payment_intent.paid");

    const updated = await patch(`${apiBase}/webhooks/${webhook.id}`, { enabled: false });
    assert.equal(updated.enabled, false);

    const tested = await post(`${apiBase}/webhooks/${webhook.id}/test`);
    assert.ok(tested.webhookDeliveries.length > 0);
    assert.equal(tested.webhookDeliveries[0].status, "failed");

    const deleted = await fetch(`${apiBase}/webhooks/${webhook.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
  });
});

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function postRaw(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function patch(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `PATCH ${url} failed`);
  return payload;
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
