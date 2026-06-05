const apiBase = process.env.ARCFLOW_API_BASE || "http://127.0.0.1:8787/api";

async function main() {
  const response = await fetch(`${apiBase}/demo/reset`, { method: "POST" });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Could not reset demo data. Is the ArcFlow API running?");
  }

  console.log("Reset ArcFlow demo data");
  console.log(`Payment intents: ${body.paymentIntents.length}`);
  console.log(`Receipts:        ${body.receipts.length}`);
  console.log(`Webhook events:  ${body.webhookDeliveries.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
