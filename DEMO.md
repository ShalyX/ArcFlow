# ArcFlow Demo Script

Use this demo to show the core ArcFlow loop in under two minutes.

## One-Line Pitch

ArcFlow gives USDC apps on Arc a payment event layer: create intents, settle payments, issue receipts, send webhooks, and keep a clean trail of what happened after money moved.

## Demo Flow

1. Open the ArcFlow console.
2. Use **Seed demo intent**, or create an intent manually with the `Access unlock` template.
3. Confirm the intent appears in **Payment Intents**.
4. Open the hosted checkout link from **Payment Intents**.
5. Use **Demo settle** for a local demo, or paste a real Arc Testnet USDC transfer transaction hash.
6. Return to the console.
7. Show:
   - The intent is now `paid`.
   - A receipt was issued.
   - A webhook delivery attempt was recorded.
   - The flow logs explain each step.
8. Restart the API and refresh the console to show the payment trail persisted.

## Talk Track

The important question ArcFlow answers is:

> What happened after money moved?

For a developer, a payment is not the end of the workflow. Something has to happen next: unlock access, update an invoice, notify a backend, issue proof, or record a customer event.

ArcFlow turns that into a product loop:

```txt
create intent -> settle payment -> issue receipt -> record webhook/log events
```

## What To Emphasize

- ArcFlow does not need to custody merchant keys for this MVP.
- Payment amounts use ERC-20 USDC with 6 decimals.
- The receipt and event trail are the durable product primitives.
- Templates are starter flows, not separate products.
- Splits, subscriptions, agent spend controls, and credibility can all grow from the same event layer.

## Demo End State

After the demo, the dashboard should show:

- At least one paid payment intent.
- At least one receipt.
- A webhook skipped or delivered event.
- Flow logs for creation, receipt issuance, settlement, and webhook handling.
- The same trail after restart because it is stored in SQLite.
