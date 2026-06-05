# Contributing

ArcFlow is early. Keep changes small, testable, and tied to the payment trail.

## Local Setup

```bash
npm install
npm run dev:all
npm run demo:seed
```

## Before Opening a PR

```bash
npm test
npm run build
```

## Branches

Use focused branches with names like:

```txt
verification-tests
webhook-management
checkout-polish
```

## Safety Expectations

- Do not commit secrets, private keys, or `.env` files.
- Do not weaken payment verification checks without adding regression tests.
- Keep ArcFlow testnet-first until mainnet support is explicitly designed.
- Prefer exact USDC amount and receiver checks over fuzzy matching.
