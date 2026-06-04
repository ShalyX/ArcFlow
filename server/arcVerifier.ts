import { createPublicClient, decodeEventLog, http, isAddress, zeroAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET } from "../src/shared/arc";
import type { PaymentIntent } from "../src/shared/types";

const transferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" }
    ],
    name: "Transfer",
    type: "event"
  }
] as const;

export type VerifiedPayment = {
  payer: `0x${string}`;
  txHash: `0x${string}`;
};

export function validateIntentAddress(address: string): address is `0x${string}` {
  return isAddress(address) && address !== zeroAddress;
}

export async function verifyArcUsdcTransfer(intent: PaymentIntent, txHash: `0x${string}`): Promise<VerifiedPayment> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL || ARC_TESTNET.rpcUrl)
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("Transaction did not succeed on Arc Testnet.");
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ARC_TESTNET.usdcAddress.toLowerCase()) continue;

    try {
      const decoded = decodeEventLog({
        abi: transferAbi,
        data: log.data,
        topics: log.topics
      });

      if (decoded.eventName !== "Transfer") continue;
      const { from, to, value } = decoded.args;
      const amountMatches = value === BigInt(intent.amount);
      const receiverMatches = to.toLowerCase() === intent.receiver.toLowerCase();

      if (amountMatches && receiverMatches) {
        return {
          payer: from,
          txHash
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("No matching Arc USDC transfer was found in that transaction.");
}
