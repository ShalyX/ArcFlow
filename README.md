# ArcFlow

ArcFlow is the payment event layer for USDC apps on Arc.

This first build focuses on the core product:

- Payment intents
- Hosted checkout links
- Receipts
- Webhook delivery
- Event logs
- Starter templates

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

The API runs on:

```txt
http://127.0.0.1:8787
```

Copy `.env.example` to `.env` if you want to override the Arc RPC URL or webhook signing secret.

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
3. Send USDC on Arc Testnet to the receiver address.
4. Paste the transaction hash to verify the payment.
5. ArcFlow issues a receipt, sends matching webhooks, and records logs.

For local demos, the checkout page includes a demo settlement button that creates the receipt/log flow without submitting an onchain transaction.

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
