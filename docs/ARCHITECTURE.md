# ArcFlow Architecture

ArcFlow is a local-first MVP for payment intents, receipts, webhooks, and logs for USDC apps on Arc.

## Components

**Console**

React + Vite app at `http://127.0.0.1:5173`.

It provides:

- Project switching and creation
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
- `POST /api/api-keys`
- `DELETE /api/api-keys/:id`
- `POST /api/projects`
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

- Projects
- Payment intents
- Receipts
- Webhook endpoints
- Webhook delivery attempts
- Flow logs
- API key metadata and hashes

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

**API Key Auth**

Protected mutation routes require the `x-arcflow-api-key` header. API keys are generated as `ak_test_...` secrets, stored as SHA-256 hashes, and shown only once in the console. The first key can bootstrap from the local console without an existing key; later key creation and protected mutations require an active key.

API keys are scoped to one project. Authenticated dashboard state and protected mutations operate inside the API key's project.

**Project Scoping**

ArcFlow seeds a default `Demo Merchant` project on boot and backfills legacy local data into that project. Payment intents, receipts, webhook endpoints, webhook delivery attempts, event logs, and API keys all carry a `project_id`. Webhook delivery only reads endpoints from the event's project, so merchant trails stay isolated.

**Merchant Demo**

Express API at `http://127.0.0.1:9090`.

It verifies signed ArcFlow events and unlocks `cus_demo` when `payment_intent.paid` is received.

**SDK Packages**

`packages/sdk`:

- ArcFlow API client
- `x-arcflow-api-key` authenticated requests
- Project and API key helpers
- Webhook endpoint and delivery helpers
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
