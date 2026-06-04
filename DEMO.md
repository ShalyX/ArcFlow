# ArcFlow Demo Script

Use this demo to show the core ArcFlow loop in under two minutes.

## One-Line Pitch

ArcFlow gives USDC apps on Arc a payment event layer: create intents, settle payments, issue receipts, send webhooks, and keep a clean trail of what happened after money moved.

## Demo Flow

1. Open the ArcFlow console.
2. Use **Seed demo intent**, or create an intent manually with the `Access unlock` template.
3. Confirm the intent appears in **Payment Intents**.
4. Copy the checkout link, then open the hosted checkout link from **Payment Intents**.
5. Use **Connect wallet and pay** with an injected wallet on Arc Testnet.
6. If you are recording locally without wallet funds, use **Demo settle** instead.
7. Return to the console.
8. Show:
   - The intent is now `paid`.
   - A receipt was issued.
   - A webhook delivery attempt was recorded.
   - The flow logs explain each step.
9. Restart the API and refresh the console to show the payment trail persisted.
10. Open the receipt page and copy the receipt link or transaction hash.
11. Show the SDK snippets in the README to make the developer integration path clear.

## Real Wallet Flow

Use this for the serious ArcFlow demo:

1. Start ArcFlow API, ArcFlow console, and the merchant example API.
2. Seed demo merchant from the dashboard with **Seed and open checkout**.
3. Confirm the local merchant webhook endpoint is enabled:
   `http://127.0.0.1:9090/webhooks/arcflow`
4. Connect a funded wallet in checkout.
5. Wallet switches to Arc Testnet.
6. Customer pays ERC-20 USDC.
7. ArcFlow verifies:
   - correct chain
   - correct USDC token address
   - successful transaction
   - exact `Transfer` event
   - exact receiver
   - exact amount
   - unused transaction hash
   - pending intent
8. ArcFlow issues a receipt.
9. ArcFlow sends a signed webhook.
10. Merchant API unlocks `cus_demo`.
11. Dashboard shows the full durable payment trail.
12. Copy the receipt link for accounting/proof.
13. Restart the API.
14. Refresh the dashboard and show the trail still exists.

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
