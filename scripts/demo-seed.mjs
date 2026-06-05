const apiBase = process.env.ARCFLOW_API_BASE || "http://127.0.0.1:8787/api";

async function main() {
  const response = await fetch(`${apiBase}/demo/seed`, { method: "POST" });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Could not seed demo intent. Is the ArcFlow API running?");
  }

  const checkoutUrl = new URL(body.checkoutUrl, "http://127.0.0.1:5173").toString();
  console.log("Seeded demo payment intent");
  console.log(`Intent:   ${body.id}`);
  console.log(`Amount:   10.00 USDC`);
  console.log(`Checkout: ${checkoutUrl}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
