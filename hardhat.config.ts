import hardhatViem from "@nomicfoundation/hardhat-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatViem],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24"
      },
      production: {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    }
  },
  networks: {
    hardhatArc: {
      type: "edr-simulated",
      chainType: "l1"
    },
    arcTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("ARC_TESTNET_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")]
    }
  }
});
