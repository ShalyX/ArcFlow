import { createPublicClient, decodeEventLog, http, isAddress, keccak256, stringToBytes, zeroAddress, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET } from "../src/shared/arc";
import type { PaymentIntent, SplitPlan } from "../src/shared/types";

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

const splitterAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "intentId", type: "bytes32" },
      { indexed: true, name: "payer", type: "address" },
      { indexed: false, name: "totalAmount", type: "uint256" },
      { indexed: false, name: "recipients", type: "address[]" },
      { indexed: false, name: "amounts", type: "uint256[]" }
    ],
    name: "SplitPaid",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "intentId", type: "bytes32" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" }
    ],
    name: "SplitTransfer",
    type: "event"
  }
] as const;

export type TransferLogCandidate = {
  address: `0x${string}`;
  data: Hex;
  topics: readonly Hex[];
};

export type VerifiedPayment = {
  payer: `0x${string}`;
  txHash: `0x${string}`;
  tokenAddress: `0x${string}`;
  receiver: `0x${string}`;
  amount: string;
  chainId: number;
  blockNumber: string;
};

export type VerifiedExecutableSplit = VerifiedPayment & {
  splitterAddress: `0x${string}`;
  splitPlan: SplitPlan;
};

export function validateIntentAddress(address: string): address is `0x${string}` {
  return isAddress(address) && address !== zeroAddress;
}

export function arcFlowIntentIdHash(paymentIntentId: string) {
  return keccak256(stringToBytes(paymentIntentId));
}

export function findMatchingUsdcTransfer({
  logs,
  expectedReceiver,
  expectedAmount,
  usdcAddress
}: {
  logs: readonly TransferLogCandidate[];
  expectedReceiver: `0x${string}`;
  expectedAmount: string;
  usdcAddress: `0x${string}`;
}) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) continue;

    const transfer = decodeTransferLog(log);
    if (!transfer) continue;
    const { from, to, value } = transfer;
    const amountMatches = value === BigInt(expectedAmount);
    const receiverMatches = to.toLowerCase() === expectedReceiver.toLowerCase();

    if (amountMatches && receiverMatches) {
      return {
        payer: from,
        tokenAddress: log.address,
        receiver: to,
        amount: value.toString()
      };
    }
  }

  return null;
}

export function findMatchingExecutableSplit({
  logs,
  paymentIntentId,
  splitPlan,
  splitterAddress,
  usdcAddress
}: {
  logs: readonly TransferLogCandidate[];
  paymentIntentId: string;
  splitPlan: SplitPlan;
  splitterAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}) {
  const expectedIntentId = arcFlowIntentIdHash(paymentIntentId);
  const expectedRecipients = splitPlan.allocations.map((allocation) => allocation.address.toLowerCase());
  const expectedAmounts = splitPlan.allocations.map((allocation) => BigInt(allocation.amount));
  const allocationTotal = expectedAmounts.reduce((sum, amount) => sum + amount, 0n);

  if (allocationTotal !== BigInt(splitPlan.totalAmount)) {
    throw new Error("Split allocation raw amounts do not sum to the payment total.");
  }

  const paid = findSplitPaidLog({ logs, expectedIntentId, splitPlan, splitterAddress });
  if (!paid) return null;

  const splitTransfers = findSplitTransferLogs({ logs, splitterAddress });
  if (splitTransfers.length !== splitPlan.allocations.length) return null;

  const splitterUsdcTransfers = findSplitterUsdcTransfers({ logs, splitterAddress, usdcAddress });
  if (splitterUsdcTransfers.length !== splitPlan.allocations.length) return null;

  for (let index = 0; index < splitPlan.allocations.length; index++) {
    const recipient = expectedRecipients[index];
    const amount = expectedAmounts[index];

    const hasSplitTransfer = splitTransfers.some(
      (event) =>
        event.intentId.toLowerCase() === expectedIntentId.toLowerCase() &&
        event.recipient.toLowerCase() === recipient &&
        event.amount === amount
    );

    if (!hasSplitTransfer) return null;

    const hasUsdcTransfer = splitterUsdcTransfers.some((transfer) => transfer.to.toLowerCase() === recipient && transfer.value === amount);

    if (!hasUsdcTransfer) return null;
  }

  return {
    payer: paid.payer,
    tokenAddress: usdcAddress,
    receiver: splitterAddress,
    amount: splitPlan.totalAmount,
    splitterAddress,
    splitPlan
  };
}

