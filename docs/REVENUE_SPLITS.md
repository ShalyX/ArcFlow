# Revenue Split Plans

Revenue Split Plan is ArcFlow's accounting-first split payment template.

It lets a developer create a payment intent where the customer pays one total USDC amount to a settlement wallet. ArcFlow verifies the total payment, computes deterministic recipient allocations, renders the split breakdown on the receipt, includes structured split metadata in webhooks, and records the allocation plan in the payment trail.

Automatic disbursement is not enabled in this MVP. The current flow records the intended allocation; it does not split funds onchain.

## What It Does

- Verifies the total USDC payment to the settlement wallet.
- Computes recipient allocations from percentages.
- Stores a `splitPlan` on the payment intent and receipt metadata.
- Shows the split breakdown on the receipt.
- Sends structured split metadata in `payment_intent.paid` webhooks.
- Records the planned allocation in flow logs.

## What It Does Not Do

- It does not transfer funds to recipients.
- It does not custody funds for recipients.
- It does not retry or schedule payouts.
- It does not replace payout accounting or tax reporting.

## Dashboard Template

Template name: `Revenue Split Plan`

Default example:

```txt
Pay 10 USDC
Platform fee: 10%
Creator: 70%
Contributor: 20%
```

ArcFlow shows:

```txt
Settlement wallet receives: 10 USDC

Recorded split plan:
- Creator: 7 USDC
- Contributor: 2 USDC
- Platform: 1 USDC
```

The dashboard copy makes the boundary explicit: this MVP records the split plan but does not yet execute onchain disbursement.

## SDK Example

```ts
import { ArcFlow } from "@arcflow/sdk";

const arcflow = new ArcFlow({
  apiKey: process.env.ARCFLOW_KEY
});

const intent = await arcflow.paymentIntents.create({
  amount: "10",
  description: "Revenue split plan demo",
  template: "revenue_split",
  settlementReceiver: "0x0000000000000000000000000000000000000001",
  split: [
    {
      label: "Creator",
      recipient: "0x0000000000000000000000000000000000000002",
      percentage: 70
    },
    {
      label: "Contributor",
      recipient: "0x0000000000000000000000000000000000000003",
      percentage: 20
    },
    {
      label: "Platform",
      recipient: "0x0000000000000000000000000000000000000004",
      percentage: 10
    }
  ]
});

console.log(intent.checkoutUrl);
```

## Receipt Example

The receipt still proves the total verified payment first:

```txt
Amount:   10.00 USDC
Receiver: 0x0000000000000000000000000000000000000001
Status:   issued
```

For split intents, it also shows the accounting plan:

```txt
Split breakdown
Revenue Split Plan
Collect to 0x0000000000000000000000000000000000000001

Creator      7.00 USDC - 70%
Contributor  2.00 USDC - 20%
Platform     1.00 USDC - 10%
```

Receipt disclaimer:

```txt
Split breakdown records the intended allocation for this payment. Automatic disbursement is not enabled in this MVP.
```

## Webhook Payload Example

`payment_intent.paid` includes both the raw `splitPlan` metadata string and a structured `split` object.

```json
{
  "type": "payment_intent.paid",
  "data": {
    "paymentIntentId": "pi_...",
    "amount": "10000000",
    "txHash": "0x...",
    "receiptUrl": "/receipts/rcpt_...",
    "splitId": "inline_revenue_split",
    "settlementReceiver": "0x0000000000000000000000000000000000000001",
    "split": {
      "splitId": "inline_revenue_split",
      "name": "Revenue Split Plan",
      "settlementReceiver": "0x0000000000000000000000000000000000000001",
      "totalAmount": "10000000",
      "allocations": [
        {
          "label": "Creator",
          "address": "0x0000000000000000000000000000000000000002",
          "shareBps": 7000,
          "amount": "7000000"
        },
        {
          "label": "Contributor",
          "address": "0x0000000000000000000000000000000000000003",
          "shareBps": 2000,
          "amount": "2000000"
        },
        {
          "label": "Platform",
          "address": "0x0000000000000000000000000000000000000004",
          "shareBps": 1000,
          "amount": "1000000"
        }
      ]
    }
  }
}
```

## Validation Rules

ArcFlow rejects split intents when:

- Percentages do not total exactly `100%`.
- A recipient address is not a valid EVM address.
- A recipient has a zero or negative percentage.
- A percentage has more than two decimal places.
- The settlement receiver is missing or invalid.

## Allocation Math

USDC has 6 decimals, so ArcFlow stores and verifies amounts in raw USDC units.

Example:

```txt
10 USDC = 10000000 raw units
70%     = 7000000 raw units
20%     = 2000000 raw units
10%     = 1000000 raw units
```

For decimal percentages, ArcFlow computes each allocation in order and assigns the rounding remainder to the final recipient. This makes the split deterministic and guarantees:

```txt
sum(split allocation raw amounts) === paid total raw amount
```

Example:

```txt
0.01 USDC = 10000 raw units
33.33%    = 3333 raw units
33.33%    = 3333 raw units
33.34%    = 3334 raw units
Total     = 10000 raw units
```

## Flow Log Example

After settlement, ArcFlow records:

```txt
split.recorded
Recorded split plan for Revenue Split Plan: 70% to Creator, 20% to Contributor, 10% to Platform.
```

## Upgrade Path: Settlement Splits

To upgrade Revenue Split Plan into a real settlement split, ArcFlow needs a contract-mediated payment path. Plain ERC-20 transfers cannot automatically split funds. If a payer transfers USDC directly to a wallet, no recipient disbursement happens unless another transaction later moves funds.

The target flow is:

```txt
Create Revenue Split Plan intent
-> ArcFlow computes split plan
-> Checkout detects template = revenue_split
-> Wallet approves ArcFlowSplitter for total USDC
-> Wallet calls ArcFlowSplitter.payAndSplit(intentId, recipients, amounts)
-> Splitter pulls USDC from payer
-> Splitter transfers exact amounts to recipients
-> Splitter emits SplitSettled
-> ArcFlow verifies SplitSettled plus recipient Transfer events
-> Receipt says "Split executed"
```

See [SETTLEMENT_SPLITTER.md](SETTLEMENT_SPLITTER.md) for the contract architecture.
