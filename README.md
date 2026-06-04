# ArcFlow

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

## Product Structure

```txt
ArcFlow
  SDK/components      @arcflow/sdk, @arcflow/react, @arcflow/webhooks
  Receipts            Proof and accounting records
  Templates           Payment link, access unlock, invoice
  Credibility         Later data layer
```

The SDK is intentionally product-scoped as `ArcFlow SDK`, avoiding the `ArcKit` name while Arc/Circle use nearby language like App Kits.

## Local Setup

```bash
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:5173
```

## Demo

See [DEMO.md](./DEMO.md) for the two-minute demo script.

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

Copy `.env.example` to `.env` if you want to override the Arc RPC URL or webhook signing secret.

Runtime data is stored in:

```txt
data/arcflow.sqlite
```

The `data/` directory is ignored by git.

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
