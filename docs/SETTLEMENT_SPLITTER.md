# Settlement Split Architecture

Revenue Split Plan is accounting-only. Settlement Split is the future contract-backed version that actually disburses USDC to recipients in the payment transaction.

## Why A Contract Is Required

A plain ERC-20 `transfer` can only move USDC from the payer to one receiver. It cannot automatically fan funds out to multiple recipients.

To split funds during checkout, the wallet must interact with a contract:

```txt
approve USDC to ArcFlowSplitter
-> call payAndSplit(...)
-> contract pulls USDC from payer
-> contract transfers exact amounts to recipients
-> contract emits split settlement event
```

## Target Flow

```txt
Create Revenue Split Plan intent
-> ArcFlow computes split plan
-> Checkout detects template = revenue_split
-> Wallet approves ArcFlowSplitter for total USDC
-> Wallet calls ArcFlowSplitter.payAndSplit(intentId, recipients, amounts)
-> ArcFlowSplitter transfers:
   7 USDC -> Creator
   2 USDC -> Contributor
   1 USDC -> Platform
-> ArcFlowSplitter emits SplitSettled
-> ArcFlow verifies SplitSettled plus USDC Transfer events
-> Receipt says "Split executed"
-> Webhook/logs record actual disbursement
```

## Contract Shape

The contract should:

- Accept only the configured Arc ERC-20 USDC token.
- Require recipient and amount array lengths to match.
- Require every recipient to be non-zero.
- Require every amount to be non-zero.
- Sum exact raw USDC amounts.
- Pull total USDC from `msg.sender`.
- Transfer each allocation to its recipient.
- Emit one settlement event containing intent ID, payer, total, recipients, and amounts.

Starter contract: [`contracts/ArcFlowSplitter.sol`](../contracts/ArcFlowSplitter.sol)

## Checkout Changes

Current wallet checkout:

```txt
USDC.transfer(intent.receiver, intent.amount)
```

Settlement split checkout:

```txt
USDC.approve(ArcFlowSplitter, intent.amount)
ArcFlowSplitter.payAndSplit(intentId, recipients, amounts)
```

The checkout UI should show two wallet steps:

```txt
1. Approve USDC
2. Execute split
```

## Verification Changes

Current verifier checks:

- Correct Arc Testnet chain.
- Successful transaction.
- Correct USDC token.
- Correct receiver.
- Correct total amount.
- Matching ERC-20 `Transfer` event.

Settlement split verifier should check:

- Correct Arc Testnet chain.
- Successful transaction.
- Transaction called the configured `ArcFlowSplitter`.
- `SplitSettled` event exists for the expected intent ID.
- Event payer matches the transaction sender.
- Event total equals the payment intent amount.
- Event recipients and amounts match `splitPlan.allocations` exactly.
- USDC `Transfer` logs exist from splitter to each recipient for each exact amount.
- Tx hash has not already been used.
- Intent is still pending before settlement.

## Receipt/Webhook Copy

Before contract settlement:

```txt
Split breakdown records the intended allocation for this payment. Automatic disbursement is not enabled in this MVP.
```

After contract settlement:

```txt
Split executed. Funds were disbursed on Arc according to this allocation.
```

## Deployment Notes

Arc Testnet details:

```txt
Chain ID: 5042002
ERC-20 USDC: 0x3600000000000000000000000000000000000000
Explorer: https://testnet.arcscan.app
```

Use environment variables for deployer credentials. Do not hardcode or commit private keys.
