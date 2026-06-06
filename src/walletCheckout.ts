import { createPublicClient, createWalletClient, custom, erc20Abi, http, isAddress, keccak256, stringToBytes, zeroAddress, type Address, type EIP1193Provider, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET } from "./shared/arc";
import type { PaymentIntent, SplitPlan } from "./shared/types";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const arcHexChainId = `0x${ARC_TESTNET.id.toString(16)}`;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET.rpcUrl)
});

const splitterAbi = [
  {
    type: "function",
    name: "payAndSplit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" }
    ],
    outputs: []
  }
] as const;

export type WalletPaymentResult = {
  account: Address;
  txHash: Hash;
};

export type WalletCheckoutStep =
  | "connect-wallet"
  | "switch-network"
  | "check-balance"
  | "approve-split"
  | "execute-split"
  | "submit-transfer"
  | "wait-confirmation";

export type WalletPaymentOptions = {
  onStep?: (step: WalletCheckoutStep) => void;
};

export async function connectAndPayIntent(intent: PaymentIntent, options: WalletPaymentOptions = {}): Promise<WalletPaymentResult> {
  const provider = window.ethereum;
  if (!provider) {
    throw new Error("No injected wallet was found. Install a wallet like MetaMask or Rabby and try again.");
  }

  options.onStep?.("switch-network");
  await ensureArcTestnet(provider);

  const walletClient = createWalletClient({
    chain: arcTestnet,
    transport: custom(provider)
  });

  options.onStep?.("connect-wallet");
  const [account] = await walletClient.requestAddresses();
  if (!account) {
    throw new Error("Wallet connection was not approved.");
  }

  options.onStep?.("check-balance");
  const amount = BigInt(intent.amount);
  const balance = await publicClient.readContract({
    address: ARC_TESTNET.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account]
  });

  if (balance < amount) {
    throw new Error("Connected wallet does not have enough Arc Testnet USDC for this payment.");
  }

  if (intent.template === "revenue_split_executable") {
    return payExecutableSplit({ intent, account, amount, walletClient, options });
  }

  options.onStep?.("submit-transfer");
  const txHash = await walletClient.writeContract({
    account,
    address: ARC_TESTNET.usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [intent.receiver, amount]
  });

  options.onStep?.("wait-confirmation");
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 120_000
  });

  return { account, txHash };
}

async function payExecutableSplit({
  intent,
  account,
  amount,
  walletClient,
  options
}: {
  intent: PaymentIntent;
  account: Address;
  amount: bigint;
  walletClient: ReturnType<typeof createWalletClient>;
  options: WalletPaymentOptions;
}) {
  const splitterAddress = configuredSplitterAddress();
  const splitPlan = parseSplitPlan(intent);
  const recipients = splitPlan.allocations.map((allocation) => allocation.address);
  const amounts = splitPlan.allocations.map((allocation) => BigInt(allocation.amount));
  const allocationTotal = amounts.reduce((sum, value) => sum + value, 0n);
  if (allocationTotal !== amount) {
    throw new Error("Split allocation amounts do not equal the checkout total.");
  }

  options.onStep?.("approve-split");
  const approvalHash = await walletClient.writeContract({
    account,
    chain: arcTestnet,
    address: ARC_TESTNET.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [splitterAddress, amount]
  });
  await publicClient.waitForTransactionReceipt({
    hash: approvalHash,
    timeout: 120_000
  });

  options.onStep?.("execute-split");
  const txHash = await walletClient.writeContract({
    account,
    chain: arcTestnet,
    address: splitterAddress,
    abi: splitterAbi,
    functionName: "payAndSplit",
    args: [keccak256(stringToBytes(intent.id)), recipients, amounts]
  });

  options.onStep?.("wait-confirmation");
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 120_000
  });

  return { account, txHash };
}

function configuredSplitterAddress() {
  const address = (import.meta.env.VITE_ARCFLOW_SPLITTER_ADDRESS || ARC_TESTNET.splitterAddress) as Address;
  if (!isAddress(address) || address === zeroAddress) {
    throw new Error("Executable split checkout needs VITE_ARCFLOW_SPLITTER_ADDRESS set to the deployed ArcFlowSplitter contract.");
  }
  return address;
}

function parseSplitPlan(intent: PaymentIntent): SplitPlan {
  if (!intent.metadata.splitPlan) {
    throw new Error("Executable split checkout needs a split plan on the payment intent.");
  }
  try {
    return JSON.parse(intent.metadata.splitPlan) as SplitPlan;
  } catch {
    throw new Error("Executable split checkout has an invalid split plan.");
  }
}

async function ensureArcTestnet(provider: EIP1193Provider) {
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (typeof currentChainId === "string" && currentChainId.toLowerCase() === arcHexChainId.toLowerCase()) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: arcHexChainId }]
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number(error.code) : undefined;
    if (code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: arcHexChainId,
          chainName: ARC_TESTNET.name,
          nativeCurrency: {
            name: "USDC",
            symbol: "USDC",
            decimals: 18
          },
          rpcUrls: [ARC_TESTNET.rpcUrl],
          blockExplorerUrls: [ARC_TESTNET.explorerUrl]
        }
      ]
    });
  }
}
