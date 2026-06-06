import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, stringToBytes, zeroAddress, type Address, type Hex } from "viem";

const { viem } = await network.create({ network: "hardhatArc" });

const intentId = keccak256(stringToBytes("pi_contract_split_demo"));
const totalAmount = 10_000_000n;

async function deployFixture() {
  const [payer, creator, contributor, platform] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const usdc = await viem.deployContract("MockUsdc");
  const splitter = await viem.deployContract("ArcFlowSplitter", [usdc.address]);

  await usdc.write.mint([payer.account.address, totalAmount]);
  await usdc.write.approve([splitter.address, totalAmount], { account: payer.account });

  return { payer, creator, contributor, platform, publicClient, usdc, splitter };
}

async function assertRejectsWith(promise: Promise<unknown>, expected: string) {
  await assert.rejects(promise, (error) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, new RegExp(expected));
    return true;
  });
}

async function main() {
  await rejectsEmptyRecipients();
  await rejectsLengthMismatch();
  await rejectsZeroRecipient();
  await rejectsZeroAmount();
  await pullsExactTotalAndTransfersExactAmounts();
  await emitsSplitPaidAndPerRecipientTransfers();
}

async function rejectsEmptyRecipients() {
  const { payer, splitter } = await deployFixture();
  await assertRejectsWith(splitter.write.payAndSplit([intentId, [], []], { account: payer.account }), "LengthMismatch");
}

async function rejectsLengthMismatch() {
  const { payer, creator, splitter } = await deployFixture();
  await assertRejectsWith(
    splitter.write.payAndSplit([intentId, [creator.account.address], []], { account: payer.account }),
    "LengthMismatch"
  );
}

async function rejectsZeroRecipient() {
  const { payer, splitter } = await deployFixture();
  await assertRejectsWith(
    splitter.write.payAndSplit([intentId, [zeroAddress], [totalAmount]], { account: payer.account }),
    "InvalidRecipient"
  );
}

async function rejectsZeroAmount() {
  const { payer, creator, splitter } = await deployFixture();
  await assertRejectsWith(
    splitter.write.payAndSplit([intentId, [creator.account.address], [0n]], { account: payer.account }),
    "InvalidAmount"
  );
}

async function pullsExactTotalAndTransfersExactAmounts() {
  const { payer, creator, contributor, platform, usdc, splitter } = await deployFixture();
  const recipients = [creator.account.address, contributor.account.address, platform.account.address] as Address[];
  const amounts = [7_000_000n, 2_000_000n, 1_000_000n];

  await splitter.write.payAndSplit([intentId, recipients, amounts], { account: payer.account });

  assert.equal(await usdc.read.balanceOf([payer.account.address]), 0n);
  assert.equal(await usdc.read.balanceOf([splitter.address]), 0n);
  assert.equal(await usdc.read.balanceOf([creator.account.address]), 7_000_000n);
  assert.equal(await usdc.read.balanceOf([contributor.account.address]), 2_000_000n);
  assert.equal(await usdc.read.balanceOf([platform.account.address]), 1_000_000n);
  assert.equal(amounts.reduce((sum, amount) => sum + amount, 0n), totalAmount);
}

async function emitsSplitPaidAndPerRecipientTransfers() {
  const { payer, creator, contributor, platform, publicClient, splitter } = await deployFixture();
  const recipients = [creator.account.address, contributor.account.address, platform.account.address] as Address[];
  const amounts = [7_000_000n, 2_000_000n, 1_000_000n];

  const hash = await splitter.write.payAndSplit([intentId, recipients, amounts], { account: payer.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const paidEvents = await splitter.getEvents.SplitPaid({}, { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
  assert.equal(paidEvents.length, 1);
  assert.equal(paidEvents[0].args.intentId as Hex, intentId);
  assert.equal(getAddress(paidEvents[0].args.payer as Address), getAddress(payer.account.address));
  assert.equal(paidEvents[0].args.totalAmount, totalAmount);
  assert.deepEqual((paidEvents[0].args.recipients as Address[]).map(getAddress), recipients.map(getAddress));
  assert.deepEqual(paidEvents[0].args.amounts, amounts);

  const transferEvents = await splitter.getEvents.SplitTransfer({}, { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
  assert.equal(transferEvents.length, 3);

  for (const [index, event] of transferEvents.entries()) {
    assert.equal(event.args.intentId as Hex, intentId);
    assert.equal(getAddress(event.args.recipient as Address), getAddress(recipients[index]));
    assert.equal(event.args.amount, amounts[index]);
  }
}

await main();
console.log("ArcFlowSplitter contract tests passed.");
