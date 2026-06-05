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
- It does not provide production authentication or authorization yet.
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

Outgoing webhook payloads are signed with HMAC-SHA256.

Receivers should verify:

```txt
x-arcflow-signature
```

The SDK exposes:

```ts
verifyArcFlowWebhook(...)
```

## Secrets

Do not commit:

- `.env`
- private keys
- wallet seed phrases
- production webhook secrets

Use `.env.example` as the public template.

## Current Limitations

- Local-only SQLite database.
- Testnet-only chain config.
- No API authentication yet.
- No webhook retry UI yet.
- No hosted deployment config yet.
