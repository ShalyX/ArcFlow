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
  tokenAddress: `0x${string}`;
  receiver: `0x${string}`;
  amount: string;
  chainId: number;
  blockNumber: string;
};

export function validateIntentAddress(address: string): address is `0x${string}` {
  return isAddress(address) && address !== zeroAddress;
}

export async function verifyArcUsdcTransfer(intent: PaymentIntent, txHash: `0x${string}`): Promise<VerifiedPayment> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL || ARC_TESTNET.rpcUrl)
  });

  const chainId = await client.getChainId();
  if (chainId !== ARC_TESTNET.id) {
    throw new Error(`Verifier is connected to chain ${chainId}, expected Arc Testnet ${ARC_TESTNET.id}.`);
  }

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("Transaction did not succeed on Arc Testnet.");
  }

  const transaction = await client.getTransaction({ hash: txHash });
  if (transaction.chainId !== undefined && transaction.chainId !== ARC_TESTNET.id) {
    throw new Error("Transaction hash is not from Arc Testnet.");
  }
  if (transaction.to?.toLowerCase() !== ARC_TESTNET.usdcAddress.toLowerCase()) {
    throw new Error("Transaction did not call the Arc ERC-20 USDC token contract.");
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
          txHash,
          tokenAddress: log.address,
          receiver: to,
          amount: value.toString(),
          chainId,
          blockNumber: receipt.blockNumber.toString()
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("No matching Arc USDC transfer was found in that transaction.");
}
