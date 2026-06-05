# ArcFlow

[![CI](https://github.com/OWNER/arcflow/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/arcflow/actions/workflows/ci.yml)

ArcFlow is the payment event layer for USDC apps on Arc.

This first build focuses on the core product:

- Payment intents
- Hosted checkout links
- Receipts
- Webhook delivery
- Event logs
- Starter templates
- SQLite persistence
- Demo seed/reset controls

The product question is simple:

> What happened after money moved?

Later modules can extend the same surface with splits, subscriptions, agent spend controls, and credibility scoring.

## Why ArcFlow?

For a developer, payment is rarely the final step. After money moves, an app still needs to unlock access, issue proof, notify a backend, record a durable trail, and make the event inspectable.

ArcFlow turns that into one local product loop:

```txt
checkout link -> wallet payment -> verified receipt -> signed webhook -> merchant unlock -> durable trail
```

## What It Is

- A local-first Arc Testnet payment infrastructure MVP.
- A developer tool for USDC payment intents and receipts.
- A signed webhook layer for post-payment app workflows.
- A demoable merchant unlock flow.
- A regression-tested verifier for exact USDC transfer matching.

## What It Is Not

- Not a custodial wallet.
- Not a mainnet payment processor yet.
- Not a replacement for compliance, tax, or accounting systems.
- Not production-authenticated yet.

## Product Structure

```txt
ArcFlow
  SDK/components      @arcflow/sdk, @arcflow/react, @arcflow/webhooks
  Receipts            Proof and accounting records
  Templates           Payment link, access unlock, invoice
  Credibility         Later data layer
```

The SDK is intentionally product-scoped as `ArcFlow SDK`, avoiding the `ArcKit` name while Arc/Circle use nearby language like App Kits.

## 5-Minute Quickstart

```bash
npm install
npm run dev:all
npm run demo:seed
```

Then:

1. Open the ArcFlow Console.
2. Copy the checkout link from **Payment Intents**.
3. Open checkout.
4. Connect a funded wallet on Arc Testnet.
5. Pay USDC.
6. View the receipt.
7. Check **Webhook Events**.
8. Check the **Merchant Unlock** panel.

For a no-wallet local walkthrough, open checkout and use **Demo settle**.

## Local Service Map

```txt
Console:       http://127.0.0.1:5173
ArcFlow API:   http://127.0.0.1:8787
Merchant Demo: http://127.0.0.1:9090
SQLite DB:     data/arcflow.sqlite
```

## Local Commands

```bash
npm run dev:all      # API, console, merchant demo
npm run demo:seed    # create a 10 USDC demo intent
npm run demo:reset   # clear demo payment trail
npm test             # payment verifier and webhook regression tests
npm run build        # typecheck and production build
```

`npm run dev` starts only the ArcFlow API and console.

## Demo

See [DEMO.md](./DEMO.md) for the two-minute demo script.

## Screenshots

Add screenshots or GIFs here before publishing:

- `docs/assets/console.png` - dashboard with payment trail.
- `docs/assets/checkout.png` - wallet checkout stepper.
- `docs/assets/receipt.png` - verified receipt page.
- `docs/assets/webhook-unlock.gif` - webhook delivered and merchant unlock.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Security Notes](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Developer SDK

The repo includes the first SDK surface in `packages/sdk`.

```ts
import { ArcFlow } from "@arcflow/sdk";

const arcflow = new ArcFlow({
  baseUrl: "http://127.0.0.1:8787/api",
  apiKey: "test_key"
});

const intent = await arcflow.paymentIntents.create({
  amount: "10.00",
  receiver: "0x0000000000000000000000000000000000000001",
  description: "API access unlock",
  template: "access-unlock",
  metadata: {
    customerId: "cus_123",
    productId: "api_basic"
  }
});
```

Webhook verification:

```ts
import { verifyArcFlowWebhook } from "@arcflow/sdk/webhooks";

const event = verifyArcFlowWebhook({
  payload: rawBody,
  signature: req.headers["x-arcflow-signature"],
  secret: process.env.WEBHOOK_SIGNING_SECRET
});
```

React helpers live in `packages/react`.

```tsx
import { ArcFlowProvider, PaymentButton } from "@arcflow/react";

export function Checkout({ intentId }: { intentId: string }) {
  return (
    <ArcFlowProvider baseUrl="http://127.0.0.1:8787/api">
      <PaymentButton intentId={intentId}>Pay with USDC on Arc</PaymentButton>
    </ArcFlowProvider>
  );
}
```

## Merchant Example

Run the example merchant webhook receiver:

```bash
npm run example:merchant
```

It exposes:

```txt
POST http://127.0.0.1:9090/webhooks/arcflow
GET  http://127.0.0.1:9090/access/:customerId
```

The example verifies `x-arcflow-signature`, then unlocks access when it receives `payment_intent.paid`.

The API runs on:

```txt
http://127.0.0.1:8787
```

Copy `.env.example` to `.env` if you want to override local ports, the Arc RPC URL, API base URL, or webhook signing secret.

Runtime data is stored in:

```txt
data/arcflow.sqlite
```

The `data/` directory is ignored by git.

## Troubleshooting

**`127.0.0.1 refused to connect`**

Run `npm run dev:all` again. The console should be on `5173`, the API on `8787`, and the merchant demo on `9090`.

**Checkout cannot find a wallet**

Install or enable an injected wallet such as MetaMask or Rabby, then refresh the checkout page.

**Wallet cannot switch to Arc Testnet**

The checkout asks your wallet to add/switch to Arc Testnet. If it fails, check that your wallet supports custom EVM networks.

**Insufficient USDC**

Fund the connected wallet with Arc Testnet USDC from the Circle faucet, then retry checkout.

**Webhook says `Cannot GET /webhooks/arcflow`**

Use the latest merchant demo. Browser visits use GET, while ArcFlow delivers webhooks with POST. The merchant demo now exposes a GET status route for that URL.

**Demo seed fails**

Make sure `npm run dev:all` is running before `npm run demo:seed`. The seed script calls `http://127.0.0.1:8787/api/demo/seed`.

**Old demo data is confusing the dashboard**

Run `npm run demo:reset`, then seed a fresh intent.

## Arc Defaults

- Network: Arc Testnet
- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- ERC-20 USDC: `0x3600000000000000000000000000000000000000`
- USDC decimals: `6`

Arc native gas uses 18 decimals, but ArcFlow payment amounts use ERC-20 USDC and therefore always use 6 decimals.

## MVP Flow

1. Create a payment intent in the console.
2. Open the hosted checkout URL.
3. Connect an injected wallet on Arc Testnet.
4. Approve the ERC-20 USDC transfer from checkout.
5. ArcFlow verifies the transaction hash, issues a receipt, sends matching webhooks, and records logs.

Manual fallback:

1. Send USDC on Arc Testnet to the receiver address.
2. Paste the transaction hash to verify the payment.
3. ArcFlow issues a receipt, sends matching webhooks, and records logs.

For local demos, the checkout page includes a demo settlement button that creates the receipt/log flow without submitting an onchain transaction.

You can also seed and reset demo data from the console, or through:

```http
POST /api/demo/seed
POST /api/demo/reset
```

## Payment Verification

ArcFlow only marks an intent paid after the verifier confirms:

- RPC is connected to Arc Testnet.
- Transaction belongs to Arc Testnet when chain metadata is present.
- Transaction succeeded.
- Transaction called the Arc ERC-20 USDC token contract.
- Receipt contains a canonical USDC `Transfer` event.
- Transfer receiver exactly matches the payment intent receiver.
- Transfer amount exactly matches the payment intent amount.
- Transaction hash has not already been used by another payment intent or receipt.
- Payment intent is still pending.

The amount match is exact, so underpaid transfers do not settle an intent.

Regression tests cover wrong receiver, wrong token, underpayment, duplicate transaction hash reuse, already-paid intent replay, pending intent settlement, and webhook signature verification.

## API Sketch

Create a payment intent:

```http
POST /api/payment-intents
Content-Type: application/json

{
  "amount": "10.00",
  "receiver": "0x0000000000000000000000000000000000000001",
  "description": "API access unlock",
  "template": "access-unlock",
  "metadata": {
    "customerId": "cus_123",
    "productId": "api_basic"
  }
}
```

Confirm a payment:

```http
POST /api/payment-intents/:id/confirm
Content-Type: application/json

{
  "txHash": "0x..."
}
```

Webhook event:

```json
{
  "type": "payment_intent.paid",
  "data": {
    "paymentIntentId": "pi_...",
    "amount": "10000000",
    "txHash": "0x...",
    "receiptUrl": "/receipts/rcpt_..."
  }
}
```

Webhook payloads are signed with `x-arcflow-signature` using HMAC-SHA256.

## Roadmap

- Splits: route revenue to multiple receivers after settlement.
- Subscriptions: recurring intents, retries, and access status webhooks.
- Agent spend controls: policy wallets, per-action caps, and spend logs.
- Credibility: payment and fulfillment history as a reputation graph.

## Current Limitations

- Arc Testnet only.
- Local SQLite only.
- No API authentication yet.
- No production deployment profile yet.
- Webhook delivery history exists, but endpoint management and retry controls are still minimal.
