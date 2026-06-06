# Release Notes

## ArcFlow v0.1.3 - Hosted Checkout Project Settlement Fix

ArcFlow v0.1.3 tightens the platform boundary around hosted checkout while keeping project-scoped merchant infrastructure intact.

The release proves this shape:

```txt
project -> API key -> SDK -> intent -> hosted checkout -> receipt -> scoped webhook trail
```

## What Changed

- Hosted checkout can confirm or demo-settle a payment intent by ID without depending on the console's active project key.
- Receipt pages can load by receipt ID directly, so proof links remain viewable across project context.
- Project dashboard state now requires a valid project API key after local bootstrap.
- The SDK now sends `x-arcflow-api-key` and includes helpers for projects, API keys, webhook endpoints, webhook delivery retry, and payment intents.
- Regression tests cover the hosted checkout safety boundary.

## Hosted Checkout Boundary

Hosted checkout can:

- Read one payment intent by ID.
- Confirm a transaction for that intent.
- Demo-settle that intent in local/demo mode.
- Read one receipt by ID.

Hosted checkout cannot, without a valid project API key:

- List project dashboard state.
- List unrelated receipts.
- Manage webhooks.
- Manage API keys.
- Create projects.
- Switch project ownership.

## Demo Command Path

```bash
npm install
npm run dev:all
```

Then open:

```txt
http://127.0.0.1:5173
```

Create an API key in Developer Config, then follow `docs/SDK_DEMO.md` for the SDK pass.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Current expected test count: 11 passing tests.

The production build may show a Vite chunk-size warning; that is known and does not block the local MVP.
