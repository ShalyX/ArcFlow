export const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  splitterAddress: "0x0000000000000000000000000000000000000000",
  usdcDecimals: 6
} as const;

export function formatUsdc(rawAmount: string) {
  const value = BigInt(rawAmount);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction.slice(0, 2)}`;
}

export function parseUsdc(amount: string) {
  const normalized = amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Amount must be a positive USDC value with up to 6 decimals.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
}
