import { createPublicClient, createWalletClient, custom, erc20Abi, http, type Address, type EIP1193Provider, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET } from "./shared/arc";
import type { PaymentIntent } from "./shared/types";

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

export type WalletPaymentResult = {
  account: Address;
  txHash: Hash;
};

export type WalletCheckoutStep =
  | "connect-wallet"
  | "switch-network"
  | "check-balance"
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
