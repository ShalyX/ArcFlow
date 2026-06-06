# SDK Demo Guide

Use this pass to prove SDK auth, project scoping, hosted checkout, receipts, and the safety boundary.

## 1. Start ArcFlow

```bash
npm run dev:all
```

Local services:

```txt
Console:       http://127.0.0.1:5173
ArcFlow API:   http://127.0.0.1:8787
Merchant Demo: http://127.0.0.1:9090
SQLite DB:     data/arcflow.sqlite
```

## 2. Create a Bootstrap API Key

Open the console:

```txt
http://127.0.0.1:5173
```

Go to Developer Config, create an API key, and copy the full `ak_test_...` value.

In PowerShell:

```powershell
$env:ARCFLOW_API_KEY="ak_test_your_key_here"
```

Confirm it:

```powershell
$env:ARCFLOW_API_KEY
```

## 3. Run the SDK Script

```powershell
@'
import { ArcFlow } from "./packages/sdk/src/index.ts";

const bootstrap = new ArcFlow({
  baseUrl: "http://127.0.0.1:8787/api",
  apiKey: process.env.ARCFLOW_API_KEY
});

const { project, apiKey } = await bootstrap.projects.create("SDK Demo Merchant");
console.log("project", project.id);

const client = new ArcFlow({
  baseUrl: "http://127.0.0.1:8787/api",
  apiKey: apiKey.key
});

const intent = await client.paymentIntents.create({
  amount: "3.00",
  receiver: "0x0000000000000000000000000000000000000001",
  description: "SDK demo checkout",
  template: "payment-link",
  metadata: { customerId: "cus_sdk_demo" }
});

console.log("intent", intent.id, intent.checkoutUrl);

const state = await client.state.get();
console.log("project state", state.currentProjectId, state.paymentIntents.length);
'@ | node --import tsx --input-type=module
```

Expected shape:

```txt
project proj_...
intent pi_... /pay/pi_...
project state proj_... 1
```

## 4. Open Hosted Checkout

Open the checkout URL from the script:

```txt
http://127.0.0.1:5173/pay/pi_...
```

For a no-wallet local pass, click Demo settle.

For a real wallet pass:

1. Connect wallet.
2. Switch to Arc Testnet.
3. Submit the USDC transfer.
4. Let ArcFlow verify the transaction.
5. Open the receipt.

## 5. Confirm the Boundary

Hosted checkout links are intentionally public by ID.

They can:

- Load the one payment intent by ID.
- Confirm a transaction for that intent.
- Demo-settle that intent in local/demo mode.
- Load the one receipt by ID.

They cannot:

- List project dashboard state.
- List unrelated receipts.
- Manage webhook endpoints.
- Manage API keys.
- Create projects.
- Switch project ownership.

## Known Local Demo Notes

- Restart `npm run dev:all` after route or server changes.
- The browser's active console API key may differ from the SDK-created project key.
- Checkout and receipt links are public by ID and should work across console project context.
- Project dashboard state requires a valid API key.
- Full API keys are shown once; create a new key if you lose one.
