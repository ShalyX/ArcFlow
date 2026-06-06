import { network } from "hardhat";
import { ARC_TESTNET } from "../src/shared/arc";

const { viem } = await network.create({ network: "arcTestnet" });

const { contract: splitter, deploymentTransaction } = await viem.sendDeploymentTransaction("ArcFlowSplitter", [
  ARC_TESTNET.usdcAddress
]);

console.log("ArcFlowSplitter deployed");
console.log(`network=${ARC_TESTNET.name}`);
console.log(`chainId=${ARC_TESTNET.id}`);
console.log(`usdc=${ARC_TESTNET.usdcAddress}`);
console.log(`splitter=${splitter.address}`);
console.log(`tx=${deploymentTransaction}`);
