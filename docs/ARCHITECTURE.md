# ArcFlow Architecture

ArcFlow is a local-first MVP for payment intents, receipts, webhooks, and logs for USDC apps on Arc.

## Components

**Console**

React + Vite app at `http://127.0.0.1:5173`.

It provides:

- Payment intent creation
- Hosted checkout
- Wallet checkout
- Receipt viewing
- Webhook event history
- Webhook endpoint management
- Merchant unlock status
- Demo seed/reset controls

**ArcFlow API**

Express API at `http://127.0.0.1:8787`.

It provides:

- `POST /api/payment-intents`
- `GET /api/payment-intents/:id`
- `POST /api/payment-intents/:id/confirm`
- `POST /api/payment-intents/:id/demo-settle`
- `GET /api/state`
- `POST /api/demo/seed`
- `POST /api/demo/reset`
- `POST /api/webhooks`
- `PATCH /api/webhooks/:id`
- `DELETE /api/webhooks/:id`
- `POST /api/webhooks/:id/rotate-secret`
- `POST /api/webhooks/:id/test`
- `POST /api/webhook-deliveries/:id/retry`

**SQLite Store**

Runtime data is stored in `data/arcflow.sqlite`.

Stored records:

- Payment intents
- Receipts
- Webhook endpoints
- Webhook delivery attempts
- Flow logs

**Payment Verifier**

`server/arcVerifier.ts` verifies Arc USDC transfers before marking an intent paid.

It checks:

- Arc Testnet chain ID
- Transaction success status
- Arc ERC-20 USDC token contract
- Canonical `Transfer` event
- Exact receiver
- Exact amount
- Unused transaction hash
- Pending intent state

**Webhook Delivery**

`server/webhooks.ts` signs outgoing events with each endpoint's HMAC-SHA256 signing secret and sends them to enabled endpoints.

Header:

```txt
x-arcflow-signature
```

Delivery attempts store the endpoint URL, event type, status, HTTP status, request payload, response body or error, signature header, attempt count, and created timestamp. The console uses that record for the Stripe-style delivery detail view and manual retries.

**Merchant Demo**

Express API at `http://127.0.0.1:9090`.

It verifies signed ArcFlow events and unlocks `cus_demo` when `payment_intent.paid` is received.

**SDK Packages**

`packages/sdk`:

- ArcFlow API client
- Webhook signer/verifier

`packages/react`:

- `ArcFlowProvider`
- `useArcFlow`
- `PaymentButton`

## Data Flow

```txt
create intent
  -> open checkout
  -> wallet sends USDC
  -> ArcFlow verifies tx hash
  -> receipt issued
  -> signed webhook delivered
  -> merchant unlocks access
  -> dashboard shows durable trail
```
