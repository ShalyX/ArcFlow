# Security Notes

ArcFlow is currently a local Arc Testnet MVP.

## What ArcFlow Does

- Creates payment intents.
- Verifies Arc ERC-20 USDC transfers.
- Issues receipts after verification.
- Sends signed webhook events.
- Stores a durable local payment trail.

## What ArcFlow Does Not Do

- It does not custody user or merchant keys.
- It does not submit backend transactions on behalf of users.
- It does not support mainnet yet.
- It does not provide production-grade authentication or authorization yet.
- It does not replace accounting, tax, or compliance tooling.

## Verification Guarantees

ArcFlow only marks a payment intent paid after checking:

- Correct Arc Testnet chain.
- Successful transaction receipt.
- Transaction called the Arc ERC-20 USDC token contract.
- Matching canonical USDC `Transfer` event.
- Exact receiver match.
- Exact amount match.
- Transaction hash has not already been used.
- Intent is still pending.

Underpayments do not settle payment intents.

## Webhook Signatures

Outgoing webhook payloads are signed with HMAC-SHA256 using the target endpoint's signing secret.

Receivers should verify:

```txt
x-arcflow-signature
```

The SDK exposes:

```ts
verifyArcFlowWebhook(...)
```

Each endpoint has a `whsec_...` signing secret, copy control, rotate control, and last-rotated timestamp in the local console. The merchant demo endpoint uses `WEBHOOK_SIGNING_SECRET` or `local-dev-secret` so the bundled receiver can verify local webhooks without extra setup.

Endpoint creation rejects empty URLs, invalid URLs, unsupported protocols, duplicate endpoint URLs, and endpoints with no selected events. Localhost endpoints are useful for the local demo, but hosted deployments should require public HTTPS endpoints.

## Secrets

Do not commit:

- `.env`
- private keys
- wallet seed phrases
- ArcFlow API keys
- production webhook secrets

Use `.env.example` as the public template.

Webhook secrets are stored in local SQLite for the MVP. A production deployment should move them to managed secret storage and gate endpoint management behind authentication and authorization.

## API Keys

Payment and webhook mutation routes require `x-arcflow-api-key`.

Local API keys are generated as `ak_test_...` secrets. ArcFlow stores SHA-256 hashes and key previews in SQLite, shows the full key only once, tracks last-used timestamps, and supports revocation from Developer Config.

The first key can be created from the local console without an existing key so a fresh clone can bootstrap itself. Production deployments should replace that local bootstrap flow with an authenticated admin setup and project-scoped keys.

## Current Limitations

- Local-only SQLite database.
- Testnet-only chain config.
- Local-only API key bootstrap.
- No hosted deployment config yet.