export async function verifyArcExecutableSplit(
  intent: PaymentIntent,
  txHash: `0x${string}`,
  splitPlan: SplitPlan,
  splitterAddress: `0x${string}` = process.env.ARCFLOW_SPLITTER_ADDRESS as `0x${string}` || ARC_TESTNET.splitterAddress
): Promise<VerifiedExecutableSplit> {
  if (intent.template !== "revenue_split_executable") {
    throw new Error("Payment intent is not an executable revenue split.");
  }
  if (!validateIntentAddress(splitterAddress)) {
    throw new Error("ArcFlow splitter contract address is not configured.");
  }

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
  if (transaction.to?.toLowerCase() !== splitterAddress.toLowerCase()) {
    throw new Error("Transaction did not call the configured ArcFlowSplitter contract.");
  }

  const match = findMatchingExecutableSplit({
    logs: receipt.logs,
    paymentIntentId: intent.id,
    splitPlan,
    splitterAddress,
    usdcAddress: ARC_TESTNET.usdcAddress
  });

  if (match) {
    return {
      ...match,
      txHash,
      chainId,
      blockNumber: receipt.blockNumber.toString()
    };
  }

  throw new Error("No matching executable split settlement was found in that transaction.");
}

function findSplitPaidLog({
  logs,
  expectedIntentId,
  splitPlan,
  splitterAddress
}: {
  logs: readonly TransferLogCandidate[];
  expectedIntentId: Hex;
  splitPlan: SplitPlan;
  splitterAddress: `0x${string}`;
}) {
  const expectedRecipients = splitPlan.allocations.map((allocation) => allocation.address.toLowerCase());
  const expectedAmounts = splitPlan.allocations.map((allocation) => BigInt(allocation.amount));
  const splitPaidLogs = logs.flatMap((log) => {
    if (log.address.toLowerCase() !== splitterAddress.toLowerCase()) return [];
    const decoded = decodeSplitterLog(log);
    if (decoded?.eventName !== "SplitPaid") return [];
    return [decoded];
  });

  if (splitPaidLogs.length !== 1) return null;

  for (const decoded of splitPaidLogs) {
    if (decoded.args.intentId.toLowerCase() !== expectedIntentId.toLowerCase()) continue;
    if (decoded.args.totalAmount !== BigInt(splitPlan.totalAmount)) continue;
    if (decoded.args.recipients.length !== expectedRecipients.length || decoded.args.amounts.length !== expectedAmounts.length) continue;

    const recipientsMatch = decoded.args.recipients.every((recipient, index) => recipient.toLowerCase() === expectedRecipients[index]);
    const amountsMatch = decoded.args.amounts.every((amount, index) => amount === expectedAmounts[index]);
    if (!recipientsMatch || !amountsMatch) continue;

    return {
      payer: decoded.args.payer
    };
  }

  return null;
}

function findSplitTransferLogs({
  logs,
  splitterAddress
}: {
  logs: readonly TransferLogCandidate[];
  splitterAddress: `0x${string}`;
}) {
  return logs.flatMap((log) => {
    if (log.address.toLowerCase() !== splitterAddress.toLowerCase()) return [];
    const decoded = decodeSplitterLog(log);
    if (decoded?.eventName !== "SplitTransfer") return [];
    return [{ intentId: decoded.args.intentId, recipient: decoded.args.recipient, amount: decoded.args.amount }];
  });
}

function findSplitterUsdcTransfers({
  logs,
  splitterAddress,
  usdcAddress
}: {
  logs: readonly TransferLogCandidate[];
  splitterAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}) {
  return logs.flatMap((log) => {
    if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) return [];
    const transfer = decodeTransferLog(log);
    if (!transfer || transfer.from.toLowerCase() !== splitterAddress.toLowerCase()) return [];
    return [transfer];
  });
}

function decodeTransferLog(log: TransferLogCandidate) {
  try {
    const decoded = decodeEventLog({
      abi: transferAbi,
      data: log.data,
      topics: [...log.topics] as [] | [signature: Hex, ...args: Hex[]]
    });

    if (decoded.eventName !== "Transfer") return null;
    return decoded.args;
  } catch {
    return null;
  }
}

function decodeSplitterLog(log: TransferLogCandidate) {
  try {
    return decodeEventLog({
      abi: splitterAbi,
      data: log.data,
      topics: [...log.topics] as [] | [signature: Hex, ...args: Hex[]]
    });
  } catch {
    return null;
  }
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

  const match = findMatchingUsdcTransfer({
    logs: receipt.logs,
    expectedReceiver: intent.receiver,
    expectedAmount: intent.amount,
    usdcAddress: ARC_TESTNET.usdcAddress
  });

  if (match) {
    return {
      ...match,
      txHash,
      chainId,
      blockNumber: receipt.blockNumber.toString()
    };
  }

  throw new Error("No matching Arc USDC transfer was found in that transaction.");
}
