import "dotenv/config";
import cors from "cors";
import express from "express";
import { verifyArcFlowWebhook } from "../../packages/sdk/src/webhooks";

const app = express();
const port = Number(process.env.MERCHANT_PORT || 9090);
const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET || "local-dev-secret";
const unlockedCustomers = new Map<string, { productId: string; unlockedAt: string }>();

app.use(cors());

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "ArcFlow merchant example" });
});

app.get("/access/:customerId", (request, response) => {
  response.json({
    customerId: request.params.customerId,
    access: unlockedCustomers.get(request.params.customerId) || null
  });
});

app.get("/webhooks/arcflow", (_request, response) => {
  response.json({
    ok: true,
    endpoint: "/webhooks/arcflow",
    method: "POST",
    message: "ArcFlow webhook receiver is active. Send signed payment events here with POST.",
    signatureHeader: "x-arcflow-signature",
    supportedEvents: ["payment_intent.paid"]
  });
});

app.post("/webhooks/arcflow", express.raw({ type: "application/json" }), (request, response) => {
  try {
    const event = verifyArcFlowWebhook({
      payload: request.body,
      signature: request.headers["x-arcflow-signature"],
      secret: webhookSecret
    });

    if (event.type === "payment_intent.paid") {
      const customerId = String(event.data.customerId || event.data.paymentIntentId || "unknown_customer");
      const productId = String(event.data.productId || "paid_access");
      unlockedCustomers.set(customerId, {
        productId,
        unlockedAt: new Date().toISOString()
      });
    }

    response.json({ received: true });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid ArcFlow webhook."
    });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Merchant example API listening on http://127.0.0.1:${port}`);
});
