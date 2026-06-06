# Changelog

## v0.2.0 - Revenue Split Template

- Added accounting-first revenue split payment intents.
- Added inline SDK split input with recipient labels, addresses, and percentages.
- Computed deterministic raw-USDC allocations that sum exactly to the paid total.
- Rendered split breakdowns and a no-auto-disbursement disclaimer on receipts.
- Included structured split metadata in signed webhook payloads and flow logs.
- Added validation coverage for split percentages, recipient addresses, zero/negative values, exact allocation sums, and rounding remainders.

## v0.1.3 - Hosted Checkout Project Settlement Fix

- Added authenticated SDK helpers for projects, API keys, webhooks, webhook delivery retry, and payment intents.
- Fixed hosted checkout settlement so checkout confirmation resolves by payment intent ID and records into that intent's project.
- Added direct receipt lookup by receipt ID so receipt links work even when the console is scoped to another project.
- Guarded project state from hosted checkout: `/api/state` requires a valid project API key after bootstrap.
- Added regression coverage for hosted checkout project settlement, direct receipt reads, SDK authenticated helpers, and project boundary rules.

## v0.1.2 - Project-Scoped ArcFlow Resources

- Added projects and default `Demo Merchant` bootstrapping.
- Scoped payment intents, receipts, webhook endpoints, webhook deliveries, flow logs, and API keys to projects.
- Added project selector and project creation in the console.
- Added per-project browser key storage for local project switching.
- Filtered webhook delivery endpoints by project.

## v0.1.1 - Webhook Debug Polish

- Added webhook endpoint signing secrets, copy controls, rotation/sync, and last-rotated timestamps.
- Added webhook delivery detail view with payload, response body, HTTP status, signature header, retry count, and timestamps.
- Added endpoint validation for empty, invalid, duplicate, unsupported-protocol, and no-event endpoints.
- Added clearer local webhook delivery connection errors.
- Kept bundled merchant demo webhook secret in sync with the local receiver.

## v0.1.0 - Local ArcFlow MVP

- Added local ArcFlow console, API, SQLite persistence, merchant demo, wallet checkout, payment intents, receipts, signed webhooks, flow logs, SDK packages, developer onboarding, CI, and verification tests.
